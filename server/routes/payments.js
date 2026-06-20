const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();

const { getAccountByRole } = require('../services/accountResolver');

// GET /api/payments
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    const offset = (page - 1) * pageSize;
    const limit = pageSize;
    const { search, status, mode, from_date, to_date } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.doc_number ILIKE $${idx} OR v.name ILIKE $${idx} OR p.reference_no ILIKE $${idx} OR p.payment_mode ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`p.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (mode) {
      conditions.push(`p.payment_mode = $${idx}`);
      params.push(mode);
      idx++;
    }
    if (from_date) {
      conditions.push(`p.date >= $${idx}`);
      params.push(from_date);
      idx++;
    }
    if (to_date) {
      conditions.push(`p.date <= $${idx}`);
      params.push(to_date);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const joins = 'LEFT JOIN vendors v ON p.vendor_id = v.id LEFT JOIN accounts a ON p.bank_account_id = a.id';

    const [dataR, countR] = await Promise.all([
      pool.query(
        `SELECT p.*, v.name as vendor_name, a.name as bank_name
         FROM payments p ${joins}
         ${where}
         ORDER BY p.date DESC, p.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM payments p ${joins} ${where}`, params.slice(0, -2)),
    ]);
    const totalCount = parseInt(countR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);
    res.json({ data: dataR.rows, totalCount, page, pageSize, totalPages });
  } catch (err) {
    logger.error('[payments GET]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

// GET /api/payments/open?vendor_id=X
router.get('/open', authenticate, async (req, res) => {
  try {
    const vendorId = parseInt(req.query.vendor_id);
    if (!vendorId || isNaN(vendorId)) {
      return res.status(400).json({ error: 'vendor_id is required' });
    }
    let rows;
    try {
      const result = await pool.query(
        `SELECT id, doc_number, doc_date, grand_total,
                COALESCE(amount_paid, 0)          AS amount_paid,
                COALESCE(balance_due, grand_total) AS balance_due,
                COALESCE(payment_status, 'UNPAID') AS payment_status,
                reference_no, remark
         FROM purchase_notes
         WHERE vendor_id = $1
           AND status != 'cancelled'
           AND COALESCE(payment_status, 'UNPAID') != 'PAID'
         ORDER BY doc_date ASC, id ASC`,
        [vendorId]
      );
      rows = result.rows;
    } catch (_colErr) {
      logger.warn('[payments /open] phase9 columns missing, using fallback query. Run sql/phase9-payment-allocations.sql to enable full tracking.');
      const result = await pool.query(
        `SELECT id, doc_number, doc_date, grand_total,
                0            AS amount_paid,
                grand_total  AS balance_due,
                'UNPAID'     AS payment_status,
                reference_no, remark
         FROM purchase_notes
         WHERE vendor_id = $1 AND status != 'cancelled'
         ORDER BY doc_date ASC, id ASC`,
        [vendorId]
      );
      rows = result.rows;
    }

    res.json({ data: rows });
  } catch (err) {
    logger.error('[payments GET /open]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load open bills' });
  }
});

// POST /api/payments
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const fail = async (status, error) => {
      await client.query('ROLLBACK');
      return res.status(status).json({ error });
    };

    const {
      date, vendor_id, payment_mode, bank_account_id,
      reference_no, cheque_no, cheque_date, remark,
      allocations,
      manual_lines: rawManualLines,
      amount: rawAmount,
      cost_center_id,
    } = req.body;

    if (!vendor_id) return fail(400, 'Vendor is required');
    if (!bank_account_id) return fail(400, 'Payment account is required');
    if (!date) return fail(400, 'Date is required');

    const totalAmount = Math.round((parseFloat(rawAmount) || 0) * 100) / 100;
    if (totalAmount <= 0) return fail(400, 'Payment amount must be greater than 0');

    const hasAllocations = Array.isArray(allocations) && allocations.length > 0;
    let appliedToBills = 0;

    if (hasAllocations) {
      for (const a of allocations) {
        const amt = parseFloat(a.amount);
        if (!Number.isInteger(parseInt(a.purchase_note_id)) || isNaN(amt) || amt <= 0) {
          return fail(400, 'Each allocation requires a valid bill and amount > 0');
        }
        appliedToBills += amt;
      }
      appliedToBills = Math.round(appliedToBills * 100) / 100;
    }

    const advanceAmount = Math.round((totalAmount - appliedToBills) * 100) / 100;
    if (advanceAmount < -0.005) {
      return fail(400, `Bill allocations ₹${appliedToBills.toFixed(2)} exceed payment amount ₹${totalAmount.toFixed(2)}`);
    }

    const payableAccId = await getAccountByRole('ACCOUNTS_PAYABLE', client);
    if (!payableAccId) return fail(400, 'Accounts Payable (3001) not configured in chart of accounts');

    const manualLines = (Array.isArray(rawManualLines) ? rawManualLines : [])
      .filter(ml => ml.account_id && parseFloat(ml.amount) > 0);
    const manualLinesTotal = Math.round(manualLines.reduce((s, ml) => s + parseFloat(ml.amount), 0) * 100) / 100;

    if (manualLinesTotal > advanceAmount + 0.005) {
      return fail(400, `Manual posting lines ₹${manualLinesTotal.toFixed(2)} exceed on-account amount ₹${advanceAmount.toFixed(2)}`);
    }

    let advanceAccId = null;
    const remainingAdvance = Math.round((advanceAmount - manualLinesTotal) * 100) / 100;
    if (remainingAdvance > 0.005) {
      advanceAccId = await getAccountByRole('VENDOR_ADVANCE', client);
      if (!advanceAccId) return fail(400, 'Vendor Advance account (1050) not found. Run sql/phase12-advances.sql migration.');
    }

    const vendorR = await client.query('SELECT name FROM vendors WHERE id = $1', [parseInt(vendor_id)]);
    if (!vendorR.rows[0]) return fail(400, 'Vendor not found');
    const vendorName = vendorR.rows[0].name;

    if (hasAllocations) {
      for (const a of allocations) {
        const pnR = await client.query(
          `SELECT id, COALESCE(balance_due, grand_total) AS balance_due
           FROM purchase_notes WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
          [parseInt(a.purchase_note_id), parseInt(vendor_id)]
        );
        if (!pnR.rows[0]) return fail(400, 'A selected bill was not found or does not belong to this vendor');
        const bd = parseFloat(pnR.rows[0].balance_due);
        const amt = parseFloat(a.amount);
        if (amt > bd + 0.005) {
          return fail(400, `Allocated ₹${amt.toFixed(2)} exceeds outstanding ₹${bd.toFixed(2)} for a bill`);
        }
      }
    }

    const seqR = await client.query("SELECT nextval('pay_seq') as num");
    const docNumber = `PAY-${String(seqR.rows[0].num).padStart(4, '0')}`;

    const jeLines = [];
    const ccId = cost_center_id ? parseInt(cost_center_id) : null;
    if (appliedToBills > 0.005) {
      jeLines.push({ accountId: payableAccId, debit: appliedToBills, credit: 0, narration: `Payment to ${vendorName}`, costCenterId: ccId });
    }
    for (const ml of manualLines) {
      jeLines.push({
        accountId:    parseInt(ml.account_id),
        debit:        parseFloat(ml.amount),
        credit:       0,
        narration:    ml.description || `Payment to ${vendorName}`,
        costCenterId: ml.cost_center_id ? parseInt(ml.cost_center_id) : ccId,
      });
    }
    if (remainingAdvance > 0.005) {
      jeLines.push({ accountId: advanceAccId, debit: remainingAdvance, credit: 0, narration: `Advance to ${vendorName}`, costCenterId: ccId });
    }
    jeLines.push({ accountId: parseInt(bank_account_id), debit: 0, credit: totalAmount, narration: `${payment_mode || 'Bank Transfer'} - ${reference_no || docNumber}`, costCenterId: ccId });

    const je = await journalEngine.createEntry({
      date,
      description: `Payment to ${vendorName} - ${docNumber}`,
      sourceType: 'payment',
      sourceId: null,
      lines: jeLines,
      autoPost: true,
      createdBy: req.user.id,
      client,
    });

    const payR = await client.query(
      `INSERT INTO payments
         (doc_number, date, vendor_id, amount, payment_mode, bank_account_id,
          reference_no, cheque_no, cheque_date, remark, advance_amount, je_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'COMPLETED',$13)
       RETURNING *`,
      [
        docNumber, date, parseInt(vendor_id), totalAmount,
        payment_mode || 'Bank Transfer', parseInt(bank_account_id),
        reference_no || null, cheque_no || null, cheque_date || null,
        remark || null, advanceAmount > 0.005 ? advanceAmount : 0,
        je.id, req.user.id,
      ]
    );
    const paymentId = payR.rows[0].id;

    if (advanceAmount > 0.005) {
      await client.query(
        `INSERT INTO vendor_advances (vendor_id, payment_id, amount, remaining_amount)
         VALUES ($1, $2, $3, $3)`,
        [parseInt(vendor_id), paymentId, advanceAmount]
      );
    }

    if (hasAllocations) {
      for (const a of allocations) {
        const amt = parseFloat(a.amount);
        const pnId = parseInt(a.purchase_note_id);

        await client.query(
          'INSERT INTO payment_allocations (payment_id, purchase_note_id, amount) VALUES ($1,$2,$3)',
          [paymentId, pnId, amt]
        );

        await client.query(
          'UPDATE purchase_notes SET amount_paid = COALESCE(amount_paid,0) + $1 WHERE id = $2',
          [amt, pnId]
        );

        const pnCheck = await client.query(
          'SELECT grand_total, amount_paid FROM purchase_notes WHERE id = $1',
          [pnId]
        );
        if (pnCheck.rows[0]) {
          const paid  = parseFloat(pnCheck.rows[0].amount_paid);
          const total = parseFloat(pnCheck.rows[0].grand_total);
          const pStatus = paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
          await client.query(
            'UPDATE purchase_notes SET payment_status = $1, balance_due = $2 WHERE id = $3',
            [pStatus, Math.max(0, total - paid), pnId]
          );
        }
      }
    }

    await client.query('COMMIT');
    dispatchEvent('payment.created', { id: paymentId, doc_number: docNumber, amount: totalAmount, vendor_id: parseInt(vendor_id), je_id: je.id, je_number: je.je_number });
    res.status(201).json({ ...payR.rows[0], je_number: je.je_number });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[payments POST]', { error: err.message, stack: err.stack });
    res.status(400).json({ error: err.message || 'Failed to record payment. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;

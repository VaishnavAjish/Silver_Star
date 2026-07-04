const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');
const FinancialMappingService = require('../services/FinancialMappingService');

const router = express.Router();

// GET /api/receipts
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
      conditions.push(`(r.doc_number ILIKE $${idx} OR c.name ILIKE $${idx} OR r.reference_no ILIKE $${idx} OR r.payment_mode ILIKE $${idx} OR inv.doc_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`r.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (mode) {
      conditions.push(`r.payment_mode = $${idx}`);
      params.push(mode);
      idx++;
    }
    if (from_date) {
      conditions.push(`r.date >= $${idx}`);
      params.push(from_date);
      idx++;
    }
    if (to_date) {
      conditions.push(`r.date <= $${idx}`);
      params.push(to_date);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const joins = `LEFT JOIN customers c ON r.customer_id = c.id
                   LEFT JOIN accounts a ON r.bank_account_id = a.id
                   LEFT JOIN invoices inv ON r.invoice_id = inv.id`;

    const [dataR, countR] = await Promise.all([
      pool.query(
        `SELECT r.*, c.name as customer_name, a.name as bank_name, inv.doc_number as invoice_number
         FROM receipts r ${joins}
         ${where}
         ORDER BY r.date DESC, r.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM receipts r ${joins} ${where}`, params.slice(0, -2)),
    ]);
    const totalCount = parseInt(countR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);
    res.json({ data: dataR.rows, totalCount, page, pageSize, totalPages });
  } catch (err) {
    logger.error('[receipts GET]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load receipts' });
  }
});

// GET /api/receipts/open?customer_id=X
router.get('/open', authenticate, async (req, res) => {
  try {
    const customerId = parseInt(req.query.customer_id);
    if (!customerId || isNaN(customerId)) {
      return res.status(400).json({ error: 'customer_id is required' });
    }
    const result = await pool.query(
      `SELECT id, doc_number, doc_date, grand_total,
              COALESCE(amount_paid, 0)           AS amount_paid,
              COALESCE(balance_due, grand_total)  AS balance_due,
              COALESCE(payment_status, 'UNPAID')  AS payment_status,
              reference_no, remark
       FROM invoices
       WHERE customer_id = $1
         AND status != 'cancelled'
         AND COALESCE(payment_status, 'UNPAID') != 'PAID'
       ORDER BY doc_date ASC, id ASC`,
      [customerId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    logger.error('[receipts GET /open]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load open invoices' });
  }
});

// POST /api/receipts
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const fail = async (status, error) => {
      await client.query('ROLLBACK');
      return res.status(status).json({ error });
    };

    const {
      date, customer_id, payment_mode, bank_account_id,
      reference_no, cheque_no, cheque_date, remark,
      allocations,
      manual_lines: rawManualLines,
      invoice_id: legacyInvoiceId,
      amount: rawAmount,
      cost_center_id,
    } = req.body;

    if (!customer_id) return fail(400, 'Customer is required');
    if (!bank_account_id) return fail(400, 'Payment account is required');
    if (!date) return fail(400, 'Date is required');

    const totalAmount = Math.round((parseFloat(rawAmount) || 0) * 100) / 100;
    if (totalAmount <= 0) return fail(400, 'Receipt amount must be greater than 0');

    const hasAllocations = Array.isArray(allocations) && allocations.length > 0;
    let appliedToInvoices = 0;
    let primaryInvoiceId = null;

    if (hasAllocations) {
      for (const a of allocations) {
        const amt = parseFloat(a.amount);
        if (!Number.isInteger(parseInt(a.invoice_id)) || isNaN(amt) || amt <= 0) {
          return fail(400, 'Each allocation requires a valid invoice and amount > 0');
        }
        appliedToInvoices += amt;
      }
      appliedToInvoices = Math.round(appliedToInvoices * 100) / 100;
      primaryInvoiceId = parseInt(allocations[0].invoice_id);
    } else {
      primaryInvoiceId = legacyInvoiceId ? parseInt(legacyInvoiceId) : null;
    }

    const advanceAmount = Math.round((totalAmount - appliedToInvoices) * 100) / 100;
    if (advanceAmount < -0.005) {
      return fail(400, `Invoice allocations ₹${appliedToInvoices.toFixed(2)} exceed receipt amount ₹${totalAmount.toFixed(2)}`);
    }

    const arAccId = await FinancialMappingService.resolveAR(client);
    if (!arAccId) return fail(400, 'Accounts Receivable (1003) not configured in chart of accounts');

    const manualLines = (Array.isArray(rawManualLines) ? rawManualLines : [])
      .filter(ml => ml.account_id && parseFloat(ml.amount) > 0);
    const manualLinesTotal = Math.round(manualLines.reduce((s, ml) => s + parseFloat(ml.amount), 0) * 100) / 100;

    if (manualLinesTotal > advanceAmount + 0.005) {
      return fail(400, `Manual posting lines ₹${manualLinesTotal.toFixed(2)} exceed on-account amount ₹${advanceAmount.toFixed(2)}`);
    }

    let custAdvanceAccId = null;
    const remainingAdvance = Math.round((advanceAmount - manualLinesTotal) * 100) / 100;
    if (remainingAdvance > 0.005) {
      custAdvanceAccId = await FinancialMappingService.resolveCustomerAdvance(client);
      if (!custAdvanceAccId) return fail(400, 'Customer Advance account (2050) not found. Run sql/phase12-advances.sql migration.');
    }

    const custR = await client.query('SELECT name FROM customers WHERE id = $1', [parseInt(customer_id)]);
    if (!custR.rows[0]) return fail(400, 'Customer not found');
    const custName = custR.rows[0].name;

    if (hasAllocations) {
      for (const a of allocations) {
        const invR = await client.query(
          'SELECT id, balance_due FROM invoices WHERE id = $1 AND customer_id = $2 FOR UPDATE',
          [parseInt(a.invoice_id), parseInt(customer_id)]
        );
        if (!invR.rows[0]) return fail(400, 'A selected invoice was not found or does not belong to this customer');
        const bd = parseFloat(invR.rows[0].balance_due);
        const amt = parseFloat(a.amount);
        if (amt > bd + 0.005) {
          return fail(400, `Allocated ₹${amt.toFixed(2)} exceeds outstanding ₹${bd.toFixed(2)} for an invoice`);
        }
      }
    }

    const seqR = await client.query("SELECT nextval('rct_seq') as num");
    const docNumber = `RCT-${String(seqR.rows[0].num).padStart(4, '0')}`;

    const ccId = cost_center_id ? parseInt(cost_center_id) : null;
    const jeLines = [
      { accountId: parseInt(bank_account_id), debit: totalAmount, credit: 0, narration: `${payment_mode || 'Bank Transfer'} from ${custName}`, costCenterId: ccId },
    ];
    if (appliedToInvoices > 0.005) {
      jeLines.push({ accountId: arAccId, debit: 0, credit: appliedToInvoices, narration: `Receipt against ${allocations.length} invoice(s)`, costCenterId: ccId });
    }
    for (const ml of manualLines) {
      jeLines.push({
        accountId:    parseInt(ml.account_id),
        debit:        0,
        credit:       parseFloat(ml.amount),
        narration:    ml.description || `Advance from ${custName}`,
        costCenterId: ml.cost_center_id ? parseInt(ml.cost_center_id) : ccId,
      });
    }
    if (remainingAdvance > 0.005) {
      jeLines.push({ accountId: custAdvanceAccId, debit: 0, credit: remainingAdvance, narration: `Advance from ${custName}`, costCenterId: ccId });
    }

    const je = await journalEngine.createEntry({
      date,
      description: `Receipt from ${custName} - ${docNumber}`,
      sourceType: 'receipt',
      sourceId: null,
      lines: jeLines,
      autoPost: true,
      createdBy: req.user.id,
      client,
    });

    const rctR = await client.query(
      `INSERT INTO receipts
         (doc_number, date, customer_id, amount, payment_mode, bank_account_id,
          reference_no, cheque_no, cheque_date, remark, invoice_id, advance_amount, je_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'COMPLETED',$14)
       RETURNING *`,
      [
        docNumber, date, parseInt(customer_id), totalAmount,
        payment_mode || 'Bank Transfer', parseInt(bank_account_id),
        reference_no || null, cheque_no || null, cheque_date || null,
        remark || null, primaryInvoiceId,
        advanceAmount > 0.005 ? advanceAmount : 0,
        je.id, req.user.id,
      ]
    );
    const receiptId = rctR.rows[0].id;

    if (advanceAmount > 0.005) {
      await client.query(
        `INSERT INTO customer_advances (customer_id, receipt_id, amount, remaining_amount)
         VALUES ($1, $2, $3, $3)`,
        [parseInt(customer_id), receiptId, advanceAmount]
      );
    }

    if (hasAllocations) {
      for (const a of allocations) {
        const amt = parseFloat(a.amount);
        const invId = parseInt(a.invoice_id);

        await client.query(
          'INSERT INTO receipt_allocations (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)',
          [receiptId, invId, amt]
        );

        await client.query(
          'UPDATE invoices SET amount_paid = amount_paid + $1 WHERE id = $2',
          [amt, invId]
        );

        const invCheck = await client.query(
          'SELECT grand_total, amount_paid FROM invoices WHERE id = $1',
          [invId]
        );
        if (invCheck.rows[0]) {
          const paid  = parseFloat(invCheck.rows[0].amount_paid);
          const total = parseFloat(invCheck.rows[0].grand_total);
          const pStatus = paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
          await client.query(
            'UPDATE invoices SET payment_status = $1, balance_due = $2 WHERE id = $3',
            [pStatus, Math.max(0, total - paid), invId]
          );
        }
      }
    } else if (primaryInvoiceId) {
      await client.query('UPDATE invoices SET amount_paid = amount_paid + $1 WHERE id = $2', [totalAmount, primaryInvoiceId]);
      const invCheck = await client.query('SELECT grand_total, amount_paid FROM invoices WHERE id = $1', [primaryInvoiceId]);
      if (invCheck.rows[0]) {
        const paid  = parseFloat(invCheck.rows[0].amount_paid);
        const total = parseFloat(invCheck.rows[0].grand_total);
        await client.query(
          'UPDATE invoices SET payment_status = $1, balance_due = $2 WHERE id = $3',
          [paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID', Math.max(0, total - paid), primaryInvoiceId]
        );
      }
    }

    if (appliedToInvoices > 0.005 || (!hasAllocations && primaryInvoiceId)) {
      const reduceBy = hasAllocations ? appliedToInvoices : totalAmount;
      await client.query(
        'UPDATE customers SET outstanding = GREATEST(0, outstanding - $1) WHERE id = $2',
        [reduceBy, parseInt(customer_id)]
      );
    }

    await client.query('COMMIT');
    dispatchEvent('receipt.created', { id: receiptId, doc_number: docNumber, amount: totalAmount, customer_id: parseInt(customer_id), je_id: je.id, je_number: je.je_number });
    res.status(201).json({ ...rctR.rows[0], je_number: je.je_number });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[receipts POST]', { error: err.message, stack: err.stack });
    res.status(400).json({ error: err.message || 'Failed to record receipt. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;

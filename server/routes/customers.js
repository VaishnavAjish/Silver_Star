const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { getCustomerOpenInvoices } = require('../services/openDocumentService');
const { reserveCode } = require('../services/codeGeneratorService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

// Due-date days from invoice payment_term, aliased to `inv`
const DUE_DAYS_SQL = `
  CASE WHEN inv.payment_term ~ '[0-9]'
       THEN regexp_replace(inv.payment_term, '[^0-9]', '', 'g')::int
       ELSE 0
  END`;

// ─── GET /summary ─────────────────────────────────────────────────────────────
// MUST be defined before /:id to avoid Express matching "summary" as an id
router.get('/summary', authenticate, async (req, res) => {
  try {
    const [arR, overdueR, recvR] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(COALESCE(inv.balance_due, inv.grand_total)), 0) AS total_receivables
        FROM invoices inv
        WHERE inv.payment_status != 'PAID' AND inv.status != 'cancelled'
      `),
      pool.query(`
        SELECT COALESCE(SUM(COALESCE(inv.balance_due, inv.grand_total)), 0) AS overdue
        FROM invoices inv
        WHERE inv.payment_status != 'PAID'
          AND inv.status != 'cancelled'
          AND (inv.doc_date + (${DUE_DAYS_SQL}) * INTERVAL '1 day') < CURRENT_DATE
      `),
      pool.query(`
        SELECT COALESCE(SUM(r.amount), 0) AS received_last_30
        FROM receipts r
        WHERE r.date >= CURRENT_DATE - INTERVAL '30 days'
          AND COALESCE(r.status, '') != 'cancelled'
      `),
    ]);
    res.json({
      total_receivables: arR.rows[0].total_receivables,
      overdue:           overdueR.rows[0].overdue,
      received_last_30:  recvR.rows[0].received_last_30,
    });
  } catch (err) {
    logger.error('GET /api/customers/summary', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/transactions ────────────────────────────────────────────────────
// MUST be before /:id
router.get('/:id/transactions', authenticate, async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer id' });

  const limit  = Math.min(parseInt(req.query.limit  || 200, 10), 500);
  const offset = parseInt(req.query.offset || 0, 10);

  try {
    // Fetch a generous page per source type; avoids loading millions of rows into memory
    const fetchLimit = limit * 5;
    const [invR, recR, jeR] = await Promise.all([
      pool.query(`
        SELECT inv.id, inv.doc_date AS date, 'Invoice' AS type,
               inv.doc_number AS ref_no,
               inv.payment_term AS category,
               inv.grand_total AS amount,
               COALESCE(inv.balance_due, inv.grand_total) AS balance,
               COALESCE(inv.payment_status, 'UNPAID') AS status,
               inv.je_id,
               NULL::numeric AS net_effect
        FROM invoices inv
        WHERE inv.customer_id = $1 AND inv.status != 'cancelled'
        ORDER BY inv.doc_date DESC
        LIMIT $2
      `, [customerId, fetchLimit]),
      pool.query(`
        SELECT r.id, r.date, 'Receipt' AS type,
               r.doc_number AS ref_no,
               r.payment_mode AS category,
               r.amount, 0::numeric AS balance,
               COALESCE(r.status, 'COMPLETED') AS status,
               r.je_id,
               NULL::numeric AS net_effect
        FROM receipts r
        WHERE r.customer_id = $1
        ORDER BY r.date DESC
        LIMIT $2
      `, [customerId, fetchLimit]),

      // JE adjustments tagged to this customer via je_lines.entity_type/entity_id
      pool.query(`
        SELECT
          jl.id,
          je.date,
          'JE Adjustment'                                    AS type,
          je.je_number                                       AS ref_no,
          COALESCE(jl.narration, je.description, '')         AS category,
          ABS(jl.debit - jl.credit)                         AS amount,
          0::numeric                                         AS balance,
          je.status,
          je.id                                              AS je_id,
          (jl.debit - jl.credit)                            AS net_effect,
          je.source_type                                     AS je_source_type,
          EXISTS (
            SELECT 1 FROM journal_entries rev
            WHERE rev.source_type IN ('reversal','edit_reversal')
              AND rev.source_id = je.id
          )                                                  AS je_is_reversed
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        WHERE jl.entity_type = 'customer'
          AND jl.entity_id = $1
          AND je.status    = 'posted'
        ORDER BY je.date DESC, je.id DESC
        LIMIT $2
      `, [customerId, fetchLimit]),
    ]);

    const all = [...invR.rows, ...recR.rows, ...jeR.rows].sort((a, b) => {
      const da = new Date(a.date), db = new Date(b.date);
      return db - da;
    });

    const totalCountR = await pool.query(`
      SELECT COUNT(*)::int + (SELECT COUNT(*)::int FROM receipts WHERE customer_id = $1) + (SELECT COUNT(*)::int FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id WHERE jl.entity_type = 'customer' AND jl.entity_id = $1 AND je.status = 'posted') FROM invoices WHERE customer_id = $1 AND status != 'cancelled'
    `, [customerId]);
    const total = parseInt(totalCountR.rows[0].count);

    res.json({ data: all.slice(offset, offset + limit), total });
  } catch (err) {
    logger.error('GET /api/customers/:id/transactions', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET / ─── list ───────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const search = req.query.search || '';
  const limit  = Math.min(parseInt(req.query.limit  || 50, 10), 500);
  const offset = parseInt(req.query.offset || 0, 10);

  try {
    const pattern = search ? `%${search}%` : null;
    const whereClause = search
      ? 'WHERE (c.name ILIKE $1 OR c.code ILIKE $1)'
      : '';
    const params = search ? [pattern, limit, offset] : [limit, offset];
    const limitParam  = search ? '$2' : '$1';
    const offsetParam = search ? '$3' : '$2';

    const [dataR, countR] = await Promise.all([
      pool.query(`
        SELECT c.*,
          COALESCE(ob.open_balance, 0) AS open_balance
        FROM customers c
        LEFT JOIN (
          SELECT inv.customer_id,
            SUM(COALESCE(inv.balance_due, inv.grand_total)) AS open_balance
          FROM invoices inv
          WHERE inv.payment_status != 'PAID' AND inv.status != 'cancelled'
          GROUP BY inv.customer_id
        ) ob ON ob.customer_id = c.id
        ${whereClause}
        ORDER BY c.code
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params),
      pool.query(`
        SELECT COUNT(*) FROM customers c ${whereClause}
      `, search ? [pattern] : []),
    ]);

    res.json({ data: dataR.rows, total: parseInt(countR.rows[0].count, 10) });
  } catch (err) {
    logger.error('GET /api/customers', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/open-invoices ──────────────────────────────────────────────────
// Returns invoices with outstanding > 0 (dynamic — accounts for receipt + JE allocations).
// Optional ?exclude_je_id=X to ignore a specific JE's allocations (used when re-editing).
// MUST be defined before /:id.
router.get('/:id/open-invoices', authenticate, async (req, res) => {
  const customerId  = parseInt(req.params.id, 10);
  const excludeJeId = req.query.exclude_je_id ? parseInt(req.query.exclude_je_id, 10) : null;
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer id' });
  try {
    const invoices = await getCustomerOpenInvoices(customerId, undefined, excludeJeId || null);
    res.json({ data: invoices, total: invoices.length });
  } catch (err) {
    logger.error('GET /api/customers/:id/open-invoices', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id ─── single customer ─────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer id' });

  try {
    const r = await pool.query(`
      SELECT c.*,
        COALESCE(ob.open_balance,    0)                                     AS open_balance,
        GREATEST(0, LEAST(
          COALESCE(ob.raw_overdue_balance, 0),
          COALESCE(ob.open_balance, 0) + COALESCE(je_adj.adjustment, 0)
        ))                                                                  AS overdue_balance,
        lr.last_receipt_date,
        COALESCE(je_adj.adjustment,  0)                                     AS je_adjustment,
        COALESCE(ob.open_balance, 0) + COALESCE(je_adj.adjustment, 0)      AS total_balance
      FROM customers c
      LEFT JOIN (
        SELECT
          SUM(COALESCE(inv.balance_due, inv.grand_total))
            FILTER (WHERE inv.payment_status != 'PAID' AND inv.status != 'cancelled')
            AS open_balance,
          SUM(COALESCE(inv.balance_due, inv.grand_total))
            FILTER (WHERE inv.payment_status != 'PAID' AND inv.status != 'cancelled'
              AND (inv.doc_date + (${DUE_DAYS_SQL}) * INTERVAL '1 day') < CURRENT_DATE)
            AS raw_overdue_balance
        FROM invoices inv WHERE inv.customer_id = $1
      ) ob ON TRUE
      LEFT JOIN (
        SELECT MAX(r.date) AS last_receipt_date FROM receipts r WHERE r.customer_id = $1
      ) lr ON TRUE
      LEFT JOIN (
        -- JE adjustments: debit to AR increases receivable, credit reduces it.
        -- Add back je_allocation amounts to avoid double-counting with synced
        -- invoice balance_due. Formula: net = SUM(debit-credit) + SUM(je_alloc_amounts)
        SELECT
          COALESCE(SUM(jl.debit - jl.credit), 0) +
          COALESCE(
            (SELECT SUM(ja.allocated_amount)
             FROM   je_allocations ja
             WHERE  ja.entity_type = 'customer' AND ja.entity_id = $1),
            0
          ) AS adjustment
        FROM   je_lines jl
        JOIN   journal_entries je ON je.id = jl.je_id
        WHERE  jl.entity_type = 'customer'
          AND  jl.entity_id   = $1
          AND  je.status      = 'posted'
      ) je_adj ON TRUE
      WHERE c.id = $1
    `, [customerId]);

    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' });
    res.json(r.rows[0]);
  } catch (err) {
    logger.error('GET /api/customers/:id', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / ── create ─────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    let {
      code, name, contact_person, phone, email,
      address, city, state, gstin, pan,
      payment_term, credit_limit, status,
    } = req.body;

    if (!name?.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Customer name is required' }); }

    // Auto-generate customer code if not provided
    code = code?.trim() ? code.trim() : await reserveCode('customer', client);

    const r = await client.query(`
      INSERT INTO customers
        (code, name, contact_person, phone, email, address, city, state,
         gstin, pan, payment_term, credit_limit, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      code, name.trim(), contact_person || null, phone || null, email || null,
      address || null, city || null, state || null, gstin || null, pan || null,
      payment_term || '30 Days', parseFloat(credit_limit) || 0, status || 'active',
    ]);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
    dispatchEvent('customer.created', r.rows[0]).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Customer code already exists' });
    logger.error('POST /api/customers', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /:id ── update ───────────────────────────────────────────────────────
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer id' });

  const {
    name, contact_person, phone, email,
    address, city, state, gstin, pan,
    payment_term, credit_limit, status,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Customer name is required' });

  try {
    const r = await pool.query(`
      UPDATE customers SET
        name = $1, contact_person = $2, phone = $3, email = $4,
        address = $5, city = $6, state = $7, gstin = $8, pan = $9,
        payment_term = $10, credit_limit = $11, status = $12,
        updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      name.trim(), contact_person || null, phone || null, email || null,
      address || null, city || null, state || null, gstin || null, pan || null,
      payment_term || '30 Days', parseFloat(credit_limit) || 0, status || 'active',
      customerId,
    ]);
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' });
    res.json(r.rows[0]);
    dispatchEvent('customer.updated', r.rows[0]).catch(() => {});
  } catch (err) {
    logger.error('PUT /api/customers/:id', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id ── delete ────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) return res.status(400).json({ error: 'Invalid customer id' });

  try {
    const invCheck = await pool.query(
      'SELECT COUNT(*) FROM invoices WHERE customer_id = $1', [customerId]
    );
    if (parseInt(invCheck.rows[0].count, 10) > 0) {
      return res.status(409).json({ error: 'Cannot delete: customer has invoice records' });
    }
    const r = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [customerId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true });
    dispatchEvent('customer.deleted', { id: customerId }).catch(() => {});
  } catch (err) {
    logger.error('DELETE /api/customers/:id', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

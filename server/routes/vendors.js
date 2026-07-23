/**
 * ─── Vendors Route ───────────────────────────────────────────────────────────
 * Performance optimised for 100 Cr-scale data.
 * • GET /summary   — cached 30 s (heaviest query in app)
 * • GET /          — list cached 30 s per unique filter combo
 * • POST / PUT / DELETE — bust vendor caches automatically
 *
 * ⚠ SQL logic is UNCHANGED from original. Only cache wrapping was added.
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const ExcelJS = require('exceljs');
const pool    = require('../db/pool');
const cache   = require('../db/cache');
const { authenticate, authorize } = require('../middleware/auth');
const { getVendorOpenBills } = require('../services/openDocumentService');
const { reserveCode } = require('../services/codeGeneratorService');
const { getVendorPosition } = require('../services/vendorAdvanceService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ─── Bulk-upload helpers ──────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function normalizeRow(row) {
  const out = {};
  Object.entries(row).forEach(([k, v]) => { out[String(k).trim().toLowerCase()] = String(v ?? '').trim(); });
  return out;
}
async function parseRows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  
  const rows = [];
  let headers = [];

  ws.eachRow((row, rowNumber) => {
    const rowValues = row.values;
    if (rowNumber === 1) {
      headers = rowValues;
    } else {
      const rowData = {};
      headers.forEach((h, i) => {
        if (h) rowData[h] = rowValues[i] ?? '';
      });
      rows.push(rowData);
    }
  });
  return rows;
}

// Computes due-date offset in days from payment_term string e.g. '30 Days' → 30
const DUE_DAYS_SQL = `
  CASE WHEN pn.payment_term ~ '[0-9]'
       THEN regexp_replace(pn.payment_term, '[^0-9]', '', 'g')::int
       ELSE 0
  END`;

// ─── IMPORTANT: static/compound routes BEFORE /:id ───────────────────────────

// GET /api/vendors/summary — cached 5 s
router.get('/summary', authenticate, async (req, res) => {
  try {
    const data = await cache.get('vendor_summary', 5, async () => {
      const r = await pool.query(`
        WITH open_bills AS (
          SELECT
            pn.id,
            pn.grand_total,
            pn.doc_date,
            pn.payment_term,
            COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0) + COALESCE(vaa.advance_allocated, 0) AS total_allocated,
            GREATEST(0, pn.grand_total - (COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0) + COALESCE(vaa.advance_allocated, 0))) AS outstanding
          FROM purchase_notes pn
          LEFT JOIN (
            SELECT purchase_note_id, SUM(amount) AS payment_allocated
            FROM payment_allocations GROUP BY purchase_note_id
          ) pa ON pa.purchase_note_id = pn.id
          LEFT JOIN (
            SELECT target_id, SUM(allocated_amount) AS je_allocated
            FROM je_allocations WHERE target_type = 'bill' GROUP BY target_id
          ) ja ON ja.target_id = pn.id
          LEFT JOIN (
            SELECT purchase_note_id, SUM(amount) AS advance_allocated
            FROM vendor_advance_applications WHERE status = 'APPLIED' GROUP BY purchase_note_id
          ) vaa ON vaa.purchase_note_id = pn.id
          WHERE pn.status != 'cancelled'
        ),
        advances AS (
          SELECT COALESCE(SUM(remaining_amount), 0) AS available_advances
          FROM vendor_advances WHERE status = 'OPEN'
        ),
        unallocated AS (
          SELECT COUNT(DISTINCT payment_id) AS unallocated_payments_count
          FROM vendor_advances WHERE status = 'OPEN' AND remaining_amount > 0
        )
        SELECT
          COALESCE(SUM(b.outstanding), 0) AS gross_open_bills,
          (SELECT available_advances FROM advances) AS available_advances,
          GREATEST(0, COALESCE(SUM(b.outstanding), 0) - (SELECT available_advances FROM advances)) AS net_payable,
          COALESCE(SUM(
            CASE WHEN (b.doc_date + INTERVAL '1 day' * (${DUE_DAYS_SQL}))::date < CURRENT_DATE AND b.outstanding > 0.005
                 THEN b.outstanding ELSE 0 END
          ), 0) AS overdue,
          (SELECT unallocated_payments_count FROM unallocated) AS unallocated_payments,
          (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE date >= CURRENT_DATE - INTERVAL '30 days') AS paid_last_30
        FROM open_bills b
      `);
      const row = r.rows[0] || {};
      const grossBills = parseFloat(row.gross_open_bills) || 0;
      const availAdv = parseFloat(row.available_advances) || 0;
      return {
        gross_open_bills: grossBills,
        total_payables: grossBills,
        available_advances: availAdv,
        net_payable: parseFloat(row.net_payable) || 0,
        overdue: parseFloat(row.overdue) || 0,
        unallocated_payments: parseInt(row.unallocated_payments) || 0,
        paid_last_30: parseFloat(row.paid_last_30) || 0,
      };
    });
    res.json(data);
  } catch (err) {
    logger.error('[vendors GET /summary]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendors/:id/transactions
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const vendorId = parseInt(req.params.id);
    if (!vendorId) return res.status(400).json({ error: 'Invalid vendor id' });

    const { type, search, from_date, to_date, page = 1, limit = 500, offset } = req.query;
    const pageSize = parseInt(limit);
    const pageNum = parseInt(page);
    const calculatedOffset = offset !== undefined ? parseInt(offset) : (pageNum - 1) * pageSize;

    const [billsR, paysR, jeR, advR] = await Promise.all([
      pool.query(`
        SELECT
          pn.id,
          pn.doc_date                                                                                                                         AS date,
          'Bill'                                                                                                                              AS type,
          COALESCE(NULLIF(pn.reference_no, ''), pn.doc_number)                                                                                AS ref_no,
          pn.item_type                                                                                                                        AS category,
          pn.grand_total                                                                                                                      AS amount,
          GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0) - COALESCE(ja_agg.je_allocated, 0) - COALESCE(vaa_agg.advance_allocated, 0), 0) AS balance,
          COALESCE(pn.payment_status, 'UNPAID')                                                                                              AS status,
          pn.je_id,
          NULL::numeric AS net_effect
        FROM purchase_notes pn
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS total_paid
          FROM payment_allocations
          WHERE purchase_note_id = pn.id
        ) pa_agg ON true
        LEFT JOIN LATERAL (
          SELECT SUM(allocated_amount) AS je_allocated
          FROM je_allocations
          WHERE target_type = 'bill' AND target_id = pn.id
        ) ja_agg ON true
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS advance_allocated
          FROM vendor_advance_applications
          WHERE status = 'APPLIED' AND purchase_note_id = pn.id
        ) vaa_agg ON true
        WHERE pn.vendor_id = $1 AND pn.status != 'cancelled'
        ORDER BY pn.doc_date DESC, pn.id DESC
      `, [vendorId]),

      pool.query(`
        SELECT
          p.id,
          p.date,
          'Payment'      AS type,
          COALESCE(NULLIF(p.reference_no, ''), p.doc_number)   AS ref_no,
          p.payment_mode AS category,
          p.amount,
          0::numeric     AS balance,
          p.status,
          p.je_id,
          NULL::numeric  AS net_effect
        FROM payments p
        WHERE p.vendor_id = $1
        ORDER BY p.date DESC, p.id DESC
      `, [vendorId]),

      // JE adjustments tagged to this vendor via je_lines.entity_type/entity_id
      pool.query(`
        SELECT
          jl.id,
          je.date,
          'JE Adjustment'                                    AS type,
          je.je_number                                       AS ref_no,
          COALESCE(jl.narration, je.description, '')         AS category,
          ABS(jl.credit - jl.debit)                         AS amount,
          0::numeric                                         AS balance,
          je.status,
          je.id                                              AS je_id,
          (jl.credit - jl.debit)                            AS net_effect,
          je.source_type                                     AS je_source_type,
          EXISTS (
            SELECT 1 FROM journal_entries rev
            WHERE rev.source_type IN ('reversal','edit_reversal')
              AND rev.source_id = je.id
          )                                                  AS je_is_reversed
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        WHERE jl.entity_type = 'vendor'
          AND jl.entity_id = $1
          AND je.status    = 'posted'
        ORDER BY je.date DESC, je.id DESC
      `, [vendorId]),

      pool.query(`
        SELECT COALESCE(SUM(remaining_amount), 0) AS unapplied_advance
        FROM vendor_advances
        WHERE vendor_id = $1 AND status = 'OPEN'
      `, [vendorId]),
    ]);

    let all = [...billsR.rows, ...paysR.rows, ...jeR.rows].sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
      return d !== 0 ? d : b.id - a.id;
    });

    if (type && type !== 'all') {
      all = all.filter(t => t.type.toLowerCase() === type.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(t =>
        (t.ref_no && t.ref_no.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q)) ||
        (t.status && t.status.toLowerCase().includes(q))
      );
    }
    if (from_date) {
      all = all.filter(t => new Date(t.date) >= new Date(from_date));
    }
    if (to_date) {
      all = all.filter(t => new Date(t.date) <= new Date(to_date));
    }

    const bills = all.filter(t => t.type === 'Bill');
    const payments = all.filter(t => t.type === 'Payment');
    const jes = all.filter(t => t.type === 'JE Adjustment');

    const summary = {
      transaction_count: all.length,
      bill_count: bills.length,
      bills_total: bills.reduce((s, b) => s + parseFloat(b.amount || 0), 0),
      payment_count: payments.length,
      payments_total: payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
      je_adjustment_count: jes.length,
      je_adjustments_absolute_total: jes.reduce((s, j) => s + parseFloat(j.amount || 0), 0),
      credit_note_count: 0,
      credit_notes_total: 0,
      unapplied_advance: parseFloat(advR.rows[0]?.unapplied_advance || 0),
    };

    const paginated = all.slice(calculatedOffset, calculatedOffset + pageSize);

    res.json({
      data: paginated,
      transactions: paginated,
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total: all.length,
      },
      summary,
    });
  } catch (err) {
    logger.error('[vendors GET /:id/transactions]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vendors (list with open balance) — cached 30 s ─────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, category, search, limit = 100, offset = 0 } = req.query;
    const cacheKey = `vendor_list_${status || 'all'}_${category || 'all'}_${search || ''}_${limit}_${offset}`;

    const data = await cache.get(cacheKey, 30, async () => {
      const params = [];
      const conds  = ['1=1'];

      if (status)   { params.push(status);            conds.push(`v.status = $${params.length}`); }
      if (category) { params.push(category);          conds.push(`v.category = $${params.length}`); }
      if (search) {
        params.push(`%${search}%`);
        conds.push(`(v.name ILIKE $${params.length} OR v.code ILIKE $${params.length})`);
      }
      const where = conds.join(' AND ');

      const countR = await pool.query(
        `SELECT COUNT(v.id) FROM vendors v WHERE ${where}`, params
      );
      const total = parseInt(countR.rows[0].count);

      params.push(parseInt(limit));  const lp = params.length;
      params.push(parseInt(offset)); const op = params.length;

      const result = await pool.query(`
        WITH paginated_vendors AS (
          SELECT * FROM vendors v
          WHERE ${where}
          ORDER BY v.name
          LIMIT $${lp} OFFSET $${op}
        ),
        vendor_pns AS (
          SELECT pn.id, pn.vendor_id, pn.grand_total, pn.doc_date, pn.payment_term,
                 GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0) - COALESCE(ja_agg.total_je, 0) - COALESCE(vaa_agg.total_advance, 0), 0) AS balance_due
          FROM purchase_notes pn
          LEFT JOIN (
            SELECT purchase_note_id, SUM(amount) AS total_paid
            FROM payment_allocations
            GROUP BY purchase_note_id
          ) pa_agg ON pa_agg.purchase_note_id = pn.id
          LEFT JOIN (
            SELECT target_id, SUM(allocated_amount) AS total_je
            FROM je_allocations
            WHERE target_type = 'bill'
            GROUP BY target_id
          ) ja_agg ON ja_agg.target_id = pn.id
          LEFT JOIN (
            SELECT purchase_note_id, SUM(amount) AS total_advance
            FROM vendor_advance_applications
            WHERE status = 'APPLIED'
            GROUP BY purchase_note_id
          ) vaa_agg ON vaa_agg.purchase_note_id = pn.id
          WHERE pn.status != 'cancelled' AND pn.payment_status != 'PAID'
            AND pn.vendor_id IN (SELECT id FROM paginated_vendors)
        ),
        vendor_balances AS (
          SELECT
            pn.vendor_id,
            SUM(pn.balance_due) AS open_balance,
            SUM(CASE WHEN (pn.doc_date + (
              CASE pn.payment_term
                WHEN '7 Days' THEN 7 WHEN '15 Days' THEN 15 WHEN '30 Days' THEN 30
                WHEN '45 Days' THEN 45 WHEN '60 Days' THEN 60 WHEN '90 Days' THEN 90 ELSE 0 END
            )) < CURRENT_DATE
                     THEN pn.balance_due ELSE 0 END) AS overdue_balance
          FROM vendor_pns pn
          GROUP BY pn.vendor_id
        ),
        vendor_adv AS (
          SELECT vendor_id, SUM(remaining_amount) AS advances
          FROM vendor_advances
          WHERE status = 'OPEN' AND vendor_id IN (SELECT id FROM paginated_vendors)
          GROUP BY vendor_id
        )
        SELECT
          v.*,
          COALESCE(b.open_balance,    0) AS open_balance,
          COALESCE(b.overdue_balance, 0) AS overdue_balance,
          COALESCE(adv.advances,      0) AS vendor_advances,
          COALESCE(b.open_balance, 0) - COALESCE(adv.advances, 0) AS net_position
        FROM paginated_vendors v
        LEFT JOIN vendor_balances b ON b.vendor_id = v.id
        LEFT JOIN vendor_adv adv ON adv.vendor_id = v.id
      `, params);

      return { data: result.rows, total };
    });

    res.json(data);
  } catch (err) {
    logger.error('[vendors GET /]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vendors/:id/open-bills ─────────────────────────────────────────
router.get('/:id/open-bills', authenticate, async (req, res) => {
  const vendorId    = parseInt(req.params.id, 10);
  const excludeJeId = req.query.exclude_je_id ? parseInt(req.query.exclude_je_id, 10) : null;
  if (isNaN(vendorId)) return res.status(400).json({ error: 'Invalid vendor id' });
  try {
    const bills = await getVendorOpenBills(vendorId, undefined, excludeJeId || null);
    res.json({ data: bills, total: bills.length });
  } catch (err) {
    logger.error('[vendors GET /:id/open-bills]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vendors/:id ─────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        v.*,
        COALESCE(b.open_balance,    0)                                      AS open_balance,
        GREATEST(0, LEAST(
          COALESCE(b.raw_overdue_balance, 0),
          COALESCE(b.open_balance, 0) + COALESCE(je_adj.adjustment, 0)
        ))                                                                  AS overdue_balance,
        b.last_payment_date,
        COALESCE(je_adj.adjustment, 0)                                      AS je_adjustment,
        COALESCE(b.open_balance, 0) + COALESCE(je_adj.adjustment, 0)       AS total_balance
      FROM vendors v
      LEFT JOIN (
        SELECT
          pn.vendor_id,
          SUM(CASE WHEN pn.payment_status != 'PAID'
                   THEN GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0) - COALESCE(ja_agg.total_je, 0) - COALESCE(vaa_agg.total_advance, 0), 0) ELSE 0 END)    AS open_balance,
          SUM(CASE WHEN pn.payment_status != 'PAID'
                        AND (pn.doc_date + INTERVAL '1 day' * (${DUE_DAYS_SQL}))::date < CURRENT_DATE
                   THEN GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0) - COALESCE(ja_agg.total_je, 0) - COALESCE(vaa_agg.total_advance, 0), 0) ELSE 0 END)    AS raw_overdue_balance,
          (SELECT MAX(p.date) FROM payments p WHERE p.vendor_id = pn.vendor_id) AS last_payment_date
        FROM purchase_notes pn
        LEFT JOIN (
          SELECT purchase_note_id, SUM(amount) AS total_paid
          FROM payment_allocations
          GROUP BY purchase_note_id
        ) pa_agg ON pa_agg.purchase_note_id = pn.id
        LEFT JOIN (
          SELECT target_id, SUM(allocated_amount) AS total_je
          FROM je_allocations
          WHERE target_type = 'bill'
          GROUP BY target_id
        ) ja_agg ON ja_agg.target_id = pn.id
        LEFT JOIN (
          SELECT purchase_note_id, SUM(amount) AS total_advance
          FROM vendor_advance_applications
          WHERE status = 'APPLIED'
          GROUP BY purchase_note_id
        ) vaa_agg ON vaa_agg.purchase_note_id = pn.id
        WHERE pn.status != 'cancelled' AND pn.vendor_id = $1 AND pn.payment_status != 'PAID'
        GROUP BY pn.vendor_id
      ) b ON b.vendor_id = v.id
      LEFT JOIN (
        SELECT
          COALESCE(SUM(jl.credit - jl.debit), 0) +
          COALESCE(
            (SELECT SUM(ja.allocated_amount)
             FROM   je_allocations ja
             WHERE  ja.entity_type = 'vendor' AND ja.entity_id = $1),
            0
          ) AS adjustment
        FROM   je_lines jl
        JOIN   journal_entries je ON je.id = jl.je_id
        WHERE  jl.entity_type = 'vendor'
          AND  jl.entity_id   = $1
          AND  je.status      = 'posted'
      ) je_adj ON TRUE
      WHERE v.id = $1
    `, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Vendor not found' });
    // Single source of truth: reuse the Vendor Advance Engine for workspace balances.
    const position = await getVendorPosition(parseInt(req.params.id));
    res.json({
      ...result.rows[0],
      open_balance:      position.outstanding_bills,   // authoritative (amount_paid based)
      outstanding_bills: position.outstanding_bills,
      vendor_advances:   position.vendor_advances,
      net_position:      position.net_position,
    });
  } catch (err) {
    logger.error('[vendors GET /:id]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/vendors (create) ───────────────────────────────────────────────
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    let {
      code, name, category, contact_person, phone, email,
      address, city, state, gstin, pan, payment_term, bank_details, status, account_id,
    } = req.body;

    if (!name?.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'name is required' }); }

    code = code?.trim() ? code.trim() : await reserveCode('vendor', client);

    const r = await client.query(
      `INSERT INTO vendors
         (code, name, category, contact_person, phone, email,
          address, city, state, gstin, pan, payment_term, bank_details, status, account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        code, name.trim(),
        category       || 'general',
        contact_person || null,
        phone          || null,
        email          || null,
        address        || null,
        city           || null,
        state          || null,
        gstin          || null,
        pan            || null,
        payment_term   || 'Immediate',
        bank_details   || null,
        status         || 'active',
        account_id     || null,
      ]
    );
    await client.query('COMMIT');
    cache.invalidatePrefix('vendor_list_');
    cache.invalidate('vendor_summary');
    res.status(201).json(r.rows[0]);
    dispatchEvent('vendor.created', r.rows[0]).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Vendor code already exists' });
    logger.error('[vendors POST /]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/vendors/:id (update) ───────────────────────────────────────────
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const allowed = [
      'code','name','category','contact_person','phone','email',
      'address','city','state','gstin','pan','payment_term','bank_details','status','account_id',
    ];
    const cols = allowed.filter(c => req.body[c] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });

    const vals      = cols.map(c => req.body[c]);
    const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    vals.push(req.params.id);

    const r = await pool.query(
      `UPDATE vendors SET ${setClause}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Vendor not found' });
    cache.invalidatePrefix('vendor_list_');
    cache.invalidate('vendor_summary');
    res.json(r.rows[0]);
    dispatchEvent('vendor.updated', r.rows[0]).catch(() => {});
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Vendor code already exists' });
    logger.error('[vendors PUT /:id]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/vendors/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM vendors WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vendor not found' });
    cache.invalidatePrefix('vendor_list_');
    cache.invalidate('vendor_summary');
    res.json({ success: true, id: r.rows[0].id });
    dispatchEvent('vendor.deleted', { id: parseInt(req.params.id) }).catch(() => {});
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Cannot delete: vendor has existing transactions' });
    logger.error('[vendors DELETE /:id]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/vendors/bulk-upload ───────────────────────────────────────────
router.post(
  '/bulk-upload',
  authenticate,
  authorize('admin', 'operator'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    if (!/\.(csv|xlsx)$/i.test(req.file.originalname || ''))
      return res.status(400).json({ error: 'Only CSV and XLSX files are supported' });

    let rows;
    try {
      const parsed = await parseRows(req.file);
      rows = parsed.map(normalizeRow).filter(row =>
        Object.values(row).some(v => String(v).trim() !== '')
      );
    } catch (err) {
      console.error('[vendors bulk-upload] parse failed:', err);
      return res.status(400).json({ error: 'Could not parse uploaded file' });
    }

    const summary = { total_rows: rows.length, inserted: 0, skipped: 0, errors: [] };
    const client  = await pool.primaryPool.connect();
    try {
      await client.query('BEGIN');
      for (const [idx, row] of rows.entries()) {
        const rowNum = idx + 2;
        const code   = (row.code || '').trim();
        const name   = (row.name || '').trim();
        if (!code) { summary.skipped++; summary.errors.push({ row: rowNum, code, error: 'code is required' }); continue; }
        if (!name) { summary.skipped++; summary.errors.push({ row: rowNum, code, error: 'name is required' }); continue; }
        try {
          await client.query('SAVEPOINT r');
          const ins = await client.query(
            `INSERT INTO vendors (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING id`,
            [code, name]
          );
          ins.rowCount === 1 ? summary.inserted++ : summary.skipped++;
          await client.query('RELEASE SAVEPOINT r');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT r');
          await client.query('RELEASE SAVEPOINT r');
          summary.skipped++;
          summary.errors.push({ row: rowNum, code, error: err.message });
        }
      }
      await client.query('COMMIT');
      cache.invalidatePrefix('vendor_list_');
      cache.invalidate('vendor_summary');
      res.json(summary);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[vendors bulk-upload] failed:', err);
      res.status(500).json({ error: 'Bulk upload failed' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;

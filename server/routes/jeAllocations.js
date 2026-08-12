const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const {
  syncBillStatus,
  syncInvoiceStatus,
} = require('../services/openDocumentService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');
// Accounting Phase 0 — shared block-only containment rule (pure, role-agnostic).
const {
  CONFLICT,
  jeAllocationDeleteBlockReason,
  conflictBody,
} = require('../services/accountingContainment');

/**
 * Accounting Phase 0 helper — resolve and LOCK the parent journal entry of an
 * allocation, then count the payments it backs. Read-only; the caller decides.
 *
 * Returns { je, paymentRefCount }. A missing JE yields je=null, which the
 * containment rule treats as fail-closed (an allocation whose parent cannot be
 * verified is refused, never silently deleted).
 */
async function loadParentJournal(client, jeId) {
  const { rows } = await client.query(
    'SELECT id, je_number, status, source_type FROM journal_entries WHERE id = $1 FOR UPDATE',
    [jeId]
  );
  const je = rows[0] || null;
  if (!je) return { je: null, paymentRefCount: 0 };
  const { rows: refRows } = await client.query(
    'SELECT COUNT(*)::int AS payment_refs FROM payments WHERE je_id = $1',
    [jeId]
  );
  return { je, paymentRefCount: refRows[0] ? refRows[0].payment_refs : 0 };
}

// ─── GET / ── fetch allocations for a JE or entity ───────────────────────────
// ?je_id=X                               — allocations for one JE
// ?entity_type=vendor&entity_id=X        — all allocations for a vendor/customer
const ALLOC_SELECT = `
  SELECT
    ja.*,
    CASE ja.target_type
      WHEN 'bill'    THEN pn.doc_number
      WHEN 'invoice' THEN inv.doc_number
    END AS target_doc_number,
    CASE ja.target_type
      WHEN 'bill'    THEN pn.doc_date::text
      WHEN 'invoice' THEN inv.doc_date::text
    END AS target_doc_date,
    CASE ja.target_type
      WHEN 'bill'    THEN pn.grand_total
      WHEN 'invoice' THEN inv.grand_total
    END AS target_grand_total
  FROM je_allocations ja
  LEFT JOIN purchase_notes pn  ON ja.target_type = 'bill'    AND pn.id  = ja.target_id
  LEFT JOIN invoices       inv ON ja.target_type = 'invoice' AND inv.id = ja.target_id
`;

router.get('/', authenticate, async (req, res) => {
  try {
    const jeId       = parseInt(req.query.je_id, 10);
    const entityType = req.query.entity_type;
    const entityId   = parseInt(req.query.entity_id, 10);

    let r;
    if (!isNaN(jeId)) {
      r = await pool.query(`${ALLOC_SELECT} WHERE ja.je_id = $1 ORDER BY ja.created_at`, [jeId]);
    } else if (entityType && !isNaN(entityId)) {
      r = await pool.query(
        `${ALLOC_SELECT} WHERE ja.entity_type = $1 AND ja.entity_id = $2 ORDER BY ja.je_id, ja.created_at`,
        [entityType, entityId]
      );
    } else {
      return res.status(400).json({ error: 'je_id or entity_type+entity_id query params required' });
    }
    res.json(r.rows);
  } catch (err) {
    logger.error('GET /api/je-allocations', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / ── save allocations for a JE ─────────────────────────────────────
// Body: { je_id, allocation_date?, allocations: [{entity_type, entity_id, target_type, target_id, allocated_amount, je_line_id?, notes?}] }
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const { je_id, allocation_date, allocations } = req.body;

  if (!je_id)                                         return res.status(400).json({ error: 'je_id required' });
  if (!Array.isArray(allocations) || !allocations.length) return res.status(400).json({ error: 'allocations array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Verify JE exists
    const jeR = await client.query('SELECT id, status FROM journal_entries WHERE id = $1', [je_id]);
    if (!jeR.rows.length) throw new Error('Journal entry not found');

    const alloc_date = allocation_date || new Date().toISOString().split('T')[0];
    const created    = [];

    for (const a of allocations) {
      const { entity_type, entity_id, target_type, target_id, allocated_amount, je_line_id, notes } = a;

      if (!entity_type || !entity_id || !target_type || !target_id) continue;
      const amt = parseFloat(allocated_amount);
      if (isNaN(amt) || amt <= 0) continue;

      // Lock document and verify outstanding is sufficient
      if (target_type === 'bill') {
        const r = await client.query(`
          SELECT pn.id, pn.grand_total,
            COALESCE((SELECT SUM(amount)           FROM payment_allocations WHERE purchase_note_id = pn.id), 0) AS pa,
            COALESCE((SELECT SUM(allocated_amount) FROM je_allocations       WHERE target_type='bill' AND target_id = pn.id), 0) AS ja
          FROM purchase_notes pn
          WHERE pn.id = $1 AND pn.vendor_id = $2
          FOR UPDATE
        `, [target_id, entity_id]);
        if (!r.rows.length) throw new Error(`Bill ${target_id} not found for vendor ${entity_id}`);
        const row         = r.rows[0];
        const outstanding = parseFloat(row.grand_total) - parseFloat(row.pa) - parseFloat(row.ja);
        if (amt > outstanding + 0.005) {
          throw new Error(`Allocation ₹${amt.toFixed(2)} exceeds outstanding ₹${outstanding.toFixed(2)} on bill ${target_id}`);
        }
      } else if (target_type === 'invoice') {
        const r = await client.query(`
          SELECT inv.id, inv.grand_total,
            COALESCE((SELECT SUM(amount)           FROM receipt_allocations WHERE invoice_id = inv.id), 0) AS ra,
            COALESCE((SELECT SUM(allocated_amount) FROM je_allocations      WHERE target_type='invoice' AND target_id = inv.id), 0) AS ja
          FROM invoices inv
          WHERE inv.id = $1 AND inv.customer_id = $2
          FOR UPDATE
        `, [target_id, entity_id]);
        if (!r.rows.length) throw new Error(`Invoice ${target_id} not found for customer ${entity_id}`);
        const row         = r.rows[0];
        const outstanding = parseFloat(row.grand_total) - parseFloat(row.ra) - parseFloat(row.ja);
        if (amt > outstanding + 0.005) {
          throw new Error(`Allocation ₹${amt.toFixed(2)} exceeds outstanding ₹${outstanding.toFixed(2)} on invoice ${target_id}`);
        }
      } else {
        throw new Error(`Unknown target_type: ${target_type}`);
      }

      // Insert allocation row
      const ins = await client.query(`
        INSERT INTO je_allocations
          (entity_type, entity_id, je_id, je_line_id, target_type, target_id,
           allocated_amount, allocation_date, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [
        entity_type,
        parseInt(entity_id),
        parseInt(je_id),
        je_line_id ? parseInt(je_line_id) : null,
        target_type,
        parseInt(target_id),
        amt,
        alloc_date,
        notes || null,
        req.user?.id || null,
      ]);
      created.push(ins.rows[0]);

      // Sync document status (keeps balance_due/payment_status current)
      if (target_type === 'bill')    await syncBillStatus(parseInt(target_id), client);
      if (target_type === 'invoice') await syncInvoiceStatus(parseInt(target_id), client);
    }

    await client.query('COMMIT');
    dispatchEvent('je_allocation.created', { je_id, allocation_count: created.length, module: 'accounting' });
    res.status(201).json({ allocations: created });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST /api/je-allocations', { error: err.message, stack: err.stack });
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── DELETE /by-je/:je_id ── remove all allocations for a JE ─────────────────
// Used when a JE is cancelled or reversed — rolls back all document settlements.
router.delete('/by-je/:je_id', authenticate, authorize('admin'), async (req, res) => {
  const jeId = parseInt(req.params.je_id, 10);
  if (isNaN(jeId)) return res.status(400).json({ error: 'Invalid JE id' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // ACCOUNTING PHASE 0 — CONTAINMENT. Resolve and LOCK the parent JE first.
    // Removing the allocations of a posted / system-generated / payment-backed
    // entry re-opens the settled bill while the ledger posting stays in place —
    // the same split-brain the JE delete guard prevents, reached through a
    // different endpoint. Integrity rule on the RECORD: no role bypasses it,
    // and a direct API call is refused exactly like a UI action.
    const parent = await loadParentJournal(client, jeId);
    const blockReason = jeAllocationDeleteBlockReason({ ...parent, jeId });
    if (blockReason) {
      await client.query('ROLLBACK');
      return res.status(CONFLICT).json(conflictBody(blockReason));
    }

    // Capture affected documents before deletion
    const affected = await client.query(
      `SELECT DISTINCT target_type, target_id FROM je_allocations WHERE je_id = $1`,
      [jeId]
    );

    await client.query('DELETE FROM je_allocations WHERE je_id = $1', [jeId]);

    // Resync status on every previously-allocated document
    for (const row of affected.rows) {
      if (row.target_type === 'bill')    await syncBillStatus(parseInt(row.target_id), client);
      if (row.target_type === 'invoice') await syncInvoiceStatus(parseInt(row.target_id), client);
    }

    await client.query('COMMIT');
    dispatchEvent('je_allocation.deleted', { je_id: jeId, affected: affected.rows.length, module: 'accounting' });
    res.json({ success: true, affected: affected.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('DELETE /api/je-allocations/by-je', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── DELETE /:id ── remove a single allocation ────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const allocId = parseInt(req.params.id, 10);
  if (isNaN(allocId)) return res.status(400).json({ error: 'Invalid allocation id' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM je_allocations WHERE id = $1 FOR UPDATE',
      [allocId]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Allocation not found' });
    }
    const alloc = existing.rows[0];

    // ACCOUNTING PHASE 0 — CONTAINMENT. Resolve and LOCK the parent JE of THIS
    // allocation before any destructive statement. Fail-closed: an allocation
    // whose parent JE cannot be resolved is refused, never silently deleted.
    const parent = await loadParentJournal(client, alloc.je_id);
    const blockReason = jeAllocationDeleteBlockReason({ ...parent, jeId: alloc.je_id });
    if (blockReason) {
      await client.query('ROLLBACK');
      return res.status(CONFLICT).json(conflictBody(blockReason));
    }

    await client.query('DELETE FROM je_allocations WHERE id = $1', [allocId]);

    if (alloc.target_type === 'bill')    await syncBillStatus(alloc.target_id, client);
    if (alloc.target_type === 'invoice') await syncInvoiceStatus(alloc.target_id, client);

    await client.query('COMMIT');
    dispatchEvent('je_allocation.deleted', { id: allocId, target_type: alloc.target_type, target_id: alloc.target_id, module: 'accounting' });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('DELETE /api/je-allocations/:id', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

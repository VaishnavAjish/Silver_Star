const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// ===========================================================================
// Cost Centre Bulk Correction Utilities (Phase 2)
// ---------------------------------------------------------------------------
// SAFETY GUARANTEES:
//   * Updates ONLY je_lines.cost_center_id. Never touches debit / credit /
//     account_id / any balance. Journal totals are completely unaffected.
//   * Operates on the LIVE je_lines table ONLY (never je_lines_old).
//   * Writes one cost_center_audit row per affected line (old -> new + reason).
//   * Requires at least one filter so a bulk op can never match the whole ledger.
//   * Supports dryRun to preview the affected count before committing.
// ===========================================================================

// Build a WHERE fragment from filters, with placeholders starting at `startIdx`.
// Returns { sql, vals }. The same filter object yields identical SQL regardless
// of startIdx, so it can be reused across count / audit / update queries.
function buildWhere(f, startIdx) {
  const cl = [];
  const vals = [];
  let i = startIdx;

  if (f.date_from)    { cl.push(`je.date >= $${i++}`);                              vals.push(f.date_from); }
  if (f.date_to)      { cl.push(`je.date <= $${i++}`);                              vals.push(f.date_to); }
  if (f.voucher_from) { cl.push(`CAST(NULLIF(substring(je.je_number from '(\\d+)$'),'') AS int) >= $${i++}`); vals.push(parseInt(f.voucher_from)); }
  if (f.voucher_to)   { cl.push(`CAST(NULLIF(substring(je.je_number from '(\\d+)$'),'') AS int) <= $${i++}`); vals.push(parseInt(f.voucher_to)); }
  if (f.account_id)   { cl.push(`jl.account_id = $${i++}`);                         vals.push(parseInt(f.account_id)); }
  if (f.source_type)  { cl.push(`je.source_type = $${i++}`);                        vals.push(f.source_type); }
  if (f.reference)    { cl.push(`(je.reference_no ILIKE $${i} OR jl.reference_no ILIKE $${i})`); i++; vals.push(`%${f.reference}%`); }
  if (f.remarks)      { cl.push(`jl.narration ILIKE $${i++}`);                      vals.push(`%${f.remarks}%`); }
  if (f.existing_cost_center_id) { cl.push(`jl.cost_center_id = $${i++}`);          vals.push(parseInt(f.existing_cost_center_id)); }
  if (f.selected_line_ids && f.selected_line_ids.length > 0) { cl.push(`jl.id = ANY($${i++})`); vals.push(f.selected_line_ids); }

  return { sql: cl.length ? cl.join(' AND ') : 'TRUE', vals };
}

function hasAnyFilter(f) {
  return Boolean(
    f.date_from || f.date_to || f.voucher_from || f.voucher_to ||
    f.account_id || f.source_type || f.reference || f.remarks ||
    f.existing_cost_center_id
  );
}

// Shared executor for both assign and replace. `target` is the cost centre to
// set; the WHERE already encodes which lines match (incl. the existing-cc filter
// for replace). `IS DISTINCT FROM` skips no-op rows so the audit stays meaningful.
async function runBulk({ res, filters, target, reason, dryRun, userId }) {
  if (!hasAnyFilter(filters)) {
    return res.status(400).json({ error: 'At least one filter is required for a bulk operation' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Count what will change (target is $1, filters start at $2)
    const wCount = buildWhere(filters, 2);
    const countR = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
        WHERE (${wCount.sql}) AND jl.cost_center_id IS DISTINCT FROM $1`,
      [target, ...wCount.vals]
    );
    const affected = countR.rows[0].n;

    if (dryRun) {
      // Fetch lines to display in preview table
      const linesR = await client.query(
        `SELECT jl.id, je.je_number, je.date, je.source_type, a.name AS account_name, a.code AS account_code, cc.name AS current_cc_name, jl.debit, jl.credit
           FROM je_lines jl
           JOIN journal_entries je ON je.id = jl.je_id
           JOIN accounts a ON a.id = jl.account_id
           LEFT JOIN cost_centers cc ON cc.id = jl.cost_center_id
          WHERE (${wCount.sql}) AND jl.cost_center_id IS DISTINCT FROM $1
          ORDER BY je.date DESC, je.je_number DESC
          LIMIT 500`,
        [target, ...wCount.vals]
      );
      await client.query('ROLLBACK');
      return res.json({ dryRun: true, affected, lines: linesR.rows });
    }

    // 2. Audit BEFORE update so old_cost_center_id is captured (params: $1 user,
    //    $2 target, $3 reason, filters from $4)
    const wAudit = buildWhere(filters, 4);
    await client.query(
      `INSERT INTO cost_center_audit
         (user_id, entity_type, entity_id, old_cost_center_id, new_cost_center_id, reason)
       SELECT $1, 'je_line', jl.id, jl.cost_center_id, $2, $3
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
        WHERE (${wAudit.sql}) AND jl.cost_center_id IS DISTINCT FROM $2`,
      [userId || null, target, reason || null, ...wAudit.vals]
    );

    // 3. Update ONLY cost_center_id (target $1, filters from $2)
    const wUpd = buildWhere(filters, 2);
    const upd = await client.query(
      `UPDATE je_lines jl
          SET cost_center_id = $1
         FROM journal_entries je
        WHERE je.id = jl.je_id AND (${wUpd.sql}) AND jl.cost_center_id IS DISTINCT FROM $1`,
      [target, ...wUpd.vals]
    );

    await client.query('COMMIT');
    res.json({ success: true, updated: upd.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// POST /api/cost-center-bulk/assign
// Filters: date range, voucher range, account, transaction type, reference, remarks.
// Assigns the chosen cost centre to all matching JE lines.
router.post('/assign', authenticate, authorize('admin'), async (req, res) => {
  const { cost_center_id, reason, dryRun,
          date_from, date_to, voucher_from, voucher_to,
          account_id, source_type, reference, remarks, selected_line_ids } = req.body;

  if (!cost_center_id) return res.status(400).json({ error: 'cost_center_id is required' });

  return runBulk({
    res,
    filters: { date_from, date_to, voucher_from, voucher_to, account_id, source_type, reference, remarks, selected_line_ids },
    target: parseInt(cost_center_id),
    reason,
    dryRun: Boolean(dryRun),
    userId: req.user?.id,
  });
});

// POST /api/cost-center-bulk/replace
// Filters: existing cost centre, date range, voucher range.
// Replaces the existing cost centre with a new one on all matching JE lines,
// preserving all accounting values.
router.post('/replace', authenticate, authorize('admin'), async (req, res) => {
  const { existing_cost_center_id, new_cost_center_id, reason, dryRun,
          date_from, date_to, voucher_from, voucher_to, selected_line_ids,
          account_id, source_type } = req.body;

  if (!existing_cost_center_id || !new_cost_center_id) {
    return res.status(400).json({ error: 'existing_cost_center_id and new_cost_center_id are required' });
  }
  if (parseInt(existing_cost_center_id) === parseInt(new_cost_center_id)) {
    return res.status(400).json({ error: 'Existing and new cost centre must differ' });
  }

  return runBulk({
    res,
    filters: { existing_cost_center_id, date_from, date_to, voucher_from, voucher_to, selected_line_ids, account_id, source_type },
    target: parseInt(new_cost_center_id),
    reason,
    dryRun: Boolean(dryRun),
    userId: req.user?.id,
  });
});

module.exports = router;

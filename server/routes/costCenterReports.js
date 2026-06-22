const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ===========================================================================
// Cost Centre Reporting (Phase 3) — READ ONLY.
// All endpoints are pure SELECT aggregations over posted journal entries.
// They never write and never alter balances.
// ===========================================================================

// Optional date-range filter on je.date. Returns SQL + params starting at idx.
function dateFilter(q, startIdx) {
  const cl = [];
  const vals = [];
  let i = startIdx;
  if (q.date_from) { cl.push(`je.date >= $${i++}`); vals.push(q.date_from); }
  if (q.date_to)   { cl.push(`je.date <= $${i++}`); vals.push(q.date_to); }
  return { sql: cl.length ? ' AND ' + cl.join(' AND ') : '', vals };
}

// GET /api/cost-center-reports/trial-balance?date_from&date_to
// Per cost centre × account: total debit, credit and net. Cost-centred lines only.
router.get('/trial-balance', authenticate, async (req, res) => {
  try {
    const d = dateFilter(req.query, 1);
    const r = await pool.query(
      `SELECT cc.id   AS cost_center_id, cc.code AS cost_center_code, cc.name AS cost_center_name,
              a.id    AS account_id, a.code AS account_code, a.name AS account_name, a.type,
              COALESCE(SUM(jl.debit),0)::numeric  AS debit,
              COALESCE(SUM(jl.credit),0)::numeric AS credit,
              COALESCE(SUM(jl.debit - jl.credit),0)::numeric AS net
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
         JOIN cost_centers    cc ON cc.id = jl.cost_center_id
         JOIN accounts        a  ON a.id  = jl.account_id
        WHERE jl.cost_center_id IS NOT NULL${d.sql}
        GROUP BY cc.id, cc.code, cc.name, a.id, a.code, a.name, a.type
        ORDER BY cc.code NULLS LAST, a.code`,
      d.vals
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cost-center-reports/dashboard?date_from&date_to
// One summary row per cost centre (incl. centres with no activity).
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const cl = [];
    const vals = [];
    let i = 1;
    if (req.query.date_from) { cl.push(`je.date >= $${i++}`); vals.push(req.query.date_from); }
    if (req.query.date_to)   { cl.push(`je.date <= $${i++}`); vals.push(req.query.date_to); }
    const dateOn = cl.length ? ' AND ' + cl.join(' AND ') : '';

    const r = await pool.query(
      `SELECT cc.id, cc.code, cc.name, cc.status,
              COUNT(jl.id)::int                              AS line_count,
              COALESCE(SUM(jl.debit),0)::numeric             AS total_debit,
              COALESCE(SUM(jl.credit),0)::numeric            AS total_credit,
              COALESCE(SUM(jl.debit - jl.credit),0)::numeric AS net
         FROM cost_centers cc
         LEFT JOIN je_lines        jl ON jl.cost_center_id = cc.id
         LEFT JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'${dateOn}
        GROUP BY cc.id, cc.code, cc.name, cc.status
        ORDER BY cc.code NULLS LAST, cc.name`,
      vals
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cost-center-reports/report?date_from&date_to&cost_center_id&mode
// mode: 'category', 'summary', 'detailed'
router.get('/report', authenticate, async (req, res) => {
  try {
    const { cost_center_id, mode } = req.query;
    
    // Base filters for all modes
    let sqlFilters = `
          AND a.type IN ('asset', 'expense')
          AND COALESCE(a.sub_type, '') NOT IN ('bank', 'cash', 'receivable', 'payable', 'loan')
          AND a.name NOT ILIKE '%advance%'
          AND a.name NOT ILIKE '%capital%'
          AND a.name NOT ILIKE '%equity%'
          AND a.name NOT ILIKE '%retained earnings%'
    `;
    
    const d = dateFilter(req.query, 1);
    const vals = [...d.vals];
    let ccFilter = '';
    
    if (cost_center_id) {
      vals.push(cost_center_id);
      ccFilter = ` AND cc.id = $${vals.length} `;
    }

    let query = '';

    if (mode === 'detailed') {
      query = `
        SELECT je.date, je.je_number, je.source_type,
               a.code AS account_code, a.name AS account_name,
               jl.remarks,
               COALESCE(jl.debit - jl.credit, 0)::numeric AS net,
               cc.code AS cost_center_code, cc.name AS cost_center_name
          FROM je_lines jl
          JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          JOIN cost_centers    cc ON cc.id = jl.cost_center_id
          JOIN accounts        a  ON a.id  = jl.account_id
         WHERE cc.status = 'active'
           ${ccFilter} ${sqlFilters} ${d.sql}
         ORDER BY cc.code, je.date, je.je_number
      `;
    } else if (mode === 'summary') {
      query = `
        SELECT cc.code AS cost_center_code, cc.name AS cost_center_name,
               COALESCE(SUM(jl.debit - jl.credit),0)::numeric AS net
          FROM je_lines jl
          JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          JOIN cost_centers    cc ON cc.id = jl.cost_center_id
          JOIN accounts        a  ON a.id  = jl.account_id
         WHERE cc.status = 'active'
           ${ccFilter} ${sqlFilters} ${d.sql}
         GROUP BY cc.code, cc.name
         ORDER BY cc.code
      `;
    } else {
      // Default to 'category' mode (old Project Cost Report logic)
      query = `
        SELECT cc.code AS cost_center_code, cc.name AS cost_center_name,
               a.code  AS account_code, a.name AS account_name, a.type, a.sub_type, a.path,
               COALESCE(SUM(jl.debit - jl.credit),0)::numeric AS net
          FROM je_lines jl
          JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          JOIN cost_centers    cc ON cc.id = jl.cost_center_id
          JOIN accounts        a  ON a.id  = jl.account_id
         WHERE cc.status = 'active'
           ${ccFilter} ${sqlFilters} ${d.sql}
         GROUP BY cc.code, cc.name, a.code, a.name, a.type, a.sub_type, a.path
         ORDER BY cc.code, a.path, a.code
      `;
    }

    const r = await pool.query(query, vals);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

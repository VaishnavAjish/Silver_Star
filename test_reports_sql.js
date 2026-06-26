const pool = require('./server/db/pool');

async function test() {
  const q1 = `SELECT
         a.id, a.code, a.name, a.type AS account_type,
         COALESCE(SUM(jl.debit), 0) AS total_debit,
         COALESCE(SUM(jl.credit), 0) AS total_credit,
         COALESCE(SUM(jl.debit - jl.credit), 0) AS net_balance
       FROM accounts a
       LEFT JOIN je_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.je_id
         AND je.status = 'posted' AND je.date::date <= '2026-06-25'::date
       WHERE a.id IN (
         SELECT DISTINCT gl_asset_account_id FROM fixed_asset_categories WHERE gl_asset_account_id IS NOT NULL
         UNION
         SELECT DISTINCT gl_accum_depr_account_id FROM fixed_asset_categories WHERE gl_accum_depr_account_id IS NOT NULL
         UNION
         SELECT DISTINCT gl_depr_expense_account_id FROM fixed_asset_categories WHERE gl_depr_expense_account_id IS NOT NULL
       )
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`;
       
  console.log("Running Query 1...");
  try {
    const r1 = await pool.query(q1);
    console.log("Query 1 success!", r1.rows.length, "rows");
  } catch (e) {
    console.error("Q1 ERROR:", e);
  }
}

test().then(() => { console.log("DONE"); process.exit(0); });

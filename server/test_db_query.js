require('dotenv').config();
const pool = require('./db/pool');

async function run() {
  try {
    const res = await pool.query(`SELECT dr.*, je.je_number,
         COALESCE(lc.cnt, 0)::int AS lines_count
       FROM depreciation_runs dr
       LEFT JOIN journal_entries je ON dr.je_id = je.id
       LEFT JOIN (
         SELECT run_id, COUNT(*) AS cnt
         FROM depreciation_run_lines
         GROUP BY run_id
       ) lc ON lc.run_id = dr.id
       ORDER BY dr.created_at DESC
       LIMIT 50 OFFSET 0`);
    console.log("Success:", res.rows.length);
  } catch (err) {
    console.error("Query Error:", err.message);
  } finally {
    process.exit();
  }
}
run();

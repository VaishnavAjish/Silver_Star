require('dotenv').config();
const fs = require('fs');
const pool = require('./db/pool');

async function run() {
  try {
    const page = 1;
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const result = await pool.query(
      `SELECT dr.*, je.je_number,
         COALESCE(lc.cnt, 0)::int AS lines_count
       FROM depreciation_runs dr
       LEFT JOIN journal_entries je ON dr.je_id = je.id
       LEFT JOIN (
         SELECT run_id, COUNT(*) AS cnt
         FROM depreciation_run_lines
         GROUP BY run_id
       ) lc ON lc.run_id = dr.id
       ORDER BY dr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    fs.writeFileSync('test_output.json', JSON.stringify({ success: true, count: result.rows.length }));
  } catch (err) {
    fs.writeFileSync('test_output.json', JSON.stringify({ success: false, error: err.message, stack: err.stack }));
  } finally {
    pool.shutdown();
  }
}
run();

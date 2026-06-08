require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');

async function check() {
  const outPath = path.join(__dirname, 'mig_output.json');
  try {
    const client = await pool.primaryPool.connect();
    const res = await client.query('SELECT filename FROM migrations_history WHERE filename = $1', ['phase35_growth_run_cycles.sql']);
    
    // Check if the table exists
    const tableCheck = await client.query(`SELECT to_regclass('public.growth_run_cycles') as exists`);

    fs.writeFileSync(outPath, JSON.stringify({
      history_rows: res.rows,
      table_exists: tableCheck.rows[0].exists !== null
    }));
    client.release();
  } catch (e) {
    fs.writeFileSync(outPath, JSON.stringify({ error: e.message }));
  } finally {
    process.exit();
  }
}
check();

const pool = require('./db/pool');
const fs = require('fs');
const path = require('path');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'phase56_allowed_outputs.sql'), 'utf8');
  console.log('Running migration...');
  await pool.query(sql);
  console.log('Done!');
  process.exit(0);
}

run().catch(console.error);

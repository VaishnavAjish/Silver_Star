require('dotenv').config();
const pool = require('./db/pool');
async function run() {
  const { rows } = await pool.primaryPool.query('SELECT name, code FROM machines ORDER BY name ASC');
  console.log('Total machines:', rows.length);
  rows.slice(0, 15).forEach(r => console.log(r.name, r.code));
  process.exit();
}
run();

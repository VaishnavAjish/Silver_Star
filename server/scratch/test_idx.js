const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: '192.168.1.53',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  try {
    const res = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'payment_allocations'`);
    console.log(res.rows);
  } catch (err) {
    console.error("PG ERROR:", err.message);
  } finally {
    process.exit();
  }
}
run();

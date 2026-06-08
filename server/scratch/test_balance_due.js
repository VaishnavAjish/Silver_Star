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
    const res = await pool.query(`
      SELECT 
        SUM(balance_due) AS sum_balance_due,
        SUM(amount_paid) AS sum_amount_paid,
        SUM(grand_total) AS sum_grand_total
      FROM purchase_notes
    `);
    console.log(res.rows[0]);
  } catch (err) {
    console.error("PG ERROR:", err.message);
  } finally {
    process.exit();
  }
}
run();

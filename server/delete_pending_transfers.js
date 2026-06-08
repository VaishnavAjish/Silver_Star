require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

async function run() {
  try {
    const res = await pool.query(`DELETE FROM pending_transfer_lots`);
    console.log(`Deleted ${res.rowCount} rows from pending_transfer_lots`);
  } catch (err) {
    console.error(err.message);
  } finally {
    process.exit();
  }
}
run();

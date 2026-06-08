require('dotenv').config();
const pool = require('./db/pool');

async function check() {
  try {
    const res = await pool.primaryPool.query("SELECT sequencename FROM pg_sequences WHERE sequencename='machine_process_seq'");
    console.log('Seq:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
}
check();

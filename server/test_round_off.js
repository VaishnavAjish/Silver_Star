const pool = require('./db/pool');

async function check() {
  try {
    const res = await pool.query("SELECT * FROM accounts WHERE name ILIKE '%round%' OR name ILIKE '%adjust%'");
    console.log("ROUND OFF ACCOUNTS:", res.rows);
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
check();

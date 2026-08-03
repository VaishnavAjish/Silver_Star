const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const pool = require('./db/pool');

async function run() {
  const c = await pool.connect();
  try {
    const res = await c.query("SELECT * FROM inventory WHERE lot_name LIKE '%SSD064-JUN26-059%' OR lot_number LIKE '%SSD064-JUN26-059%' OR lot_code LIKE '%SSD064-JUN26-059%'");
    console.log('NEW NAME ROWS:', res.rows.length);
    if(res.rows.length>0) {
      console.log('NEW LOT:');
      console.log(res.rows[0]);
    }
    const old = await c.query("SELECT * FROM inventory WHERE lot_number LIKE '%SSD025-JUL26-059%' OR lot_name LIKE '%SSD025-JUL26-059%' OR lot_code LIKE '%SSD025-JUL26-059%' OR genealogy_path LIKE '%SSD025-JUL26-059%' OR remarks LIKE '%SSD025-JUL26-059%' OR CAST(id AS TEXT) = '100919'");
    console.log('OLD / 100919 ROWS:', old.rows.length);
    if(old.rows.length>0) {
      console.log('OLD / 100919 LOT:');
      console.log(old.rows[0]);
    }
  } catch(e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
run();

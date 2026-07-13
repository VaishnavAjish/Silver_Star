const db = require('./server/config/database');

async function run() {
  try {
    const res = await db.query(`SELECT category, status, operation_type, lot_code, item_category FROM inventory WHERE lot_code = '108556' OR lot_number = '108556'`);
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    db.end();
  }
}
run();

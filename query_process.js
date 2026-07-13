const db = require('./server/config/database');

async function run() {
  try {
    const res = await db.query(`SELECT process_code, process_name, process_group, input_item_category FROM process_master`);
    console.table(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    db.end();
  }
}
run();

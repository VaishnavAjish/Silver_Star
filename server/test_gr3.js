const fs = require('fs');
require('dotenv').config();
const { query } = require('./db/pool');

(async () => {
  try {
    const { rows } = await query(`SELECT id, status, machine_process_id FROM inventory WHERE item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1) ORDER BY id DESC LIMIT 5`);
    fs.writeFileSync('db_out.txt', JSON.stringify(rows, null, 2));
  } catch (err) {
    fs.writeFileSync('db_out.txt', "ERROR: " + err.message);
  } finally {
    process.exit(0);
  }
})();

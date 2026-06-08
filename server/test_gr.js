require('dotenv').config();
const { query, primaryPool } = require('./db/pool');

(async () => {
  try {
    const { rows } = await query(`SELECT * FROM items WHERE category = 'growth_run'`);
    console.log("GROWTH RUN ITEMS:", rows);
    const inv = await query(`SELECT id, status, machine_process_id FROM inventory WHERE item_id = $1`, [rows[0]?.id]);
    console.log("GROWTH RUN INVENTORY:", inv.rows);
  } catch (err) {
    console.error(err);
  } finally {
    primaryPool.end();
  }
})();

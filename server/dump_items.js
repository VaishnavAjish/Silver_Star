const fs = require('fs');
require('dotenv').config();
const { query } = require('./db/pool');

(async () => {
  try {
    const { rows } = await query(`SELECT id, name, category, status FROM items`);
    fs.writeFileSync('items_out.json', JSON.stringify(rows, null, 2));
  } catch (err) {
    fs.writeFileSync('items_out.json', "ERROR: " + err.message);
  } finally {
    process.exit(0);
  }
})();

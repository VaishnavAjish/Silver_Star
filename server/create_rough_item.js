const fs = require('fs');
require('dotenv').config();
const { query, primaryPool } = require('./db/pool');

(async () => {
  try {
    const res = await query(`
      INSERT INTO items (code, name, category, status, default_uom)
      VALUES ('ROUGH-001', 'Rough Diamond Master', 'rough', 'active', 'CT')
      ON CONFLICT (code) DO NOTHING
      RETURNING *;
    `);
    fs.writeFileSync('insert_item.log', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    fs.writeFileSync('insert_item.log', "ERR: " + err.message);
  } finally {
    process.exit(0);
  }
})();

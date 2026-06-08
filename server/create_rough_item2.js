require('dotenv').config();
const { query, primaryPool } = require('./db/pool');

(async () => {
  try {
    const res = await query(`
      INSERT INTO items (code, name, category, status, default_uom)
      VALUES ('ROUGH-002', 'Rough Diamond', 'rough', 'active', 'CT')
      ON CONFLICT (code) DO NOTHING
      RETURNING *;
    `);
    console.log("INSERT RESULT:", res.rows);
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    primaryPool.end(); // close the pool so node can exit gracefully
  }
})();

require('dotenv').config();
const pool = require('./db/pool');
const fs = require('fs');

async function listTables() {
  try {
    const client = await pool.primaryPool.connect();
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    fs.writeFileSync('tables_list.json', JSON.stringify(res.rows.map(r => r.table_name)));
    client.release();
    process.exit();
  } catch(e) {
    fs.writeFileSync('tables_list.json', JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
listTables();

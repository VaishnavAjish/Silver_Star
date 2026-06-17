const fs = require('fs');
const { primaryPool } = require('./db/pool');

async function check() {
  try {
    const res = await primaryPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    fs.writeFileSync('tables.txt', res.rows.map(r => r.table_name).join(', '));
  } catch(e) {
    fs.writeFileSync('tables.txt', 'Error: ' + e.message);
  }
  process.exit();
}
check();

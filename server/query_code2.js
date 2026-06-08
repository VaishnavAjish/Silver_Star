require('dotenv').config();
const { query } = require('./db/pool');
const fs = require('fs');

async function run() {
  try {
    const res = await query("SELECT * FROM code_sequences WHERE entity_type = 'vendor'");
    fs.writeFileSync('out_code.txt', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    fs.writeFileSync('out_code.txt', String(err));
  } finally {
    process.exit(0);
  }
}
run();

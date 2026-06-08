require('dotenv').config();
const { query } = require('./db/pool');
const fs = require('fs');

async function test() {
  try {
    const accs = await query('SELECT id, name, type, is_group, account_type FROM accounts LIMIT 5');
    fs.writeFileSync('test_out.json', JSON.stringify(accs.rows, null, 2));
  } catch (err) {
    fs.writeFileSync('test_err.json', err.message);
  }
  process.exit(0);
}
test();

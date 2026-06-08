const fs = require('fs');
require('dotenv').config();
const { query } = require('./db/pool');

(async () => {
  try {
    const { rows } = await query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'items';`);
    fs.writeFileSync('C:\\Users\\AXEL\\.gemini\\antigravity-ide\\brain\\d8feb190-cf9b-4aa6-8b3a-d8746ac6ad66\\scratch\\db_cols.txt', JSON.stringify(rows, null, 2));
  } catch (err) {
    fs.writeFileSync('C:\\Users\\AXEL\\.gemini\\antigravity-ide\\brain\\d8feb190-cf9b-4aa6-8b3a-d8746ac6ad66\\scratch\\db_cols.txt', err.message);
  } finally {
    process.exit(0);
  }
})();

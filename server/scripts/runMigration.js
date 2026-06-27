require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');

async function run() {
  const sqlFile = process.argv[2] || '../migrations/phase43_reporting_preferences.sql';
  const filePath = path.resolve(__dirname, '../../', sqlFile);
  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    try { await pool.primaryPool.end(); } catch (_) {}
    process.exit(0);
  }
}
run();

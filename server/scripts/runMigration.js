require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');

async function run() {
  // Default: relative to this script's location (server/scripts/ → server/migrations/)
  const filePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '../migrations/phase43_reporting_preferences.sql');

  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration successful:', filePath);
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    try { await pool.primaryPool.end(); } catch (_) {}
    process.exit(0);
  }
}
run();

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../db/pool');
const fs = require('fs');
const path = require('path');

async function run() {
  const filePath = path.join(__dirname, '../migrations/phase43_reporting_preferences.sql');
  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    pool.end();
  }
}
run();

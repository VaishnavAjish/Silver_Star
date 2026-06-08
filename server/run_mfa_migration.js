require('dotenv').config();
const pool = require('./db/pool');
const fs = require('fs');
const path = require('path');

async function migrate() {
  try {
    console.log('Connecting to database...');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'phase32_security_mfa_columns.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migration phase32_security_mfa_columns.sql applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();

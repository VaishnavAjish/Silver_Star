const fs = require('fs');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();
  let log = '';
  try {
    const p = path.join(__dirname, 'migrations', 'phase41-cost-center-foundation.sql');
    const sql = fs.readFileSync(p, 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (const stmt of statements) {
      log += 'Running: ' + stmt.substring(0, 50) + '\n';
      await client.query(stmt);
    }
    
    await client.query('INSERT INTO migrations_history (filename) VALUES ($1) ON CONFLICT DO NOTHING', ['phase41-cost-center-foundation.sql']);
    log += 'SUCCESS: Migration 41 applied!\n';
  } catch (err) {
    log += 'ERROR: ' + err.message + '\n';
  } finally {
    client.release();
    fs.writeFileSync('mig_41_log.txt', log);
    process.exit(0);
  }
}
run();

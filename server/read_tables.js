require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
    `);
    fs.writeFileSync('tables_dump.json', JSON.stringify(res.rows.map(r => r.table_name), null, 2));
  } catch (e) {
    fs.writeFileSync('tables_dump.json', 'Error: ' + e.message);
  } finally {
    process.exit();
  }
}

run();

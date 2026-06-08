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
    const res = await pool.query('SELECT username, is_active FROM users');
    fs.writeFileSync('output.log', JSON.stringify(res.rows, null, 2));
  } catch (e) {
    fs.writeFileSync('output.log', 'Error: ' + e.message);
  } finally {
    process.exit();
  }
}

run();

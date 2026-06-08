require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

async function check() {
  try {
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true'
    });
    
    const client = await pool.connect();
    const res = await client.query('SELECT * FROM accounts LIMIT 5');
    fs.writeFileSync('check_out.json', JSON.stringify({ success: true, rows: res.rows }));
    client.release();
    await pool.end();
  } catch(e) {
    fs.writeFileSync('check_out.json', JSON.stringify({ success: false, error: e.message }));
  }
}
check();

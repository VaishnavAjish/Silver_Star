require('dotenv').config();
const pool = require('./db/pool');
const fs = require('fs');

async function getLogs() {
  try {
    const client = await pool.primaryPool.connect();
    const res = await client.query(`
      SELECT * 
      FROM api_logs 
      WHERE status >= 500 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    fs.writeFileSync('logs_out.json', JSON.stringify(res.rows, null, 2));
    client.release();
    process.exit();
  } catch(e) {
    fs.writeFileSync('logs_out.json', JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
getLogs();

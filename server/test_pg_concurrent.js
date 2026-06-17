const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function test() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'silverstar_grow',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  
  try {
    const client = await pool.connect();
    // execute two queries concurrently on the same client
    await Promise.all([
      client.query('SELECT pg_sleep(1)'),
      client.query('SELECT pg_sleep(1)')
    ]);
    fs.writeFileSync('pg_test_res.txt', 'OK - queued sequentially');
    client.release();
  } catch (err) {
    fs.writeFileSync('pg_test_res.txt', 'ERROR - ' + err.message);
  }
  process.exit();
}
test();

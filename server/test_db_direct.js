const fs = require('fs');
process.on('uncaughtException', e => fs.writeFileSync('db_test_result.txt', 'UNCAUGHT: ' + e.message));
process.on('unhandledRejection', e => fs.writeFileSync('db_test_result.txt', 'UNHANDLED: ' + e.message));

require('dotenv').config();
const { Pool } = require('pg');

async function test() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });

  try {
    const res = await pool.query('SELECT 1 as result');
    fs.writeFileSync('db_test_result.txt', 'SUCCESS: ' + JSON.stringify(res.rows[0]));
  } catch (err) {
    fs.writeFileSync('db_test_result.txt', 'ERROR: ' + err.message);
  } finally {
    await pool.end();
  }
}
test();

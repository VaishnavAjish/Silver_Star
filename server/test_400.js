const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/silverstar'
});

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM code_sequences WHERE entity_type = $1', ['transfer']);
    console.log('ROWS:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    client.release();
    pool.end();
  }
}
run();

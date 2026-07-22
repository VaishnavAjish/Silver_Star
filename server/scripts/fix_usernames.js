require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function run() {
  try {
    const res = await pool.query('UPDATE users SET username = TRIM(username), email = TRIM(email), full_name = TRIM(full_name)');
    console.log(`Successfully trimmed usernames for ${res.rowCount} users.`);
  } catch (e) {
    console.error('Error updating users:', e);
  } finally {
    await pool.end();
  }
}

run();

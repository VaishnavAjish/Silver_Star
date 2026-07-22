require('dotenv').config({ path: __dirname + '/../.env' });
const pool = require('../db/pool');

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

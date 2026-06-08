require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

async function run() {
  try {
    const res = await pool.query(`UPDATE process_master SET completion_mode = 'OUTPUT_BASED' WHERE process_group = 'GROWTH' RETURNING process_code`);
    console.log(`Updated ${res.rowCount} processes to OUTPUT_BASED:`, res.rows.map(r => r.process_code));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();

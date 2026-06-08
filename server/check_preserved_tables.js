require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

const CHECK_TABLES = [
  'machines',
  'vendors',
  'accounts',
  'users',
  'items',
  'inventory'
];

async function run() {
  try {
    for (const table of CHECK_TABLES) {
      const res = await pool.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`Table ${table} has ${res.rows[0].count} rows.`);
    }
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    process.exit();
  }
}

run();

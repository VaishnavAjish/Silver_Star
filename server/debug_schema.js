const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();
  const tables = ['departments', 'customers', 'invoices', 'inventory', 'machine_processes'];
  for (const t of tables) {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [t]);
    console.log(`\n--- ${t} ---`);
    for (const row of res.rows) {
      console.log(`${row.column_name}: ${row.data_type}`);
    }
  }
  client.release();
  process.exit(0);
}
run();

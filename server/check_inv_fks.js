require('dotenv').config();
const pool = require('./db/pool');

async function run() {
  const { rows } = await pool.primaryPool.query(`
    SELECT conname, pg_get_constraintdef(c.oid) 
    FROM pg_constraint c 
    JOIN pg_namespace n ON n.oid = c.connamespace 
    WHERE conrelid = 'inventory'::regclass;
  `);
  console.log(rows);
  process.exit();
}
run();

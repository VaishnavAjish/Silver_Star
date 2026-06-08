require('dotenv').config();
const fs = require('fs');
const pool = require('./db/pool');

async function applyMigration(file) {
  const sql = fs.readFileSync(file, 'utf8');
  const client = await pool.primaryPool.connect();
  try {
    console.log(`Applying ${file}...`);
    await client.query(sql);
    console.log(`Success: ${file}`);
  } catch (err) {
    console.error(`Error in ${file}:`, err.message);
  } finally {
    client.release();
  }
}

async function run() {
  await applyMigration('./migrations/phase34_process_group.sql');
  process.exit();
}
run();

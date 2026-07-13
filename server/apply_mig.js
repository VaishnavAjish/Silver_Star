const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({
  host: '54.235.46.178',
  port: 5432,
  user: 'ssg',
  password: 'Nidhi',
  database: 'silverstar_grow'
});

async function run() {
  try {
    const sql = fs.readFileSync('migrations/phase55-growth-run-numbering.sql', 'utf8');
    await pool.query(sql);
    console.log("Migration applied successfully!");
  } catch(e) {
    console.error("Migration failed:", e);
  } finally {
    pool.end();
  }
}
run();

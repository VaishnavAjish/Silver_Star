const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'silverstar_grow',
  user: 'postgres',
  password: 'nidhi',
});

async function run() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'phase33_user_department.sql'),
      'utf8'
    );
    console.log('Running migration...');
    await pool.query(sql);
    console.log('Migration completed successfully!');

    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='department_id'"
    );
    if (r.rows.length > 0) {
      console.log('Column department_id exists on users table');
    } else {
      console.log('Column not found - may already exist?');
    }

    await pool.end();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

run();

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
  const { rows } = await pool.query(`
    SELECT 
      lpi.issue_number, 
      lpi.status as issue_status, 
      lpi.machine_process_id, 
      mp.process_number,
      mp.status as mp_status,
      m.name as machine_name,
      m.status as machine_status
    FROM lot_process_issues lpi
    JOIN machine_processes mp ON mp.id = lpi.machine_process_id
    JOIN machines m ON m.id = mp.machine_id
    WHERE m.name = 'SSD-003'
    ORDER BY lpi.id DESC
    LIMIT 10
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit();
}
run();

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

async function run() {
  try {
    console.log('\n========================================');
    console.log('PHASE 2 — IDENTIFY THE EXACT PROCESS');
    console.log('========================================');
    const pm = await pool.query(`SELECT id, process_code, process_name, process_group, completion_mode, active, input_category, allowed_outputs, output_strategy, machine_group FROM process_master WHERE process_name ILIKE '%Edge Cut%'`);
    console.table(pm.rows);

    console.log('\n========================================');
    console.log('PHASE 3 — READ-ONLY PRODUCTION INVESTIGATION');
    console.log('========================================');
    
    // Find machine
    const m = await pool.query(`SELECT id, code, name, status, updated_at FROM machines WHERE code = 'FB-M-02' OR name = 'LS-02'`);
    console.log('\n--- Machine ---');
    console.table(m.rows);

    if (m.rows.length === 0) return;
    const machineId = m.rows[0].id;

    // Find machine process for Edge Cut / Run 1 / Growth GR-202607-0045
    // Actually, let's just find the latest active process for this machine
    const mp = await pool.query(`
      SELECT mp.id, mp.process_type, mp.status, mp.started_at, mp.completed_at, mp.process_number 
      FROM machine_processes mp
      WHERE mp.machine_id = $1 AND mp.status != 'completed'
      ORDER BY mp.id DESC LIMIT 1
    `, [machineId]);
    console.log('\n--- Active Machine Process ---');
    console.table(mp.rows);

    if (mp.rows.length === 0) {
      console.log('No active machine process found for this machine.');
      return;
    }
    const mpId = mp.rows[0].id;

    // Issues
    const issues = await pool.query(`
      SELECT id, status, qty_issued, remaining_in_process, inventory_id, growth_number, run_number 
      FROM lot_process_issues 
      WHERE machine_process_id = $1
    `, [mpId]);
    console.log('\n--- Associated Issues ---');
    console.table(issues.rows);

    // Returns
    if (issues.rows.length > 0) {
      const issueIds = issues.rows.map(i => i.id);
      const returns = await pool.query(`
        SELECT id, issue_id, return_number, returned_qty, is_final_return, created_at
        FROM lot_process_returns 
        WHERE issue_id = ANY($1::int[])
        ORDER BY created_at DESC
      `, [issueIds]);
      console.log('\n--- Returns ---');
      console.table(returns.rows);
      
      const invs = await pool.query(`
        SELECT id, lot_number, qty, status, updated_at, process_group
        FROM inventory 
        WHERE id = ANY($1::int[])
      `, [issues.rows.map(i => i.inventory_id)]);
      console.log('\n--- Affected Inventory ---');
      console.table(invs.rows);
    }

    // Machine logs
    const mLogs = await pool.query(`
      SELECT id, status_from, status_to, created_at, reason
      FROM machine_status_logs
      WHERE machine_id = $1
      ORDER BY created_at DESC LIMIT 5
    `, [machineId]);
    console.log('\n--- Recent Machine Status Logs ---');
    console.table(mLogs.rows);

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'ssg',
  password: process.env.DB_PASSWORD || 'Nidhi'
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('Fetching issue PI-202608-1053...');
    const { rows: issues } = await client.query("SELECT * FROM lot_process_issues WHERE issue_number = 'PI-202608-1053'");
    if (!issues.length) throw new Error('Issue not found!');
    
    const issue = issues[0];
    console.log('Found issue:', issue.issue_number, 'issued_qty:', issue.issued_qty);
    
    if (Number(issue.issued_qty) !== 21) {
       console.log('Issue qty is already fixed or is not 21. Current qty:', issue.issued_qty);
       return await client.query('ROLLBACK');
    }

    console.log('1. Updating lot_process_issues to 18...');
    await client.query("UPDATE lot_process_issues SET issued_qty = 18 WHERE id = $1", [issue.id]);

    console.log('2. Updating Process Lot (qty = qty - 3)...');
    await client.query("UPDATE inventory SET qty = qty - 3 WHERE id = $1", [issue.process_lot_id]);

    console.log('3. Updating Source Lot (qty = qty + 3)...');
    await client.query("UPDATE inventory SET qty = qty + 3, status = 'IN STOCK' WHERE id = $1", [issue.source_lot_id]);

    console.log('4. Updating Operation Logs...');
    await client.query("UPDATE lot_op_log SET qty_delta = 18 WHERE reference_id = $1 AND operation = 'issue_receive'", [issue.id]);
    await client.query("UPDATE lot_op_log SET qty_delta = -18 WHERE reference_id = $1 AND operation = 'issue'", [issue.id]);

    await client.query('COMMIT');
    console.log('✅ SUCCESS: Fixed issue PI-202608-1053 to 18 pieces!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR fixing data:', err);
  } finally {
    client.release();
    pool.end();
  }
}
run();

require('dotenv').config();
const pool = require('./db/pool');

async function run() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Find the processes to delete
    const resP = await client.query(`
      SELECT id, machine_id FROM machine_processes 
      WHERE process_number LIKE 'PRC-TEST-%' OR process_number LIKE 'PRC-DEMO-%'
    `);
    
    if (resP.rows.length === 0) {
      console.log('No demo processes found to delete.');
      return;
    }

    const processIds = resP.rows.map(r => r.id);
    const machineIds = resP.rows.map(r => r.machine_id);

    console.log(`Found ${processIds.length} demo processes to delete.`);

    // Delete lot_mix_components associated with demo biscuits
    await client.query(`
      DELETE FROM lot_mix_components 
      WHERE mixed_lot_id IN (
        SELECT id FROM inventory WHERE machine_process_id = ANY($1)
      )
    `, [processIds]);

    // Delete demo issues
    await client.query(`
      DELETE FROM lot_process_issues 
      WHERE machine_process_id = ANY($1)
    `, [processIds]);

    // Delete demo inventory (biscuits and seeds)
    // Biscuits are tied to machine_process_id
    await client.query(`
      DELETE FROM inventory 
      WHERE machine_process_id = ANY($1) 
         OR lot_number LIKE 'SEED-TEST-%' 
         OR lot_number LIKE 'SEED-DEMO-%'
    `, [processIds]);

    // Delete demo processes
    await client.query(`
      DELETE FROM machine_processes 
      WHERE id = ANY($1)
    `, [processIds]);

    // Reset machine status back to idle
    if (machineIds.length > 0) {
      await client.query(`
        UPDATE machines 
        SET status = 'idle'
        WHERE id = ANY($1) AND status = 'awaiting_output'
      `, [machineIds]);
    }

    await client.query('COMMIT');
    console.log('Demo data deleted successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting data:', err);
  } finally {
    client.release();
    process.exit();
  }
}

run();

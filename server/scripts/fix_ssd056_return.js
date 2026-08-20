const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool();

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log("Looking up Growth Run SSD056-JUL26-043...");
    const { rows: [gr] } = await client.query(`SELECT * FROM inventory WHERE lot_number = 'SSD056-JUL26-043' OR lot_code = 'SSD056-JUL26-043'`);
    if (!gr) throw new Error("Growth Run not found.");
    
    console.log(`Found GR id: ${gr.id}, status: ${gr.status}`);
    
    // Find the return
    const { rows: retLines } = await client.query(`SELECT return_id FROM process_return_lines WHERE lot_id = $1`, [gr.id]);
    if (retLines.length === 0) throw new Error("No return found for this GR.");
    const returnId = retLines[0].return_id;
    console.log(`Found Return ID: ${returnId}`);
    
    // Find the issue
    const { rows: [issue] } = await client.query(`SELECT * FROM lot_process_issues WHERE process_lot_id = $1 ORDER BY id DESC LIMIT 1`, [gr.id]);
    if (!issue) throw new Error("No issue found.");
    console.log(`Found Issue ID: ${issue.id}`);
    
    // Find created child lots
    const { rows: children } = await client.query(`SELECT * FROM inventory WHERE parent_lot_id = $1 AND operation_type = 'return'`, [gr.id]);
    console.log(`Found child lots: ${children.map(c => c.lot_number).join(', ')}`);
    
    for (const c of children) {
      if (c.status !== 'IN STOCK') {
        throw new Error(`Child lot ${c.lot_number} is not IN STOCK (status: ${c.status}). Cannot safely reverse!`);
      }
    }
    
    // Delete child lots and their process_return_lines and lot_op_logs
    for (const c of children) {
      await client.query(`DELETE FROM lot_op_log WHERE lot_id = $1`, [c.id]);
      await client.query(`DELETE FROM process_return_lines WHERE lot_id = $1`, [c.id]);
      await client.query(`DELETE FROM inventory WHERE id = $1`, [c.id]);
      console.log(`Deleted child lot ${c.lot_number}`);
    }
    
    // Restore attached seeds
    const { rows: attachedSeeds } = await client.query(`SELECT * FROM inventory WHERE root_lot_id = $1 AND id <> $1 AND status = 'CONSUMED'`, [gr.id]);
    for (const s of attachedSeeds) {
      await client.query(`UPDATE inventory SET qty = 1, status = 'IN PROCESS', manufacturing_state = 'ATTACHED_TO_GROWTH', updated_at = NOW() WHERE id = $1`, [s.id]);
      console.log(`Restored attached seed ${s.lot_number}`);
    }
    
    // Restore GR
    await client.query(`UPDATE inventory SET qty = 1, status = 'IN PROCESS', manufacturing_state = 'ATTACHED_TO_GROWTH', updated_at = NOW() WHERE id = $1`, [gr.id]);
    console.log(`Restored Growth Run ${gr.lot_number}`);
    
    // Delete the return
    await client.query(`DELETE FROM lot_op_log WHERE reference_type = 'lot_process_return' AND reference_id = $1`, [returnId]);
    await client.query(`DELETE FROM process_return_lines WHERE return_id = $1`, [returnId]);
    await client.query(`DELETE FROM lot_process_returns WHERE id = $1`, [returnId]);
    
    // Restore the issue
    await client.query(`UPDATE lot_process_issues SET status = 'OPEN', remaining_in_process = 1, updated_at = NOW() WHERE id = $1`, [issue.id]);
    console.log(`Restored Issue ${issue.id} to OPEN`);
    
    await client.query('COMMIT');
    console.log("SUCCESS! Return reversed. You can now re-process the return with BOTH the Seed and Growth weight.");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("ERROR:", err.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();

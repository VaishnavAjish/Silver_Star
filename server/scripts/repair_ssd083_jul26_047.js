const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

const DRY_RUN = !process.argv.includes('--apply');
const LOT_ID = 100843;
const MACHINE_CODE = 'CVD-M-83';

async function runRepair() {
  console.log(`\n======================================================`);
  console.log(`RECOVERY SCRIPT: SSD083-JUL26-047 (Inventory ID: 100843)`);
  console.log(`MODE: ${DRY_RUN ? 'DRY RUN (No changes will be saved)' : 'APPLY (Changes WILL be committed)'}`);
  console.log(`======================================================\n`);

  const client = await pool.connect();
  
  try {
    if (!DRY_RUN) {
      await client.query('BEGIN');
      console.log(`[INFO] Transaction started.`);
    }

    // 1. Lock and Verify Inventory
    const invRes = await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [LOT_ID]);
    if (invRes.rows.length !== 1) {
      throw new Error(`CRITICAL: Expected exactly 1 inventory row for ID ${LOT_ID}, found ${invRes.rows.length}.`);
    }
    const inv = invRes.rows[0];
    if (inv.qty != 8) {
      throw new Error(`CRITICAL: Expected inventory qty to be 8, found ${inv.qty}.`);
    }

    // 2. Lock and Verify Machine
    const machRes = await client.query('SELECT * FROM machines WHERE code = $1 FOR UPDATE', [MACHINE_CODE]);
    if (machRes.rows.length !== 1) {
      throw new Error(`CRITICAL: Machine ${MACHINE_CODE} not found.`);
    }
    const machine = machRes.rows[0];

    // 3. Verify Active Machine Processes
    const mpRes = await client.query(`
      SELECT * FROM machine_processes 
      WHERE machine_id = $1 AND status IN ('RUNNING', 'BREAKDOWN') FOR UPDATE
    `, [machine.id]);
    
    if (mpRes.rows.length !== 1) {
      throw new Error(`CRITICAL: Expected exactly 1 active machine process on ${MACHINE_CODE}, found ${mpRes.rows.length}.`);
    }
    const mp = mpRes.rows[0];

    // 4. Verify Lot Process Issues
    const lpiRes = await client.query(`
      SELECT * FROM lot_process_issues 
      WHERE process_lot_id = $1 AND status = 'OPEN' FOR UPDATE
    `, [LOT_ID]);
    
    if (lpiRes.rows.length === 0) {
      console.log(`[WARN] No OPEN process issues found for lot ${LOT_ID}. Will proceed with recovery.`);
    }

    // 5. Verify Outputs / Returns
    const outRes = await client.query('SELECT * FROM rough_growth WHERE seed_inventory_id = $1', [LOT_ID]);
    if (outRes.rows.length > 0) {
      throw new Error(`CRITICAL: Output already exists in rough_growth! Count: ${outRes.rows.length}. Stop.`);
    }

    const retRes = await client.query('SELECT * FROM process_returns WHERE machine_process_id = $1 OR process_issue_id = ANY($2::int[])', 
      [mp.id, lpiRes.rows.length ? lpiRes.rows.map(r => r.id) : [0]]
    );
    if (retRes.rows.length > 0) {
      throw new Error(`CRITICAL: Process returns already exist! Count: ${retRes.rows.length}. Stop.`);
    }

    console.log(`[SUCCESS] All pre-conditions verified.`);
    console.log(` - Inventory: ID ${inv.id}, Status: ${inv.status}, Qty: ${inv.qty}`);
    console.log(` - Machine: ${machine.code}, Status: ${machine.status}`);
    console.log(` - Machine Process: ID ${mp.id}, Status: ${mp.status}`);

    if (DRY_RUN) {
      console.log(`\n[DRY RUN] Would perform the following updates:`);
      console.log(` 1. UPDATE lot_process_issues SET status = 'CANCELLED' WHERE id IN (${lpiRes.rows.map(r=>r.id).join(',') || 'none'})`);
      console.log(` 2. UPDATE machine_processes SET status = 'CANCELLED' WHERE id = ${mp.id}`);
      console.log(` 3. UPDATE inventory SET status = 'IN STOCK', machine_process_id = NULL WHERE id = ${LOT_ID}`);
      console.log(` 4. UPDATE machines SET status = 'AVAILABLE', active_process_id = NULL WHERE id = ${machine.id}`);
      console.log(` 5. INSERT audit event STUCK_PROCESS_ADMIN_RECOVERY`);
      
      console.log(`\nRun with --apply to commit these changes to the database.`);
      return;
    }

    // --- APPLY CHANGES ---
    console.log(`\n[APPLYING CHANGES]`);
    
    if (lpiRes.rows.length > 0) {
      await client.query(`UPDATE lot_process_issues SET status = 'CANCELLED' WHERE process_lot_id = $1 AND status = 'OPEN'`, [LOT_ID]);
      console.log(` - Updated lot_process_issues to CANCELLED.`);
    }

    await client.query(`UPDATE machine_processes SET status = 'CANCELLED' WHERE id = $1`, [mp.id]);
    console.log(` - Updated machine_process ${mp.id} to CANCELLED.`);

    await client.query(`UPDATE inventory SET status = 'IN STOCK', machine_process_id = NULL WHERE id = $1`, [LOT_ID]);
    console.log(` - Updated inventory ${LOT_ID} to IN STOCK and cleared machine link.`);

    await client.query(`UPDATE machines SET status = 'AVAILABLE', active_process_id = NULL WHERE id = $1`, [machine.id]);
    console.log(` - Updated machine ${machine.code} to AVAILABLE and cleared active process.`);

    // Audit Event
    await client.query(`
      INSERT INTO inventory_history (
        inventory_id, event_type, old_status, new_status, quantity, user_id, reference_id, reference_type, details, created_at
      ) VALUES (
        $1, 'STUCK_PROCESS_ADMIN_RECOVERY', $2, 'IN STOCK', $3, 1, $4, 'machine_process', $5, NOW()
      )
    `, [
      LOT_ID, 
      inv.status,
      inv.qty,
      mp.id,
      JSON.stringify({
        machine_id: machine.id,
        reason: "Legacy/stuck process recovery - physical lot verified outside machine.",
        old_machine_status: machine.status,
        process_issue_ids: lpiRes.rows.map(r => r.id)
      })
    ]);
    console.log(` - Inserted audit event log.`);

    await client.query('COMMIT');
    console.log(`\n[SUCCESS] Transaction committed successfully. Recovery complete.`);

  } catch (err) {
    if (!DRY_RUN) {
      await client.query('ROLLBACK');
      console.error(`\n[ERROR] Transaction rolled back due to error.`);
    }
    console.error(`Error details:`, err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

runRepair();

require('dotenv').config({ path: __dirname + '/../.env' });
const pool = require('../db/pool');

async function diagnostic() {
  try {
    const issueCode = 'PI-202607-0365';
    
    // 1. Process Issue
    const issueResult = await pool.query(`
      SELECT pi.*, p.code as process_code, p.process_group
      FROM process_issues pi
      JOIN processes p ON p.id = pi.process_id
      WHERE pi.issue_number = $1
    `, [issueCode]);
    
    if (issueResult.rows.length === 0) {
      console.log('Issue not found!');
      return;
    }
    const issue = issueResult.rows[0];
    console.log('=== PROCESS ISSUE ===');
    console.log(issue);

    // 2. Machine Process
    const mpResult = await pool.query(`
      SELECT mp.*, m.code as machine_code
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      WHERE mp.id = $1
    `, [issue.machine_process_id]);
    console.log('\n=== MACHINE PROCESS ===');
    console.log(mpResult.rows[0]);

    // 3. Source Inventory (Growth Biscuit)
    const processLotResult = await pool.query(`
      SELECT * FROM inventory WHERE id = $1
    `, [issue.inventory_id]);
    const processLot = processLotResult.rows[0];
    console.log('\n=== SOURCE INVENTORY (GROWTH BISCUIT) ===');
    console.log(processLot);

    // 4. Return State
    const returnResult = await pool.query(`
      SELECT * FROM process_returns WHERE process_issue_id = $1
    `, [issue.id]);
    console.log('\n=== RETURN STATE ===');
    console.log(returnResult.rows);

    const outputsResult = await pool.query(`
      SELECT * FROM inventory
      WHERE id IN (
        SELECT inventory_id FROM process_return_outputs WHERE process_return_id IN (
          SELECT id FROM process_returns WHERE process_issue_id = $1
        )
      )
    `, [issue.id]);
    console.log('\n=== EXISTING OUTPUT INVENTORY ===');
    console.log(outputsResult.rows);

    // 5. Seed Reference Sources
    console.log('\n=== SEED REFERENCE SOURCES ===');
    if (processLot.category === 'growth_run') {
      const { rows: seedRows } = await pool.query(`
        SELECT s.* FROM inventory s
        WHERE s.manufacturing_state = 'ATTACHED_TO_GROWTH'
          AND s.status = 'IN PROCESS'
          AND s.id IN (
            SELECT gi.process_lot_id FROM lot_process_issues gi
            WHERE gi.status = 'RETURNED'
              AND gi.machine_process_id IN (
                SELECT grc.machine_process_id FROM growth_run_cycles grc
                WHERE grc.growth_run_id = $1 AND grc.machine_process_id IS NOT NULL
                UNION
                SELECT ol.reference_id FROM lot_op_log ol
                WHERE ol.lot_id = $1 AND ol.reference_type = 'machine_process'
                  AND ol.operation IN ('growth_run_created','growth_again')
              )
          )
        ORDER BY s.id
      `, [processLot.id]);
      console.log('--- Attached Seed Inventory Rows ---');
      console.log(seedRows);

      // Check mix transactions or prior movements for the seed
      if (seedRows.length > 0) {
        for (const seed of seedRows) {
          const mixResult = await pool.query(`
            SELECT * FROM mix_transactions WHERE output_inventory_id = $1
          `, [seed.id]);
          console.log(`\n--- Mix Transactions for Seed ${seed.id} ---`);
          console.log(mixResult.rows);

          const moveResult = await pool.query(`
            SELECT * FROM inventory_movements WHERE inventory_id = $1 ORDER BY created_at DESC LIMIT 5
          `, [seed.id]);
          console.log(`\n--- Last 5 Movements for Seed ${seed.id} ---`);
          console.log(moveResult.rows);

          const lotOpResult = await pool.query(`
            SELECT * FROM lot_op_log WHERE lot_id = $1 ORDER BY created_at DESC LIMIT 5
          `, [seed.id]);
          console.log(`\n--- Last 5 Lot Ops for Seed ${seed.id} ---`);
          console.log(lotOpResult.rows);
        }
      }
    } else {
      console.log('Process Lot is not a growth_run. Cannot find attached seed in the standard way.');
    }

  } catch (err) {
    console.error('DIAGNOSTIC ERROR:', err);
  } finally {
    await pool.end();
  }
}

diagnostic();

require('dotenv').config({ path: __dirname + '/../.env' });
const pool = require('../db/pool');

const fs = require('fs');

async function diagnostic() {
  let out = '';
  const log = (str) => { out += (typeof str === 'object' ? JSON.stringify(str, null, 2) : str) + '\n'; };
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
      log('Issue not found!');
      return;
    }
    const issue = issueResult.rows[0];
    log('--- PROCESS ISSUE ---');
    log(issue);

    // 2. Machine Process
    const mpResult = await pool.query(`
      SELECT mp.*, m.code as machine_code
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      WHERE mp.id = $1
    `, [issue.machine_process_id]);
    
    log('\n--- MACHINE PROCESS ---');
    log(mpResult.rows[0]);

    // 3. Machine Process Lots (Attachment)
    const mplResult = await pool.query(`
      SELECT *
      FROM machine_process_lots
      WHERE machine_process_id = $1
    `, [issue.machine_process_id]);
    log('\n--- MACHINE PROCESS LOTS ---');
    log(mplResult.rows);

    // 4. Source Inventory (Seed)
    const invResult = await pool.query(`
      SELECT *
      FROM inventory
      WHERE id = $1
    `, [issue.inventory_id]);
    log('\n--- SOURCE INVENTORY (SEED) ---');
    log(invResult.rows[0]);

    // 5. Returns
    const returnResult = await pool.query(`
      SELECT *
      FROM process_returns
      WHERE process_issue_id = $1
    `, [issue.id]);
    log('\n--- EXISTING RETURNS ---');
    log(returnResult.rows);

    // 6. Outputs
    const outputsResult = await pool.query(`
      SELECT *
      FROM inventory
      WHERE id IN (
        SELECT inventory_id FROM process_return_outputs WHERE process_return_id IN (
          SELECT id FROM process_returns WHERE process_issue_id = $1
        )
      )
    `, [issue.id]);
    log('\n--- OUTPUT INVENTORY ---');
    log(outputsResult.rows);

  } catch (err) {
    log(err.toString());
  } finally {
    fs.writeFileSync('diag_output.txt', out);
    await pool.end();
  }
}

diagnostic();

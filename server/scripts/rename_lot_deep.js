const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

const DRY_RUN = !process.argv.includes('--apply');
const SEARCH_PATTERN = '029-AUG26-045';
const OLD_PREFIX = 'SSD029-AUG26-045';
const NEW_PREFIX = 'SSD018-AUG26-045';

async function runDeepRename() {
  console.log(`\n======================================================`);
  console.log(`DEEP LOT RENAME: Replacing '${OLD_PREFIX}' -> '${NEW_PREFIX}' across ALL columns`);
  console.log(`MODE: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (committing changes)'}`);
  console.log(`======================================================\n`);

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    // Find ALL inventory rows where lot_number, lot_name, lot_code, genealogy_path or remarks match
    const invRes = await client.query(
      `SELECT id, lot_number, lot_name, lot_code, genealogy_path, remarks 
       FROM inventory 
       WHERE lot_number LIKE '%' || $1 || '%' 
          OR lot_name LIKE '%' || $1 || '%' 
          OR lot_code LIKE '%' || $1 || '%'
          OR genealogy_path LIKE '%' || $1 || '%'
          OR remarks LIKE '%' || $1 || '%'
       FOR UPDATE`, 
      [SEARCH_PATTERN]
    );

    console.log(`[FOUND MATCHING INVENTORY ROWS (${invRes.rows.length})]:`);
    let totalUpdates = 0;

    for (const lot of invRes.rows) {
      let newNum = lot.lot_number ? lot.lot_number.replace(/SSD029-AUG26-045/g, NEW_PREFIX).replace(/029-AUG26-045/g, '018-AUG26-045') : lot.lot_number;
      let newName = lot.lot_name ? lot.lot_name.replace(/SSD029-AUG26-045/g, NEW_PREFIX).replace(/029-AUG26-045/g, '018-AUG26-045') : lot.lot_name;
      let newCode = lot.lot_code ? lot.lot_code.replace(/SSD029-AUG26-045/g, NEW_PREFIX).replace(/029-AUG26-045/g, '018-AUG26-045') : lot.lot_code;
      let newGen  = lot.genealogy_path ? lot.genealogy_path.replace(/SSD029-AUG26-045/g, NEW_PREFIX).replace(/029-AUG26-045/g, '018-AUG26-045') : lot.genealogy_path;
      let newRem  = lot.remarks ? lot.remarks.replace(/SSD029-AUG26-045/g, NEW_PREFIX).replace(/029-AUG26-045/g, '018-AUG26-045') : lot.remarks;

      console.log(`[PROPOSED INVENTORY UPDATE] ID ${lot.id}:`);
      if (lot.lot_number !== newNum) console.log(`  - lot_number:     '${lot.lot_number}' -> '${newNum}'`);
      if (lot.lot_name !== newName)   console.log(`  - lot_name:       '${lot.lot_name}' -> '${newName}'`);
      if (lot.lot_code !== newCode)   console.log(`  - lot_code:       '${lot.lot_code}' -> '${newCode}'`);
      if (lot.genealogy_path !== newGen) console.log(`  - genealogy_path: '${lot.genealogy_path}' -> '${newGen}'`);
      if (lot.remarks !== newRem)     console.log(`  - remarks:        '${lot.remarks}' -> '${newRem}'`);

      if (!DRY_RUN) {
        await client.query(
          `UPDATE inventory 
           SET lot_number = $1, lot_name = $2, lot_code = $3, genealogy_path = $4, remarks = $5 
           WHERE id = $6`,
          [newNum, newName, newCode, newGen, newRem, lot.id]
        );
      }
      totalUpdates++;
    }

    if (DRY_RUN) {
      console.log(`\n======================================================`);
      console.log(`[DRY RUN COMPLETE] Total rows to update: ${totalUpdates}`);
      console.log(`Run with '--apply' to execute updates on database.\n`);
    } else {
      await client.query('COMMIT');
      console.log(`\n======================================================`);
      console.log(`[SUCCESS] Updated ${totalUpdates} inventory rows. Transaction committed successfully.\n`);
    }

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error(`\n[ERROR] Migration aborted:`, err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

runDeepRename();

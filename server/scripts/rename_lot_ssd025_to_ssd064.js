const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

const DRY_RUN = !process.argv.includes('--apply');
const OLD_NAME = 'SSD025-JUL26-059';
const NEW_NAME = 'SSD064-JUN26-059';

async function runRename() {
  console.log(`\n======================================================`);
  console.log(`LOT IDENTITY CORRECTION: ${OLD_NAME} -> ${NEW_NAME}`);
  console.log(`MODE: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`======================================================\n`);

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    // 1. Locate the exact inventory row for SSD025-JUL26-059
    const invRes = await client.query(
      `SELECT * FROM inventory 
       WHERE lot_number = $1 OR lot_name = $1 
          OR lot_number LIKE '%' || $1 || '%' 
          OR lot_name LIKE '%' || $1 || '%' 
       FOR UPDATE`, 
      [OLD_NAME]
    );

    if (invRes.rows.length === 0) {
      throw new Error(`CRITICAL: Could not find inventory row for '${OLD_NAME}'.`);
    }
    if (invRes.rows.length > 1) {
      throw new Error(`CRITICAL: Found ${invRes.rows.length} rows for '${OLD_NAME}'. Aborting to prevent multi-update.`);
    }

    const lot = invRes.rows[0];
    const LOT_ID = lot.id;

    console.log(`[FOUND INVENTORY ROW]`);
    console.log(`- ID: ${LOT_ID}`);
    console.log(`- Current lot_number: ${lot.lot_number}`);
    console.log(`- Current lot_name: ${lot.lot_name}`);
    console.log(`- Current status: ${lot.status}`);
    console.log(`- Qty/Weight: ${lot.qty} / ${lot.weight}`);
    console.log();

    // 3. Confirm SSD064-JUN26-059 does not already exist
    const newInvRes = await client.query(
      `SELECT id FROM inventory WHERE lot_number = $1 OR lot_name = $1`, 
      [NEW_NAME]
    );
    if (newInvRes.rows.length > 0) {
      throw new Error(`CRITICAL: New lot name '${NEW_NAME}' already exists on ID ${newInvRes.rows[0].id}.`);
    }

    console.log(`[VALIDATION]`);
    console.log(`- New name '${NEW_NAME}' is available (no collisions).`);
    console.log(`- Exactly one canonical row matched.`);
    console.log();

    // 4 & 5. Identify fields for update
    // We update lot_number and lot_name by replacing the string.
    let newLotNumber = lot.lot_number ? lot.lot_number.replace(OLD_NAME, NEW_NAME) : lot.lot_number;
    let newLotName = lot.lot_name ? lot.lot_name.replace(OLD_NAME, NEW_NAME) : lot.lot_name;
    let newLotCode = lot.lot_code ? lot.lot_code.replace(OLD_NAME, NEW_NAME) : lot.lot_code;

    console.log(`[PROPOSED UPDATES]`);
    console.log(`- inventory.lot_number: '${lot.lot_number}' -> '${newLotNumber}'`);
    console.log(`- inventory.lot_name: '${lot.lot_name}' -> '${newLotName}'`);
    if (lot.lot_code) console.log(`- inventory.lot_code: '${lot.lot_code}' -> '${newLotCode}'`);
    console.log(`- No foreign-key IDs, quantities, dimensions, genealogies, or history narration will change.`);
    console.log();

    if (DRY_RUN) {
      console.log(`[DRY RUN COMPLETE] Use '--apply' to commit these exact changes.\n`);
      return;
    }

    // Apply updates
    await client.query(
      `UPDATE inventory 
       SET lot_number = $1, lot_name = $2, lot_code = $3 
       WHERE id = $4`,
      [newLotNumber, newLotName, newLotCode, LOT_ID]
    );

    // Also update invoice_lines if there are any canonical links directly tied to this exact inventory_id
    const invoiceLineRes = await client.query(
      `SELECT id, lot_number, lot_name FROM invoice_lines WHERE inventory_id = $1 AND (lot_number LIKE '%' || $2 || '%' OR lot_name LIKE '%' || $2 || '%')`,
      [LOT_ID, OLD_NAME]
    );
    for (const il of invoiceLineRes.rows) {
      let ilNum = il.lot_number ? il.lot_number.replace(OLD_NAME, NEW_NAME) : il.lot_number;
      let ilName = il.lot_name ? il.lot_name.replace(OLD_NAME, NEW_NAME) : il.lot_name;
      await client.query(
        `UPDATE invoice_lines SET lot_number = $1, lot_name = $2 WHERE id = $3`,
        [ilNum, ilName, il.id]
      );
      console.log(`- Updated invoice_lines ID ${il.id}: '${il.lot_name}' -> '${ilName}'`);
    }
    
    // Also update rough_growth for seed_lot_code if it matches
    const roughRes = await client.query(
      `SELECT id, seed_lot_code FROM rough_growth WHERE seed_inventory_id = $1 AND seed_lot_code LIKE '%' || $2 || '%'`,
      [LOT_ID, OLD_NAME]
    );
    for (const rg of roughRes.rows) {
      let rgCode = rg.seed_lot_code ? rg.seed_lot_code.replace(OLD_NAME, NEW_NAME) : rg.seed_lot_code;
      await client.query(
        `UPDATE rough_growth SET seed_lot_code = $1 WHERE id = $2`,
        [rgCode, rg.id]
      );
      console.log(`- Updated rough_growth ID ${rg.id}: '${rg.seed_lot_code}' -> '${rgCode}'`);
    }

    await client.query('COMMIT');
    console.log(`[SUCCESS] Database migration completed. Transaction committed.\n`);

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error(`[ERROR]`, err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

runRename();

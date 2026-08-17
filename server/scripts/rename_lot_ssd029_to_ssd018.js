const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

const DRY_RUN = !process.argv.includes('--apply');
const OLD_NAME = 'SSD029-AUG26-045';
const NEW_NAME = 'SSD018-AUG26-045';

async function runRename() {
  console.log(`\n======================================================`);
  console.log(`LOT IDENTITY CORRECTION: ${OLD_NAME} -> ${NEW_NAME}`);
  console.log(`MODE: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (committing changes)'}`);
  console.log(`======================================================\n`);

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    // 1. Locate the exact inventory row for OLD_NAME
    const invRes = await client.query(
      `SELECT * FROM inventory 
       WHERE lot_number = $1 OR lot_name = $1 
          OR lot_number LIKE '%' || $1 || '%' 
          OR lot_name LIKE '%' || $1 || '%' 
       FOR UPDATE`, 
      [OLD_NAME]
    );

    if (invRes.rows.length === 0) {
      console.log(`⚠️  No inventory row found directly matching '${OLD_NAME}'.`);
    } else {
      console.log(`[FOUND INVENTORY ROWS (${invRes.rows.length})]:`);
      for (const lot of invRes.rows) {
        console.log(`- ID: ${lot.id}`);
        console.log(`  Current lot_number: ${lot.lot_number}`);
        console.log(`  Current lot_name: ${lot.lot_name}`);
        console.log(`  Current lot_code: ${lot.lot_code}`);
        console.log(`  Current status: ${lot.status}`);
        console.log(`  Qty/Weight: ${lot.qty} / ${lot.weight}`);
      }
      console.log();
    }

    // 2. Confirm target lot name NEW_NAME does not already exist
    const newInvRes = await client.query(
      `SELECT id, lot_number, lot_name FROM inventory WHERE lot_number = $1 OR lot_name = $1`, 
      [NEW_NAME]
    );
    if (newInvRes.rows.length > 0) {
      throw new Error(`CRITICAL: New lot name '${NEW_NAME}' already exists on ID ${newInvRes.rows[0].id}. Aborting.`);
    }

    console.log(`[VALIDATION]`);
    console.log(`- Target lot name '${NEW_NAME}' is available (no collisions).`);
    console.log();

    let totalUpdates = 0;

    // 3. Update inventory rows
    for (const lot of invRes.rows) {
      let newLotNumber = lot.lot_number ? lot.lot_number.replace(OLD_NAME, NEW_NAME) : lot.lot_number;
      let newLotName = lot.lot_name ? lot.lot_name.replace(OLD_NAME, NEW_NAME) : lot.lot_name;
      let newLotCode = lot.lot_code ? lot.lot_code.replace(OLD_NAME, NEW_NAME) : lot.lot_code;

      console.log(`[PROPOSED INVENTORY UPDATE] ID ${lot.id}:`);
      if (lot.lot_number !== newLotNumber) console.log(`  - lot_number: '${lot.lot_number}' -> '${newLotNumber}'`);
      if (lot.lot_name !== newLotName)     console.log(`  - lot_name:   '${lot.lot_name}' -> '${newLotName}'`);
      if (lot.lot_code !== newLotCode)     console.log(`  - lot_code:   '${lot.lot_code}' -> '${newLotCode}'`);

      if (!DRY_RUN) {
        await client.query(
          `UPDATE inventory 
           SET lot_number = $1, lot_name = $2, lot_code = $3 
           WHERE id = $4`,
          [newLotNumber, newLotName, newLotCode, lot.id]
        );
      }
      totalUpdates++;
    }

    // 4. Update invoice_lines
    const invoiceLineRes = await client.query(
      `SELECT id, lot_number, lot_name FROM invoice_lines WHERE lot_number LIKE '%' || $1 || '%' OR lot_name LIKE '%' || $1 || '%'`,
      [OLD_NAME]
    );
    for (const il of invoiceLineRes.rows) {
      let ilNum = il.lot_number ? il.lot_number.replace(OLD_NAME, NEW_NAME) : il.lot_number;
      let ilName = il.lot_name ? il.lot_name.replace(OLD_NAME, NEW_NAME) : il.lot_name;
      console.log(`[PROPOSED INVOICE LINE UPDATE] ID ${il.id}:`);
      console.log(`  - lot_number: '${il.lot_number}' -> '${ilNum}'`);
      console.log(`  - lot_name:   '${il.lot_name}' -> '${ilName}'`);
      if (!DRY_RUN) {
        await client.query(
          `UPDATE invoice_lines SET lot_number = $1, lot_name = $2 WHERE id = $3`,
          [ilNum, ilName, il.id]
        );
      }
      totalUpdates++;
    }

    // 5. Update rough_growth
    const roughRes = await client.query(
      `SELECT id, seed_lot_code, growth_lot_code FROM rough_growth WHERE seed_lot_code LIKE '%' || $1 || '%' OR growth_lot_code LIKE '%' || $1 || '%'`,
      [OLD_NAME]
    );
    for (const rg of roughRes.rows) {
      let seedCode = rg.seed_lot_code ? rg.seed_lot_code.replace(OLD_NAME, NEW_NAME) : rg.seed_lot_code;
      let growthCode = rg.growth_lot_code ? rg.growth_lot_code.replace(OLD_NAME, NEW_NAME) : rg.growth_lot_code;
      console.log(`[PROPOSED ROUGH GROWTH UPDATE] ID ${rg.id}:`);
      console.log(`  - seed_lot_code:   '${rg.seed_lot_code}' -> '${seedCode}'`);
      console.log(`  - growth_lot_code: '${rg.growth_lot_code}' -> '${growthCode}'`);
      if (!DRY_RUN) {
        await client.query(
          `UPDATE rough_growth SET seed_lot_code = $1, growth_lot_code = $2 WHERE id = $3`,
          [seedCode, growthCode, rg.id]
        );
      }
      totalUpdates++;
    }

    // 6. Update import_row_lots
    const importRes = await client.query(
      `SELECT id, lot_name FROM import_row_lots WHERE lot_name LIKE '%' || $1 || '%'`,
      [OLD_NAME]
    );
    for (const imp of importRes.rows) {
      let impName = imp.lot_name ? imp.lot_name.replace(OLD_NAME, NEW_NAME) : imp.lot_name;
      console.log(`[PROPOSED IMPORT ROW LOT UPDATE] ID ${imp.id}: '${imp.lot_name}' -> '${impName}'`);
      if (!DRY_RUN) {
        await client.query(
          `UPDATE import_row_lots SET lot_name = $1 WHERE id = $2`,
          [impName, imp.id]
        );
      }
      totalUpdates++;
    }

    if (DRY_RUN) {
      console.log(`\n======================================================`);
      console.log(`[DRY RUN COMPLETE] Total rows to update: ${totalUpdates}`);
      console.log(`Run with '--apply' to execute these updates on the server database.\n`);
    } else {
      await client.query('COMMIT');
      console.log(`\n======================================================`);
      console.log(`[SUCCESS] Updated ${totalUpdates} records. Transaction committed successfully.\n`);
    }

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error(`\n[ERROR] Migration aborted:`, err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

runRename();

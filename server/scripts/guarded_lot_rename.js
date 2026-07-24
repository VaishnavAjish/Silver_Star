'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');

async function runGuardedRename() {
  const oldName = 'SSD080-JUL26-058';
  const newName = 'SSD054-JUN26-073';

  console.log('=== GUARDED LOT-NAME CORRECTION ===');
  console.log(`Targeting Old Name: '${oldName}' -> New Name: '${newName}'`);

  const client = await pool.primaryPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check existing carrier matching old name
    const { rows: existingOld } = await client.query(
      `SELECT * FROM inventory WHERE lot_name = $1 OR growth_number = $1 OR lot_id = $1 FOR UPDATE`,
      [oldName]
    );

    // 2. Check collision matching new name
    const { rows: existingNew } = await client.query(
      `SELECT * FROM inventory WHERE lot_name = $1 OR growth_number = $1 OR lot_id = $1`,
      [newName]
    );

    // Idempotency check: if already renamed to new name and old name no longer exists
    if (existingOld.length === 0 && existingNew.length === 1) {
      console.log('ALREADY_RENAMED — NO ACTION REQUIRED');
      await client.query('ROLLBACK');
      return {
        status: 'ALREADY_RENAMED — NO ACTION REQUIRED',
        carrier: existingNew[0],
      };
    }

    if (existingOld.length === 0 && existingNew.length === 0) {
      throw new Error(`Carrier with lot_name/growth_number '${oldName}' not found in inventory.`);
    }

    if (existingNew.length > 0 && existingOld.length > 0) {
      console.log('HOLD — NEW LOT NAME ALREADY EXISTS');
      await client.query('ROLLBACK');
      return {
        status: 'HOLD — NEW LOT NAME ALREADY EXISTS',
        collisionCarrier: existingNew[0],
      };
    }

    if (existingOld.length !== 1) {
      throw new Error(`Ambiguous match: found ${existingOld.length} carriers matching '${oldName}'.`);
    }

    const carrier = existingOld[0];
    console.log('\n--- Target Carrier Pre-Update ---');
    console.log(`Inventory ID: ${carrier.id}`);
    console.log(`Lot ID: ${carrier.lot_id}`);
    console.log(`Lot Name: ${carrier.lot_name}`);
    console.log(`Growth Number: ${carrier.growth_number}`);
    console.log(`Item ID: ${carrier.item_id}`);
    console.log(`Qty Pcs: ${carrier.qty_pcs}`);
    console.log(`Weight Carats: ${carrier.weight_carats}`);
    console.log(`Dimensions: ${carrier.dimensions}`);
    console.log(`Status: ${carrier.status}`);
    console.log(`Cost Per Unit: ${carrier.cost_per_unit}`);
    console.log(`Total Value: ${carrier.total_value}`);
    console.log(`Root Lot ID: ${carrier.root_lot_id}`);
    console.log(`Growth Run ID: ${carrier.growth_run_id}`);
    console.log(`Created At: ${carrier.created_at}`);

    // 3. Perform guarded atomic update on inventory carrier
    const updateInvR = await client.query(
      `UPDATE inventory
       SET lot_name = $1,
           growth_number = CASE WHEN growth_number = $2 THEN $1 ELSE growth_number END,
           lot_id = CASE WHEN lot_id = $2 THEN $1 ELSE lot_id END,
           updated_at = NOW()
       WHERE id = $3 AND (lot_name = $2 OR growth_number = $2 OR lot_id = $2)
       RETURNING *`,
      [newName, oldName, carrier.id]
    );

    if (updateInvR.rowCount !== 1) {
      throw new Error(`Failed to update inventory row for ID=${carrier.id}. Row count mismatch.`);
    }

    const updatedCarrier = updateInvR.rows[0];

    // 4. Update active denormalized identity fields in related active workflow tables if present
    // process_issues (lot_number)
    const piColR = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'process_issues'`
    );
    if (piColR.rows.some(r => r.column_name === 'lot_number')) {
      await client.query(
        `UPDATE process_issues SET lot_number = $1 WHERE lot_id = $2 AND lot_number = $3`,
        [newName, carrier.id, oldName]
      );
    }

    // barcodes (lot_number / barcode_text)
    const bcColR = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'barcodes'`
    );
    if (bcColR.rows.length > 0) {
      if (bcColR.rows.some(r => r.column_name === 'lot_number')) {
        await client.query(
          `UPDATE barcodes SET lot_number = $1 WHERE lot_id = $2 AND lot_number = $3`,
          [newName, carrier.id, oldName]
        );
      }
      if (bcColR.rows.some(r => r.column_name === 'barcode_text')) {
        await client.query(
          `UPDATE barcodes SET barcode_text = $1 WHERE lot_id = $2 AND barcode_text = $3`,
          [newName, carrier.id, oldName]
        );
      }
    }

    // 5. Insert structured audit log in lot_op_log
    const auditReason = `OWNER_AUTHORIZED_LOT_IDENTITY_CORRECTION | OLD: ${oldName} | NEW: ${newName} | NO_NEW_INVENTORY_ROW`;
    
    await client.query(
      `INSERT INTO lot_op_log (lot_id, operation, notes, performed_at)
       VALUES ($1, $2, $3, NOW())`,
      [carrier.id, 'LOT_RENAME', auditReason]
    );

    await client.query('COMMIT');
    console.log('\nSUCCESS — SAME LOT RENAMED WITHOUT NEW ID');

    return {
      status: 'SUCCESS — SAME LOT RENAMED WITHOUT NEW ID',
      pre: carrier,
      post: updatedCarrier,
      auditReason,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — TRANSACTION ROLLED BACK:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runGuardedRename()
    .then(r => {
      console.log('\nFinal Status:', r.status);
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runGuardedRename };

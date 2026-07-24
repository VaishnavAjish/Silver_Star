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

    // Inspect inventory table columns dynamically
    const invColsR = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory'`
    );
    const invCols = invColsR.rows.map(r => r.column_name);

    // Build dynamic identity query for inventory text columns
    const textFields = ['lot_name', 'lot_number', 'lot_code'].filter(c => invCols.includes(c));
    const whereOldClause = textFields.map((c) => `${c} = $1`).join(' OR ');

    // 1. Check existing carrier matching old name
    const { rows: existingOld } = await client.query(
      `SELECT * FROM inventory WHERE ${whereOldClause} FOR UPDATE`,
      [oldName]
    );

    // 2. Check collision matching new name
    const { rows: existingNew } = await client.query(
      `SELECT * FROM inventory WHERE ${whereOldClause}`,
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
      throw new Error(`Carrier with lot_name/lot_number '${oldName}' not found in inventory.`);
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
    console.log(`Lot Name: ${carrier.lot_name || carrier.lot_number}`);
    console.log(`Status: ${carrier.status}`);
    console.log(`Created At: ${carrier.created_at}`);

    // Build update set clause for existing matching columns
    const setParts = [];

    if (invCols.includes('lot_name')) {
      setParts.push(`lot_name = $1`);
    }
    if (invCols.includes('lot_number')) {
      setParts.push(`lot_number = CASE WHEN lot_number = $2 THEN $1 ELSE lot_number END`);
    }
    if (invCols.includes('lot_code')) {
      setParts.push(`lot_code = CASE WHEN lot_code = $2 THEN $1 ELSE lot_code END`);
    }
    setParts.push(`updated_at = NOW()`);

    const updateSql = `UPDATE inventory SET ${setParts.join(', ')} WHERE id = $3 RETURNING *`;
    const updateInvR = await client.query(updateSql, [newName, oldName, carrier.id]);

    if (updateInvR.rowCount !== 1) {
      throw new Error(`Failed to update inventory row for ID=${carrier.id}. Row count mismatch.`);
    }

    const updatedCarrier = updateInvR.rows[0];

    // 4. Update active denormalized identity fields in related active workflow tables if present
    const tablesR = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const allTables = tablesR.rows.map(r => r.table_name);

    if (allTables.includes('process_issues')) {
      const piCols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'process_issues'`)).rows.map(r => r.column_name);
      if (piCols.includes('lot_number') && piCols.includes('lot_id')) {
        await client.query(
          `UPDATE process_issues SET lot_number = $1 WHERE lot_id = $2 AND lot_number = $3`,
          [newName, carrier.id, oldName]
        );
      }
    }

    if (allTables.includes('barcodes')) {
      const bcCols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'barcodes'`)).rows.map(r => r.column_name);
      if (bcCols.includes('lot_number') && bcCols.includes('lot_id')) {
        await client.query(
          `UPDATE barcodes SET lot_number = $1 WHERE lot_id = $2 AND lot_number = $3`,
          [newName, carrier.id, oldName]
        );
      }
      if (bcCols.includes('barcode_text') && bcCols.includes('lot_id')) {
        await client.query(
          `UPDATE barcodes SET barcode_text = $1 WHERE lot_id = $2 AND barcode_text = $3`,
          [newName, carrier.id, oldName]
        );
      }
    }

    // 5. Insert structured audit log in lot_op_log if table exists
    const auditReason = `OWNER_AUTHORIZED_LOT_IDENTITY_CORRECTION | OLD: ${oldName} | NEW: ${newName} | NO_NEW_INVENTORY_ROW`;
    
    if (allTables.includes('lot_op_log')) {
      await client.query(
        `INSERT INTO lot_op_log (lot_id, operation, notes, performed_at)
         VALUES ($1, $2, $3, NOW())`,
        [carrier.id, 'LOT_RENAME', auditReason]
      );
    }

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


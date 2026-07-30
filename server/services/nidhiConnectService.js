'use strict';

const pool = require('../db/pool');

/**
 * Normalizes a lot name by trimming and converting to uppercase.
 */
function normalizeLotName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toUpperCase();
}

/**
 * Extracts series prefix from lot name.
 * Example: 'SSD013-JUL26-040' -> 'SSD013-JUL26'
 * Example: 'SSD013-JUL26-ABC-040' -> 'SSD013-JUL26-ABC'
 */
function extractSeriesPrefix(lotName) {
  const parts = lotName.split('-');
  if (parts.length <= 1) return lotName;
  parts.pop(); // remove sequence part
  return parts.join('-');
}

/**
 * Controlled Lot Name Correction in NidhiConnect
 *
 * Rules:
 * 1. Validate mandatory reason and special permission.
 * 2. Validate new Lot Name after trim/normalization.
 * 3. Enforce company-wide uniqueness before update & via DB unique constraint.
 * 4. Do not create a new ImportRowLot.
 * 5. Do not consume or modify the Lot Series next number counter.
 * 6. Record oldLotName and newLotName in append-only import_row_lot_events with action LOT_NAME_CORRECTED.
 * 7. Record actor, timestamp, requestId, and row version.
 * 8. Optimistic concurrency: mismatch on row_version returns HTTP 409 Conflict.
 * 9. Batch status check: If status is READY_FOR_FINAL_IMPORT, throw 400 requiring reopening.
 * 10. B5 lock check: If b5_confirmed is true, block direct correction with 422.
 * 11. Update Series linkage if prefix changes, validating sequence availability in new Series without incrementing next_number.
 */
async function correctLotName({
  importRowLotId,
  newLotName,
  reason,
  actorId,
  requestId = null,
  expectedRowVersion = null,
  dbClient = null
}) {
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    const err = new Error('Correction reason is mandatory');
    err.statusCode = 400;
    err.code = 'REASON_REQUIRED';
    throw err;
  }

  const normalizedNewName = normalizeLotName(newLotName);
  if (!normalizedNewName) {
    const err = new Error('Invalid or empty new lot name');
    err.statusCode = 400;
    err.code = 'INVALID_LOT_NAME';
    throw err;
  }

  const client = dbClient || await pool.connect();
  const shouldRelease = !dbClient;

  try {
    if (shouldRelease) await client.query('BEGIN');

    // 1. Fetch & Lock ImportRowLot
    let { rows: lotRows } = await client.query(
      `SELECT r.*, b.status as batch_status, s.series_prefix
       FROM import_row_lots r
       JOIN import_batches b ON r.batch_id = b.id
       JOIN lot_series s ON r.lot_series_id = s.id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [importRowLotId]
    );

    if (!lotRows.length) {
      // Fallback lookup if importRowLotId passed is inventory.id
      const { rows: fallbackRows } = await client.query(
        `SELECT r.*, b.status as batch_status, s.series_prefix
         FROM import_row_lots r
         JOIN import_batches b ON r.batch_id = b.id
         JOIN lot_series s ON r.lot_series_id = s.id
         JOIN inventory inv ON (inv.import_row_lot_id = r.id OR r.lot_name = SPLIT_PART(inv.lot_code, ' ', 1) OR r.lot_name = SPLIT_PART(inv.lot_number, ' ', 1))
         WHERE inv.id = $1 FOR UPDATE OF r`,
        [importRowLotId]
      );
      lotRows = fallbackRows;
    }

    if (!lotRows.length) {
      const err = new Error(`ImportRowLot with ID ${importRowLotId} not found`);
      err.statusCode = 404;
      err.code = 'LOT_NOT_FOUND';
      throw err;
    }

    const lot = lotRows[0];
    const oldLotName = lot.lot_name;
    const oldSeriesId = lot.lot_series_id;
    const sequenceNumber = lot.sequence_number;
    const companyId = lot.company_id;

    // No-op check if name is unchanged
    if (oldLotName === normalizedNewName) {
      if (shouldRelease) await client.query('COMMIT');
      return lot;
    }

    // 2. Optimistic Concurrency Check
    if (expectedRowVersion !== null && expectedRowVersion !== undefined) {
      if (parseInt(lot.row_version) !== parseInt(expectedRowVersion)) {
        const err = new Error(`Stale request. Current version is ${lot.row_version}, expected ${expectedRowVersion}`);
        err.statusCode = 409;
        err.code = 'STALE_DATA_VERSION_MISMATCH';
        throw err;
      }
    }

    // 3. Check Batch Status Guard
    if (lot.batch_status === 'READY_FOR_FINAL_IMPORT') {
      const err = new Error('Batch is in READY_FOR_FINAL_IMPORT state. Reopen batch before correcting lot name.');
      err.statusCode = 400;
      err.code = 'BATCH_LOCKED_REQUIRE_REOPEN';
      throw err;
    }

    // 4. Check B5 Confirmation Lock
    if (lot.b5_confirmed) {
      const err = new Error('Direct correction blocked after B5/Fantasy confirmation. Use external-reconciliation workflow.');
      err.statusCode = 422;
      err.code = 'DIRECT_CORRECTION_BLOCKED_B5_CONFIRMED';
      throw err;
    }

    // 5. Company-Wide Uniqueness Pre-Check
    const { rows: existingNameRows } = await client.query(
      `SELECT id FROM import_row_lots WHERE company_id = $1 AND lot_name = $2 AND id != $3`,
      [companyId, normalizedNewName, lot.id]
    );

    if (existingNameRows.length > 0) {
      const err = new Error(`Lot name '${normalizedNewName}' already exists in company`);
      err.statusCode = 409;
      err.code = 'DUPLICATE_LOT_NAME';
      throw err;
    }

    // 6. Series Resolution & Linkage Update
    const newPrefix = extractSeriesPrefix(normalizedNewName);
    let newSeriesId = oldSeriesId;

    if (newPrefix !== lot.series_prefix) {
      // Find or create target series
      let { rows: seriesRows } = await client.query(
        `SELECT id, series_prefix, next_number FROM lot_series WHERE company_id = $1 AND series_prefix = $2`,
        [companyId, newPrefix]
      );

      if (!seriesRows.length) {
        // Create new LotSeries without altering any sequence
        const { rows: createdSeries } = await client.query(
          `INSERT INTO lot_series (company_id, series_prefix, next_number)
           VALUES ($1, $2, 1) RETURNING *`,
          [companyId, newPrefix]
        );
        seriesRows = createdSeries;
      }

      newSeriesId = seriesRows[0].id;

      // Verify sequence_number availability in new series
      const { rows: seqConflictRows } = await client.query(
        `SELECT id FROM import_row_lots WHERE lot_series_id = $1 AND sequence_number = $2 AND id != $3`,
        [newSeriesId, sequenceNumber, lot.id]
      );

      if (seqConflictRows.length > 0) {
        const err = new Error(`Sequence number '${sequenceNumber}' is already used in series '${newPrefix}'`);
        err.statusCode = 409;
        err.code = 'SERIES_SEQUENCE_CONFLICT';
        throw err;
      }
    }

    // 7. Update ImportRowLot
    const newRowVersion = lot.row_version + 1;
    const { rows: [updatedLot] } = await client.query(
      `UPDATE import_row_lots
       SET lot_name = $1,
           lot_series_id = $2,
           row_version = $3,
           updated_at = NOW()
       WHERE id = $4 AND row_version = $5
       RETURNING *`,
      [normalizedNewName, newSeriesId, newRowVersion, lot.id, lot.row_version]
    );

    if (!updatedLot) {
      const err = new Error('Concurrent update detected on lot record');
      err.statusCode = 409;
      err.code = 'STALE_DATA_VERSION_MISMATCH';
      throw err;
    }

    // 7b. Sync current inventory table views if matching lot exists
    try {
      const baseOldName = oldLotName.split(' ')[0].trim();
      const baseNewName = normalizedNewName.split(' ')[0].trim();
      await client.query(
        `UPDATE inventory
         SET lot_code   = REPLACE(lot_code, $2, $1),
             lot_number = REPLACE(lot_number, $2, $1),
             lot_name   = REPLACE(lot_name, $2, $1)
         WHERE lot_code LIKE $2 || '%'
            OR lot_number LIKE $2 || '%'
            OR lot_name LIKE $2 || '%'`,
        [baseNewName, baseOldName]
      );
    } catch (invErr) {
      // Safe fallback if optional inventory table fields differ
    }

    // 8. Append Audit Event
    await client.query(
      `INSERT INTO import_row_lot_events
         (import_row_lot_id, action, old_lot_name, new_lot_name, old_lot_series_id, new_lot_series_id, reason, actor_id, request_id, row_version)
       VALUES ($1, 'LOT_NAME_CORRECTED', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        importRowLotId,
        oldLotName,
        normalizedNewName,
        oldSeriesId,
        newSeriesId,
        reason.trim(),
        actorId,
        requestId || null,
        newRowVersion
      ]
    );

    if (shouldRelease) await client.query('COMMIT');
    return updatedLot;
  } catch (err) {
    if (shouldRelease) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}

/**
 * Reopens a batch from READY_FOR_FINAL_IMPORT to REOPENED
 */
async function reopenBatch(batchId, actorId) {
  const { rows } = await pool.query(
    `UPDATE import_batches
     SET status = 'REOPENED', updated_at = NOW()
     WHERE id = $1 AND status = 'READY_FOR_FINAL_IMPORT'
     RETURNING *`,
    [batchId]
  );
  if (!rows.length) {
    throw new Error('Batch not found or not in READY_FOR_FINAL_IMPORT status');
  }
  return rows[0];
}

/**
 * Creates an export snapshot for a batch
 */
async function createBatchSnapshot(batchId, snapshotType) {
  const { rows: lotRows } = await pool.query(
    `SELECT id, lot_name, sequence_number, row_version, b5_confirmed
     FROM import_row_lots WHERE batch_id = $1 ORDER BY id`,
    [batchId]
  );

  const { rows: [snapshot] } = await pool.query(
    `INSERT INTO import_batch_snapshots (batch_id, snapshot_type, payload)
     VALUES ($1, $2, $3) RETURNING *`,
    [batchId, snapshotType, JSON.stringify(lotRows)]
  );

  return snapshot;
}

module.exports = {
  normalizeLotName,
  extractSeriesPrefix,
  correctLotName,
  reopenBatch,
  createBatchSnapshot,
};

'use strict';

/**
 * NidhiConnect Controlled Lot Name Correction Unit & Integration Tests
 * Run with: node --test server/tests/nidhiConnectLotCorrection.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const {
  correctLotName,
  reopenBatch,
  createBatchSnapshot,
  normalizeLotName,
  extractSeriesPrefix
} = require('../services/nidhiConnectService');

// Helper to clean test fixtures
async function cleanupFixtures() {
  await pool.query(`DELETE FROM import_batch_snapshots WHERE batch_id IN (SELECT id FROM import_batches WHERE batch_number LIKE 'TEST-BATCH-%')`);
  await pool.query(`DELETE FROM import_row_lot_events WHERE import_row_lot_id IN (SELECT id FROM import_row_lots WHERE company_id = 999)`);
  await pool.query(`DELETE FROM import_row_lots WHERE company_id = 999`);
  await pool.query(`DELETE FROM import_batches WHERE company_id = 999`);
  await pool.query(`DELETE FROM lot_series WHERE company_id = 999`);
}

test('NidhiConnect helper utilities: normalize and extract series prefix', () => {
  assert.equal(normalizeLotName('  ssd013-jun26-040  '), 'SSD013-JUN26-040');
  assert.equal(extractSeriesPrefix('SSD013-JUN26-040'), 'SSD013-JUN26');
  assert.equal(extractSeriesPrefix('SSD013-JUL26-040'), 'SSD013-JUL26');
});

test('Controlled Lot Name Correction: full rule validation suite', async (t) => {
  await cleanupFixtures();

  // Setup Fixtures
  const companyId = 999;

  // 1. Create Series JUN26 (next_number = 100)
  const { rows: [junSeries] } = await pool.query(
    `INSERT INTO lot_series (company_id, series_prefix, next_number)
     VALUES ($1, 'SSD013-JUN26', 100) RETURNING *`,
    [companyId]
  );

  // 2. Create Series JUL26 (next_number = 200)
  const { rows: [julSeries] } = await pool.query(
    `INSERT INTO lot_series (company_id, series_prefix, next_number)
     VALUES ($1, 'SSD013-JUL26', 200) RETURNING *`,
    [companyId]
  );

  // 3. Create Import Batch in DRAFT status
  const { rows: [batch] } = await pool.query(
    `INSERT INTO import_batches (company_id, batch_number, status)
     VALUES ($1, 'TEST-BATCH-001', 'DRAFT') RETURNING *`,
    [companyId]
  );

  // 4. Create Initial ImportRowLot SSD013-JUN26-040 (sequence 040)
  const { rows: [lot] } = await pool.query(
    `INSERT INTO import_row_lots (company_id, batch_id, lot_series_id, lot_name, sequence_number, row_version)
     VALUES ($1, $2, $3, 'SSD013-JUN26-040', '040', 1) RETURNING *`,
    [companyId, batch.id, junSeries.id]
  );

  // 5. Create another existing Lot SSD013-JUL26-099 (to test duplicate check)
  const { rows: [existingLot] } = await pool.query(
    `INSERT INTO import_row_lots (company_id, batch_id, lot_series_id, lot_name, sequence_number, row_version)
     VALUES ($1, $2, $3, 'SSD013-JUL26-099', '099', 1) RETURNING *`,
    [companyId, batch.id, julSeries.id]
  );

  // Take an initial export snapshot of the batch before correction
  const initialSnapshot = await createBatchSnapshot(batch.id, 'FINAL_EXPORT');

  // Count total lots in DB before correction
  const { rows: [{ count: lotCountBefore }] } = await pool.query(
    `SELECT COUNT(*) FROM import_row_lots WHERE company_id = $1`,
    [companyId]
  );

  // Perform Lot Name Correction: SSD013-JUN26-040 -> SSD013-JUL26-040
  const correctedLot = await correctLotName({
    importRowLotId: lot.id,
    newLotName: 'SSD013-JUL26-040',
    reason: 'Typo in series month code during registration',
    actorId: 42,
    requestId: 'REQ-12345',
    expectedRowVersion: 1,
  });

  // TEST RULE 1: Lot ID remains unchanged
  t.test('1. Lot ID remains unchanged', () => {
    assert.equal(correctedLot.id, lot.id);
  });

  // TEST RULE 2: Sequence remains 040
  t.test('2. Sequence remains 040', () => {
    assert.equal(correctedLot.sequence_number, '040');
  });

  // TEST RULE 3: Old name is retained in history (import_row_lot_events)
  t.test('3. Old name is retained in history', async () => {
    const { rows: events } = await pool.query(
      `SELECT * FROM import_row_lot_events WHERE import_row_lot_id = $1 ORDER BY id DESC`,
      [lot.id]
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'LOT_NAME_CORRECTED');
    assert.equal(events[0].old_lot_name, 'SSD013-JUN26-040');
    assert.equal(events[0].new_lot_name, 'SSD013-JUL26-040');
    assert.equal(events[0].reason, 'Typo in series month code during registration');
    assert.equal(events[0].actor_id, 42);
    assert.equal(events[0].request_id, 'REQ-12345');
    assert.equal(events[0].row_version, 2);
  });

  // TEST RULE 4: Duplicate new name returns 409
  t.test('4. Duplicate new name returns 409', async () => {
    await assert.rejects(
      async () => {
        await correctLotName({
          importRowLotId: lot.id,
          newLotName: 'SSD013-JUL26-099', // matches existingLot
          reason: 'Attempt duplicate',
          actorId: 42,
          expectedRowVersion: 2,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'DUPLICATE_LOT_NAME');
        return true;
      }
    );
  });

  // TEST RULE 5: Existing snapshot remains historically unchanged
  t.test('5. Existing snapshot remains historically unchanged', async () => {
    const { rows: [snap] } = await pool.query(
      `SELECT * FROM import_batch_snapshots WHERE id = $1`,
      [initialSnapshot.id]
    );
    const snapPayload = JSON.parse(JSON.stringify(snap.payload));
    const snapTargetLot = snapPayload.find(l => l.id === lot.id);
    assert.ok(snapTargetLot);
    assert.equal(snapTargetLot.lot_name, 'SSD013-JUN26-040');
  });

  // TEST RULE 6: Reopened/recompleted snapshot contains the new name
  t.test('6. Reopened/recompleted snapshot contains the new name', async () => {
    const freshSnapshot = await createBatchSnapshot(batch.id, 'FINAL_EXPORT');
    const snapPayload = JSON.parse(JSON.stringify(freshSnapshot.payload));
    const snapTargetLot = snapPayload.find(l => l.id === lot.id);
    assert.ok(snapTargetLot);
    assert.equal(snapTargetLot.lot_name, 'SSD013-JUL26-040');
  });

  // TEST RULE 7: No new Lot record or sequence consumption
  t.test('7. No new Lot record or sequence consumption', async () => {
    const { rows: [{ count: lotCountAfter }] } = await pool.query(
      `SELECT COUNT(*) FROM import_row_lots WHERE company_id = $1`,
      [companyId]
    );
    assert.equal(parseInt(lotCountAfter), parseInt(lotCountBefore));

    const { rows: [julSeriesAfter] } = await pool.query(
      `SELECT next_number FROM lot_series WHERE id = $1`,
      [julSeries.id]
    );
    assert.equal(julSeriesAfter.next_number, 200); // Unmodified!
  });

  // ADDITIONAL RULE TESTS:

  // Optimistic Concurrency 409 Mismatch
  t.test('Optimistic concurrency: stale expectedRowVersion returns 409', async () => {
    await assert.rejects(
      async () => {
        await correctLotName({
          importRowLotId: lot.id,
          newLotName: 'SSD013-JUL26-041',
          reason: 'Stale update',
          actorId: 42,
          expectedRowVersion: 1, // Current is 2
        });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'STALE_DATA_VERSION_MISMATCH');
        return true;
      }
    );
  });

  // Batch READY_FOR_FINAL_IMPORT lock test
  t.test('Batch locked in READY_FOR_FINAL_IMPORT requires reopening', async () => {
    await pool.query(`UPDATE import_batches SET status = 'READY_FOR_FINAL_IMPORT' WHERE id = $1`, [batch.id]);

    await assert.rejects(
      async () => {
        await correctLotName({
          importRowLotId: lot.id,
          newLotName: 'SSD013-JUL26-041',
          reason: 'Correction on ready batch',
          actorId: 42,
          expectedRowVersion: 2,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'BATCH_LOCKED_REQUIRE_REOPEN');
        return true;
      }
    );

    // Reopen batch and verify correction works
    await reopenBatch(batch.id, 42);
    const reCorrected = await correctLotName({
      importRowLotId: lot.id,
      newLotName: 'SSD013-JUL26-041',
      reason: 'Correction after reopening',
      actorId: 42,
      expectedRowVersion: 2,
    });
    assert.equal(reCorrected.lot_name, 'SSD013-JUL26-041');
  });

  // B5 Confirmation lock test
  t.test('B5 confirmed lot blocks direct correction with 422', async () => {
    await pool.query(`UPDATE import_row_lots SET b5_confirmed = TRUE WHERE id = $1`, [lot.id]);

    await assert.rejects(
      async () => {
        await correctLotName({
          importRowLotId: lot.id,
          newLotName: 'SSD013-JUL26-042',
          reason: 'Post B5 correction',
          actorId: 42,
          expectedRowVersion: 3,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'DIRECT_CORRECTION_BLOCKED_B5_CONFIRMED');
        return true;
      }
    );
  });

  await cleanupFixtures();
});

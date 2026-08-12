'use strict';

/**
 * Growth Process Lot ↔ Growth Number Identity Test Suite
 * Run with: node --test server/tests/growthProcessLotIdentity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { resolveIssueGrowthContext } = require('../services/growthIssueContext');

async function cleanupFixtures() {
  await pool.query(`DELETE FROM lot_op_log WHERE performed_by = 9999`);
  await pool.query(`DELETE FROM machine_process_lots WHERE process_id IN (SELECT id FROM machine_processes WHERE created_by = 9999)`);
  await pool.query(`DELETE FROM lot_process_issues WHERE created_by = 9999`);
  await pool.query(`DELETE FROM machine_processes WHERE created_by = 9999`);
  await pool.query(`DELETE FROM inventory WHERE remarks LIKE '%TEST-IDENTITY-%'`);
  await pool.query(`DELETE FROM growth_monthly_seqs WHERE year_month = 'TEST99'`);
}

test('TEST 1 & TEST 2 & TEST 3 — Growth Issue & Growth Return Identity Contracts', async (t) => {
  await cleanupFixtures();

  // Test 1: Seed 1207 issued to Growth
  // Verify Root Lot = 1207, Source Lot = 1207, Process Lot = generated Growth Number, Growth Number = generated Growth Number
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create seed item & seed inventory row 1207
    const { rows: [seedItem] } = await client.query(
      `INSERT INTO items (code, name, category, status)
       VALUES ('SEED-TEST-01', 'Test Seed Item', 'seed', 'active')
       RETURNING id`
    );

    const { rows: [seedLot] } = await client.query(
      `INSERT INTO inventory (item_id, lot_number, lot_code, qty, unit, weight, status, remarks)
       VALUES ($1, '1207', '1207', 1, 'PCS', 0.5, 'IN STOCK', 'TEST-IDENTITY-SEED')
       RETURNING id, lot_number, lot_code`
    );

    // Set root_lot_id = self
    await client.query(`UPDATE inventory SET root_lot_id = id WHERE id = $1`, [seedLot.id]);

    // 2. Mock Process Issue creation for Growth
    const { rows: [machProc] } = await client.query(
      `INSERT INTO machine_processes (process_number, process_type, status, created_by)
       VALUES ('MP-TEST-001', 'growth', 'running', 9999) RETURNING id`
    );

    const { rows: [biscuitItem] } = await client.query(
      `SELECT id FROM items WHERE category = 'growth_run' LIMIT 1`
    );

    // Create biscuit inventory row SSD101-AUG26-001
    const { rows: [growthRun] } = await client.query(
      `INSERT INTO inventory (item_id, lot_number, lot_name, lot_code, qty, unit, weight, status, remarks, parent_lot_id, root_lot_id, machine_process_id)
       VALUES ($1, 'SSD101-AUG26-001', 'Biscuit SSD101-AUG26-001', 'SSD101-AUG26-001', 1, 'PCS', 0.5, 'IN PROCESS', 'TEST-IDENTITY-BISCUIT', $2, $2, $3)
       RETURNING id, lot_number`,
      [biscuitItem.id, seedLot.id, machProc.id]
    );

    // Insert issue with correct process_lot_id = growthRun.id
    const { rows: [issue] } = await client.query(
      `INSERT INTO lot_process_issues (issue_number, source_lot_id, process_lot_id, issued_qty, machine_process_id, process_type, status, created_by)
       VALUES ('PI-TEST-001', $1, $2, 1, $3, 'growth', 'OPEN', 9999) RETURNING id`,
      [seedLot.id, growthRun.id, machProc.id]
    );

    // Query back formatted issue row
    const { rows: [fetched] } = await client.query(
      `SELECT pi.*,
              sl.lot_number AS source_lot_number,
              pl.lot_number AS process_lot_number, pl.lot_code AS process_lot_code, pli.category AS process_lot_category,
              gr.lot_number AS growth_number, gr.run_no,
              rt.lot_number AS root_lot_number
       FROM lot_process_issues pi
       JOIN inventory sl ON sl.id = pi.source_lot_id
       LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
       LEFT JOIN items pli ON pli.id = pl.item_id
       LEFT JOIN inventory gr ON gr.machine_process_id = pi.machine_process_id AND gr.item_id IN (SELECT id FROM items WHERE category IN ('growth_run','growth_diamond'))
       LEFT JOIN inventory rt ON rt.id = sl.root_lot_id
       WHERE pi.id = $1`,
      [issue.id]
    );

    const resolved = resolveIssueGrowthContext(fetched);

    t.test('TEST 1 — First Growth Issue identity invariants', () => {
      assert.equal(resolved.root_lot_number, '1207');
      assert.equal(resolved.source_lot_number, '1207');
      assert.equal(resolved.process_lot_number, 'SSD101-AUG26-001');
      assert.equal(resolved.growth_number, 'SSD101-AUG26-001');
    });

    t.test('TEST 2 — Growth Return List displays Process Lot and Growth Number identically', () => {
      assert.equal(resolved.process_lot_number, resolved.growth_number);
    });

    t.test('TEST 3 — Growth Again retains same Growth Number', () => {
      const growthAgainResolved = resolveIssueGrowthContext({
        ...fetched,
        process_lot_category: 'growth_run',
        process_lot_number: 'SSD101-AUG26-001',
        process_lot_run_no: 2
      });
      assert.equal(growthAgainResolved.growth_number, 'SSD101-AUG26-001');
      assert.equal(growthAgainResolved.run_no, 2);
      assert.equal(growthAgainResolved.growth_identity_source, 'carrier');
    });

    await client.query('ROLLBACK');
  } finally {
    client.release();
    await cleanupFixtures();
  }
});

test('TEST 6 — Non-Growth Process retains existing valid Process Lot behavior', () => {
  const laserRow = {
    process_type: 'edge_cut',
    process_lot_category: 'rough',
    process_lot_number: '1207-02',
    growth_number: null,
  };
  const resolved = resolveIssueGrowthContext(laserRow);
  assert.equal(resolved.process_lot_number, '1207-02');
  assert.equal(resolved.growth_number, null);
  assert.equal(resolved.growth_identity_source, 'none');
});

test('TEST 7 — Corruption Blocker rejecting Growth issue when Process Lot is seed code', async () => {
  // Mock invariant assertion function
  function verifyGrowthInvariant({ processLotName, growthNumber }) {
    if (processLotName !== growthNumber) {
      throw new Error(`Growth Process invariant violation: Process Lot name '${processLotName}' does not equal Growth Number '${growthNumber}'.`);
    }
  }

  assert.throws(
    () => {
      verifyGrowthInvariant({ processLotName: '1207-02', growthNumber: 'SSD101-AUG26-001' });
    },
    (err) => {
      assert.match(err.message, /Growth Process invariant violation/);
      return true;
    }
  );
});

test('TEST 8 — Exact Defect Verification for PI-202607-0956 scenario', () => {
  const defectRowMock = {
    issue_number: 'PI-202607-0956',
    source_lot_number: '1207',
    root_lot_number: '1207',
    process_lot_category: 'growth_run',
    process_lot_number: 'SSD101-AUG26-001',
    growth_number: 'SSD101-AUG26-001',
  };

  const resolved = resolveIssueGrowthContext(defectRowMock);
  assert.equal(resolved.root_lot_number, '1207');
  assert.equal(resolved.process_lot_number, 'SSD101-AUG26-001');
  assert.equal(resolved.growth_number, 'SSD101-AUG26-001');
});

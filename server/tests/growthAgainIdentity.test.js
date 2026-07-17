// Growth-Again identity correction — focused owner test list (pure, no DB).
// Covers the carrier classification used by the CREATE ISSUE flow, the
// carrier in-place return routing in buildReturnPlan, and the reconciliation
// guard mirror of phase70 (100594 SSD013-APR26-011 / 100867 SSD001-JUL26-055).
const { test } = require('node:test');
const assert = require('node:assert');

const {
  isGrowthCarrierCategory, appliesSeedAttachment, classifyGrowthIssueLots,
  RUN_INCREMENT_SQL, nextRunNo,
} = require('../services/growthCarrier');
const { buildReturnPlan } = require('../services/returnRouting');
const {
  isAlreadyReconciled, reconciliationBlockReason, reconciliationEndState,
} = require('../services/growthIdentityReconciliation');

// ── Fixtures (synthetic mirrors of the production candidate) ──────────────────
const growthDiamondLot = {
  category: 'growth_diamond', status: 'IN STOCK',
  lotNumber: 'SSD013-APR26-011', requestedQty: 21, availableQty: 21,
};
const growthRunLot = {
  category: 'growth_run', status: 'IN STOCK',
  lotNumber: 'SSD001-JUL26-055', requestedQty: 15, availableQty: 15,
};
const seedLot = {
  category: 'seed', status: 'IN STOCK',
  lotNumber: '1019-02', requestedQty: 5, availableQty: 5,
};

const growthOutputs = [
  { type: 'usable',  label: 'Usable',  suffix: 'R', status: 'IN STOCK', item_category_override: 'growth_run' },
  { type: 'damaged', label: 'Damaged', suffix: 'D', status: 'DAMAGED' },
];

const carrierReturnBase = {
  issue: {
    status: 'OPEN', issue_number: 'PI-1', issued_qty: 21,
    remaining_in_process: 21, process_group: 'GROWTH', process_type: 'growth',
    machine_process_id: 512,
  },
  processLot: {
    id: 100594, category: 'growth_diamond', lot_number: 'SSD013-APR26-011',
    lot_code: null, status: 'IN PROCESS', qty: 21, weight: 25.41,
    run_no: 1, rate: 0, total_value: 0,
  },
  biscuit: null,
  biscuitCandidateCount: 0,
  allowedOutputs: growthOutputs,
  lines: [{ type: 'usable', qty: 21 }],
  measurements: undefined,
  openSiblingCount: 0,
  attachedSeed: null,
};

// ── 1. Growth Diamond keeps the same inventory ID ─────────────────────────────
test('1. growth_diamond re-issued to Growth is an identity-preserving carrier', () => {
  const r = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [growthDiamondLot] });
  assert.equal(r.valid, true);
  assert.equal(r.isGrowthAgain, true);
  assert.equal(r.carrierIndex, 0);
  assert.equal(isGrowthCarrierCategory('growth_diamond'), true);
});

test('1b. growth_diamond partial re-issue to Growth is rejected (no identity split)', () => {
  const r = classifyGrowthIssueLots({
    isGrowthGroup: true,
    lots: [{ ...growthDiamondLot, requestedQty: 10 }],
  });
  assert.equal(r.valid, false);
  assert.match(r.error, /full quantity/i);
});

// ── 2. Partial Growth Run keeps the same inventory ID ─────────────────────────
test('2. growth_run re-issued to Growth is an identity-preserving carrier', () => {
  const r = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [growthRunLot] });
  assert.equal(r.valid, true);
  assert.equal(r.isGrowthAgain, true);
  assert.equal(r.carrierIndex, 0);
});

// ── 3. No new inventory/lot is created ────────────────────────────────────────
test('3. Growth Again is flagged so Step 6 skips createGrowthRun (no new row)', () => {
  // isGrowthAgain:true is the exact switch that routes Step 6 to the atomic
  // run-increment UPDATE instead of createGrowthRun's INSERT path.
  for (const lot of [growthDiamondLot, growthRunLot]) {
    const r = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [lot] });
    assert.equal(r.isGrowthAgain, true, lot.category);
  }
  // Seeds still start a NEW growth identity (createGrowthRun path unchanged).
  const seeds = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [seedLot] });
  assert.deepEqual(seeds, { valid: true, isGrowthAgain: false, carrierIndex: null });
});

test('3b. carrier cannot be mixed with other lots, and never two carriers', () => {
  const mixed = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [growthRunLot, seedLot] });
  assert.equal(mixed.valid, false);
  assert.match(mixed.error, /cannot be combined/i);

  const two = classifyGrowthIssueLots({ isGrowthGroup: true, lots: [growthRunLot, growthDiamondLot] });
  assert.equal(two.valid, false);
  assert.match(two.error, /one Growth carrier/i);
});

test('3c. non-growth processes are untouched by carrier classification', () => {
  const r = classifyGrowthIssueLots({
    isGrowthGroup: false,
    lots: [growthDiamondLot, seedLot, { ...growthDiamondLot, requestedQty: 3 }],
  });
  assert.deepEqual(r, { valid: true, isGrowthAgain: false, carrierIndex: null });
});

// ── 4. Run increments atomically ──────────────────────────────────────────────
test('4. run increment is a single COALESCE-guarded SQL expression', () => {
  // The route embeds this fragment in ONE UPDATE executed under the carrier's
  // FOR UPDATE row lock — no read-modify-write window exists.
  assert.equal(RUN_INCREMENT_SQL, 'COALESCE(run_no, 1) + 1');
});

test('4b. run semantics: R1→R2, R2→R3, legacy NULL→R2 — never resets to R1', () => {
  assert.equal(nextRunNo(1), 2);
  assert.equal(nextRunNo(2), 3);
  assert.equal(nextRunNo('7'), 8);
  assert.equal(nextRunNo(null), 2);
  assert.equal(nextRunNo(undefined), 2);
  assert.equal(nextRunNo(0), 2); // corrupt zero never resets below R2
});

// ── 5. No Seed attachment is applied ──────────────────────────────────────────
test('5. seed attachment never applies to either carrier category', () => {
  assert.equal(appliesSeedAttachment('growth_run', true), false);
  assert.equal(appliesSeedAttachment('growth_diamond', true), false);
  // Seeds (and other non-carrier inputs) still attach on GROWTH issues only.
  assert.equal(appliesSeedAttachment('seed', true), true);
  assert.equal(appliesSeedAttachment('seed', false), false);
});

// ── 6. Rough Diamond is rejected ──────────────────────────────────────────────
test('6. rough is rejected from Growth even alongside valid lots', () => {
  const alone = classifyGrowthIssueLots({
    isGrowthGroup: true,
    lots: [{ category: 'rough', status: 'IN STOCK', lotNumber: 'R-77', requestedQty: 1, availableQty: 1 }],
  });
  assert.equal(alone.valid, false);
  assert.match(alone.error, /Rough Diamond/i);

  const mixed = classifyGrowthIssueLots({
    isGrowthGroup: true,
    lots: [seedLot, { category: 'rough', status: 'IN STOCK', lotNumber: 'R-77', requestedQty: 1, availableQty: 1 }],
  });
  assert.equal(mixed.valid, false);
  assert.match(mixed.error, /Rough Diamond/i);
});

// ── 7. Concurrent duplicate Issue is prevented ────────────────────────────────
test('7. a carrier that is already IN PROCESS cannot be issued again', () => {
  // Request B serializes on the FOR UPDATE row lock behind request A; when it
  // re-reads, the carrier is IN PROCESS and classification rejects it.
  for (const status of ['IN PROCESS', 'CONSUMED', 'DAMAGED']) {
    const r = classifyGrowthIssueLots({
      isGrowthGroup: true,
      lots: [{ ...growthDiamondLot, status }],
    });
    assert.equal(r.valid, false, status);
    assert.match(r.error, /duplicate issue blocked|already inside a process|unavailable/i);
  }
  const low = classifyGrowthIssueLots({
    isGrowthGroup: true, lots: [{ ...growthRunLot, status: 'LOW STOCK' }],
  });
  assert.equal(low.valid, true);
});

// ── 8. Return updates the same carrier ────────────────────────────────────────
test('8. growth_diamond carrier return routes in place to the SAME row', () => {
  const p = buildReturnPlan(carrierReturnBase);
  assert.equal(p.valid, true);
  assert.equal(p.route, 'BISCUIT');
  assert.equal(p.in_place, true);
  assert.equal(p.growth_run_input, true);
  assert.equal(p.target_lot_id, 100594);          // SAME inventory id
  assert.equal(p.growth_number, 'SSD013-APR26-011');
  assert.equal(p.run_no, 1);
  assert.equal(p.will_create_new_lot, false);
  assert.equal(p.projected_inventory_status, 'IN STOCK');
  assert.equal(p.projected_qty, 21);              // qty preserved
});

test('8b. growth_run carrier return is unchanged (regression)', () => {
  const p = buildReturnPlan({
    ...carrierReturnBase,
    issue: { ...carrierReturnBase.issue, issued_qty: 15, remaining_in_process: 15 },
    processLot: {
      id: 200001, category: 'growth_run', lot_number: 'GR-000042', lot_code: 'GR-000042',
      status: 'IN PROCESS', qty: 15, weight: 30.2, run_no: 2, rate: 0, total_value: 0,
    },
    lines: [{ type: 'usable', qty: 15 }],
  });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'BISCUIT');
  assert.equal(p.target_lot_id, 200001);
  assert.equal(p.will_create_new_lot, false);
});

test('8c. a stray duplicate biscuit blocks the carrier return until reconciled', () => {
  // The frozen 100594/100867 pair: a growth_run row exists on the same
  // process. The return must not silently update EITHER row.
  const p = buildReturnPlan({
    ...carrierReturnBase,
    biscuit: { id: 100867, lot_number: 'SSD001-JUL26-055', run_no: 1 },
    biscuitCandidateCount: 1,
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /duplicate identity|reconciled/i);
});

test('8d. growth_diamond outside GROWTH keeps its legacy CHILD route (regression)', () => {
  const p = buildReturnPlan({
    ...carrierReturnBase,
    issue: {
      ...carrierReturnBase.issue, process_group: 'LASER', process_type: 'edge_cut',
      issued_qty: 21, remaining_in_process: 21,
    },
    allowedOutputs: [
      { type: 'usable',  suffix: 'R', status: 'IN STOCK' },
      { type: 'damaged', suffix: 'D', status: 'DAMAGED' },
    ],
  });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.will_create_new_lot, true);
});

// ── 9. Reconciliation aborts when downstream references exist ─────────────────
const cleanReconCtx = () => ({
  original: {
    id: 100594, category: 'growth_diamond', lotNumber: 'SSD013-APR26-011',
    status: 'IN PROCESS', runNo: 1, machineProcessId: 512,
    manufacturingState: 'ATTACHED_TO_GROWTH', qty: 21, weight: 25.41,
  },
  duplicate: {
    id: 100867, category: 'growth_run', lotNumber: 'SSD001-JUL26-055',
    status: 'IN PROCESS', runNo: 1, machineProcessId: 512, totalValue: 0, qty: 21,
  },
  duplicateRefs: {
    issues: 0, returnLines: 0, growthCycles: 0, mixComponents: 0,
    childLots: 0, processLotLinks: 0, opLogBeyondCreation: 0,
  },
  issueProcessLotId: 100594,
});

test('9. any downstream reference on the duplicate aborts reconciliation', () => {
  for (const key of ['issues', 'returnLines', 'growthCycles', 'mixComponents',
                     'childLots', 'processLotLinks', 'opLogBeyondCreation']) {
    const ctx = cleanReconCtx();
    ctx.duplicateRefs[key] = 1;
    const reason = reconciliationBlockReason(ctx);
    assert.ok(reason, key);
    assert.match(reason, /downstream activity/i, key);
  }
  // Unmeasured counts are as blocking as non-zero ones.
  const ctx = cleanReconCtx();
  delete ctx.duplicateRefs.growthCycles;
  assert.match(reconciliationBlockReason(ctx), /not measured/i);
});

test('9b. changed frozen state aborts reconciliation', () => {
  let ctx = cleanReconCtx();
  ctx.original.status = 'IN STOCK';
  assert.match(reconciliationBlockReason(ctx), /frozen state changed/i);

  ctx = cleanReconCtx();
  ctx.original.runNo = 2;
  assert.match(reconciliationBlockReason(ctx), /frozen state changed/i);

  ctx = cleanReconCtx();
  ctx.duplicate.machineProcessId = 999;
  assert.match(reconciliationBlockReason(ctx), /same machine process/i);

  ctx = cleanReconCtx();
  ctx.issueProcessLotId = 100867;
  assert.match(reconciliationBlockReason(ctx), /manual review/i);

  ctx = cleanReconCtx();
  ctx.duplicate.totalValue = 1200.5;
  assert.match(reconciliationBlockReason(ctx), /non-zero value/i);
});

// ── 10. Safe reconciliation leaves one active physical carrier ────────────────
test('10. clean context passes and the end state has exactly one active carrier', () => {
  const ctx = cleanReconCtx();
  assert.equal(reconciliationBlockReason(ctx), null);

  const end = reconciliationEndState(ctx);
  assert.equal(end.activeCarrierCount, 1);
  assert.equal(end.original.id, 100594);
  assert.equal(end.original.status, 'IN PROCESS');
  assert.equal(end.original.runNo, 2);                    // the run that DID happen
  assert.equal(end.original.manufacturingState, null);    // wrong attachment cleared
  assert.equal(end.duplicate.status, 'CONSUMED');
  assert.equal(end.duplicate.machineProcessId, null);
  assert.equal(end.duplicate.qty, 0);
  assert.equal(end.duplicate.totalValue, 0);
});

test('10b. idempotency: the reconciled end state is recognized as a no-op', () => {
  const ctx = cleanReconCtx();
  assert.equal(isAlreadyReconciled(ctx), false); // frozen pair: not yet
  const done = {
    original: { ...ctx.original, runNo: 2, manufacturingState: null },
    duplicate: { ...ctx.duplicate, status: 'CONSUMED', machineProcessId: null, qty: 0 },
  };
  assert.equal(isAlreadyReconciled(done), true);
});

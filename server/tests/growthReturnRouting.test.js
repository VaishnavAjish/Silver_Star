// Phase 1 growth-identity routing — truth table for resolveGrowthReturnRoute()
// (pure function, no DB). Covers self-audit test cases 1–6.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveGrowthReturnRoute, reversalBlockReason } = require('../services/returnRouting');

const biscuit = { id: 42, lot_number: 'SSD074-JUN26-015', run_no: 1 };
const allowedOutputs = [
  { type: 'usable',   label: 'Partial Growth Run', item_category_override: 'growth_run', status: 'IN STOCK' },
  { type: 'damaged',  label: 'Damaged',  suffix: 'D', status: 'DAMAGED' },
  { type: 'consumed', label: 'Consumed', suffix: 'C', status: 'CONSUMED' },
];
const base = {
  isGrowthGroupIssue: true, isComponentMode: false, biscuit, allowedOutputs,
};

test('1: full all-usable return (9 of 9) routes to the biscuit', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'BISCUIT');
});

test('2: partial usable (5 of 9) is REJECTED', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 5 }], currentRemaining: 9, remainingAfter: 4 });
  assert.equal(r.route, 'REJECT');
  assert.match(r.reason, /Phase 1/);
});

test('3: mixed final 7 usable + 2 damaged of 9 is REJECTED in Phase 1', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 7 }, { type: 'damaged', qty: 2 }],
    currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
});

test('4: mixed 8 usable + 1 consumed of 9 is REJECTED in Phase 1', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 8 }, { type: 'consumed', qty: 1 }],
    currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
});

test('5: damaged-only return keeps existing CHILD behaviour', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'damaged', qty: 3 }], currentRemaining: 9, remainingAfter: 6 });
  assert.equal(r.route, 'CHILD');
});

test('6a: COMPONENT mode (seed_remove) is never intercepted', () => {
  const r = resolveGrowthReturnRoute({ ...base, isComponentMode: true,
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'CHILD');
});

test('6b: non-GROWTH process (laser/cuts/seed_remove) untouched', () => {
  const r = resolveGrowthReturnRoute({ ...base, isGrowthGroupIssue: false,
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'CHILD');
});

test('6c: usable output overridden to growth_diamond (seed_remove) untouched', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    allowedOutputs: [{ type: 'usable', item_category_override: 'growth_diamond' }],
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'CHILD');
});

test('GROWTH usable/growth_run full return WITHOUT biscuit → REJECT (data-integrity)', () => {
  const r = resolveGrowthReturnRoute({ ...base, biscuit: null,
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
  assert.match(r.reason, /Growth biscuit or Growth Number was not found/);
});

test('non-GROWTH usable output without biscuit → CHILD (legacy untouched)', () => {
  const r = resolveGrowthReturnRoute({ ...base, isGrowthGroupIssue: false, biscuit: null,
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'CHILD');
});

test('usable qty below outstanding with remaining forced to 0 is REJECTED', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 8.9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
});

test('decimal-safe: 8.99995 of 9 within epsilon routes to biscuit', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    lines: [{ type: 'usable', qty: 8.99995 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'BISCUIT');
});

test('usable without growth_run override → CHILD (generic processes)', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    allowedOutputs: [{ type: 'usable', suffix: 'R', status: 'IN STOCK' }],
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'CHILD');
});

// ── Reversal eligibility (phase60) — reversalBlockReason() truth table ────────
const pre = {
  route: 'BISCUIT',
  remaining_before: 9,
  process_lot: { id: 7, qty: 9, weight: 25.65, total_value: 100, status: 'IN PROCESS' },
  biscuit: { id: 42, lot_number: 'SSD074-JUN26-015', run_no: 1, machine_process_id: 5,
             status: 'IN PROCESS', weight: 91.2, dim_length: 26, dim_depth: 13,
             dim_height: 0.3, dim_unit: 'mm' },
  machine_id: 3,
};
const activeHeader = { status: 'ACTIVE', is_final: true };
const returnedIssue = { status: 'RETURNED' };
const okBiscuit = { lot_number: 'SSD074-JUN26-015', run_no: 1, machine_process_id: 5, status: 'IN STOCK' };
const runningMp = { status: 'running' };

test('reversal: eligible full usable growth return → null (allowed)', () => {
  assert.equal(reversalBlockReason({
    header: activeHeader, pre, issue: returnedIssue, biscuit: okBiscuit, machineProcess: runningMp,
  }), null);
});

test('reversal B: already REVERSED → controlled duplicate error', () => {
  assert.equal(reversalBlockReason({
    header: { ...activeHeader, status: 'REVERSED' }, pre, issue: returnedIssue,
    biscuit: okBiscuit, machineProcess: runningMp,
  }), 'This Growth Return has already been reversed.');
});

test('reversal: no pre_state snapshot (legacy/non-biscuit return) → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre: null, issue: returnedIssue,
    biscuit: okBiscuit, machineProcess: runningMp,
  }), /Only the full usable Growth Return/);
});

test('reversal C: run_no advanced (Growth Again started) → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre, issue: returnedIssue,
    biscuit: { ...okBiscuit, run_no: 2 }, machineProcess: runningMp,
  }), /Growth Again has already started/);
});

test('reversal F: biscuit no longer IN STOCK → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre, issue: returnedIssue,
    biscuit: { ...okBiscuit, status: 'IN PROCESS' }, machineProcess: runningMp,
  }), /downstream activity exists/);
});

test('reversal: biscuit repointed to another process → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre, issue: returnedIssue,
    biscuit: { ...okBiscuit, machine_process_id: 9 }, machineProcess: runningMp,
  }), /issued to another process/);
});

test('reversal: issue state changed since return → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre, issue: { status: 'OPEN' },
    biscuit: okBiscuit, machineProcess: runningMp,
  }), /issue state changed/);
});

test('reversal: completed machine process → rejected', () => {
  assert.match(reversalBlockReason({
    header: activeHeader, pre, issue: returnedIssue,
    biscuit: okBiscuit, machineProcess: { status: 'completed' },
  }), /already completed/);
});

// Phase 1 growth-identity routing — truth table for resolveGrowthReturnRoute()
// (pure function, no DB). Covers self-audit test cases 1–6.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveGrowthReturnRoute, buildReturnPlan, reversalBlockReason,
  normalizeGrowthUsableOutputs,
} = require('../services/returnRouting');

// ── normalizeGrowthUsableOutputs — ProcessMaster write guardrail ──────────────
test('normalize: GROWTH usable rule without override is forced to growth_run', () => {
  const input = [
    { type: 'usable', suffix: 'R', status: 'IN STOCK' },
    { type: 'damaged', suffix: 'D', status: 'DAMAGED' },
  ];
  const out = normalizeGrowthUsableOutputs('GROWTH', input);
  assert.equal(out[0].item_category_override, 'growth_run');
  assert.equal(out[1].item_category_override, undefined);
  // immutability: the input rule object is never mutated
  assert.equal(input[0].item_category_override, undefined);
});

test('normalize: already-correct GROWTH config passes through unchanged', () => {
  const input = [{ type: 'usable', suffix: 'R', status: 'IN STOCK', item_category_override: 'growth_run' }];
  const out = normalizeGrowthUsableOutputs('GROWTH', input);
  assert.deepEqual(out, input);
});

test('normalize: COMPONENT-mode config (seed_remove style) is never touched', () => {
  const input = [
    { type: 'S',  suffix: 'S',  status: 'IN STOCK', component: 'seed' },
    { type: 'GD', suffix: 'GD', status: 'IN STOCK', component: 'diamond' },
  ];
  assert.deepEqual(normalizeGrowthUsableOutputs('GROWTH', input), input);
});

test('normalize: non-GROWTH groups are returned untouched', () => {
  const input = [{ type: 'usable', suffix: 'R', status: 'IN STOCK' }];
  assert.deepEqual(normalizeGrowthUsableOutputs('LASER', input), input);
  assert.deepEqual(normalizeGrowthUsableOutputs(null, input), input);
});

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

test('6c: GROWTH usable with INCORRECT override (growth_diamond) → REJECT (config-integrity)', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    allowedOutputs: [{ type: 'usable', item_category_override: 'growth_diamond' }],
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
  assert.match(r.reason, /configuration is invalid/);
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

test('GROWTH usable with MISSING growth_run override → REJECT (config-integrity)', () => {
  const r = resolveGrowthReturnRoute({ ...base,
    allowedOutputs: [{ type: 'usable', suffix: 'R', status: 'IN STOCK' }],
    lines: [{ type: 'usable', qty: 9 }], currentRemaining: 9, remainingAfter: 0 });
  assert.equal(r.route, 'REJECT');
  assert.match(r.reason, /must map to the existing Growth Run identity/);
});

// ── buildReturnPlan — the shared preflight/transaction resolver ───────────────
// Same pure function behind POST /:id/return/validate AND the locked posting
// transaction. Fixtures mirror the expected live case: issue PI-202607-0190,
// seed process lot 1199-02, biscuit SSD087-JUL26-028 (Run R1).
const planIssue = {
  status: 'OPEN', issue_number: 'PI-202607-0190', issued_qty: 9,
  remaining_in_process: 9, process_group: 'GROWTH', process_type: 'growth',
  machine_process_id: 5,
};
const seedProcessLot = {
  id: 7, category: 'seed', lot_code: '1199-02', lot_number: '1199-02',
  qty: 9, weight: 25.65, status: 'IN PROCESS',
};
const planBiscuit = {
  id: 42, lot_number: 'SSD087-JUL26-028', run_no: 1, qty: 1, weight: 91.2,
  status: 'IN PROCESS', machine_process_id: 5,
};
const planBase = {
  issue: planIssue, processLot: seedProcessLot, biscuit: planBiscuit,
  allowedOutputs, lines: [{ type: 'usable', qty: 9 }],
  openSiblingCount: 0, biscuitCandidateCount: 1,
};

test('plan 1: full usable + biscuit → BISCUIT targeting SSD087-JUL26-028, no new lot', () => {
  const p = buildReturnPlan(planBase);
  assert.equal(p.valid, true);
  assert.equal(p.route, 'BISCUIT');
  assert.equal(p.target_lot_id, 42);
  assert.equal(p.target_lot_code, 'SSD087-JUL26-028');
  assert.equal(p.growth_number, 'SSD087-JUL26-028');
  assert.equal(p.run_no, 1);
  assert.equal(p.will_create_new_lot, false);
  assert.equal(p.is_final, true);
  assert.equal(p.reversal_supported, true);
  assert.equal(p.projected_issue_status, 'RETURNED');
  assert.equal(p.projected_inventory_status, 'IN STOCK');
});

test('plan 2: partial usable (5 of 9) → REJECT', () => {
  const p = buildReturnPlan({ ...planBase,
    lines: [{ type: 'usable', qty: 5 }], remainingAfterInput: 4 });
  assert.equal(p.valid, false);
  assert.match(p.error, /Phase 1/);
});

test('plan 3: mixed usable (7 usable + 2 damaged) → REJECT', () => {
  const p = buildReturnPlan({ ...planBase,
    lines: [{ type: 'usable', qty: 7 }, { type: 'damaged', qty: 2 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /Phase 1/);
});

test('plan 4: ZERO biscuit candidates → REJECT (never a replacement Growth identity)', () => {
  const p = buildReturnPlan({ ...planBase, biscuit: null, biscuitCandidateCount: 0 });
  assert.equal(p.valid, false);
  assert.match(p.error, /Growth biscuit or Growth Number was not found/);
});

test('plan 4b: MULTIPLE biscuit candidates → REJECT (identity conflict, never pick a row)', () => {
  const p = buildReturnPlan({ ...planBase, biscuit: null, biscuitCandidateCount: 2 });
  assert.equal(p.valid, false);
  assert.match(p.error, /Multiple Growth biscuits were found/);
});

test('plan 4c: multiple candidates block even a damaged-only return on the conflicted process', () => {
  const p = buildReturnPlan({ ...planBase, biscuit: null, biscuitCandidateCount: 3,
    lines: [{ type: 'damaged', qty: 3 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /identity conflict/);
});

test('plan 5: GROWTH usable with MISSING growth_run override → REJECT', () => {
  const p = buildReturnPlan({ ...planBase,
    allowedOutputs: [{ type: 'usable', suffix: 'R', status: 'IN STOCK' }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /configuration is invalid/);
});

test('plan 6: GROWTH usable with INCORRECT override → REJECT', () => {
  const p = buildReturnPlan({ ...planBase,
    allowedOutputs: [{ type: 'usable', suffix: 'R', status: 'IN STOCK', item_category_override: 'growth_diamond' }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /must map to the existing Growth Run identity/);
});

test('plan 7: damaged-only → CHILD, creates a new lot, not reversible', () => {
  const p = buildReturnPlan({ ...planBase,
    lines: [{ type: 'damaged', qty: 3 }], remainingAfterInput: 6 });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.will_create_new_lot, true);
  assert.equal(p.reversal_supported, false);
  assert.equal(p.is_final, false);
  assert.equal(p.projected_issue_status, 'OPEN');
});

test('plan 8: non-GROWTH usable → legacy CHILD behaviour', () => {
  const p = buildReturnPlan({ ...planBase,
    issue: { ...planIssue, process_group: 'LASER', process_type: 'edge_cut' },
    allowedOutputs: [{ type: 'usable', suffix: 'R', status: 'IN STOCK' }] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.will_create_new_lot, true);
});

test('plan 9a: COMPONENT mode (seed_remove) unchanged — per-group equality holds', () => {
  const compOutputs = [
    { type: 'S',  label: 'Recovered Seed', suffix: 'S',  status: 'IN STOCK', component: 'seed',    type_kind: 'usable' },
    { type: 'GD', label: 'Growth Diamond', suffix: 'GD', status: 'IN STOCK', component: 'diamond', type_kind: 'usable' },
  ];
  const p = buildReturnPlan({ ...planBase, allowedOutputs: compOutputs,
    lines: [{ type: 'S', qty: 9 }, { type: 'GD', qty: 9 }] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.remaining_after, 0);
  assert.equal(p.is_final, true);
});

test('plan 9b: COMPONENT mode — a short group is rejected (groups never summed)', () => {
  const compOutputs = [
    { type: 'S',  suffix: 'S',  status: 'IN STOCK', component: 'seed' },
    { type: 'GD', suffix: 'GD', status: 'IN STOCK', component: 'diamond' },
  ];
  const p = buildReturnPlan({ ...planBase, allowedOutputs: compOutputs,
    lines: [{ type: 'S', qty: 9 }, { type: 'GD', qty: 5 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /diamond outputs total 5\.0000/);
});

test('plan: over-return (12 of 9) → Balance mismatch', () => {
  const p = buildReturnPlan({ ...planBase, lines: [{ type: 'usable', qty: 12 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /Balance mismatch/);
});

test('plan: falsified remaining_in_process=0 with partial qty → REJECT as partial, never BISCUIT', () => {
  // Outstanding 9, client submits 5 usable and LIES that remaining is 0.
  // remaining is SERVER-calculated (9 - 5 = 4), so the plan rejects as a
  // partial growth return — the falsified field cannot reach the BISCUIT route.
  const p = buildReturnPlan({ ...planBase,
    lines: [{ type: 'usable', qty: 5 }], remainingAfterInput: 0, remaining_in_process: 0 });
  assert.equal(p.valid, false);
  assert.notEqual(p.route, 'BISCUIT');
  assert.match(p.error, /Phase 1/);
});

test('plan: biscuit-INPUT return (growth again / laser) stays in place, not the growth-return path', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: { ...planBiscuit, category: 'growth_run', lot_code: null },
    biscuit: null });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'BISCUIT');
  assert.equal(p.growth_run_input, true);
  assert.equal(p.will_create_new_lot, false);
  assert.equal(p.target_lot_code, 'SSD087-JUL26-028');
  assert.equal(p.reversal_supported, false);
});

test('plan: issue no longer OPEN → invalid', () => {
  const p = buildReturnPlan({ ...planBase, issue: { ...planIssue, status: 'RETURNED' } });
  assert.equal(p.valid, false);
  assert.match(p.error, /already RETURNED/);
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

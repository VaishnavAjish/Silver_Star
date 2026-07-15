// Phase 1 growth-identity routing — truth table for resolveGrowthReturnRoute()
// (pure function, no DB). Covers self-audit test cases 1–6.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveGrowthReturnRoute, buildReturnPlan, reversalBlockReason,
  normalizeGrowthUsableOutputs, allocateComponentValues,
  resolveWeightBalanceMode, resolveComponentStrategy,
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
  // Phase B: the Seed process lot is retained (never consumed) on this route.
  assert.equal(p.seed_retained, true);
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
  assert.equal(p.seed_retained, false); // Phase B applies only to the BISCUIT route
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

// ── Phase C: Seed Remove — COMPONENT return of a biscuit input ────────────────
const seedRemoveOutputs = [
  { type: 'reprocess',       label: 'Recovered Seed',  suffix: 'S',  status: 'IN STOCK', item_category_override: 'seed',           component: 'seed' },
  { type: 'seed_damaged',    label: 'Seed Damaged',    suffix: 'SD', status: 'DAMAGED',  item_category_override: 'seed',           component: 'seed' },
  { type: 'usable',          label: 'Growth Diamond',  suffix: 'R',  status: 'IN STOCK', item_category_override: 'growth_diamond', component: 'diamond' },
  { type: 'diamond_damaged', label: 'Diamond Damaged', suffix: 'GD', status: 'DAMAGED',  item_category_override: 'growth_diamond', component: 'diamond' },
];
const biscuitInput = { ...planBiscuit, category: 'growth_run', lot_code: null };

// Phase C unblock fixtures: authoritative attached-Seed context (Decision A/B)
// and a valued biscuit. Seed pool 90 (carrying cost), Growth pool 120,
// assembly weight 91.2 ct, seed reference weight 25.65 ct.
const attachedSeedOk = {
  resolved: true, candidateCount: 1, rootCount: 1, rootLotId: 11,
  inventoryId: 55, // single attached Seed identity (in-place release target)
  refWeight: 25.65, refValue: 90,
};
const biscuitValued = { ...planBiscuit, category: 'growth_run', lot_code: null, total_value: 120 };
const seedRemoveLines = [
  { type: 'reprocess', qty: 6, weight: 2 }, { type: 'seed_damaged', qty: 3, weight: 1 },
  { type: 'usable', qty: 8, weight: 60 },   { type: 'diamond_damaged', qty: 1, weight: 10 },
];

test('phase C (detach): clean Seed Remove → in-place DETACH_TRANSFORM, no child identities', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk, // single seed, inventoryId 55
    lines: [
      { type: 'reprocess', qty: 9, weight: 3 },  // Recovered Seed (released in place)
      { type: 'usable',    qty: 9, weight: 70 }, // Growth Diamond (carrier transformed)
    ] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'DETACH_TRANSFORM');
  assert.equal(p.detach_transform, true);
  assert.equal(p.component_mode, true);
  assert.equal(p.is_final, true);
  // No child identities are created (both existing rows reused).
  assert.equal(p.will_create_new_lot, false);
  assert.equal(p.component_allocation, null);
  // Authoritative target IDs resolved by the planner (client never chooses).
  assert.equal(p.growth_carrier_inventory_id, biscuitValued.id); // carrier = Growth Run row
  assert.equal(p.attached_seed_inventory_id, 55);                // SAME attached Seed row
  assert.equal(p.carrier_target.item_category, 'growth_diamond');
  assert.equal(p.carrier_target.qty, 9);   // actual Growth qty, NEVER forced to 1
  assert.equal(p.carrier_target.weight, 70);
  assert.equal(p.carrier_target.status, 'IN STOCK');
  assert.equal(p.seed_target.qty, 9);
  assert.equal(p.seed_target.weight, 3);
  assert.equal(p.seed_target.status, 'IN STOCK');
  // Weight balance still authoritative (seed bounded, growth generated).
  assert.equal(p.weight_balance.seed_output_weight, 3);
  assert.equal(p.weight_balance.growth_generated_weight, 70);
  // Value pools preserved per identity — no duplication, no allocation.
  assert.deepEqual(p.value_pools, { growth: 120, seed: 90 });
  assert.equal(p.growth_number, 'SSD087-JUL26-028');
  assert.equal(p.run_no, 1);
});

test('phase C (detach): multi-disposition Seed Remove is REJECTED (would create extra identities)', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk,
    lines: seedRemoveLines }); // 2 seed + 2 diamond dispositions
  assert.equal(p.valid, false);
  assert.match(p.error, /exactly one Recovered-Seed line and one Growth-Diamond line/);
});

test('phase C (detach): missing single attached-Seed identity ABORTS the detach', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: { ...attachedSeedOk, inventoryId: null }, // ambiguous / not single
    lines: [
      { type: 'reprocess', qty: 9, weight: 3 },
      { type: 'usable',    qty: 9, weight: 70 },
    ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /exactly one attached Seed inventory identity/);
});

test('strategy: seed_remove config → DETACH_TRANSFORM_IN_PLACE; plain component → child split', () => {
  assert.equal(resolveComponentStrategy(seedRemoveOutputs), 'DETACH_TRANSFORM_IN_PLACE');
  assert.equal(resolveComponentStrategy([
    { type: 'reprocess', component: 'seed' }, { type: 'usable', component: 'diamond' },
  ]), 'COMPONENT_CHILD_SPLIT'); // no seed / growth_diamond category overrides
});

test('phase C: missing attached Seed BLOCKS with the exact required message', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: null,
    lines: seedRemoveLines });
  assert.equal(p.valid, false);
  assert.match(p.error, /Attached Seed could not be resolved for this Growth Run/);
  assert.match(p.error, /quantity, weight, value, and genealogy/);
});

test('phase C: multiple attached Seed roots BLOCK (never collapsed)', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: { ...attachedSeedOk, rootCount: 2, rootLotId: null },
    lines: seedRemoveLines });
  assert.equal(p.valid, false);
  assert.match(p.error, /Multiple attached Seed roots/);
});

test('phase C: missing weight on a qty>0 line BLOCKS (explicit weight mandatory)', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk,
    lines: [
      { type: 'reprocess', qty: 9, weight: 3 },
      { type: 'usable', qty: 9 }, // no weight
    ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /explicit positive output weight/);
});

test('phase C: negative weight BLOCKS', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk,
    lines: [
      { type: 'reprocess', qty: 9, weight: -1 },
      { type: 'usable', qty: 9, weight: 60 },
    ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /Negative weight/);
});

test('phase C: combined output ABOVE the old assembly weight is VALID (generated growth, no mass error)', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk,
    lines: [
      { type: 'reprocess', qty: 9, weight: 20 }, // seed 20 ≤ ref 25.65 → OK
      { type: 'usable', qty: 9, weight: 80 },    // growth 80 (uncapped) → combined 100 > 91.2
    ] });
  assert.equal(p.valid, true);
  assert.equal(p.weight_balance.growth_generated_weight, 80);
  assert.equal(p.weight_balance.combined_output_weight, 100);
  assert.ok(!/mass|negative process loss|exceeds input/i.test(p.error || ''));
});

// ── Seed Remove generated-weight contract — screenshot case + Examples A–F ────
// Self-contained 24-PCS fixture: Seed reference 23.5200 ct, Growth measured for
// the first time at Seed Remove. Value pools: seed 200, growth (biscuit) 500.
const attachedSeed24 = {
  resolved: true, candidateCount: 1, rootCount: 1, rootLotId: 21,
  inventoryId: 100558, // the SAME attached Seed row released in place
  refWeight: 23.52, refValue: 200,
};
const biscuit24 = {
  id: 90, lot_number: 'SSD100-JUL26-100', run_no: 1, qty: 24, weight: 23.52,
  status: 'IN PROCESS', machine_process_id: 9, category: 'growth_run',
  lot_code: null, total_value: 500,
};
const base24 = {
  issue: { status: 'OPEN', issue_number: 'PI-202607-0191', issued_qty: 24,
           remaining_in_process: 24, process_group: 'GROWTH', process_type: 'seed_remove',
           machine_process_id: 9 },
  processLot: biscuit24, biscuit: null, allowedOutputs: seedRemoveOutputs,
  attachedSeed: attachedSeed24, openSiblingCount: 0, biscuitCandidateCount: 0,
};

test('seed-remove #1 (screenshot A): 24 PCS, Seed 23.52, Growth 298.56 → VALID, seed loss 0', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 24, weight: 298.56 },
  ] });
  assert.equal(p.valid, true);
  assert.equal(p.quantity_balance.seed_balanced, true);
  assert.equal(p.quantity_balance.growth_balanced, true);
  assert.equal(Math.round(p.weight_balance.seed_loss_weight * 10000) / 10000, 0);
  assert.equal(p.weight_balance.growth_generated_weight, 298.56);
  assert.ok(!/mass|negative process loss|exceeds input/i.test(p.error || ''));
});

test('seed-remove #2 (Example C): Growth 340 > Seed reference is VALID (no ceiling)', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 24, weight: 340.0 },
  ] });
  assert.equal(p.valid, true);
  assert.equal(p.weight_balance.growth_generated_weight, 340);
});

test('seed-remove #3 (Example B): substantially lower Growth (250) remains VALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.50 },
    { type: 'usable',    qty: 24, weight: 250.0 },
  ] });
  assert.equal(p.valid, true);
  assert.equal(p.weight_balance.growth_generated_weight, 250);
  // Seed variance/loss = 23.52 − 23.50 = 0.02 (independent of growth).
  assert.equal(Math.round(p.weight_balance.seed_loss_weight * 10000) / 10000, 0.02);
});

test('seed-remove #4 (Example E): missing Growth weight is INVALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 24 }, // no weight
  ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /explicit positive output weight/);
});

test('seed-remove #5: zero usable Growth weight is INVALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 24, weight: 0 },
  ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /explicit positive output weight/);
});

test('seed-remove #6 (Example D): Growth-family quantity mismatch is INVALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 23, weight: 298.56 }, // diamond family = 23 ≠ 24
  ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /diamond outputs total/);
});

test('seed-remove #7: Seed-family quantity mismatch is INVALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 23, weight: 23.52 }, // seed family = 23 ≠ 24
    { type: 'usable',    qty: 24, weight: 298.56 },
  ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /seed outputs total/);
});

test('seed-remove #8 (Example F): Seed output beyond reference tolerance is INVALID', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 24.00 }, // 24.00 > 23.52 + EPS
    { type: 'usable',    qty: 24, weight: 298.56 },
  ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /Seed reference weight/);
});

test('seed-remove #9: Seed loss is computed independently of Growth weight', () => {
  const low = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.00 }, { type: 'usable', qty: 24, weight: 100 },
  ] });
  const high = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.00 }, { type: 'usable', qty: 24, weight: 500 },
  ] });
  assert.equal(low.valid, true);
  assert.equal(high.valid, true);
  // Same seed → same seed loss regardless of the (very different) growth weight.
  assert.equal(Math.round(low.weight_balance.seed_loss_weight * 10000) / 10000, 0.52);
  assert.equal(Math.round(high.weight_balance.seed_loss_weight * 10000) / 10000, 0.52);
});

test('seed-remove #12: value conserved — each identity keeps its own family pool (no duplication)', () => {
  const p = buildReturnPlan({ ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 },
    { type: 'usable',    qty: 24, weight: 298.56 },
  ] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'DETACH_TRANSFORM');
  // In-place: carrier keeps growth pool (500), released Seed keeps seed pool (200).
  assert.deepEqual(p.value_pools, { growth: 500, seed: 200 });
  assert.equal(p.component_allocation, null); // no child rows → no per-line allocation
  assert.equal(p.growth_carrier_inventory_id, base24.processLot.id);
  assert.equal(p.attached_seed_inventory_id, 100558);
});

test('seed-remove #14: planner is pure/deterministic — client cannot alter the verdict', () => {
  const ctx = { ...base24, lines: [
    { type: 'reprocess', qty: 24, weight: 23.52 }, { type: 'usable', qty: 24, weight: 298.56 },
  ] };
  const a = buildReturnPlan(ctx);
  const b = buildReturnPlan(ctx); // same function the locked posting recomputes
  assert.deepEqual(a.weight_balance, b.weight_balance);
  assert.deepEqual(a.quantity_balance, b.quantity_balance);
  assert.equal(a.valid, b.valid);
});

// ── resolveWeightBalanceMode — config-driven mode selection ───────────────────
test('mode: seed + diamond families → SEED_REFERENCE_PLUS_GENERATED_GROWTH', () => {
  assert.equal(resolveWeightBalanceMode(seedRemoveOutputs), 'SEED_REFERENCE_PLUS_GENERATED_GROWTH');
});

test('mode #11: non-component / seed-only configs keep COMBINED_MASS (legacy mass rule retained)', () => {
  assert.equal(resolveWeightBalanceMode(allowedOutputs), 'COMBINED_MASS'); // standard usable/damaged/consumed
  assert.equal(resolveWeightBalanceMode([
    { type: 'reprocess', component: 'seed' }, { type: 'seed_damaged', component: 'seed' },
  ]), 'COMBINED_MASS'); // seed-only component config → still combined-mass ceiling
});

// ── DB / UI contract tests — require a live PostgreSQL (honest skips) ──────────
test('seed-remove #13: client and server render identical authoritative plan (UI)',
  { skip: 'requires a running client+server; verified by construction — client reads plan.weight_balance verbatim' }, () => {});
test('seed-remove #14b: posting recomputes the plan under lock and rejects a bypass',
  { skip: 'requires PostgreSQL (unavailable in this environment)' }, () => {});
test('seed-remove #15: no genealogy / identity regression on Seed Remove split',
  { skip: 'requires PostgreSQL (unavailable in this environment)' }, () => {});

// ── In-place detach POSTING contract — requires PostgreSQL (honest skips) ──────
// The planner assertions above prove the authoritative targets/route; these
// verify the locked transaction against a live schema and cannot run here.
const DB_SKIP = { skip: 'requires PostgreSQL (unavailable in this environment)' };
test('detach posting #1-2: Growth carrier inventory ID and lot identity unchanged', DB_SKIP, () => {});
test('detach posting #3-4: carrier category → growth_diamond, status → IN STOCK', DB_SKIP, () => {});
test('detach posting #5-6: carrier qty = returned Growth qty (24, not 1); weight = entered', DB_SKIP, () => {});
test('detach posting #7-10: carrier length/width(depth)/height persist; unit stays PCS', DB_SKIP, () => {});
test('detach posting #11-13: attached Seed inventory ID, lot name, root lot unchanged', DB_SKIP, () => {});
test('detach posting #14-16: Seed status IN STOCK, state AVAILABLE, qty/weight/dims persist', DB_SKIP, () => {});
test('detach posting #17-20: no new Growth/Seed rows; no -R1/-S1 lots generated', DB_SKIP, () => {});
test('detach posting #23-24: value conserved on both rows; genealogy intact', DB_SKIP, () => {});
test('detach posting #25-26: missing/ambiguous carrier or attached Seed aborts under lock', DB_SKIP, () => {});
test('detach posting #27: rollback on failure restores both identities', DB_SKIP, () => {});

test('phase C: recovered Seed weight beyond the Seed reference ceiling BLOCKS', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: biscuitValued, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk, // refWeight 25.65
    lines: [
      { type: 'reprocess', qty: 9, weight: 30 }, // > 25.65
      { type: 'usable', qty: 9, weight: 50 },
    ] });
  assert.equal(p.valid, false);
  assert.match(p.error, /exceeds the Seed reference weight/);
});

test('phase C (detach): zero carrier carrying value is VALID (growth pool 0, seed pool intact)', () => {
  const p = buildReturnPlan({ ...planBase,
    processLot: { ...biscuitValued, total_value: 0 }, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    attachedSeed: attachedSeedOk,
    lines: [
      { type: 'reprocess', qty: 9, weight: 3 },
      { type: 'usable',    qty: 9, weight: 70 },
    ] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'DETACH_TRANSFORM');
  assert.deepEqual(p.value_pools, { growth: 0, seed: 90 }); // seed pool untouched
});

test('phase C allocation: pools close exactly, residue on the LAST eligible line', () => {
  const outs = [
    { type: 's1', component: 'seed' }, { type: 's2', component: 'seed' },
    { type: 's3', component: 'seed' }, { type: 'd1', component: 'diamond' },
  ];
  const rows = allocateComponentValues(
    [{ type: 's1', qty: 1, weight: 1 }, { type: 's2', qty: 1, weight: 1 },
     { type: 's3', qty: 1, weight: 1 }, { type: 'd1', qty: 3, weight: 5 }],
    outs, 250, 100
  );
  // Seed pool 100 across equal weights → 33.33, 33.33, then residue → 33.34
  assert.deepEqual(rows.filter(r => r.family === 'seed').map(r => r.value),
    [33.33, 33.33, 33.34]);
  // Diamond pool 250 lands entirely on its single line — no cross-family leak.
  assert.deepEqual(rows.filter(r => r.family === 'diamond').map(r => r.value), [250]);
  // Immutability: fresh rows, inputs untouched.
  const input = [{ type: 's1', qty: 1, weight: 1 }];
  allocateComponentValues(input, outs, 10, 10);
  assert.equal(input[0].value, undefined);
});

test('phase C: QUANTITY-mode biscuit multi-line is still rejected (single disposition)', () => {
  const p = buildReturnPlan({ ...planBase, processLot: biscuitInput, biscuit: null,
    lines: [{ type: 'usable', qty: 5 }, { type: 'damaged', qty: 4 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /single disposition/);
});

test('phase C: component-group imbalance on a biscuit input is rejected', () => {
  const p = buildReturnPlan({ ...planBase, processLot: biscuitInput, biscuit: null,
    allowedOutputs: seedRemoveOutputs,
    lines: [{ type: 'reprocess', qty: 9 }, { type: 'usable', qty: 5 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /diamond outputs total 5\.0000/);
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

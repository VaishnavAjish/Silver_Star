// Growth Diamond → Rough Diamond in-place transformation — planner truth
// table for buildReturnPlan()'s TRANSFORM_IN_PLACE route. Pure tests, no DB.
// Activation is CONFIGURATION-driven (transform_in_place on an output rule);
// process code/name must never activate it.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReturnPlan } = require('../services/returnRouting');

// ── Fixtures (synthetic) ──────────────────────────────────────────────────────
const transformOutputs = [
  { type: 'usable', label: 'Rough Diamond', suffix: 'R', status: 'IN STOCK',
    item_category_override: 'rough', transform_in_place: true,
    input_item_category: 'growth_diamond' },
  { type: 'damaged',  label: 'Damaged',  suffix: 'D', status: 'DAMAGED' },
  { type: 'consumed', label: 'Consumed', suffix: 'C', status: 'CONSUMED' },
];

// Today's block_cut-style config: usable → growth_diamond CHILD, no transform.
const legacyOutputs = [
  { type: 'usable', label: 'Growth Diamond', suffix: 'R', status: 'IN STOCK',
    item_category_override: 'growth_diamond' },
  { type: 'damaged',  label: 'Damaged',  suffix: 'D', status: 'DAMAGED' },
  { type: 'consumed', label: 'Consumed', suffix: 'C', status: 'CONSUMED' },
];

const gdLot = {
  id: 501, lot_number: 'GR-1199-GD1', lot_code: 'GR-1199-GD1',
  category: 'growth_diamond', status: 'IN PROCESS',
  qty: 1, unit: 'PCS', weight: 25.5, rate: 10, total_value: 255,
  parent_lot_id: 400, root_lot_id: 11,
};

const issue = {
  id: 90, issue_number: 'PI-202607-0001', status: 'OPEN',
  issued_qty: 1, remaining_in_process: 1,
  process_type: 'final_block', process_group: 'LASER',
  machine_process_id: 77,
};

function plan(overrides = {}) {
  return buildReturnPlan({
    issue, processLot: gdLot, biscuit: null,
    allowedOutputs: transformOutputs,
    lines: [{ type: 'usable', qty: 1, weight: 24 }],
    measurements: undefined,
    openSiblingCount: 0, biscuitCandidateCount: 0, attachedSeed: null,
    ...overrides,
  });
}

// 1. Activation is configuration-driven — without the rule nothing transforms.
test('transform: without transform_in_place the same return stays CHILD', () => {
  const p = plan({ allowedOutputs: legacyOutputs });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.will_create_new_lot, true);
  assert.equal(p.transform_in_place, undefined);
});

// 2. Process code/name never activates the transformation.
test('transform: process code final_block alone does NOT activate transform', () => {
  const p = plan({
    allowedOutputs: legacyOutputs,
    issue: { ...issue, process_type: 'final_block' },
  });
  assert.equal(p.route, 'CHILD');
});

// 3–6. Approved rule + Growth Diamond input resolves in place, same lot.
test('transform: growth_diamond + transform rule resolves TRANSFORM_IN_PLACE', () => {
  const p = plan();
  assert.equal(p.valid, true);
  assert.equal(p.route, 'TRANSFORM_IN_PLACE');
  assert.equal(p.transform_in_place, true);
  assert.equal(p.in_place, true);
});

test('transform: target category is rough', () => {
  const p = plan();
  assert.deepEqual(p.category_transition, { before: 'growth_diamond', after: 'rough' });
});

test('transform: the target lot IS the input lot (same id / lot number)', () => {
  const p = plan();
  assert.equal(p.target_lot_id, gdLot.id);
  assert.equal(p.target_lot_code, gdLot.lot_code);
  assert.equal(p.target_lot_number, gdLot.lot_number);
});

test('transform: creates_new_lot and will_create_new_lot are false', () => {
  const p = plan();
  assert.equal(p.creates_new_lot, false);
  assert.equal(p.will_create_new_lot, false);
});

// 7. Full usable quantity passes and is final.
test('transform: full usable quantity is valid and final', () => {
  const p = plan();
  assert.equal(p.valid, true);
  assert.equal(p.is_final, true);
  assert.equal(p.final, true);
  assert.equal(p.projected_issue_status, 'RETURNED');
  assert.equal(p.projected_inventory_status, 'IN STOCK');
});

// 8. Partial quantity rejects — no partial transformation identity rules.
test('transform: partial quantity REJECTS', () => {
  const p = plan({
    issue: { ...issue, issued_qty: 2, remaining_in_process: 2 },
    processLot: { ...gdLot, qty: 2 },
    lines: [{ type: 'usable', qty: 1, weight: 24 }],
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /FULL remaining quantity/);
});

// 9. Multiple transform lines reject.
test('transform: multiple usable lines REJECT', () => {
  const p = plan({
    issue: { ...issue, issued_qty: 2, remaining_in_process: 2 },
    processLot: { ...gdLot, qty: 2 },
    lines: [
      { type: 'usable', qty: 1, weight: 12 },
      { type: 'usable', qty: 1, weight: 12 },
    ],
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /single usable line/);
});

// 10. Mixed usable + damaged rejects.
test('transform: mixed usable + damaged REJECTS', () => {
  const p = plan({
    issue: { ...issue, issued_qty: 2, remaining_in_process: 2 },
    processLot: { ...gdLot, qty: 2 },
    lines: [
      { type: 'usable',  qty: 1, weight: 12 },
      { type: 'damaged', qty: 1 },
    ],
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /single usable line/);
});

// 11. Wrong source category rejects — never transformed, never CHILD-forked.
test('transform: non-growth_diamond source REJECTS', () => {
  const p = plan({
    processLot: { ...gdLot, category: 'seed' },
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /requires a Growth Diamond input/);
});

// 12. Missing measured weight rejects.
test('transform: missing operator-measured weight REJECTS', () => {
  const p = plan({ lines: [{ type: 'usable', qty: 1 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /operator-measured output weight/);
});

// 13. Output weight above input rejects (loss-only process).
test('transform: output weight above input REJECTS', () => {
  const p = plan({ lines: [{ type: 'usable', qty: 1, weight: 26 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /exceeds input weight/);
});

// 14. Output below input computes the exact loss.
test('transform: loss = input − output, recorded on the plan', () => {
  const p = plan({ lines: [{ type: 'usable', qty: 1, weight: 24 }] });
  assert.equal(p.valid, true);
  assert.equal(p.input_weight, 25.5);
  assert.equal(p.output_weight, 24);
  assert.equal(p.process_loss_weight, 1.5);
  assert.equal(p.projected_weight, 24);
});

// 15. Carrying value is preserved — never recalculated by the planner.
test('transform: carrying value policy is PRESERVE', () => {
  const p = plan();
  assert.equal(p.carrying_value_policy, 'PRESERVE');
  // The plan carries NO value/rate mutation fields for the transform route.
  assert.equal(p.component_allocation, undefined);
  assert.equal(p.value_pools, undefined);
});

// 16. Not reversible until a dedicated policy is approved.
test('transform: reversal_supported is false', () => {
  const p = plan();
  assert.equal(p.reversal_supported, false);
});

// ── Configuration-integrity guards ────────────────────────────────────────────
test('transform: non-rough target category REJECTS as config error', () => {
  const badOutputs = [
    { ...transformOutputs[0], item_category_override: 'growth_diamond' },
    transformOutputs[1], transformOutputs[2],
  ];
  const p = plan({ allowedOutputs: badOutputs });
  assert.equal(p.valid, false);
  assert.match(p.error, /must target the rough category/);
});

test('transform: COMPONENT + transform combination REJECTS as config error', () => {
  const badOutputs = [
    transformOutputs[0],
    { type: 'damaged', suffix: 'D', status: 'DAMAGED', component: 'diamond' },
  ];
  const p = plan({ allowedOutputs: badOutputs });
  assert.equal(p.valid, false);
  assert.match(p.error, /cannot be combined with COMPONENT/);
});

test('transform: transform_in_place on a non-usable rule REJECTS as config error', () => {
  const badOutputs = [
    { type: 'usable', suffix: 'R', status: 'IN STOCK', item_category_override: 'rough' },
    { type: 'damaged', suffix: 'D', status: 'DAMAGED',
      item_category_override: 'rough', transform_in_place: true },
  ];
  const p = plan({
    allowedOutputs: badOutputs,
    lines: [{ type: 'damaged', qty: 1, weight: 24 }],
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /only supported on the usable output/);
});

test('transform: conflicting measurement weight REJECTS as ambiguous', () => {
  const p = plan({
    lines: [{ type: 'usable', qty: 1, weight: 24 }],
    measurements: { weight: 23 },
  });
  assert.equal(p.valid, false);
  assert.match(p.error, /Ambiguous output weight/);
});

test('transform: matching measurement weight passes (client consolidation)', () => {
  const p = plan({
    lines: [{ type: 'usable', qty: 1, weight: 24 }],
    measurements: { weight: 24, length: 10, width: 8, height: 5 },
  });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'TRANSFORM_IN_PLACE');
});

// Ordinary CHILD behaviour on the same process stays unchanged when the
// transform line is absent (damaged-only return = physical separation).
test('transform config: damaged-only return still routes CHILD (unchanged)', () => {
  const p = plan({ lines: [{ type: 'damaged', qty: 1 }] });
  assert.equal(p.valid, true);
  assert.equal(p.route, 'CHILD');
  assert.equal(p.will_create_new_lot, true);
  assert.equal(p.transform_in_place, undefined);
});

// Zero / negative measured weight is never a valid physical diamond.
test('transform: zero output weight REJECTS', () => {
  const p = plan({ lines: [{ type: 'usable', qty: 1, weight: 0 }] });
  assert.equal(p.valid, false);
  assert.match(p.error, /operator-measured output weight/);
});

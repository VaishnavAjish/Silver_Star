// Phase 1 growth-identity routing — truth table for resolveGrowthReturnRoute()
// (pure function, no DB). Covers self-audit test cases 1–6.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveGrowthReturnRoute } = require('../services/returnRouting');

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

// Seed Lifecycle Phase A — manufacturing-state helper truth table (pure, no DB).
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MANUFACTURING_STATES, effectiveManufacturingState, attachmentBlockReason,
} = require('../services/manufacturingState');

test('states catalogue matches the approved architecture', () => {
  assert.deepEqual(MANUFACTURING_STATES,
    ['AVAILABLE', 'ATTACHED_TO_GROWTH', 'RECOVERED', 'RETIRED']);
});

test('legacy NULL manufacturing_state reads as AVAILABLE', () => {
  assert.equal(effectiveManufacturingState({ manufacturing_state: null }), 'AVAILABLE');
  assert.equal(effectiveManufacturingState({}), 'AVAILABLE');          // pre-phase62 rows
  assert.equal(effectiveManufacturingState(null), 'AVAILABLE');
});

test('explicit states pass through', () => {
  assert.equal(effectiveManufacturingState({ manufacturing_state: 'ATTACHED_TO_GROWTH' }),
    'ATTACHED_TO_GROWTH');
  assert.equal(effectiveManufacturingState({ manufacturing_state: 'RECOVERED' }), 'RECOVERED');
});

test('attached lot is blocked with the action named', () => {
  const row = { lot_code: '1211-01', manufacturing_state: 'ATTACHED_TO_GROWTH' };
  const msg = attachmentBlockReason(row, 'transferred');
  assert.match(msg, /1211-01/);
  assert.match(msg, /ATTACHED_TO_GROWTH/);
  assert.match(msg, /cannot be transferred until Seed Remove/);
});

test('AVAILABLE / NULL / RECOVERED lots are never blocked', () => {
  assert.equal(attachmentBlockReason({ lot_code: '1211' }, 'split'), null);
  assert.equal(attachmentBlockReason({ lot_code: '1211', manufacturing_state: null }, 'mixed'), null);
  assert.equal(attachmentBlockReason({ lot_code: '1211-S1', manufacturing_state: 'RECOVERED' }, 'issued'), null);
});

test('message falls back to lot_number then id', () => {
  assert.match(attachmentBlockReason({ lot_number: 'SSD-01', manufacturing_state: 'ATTACHED_TO_GROWTH' }), /SSD-01/);
  assert.match(attachmentBlockReason({ id: 42, manufacturing_state: 'ATTACHED_TO_GROWTH' }), /#42/);
});

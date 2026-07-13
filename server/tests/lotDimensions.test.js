'use strict';

/**
 * Mix dimension merge rules. Run with:  node --test tests/lotDimensions.test.js
 *
 * Guards the bug where the Mix child INSERT omitted dim_* entirely, so every
 * mixed lot was created with blank dimensions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMixDimensions, mixDimensionError } = require('../services/lotDimensions');

/** node-pg returns NUMERIC(10,3) as a string — the fixtures mirror that. */
const lot = (lot_number, dim_length, dim_depth, dim_height, dim_unit = 'mm') =>
  ({ lot_number, dim_length, dim_depth, dim_height, dim_unit });

test('parents with identical dimensions → child inherits them', () => {
  const result = resolveMixDimensions([
    lot('1166', '12.000', '12.000', '0.300'),
    lot('1174', '12.000', '12.000', '0.300'),
  ]);

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dims, {
    dim_length: 12,
    dim_depth: 12,
    dim_height: 0.3,
    dim_unit: 'mm',
  });
});

test('string/number precision differences are not a conflict', () => {
  // '12.000', '12.00' and 12 are the same size; raw === would disagree.
  const result = resolveMixDimensions([
    lot('A', '12.000', '12.00', '0.300'),
    lot('B', 12, '12.0', 0.3),
  ]);

  assert.equal(result.conflict, false);
  assert.equal(result.dims.dim_length, 12);
  assert.equal(result.dims.dim_height, 0.3);
});

test('parents with conflicting dimensions → conflict, naming both lots', () => {
  const result = resolveMixDimensions([
    lot('1166', '12.000', '12.000', '0.300'),
    lot('1174', '10.000', '10.000', '0.300'),
  ]);

  assert.equal(result.conflict, true);
  assert.deepEqual(result.conflictFields, ['dim_length', 'dim_depth']);
  assert.equal(result.conflictingLots.length, 2);

  const message = mixDimensionError(result);
  assert.match(message, /1166/);
  assert.match(message, /1174/);
  assert.match(message, /12 × 12 × 0\.3 mm/);
});

test('conflicting units → conflict', () => {
  const result = resolveMixDimensions([
    lot('A', '12.000', '12.000', '0.300', 'mm'),
    lot('B', '12.000', '12.000', '0.300', 'cm'),
  ]);

  assert.equal(result.conflict, true);
  assert.ok(result.conflictFields.includes('dim_unit'));
});

test('NULL means "not yet measured": it neither blocks the mix nor overwrites', () => {
  // Legacy/unmeasured lots must stay mixable, or the bug's own output is frozen.
  const result = resolveMixDimensions([
    lot('measured', '12.000', '12.000', '0.300'),
    lot('legacy', null, null, null, null),
  ]);

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dims, {
    dim_length: 12,
    dim_depth: 12,
    dim_height: 0.3,
    dim_unit: 'mm',
  });
});

test('all parents unmeasured → no dimensions, still allowed', () => {
  const result = resolveMixDimensions([
    lot('A', null, null, null, null),
    lot('B', null, null, null, null),
  ]);

  assert.equal(result.conflict, false);
  assert.deepEqual(result.dims, {
    dim_length: null,
    dim_depth: null,
    dim_height: null,
    dim_unit: null,
  });
});

test('a single measured axis is inherited even when the others are unknown', () => {
  const result = resolveMixDimensions([
    lot('A', null, null, '0.300'),
    lot('B', null, null, '0.300'),
  ]);

  assert.equal(result.conflict, false);
  assert.equal(result.dims.dim_height, 0.3);
  assert.equal(result.dims.dim_length, null);
});

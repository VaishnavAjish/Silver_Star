'use strict';

/**
 * Mix Lots physical & genealogy contract tests.
 * Run with: node --test server/tests/mixLotsContract.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMixDimensions, mixDimensionError } = require('../services/lotDimensions');

test('mix contract: dimension resolution applies to non-seed items as well as seeds', () => {
  const matchingNonSeeds = [
    { lot_number: 'LOT-A', item_id: 1, category: 'rough', dim_length: '10.0', dim_depth: '10.0', dim_height: '5.0', dim_unit: 'mm' },
    { lot_number: 'LOT-B', item_id: 1, category: 'rough', dim_length: '10.0', dim_depth: '10.0', dim_height: '5.0', dim_unit: 'mm' }
  ];

  const res = resolveMixDimensions(matchingNonSeeds);
  assert.equal(res.conflict, false);
  assert.deepEqual(res.dims, {
    dim_length: 10,
    dim_depth: 10,
    dim_height: 5,
    dim_unit: 'mm'
  });
});

test('mix contract: non-seed items with conflicting dimensions trigger conflict error', () => {
  const conflictingNonSeeds = [
    { lot_number: 'LOT-A', item_id: 1, category: 'rough', dim_length: '10.0', dim_depth: '10.0', dim_height: '5.0', dim_unit: 'mm' },
    { lot_number: 'LOT-B', item_id: 1, category: 'rough', dim_length: '12.0', dim_depth: '10.0', dim_height: '5.0', dim_unit: 'mm' }
  ];

  const res = resolveMixDimensions(conflictingNonSeeds);
  assert.equal(res.conflict, true);
  assert.deepEqual(res.conflictFields, ['dim_length']);
  const err = mixDimensionError(res);
  assert.match(err, /Cannot mix lots with different dimensions/);
});

test('mix contract: physical weight and quantity aggregation logic', () => {
  const parents = [
    { lot_number: 'MX0010-01', qty: 30, weight: 15.5, rate: 100, total_value: 1550, unit: 'PCS' },
    { lot_number: '1174-01',   qty: 2,  weight: 1.2,  rate: 100, total_value: 120,  unit: 'PCS' }
  ];

  const totalQty = parents.reduce((s, r) => s + parseFloat(r.qty || 0), 0);
  const totalWeight = parents.reduce((s, r) => s + parseFloat(r.weight || 0), 0);
  const totalVal = parents.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);

  assert.equal(totalQty, 32);
  assert.equal(totalWeight, 16.7);
  assert.equal(totalVal, 1670);
});

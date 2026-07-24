/**
 * Unit tests for server/services/inventoryAuth.js
 *
 * Pure functions only — no DB, no HTTP. Tests:
 *   - FINANCIAL_FIELDS constant completeness
 *   - stripFinancial (single row, array, canViewFinancial=true bypass)
 *   - buildDeptScopeClause (ALL, NONE, SELECTED variants)
 *   - isLotInScope (ALL, NONE, SELECTED with/without unassigned)
 *
 * Run: node --test server/tests/inventoryAuth.test.js
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  FINANCIAL_FIELDS,
  stripFinancial,
  buildDeptScopeClause,
  isLotInScope,
} = require('../services/inventoryAuth');

// ── FINANCIAL_FIELDS constant ─────────────────────────────────────────────────

test('FINANCIAL_FIELDS — contains all 18 mandated keys', () => {
  const required = [
    'rate', 'unit_rate', 'purchase_rate', 'sale_rate', 'avg_rate',
    'cost', 'unit_cost', 'total_cost', 'total_value', 'inventory_value',
    'valuation', 'cogs', 'profit', 'margin', 'markup',
    'book_value', 'opening_value', 'closing_value',
  ];
  for (const key of required) {
    assert.ok(FINANCIAL_FIELDS.includes(key), `Missing key: ${key}`);
  }
  assert.equal(FINANCIAL_FIELDS.length, required.length,
    `FINANCIAL_FIELDS has ${FINANCIAL_FIELDS.length} keys, expected ${required.length}`);
});

// ── stripFinancial — single row ───────────────────────────────────────────────

test('stripFinancial — removes all financial keys from a row when canViewFinancial=false', () => {
  const row = {
    id: 42, lot_number: 'SSD001', qty: 5, weight: 2.5,
    rate: 10000, total_value: 50000, cost: 9000, unit_cost: 1800,
    total_cost: 45000, inventory_value: 50000, valuation: 50000,
    cogs: 1000, profit: 4000, margin: 8, markup: 9,
    book_value: 48000, opening_value: 0, closing_value: 50000,
    unit_rate: 10000, purchase_rate: 9500, sale_rate: 11000, avg_rate: 10000,
  };
  const result = stripFinancial(row, false);

  // Non-financial fields preserved
  assert.equal(result.id, 42);
  assert.equal(result.lot_number, 'SSD001');
  assert.equal(result.qty, 5);
  assert.equal(result.weight, 2.5);

  // All financial fields absent (not null — absent)
  for (const key of FINANCIAL_FIELDS) {
    assert.equal(key in result, false, `Key '${key}' should be absent, found: ${result[key]}`);
  }
});

test('stripFinancial — does NOT strip when canViewFinancial=true', () => {
  const row = { id: 1, lot_number: 'X', rate: 500, total_value: 1000 };
  const result = stripFinancial(row, true);
  assert.equal(result.rate, 500);
  assert.equal(result.total_value, 1000);
});

test('stripFinancial — does NOT mutate the original row', () => {
  const row = { id: 1, rate: 999, total_value: 5000 };
  stripFinancial(row, false);
  assert.equal(row.rate, 999, 'Original row.rate was mutated');
  assert.equal(row.total_value, 5000, 'Original row.total_value was mutated');
});

// ── stripFinancial — array ────────────────────────────────────────────────────

test('stripFinancial — strips all rows in an array', () => {
  const rows = [
    { id: 1, lot_number: 'A', rate: 100, total_value: 200 },
    { id: 2, lot_number: 'B', rate: 300, total_value: 600 },
  ];
  const result = stripFinancial(rows, false);
  assert.equal(result.length, 2);
  assert.equal('rate' in result[0], false);
  assert.equal('rate' in result[1], false);
  assert.equal(result[0].lot_number, 'A');
  assert.equal(result[1].lot_number, 'B');
});

test('stripFinancial — handles empty array', () => {
  const result = stripFinancial([], false);
  assert.deepEqual(result, []);
});

test('stripFinancial — handles null/undefined gracefully', () => {
  assert.equal(stripFinancial(null, false), null);
  assert.equal(stripFinancial(undefined, false), undefined);
});

// ── buildDeptScopeClause — ALL ────────────────────────────────────────────────

test('buildDeptScopeClause — ALL mode returns empty clause', () => {
  const ctx = { scopeMode: 'ALL', allowedDeptIds: [], includeUnassigned: false };
  const { clause, params } = buildDeptScopeClause(ctx, ['existing']);
  assert.equal(clause, '');
  assert.deepEqual(params, ['existing']); // unchanged
});

// ── buildDeptScopeClause — NONE ───────────────────────────────────────────────

test('buildDeptScopeClause — NONE mode returns AND 1=0', () => {
  const ctx = { scopeMode: 'NONE', allowedDeptIds: [], includeUnassigned: false };
  const { clause, params } = buildDeptScopeClause(ctx, []);
  assert.equal(clause, ' AND 1=0');
  assert.deepEqual(params, []);
});

// ── buildDeptScopeClause — SELECTED ──────────────────────────────────────────

test('buildDeptScopeClause — SELECTED with dept IDs generates ANY clause', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [3, 7], includeUnassigned: false };
  const { clause, params } = buildDeptScopeClause(ctx, ['p1']);
  assert.equal(params.length, 2);
  assert.deepEqual(params[1], [3, 7]);
  assert.match(clause, /AND \(inv\.department_id = ANY\(\$2::int\[\]\)\)/);
  assert.equal(clause.includes('OR inv.department_id IS NULL'), false);
});

test('buildDeptScopeClause — SELECTED + include_unassigned adds IS NULL clause', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [5], includeUnassigned: true };
  const { clause } = buildDeptScopeClause(ctx, []);
  assert.ok(clause.includes('OR inv.department_id IS NULL'),
    'Expected IS NULL clause for include_unassigned');
});

test('buildDeptScopeClause — SELECTED with empty dept IDs returns AND 1=0', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [], includeUnassigned: false };
  const { clause } = buildDeptScopeClause(ctx, []);
  assert.equal(clause, ' AND 1=0');
});

// ── isLotInScope ──────────────────────────────────────────────────────────────

test('isLotInScope — ALL mode always returns true', () => {
  const ctx = { scopeMode: 'ALL', allowedDeptIds: [], includeUnassigned: false };
  assert.equal(isLotInScope(ctx, { department_id: 3 }), true);
  assert.equal(isLotInScope(ctx, { department_id: null }), true);
  assert.equal(isLotInScope(ctx, {}), true);
});

test('isLotInScope — NONE mode always returns false', () => {
  const ctx = { scopeMode: 'NONE', allowedDeptIds: [1, 2], includeUnassigned: true };
  assert.equal(isLotInScope(ctx, { department_id: 1 }), false);
  assert.equal(isLotInScope(ctx, { department_id: null }), false);
});

test('isLotInScope — SELECTED: matching dept returns true', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [3, 7], includeUnassigned: false };
  assert.equal(isLotInScope(ctx, { department_id: 3 }), true);
  assert.equal(isLotInScope(ctx, { department_id: 7 }), true);
});

test('isLotInScope — SELECTED: non-matching dept returns false', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [3], includeUnassigned: false };
  assert.equal(isLotInScope(ctx, { department_id: 9 }), false);
});

test('isLotInScope — SELECTED: null dept + includeUnassigned=true returns true', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [3], includeUnassigned: true };
  assert.equal(isLotInScope(ctx, { department_id: null }), true);
  assert.equal(isLotInScope(ctx, {}), true);
});

test('isLotInScope — SELECTED: null dept + includeUnassigned=false returns false', () => {
  const ctx = { scopeMode: 'SELECTED', allowedDeptIds: [3], includeUnassigned: false };
  assert.equal(isLotInScope(ctx, { department_id: null }), false);
});

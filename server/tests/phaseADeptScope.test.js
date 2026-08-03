/**
 * Phase A — canonical department scope unit tests.
 *
 * Covers the scope model itself, with the DB stubbed but the scope logic
 * fully live (nothing under test is mocked away):
 *   - loadDeptScope: super_admin / ALL / SELECTED / NONE / empty-SELECTED
 *   - ALL is NEVER narrowed to the user's primary department
 *   - a missing primary department NEVER widens access
 *   - buildMovementScopeClause: relational EXISTS, fails closed
 *   - isLotVisible round-trip through scopeToCtx
 *
 * Run: node --test server/tests/phaseADeptScope.test.js
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// ── Stub the pg pool BEFORE inventoryAuth is loaded ──────────────────────────
// Only the DB is stubbed. loadDeptScope / buildMovementScopeClause /
// isLotVisible all execute for real against these rows.
const poolPath = require.resolve('../db/pool');

let scopeRow  = null;   // row from user_inventory_scopes, or null
let deptRows  = [];     // rows from user_inventory_scope_depts

const fakePool = {
  query: async (sql) => {
    if (/FROM user_inventory_scopes/i.test(sql)) {
      return { rows: scopeRow ? [scopeRow] : [] };
    }
    if (/FROM user_inventory_scope_depts/i.test(sql)) {
      return { rows: deptRows };
    }
    // role_permissions / user_permission_overrides / user_permissions /
    // users lookups performed by the permission resolver
    return { rows: [] };
  },
};

require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: { ...fakePool, primaryPool: fakePool },
};

const {
  loadDeptScope,
  buildMovementScopeClause,
  isLotVisible,
  isSuperAdminRole,
  scopeToCtx,
} = require('../services/inventoryAuth');

function setScope(mode, depts = [], includeUnassigned = false) {
  scopeRow = mode ? { scope_mode: mode, include_unassigned: includeUnassigned } : null;
  deptRows = depts.map(d => ({ department_id: d }));
}

// ── isSuperAdminRole ─────────────────────────────────────────────────────────

test('isSuperAdminRole — only true super-admin spellings bypass', () => {
  for (const r of ['super_admin', 'SUPER_ADMIN', ' superadmin ', 'Super Admin']) {
    assert.equal(isSuperAdminRole(r), true, `expected bypass for "${r}"`);
  }
  for (const r of ['admin', 'administrator', 'operator', 'viewer', '', null, undefined]) {
    assert.equal(isSuperAdminRole(r), false, `expected NO bypass for "${r}"`);
  }
});

// ── loadDeptScope ────────────────────────────────────────────────────────────

test('loadDeptScope — super_admin is unrestricted without touching scope config', async () => {
  setScope('NONE');                       // deliberately restrictive config
  const scope = await loadDeptScope(6, 'super_admin');
  assert.equal(scope.isAll, true);
  assert.equal(scope.isNone, false);
  assert.equal(scope.canViewFinancial, true);
});

test('loadDeptScope — scope_mode ALL is unrestricted (NOT narrowed to primary dept)', async () => {
  setScope('ALL');
  const scope = await loadDeptScope(11, 'operator');
  assert.equal(scope.isAll, true);
  assert.equal(scope.isNone, false);
  assert.deepEqual(scope.allowedDeptIds, [],
    'ALL must not be reduced to a department list');
});

test('loadDeptScope — SELECTED restricts to the whitelisted departments only', async () => {
  setScope('SELECTED', [4]);
  const scope = await loadDeptScope(16, 'operator');
  assert.equal(scope.isAll, false);
  assert.equal(scope.isNone, false);
  assert.deepEqual(scope.allowedDeptIds, [4]);
});

test('loadDeptScope — NONE yields no data', async () => {
  setScope('NONE');
  const scope = await loadDeptScope(99, 'operator');
  assert.equal(scope.isNone, true);
  assert.equal(scope.isAll, false);
});

test('loadDeptScope — SELECTED with an empty department list fails closed', async () => {
  setScope('SELECTED', []);
  const scope = await loadDeptScope(99, 'operator');
  assert.equal(scope.isNone, true, 'empty SELECTED must not fall through to ALL');
  assert.equal(scope.isAll, false);
});

test('loadDeptScope — a missing primary department never widens access (TEST 11)', async () => {
  // users.department_id is irrelevant to the canonical model; the stub never
  // returns one, and a SELECTED user must stay restricted regardless.
  setScope('SELECTED', [4]);
  const scope = await loadDeptScope(16, 'operator');
  assert.deepEqual(scope.allowedDeptIds, [4]);
  assert.equal(scope.isAll, false,
    'no primary department must not promote the user to all-department access');
});

test('loadDeptScope — non-super-admin roles get no implicit bypass', async () => {
  setScope('SELECTED', [4]);
  for (const role of ['admin', 'administrator', 'manager', 'operator']) {
    const scope = await loadDeptScope(16, role);
    assert.equal(scope.isAll, false, `role "${role}" must not bypass SELECTED scope`);
    assert.deepEqual(scope.allowedDeptIds, [4]);
  }
});

// ── buildMovementScopeClause ─────────────────────────────────────────────────

test('buildMovementScopeClause — ALL adds no predicate', () => {
  const { clause, params } = buildMovementScopeClause(
    { isAll: true, isNone: false, allowedDeptIds: [] }, ['x']
  );
  assert.equal(clause, '');
  assert.deepEqual(params, ['x']);
});

test('buildMovementScopeClause — NONE fails closed', () => {
  const { clause } = buildMovementScopeClause(
    { isAll: false, isNone: true, allowedDeptIds: [] }, []
  );
  assert.equal(clause, ' AND 1=0');
});

test('buildMovementScopeClause — SELECTED checks parent AND child lots relationally', () => {
  const { clause, params } = buildMovementScopeClause(
    { isAll: false, isNone: false, allowedDeptIds: [4], includeUnassigned: false }, []
  );
  assert.match(clause, /lot_movement_parents/,  'must consider parent lots');
  assert.match(clause, /lot_movement_children/, 'must consider child lots');
  assert.match(clause, /sinv\.department_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(params, [[4]]);

  // Authorisation must be purely relational — never text or name based.
  assert.doesNotMatch(clause, /notes/i,        'must not authorise from movement notes');
  assert.doesNotMatch(clause, /created_by/i,   'must not authorise from creator');
  assert.doesNotMatch(clause, /full_name/i,    'must not authorise from user names');
  assert.doesNotMatch(clause, /'Admin'/,       'must not hardcode a department name');
  assert.doesNotMatch(clause, /department_id = 3\b/, 'must not hardcode department 3');
});

test('buildMovementScopeClause — include_unassigned admits NULL-department lots', () => {
  const { clause } = buildMovementScopeClause(
    { isAll: false, isNone: false, allowedDeptIds: [4], includeUnassigned: true }, []
  );
  assert.match(clause, /sinv\.department_id IS NULL/);
});

test('buildMovementScopeClause — appends its param after existing params', () => {
  const { clause, params } = buildMovementScopeClause(
    { isAll: false, isNone: false, allowedDeptIds: [2, 5] }, ['transfer', '2026-08-01']
  );
  assert.deepEqual(params, ['transfer', '2026-08-01', [2, 5]]);
  assert.match(clause, /\$3::int\[\]/, 'placeholder must follow the existing params');
});

// ── isLotVisible / scopeToCtx ────────────────────────────────────────────────

test('isLotVisible — SELECTED admits in-scope lots and rejects the rest', () => {
  const scope = { isAll: false, isNone: false, allowedDeptIds: [4], includeUnassigned: false };
  assert.equal(isLotVisible(scope, { department_id: 4 }), true);
  assert.equal(isLotVisible(scope, { department_id: 3 }), false, 'Admin lot must be hidden');
  assert.equal(isLotVisible(scope, { department_id: 5 }), false, 'Account lot must be hidden');
  assert.equal(isLotVisible(scope, { department_id: null }), false);
});

test('isLotVisible — NONE hides everything, ALL shows everything', () => {
  const none = { isAll: false, isNone: true, allowedDeptIds: [], includeUnassigned: false };
  const all  = { isAll: true,  isNone: false, allowedDeptIds: [], includeUnassigned: true };
  assert.equal(isLotVisible(none, { department_id: 4 }), false);
  assert.equal(isLotVisible(all,  { department_id: 3 }), true);
  assert.equal(isLotVisible(all,  { department_id: null }), true);
});

test('scopeToCtx — maps canonical scope onto the legacy ctx shape', () => {
  assert.equal(scopeToCtx({ isAll: true,  isNone: false }).scopeMode, 'ALL');
  assert.equal(scopeToCtx({ isAll: false, isNone: true  }).scopeMode, 'NONE');
  assert.equal(scopeToCtx({ isAll: false, isNone: false }).scopeMode, 'SELECTED');
});

/**
 * RBAC Brick 8 — the two compatibility switches.
 *
 * Brick 8 reconciled two long-standing inconsistencies by moving each behind one
 * implementation. The whole value of that depends on the default mode being
 * indistinguishable from the code it replaced, so these tests pin the old
 * behaviour literally: the pre-change role arrays are written out here and the
 * new policy must agree with them for every role, at every call site.
 *
 * If somebody later decides the canonical policy is correct, these tests do not
 * stop them — they make them say so by changing the flag, rather than by editing
 * a role list nobody is watching.
 *
 * Run: node --test --test-force-exit server/tests/brick8CompatibilityPolicies.test.js
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../security/rbac/inventoryScopePolicy');
const inventoryAuth = require('../services/inventoryAuth');
const config = require('../security/rbac/enforcementConfig');

/* The two arrays exactly as services/inventoryAuth.js held them before Brick 8.
   Written out, not imported, so this test still means something if the source
   arrays are changed. */
const PRE_BRICK8_WIDE_LIST = [
  'super_admin', 'superadmin', 'super admin', 'admin', 'administrator',
  'management', 'manager', 'owner', 'developer',
];
const PRE_BRICK8_NARROW_LIST = ['super_admin', 'superadmin', 'super admin'];

/** Every role string that appears anywhere in this codebase, plus a stranger. */
const ALL_ROLES = [
  'super_admin', 'superadmin', 'super admin', 'admin', 'administrator',
  'management', 'manager', 'owner', 'developer', 'operator', 'operator_restricted',
  'viewer', 'accountant', 'finance', '', null, undefined, 'Some-Unknown-Role',
];

const { CALL_SITES } = policy;

function norm(role) {
  return String(role || '').toLowerCase().trim();
}

/* ══ Inventory scope bypass ════════════════════════════════════════════════ */

test('compatibility is the default policy', () => {
  assert.equal(config.getInventoryScopePolicy({}), 'compatibility');
  assert.equal(
    config.getInventoryScopePolicy({ RBAC_INVENTORY_SCOPE_POLICY: 'nonsense' }),
    'compatibility',
    'an unreadable value must not silently narrow live visibility',
  );
});

test('compatibility: requireInventoryView keeps the exact nine-role wide list', () => {
  for (const role of ALL_ROLES) {
    const expected = PRE_BRICK8_WIDE_LIST.includes(norm(role));
    assert.equal(
      policy.bypassesDepartmentScope(role, {
        callSite: CALL_SITES.INVENTORY_VIEW,
        policy: 'compatibility',
      }),
      expected,
      `requireInventoryView changed its answer for role "${role}"`,
    );
  }
});

test('compatibility: loadDeptScope keeps the exact three-role narrow list', () => {
  for (const role of ALL_ROLES) {
    const expected = PRE_BRICK8_NARROW_LIST.includes(norm(role));
    assert.equal(
      policy.bypassesDepartmentScope(role, {
        callSite: CALL_SITES.DEPT_SCOPE,
        policy: 'compatibility',
      }),
      expected,
      `loadDeptScope changed its answer for role "${role}"`,
    );
  }
});

test('compatibility: the live inventoryAuth exports agree with the frozen lists', () => {
  // The refactor is only safe if the module actually consulted is unchanged.
  for (const role of ALL_ROLES) {
    assert.equal(
      inventoryAuth.isSuperAdminRole(role),
      PRE_BRICK8_NARROW_LIST.includes(norm(role)),
      `services/inventoryAuth.isSuperAdminRole changed for role "${role}"`,
    );
  }
  // FINANCIAL_BYPASS_ROLES is module-private in inventoryAuth (it was never
  // exported), so the live list is checked at its new home — the same array
  // inventoryAuth destructures.
  assert.deepEqual([...policy.LEGACY_WIDE_BYPASS_ROLES], PRE_BRICK8_WIDE_LIST);
});

test('the disagreement Brick 4 reported is reproduced, not quietly fixed', () => {
  // An `admin` is unrestricted on the Inventory page and scope-bound on Stock
  // Transfer. That is the defect; it is preserved until an owner decides.
  const opts = (callSite) => ({ callSite, policy: 'compatibility' });
  assert.equal(policy.bypassesDepartmentScope('admin', opts(CALL_SITES.INVENTORY_VIEW)), true);
  assert.equal(policy.bypassesDepartmentScope('admin', opts(CALL_SITES.DEPT_SCOPE)), false);
});

test('canonical: exactly one rule everywhere — Super Admin alone', () => {
  for (const role of ALL_ROLES) {
    const expected = PRE_BRICK8_NARROW_LIST.includes(norm(role));
    for (const callSite of Object.values(CALL_SITES)) {
      assert.equal(
        policy.bypassesDepartmentScope(role, { callSite, policy: 'canonical' }),
        expected,
        `canonical must not depend on the call site (role "${role}", site ${callSite})`,
      );
    }
  }
});

test('canonical narrows, never widens', () => {
  for (const role of ALL_ROLES) {
    for (const callSite of Object.values(CALL_SITES)) {
      const compat = policy.bypassesDepartmentScope(role, { callSite, policy: 'compatibility' });
      const canon = policy.bypassesDepartmentScope(role, { callSite, policy: 'canonical' });
      assert.ok(
        !(canon && !compat),
        `switching to canonical would GRANT bypass to "${role}" at ${callSite}`,
      );
    }
  }
});

test('canonical: the roles that would lose unrestricted visibility are named', () => {
  const losing = ALL_ROLES.filter(
    (r) =>
      policy.bypassesDepartmentScope(r, {
        callSite: CALL_SITES.INVENTORY_VIEW,
        policy: 'compatibility',
      }) &&
      !policy.bypassesDepartmentScope(r, {
        callSite: CALL_SITES.INVENTORY_VIEW,
        policy: 'canonical',
      }),
  );
  assert.deepEqual(losing, ['admin', 'administrator', 'management', 'manager', 'owner', 'developer']);
});

/* ══ operator_restricted default scope ═════════════════════════════════════ */

test('the unconfigured-user default is unchanged, and now has one owner', () => {
  assert.equal(policy.defaultScopeModeForRole('operator_restricted'), 'NONE');
  for (const role of ['operator', 'viewer', 'admin', 'super_admin', '', null]) {
    assert.equal(policy.defaultScopeModeForRole(role), 'ALL');
  }
});

test('the role whose stored-vs-shown state disagrees is identifiable', () => {
  // Brick 4: the Admin scope API reports ALL for an unconfigured user whatever
  // their role, while the backend gives operator_restricted NONE. One function
  // now answers for both, so the panel can stop showing the wrong thing.
  assert.equal(policy.hasDefaultScopeAmbiguity('operator_restricted'), true);
  assert.equal(policy.hasDefaultScopeAmbiguity('operator'), false);
});

test('the default is normalised, so casing cannot produce a third answer', () => {
  assert.equal(policy.defaultScopeModeForRole('OPERATOR_RESTRICTED'), 'NONE');
  assert.equal(policy.defaultScopeModeForRole('  operator_restricted  '), 'NONE');
});

/* ══ Legacy user_permissions fallback ══════════════════════════════════════ */

test('the legacy user_permissions fallback ships enabled', () => {
  assert.equal(
    config.isLegacyUserPermissionsFallbackEnabled({}),
    true,
    'the fallback must stay on until the table is verified empty in production',
  );
});

test('only an explicit false disables the fallback', () => {
  const enabled = (v) =>
    config.isLegacyUserPermissionsFallbackEnabled({ RBAC_LEGACY_USER_PERMISSIONS_FALLBACK: v });
  assert.equal(enabled('false'), false);
  assert.equal(enabled('FALSE'), false);
  assert.equal(enabled('true'), true);
  assert.equal(enabled(''), true);
  assert.equal(enabled('nonsense'), true, 'a typo must not deprecate a live code path');
});

test('both legacy readers consult the switch, so they cannot disagree', () => {
  // Proving the wiring, not the query. If only resolveEffectivePermission were
  // gated, a route decision and the /api/auth/me payload would disagree about
  // whether the legacy table counts.
  const source = require('node:fs').readFileSync(require.resolve('../utils/permissions'), 'utf8');
  assert.match(source, /isLegacyUserPermissionsFallbackEnabled/);
  const uses = source.match(/legacyFallbackEnabled\(\)/g) || [];
  assert.ok(uses.length >= 3, `expected the switch at both read sites, found ${uses.length} uses`);
});

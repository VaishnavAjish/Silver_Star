/**
 * RBAC Brick 8 — route coverage and catalog parity.
 *
 * The ten invariants the brick requires, in order:
 *   1  every registered Express route is classified
 *   2  every mutation route is classified
 *   3  every authenticate-only mutation carries a real justification
 *   4  every strict guard names a real catalog entry
 *   5  every strict action exists in PERM_BITS
 *   6  no duplicate route mapping
 *   7  no UNKNOWN classification exists at all
 *   8  public exemptions are documented
 *   9  authenticate-only and blocked exemptions are documented
 *  10  a manifest entry for a route that no longer exists fails this test
 *
 * Plus the parity checks that keep the manifest honest against Brick 1: no
 * DUPLICATE_LEGACY code may be enforced, reports may not acquire write actions,
 * and every capability with no seeded baseline row is reported rather than
 * silently shipped.
 *
 * Entirely database-independent: it reads the built router and two in-memory
 * modules.
 *
 * Run: node --test server/tests/brick8RouteCoverage.test.js
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../app');
const pool = require('../db/pool');
const { collectRouteKeys, keyOf } = require('../security/rbac/routeIntrospection');
const manifest = require('../security/rbac/routeEnforcementManifest');
const { STATUS, GUARD, ALL_STATUSES } = require('../security/rbac/manifest/defineRoute');
const { PERM_BITS } = require('../utils/permissions');
const catalog = require('../rbac/permissionCatalog');

const registered = collectRouteKeys(app);
const registeredKeys = [...new Set(registered.map((r) => keyOf(r.method, r.path)))];

/* Requiring app.js opens the database pools. Nothing here queries them, but an
   open pool keeps the event loop alive and the runner would hang after the last
   assertion. */
test.after(async () => {
  try {
    await pool.shutdown();
  } catch {
    /* the pool was never connected — nothing to close */
  }
});

/* ── 1 & 10. Every registered route is classified ──────────────────────────── */

test('1. every registered route has a manifest entry', () => {
  const missing = registeredKeys.filter((k) => !manifest.BY_KEY.has(k));
  assert.deepEqual(
    missing,
    [],
    'Routes reachable by a client but absent from the Brick 8 manifest. Add an entry in ' +
      'server/security/rbac/manifest/ — an unclassified route is an unreviewed authorization ' +
      'decision.',
  );
});

test('10. the manifest describes no route that is not registered', () => {
  const live = new Set(registeredKeys);
  const stale = manifest.ENTRIES.map((e) => e.key).filter((k) => !live.has(k));
  assert.deepEqual(
    stale,
    [],
    'Manifest entries for routes that no longer exist. A stale entry hides the fact that its ' +
      'endpoint was removed, and would silently absorb a future route of the same name.',
  );
});

test('1b. counts agree exactly', () => {
  assert.equal(manifest.ENTRIES.length, registeredKeys.length);
});

/* ── 2 & 3. Mutations ──────────────────────────────────────────────────────── */

test('2. every mutation route is classified', () => {
  const mutations = registered.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  const unclassified = mutations
    .map((r) => keyOf(r.method, r.path))
    .filter((k) => !manifest.BY_KEY.has(k));
  assert.deepEqual(unclassified, []);
});

test('3. no mutation relies on "the global authenticate is probably enough"', () => {
  for (const e of manifest.ENTRIES) {
    if (!e.mutation || e.status !== STATUS.INTENTIONALLY_AUTHENTICATED_ONLY) continue;
    assert.ok(
      e.reason.trim().length > 30,
      `${e.key}: an authenticate-only mutation needs a real justification, not a label.`,
    );
  }
});

/* ── 4 & 5. Catalog and PERM_BITS parity ───────────────────────────────────── */

test('4. every enforced entry names a real, non-duplicate catalog entry', () => {
  for (const e of manifest.ENTRIES) {
    if (e.status !== STATUS.EFFECTIVE_PERMISSION_ENFORCED) continue;

    const entry = catalog.getByDbKey(e.module, e.submodule);
    assert.ok(entry, `${e.key}: no catalog entry for ${e.module}/${e.submodule || "''"}`);
    assert.equal(entry.code, e.capability, `${e.key}: capability code drifted from the catalog`);
    assert.notEqual(
      entry.status,
      'DUPLICATE_LEGACY',
      `${e.key}: enforces the duplicate code ${entry.code}; use ${entry.canonical_code}`,
    );
    assert.ok(
      entry.supported_actions.includes(e.action),
      `${e.key}: ${entry.code} does not support "${e.action}"`,
    );
  }
});

test('5. every enforced action is a PERM_BITS key', () => {
  for (const e of manifest.ENTRIES) {
    if (e.status !== STATUS.EFFECTIVE_PERMISSION_ENFORCED) continue;
    assert.notEqual(
      PERM_BITS[e.action],
      undefined,
      `${e.key}: "${e.action}" is not a permission bit, so the check could never succeed`,
    );
  }
});

/* ── 6 & 7. Structural invariants ──────────────────────────────────────────── */

test('6. no duplicate route mapping', () => {
  const seen = new Set();
  for (const e of manifest.ENTRIES) {
    assert.ok(!seen.has(e.key), `duplicate manifest entry for ${e.key}`);
    seen.add(e.key);
  }
});

test('7. every classification is one of the six declared statuses', () => {
  for (const e of manifest.ENTRIES) {
    assert.ok(ALL_STATUSES.includes(e.status), `${e.key}: unknown status ${e.status}`);
  }
  // There is no UNKNOWN member to reach in the first place.
  assert.ok(!ALL_STATUSES.includes('UNKNOWN'));
});

/* ── 8 & 9. Documented exemptions ──────────────────────────────────────────── */

test('8. every public exemption is documented and carries no rollout group', () => {
  const publics = manifest.ENTRIES.filter((e) => e.status === STATUS.PUBLIC);
  assert.ok(publics.length > 0);
  for (const e of publics) {
    assert.ok(e.reason.length > 20, `${e.key}: PUBLIC needs a stated reason`);
    assert.equal(e.group, null, `${e.key}: a public route has no rollout group`);
    assert.equal(e.guard, GUARD.NONE);
  }
});

test('9. every authenticate-only, blocked and legacy-role exemption is documented', () => {
  const exempt = [
    STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    STATUS.SECURITY_BLOCKED,
    STATUS.LEGACY_ROLE_GUARD,
  ];
  for (const e of manifest.ENTRIES) {
    if (!exempt.includes(e.status)) continue;
    assert.ok(e.reason.length > 20, `${e.key}: ${e.status} needs a stated reason`);
    assert.equal(e.guard, GUARD.NONE, `${e.key}: ${e.status} must not install a capability guard`);
    assert.equal(e.capability, null, `${e.key}: ${e.status} must not carry a capability`);
  }
});

/* ── Reports may not acquire write actions ─────────────────────────────────── */

test('report routes enforce only view, export or print', () => {
  const allowed = new Set(['view', 'export', 'print']);
  for (const e of manifest.ENTRIES) {
    if (e.module !== 'reports') continue;
    assert.ok(
      allowed.has(e.action),
      `${e.key}: a report must not require "${e.action}" — reports are read surfaces`,
    );
  }
});

/* ── Blockers are reported, never silently shipped ─────────────────────────── */

test('every SECURITY_BLOCKED route is reported as a pre-strict blocker', () => {
  const blocked = manifest.ENTRIES.filter((e) => e.status === STATUS.SECURITY_BLOCKED);
  const reported = manifest.getPreStrictBlockers().security_blocked.map((b) => b.key);
  assert.deepEqual(blocked.map((e) => e.key).sort(), reported.sort());
  assert.ok(blocked.length > 0, 'this codebase does have unmappable endpoints; hiding them is worse');
});

test('capabilities with no seeded baseline row are reported before strict', () => {
  const missing = manifest.getMissingBaselineCapabilities();
  for (const m of missing) {
    const entry = catalog.getByCode(m.capability);
    assert.equal(entry.has_baseline_rows, false);
    assert.ok(m.routes.length > 0);
  }
  // Known at the time of writing. The assertion is that they are *reported*,
  // not that the list never grows.
  const codes = missing.map((m) => m.capability);
  for (const expected of ['inventory.history_reversal', 'inventory.inventory_correction']) {
    assert.ok(codes.includes(expected), `${expected} must be reported as a pre-strict blocker`);
  }
});

test('routes needing unmodelled authority are reported, not silently enforced', () => {
  const gaps = manifest.getPreStrictBlockers().authority_model_missing.map((g) => g.key);
  // Approving and rejecting a stock transfer both need "for which department",
  // which Brick 5 recorded as not modelled.
  assert.ok(gaps.includes('POST /api/stock-transfer/pending/:id/approve'));
  assert.ok(gaps.includes('POST /api/stock-transfer/pending/:id/reject'));
});

/**
 * RBAC Brick 1 — canonical permission catalog tests.
 *
 * Twenty invariants, in the order specified by the brick:
 *   1  unique canonical codes            11 no empty label on any entry
 *   2  unique group assignment           12 no entry in two business groups
 *   3  seeded role keys are mapped       13 no write path to role_permissions
 *   4  sidebar keys are mapped           14 no write path to overrides
 *   5  route + resolver keys are mapped  15 resolver snapshot byte-identical
 *   6  duplicate namespaces flagged      16 enforcement vocabulary is closed
 *   7  Finance/HR phantoms inactive      17 Seed Stock + Gas Stock catalogued
 *   8  empty submodules classified       18 Cost Centres gap reported
 *   9  actions are valid PERM_BITS       19 vis.* are STORED_NOT_ENFORCED
 *  10  unknown actions fail validation   20 endpoint is admin-protected
 *
 * Plus an optional live-database reconciliation that auto-skips when the
 * database is unreachable. Every database statement is READ ONLY.
 *
 * Run: node --test server/tests/permissionCatalog.test.js
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const test   = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

/* ── Stub the pool BEFORE anything pulls it in ──────────────────────────────
 * The resolver snapshot drives the REAL resolveEffectivePermission through a
 * scripted pool, so the algebra under test is production code, not a copy.
 */
const poolPath = require.resolve('../db/pool');
let scriptedRows = { roleMask: null, override: null, legacy: [] };

require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    query: async (sql) => {
      if (/BIT_OR\(rp\.permissions\)/.test(sql)) {
        return { rows: [{ mask: scriptedRows.roleMask }] };
      }
      if (/user_permission_overrides/.test(sql)) {
        return { rows: scriptedRows.override ? [scriptedRows.override] : [] };
      }
      if (/user_permissions/.test(sql)) return { rows: scriptedRows.legacy };
      if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: 'operator' }] };
      return { rows: [] };
    },
    primaryPool: {
      connect: async () => { throw new Error('tests must never open a write connection'); },
    },
  },
};

const catalog  = require('../rbac/permissionCatalog');
const sources  = require('../rbac/catalogSources');
const analysis = require('../rbac/catalogAnalysis');
const { defineEntry } = require('../rbac/catalogShared');
const { PERM_BITS, resolveEffectivePermission } = require('../utils/permissions');

const REPO_ROOT = path.join(__dirname, '..', '..');
const refs = sources.collectSourceRefs();
const mapping = analysis.analyzeMapping(refs);
const staticAnomalies = analysis.analyzeStatic(refs);

const describeRef = r => `${r.module}:${r.submodule} (${r.file}:${r.line})`;

/* ── 1. Unique canonical codes ─────────────────────────────────────────────── */
test('1: every canonical code is unique', () => {
  const seen = new Set();
  for (const entry of catalog.PERMISSIONS) {
    assert.ok(!seen.has(entry.code), `duplicate code ${entry.code}`);
    seen.add(entry.code);
  }
  assert.equal(seen.size, catalog.PERMISSIONS.length);
});

/* ── 2. Unique group assignment ────────────────────────────────────────────── */
test('2: every entry belongs to exactly one approved business group', () => {
  for (const entry of catalog.PERMISSIONS) {
    assert.ok(
      catalog.BUSINESS_GROUPS.includes(entry.business_group),
      `${entry.code} has unapproved group "${entry.business_group}"`
    );
  }
  const counted = catalog.getGroups().reduce((sum, g) => sum + g.permission_count, 0);
  assert.equal(counted, catalog.PERMISSIONS.length,
    'group counts must partition the catalog exactly once');
});

/* ── 3. Every seeded role_permissions key is mapped ────────────────────────── */
test('3: every MODULE_TREE key that seeds role_permissions maps to a catalog entry', () => {
  assert.ok(refs.serverModuleTree.length > 0, 'server MODULE_TREE could not be parsed');
  assert.ok(refs.clientModuleTree.length > 0, 'client MODULE_TREE could not be parsed');
  assert.deepEqual(mapping.unmapped_server_tree.map(describeRef), []);
  assert.deepEqual(mapping.unmapped_client_tree.map(describeRef), []);
});

/* ── 4. Every sidebar permission code is mapped ────────────────────────────── */
test('4: every sidebar permission code maps to a catalog entry', () => {
  assert.ok(refs.sidebar.length > 0, 'navigation registry could not be parsed');
  assert.deepEqual(mapping.unmapped_sidebar.map(describeRef), []);
});

/* ── 5. Route guards and resolver call sites are mapped ────────────────────── */
test('5: every route guard and resolver call site maps to a catalog entry', () => {
  assert.ok(refs.frontendRouteGuards.length > 0, 'no frontend route guards parsed');
  assert.ok(refs.backendGuards.length > 0, 'no backend guards parsed');
  assert.deepEqual(mapping.unmapped_route_guards.map(describeRef), []);
  assert.deepEqual(mapping.unmapped_backend_guards.map(describeRef), []);
});

/* ── 6. Duplicate namespaces are explicitly flagged ────────────────────────── */
test('6: duplicate namespace entries are flagged with a canonical owner', () => {
  const DUPLICATED = ['asset_categories', 'departments', 'expense_categories',
    'locations', 'machines', 'uom'];

  for (const key of DUPLICATED) {
    const legacy = catalog.getByCode(`manufacturing.${key}`);
    assert.ok(legacy, `manufacturing.${key} missing from catalog`);
    assert.equal(legacy.status, 'DUPLICATE_LEGACY');
    assert.equal(legacy.canonical_code, `master_data.${key}`);
    assert.ok(catalog.getByCode(legacy.canonical_code),
      `canonical owner ${legacy.canonical_code} must exist`);
  }

  for (const entry of catalog.PERMISSIONS) {
    if (entry.status !== 'DUPLICATE_LEGACY') continue;
    assert.ok(entry.canonical_code, `${entry.code} lacks canonical_code`);
    assert.notEqual(entry.canonical_code, entry.code);
  }
});

/* ── 7. Finance / HR phantoms are inactive ─────────────────────────────────── */
test('7: Finance and HR phantom permissions are PLANNED_INACTIVE', () => {
  const phantoms = ['finance.budgets', 'finance.cashflow', 'hr.employees', 'hr.attendance'];
  for (const code of phantoms) {
    const entry = catalog.getByCode(code);
    assert.ok(entry, `${code} missing from catalog`);
    assert.equal(entry.status, 'PLANNED_INACTIVE', `${code} must be PLANNED_INACTIVE`);
    for (const surface of catalog.ENFORCEMENT_SURFACES) {
      assert.equal(entry.enforcement[surface], 'NO_ACTIVE_FEATURE',
        `${code}.${surface} must report NO_ACTIVE_FEATURE`);
    }
  }
});

/* ── 8. Empty submodules carry an explicit classification ──────────────────── */
test('8: every submodule = \'\' entry is explicitly classified and labelled', () => {
  const moduleEntries = catalog.PERMISSIONS.filter(p => p.backend_submodule === '');
  assert.ok(moduleEntries.length > 0, 'expected module-level entries');

  for (const entry of moduleEntries) {
    assert.ok(entry.empty_submodule_meaning,
      `${entry.code} must state what its empty submodule means`);
    assert.ok(['MODULE_ACCESS', 'LEGACY_MODULE_BASELINE'].includes(entry.empty_submodule_meaning),
      `${entry.code} has undocumented meaning "${entry.empty_submodule_meaning}"`);
    assert.ok(['MODULE_ACCESS', 'CAPABILITY_FLAG'].includes(entry.control_type),
      `${entry.code} must use MODULE_ACCESS or CAPABILITY_FLAG`);
    assert.ok(entry.code.endsWith(`.${catalog.MODULE_ACCESS_SUBMODULE}`),
      `${entry.code} must use the __module__ display suffix`);
    // The DATABASE key is preserved verbatim — never renamed.
    assert.equal(entry.backend_submodule, '');
    assert.ok(String(entry.label || '').trim().length > 0, `${entry.code} has a blank label`);
  }
});

/* ── 9. Supported actions are real permission bits ─────────────────────────── */
test('9: every supported action is a valid PERM_BITS key with the right bit', () => {
  for (const entry of catalog.PERMISSIONS) {
    let expected = 0;
    for (const action of entry.supported_actions) {
      assert.notEqual(PERM_BITS[action], undefined,
        `${entry.code} declares unknown action "${action}"`);
      expected |= PERM_BITS[action];
    }
    assert.equal(entry.supported_bitmask, expected,
      `${entry.code} bitmask does not match its actions`);
    assert.equal(entry.supported_bitmask & ~4095, 0,
      `${entry.code} bitmask escapes ALL_PERMISSION_BITS`);
  }
});

/* ── 10. Unknown actions fail validation ───────────────────────────────────── */
test('10: defineEntry rejects unknown actions and undocumented vocabulary', () => {
  const base = {
    module: 'test', submodule: 'x', group: 'Inventory', label: 'T',
    description: 'd', status: 'ACTIVE', risk: 'LOW', control: 'ACTION_MATRIX',
  };
  assert.throws(() => defineEntry({ ...base, actions: ['teleport'] }), /unknown action/);
  assert.throws(() => defineEntry({ ...base, actions: [] }), /non-empty array/);
  assert.throws(() => defineEntry({ ...base, actions: ['view'], group: 'Nope' }), /business_group/);
  assert.throws(() => defineEntry({ ...base, actions: ['view'], status: 'MAYBE' }), /status/);
  assert.throws(() => defineEntry({ ...base, actions: ['view'], risk: 'SPICY' }), /risk_level/);
  assert.throws(
    () => defineEntry({ ...base, actions: ['view'], enforcement: { api_list: 'SORT_OF' } }),
    /enforcement\.api_list/
  );
  assert.throws(
    () => defineEntry({ ...base, actions: ['view'], enforcement: { made_up_surface: 'ENFORCED' } }),
    /unknown enforcement surface/
  );
  assert.throws(() => defineEntry({ ...base, submodule: '', actions: ['view'] }),
    /emptySubmoduleMeaning/);
  assert.throws(
    () => defineEntry({ ...base, actions: ['view'], status: 'DUPLICATE_LEGACY' }),
    /canonicalCode/
  );
});

/* ── 11. No empty labels ───────────────────────────────────────────────────── */
test('11: no catalog entry has an empty label or description', () => {
  for (const entry of catalog.PERMISSIONS) {
    assert.ok(String(entry.label || '').trim().length > 0, `${entry.code} has an empty label`);
    assert.ok(String(entry.description || '').trim().length > 0,
      `${entry.code} has an empty description`);
  }
  for (const restriction of catalog.VIEW_RESTRICTIONS) {
    assert.ok(String(restriction.label || '').trim().length > 0,
      `${restriction.code} has an empty label`);
  }
});

/* ── 12. One business group per code ───────────────────────────────────────── */
test('12: no code appears under two business groups', () => {
  const groupByCode = new Map();
  for (const entry of catalog.PERMISSIONS) {
    if (groupByCode.has(entry.code)) {
      assert.equal(groupByCode.get(entry.code), entry.business_group,
        `${entry.code} claims two groups`);
    }
    groupByCode.set(entry.code, entry.business_group);
  }
  assert.doesNotThrow(() => catalog.validateCatalog());
});

/* ── 13/14. Brick 1 introduces no write path ───────────────────────────────── */
const BRICK_FILES = [
  'server/rbac/catalogShared.js',
  'server/rbac/permissionCatalog.js',
  'server/rbac/catalogSources.js',
  'server/rbac/catalogAnalysis.js',
  'server/rbac/viewRestrictions.js',
  'server/rbac/catalog/general.js',
  'server/rbac/catalog/inventory.js',
  'server/rbac/catalog/manufacturing.js',
  'server/rbac/catalog/commerce.js',
  'server/rbac/catalog/accounting.js',
  'server/rbac/catalog/administration.js',
  'server/routes/adminPermissionCatalog.js',
];

const WRITE_SQL = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\b/i;

/**
 * Every SQL statement in this codebase is written as a backtick template
 * literal, so the table can be checked precisely: prose in single-quoted
 * notes ("…has no role_permissions row") is not SQL and is not scanned.
 */
function sqlLiteralsMentioning(source, tableName) {
  const out = [];
  const literalRe = /`([^`]*)`/g;
  let m;
  while ((m = literalRe.exec(source)) !== null) {
    if (m[1].includes(tableName)) out.push(m[1].trim());
  }
  return out;
}

function assertNoWrites(tableName) {
  for (const rel of BRICK_FILES) {
    const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(WRITE_SQL.test(source), false, `${rel} contains a write statement`);
    assert.equal(/primaryPool/.test(source), false,
      `${rel} reaches for the primary (write) pool`);
    // Referencing the table is fine; every statement touching it must read.
    for (const sql of sqlLiteralsMentioning(source, tableName)) {
      assert.match(sql, /^(SELECT|WITH)\b/i,
        `${rel} runs a non-SELECT statement against ${tableName}: ${sql.slice(0, 60)}`);
    }
  }
}

test('13: no Brick 1 file can modify role_permissions (masks unchanged by construction)', () => {
  assertNoWrites('role_permissions');
});

test('14: no Brick 1 file can modify user_permission_overrides', () => {
  assertNoWrites('user_permission_overrides');
});

/* ── 15. Resolver output snapshot ──────────────────────────────────────────── */
test('15: resolver output is byte-identical to the recorded snapshot', async () => {
  // (roleMask, allowMask, denyMask) → effective, produced by the REAL resolver.
  const MATRIX = [
    { role: null, allow: null, deny: null },
    { role: 103,  allow: 0,    deny: 0 },
    { role: 103,  allow: 8,    deny: 0 },
    { role: 103,  allow: 0,    deny: 4 },
    { role: 103,  allow: 8,    deny: 1 },
    { role: 2047, allow: 0,    deny: 0 },
    { role: 2033, allow: 0,    deny: 0 },
    { role: 4095, allow: 0,    deny: 2048 },
    { role: 0,    allow: 2048, deny: 0 },
    { role: 1,    allow: 4095, deny: 4095 },
  ];

  const actual = [];
  for (const row of MATRIX) {
    scriptedRows = {
      roleMask: row.role,
      override: row.allow === null && row.deny === null
        ? null
        : { allow_mask: row.allow, deny_mask: row.deny },
      legacy: [],
    };
    actual.push(await resolveEffectivePermission(1, 'inventory', 'stock_transfer', 'operator'));
  }

  // Frozen expectation of ((role | allow) & ~deny) & 4095.
  assert.equal(
    JSON.stringify(actual),
    JSON.stringify([0, 103, 111, 99, 110, 2047, 2033, 2047, 2048, 0])
  );

  // Super Admin bypass is unchanged and short-circuits before any query.
  scriptedRows = { roleMask: 0, override: { allow_mask: 0, deny_mask: 4095 }, legacy: [] };
  assert.equal(
    await resolveEffectivePermission(1, 'inventory', 'stock_transfer', 'super_admin'),
    4095
  );
});

/* ── 16. Enforcement vocabulary is closed ──────────────────────────────────── */
test('16: enforcement uses only documented surfaces and statuses', () => {
  for (const entry of catalog.PERMISSIONS) {
    const surfaces = Object.keys(entry.enforcement).sort();
    assert.deepEqual(surfaces, [...catalog.ENFORCEMENT_SURFACES].sort(),
      `${entry.code} does not classify every surface exactly once`);
    for (const [surface, status] of Object.entries(entry.enforcement)) {
      assert.ok(catalog.ENFORCEMENT_STATUSES.includes(status),
        `${entry.code}.${surface} has undocumented status "${status}"`);
    }
    // No aggregate "secured" flag may exist — it would hide partial gaps.
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'secured'), false);
  }
  for (const a of staticAnomalies) {
    assert.ok(analysis.ANOMALY_TYPES.includes(a.type), `undocumented anomaly type ${a.type}`);
    assert.ok(analysis.ANOMALY_SEVERITIES.includes(a.severity),
      `undocumented severity ${a.severity}`);
  }
});

/* ── 17. Seed Stock and Gas Stock ──────────────────────────────────────────── */
test('17: Seed Stock and Gas Stock are catalogued and their missing baseline is reported', () => {
  for (const code of ['inventory.seed_stock', 'inventory.gas_stock']) {
    const entry = catalog.getByCode(code);
    assert.ok(entry, `${code} missing from catalog`);
    assert.equal(entry.status, 'ACTIVE');
    assert.equal(entry.business_group, 'Inventory Management');
    assert.equal(entry.enforcement.navigation, 'ENFORCED');
    assert.equal(entry.enforcement.frontend_route, 'ENFORCED');
    assert.equal(entry.has_baseline_rows, false,
      `${code} has no seeded role_permissions row and must say so`);
    assert.ok(
      staticAnomalies.some(a => a.type === 'MISSING_BASELINE_ROW' && a.code === code),
      `${code} must raise MISSING_BASELINE_ROW`
    );
  }
});

/* ── 18. Cost Centres ──────────────────────────────────────────────────────── */
test('18: Cost Centres is catalogued and its missing backend permission row is reported', () => {
  const entry = catalog.getByCode('management.cost_centres');
  assert.ok(entry, 'management.cost_centres missing from catalog');
  assert.equal(entry.status, 'ACTIVE');
  assert.equal(entry.has_baseline_rows, false);
  assert.ok(
    staticAnomalies.some(a =>
      a.type === 'MISSING_BASELINE_ROW' && a.code === 'management.cost_centres'),
    'Cost Centres must raise MISSING_BASELINE_ROW'
  );
  // No other namespace holds a Cost Centres row either.
  for (const ns of ['master_data', 'manufacturing', 'inventory']) {
    assert.equal(catalog.getByCode(`${ns}.cost_centres`), null,
      `unexpected ${ns}.cost_centres entry`);
  }
});

/* ── 19. Unenforced vis.* settings ─────────────────────────────────────────── */
test('19: every vis.* setting is STORED_NOT_ENFORCED and carries the warning', () => {
  const visEntries = catalog.VIEW_RESTRICTIONS.filter(v => v.code.startsWith('vis.'));
  assert.equal(visEntries.length, 7, 'expected the seven User Drawer visibility flags');

  for (const entry of visEntries) {
    assert.equal(entry.status, 'STORED_NOT_ENFORCED', `${entry.code} must not claim enforcement`);
    assert.equal(entry.warning, catalog.UNENFORCED_WARNING);
    assert.equal(entry.setting_type, 'USER_PREFERENCE');
    assert.equal(entry.business_group, 'View Restrictions');
  }

  // The two genuinely enforced restrictions must name their enforcement sites.
  const enforced = catalog.VIEW_RESTRICTIONS.filter(v => v.status === 'ENFORCED');
  assert.deepEqual(
    enforced.map(v => v.code).sort(),
    ['inventory.inventory_financial', 'scope.inventory_department']
  );
  for (const entry of enforced) {
    assert.ok(entry.enforced_by.length > 0, `${entry.code} must cite its enforcement sites`);
    assert.equal(entry.warning, null);
  }
});

/* ── 20. Endpoint is admin-protected and read-only ─────────────────────────── */
test('20: the catalog endpoint is admin-protected and exposes no write verbs', async () => {
  const express = require('express');
  const request = require('supertest');
  const router = require('../routes/adminPermissionCatalog');

  const app = express();
  app.use('/api/admin/permission-catalog', router);

  const noToken = await request(app).get('/api/admin/permission-catalog');
  assert.equal(noToken.status, 401, 'unauthenticated callers must be rejected');

  const badToken = await request(app)
    .get('/api/admin/permission-catalog/diagnostics')
    .set('Authorization', 'Bearer not-a-real-token');
  assert.equal(badToken.status, 401, 'invalid tokens must be rejected');

  // Every registered handler is a GET, behind authenticate + authorize.
  const layers = router.stack.filter(l => l.route);
  assert.ok(layers.length >= 2, 'expected the catalog and diagnostics routes');
  for (const layer of layers) {
    assert.deepEqual(Object.keys(layer.route.methods), ['get'],
      `${layer.route.path} exposes a non-GET verb`);
    const names = layer.route.stack.map(s => s.handle.name);
    assert.ok(names.includes('authenticate'), `${layer.route.path} lacks authenticate`);
    assert.ok(layer.route.stack.length >= 3,
      `${layer.route.path} must run authenticate + authorize before its handler`);
  }
});

/* ── Live database reconciliation (auto-skips when unreachable) ────────────── */
test('live: every role_permissions row maps to a catalog entry', async (t) => {
  const { Client } = require('pg');
  const client = new Client({
    host:     process.env.DB_HOST || 'localhost',
    port:     Number(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'silverstar_grow',
    connectionTimeoutMillis: 4000,
  });

  try {
    await client.connect();
  } catch (err) {
    t.skip(`database unreachable (${err.code || err.message}) — static tests still cover the catalog`);
    return;
  }

  try {
    await client.query('SET default_transaction_read_only = on');
    const { rows } = await client.query(
      `SELECT r.slug AS role_slug, rp.module, rp.submodule, rp.permissions
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.is_active = TRUE`
    );

    const unmapped = rows.filter(r => !catalog.getByDbKey(r.module, r.submodule || ''));
    assert.deepEqual(
      [...new Set(unmapped.map(r => `${r.module}:${r.submodule}`))],
      [],
      'every live role_permissions row must map to a catalog entry'
    );

    for (const a of analysis.analyzeRoleBaselines(rows)) {
      assert.ok(analysis.ANOMALY_TYPES.includes(a.type), `undocumented anomaly ${a.type}`);
    }
  } finally {
    await client.end();
  }
});

'use strict';

/**
 * RBAC Brick 6 — copy-setup preview: no-write proof and preview/apply parity.
 *
 * NO DATABASE IS CONTACTED. Following server/tests/permissionCatalog.test.js,
 * `require.cache` is poisoned with a stub pool before the route loads, so the
 * REAL route handlers run against an in-memory store of invented rows. Nothing
 * here can touch a production user, by construction rather than by convention.
 *
 * WHAT THE PARITY TEST ACTUALLY PROVES
 *   1. drive GET  /users/9/copy-setup/preview  → the payload the client sees
 *   2. feed that payload to the CLIENT's own buildCopyPreview
 *   3. drive POST /users/9/copy-setup          → the real transaction runs
 *   4. read the resulting store and compare it to what the model predicted
 * Both sides are production code. The store's statement dispatcher throws on any
 * SQL it does not recognise, so a change to the copy transaction breaks this
 * test rather than silently drifting away from the preview.
 *
 * Run: node --test server/tests/copySetupPreview.test.js
 */

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const ACTOR = { id: 1, role: 'admin' };
const SOURCE_ID = 2;
const TARGET_ID = 9;

/* ── In-memory store ───────────────────────────────────────────────────────── */

const clone = rows => rows.map(r => ({ ...r }));

function freshStore() {
  return {
    users: [
      { id: SOURCE_ID, username: 'test.source', full_name: 'Test Source', role: 'operator', is_active: true, department_id: 3, department_name: 'Growing', auth_version: 1 },
      { id: TARGET_ID, username: 'test.target', full_name: 'Test Target', role: 'operator', is_active: true, department_id: 4, department_name: 'Polish 2', auth_version: 1 },
    ],
    /* RBAC Brick 7. The copy now invalidates the TARGET's sessions when it moves
       authority, so the stub needs somewhere for that revocation to land. One
       live row per user, so "the source is never signed out" is provable rather
       than vacuously true. `token_hash` is a literal placeholder — no real hash
       is involved and nothing reads it. */
    refresh_tokens: [
      { id: 41, user_id: SOURCE_ID, token_hash: 'stub-hash-source', used_at: null, revoked_at: null, revoked_reason: null },
      { id: 42, user_id: TARGET_ID, token_hash: 'stub-hash-target', used_at: null, revoked_at: null, revoked_reason: null },
    ],
    user_permission_overrides: [
      { user_id: SOURCE_ID, module: 'inventory', submodule: 'stock_transfer', allow_mask: 16, deny_mask: 0 },
      { user_id: SOURCE_ID, module: 'accounting', submodule: 'journal_entries', allow_mask: 0, deny_mask: 1 },
      { user_id: TARGET_ID, module: 'accounting', submodule: 'journal_entries', allow_mask: 1, deny_mask: 0 },
      { user_id: TARGET_ID, module: 'reports', submodule: 'stock', allow_mask: 2, deny_mask: 0 },
    ],
    user_permissions: [
      { user_id: SOURCE_ID, module: 'inventory', permission_key: 'legacy_view', allowed: true },
      { user_id: TARGET_ID, module: 'reports', permission_key: 'legacy_export', allowed: true },
    ],
    user_inventory_scopes: [
      { user_id: SOURCE_ID, scope_mode: 'SELECTED', include_unassigned: false },
      { user_id: TARGET_ID, scope_mode: 'ALL', include_unassigned: true },
    ],
    user_inventory_scope_depts: [
      { user_id: SOURCE_ID, department_id: 3 },
      { user_id: SOURCE_ID, department_id: 4 },
    ],
    user_preferences: [
      { user_id: SOURCE_ID, pref_key: 'theme', pref_value: 'dark' },
      { user_id: SOURCE_ID, pref_key: 'vis.show_cogs', pref_value: 'true' },
      { user_id: TARGET_ID, pref_key: 'theme', pref_value: 'light' },
      { user_id: TARGET_ID, pref_key: 'compact_mode', pref_value: 'true' },
      { user_id: TARGET_ID, pref_key: 'vis.show_margin', pref_value: 'false' },
    ],
    user_dashboard_widgets: [
      { user_id: SOURCE_ID, widget_key: 'stock_summary', position: 0, is_visible: true },
      { user_id: TARGET_ID, widget_key: 'stock_summary', position: 2, is_visible: false },
      { user_id: TARGET_ID, widget_key: 'cash_position', position: 1, is_visible: true },
    ],
    template_shares: [
      { user_id: SOURCE_ID, template_id: 11 },
      { user_id: TARGET_ID, template_id: 11 },
      { user_id: TARGET_ID, template_id: 20 },
    ],
    inventory_templates: [
      { id: 11, name: 'Growing view', created_by: 5, is_global: false },
      { id: 12, name: 'Source private view', created_by: SOURCE_ID, is_global: false },
      { id: 13, name: 'Source global view', created_by: SOURCE_ID, is_global: true },
      { id: 20, name: 'Target only view', created_by: TARGET_ID, is_global: false },
    ],
    departments: [
      { id: 3, name: 'Growing' },
      { id: 4, name: 'Polish 2' },
    ],
    permission_audit_logs: [],
  };
}

let store = freshStore();
/** Every statement the route issues, in order, with the pool it came from. */
let statements = [];
let writeConnections = 0;

const squash = sql => String(sql).replace(/\s+/g, ' ').trim();
const byUser = (table, id) => store[table].filter(r => Number(r.user_id) === Number(id));

/* ── The SELECTs the preview route issues ──────────────────────────────────── */

function runSelect(sql, params) {
  const s = squash(sql);

  if (/FROM users u LEFT JOIN departments d/.test(s)) {
    const ids = params[0].map(Number);
    return { rows: store.users.filter(u => ids.includes(u.id)).map(u => ({ ...u })) };
  }
  if (/SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides/.test(s)) {
    return {
      rows: byUser('user_permission_overrides', params[0]).map(
        ({ module, submodule, allow_mask, deny_mask }) => ({ module, submodule, allow_mask, deny_mask }),
      ),
    };
  }
  if (/SELECT module, permission_key, allowed FROM user_permissions/.test(s)) {
    return {
      rows: byUser('user_permissions', params[0]).map(
        ({ module, permission_key, allowed }) => ({ module, permission_key, allowed }),
      ),
    };
  }
  if (/SELECT scope_mode, include_unassigned FROM user_inventory_scopes/.test(s)) {
    return {
      rows: byUser('user_inventory_scopes', params[0]).map(
        ({ scope_mode, include_unassigned }) => ({ scope_mode, include_unassigned }),
      ),
    };
  }
  if (/FROM user_inventory_scope_depts uisd/.test(s)) {
    return {
      rows: byUser('user_inventory_scope_depts', params[0]).map(r => ({
        department_id: r.department_id,
        name: store.departments.find(d => d.id === r.department_id)?.name || null,
      })),
    };
  }
  if (/SELECT pref_key, pref_value FROM user_preferences/.test(s)) {
    return {
      rows: byUser('user_preferences', params[0]).map(
        ({ pref_key, pref_value }) => ({ pref_key, pref_value }),
      ),
    };
  }
  if (/SELECT widget_key, position, is_visible FROM user_dashboard_widgets/.test(s)) {
    return {
      rows: byUser('user_dashboard_widgets', params[0]).map(
        ({ widget_key, position, is_visible }) => ({ widget_key, position, is_visible }),
      ),
    };
  }
  if (/FROM template_shares ts/.test(s)) {
    return {
      rows: byUser('template_shares', params[0]).map(r => ({
        template_id: r.template_id,
        name: store.inventory_templates.find(t => t.id === r.template_id)?.name || null,
      })),
    };
  }
  if (/SELECT id AS template_id, name FROM inventory_templates/.test(s)) {
    return {
      rows: store.inventory_templates
        .filter(t => Number(t.created_by) === Number(params[0]) && t.is_global === false)
        .map(t => ({ template_id: t.id, name: t.name })),
    };
  }
  throw new Error(`unhandled SELECT: ${s.slice(0, 120)}`);
}

/* ── The statements the copy transaction issues ────────────────────────────── */

function copyRows(table, targetId, sourceId, project) {
  for (const row of byUser(table, sourceId)) {
    store[table].push({ user_id: Number(targetId), ...project(row) });
  }
}

function runWrite(sql, params) {
  const s = squash(sql);

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };

  /* ── RBAC Brick 7 statements ──────────────────────────────────────────────
     The copy transaction now takes a row lock on both users and re-reads their
     state on the TRANSACTION client, so this dispatcher — which the write pool
     routes everything through — has to serve reads too. */

  // The per-user serialisation lock the copy takes before it reads anything.
  if (/^SELECT id FROM users WHERE id = \$1 FOR UPDATE$/i.test(s)) {
    const row = store.users.find(u => Number(u.id) === Number(params[0]));
    return { rows: row ? [{ id: row.id }] : [] };
  }

  /* Any other SELECT on the write client is one of the preview reads, executed
     inside the transaction for the fingerprint precondition. Delegating to the
     SAME `runSelect` the preview uses is deliberate: it is what makes
     "the precondition reads exactly what the preview read" true in the stub as
     well as in the route. */
  if (/^SELECT\b/i.test(s)) return runSelect(sql, params);

  // Session invalidation — bump the security revision.
  if (/^UPDATE users SET auth_version = COALESCE\(auth_version, \$2\) \+ 1 WHERE id = \$1 RETURNING id, auth_version$/i.test(s)) {
    const row = store.users.find(u => Number(u.id) === Number(params[0]));
    if (!row) return { rows: [] };
    row.auth_version = (row.auth_version ?? Number(params[1])) + 1;
    return { rows: [{ id: row.id, auth_version: row.auth_version }] };
  }

  // Session invalidation — revoke the live refresh tokens.
  if (/^UPDATE refresh_tokens SET revoked_at = NOW\(\), revoked_reason = \$2 WHERE user_id = ANY\(\$1::int\[\]\) AND revoked_at IS NULL AND used_at IS NULL RETURNING id$/i.test(s)) {
    const ids = params[0].map(Number);
    const hit = store.refresh_tokens.filter(
      t => ids.includes(Number(t.user_id)) && t.revoked_at === null && t.used_at === null,
    );
    hit.forEach((t) => { t.revoked_at = new Date(); t.revoked_reason = params[1]; });
    return { rows: hit.map(t => ({ id: t.id })) };
  }

  /* The vis.*-filtered DELETE. Matched BEFORE the generic per-user DELETE below,
     because the generic pattern would otherwise swallow it and wipe the vis.*
     rows — reproducing the very bug Brick 7 fixed, inside the test harness. */
  if (/^DELETE FROM user_preferences WHERE user_id = \$1 AND pref_key NOT LIKE 'vis\.%'$/i.test(s)) {
    store.user_preferences = store.user_preferences.filter(
      r => Number(r.user_id) !== Number(params[0]) || String(r.pref_key).startsWith('vis.'),
    );
    return { rows: [] };
  }

  const del = s.match(/^DELETE FROM (\w+) WHERE user_id = \$1$/i);
  if (del) {
    store[del[1]] = store[del[1]].filter(r => Number(r.user_id) !== Number(params[0]));
    return { rows: [] };
  }

  if (/^INSERT INTO user_permission_overrides .* FROM user_permission_overrides WHERE user_id = \$2$/i.test(s)) {
    copyRows('user_permission_overrides', params[0], params[1], r => ({
      module: r.module, submodule: r.submodule, allow_mask: r.allow_mask, deny_mask: r.deny_mask,
    }));
    return { rows: [] };
  }
  if (/^INSERT INTO user_permissions .* FROM user_permissions WHERE user_id = \$2$/i.test(s)) {
    copyRows('user_permissions', params[0], params[1], r => ({
      module: r.module, permission_key: r.permission_key, allowed: r.allowed,
    }));
    return { rows: [] };
  }
  if (/^INSERT INTO user_inventory_scopes .* FROM user_inventory_scopes WHERE user_id = \$2$/i.test(s)) {
    copyRows('user_inventory_scopes', params[0], params[1], r => ({
      scope_mode: r.scope_mode, include_unassigned: r.include_unassigned,
    }));
    return { rows: [] };
  }
  if (/^INSERT INTO user_inventory_scope_depts .* FROM user_inventory_scope_depts WHERE user_id = \$2$/i.test(s)) {
    copyRows('user_inventory_scope_depts', params[0], params[1], r => ({
      department_id: r.department_id,
    }));
    return { rows: [] };
  }
  if (/^INSERT INTO user_preferences .* WHERE user_id = \$2 AND pref_key NOT LIKE 'vis\.%'$/i.test(s)) {
    for (const row of byUser('user_preferences', params[1])) {
      if (String(row.pref_key).startsWith('vis.')) continue;
      store.user_preferences.push({
        user_id: Number(params[0]), pref_key: row.pref_key, pref_value: row.pref_value,
      });
    }
    return { rows: [] };
  }
  if (/^INSERT INTO user_dashboard_widgets .* FROM user_dashboard_widgets WHERE user_id = \$2$/i.test(s)) {
    copyRows('user_dashboard_widgets', params[0], params[1], r => ({
      widget_key: r.widget_key, position: r.position, is_visible: r.is_visible,
    }));
    return { rows: [] };
  }
  if (/^INSERT INTO template_shares \(user_id, template_id\) SELECT \$1, template_id FROM template_shares WHERE user_id = \$2$/i.test(s)) {
    copyRows('template_shares', params[0], params[1], r => ({ template_id: r.template_id }));
    return { rows: [] };
  }
  if (/^INSERT INTO template_shares \(user_id, template_id\) SELECT \$1, id FROM inventory_templates WHERE created_by = \$2 AND is_global = false ON CONFLICT DO NOTHING$/i.test(s)) {
    for (const t of store.inventory_templates) {
      if (Number(t.created_by) !== Number(params[1]) || t.is_global !== false) continue;
      const exists = store.template_shares.some(
        sh => Number(sh.user_id) === Number(params[0]) && sh.template_id === t.id,
      );
      if (!exists) store.template_shares.push({ user_id: Number(params[0]), template_id: t.id });
    }
    return { rows: [] };
  }
  if (/^INSERT INTO permission_audit_logs/i.test(s)) {
    store.permission_audit_logs.push({ user_id: params[0], action: params[1], target_id: params[3] });
    return { rows: [] };
  }

  throw new Error(`unhandled statement: ${s.slice(0, 160)}`);
}

/* ── Stub every module the route pulls in ──────────────────────────────────── */

function stub(relative, exports) {
  const resolved = require.resolve(relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('../db/pool', {
  /* `pool.query` is not read-only by convention: the copy route's post-commit
     auditLog call goes through it. Statements are dispatched by their verb and
     tagged, so "the preview only ever SELECTs" stays an assertion rather than an
     assumption built into the stub. */
  query: async (sql, params = []) => {
    const text = squash(sql);
    const isRead = /^SELECT\b/i.test(text);
    statements.push({ pool: isRead ? 'read' : 'audit', sql: text });
    return isRead ? runSelect(sql, params) : runWrite(sql, params);
  },
  primaryPool: {
    connect: async () => {
      writeConnections += 1;
      return {
        query: async (sql, params = []) => {
          statements.push({ pool: 'write', sql: squash(sql) });
          return runWrite(sql, params);
        },
        release: () => {},
      };
    },
  },
});

stub('../middleware/auth', {
  authenticate: (req, _res, next) => { req.user = ACTOR; next(); },
  authorize: () => (_req, _res, next) => next(),
});

stub('../services/eventDispatcher', {
  dispatchEvent: () => {},
  dispatchPermissionChange: () => {},
});

/* Silent by default so a deliberate 400/404 case does not spam the run.
   DEBUG_COPY_SETUP=1 surfaces the route's own error when a test goes red. */
stub('../middleware/logger', {
  logger: {
    error: (...args) => { if (process.env.DEBUG_COPY_SETUP) console.error(...args); },
    warn: () => {},
    info: () => {},
  },
});

stub('../services/inventoryAuth', { loadInventoryAuthContext: async () => ({}) });

/* auditLog goes through the stubbed pool, so the INSERT stays observable. */
stub('../routes/roles', {
  router: null,
  auditLog: async (client, userId, action, targetType, targetId) => {
    await client.query(
      'INSERT INTO permission_audit_logs (user_id, action, target_type, target_id, changes, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, action, targetType, targetId, null, null, null],
    );
  },
});

const express = require('express');
const router = require('../routes/adminUsers');

/* ── One throwaway HTTP server around the real router ──────────────────────── */

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(() => {
  store = freshStore();
  statements = [];
  writeConnections = 0;
});

const getPreview = (target = TARGET_ID, source = SOURCE_ID) => fetch(
  `${baseUrl}/api/admin/users/${target}/copy-setup/preview?source_user_id=${source}`,
);

const postCopy = (body, target = TARGET_ID) => fetch(
  `${baseUrl}/api/admin/users/${target}/copy-setup`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
);

const ALL = {
  permissions: true, visibility: true, preferences: true, dashboard: true, templates: true,
};

async function loadModel() {
  const modelPath = path.join(
    __dirname, '..', '..', 'client', 'src', 'modules', 'admin-panel',
    'user-card', 'copy-setup', 'copySetupPreviewModel.js',
  );
  return import(`file://${modelPath.replace(/\\/g, '/')}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   Preview is read-only
   ══════════════════════════════════════════════════════════════════════════ */

test('preview issues SELECT statements only', async () => {
  const res = await getPreview();
  assert.equal(res.status, 200);

  assert.ok(statements.length > 0, 'the preview must actually read something');
  for (const { sql } of statements) {
    assert.match(sql, /^SELECT\b/i, `preview ran a non-SELECT statement: ${sql.slice(0, 80)}`);
  }
});

test('preview never opens a write connection and never begins a transaction', async () => {
  await getPreview();

  assert.equal(writeConnections, 0, 'the preview reached for the primary write pool');
  assert.equal(statements.some(s => s.pool === 'write'), false);
  assert.equal(statements.some(s => /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(s.sql)), false);
});

test('preview leaves every table byte-identical and writes no audit row', async () => {
  const before = JSON.stringify(freshStore());
  await getPreview();
  await getPreview();

  assert.equal(JSON.stringify(store), before, 'the preview mutated stored state');
  assert.equal(store.permission_audit_logs.length, 0);
});

test('preview is idempotent — two reads return the same payload', async () => {
  const first = await (await getPreview()).json();
  const second = await (await getPreview()).json();
  assert.deepEqual(first, second);
});

test('preview rejects a self-copy, matching the write endpoint', async () => {
  const res = await getPreview(TARGET_ID, TARGET_ID);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /self/i);
  assert.equal(statements.length, 0, 'a rejected preview must not read anything');
});

test('preview 404s for a user that does not exist', async () => {
  const res = await getPreview(TARGET_ID, 4242);
  assert.equal(res.status, 404);
});

test('preview reads every table the copy transaction writes', async () => {
  await getPreview();
  const read = statements.map(s => s.sql).join(' ');

  for (const table of ['user_permission_overrides', 'user_permissions',
    'user_inventory_scopes', 'user_inventory_scope_depts', 'user_preferences',
    'user_dashboard_widgets', 'template_shares', 'inventory_templates']) {
    assert.ok(read.includes(table), `the preview never reads ${table}, which the copy replaces`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Preview / apply parity — the model predicts the transaction exactly
   ══════════════════════════════════════════════════════════════════════════ */

test('parity: every selected category ends exactly as the preview predicted', async () => {
  const model = await loadModel();
  const payload = await (await getPreview()).json();
  const preview = model.buildCopyPreview({ payload, selection: ALL });

  statements = [];
  const res = await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));
  assert.equal(res.status, 200);

  /* 1. permission overrides */
  assert.deepEqual(
    byUser('user_permission_overrides', TARGET_ID)
      .map(r => `${r.module}:${r.submodule || ''}=${r.allow_mask}/${r.deny_mask}`).sort(),
    preview.categories.permissions.diff.overrides.result
      .map(r => `${r.module}:${r.submodule || ''}=${r.allow_mask}/${r.deny_mask}`).sort(),
  );

  /* 1b. the legacy table the same flag also replaces */
  assert.deepEqual(
    byUser('user_permissions', TARGET_ID).map(r => `${r.module}:${r.permission_key}`).sort(),
    preview.categories.permissions.diff.legacy.result
      .map(r => `${r.module}:${r.permission_key}`).sort(),
  );

  /* 2. inventory scope */
  const scopeAfter = preview.categories.visibility.diff.after;
  const actualScope = byUser('user_inventory_scopes', TARGET_ID);
  assert.equal(actualScope.length, scopeAfter.has_row ? 1 : 0);
  if (scopeAfter.has_row) {
    assert.equal(actualScope[0].scope_mode, scopeAfter.scope_mode);
    assert.equal(Boolean(actualScope[0].include_unassigned), scopeAfter.include_unassigned);
  }
  assert.deepEqual(
    byUser('user_inventory_scope_depts', TARGET_ID).map(r => r.department_id).sort(),
    [...scopeAfter.department_ids].sort(),
  );

  /* 3. preferences — RBAC Brick 7 vis.* preservation.
   *
   * Brick 6 asserted the opposite of this: that NO vis.* row survived, because
   * the copy's unfiltered DELETE destroyed the target's own. Brick 7 filtered
   * the DELETE, so the stored result is now the copyable rows the preview
   * predicts PLUS the target's untouched vis.* rows. */
  const prefsAfter = byUser('user_preferences', TARGET_ID);
  const prefDiff = preview.categories.preferences.diff;

  assert.deepEqual(
    prefsAfter.filter(r => !r.pref_key.startsWith('vis.'))
      .map(r => `${r.pref_key}=${r.pref_value}`).sort(),
    prefDiff.result.map(r => `${r.pref_key}=${r.pref_value}`).sort(),
    'the copyable preferences do not match what the preview predicted',
  );

  // The target's own vis.* rows survive, byte-identical.
  assert.deepEqual(
    prefsAfter.filter(r => r.pref_key.startsWith('vis.'))
      .map(r => `${r.pref_key}=${r.pref_value}`).sort(),
    prefDiff.preservedExcluded.map(e => `${e.before.pref_key}=${e.before.pref_value}`).sort(),
    'a target vis.* row was destroyed, which Brick 7 fixed',
  );
  assert.ok(
    prefsAfter.some(r => r.pref_key === 'vis.show_margin' && r.pref_value === 'false'),
    'the target\'s vis.show_margin was not preserved with its original value',
  );

  // …and the SOURCE's vis.* rows are still not copied.
  assert.equal(
    prefsAfter.some(r => r.pref_key === 'vis.show_cogs'),
    false,
    'a source vis.* row was copied onto the target',
  );

  /* 4. dashboard */
  assert.deepEqual(
    byUser('user_dashboard_widgets', TARGET_ID)
      .map(r => `${r.widget_key}@${r.position}:${r.is_visible}`).sort(),
    preview.categories.dashboard.diff.result
      .map(r => `${r.widget_key}@${r.position}:${r.is_visible}`).sort(),
  );

  /* 5. templates */
  assert.deepEqual(
    byUser('template_shares', TARGET_ID).map(r => r.template_id).sort(),
    preview.categories.templates.diff.result.map(r => r.template_id).sort(),
  );
});

test('parity: an unselected category is left completely untouched', async () => {
  const model = await loadModel();
  const selection = {
    permissions: true, visibility: false, preferences: false, dashboard: false, templates: false,
  };

  const untouched = {
    scopes: clone(byUser('user_inventory_scopes', TARGET_ID)),
    depts: clone(byUser('user_inventory_scope_depts', TARGET_ID)),
    prefs: clone(byUser('user_preferences', TARGET_ID)),
    widgets: clone(byUser('user_dashboard_widgets', TARGET_ID)),
    shares: clone(byUser('template_shares', TARGET_ID)),
  };

  const res = await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection }));
  assert.equal(res.status, 200);

  assert.deepEqual(byUser('user_inventory_scopes', TARGET_ID), untouched.scopes);
  assert.deepEqual(byUser('user_inventory_scope_depts', TARGET_ID), untouched.depts);
  assert.deepEqual(byUser('user_preferences', TARGET_ID), untouched.prefs);
  assert.deepEqual(byUser('user_dashboard_widgets', TARGET_ID), untouched.widgets);
  assert.deepEqual(byUser('template_shares', TARGET_ID), untouched.shares);
});

test('parity: the source user is never modified', async () => {
  const model = await loadModel();
  const snapshot = () => JSON.stringify({
    overrides: byUser('user_permission_overrides', SOURCE_ID),
    legacy: byUser('user_permissions', SOURCE_ID),
    scopes: byUser('user_inventory_scopes', SOURCE_ID),
    depts: byUser('user_inventory_scope_depts', SOURCE_ID),
    prefs: byUser('user_preferences', SOURCE_ID),
    widgets: byUser('user_dashboard_widgets', SOURCE_ID),
    shares: byUser('template_shares', SOURCE_ID),
    templates: store.inventory_templates,
  });
  const before = snapshot();

  await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));

  assert.equal(snapshot(), before);
});

/* ══════════════════════════════════════════════════════════════════════════
   Security boundary — what the copy is structurally unable to change
   ══════════════════════════════════════════════════════════════════════════ */

test('the copy transaction names no identity or credential column', async () => {
  const model = await loadModel();
  await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));

  const written = statements.filter(s => s.pool !== 'read').map(s => s.sql).join(' ');

  /* RBAC Brick 7 narrowed this invariant, deliberately.
   *
   * Brick 6 asserted the copy never NAMED `users` or `refresh_tokens` at all.
   * That is no longer true and must not be: the copy now locks the users row and,
   * when it moves authority, increments users.auth_version and revokes the
   * target's refresh tokens. Asserting the old blanket rule would mean asserting
   * that session invalidation does not happen.
   *
   * What still holds — and is what the original invariant was actually protecting
   * — is that the copy never touches IDENTITY or CREDENTIALS. Those columns are
   * named individually below, which is a stronger and more honest claim than the
   * table-level ban it replaces. */
  for (const table of ['user_roles', 'roles', 'role_permissions']) {
    assert.equal(
      new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|FROM)\\s+${table}\\b`, 'i').test(written),
      false,
      `the copy transaction reads or writes ${table}`,
    );
  }

  // No credential or identity column, by name, anywhere in the transaction.
  for (const token of ['password', 'password_hash', 'mfa', 'mfa_secret', 'token_hash',
    'username', 'email', 'is_active', 'last_login']) {
    assert.equal(new RegExp(`\\b${token}\\b`, 'i').test(written), false,
      `the copy transaction names ${token}`);
  }

  // The ONLY users column the copy may write is the security revision.
  const userWrites = statements
    .filter(s => s.pool !== 'read' && /^UPDATE users\b/i.test(s.sql))
    .map(s => s.sql);
  for (const sql of userWrites) {
    assert.match(sql, /^UPDATE users SET auth_version = /i,
      `the copy transaction updates a users column other than auth_version: ${sql}`);
  }
});

test('the target keeps its role, department and account status', async () => {
  const model = await loadModel();
  const identityOf = () => JSON.stringify(store.users.map(
    ({ id, username, full_name, role, is_active, department_id }) => (
      { id, username, full_name, role, is_active, department_id }),
  ));
  const before = identityOf();

  await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));

  /* Compared field by field rather than over the whole row, because RBAC Brick 7
     legitimately changes ONE users column — auth_version — when the copy moves
     authority. Every field an administrator would recognise as identity is
     asserted unchanged; the security revision is asserted separately below. */
  assert.equal(identityOf(), before);
});

/* ══════════════════════════════════════════════════════════════════════════
   RBAC Brick 7 — session propagation of a copy
   ══════════════════════════════════════════════════════════════════════════ */

const targetUser = () => store.users.find(u => u.id === TARGET_ID);
const sourceUser = () => store.users.find(u => u.id === SOURCE_ID);
const liveTokens = id => store.refresh_tokens.filter(
  t => Number(t.user_id) === Number(id) && t.revoked_at === null,
);

test('copying permissions invalidates the target\'s sessions', async () => {
  const model = await loadModel();
  const before = targetUser().auth_version;

  const res = await postCopy(model.buildApplyPayload({
    sourceId: SOURCE_ID,
    selection: { permissions: true, visibility: false, preferences: false, dashboard: false, templates: false },
  }));

  assert.equal(res.status, 200);
  assert.equal(targetUser().auth_version, before + 1, 'the target keeps its old access token');
  assert.equal(liveTokens(TARGET_ID).length, 0, 'the target can refresh straight back in');
  assert.equal((await res.json()).session_invalidation.enforced, true);
});

test('copying visibility invalidates the target\'s sessions', async () => {
  const model = await loadModel();
  const before = targetUser().auth_version;

  const res = await postCopy(model.buildApplyPayload({
    sourceId: SOURCE_ID,
    selection: { permissions: false, visibility: true, preferences: false, dashboard: false, templates: false },
  }));

  assert.equal(res.status, 200);
  assert.equal(targetUser().auth_version, before + 1);
  assert.equal(liveTokens(TARGET_ID).length, 0);
});

test('a preferences-, dashboard- or template-only copy invalidates nothing', async () => {
  const model = await loadModel();
  const before = targetUser().auth_version;

  const res = await postCopy(model.buildApplyPayload({
    sourceId: SOURCE_ID,
    selection: { permissions: false, visibility: false, preferences: true, dashboard: true, templates: true },
  }));

  assert.equal(res.status, 200);
  assert.equal(targetUser().auth_version, before, 'a layout copy signed the target out');
  assert.equal(liveTokens(TARGET_ID).length, 1, 'a layout copy revoked a refresh token');
  assert.equal((await res.json()).session_invalidation.enforced, false);
});

test('the source is never signed out for being copied FROM', async () => {
  const model = await loadModel();
  const before = sourceUser().auth_version;

  await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));

  assert.equal(sourceUser().auth_version, before, 'the source user was signed out');
  assert.equal(liveTokens(SOURCE_ID).length, 1, 'the source user\'s refresh token was revoked');
});

test('a stale preview fingerprint is refused inside the transaction', async () => {
  const model = await loadModel();
  const payload = await (await getPreview()).json();
  assert.ok(payload.state_fingerprint, 'the preview must issue a fingerprint to echo back');

  // Someone else changes the target after the preview was generated.
  store.user_preferences.push({ user_id: TARGET_ID, pref_key: 'default_branch', pref_value: 'B' });

  const before = JSON.stringify(store);
  const res = await postCopy({
    ...model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }),
    expected_fingerprint: payload.state_fingerprint,
  });

  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'STALE_COPY_PREVIEW');
  assert.equal(JSON.stringify(store), before, 'a refused copy still mutated the database');
  assert.equal(store.permission_audit_logs.length, 0, 'a refused copy wrote a success audit row');
});

test('a matching preview fingerprint is accepted', async () => {
  const model = await loadModel();
  const payload = await (await getPreview()).json();

  const res = await postCopy({
    ...model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }),
    expected_fingerprint: payload.state_fingerprint,
  });

  assert.equal(res.status, 200);
  assert.equal(store.permission_audit_logs.length, 1);
});

test('the server fingerprint equals the client model\'s, byte for byte', async () => {
  const model = await loadModel();
  const payload = await (await getPreview()).json();

  /* Parity is load-bearing: the wizard echoes the SERVER's fingerprint, but the
     client computes its own for the pre-check. If the two algorithms ever drift,
     this fails here rather than as a 409 on every apply in production. */
  assert.equal(payload.state_fingerprint, model.fingerprintCopyState(payload));
});

test('the copy stays one transaction and records one audit row', async () => {
  const model = await loadModel();
  await postCopy(model.buildApplyPayload({ sourceId: SOURCE_ID, selection: ALL }));

  const write = statements.filter(s => s.pool === 'write').map(s => s.sql);
  assert.equal(write.filter(s => /^BEGIN$/i.test(s)).length, 1);
  assert.equal(write.filter(s => /^COMMIT$/i.test(s)).length, 1);
  assert.equal(write.filter(s => /^ROLLBACK$/i.test(s)).length, 0);
  assert.equal(writeConnections, 1, 'the copy must not open more than one connection');

  assert.equal(store.permission_audit_logs.length, 1);
  assert.equal(store.permission_audit_logs[0].action, 'copy_user_setup');
  assert.equal(store.permission_audit_logs[0].target_id, TARGET_ID);
});

test('the write endpoint rejects a self-copy on its own', async () => {
  const res = await postCopy({ source_user_id: TARGET_ID, copy_permissions: true });
  assert.equal(res.status, 400);
  assert.equal(writeConnections, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   Source-level guards
   ══════════════════════════════════════════════════════════════════════════ */

test('the preview handler contains no write statement in its source', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminUsers.js'), 'utf8');
  const start = source.indexOf("router.get('/users/:id/copy-setup/preview'");
  const end = source.indexOf("router.post('/users/:id/copy-setup'");

  assert.ok(start > -1 && end > start, 'could not locate the preview handler');

  // Comments are stripped first: the handler's own documentation quotes the
  // copy transaction's DELETE/INSERT, and a comment is not a statement.
  const handler = source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, ' ');

  assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE|BEGIN|COMMIT)\b/i.test(handler), false,
    'the preview handler contains a write statement');
  assert.equal(/primaryPool/.test(handler), false,
    'the preview handler reaches for the primary write pool');
  assert.equal(/auditLog/.test(handler), false,
    'the preview handler writes an audit row');
});

test('the preview endpoint is admin-protected, like every sibling route', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminUsers.js'), 'utf8');
  assert.match(source, /router\.get\('\/users\/:id\/copy-setup\/preview', \.\.\.adminOnly,/);
  assert.match(source, /const adminOnly = \[authenticate, authorize\('admin'\)\]/);
});

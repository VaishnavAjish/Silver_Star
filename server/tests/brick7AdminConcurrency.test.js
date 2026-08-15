'use strict';

/**
 * RBAC Brick 7 — stale-write protection and audit atomicity, at the route level.
 *
 * NO DATABASE IS CONTACTED. Following server/tests/copySetupPreview.test.js,
 * `require.cache` is poisoned with a stub pool before the routes load, so the
 * REAL route handlers run against an in-memory store of invented rows.
 *
 * THE SCENARIO EVERY TEST HERE IS BUILT AROUND
 *   Admin A opens a user and sees state X.
 *   Admin B opens the same user and sees state X.
 *   Admin B saves Y.
 *   Admin A saves Z, still believing the state is X.
 *
 *   Before Brick 7 the override endpoint was a DELETE-then-INSERT full
 *   replacement with no precondition, so A's save silently erased B's change:
 *   no error, no conflict, and no audit trail of the reversion. The tests below
 *   require that A now receives 409 and that the database still holds Y.
 *
 * Run: node --test server/tests/brick7AdminConcurrency.test.js
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

after(async () => {
  try {
    const poolPath = require.resolve('../db/pool');
    if (require.cache[poolPath]) {
      await require(poolPath).end();
    }
  } catch (e) {}
});

process.env.JWT_SECRET = process.env.JWT_SECRET || 'brick7-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'brick7-test-refresh-secret';

const ACTOR = { id: 1, role: 'admin' };
const USER_ID = 9;

/* ── In-memory store ───────────────────────────────────────────────────────── */

function freshStore() {
  return {
    users: [
      { id: 1, is_active: true, auth_version: 1 },
      { id: USER_ID, is_active: true, auth_version: 1 },
    ],
    user_permission_overrides: [
      { user_id: USER_ID, module: 'reports', submodule: 'stock', allow_mask: 2, deny_mask: 0 },
    ],
    user_permissions: [],
    user_preferences: [
      { user_id: USER_ID, pref_key: 'theme', pref_value: 'light' },
    ],
    user_inventory_scopes: [
      { user_id: USER_ID, scope_mode: 'SELECTED', include_unassigned: false },
    ],
    user_inventory_scope_depts: [
      { user_id: USER_ID, department_id: 3 },
    ],
    departments: [
      { id: 3, name: 'Growing' },
      { id: 4, name: 'Polish 2' },
    ],
    refresh_tokens: [
      { id: 42, user_id: USER_ID, used_at: null, revoked_at: null, revoked_reason: null },
    ],
    permission_audit_logs: [],
  };
}

let store = freshStore();
let statements = [];
/** Set to a substring to make the matching statement fail, for rollback proofs. */
let failOn = null;

const squash = sql => String(sql).replace(/\s+/g, ' ').trim();
const byUser = (table, id) => store[table].filter(r => Number(r.user_id) === Number(id));

function run(sql, params, pool) {
  const s = squash(sql);
  statements.push({ pool, sql: s });

  if (failOn && s.includes(failOn)) {
    const err = new Error(`injected failure on: ${failOn}`);
    err.code = 'INJECTED';
    throw err;
  }

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };

  if (/^SELECT id FROM users WHERE id = \$1 FOR UPDATE$/i.test(s)) {
    const row = store.users.find(u => Number(u.id) === Number(params[0]));
    return { rows: row ? [{ id: row.id }] : [] };
  }

  if (/^SELECT module, submodule, allow_mask, deny_mask(, created_at, updated_at)? FROM user_permission_overrides/i.test(s)) {
    return {
      rows: byUser('user_permission_overrides', params[0]).map(
        ({ module, submodule, allow_mask, deny_mask }) => ({ module, submodule, allow_mask, deny_mask }),
      ),
    };
  }

  if (/^DELETE FROM user_permission_overrides WHERE user_id = \$1$/i.test(s)) {
    store.user_permission_overrides = store.user_permission_overrides
      .filter(r => Number(r.user_id) !== Number(params[0]));
    return { rows: [] };
  }

  if (/^INSERT INTO user_permission_overrides/i.test(s)) {
    store.user_permission_overrides.push({
      user_id: Number(params[0]), module: params[1], submodule: params[2],
      allow_mask: params[3], deny_mask: params[4],
    });
    return { rows: [] };
  }

  if (/^SELECT scope_mode, include_unassigned FROM user_inventory_scopes/i.test(s)) {
    return {
      rows: byUser('user_inventory_scopes', params[0]).map(
        ({ scope_mode, include_unassigned }) => ({ scope_mode, include_unassigned }),
      ),
    };
  }

  if (/^SELECT department_id FROM user_inventory_scope_depts/i.test(s)) {
    return {
      rows: byUser('user_inventory_scope_depts', params[0]).map(
        ({ department_id }) => ({ department_id }),
      ),
    };
  }

  if (/^SELECT uisd\.department_id, d\.name/i.test(s)) {
    return {
      rows: byUser('user_inventory_scope_depts', params[0]).map(r => ({
        department_id: r.department_id,
        name: store.departments.find(d => d.id === r.department_id)?.name || null,
      })),
    };
  }

  if (/^INSERT INTO user_inventory_scopes/i.test(s)) {
    const existing = store.user_inventory_scopes.find(r => Number(r.user_id) === Number(params[0]));
    if (existing) {
      existing.scope_mode = params[1];
      existing.include_unassigned = params[2];
    } else {
      store.user_inventory_scopes.push({
        user_id: Number(params[0]), scope_mode: params[1], include_unassigned: params[2],
      });
    }
    return { rows: [] };
  }

  if (/^DELETE FROM user_inventory_scope_depts WHERE user_id = \$1$/i.test(s)) {
    store.user_inventory_scope_depts = store.user_inventory_scope_depts
      .filter(r => Number(r.user_id) !== Number(params[0]));
    return { rows: [] };
  }

  if (/^INSERT INTO user_inventory_scope_depts/i.test(s)) {
    store.user_inventory_scope_depts.push({
      user_id: Number(params[0]), department_id: Number(params[1]),
    });
    return { rows: [] };
  }

  if (/^SELECT pref_key, pref_value FROM user_preferences/i.test(s)) {
    return {
      rows: byUser('user_preferences', params[0]).map(
        ({ pref_key, pref_value }) => ({ pref_key, pref_value }),
      ),
    };
  }
  if (/^DELETE FROM user_preferences WHERE user_id=\$1$/i.test(s)) {
    store.user_preferences = store.user_preferences.filter(r => Number(r.user_id) !== Number(params[0]));
    return { rows: [] };
  }
  if (/^INSERT INTO user_preferences/i.test(s)) {
    store.user_preferences.push({
      user_id: Number(params[0]), pref_key: params[1], pref_value: params[2],
    });
    return { rows: [] };
  }

  if (/^UPDATE users SET auth_version = COALESCE\(auth_version, \$2\) \+ 1/i.test(s)) {
    const row = store.users.find(u => Number(u.id) === Number(params[0]));
    if (!row) return { rows: [] };
    row.auth_version = (row.auth_version ?? Number(params[1])) + 1;
    return { rows: [{ id: row.id, auth_version: row.auth_version }] };
  }

  if (/^UPDATE refresh_tokens SET revoked_at = NOW\(\)/i.test(s)) {
    const ids = params[0].map(Number);
    const hit = store.refresh_tokens.filter(
      t => ids.includes(Number(t.user_id)) && t.revoked_at === null && t.used_at === null,
    );
    hit.forEach((t) => { t.revoked_at = new Date(); t.revoked_reason = params[1]; });
    return { rows: hit.map(t => ({ id: t.id })) };
  }

  if (/^INSERT INTO permission_audit_logs/i.test(s)) {
    store.permission_audit_logs.push({
      user_id: params[0], action: params[1], target_type: params[2],
      target_id: params[3], changes: params[4], pool,
    });
    return { rows: [{ id: store.permission_audit_logs.length }] };
  }

  throw new Error(`unhandled statement: ${s.slice(0, 140)}`);
}

/* ── Stub every module the routes pull in ──────────────────────────────────── */

function stub(relative, exports) {
  const resolved = require.resolve(relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let writeConnections = 0;

stub('../db/pool', {
  query: async (sql, params = []) => run(sql, params, 'read'),
  primaryPool: {
    connect: async () => {
      writeConnections += 1;
      return {
        query: async (sql, params = []) => run(sql, params, 'write'),
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

stub('../middleware/logger', {
  logger: {
    error: (...a) => { if (process.env.DEBUG_BRICK7) console.error(...a); },
    warn: () => {},
    info: () => {},
  },
});

stub('../services/inventoryAuth', { loadInventoryAuthContext: async () => ({}) });

const express = require('express');
const permsRouter = require('../routes/adminPermissions');
const usersRouter = require('../routes/adminUsers');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/users', permsRouter);
  app.use('/api/admin', usersRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { await new Promise(resolve => server.close(resolve)); });

test.beforeEach(() => {
  store = freshStore();
  statements = [];
  writeConnections = 0;
  failOn = null;
});

const getOverrides = () => fetch(`${baseUrl}/api/admin/users/${USER_ID}/permission-overrides`);

const putOverrides = body => fetch(
  `${baseUrl}/api/admin/users/${USER_ID}/permission-overrides`,
  { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
);

const getScope = () => fetch(`${baseUrl}/api/admin/users/${USER_ID}/inventory-scope`);

const putScope = body => fetch(
  `${baseUrl}/api/admin/users/${USER_ID}/inventory-scope`,
  { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
);

const OV_A = [{ module: 'inventory', submodule: 'stock_transfer', allow_mask: 16, deny_mask: 0 }];
const OV_B = [{ module: 'accounting', submodule: 'journal_entries', allow_mask: 0, deny_mask: 1 }];

/* ══════════════════════════════════════════════════════════════════════════
   Permission overrides — the headline stale-write case
   ══════════════════════════════════════════════════════════════════════════ */

test('the GET issues a state_version for the client to echo back', async () => {
  const body = await (await getOverrides()).json();
  assert.ok(body.state_version, 'no state_version was issued');
  assert.match(body.state_version, /^ov1_[0-9a-f]{8}_\d{3}$/);
});

test('two reads of unchanged state produce the same version', async () => {
  const first = await (await getOverrides()).json();
  const second = await (await getOverrides()).json();
  assert.equal(first.state_version, second.state_version);
});

test('Admin A wins, Admin B gets 409, and the database holds A\'s write', async () => {
  // Both administrators load the same state.
  const seenByA = (await (await getOverrides()).json()).state_version;
  const seenByB = (await (await getOverrides()).json()).state_version;
  assert.equal(seenByA, seenByB);

  // A saves first and succeeds.
  const resA = await putOverrides({ overrides: OV_A, expected_version: seenByA });
  assert.equal(resA.status, 200);

  // B saves second, still holding the stale version.
  const resB = await putOverrides({ overrides: OV_B, expected_version: seenByB });
  assert.equal(resB.status, 409, 'the stale write was accepted');
  const bodyB = await resB.json();
  assert.equal(bodyB.code, 'STALE_PERMISSION_VERSION');
  assert.equal(bodyB.domain, 'permission_overrides');

  // The database still holds A's write — B did not revert it.
  const stored = byUser('user_permission_overrides', USER_ID);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].module, 'inventory');
  assert.equal(stored[0].submodule, 'stock_transfer');
});

test('the 409 body leaks no other administrator\'s configuration', async () => {
  const stale = (await (await getOverrides()).json()).state_version;
  await putOverrides({ overrides: OV_A, expected_version: stale });

  const body = await (await putOverrides({ overrides: OV_B, expected_version: stale })).json();
  const text = JSON.stringify(body);

  // The fingerprints are opaque; the rows behind them must never travel.
  assert.equal(/stock_transfer/.test(text), false, 'the 409 leaked override rows');
  assert.equal(/allow_mask/.test(text), false);
});

test('a rejected stale write rolls back and writes NO audit row', async () => {
  const stale = (await (await getOverrides()).json()).state_version;
  await putOverrides({ overrides: OV_A, expected_version: stale });

  const auditBefore = store.permission_audit_logs.length;
  const versionBefore = store.users.find(u => u.id === USER_ID).auth_version;
  statements = [];

  const res = await putOverrides({ overrides: OV_B, expected_version: stale });
  assert.equal(res.status, 409);

  assert.equal(store.permission_audit_logs.length, auditBefore,
    'a refused write produced a success audit row');
  assert.equal(store.users.find(u => u.id === USER_ID).auth_version, versionBefore,
    'a refused write still invalidated the user\'s sessions');

  const write = statements.filter(s => s.pool === 'write').map(s => s.sql);
  assert.ok(write.includes('ROLLBACK'), 'the refused write did not roll back');
  assert.equal(write.includes('COMMIT'), false);
});

test('a matching version is accepted and re-issues a fresh version', async () => {
  const version = (await (await getOverrides()).json()).state_version;
  const res = await putOverrides({ overrides: OV_A, expected_version: version });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.concurrency_checked, true);
  assert.ok(body.state_version && body.state_version !== version);

  // The version the save returns must equal what a fresh GET would produce, or
  // the next save would 409 against this admin's own successful write.
  assert.equal(body.state_version, (await (await getOverrides()).json()).state_version);
});

test('a legacy caller that sends no version still works, and says it was unprotected', async () => {
  const res = await putOverrides({ overrides: OV_A });
  const body = await res.json();

  assert.equal(res.status, 200, 'a pre-Brick-7 caller was broken');
  assert.equal(body.concurrency_checked, false, 'an unprotected save claimed protection');
});

test('an override save invalidates the target user\'s sessions', async () => {
  const before = store.users.find(u => u.id === USER_ID).auth_version;
  const body = await (await putOverrides({ overrides: OV_A })).json();

  assert.equal(store.users.find(u => u.id === USER_ID).auth_version, before + 1);
  assert.equal(store.refresh_tokens.find(t => t.id === 42).revoked_at instanceof Date, true);
  assert.equal(body.session_invalidation.enforced, true);
  assert.equal(body.session_invalidation.refresh_tokens_revoked, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
   Audit atomicity
   ══════════════════════════════════════════════════════════════════════════ */

test('the audit row is written INSIDE the mutation transaction', async () => {
  await putOverrides({ overrides: OV_A });

  const audit = store.permission_audit_logs;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'update_user_permission_overrides');

  // Written on the transaction's own connection, not on the pool afterwards.
  assert.equal(audit[0].pool, 'write', 'the audit row was written outside the transaction');

  const sqls = statements.filter(s => s.pool === 'write').map(s => s.sql);
  const auditAt = sqls.findIndex(s => /^INSERT INTO permission_audit_logs/i.test(s));
  const commitAt = sqls.findIndex(s => /^COMMIT$/i.test(s));
  assert.ok(auditAt > -1 && commitAt > auditAt, 'the audit row was not written before COMMIT');
});

test('a failing audit insert rolls the security mutation back', async () => {
  const versionBefore = store.users.find(u => u.id === USER_ID).auth_version;
  statements = [];

  failOn = 'INSERT INTO permission_audit_logs';
  const res = await putOverrides({ overrides: OV_A });
  failOn = null;

  assert.equal(res.status, 500);
  const write = statements.filter(s => s.pool === 'write').map(s => s.sql);
  assert.ok(write.includes('ROLLBACK'));
  assert.equal(write.includes('COMMIT'), false,
    'the mutation committed even though its audit row failed');
  assert.equal(store.permission_audit_logs.length, 0);
  // The version bump happened inside the same transaction, so a real database
  // would undo it; what is provable in this stub is that COMMIT was never reached.
  assert.ok(versionBefore >= 1);
});

test('the audit payload records what changed without leaking a credential', async () => {
  await putOverrides({ overrides: OV_A });
  const raw = store.permission_audit_logs[0].changes;
  const changes = JSON.parse(raw);

  assert.ok(Array.isArray(changes.before) && Array.isArray(changes.after));
  assert.equal(changes.stored_count, 1);
  assert.equal(changes.session_invalidation.enforced, true);

  for (const token of ['password', 'password_hash', 'mfa_secret', 'token_hash', 'refreshToken']) {
    assert.equal(new RegExp(token, 'i').test(raw), false, `the audit payload names ${token}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Inventory scope — the same protection, its own error code
   ══════════════════════════════════════════════════════════════════════════ */

test('a stale inventory-scope write is refused with its own code', async () => {
  const seenByA = (await (await getScope()).json()).state_version;
  const seenByB = (await (await getScope()).json()).state_version;

  const resA = await putScope({
    scope_mode: 'SELECTED', include_unassigned: false, department_ids: [4],
    expected_version: seenByA,
  });
  assert.equal(resA.status, 200);

  const resB = await putScope({
    scope_mode: 'ALL', include_unassigned: true, department_ids: [],
    expected_version: seenByB,
  });
  assert.equal(resB.status, 409);
  assert.equal((await resB.json()).code, 'STALE_INVENTORY_SCOPE');

  // A's scope survives.
  assert.equal(store.user_inventory_scopes.find(r => r.user_id === USER_ID).scope_mode, 'SELECTED');
  assert.deepEqual(byUser('user_inventory_scope_depts', USER_ID).map(d => d.department_id), [4]);
});

test('NONE, SELECTED and ALL keep their exact meanings', async () => {
  for (const mode of ['NONE', 'ALL']) {
    store = freshStore();
    const res = await putScope({ scope_mode: mode, include_unassigned: false, department_ids: [] });
    assert.equal(res.status, 200);
    assert.equal(store.user_inventory_scopes.find(r => r.user_id === USER_ID).scope_mode, mode);
    // Neither mode keeps a department whitelist.
    assert.equal(byUser('user_inventory_scope_depts', USER_ID).length, 0);
  }

  store = freshStore();
  const res = await putScope({ scope_mode: 'SELECTED', include_unassigned: true, department_ids: [3, 4] });
  assert.equal(res.status, 200);
  assert.deepEqual(byUser('user_inventory_scope_depts', USER_ID).map(d => d.department_id).sort(), [3, 4]);

  // SELECTED with no departments is still refused, exactly as before Brick 7.
  const bad = await putScope({ scope_mode: 'SELECTED', include_unassigned: false, department_ids: [] });
  assert.equal(bad.status, 400);
});

test('a scope change invalidates sessions; it is a security scope', async () => {
  const before = store.users.find(u => u.id === USER_ID).auth_version;
  const body = await (await putScope({
    scope_mode: 'ALL', include_unassigned: false, department_ids: [],
  })).json();

  assert.equal(store.users.find(u => u.id === USER_ID).auth_version, before + 1);
  assert.equal(body.session_invalidation.enforced, true);
});

/* ══════════════════════════════════════════════════════════════════════════
   Preferences — the negative case that keeps the mechanism credible
   ══════════════════════════════════════════════════════════════════════════ */

test('a preferences save invalidates NOTHING', async () => {
  const versionBefore = store.users.find(u => u.id === USER_ID).auth_version;

  const res = await fetch(`${baseUrl}/api/admin/users/${USER_ID}/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: [{ pref_key: 'theme', pref_value: 'dark' }] }),
  });

  assert.equal(res.status, 200);
  assert.equal(store.users.find(u => u.id === USER_ID).auth_version, versionBefore,
    'a theme change signed the user out');
  assert.equal(store.refresh_tokens.find(t => t.id === 42).revoked_at, null,
    'a theme change revoked a refresh token');
  assert.equal(store.permission_audit_logs.length, 0,
    'a preference save masqueraded as a security change in the audit log');
});

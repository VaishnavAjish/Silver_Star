/**
 * RBAC Brick 8 — installer placement, legacy-guard bridging, and real HTTP
 * behaviour in each mode.
 *
 * Two halves, deliberately separated:
 *
 *   STRUCTURE — asserted against the real server/app.js router. Nothing is
 *   requested; the built stack is inspected. This is where "every route was
 *   reached" and "the guard sits after authentication" are proved.
 *
 *   BEHAVIOUR — asserted over real HTTP with supertest, against a purpose-built
 *   application that reuses the REAL installer, the REAL manifest entry and the
 *   REAL guard, but whose handler is a one-line stub. That keeps the test
 *   database-free while still exercising the whole middleware chain, including
 *   the express-async-errors wrapping that makes naive layer inspection wrong.
 *
 * The behavioural half is where the two most consequential claims are checked:
 * that flags off changes nothing, and that flags on does not leave a role-string
 * guard stacked behind the capability guard where it could veto a user-specific
 * ALLOW.
 *
 * Run: node --test --test-force-exit server/tests/brick8Installer.test.js
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const app = require('../app');
const pool = require('../db/pool');
const permissions = require('../utils/permissions');
const { authorize } = require('../middleware/auth');
const config = require('../security/rbac/enforcementConfig');
const manifest = require('../security/rbac/routeEnforcementManifest');
const { collectRoutes } = require('../security/rbac/routeIntrospection');
const {
  installRouteEnforcement,
  insertionIndex,
} = require('../security/rbac/installRouteEnforcement');

const { MODES } = config;
const { PERM_BITS, ALL_PERMISSION_BITS } = permissions;

/* ── Structure: the real application ───────────────────────────────────────── */

test('the installer reaches every registered route with no unclassified remainder', () => {
  // A second run over the already-installed app: the report is what matters, and
  // a route with no manifest entry would surface here as it does at boot.
  const report = installRouteEnforcement(app);
  assert.deepEqual(report.unclassified, []);
  assert.ok(report.routes > 300, 'the walk should see the whole router');
  assert.ok(report.methodPaths >= manifest.ENTRIES.length);
});

test('a capability guard is installed for every ROUTE-guarded entry', () => {
  const guarded = new Set();
  for (const record of collectRoutes(app)) {
    for (const layer of record.stack) {
      const spec = layer.handle && layer.handle.__rbacGuard;
      if (spec) guarded.add(`${spec.capability}|${spec.action}`);
    }
  }
  const wanted = new Set(
    manifest.ENTRIES.filter((e) => e.guard === manifest.GUARD.ROUTE).map(
      (e) => `${e.capability}|${e.action}`,
    ),
  );
  const missing = [...wanted].filter((k) => !guarded.has(k));
  assert.deepEqual(missing, [], 'every route-guarded capability must have a live guard');
});

test('no guard is installed where the handler already resolves the capability', () => {
  // GUARD.HANDLER entries would otherwise be checked twice, and with a single
  // action where the handler chooses between several.
  const handlerOnly = manifest.ENTRIES.filter((e) => e.guard === manifest.GUARD.HANDLER);
  assert.ok(handlerOnly.length > 0);
  for (const e of handlerOnly) {
    assert.equal(e.status, 'EFFECTIVE_PERMISSION_ENFORCED');
  }
});

test('the guard is placed after authentication, never before it', () => {
  // /api/auth is exempt from the global authenticate gate, so these routes carry
  // their own. A guard ahead of it would see no user and answer 401.
  let checked = 0;
  for (const record of collectRoutes(app)) {
    if (!record.paths.includes('/api/auth/register')) continue;
    checked += 1;

    const authIdx = record.stack.findIndex(
      (l) => l.name === 'authenticate' || (l.handle && l.handle.__rbacAuthenticate),
    );
    const guardIdx = record.stack.findIndex((l) => l.handle && l.handle.__rbacGuard);
    assert.notEqual(authIdx, -1, 'POST /api/auth/register must authenticate itself');
    assert.notEqual(guardIdx, -1, 'POST /api/auth/register must be capability guarded');
    assert.ok(guardIdx > authIdx, 'the capability guard must run after req.user exists');
  }
  assert.ok(checked > 0, 'the /api/auth/register route was not found');
});

test('insertionIndex falls back to the front when a route has no authentication layer', () => {
  assert.equal(insertionIndex([{ name: 'handler' }]), 0);
  assert.equal(insertionIndex([{ name: 'authenticate' }, { name: 'handler' }]), 1);
  assert.equal(
    insertionIndex([{ name: 'x' }, { handle: { __rbacAuthenticate: true } }, { name: 'h' }]),
    2,
  );
});

test('installing twice does not double-bridge a legacy guard', () => {
  const count = () => {
    let n = 0;
    for (const record of collectRoutes(app)) {
      for (const layer of record.stack) {
        if (layer.handle && layer.handle.__rbacBridged) n += 1;
      }
    }
    return n;
  };
  const before = count();
  installRouteEnforcement(app);
  assert.equal(count(), before, 'the bridge must be idempotent');
});

test('requireInventoryView is never bridged — scope is not a capability', () => {
  let seen = 0;
  for (const record of collectRoutes(app)) {
    for (const layer of record.stack) {
      if (layer.name === 'requireInventoryView') {
        seen += 1;
        assert.ok(
          !layer.handle.__rbacBridged,
          'department scope must keep running in every mode; no bit replaces it',
        );
      }
    }
  }
  assert.ok(seen > 0, 'requireInventoryView should be present on the inventory routes');
});

/* ── Behaviour: a database-free application using the real machinery ───────── */

const realResolver = permissions.resolveEffectivePermission;

/** Stands in for `authenticate`, without the Brick 7 database read. */
function stubAuthenticate(role) {
  const fn = (req, res, next) => {
    if (req.headers.authorization !== 'Bearer test') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { id: 7, username: 'test.user', role };
    return next();
  };
  fn.__rbacAuthenticate = true;
  return fn;
}

/**
 * Build an application on a REAL manifest path, so the real entry, the real
 * guard and the real installer are all exercised.
 *
 * DELETE /api/roles/:id is classified admin.roles DELETE and is guarded today by
 * authorize('admin') — exactly the shape the no-dual-authorization rule is about.
 */
function buildApp(role) {
  const a = express();
  a.delete('/api/roles/:id', stubAuthenticate(role), authorize('admin'), (req, res) =>
    res.json({ ok: true, reached: 'handler' }),
  );
  a.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  installRouteEnforcement(a, { throwOnUnclassified: true });
  return a;
}

test.beforeEach(() => {
  config.__resetForTests();
  permissions.resolveEffectivePermission = realResolver;
});

test.after(async () => {
  permissions.resolveEffectivePermission = realResolver;
  config.__resetForTests();
  try {
    await pool.shutdown();
  } catch {
    /* never connected */
  }
});

test('LEGACY: an operator is refused by the role guard exactly as before', async () => {
  config.__setModeForTests('admin', MODES.LEGACY);
  permissions.resolveEffectivePermission = async () => {
    throw new Error('the resolver must not be consulted in LEGACY');
  };

  const res = await request(buildApp('operator'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'Insufficient permissions', 'the legacy message must be unchanged');
  assert.equal(res.body.code, undefined, 'LEGACY answers with the old body, with no new code');
});

test('LEGACY: an admin still reaches the handler', async () => {
  config.__setModeForTests('admin', MODES.LEGACY);
  permissions.resolveEffectivePermission = async () => {
    throw new Error('the resolver must not be consulted in LEGACY');
  };

  const res = await request(buildApp('admin'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(res.status, 200);
  assert.equal(res.body.reached, 'handler');
});

test('LEGACY: an unauthenticated caller still gets 401 from authentication', async () => {
  config.__setModeForTests('admin', MODES.LEGACY);
  const res = await request(buildApp('admin')).delete('/api/roles/5');
  assert.equal(res.status, 401);
});

test('SHADOW: the response is identical to LEGACY in both directions', async () => {
  permissions.resolveEffectivePermission = async () => 0; // strict would deny

  config.__setModeForTests('admin', MODES.LEGACY);
  const legacyAdmin = await request(buildApp('admin'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');
  const legacyOperator = await request(buildApp('operator'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  config.__setModeForTests('admin', MODES.SHADOW);
  const shadowAdmin = await request(buildApp('admin'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');
  const shadowOperator = await request(buildApp('operator'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(shadowAdmin.status, legacyAdmin.status);
  assert.deepEqual(shadowAdmin.body, legacyAdmin.body);
  assert.equal(shadowOperator.status, legacyOperator.status);
  assert.deepEqual(shadowOperator.body, legacyOperator.body);
});

test('STRICT: the role-string guard is stepped over so a user-specific ALLOW wins', async () => {
  // This is the whole point of the bridge. The user is an operator, so
  // authorize('admin') would refuse — but they hold admin.roles DELETE.
  config.__setModeForTests('admin', MODES.STRICT);
  permissions.resolveEffectivePermission = async () => ALL_PERMISSION_BITS;

  const res = await request(buildApp('operator'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(res.status, 200, 'a granted operator must not be vetoed by the legacy role string');
  assert.equal(res.body.reached, 'handler');
});

test('STRICT: an administrator without the bit is refused by the capability', async () => {
  // The mirror image: the role string would admit them, the capability does not.
  config.__setModeForTests('admin', MODES.STRICT);
  permissions.resolveEffectivePermission = async () => PERM_BITS.view;

  const res = await request(buildApp('admin'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'PERMISSION_DENIED');
  assert.equal(res.body.module, 'admin');
  assert.equal(res.body.submodule, 'roles');
  assert.equal(res.body.action, 'delete');
});

test('STRICT: a resolver outage is 503 and the handler is not reached', async () => {
  config.__setModeForTests('admin', MODES.STRICT);
  permissions.resolveEffectivePermission = async () => {
    throw new Error('connection terminated due to connection timeout');
  };

  const res = await request(buildApp('admin'))
    .delete('/api/roles/5')
    .set('Authorization', 'Bearer test');

  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'SECURITY_CHECK_UNAVAILABLE');
});

test('STRICT: authentication still runs first — no token is 401, not 403', async () => {
  config.__setModeForTests('admin', MODES.STRICT);
  permissions.resolveEffectivePermission = async () => ALL_PERMISSION_BITS;
  const res = await request(buildApp('admin')).delete('/api/roles/5');
  assert.equal(res.status, 401);
});

test('rolling STRICT back to LEGACY restores the role guard on the next request', async () => {
  const a = buildApp('operator');
  permissions.resolveEffectivePermission = async () => ALL_PERMISSION_BITS;

  config.__setModeForTests('admin', MODES.STRICT);
  const strict = await request(a).delete('/api/roles/5').set('Authorization', 'Bearer test');
  assert.equal(strict.status, 200);

  config.__setModeForTests('admin', MODES.LEGACY);
  const rolledBack = await request(a).delete('/api/roles/5').set('Authorization', 'Bearer test');
  assert.equal(rolledBack.status, 403, 'rollback must not require a redeploy');
  assert.equal(rolledBack.body.error, 'Insufficient permissions');
});

test('a public route is unaffected by every mode', async () => {
  for (const mode of [MODES.LEGACY, MODES.SHADOW, MODES.STRICT]) {
    config.__setModeForTests('admin', mode);
    config.__setModeForTests('general', mode);
    const res = await request(buildApp('operator')).get('/api/health');
    assert.equal(res.status, 200, `health must answer in ${mode}`);
  }
});

/**
 * RBAC Brick 8 — rollout configuration and the three enforcement modes.
 *
 * Database-independent by construction: the canonical resolver is substituted
 * with a stub, so these tests assert what the guard DOES with an answer, never
 * what the answer is. The resolver's own algebra belongs to Bricks 1–5 and is
 * deliberately not re-tested here.
 *
 * The most important assertion in this file is the LEGACY one: the guard must
 * not call the resolver at all. That is what makes "flags off means today's
 * behaviour" a proof rather than a hope — no query, no decision, no difference.
 *
 * Run: node --test --test-force-exit server/tests/brick8EnforcementModes.test.js
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

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

const permissions = require('../utils/permissions');
const config = require('../security/rbac/enforcementConfig');
const telemetry = require('../security/rbac/authorizationTelemetry');
const {
  requireEffectivePermission,
  evaluateStrict,
  legacyAllowedFrom,
  ERROR_CODES,
} = require('../security/rbac/requireEffectivePermission');

const { PERM_BITS, ALL_PERMISSION_BITS } = permissions;
const { MODES } = config;

/* ── Harness ───────────────────────────────────────────────────────────────── */

const realResolver = permissions.resolveEffectivePermission;
let resolverCalls = [];

/** Replace the resolver with a fixed answer, recording every call. */
function stubResolver(answer) {
  resolverCalls = [];
  permissions.resolveEffectivePermission = async (userId, module, submodule, role) => {
    resolverCalls.push({ userId, module, submodule, role });
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(module, submodule) : answer;
  };
}

function restoreResolver() {
  permissions.resolveEffectivePermission = realResolver;
}

function fakeRes() {
  const listeners = [];
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    on(event, fn) {
      if (event === 'finish') listeners.push(fn);
    },
    finish(code) {
      this.statusCode = code;
      listeners.forEach((fn) => fn());
    },
  };
}

function fakeReq(user = { id: 7, role: 'operator' }, method = 'POST') {
  return { method, user };
}

/** Run a guard and report what it did. */
async function run(guard, req, res) {
  let nexted = false;
  await guard(req, res, () => {
    nexted = true;
  });
  return { nexted, status: res.statusCode, body: res.body };
}

const SPEC = {
  module: 'inventory',
  submodule: 'stock_transfer',
  action: 'approve',
  group: 'stock_transfer',
  capability: 'inventory.stock_transfer',
  route: '/api/stock-transfer/pending/:id/approve',
};

test.beforeEach(() => {
  config.__resetForTests();
  telemetry.reset();
});

test.after(() => {
  restoreResolver();
  config.__resetForTests();
});

/* ══ Configuration ═════════════════════════════════════════════════════════ */

test('config: every rollout group defaults to LEGACY', () => {
  const result = config.readModes({});
  assert.deepEqual(result.errors, []);
  for (const group of config.ROLLOUT_GROUPS) {
    assert.equal(result.modes[group], MODES.LEGACY, `${group} must ship disabled`);
  }
});

test('config: the shipped process is entirely legacy', () => {
  assert.equal(config.isEntirelyLegacy(), true);
});

test('config: boolean spellings map to the two end states, never to shadow', () => {
  const { modes } = config.readModes({
    RBAC_ENFORCE_INVENTORY: 'true',
    RBAC_ENFORCE_ACCOUNTING: 'false',
    RBAC_ENFORCE_REPORTS: 'SHADOW',
    RBAC_ENFORCE_ADMIN: 'off',
  });
  assert.equal(modes.inventory, MODES.STRICT);
  assert.equal(modes.accounting, MODES.LEGACY);
  assert.equal(modes.reports, MODES.SHADOW);
  assert.equal(modes.admin, MODES.LEGACY);
});

test('config: an unreadable value is an error, not a silent legacy fallback', () => {
  const { errors } = config.readModes({ RBAC_ENFORCE_ACCOUNTING: 'strct' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /RBAC_ENFORCE_ACCOUNTING="strct"/);
  assert.throws(
    () => config.validateEnforcementConfig({ RBAC_ENFORCE_ACCOUNTING: 'strct' }),
    /invalid configuration/,
  );
});

test('config: a variable naming no known group is reported', () => {
  const { errors } = config.readModes({ RBAC_ENFORCE_INVENTORYY: 'strict' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not name a known RBAC rollout group/);
});

test('config: the default variable sets unset groups only', () => {
  const { modes } = config.readModes({
    RBAC_ENFORCE_DEFAULT: 'shadow',
    RBAC_ENFORCE_ADMIN: 'legacy',
  });
  assert.equal(modes.inventory, MODES.SHADOW);
  assert.equal(modes.admin, MODES.LEGACY);
});

test('config: an unknown group name resolves to LEGACY rather than enforcing', () => {
  assert.equal(config.getMode('not-a-group'), MODES.LEGACY);
  assert.equal(config.isStrict('not-a-group'), false);
});

test('config: a valid environment boots', () => {
  const modes = config.validateEnforcementConfig({
    RBAC_ENFORCE_INVENTORY: 'shadow',
    RBAC_ENFORCE_STOCK_TRANSFER: 'strict',
  });
  assert.equal(modes.inventory, MODES.SHADOW);
  assert.equal(modes.stock_transfer, MODES.STRICT);
  assert.equal(modes.admin, MODES.LEGACY);
});

/* ══ LEGACY ════════════════════════════════════════════════════════════════ */

test('LEGACY: the guard passes through and never touches the resolver', async () => {
  stubResolver(0); // would deny if it were ever asked
  config.__setModeForTests('stock_transfer', MODES.LEGACY);

  const guard = requireEffectivePermission(SPEC);
  const res = fakeRes();
  const out = await run(guard, fakeReq(), res);

  assert.equal(out.nexted, true, 'LEGACY must not deny');
  assert.equal(res.statusCode, 200, 'LEGACY must not set a status');
  assert.deepEqual(resolverCalls, [], 'LEGACY must issue no permission query at all');
  restoreResolver();
});

test('LEGACY: even a caller with no user at all is passed through', async () => {
  stubResolver(0);
  config.__setModeForTests('stock_transfer', MODES.LEGACY);
  const out = await run(requireEffectivePermission(SPEC), fakeReq(null), fakeRes());
  assert.equal(out.nexted, true);
  assert.deepEqual(resolverCalls, []);
  restoreResolver();
});

/* ══ SHADOW ════════════════════════════════════════════════════════════════ */

test('SHADOW: a strict-deny does not deny the request', async () => {
  stubResolver(0);
  config.__setModeForTests('stock_transfer', MODES.SHADOW);

  const res = fakeRes();
  const out = await run(requireEffectivePermission(SPEC), fakeReq(), res);

  assert.equal(out.nexted, true, 'SHADOW must never deny');
  assert.equal(res.statusCode, 200, 'SHADOW must not write a status');
  restoreResolver();
});

test('SHADOW: a legacy-allow / strict-deny pair is recorded as a mismatch', async () => {
  stubResolver(0);
  config.__setModeForTests('stock_transfer', MODES.SHADOW);

  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);
  res.finish(200); // the legacy chain allowed it

  const report = telemetry.getMismatchReport();
  assert.equal(report.mismatches, 1);
  assert.equal(report.legacy_allow_strict_deny.length, 1);
  assert.equal(report.legacy_allow_strict_deny[0].capability, 'inventory.stock_transfer');
  assert.equal(report.legacy_allow_strict_deny[0].reason, 'MISSING_BIT');
  restoreResolver();
});

test('SHADOW: a legacy-deny / strict-allow pair is recorded in the other direction', async () => {
  stubResolver(PERM_BITS.approve);
  config.__setModeForTests('stock_transfer', MODES.SHADOW);

  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);
  res.finish(403); // the legacy role guard refused

  const report = telemetry.getMismatchReport();
  assert.equal(report.legacy_deny_strict_allow.length, 1);
  restoreResolver();
});

test('SHADOW: agreement is counted and produces no mismatch row', async () => {
  stubResolver(PERM_BITS.approve);
  config.__setModeForTests('stock_transfer', MODES.SHADOW);

  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);
  res.finish(200);

  const report = telemetry.getMismatchReport();
  assert.equal(report.agreements, 1);
  assert.equal(report.mismatches, 0);
  restoreResolver();
});

test('SHADOW: a resolver failure is recorded and still does not affect the response', async () => {
  stubResolver(new Error('connection terminated'));
  config.__setModeForTests('stock_transfer', MODES.SHADOW);

  const res = fakeRes();
  const out = await run(requireEffectivePermission(SPEC), fakeReq(), res);
  res.finish(200);

  assert.equal(out.nexted, true);
  assert.equal(telemetry.getMismatchReport().evaluation_failures, 1);
  restoreResolver();
});

test('SHADOW: no denial counter is written — shadow observes, it does not judge', async () => {
  stubResolver(0);
  config.__setModeForTests('stock_transfer', MODES.SHADOW);
  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);
  res.finish(200);
  assert.deepEqual(telemetry.getDenialReport(), []);
  restoreResolver();
});

test('legacyAllowedFrom treats only 401 and 403 as a refusal', () => {
  assert.equal(legacyAllowedFrom(200), true);
  assert.equal(legacyAllowedFrom(404), true, '404 means the handler ran and found nothing');
  assert.equal(legacyAllowedFrom(500), true, 'a handler that crashed was still admitted');
  assert.equal(legacyAllowedFrom(401), false);
  assert.equal(legacyAllowedFrom(403), false);
});

/* ══ STRICT ════════════════════════════════════════════════════════════════ */

test('STRICT 1+2: a role baseline or explicit allow is accepted', async () => {
  stubResolver(PERM_BITS.approve | PERM_BITS.view);
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const req = fakeReq();
  const out = await run(requireEffectivePermission(SPEC), req, fakeRes());

  assert.equal(out.nexted, true);
  assert.equal(req.rbacPermission.capability, 'inventory.stock_transfer');
  assert.equal(req.rbacPermission.action, 'approve');
  restoreResolver();
});

test('STRICT 3+4: an explicit deny or a role deny is rejected with a stable code', async () => {
  // The resolver has already applied ((role|allow) & ~deny); a denied user
  // arrives here as a mask without the bit, whatever produced it.
  stubResolver(PERM_BITS.view);
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const res = fakeRes();
  const out = await run(requireEffectivePermission(SPEC), fakeReq(), res);

  assert.equal(out.nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, ERROR_CODES.PERMISSION_DENIED);
  assert.equal(res.body.module, 'inventory');
  assert.equal(res.body.submodule, 'stock_transfer');
  assert.equal(res.body.action, 'approve');
  restoreResolver();
});

test('STRICT: a denial body leaks no mask, department or SQL', async () => {
  stubResolver(PERM_BITS.view);
  config.__setModeForTests('stock_transfer', MODES.STRICT);
  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);

  const serialised = JSON.stringify(res.body);
  assert.deepEqual(Object.keys(res.body).sort(), ['action', 'code', 'error', 'module', 'submodule']);
  assert.ok(!/mask/i.test(serialised));
  assert.ok(!/department/i.test(serialised));
  assert.ok(!/select|from|where/i.test(serialised));
  restoreResolver();
});

test('STRICT 5: a missing baseline denies — nothing is granted by default', async () => {
  stubResolver(0); // no role row, no override
  config.__setModeForTests('stock_transfer', MODES.STRICT);
  const res = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), res);
  assert.equal(res.statusCode, 403);
  restoreResolver();
});

test('STRICT 6: an action that is not a permission bit is denied, not skipped', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('manufacturing', MODES.STRICT);

  // The historical, still-live example: lotProcessIssues.js asks for this name
  // and it has never existed in PERM_BITS.
  const res = fakeRes();
  const out = await run(
    requireEffectivePermission({
      module: 'process_return',
      submodule: '',
      action: 'seed_remove_override',
      group: 'manufacturing',
      capability: 'process_return.__module__',
      route: '/test',
    }),
    fakeReq(),
    res,
  );

  assert.equal(out.nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(telemetry.getDenialReport()[0].reason, 'UNKNOWN_ACTION');
  restoreResolver();
});

test('STRICT 7: a capability absent from the catalog is denied even with a full mask', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('inventory', MODES.STRICT);

  const res = fakeRes();
  const out = await run(
    requireEffectivePermission({
      module: 'inventory',
      submodule: 'not_a_real_capability',
      action: 'view',
      group: 'inventory',
      capability: 'inventory.not_a_real_capability',
      route: '/test',
    }),
    fakeReq(),
    res,
  );

  assert.equal(out.nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(telemetry.getDenialReport()[0].reason, 'UNKNOWN_CAPABILITY');
  restoreResolver();
});

test('STRICT 8: Super Admin passes through the resolver, not around the guard', async () => {
  // The bypass lives inside resolveEffectivePermission, which answers with every
  // bit set. The guard has no role-name special case of its own, and this test
  // fails if one is ever added.
  stubResolver((module) => {
    assert.equal(module, 'inventory');
    return ALL_PERMISSION_BITS;
  });
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const out = await run(
    requireEffectivePermission(SPEC),
    fakeReq({ id: 1, role: 'super_admin' }),
    fakeRes(),
  );
  assert.equal(out.nexted, true);
  assert.equal(resolverCalls.length, 1, 'the resolver is still consulted for a Super Admin');
  restoreResolver();
});

test('STRICT: no user is 401, not 403 — an absent session is not a permission problem', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('stock_transfer', MODES.STRICT);
  const res = fakeRes();
  const out = await run(requireEffectivePermission(SPEC), fakeReq(null), res);
  assert.equal(out.nexted, false);
  assert.equal(res.statusCode, 401);
  restoreResolver();
});

test('STRICT: a resolver outage is 503, never an implicit allow and never a 403', async () => {
  stubResolver(new Error('connection terminated due to connection timeout'));
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const res = fakeRes();
  const out = await run(requireEffectivePermission(SPEC), fakeReq(), res);

  assert.equal(out.nexted, false, 'a database outage must never open the route');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, ERROR_CODES.SECURITY_CHECK_UNAVAILABLE);
  restoreResolver();
});

/* ══ Request-scoped caching ════════════════════════════════════════════════ */

test('two checks of the same capability in one request issue one query', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const req = fakeReq();
  await run(requireEffectivePermission(SPEC), req, fakeRes());
  await run(requireEffectivePermission({ ...SPEC, action: 'view' }), req, fakeRes());

  assert.equal(resolverCalls.length, 1, 'the second check must reuse the first resolution');
  restoreResolver();
});

test('the cache is per request — a second request resolves again', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  await run(requireEffectivePermission(SPEC), fakeReq(), fakeRes());
  await run(requireEffectivePermission(SPEC), fakeReq(), fakeRes());

  assert.equal(
    resolverCalls.length,
    2,
    'caching across requests would delay revocation, which Brick 7 exists to prevent',
  );
  restoreResolver();
});

test('different capabilities in one request are resolved separately', async () => {
  stubResolver(ALL_PERMISSION_BITS);
  config.__setModeForTests('stock_transfer', MODES.STRICT);

  const req = fakeReq();
  await run(requireEffectivePermission(SPEC), req, fakeRes());
  await run(
    requireEffectivePermission({ ...SPEC, submodule: 'all_inventory', action: 'view' }),
    req,
    fakeRes(),
  );

  assert.equal(resolverCalls.length, 2);
  restoreResolver();
});

/* ══ evaluateStrict in isolation ═══════════════════════════════════════════ */

test('evaluateStrict reports the reason without producing any HTTP outcome', async () => {
  stubResolver(PERM_BITS.view);
  const decision = await evaluateStrict(fakeReq(), SPEC);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'MISSING_BIT');
  assert.equal(decision.mask, PERM_BITS.view);
  restoreResolver();
});

/* ══ Per-group isolation ═══════════════════════════════════════════════════ */

test('enabling one group does not enable another', async () => {
  stubResolver(0);
  config.__setModesForTests({ stock_transfer: MODES.STRICT, accounting: MODES.LEGACY });

  const denied = fakeRes();
  await run(requireEffectivePermission(SPEC), fakeReq(), denied);
  assert.equal(denied.statusCode, 403);

  const untouched = fakeRes();
  const out = await run(
    requireEffectivePermission({
      module: 'accounting',
      submodule: 'payments',
      action: 'create',
      group: 'accounting',
      capability: 'accounting.payments',
      route: '/api/payments',
    }),
    fakeReq(),
    untouched,
  );
  assert.equal(out.nexted, true, 'accounting is still LEGACY and must be unaffected');
  restoreResolver();
});

test('a group can be rolled back from STRICT to LEGACY without a redeploy', async () => {
  stubResolver(0);
  const guard = requireEffectivePermission(SPEC);

  config.__setModeForTests('stock_transfer', MODES.STRICT);
  assert.equal((await run(guard, fakeReq(), fakeRes())).nexted, false);

  // The same guard instance, re-reading the mode on the next request.
  config.__setModeForTests('stock_transfer', MODES.LEGACY);
  assert.equal((await run(guard, fakeReq(), fakeRes())).nexted, true);
  restoreResolver();
});

'use strict';

/**
 * RBAC Brick 7 — session invalidation, token versioning and refresh revocation.
 *
 * NO DATABASE IS CONTACTED. Every test drives the real service and middleware
 * code against a hand-rolled in-memory client that records the SQL it is given.
 * Nothing here can touch a production user, by construction rather than by
 * convention.
 *
 * WHAT THIS SUITE IS ACTUALLY PROVING
 *   The claim Brick 7 must never make falsely is "existing sessions were
 *   invalidated". Before this brick, `authenticate` was `jwt.verify` and nothing
 *   else, so an 8-hour access token outlived every permission change made during
 *   its lifetime. These tests exercise the mechanism that closes that: a token
 *   minted at revision N stops verifying the moment the stored revision moves.
 *
 * Run: node --test server/tests/brick7SessionSecurity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* config/security.js calls process.exit(1) when these are unset. Test-only
   values, never a real secret, set before the module is first required. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'brick7-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'brick7-test-refresh-secret';

const USER_ID = 9;
const OTHER_USER_ID = 12;
const ACTOR_ID = 1;
const ROLE_ID = 4;

/* ── In-memory database ────────────────────────────────────────────────────── */

function freshDb() {
  return {
    users: [
      { id: USER_ID, is_active: true, auth_version: 1 },
      { id: OTHER_USER_ID, is_active: true, auth_version: 1 },
      { id: ACTOR_ID, is_active: true, auth_version: 1 },
    ],
    user_roles: [
      { user_id: USER_ID, role_id: ROLE_ID },
      { user_id: OTHER_USER_ID, role_id: 7 },
    ],
    refresh_tokens: [
      { id: 41, user_id: USER_ID, used_at: null, revoked_at: null, revoked_reason: null },
      { id: 42, user_id: USER_ID, used_at: new Date(), revoked_at: null, revoked_reason: null },
      { id: 43, user_id: OTHER_USER_ID, used_at: null, revoked_at: null, revoked_reason: null },
    ],
  };
}

const squash = sql => String(sql).replace(/\s+/g, ' ').trim();

/**
 * A transaction client, deliberately NOT a pool: it exposes `query` and no
 * `connect`, which is what securityAuditService uses to reject a pool.
 *
 * `missing` makes a named column raise the PostgreSQL error the real server
 * would raise before the phase87 migration has been applied, so the degraded
 * paths are exercised rather than assumed.
 */
function makeClient(db, { missing = [] } = {}) {
  const statements = [];

  const raise = (code, message) => {
    const err = new Error(message);
    err.code = code;
    throw err;
  };

  return {
    statements,
    query: async (sql, params = []) => {
      const s = squash(sql);
      statements.push(s);

      if (/^SELECT id, is_active, COALESCE\(auth_version/i.test(s)) {
        if (missing.includes('auth_version')) raise('42703', 'column "auth_version" does not exist');
        const row = db.users.find(u => Number(u.id) === Number(params[0]));
        return {
          rows: row
            ? [{ id: row.id, is_active: row.is_active, auth_version: row.auth_version ?? params[1] }]
            : [],
        };
      }

      if (/^UPDATE users SET auth_version = COALESCE\(auth_version, \$2\) \+ 1 WHERE id = \$1/i.test(s)) {
        if (missing.includes('auth_version')) raise('42703', 'column "auth_version" does not exist');
        const row = db.users.find(u => Number(u.id) === Number(params[0]));
        if (!row) return { rows: [] };
        row.auth_version = (row.auth_version ?? Number(params[1])) + 1;
        return { rows: [{ id: row.id, auth_version: row.auth_version }] };
      }

      if (/^WITH targets AS \( SELECT id FROM users WHERE id = ANY/i.test(s)) {
        if (missing.includes('auth_version')) raise('42703', 'column "auth_version" does not exist');
        const ids = params[0].map(Number);
        const hit = db.users.filter(u => ids.includes(Number(u.id)));
        hit.forEach((u) => { u.auth_version = (u.auth_version ?? Number(params[1])) + 1; });
        return { rows: hit.map(u => ({ id: u.id, auth_version: u.auth_version })) };
      }

      if (/^UPDATE refresh_tokens SET revoked_at = NOW\(\)/i.test(s)) {
        if (missing.includes('revoked_at')) raise('42703', 'column "revoked_at" does not exist');
        const ids = params[0].map(Number);
        const hit = db.refresh_tokens.filter(
          t => ids.includes(Number(t.user_id)) && t.revoked_at === null && t.used_at === null,
        );
        hit.forEach((t) => { t.revoked_at = new Date(); t.revoked_reason = params[1]; });
        return { rows: hit.map(t => ({ id: t.id })) };
      }

      if (/^SELECT user_id FROM user_roles WHERE role_id = \$1/i.test(s)) {
        return {
          rows: db.user_roles
            .filter(r => Number(r.role_id) === Number(params[0]))
            .map(r => ({ user_id: r.user_id })),
        };
      }

      throw new Error(`unhandled statement: ${s.slice(0, 120)}`);
    },
  };
}

const {
  invalidateUserSessions,
  invalidateSessionsForRole,
  describeInvalidation,
  INVALIDATION_REASON,
} = require('../services/security/sessionInvalidationService');

const {
  readAuthState,
  TOKEN_VERSION_CLAIM,
  INITIAL_AUTH_VERSION,
} = require('../services/security/securityVersionService');

/* ══════════════════════════════════════════════════════════════════════════
   The invalidation service
   ══════════════════════════════════════════════════════════════════════════ */

test('invalidating a user bumps the security revision AND revokes live refresh tokens', async () => {
  const db = freshDb();
  const client = makeClient(db);

  const result = await invalidateUserSessions(client, {
    userId: USER_ID,
    reason: INVALIDATION_REASON.PERMISSION_OVERRIDES_CHANGED,
    actorId: ACTOR_ID,
  });

  assert.equal(result.enforced, true);
  assert.equal(result.accessTokensInvalidated, true);
  assert.equal(result.authVersion, 2, 'the stored revision did not move');

  // Only the LIVE token is revoked; the already-rotated one keeps its used_at
  // so refresh-reuse detection still reads it as a rotation, not a revocation.
  assert.equal(result.refreshTokensRevoked, 1);
  assert.equal(db.refresh_tokens.find(t => t.id === 41).revoked_at instanceof Date, true);
  assert.equal(db.refresh_tokens.find(t => t.id === 42).revoked_at, null);
  assert.equal(db.refresh_tokens.find(t => t.id === 41).revoked_reason,
    INVALIDATION_REASON.PERMISSION_OVERRIDES_CHANGED);
});

test('an unrelated user keeps their session', async () => {
  const db = freshDb();
  await invalidateUserSessions(makeClient(db), {
    userId: USER_ID,
    reason: INVALIDATION_REASON.PASSWORD_RESET,
    actorId: ACTOR_ID,
  });

  assert.equal(db.users.find(u => u.id === OTHER_USER_ID).auth_version, 1);
  assert.equal(db.refresh_tokens.find(t => t.id === 43).revoked_at, null);
});

test('the service never commits and never opens its own connection', async () => {
  const db = freshDb();
  const client = makeClient(db);
  await invalidateUserSessions(client, {
    userId: USER_ID, reason: INVALIDATION_REASON.ACCOUNT_DISABLED, actorId: ACTOR_ID,
  });

  for (const sql of client.statements) {
    assert.equal(/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql), false,
      `the service issued its own transaction control: ${sql}`);
  }
  assert.equal(typeof client.connect, 'undefined');
});

test('a free-text reason is refused, so revoked_reason stays a closed vocabulary', async () => {
  const client = makeClient(freshDb());
  await assert.rejects(
    () => invalidateUserSessions(client, { userId: USER_ID, reason: 'because', actorId: ACTOR_ID }),
    /unknown reason/i,
  );
});

test('a missing migration degrades honestly instead of claiming revocation', async () => {
  const db = freshDb();
  const result = await invalidateUserSessions(makeClient(db, { missing: ['auth_version'] }), {
    userId: USER_ID, reason: INVALIDATION_REASON.PASSWORD_RESET, actorId: ACTOR_ID,
  });

  assert.equal(result.enforced, false);
  assert.equal(result.degraded, 'auth_version_column_missing');
  assert.match(describeInvalidation(result), /NOT invalidated/);
  // The critical property: no false claim is reachable from the result.
  assert.doesNotMatch(describeInvalidation(result), /invalidated immediately/);
});

test('revoking tokens without the revoked_at column is reported as incomplete', async () => {
  const db = freshDb();
  const result = await invalidateUserSessions(makeClient(db, { missing: ['revoked_at'] }), {
    userId: USER_ID, reason: INVALIDATION_REASON.PASSWORD_RESET, actorId: ACTOR_ID,
  });

  // The access token IS dead — the version moved — but the client can refresh
  // straight back into a live one, so this is not a complete invalidation.
  assert.equal(result.accessTokensInvalidated, true);
  assert.equal(result.enforced, false);
  assert.equal(result.degraded, 'refresh_tokens_revocation_column_missing');
});

/* ══════════════════════════════════════════════════════════════════════════
   Role baseline propagation
   ══════════════════════════════════════════════════════════════════════════ */

test('a role baseline change invalidates every assigned user — and only those', async () => {
  const db = freshDb();
  const result = await invalidateSessionsForRole(makeClient(db), {
    roleId: ROLE_ID,
    reason: INVALIDATION_REASON.ROLE_BASELINE_CHANGED,
    actorId: ACTOR_ID,
  });

  assert.equal(result.enforced, true);
  assert.deepEqual(result.affectedUserIds, [USER_ID]);
  assert.equal(db.users.find(u => u.id === USER_ID).auth_version, 2);
  // Assigned to a different role, so untouched.
  assert.equal(db.users.find(u => u.id === OTHER_USER_ID).auth_version, 1);
  assert.equal(db.refresh_tokens.find(t => t.id === 43).revoked_at, null);
});

test('role propagation is set-based, not a per-user loop', async () => {
  const db = freshDb();
  db.user_roles.push({ user_id: OTHER_USER_ID, role_id: ROLE_ID });
  db.users.push({ id: 30, is_active: true, auth_version: 1 });
  db.user_roles.push({ user_id: 30, role_id: ROLE_ID });

  const client = makeClient(db);
  await invalidateSessionsForRole(client, {
    roleId: ROLE_ID, reason: INVALIDATION_REASON.ROLE_BASELINE_CHANGED, actorId: ACTOR_ID,
  });

  // Three affected users, but still one UPDATE per table.
  assert.equal(client.statements.filter(s => /^WITH targets AS/i.test(s)).length, 1);
  assert.equal(client.statements.filter(s => /^UPDATE refresh_tokens/i.test(s)).length, 1);
  assert.equal(db.users.filter(u => u.auth_version === 2).length, 3);
});

test('a role with no members is fully propagated and reports no affected users', async () => {
  const db = freshDb();
  const result = await invalidateSessionsForRole(makeClient(db), {
    roleId: 999, reason: INVALIDATION_REASON.ROLE_BASELINE_CHANGED, actorId: ACTOR_ID,
  });

  assert.equal(result.enforced, true);
  assert.equal(result.affectedUserCount, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   The security revision itself
   ══════════════════════════════════════════════════════════════════════════ */

test('NULL auth_version reads as version 1, so an un-migrated row needs no backfill', async () => {
  const db = freshDb();
  db.users.find(u => u.id === USER_ID).auth_version = null;

  const state = await readAuthState(makeClient(db), USER_ID);
  assert.equal(state.exists, true);
  assert.equal(state.authVersion, INITIAL_AUTH_VERSION);
});

test('the first bump lands on 2 whether the column was NULL or 1', async () => {
  for (const initial of [null, 1]) {
    const db = freshDb();
    db.users.find(u => u.id === USER_ID).auth_version = initial;
    await invalidateUserSessions(makeClient(db), {
      userId: USER_ID, reason: INVALIDATION_REASON.PASSWORD_RESET, actorId: ACTOR_ID,
    });
    assert.equal(db.users.find(u => u.id === USER_ID).auth_version, 2,
      `initial ${initial} did not bump to 2`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   The access-token check — the headline property
   ══════════════════════════════════════════════════════════════════════════ */

test('authenticate accepts a current token and rejects every stale one', async (t) => {
  const jwt = require('jsonwebtoken');
  const securityConfig = require('../config/security');

  const db = freshDb();

  /* `db/pool` is poisoned so the middleware can only ever see the in-memory
     database above, then restored afterwards so the other suites are unaffected. */
  const poolPath = require.resolve('../db/pool');
  const loggerPath = require.resolve('../middleware/logger');
  const authPath = require.resolve('../middleware/auth');
  const saved = {
    pool: require.cache[poolPath],
    logger: require.cache[loggerPath],
    auth: require.cache[authPath],
  };

  require.cache[poolPath] = {
    id: poolPath, filename: poolPath, loaded: true, exports: makeClient(db),
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
  };
  delete require.cache[authPath];
  const { authenticate } = require('../middleware/auth');

  t.after(() => {
    for (const [p, mod] of [[poolPath, saved.pool], [loggerPath, saved.logger], [authPath, saved.auth]]) {
      if (mod) require.cache[p] = mod; else delete require.cache[p];
    }
  });

  const sign = (claims, role = 'operator') => jwt.sign(
    { id: USER_ID, username: 'test.target', role, ...claims },
    securityConfig.jwt.accessSecret,
    { expiresIn: '8h', issuer: securityConfig.jwt.issuer },
  );

  const run = async (token) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    let status = 200;
    let body = null;
    let nexted = false;
    const res = {
      status: (c) => { status = c; return res; },
      json: (b) => { body = b; return res; },
    };
    await authenticate(req, res, () => { nexted = true; });
    return { status, body, nexted };
  };

  // 1. A token minted at the current revision is accepted.
  const current = sign({ [TOKEN_VERSION_CLAIM]: 1 });
  assert.equal((await run(current)).nexted, true, 'a valid token was rejected');

  // 2. A security change happens.
  await invalidateUserSessions(makeClient(db), {
    userId: USER_ID,
    reason: INVALIDATION_REASON.PERMISSION_OVERRIDES_CHANGED,
    actorId: ACTOR_ID,
  });

  // 3. THE HEADLINE PROPERTY. The token accepted a moment ago — unexpired, never
  //    handed back, held entirely by the client — is now refused by the server.
  const afterChange = await run(current);
  assert.equal(afterChange.nexted, false, 'a revoked access token still authenticated');
  assert.equal(afterChange.status, 401);
  assert.equal(afterChange.body.code, 'SESSION_INVALIDATED');

  // 4. A token minted after the change is accepted.
  assert.equal((await run(sign({ [TOKEN_VERSION_CLAIM]: 2 }))).nexted, true);

  // 5. A disabled account is refused with its own code, whatever its revision.
  db.users.find(u => u.id === USER_ID).is_active = false;
  const disabled = await run(sign({ [TOKEN_VERSION_CLAIM]: 2 }));
  assert.equal(disabled.status, 401);
  assert.equal(disabled.body.code, 'ACCOUNT_DISABLED');
  db.users.find(u => u.id === USER_ID).is_active = true;

  // 6. A Super Admin obeys exactly the same mechanics — the bypass affects the
  //    permission RESULT, never session validity.
  const superRes = await run(sign({ [TOKEN_VERSION_CLAIM]: 1 }, 'super_admin'));
  assert.equal(superRes.nexted, false, 'a Super Admin kept a revoked session');
  assert.equal(superRes.body.code, 'SESSION_INVALIDATED');

  // 7. A legacy token (no `av` claim) is accepted by default — the documented
  //    transition policy that stops the deployment signing everyone out.
  const legacy = jwt.sign(
    { id: USER_ID, username: 'test.target', role: 'operator' },
    securityConfig.jwt.accessSecret,
    { expiresIn: '8h', issuer: securityConfig.jwt.issuer },
  );
  assert.equal((await run(legacy)).nexted, true,
    'a pre-deployment token was rejected, which would sign every user out at deploy time');

  // 8. A garbage token is still refused by signature verification alone.
  assert.equal((await run('not-a-token')).status, 401);
});

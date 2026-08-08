'use strict';

/**
 * RBAC Brick 7 — the security revision that makes an issued access token
 * revocable.
 *
 * THE PROBLEM THIS SOLVES
 *   Before Brick 7, `authenticate()` was `jwt.verify` and nothing else. Access
 *   tokens live 8 hours. So an administrator who removed a permission, changed a
 *   role, disabled an account or reset a password changed only what the NEXT
 *   token would say — the token already in the user's browser kept its old
 *   authority for the rest of those 8 hours, and no amount of refresh-token
 *   revocation could touch it, because the access token was never checked
 *   against anything.
 *
 * THE MECHANISM
 *   Every access token carries `av` — the user's `users.auth_version` at mint
 *   time. Every authenticated request re-reads the stored value and requires
 *   equality. A security change increments the stored value, so every token
 *   minted before it stops verifying on the very next request.
 *
 * WHY EQUALITY ON AN INTEGER RATHER THAN AN "INVALID BEFORE" TIMESTAMP
 *   A timestamp comparison has to be made against the JWT `iat` claim, and `iat`
 *   is defined in whole seconds. A token minted in the same second as a security
 *   change would compare as older than the change and be rejected even though it
 *   was issued after it — logging a user out immediately after a legitimate
 *   re-login. An integer version has no resolution to lose: the token either
 *   carries the current revision or it does not.
 *
 * WHY NULL MEANS 1
 *   phase87 adds `auth_version` as a nullable column with no backfill,
 *   deliberately, so that adding it cannot rewrite the users table on any
 *   PostgreSQL version. Every read here therefore coalesces NULL to 1, and a
 *   user who has never had a security change is version 1 whether the column
 *   holds NULL or 1.
 *
 * TRANSACTION DISCIPLINE
 *   Every function takes an explicit `client`. Callers inside a transaction pass
 *   their own transaction client so the version bump commits or rolls back with
 *   the mutation it belongs to. Callers outside one may pass the pool. Nothing
 *   here opens a connection, issues BEGIN/COMMIT, or reaches for a pool of its
 *   own — doing so would silently break the atomicity the caller established.
 */

/** The JWT claim carrying the security revision. */
const TOKEN_VERSION_CLAIM = 'av';

/** The version a user is considered to be at before any security change. */
const INITIAL_AUTH_VERSION = 1;

/**
 * PostgreSQL error codes meaning "the phase87 migration has not run here".
 *   42703 undefined_column — users.auth_version is missing
 *   42P01 undefined_table  — used by callers touching refresh_tokens
 * Callers distinguish these from real failures so a not-yet-migrated database
 * degrades in a defined way instead of throwing an opaque 500.
 */
const UNDEFINED_COLUMN = '42703';
const UNDEFINED_TABLE = '42P01';

function isMissingSchemaError(err) {
  return Boolean(err) && (err.code === UNDEFINED_COLUMN || err.code === UNDEFINED_TABLE);
}

/**
 * The authorization-relevant state of one user, in a single indexed primary-key
 * lookup.
 *
 * COST: this is the one query Brick 7 adds to every authenticated request. It is
 * a primary-key lookup on `users`, a table small enough to live in shared
 * buffers. For comparison, every route already guarded by `checkPermission`
 * issues two to three uncached queries against `role_permissions` and
 * `user_permission_overrides` on the same request, so this is a small addition
 * to the paths that matter and the only cost on the paths that do not.
 *
 * Returns `{ exists: false }` for a deleted user rather than throwing: the
 * caller's job is to reject the token, not to explain the absence.
 */
async function readAuthState(client, userId) {
  const { rows } = await client.query(
    `SELECT id,
            is_active,
            COALESCE(auth_version, $2) AS auth_version
       FROM users
      WHERE id = $1`,
    [userId, INITIAL_AUTH_VERSION],
  );

  if (rows.length === 0) return { exists: false, isActive: false, authVersion: null };

  return {
    exists: true,
    isActive: rows[0].is_active !== false,
    authVersion: Number(rows[0].auth_version),
  };
}

/**
 * Increment one user's security revision and return the new value.
 *
 * `COALESCE(auth_version, 1) + 1` makes the first bump land on 2 whether the
 * column was NULL or 1, so a never-touched user and an explicitly-initialised
 * one behave identically.
 *
 * Returns null when the user does not exist. That is not an error here — a
 * caller invalidating sessions for a user that a concurrent transaction deleted
 * has nothing to invalidate.
 */
async function bumpAuthVersion(client, userId) {
  const { rows } = await client.query(
    `UPDATE users
        SET auth_version = COALESCE(auth_version, $2) + 1
      WHERE id = $1
      RETURNING id, auth_version`,
    [userId, INITIAL_AUTH_VERSION],
  );
  return rows.length ? Number(rows[0].auth_version) : null;
}

/**
 * Increment the security revision for many users in ONE statement.
 *
 * Used by role-baseline propagation, where the affected set is "everyone
 * assigned this role" and can be large. A per-user loop would issue N round
 * trips inside a transaction already holding row locks; this issues one.
 *
 * Ordering note: `ORDER BY id` in the CTE makes the row locks acquire in a
 * consistent order across concurrent invocations, so two administrators editing
 * two roles that share users cannot deadlock against each other.
 */
async function bumpAuthVersionForUsers(client, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();

  const { rows } = await client.query(
    `WITH targets AS (
       SELECT id FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE
     )
     UPDATE users u
        SET auth_version = COALESCE(u.auth_version, $2) + 1
       FROM targets t
      WHERE u.id = t.id
      RETURNING u.id, u.auth_version`,
    [ids, INITIAL_AUTH_VERSION],
  );

  return new Map(rows.map(r => [Number(r.id), Number(r.auth_version)]));
}

/**
 * Read the version to stamp into a token being minted right now.
 *
 * Falls back to INITIAL_AUTH_VERSION when the phase87 migration has not run, so
 * a backend deployed ahead of its migration still issues usable tokens instead
 * of failing every login. `authenticate` applies the mirror-image tolerance, and
 * the pair is what makes the deployment order recoverable rather than a cliff.
 */
async function readAuthVersionForToken(client, userId) {
  try {
    const state = await readAuthState(client, userId);
    return state.exists ? state.authVersion : INITIAL_AUTH_VERSION;
  } catch (err) {
    if (isMissingSchemaError(err)) return INITIAL_AUTH_VERSION;
    throw err;
  }
}

module.exports = {
  TOKEN_VERSION_CLAIM,
  INITIAL_AUTH_VERSION,
  isMissingSchemaError,
  readAuthState,
  bumpAuthVersion,
  bumpAuthVersionForUsers,
  readAuthVersionForToken,
};

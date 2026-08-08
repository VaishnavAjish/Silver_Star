'use strict';

/**
 * RBAC Brick 7 — the single canonical way to invalidate a user's sessions.
 *
 * WHAT "INVALIDATE" MEANS HERE, EXACTLY
 *   Two things happen, and both are necessary:
 *
 *     1. users.auth_version is incremented. Every access token minted before now
 *        carries the OLD value in its `av` claim, so `authenticate()` rejects it
 *        on the user's very next request. This is the part that actually removes
 *        stale authority, and it is server-side: a client that ignores every
 *        socket message and never calls /refresh still loses access.
 *
 *     2. Live refresh tokens are marked revoked. Without this, the user's client
 *        would answer the 401 by silently refreshing into a brand-new, fully
 *        valid token — and the invalidation would be a round trip, not a
 *        revocation.
 *
 *   Doing only (2) — which is what `refresh_tokens.revoked_at` alone would give
 *   us — leaves the already-issued 8-hour access token working. Doing only (1)
 *   lets the client mint a replacement immediately. The pair is the boundary.
 *
 * WHAT THIS DOES NOT DO
 *   It does not send a socket message and does not depend on one. Socket
 *   notification (services/eventDispatcher) stays exactly where it was, as a UX
 *   courtesy that makes a well-behaved client react promptly. It is not the
 *   security boundary, and a hostile or disconnected client cannot opt out of
 *   the two database facts above.
 *
 * TRANSACTION DISCIPLINE — THE IMPORTANT PART
 *   Every function takes the CALLER'S transaction client and never commits.
 *   The invalidation must land in the same transaction as the mutation that
 *   justified it: if the permission write rolls back, the revocation must roll
 *   back with it, or we would log a user out over a change that never happened.
 *   Equally, if the revocation fails, the permission write must not survive.
 *
 *   This is why nothing in this file requires `db/pool`. There is no way to
 *   accidentally reach a second connection from here.
 */

const {
  bumpAuthVersion,
  bumpAuthVersionForUsers,
  isMissingSchemaError,
} = require('./securityVersionService');

/**
 * Why a session was invalidated. Stored in refresh_tokens.revoked_reason
 * (VARCHAR(64)) and echoed in the audit row, so an incident review can tell an
 * administrative permission change apart from a password reset.
 *
 * These are the ONLY reasons. A caller that needs a new one adds it here, which
 * keeps the vocabulary closed and greppable.
 */
const INVALIDATION_REASON = Object.freeze({
  PASSWORD_RESET: 'password_reset',
  ACCOUNT_DISABLED: 'account_disabled',
  ROLE_CHANGED: 'role_changed',
  ROLE_ASSIGNMENT_CHANGED: 'role_assignment_changed',
  ROLE_BASELINE_CHANGED: 'role_baseline_changed',
  PERMISSION_OVERRIDES_CHANGED: 'permission_overrides_changed',
  LEGACY_PERMISSIONS_CHANGED: 'legacy_permissions_changed',
  INVENTORY_SCOPE_CHANGED: 'inventory_scope_changed',
  PRIMARY_DEPARTMENT_CHANGED: 'primary_department_changed',
  COPY_SETUP_SECURITY: 'copy_setup_security',
});

const VALID_REASONS = Object.freeze(Object.values(INVALIDATION_REASON));

/**
 * Revoke every live refresh token for a set of users, in one statement.
 *
 * `revoked_at IS NULL AND used_at IS NULL` is the live set:
 *   - used_at IS NOT NULL     already consumed by a rotation; presenting it
 *                             again trips reuse detection, so it grants nothing
 *   - revoked_at IS NOT NULL  already revoked; re-stamping would overwrite the
 *                             original revocation time and lose evidence
 *
 * Returns the number of rows actually revoked, which is what the API reports.
 * Reporting the number we INTENDED to revoke would be a claim, not a fact.
 */
async function revokeRefreshTokens(client, userIds, reason) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return 0;

  const { rows } = await client.query(
    `UPDATE refresh_tokens
        SET revoked_at = NOW(),
            revoked_reason = $2
      WHERE user_id = ANY($1::int[])
        AND revoked_at IS NULL
        AND used_at IS NULL
      RETURNING id`,
    [ids, reason],
  );
  return rows.length;
}

function assertReason(reason) {
  if (!VALID_REASONS.includes(reason)) {
    throw new Error(
      `invalidateUserSessions: unknown reason "${reason}". `
      + 'Add it to INVALIDATION_REASON rather than passing a free string.',
    );
  }
}

/**
 * Invalidate one user's sessions inside the caller's transaction.
 *
 * @param {object} client            the caller's transaction client — NOT a pool
 * @param {number} options.userId    whose sessions to invalidate
 * @param {string} options.reason    an INVALIDATION_REASON value
 * @param {number} options.actorId   the administrator responsible
 *
 * `enforced` is the field callers must report from, and it is deliberately not
 * always true. If the phase87 migration has not been applied to this database,
 * the version bump and the revocation are both impossible; rather than crash a
 * legitimate permission save, we complete the mutation and return
 * `enforced: false` with `degraded` naming the reason. The route then tells the
 * administrator that sessions were NOT invalidated instead of claiming they
 * were. A false claim of revocation is worse than a stated failure to revoke.
 */
async function invalidateUserSessions(client, { userId, reason, actorId = null } = {}) {
  assertReason(reason);
  const id = Number(userId);
  if (!Number.isInteger(id)) throw new Error('invalidateUserSessions: userId must be an integer');

  const result = {
    userId: id,
    reason,
    actorId: actorId == null ? null : Number(actorId),
    authVersion: null,
    accessTokensInvalidated: false,
    refreshTokensRevoked: 0,
    enforced: false,
    degraded: null,
  };

  try {
    const authVersion = await bumpAuthVersion(client, id);
    if (authVersion === null) {
      // The user row is gone. Nothing holds authority, so there is nothing to
      // invalidate and this is not a failure.
      result.degraded = 'user_not_found';
      return result;
    }
    result.authVersion = authVersion;
    result.accessTokensInvalidated = true;
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    result.degraded = 'auth_version_column_missing';
    return result;
  }

  try {
    result.refreshTokensRevoked = await revokeRefreshTokens(client, [id], reason);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    /* The access token is already dead — that is the part that matters — but the
       client can refresh straight back into a live one, so this is not a
       complete invalidation and must not be reported as one. */
    result.degraded = 'refresh_tokens_revocation_column_missing';
    return result;
  }

  result.enforced = true;
  return result;
}

/**
 * Invalidate every session belonging to every user assigned a role.
 *
 * WHY THIS EXISTS SEPARATELY
 *   A role's permission baseline is shared. Editing it changes the effective
 *   access of every user holding that role, none of whom is named in the
 *   request. Waiting for each of those users to be edited individually would
 *   leave their tokens carrying the old baseline for up to 8 hours.
 *
 * The membership read uses the caller's client so it sees the same snapshot as
 * the role write it accompanies — a user assigned the role by a concurrent
 * transaction is either fully inside this transaction's view or fully outside
 * it, never half.
 *
 * Set-based throughout: one SELECT, one UPDATE on users, one UPDATE on
 * refresh_tokens, regardless of how many users hold the role.
 */
async function invalidateSessionsForRole(client, { roleId, reason, actorId = null } = {}) {
  assertReason(reason);
  const id = Number(roleId);
  if (!Number.isInteger(id)) throw new Error('invalidateSessionsForRole: roleId must be an integer');

  const { rows } = await client.query(
    'SELECT user_id FROM user_roles WHERE role_id = $1 ORDER BY user_id',
    [id],
  );
  const userIds = rows.map(r => Number(r.user_id));

  const result = {
    roleId: id,
    reason,
    actorId: actorId == null ? null : Number(actorId),
    affectedUserIds: userIds,
    affectedUserCount: userIds.length,
    accessTokensInvalidated: 0,
    refreshTokensRevoked: 0,
    enforced: false,
    degraded: null,
  };

  if (userIds.length === 0) {
    // A role with no members is fully propagated the moment it is saved.
    result.enforced = true;
    return result;
  }

  try {
    const versions = await bumpAuthVersionForUsers(client, userIds);
    result.accessTokensInvalidated = versions.size;
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    result.degraded = 'auth_version_column_missing';
    return result;
  }

  try {
    result.refreshTokensRevoked = await revokeRefreshTokens(client, userIds, reason);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    result.degraded = 'refresh_tokens_revocation_column_missing';
    return result;
  }

  result.enforced = true;
  return result;
}

/**
 * A one-line, honest summary for the audit row and the admin-facing response.
 *
 * This is the only place that turns an invalidation result into prose, so there
 * is exactly one wording to review and no route can invent a stronger claim than
 * the result supports.
 */
function describeInvalidation(result) {
  if (!result) return 'No session invalidation was attempted.';
  if (result.degraded === 'user_not_found') return 'No sessions to invalidate — the user no longer exists.';
  if (!result.enforced) {
    return 'Sessions were NOT invalidated: the phase87 session-security migration '
      + 'has not been applied to this database. Existing access tokens remain valid '
      + 'until they expire.';
  }
  const revoked = result.refreshTokensRevoked;
  return 'Existing access tokens were invalidated immediately and '
    + `${revoked} refresh ${revoked === 1 ? 'token was' : 'tokens were'} revoked.`;
}

module.exports = {
  INVALIDATION_REASON,
  VALID_REASONS,
  invalidateUserSessions,
  invalidateSessionsForRole,
  revokeRefreshTokens,
  describeInvalidation,
};

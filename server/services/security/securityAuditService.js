'use strict';

/**
 * RBAC Brick 7 — the canonical write path for security audit evidence.
 *
 * WHICH STORE, AND WHY NOT A NEW ONE
 *   `permission_audit_logs` is already the healthy RBAC audit table: roles.js,
 *   adminPermissions.js and (through roles.js's exported helper) adminUsers.js
 *   all write to it today. This service consolidates those open-coded INSERTs
 *   behind one function. It does not introduce a table, a schema change or a
 *   second audit path — `middleware/auditLog.js` and the other historical audit
 *   tables are deliberately left exactly as they are, to be dealt with by a
 *   later maintenance release rather than during security hardening.
 *
 * THE ATOMICITY RULE
 *   `writeSecurityAudit` takes the caller's transaction client and never
 *   commits. For a security mutation the write and its audit row must succeed or
 *   fail together: an override change that commits without its audit row is an
 *   unexplained privilege change, and an audit row that survives a rolled-back
 *   mutation is a false record of something that never happened.
 *
 *   Before Brick 7, `adminUsers.js` called `auditLog(pool, ...)` AFTER `COMMIT`
 *   on a different connection, so a failed audit insert left the security change
 *   committed and unlogged. Passing the transaction client is what fixes that,
 *   and it is why this function refuses a pool (see `assertTransactionClient`).
 *
 * WHAT IS NEVER WRITTEN
 *   Redaction is applied to every payload, unconditionally, before serialisation.
 *   It is not the caller's job to remember: a route that carelessly passes the
 *   whole request body still cannot leak a password, a hash, an MFA secret, a
 *   refresh token or a JWT into the audit table.
 */

/**
 * Keys whose VALUES are never stored, matched case-insensitively anywhere in the
 * key name. Deliberately broad — a false redaction costs a diagnostic detail, a
 * missed one puts a credential in a table that administrators can read.
 */
const REDACTED_KEY_PATTERN = /pass|pwd|hash|secret|token|mfa|otp|credential|cookie|authorization|private/i;

const REDACTED_PLACEHOLDER = '[redacted]';

/** Depth and size ceilings so a pathological payload cannot blow up the row. */
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 500;
const MAX_SERIALISED_BYTES = 60000;

/**
 * Recursively strip anything credential-shaped.
 *
 * Cycles are handled with a `seen` set rather than a try/catch around
 * JSON.stringify, because a cycle must not cost us the whole audit row — the
 * offending branch is replaced and everything else is still recorded.
 */
function redactAuditPayload(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;

  if (typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }

  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(v => redactAuditPayload(v, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} more omitted]`);
    }
    return items;
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      /* The KEY is kept so the audit still records that a password was set —
         only the value is dropped. "reset_password with [redacted]" is evidence;
         omitting the key entirely would hide that the field was involved. */
      out[key] = REDACTED_PLACEHOLDER;
      continue;
    }
    out[key] = redactAuditPayload(item, depth + 1, seen);
  }
  return out;
}

/**
 * A pool exposes `.connect()`; a checked-out client does not. Passing the pool
 * here would put the audit row on a DIFFERENT connection from the mutation,
 * outside its transaction — exactly the bug this brick exists to fix — so it is
 * rejected loudly at the call site rather than silently producing an
 * unsynchronised audit trail.
 */
function assertTransactionClient(client, fnName) {
  if (!client || typeof client.query !== 'function') {
    throw new Error(`${fnName}: a database client is required`);
  }
  if (client.totalCount !== undefined || (typeof client.connect === 'function' && typeof client.release !== 'function')) {
    throw new Error(
      `${fnName}: received a pool, not a transaction client. Security audit rows `
      + 'must be written on the same client as the mutation they describe, or they '
      + 'can survive a rollback.',
    );
  }
}

/**
 * The project's canonical proxy-aware IP extraction, reused rather than
 * reimplemented. roles.js's audit helper already called it, so consolidating on
 * it keeps `ip_address` byte-identical to what the pre-Brick-7 audit rows hold —
 * a second, subtly different implementation here would make old and new audit
 * rows disagree about the same request.
 */
const { getClientIp } = require('../../utils/requestUtils');

/**
 * Serialise the redacted payload, keeping it inside the size ceiling.
 *
 * For a large permission set the `before`/`after` arrays can be big. Rather than
 * silently truncating the JSON — which would produce an unparseable column — an
 * oversized payload is replaced by a summary stating what was dropped, so a
 * reader can tell "too large to record in full" apart from "nothing happened".
 */
function serialiseChanges(changes) {
  if (changes === null || changes === undefined) return null;
  const redacted = redactAuditPayload(changes);
  const text = JSON.stringify(redacted);
  if (text.length <= MAX_SERIALISED_BYTES) return text;

  return JSON.stringify({
    truncated: true,
    reason: 'payload exceeded the audit size limit and was replaced by this summary',
    original_bytes: text.length,
    limit_bytes: MAX_SERIALISED_BYTES,
    keys: Array.isArray(redacted) ? ['<array>'] : Object.keys(redacted || {}),
  });
}

/**
 * Write one security audit row on the caller's transaction client.
 *
 * @param {object} client                 the caller's transaction client
 * @param {number} options.actorId        administrator performing the change
 * @param {string} options.action         e.g. 'update_user_permission_overrides'
 * @param {string} options.targetType     'user' | 'role'
 * @param {number} options.targetId       the subject of the change
 * @param {object} options.changes        before/after summary — redacted here
 * @param {object} options.req            for ip_address / user_agent
 * @param {object} options.invalidation   result from sessionInvalidationService
 * @param {string} options.category       save category, for the admin UI
 *
 * The session-invalidation result is folded into `changes` rather than given a
 * column of its own: it needs no schema change, and it keeps "what changed" and
 * "what that did to the user's sessions" in one reviewable record.
 */
async function writeSecurityAudit(client, {
  actorId,
  action,
  targetType,
  targetId,
  changes = null,
  req = null,
  invalidation = null,
  category = null,
} = {}) {
  assertTransactionClient(client, 'writeSecurityAudit');
  if (!action) throw new Error('writeSecurityAudit: action is required');

  const isPlainObject = changes && typeof changes === 'object' && !Array.isArray(changes);
  const payload = isPlainObject ? { ...changes } : { detail: changes ?? null };

  if (category) payload.category = category;

  if (invalidation) {
    payload.session_invalidation = {
      reason: invalidation.reason ?? null,
      enforced: Boolean(invalidation.enforced),
      degraded: invalidation.degraded ?? null,
      access_tokens_invalidated: invalidation.accessTokensInvalidated ?? false,
      refresh_tokens_revoked: invalidation.refreshTokensRevoked ?? 0,
      auth_version: invalidation.authVersion ?? null,
      ...(invalidation.affectedUserCount !== undefined
        ? { affected_user_count: invalidation.affectedUserCount }
        : {}),
    };
  }

  const { rows } = await client.query(
    `INSERT INTO permission_audit_logs
       (user_id, action, target_type, target_id, changes, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      actorId ?? null,
      action,
      targetType ?? null,
      targetId ?? null,
      serialiseChanges(payload),
      getClientIp(req),
      req?.headers?.['user-agent'] || null,
    ],
  );

  return rows[0]?.id ?? null;
}

module.exports = {
  REDACTED_KEY_PATTERN,
  REDACTED_PLACEHOLDER,
  MAX_SERIALISED_BYTES,
  redactAuditPayload,
  serialiseChanges,
  writeSecurityAudit,
};

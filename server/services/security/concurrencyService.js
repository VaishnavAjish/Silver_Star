'use strict';

/**
 * RBAC Brick 7 — optimistic concurrency for full-replacement security writes.
 *
 * THE RACE THIS CLOSES
 *   Admin A opens a user's permission editor and sees state X.
 *   Admin B changes that user to state Y and saves.
 *   Admin A, still looking at X, saves — and because the override endpoint is a
 *   DELETE-then-INSERT full replacement, A's save silently reverts B's change.
 *   Nothing errors, nothing is logged as a conflict, and B's edit is simply gone.
 *
 *   The write is now conditional: A sends the fingerprint of the state it loaded,
 *   the server recomputes the fingerprint under a row lock, and a mismatch is a
 *   409 instead of an overwrite.
 *
 * WHY A FINGERPRINT AND NOT `updated_at` OR A VERSION COLUMN
 *   `updated_at` cannot serve here. The override write DELETEs every row and
 *   INSERTs replacements, so the surviving rows' timestamps describe rows that no
 *   longer exist; and a user with zero override rows — a completely normal state,
 *   and the one an administrator is most likely to be racing to change — has no
 *   row and therefore no timestamp to compare at all.
 *
 *   A dedicated version column would need a migration per table and a discipline
 *   that every writer remembers to bump it. A fingerprint derived from the rows
 *   themselves cannot drift out of sync with the rows, needs no schema change,
 *   and handles the empty set naturally (it has its own stable digest).
 *
 *   ONE mechanism is used for every domain here, deliberately. The brick's
 *   instruction not to invent several competing concurrency systems is why the
 *   scope, role-assignment and role-baseline checks all reuse `digest` with a
 *   different prefix rather than growing their own schemes.
 *
 * WHAT A FINGERPRINT IS NOT
 *   It is not a lock and not a secret. FNV-1a is a non-cryptographic digest: it
 *   only has to change when the bytes change. It is opaque to the client, which
 *   never interprets it — it echoes back whatever the GET handed it.
 *
 * SERIALISATION PARITY
 *   `stableStringify` here is byte-for-byte the algorithm in the client's
 *   copySetupPreviewModel.js, and copyStateFingerprint.js depends on that. Any
 *   change to it must be made in both files together, or the Copy Setup
 *   precondition will reject every apply.
 */

const { StaleWriteError, SECURITY_ERROR_CODES } = require('./securityErrors');

/**
 * Deterministic serialisation: object key order never affects the output, so two
 * reads of the same rows in different column orders digest identically.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** FNV-1a, 32-bit. Cheap, stable, and identical to the client's implementation. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * `prefix_hash_length`. The length is appended because a 32-bit digest alone has
 * a birthday bound low enough to be worth widening for free, and the prefix makes
 * a fingerprint self-describing in a log or a 409 body — a scope fingerprint sent
 * to the overrides endpoint is visibly wrong rather than merely unequal.
 */
function digest(prefix, material) {
  const text = stableStringify(material);
  return `${prefix}_${fnv1a(text).toString(16).padStart(8, '0')}_${String(text.length).padStart(3, '0')}`;
}

/**
 * Normalising projections.
 *
 * Every value is coerced explicitly because `pg` type mapping is not something
 * this check should depend on: an INTEGER arriving as a number on one path and a
 * string on another would produce two different fingerprints for identical
 * stored state, and every save would 409. Sorting is likewise explicit — row
 * order from PostgreSQL is not guaranteed without ORDER BY, and the digest must
 * describe the SET, not the order it happened to arrive in.
 */
const overrideKey = r => `${String(r.module ?? '')}:${String(r.submodule ?? '')}`;

const byKey = (a, b) => (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0));

function projectOverrides(rows = []) {
  return [...rows]
    .map(r => ({
      key: overrideKey(r),
      allow_mask: Number(r.allow_mask) || 0,
      deny_mask: Number(r.deny_mask) || 0,
    }))
    /* Rows with neither an allow nor a deny are dropped: the PUT handler declines
       to store them, so a fingerprint that counted them would describe a state
       the table can never hold, and the very next save would 409 forever. */
    .filter(r => r.allow_mask > 0 || r.deny_mask > 0)
    .sort(byKey);
}

function projectScope({ scope_mode, include_unassigned, department_ids } = {}) {
  return {
    /* No stored row resolves to ALL, and this projection agrees with that, so a
       user with no row and a user explicitly set to ALL fingerprint the same —
       because the resolver treats them the same. */
    scope_mode: String(scope_mode ?? 'ALL'),
    include_unassigned: Boolean(include_unassigned),
    department_ids: [...new Set((department_ids || []).map(Number).filter(Number.isInteger))]
      .sort((a, b) => a - b),
  };
}

function projectRoleIds(roleIds = []) {
  return [...new Set((roleIds || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
}

function projectRolePermissions(rows = []) {
  return [...rows]
    .map(r => ({
      key: `${String(r.module ?? '')}:${String(r.submodule ?? '')}`,
      permissions: Number(r.permissions) || 0,
    }))
    .sort(byKey);
}

/* ── Per-domain fingerprints ─────────────────────────────────────────────── */

const overridesFingerprint = rows => digest('ov1', projectOverrides(rows));
const scopeFingerprint = state => digest('sc1', projectScope(state));
const roleAssignmentFingerprint = roleIds => digest('ra1', projectRoleIds(roleIds));
const rolePermissionsFingerprint = rows => digest('rp1', projectRolePermissions(rows));

/* ── The precondition ────────────────────────────────────────────────────── */

/**
 * Enforce `expected === actual`, or throw a 409.
 *
 * BACKWARDS COMPATIBILITY, ON PURPOSE
 *   `expected == null` skips the check. Callers that predate Brick 7 — and the
 *   frontend during the window between the backend and frontend deploys — send
 *   no `expected_version` and keep working exactly as before. Making the field
 *   mandatory would turn every in-flight admin session into a 409 storm at the
 *   moment of deployment.
 *
 *   The cost is stated plainly: a request without `expected_version` gets no
 *   stale-write protection. `checked` is returned so the audit row records which
 *   of the two happened, and an operator can tell from the audit trail whether a
 *   given save was protected.
 */
function assertExpectedVersion({ expected, actual, code, domain, message }) {
  if (expected === null || expected === undefined || expected === '') {
    return { checked: false, actual };
  }
  if (String(expected) !== String(actual)) {
    throw new StaleWriteError(
      code || SECURITY_ERROR_CODES.STALE_PERMISSION_VERSION,
      message
        || 'This configuration was changed by someone else after you loaded it. '
         + 'Your unsaved changes have been kept — reload to see the current '
         + 'configuration before saving again.',
      { expected: String(expected), actual: String(actual), domain: domain || null },
    );
  }
  return { checked: true, actual };
}

/**
 * Take the per-user serialisation lock.
 *
 * WHY LOCK `users` AND NOT THE TABLE BEING WRITTEN
 *   The domains are spread over five tables (overrides, legacy permissions,
 *   scope, scope departments, roles), and several of them are legitimately EMPTY
 *   for the user being edited. There is no row to lock in an empty table, so
 *   locking the child rows cannot serialise two administrators who are both
 *   adding the first override. The `users` row always exists and is the one
 *   thing every per-user security write has in common, so it is the natural
 *   serialisation point: read-then-write races collapse to a queue of one.
 *
 * Deadlock note: every per-user security write takes this lock FIRST and takes
 * exactly one, so there is no lock-ordering cycle between them. Role-baseline
 * propagation, which touches many users, orders its own locks by user id
 * (see securityVersionService.bumpAuthVersionForUsers).
 *
 * Returns false when the user does not exist, letting the caller answer 404
 * rather than proceeding to write orphan rows.
 */
async function lockUserRow(client, userId) {
  const { rows } = await client.query(
    'SELECT id FROM users WHERE id = $1 FOR UPDATE',
    [Number(userId)],
  );
  return rows.length > 0;
}

/** The same, for a role. Used by role-baseline and role-metadata writes. */
async function lockRoleRow(client, roleId) {
  const { rows } = await client.query(
    'SELECT id FROM roles WHERE id = $1 FOR UPDATE',
    [Number(roleId)],
  );
  return rows.length > 0;
}

module.exports = {
  stableStringify,
  fnv1a,
  digest,
  projectOverrides,
  projectScope,
  projectRoleIds,
  projectRolePermissions,
  overridesFingerprint,
  scopeFingerprint,
  roleAssignmentFingerprint,
  rolePermissionsFingerprint,
  assertExpectedVersion,
  lockUserRow,
  lockRoleRow,
};

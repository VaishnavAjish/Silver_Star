const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchPermissionChange } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');
const { ALL_PERMISSION_BITS } = require('../utils/permissions');

const {
  overridesFingerprint,
  assertExpectedVersion,
  lockUserRow,
} = require('../services/security/concurrencyService');
const {
  invalidateUserSessions,
  INVALIDATION_REASON,
  describeInvalidation,
} = require('../services/security/sessionInvalidationService');
const { writeSecurityAudit } = require('../services/security/securityAuditService');
const { sendSecurityError, SECURITY_ERROR_CODES } = require('../services/security/securityErrors');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

/**
 * RBAC Brick 7 — what changed in this file, and what deliberately did not.
 *
 * PERMISSION OVERRIDES (PUT and DELETE) are full replacements of a user's stored
 * authority. They are now:
 *   - serialised on the target user's row (`lockUserRow`), so two administrators
 *     cannot interleave a read and a write;
 *   - conditional on `expected_version`, so a stale editor cannot silently revert
 *     a newer change — it gets 409 STALE_PERMISSION_VERSION instead;
 *   - accompanied by session invalidation, so the affected user's already-issued
 *     8-hour access token stops working immediately rather than carrying the old
 *     permissions until it expires;
 *   - audited INSIDE the transaction, so the change and its evidence commit or
 *     roll back together.
 *
 * PREFERENCES (PUT) is untouched on purpose. Theme, rows-per-page and landing
 * page are not authority. Invalidating sessions when an administrator changes a
 * user's row count would log that user out for a cosmetic edit, and would train
 * everyone to ignore the "you were signed out" message that must stay meaningful
 * for real security changes.
 */

/** The response shape every hardened security write returns, so the client has one contract. */
function securityWriteResult(extra, invalidation, precondition) {
  return {
    success: true,
    ...extra,
    session_invalidation: {
      enforced: Boolean(invalidation?.enforced),
      refresh_tokens_revoked: invalidation?.refreshTokensRevoked ?? 0,
      message: describeInvalidation(invalidation),
    },
    /* Tells the client whether it was actually protected from a stale write. A
       legacy caller that sent no expected_version gets `false` and can say so
       rather than assuming a guarantee it never asked for. */
    concurrency_checked: Boolean(precondition?.checked),
  };
}

// GET /api/admin/users/:id/permission-overrides
router.get('/:id/permission-overrides', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT module, submodule, allow_mask, deny_mask, created_at, updated_at
       FROM user_permission_overrides
       WHERE user_id = $1
       ORDER BY module, submodule`,
      [req.params.id]
    );
    /* `state_version` is the token the client echoes back as `expected_version`
       on save. It is opaque: the client never parses it, only round-trips it. */
    res.json({ data: rows, state_version: overridesFingerprint(rows) });
  } catch (err) {
    logger.error('GET permission-overrides error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/permission-overrides — bulk update overrides for a single user
router.put('/:id/permission-overrides', ...adminOnly, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { overrides, expected_version: expectedVersion } = req.body;
  if (!Array.isArray(overrides)) return res.status(400).json({ error: 'overrides array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    /* Serialisation point. Taken before the read so the state we fingerprint is
       the state we replace — without it, another administrator could commit
       between our SELECT and our DELETE and we would overwrite them anyway. */
    const userExists = await lockUserRow(client, targetUserId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch existing overrides for the audit log AND for the staleness check.
    const { rows: oldOverrides } = await client.query(
      'SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides WHERE user_id = $1',
      [targetUserId]
    );

    const precondition = assertExpectedVersion({
      expected: expectedVersion,
      actual: overridesFingerprint(oldOverrides),
      code: SECURITY_ERROR_CODES.STALE_PERMISSION_VERSION,
      domain: 'permission_overrides',
      message: 'These permissions were changed by another administrator after you '
        + 'opened this user. Your unsaved changes have been kept — reload to see the '
        + 'current permissions before saving again.',
    });

    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetUserId]);

    // Deduplicate and sanitize overrides by module:submodule
    const dedupedMap = new Map();
    for (const ov of overrides) {
      const module = String(ov.module || '').trim();
      const submodule = String(ov.submodule || '').trim();
      if (!module) continue;

      const rawAllow = (parseInt(ov.allow_mask || 0, 10)) & ALL_PERMISSION_BITS;
      const rawDeny = (parseInt(ov.deny_mask || 0, 10)) & ALL_PERMISSION_BITS;

      // Ensure no overlap: allow cannot conflict with deny
      const cleanAllow = rawAllow & ~rawDeny;
      const cleanDeny = rawDeny;

      dedupedMap.set(`${module}:${submodule}`, {
        module,
        submodule,
        allow_mask: cleanAllow,
        deny_mask: cleanDeny,
      });
    }

    const actorId = req.user?.id ? Number(req.user.id) : null;

    let insertedCount = 0;
    for (const ov of dedupedMap.values()) {
      if (ov.allow_mask > 0 || ov.deny_mask > 0) {
        await client.query(
          `INSERT INTO user_permission_overrides
             (user_id, module, submodule, allow_mask, deny_mask, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, module, submodule)
           DO UPDATE SET
             allow_mask = EXCLUDED.allow_mask,
             deny_mask = EXCLUDED.deny_mask,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [targetUserId, ov.module, ov.submodule, ov.allow_mask, ov.deny_mask, actorId, actorId]
        );
        insertedCount++;
      }
    }

    /* Re-read rather than fingerprinting the request body: the handler drops
       all-zero rows, so the stored set is not always what was sent. The version
       returned must be the one a fresh GET would produce, or the client's next
       save would 409 against its own successful write. */
    const { rows: newOverrides } = await client.query(
      'SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides WHERE user_id = $1',
      [targetUserId]
    );

    const invalidation = await invalidateUserSessions(client, {
      userId: targetUserId,
      reason: INVALIDATION_REASON.PERMISSION_OVERRIDES_CHANGED,
      actorId,
    });

    await writeSecurityAudit(client, {
      actorId,
      action: 'update_user_permission_overrides',
      targetType: 'user',
      targetId: targetUserId,
      category: 'access',
      changes: {
        before: oldOverrides,
        after: newOverrides,
        stored_count: insertedCount,
        submitted_count: overrides.length,
        concurrency_checked: precondition.checked,
      },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    // Real-Time: push permission change notification to affected user's socket.
    // UX only — enforcement already happened above, in the database.
    dispatchPermissionChange(targetUserId, {
      changedBy: req.user.id,
      overridesCount: insertedCount,
    });

    res.json(securityWriteResult(
      { saved: insertedCount, state_version: overridesFingerprint(newOverrides) },
      invalidation,
      precondition,
    ));
  } catch (err) {
    await client.query('ROLLBACK');
    /* A 409 leaves no trace beyond this: the transaction rolled back, so no
       audit row and no session invalidation survive a rejected stale write. */
    if (sendSecurityError(res, err)) return;
    logger.error('Save permission-overrides error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/users/:id/permission-overrides — reset all overrides for a user to INHERIT
router.delete('/:id/permission-overrides', ...adminOnly, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { expected_version: expectedVersion } = req.body || {};

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const userExists = await lockUserRow(client, targetUserId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const { rows: oldOverrides } = await client.query(
      'SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides WHERE user_id = $1',
      [targetUserId]
    );

    /* Reset is idempotent, and its intent — "leave this user with no overrides" —
       does not depend on what the overrides currently are, so `expected_version`
       is honoured when sent but not required. */
    const precondition = assertExpectedVersion({
      expected: expectedVersion,
      actual: overridesFingerprint(oldOverrides),
      code: SECURITY_ERROR_CODES.STALE_PERMISSION_VERSION,
      domain: 'permission_overrides',
    });

    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetUserId]);

    const invalidation = await invalidateUserSessions(client, {
      userId: targetUserId,
      reason: INVALIDATION_REASON.PERMISSION_OVERRIDES_CHANGED,
      actorId: req.user.id,
    });

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'reset_user_permission_overrides',
      targetType: 'user',
      targetId: targetUserId,
      category: 'access',
      changes: { before: oldOverrides, after: [], removed_count: oldOverrides.length },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    dispatchPermissionChange(targetUserId, {
      changedBy: req.user.id,
      reset: true,
    });

    res.json(securityWriteResult(
      { reset: true, state_version: overridesFingerprint([]) },
      invalidation,
      precondition,
    ));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    logger.error('Reset permission-overrides error:', { error: err.message });
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/admin/users/:id/permissions (legacy)
router.get('/:id/permissions', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT module, permission_key, allowed FROM user_permissions WHERE user_id=$1 ORDER BY module, permission_key',
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/permissions (legacy bulk replace)
//
// Still a real authority change, so it invalidates sessions and is audited like
// the canonical path. The legacy table itself is left in place — the resolver
// still falls back to it, and removing that fallback is explicitly out of scope.
router.put('/:id/permissions', ...adminOnly, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const userExists = await lockUserRow(client, targetUserId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const { rows: before } = await client.query(
      'SELECT module, permission_key, allowed FROM user_permissions WHERE user_id=$1',
      [targetUserId]
    );

    await client.query('DELETE FROM user_permissions WHERE user_id=$1', [targetUserId]);
    for (const p of permissions) {
      await client.query(
        'INSERT INTO user_permissions (user_id, module, permission_key, allowed) VALUES ($1,$2,$3,$4)',
        [targetUserId, p.module, p.permission_key, Boolean(p.allowed)]
      );
    }

    const invalidation = await invalidateUserSessions(client, {
      userId: targetUserId,
      reason: INVALIDATION_REASON.LEGACY_PERMISSIONS_CHANGED,
      actorId: req.user.id,
    });

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'update_user_legacy_permissions',
      targetType: 'user',
      targetId: targetUserId,
      category: 'access',
      changes: { before, after: permissions, stored_count: permissions.length },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    dispatchPermissionChange(targetUserId, {
      changedBy: req.user.id,
      permissionsCount: permissions.length,
    });

    res.json(securityWriteResult({ saved: permissions.length }, invalidation, null));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    logger.error('Save permissions error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/admin/users/:id/preferences
router.get('/:id/preferences', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT pref_key, pref_value FROM user_preferences WHERE user_id=$1',
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/preferences — bulk replace
//
// NOT a security change. No session invalidation, by design: see the note at the
// top of this file. Left behaviourally identical to its pre-Brick-7 form.
router.put('/:id/preferences', ...adminOnly, async (req, res) => {
  const { id } = req.params;
  const { preferences } = req.body;
  if (!Array.isArray(preferences)) return res.status(400).json({ error: 'preferences array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_preferences WHERE user_id=$1', [id]);
    for (const p of preferences) {
      await client.query(
        'INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES ($1,$2,$3)',
        [id, p.pref_key, String(p.pref_value ?? '')]
      );
    }
    await client.query('COMMIT');
    res.json({ saved: preferences.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Save preferences error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;

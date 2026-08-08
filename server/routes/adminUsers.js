const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('./roles');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');
const { loadInventoryAuthContext } = require('../services/inventoryAuth');

const {
  scopeFingerprint,
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
const {
  fingerprintCopyState,
  buildFingerprintPayload,
} = require('../services/security/copyStateFingerprint');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];
const ROLES = ['super_admin', 'admin', 'operator', 'viewer'];

/**
 * RBAC Brick 7 — the session/audit posture of every write in this file.
 *
 * INVALIDATES SESSIONS
 *   PUT   /users/:id                 only when `role` changed
 *   PATCH /users/:id/status          only when the account became INACTIVE
 *   POST  /users/:id/reset-password  always
 *   PUT   /users/:id/inventory-scope always (it is a security scope)
 *   POST  /users/:id/copy-setup      only when permissions or visibility copied
 *   POST  /users                     never — a new user has no sessions yet
 *
 * DOES NOT INVALIDATE SESSIONS
 *   A primary-department change. That is a deliberate, evidence-backed call:
 *   services/inventoryAuth.js states in its own header that "The user's Primary
 *   Department (users.department_id) plays NO part in visibility. ALL is never
 *   narrowed to the primary department, and a missing primary department never
 *   widens access." It is a reporting default, not authority, so revoking
 *   sessions over it would be noise. If department ever enters the authorization
 *   path, this is the line to revisit.
 *
 * AUDIT ATOMICITY
 *   Every `auditLog` call in this file used to run AFTER `COMMIT`, on the pool,
 *   outside the transaction it described — so a failed audit insert left the
 *   security change committed and unlogged, and there was no guarantee the two
 *   agreed. Every write below now owns a transaction and passes that
 *   transaction's client, so the mutation, its audit row and its session
 *   invalidation share one fate.
 */

/** One response contract for every hardened write, matching adminPermissions.js. */
function securityWriteResult(extra, invalidation, precondition) {
  return {
    ...extra,
    session_invalidation: {
      enforced: Boolean(invalidation?.enforced),
      refresh_tokens_revoked: invalidation?.refreshTokensRevoked ?? 0,
      message: invalidation
        ? describeInvalidation(invalidation)
        : 'This change does not affect authorization, so no session was invalidated.',
    },
    concurrency_checked: Boolean(precondition?.checked),
  };
}

// GET /api/admin/users
router.get('/users', ...adminOnly, async (req, res) => {
  try {
    let r;
    try {
      r = await pool.query(
        `SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
                u.last_login, u.created_at, u.department_id,
                d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         ORDER BY u.id`
      );
    } catch (e) {
      if (e.code === '42703') {
        // Fallback: department_id column doesn't exist yet
        r = await pool.query(
          `SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
                  u.last_login, u.created_at
           FROM users u
           ORDER BY u.id`
        );
      } else {
        throw e;
      }
    }
    res.json(r.rows);
  } catch (err) {
    logger.error('GET /api/admin/users error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/roles
router.get('/roles', ...adminOnly, (_req, res) => res.json(ROLES));

// POST /api/admin/users
//
// No session invalidation: a user being created has no sessions. The audit row
// moves inside the transaction so a created user can never end up unlogged.
router.post('/users', ...adminOnly, async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    let { username, email, password, full_name, role, department_id } = req.body;
    username = (username || '').trim();
    email = email ? email.trim() : null;
    full_name = (full_name || '').trim();
    if (!username || !password || !full_name) return res.status(400).json({ error: 'username, password, full_name required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const hash = await bcrypt.hash(password, 10);
    const deptVal = department_id ? Number(department_id) : null;

    await client.query('BEGIN');

    let r;
    if (deptVal !== null) {
      r = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, department_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, email, full_name, role, is_active, created_at`,
        [username, email || null, hash, full_name, role, deptVal]
      );
    } else {
      r = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, full_name, role, is_active, created_at`,
        [username, email || null, hash, full_name, role]
      );
    }

    /* Neither `password` nor `hash` is passed here. The audit service would redact
       them anyway, but not handing them over is the stronger guarantee. */
    await auditLog(client, req.user.id, 'create_user', 'user', r.rows[0].id,
      { username, email, full_name, role }, req);

    await client.query('COMMIT');

    // Real-Time: notify admin room of new user
    dispatchEvent('user.created', { id: r.rows[0].id, username, full_name, role });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    if (err.code === '23503') return res.status(400).json({ error: 'Selected department does not exist' });
    if (err.code === '42703') return res.status(500).json({ error: 'Database column missing — run phase33_user_department.sql migration' });
    logger.error('POST /api/admin/users error:', { error: err.message, code: err.code, stack: err.stack?.split('\n').slice(0, 4).join('\n') });
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', ...adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.primaryPool.connect();
  try {
    let { username, email, full_name, role, department_id } = req.body;
    username = (username || '').trim();
    email = email ? email.trim() : null;
    full_name = (full_name || '').trim();
    if (!username || !full_name) return res.status(400).json({ error: 'username, full_name required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (id === req.user.id && role !== 'admin' && role !== 'super_admin') return res.status(400).json({ error: 'Cannot change your own role away from admin' });
    const deptVal = department_id ? Number(department_id) : null;

    await client.query('BEGIN');

    const userExists = await lockUserRow(client, id);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    /* Read the prior role so invalidation is conditional on an actual change.
       Re-saving the form without touching the role must not log the user out. */
    const { rows: [before] } = await client.query(
      'SELECT role, department_id FROM users WHERE id = $1', [id],
    );
    const roleChanged = Boolean(before) && before.role !== role;

    let r;
    if (deptVal !== null) {
      r = await client.query(
        `UPDATE users SET username=$1, email=$2, full_name=$3, role=$4, department_id=$5, updated_at=NOW()
         WHERE id=$6 RETURNING id, username, email, full_name, role, is_active`,
        [username, email || null, full_name, role, deptVal, id]
      );
    } else {
      r = await client.query(
        `UPDATE users SET username=$1, email=$2, full_name=$3, role=$4, updated_at=NOW()
         WHERE id=$5 RETURNING id, username, email, full_name, role, is_active`,
        [username, email || null, full_name, role, id]
      );
    }
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const invalidation = roleChanged
      ? await invalidateUserSessions(client, {
        userId: id,
        reason: INVALIDATION_REASON.ROLE_CHANGED,
        actorId: req.user.id,
      })
      : null;

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'update_user',
      targetType: 'user',
      targetId: id,
      category: 'general',
      changes: {
        username,
        email,
        full_name,
        role,
        role_before: before?.role ?? null,
        role_changed: roleChanged,
        department_id: deptVal,
        department_id_before: before?.department_id ?? null,
      },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    // Real-Time: notify admin room and the affected user (role change takes effect immediately)
    dispatchEvent('user.updated', { id, username, full_name, role });
    dispatchEvent('permission.changed', { userId: id, reason: 'role_update', newRole: role }, { targetUserId: id });

    res.json(securityWriteResult({ ...r.rows[0], role_changed: roleChanged }, invalidation, null));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    if (err.code === '23503') return res.status(400).json({ error: 'Selected department does not exist' });
    if (err.code === '42703') return res.status(500).json({ error: 'Database column missing — run phase33_user_department.sql migration' });
    logger.error('PUT /api/admin/users error:', { error: err.message, code: err.code });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', ...adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.primaryPool.connect();
  try {
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' });

    await client.query('BEGIN');

    const userExists = await lockUserRow(client, id);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const r = await client.query(
      'UPDATE users SET is_active = NOT is_active, updated_at=NOW() WHERE id=$1 RETURNING id, is_active',
      [id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const nowActive = r.rows[0].is_active;

    /* Invalidate on DISABLE only.
       Re-enabling deliberately does not resurrect anything: refresh tokens
       revoked at disable time keep their revoked_at, and the auth_version bump
       from the disable already killed every access token minted before it. There
       is nothing to restore, so re-enable needs no second invalidation — the
       user simply signs in again and receives a fresh token. */
    const invalidation = nowActive
      ? null
      : await invalidateUserSessions(client, {
        userId: id,
        reason: INVALIDATION_REASON.ACCOUNT_DISABLED,
        actorId: req.user.id,
      });

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'toggle_user_status',
      targetType: 'user',
      targetId: id,
      category: 'security',
      changes: { is_active: nowActive, action: nowActive ? 'enabled' : 'disabled' },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    // Real-Time: force-disconnected users to re-auth next request
    dispatchEvent('user.deactivated', { id, is_active: nowActive }, { targetUserId: id });

    res.json(securityWriteResult(r.rows[0], invalidation, null));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    logger.error('PATCH /api/admin/users/:id/status error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /api/admin/users/:id/reset-password
//
// Always invalidates. A password reset whose old sessions keep working is not a
// password reset — whoever held the previous credentials keeps their access for
// the remaining lifetime of their 8-hour token.
router.post('/users/:id/reset-password', ...adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.primaryPool.connect();
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const userExists = await lockUserRow(client, id);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const r = await client.query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 RETURNING id',
      [hash, id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const invalidation = await invalidateUserSessions(client, {
      userId: id,
      reason: INVALIDATION_REASON.PASSWORD_RESET,
      actorId: req.user.id,
    });

    /* Neither the password nor its hash is passed to the audit. */
    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'reset_password',
      targetType: 'user',
      targetId: id,
      category: 'security',
      changes: { message: 'Password manually reset by an administrator' },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    res.json(securityWriteResult({ success: true }, invalidation, null));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    logger.error('POST reset-password error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── INVENTORY SCOPE MANAGEMENT ───────────────────────────────────────────────

// GET /api/admin/users/:id/inventory-scope
// Read a user's current inventory dept-scope configuration.
router.get('/users/:id/inventory-scope', ...adminOnly, async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const [scopeRow, deptRows] = await Promise.all([
      pool.query(
        'SELECT scope_mode, include_unassigned FROM user_inventory_scopes WHERE user_id = $1',
        [userId]
      ),
      pool.query(
        `SELECT uisd.department_id, d.name
         FROM user_inventory_scope_depts uisd
         JOIN departments d ON d.id = uisd.department_id
         WHERE uisd.user_id = $1
         ORDER BY d.name`,
        [userId]
      ),
    ]);

    const scopeMode = scopeRow.rows[0]?.scope_mode ?? 'ALL';
    const includeUnassigned = scopeRow.rows[0]?.include_unassigned ?? false;
    const departments = deptRows.rows;

    res.json({
      scope_mode:         scopeMode,
      include_unassigned: includeUnassigned,
      departments,
      state_version: scopeFingerprint({
        scope_mode: scopeMode,
        include_unassigned: includeUnassigned,
        department_ids: departments.map(d => d.department_id),
      }),
    });
  } catch (err) {
    logger.error('GET inventory-scope error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/inventory-scope
// Upsert a user's inventory dept-scope. Replaces existing dept list atomically.
router.put('/users/:id/inventory-scope', ...adminOnly, async (req, res) => {
  const userId = Number(req.params.id);
  const {
    scope_mode, include_unassigned = false, department_ids = [],
    expected_version: expectedVersion,
  } = req.body;

  const VALID_MODES = ['ALL', 'SELECTED', 'NONE'];
  if (!VALID_MODES.includes(scope_mode)) {
    return res.status(400).json({ error: `scope_mode must be one of: ${VALID_MODES.join(', ')}` });
  }
  if (scope_mode === 'SELECTED' && (!Array.isArray(department_ids) || department_ids.length === 0)) {
    return res.status(400).json({ error: 'department_ids must be a non-empty array when scope_mode is SELECTED' });
  }

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const userExists = await lockUserRow(client, userId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    /* Read the current scope for the staleness check and for the audit's before
       image. Department visibility is security state: a stale save here silently
       widens or narrows what another administrator just decided. */
    const { rows: beforeScope } = await client.query(
      'SELECT scope_mode, include_unassigned FROM user_inventory_scopes WHERE user_id = $1',
      [userId],
    );
    const { rows: beforeDepts } = await client.query(
      'SELECT department_id FROM user_inventory_scope_depts WHERE user_id = $1',
      [userId],
    );

    const beforeState = {
      scope_mode: beforeScope[0]?.scope_mode ?? 'ALL',
      include_unassigned: beforeScope[0]?.include_unassigned ?? false,
      department_ids: beforeDepts.map(d => d.department_id),
    };

    const precondition = assertExpectedVersion({
      expected: expectedVersion,
      actual: scopeFingerprint(beforeState),
      code: SECURITY_ERROR_CODES.STALE_INVENTORY_SCOPE,
      domain: 'inventory_scope',
      message: 'This user\'s inventory visibility was changed by another administrator '
        + 'after you opened them. Your unsaved changes have been kept — reload to see '
        + 'the current scope before saving again.',
    });

    // Upsert scope row
    await client.query(
      `INSERT INTO user_inventory_scopes
         (user_id, scope_mode, include_unassigned, updated_by, updated_at, created_by)
       VALUES ($1, $2, $3, $4, NOW(), $4)
       ON CONFLICT (user_id) DO UPDATE
         SET scope_mode = EXCLUDED.scope_mode,
             include_unassigned = EXCLUDED.include_unassigned,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [userId, scope_mode, Boolean(include_unassigned), req.user.id]
    );

    // Replace dept whitelist atomically
    await client.query(
      'DELETE FROM user_inventory_scope_depts WHERE user_id = $1',
      [userId]
    );

    const validIds = scope_mode === 'SELECTED'
      ? department_ids.map(Number).filter(n => !Number.isNaN(n))
      : [];

    for (const deptId of validIds) {
      await client.query(
        'INSERT INTO user_inventory_scope_depts (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, deptId]
      );
    }

    const afterState = {
      scope_mode,
      include_unassigned: Boolean(include_unassigned),
      department_ids: validIds,
    };

    const invalidation = await invalidateUserSessions(client, {
      userId,
      reason: INVALIDATION_REASON.INVENTORY_SCOPE_CHANGED,
      actorId: req.user.id,
    });

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'update_inventory_scope',
      targetType: 'user',
      targetId: userId,
      category: 'access',
      changes: {
        before: beforeState,
        after: afterState,
        concurrency_checked: precondition.checked,
      },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    res.json(securityWriteResult({
      ok: true,
      user_id: userId,
      scope_mode,
      include_unassigned,
      department_ids: validIds,
      state_version: scopeFingerprint(afterState),
    }, invalidation, precondition));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    if (err.code === '23503') return res.status(400).json({ error: 'One or more department IDs do not exist' });
    logger.error('PUT inventory-scope error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/admin/users/:id/effective-access
// Returns the resolved authorization context for any user (admin use).
router.get('/users/:id/effective-access', ...adminOnly, async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const userRow = await pool.query('SELECT role FROM users WHERE id = $1 AND is_active = true', [userId]);
    if (!userRow.rows.length) return res.status(404).json({ error: 'User not found' });

    const ctx = await loadInventoryAuthContext(userId, userRow.rows[0].role);
    res.json({
      inventory: {
        can_view:           ctx.canViewInventory,
        can_export:         ctx.canExport,
        can_view_financial: ctx.canViewFinancial,
        scope_mode:         ctx.scopeMode,
        allowed_dept_ids:   ctx.scopeMode === 'SELECTED' ? ctx.allowedDeptIds : [],
        include_unassigned: ctx.includeUnassigned,
      },
    });
  } catch (err) {
    logger.error('GET effective-access error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/:id/setup-summary
// Fetches counts of permissions, templates, etc. to preview copy setup
router.get('/users/:id/setup-summary', ...adminOnly, async (req, res) => {
  const sourceId = Number(req.params.id);
  try {
    const qPerms = pool.query('SELECT COUNT(*) FROM user_permission_overrides WHERE user_id = $1', [sourceId]);
    const qLegacyPerms = pool.query('SELECT COUNT(*) FROM user_permissions WHERE user_id = $1', [sourceId]);
    const qPrefs = pool.query('SELECT COUNT(*) FROM user_preferences WHERE user_id = $1', [sourceId]);
    const qDash  = pool.query('SELECT COUNT(*) FROM user_dashboard_widgets WHERE user_id = $1', [sourceId]);
    const qTmpl  = pool.query('SELECT COUNT(*) FROM template_shares WHERE user_id = $1', [sourceId]);

    // Also include templates created by them that are not global
    const qOwnTmpl = pool.query('SELECT COUNT(*) FROM inventory_templates WHERE created_by = $1 AND is_global = false', [sourceId]);

    const qScope = pool.query('SELECT scope_mode FROM user_inventory_scopes WHERE user_id = $1', [sourceId]);
    const qDepts = pool.query('SELECT COUNT(*) FROM user_inventory_scope_depts WHERE user_id = $1', [sourceId]);

    const [perms, legacyPerms, prefs, dash, tmpl, ownTmpl, scope, depts] = await Promise.all([qPerms, qLegacyPerms, qPrefs, qDash, qTmpl, qOwnTmpl, qScope, qDepts]);

    res.json({
      permissions_count: parseInt(perms.rows[0].count) || parseInt(legacyPerms.rows[0].count),
      preferences_count: parseInt(prefs.rows[0].count),
      dashboard_count: parseInt(dash.rows[0].count),
      shared_templates_count: parseInt(tmpl.rows[0].count),
      owned_templates_count: parseInt(ownTmpl.rows[0].count),
      scope_mode: scope.rows.length ? scope.rows[0].scope_mode : 'ALL',
      scope_depts_count: parseInt(depts.rows[0].count),
    });
  } catch (err) {
    logger.error('GET setup-summary error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── COPY SETUP PREVIEW (RBAC Brick 6) ───────────────────────────────────────
 *
 * GET /api/admin/users/:id/copy-setup/preview?source_user_id=N
 *
 * READ ONLY. Returns the stored state of every category the copy endpoint below
 * touches, for BOTH users, so the administrator can be shown exactly what an
 * apply would do before anything changes.
 *
 * WHY A BACKEND READ RATHER THAN CLIENT-SIDE ASSEMBLY
 *   Two of the five categories the copy writes — user_dashboard_widgets and
 *   template_shares — have no per-user admin read endpoint, and the legacy
 *   user_permissions table that copy_permissions also replaces is only exposed
 *   through a separate route. Reproducing the copy's reach from the client would
 *   mean six-plus requests and a category the preview could not see at all.
 *
 * WHY GET, AND WHY NO CATEGORY FLAGS
 *   The response is pure state, never a computed decision, so it is idempotent
 *   and safe to re-issue. Category selection is applied by the client's pure diff
 *   model, which means toggling a category is provably zero network traffic and
 *   cannot be mistaken for an operation.
 *
 * ZERO WRITES: only SELECT statements, no BEGIN, no audit row. `pool.query`
 * without `readOnly` targets the primary — the same pool the copy transaction
 * uses — so the preview cannot be served from a lagging replica.
 *
 * RBAC BRICK 7 ADDITION
 *   `state_fingerprint` is returned. The wizard sends it back as
 *   `expected_fingerprint` on apply, and the copy transaction re-derives it from
 *   its own snapshot before writing anything. Brick 6 could only compare two
 *   client-side reads, which left a window between the last read and the write;
 *   the precondition now lives inside the transaction that does the writing.
 */
router.get('/users/:id/copy-setup/preview', ...adminOnly, async (req, res) => {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.query.source_user_id);

  if (!Number.isInteger(targetId) || !Number.isInteger(sourceId)) {
    return res.status(400).json({ error: 'source_user_id and a numeric user id are required' });
  }
  if (targetId === sourceId) {
    return res.status(400).json({ error: 'Cannot copy setup to self' });
  }

  try {
    const identities = await loadCopyIdentities([sourceId, targetId]);
    const source = identities.get(sourceId);
    const target = identities.get(targetId);
    if (!source) return res.status(404).json({ error: 'Source user not found' });
    if (!target) return res.status(404).json({ error: 'Target user not found' });

    const [sourceState, targetState] = await Promise.all([
      loadCopyCategoryState(sourceId),
      loadCopyCategoryState(targetId),
    ]);

    // Only the source side of Templates reads owned templates: the copy shares
    // the SOURCE's own non-global templates with the target, and never moves
    // ownership in either direction.
    const { rows: ownedTemplates } = await pool.query(
      `SELECT id AS template_id, name
       FROM inventory_templates
       WHERE created_by = $1 AND is_global = false
       ORDER BY name, id`,
      [sourceId],
    );

    res.json({
      source,
      target,
      /* The token the wizard echoes back as `expected_fingerprint`. Computed
         from the same rows the apply transaction will re-read, by the same
         function, so a match proves the reviewed state is the written state. */
      state_fingerprint: fingerprintCopyState(buildFingerprintPayload({
        sourceState, targetState, sourceOwnedTemplates: ownedTemplates,
      })),
      categories: {
        permissions: {
          semantics: 'REPLACE',
          source: sourceState.permissions,
          target: targetState.permissions,
        },
        visibility: {
          semantics: 'REPLACE',
          source: sourceState.visibility,
          target: targetState.visibility,
        },
        preferences: {
          semantics: 'REPLACE',
          /* RBAC Brick 7: the copy's DELETE now carries the same
             `pref_key NOT LIKE 'vis.%'` filter as its INSERT, so the target's own
             vis.* rows are neither copied over nor destroyed. `excluded_key_prefix`
             now means excluded from BOTH sides of the replacement, which is what
             it always claimed to mean. `excluded_semantics` states that
             explicitly so the client renders a preservation note rather than the
             Brick 6 destructive-removal warning. */
          excluded_key_prefix: 'vis.',
          excluded_semantics: 'PRESERVE_ON_TARGET',
          source: sourceState.preferences,
          target: targetState.preferences,
        },
        dashboard: {
          semantics: 'REPLACE',
          source: sourceState.dashboard,
          target: targetState.dashboard,
        },
        templates: {
          semantics: 'REPLACE',
          source: { shares: sourceState.templates, owned_non_global: ownedTemplates },
          target: { shares: targetState.templates, owned_non_global: [] },
        },
      },
    });
  } catch (err) {
    logger.error('GET copy-setup/preview error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

/** Identity for the preview header. Never part of any copy — display only. */
async function loadCopyIdentities(ids, db = pool) {
  const withDept = `SELECT u.id, u.username, u.full_name, u.role, u.is_active,
                           u.department_id, d.name AS department_name
                    FROM users u
                    LEFT JOIN departments d ON d.id = u.department_id
                    WHERE u.id = ANY($1::int[])`;
  const withoutDept = `SELECT u.id, u.username, u.full_name, u.role, u.is_active
                       FROM users u WHERE u.id = ANY($1::int[])`;

  let rows;
  try {
    ({ rows } = await db.query(withDept, [ids]));
  } catch (e) {
    // Same fallback GET /api/admin/users carries: department_id may predate the
    // phase33 migration on some environments.
    if (e.code !== '42703') throw e;
    ({ rows } = await db.query(withoutDept, [ids]));
  }
  return new Map(rows.map(r => [r.id, r]));
}

/**
 * Every row the copy endpoint reads for one user, in the copy's own terms.
 *
 * `has_row` on the scope is kept distinct from the ALL default: a user with no
 * user_inventory_scopes row and a user explicitly set to ALL resolve the same
 * way today, but only the second one leaves a row for the copy to carry.
 *
 * RBAC Brick 7: `db` is now injectable. The preview passes the pool; the apply
 * transaction passes ITS OWN client, so the fingerprint precondition is computed
 * from the same snapshot the copy is about to overwrite. Reading it on the pool
 * instead would reintroduce exactly the check-then-write gap this closes. The
 * statements are otherwise unchanged, which is what keeps the preview and the
 * precondition provably reading the same thing.
 */
async function loadCopyCategoryState(userId, db = pool) {
  const [overrides, legacy, scope, scopeDepts, preferences, dashboard, templates] = await Promise.all([
    db.query(
      `SELECT module, submodule, allow_mask, deny_mask
       FROM user_permission_overrides WHERE user_id = $1
       ORDER BY module, submodule`,
      [userId],
    ),
    db.query(
      `SELECT module, permission_key, allowed
       FROM user_permissions WHERE user_id = $1
       ORDER BY module, permission_key`,
      [userId],
    ),
    db.query(
      'SELECT scope_mode, include_unassigned FROM user_inventory_scopes WHERE user_id = $1',
      [userId],
    ),
    db.query(
      `SELECT uisd.department_id, d.name
       FROM user_inventory_scope_depts uisd
       LEFT JOIN departments d ON d.id = uisd.department_id
       WHERE uisd.user_id = $1
       ORDER BY d.name, uisd.department_id`,
      [userId],
    ),
    db.query(
      'SELECT pref_key, pref_value FROM user_preferences WHERE user_id = $1 ORDER BY pref_key',
      [userId],
    ),
    db.query(
      `SELECT widget_key, position, is_visible
       FROM user_dashboard_widgets WHERE user_id = $1
       ORDER BY position, widget_key`,
      [userId],
    ),
    db.query(
      `SELECT ts.template_id, t.name
       FROM template_shares ts
       LEFT JOIN inventory_templates t ON t.id = ts.template_id
       WHERE ts.user_id = $1
       ORDER BY t.name, ts.template_id`,
      [userId],
    ),
  ]);

  return {
    permissions: { overrides: overrides.rows, legacy: legacy.rows },
    visibility: {
      has_row: scope.rows.length > 0,
      scope_mode: scope.rows[0]?.scope_mode ?? null,
      include_unassigned: scope.rows[0]?.include_unassigned ?? null,
      departments: scopeDepts.rows,
    },
    preferences: preferences.rows,
    dashboard: dashboard.rows,
    templates: templates.rows,
  };
}

// POST /api/admin/users/:id/copy-setup
// Copies selected configurations from source user to target user (:id)
router.post('/users/:id/copy-setup', ...adminOnly, async (req, res) => {
  const targetId = Number(req.params.id);
  const {
    source_user_id,
    copy_permissions,
    copy_visibility,
    copy_preferences,
    copy_dashboard,
    copy_templates,
    expected_fingerprint: expectedFingerprint,
  } = req.body;

  if (!source_user_id) return res.status(400).json({ error: 'source_user_id is required' });
  if (targetId === Number(source_user_id)) return res.status(400).json({ error: 'Cannot copy setup to self' });

  const sourceId = Number(source_user_id);

  /* Only these two move authority. Preferences, dashboard and templates are
     layout and convenience, and copying them must not sign the target out. */
  const securityCategoriesCopied = Boolean(copy_permissions) || Boolean(copy_visibility);

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    /* Lock BOTH users, in ascending id order.
       Both, because the fingerprint covers the source as well as the target — a
       source that changes mid-copy produces a result the administrator never
       reviewed. Ascending order, because two administrators running A->B and
       B->A simultaneously would otherwise take the same two locks in opposite
       orders and deadlock. */
    for (const id of [targetId, sourceId].sort((a, b) => a - b)) {
      const exists = await lockUserRow(client, id);
      if (!exists) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: id === sourceId ? 'Source user not found' : 'Target user not found',
        });
      }
    }

    /* THE PRECONDITION, INSIDE THE TRANSACTION.
       Re-read both users' state on the transaction client and recompute the
       fingerprint the administrator reviewed. Any competing write is now either
       committed before this snapshot (and therefore visible here) or blocked on
       the locks above until this transaction finishes — so unlike Brick 6's
       best-effort GET-before-POST, no window remains between the check and the
       write. */
    const sourceState = await loadCopyCategoryState(sourceId, client);
    const targetState = await loadCopyCategoryState(targetId, client);
    const { rows: ownedTemplates } = await client.query(
      `SELECT id AS template_id, name
       FROM inventory_templates
       WHERE created_by = $1 AND is_global = false
       ORDER BY name, id`,
      [sourceId],
    );

    const actualFingerprint = fingerprintCopyState(buildFingerprintPayload({
      sourceState, targetState, sourceOwnedTemplates: ownedTemplates,
    }));

    const precondition = assertExpectedVersion({
      expected: expectedFingerprint,
      actual: actualFingerprint,
      code: SECURITY_ERROR_CODES.STALE_COPY_PREVIEW,
      domain: 'copy_setup',
      message: 'The configuration changed after you generated this preview, so the '
        + 'copy was not applied. Review the current configuration and try again.',
    });

    // Copy Permission Overrides
    if (copy_permissions) {
      await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetId]);
      await client.query(
        `INSERT INTO user_permission_overrides (user_id, module, submodule, allow_mask, deny_mask, created_by, updated_by)
         SELECT $1, module, submodule, allow_mask, deny_mask, $3, $3
         FROM user_permission_overrides WHERE user_id = $2`,
        [targetId, sourceId, req.user.id]
      );
      // Legacy user_permissions copy
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [targetId]);
      await client.query(
        `INSERT INTO user_permissions (user_id, module, permission_key, allowed)
         SELECT $1, module, permission_key, allowed
         FROM user_permissions WHERE user_id = $2`,
        [targetId, sourceId]
      );
    }

    // Copy Inventory Visibility
    if (copy_visibility) {
      await client.query('DELETE FROM user_inventory_scopes WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM user_inventory_scope_depts WHERE user_id = $1', [targetId]);

      await client.query(
        `INSERT INTO user_inventory_scopes (user_id, scope_mode, include_unassigned, updated_by, updated_at, created_by)
         SELECT $1, scope_mode, include_unassigned, $3, NOW(), $3
         FROM user_inventory_scopes WHERE user_id = $2`,
        [targetId, sourceId, req.user.id]
      );

      await client.query(
        `INSERT INTO user_inventory_scope_depts (user_id, department_id)
         SELECT $1, department_id
         FROM user_inventory_scope_depts WHERE user_id = $2`,
        [targetId, sourceId]
      );
    }

    /* Copy Preferences (excluding security visibility keys).
     *
     * RBAC BRICK 7 — VERIFIED SAFETY FIX.
     *   The DELETE used to be unfiltered while the INSERT filtered `vis.%`. The
     *   result was that the target's own vis.* rows were destroyed and nothing
     *   replaced them: a key explicitly excluded from being COPIED was silently
     *   being DELETED. The exclusion is now symmetric — neither side of the
     *   replacement touches a vis.* row, so the target's stored visibility
     *   preferences survive a Copy Preferences byte-for-byte, and a target that
     *   had none still has none (nothing is created for it either).
     */
    if (copy_preferences) {
      await client.query(
        "DELETE FROM user_preferences WHERE user_id = $1 AND pref_key NOT LIKE 'vis.%'",
        [targetId]
      );
      await client.query(
        `INSERT INTO user_preferences (user_id, pref_key, pref_value)
         SELECT $1, pref_key, pref_value
         FROM user_preferences WHERE user_id = $2 AND pref_key NOT LIKE 'vis.%'`,
        [targetId, sourceId]
      );
    }

    // Copy Dashboard Config
    if (copy_dashboard) {
      await client.query('DELETE FROM user_dashboard_widgets WHERE user_id = $1', [targetId]);
      await client.query(
        `INSERT INTO user_dashboard_widgets (user_id, widget_key, position, is_visible)
         SELECT $1, widget_key, position, is_visible
         FROM user_dashboard_widgets WHERE user_id = $2`,
        [targetId, sourceId]
      );
    }

    // Copy Templates
    if (copy_templates) {
      await client.query('DELETE FROM template_shares WHERE user_id = $1', [targetId]);

      // 1. Copy explicit shares
      await client.query(
        `INSERT INTO template_shares (user_id, template_id)
         SELECT $1, template_id
         FROM template_shares WHERE user_id = $2`,
        [targetId, sourceId]
      );

      // 2. Also share templates that the source user created (which are not global)
      await client.query(
        `INSERT INTO template_shares (user_id, template_id)
         SELECT $1, id
         FROM inventory_templates
         WHERE created_by = $2 AND is_global = false
         ON CONFLICT DO NOTHING`,
        [targetId, sourceId]
      );
    }

    /* Only the TARGET's sessions are invalidated, and only when authority moved.
       The source is untouched: their configuration was read, not changed, and
       signing someone out because a colleague copied from them would be wrong. */
    const invalidation = securityCategoriesCopied
      ? await invalidateUserSessions(client, {
        userId: targetId,
        reason: INVALIDATION_REASON.COPY_SETUP_SECURITY,
        actorId: req.user.id,
      })
      : null;

    await writeSecurityAudit(client, {
      actorId: req.user.id,
      action: 'copy_user_setup',
      targetType: 'user',
      targetId,
      category: 'copy_setup',
      changes: {
        source_user_id: sourceId,
        copied: {
          copy_permissions: Boolean(copy_permissions),
          copy_visibility: Boolean(copy_visibility),
          copy_preferences: Boolean(copy_preferences),
          copy_dashboard: Boolean(copy_dashboard),
          copy_templates: Boolean(copy_templates),
        },
        security_categories_copied: securityCategoriesCopied,
        preview_fingerprint: actualFingerprint,
        concurrency_checked: precondition.checked,
        permission_overrides_written: copy_permissions
          ? sourceState.permissions.overrides.length : 0,
        legacy_permissions_written: copy_permissions
          ? sourceState.permissions.legacy.length : 0,
        preferences_written: copy_preferences
          ? sourceState.preferences.filter(p => !String(p.pref_key).startsWith('vis.')).length : 0,
        target_vis_preferences_preserved: copy_preferences
          ? targetState.preferences.filter(p => String(p.pref_key).startsWith('vis.')).length : 0,
        dashboard_widgets_written: copy_dashboard ? sourceState.dashboard.length : 0,
        template_shares_written: copy_templates ? sourceState.templates.length : 0,
      },
      req,
      invalidation,
    });

    await client.query('COMMIT');

    // Real-Time Events — UX only, never the security boundary.
    if (securityCategoriesCopied) {
      const { dispatchPermissionChange } = require('../services/eventDispatcher');
      dispatchPermissionChange(targetId, { changedBy: req.user.id, reason: 'copy_setup' });
    }
    if (copy_dashboard) {
      dispatchEvent('dashboard.widget.updated', { user_id: targetId, module: 'dashboard' });
    }

    res.json(securityWriteResult({ success: true }, invalidation, precondition));
  } catch (err) {
    await client.query('ROLLBACK');
    if (sendSecurityError(res, err)) return;
    logger.error('POST copy-setup error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;

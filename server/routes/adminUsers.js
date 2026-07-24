const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('./roles');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');
const { loadInventoryAuthContext } = require('../services/inventoryAuth');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];
const ROLES = ['super_admin', 'admin', 'operator', 'viewer'];

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
router.post('/users', ...adminOnly, async (req, res) => {
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
    let r;
    if (deptVal !== null) {
      r = await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, department_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, email, full_name, role, is_active, created_at`,
        [username, email || null, hash, full_name, role, deptVal]
      );
    } else {
      r = await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, full_name, role, is_active, created_at`,
        [username, email || null, hash, full_name, role]
      );
    }
    await auditLog(pool, req.user.id, 'create_user', 'user', r.rows[0].id, { username, email, full_name, role }, req);

    // Real-Time: notify admin room of new user
    dispatchEvent('user.created', { id: r.rows[0].id, username, full_name, role });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    if (err.code === '23503') return res.status(400).json({ error: 'Selected department does not exist' });
    if (err.code === '42703') return res.status(500).json({ error: 'Database column missing — run phase33_user_department.sql migration' });
    logger.error('POST /api/admin/users error:', { error: err.message, code: err.code, stack: err.stack?.split('\n').slice(0,4).join('\n') });
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', ...adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    let { username, email, full_name, role, department_id } = req.body;
    username = (username || '').trim();
    email = email ? email.trim() : null;
    full_name = (full_name || '').trim();
    if (!username || !full_name) return res.status(400).json({ error: 'username, full_name required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (id === req.user.id && role !== 'admin' && role !== 'super_admin') return res.status(400).json({ error: 'Cannot change your own role away from admin' });
    const deptVal = department_id ? Number(department_id) : null;
    let r;
    if (deptVal !== null) {
      r = await pool.query(
        `UPDATE users SET username=$1, email=$2, full_name=$3, role=$4, department_id=$5, updated_at=NOW()
         WHERE id=$6 RETURNING id, username, email, full_name, role, is_active`,
        [username, email || null, full_name, role, deptVal, id]
      );
    } else {
      r = await pool.query(
        `UPDATE users SET username=$1, email=$2, full_name=$3, role=$4, updated_at=NOW()
         WHERE id=$5 RETURNING id, username, email, full_name, role, is_active`,
        [username, email || null, full_name, role, id]
      );
    }
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    await auditLog(pool, req.user.id, 'update_user', 'user', id, { username, email, full_name, role }, req);

    // Real-Time: notify admin room and the affected user (role change takes effect immediately)
    dispatchEvent('user.updated', { id, username, full_name, role });
    dispatchEvent('permission.changed', { userId: id, reason: 'role_update', newRole: role }, { targetUserId: id });

    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    if (err.code === '23503') return res.status(400).json({ error: 'Selected department does not exist' });
    if (err.code === '42703') return res.status(500).json({ error: 'Database column missing — run phase33_user_department.sql migration' });
    logger.error('PUT /api/admin/users error:', { error: err.message, code: err.code });
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', ...adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' });
    const r = await pool.query(
      'UPDATE users SET is_active = NOT is_active, updated_at=NOW() WHERE id=$1 RETURNING id, is_active',
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    await auditLog(pool, req.user.id, 'toggle_user_status', 'user', id, { is_active: r.rows[0].is_active }, req);

    // Real-Time: force-disconnected users to re-auth next request
    dispatchEvent('user.deactivated', { id, is_active: r.rows[0].is_active }, { targetUserId: id });

    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', ...adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 RETURNING id',
      [hash, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    await auditLog(pool, req.user.id, 'reset_password', 'user', parseInt(id), { message: 'Password manually reset' }, req);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
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

    res.json({
      scope_mode:         scopeRow.rows[0]?.scope_mode ?? 'ALL',
      include_unassigned: scopeRow.rows[0]?.include_unassigned ?? false,
      departments:        deptRows.rows,
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
  const { scope_mode, include_unassigned = false, department_ids = [] } = req.body;

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

    if (scope_mode === 'SELECTED' && department_ids.length > 0) {
      const validIds = department_ids.map(Number).filter(n => !isNaN(n));
      for (const deptId of validIds) {
        await client.query(
          'INSERT INTO user_inventory_scope_depts (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, deptId]
        );
      }
    }

    await client.query('COMMIT');

    await auditLog(pool, req.user.id, 'update_inventory_scope', 'user', userId,
      { scope_mode, include_unassigned, department_ids }, req);

    res.json({ ok: true, user_id: userId, scope_mode, include_unassigned, department_ids });
  } catch (err) {
    await client.query('ROLLBACK');
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

module.exports = router;

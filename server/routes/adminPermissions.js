const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent, dispatchPermissionChange } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');
const { ALL_PERMISSION_BITS } = require('../utils/permissions');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

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
    res.json({ data: rows });
  } catch (err) {
    logger.error('GET permission-overrides error:', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/permission-overrides — bulk update overrides for a single user
router.put('/:id/permission-overrides', ...adminOnly, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { overrides } = req.body;
  if (!Array.isArray(overrides)) return res.status(400).json({ error: 'overrides array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Fetch existing overrides for audit log
    const { rows: oldOverrides } = await client.query(
      'SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides WHERE user_id = $1',
      [targetUserId]
    );

    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetUserId]);

    let insertedCount = 0;
    for (const ov of overrides) {
      const module = String(ov.module || '').trim();
      const submodule = String(ov.submodule || '').trim();
      let allowMask = (parseInt(ov.allow_mask || 0)) & ALL_PERMISSION_BITS;
      let denyMask = (parseInt(ov.deny_mask || 0)) & ALL_PERMISSION_BITS;

      // Validate check constraint: allow_mask & deny_mask must be 0
      if ((allowMask & denyMask) !== 0) {
        throw new Error(`Invalid override for ${module}:${submodule} - allow_mask and deny_mask cannot overlap`);
      }

      // Only store rows where there is an explicit allow or deny override
      if (allowMask > 0 || denyMask > 0) {
        await client.query(
          `INSERT INTO user_permission_overrides
             (user_id, module, submodule, allow_mask, deny_mask, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [targetUserId, module, submodule, allowMask, denyMask, req.user.id]
        );
        insertedCount++;
      }
    }

    // Insert audit log entry
    await client.query(
      `INSERT INTO permission_audit_logs (user_id, action, target_type, target_id, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user.id,
        'update_user_permission_overrides',
        'user',
        targetUserId,
        JSON.stringify({ before: oldOverrides, after: overrides }),
        req.ip,
        req.headers['user-agent'] || null,
      ]
    );

    await client.query('COMMIT');

    // Real-Time: push permission change notification to affected user's socket
    dispatchPermissionChange(targetUserId, {
      changedBy: req.user.id,
      overridesCount: insertedCount,
    });

    res.json({ success: true, saved: insertedCount });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Save permission-overrides error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/users/:id/permission-overrides — reset all overrides for a user to INHERIT
router.delete('/:id/permission-overrides', ...adminOnly, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { rows: oldOverrides } = await client.query(
      'SELECT module, submodule, allow_mask, deny_mask FROM user_permission_overrides WHERE user_id = $1',
      [targetUserId]
    );

    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetUserId]);

    await client.query(
      `INSERT INTO permission_audit_logs (user_id, action, target_type, target_id, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user.id,
        'reset_user_permission_overrides',
        'user',
        targetUserId,
        JSON.stringify({ before: oldOverrides, after: [] }),
        req.ip,
        req.headers['user-agent'] || null,
      ]
    );

    await client.query('COMMIT');

    dispatchPermissionChange(targetUserId, {
      changedBy: req.user.id,
      reset: true,
    });

    res.json({ success: true, reset: true });
  } catch (err) {
    await client.query('ROLLBACK');
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
router.put('/:id/permissions', ...adminOnly, async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_permissions WHERE user_id=$1', [id]);
    for (const p of permissions) {
      await client.query(
        'INSERT INTO user_permissions (user_id, module, permission_key, allowed) VALUES ($1,$2,$3,$4)',
        [id, p.module, p.permission_key, Boolean(p.allowed)]
      );
    }
    await client.query('COMMIT');

    dispatchPermissionChange(id, {
      changedBy: req.user.id,
      permissionsCount: permissions.length,
    });

    res.json({ saved: permissions.length });
  } catch (err) {
    await client.query('ROLLBACK');
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

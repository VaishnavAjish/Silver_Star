const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent, dispatchPermissionChange } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

// GET /api/admin/users/:id/permissions
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

// PUT /api/admin/users/:id/permissions  — bulk replace
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

    // Real-Time: push permission change directly to the affected user's socket
    // The client will call /api/auth/me to refresh their session without logout
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

// PUT /api/admin/users/:id/preferences  — bulk replace
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

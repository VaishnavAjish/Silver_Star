/**
 * Self-service current-user endpoints. Unlike the admin preference API
 * (routes/adminPermissions.js, admin-only, any user), these operate ONLY on the
 * authenticated caller (req.user.id) and ONLY on a small whitelist of nav.*
 * preference keys. Permission/role keys can never be written here.
 */
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { validatePreferences } = require('../services/navPreferences');
const { loadInventoryAuthContext } = require('../services/inventoryAuth');

const router = express.Router();
const SELF_KEYS = ['nav.shortcuts', 'nav.collapsed', 'nav.compact'];

// GET /api/me/preferences — the current user's self-service preferences only.
router.get('/preferences', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT pref_key, pref_value FROM user_preferences WHERE user_id=$1 AND pref_key = ANY($2::text[])',
      [req.user.id, SELF_KEYS]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/me/preferences — upsert ONLY whitelisted keys, ONLY for req.user.
router.put('/preferences', authenticate, async (req, res) => {
  const check = validatePreferences(req.body && req.body.preferences);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    for (const p of check.sanitized) {
      // Scoped to the authenticated user — a caller can never target another id.
      await client.query('DELETE FROM user_preferences WHERE user_id=$1 AND pref_key=$2', [req.user.id, p.pref_key]);
      await client.query('INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES ($1,$2,$3)', [req.user.id, p.pref_key, p.pref_value]);
    }
    await client.query('COMMIT');
    res.json({ saved: check.sanitized.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/me/access — effective authorization contract for the caller.
// Informational only — frontend must not skip API calls based on this;
// the backend enforces independently on every request.
router.get('/access', authenticate, async (req, res) => {
  try {
    const ctx = await loadInventoryAuthContext(req.user.id, req.user.role);
    res.json({
      inventory: {
        can_view:           ctx.canViewInventory,
        can_export:         ctx.canExport,
        can_view_financial: ctx.canViewFinancial,
        scope_mode:         ctx.scopeMode,
        // allowed_dept_ids only populated for SELECTED mode
        allowed_dept_ids:   ctx.scopeMode === 'SELECTED' ? ctx.allowedDeptIds : [],
        include_unassigned: ctx.includeUnassigned,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

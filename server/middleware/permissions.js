const pool = require('../db/pool');
const { hasPermission, PERM_BITS, checkPermissionBitmask } = require('../utils/permissions');
const { logger } = require('./logger');

// Legacy role defaults kept as final fallback
const ROLE_DEFAULTS = {
  operator: {
    dashboard:  ['view'],
    inventory:  ['view', 'create', 'edit', 'export', 'print'],
    purchase:   ['view', 'create', 'edit', 'print'],
    sales:      ['view', 'create', 'edit', 'print'],
    process:    ['view', 'create', 'edit'],
    rough:      ['view', 'create', 'edit'],
    assets:     ['view', 'print'],
    accounting: ['view', 'create', 'edit'],
    reports:    ['view', 'export', 'print'],
    management:    ['view'],
    manufacturing: ['view', 'create', 'edit'],
  },
  viewer: {
    dashboard:     ['view'],
    inventory:     ['view', 'print'],
    purchase:      ['view', 'print'],
    sales:         ['view', 'print'],
    process:       ['view'],
    rough:         ['view'],
    assets:        ['view'],
    accounting:    ['view'],
    reports:       ['view', 'print'],
    management:    ['view'],
    manufacturing: ['view'],
  },
};

/**
 * Middleware factory: checkPermission('inventory', 'create')
 * Checks in order:
 *   0. Super Admin bypass (full unrestricted access)
 *   1. User's RBAC role permissions (via role_permissions table)
 *   2. Legacy admin role bypass
 *   3. Legacy user_permissions overrides
 *   4. Legacy ROLE_DEFAULTS
 */
function checkPermission(module, action, submodule = '') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // 0. Super Admin — full unrestricted access to everything
    if (req.user.role === 'super_admin' || req.user.role === 'superadmin' || req.user.role === 'super admin') {
      return next();
    }

    try {
      // Check if user has RBAC entries configured for this module
      const { rows: [rbacCountRow] } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.user_id = $1 AND rp.module = $2`,
        [req.user.id, module]
      );

      const hasRbacConfig = rbacCountRow && rbacCountRow.count > 0;

      if (hasRbacConfig) {
        const hasPerm = await hasPermission(req.user.id, module, action, submodule);
        if (hasPerm) return next();

        // Strict RBAC match: when RBAC entries exist, deny immediately if permission bit is 0
        return res.status(403).json({ error: `Permission denied: ${module}.${action}` });
      }

      // 3. Legacy user_permissions overrides
      const { rows } = await pool.query(
        'SELECT allowed FROM user_permissions WHERE user_id=$1 AND module=$2 AND permission_key=$3',
        [req.user.id, module, action]
      );
      if (rows.length > 0) {
        return rows[0].allowed
          ? next()
          : res.status(403).json({ error: `Permission denied: ${module}.${action}` });
      }

      // 4. Legacy ROLE_DEFAULTS fallback ONLY when no RBAC configuration exists
      const allowed = ROLE_DEFAULTS[req.user.role]?.[module]?.includes(action) ?? false;
      return allowed ? next() : res.status(403).json({ error: `Permission denied: ${module}.${action}` });
    } catch (err) {
      logger.error('checkPermission error', { error: err.message, stack: err.stack });
      res.status(500).json({ error: 'Server error' });
    }
  };
}

module.exports = { checkPermission, ROLE_DEFAULTS };

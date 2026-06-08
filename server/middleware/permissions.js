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
    if (req.user.role === 'super_admin') return next();

    try {
      // 1. Check RBAC role_permissions via user_roles
      const hasPerm = await hasPermission(req.user.id, module, action, submodule);
      if (hasPerm) return next();

      // Also check module-level (submodule = '') if submodule-specific returned nothing
      if (submodule) {
        const hasModulePerm = await hasPermission(req.user.id, module, action, '');
        if (hasModulePerm) return next();
      }

      // 2. Legacy admin role bypass
      if (req.user.role === 'admin') return next();

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

      // 4. Legacy ROLE_DEFAULTS fallback
      const allowed = ROLE_DEFAULTS[req.user.role]?.[module]?.includes(action) ?? false;
      return allowed ? next() : res.status(403).json({ error: `Permission denied: ${module}.${action}` });
    } catch (err) {
      logger.error('checkPermission error', { error: err.message, stack: err.stack });
      res.status(500).json({ error: 'Server error' });
    }
  };
}

module.exports = { checkPermission, ROLE_DEFAULTS };

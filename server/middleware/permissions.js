const { hasPermission, PERM_BITS, resolveEffectivePermission } = require('../utils/permissions');
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
 * Evaluates canonical effective permission resolution.
 */
//
// BRICK 8 NOTE — this factory has NO callers. A walk of the built router found
// zero routes using it (server/security/rbac/routeIntrospection.js), so before
// Brick 8 no production endpoint consulted the effective-permission resolver
// through middleware at all. It is kept, and tagged, so that if it is ever used
// the Brick 8 installer recognises it as a legacy guard for the same capability
// and does not stack it behind the new one. New enforcement should use
// server/security/rbac/requireEffectivePermission.js, which adds rollout modes,
// telemetry, a request-scoped cache, and 503-not-500 on resolver failure.
function checkPermission(module, action, submodule = '') {
  const guard = async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Super Admin — full unrestricted access to everything
    const normRole = String(req.user.role || '').toLowerCase().trim();
    if (['super_admin', 'superadmin', 'super admin'].includes(normRole)) {
      return next();
    }

    try {
      const allowed = await hasPermission(req.user.id, module, action, submodule, req.user.role);
      if (allowed) return next();

      return res.status(403).json({ error: `Permission denied: ${module}.${action}` });
    } catch (err) {
      logger.error('checkPermission error', { error: err.message, stack: err.stack });
      res.status(500).json({ error: 'Server error' });
    }
  };
  guard.__rbacLegacyGuard = { kind: 'checkPermission', module, action, submodule };
  return guard;
}

module.exports = { checkPermission, ROLE_DEFAULTS };

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
function checkPermission(module, action, submodule = '') {
  return async (req, res, next) => {
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
}

module.exports = { checkPermission, ROLE_DEFAULTS };

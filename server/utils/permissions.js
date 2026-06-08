const pool = require('../db/pool');

/* ── Permission bit values (must match frontend constants) ── */
const PERM_BITS = {
  view:    1,
  create:  2,
  edit:    4,
  delete:  8,
  approve: 16,
  export:  32,
  print:   64,
  reject:  128,
  import:  256,
  manage:  512,
};

const FULL_ACCESS = 1023;

/**
 * Get effective permissions for a user on a given module+submodule.
 * Checks: role_permissions via user_roles → then legacy user_permissions fallback
 * Returns a bitmask integer.
 */
async function getUserPermissionBitmask(userId, module, submodule = '') {
  const { rows: [row] } = await pool.query(
    `SELECT BIT_OR(rp.permissions) AS mask
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1 AND rp.module = $2 AND rp.submodule = $3`,
    [userId, module, submodule]
  );

  if (row && row.mask != null) {
    return parseInt(row.mask);
  }

  // Fallback: legacy user_permissions table
  const { rows: legacyRows } = await pool.query(
    `SELECT permission_key, allowed FROM user_permissions
     WHERE user_id = $1 AND module = $2`,
    [userId, module]
  );

  if (legacyRows.length > 0) {
    let mask = 0;
    for (const p of legacyRows) {
      if (p.allowed && PERM_BITS[p.permission_key] !== undefined) {
        mask |= PERM_BITS[p.permission_key];
      }
    }
    return mask;
  }

  return 0;
}

/**
 * Check if a user has a specific permission action on a module (and optional submodule).
 */
async function hasPermission(userId, module, action, submodule = '') {
  const bit = PERM_BITS[action];
  if (bit === undefined) return false;
  const mask = await getUserPermissionBitmask(userId, module, submodule);
  return (mask & bit) === bit;
}

/**
 * Synchronous permission check using a pre-loaded permissions map.
 * Useful for middleware after permissions are loaded.
 */
function checkPermissionBitmask(mask, action) {
  const bit = PERM_BITS[action];
  if (bit === undefined) return false;
  return (mask & bit) === bit;
}

/**
 * Convert an array of action names to a bitmask integer.
 */
function actionsToBitmask(actions) {
  let mask = 0;
  if (!Array.isArray(actions)) return mask;
  for (const a of actions) {
    if (PERM_BITS[a] !== undefined) mask |= PERM_BITS[a];
  }
  return mask;
}

/**
 * Convert a bitmask integer to an array of action names.
 */
function bitmaskToActions(mask) {
  const actions = [];
  for (const [action, bit] of Object.entries(PERM_BITS)) {
    if ((mask & bit) === bit) actions.push(action);
  }
  return actions;
}

module.exports = {
  PERM_BITS,
  FULL_ACCESS,
  getUserPermissionBitmask,
  hasPermission,
  checkPermissionBitmask,
  actionsToBitmask,
  bitmaskToActions,
};

const pool = require('../db/pool');

/* Read lazily, so the switch can be changed for a test without this module
   having been loaded in a particular order. See the long note at the legacy
   fallback branch below for why it exists and why it is on by default. */
function legacyFallbackEnabled() {
  return require('../security/rbac/enforcementConfig').isLegacyUserPermissionsFallbackEnabled();
}

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
  sidebar: 1024,
  override_weight_variance: 2048,
  override_seed_resolution: 4096,
};

const ALL_PERMISSION_BITS = Object.values(PERM_BITS).reduce((a, b) => a | b, 0); // 4095
const FULL_ACCESS = ALL_PERMISSION_BITS;

/**
 * Resolve canonical effective permission bitmask for a user on a given module+submodule.
 * Effective precedence:
 *   1. Super Admin bypass (FULL_ACCESS)
 *   2. Role baseline permissions (role_mask)
 *   3. User overrides (allow_mask, deny_mask)
 *   Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 */
async function resolveEffectivePermission(userId, module, submodule = '', userRole = null) {
  if (!userRole) {
    const { rows: [u] } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    userRole = u?.role;
  }
  const normRole = String(userRole || '').toLowerCase().trim();
  if (['super_admin', 'superadmin', 'super admin'].includes(normRole)) {
    return ALL_PERMISSION_BITS;
  }

  // 1. Query role baseline mask
  const { rows: [roleRow] } = await pool.query(
    `SELECT BIT_OR(rp.permissions) AS mask
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1 AND rp.module = $2 AND rp.submodule = $3`,
    [userId, module, submodule]
  );
  const roleMask = roleRow && roleRow.mask != null ? parseInt(roleRow.mask) : 0;

  // 2. Query user overrides
  const { rows: [overrideRow] } = await pool.query(
    `SELECT allow_mask, deny_mask FROM user_permission_overrides
     WHERE user_id = $1 AND module = $2 AND submodule = $3`,
    [userId, module, submodule]
  );

  let allowMask = 0;
  let denyMask = 0;

  if (overrideRow) {
    allowMask = parseInt(overrideRow.allow_mask || 0);
    denyMask = parseInt(overrideRow.deny_mask || 0);
  }

  // 3. Fallback: if no role_permissions AND no overrides exist for user, check legacy user_permissions
  //
  // RBAC BRICK 8 — WHY THIS IS NOW CONDITIONAL, AND WHY IT IS STILL ON
  // ────────────────────────────────────────────────────────────────────
  // Brick 5 could not certify Default Deny while this branch exists: a user with
  // no role rows and no overrides — which ought to mean "no access" — can still
  // be granted permissions from a table nothing writes to any more. The intended
  // end state is that effective access derives only from the Super Admin bypass,
  // role_permissions and user_permission_overrides.
  //
  // It is not removed here because the claim "user_permissions is empty" cannot
  // be verified from this environment: the development database is unreachable,
  // so the evidence for deletion does not exist. Deleting the branch on the
  // strength of a belief would silently revoke access from anybody it is
  // currently serving.
  //
  // So the branch sits behind a switch that defaults to the present behaviour.
  // Set RBAC_LEGACY_USER_PERMISSIONS_FALLBACK=false once the table is confirmed
  // empty in production. The table itself is never dropped by this code.
  if (!roleRow?.mask && !overrideRow && legacyFallbackEnabled()) {
    const { rows: legacyRows } = await pool.query(
      `SELECT permission_key, allowed FROM user_permissions
       WHERE user_id = $1 AND module = $2`,
      [userId, module]
    );
    if (legacyRows.length > 0) {
      for (const p of legacyRows) {
        if (p.allowed && PERM_BITS[p.permission_key] !== undefined) {
          allowMask |= PERM_BITS[p.permission_key];
        }
      }
    }
  }

  // Calculate effective mask limited to ALL_PERMISSION_BITS
  const effectiveMask = ((roleMask | allowMask) & ~denyMask) & ALL_PERMISSION_BITS;
  return effectiveMask;
}

/**
 * Get all effective permissions for a user across modules and submodules.
 * Used for /api/auth/me payload.
 */
async function getAllEffectivePermissionsForUser(userId, userRole = null) {
  if (!userRole) {
    const { rows: [u] } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    userRole = u?.role;
  }
  const normRole = String(userRole || '').toLowerCase().trim();
  const isSuperAdmin = ['super_admin', 'superadmin', 'super admin'].includes(normRole);

  if (isSuperAdmin) {
    return [{ module: '*', submodule: '*', mask: ALL_PERMISSION_BITS }];
  }

  // Fetch all role permissions for user
  const { rows: rolePerms } = await pool.query(
    `SELECT rp.module, rp.submodule, BIT_OR(rp.permissions)::int AS mask
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1
     GROUP BY rp.module, rp.submodule`,
    [userId]
  );

  // Fetch all user permission overrides for user
  const { rows: overrides } = await pool.query(
    `SELECT module, submodule, allow_mask, deny_mask
     FROM user_permission_overrides
     WHERE user_id = $1`,
    [userId]
  );

  // Fetch legacy user permissions — same switch as resolveEffectivePermission,
  // so the /api/auth/me payload and a route decision can never disagree about
  // whether the legacy table counts.
  const { rows: legacyPerms } = legacyFallbackEnabled()
    ? await pool.query(
      `SELECT module, permission_key, allowed
       FROM user_permissions WHERE user_id = $1`,
      [userId]
    )
    : { rows: [] };

  const map = new Map();

  for (const r of rolePerms) {
    const key = `${r.module}:${r.submodule}`;
    map.set(key, { module: r.module, submodule: r.submodule, roleMask: r.mask || 0, allowMask: 0, denyMask: 0 });
  }

  for (const o of overrides) {
    const key = `${o.module}:${o.submodule}`;
    const existing = map.get(key) || { module: o.module, submodule: o.submodule, roleMask: 0, allowMask: 0, denyMask: 0 };
    existing.allowMask = o.allow_mask || 0;
    existing.denyMask = o.deny_mask || 0;
    map.set(key, existing);
  }

  if (rolePerms.length === 0 && overrides.length === 0 && legacyPerms.length > 0) {
    const legacyMap = new Map();
    for (const lp of legacyPerms) {
      const key = `${lp.module}:`;
      let mask = legacyMap.get(key) || 0;
      if (lp.allowed && PERM_BITS[lp.permission_key]) {
        mask |= PERM_BITS[lp.permission_key];
      }
      legacyMap.set(key, mask);
    }
    for (const [key, mask] of legacyMap.entries()) {
      const [mod, sub] = key.split(':');
      map.set(key, { module: mod, submodule: sub, roleMask: 0, allowMask: mask, denyMask: 0 });
    }
  }

  const result = [];
  for (const [key, item] of map.entries()) {
    const effMask = ((item.roleMask | item.allowMask) & ~item.denyMask) & ALL_PERMISSION_BITS;
    result.push({
      module: item.module,
      submodule: item.submodule,
      mask: effMask,
      role_mask: item.roleMask,
      allow_mask: item.allowMask,
      deny_mask: item.denyMask
    });
  }

  return result;
}

/**
 * Legacy compatibility helper.
 */
async function getUserPermissionBitmask(userId, module, submodule = '') {
  return resolveEffectivePermission(userId, module, submodule);
}

/**
 * Check if a user has a specific permission action on a module (and optional submodule).
 */
async function hasPermission(userId, module, action, submodule = '', userRole = null) {
  const bit = PERM_BITS[action];
  if (bit === undefined) return false;
  const mask = await resolveEffectivePermission(userId, module, submodule, userRole);
  return (mask & bit) === bit;
}

/**
 * Synchronous permission check using a pre-loaded permissions map/bitmask.
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
  return mask & ALL_PERMISSION_BITS;
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
  ALL_PERMISSION_BITS,
  FULL_ACCESS,
  getUserPermissionBitmask,
  resolveEffectivePermission,
  getAllEffectivePermissionsForUser,
  hasPermission,
  checkPermissionBitmask,
  actionsToBitmask,
  bitmaskToActions,
};

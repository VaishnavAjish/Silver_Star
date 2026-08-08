/**
 * RBAC Brick 8 — the one place that decides who bypasses inventory department
 * scope, and what scope an unconfigured user gets.
 *
 * THE DISAGREEMENT THIS REPLACES
 * ───────────────────────────────
 * services/inventoryAuth.js carried two role lists answering the same question
 * differently:
 *
 *   FINANCIAL_BYPASS_ROLES  super_admin, superadmin, "super admin", admin,
 *                           administrator, management, manager, owner, developer
 *     — consulted by requireInventoryView, which on a match hands back
 *       scopeMode ALL and ignores whatever scope an administrator configured.
 *
 *   SUPER_ADMIN_ROLES       super_admin, superadmin, "super admin"
 *     — consulted by loadDeptScope, which honours the stored scope for everyone
 *       else.
 *
 * The observable consequence: an `admin` sees every department on the Inventory
 * page (requireInventoryView) and only their configured departments on Stock
 * Transfer, Lot Movements and global search (loadDeptScope). The Admin Panel
 * shows one stored scope while the system enforces two different things.
 *
 * WHY THIS FILE DOES NOT SIMPLY PICK ONE
 * ───────────────────────────────────────
 * Both readings are defensible. "An administrator should see everything" is a
 * real position; so is "an administrator's configured scope should mean what it
 * says". Choosing costs somebody access or grants somebody visibility, and
 * neither is an enforcement decision.
 *
 * So: one implementation, two policies, and the one that reproduces today's
 * behaviour exactly is the default.
 *
 *   compatibility (default)  per-call-site lists, byte-identical to today
 *   canonical                Super Admin alone bypasses, everywhere
 *
 * Switching to `canonical` NARROWS visibility for admin, administrator,
 * management, manager, owner and developer. It is an owner's decision, made by
 * setting RBAC_INVENTORY_SCOPE_POLICY=canonical, and it is reversible.
 *
 * WHAT THIS FILE DOES NOT DECIDE
 * ───────────────────────────────
 * Whether a user holds a capability. That is the resolver's job. Scope answers
 * "which rows", never "which actions".
 */

'use strict';

const { getInventoryScopePolicy } = require('./enforcementConfig');

/** Roles that are Super Admin under any spelling used in this codebase. */
const SUPER_ADMIN_ROLES = Object.freeze(['super_admin', 'superadmin', 'super admin']);

/**
 * The wider list consulted by requireInventoryView today. Preserved verbatim —
 * including `developer`, a role no seeded configuration creates, kept only
 * because removing it would be a live access change.
 */
const LEGACY_WIDE_BYPASS_ROLES = Object.freeze([
  ...SUPER_ADMIN_ROLES,
  'admin',
  'administrator',
  'management',
  'manager',
  'owner',
  'developer',
]);

/** The call sites, named so a policy can differ between them honestly. */
const CALL_SITES = Object.freeze({
  /** services/inventoryAuth.js requireInventoryView — Inventory list/detail. */
  INVENTORY_VIEW: 'requireInventoryView',
  /** services/inventoryAuth.js loadDeptScope — Stock Transfer, movements, search. */
  DEPT_SCOPE: 'loadDeptScope',
  /** Financial field visibility. */
  FINANCIAL: 'financialFields',
});

function normalise(role) {
  return String(role || '').toLowerCase().trim();
}

function isSuperAdmin(role) {
  return SUPER_ADMIN_ROLES.includes(normalise(role));
}

/**
 * Does this role see every department regardless of stored scope?
 *
 * @param {string} role
 * @param {{callSite: string, policy?: string}} options
 * @returns {boolean}
 */
function bypassesDepartmentScope(role, { callSite, policy = getInventoryScopePolicy() } = {}) {
  if (isSuperAdmin(role)) return true;
  if (policy === 'canonical') return false;

  // Compatibility: reproduce each call site's historical answer exactly.
  if (callSite === CALL_SITES.DEPT_SCOPE) return false;
  return LEGACY_WIDE_BYPASS_ROLES.includes(normalise(role));
}

/**
 * Does this role always see financial columns, without holding
 * inventory.inventory_financial?
 *
 * Kept on the same switch: the wide list is the same list, and splitting the two
 * would create a third rule to reconcile later.
 */
function bypassesFinancialFields(role, { policy = getInventoryScopePolicy() } = {}) {
  return bypassesDepartmentScope(role, { callSite: CALL_SITES.FINANCIAL, policy });
}

/**
 * The scope a user gets when `user_inventory_scopes` holds no row for them.
 *
 * THE SECOND INCONSISTENCY, RECORDED RATHER THAN SILENTLY CHANGED
 * ───────────────────────────────────────────────────────────────
 * The backend defaults `operator_restricted` to NONE while defaulting every
 * other role to ALL. Brick 4 found that the Admin scope API reports ALL for an
 * unconfigured user whatever their role — so the panel can show "All
 * departments" for an operator_restricted user who is in fact seeing nothing.
 *
 * That display/enforcement split is why this function exists: the Admin preview
 * and the runtime can now call the SAME function and agree. Brick 8 does not
 * change either default, because raising operator_restricted to ALL would grant
 * visibility and lowering everyone else to NONE would remove it.
 *
 * @returns {'ALL'|'NONE'}
 */
function defaultScopeModeForRole(role) {
  return normalise(role) === 'operator_restricted' ? 'NONE' : 'ALL';
}

/** True when this role's default differs from the ALL the Admin API reports. */
function hasDefaultScopeAmbiguity(role) {
  return defaultScopeModeForRole(role) !== 'ALL';
}

module.exports = {
  SUPER_ADMIN_ROLES,
  LEGACY_WIDE_BYPASS_ROLES,
  CALL_SITES,
  isSuperAdmin,
  bypassesDepartmentScope,
  bypassesFinancialFields,
  defaultScopeModeForRole,
  hasDefaultScopeAmbiguity,
};

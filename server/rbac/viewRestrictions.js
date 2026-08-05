/**
 * Catalog data — VIEW RESTRICTIONS.
 *
 * These are NOT action permissions and deliberately live outside the
 * `permissions` array: they are a distinct setting type with their own storage
 * and their own enforcement story.
 *
 * Verified against:
 *   server/services/inventoryAuth.js:42     FINANCIAL_FIELDS strip list
 *   server/services/inventoryAuth.js:57     resolveCanViewFinancial
 *   server/services/inventoryAuth.js:87-101 user_inventory_scopes / _depts
 *   server/services/inventoryAuth.js:236    loadDeptScope (Phase A canonical scope)
 *   server/routes/adminUsers.js:178,209     inventory-scope read/write
 *   client/src/modules/admin-panel/pages/UserDrawer.jsx:12-20  VISIBILITY_KEYS
 *   client/src/core/context/AuthContext.jsx:241                getVisibility
 *
 * The vis.* flags are stored, editable and copied between users, but a
 * repository-wide search finds NO consumer of `getVisibility` anywhere in the
 * client and no server-side reader at all. They are therefore reported as
 * STORED_NOT_ENFORCED and must never be labelled secure.
 */

'use strict';

const RESTRICTION_STATUSES = Object.freeze(['ENFORCED', 'STORED_NOT_ENFORCED']);
const SETTING_TYPES = Object.freeze(['DEPARTMENT_SCOPE', 'CAPABILITY_PERMISSION', 'USER_PREFERENCE']);

const UNENFORCED_WARNING = 'Stored configuration; no active backend enforcement.';

function defineRestriction(input) {
  if (!RESTRICTION_STATUSES.includes(input.status)) {
    throw new Error(`[view-restrictions] ${input.code}: invalid status "${input.status}"`);
  }
  if (!SETTING_TYPES.includes(input.settingType)) {
    throw new Error(`[view-restrictions] ${input.code}: invalid setting_type "${input.settingType}"`);
  }
  if (!String(input.label || '').trim()) {
    throw new Error(`[view-restrictions] ${input.code}: label must not be empty`);
  }
  return Object.freeze({
    code:           input.code,
    business_group: 'View Restrictions',
    label:          input.label,
    description:    input.description,
    setting_type:   input.settingType,
    storage:        input.storage,
    status:         input.status,
    risk_level:     input.risk,
    /** Present ONLY on unenforced settings — the future UI must render it. */
    warning: input.status === 'STORED_NOT_ENFORCED' ? UNENFORCED_WARNING : null,
    enforced_by: Object.freeze([...(input.enforcedBy || [])]),
    refs:        Object.freeze([...(input.refs || [])]),
    notes:       Object.freeze([...(input.notes || [])]),
  });
}

/** The seven financial visibility preferences offered by the User Drawer. */
const VIS_PREFERENCE_KEYS = [
  { key: 'vis.show_cogs',          label: 'Cost of Goods (COGS)' },
  { key: 'vis.show_purchase_rate', label: 'Purchase Rate' },
  { key: 'vis.show_sale_rate',     label: 'Sale Rate' },
  { key: 'vis.show_margin',        label: 'Margin %' },
  { key: 'vis.show_gross_profit',  label: 'Gross Profit' },
  { key: 'vis.show_net_profit',    label: 'Net Profit' },
  { key: 'vis.show_balances',      label: 'Account Balances' },
];

const visPreferenceEntries = VIS_PREFERENCE_KEYS.map(({ key, label }) =>
  defineRestriction({
    code: key,
    label,
    description: `Stored per-user flag intended to control whether ${label} is displayed.`,
    settingType: 'USER_PREFERENCE',
    storage: 'user_preferences.pref_key (TEXT "true"/"false", default "true")',
    status: 'STORED_NOT_ENFORCED',
    risk: 'LOW',
    refs: [
      'client/src/modules/admin-panel/pages/UserDrawer.jsx:12',
      'client/src/core/context/AuthContext.jsx:241',
    ],
    notes: [
      'AuthContext exposes getVisibility(key) but no component in client/src calls it.',
      'No server route reads any vis.* preference; adminUsers.js:393 only EXCLUDES vis.% from the copy-setup flow.',
      'Turning this off hides nothing today. The enforced financial control is the inventory.inventory_financial permission.',
    ],
  })
);

const VIEW_RESTRICTIONS = Object.freeze([
  defineRestriction({
    code: 'scope.inventory_department',
    label: 'Inventory Department Access',
    description:
      'Restricts which departments\' lots a user may see across Inventory, Lot Movements '
      + 'and Stock Transfer. Modes: ALL, SELECTED (whitelist), NONE.',
    settingType: 'DEPARTMENT_SCOPE',
    storage: 'user_inventory_scopes.scope_mode + user_inventory_scope_depts.department_id',
    status: 'ENFORCED',
    risk: 'CRITICAL',
    enforcedBy: [
      'server/services/inventoryAuth.js:168 buildDeptScopeClause',
      'server/services/inventoryAuth.js:200 isLotInScope',
      'server/services/inventoryAuth.js:236 loadDeptScope',
      'server/services/inventoryAuth.js:281 buildMovementScopeClause',
    ],
    refs: ['server/routes/adminUsers.js:178', 'server/routes/adminUsers.js:209'],
    notes: [
      'There is exactly ONE scope model (Phase A). users.department_id plays no part in visibility.',
      'SELECTED with an empty whitelist fails closed (treated as NONE).',
      'Scope NONE returns zero rows rather than 403, to avoid enumeration.',
      'super_admin bypasses the scope entirely.',
    ],
  }),

  defineRestriction({
    code: 'inventory.inventory_financial',
    label: 'Financial Field Visibility',
    description:
      'Controls whether rate / cost / value / margin fields are serialised on inventory responses. '
      + 'Backed by a real permission key, not a preference.',
    settingType: 'CAPABILITY_PERMISSION',
    storage: 'role_permissions / user_permission_overrides (module inventory, submodule inventory_financial)',
    status: 'ENFORCED',
    risk: 'CRITICAL',
    enforcedBy: [
      'server/services/inventoryAuth.js:57 resolveCanViewFinancial',
      'server/services/inventoryAuth.js:157 stripFinancial',
    ],
    refs: ['server/services/inventoryAuth.js:42'],
    notes: [
      'Fields are ABSENT from the payload when denied — never null or zero.',
      'Nine role strings bypass it outright: super_admin, superadmin, "super admin", admin, administrator, management, manager, owner, developer.',
      'No seeded role_permissions row exists for inventory.inventory_financial, so only the bypass roles see financial fields today.',
      'Also catalogued as a permission entry so the twelve-group invariant holds; this record is the View Restrictions view of the same control.',
    ],
  }),

  ...visPreferenceEntries,
]);

module.exports = {
  VIEW_RESTRICTIONS,
  RESTRICTION_STATUSES,
  SETTING_TYPES,
  UNENFORCED_WARNING,
};

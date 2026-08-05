/**
 * Catalog data — ADMINISTRATION, MASTER DATA, and the phantom HR / Finance rows.
 *
 * Verified against:
 *   server/routes/roles.js:104  `admin`        (4 submodules)
 *   server/routes/roles.js:111  `hr`           (no live page)
 *   server/routes/roles.js:116  `finance`      (no live page)
 *   server/routes/roles.js:121  `master_data`  (6 submodules)
 *   client/src/core/navigation/registry.js:132-145  Management + Admin Panel rows
 *   client/src/router/index.jsx:95-105              MASTER_CONFIGS dynamic routes
 *   server/routes/masterFactory.js:151,171,196      role-string guards
 *   server/routes/adminUsers.js, adminPermissions.js:9, roles.js:330
 *
 * CRITICAL STRUCTURAL FINDING recorded here: the `management` module appears in
 * the sidebar under NINE submodules but in phase35-rbac.sql only as a single
 * module-level row. Neither MODULE_TREE lists it, so the startup seeder and the
 * Role Management grid can never create or edit those nine keys.
 */

'use strict';

const { defineEntry } = require('../catalogShared');

/** Management sidebar keys with no baseline row anywhere. */
const MANAGEMENT_KEYS = [
  {
    key: 'items_master', label: 'Items Master', group: 'Inventory', subgroup: 'Stock',
    risk: 'HIGH', path: '/items', line: 134, duplicateOf: 'inventory.items_master',
  },
  {
    key: 'departments', label: 'Departments', group: 'Administration', subgroup: 'Master Data',
    risk: 'HIGH', path: '/departments', line: 135, duplicateOf: 'master_data.departments',
  },
  {
    key: 'locations', label: 'Locations', group: 'Administration', subgroup: 'Master Data',
    risk: 'HIGH', path: '/locations', line: 136, duplicateOf: 'master_data.locations',
  },
  {
    key: 'uom', label: 'Units of Measure', group: 'Administration', subgroup: 'Master Data',
    risk: 'MEDIUM', path: '/uom', line: 137, duplicateOf: 'master_data.uom',
  },
  {
    key: 'expense_categories', label: 'Expense Categories', group: 'Administration',
    subgroup: 'Master Data', risk: 'MEDIUM', path: '/expense-categories', line: 138,
    duplicateOf: 'master_data.expense_categories',
  },
  {
    key: 'asset_categories', label: 'Asset Categories', group: 'Administration',
    subgroup: 'Master Data', risk: 'MEDIUM', path: '/fixed-asset-categories', line: 139,
    duplicateOf: 'master_data.asset_categories',
  },
  {
    key: 'machines', label: 'Machines', group: 'Administration', subgroup: 'Master Data',
    risk: 'HIGH', path: '/machines', line: 63, duplicateOf: 'master_data.machines',
  },
  {
    key: 'process_master', label: 'Process Master', group: 'Manufacturing',
    subgroup: 'Process Flow', risk: 'HIGH', path: '/manufacturing/process-master', line: 64,
    duplicateOf: 'manufacturing.process_master',
  },
];

const managementEntries = MANAGEMENT_KEYS.map(
  ({ key, label, group, subgroup, risk, path, line, duplicateOf }) =>
    defineEntry({
      module: 'management', submodule: key,
      group,
      subgroup,
      label,
      description: `${label} master screen (${path}).`,
      status: 'ACTIVE',
      risk,
      control: 'ACTION_MATRIX',
      actions: ['view', 'sidebar', 'create', 'edit', 'delete'],
      hasBaselineRows: false,
      enforcement: {
        navigation: 'ENFORCED',
        // MASTER_CONFIGS routes are generated without any guard.
        frontend_route: 'NOT_ENFORCED',
        api_list: 'AUTHENTICATE_ONLY',
        api_detail: 'AUTHENTICATE_ONLY',
        api_create: 'ROLE_STRING_ONLY',
        api_edit: 'ROLE_STRING_ONLY',
        api_delete: 'ROLE_STRING_ONLY',
      },
      frontendRefs: [
        `client/src/core/navigation/registry.js:${line}`,
        'client/src/router/index.jsx:95',
      ],
      backendRefs: [
        'server/routes/masterFactory.js:151',
        'server/routes/masterFactory.js:171',
        'server/routes/masterFactory.js:196',
      ],
      notes: [
        'UNMAPPED SIDEBAR CODE: `management` is in neither MODULE_TREE, so no role_permissions row is ever seeded for this key.',
        `A seeded row for the same capability exists under ${duplicateOf}.`,
        'AuthContext.hasPermission finds no management submodule row and falls back to the module-level management row (mask 1 = view) seeded by phase35-rbac.sql.',
        'The generated master route has no <PermissionGuard>; direct URL entry is not blocked.',
      ],
    })
);

const masterDataEntries = [
  { key: 'departments',        label: 'Departments',        risk: 'HIGH' },
  { key: 'locations',          label: 'Locations',          risk: 'HIGH' },
  { key: 'machines',           label: 'Machines',           risk: 'HIGH' },
  { key: 'uom',                label: 'Units of Measure',   risk: 'MEDIUM' },
  { key: 'expense_categories', label: 'Expense Categories', risk: 'MEDIUM' },
  { key: 'asset_categories',   label: 'Asset Categories',   risk: 'MEDIUM' },
].map(({ key, label, risk }) =>
  defineEntry({
    module: 'master_data', submodule: key,
    group: 'Administration',
    subgroup: 'Master Data',
    label: `${label} (master data)`,
    description: `Seeded ${label.toLowerCase()} permission in the recommended canonical namespace.`,
    // Seeded and grantable, but the live screens were re-keyed to management.*
    // so nothing resolves this namespace today. ACTIVE would overstate it.
    status: 'LEGACY_ORPHAN',
    risk,
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit', 'delete'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:121'],
    notes: [
      `RECOMMENDED CANONICAL OWNER for the ${label.toLowerCase()} capability in a later brick.`,
      `Duplicated by manufacturing.${key} (seeded) and management.${key} (live sidebar key, unseeded).`,
      'Seeded and editable in the Role Management grid, but verified to have no live reader — granting it changes nothing today.',
    ],
  })
);

module.exports = [
  /* ── Management module baseline ────────────────────────────────────────── */
  defineEntry({
    module: 'management', submodule: '',
    group: 'Administration',
    label: 'Management (module access)',
    description: 'The ONLY seeded management row. Every management sidebar entry falls back to it.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'ROLE_STRING_ONLY', api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    backendRefs: [
      'server/migrations/phase35-rbac.sql:92',
      'server/migrations/phase35-rbac.sql:112',
    ],
    notes: [
      'Seeded with mask 1 (view) for operator and viewer only, by migration — not by the startup seeder.',
      'Because AuthContext falls back to the module row, one management view bit reveals all nine management sidebar rows at once.',
    ],
  }),

  ...managementEntries,

  defineEntry({
    module: 'management', submodule: 'cost_centres',
    group: 'Administration',
    subgroup: 'Master Data',
    label: 'Cost Centres',
    description: 'Cost centre master and the cost centre correction workspace.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:140',
      'client/src/core/navigation/registry.js:141',
      'client/src/modules/management/routes.js',
    ],
    backendRefs: [
      'server/routes/costCenters.js',
      'server/routes/costCenterCorrections.js',
      'server/routes/costCenterBulk.js',
    ],
    notes: [
      'REPORTED GAP: Cost Centres has NO backend permission row in any namespace — not management, not master_data, not manufacturing.',
      'Two sidebar rows (Cost Centres, Cost Centre Corrections) share this key.',
      'The cost-centre APIs are authenticate-only; corrections mutate posted allocations without a bitmask check.',
    ],
  }),

  ...masterDataEntries,

  /* ── Admin Panel ───────────────────────────────────────────────────────── */
  defineEntry({
    module: 'admin', submodule: 'users',
    group: 'Administration',
    subgroup: 'Access Control',
    label: 'Users',
    description: 'User administration: accounts, roles, overrides, scope and preferences.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete', 'manage'],
    enforcement: {
      // isEntryVisible short-circuits on adminOnly → hasRole('admin','super_admin').
      navigation: 'ROLE_STRING_ONLY',
      frontend_route: 'ROLE_STRING_ONLY',
      frontend_action: 'ROLE_STRING_ONLY',
      api_list: 'ROLE_STRING_ONLY', api_detail: 'ROLE_STRING_ONLY',
      api_create: 'ROLE_STRING_ONLY', api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:145',
      'client/src/modules/admin-panel/routes.js:7',
    ],
    backendRefs: ['server/routes/adminUsers.js', 'server/routes/adminPermissions.js:9'],
    notes: [
      'The whole Admin Panel is gated on the ROLE STRING, never on this bitmask — granting or revoking admin.users bits changes nothing.',
      'Removing the admin role string is the only way to remove admin panel access.',
    ],
  }),

  defineEntry({
    module: 'admin', submodule: 'roles',
    group: 'Administration',
    subgroup: 'Access Control',
    label: 'Roles & Permissions',
    description: 'Role CRUD, role permission grid and user-role assignment.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'ROLE_STRING_ONLY',
      frontend_action: 'ROLE_STRING_ONLY',
      api_list: 'ROLE_STRING_ONLY', api_detail: 'ROLE_STRING_ONLY',
      api_create: 'ROLE_STRING_ONLY', api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    frontendRefs: ['client/src/modules/admin-panel/pages/RoleManagementPage.jsx'],
    backendRefs: ['server/routes/roles.js:330', 'server/routes/roles.js:522'],
    notes: [
      'Every /api/roles endpoint uses authorize(\'admin\') plus a role-hierarchy check (requireRoleAuthority); no bitmask is consulted.',
      'Role Management has no sidebar row of its own — it is reached from inside the Admin Panel.',
    ],
  }),

  defineEntry({
    module: 'admin', submodule: 'audit_logs',
    group: 'Administration',
    subgroup: 'Observability',
    label: 'Audit Logs',
    description: 'Permission audit log and the admin request logger.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'export'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'ROLE_STRING_ONLY',
      frontend_action: 'ROLE_STRING_ONLY',
      api_list: 'PARTIALLY_ENFORCED', api_detail: 'PARTIALLY_ENFORCED',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/modules/admin-panel/routes.js:8'],
    backendRefs: ['server/routes/roles.js:646', 'server/routes/auditLogs.js'],
    notes: [
      'GET /api/roles/audit-log uses authorize(\'admin\'); /api/audit-logs is authenticate-only.',
      'No bitmask is consulted on either path.',
    ],
  }),

  defineEntry({
    module: 'admin', submodule: 'settings',
    group: 'Administration',
    subgroup: 'Configuration',
    label: 'Settings',
    description: 'Seeded administration settings key.',
    status: 'LEGACY_ORPHAN',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'edit'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:109'],
    notes: [
      'No settings page, route or API reads this key. It is seeded for all four system roles.',
    ],
  }),

  /* ── Phantom modules — rows exist, no verified feature ─────────────────── */
  defineEntry({
    module: 'hr', submodule: 'employees',
    group: 'Administration',
    subgroup: 'Planned (inactive)',
    label: 'Employees',
    description: 'Planned HR employee register. No page, route or API exists.',
    status: 'PLANNED_INACTIVE',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit', 'delete'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:113'],
    notes: [
      'HR is not one of the twelve approved business groups; it is filed under Administration until a real feature exists.',
      'Rows are seeded for all four roles (operator/viewer get 0). Rows must NOT be deleted.',
      'Hide behind an explicit "Show inactive permissions" filter in the future editor.',
    ],
  }),

  defineEntry({
    module: 'hr', submodule: 'attendance',
    group: 'Administration',
    subgroup: 'Planned (inactive)',
    label: 'Attendance',
    description: 'Planned HR attendance register. No page, route or API exists.',
    status: 'PLANNED_INACTIVE',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:114'],
    notes: ['Rows are seeded but no feature exists. Do not delete.'],
  }),

  defineEntry({
    module: 'finance', submodule: 'budgets',
    group: 'Accounting',
    subgroup: 'Planned (inactive)',
    label: 'Budgets',
    description: 'Planned finance budgeting module. No page, route or API exists.',
    status: 'PLANNED_INACTIVE',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit', 'approve'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:118'],
    notes: [
      'Phantom permission: rows exist, no verified application page or route.',
      'Do not delete rows. Hide behind "Show inactive permissions".',
    ],
  }),

  defineEntry({
    module: 'finance', submodule: 'cashflow',
    group: 'Accounting',
    subgroup: 'Planned (inactive)',
    label: 'Cash Flow',
    description: 'Planned finance cash-flow module. No page, route or API exists.',
    status: 'PLANNED_INACTIVE',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'export'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:119'],
    notes: [
      'Phantom permission: rows exist, no verified application page or route.',
      'The live Fund Utilization report is keyed reports:\'\' and is unrelated to this key.',
    ],
  }),
];

/**
 * Catalog data — MANUFACTURING and ROUGH DIAMONDS.
 *
 * Verified against:
 *   server/routes/roles.js:47   `process`       (legacy, no live caller)
 *   server/routes/roles.js:53   `rough`
 *   server/routes/roles.js:93   `manufacturing` (6 master-data duplicates)
 *   client/src/core/navigation/registry.js:57-74 sidebar rows
 *   server/routes/manufacturingProcesses.js      control tower API
 *   server/routes/processMaster.js               process master API
 *   server/routes/lotProcessIssues.js:1394,1650,1762  `process_return` guards
 *
 * The six master-data duplicates under `manufacturing` are marked
 * DUPLICATE_LEGACY with `master_data.*` as the recommended surviving code.
 * Nothing is merged or renamed in Brick 1.
 */

'use strict';

const { defineEntry } = require('../catalogShared');

/** The six capabilities duplicated across manufacturing / master_data / management. */
const DUPLICATED_MASTER_DATA = [
  { key: 'machines',           label: 'Machines',           risk: 'HIGH' },
  { key: 'departments',        label: 'Departments',        risk: 'HIGH' },
  { key: 'locations',          label: 'Locations',          risk: 'HIGH' },
  { key: 'uom',                label: 'Units of Measure',   risk: 'MEDIUM' },
  { key: 'expense_categories', label: 'Expense Categories', risk: 'MEDIUM' },
  { key: 'asset_categories',   label: 'Asset Categories',   risk: 'MEDIUM' },
];

const manufacturingDuplicates = DUPLICATED_MASTER_DATA.map(({ key, label, risk }) =>
  defineEntry({
    module: 'manufacturing', submodule: key,
    group: 'Manufacturing',
    subgroup: 'Master Data (duplicate namespace)',
    label: `${label} (manufacturing duplicate)`,
    description: `Duplicate ${label.toLowerCase()} permission under the manufacturing namespace.`,
    status: 'DUPLICATE_LEGACY',
    canonicalCode: `master_data.${key}`,
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
    backendRefs: ['server/routes/roles.js:93'],
    notes: [
      `Three namespaces exist for this capability: manufacturing.${key}, master_data.${key} and management.${key}.`,
      `The live sidebar row uses management.${key}; the seeded rows live under manufacturing.${key} and master_data.${key}.`,
      'Recommended canonical owner for a later brick: master_data. No rows are deleted or renamed in Brick 1.',
    ],
  })
);

module.exports = [
  /* ── Manufacturing module ──────────────────────────────────────────────── */
  defineEntry({
    module: 'manufacturing', submodule: '',
    group: 'Manufacturing',
    label: 'Manufacturing (module access)',
    description: 'Legacy module-wide manufacturing baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    backendRefs: ['server/migrations/phase35-rbac.sql:93'],
    notes: [
      'Read only as the AuthContext fallback when a manufacturing submodule row is absent.',
    ],
  }),

  defineEntry({
    module: 'manufacturing', submodule: 'control_tower',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Control Tower',
    description: 'Live manufacturing floor view: KPIs, machines, alerts and running processes.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar'],
    enforcement: {
      navigation: 'ENFORCED',
      // manufacturing/routes.js carries no requirePermission.
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:59',
      'client/src/modules/manufacturing/routes.js',
    ],
    backendRefs: ['server/routes/manufacturingProcesses.js:62'],
    notes: ['Every /api/manufacturing endpoint is authenticate-only.'],
  }),

  defineEntry({
    module: 'manufacturing', submodule: 'process_master',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Process Master (manufacturing duplicate)',
    description: 'Duplicate process-master permission. The live sidebar row uses management.process_master.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'management.process_master',
    risk: 'HIGH',
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
    backendRefs: ['server/routes/roles.js:96'],
    notes: [
      'Only two namespaces exist for this capability (manufacturing + management); master_data has no process_master key.',
      'The /api/process-master write endpoints are guarded by authorize(\'admin\'), not by any bitmask.',
    ],
  }),

  ...manufacturingDuplicates,

  /* ── Legacy `process` module — seeded, no live caller ───────────────────── */
  defineEntry({
    module: 'process', submodule: '',
    group: 'Manufacturing',
    label: 'Process (module access, legacy)',
    description: 'Module-wide baseline for the retired `process` module.',
    status: 'LEGACY_ORPHAN',
    risk: 'MEDIUM',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit'],
    emptySubmoduleMeaning: 'LEGACY_MODULE_BASELINE',
    enforcement: {
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/migrations/phase35-rbac.sql:87'],
    notes: [
      'The process workflow now lives under inventory.process_issues; nothing reads the `process` module.',
      'ROLE_DEFAULTS in server/middleware/permissions.js still lists `process`, but that map is only a last-resort fallback.',
    ],
  }),

  defineEntry({
    module: 'process', submodule: 'process_log',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Process Log (legacy)',
    description: 'Seeded key for the retired process log page.',
    status: 'LEGACY_ORPHAN',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:49'],
    notes: ['No sidebar row, route or API reads this key.'],
  }),

  defineEntry({
    module: 'process', submodule: 'send_to_process',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Send to Process (legacy)',
    description: 'Superseded by inventory.process_issues.',
    status: 'LEGACY_ORPHAN',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:50'],
    notes: ['No live caller. Superseded by inventory.process_issues.'],
  }),

  defineEntry({
    module: 'process', submodule: 'return_from_process',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Return from Process (legacy)',
    description: 'Superseded by inventory.process_issues.',
    status: 'LEGACY_ORPHAN',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:51'],
    notes: ['No live caller. Superseded by inventory.process_issues.'],
  }),

  /* ── `process_return` — a runtime-only module with no seeded rows ───────── */
  defineEntry({
    module: 'process_return', submodule: '',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Process Return Overrides',
    description:
      'Module-level capability consulted when a process return breaches the weight-variance tolerance.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'CAPABILITY_FLAG',
    actions: ['override_weight_variance', 'override_seed_resolution'],
    hasBaselineRows: false,
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NOT_ENFORCED',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'ENFORCED',
      api_edit: 'ENFORCED',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: [
      'server/routes/lotProcessIssues.js:1394',
      'server/routes/lotProcessIssues.js:1650',
      'server/routes/lotProcessIssues.js:1762',
    ],
    notes: [
      'MISSING BASELINE: `process_return` is in neither MODULE_TREE, so no role_permissions row is ever seeded and no admin UI can grant it.',
      'lotProcessIssues.js:1650 checks the action "seed_remove_override", which is NOT in PERM_BITS — hasPermission returns false for every non-super-admin, making that guard an unconditional deny.',
      'AuthContext keeps its own _PERM_BITS map without override_weight_variance (bit 2048), so the frontend can never report this capability as granted.',
    ],
  }),

  /* ── Rough Diamonds ────────────────────────────────────────────────────── */
  defineEntry({
    module: 'rough', submodule: '',
    group: 'Rough Diamonds',
    label: 'Rough Diamonds (module access)',
    description: 'Legacy module-wide rough baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    backendRefs: ['server/migrations/phase35-rbac.sql:88'],
    notes: ['Read only as the AuthContext fallback when rough.rough_growth is absent.'],
  }),

  defineEntry({
    module: 'rough', submodule: 'rough_growth',
    group: 'Rough Diamonds',
    subgroup: 'Growth',
    label: 'Rough Growth',
    description: 'Rough stock, growth runs and the legacy rough-growth workspace.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit'],
    enforcement: {
      navigation: 'ENFORCED',
      // rough-diamonds/routes.js carries no requirePermission.
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:70',
      'client/src/core/navigation/registry.js:71',
      'client/src/core/navigation/registry.js:72',
    ],
    backendRefs: ['server/routes/roughGrowth.js', 'server/routes/growthRuns.js'],
    notes: [
      'One key serves all three Rough Diamonds sidebar rows (Rough Stock, Growth Runs, Rough Growth Legacy).',
      'None of the four rough-diamonds routes has a <PermissionGuard>.',
    ],
  }),

  defineEntry({
    module: 'rough', submodule: 'new_growth_entry',
    group: 'Rough Diamonds',
    subgroup: 'Growth',
    label: 'New Growth Entry (legacy key)',
    description: 'Seeded key with no sidebar row, route guard or API caller.',
    status: 'LEGACY_ORPHAN',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:56'],
    notes: ['Growth creation happens under the rough_growth key; this row is never read.'],
  }),
];

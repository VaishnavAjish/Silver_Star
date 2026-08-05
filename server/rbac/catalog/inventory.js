/**
 * Catalog data — INVENTORY and INVENTORY MANAGEMENT.
 *
 * Verified against:
 *   server/routes/roles.js:28              seeded inventory submodules
 *   client/src/core/navigation/registry.js sidebar rows 34-55, 60-62
 *   client/src/modules/inventory/routes.js requirePermission guards 22-40
 *   server/routes/inventory.js             gas/seed/reversal guards
 *   server/routes/stockTransfer.js         transfer guards
 *   server/services/inventoryAuth.js       dept scope + financial stripping
 *   server/services/inventoryCorrectionService.js correction capability
 *
 * NOTE: `inventory.items_master` is seeded but the live Items Master page is
 * keyed `management.items_master` — see catalog/administration.js.
 */

'use strict';

const { defineEntry } = require('../catalogShared');

module.exports = [
  /* ── Module-level baseline ─────────────────────────────────────────────── */
  defineEntry({
    module: 'inventory', submodule: '',
    group: 'Inventory',
    label: 'Inventory (module access)',
    description: 'Legacy module-wide inventory baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit', 'export', 'print'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Sidebar "Start Process" resolves against inventory:'' (editorOnly, no submodule).
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      // canExport is computed from this row but only surfaced to the client.
      export: 'FRONTEND_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:60'],
    backendRefs: [
      'server/migrations/phase35-rbac.sql:84',
      'server/services/inventoryAuth.js:72',
      'server/services/inventoryAuth.js:75',
    ],
    notes: [
      'inventoryAuth.loadInventoryAuthContext hard-codes canViewInventory = true; the module VIEW bit is not a gate.',
      'canExport is derived from this row and returned by /api/me and the admin user detail, but no export endpoint consults it.',
    ],
  }),

  /* ── Inventory / Stock ─────────────────────────────────────────────────── */
  defineEntry({
    module: 'inventory', submodule: 'all_inventory',
    group: 'Inventory',
    subgroup: 'Stock',
    label: 'All Inventory',
    description: 'The operational lot workspace: list, lot detail, lineage and split.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      frontend_action: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      export: 'FRONTEND_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:35',
      'client/src/modules/inventory/routes.js:22',
      'client/src/modules/inventory/routes.js:32',
    ],
    backendRefs: ['server/routes/inventory.js', 'server/services/inventoryAuth.js:120'],
    notes: [
      'Inventory list/detail APIs are department-scoped by requireInventoryView, but the submodule bitmask is not consulted.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'items_master',
    group: 'Inventory',
    subgroup: 'Stock',
    label: 'Items Master (legacy key)',
    description: 'Seeded items-master key. The live page resolves management.items_master.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'management.items_master',
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
    backendRefs: ['server/routes/roles.js:32'],
    notes: [
      'No live caller reads inventory:items_master. The sidebar entry `items-master` uses module `management`.',
      'Brick 2 candidate: keep management.items_master, retire this key without deleting rows.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'mix_lots',
    group: 'Inventory',
    subgroup: 'Stock Movement',
    label: 'Mix Lots',
    description: 'Merge multiple lots into a single mixed lot.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:36',
      'client/src/modules/inventory/routes.js:30',
    ],
    notes: ['Sidebar entry is editorOnly: create OR edit OR view OR sidebar all reveal it.'],
  }),

  defineEntry({
    module: 'inventory', submodule: 'lot_movements',
    group: 'Inventory',
    subgroup: 'Stock Movement',
    label: 'Lot Movements',
    description: 'Read-only ledger of every parent/child lot movement.',
    status: 'ACTIVE',
    risk: 'MEDIUM',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:38',
      'client/src/modules/inventory/routes.js:34',
    ],
    backendRefs: ['server/services/inventoryAuth.js:281'],
    notes: [
      'Rows are department-scoped by buildMovementScopeClause; the submodule bitmask is not consulted by the API.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'stock_transfer',
    group: 'Inventory',
    subgroup: 'Stock Movement',
    label: 'Stock Transfer',
    description: 'Create, review, approve, reject and export internal inventory transfers.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'delete', 'approve', 'reject', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      // POST /preview consults view+create bits; other handlers do not.
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'PARTIALLY_ENFORCED',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'AUTHENTICATE_ONLY',
      api_approve: 'AUTHENTICATE_ONLY',
      export: 'ENFORCED',
      print: 'ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:37',
      'client/src/modules/inventory/routes.js:39',
      'client/src/modules/inventory/routes.js:40',
    ],
    backendRefs: [
      'server/routes/stockTransfer.js:109',
      'server/routes/stockTransfer.js:396',
      'server/routes/stockTransfer.js:733',
      'server/routes/stockTransfer.js:1117',
    ],
    notes: [
      'POST /pending/:id/approve and /reject are authenticate-only — approve/reject bits are stored but not enforced.',
      'POST / (direct transfer) is guarded by authorize(\'admin\',\'operator\'), a role string, not a bitmask.',
      'Known baseline anomaly: operator mask exceeds admin mask on this key in the live database.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'history_reversal',
    group: 'Inventory',
    subgroup: 'Stock Movement',
    label: 'Lot History Reversal',
    description: 'Dedicated capability to reverse a posted inventory/manufacturing transaction.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'CAPABILITY_FLAG',
    actions: ['edit'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'UNKNOWN',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'ENFORCED',
    },
    backendRefs: ['server/routes/inventory.js:976'],
    notes: [
      'No seeded role_permissions row exists for this key — only Super Admin passes today.',
      'Deliberately separate from inventory edit so ordinary edit never confers reversal authority.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'inventory_correction',
    group: 'Inventory',
    subgroup: 'Stock Movement',
    label: 'Lot Weight Correction',
    description: 'Dedicated capability to correct a grown lot weight in place.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'CAPABILITY_FLAG',
    actions: ['view', 'edit'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'UNKNOWN',
      api_list: 'ENFORCED',
      api_detail: 'ENFORCED',
      api_create: 'ENFORCED',
      api_edit: 'ENFORCED',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: [
      'server/services/inventoryCorrectionService.js:111',
      'server/services/inventoryCorrectionService.js:257',
    ],
    notes: [
      'No seeded role_permissions row exists for this key — only Super Admin passes today.',
      'view gates the correction history read; edit gates the correction itself.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'inventory_financial',
    group: 'View Restrictions',
    subgroup: 'Field Visibility',
    label: 'Inventory Financial Fields',
    description:
      'Grants visibility of rate/cost/value/margin fields on inventory responses. '
      + 'Without it the server deletes those keys from the payload.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'CAPABILITY_FLAG',
    actions: ['view'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'ENFORCED',
      api_detail: 'ENFORCED',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: [
      'server/services/inventoryAuth.js:57',
      'server/services/inventoryAuth.js:42',
    ],
    notes: [
      'This — not any vis.* preference — is the enforced financial-field control.',
      'FINANCIAL_BYPASS_ROLES (super_admin, admin, administrator, management, manager, owner, developer) bypass it by role string.',
      'No seeded role_permissions row exists for this key.',
    ],
  }),

  /* ── Inventory Management ──────────────────────────────────────────────── */
  defineEntry({
    module: 'inventory', submodule: 'opening_entry',
    group: 'Inventory Management',
    subgroup: 'Period Control',
    label: 'Opening Entry',
    description: 'Record period opening stock positions.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'ROLE_STRING_ONLY',
      api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:52',
      'client/src/modules/inventory/routes.js:27',
    ],
    backendRefs: ['server/routes/inventory.js:338', 'server/routes/inventory.js:360'],
    notes: [
      'POST /api/inventory/opening is guarded by authorize(\'admin\',\'operator\') — a role string, not the create bit.',
      'No delete or approve endpoint exists, so neither action is catalogued.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'closing_entry',
    group: 'Inventory Management',
    subgroup: 'Period Control',
    label: 'Closing Entry',
    description: 'Record period closing stock positions.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'ROLE_STRING_ONLY',
      api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:53',
      'client/src/modules/inventory/routes.js:28',
    ],
    backendRefs: ['server/routes/inventory.js:449', 'server/routes/inventory.js:469'],
    notes: ['POST /api/inventory/closing is guarded by authorize(\'admin\') only.'],
  }),

  defineEntry({
    module: 'inventory', submodule: 'seed_stock',
    group: 'Inventory Management',
    subgroup: 'Consumables',
    label: 'Seed Stock',
    description: 'Seed inventory positions, lots and export.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'export', 'print'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'ENFORCED',
      print: 'ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:50',
      'client/src/modules/inventory/routes.js:25',
    ],
    backendRefs: ['server/routes/inventory.js:1050'],
    notes: [
      'MISSING BASELINE: server/routes/roles.js MODULE_TREE has no seed_stock entry, so no role_permissions row is seeded.',
      'The sidebar row and route guard both require inventory:seed_stock view — non-super-admins are hidden unless a row is added manually.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'gas_stock',
    group: 'Inventory Management',
    subgroup: 'Consumables',
    label: 'Gas Stock',
    description: 'Gas cylinder positions and lots; MANAGE additionally reveals central (unassigned) gas.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'manage', 'export', 'print'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'ENFORCED',
      api_detail: 'ENFORCED',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'ENFORCED',
      print: 'ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:51',
      'client/src/modules/inventory/routes.js:26',
    ],
    backendRefs: ['server/routes/inventory.js:37', 'server/routes/inventory.js:1082'],
    notes: [
      'MISSING BASELINE: no seeded role_permissions row (same gap as seed_stock).',
      'MANAGE is used here as "see central/unassigned gas", not as a generic administration bit.',
    ],
  }),

  /* ── Manufacturing-facing inventory keys ───────────────────────────────── */
  defineEntry({
    module: 'inventory', submodule: 'process_issues',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Process Issues & Returns',
    description: 'Issue lots to a manufacturing process and record the return.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:61',
      'client/src/core/navigation/registry.js:62',
      'client/src/modules/inventory/routes.js:35',
      'client/src/modules/inventory/routes.js:36',
      'client/src/modules/inventory/routes.js:38',
    ],
    backendRefs: ['server/routes/lotProcessIssues.js'],
    notes: [
      'One permission key serves both the Process Issues and Process Return sidebar rows and four routes.',
      'The lot-process-issues API is authenticate-only; only the weight-variance override consults a bitmask.',
    ],
  }),

  defineEntry({
    module: 'inventory', submodule: 'start_process',
    group: 'Manufacturing',
    subgroup: 'Process Flow',
    label: 'Start Process (legacy key)',
    description: 'Seeded key for starting a process. The live sidebar row resolves inventory:\'\' instead.',
    status: 'LEGACY_ORPHAN',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE',
      frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:38'],
    notes: [
      'Sidebar id `start-process` carries module `inventory` with NO submodule, so this row is never read.',
      'Brick 2 candidate: either point the sidebar row at this key or retire the key.',
    ],
  }),
];

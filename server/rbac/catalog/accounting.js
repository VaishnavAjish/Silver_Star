/**
 * Catalog data — ACCOUNTING, FIXED ASSETS and REPORTS.
 *
 * Verified against:
 *   server/routes/roles.js:64/74/79        seeded accounting / assets / reports keys
 *   client/src/shared/constants/permissions.js:97  client-only `accounting.transfers`
 *   client/src/core/navigation/registry.js:94-130  sidebar rows
 *   client/src/modules/{accounting,fixed-assets,reports}/routes.js  — no route guards
 *   server/routes/reports.js:33            isAuthorizedForReport (VIEW bit)
 *   server/services/accountingExportRegistry.js:25,75,117,176
 *
 * Two sidebar rows resolve keys that exist in NEITHER MODULE_TREE
 * (`accounting.bank_reconciliation`) or only in the client tree
 * (`accounting.transfers`); both are catalogued with has_baseline_rows = false.
 */

'use strict';

const { defineEntry } = require('../catalogShared');

/** Report keys that only ever expose view / export / print. */
const REPORT_KEYS = [
  { key: 'ledger',              label: 'Ledger',              exported: true },
  { key: 'trial_balance',       label: 'Trial Balance',       exported: true },
  { key: 'profit_loss',         label: 'Profit & Loss',       exported: true },
  { key: 'balance_sheet',       label: 'Balance Sheet',       exported: true },
  { key: 'costing_report',      label: 'Costing Report',      exported: false },
  { key: 'accounts_receivable', label: 'Accounts Receivable', exported: false },
  { key: 'accounts_payable',    label: 'Accounts Payable',    exported: false },
  { key: 'cost_center_pl',      label: 'Cost Center P&L',     exported: false },
];

const reportEntries = REPORT_KEYS.map(({ key, label, exported }) =>
  defineEntry({
    module: 'reports', submodule: key,
    group: 'Reports',
    subgroup: 'Financial Reports',
    label,
    description: `${label} report — read, export and print.`,
    status: 'ACTIVE',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'sidebar', 'export', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      // reports/routes.js declares no requirePermission for any report page.
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: exported ? 'PARTIALLY_ENFORCED' : 'NOT_ENFORCED',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:118'],
    backendRefs: exported
      ? ['server/routes/reports.js:33', 'server/services/accountingExportRegistry.js']
      : ['server/routes/reports.js'],
    notes: exported
      ? [
        'POST /api/reports/export gates on the VIEW bit of this key, not on the EXPORT bit — granting export alone does nothing.',
        'isAuthorizedForReport also accepts the module-level reports:\'\' row and two legacy fallbacks.',
      ]
      : ['No server-authoritative export definition exists for this report; export/print are client-side only.'],
  })
);

module.exports = [
  /* ── Accounting ────────────────────────────────────────────────────────── */
  defineEntry({
    module: 'accounting', submodule: '',
    group: 'Accounting',
    label: 'Accounting (module access)',
    description: 'Legacy module-wide accounting baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Receipt / Payment / Journal Entry / Bank Deposit CREATE_ACTIONS.
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:152',
      'client/src/core/navigation/registry.js:157',
      'client/src/core/navigation/registry.js:159',
      'client/src/core/navigation/registry.js:160',
    ],
    backendRefs: ['server/migrations/phase35-rbac.sql:90'],
    notes: ['Financial posting is reachable through the module-level CREATE bit alone.'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'chart_of_accounts',
    group: 'Accounting',
    subgroup: 'Ledger Setup',
    label: 'Chart of Accounts',
    description: 'General-ledger account tree.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'ROLE_STRING_ONLY', api_edit: 'ROLE_STRING_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:96'],
    backendRefs: ['server/routes/accounts.js'],
    notes: ['accounts.js uses two authorize(\'admin\') guards; no handler consults a bitmask.'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'journal_entries',
    group: 'Accounting',
    subgroup: 'Postings',
    label: 'Journal Entries',
    description: 'Manual journal entry list, detail and posting.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete', 'print'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:97'],
    backendRefs: ['server/routes/journalEntries.js'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'payments',
    group: 'Accounting',
    subgroup: 'Postings',
    label: 'Payments',
    description: 'Outgoing payment vouchers.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:98'],
    backendRefs: ['server/routes/payments.js'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'receipts',
    group: 'Accounting',
    subgroup: 'Postings',
    label: 'Receipts',
    description: 'Incoming receipt vouchers.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:99'],
    backendRefs: ['server/routes/receipts.js'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'bank_deposits',
    group: 'Accounting',
    subgroup: 'Banking',
    label: 'Bank Deposits',
    description: 'Bank deposit slips and their allocation.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'ROLE_STRING_ONLY', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:100'],
    backendRefs: ['server/routes/bankDeposits.js'],
  }),

  defineEntry({
    module: 'accounting', submodule: 'transfers',
    group: 'Accounting',
    subgroup: 'Banking',
    label: 'Bank/Cash Transfers',
    description: 'Internal bank and cash transfers.',
    status: 'ACTIVE',
    risk: 'CRITICAL',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:101',
      'client/src/shared/constants/permissions.js:97',
    ],
    backendRefs: ['server/routes/transfers.js'],
    notes: [
      'TREE DRIFT: this key exists in the CLIENT MODULE_TREE but not in server/routes/roles.js, so the startup seeder never creates a baseline row.',
      'PUT /api/roles/:id/permissions replaces every row with whatever the client grid submits, so this key appears only for roles edited through the UI.',
    ],
  }),

  defineEntry({
    module: 'accounting', submodule: 'bank_reconciliation',
    group: 'Accounting',
    subgroup: 'Banking',
    label: 'Bank Reconciliation',
    description: 'Bank statement reconciliation workspace.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'edit'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:102'],
    backendRefs: ['server/routes/bankRecon.js'],
    notes: [
      'UNMAPPED SIDEBAR CODE: this key is in NEITHER MODULE_TREE, so no baseline row can be seeded and the admin grid cannot grant it.',
      'A seeded reports.bank_reconciliation row exists but nothing reads it.',
    ],
  }),

  defineEntry({
    module: 'accounting', submodule: 'depreciation_runs',
    group: 'Accounting',
    subgroup: 'Postings',
    label: 'Depreciation Runs (accounting duplicate)',
    description: 'Seeded depreciation-run key. The live sidebar row resolves assets.depreciation_runs.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'assets.depreciation_runs',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create', 'edit'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:71'],
    notes: [
      'This key holds the seeded rows; the live sidebar reads the assets namespace, which has none.',
      'Brick 2 decision required: either re-point the sidebar at accounting.depreciation_runs or seed assets.depreciation_runs.',
    ],
  }),

  defineEntry({
    module: 'accounting', submodule: 'new_depreciation_run',
    group: 'Accounting',
    subgroup: 'Postings',
    label: 'New Depreciation Run (legacy key)',
    description: 'Seeded key. The live sidebar row resolves assets:\'\' instead.',
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
    backendRefs: ['server/routes/roles.js:72'],
  }),

  /* ── Fixed Assets ──────────────────────────────────────────────────────── */
  defineEntry({
    module: 'assets', submodule: '',
    group: 'Fixed Assets',
    label: 'Fixed Assets (module access)',
    description: 'Legacy module-wide assets baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'print'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Sidebar "Manual Entry" and "New Depreciation Run" are editorOnly with no submodule.
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:109',
      'client/src/core/navigation/registry.js:111',
    ],
    backendRefs: ['server/migrations/phase35-rbac.sql:89'],
  }),

  defineEntry({
    module: 'assets', submodule: 'asset_list',
    group: 'Fixed Assets',
    subgroup: 'Register',
    label: 'Asset List',
    description: 'Fixed asset register list and detail.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete', 'print'],
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'ROLE_STRING_ONLY', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:108'],
    backendRefs: ['server/routes/fixedAssets.js'],
  }),

  defineEntry({
    module: 'assets', submodule: 'manual_entry',
    group: 'Fixed Assets',
    subgroup: 'Register',
    label: 'Manual Asset Entry (legacy key)',
    description: 'Seeded key. The live sidebar row resolves assets:\'\' instead.',
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
    backendRefs: ['server/routes/roles.js:77'],
  }),

  defineEntry({
    module: 'assets', submodule: 'depreciation_runs',
    group: 'Fixed Assets',
    subgroup: 'Depreciation',
    label: 'Depreciation Runs',
    description: 'Periodic depreciation run list and posting.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'ROLE_STRING_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:110'],
    backendRefs: ['server/routes/depreciationRuns.js'],
    notes: [
      'UNMAPPED SIDEBAR CODE: no seeded row. The seeded rows live under accounting.depreciation_runs.',
    ],
  }),

  defineEntry({
    module: 'assets', submodule: 'fixed_asset_register',
    group: 'Fixed Assets',
    subgroup: 'Depreciation',
    label: 'Fixed Asset Register',
    description: 'Fixed asset register report.',
    status: 'ACTIVE',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'sidebar', 'export', 'print'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:112'],
    notes: ['UNMAPPED SIDEBAR CODE: the seeded row is reports.fixed_asset_register.'],
  }),

  defineEntry({
    module: 'assets', submodule: 'depreciation_schedule',
    group: 'Fixed Assets',
    subgroup: 'Depreciation',
    label: 'Depreciation Schedule',
    description: 'Depreciation schedule report.',
    status: 'ACTIVE',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'sidebar', 'export', 'print'],
    hasBaselineRows: false,
    enforcement: {
      navigation: 'ENFORCED', frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'NOT_ENFORCED', print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:113'],
    notes: ['UNMAPPED SIDEBAR CODE: the seeded row is reports.depreciation_schedule.'],
  }),

  /* ── Reports ───────────────────────────────────────────────────────────── */
  defineEntry({
    module: 'reports', submodule: '',
    group: 'Reports',
    label: 'Reports (module access)',
    description: 'Legacy module-wide reports baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'MEDIUM',
    control: 'MODULE_ACCESS',
    actions: ['view', 'export', 'print'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Fund Utilization and Cost Centre Reports carry module `reports` with no submodule.
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
      export: 'PARTIALLY_ENFORCED', print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:119',
      'client/src/core/navigation/registry.js:128',
    ],
    backendRefs: ['server/routes/reports.js:38', 'server/migrations/phase35-rbac.sql:91'],
    notes: [
      'isAuthorizedForReport falls back to this module-level row, so it can widen access to every server-defined report export.',
    ],
  }),

  ...reportEntries,

  defineEntry({
    module: 'reports', submodule: 'fixed_asset_register',
    group: 'Reports',
    subgroup: 'Asset Reports',
    label: 'Fixed Asset Register (reports duplicate)',
    description: 'Seeded key. The live sidebar row resolves assets.fixed_asset_register.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'assets.fixed_asset_register',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'export', 'print'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:86'],
    notes: ['Holds the seeded rows; the live key does not. Resolve the namespace in a later brick.'],
  }),

  defineEntry({
    module: 'reports', submodule: 'depreciation_schedule',
    group: 'Reports',
    subgroup: 'Asset Reports',
    label: 'Depreciation Schedule (reports duplicate)',
    description: 'Seeded key. The live sidebar row resolves assets.depreciation_schedule.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'assets.depreciation_schedule',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'export', 'print'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:87'],
    notes: ['Holds the seeded rows; the live key does not.'],
  }),

  defineEntry({
    module: 'reports', submodule: 'bank_reconciliation',
    group: 'Reports',
    subgroup: 'Banking Reports',
    label: 'Bank Reconciliation (reports duplicate)',
    description: 'Seeded key. The live sidebar row resolves accounting.bank_reconciliation.',
    status: 'DUPLICATE_LEGACY',
    canonicalCode: 'accounting.bank_reconciliation',
    risk: 'MEDIUM',
    control: 'REPORT_ACCESS',
    actions: ['view', 'export', 'print'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:90'],
    notes: ['Holds the seeded rows; the live key does not.'],
  }),
];

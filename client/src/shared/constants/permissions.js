/* ── Permission Bit Values ────────────────────────────────── */
export const PERM_BITS = {
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

export const ALL_PERMISSION_BITS = 8191;
export const FULL_ACCESS = 8191;

export const ACTIONS = [
  { id: 'view',    label: 'VIEW' },
  { id: 'create',  label: 'CREATE' },
  { id: 'edit',    label: 'EDIT' },
  { id: 'delete',  label: 'DELETE' },
  { id: 'approve', label: 'APPROVE' },
  { id: 'reject',  label: 'REJECT' },
  { id: 'export',  label: 'EXPORT' },
  { id: 'import',  label: 'IMPORT' },
  { id: 'print',   label: 'PRINT' },
  { id: 'manage',  label: 'MANAGE' },
  { id: 'sidebar', label: 'SIDEBAR' },
  { id: 'override_weight_variance', label: 'OVERRIDE WEIGHT VARIANCE' },
  { id: 'override_seed_resolution', label: 'OVERRIDE SEED RESOLUTION' },
];

/* ── Module / Submodule Tree ─────────────────────────────── */
export const MODULE_TREE = [
  {
    module: 'dashboard', label: 'Dashboard',
    submodules: [
      { key: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    module: 'clipboard', label: 'Clipboard',
    submodules: [
      { key: 'clipboard', label: 'Clipboard' },
    ],
  },
  {
    module: 'inventory', label: 'Inventory',
    submodules: [
      { key: 'all_inventory',    label: 'All Inventory' },
      { key: 'mix_lots',         label: 'Mix Lots' },
      { key: 'stock_transfer',   label: 'Stock Transfer' },
      { key: 'lot_movements',    label: 'Lot Movements' },
      { key: 'seed_stock',       label: 'Seed Stock' },
      { key: 'gas_stock',        label: 'Gas Stock' },
      { key: 'opening_entry',    label: 'Opening Entry' },
      { key: 'closing_entry',    label: 'Closing Entry' },
    ],
  },
  {
    module: 'manufacturing', label: 'Manufacturing',
    submodules: [
      { key: 'control_tower',     label: 'Control Tower' },
      { key: 'start_process',     label: 'Start Process' },
      { key: 'process_issues',    label: 'Process Issues' },
      { key: 'process_return',    label: 'Process Return' },
      { key: 'machines',          label: 'Machines' },
      { key: 'process_master',    label: 'Process Master' },
    ],
  },
  {
    module: 'rough', label: 'Rough Diamonds',
    submodules: [
      { key: 'rough_growth',      label: 'Rough Stock' },
      { key: 'growth_runs',       label: 'Growth Runs' },
      { key: 'rough_growth_legacy', label: 'Rough Growth (Legacy)' },
    ],
  },
  {
    module: 'purchase', label: 'Purchase',
    submodules: [
      { key: 'vendors',             label: 'Vendors' },
      { key: 'vendor_bills',        label: 'Vendor Bills' },
      { key: 'purchase_notes',      label: 'Purchase Notes' },
      { key: 'new_purchase_note',   label: 'New Purchase Note' },
      { key: 'expenses',            label: 'Expenses' },
    ],
  },
  {
    module: 'sales', label: 'Sales',
    submodules: [
      { key: 'invoice',     label: 'Invoices' },
      { key: 'new_invoice',  label: 'New Invoice' },
      { key: 'customers',    label: 'Customers' },
    ],
  },
  {
    module: 'accounting', label: 'Accounting',
    submodules: [
      { key: 'chart_of_accounts',    label: 'Chart of Accounts' },
      { key: 'journal_entries',      label: 'Journal Entries' },
      { key: 'payments',             label: 'Payments' },
      { key: 'receipts',             label: 'Receipts' },
      { key: 'bank_deposits',        label: 'Bank Deposits' },
      { key: 'transfers',            label: 'Transfers' },
      { key: 'bank_reconciliation',  label: 'Bank Reconciliation' },
    ],
  },
  {
    module: 'assets', label: 'Fixed Assets',
    submodules: [
      { key: 'asset_list',            label: 'Asset List' },
      { key: 'manual_entry',          label: 'Manual Entry' },
      { key: 'depreciation_runs',     label: 'Depreciation Runs' },
      { key: 'new_depreciation_run',  label: 'New Depreciation Run' },
      { key: 'fixed_asset_register',  label: 'Fixed Asset Register' },
      { key: 'depreciation_schedule', label: 'Depreciation Schedule' },
    ],
  },
  {
    module: 'reports', label: 'Reports',
    submodules: [
      { key: 'fund_utilization',     label: 'Fund Utilization' },
      { key: 'ledger',               label: 'Ledger' },
      { key: 'trial_balance',        label: 'Trial Balance' },
      { key: 'profit_loss',          label: 'Profit & Loss' },
      { key: 'balance_sheet',        label: 'Balance Sheet' },
      { key: 'costing_report',       label: 'Costing Report' },
      { key: 'accounts_receivable',  label: 'Accounts Receivable' },
      { key: 'accounts_payable',     label: 'Accounts Payable' },
      { key: 'cost_center_pl',       label: 'Cost Center P&L' },
      { key: 'cost_centre_reports',  label: 'Cost Centre Reports' },
    ],
  },
  {
    module: 'management', label: 'Management',
    submodules: [
      { key: 'items_master',             label: 'Items Master' },
      { key: 'departments',              label: 'Departments' },
      { key: 'locations',                label: 'Locations' },
      { key: 'uom',                      label: 'UOM' },
      { key: 'expense_categories',        label: 'Expense Categories' },
      { key: 'asset_categories',          label: 'Asset Categories' },
      { key: 'cost_centres',             label: 'Cost Centres' },
      { key: 'cost_centre_corrections',  label: 'Cost Centre Corrections' },
    ],
  },
  {
    module: 'admin', label: 'Admin Panel',
    submodules: [
      { key: 'users',      label: 'Users' },
      { key: 'roles',      label: 'Roles & Permissions' },
      { key: 'audit_logs', label: 'Audit Logs' },
      { key: 'settings',   label: 'Settings' },
    ],
  },
  {
    module: 'hr', label: 'HR',
    submodules: [
      { key: 'employees',  label: 'Employees' },
      { key: 'attendance', label: 'Attendance' },
    ],
  },
  {
    module: 'finance', label: 'Finance',
    submodules: [
      { key: 'budgets',  label: 'Budgets' },
      { key: 'cashflow', label: 'Cash Flow' },
    ],
  },
];

/* ── Helper: bitmask ↔ actions ───────────────────────────── */
export function maskToActions(mask) {
  if (!mask || mask === 0) return [];
  return ACTIONS.filter(a => (mask & PERM_BITS[a.id]) === PERM_BITS[a.id]).map(a => a.id);
}

export function actionsToMask(actions) {
  let mask = 0;
  if (!actions || !Array.isArray(actions)) return mask;
  for (const a of actions) {
    if (PERM_BITS[a] !== undefined) mask |= PERM_BITS[a];
  }
  return mask;
}

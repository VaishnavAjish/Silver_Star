// Registry of all dashboard elements and their required permissions

const DASHBOARD_SHORTCUTS = [
  // Dashboard & Clipboard are always visible if logged in
  { id: 'dashboard', module: 'dashboard', submodule: 'dashboard' },
  { id: 'clipboard', module: 'clipboard', submodule: 'clipboard' },

  // Inventory & Purchase
  { id: 'all-inventory', module: 'inventory', submodule: 'all_inventory', group: 'Inventory & Purchase' },
  { id: 'stock-transfer', module: 'inventory', submodule: 'all_inventory', group: 'Inventory & Purchase' }, // Usually requires inventory access
  { id: 'lot-movements', module: 'inventory', submodule: 'lot_movements', group: 'Inventory & Purchase' },
  { id: 'vendors', module: 'purchase', submodule: 'vendors', group: 'Inventory & Purchase' },
  { id: 'vendor-bills', module: 'purchase', submodule: 'purchase_notes', group: 'Inventory & Purchase' },
  { id: 'purchase-notes', module: 'purchase', submodule: 'purchase_notes', group: 'Inventory & Purchase' },

  // Manufacturing
  { id: 'control-tower', module: 'manufacturing', submodule: 'control_tower', group: 'Manufacturing' },
  { id: 'start-process', module: 'inventory', submodule: 'process_issues', group: 'Manufacturing' },
  { id: 'process-issues', module: 'inventory', submodule: 'process_issues', group: 'Manufacturing' },
  { id: 'process-return', module: 'inventory', submodule: 'process_issues', group: 'Manufacturing' },
  { id: 'rough-stock', module: 'rough', submodule: 'rough_growth', group: 'Manufacturing' },
  { id: 'growth-runs', module: 'rough', submodule: 'rough_growth', group: 'Manufacturing' },
  { id: 'rough-growth-legacy', module: 'rough', submodule: 'rough_growth', group: 'Manufacturing' },

  // Sales
  { id: 'invoices', module: 'sales', submodule: 'invoice', group: 'Sales' },
  { id: 'customers', module: 'sales', submodule: 'customers', group: 'Sales' },

  // Accounting
  { id: 'chart-of-accounts', module: 'accounting', submodule: 'chart_of_accounts', group: 'Accounting' },
  { id: 'journal-entries', module: 'accounting', submodule: 'journal_entries', group: 'Accounting' },
  { id: 'payments', module: 'accounting', submodule: 'payments', group: 'Accounting' },
  { id: 'receipts', module: 'accounting', submodule: 'receipts', group: 'Accounting' },
  { id: 'bank-deposits', module: 'accounting', submodule: 'bank_deposits', group: 'Accounting' },
  { id: 'transfers', module: 'accounting', submodule: 'transfers', group: 'Accounting' },
  { id: 'fund-utilization', module: 'reports', submodule: 'fund_utilization', group: 'Accounting' }, // Reports
  { id: 'ledger', module: 'reports', submodule: 'ledger', group: 'Accounting' },
  { id: 'pnl', module: 'reports', submodule: 'profit_loss', group: 'Accounting' },
];

const DASHBOARD_WIDGETS = [
  { id: 'profit_loss_summary', module: 'reports', submodule: 'profit_loss' },
  { id: 'bank_balance',        module: 'accounting', submodule: 'chart_of_accounts' },
  { id: 'sales_trend',         module: 'sales', submodule: 'invoice' },
  { id: 'expenses_chart',      module: 'purchase', submodule: 'purchase_notes' },
  { id: 'cash_flow_chart',     module: 'accounting', submodule: 'payments' },
  { id: 'accounts_receivable', module: 'reports', submodule: 'accounts_receivable' },
  { id: 'accounts_payable',    module: 'reports', submodule: 'accounts_payable' },
  { id: 'top_expenses',        module: 'purchase', submodule: 'purchase_notes' },
  { id: 'operator_operations', module: 'inventory', submodule: 'all_inventory' },
];

const PRESETS = [
  { id: 'Operator Operations', reqModule: 'inventory', reqSubmodule: 'all_inventory' },
  { id: 'Inventory', reqModule: 'inventory', reqSubmodule: 'all_inventory' },
  { id: 'Manufacturing', reqModule: 'inventory', reqSubmodule: 'process_issues' },
  { id: 'Accounts', reqModule: 'accounting', reqSubmodule: 'journal_entries' },
  { id: 'Management', reqModule: 'reports', reqSubmodule: 'profit_loss' }
];

const QUICK_CREATE = [
  { id: 'create-invoice', module: 'sales', requiredAction: 'create' },
  { id: 'create-receipt', module: 'accounting', requiredAction: 'create' },
  { id: 'create-customer', module: 'sales', requiredAction: 'create' },
  { id: 'create-expense', module: 'purchase', requiredAction: 'create' },
  { id: 'create-purchase-note', module: 'purchase', requiredAction: 'create' },
  { id: 'create-vendor-bill', module: 'purchase', requiredAction: 'create' },
  { id: 'create-payment', module: 'accounting', requiredAction: 'create' },
  { id: 'create-vendor', module: 'purchase', requiredAction: 'create' },
  { id: 'create-journal-entry', module: 'accounting', requiredAction: 'create' },
  { id: 'create-bank-deposit', module: 'accounting', requiredAction: 'create' }
];

module.exports = {
  DASHBOARD_SHORTCUTS,
  DASHBOARD_WIDGETS,
  PRESETS,
  QUICK_CREATE
};

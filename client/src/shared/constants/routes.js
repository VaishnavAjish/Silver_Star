// Central route path constants.
// Every module page path is defined ONCE here.
export const ROUTES = {
  // Dashboard
  DASHBOARD:            '/',

  // Auth
  LOGIN:                '/login',

  // Inventory
  INVENTORY:            '/inventory',
  INVENTORY_LIST:       '/inventory',
  INVENTORY_OPENING:    '/inventory/opening',
  INVENTORY_CLOSING:    '/inventory/closing',
  INVENTORY_ADJUSTMENT: '/inventory/adjustment',
  INVENTORY_TRANSFER:   '/inventory/transfer',
  INVENTORY_REPORT:     '/inventory/report',

  // Purchase
  PURCHASE_NOTES:       '/purchase-notes',
  PURCHASE_NOTE_NEW:    '/purchase-notes/new',
  PURCHASE_NOTE_EDIT:   '/purchase-notes/:id/edit',

  // Sales
  INVOICES:             '/invoices',
  INVOICE_NEW:          '/invoices/new',
  INVOICE_EDIT:         '/invoices/:id/edit',
  RECEIPTS:             '/receipts',
  RECEIPT_NEW:          '/receipts/new',
  PAYMENTS:             '/payments',
  PAYMENT_NEW:          '/payments/new',
  CUSTOMERS:            '/customers',
  CUSTOMER_DETAILS:     '/customers/:id',

  // Process
  PROCESS_LOG:          '/process-log',
  PROCESS_SEND:         '/process-send',
  PROCESS_RETURN:       '/process-return',
  PROCESS_ISSUES:       '/process-issues',
  LOT_WORKSPACE:        '/lot-workspace',

  // Growth / Rough
  ROUGH_GROWTH:         '/rough-growth',
  ROUGH_GROWTH_NEW:     '/rough-growth/new',
  GROWTH_OUTPUT:        '/inventory/process-issues',
  LOT_ISSUE:            '/lot-issue',

  // Accounting
  ACCOUNTS:             '/accounts',
  ACCOUNT_NEW:          '/accounts/new',
  JOURNAL_ENTRIES:      '/journal-entries',
  JOURNAL_ENTRY_NEW:    '/journal-entries/new',
  JOURNAL_ENTRY_EDIT:   '/journal-entries/:id/edit',
  PNL:                  '/pnl',
  BALANCE_SHEET:        '/balance-sheet',
  TRIAL_BALANCE:        '/trial-balance',
  BANK_DEPOSIT:         '/bank-deposit',
  BANK_RECONCILIATION:  '/bank-reconciliation',
  EXPENSES:             '/expenses',
  EXPENSE_NEW:          '/expenses/new',
  COST_CENTERS:         '/cost-centers',

  // Fixed Assets
  FIXED_ASSETS:         '/fixed-assets',
  FIXED_ASSET_NEW:      '/fixed-assets/new',
  FIXED_ASSET_EDIT:     '/fixed-assets/:id/edit',
  DEPRECIATION_RUNS:    '/depreciation-runs',
  ASSET_TEMPLATES:      '/asset-templates',

  // Manufacturing
  MANUFACTURING:        '/manufacturing',

  // Reports
  REPORTS:              '/reports',
  REPORT_ACCOUNTING:    '/reports/accounting',
  REPORT_INVENTORY:     '/reports/inventory',
  REPORT_SALES:         '/reports/sales',

  // Management / Config
  MASTER_CONFIGS:       '/master-configs',
  MANAGEMENT:           '/management',
  VENDORS:              '/vendors',
  VENDOR_DETAILS:       '/vendors/:id',
  DEPARTMENTS:          '/departments',
  LOCATIONS:            '/locations',
  MACHINES:             '/machines',
  UOM:                  '/uom',
  EXPENSE_CATEGORIES:   '/expense-categories',
  ITEMS:                '/items',

  // Admin
  USERS:                '/admin/users',
  PERMISSIONS:          '/admin/permissions',
  AUDIT_LOG:            '/admin/audit',

  // Labels
  LABELS:               '/labels',

  // Clipboard
  CLIPBOARD:            '/clipboard',
};

/**
 * Central Navigation Registry — the SINGLE source of truth for every
 * navigation surface: sidebar, command palette, global + Create menu, and
 * user-pinned header shortcuts. No surface may keep its own hard-coded array.
 *
 * Permission is described per-entry by { module, submodule } (+ editorOnly /
 * adminOnly / requiredAction). The VISUAL section is independent of the
 * permission module — e.g. Process Issues lives under the Manufacturing section
 * but keeps its inventory/process_issues permission descriptor unchanged, so
 * moving it never alters access.
 *
 * Entry shape:
 *   { id, label, path, icon, module?, submodule?, actionType,
 *     editorOnly?, adminOnly?, requiredAction?, pinnable?, searchable?,
 *     sortOrder?, children? }
 *
 * actionType: 'route' | 'group' | 'create' | 'report'
 */
import {
  LayoutDashboard, ClipboardList, Warehouse, Cpu, Gem, ShoppingCart, FileText,
  Building2, Landmark, BarChart3, Database, ShieldCheck,
  Package, Send, RotateCcw, Clock, Layers, GitBranch, Boxes,
  Receipt, CreditCard, HandCoins, BookOpen, TrendingUp, TrendingDown, Users,
  Calculator, Settings as Cog, Wrench, ClipboardCheck,
} from 'lucide-react';

// ── Sidebar tree (visual sections → children). Section membership is display
//    only; module/submodule below carry the authoritative permission. ─────────
export const NAVIGATION = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard, actionType: 'route', module: 'dashboard', submodule: 'dashboard', pinnable: true, searchable: true },
  { id: 'clipboard', label: 'Clipboard', path: '/clipboard', icon: ClipboardList, actionType: 'route', module: 'clipboard', submodule: 'clipboard', pinnable: true, searchable: true },

  {
    id: 'sec-inventory', label: 'Inventory', icon: Warehouse, actionType: 'group', children: [
      { id: 'all-inventory', label: 'All Inventory', path: '/inventory', icon: Boxes, module: 'inventory', submodule: 'all_inventory', pinnable: true, searchable: true },
      { id: 'opening-entry', label: 'Opening Entry', path: '/inventory/opening', icon: Package, module: 'inventory', editorOnly: true, pinnable: true, searchable: true },
      { id: 'closing-entry', label: 'Closing Entry', path: '/inventory/closing', icon: Package, module: 'inventory', editorOnly: true, pinnable: true, searchable: true },
      { id: 'mix-lots', label: 'Mix Lots', path: '/inventory/mix', icon: Layers, module: 'inventory', editorOnly: true, searchable: true },
      { id: 'stock-transfer', label: 'Stock Transfer', path: '/inventory/stock-transfer', icon: Send, module: 'inventory', editorOnly: true, pinnable: true, searchable: true },
      { id: 'lot-movements', label: 'Lot Movements', path: '/lot-movements', icon: GitBranch, module: 'inventory', submodule: 'lot_movements', pinnable: true, searchable: true },
    ],
  },

  {
    id: 'sec-manufacturing', label: 'Manufacturing', icon: Cpu, actionType: 'group', children: [
      { id: 'control-tower', label: 'Control Tower', path: '/manufacturing/control-tower', icon: Cpu, module: 'manufacturing', submodule: 'control_tower', pinnable: true, searchable: true },
      { id: 'start-process', label: 'Start Process', path: '/inventory/process-issues/new', icon: Send, module: 'inventory', editorOnly: true, pinnable: true, searchable: true },
      { id: 'process-issues', label: 'Process Issues', path: '/inventory/process-issues', icon: ClipboardCheck, module: 'inventory', submodule: 'process_issues', pinnable: true, searchable: true },
      { id: 'process-return', label: 'Process Return', path: '/inventory/process-returns', icon: RotateCcw, module: 'inventory', submodule: 'process_issues', pinnable: true, searchable: true },
      { id: 'machines', label: 'Machines', path: '/machines', icon: Wrench, module: 'management', submodule: 'machines', pinnable: true, searchable: true },
      { id: 'process-master', label: 'Process Master', path: '/manufacturing/process-master', icon: Cog, module: 'management', submodule: 'process_master', pinnable: true, searchable: true },
    ],
  },

  {
    id: 'sec-rough', label: 'Rough Diamonds', icon: Gem, actionType: 'group', children: [
      { id: 'rough-stock', label: 'Rough Stock', path: '/rough-diamonds/inventory', icon: Gem, module: 'rough', submodule: 'rough_growth', pinnable: true, searchable: true },
      { id: 'growth-runs', label: 'Growth Runs', path: '/growth-runs', icon: Gem, module: 'rough', submodule: 'rough_growth', pinnable: true, searchable: true },
      { id: 'rough-growth-legacy', label: 'Rough Growth (Legacy)', path: '/rough-growth', icon: Clock, module: 'rough', submodule: 'rough_growth', searchable: true },
    ],
  },

  {
    id: 'sec-purchase', label: 'Purchase', icon: ShoppingCart, actionType: 'group', children: [
      { id: 'vendors', label: 'Vendors', path: '/vendors', icon: Building2, module: 'purchase', submodule: 'vendors', searchable: true },
      { id: 'vendor-bills', label: 'Vendor Bills', path: '/bills', icon: FileText, module: 'purchase', submodule: 'purchase_notes', searchable: true },
      { id: 'purchase-notes', label: 'Purchase Notes', path: '/purchase-notes', icon: ShoppingCart, module: 'purchase', submodule: 'purchase_notes', searchable: true },
      { id: 'new-purchase-note', label: 'New Purchase Note', path: '/purchase-notes/new', icon: ShoppingCart, module: 'purchase', editorOnly: true, searchable: true },
      { id: 'expenses', label: 'Expenses', path: '/expenses', icon: CreditCard, module: 'purchase', submodule: 'expenses', searchable: true },
    ],
  },

  {
    id: 'sec-sales', label: 'Sales', icon: FileText, actionType: 'group', children: [
      { id: 'invoices', label: 'Invoices', path: '/invoices', icon: FileText, module: 'sales', submodule: 'invoice', searchable: true },
      { id: 'new-invoice', label: 'New Invoice', path: '/invoices/new', icon: FileText, module: 'sales', editorOnly: true, searchable: true },
      { id: 'customers', label: 'Customers', path: '/customers', icon: Users, module: 'sales', submodule: 'customers', searchable: true },
    ],
  },

  {
    id: 'sec-accounting', label: 'Accounting', icon: Building2, actionType: 'group', children: [
      { id: 'chart-of-accounts', label: 'Chart of Accounts', path: '/accounts', icon: BarChart3, module: 'accounting', submodule: 'chart_of_accounts', searchable: true },
      { id: 'journal-entries', label: 'Journal Entries', path: '/journal-entries', icon: BookOpen, module: 'accounting', submodule: 'journal_entries', searchable: true },
      { id: 'payments', label: 'Payments', path: '/payments', icon: TrendingDown, module: 'accounting', submodule: 'payments', searchable: true },
      { id: 'receipts', label: 'Receipts', path: '/receipts', icon: Receipt, module: 'accounting', submodule: 'receipts', searchable: true },
      { id: 'bank-deposits', label: 'Bank Deposits', path: '/bank-deposits', icon: Landmark, module: 'accounting', submodule: 'bank_deposits', searchable: true },
      { id: 'transfers', label: 'Transfers', path: '/transfers', icon: HandCoins, module: 'accounting', submodule: 'transfers', searchable: true },
      { id: 'bank-reconciliation', label: 'Bank Reconciliation', path: '/reports/bank-reconciliation', icon: Calculator, module: 'accounting', submodule: 'bank_reconciliation', searchable: true },
    ],
  },

  {
    id: 'sec-assets', label: 'Fixed Assets', icon: Landmark, actionType: 'group', children: [
      { id: 'asset-list', label: 'Asset List', path: '/assets', icon: Landmark, module: 'assets', submodule: 'asset_list', searchable: true },
      { id: 'manual-asset-entry', label: 'Manual Entry', path: '/assets/new', icon: Landmark, module: 'assets', editorOnly: true, searchable: true },
      { id: 'depreciation-runs', label: 'Depreciation Runs', path: '/depreciation-runs', icon: TrendingDown, module: 'assets', submodule: 'depreciation_runs', searchable: true },
      { id: 'new-depreciation-run', label: 'New Depreciation Run', path: '/depreciation-runs/new', icon: TrendingDown, module: 'assets', editorOnly: true, searchable: true },
      { id: 'fixed-asset-register', label: 'Fixed Asset Register', path: '/reports/fixed-asset-register', icon: BarChart3, module: 'assets', submodule: 'fixed_asset_register', searchable: true },
      { id: 'depreciation-schedule', label: 'Depreciation Schedule', path: '/reports/depreciation-schedule', icon: BarChart3, module: 'assets', submodule: 'depreciation_schedule', searchable: true },
    ],
  },

  {
    id: 'sec-reports', label: 'Reports', icon: BarChart3, actionType: 'group', children: [
      { id: 'fund-utilization', label: 'Fund Utilization', path: '/reports/fund-utilization', icon: TrendingUp, module: 'reports', actionType: 'report', pinnable: true, searchable: true },
      { id: 'ledger', label: 'Ledger', path: '/ledger', icon: BookOpen, module: 'reports', submodule: 'ledger', actionType: 'report', pinnable: true, searchable: true },
      { id: 'trial-balance', label: 'Trial Balance', path: '/trial-balance', icon: BarChart3, module: 'reports', submodule: 'trial_balance', actionType: 'report', searchable: true },
      { id: 'pnl', label: 'Profit & Loss', path: '/pnl', icon: TrendingUp, module: 'reports', submodule: 'profit_loss', actionType: 'report', pinnable: true, searchable: true },
      { id: 'balance-sheet', label: 'Balance Sheet', path: '/balance-sheet', icon: BarChart3, module: 'reports', submodule: 'balance_sheet', actionType: 'report', searchable: true },
      { id: 'costing', label: 'Costing Report', path: '/costing', icon: Calculator, module: 'reports', submodule: 'costing_report', actionType: 'report', pinnable: true, searchable: true },
      { id: 'accounts-receivable', label: 'Accounts Receivable', path: '/reports/accounts-receivable', icon: TrendingUp, module: 'reports', submodule: 'accounts_receivable', actionType: 'report', searchable: true },
      { id: 'accounts-payable', label: 'Accounts Payable', path: '/reports/accounts-payable', icon: TrendingDown, module: 'reports', submodule: 'accounts_payable', actionType: 'report', searchable: true },
      { id: 'cost-center-pl', label: 'Cost Center P&L', path: '/reports/cost-center', icon: BarChart3, module: 'reports', submodule: 'cost_center_pl', actionType: 'report', searchable: true },
      { id: 'cost-centre-reports', label: 'Cost Centre Reports', path: '/cost-center-reports', icon: BarChart3, module: 'reports', actionType: 'report', searchable: true },
    ],
  },

  {
    id: 'sec-management', label: 'Management', icon: Database, actionType: 'group', children: [
      { id: 'items-master', label: 'Items Master', path: '/items', icon: Boxes, module: 'management', submodule: 'items_master', searchable: true },
      { id: 'departments', label: 'Departments', path: '/departments', icon: Building2, module: 'management', submodule: 'departments', searchable: true },
      { id: 'locations', label: 'Locations', path: '/locations', icon: Building2, module: 'management', submodule: 'locations', searchable: true },
      { id: 'uom', label: 'UOM', path: '/uom', icon: Calculator, module: 'management', submodule: 'uom', searchable: true },
      { id: 'expense-categories', label: 'Expense Categories', path: '/expense-categories', icon: CreditCard, module: 'management', submodule: 'expense_categories', searchable: true },
      { id: 'asset-categories', label: 'Asset Categories', path: '/fixed-asset-categories', icon: Landmark, module: 'management', submodule: 'asset_categories', searchable: true },
      { id: 'cost-centres', label: 'Cost Centres', path: '/cost-centers', icon: Database, module: 'management', submodule: 'cost_centres', searchable: true },
      { id: 'cost-centre-corrections', label: 'Cost Centre Corrections', path: '/cost-center-corrections', icon: Database, module: 'management', submodule: 'cost_centres', searchable: true },
    ],
  },

  { id: 'admin-users', label: 'Admin Panel', path: '/admin/users', icon: ShieldCheck, actionType: 'route', module: 'admin', submodule: 'users', adminOnly: true, searchable: true },
];

// ── Global + Create menu — driven by the SAME registry (actionType='create').
//    Every action requires the module 'create' permission (requiredAction). ───
export const CREATE_ACTIONS = [
  { id: 'create-invoice', label: 'Invoice', path: '/invoices/new', icon: FileText, group: 'Customers', actionType: 'create', module: 'sales', requiredAction: 'create', pinnable: true, hot: true },
  { id: 'create-receipt', label: 'Receipt', path: '/receipts/new', icon: TrendingUp, group: 'Customers', actionType: 'create', module: 'accounting', requiredAction: 'create', pinnable: true },
  { id: 'create-customer', label: 'Customer', path: '/customers', icon: Users, group: 'Customers', actionType: 'create', module: 'sales', requiredAction: 'create' },
  { id: 'create-expense', label: 'Expense', path: '/expenses', icon: CreditCard, group: 'Vendors', actionType: 'create', module: 'purchase', requiredAction: 'create' },
  { id: 'create-purchase-note', label: 'Purchase Note', path: '/purchase-notes/new', icon: ShoppingCart, group: 'Vendors', actionType: 'create', module: 'purchase', requiredAction: 'create', pinnable: true, hot: true },
  { id: 'create-vendor-bill', label: 'Vendor Bill', path: '/bills/new', icon: FileText, group: 'Vendors', actionType: 'create', module: 'purchase', requiredAction: 'create', pinnable: true, hot: true },
  { id: 'create-payment', label: 'Payment', path: '/payments/new', icon: TrendingDown, group: 'Vendors', actionType: 'create', module: 'accounting', requiredAction: 'create', pinnable: true },
  { id: 'create-vendor', label: 'Vendor', path: '/vendors', icon: Building2, group: 'Vendors', actionType: 'create', module: 'purchase', requiredAction: 'create' },
  { id: 'create-journal-entry', label: 'Journal Entry', path: '/journal-entries/new', icon: BookOpen, group: 'Accounting', actionType: 'create', module: 'accounting', requiredAction: 'create', pinnable: true, hot: true },
  { id: 'create-bank-deposit', label: 'Bank Deposit', path: '/bank-deposits/new', icon: Landmark, group: 'Accounting', actionType: 'create', module: 'accounting', requiredAction: 'create' },
];

// ── Role/persona presets (defaults only — never grant access). Values are
//    registry ids; unavailable ids are omitted per user at resolve time. ──────
export const PRESETS = {
  factory:     ['control-tower', 'start-process', 'process-return', 'process-issues', 'stock-transfer', 'growth-runs'],
  accounts:    ['create-journal-entry', 'create-payment', 'create-receipt', 'create-vendor-bill', 'create-purchase-note'],
  inventory:   ['all-inventory', 'opening-entry', 'closing-entry', 'stock-transfer', 'lot-movements'],
  management:  ['dashboard', 'control-tower', 'pnl', 'costing', 'fund-utilization'],
  super_admin: [],
};

// Default preset by role (personas map onto real roles; super_admin empty).
export const DEFAULT_PRESET_BY_ROLE = {
  operator: 'factory',
  viewer: 'inventory',
  admin: 'management',
  super_admin: 'super_admin',
};

export const MAX_VISIBLE_SHORTCUTS = 5;

// ── Flatten every leaf entry (sidebar leaves + create actions) for id lookup.
function collectLeaves() {
  const out = [];
  for (const node of NAVIGATION) {
    if (node.children) {
      for (const c of node.children) out.push({ ...c, section: node.label, sectionIcon: node.icon, actionType: c.actionType || 'route' });
    } else if (node.path) {
      out.push({ ...node, section: null });
    }
  }
  for (const a of CREATE_ACTIONS) out.push(a);
  return out;
}

export const ALL_ENTRIES = collectLeaves();
const ENTRY_BY_ID = new Map(ALL_ENTRIES.map(e => [e.id, e]));

export function getEntryById(id) {
  return ENTRY_BY_ID.get(id) || null;
}

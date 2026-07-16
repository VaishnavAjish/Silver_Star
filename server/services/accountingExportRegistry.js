const { getLedgerReport, getTrialBalanceHierarchyReport, getProfitAndLossReport, getBalanceSheetReport } = require('./accountingReportService');

const BUSINESS_NAME = 'SILVERSTAR DIAM PVT. LTD.';

const nz = (v) => (v === 0 || v === null || v === undefined ? null : v);
const indent = (depth, name) => `${'    '.repeat(Math.max(0, depth))}${name ?? ''}`;

function flattenTree(nodes, cells, depth = 0) {
  const out = [];
  for (const node of nodes || []) {
    out.push(cells(node, depth));
    if (node.children && node.children.length) {
      out.push(...flattenTree(node.children, cells, depth + 1));
    }
  }
  return out;
}

const ledger = {
  id: 'ledger',
  title: 'Ledger',
  fileName: 'ledger',
  formats: ['xlsx', 'csv'],
  orientation: 'landscape',
  permission: { module: 'reports', submodule: 'ledger' },
  validateFilters: (f = {}) => {
    const allowed = ['accountId', 'accountName', 'fromDate', 'toDate'];
    const unknown = Object.keys(f).filter(k => !allowed.includes(k));
    if (unknown.length > 0) throw new Error(`Unknown filter keys: ${unknown.join(', ')}`);
    if (!f.accountId || isNaN(Number(f.accountId))) throw new Error('Invalid accountId filter');
    // Ensure date formats are somewhat valid
    if (f.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.fromDate)) throw new Error('Invalid fromDate filter');
    if (f.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.toDate)) throw new Error('Invalid toDate filter');
    if (f.fromDate && f.toDate && new Date(f.fromDate) > new Date(f.toDate)) throw new Error('Reversed date range');
    return f;
  },
  getFilters: (f = {}) => [
    { label: 'Account', value: f.accountName || f.accountId },
    { label: 'From', value: f.fromDate },
    { label: 'To', value: f.toDate },
  ],
  columns: [
    { key: 'date', label: 'Date', type: 'date', width: 13 },
    { key: 'je_number', label: 'JE No', type: 'text', width: 14 },
    { key: 'description', label: 'Description', type: 'text', width: 40 },
    { key: 'source', label: 'Source', type: 'text', width: 16 },
    { key: 'doc_id', label: 'Doc ID', type: 'text', width: 14 },
    { key: 'debit', label: 'Debit', type: 'number', width: 16 },
    { key: 'credit', label: 'Credit', type: 'number', width: 16 },
    { key: 'balance', label: 'Balance', type: 'number', width: 18 },
  ],
  async loadCanonicalReport(filters) {
    return await getLedgerReport(filters.accountId, filters.fromDate, filters.toDate);
  },
  buildModel(data) {
    const rows = [];
    rows.push({ kind: 'subtotal', cells: ['', '', 'Opening Balance', '', '', null, null, data.openingBalance ?? 0] });
    for (const e of data.entries || []) {
      rows.push({
        kind: 'data',
        cells: [e.date, e.je_number, e.description, e.source_type || '', e.doc_id || '', nz(e.debit), nz(e.credit), e.balance],
      });
    }
    const totals = { cells: ['', '', 'Period Totals', '', '', data.totalDebit ?? 0, data.totalCredit ?? 0, data.closingBalance ?? 0] };
    return { rows, totals };
  },
};

const trialBalance = {
  id: 'trial-balance',
  title: 'Trial Balance',
  fileName: 'trial-balance',
  formats: ['xlsx', 'csv'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'trial_balance' },
  validateFilters: (f = {}) => {
    const allowed = ['fromDate', 'toDate'];
    const unknown = Object.keys(f).filter(k => !allowed.includes(k));
    if (unknown.length > 0) throw new Error(`Unknown filter keys: ${unknown.join(', ')}`);
    if (f.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.fromDate)) throw new Error('Invalid fromDate filter');
    if (f.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.toDate)) throw new Error('Invalid toDate filter');
    if (f.fromDate && f.toDate && new Date(f.fromDate) > new Date(f.toDate)) throw new Error('Reversed date range');
    return f;
  },
  getFilters: (f = {}) => [
    { label: 'From', value: f.fromDate },
    { label: 'To', value: f.toDate },
  ],
  columns: [
    { key: 'account', label: 'Account', type: 'text', width: 44 },
    { key: 'debit', label: 'Debit', type: 'number', width: 18 },
    { key: 'credit', label: 'Credit', type: 'number', width: 18 },
  ],
  async loadCanonicalReport(filters) {
    return await getTrialBalanceHierarchyReport(filters.fromDate, filters.toDate);
  },
  buildModel(data) {
    const rows = flattenTree(data.roots || [], (node, depth) => ({
      kind: node.is_group ? 'subtotal' : 'data',
      cells: [
        indent(depth, node.code ? `${node.name}  [${node.code}]` : node.name),
        nz(node.dr_val),
        nz(node.cr_val),
      ],
    }));
    const totals = { cells: ['Grand Total', data.grandDebit ?? 0, data.grandCredit ?? 0] };
    return { rows, totals };
  },
};

const profitLoss = {
  id: 'pnl',
  title: 'Profit & Loss',
  fileName: 'profit-and-loss',
  formats: ['xlsx', 'csv'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'profit_loss' },
  validateFilters: (f = {}) => {
    const allowed = ['fromDate', 'toDate'];
    const unknown = Object.keys(f).filter(k => !allowed.includes(k));
    if (unknown.length > 0) throw new Error(`Unknown filter keys: ${unknown.join(', ')}`);
    if (f.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.fromDate)) throw new Error('Invalid fromDate filter');
    if (f.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.toDate)) throw new Error('Invalid toDate filter');
    if (f.fromDate && f.toDate && new Date(f.fromDate) > new Date(f.toDate)) throw new Error('Reversed date range');
    return f;
  },
  getFilters: (f = {}) => [
    { label: 'From', value: f.fromDate },
    { label: 'To', value: f.toDate },
  ],
  columns: [
    { key: 'particulars', label: 'Particulars', type: 'text', width: 48 },
    { key: 'amount', label: 'Amount', type: 'number', width: 20 },
  ],
  async loadCanonicalReport(filters) {
    return await getProfitAndLossReport(filters.fromDate, filters.toDate);
  },
  buildModel(data) {
    const inv = data.inventory || {};
    const grossProfit = (data.totalRevenue ?? 0) - (data.totalCogs ?? 0);
    const rows = [];

    rows.push({ kind: 'header', cells: ['Revenue', null] });
    for (const r of data.revenue || []) rows.push({ kind: 'data', cells: [indent(1, r.name), r.amount] });
    rows.push({ kind: 'subtotal', cells: ['Total Revenue', data.totalRevenue ?? 0] });
    rows.push({ kind: 'spacer' });

    rows.push({ kind: 'header', cells: ['Cost of Goods Sold', null] });
    rows.push({ kind: 'data', cells: [indent(1, 'Opening Stock'), inv.openingStock ?? 0] });
    rows.push({ kind: 'data', cells: [indent(1, 'Purchases'), inv.purchases ?? 0] });
    rows.push({ kind: 'data', cells: [indent(1, `Less: Closing Stock${inv.closingMode ? ` (${inv.closingMode})` : ''}`), -(inv.closingStock ?? 0)] });
    rows.push({ kind: 'subtotal', cells: ['Total COGS', data.totalCogs ?? 0] });
    rows.push({ kind: 'spacer' });

    rows.push({ kind: 'subtotal', cells: ['Gross Profit', grossProfit] });
    rows.push({ kind: 'spacer' });

    rows.push({ kind: 'header', cells: ['Operating Expenses', null] });
    for (const r of data.opex || []) rows.push({ kind: 'data', cells: [indent(1, r.name), r.amount] });
    rows.push({ kind: 'subtotal', cells: ['Total OpEx', data.totalOpex ?? 0] });
    rows.push({ kind: 'spacer' });

    rows.push({ kind: 'data', cells: ['Net Margin (%)', data.netMargin ?? 0] });

    const totals = { cells: ['Net Profit', data.netProfit ?? 0] };
    return { rows, totals };
  },
};

const balanceSheet = {
  id: 'balance-sheet',
  title: 'Balance Sheet',
  fileName: 'balance-sheet',
  formats: ['xlsx', 'csv'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'balance_sheet' },
  validateFilters: (f = {}) => {
    const allowed = ['asOfDate'];
    const unknown = Object.keys(f).filter(k => !allowed.includes(k));
    if (unknown.length > 0) throw new Error(`Unknown filter keys: ${unknown.join(', ')}`);
    if (f.asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.asOfDate)) throw new Error('Invalid asOfDate filter');
    return f;
  },
  getFilters: (f = {}) => [{ label: 'As of', value: f.asOfDate }],
  columns: [
    { key: 'code', label: 'Code', type: 'text', width: 12 },
    { key: 'particulars', label: 'Particulars', type: 'text', width: 46 },
    { key: 'amount', label: 'Amount', type: 'number', width: 20 },
  ],
  async loadCanonicalReport(filters) {
    return await getBalanceSheetReport(filters.asOfDate);
  },
  buildModel(data) {
    const h = data.hierarchy || {};
    const nodeCells = (node, depth) => ({
      kind: node.is_group ? 'subtotal' : 'data',
      cells: [node.code || '', indent(depth, node.name), node.is_group ? (node.group_total ?? node.balance) : node.balance],
    });
    const section = (title, nodes, total, extraRows = []) => {
      const rows = [{ kind: 'header', cells: [title, '', null] }];
      rows.push(...flattenTree(nodes || [], nodeCells));
      rows.push(...extraRows);
      rows.push({ kind: 'subtotal', cells: [`Total ${title}`, '', total] });
      rows.push({ kind: 'spacer' });
      return rows;
    };

    const rows = [
      ...section('LIABILITIES', h.liabilities, data.totalLiabilities ?? 0),
      ...section('EQUITY', h.equity, data.totalEquity ?? 0, [
        { kind: 'data', cells: ['', 'Current Year Profit (Retained Earnings)', data.retainedEarnings ?? 0] },
      ]),
      ...section('ASSETS', h.assets, data.totalAssets ?? 0),
    ];
    return { rows, totals: null };
  },
};

const REPORT_EXPORTS = {
  [ledger.id]: ledger,
  [trialBalance.id]: trialBalance,
  [profitLoss.id]: profitLoss,
  [balanceSheet.id]: balanceSheet,
};

function buildExportModel(def, data, filters = {}) {
  const { rows, totals } = def.buildModel(data, filters);
  const filterSummary = def.getFilters(filters);
  const generatedAt = new Date().toISOString();
  return {
    id: def.id,
    title: def.title,
    fileName: def.fileName,
    orientation: def.orientation,
    business: BUSINESS_NAME,
    subtitle: '',
    generatedAt,
    filters: filterSummary,
    columns: def.columns,
    rows,
    totals,
    meta: {
      business: BUSINESS_NAME,
      title: def.title,
      filters: filterSummary,
      generatedAt,
    },
  };
}

module.exports = {
  REPORT_EXPORTS,
  buildExportModel
};

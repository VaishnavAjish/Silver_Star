/**
 * core/export/exportDefinitions — per-report export metadata + model builders.
 *
 * One definition per P0 accounting report. Each definition is the single
 * source of truth for that report's export: columns, orientation, the
 * report-view permission to reuse, and a `buildModel(data, filters)` function
 * that turns the LIVE report response (already fetched for the on-screen view,
 * i.e. all records matching the active filters) into the neutral model consumed
 * by exportUtils and the server xlsx builder.
 *
 * Builders NEVER recompute accounting figures — they read the raw numeric
 * values the report API already returned (openingBalance, dr_val, amount,
 * balance, grand totals, …). The only arithmetic is the Gross Profit identity
 * (Revenue − COGS), which the P&L view itself already displays.
 */

export const BUSINESS_NAME = 'SILVERSTAR DIAM PVT. LTD.';

const nz = (v) => (v === 0 || v === null || v === undefined ? null : v);
const indent = (depth, name) => `${'    '.repeat(Math.max(0, depth))}${name ?? ''}`;

/** Depth-first flatten of a GL tree into export rows. */
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

// ── Ledger ────────────────────────────────────────────────────────────────
const ledger = {
  id: 'ledger',
  title: 'Ledger',
  fileName: 'ledger',
  formats: ['xlsx', 'csv', 'print'],
  orientation: 'landscape',
  permission: { module: 'reports', submodule: 'ledger' },
  getFilters: (f = {}) => [
    { label: 'Account', value: f.account },
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

// ── Trial Balance ───────────────────────────────────────────────────────────
const trialBalance = {
  id: 'trial-balance',
  title: 'Trial Balance',
  fileName: 'trial-balance',
  formats: ['xlsx', 'csv', 'print'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'trial_balance' },
  getFilters: (f = {}) => [
    { label: 'From', value: f.fromDate },
    { label: 'To', value: f.toDate },
  ],
  columns: [
    { key: 'account', label: 'Account', type: 'text', width: 44 },
    { key: 'debit', label: 'Debit', type: 'number', width: 18 },
    { key: 'credit', label: 'Credit', type: 'number', width: 18 },
  ],
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

// ── Profit & Loss ─────────────────────────────────────────────────────────
const profitLoss = {
  id: 'pnl',
  title: 'Profit & Loss',
  fileName: 'profit-and-loss',
  formats: ['xlsx', 'csv', 'print'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'profit_loss' },
  getFilters: (f = {}) => [
    { label: 'From', value: f.fromDate },
    { label: 'To', value: f.toDate },
  ],
  columns: [
    { key: 'particulars', label: 'Particulars', type: 'text', width: 48 },
    { key: 'amount', label: 'Amount', type: 'number', width: 20 },
  ],
  buildModel(data) {
    const inv = data.inventory || {};
    const grossProfit = (data.totalRevenue ?? 0) - (data.totalCogs ?? 0); // identity shown on-screen
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

// ── Balance Sheet ───────────────────────────────────────────────────────────
const balanceSheet = {
  id: 'balance-sheet',
  title: 'Balance Sheet',
  fileName: 'balance-sheet',
  formats: ['xlsx', 'csv', 'print'],
  orientation: 'portrait',
  permission: { module: 'reports', submodule: 'balance_sheet' },
  getFilters: (f = {}) => [{ label: 'As of', value: f.asOfDate }],
  columns: [
    { key: 'code', label: 'Code', type: 'text', width: 12 },
    { key: 'particulars', label: 'Particulars', type: 'text', width: 46 },
    { key: 'amount', label: 'Amount', type: 'number', width: 20 },
  ],
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

export const REPORT_EXPORTS = {
  [ledger.id]: ledger,
  [trialBalance.id]: trialBalance,
  [profitLoss.id]: profitLoss,
  [balanceSheet.id]: balanceSheet,
};

/**
 * Assemble the full, ready-to-export model for a report.
 * @param {object} def   one of REPORT_EXPORTS
 * @param {object} data  the live report API response
 * @param {object} filters  the report page's active filter state
 */
export function buildReportModel(def, data, filters = {}) {
  const { rows, totals } = def.buildModel(data, filters);
  const filterSummary = def.getFilters(filters);
  const generatedAt = new Date().toISOString();
  return {
    // Top-level fields consumed by the server xlsx builder (pure formatter).
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
    // Convenience bundle for the client CSV writer / print header.
    meta: {
      business: BUSINESS_NAME,
      title: def.title,
      filters: filterSummary,
      generatedAt,
    },
  };
}

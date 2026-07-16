const pool = require('../db/pool');
const { getInventoryValuation, getInventoryValuationLines, round2 } = require('./inventoryAccounting');
const { logger } = require('../middleware/logger');
const { buildTrialBalanceHierarchy, buildAccountHierarchy } = require('./glQueryService');
const reportingCurrencyService = require('./reportingCurrencyService');

async function getLedgerReport(accountId, from_date, to_date, query = {}) {
  const accR = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (accR.rows.length === 0) throw new Error('Account not found');
  const account = accR.rows[0];

  // Opening balance: sum of all posted JEs before from_date
  const openR = await pool.query(
    `SELECT COALESCE(SUM(jl.debit), 0) as total_dr, COALESCE(SUM(jl.credit), 0) as total_cr
     FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id
     WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date < $2`,
    [accountId, from_date]
  );
  let openingBalance = 0;
  if (['asset', 'expense'].includes(account.type)) {
    openingBalance = parseFloat(openR.rows[0].total_dr) - parseFloat(openR.rows[0].total_cr);
  } else {
    openingBalance = parseFloat(openR.rows[0].total_cr) - parseFloat(openR.rows[0].total_dr);
  }

  // Period entries
  const entriesR = await pool.query(
    `SELECT je.id as je_id, je.je_number, je.date, je.description, je.source_type, je.source_id, jl.debit, jl.credit, jl.narration,
            CASE
              WHEN je.source_type = 'purchase' THEN (SELECT doc_number::text FROM purchase_notes WHERE id::text = je.source_id::text)
              WHEN je.source_type = 'sales' THEN (SELECT doc_number::text FROM invoices WHERE id::text = je.source_id::text)
              WHEN je.source_type = 'payment' THEN (SELECT doc_number::text FROM payments WHERE id::text = je.source_id::text)
              WHEN je.source_type = 'receipt' THEN (SELECT doc_number::text FROM receipts WHERE id::text = je.source_id::text)
              ELSE je.source_id::text
            END as doc_id
     FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id
     WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date BETWEEN $2 AND $3
     ORDER BY je.date, je.id`,
    [accountId, from_date, to_date]
  );

  let runningBalance = openingBalance;
  const entries = entriesR.rows.map(e => {
    const dr = parseFloat(e.debit) || 0;
    const cr = parseFloat(e.credit) || 0;
    if (['asset', 'expense'].includes(account.type)) {
      runningBalance += dr - cr;
    } else {
      runningBalance += cr - dr;
    }
    return { ...e, debit: dr, credit: cr, balance: Math.round(runningBalance * 100) / 100 };
  });

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  return { account, openingBalance, entries, closingBalance: runningBalance, totalDebit, totalCredit, period: { from: from_date, to: to_date } };
}

async function getTrialBalanceReport(from_date, to_date, query = {}) {
  const result = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2
       GROUP BY jl.account_id
     ),
     balances AS (
       SELECT a.code, a.name, a.type, a.is_group,
              CASE WHEN a.type IN ('asset','expense')
                   THEN COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0)
                   ELSE COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0)
              END AS balance
       FROM accounts a
       LEFT JOIN ledger l ON l.account_id = a.id
       WHERE a.is_group = false AND a.status = 'active'
     )
     SELECT code, name, type, is_group, balance,
            CASE WHEN balance > 0 AND type IN ('asset','expense') THEN balance
                 WHEN balance < 0 AND type IN ('liability','equity','revenue') THEN ABS(balance) ELSE 0 END as debit_balance,
            CASE WHEN balance > 0 AND type IN ('liability','equity','revenue') THEN balance
                 WHEN balance < 0 AND type IN ('asset','expense') THEN ABS(balance) ELSE 0 END as credit_balance
     FROM balances
     ORDER BY code`,
    [from_date, to_date]
  );
  const totalDr = result.rows.reduce((s, r) => s + parseFloat(r.debit_balance || 0), 0);
  const totalCr = result.rows.reduce((s, r) => s + parseFloat(r.credit_balance || 0), 0);
  const payload = { accounts: result.rows, totalDebit: totalDr, totalCredit: totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01, period: { from: from_date, to: to_date } };
  return await reportingCurrencyService.formatReport(payload, 'trial_balance', query);
}

async function getTrialBalanceHierarchyReport(from_date, to_date, query = {}) {
  const roots = await buildTrialBalanceHierarchy(from_date, to_date);

  const totR = await pool.query(
    `SELECT COALESCE(SUM(jl.debit),  0) AS grand_debit,
            COALESCE(SUM(jl.credit), 0) AS grand_credit
     FROM je_lines jl
     JOIN journal_entries je ON je.id = jl.je_id
     WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2`,
    [from_date, to_date]
  );
  const grandDebit  = Math.round(parseFloat(totR.rows[0].grand_debit)  * 100) / 100;
  const grandCredit = Math.round(parseFloat(totR.rows[0].grand_credit) * 100) / 100;

  const payload = {
    period: { from: from_date, to: to_date },
    roots,
    grandDebit,
    grandCredit,
    balanced: Math.abs(grandDebit - grandCredit) < 0.01,
  };
  return await reportingCurrencyService.formatReport(payload, 'trial_balance_hierarchy', query);
}

async function getProfitAndLossReport(from_date, to_date, query = {}) {
  const [roots, closingInventory] = await Promise.all([
    buildTrialBalanceHierarchy(from_date, to_date),
    getInventoryValuation(to_date)
  ]);

  const allLeaves = [];
  const flatten = (nodes, rootGroup) => {
    for (const node of nodes) {
      if (!node.is_group && (node.net_balance !== 0 || node.total_debit !== 0 || node.total_credit !== 0)) {
        allLeaves.push({ ...node, rootGroup });
      }
      if (node.children && node.children.length > 0) {
        flatten(node.children, rootGroup || node.name);
      }
    }
  };
  flatten(roots, null);

  let openingStock = 0;
  try {
    const openingR = await pool.query(
      `SELECT COALESCE(SUM(value), 0) AS value FROM inventory_opening WHERE as_of_date < $1`,
      [from_date]
    );
    openingStock = round2(openingR.rows[0].value);
  } catch { /* missing table */ }

  const revenue = allLeaves
    .filter(a => a.type === 'revenue')
    .map(a => ({ ...a, amount: -a.net_balance }));

  const expenses = allLeaves.filter(a => a.type === 'expense');

  const isCogs = (a) => {
    return a.account_role === 'COGS' || a.sub_type === 'cogs' || a.sub_type === 'direct_expense';
  };

  const cogsAccounts = expenses.filter(isCogs);
  const opexAccounts = expenses.filter(a => !isCogs(a));

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);

  const actualCogs = round2(cogsAccounts.reduce((sum, a) => sum + a.net_balance, 0));
  const closingStock = round2(closingInventory.value);
  
  const purchases = round2(actualCogs - openingStock + closingStock);
  const formulaCogs = actualCogs;

  const cogs = [
    { code: 'OPEN', name: 'Opening Stock', amount: openingStock },
    { code: 'PURCHASES', name: 'Purchases', amount: purchases },
    { code: 'CLOSE', name: 'Less: Closing Stock', amount: -closingStock },
  ];

  const opex = opexAccounts.map(a => ({ ...a, amount: a.net_balance }));
  const totalCogs = formulaCogs;
  const totalOpex = round2(opex.reduce((s, r) => s + r.amount, 0));
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = grossProfit - totalOpex;
  const netMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 10000) / 100 : 0;

  logger.info(`[P&L Report] period=${from_date}..${to_date} revenue=${totalRevenue} cogs=${totalCogs} opex=${totalOpex} gross=${grossProfit} net=${netProfit}`);

  let purchaseBreakdown = [];
  try {
    const breakdownR = await pool.query(
      `SELECT COALESCE(item_type, 'General') AS category, COALESCE(SUM(total_amount), 0) as amount
       FROM purchase_notes
       WHERE doc_date >= $1 AND doc_date <= $2 AND status != 'cancelled'
         AND LOWER(item_type) IN ('seed', 'gas')
       GROUP BY COALESCE(item_type, 'General')`,
      [from_date, to_date]
    );
    purchaseBreakdown = breakdownR.rows;
  } catch (err) {
    logger.error('Failed to get purchase breakdown:', err);
  }

  const payload = {
    period: { from: from_date, to: to_date },
    revenue, totalRevenue,
    cogs, totalCogs,
    inventory: {
      openingStock,
      purchases,
      purchaseBreakdown,
      closingStock,
      closingMode: closingInventory.mode,
      closingAsOfDate: closingInventory.as_of_date,
    },
    grossProfit,
    opex, totalOpex,
    netProfit, netMargin,
  };
  return await reportingCurrencyService.formatReport(payload, 'pnl', query);
}

async function getBalanceSheetReport(asOfDate, query = {}) {
  const assetR = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date <= $1
       GROUP BY jl.account_id
     )
     SELECT a.code, a.name,
            COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0) as balance
     FROM accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE a.type = 'asset' AND a.is_group = false AND a.status = 'active'
     AND COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0) <> 0
     ORDER BY a.code`,
    [asOfDate]
  );

  const liabR = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date <= $1
       GROUP BY jl.account_id
     )
     SELECT a.code, a.name,
            COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0) as balance
     FROM accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE a.type = 'liability' AND a.is_group = false AND a.status = 'active'
     AND COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0) <> 0
     ORDER BY a.code`,
    [asOfDate]
  );

  const equityR = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date <= $1
       GROUP BY jl.account_id
     )
     SELECT a.code, a.name,
            COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0) as balance
     FROM accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE a.type = 'equity' AND a.is_group = false AND a.status = 'active'
     AND COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0) <> 0
     ORDER BY a.code`,
    [asOfDate]
  );

  const reR = await pool.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as retained_earnings
     FROM je_lines jl
     JOIN journal_entries je ON je.id = jl.je_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE je.status = 'posted' AND je.date <= $1 AND a.type IN ('revenue', 'expense')`,
    [asOfDate]
  );

  const assets = assetR.rows.map(r => ({ code: r.code, name: r.name, balance: parseFloat(r.balance) }));
  const liabilities = liabR.rows.map(r => ({ code: r.code, name: r.name, balance: parseFloat(r.balance) }));
  const equity = equityR.rows.map(r => ({ code: r.code, name: r.name, balance: parseFloat(r.balance) }));
  const retainedEarnings = parseFloat(reR.rows[0].retained_earnings);

  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0);
  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity + retainedEarnings)) < 0.01;
  const groupRows = (rows, defs) => {
    const used = new Set();
    const groups = defs.map(def => {
      const matched = rows.filter((r, idx) => {
        const ok = !used.has(idx) && def.tests.some(t => t.test(`${r.code} ${r.name}`));
        if (ok) used.add(idx);
        return ok;
      });
      return { title: def.title, rows: matched };
    });
    const others = rows.filter((_, idx) => !used.has(idx));
    if (others.length) groups.push({ title: 'Others', rows: others });
    return groups;
  };
  const vertical = {
    liabilities: groupRows(liabilities, [
      { title: 'Loans', tests: [/loan|borrow/i] },
      { title: 'Creditors', tests: [/payable|creditor|vendor/i] },
      { title: 'Taxes Payable', tests: [/tax|gst|tds/i] },
    ]),
    capital: groupRows(equity, [{ title: 'Capital', tests: [/capital|equity/i] }]),
    equity: [{ title: 'Current Year Profit', rows: [{ code: '', name: 'Current Year Profit', balance: retainedEarnings }] }],
    assets: groupRows(assets, [
      { title: 'Cash', tests: [/cash/i] },
      { title: 'Bank', tests: [/bank/i] },
      { title: 'Debtors', tests: [/receivable|debtor|customer/i] },
      { title: 'Inventory', tests: [/inventory|stock|wip|seed|rough|gas|consumable/i] },
      { title: 'Fixed Assets', tests: [/fixed|plant|machine|equipment|accum/i] },
    ]),
  };

  const [hAssets, hLiabs, hEquity] = await Promise.all([
    buildAccountHierarchy('asset',     asOfDate),
    buildAccountHierarchy('liability', asOfDate),
    buildAccountHierarchy('equity',    asOfDate),
  ]);

  const payload = {
    asOfDate, assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity, retainedEarnings,
    isBalanced, vertical,
    hierarchy: { assets: hAssets, liabilities: hLiabs, equity: hEquity },
  };
  return await reportingCurrencyService.formatReport(payload, 'balance_sheet', query);
}

module.exports = {
  getLedgerReport,
  getTrialBalanceReport,
  getTrialBalanceHierarchyReport,
  getProfitAndLossReport,
  getBalanceSheetReport
};

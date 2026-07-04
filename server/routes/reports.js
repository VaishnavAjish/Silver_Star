const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { getInventoryValuation, getInventoryValuationLines, round2 } = require('../services/inventoryAccounting');
const { logger } = require('../middleware/logger');
const { buildTrialBalanceHierarchy, buildAccountHierarchy } = require('../services/glQueryService');
const { getFundMovementSummary, getDrillDownData } = require('../services/fundMovementService');
const reportingCurrencyService = require('../services/reportingCurrencyService');

const router = express.Router();

// GET /api/reports/pnl?from=2025-04-01&to=2025-04-30
router.get('/pnl', authenticate, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (!from_date) from_date = '1970-01-01';
    if (!to_date) to_date = new Date().toISOString().split('T')[0];

    // Fetch GL balances via Trial Balance hierarchy and inventory valuations concurrently
    const [roots, closingInventory] = await Promise.all([
      buildTrialBalanceHierarchy(from_date, to_date),
      getInventoryValuation(to_date)
    ]);

    // Flatten the Trial Balance tree to get all leaf accounts with activity
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

    // inventory_opening table may not exist on older deployments - fall back to 0
    let openingStock = 0;
    try {
      const openingR = await pool.query(
        `SELECT COALESCE(SUM(value), 0) AS value FROM inventory_opening WHERE as_of_date < $1`,
        [from_date]
      );
      openingStock = round2(openingR.rows[0].value);
    } catch { /* table missing - treat opening stock as 0 */ }

    // Revenue accounts (Credit balances are positive for revenue)
    const revenue = allLeaves
      .filter(a => a.type === 'revenue')
      .map(a => ({ ...a, amount: -a.net_balance }));

    const expenses = allLeaves.filter(a => a.type === 'expense');

    // Identify COGS accounts via structural fields, never by user-defined string names
    const isCogs = (a) => {
      return a.account_role === 'COGS' || a.sub_type === 'cogs' || a.sub_type === 'direct_expense';
    };

    const cogsAccounts = expenses.filter(isCogs);
    const opexAccounts = expenses.filter(a => !isCogs(a));

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);

    // Actual COGS is strictly the sum of the COGS GL accounts (Debit is positive for expenses)
    const actualCogs = round2(cogsAccounts.reduce((sum, a) => sum + a.net_balance, 0));
    const closingStock = round2(closingInventory.value);
    
    // Mathematically derive the Purchases figure to perfectly balance the Periodic formula
    // Formula: actualCogs = openingStock + purchases - closingStock
    // Therefore: purchases = actualCogs - openingStock + closingStock
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

    // Calculate Purchase Breakdown directly from purchase_notes
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
    const formatted = await reportingCurrencyService.formatReport(payload, 'pnl', req.query);
    res.json(formatted);
  } catch (err) { 
    require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); 
    res.status(500).json({ error: err.message }); 
  }
});

// GET /api/reports/inventory-valuation?as_of_date=YYYY-MM-DD
router.get('/inventory-valuation', authenticate, async (req, res) => {
  try {
    const { as_of_date = new Date().toISOString().split('T')[0] } = req.query;
    res.json(await getInventoryValuationLines(as_of_date));
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/ledger/:accountId
router.get('/ledger/:accountId', authenticate, async (req, res) => {
  try {
    const { from_date = '2025-01-01', to_date = new Date().toISOString().split('T')[0] } = req.query;

    const accR = await pool.query('SELECT * FROM accounts WHERE id = $1', [req.params.accountId]);
    if (accR.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const account = accR.rows[0];

    // Opening balance: sum of all posted JEs before from_date
    const openR = await pool.query(
      `SELECT COALESCE(SUM(jl.debit), 0) as total_dr, COALESCE(SUM(jl.credit), 0) as total_cr
       FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date < $2`,
      [req.params.accountId, from_date]
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
      [req.params.accountId, from_date, to_date]
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

    res.json({ account, openingBalance, entries, closingBalance: runningBalance, totalDebit, totalCredit });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/trial-balance
router.get('/trial-balance', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const fromDate = req.query.fromDate || req.query.from_date || '1900-01-01';
    const toDate = req.query.toDate || req.query.to_date || today;

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
      [fromDate, toDate]
    );
    const totalDr = result.rows.reduce((s, r) => s + parseFloat(r.debit_balance || 0), 0);
    const totalCr = result.rows.reduce((s, r) => s + parseFloat(r.credit_balance || 0), 0);
    const payload = { accounts: result.rows, totalDebit: totalDr, totalCredit: totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 };
    const formatted = await reportingCurrencyService.formatReport(payload, 'trial_balance', req.query);
    res.json(formatted);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/trial-balance-detailed
router.get('/trial-balance-detailed', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const fromDate = req.query.fromDate || req.query.from_date || '1900-01-01';
    const toDate = req.query.toDate || req.query.to_date || today;
    const result = await pool.query(
      `WITH opening AS (
         SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
         WHERE je.status = 'posted' AND je.date < $1
         GROUP BY jl.account_id
       ),
       movement AS (
         SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
         WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2
         GROUP BY jl.account_id
       )
       SELECT a.id, a.code, a.name, a.type,
              CASE WHEN a.type IN ('asset','expense')
                   THEN COALESCE(o.debit,0) - COALESCE(o.credit,0)
                   ELSE COALESCE(o.credit,0) - COALESCE(o.debit,0)
              END AS opening,
              COALESCE(m.debit,0) AS debit,
              COALESCE(m.credit,0) AS credit,
              CASE WHEN a.type IN ('asset','expense')
                   THEN COALESCE(o.debit,0) - COALESCE(o.credit,0) + COALESCE(m.debit,0) - COALESCE(m.credit,0)
                   ELSE COALESCE(o.credit,0) - COALESCE(o.debit,0) + COALESCE(m.credit,0) - COALESCE(m.debit,0)
              END AS closing
       FROM accounts a
       LEFT JOIN opening o ON o.account_id = a.id
       LEFT JOIN movement m ON m.account_id = a.id
       WHERE a.is_group = false AND a.status = 'active'
       ORDER BY a.code`,
      [fromDate, toDate]
    );
    const accounts = result.rows.map(r => {
      const closing = parseFloat(r.closing || 0);
      return {
        ...r,
        opening: parseFloat(r.opening || 0),
        debit: parseFloat(r.debit || 0),
        credit: parseFloat(r.credit || 0),
        closing,
        dr_cr: closing >= 0 ? (['asset', 'expense'].includes(r.type) ? 'Dr' : 'Cr') : (['asset', 'expense'].includes(r.type) ? 'Cr' : 'Dr'),
      };
    });
    const totals = accounts.reduce((s, r) => ({
      opening: s.opening + r.opening,
      debit: s.debit + r.debit,
      credit: s.credit + r.credit,
      closing: s.closing + r.closing,
    }), { opening: 0, debit: 0, credit: 0, closing: 0 });
    const payload = { period: { from: fromDate, to: toDate }, accounts, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.01 };
    const formatted = await reportingCurrencyService.formatReport(payload, 'trial_balance_detailed', req.query);
    res.json(formatted);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── Balance sheet hierarchy helper ────────────────────────────────────────────
// Imported from glQueryService — do not duplicate here.
// buildAccountHierarchy() and buildTrialBalanceHierarchy() are now shared
// services consumed by both this file and fundMovementService.

// ── Trial balance hierarchy helper ───────────────────────────────────────────
// Imported from glQueryService — do not duplicate here.

// GET /api/reports/trial-balance-hierarchy?from_date=&to_date=
router.get('/trial-balance-hierarchy', authenticate, async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const fromDate = req.query.from_date || '2025-04-01';
    const toDate   = req.query.to_date   || today;

    const roots = await buildTrialBalanceHierarchy(fromDate, toDate);

    // Grand totals: raw sum of all posted JE lines (debits always equal credits)
    const totR = await pool.query(
      `SELECT COALESCE(SUM(jl.debit),  0) AS grand_debit,
              COALESCE(SUM(jl.credit), 0) AS grand_credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2`,
      [fromDate, toDate]
    );
    const grandDebit  = Math.round(parseFloat(totR.rows[0].grand_debit)  * 100) / 100;
    const grandCredit = Math.round(parseFloat(totR.rows[0].grand_credit) * 100) / 100;

    const payload = {
      period: { from: fromDate, to: toDate },
      roots,
      grandDebit,
      grandCredit,
      balanced: Math.abs(grandDebit - grandCredit) < 0.01,
    };
    const formatted = await reportingCurrencyService.formatReport(payload, 'trial_balance_hierarchy', req.query);
    res.json(formatted);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/reports/balance-sheet?asOfDate=YYYY-MM-DD
router.get('/balance-sheet', authenticate, async (req, res) => {
  try {
    let asOfDate = req.query.asOfDate;
    if (!asOfDate) asOfDate = new Date().toISOString().split('T')[0];

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

    // Net income = SUM(credit - debit) across all revenue and expense lines.
    // Revenue net = credit - debit (positive = earned). Expense net = debit - credit (positive = spent).
    // Combined: credit_rev - debit_rev + credit_exp - debit_exp = (credit - debit) for both types.
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

    // Build hierarchy in parallel — additive field, doesn't affect existing frontend
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
    const formatted = await reportingCurrencyService.formatReport(payload, 'balance_sheet', req.query);
    res.json(formatted);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── FIXED ASSET REGISTER ─────────────────────────────────────────────────────
// GET /api/reports/fixed-asset-register?asOfDate=YYYY-MM-DD
router.get('/fixed-asset-register', authenticate, async (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || new Date().toISOString().split('T')[0];

    // For each asset, WDV as of date = purchase_cost - (accumulated_depr - future_runs_after_date)
    const result = await pool.query(
      `SELECT
         fa.id, fa.asset_code, fa.asset_name, fa.qty,
         fa.purchase_date, fa.in_service_date, fa.purchase_cost, fa.salvage_value,
         fa.status, fa.disposal_date,
         fac.id as category_id, fac.name as category_name, fac.depreciation_rate_pct,
         fa.accumulated_depreciation,
         COALESCE((
           SELECT SUM(drl.depreciation_amount)
           FROM depreciation_run_lines drl
           JOIN depreciation_runs dr ON drl.run_id = dr.id
           WHERE drl.fixed_asset_id = fa.id AND dr.status = 'posted' AND dr.period_to > $1
         ), 0) as future_depr
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE fa.purchase_date <= $1
       ORDER BY fac.name, fa.asset_code`,
      [asOfDate]
    );

    // Group by category
    const categoryMap = {};
    for (const row of result.rows) {
      const accDeprAsOf = parseFloat(row.accumulated_depreciation) - parseFloat(row.future_depr);
      const wdvAsOf     = parseFloat(row.purchase_cost) - accDeprAsOf;
      const asset = {
        id:                        row.id,
        asset_code:                row.asset_code,
        asset_name:                row.asset_name,
        qty:                       parseFloat(row.qty) || 1,
        purchase_date:             row.purchase_date,
        in_service_date:           row.in_service_date,
        purchase_cost:             parseFloat(row.purchase_cost),
        accumulated_depreciation:  Math.round(accDeprAsOf * 100) / 100,
        wdv_as_of:                 Math.round(wdvAsOf * 100) / 100,
        status:                    row.status,
      };
      if (!categoryMap[row.category_name]) {
        categoryMap[row.category_name] = { category_name: row.category_name, assets: [],
          total_cost: 0, total_accum_depr: 0, total_wdv: 0 };
      }
      const cat = categoryMap[row.category_name];
      cat.assets.push(asset);
      cat.total_cost         += asset.purchase_cost;
      cat.total_accum_depr   += asset.accumulated_depreciation;
      cat.total_wdv          += asset.wdv_as_of;
    }

    const categories = Object.values(categoryMap).map(c => ({
      ...c,
      total_cost:       Math.round(c.total_cost * 100) / 100,
      total_accum_depr: Math.round(c.total_accum_depr * 100) / 100,
      total_wdv:        Math.round(c.total_wdv * 100) / 100,
    }));

    const grand = categories.reduce((a, c) => ({
      total_cost:       a.total_cost + c.total_cost,
      total_accum_depr: a.total_accum_depr + c.total_accum_depr,
      total_wdv:        a.total_wdv + c.total_wdv,
    }), { total_cost: 0, total_accum_depr: 0, total_wdv: 0 });

    res.json({ as_of_date: asOfDate, categories,
               grand_total_cost:       Math.round(grand.total_cost * 100) / 100,
               grand_total_accum_depr: Math.round(grand.total_accum_depr * 100) / 100,
               grand_total_wdv:        Math.round(grand.total_wdv * 100) / 100 });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── FIXED ASSET DASHBOARD ─────────────────────────────────────────────────────
// GET /api/reports/fixed-asset-dashboard?asOfDate=YYYY-MM-DD
router.get('/fixed-asset-dashboard', authenticate, async (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || new Date().toISOString().split('T')[0];

    // KPI summary + per-category breakdown
    const r = await pool.query(
      `SELECT
         fac.name AS category_name,
         SUM(COALESCE(fa.qty, 1)) AS asset_count,
         SUM(fa.purchase_cost) AS total_cost,
         SUM(fa.accumulated_depreciation - COALESCE((
           SELECT SUM(drl.depreciation_amount)
           FROM depreciation_run_lines drl
           JOIN depreciation_runs dr ON drl.run_id = dr.id
           WHERE drl.fixed_asset_id = fa.id AND dr.status = 'posted' AND dr.period_to > $1
         ), 0)) AS total_accum_depr,
         SUM(fa.purchase_cost - (fa.accumulated_depreciation - COALESCE((
           SELECT SUM(drl.depreciation_amount)
           FROM depreciation_run_lines drl
           JOIN depreciation_runs dr ON drl.run_id = dr.id
           WHERE drl.fixed_asset_id = fa.id AND dr.status = 'posted' AND dr.period_to > $1
         ), 0))) AS total_wdv,
         SUM(CASE WHEN fa.status = 'active' THEN COALESCE(fa.qty, 1) ELSE 0 END) AS active_count,
         SUM(CASE WHEN fa.status = 'disposed' THEN COALESCE(fa.qty, 1) ELSE 0 END) AS disposed_count
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE fa.purchase_date <= $1
       GROUP BY fac.id, fac.name
       ORDER BY total_cost DESC`,
      [asOfDate]
    );

    // Depreciation posted by month (last 12 months)
    const trendR = await pool.query(
      `SELECT
         TO_CHAR(dr.period_to, 'Mon YYYY') AS month_label,
         DATE_TRUNC('month', dr.period_to) AS month_start,
         SUM(drl.depreciation_amount) AS depreciation_amount
       FROM depreciation_run_lines drl
       JOIN depreciation_runs dr ON drl.run_id = dr.id
       WHERE dr.status = 'posted'
         AND dr.period_to >= ($1::date - INTERVAL '12 months')
         AND dr.period_to <= $1::date
       GROUP BY DATE_TRUNC('month', dr.period_to), TO_CHAR(dr.period_to, 'Mon YYYY')
       ORDER BY month_start ASC`
      , [asOfDate]
    );

    const categories = r.rows.map(row => ({
      category_name:  row.category_name,
      asset_count:    parseInt(row.asset_count),
      active_count:   parseInt(row.active_count),
      disposed_count: parseInt(row.disposed_count),
      total_cost:     Math.round(parseFloat(row.total_cost || 0) * 100) / 100,
      total_accum_depr: Math.round(parseFloat(row.total_accum_depr || 0) * 100) / 100,
      total_wdv:      Math.round(parseFloat(row.total_wdv || 0) * 100) / 100,
      depr_pct:       row.total_cost > 0
        ? Math.round((parseFloat(row.total_accum_depr || 0) / parseFloat(row.total_cost)) * 100)
        : 0,
    }));

    const grand = categories.reduce((a, c) => ({
      total_cost:       a.total_cost + c.total_cost,
      total_accum_depr: a.total_accum_depr + c.total_accum_depr,
      total_wdv:        a.total_wdv + c.total_wdv,
      asset_count:      a.asset_count + c.asset_count,
      active_count:     a.active_count + c.active_count,
      disposed_count:   a.disposed_count + c.disposed_count,
    }), { total_cost: 0, total_accum_depr: 0, total_wdv: 0, asset_count: 0, active_count: 0, disposed_count: 0 });

    res.json({
      as_of_date: asOfDate,
      kpi: {
        total_assets:    grand.asset_count,
        active_assets:   grand.active_count,
        disposed_assets: grand.disposed_count,
        total_cost:      Math.round(grand.total_cost * 100) / 100,
        total_accum_depr:Math.round(grand.total_accum_depr * 100) / 100,
        total_wdv:       Math.round(grand.total_wdv * 100) / 100,
        overall_depr_pct: grand.total_cost > 0
          ? Math.round((grand.total_accum_depr / grand.total_cost) * 100)
          : 0,
      },
      categories,
      depreciation_trend: trendR.rows.map(r => ({
        month: r.month_label,
        amount: Math.round(parseFloat(r.depreciation_amount || 0) * 100) / 100,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FIXED ASSET TRIAL BALANCE ──────────────────────────────────────────────────
// GET /api/reports/fixed-asset-trial-balance?asOfDate=YYYY-MM-DD
router.get('/fixed-asset-trial-balance', authenticate, async (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || new Date().toISOString().split('T')[0];

    // Get GL account balances for all accounts linked to fixed asset categories
    const r = await pool.query(
      `SELECT
         a.id, a.code, a.name, a.type AS account_type, a.sub_type,
         COALESCE(SUM(jl.debit), 0) AS total_debit,
         COALESCE(SUM(jl.credit), 0) AS total_credit,
         COALESCE(SUM(jl.debit - jl.credit), 0) AS net_balance
       FROM accounts a
       LEFT JOIN je_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.je_id
         AND je.status = 'posted' AND je.date::date <= $1::date
       WHERE a.id IN (
         SELECT DISTINCT gl_asset_account_id FROM fixed_asset_categories WHERE gl_asset_account_id IS NOT NULL
         UNION
         SELECT DISTINCT gl_accum_depr_account_id FROM fixed_asset_categories WHERE gl_accum_depr_account_id IS NOT NULL
         UNION
         SELECT DISTINCT gl_depr_expense_account_id FROM fixed_asset_categories WHERE gl_depr_expense_account_id IS NOT NULL
       )
       GROUP BY a.id, a.code, a.name, a.type, a.sub_type
       ORDER BY a.code`,
      [asOfDate]
    );

    // Also get per-category account mapping
    const catR = await pool.query(
      `SELECT
         fac.name AS category_name,
         a_asset.code AS asset_account_code, a_asset.name AS asset_account_name,
         a_depr.code  AS accum_depr_code,    a_depr.name  AS accum_depr_name,
         a_exp.code   AS depr_exp_code,      a_exp.name   AS depr_exp_name
       FROM fixed_asset_categories fac
       LEFT JOIN accounts a_asset ON a_asset.id = fac.gl_asset_account_id
       LEFT JOIN accounts a_depr  ON a_depr.id  = fac.gl_accum_depr_account_id
       LEFT JOIN accounts a_exp   ON a_exp.id   = fac.gl_depr_expense_account_id
       ORDER BY fac.name`
    );

    const accounts = r.rows.map(row => ({
      id:           row.id,
      code:         row.code,
      name:         row.name,
      account_type: row.account_type,
      sub_type:     row.sub_type,
      total_debit:  Math.round(parseFloat(row.total_debit) * 100) / 100,
      total_credit: Math.round(parseFloat(row.total_credit) * 100) / 100,
      net_balance:  Math.round(parseFloat(row.net_balance) * 100) / 100,
    }));

    const grand_debit  = accounts.reduce((s, a) => s + a.total_debit, 0);
    const grand_credit = accounts.reduce((s, a) => s + a.total_credit, 0);

    res.json({
      as_of_date: asOfDate,
      accounts,
      category_mapping: catR.rows,
      grand_total_debit:  Math.round(grand_debit * 100) / 100,
      grand_total_credit: Math.round(grand_credit * 100) / 100,
    });
  } catch (err) { 
    console.error("=== FIXED ASSET TRIAL BALANCE ERROR ===", err);
    res.status(500).json({ error: err.message, stack: err.stack }); 
  }
});

// ── DEPRECIATION SCHEDULE ─────────────────────────────────────────────────────
// GET /api/reports/depreciation-schedule?fromDate=&toDate=
router.get('/depreciation-schedule', authenticate, async (req, res) => {
  try {
    const todayDate = new Date();
    let fromDate = req.query.fromDate;
    let toDate = req.query.toDate;

    const { calculateForAsset } = require('../services/depreciationEngine');

    const assetsR = await pool.query(
      `SELECT fa.*, fac.depreciation_rate_pct, fac.depreciation_method, fac.name as category_name
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE fa.status = 'active'
       ORDER BY fa.asset_code`
    );

    if (!fromDate) {
      let minDate = todayDate;
      for (const a of assetsR.rows) {
        if (a.in_service_date && new Date(a.in_service_date) < minDate) {
          minDate = new Date(a.in_service_date);
        }
      }
      fromDate = minDate.toISOString().split('T')[0];
    }
    if (!toDate) {
      toDate = todayDate.toISOString().split('T')[0];
    }

    // Build monthly periods between fromDate and toDate (max 36 months)
    const maxPeriods = 36;
    const periods = [];
    let cur = new Date(fromDate.slice(0, 7) + '-01T00:00:00Z');
    let end = new Date(toDate.slice(0, 7) + '-01T00:00:00Z');
    const maxEnd = new Date(cur.getUTCFullYear(), cur.getUTCMonth() + maxPeriods, 1);
    if (end > maxEnd) end = maxEnd;
    while (cur <= end && periods.length < maxPeriods) {
      const next   = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      const pFrom  = cur.toISOString().split('T')[0];
      const pTo    = new Date(next.getTime() - 86400000).toISOString().split('T')[0];
      periods.push({ from: pFrom, to: pTo });
      cur = next;
    }

    const schedule = [];
    for (const period of periods) {
      let periodTotal = 0;
      const periodLines = [];
      for (const asset of assetsR.rows) {
        const r = calculateForAsset(asset,
          { depreciation_rate_pct: asset.depreciation_rate_pct, depreciation_method: asset.depreciation_method },
          period.from, period.to
        );
        if (!r.skip && r.depreciation_amount > 0) {
          periodLines.push({
            asset_code:          asset.asset_code,
            asset_name:          asset.asset_name,
            category_name:       asset.category_name,
            depreciation_amount: r.depreciation_amount,
          });
          periodTotal += r.depreciation_amount;
        }
      }
      if (periodLines.length > 0) {
        schedule.push({
          period_from:   period.from,
          period_to:     period.to,
          total_depr:    Math.round(periodTotal * 100) / 100,
          asset_count:   periodLines.length,
          lines:         periodLines,
        });
      }
    }

    res.json({ from_date: fromDate, to_date: toDate, schedule,
               grand_total: Math.round(schedule.reduce((s, p) => s + p.total_depr, 0) * 100) / 100 });
  } catch (err) {
    logger.error('DEPR_SCHED_ERROR:', { error: err.message, stack: err.stack?.split('\n').slice(0,2).join(' ') });
    res.status(500).json({ error: err.message });
  }
});

// ── ACCOUNTS RECEIVABLE ──────────────────────────────────────────────────────
// GET /api/reports/accounts-receivable
router.get('/accounts-receivable', authenticate, async (req, res) => {
  try {
    const { customer_id, from_date, to_date, status, overdue_only, search, limit = 500, offset = 0 } = req.query;

    const params = [];
    const innerConds = [`inv.status != 'cancelled'`];
    const outerConds = [];

    if (customer_id) { params.push(parseInt(customer_id)); innerConds.push(`inv.customer_id = $${params.length}`); }
    if (from_date)   { params.push(from_date);             innerConds.push(`inv.doc_date >= $${params.length}`); }
    if (to_date)     { params.push(to_date);               innerConds.push(`inv.doc_date <= $${params.length}`); }
    if (search)      { params.push(`%${search}%`);         innerConds.push(`inv.doc_number ILIKE $${params.length}`); }

    if      (status === 'Paid')    outerConds.push(`balance_amount <= 0`);
    else if (status === 'Unpaid')  outerConds.push(`received_amount = 0 AND balance_amount > 0`);
    else if (status === 'Partial') outerConds.push(`received_amount > 0 AND balance_amount > 0 AND due_date >= CURRENT_DATE`);
    else if (status === 'Overdue') outerConds.push(`balance_amount > 0 AND due_date < CURRENT_DATE`);
    if (overdue_only === 'true')   outerConds.push(`balance_amount > 0 AND due_date < CURRENT_DATE`);

    const whereInner = innerConds.join(' AND ');
    const whereOuter = outerConds.length ? outerConds.join(' AND ') : '1=1';
    
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const dueDaysExpr = `CASE WHEN NULLIF(inv.payment_term, '') ~ '[0-9]' THEN regexp_replace(inv.payment_term, '[^0-9]', '', 'g')::int ELSE 30 END`;

    // AGGREGATE QUERY
    const aggResult = await pool.query(`
      WITH base_data AS (
        SELECT
          inv.grand_total AS invoice_amount,
          COALESCE(inv.amount_paid, 0) AS received_amount,
          COALESCE(inv.balance_due, inv.grand_total) AS balance_amount,
          (inv.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date AS due_date
        FROM invoices inv
        WHERE ${whereInner}
      )
      SELECT 
        COUNT(*)::int AS total_count,
        COALESCE(SUM(invoice_amount), 0) AS total_invoice,
        COALESCE(SUM(received_amount), 0) AS total_received,
        COALESCE(SUM(balance_amount), 0) AS total_balance
      FROM base_data
      WHERE ${whereOuter}
    `, params.slice(0, -2));

    const totalCount = aggResult.rows[0]?.total_count || 0;
    const totals = {
      invoice_amount: parseFloat(aggResult.rows[0]?.total_invoice || 0),
      received_amount: parseFloat(aggResult.rows[0]?.total_received || 0),
      balance_amount: parseFloat(aggResult.rows[0]?.total_balance || 0)
    };

    // ROW QUERY WITH PAGINATION
    const result = await pool.query(`
      SELECT * FROM (
        SELECT
          inv.id, inv.doc_number, inv.doc_date,
          c.name AS customer_name,
          inv.payment_term,
          (inv.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date AS due_date,
          inv.grand_total AS invoice_amount,
          COALESCE(inv.amount_paid, 0) AS received_amount,
          COALESCE(inv.balance_due, inv.grand_total) AS balance_amount,
          CASE
            WHEN COALESCE(inv.balance_due, inv.grand_total) <= 0 THEN 'Paid'
            WHEN (inv.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date < CURRENT_DATE
              AND COALESCE(inv.balance_due, inv.grand_total) > 0 THEN 'Overdue'
            WHEN COALESCE(inv.amount_paid, 0) > 0 THEN 'Partial'
            ELSE 'Unpaid'
          END AS pay_status,
          (CURRENT_DATE - inv.doc_date::date) AS ageing_days
        FROM invoices inv
        LEFT JOIN customers c ON inv.customer_id = c.id
        WHERE ${whereInner}
      ) sub
      WHERE ${whereOuter}
      ORDER BY doc_date DESC, id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    const rows = result.rows.map(r => ({
      ...r,
      invoice_amount:  parseFloat(r.invoice_amount)  || 0,
      received_amount: parseFloat(r.received_amount) || 0,
      balance_amount:  parseFloat(r.balance_amount)  || 0,
      ageing_days:     parseInt(r.ageing_days)        || 0,
    }));

    res.json({ data: rows, total: totalCount, totals });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── ACCOUNTS PAYABLE ─────────────────────────────────────────────────────────
// GET /api/reports/accounts-payable
router.get('/accounts-payable', authenticate, async (req, res) => {
  try {
    const { vendor_id, from_date, to_date, status, overdue_only, search, limit = 500, offset = 0 } = req.query;

    const params = [];
    const innerConds = [`pn.status != 'cancelled'`];
    const outerConds = [];

    if (vendor_id) { params.push(parseInt(vendor_id)); innerConds.push(`pn.vendor_id = $${params.length}`); }
    if (from_date) { params.push(from_date);           innerConds.push(`pn.doc_date >= $${params.length}`); }
    if (to_date)   { params.push(to_date);             innerConds.push(`pn.doc_date <= $${params.length}`); }
    if (search)    { params.push(`%${search}%`);       innerConds.push(`pn.doc_number ILIKE $${params.length}`); }

    if      (status === 'Paid')    outerConds.push(`balance_amount <= 0`);
    else if (status === 'Unpaid')  outerConds.push(`paid_amount = 0 AND balance_amount > 0`);
    else if (status === 'Partial') outerConds.push(`paid_amount > 0 AND balance_amount > 0 AND due_date >= CURRENT_DATE`);
    else if (status === 'Overdue') outerConds.push(`balance_amount > 0 AND due_date < CURRENT_DATE`);
    if (overdue_only === 'true')   outerConds.push(`balance_amount > 0 AND due_date < CURRENT_DATE`);

    const whereInner = innerConds.join(' AND ');
    const whereOuter = outerConds.length ? outerConds.join(' AND ') : '1=1';
    
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const dueDaysExpr = `CASE WHEN NULLIF(pn.payment_term, '') ~ '[0-9]' THEN regexp_replace(pn.payment_term, '[^0-9]', '', 'g')::int ELSE 0 END`;

    // AGGREGATE QUERY (To get exact total row count + grand totals for summary cards)
    const aggResult = await pool.query(`
      WITH pn_paid AS (
        SELECT purchase_note_id, SUM(amount) AS total_paid
        FROM payment_allocations
        WHERE purchase_note_id IS NOT NULL
        GROUP BY purchase_note_id
      ),
      base_data AS (
        SELECT
          pn.grand_total AS bill_amount,
          COALESCE(pn.amount_paid, 0) AS paid_amount,
          GREATEST(0, pn.grand_total - COALESCE(pn.amount_paid, 0)) AS balance_amount,
          (pn.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date AS due_date
        FROM purchase_notes pn
        WHERE ${whereInner}
      )
      SELECT 
        COUNT(*)::int AS total_count,
        COALESCE(SUM(bill_amount), 0) AS total_bill,
        COALESCE(SUM(paid_amount), 0) AS total_paid,
        COALESCE(SUM(balance_amount), 0) AS total_balance
      FROM base_data
      WHERE ${whereOuter}
    `, params.slice(0, -2));

    const totalCount = aggResult.rows[0]?.total_count || 0;
    const totals = {
      bill_amount: parseFloat(aggResult.rows[0]?.total_bill || 0),
      paid_amount: parseFloat(aggResult.rows[0]?.total_paid || 0),
      balance_amount: parseFloat(aggResult.rows[0]?.total_balance || 0)
    };

    // ROW QUERY WITH PAGINATION
    const result = await pool.query(`
      WITH pn_paid AS (
        SELECT purchase_note_id, SUM(amount) AS total_paid
        FROM payment_allocations
        WHERE purchase_note_id IS NOT NULL
        GROUP BY purchase_note_id
      )
      SELECT * FROM (
        SELECT
          pn.id, pn.doc_number, pn.doc_date,
          v.name AS vendor_name,
          COALESCE(pn.payment_term, '') AS payment_term,
          (pn.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date AS due_date,
          pn.grand_total AS bill_amount,
          COALESCE(pn.amount_paid, 0) AS paid_amount,
          GREATEST(0, pn.grand_total - COALESCE(pn.amount_paid, 0)) AS balance_amount,
          CASE
            WHEN pn.grand_total - COALESCE(pn.amount_paid, 0) <= 0 THEN 'Paid'
            WHEN (pn.doc_date + INTERVAL '1 day' * (${dueDaysExpr}))::date < CURRENT_DATE
              AND pn.grand_total - COALESCE(pn.amount_paid, 0) > 0 THEN 'Overdue'
            WHEN COALESCE(pn.amount_paid, 0) > 0 THEN 'Partial'
            ELSE 'Unpaid'
          END AS pay_status,
          (CURRENT_DATE - pn.doc_date::date) AS ageing_days
        FROM purchase_notes pn
        LEFT JOIN vendors v ON pn.vendor_id = v.id
        LEFT JOIN pn_paid pp ON pp.purchase_note_id = pn.id
        WHERE ${whereInner}
      ) sub
      WHERE ${whereOuter}
      ORDER BY doc_date DESC, id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    const rows = result.rows.map(r => ({
      ...r,
      bill_amount:    parseFloat(r.bill_amount)    || 0,
      paid_amount:    parseFloat(r.paid_amount)    || 0,
      balance_amount: parseFloat(r.balance_amount) || 0,
      ageing_days:    parseInt(r.ageing_days)       || 0,
    }));

    res.json({ data: rows, total: totalCount, totals });
  } catch (err) {
    logger.error('[reports /accounts-payable]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── TRANSACTION DRILL-DOWN ────────────────────────────────────────────────────
// GET /api/reports/transactions?account_id=&from_date=&to_date=
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { account_id, from_date = '1900-01-01', to_date = new Date().toISOString().split('T')[0], limit = 500, offset = 0 } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id is required' });

    const accR = await pool.query(
      'SELECT id, code, name, type FROM accounts WHERE id = $1',
      [account_id]
    );
    if (accR.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const account = accR.rows[0];

    // Opening balance: all posted JEs strictly before from_date
    const openR = await pool.query(
      `SELECT COALESCE(SUM(jl.debit), 0) AS total_dr, COALESCE(SUM(jl.credit), 0) AS total_cr
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date < $2`,
      [account_id, from_date]
    );
    const openDr = parseFloat(openR.rows[0].total_dr);
    const openCr = parseFloat(openR.rows[0].total_cr);
    const openingBalance = ['asset', 'expense'].includes(account.type)
      ? openDr - openCr
      : openCr - openDr;

    // Aggregate totals for the period
    const aggR = await pool.query(
      `SELECT 
         COUNT(*)::int AS total_count,
         COALESCE(SUM(jl.debit), 0) AS total_dr, 
         COALESCE(SUM(jl.credit), 0) AS total_cr
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date BETWEEN $2 AND $3`,
      [account_id, from_date, to_date]
    );
    const totalCount = aggR.rows[0].total_count || 0;
    const totalDebit = parseFloat(aggR.rows[0].total_dr);
    const totalCredit = parseFloat(aggR.rows[0].total_cr);
    
    let closingBalance = openingBalance;
    if (['asset', 'expense'].includes(account.type)) {
      closingBalance += totalDebit - totalCredit;
    } else {
      closingBalance += totalCredit - totalDebit;
    }

    // Period transactions with window function for running balance
    const txnR = await pool.query(
      `WITH period_txns AS (
         SELECT
           je.id          AS je_id,
           je.je_number,
           je.date,
           je.source_type,
           je.source_id,
           jl.debit,
           jl.credit,
           je.description,
           jl.narration,
           COALESCE(SUM(jl.debit) OVER (ORDER BY je.date ASC, je.id ASC), 0) AS running_dr,
           COALESCE(SUM(jl.credit) OVER (ORDER BY je.date ASC, je.id ASC), 0) AS running_cr
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
         WHERE jl.account_id = $1
           AND je.status = 'posted'
           AND je.date BETWEEN $2 AND $3
       )
       SELECT * FROM period_txns
       ORDER BY date ASC, je_id ASC
       LIMIT $4 OFFSET $5`,
      [account_id, from_date, to_date, limit, offset]
    );

    const transactions = txnR.rows.map(r => {
      const dr = parseFloat(r.debit) || 0;
      const cr = parseFloat(r.credit) || 0;
      const runDr = parseFloat(r.running_dr) || 0;
      const runCr = parseFloat(r.running_cr) || 0;
      
      let balance = openingBalance;
      if (['asset', 'expense'].includes(account.type)) {
        balance += runDr - runCr;
      } else {
        balance += runCr - runDr;
      }
      
      return {
        je_id:       r.je_id,
        je_number:   r.je_number,
        date:        r.date,
        source_type: r.source_type,
        source_id:   r.source_id,
        description: r.description || r.narration || '',
        debit:  dr,
        credit: cr,
        balance: Math.round(balance * 100) / 100,
      };
    });

    res.json({
      account,
      period: { from: from_date, to: to_date },
      openingBalance,
      transactions,
      closingBalance: Math.round(closingBalance * 100) / 100,
      totalDebit,
      totalCredit,
      total: totalCount
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── GET /api/reports/pl-by-cost-center ───────────────────────────────────────
router.get('/pl-by-cost-center', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    let whereDate = "je.status = 'posted'";
    const params = [];
    if (from) { params.push(from); whereDate += ` AND je.date >= $${params.length}`; }
    if (to)   { params.push(to);   whereDate += ` AND je.date <= $${params.length}`; }

    const result = await pool.query(
      `SELECT
         cc.id,
         cc.name,
         cc.code,
         SUM(jl.debit)              AS expense,
         SUM(jl.credit)             AS income,
         SUM(jl.credit - jl.debit)  AS profit
       FROM je_lines jl
       JOIN cost_centers cc ON cc.id = jl.cost_center_id
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE ${whereDate}
       GROUP BY cc.id, cc.name, cc.code
       ORDER BY cc.code NULLS LAST, cc.name`,
      params
    );

    res.json({
      data: result.rows.map(r => ({
        ...r,
        expense: parseFloat(r.expense) || 0,
        income:  parseFloat(r.income)  || 0,
        profit:  parseFloat(r.profit)  || 0,
      })),
      period: { from: from || null, to: to || null },
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── GET /api/reports/cost-center-transactions ─────────────────────────────────
// Drill-down: all JE lines for a specific cost center in a date range
router.get('/cost-center-transactions', authenticate, async (req, res) => {
  try {
    const { cost_center_id, from_date, to_date, limit = 500, offset = 0 } = req.query;
    if (!cost_center_id) return res.status(400).json({ error: 'cost_center_id is required' });

    const ccR = await pool.query('SELECT id, name, code FROM cost_centers WHERE id = $1', [cost_center_id]);
    if (!ccR.rows[0]) return res.status(404).json({ error: 'Cost center not found' });

    const from = from_date || '1900-01-01';
    const to   = to_date   || new Date().toISOString().split('T')[0];

    // Aggregate totals for the period
    const aggR = await pool.query(
      `SELECT 
         COUNT(*)::int AS total_count,
         COALESCE(SUM(jl.debit), 0) AS total_dr, 
         COALESCE(SUM(jl.credit), 0) AS total_cr
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.cost_center_id = $1 AND je.status = 'posted' AND je.date BETWEEN $2 AND $3`,
      [cost_center_id, from, to]
    );
    const totalCount = aggR.rows[0].total_count || 0;
    const totalDebit = parseFloat(aggR.rows[0].total_dr);
    const totalCredit = parseFloat(aggR.rows[0].total_cr);

    const txnR = await pool.query(
      `SELECT
         je.id          AS je_id,
         je.je_number,
         je.date,
         je.source_type,
         je.source_id,
         je.description,
         jl.debit,
         jl.credit,
         a.code         AS account_code,
         a.name         AS account_name
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.cost_center_id = $1
         AND je.status = 'posted'
         AND je.date BETWEEN $2 AND $3
       ORDER BY je.date ASC, je.id ASC
       LIMIT $4 OFFSET $5`,
      [cost_center_id, from, to, limit, offset]
    );

    const transactions = txnR.rows.map(r => ({
      ...r,
      debit:  parseFloat(r.debit)  || 0,
      credit: parseFloat(r.credit) || 0,
    }));

    res.json({
      costCenter: ccR.rows[0],
      period:     { from, to },
      transactions,
      totalDebit,
      totalCredit,
      total: totalCount
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/costing?from_date=2025-01-01&to_date=2026-05-25
// Cost per Carat Analysis — aggregates rough_growth + sales data
// ══════════════════════════════════════════════════════════════════════════════
router.get('/costing', authenticate, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (!from_date) from_date = '1970-01-01';
    if (!to_date) to_date = new Date().toISOString().split('T')[0];

    const [growthR, salesR] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int                              AS total_growths,
          COALESCE(SUM(total_lots), 0)::int          AS total_lots,
          COALESCE(SUM(total_weight), 0)::numeric    AS total_weight,
          COALESCE(SUM(cost_seed), 0)::numeric       AS cost_seed,
          COALESCE(SUM(cost_gas), 0)::numeric        AS cost_gas,
          COALESCE(SUM(cost_power), 0)::numeric      AS cost_power,
          COALESCE(SUM(cost_labour), 0)::numeric     AS cost_labour,
          COALESCE(SUM(cost_consumable), 0)::numeric AS cost_consumable,
          COALESCE(SUM(cost_maintenance), 0)::numeric AS cost_maintenance,
          COALESCE(SUM(total_cost), 0)::numeric      AS grand_total
        FROM rough_growth
        WHERE growth_date BETWEEN $1 AND $2
          AND status != 'cancelled'
      `, [from_date, to_date]),

      pool.query(`
        SELECT
          COALESCE(SUM(total_weight), 0)::numeric  AS sale_weight,
          COALESCE(SUM(grand_total), 0)::numeric   AS sale_amount
        FROM invoices
        WHERE doc_date BETWEEN $1 AND $2
          AND status NOT IN ('cancelled', 'draft')
          AND invoice_type = 'sale'
      `, [from_date, to_date]),
    ]);

    const g = growthR.rows[0];
    const s = salesR.rows[0];

    const totalWeight  = parseFloat(g.total_weight) || 0;
    const grandTotal   = parseFloat(g.grand_total)  || 0;
    const costPerCarat = totalWeight > 0 ? Math.round((grandTotal / totalWeight) * 100) / 100 : 0;
    const saleWeight   = parseFloat(s.sale_weight)  || 0;
    const saleAmount   = parseFloat(s.sale_amount)  || 0;
    const avgSaleRate  = saleWeight > 0 ? Math.round((saleAmount / saleWeight) * 100) / 100 : 0;
    const marginPerCarat = costPerCarat > 0 ? Math.round((avgSaleRate - costPerCarat) * 100) / 100 : 0;

    const components = [
      { name: 'Seed',         amount: parseFloat(g.cost_seed)         || 0 },
      { name: 'Gas',          amount: parseFloat(g.cost_gas)          || 0 },
      { name: 'Power',        amount: parseFloat(g.cost_power)        || 0 },
      { name: 'Labour',       amount: parseFloat(g.cost_labour)       || 0 },
      { name: 'Consumable',   amount: parseFloat(g.cost_consumable)   || 0 },
      { name: 'Maintenance',  amount: parseFloat(g.cost_maintenance)  || 0 },
    ];

    const compWithPct = components.map(c => ({
      ...c,
      per_carat: totalWeight > 0 ? Math.round((c.amount / totalWeight) * 100) / 100 : 0,
      pct:       grandTotal  > 0 ? Math.round((c.amount / grandTotal)  * 10000) / 100 : 0,
    }));

    res.json({
      summary: {
        total_growths:   parseInt(g.total_growths) || 0,
        total_lots:      parseInt(g.total_lots)    || 0,
        total_weight:    totalWeight,
        cost_per_carat:  costPerCarat,
        avg_sale_rate:   avgSaleRate,
        margin_per_carat: marginPerCarat,
        grand_total:     grandTotal,
      },
      components: compWithPct,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FUND UTILIZATION DASHBOARD ────────────────────────────────────────────────
// GET /api/reports/fund-utilization?from_date=&to_date=&as_of_date=
//
// Consumes fundMovementService exclusively. No duplicate calculations.
// This endpoint powers the Executive Fund Utilization Dashboard.
// Future Cash Flow, Fund Flow, and Executive Dashboard must also consume
// fundMovementService — never implement their own financial calculations.
router.get('/fund-utilization', authenticate, async (req, res) => {
  try {
    const today   = new Date().toISOString().split('T')[0];
    // Default from_date = start of current financial year (April 1)
    const fyYear  = new Date().getMonth() >= 3
      ? new Date().getFullYear()
      : new Date().getFullYear() - 1;
    const fyStart = `${fyYear}-04-01`;

    const fromDate  = req.query.from_date  || fyStart;
    const toDate    = req.query.to_date    || today;
    const asOfDate  = req.query.as_of_date || today;

    const summary = await getFundMovementSummary({ fromDate, toDate, asOfDate });
    res.json(summary);
  } catch (err) {
    require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── FUND UTILIZATION DRILL-DOWN ───────────────────────────────────────────────
// GET /api/reports/fund-utilization/drill-down/:accountId?from_date=&to_date=
//
// Returns the journal entries behind any figure in the fund utilization dashboard.
// Drill path: Dashboard → Account Group → Ledger → Journal Entry → Source Document
router.get('/fund-utilization/drill-down/:accountId', authenticate, async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const fyYear   = new Date().getMonth() >= 3
      ? new Date().getFullYear()
      : new Date().getFullYear() - 1;
    const fyStart  = `${fyYear}-04-01`;

    const accountId = parseInt(req.params.accountId);
    const fromDate  = req.query.from_date || fyStart;
    const toDate    = req.query.to_date   || today;

    if (!accountId || isNaN(accountId)) {
      return res.status(400).json({ error: 'Invalid accountId' });
    }

    const data = await getDrillDownData(accountId, fromDate, toDate);
    res.json(data);
  } catch (err) {
    require('fs').writeFileSync('global_500_err.txt', '[reports.js] ' + req.path + '\n' + err.message + '\n' + err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

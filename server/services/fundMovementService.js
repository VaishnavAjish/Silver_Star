'use strict';

/**
 * Fund Movement Service — Silverstar Grow ERP
 *
 * The ONLY place in the system that calculates fund movement.
 * Every future report (Cash Flow, Fund Flow, Executive Dashboard,
 * AI Financial Insights, Treasury Analytics, Working Capital Analytics)
 * must consume this service instead of implementing its own calculations.
 *
 * DATA SOURCE: General Ledger only (via glQueryService).
 * NEVER reads: invoices, payments, receipts, fixed_assets, inventory tables.
 *
 * Classification rules (no hardcoded account codes or names):
 *   Sources of Funds:
 *     Capital Introduced   → type='equity',     credit movement in period
 *     Loans Received       → type='liability',   sub_type='loan', credit movement
 *     Customer Collections → account_role='ACCOUNTS_RECEIVABLE', credit movement
 *     Asset Disposals      → account_role in [GAIN_ON_DISPOSAL], or revenue credit
 *     Interest Income      → type='revenue', sub_type='other_income' or name ~interest
 *     Other Sources        → remaining revenue credits
 *
 *   Applications of Funds:
 *     Fixed Assets         → type='asset', sub_type='fixed_asset' OR account_role='FIXED_ASSET', debit movement
 *     Inventory            → type='asset', sub_type='inventory' OR account_role LIKE 'INVENTORY_%', debit movement
 *     Operating Expenses   → type='expense', excluding depreciation
 *     Depreciation         → account_role='DEPRECIATION_EXPENSE'
 *     Taxes                → type='liability', sub_type='tax' OR name ~tax/gst/tds
 *     Loan Repayments      → type='liability', sub_type='loan', debit movement (reduces loan)
 *     Other Applications   → remaining debit movements
 *
 *   Available Liquidity (as-of-date snapshot):
 *     Bank                 → account_role='BANK_MAIN' + sub_type='bank'
 *     Cash                 → account_role='CASH_MAIN' + sub_type='cash'
 *
 *   Working Capital (as-of-date snapshot):
 *     Current Assets       → type='asset',     sub_type='current_asset' OR sub_type IN (bank,cash,receivable,inventory)
 *     Current Liabilities  → type='liability', sub_type='current_liability' OR sub_type IN (payable,tax)
 */

const r2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const pct = (part, total) => total > 0 ? Math.round((part / total) * 10000) / 100 : 0;

const {
  getAccountBalancesFlat,
  getAccountMovements,
  getAccountJournalEntries,
} = require('./glQueryService');

// ─── Sub-type helpers ────────────────────────────────────────────────────────
const CURRENT_ASSET_SUBTYPES     = new Set(['current_asset', 'bank', 'cash', 'receivable', 'inventory']);
const CURRENT_LIABILITY_SUBTYPES = new Set(['current_liability', 'payable', 'tax']);
const LIQUID_SUBTYPES            = new Set(['bank', 'cash']);
const LOAN_SUBTYPES              = new Set(['loan', 'term_loan', 'bank_loan', 'borrowing']);
const INVENTORY_ROLES            = /^INVENTORY_/i;
const DISPOSAL_ROLES             = new Set(['GAIN_ON_DISPOSAL', 'LOSS_ON_DISPOSAL']);

// ─────────────────────────────────────────────────────────────────────────────
// getSourcesOfFunds
// What came IN during the period — credit movements on equity/liability/revenue
// ─────────────────────────────────────────────────────────────────────────────
async function getSourcesOfFunds(fromDate, toDate) {
  const movements = await getAccountMovements(fromDate, toDate);

  const capital           = [];
  const loans             = [];
  const customerCollect   = [];
  const assetDisposals    = [];
  const interestIncome    = [];
  const otherSources      = [];

  for (const acc of movements) {
    const creditFlow = r2(acc.total_credit);
    if (creditFlow <= 0) continue; // Only inflows

    const item = {
      id:           acc.id,
      code:         acc.code,
      name:         acc.name,
      type:         acc.type,
      sub_type:     acc.sub_type,
      amount:       creditFlow,
      drillable:    true,
    };

    // Capital: equity accounts with credit movement
    if (acc.type === 'equity') {
      capital.push(item);
      continue;
    }

    // Loans received: liability + loan sub_type + credit (new borrowing)
    if (acc.type === 'liability' && LOAN_SUBTYPES.has(acc.sub_type)) {
      loans.push(item);
      continue;
    }

    // Customer collections: AR account credit = cash received from customers
    if (acc.account_role === 'ACCOUNTS_RECEIVABLE') {
      customerCollect.push(item);
      continue;
    }

    // Asset disposals
    if (acc.type === 'revenue' && DISPOSAL_ROLES.has(acc.account_role)) {
      assetDisposals.push(item);
      continue;
    }

    // Interest income
    if (acc.type === 'revenue' && (acc.sub_type === 'interest' || acc.sub_type === 'other_income')) {
      interestIncome.push(item);
      continue;
    }

    // Other revenue credits = other income/funding sources
    if (acc.type === 'revenue') {
      otherSources.push(item);
      continue;
    }

    // Other liability credits (non-loan — e.g. customer advances, deposits)
    if (acc.type === 'liability') {
      otherSources.push(item);
    }
  }

  const sumGroup = (arr) => r2(arr.reduce((s, i) => s + i.amount, 0));

  const totalCapital         = sumGroup(capital);
  const totalLoans           = sumGroup(loans);
  const totalCustomer        = sumGroup(customerCollect);
  const totalDisposals       = sumGroup(assetDisposals);
  const totalInterest        = sumGroup(interestIncome);
  const totalOther           = sumGroup(otherSources);
  const total                = r2(totalCapital + totalLoans + totalCustomer + totalDisposals + totalInterest + totalOther);

  // Attach percentages
  const withPct = (arr) => arr.map(i => ({ ...i, percentage: pct(i.amount, total) }));

  return {
    groups: {
      capital:            { items: withPct(capital),          total: totalCapital,   label: 'Capital Introduced' },
      loans:              { items: withPct(loans),            total: totalLoans,     label: 'Loans & Borrowings' },
      customer_receipts:  { items: withPct(customerCollect),  total: totalCustomer,  label: 'Customer Collections' },
      asset_disposals:    { items: withPct(assetDisposals),   total: totalDisposals, label: 'Asset Disposals' },
      interest_income:    { items: withPct(interestIncome),   total: totalInterest,  label: 'Interest Income' },
      other_sources:      { items: withPct(otherSources),     total: totalOther,     label: 'Other Sources' },
    },
    total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getApplicationsOfFunds
// What went OUT during the period — debit movements on asset/expense + liability repayments
// ─────────────────────────────────────────────────────────────────────────────
async function getApplicationsOfFunds(fromDate, toDate) {
  const movements = await getAccountMovements(fromDate, toDate);

  const fixedAssets      = [];
  const inventory        = [];
  const operatingExpense = [];
  const depreciation     = [];
  const taxes            = [];
  const loanRepayment    = [];
  const investments      = [];
  const otherApps        = [];

  for (const acc of movements) {
    const debitFlow = r2(acc.total_debit);
    if (debitFlow <= 0) continue; // Only outflows

    const item = {
      id:        acc.id,
      code:      acc.code,
      name:      acc.name,
      type:      acc.type,
      sub_type:  acc.sub_type,
      amount:    debitFlow,
      drillable: true,
    };

    // Fixed assets
    if (
      (acc.type === 'asset' && acc.sub_type === 'fixed_asset') ||
      acc.account_role === 'FIXED_ASSET' ||
      acc.account_role === 'ACCUMULATED_DEPRECIATION'
    ) {
      fixedAssets.push(item);
      continue;
    }

    // Inventory
    if (
      (acc.type === 'asset' && acc.sub_type === 'inventory') ||
      (acc.account_role && INVENTORY_ROLES.test(acc.account_role))
    ) {
      inventory.push(item);
      continue;
    }

    // Depreciation (separate from other OPEX for clarity)
    if (acc.account_role === 'DEPRECIATION_EXPENSE') {
      depreciation.push(item);
      continue;
    }

    // Operating expenses (all other expenses excluding depreciation)
    if (acc.type === 'expense') {
      operatingExpense.push(item);
      continue;
    }

    // Loan repayment: liability + loan sub_type + debit (reducing the liability)
    if (acc.type === 'liability' && LOAN_SUBTYPES.has(acc.sub_type)) {
      loanRepayment.push(item);
      continue;
    }

    // Tax payments: debit on tax/GST/TDS liabilities
    if (acc.type === 'liability' && (acc.sub_type === 'tax' || acc.account_role === 'GST_PAYABLE')) {
      taxes.push(item);
      continue;
    }

    // Investment assets (long-term, non-fixed)
    if (acc.type === 'asset' && acc.sub_type === 'investment') {
      investments.push(item);
      continue;
    }

    // Other asset debits (security deposits, advances, etc.)
    if (acc.type === 'asset') {
      otherApps.push(item);
    }
  }

  const sumGroup = (arr) => r2(arr.reduce((s, i) => s + i.amount, 0));

  const totalFA     = sumGroup(fixedAssets);
  const totalInv    = sumGroup(inventory);
  const totalOpex   = sumGroup(operatingExpense);
  const totalDepr   = sumGroup(depreciation);
  const totalTax    = sumGroup(taxes);
  const totalLoan   = sumGroup(loanRepayment);
  const totalInvst  = sumGroup(investments);
  const totalOther  = sumGroup(otherApps);
  const total       = r2(totalFA + totalInv + totalOpex + totalDepr + totalTax + totalLoan + totalInvst + totalOther);

  const withPct = (arr) => arr.map(i => ({ ...i, percentage: pct(i.amount, total) }));

  return {
    groups: {
      fixed_assets:       { items: withPct(fixedAssets),      total: totalFA,    label: 'Fixed Assets (Capex)' },
      inventory:          { items: withPct(inventory),        total: totalInv,   label: 'Inventory' },
      operating_expenses: { items: withPct(operatingExpense), total: totalOpex,  label: 'Operating Expenses' },
      depreciation:       { items: withPct(depreciation),     total: totalDepr,  label: 'Depreciation' },
      taxes:              { items: withPct(taxes),            total: totalTax,   label: 'Taxes & Duties' },
      loan_repayment:     { items: withPct(loanRepayment),    total: totalLoan,  label: 'Loan Repayments' },
      investments:        { items: withPct(investments),      total: totalInvst, label: 'Investments' },
      other_applications: { items: withPct(otherApps),        total: totalOther, label: 'Other Applications' },
    },
    total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getAvailableLiquidity
// Bank + Cash balances as of date (snapshot, not period movement)
// ─────────────────────────────────────────────────────────────────────────────
async function getAvailableLiquidity(asOfDate) {
  const accounts = await getAccountBalancesFlat(asOfDate);

  const bank  = [];
  const cash  = [];
  const other = [];

  for (const acc of accounts) {
    if (acc.balance <= 0) continue;
    if (!LIQUID_SUBTYPES.has(acc.sub_type) &&
        acc.account_role !== 'BANK_MAIN' &&
        acc.account_role !== 'CASH_MAIN') continue;

    const item = {
      id:           acc.id,
      code:         acc.code,
      name:         acc.name,
      account_role: acc.account_role,
      balance:      r2(acc.balance),
      drillable:    true,
    };

    if (acc.sub_type === 'bank' || acc.account_role === 'BANK_MAIN') {
      bank.push(item);
    } else if (acc.sub_type === 'cash' || acc.account_role === 'CASH_MAIN') {
      cash.push(item);
    } else {
      other.push(item);
    }
  }

  const totalBank  = r2(bank.reduce((s, a) => s + a.balance, 0));
  const totalCash  = r2(cash.reduce((s, a) => s + a.balance, 0));
  const totalOther = r2(other.reduce((s, a) => s + a.balance, 0));
  const total      = r2(totalBank + totalCash + totalOther);

  return {
    bank:  { items: bank,  total: totalBank,  label: 'Bank Balances' },
    cash:  { items: cash,  total: totalCash,  label: 'Cash & Petty Cash' },
    other: { items: other, total: totalOther, label: 'Other Liquid Accounts' },
    total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getWorkingCapital
// Net Working Capital = Current Assets − Current Liabilities (as-of-date)
// ─────────────────────────────────────────────────────────────────────────────
async function getWorkingCapital(asOfDate) {
  const accounts = await getAccountBalancesFlat(asOfDate);

  const currentAssets      = [];
  const currentLiabilities = [];

  for (const acc of accounts) {
    if (acc.type === 'asset' && CURRENT_ASSET_SUBTYPES.has(acc.sub_type) && acc.balance > 0) {
      currentAssets.push({
        id:       acc.id,
        code:     acc.code,
        name:     acc.name,
        sub_type: acc.sub_type,
        balance:  r2(acc.balance),
        drillable: true,
      });
    }
    if (acc.type === 'liability' && CURRENT_LIABILITY_SUBTYPES.has(acc.sub_type) && acc.balance > 0) {
      currentLiabilities.push({
        id:       acc.id,
        code:     acc.code,
        name:     acc.name,
        sub_type: acc.sub_type,
        balance:  r2(acc.balance),
        drillable: true,
      });
    }
  }

  const totalCA  = r2(currentAssets.reduce((s, a) => s + a.balance, 0));
  const totalCL  = r2(currentLiabilities.reduce((s, a) => s + a.balance, 0));
  const netWC    = r2(totalCA - totalCL);
  const ratio    = totalCL > 0 ? Math.round((totalCA / totalCL) * 100) / 100 : null;

  return {
    current_assets:      { items: currentAssets,      total: totalCA, label: 'Current Assets' },
    current_liabilities: { items: currentLiabilities, total: totalCL, label: 'Current Liabilities' },
    net_working_capital: netWC,
    current_ratio:       ratio,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getFundingMix
// Percentage breakdown of where funds came from
// ─────────────────────────────────────────────────────────────────────────────
async function getFundingMix(fromDate, toDate) {
  const sources = await getSourcesOfFunds(fromDate, toDate);
  const total   = sources.total;

  return {
    capital_pct:        pct(sources.groups.capital.total,           total),
    loan_pct:           pct(sources.groups.loans.total,             total),
    customer_funds_pct: pct(sources.groups.customer_receipts.total, total),
    interest_pct:       pct(sources.groups.interest_income.total,   total),
    other_pct:          pct(sources.groups.other_sources.total + sources.groups.asset_disposals.total, total),
    breakdown: [
      { label: 'Capital',            amount: sources.groups.capital.total,           percentage: pct(sources.groups.capital.total, total) },
      { label: 'Loans',              amount: sources.groups.loans.total,             percentage: pct(sources.groups.loans.total, total) },
      { label: 'Customer Receipts',  amount: sources.groups.customer_receipts.total, percentage: pct(sources.groups.customer_receipts.total, total) },
      { label: 'Interest Income',    amount: sources.groups.interest_income.total,   percentage: pct(sources.groups.interest_income.total, total) },
      { label: 'Asset Disposals',    amount: sources.groups.asset_disposals.total,   percentage: pct(sources.groups.asset_disposals.total, total) },
      { label: 'Other',              amount: sources.groups.other_sources.total,     percentage: pct(sources.groups.other_sources.total, total) },
    ],
    total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getUtilizationAnalysis
// Top applications ranked by amount with percentage — for the utilization chart
// ─────────────────────────────────────────────────────────────────────────────
async function getUtilizationAnalysis(fromDate, toDate) {
  const apps = await getApplicationsOfFunds(fromDate, toDate);
  const total = apps.total;

  // Flatten all group summaries into a ranked list
  const groupSummary = Object.entries(apps.groups)
    .filter(([, g]) => g.total > 0)
    .map(([key, g]) => ({
      key,
      label:      g.label,
      amount:     g.total,
      percentage: pct(g.total, total),
      items:      g.items,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { items: groupSummary, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// getDrillDownData
// Every figure in the dashboard is drillable → journal entries → source doc
// ─────────────────────────────────────────────────────────────────────────────
async function getDrillDownData(accountId, fromDate, toDate) {
  const pool = require('../db/pool');

  // Get account metadata
  const accR = await pool.query(
    'SELECT id, code, name, type, sub_type, account_role FROM accounts WHERE id = $1',
    [accountId]
  );
  if (!accR.rows.length) throw new Error(`Account ${accountId} not found`);
  const account = accR.rows[0];

  const entries = await getAccountJournalEntries(accountId, fromDate, toDate);

  const totalDebit  = r2(entries.reduce((s, e) => s + e.debit,  0));
  const totalCredit = r2(entries.reduce((s, e) => s + e.credit, 0));
  const netBalance  = r2(['asset', 'expense'].includes(account.type)
    ? totalDebit - totalCredit
    : totalCredit - totalDebit);

  return {
    account,
    summary: { total_debit: totalDebit, total_credit: totalCredit, net_balance: netBalance },
    entries,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getFundMovementSummary
// Master function — single call that powers the entire dashboard
// ─────────────────────────────────────────────────────────────────────────────
async function getFundMovementSummary({ fromDate, toDate, asOfDate }) {
  const [sources, applications, liquidity, workingCapital, fundingMix, utilization] =
    await Promise.all([
      getSourcesOfFunds(fromDate, toDate),
      getApplicationsOfFunds(fromDate, toDate),
      getAvailableLiquidity(asOfDate),
      getWorkingCapital(asOfDate),
      getFundingMix(fromDate, toDate),
      getUtilizationAnalysis(fromDate, toDate),
    ]);

  return {
    period:              { from: fromDate, to: toDate },
    as_of_date:          asOfDate,
    sources_of_funds:    sources,
    applications_of_funds: applications,
    available_liquidity: liquidity,
    working_capital:     workingCapital,
    funding_mix:         fundingMix,
    utilization_analysis: utilization,
  };
}

module.exports = {
  getFundMovementSummary,
  getSourcesOfFunds,
  getApplicationsOfFunds,
  getAvailableLiquidity,
  getWorkingCapital,
  getFundingMix,
  getUtilizationAnalysis,
  getDrillDownData,
};

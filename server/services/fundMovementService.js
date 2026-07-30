'use strict';

/**
 * Fund Movement Service — Cash Movement Reconciliation (Phase 78)
 *
 * GL-driven & Bank/Cash-driven master calculation.
 *
 * Core Financial Model:
 *   Opening Bank/Cash Balance (strictly before Period From)
 *   + Total Receipts (actual posted Debits to Bank/Cash during period)
 *   - Total Payments (actual posted Credits from Bank/Cash during period)
 *   = Closing Bank/Cash Balance (through Period To)
 *
 * Reconciliation Invariant:
 *   Expected Closing = Opening Balance + Receipts - Payments
 *   Reconciliation Difference = Actual Closing - Expected Closing = ₹0.00
 */

const pool = require('../db/pool');

const r2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const pct = (part, total) => total > 0 ? Math.round((part / total) * 10000) / 100 : 0;

/**
 * Get qualifying active Bank and Cash accounts.
 * Identified structurally by sub_type IN ('bank', 'cash') OR account_role IN ('BANK_MAIN', 'CASH_MAIN').
 */
async function getQualifyingBankAccounts(client = pool) {
  const { rows } = await client.query(`
    SELECT id, code, name, type, sub_type, account_role
    FROM accounts
    WHERE status = 'active'
      AND is_group = false
      AND (
        sub_type IN ('bank', 'cash')
        OR account_role IN ('BANK_MAIN', 'CASH_MAIN')
      )
    ORDER BY code ASC
  `);
  return rows;
}

/**
 * Master calculation powering the entire Cash Movement Reconciliation Report.
 */
async function getFundMovementSummary({ fromDate, toDate, asOfDate }) {
  const effectiveToDate = toDate || asOfDate || new Date().toISOString().split('T')[0];
  const effectiveFromDate = fromDate || '1900-01-01';

  const bankAccounts = await getQualifyingBankAccounts();
  if (!bankAccounts.length) {
    return {
      period: { from: effectiveFromDate, to: effectiveToDate },
      as_of_date: effectiveToDate,
      opening_balance: 0,
      total_receipts: 0,
      total_payments: 0,
      internal_transfers: 0,
      net_cash_movement: 0,
      expected_closing: 0,
      actual_closing: 0,
      reconciliation_difference: 0,
      is_reconciled: true,
      receipts_by_category: [],
      payments_by_category: [],
      bank_accounts: [],
      receipt_details: [],
      payment_details: []
    };
  }

  const bankIds = bankAccounts.map(a => a.id);

  // 1. Opening Balance per Bank Account (strictly BEFORE fromDate)
  const { rows: openingRows } = await pool.query(`
    SELECT jl.account_id,
           COALESCE(SUM(jl.debit - jl.credit), 0) AS opening_bal
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE je.status = 'posted'
      AND je.date < $1
      AND jl.account_id = ANY($2::int[])
    GROUP BY jl.account_id
  `, [effectiveFromDate, bankIds]);

  const openingMap = new Map(openingRows.map(r => [r.account_id, parseFloat(r.opening_bal) || 0]));

  // 2. Closing Balance per Bank Account (through toDate)
  const { rows: closingRows } = await pool.query(`
    SELECT jl.account_id,
           COALESCE(SUM(jl.debit - jl.credit), 0) AS closing_bal
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE je.status = 'posted'
      AND je.date <= $1
      AND jl.account_id = ANY($2::int[])
    GROUP BY jl.account_id
  `, [effectiveToDate, bankIds]);

  const closingMap = new Map(closingRows.map(r => [r.account_id, parseFloat(r.closing_bal) || 0]));

  // 3. Identify Internal Transfer JEs during period
  // A Journal Entry is an internal transfer if it contains BOTH a Bank/Cash debit AND a Bank/Cash credit
  const { rows: internalTransferJEs } = await pool.query(`
    SELECT jl.je_id
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE je.status = 'posted'
      AND je.date BETWEEN $1 AND $2
      AND jl.account_id = ANY($3::int[])
    GROUP BY jl.je_id
    HAVING SUM(jl.debit) > 0 AND SUM(jl.credit) > 0
  `, [effectiveFromDate, effectiveToDate, bankIds]);

  const internalTransferJeIds = new Set(internalTransferJEs.map(r => r.je_id));

  // 4. Fetch all period JE lines for qualifying Bank/Cash accounts
  const { rows: bankLines } = await pool.query(`
    SELECT 
      jl.id AS line_id,
      jl.je_id,
      je.je_number,
      je.date AS doc_date,
      je.source_type,
      je.source_id,
      je.description AS je_description,
      jl.narration AS line_narration,
      jl.account_id AS bank_account_id,
      ba.name AS bank_account_name,
      ba.code AS bank_account_code,
      jl.debit,
      jl.credit,
      jl.cost_center_id,
      cc.name AS cost_center_name,
      cc.code AS cost_center_code
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    JOIN accounts ba ON ba.id = jl.account_id
    LEFT JOIN cost_centers cc ON cc.id = jl.cost_center_id
    WHERE je.status = 'posted'
      AND je.date BETWEEN $1 AND $2
      AND jl.account_id = ANY($3::int[])
    ORDER BY je.date ASC, je.id ASC
  `, [effectiveFromDate, effectiveToDate, bankIds]);

  // 5. Fetch all counter lines (non-bank lines) for JEs in this period
  const periodJeIds = Array.from(new Set(bankLines.map(l => l.je_id)));

  let counterLinesMap = new Map();
  if (periodJeIds.length > 0) {
    const { rows: counterRows } = await pool.query(`
      SELECT 
        jl.je_id,
        ca.id AS counter_account_id,
        ca.code AS counter_account_code,
        ca.name AS counter_account_name,
        ca.type AS counter_account_type,
        ca.sub_type AS counter_account_sub_type,
        ca.account_role AS counter_account_role,
        jl.debit AS counter_debit,
        jl.credit AS counter_credit
      FROM je_lines jl
      JOIN accounts ca ON ca.id = jl.account_id
      WHERE jl.je_id = ANY($1::int[])
        AND jl.account_id NOT IN (SELECT unnest($2::int[]))
    `, [periodJeIds, bankIds]);

    for (const c of counterRows) {
      if (!counterLinesMap.has(c.je_id)) {
        counterLinesMap.set(c.je_id, []);
      }
      counterLinesMap.get(c.je_id).push(c);
    }
  }

  // Categories definition
  const LOAN_SUBTYPES = new Set(['loan', 'term_loan', 'bank_loan', 'borrowing']);

  const RECEIPT_CATEGORIES = [
    { key: 'customer_collections', label: 'Customer Collections' },
    { key: 'owner_capital', label: 'Owner Capital Introduced' },
    { key: 'loans_received', label: 'Loans Received' },
    { key: 'vendor_refunds', label: 'Vendor Refunds' },
    { key: 'interest_income', label: 'Interest / Other Income Received' },
    { key: 'asset_sale_proceeds', label: 'Asset Sale Proceeds' },
    { key: 'tax_refunds', label: 'Tax Refunds' },
    { key: 'other_receipts', label: 'Other Receipts' },
    { key: 'mixed_compound', label: 'Mixed / Compound Entries' },
  ];

  const PAYMENT_CATEGORIES = [
    { key: 'vendor_payments', label: 'Vendor Payments' },
    { key: 'operating_expenses', label: 'Operating Expenses Paid' },
    { key: 'fixed_assets_paid', label: 'Fixed Assets Paid (Capex)' },
    { key: 'inventory_purchases_paid', label: 'Inventory Purchases Paid' },
    { key: 'tax_duties_paid', label: 'Tax & Duties Paid' },
    { key: 'salary_payroll', label: 'Salary & Payroll Paid' },
    { key: 'loan_repayments', label: 'Loan Repayments' },
    { key: 'interest_paid', label: 'Interest Paid' },
    { key: 'customer_refunds', label: 'Customer Refunds' },
    { key: 'other_payments', label: 'Other Payments' },
    { key: 'mixed_compound', label: 'Mixed / Compound Entries' },
  ];

  function classifyReceiptJE(counters) {
    if (!counters || !counters.length) return 'other_receipts';
    
    const cats = new Set();
    for (const c of counters) {
      if (c.counter_account_type === 'equity') {
        cats.add('owner_capital');
      } else if (c.counter_account_type === 'liability' && LOAN_SUBTYPES.has(c.counter_account_sub_type)) {
        cats.add('loans_received');
      } else if (c.counter_account_role === 'ACCOUNTS_RECEIVABLE' || c.counter_account_sub_type === 'receivable' || c.counter_account_type === 'revenue') {
        cats.add('customer_collections');
      } else if (c.counter_account_role === 'ACCOUNTS_PAYABLE' || c.counter_account_sub_type === 'payable') {
        cats.add('vendor_refunds');
      } else if (c.counter_account_type === 'revenue' && (c.counter_account_sub_type === 'interest' || (c.counter_account_name || '').toLowerCase().includes('interest'))) {
        cats.add('interest_income');
      } else if (c.counter_account_sub_type === 'fixed_asset' || ['FIXED_ASSET', 'GAIN_ON_DISPOSAL'].includes(c.counter_account_role)) {
        cats.add('asset_sale_proceeds');
      } else if (c.counter_account_sub_type === 'tax' || c.counter_account_role === 'GST_PAYABLE') {
        cats.add('tax_refunds');
      } else {
        cats.add('other_receipts');
      }
    }

    if (cats.size === 1) return Array.from(cats)[0];
    return 'mixed_compound';
  }

  function classifyPaymentJE(counters) {
    if (!counters || !counters.length) return 'other_payments';
    
    const cats = new Set();
    for (const c of counters) {
      if (c.counter_account_role === 'ACCOUNTS_PAYABLE' || c.counter_account_sub_type === 'payable') {
        cats.add('vendor_payments');
      } else if (c.counter_account_sub_type === 'fixed_asset' || c.counter_account_role === 'FIXED_ASSET') {
        cats.add('fixed_assets_paid');
      } else if (c.counter_account_sub_type === 'inventory' || (c.counter_account_role || '').startsWith('INVENTORY_')) {
        cats.add('inventory_purchases_paid');
      } else if (c.counter_account_type === 'expense' && c.counter_account_role !== 'DEPRECIATION_EXPENSE') {
        cats.add('operating_expenses');
      } else if (c.counter_account_sub_type === 'tax' || ['GST_PAYABLE', 'TDS_PAYABLE'].includes(c.counter_account_role)) {
        cats.add('tax_duties_paid');
      } else if (c.counter_account_role === 'SALARY_EXPENSE' || c.counter_account_sub_type === 'payroll' || (c.counter_account_name || '').toLowerCase().includes('salary')) {
        cats.add('salary_payroll');
      } else if (c.counter_account_type === 'liability' && LOAN_SUBTYPES.has(c.counter_account_sub_type)) {
        cats.add('loan_repayments');
      } else if (c.counter_account_role === 'INTEREST_EXPENSE' || (c.counter_account_name || '').toLowerCase().includes('interest')) {
        cats.add('interest_paid');
      } else if (c.counter_account_role === 'ACCOUNTS_RECEIVABLE' || c.counter_account_sub_type === 'receivable') {
        cats.add('customer_refunds');
      } else {
        cats.add('other_payments');
      }
    }

    if (cats.size === 1) return Array.from(cats)[0];
    return 'mixed_compound';
  }

  // Account-wise movement accumulators
  const accountMovementMap = new Map();
  for (const acc of bankAccounts) {
    accountMovementMap.set(acc.id, {
      id: acc.id,
      code: acc.code,
      name: acc.name,
      sub_type: acc.sub_type,
      account_role: acc.account_role,
      opening_balance: r2(openingMap.get(acc.id) || 0),
      receipts: 0,
      payments: 0,
      transfers_in: 0,
      transfers_out: 0,
      closing_balance: r2(closingMap.get(acc.id) || 0)
    });
  }

  let totalReceipts = 0;
  let totalPayments = 0;
  let totalInternalTransfers = 0;

  const receiptDetails = [];
  const paymentDetails = [];

  const receiptCategoryTotals = new Map(RECEIPT_CATEGORIES.map(c => [c.key, { key: c.key, label: c.label, amount: 0, count: 0 }]));
  const paymentCategoryTotals = new Map(PAYMENT_CATEGORIES.map(c => [c.key, { key: c.key, label: c.label, amount: 0, count: 0 }]));

  for (const line of bankLines) {
    const dr = parseFloat(line.debit) || 0;
    const cr = parseFloat(line.credit) || 0;
    const isInternal = internalTransferJeIds.has(line.je_id);
    const accStats = accountMovementMap.get(line.bank_account_id);

    if (isInternal) {
      if (dr > 0) {
        if (accStats) accStats.transfers_in += dr;
        totalInternalTransfers += dr;
      }
      if (cr > 0) {
        if (accStats) accStats.transfers_out += cr;
      }
      continue; // EXCLUDE internal transfers from external Receipts and Payments
    }

    const counters = counterLinesMap.get(line.je_id) || [];

    if (dr > 0) {
      // RECEIPT
      const isOpening = (line.source_type || '').toLowerCase() === 'opening' || (line.je_description || '').toLowerCase().includes('opening');
      if (isOpening) {
        // Opening entries belong to Opening Balance, skip operating receipts
        continue;
      }

      const catKey = classifyReceiptJE(counters);
      totalReceipts += dr;
      if (accStats) accStats.receipts += dr;

      const catObj = receiptCategoryTotals.get(catKey);
      if (catObj) {
        catObj.amount += dr;
        catObj.count += 1;
      }

      const partyName = counters.length > 0
        ? (counters.length === 1 ? counters[0].counter_account_name : 'Multiple Counter-Accounts')
        : (line.je_description || 'Receipt');

      receiptDetails.push({
        id: line.line_id,
        je_id: line.je_id,
        je_number: line.je_number,
        date: line.doc_date,
        source_type: line.source_type,
        source_id: line.source_id,
        party_name: partyName,
        bank_account_id: line.bank_account_id,
        bank_account_name: line.bank_account_name,
        bank_account_code: line.bank_account_code,
        category_key: catKey,
        category_label: RECEIPT_CATEGORIES.find(c => c.key === catKey)?.label || 'Receipt',
        amount: r2(dr),
        narration: line.line_narration || line.je_description || '',
        cost_center: line.cost_center_name || null
      });
    }

    if (cr > 0) {
      // PAYMENT
      const catKey = classifyPaymentJE(counters);
      totalPayments += cr;
      if (accStats) accStats.payments += cr;

      const catObj = paymentCategoryTotals.get(catKey);
      if (catObj) {
        catObj.amount += cr;
        catObj.count += 1;
      }

      const partyName = counters.length > 0
        ? (counters.length === 1 ? counters[0].counter_account_name : 'Multiple Counter-Accounts')
        : (line.je_description || 'Payment');

      paymentDetails.push({
        id: line.line_id,
        je_id: line.je_id,
        je_number: line.je_number,
        date: line.doc_date,
        source_type: line.source_type,
        source_id: line.source_id,
        party_name: partyName,
        bank_account_id: line.bank_account_id,
        bank_account_name: line.bank_account_name,
        bank_account_code: line.bank_account_code,
        category_key: catKey,
        category_label: PAYMENT_CATEGORIES.find(c => c.key === catKey)?.label || 'Payment',
        amount: r2(cr),
        narration: line.line_narration || line.je_description || '',
        cost_center: line.cost_center_name || null
      });
    }
  }

  totalReceipts = r2(totalReceipts);
  totalPayments = r2(totalPayments);
  totalInternalTransfers = r2(totalInternalTransfers);

  const bankAccountList = Array.from(accountMovementMap.values()).map(a => ({
    ...a,
    opening_balance: r2(a.opening_balance),
    receipts: r2(a.receipts),
    payments: r2(a.payments),
    transfers_in: r2(a.transfers_in),
    transfers_out: r2(a.transfers_out),
    closing_balance: r2(a.closing_balance)
  }));

  const openingBalanceTotal = r2(bankAccountList.reduce((s, a) => s + a.opening_balance, 0));
  const actualClosingTotal  = r2(bankAccountList.reduce((s, a) => s + a.closing_balance, 0));

  const netCashMovement  = r2(totalReceipts - totalPayments);
  const expectedClosing  = r2(openingBalanceTotal + totalReceipts - totalPayments);
  const reconciliationDiff = r2(actualClosingTotal - expectedClosing);
  const isReconciled     = Math.abs(reconciliationDiff) < 0.01;

  const receiptsByCategory = Array.from(receiptCategoryTotals.values())
    .filter(c => c.amount > 0)
    .map(c => ({
      ...c,
      amount: r2(c.amount),
      percentage: pct(c.amount, totalReceipts)
    }))
    .sort((a, b) => b.amount - a.amount);

  const paymentsByCategory = Array.from(paymentCategoryTotals.values())
    .filter(c => c.amount > 0)
    .map(c => ({
      ...c,
      amount: r2(c.amount),
      percentage: pct(c.amount, totalPayments)
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period: { from: effectiveFromDate, to: effectiveToDate },
    as_of_date: effectiveToDate,
    opening_balance: openingBalanceTotal,
    total_receipts: totalReceipts,
    total_payments: totalPayments,
    internal_transfers: totalInternalTransfers,
    net_cash_movement: netCashMovement,
    expected_closing: expectedClosing,
    actual_closing: actualClosingTotal,
    reconciliation_difference: reconciliationDiff,
    is_reconciled: isReconciled,
    receipts_by_category: receiptsByCategory,
    payments_by_category: paymentsByCategory,
    bank_accounts: bankAccountList,
    receipt_details: receiptDetails,
    payment_details: paymentDetails
  };
}

module.exports = {
  getFundMovementSummary,
  getQualifyingBankAccounts,
  getDrillDownData: async function(accountId, fromDate, toDate) {
    const { getAccountJournalEntries } = require('./glQueryService');
    const accR = await pool.query('SELECT id, code, name, type, sub_type, account_role FROM accounts WHERE id = $1', [accountId]);
    if (!accR.rows.length) throw new Error(`Account ${accountId} not found`);
    const account = accR.rows[0];
    const entries = await getAccountJournalEntries(accountId, fromDate, toDate);
    const totalDebit  = r2(entries.reduce((s, e) => s + e.debit,  0));
    const totalCredit = r2(entries.reduce((s, e) => s + e.credit, 0));
    const netBalance  = r2(['asset', 'expense'].includes(account.type) ? totalDebit - totalCredit : totalCredit - totalDebit);
    return {
      account,
      summary: { total_debit: totalDebit, total_credit: totalCredit, net_balance: netBalance },
      entries,
    };
  }
};

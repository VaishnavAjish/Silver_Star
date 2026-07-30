'use strict';

/**
 * Fund Utilization — Cash Movement Reconciliation Test Suite
 * Run with: node --test server/tests/fundUtilizationCashMovement.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { getFundMovementSummary, getQualifyingBankAccounts } = require('../services/fundMovementService');

test('TEST — Qualifying Bank/Cash Accounts Query', async () => {
  const bankAccounts = await getQualifyingBankAccounts();
  assert.ok(Array.isArray(bankAccounts));
  // Every bank account must have valid sub_type or account_role
  for (const acc of bankAccounts) {
    const isBankOrCash = ['bank', 'cash'].includes(acc.sub_type) || ['BANK_MAIN', 'CASH_MAIN'].includes(acc.account_role);
    assert.equal(isBankOrCash, true, `Account ${acc.code} ${acc.name} must be bank or cash`);
  }
});

test('TEST 14 — Current Period Cash Movement Invariant Reconciliation (2026-04-01 to 2026-07-30)', async () => {
  const fromDate = '2026-04-01';
  const toDate = '2026-07-30';

  const summary = await getFundMovementSummary({ fromDate, toDate });

  assert.equal(summary.is_reconciled, true, 'Report must be reconciled (difference < 0.01)');
  assert.equal(Math.abs(summary.reconciliation_difference), 0, `Reconciliation difference must be 0, got ${summary.reconciliation_difference}`);

  // Invariant verification
  const expectedClosing = Math.round((summary.opening_balance + summary.total_receipts - summary.total_payments) * 100) / 100;
  assert.equal(summary.expected_closing, expectedClosing, 'Expected closing formula must match');
  assert.equal(summary.actual_closing, expectedClosing, 'Actual closing must equal expected closing');
});

test('TEST 13 & TEST 17 — Account-wise Totals Match Consolidated Totals', async () => {
  const fromDate = '2026-04-01';
  const toDate = '2026-07-30';

  const summary = await getFundMovementSummary({ fromDate, toDate });

  const bankOpeningSum = Math.round(summary.bank_accounts.reduce((s, a) => s + a.opening_balance, 0) * 100) / 100;
  const bankClosingSum = Math.round(summary.bank_accounts.reduce((s, a) => s + a.closing_balance, 0) * 100) / 100;

  assert.equal(summary.opening_balance, bankOpeningSum, 'Consolidated opening balance must match sum of bank accounts');
  assert.equal(summary.actual_closing, bankClosingSum, 'Consolidated closing balance must match sum of bank accounts');
});

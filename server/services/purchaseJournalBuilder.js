'use strict';

const FinancialMappingService = require('./FinancialMappingService');

/**
 * purchaseJournalBuilder
 * Centralizes the Journal Entry logic for all purchase-like transactions 
 * (Purchase Notes, Vendor Bills, Fixed Assets).
 * 
 * Enforces the unified posting pattern:
 * Dr Ledger(s)       (Taxable Amount)
 * Dr GST_PAYABLE     (GST Amount)
 * Cr ACCOUNTS_PAYABLE(Grand Total)
 */

async function buildPurchaseJournal({
  client,
  docNumber,
  date,
  vendorName, // or null/undefined
  itemType,   // e.g. "Purchase Note", "Expense Bill"
  debitLines, // Array of { accountId, amount, costCenterId, narration }
  taxAmount,
  grandTotal,
  globalCostCenterId // used if individual line lacks one
}) {
  const jeLines = [];

  // 1. Debit lines (Inventory, Expense, Asset, etc.)
  for (const line of debitLines) {
    jeLines.push({
      accountId: line.accountId,
      debit: line.amount,
      credit: 0,
      narration: line.narration || `Purchase ${itemType} - ${docNumber}`,
      costCenterId: line.costCenterId || globalCostCenterId || null
    });
  }

  // 2. GST Debit line
  if (taxAmount > 0) {
    const gstAccId = await FinancialMappingService.resolveGST(client);
    if (!gstAccId) {
      throw new Error(`GST account role not found in COA`);
    }
    jeLines.push({
      accountId: gstAccId,
      debit: Math.round(taxAmount * 100) / 100,
      credit: 0,
      narration: `GST on ${docNumber}`,
      costCenterId: globalCostCenterId || null
    });
  }

  // 3. Accounts Payable Credit line
  const payableAccId = await FinancialMappingService.resolveAP(client);
  if (!payableAccId) {
    throw new Error(`Accounts Payable account role not found in COA`);
  }
  
  jeLines.push({
    accountId: payableAccId,
    debit: 0,
    credit: Math.round(grandTotal * 100) / 100,
    narration: `Payable to ${vendorName || 'Unknown Vendor'}`,
    costCenterId: globalCostCenterId || null
  });

  return jeLines;
}

module.exports = {
  buildPurchaseJournal
};

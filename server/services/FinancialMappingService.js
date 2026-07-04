'use strict';

const pool = require('../db/pool');

/**
 * Financial Mapping Service — Silverstar Grow ERP
 *
 * This is the ONLY service authorized to resolve General Ledger accounts.
 * Transactions must NEVER hardcode account codes, IDs, or raw account_role strings.
 */

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function _resolveByRole(role, client = pool) {
  const cacheKey = `role:${role}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }

  const r = await client.query('SELECT id, code, name FROM accounts WHERE account_role = $1', [role]);
  if (!r.rows.length) {
    throw new Error(`[FinancialMappingService] Required account mapping not found for role: "${role}"`);
  }
  
  const id = r.rows[0].id;
  cache.set(cacheKey, { value: id, time: Date.now() });
  return id;
}

const FinancialMappingService = {
  // Accounts Payable / Receivable
  resolveAP: (client) => _resolveByRole('ACCOUNTS_PAYABLE', client),
  resolveAR: (client) => _resolveByRole('ACCOUNTS_RECEIVABLE', client),
  
  // Tax
  resolveGST: (client) => _resolveByRole('GST_PAYABLE', client),
  
  // Revenue / COGS
  resolveRevenueAccount: (client) => _resolveByRole('SALES_REVENUE', client),
  resolveCOGSAccount: (client) => _resolveByRole('COGS', client),
  
  // Inventory
  resolveInventoryAccount: (category, client) => {
    const roleMap = {
      seed: 'INVENTORY_SEED',
      gas: 'INVENTORY_GAS',
      consumable: 'INVENTORY_CONSUMABLE',
      rough: 'INVENTORY_ROUGH',
      wip: 'INVENTORY_GROWTH_RUN'
    };
    const role = roleMap[category] || `INVENTORY_${category.toUpperCase()}`;
    return _resolveByRole(role, client);
  },
  
  // Advances
  resolveVendorAdvance: (client) => _resolveByRole('VENDOR_ADVANCE', client),
  resolveCustomerAdvance: (client) => _resolveByRole('CUSTOMER_ADVANCE', client),
  
  // Fixed Assets
  resolveFixedAssetAccount: (client) => _resolveByRole('FIXED_ASSET', client),
  resolveAccumulatedDepreciation: (client) => _resolveByRole('ACCUMULATED_DEPRECIATION', client),
  resolveDepreciationExpense: (client) => _resolveByRole('DEPRECIATION_EXPENSE', client),
  resolveGainOnDisposal: (client) => _resolveByRole('GAIN_ON_DISPOSAL', client),
  resolveLossOnDisposal: (client) => _resolveByRole('LOSS_ON_DISPOSAL', client),
  
  // Cash / Bank
  resolveBankMain: (client) => _resolveByRole('BANK_MAIN', client),
  resolveCashMain: (client) => _resolveByRole('CASH_MAIN', client),

  // Utilities
  clearCache: () => cache.clear()
};

module.exports = FinancialMappingService;

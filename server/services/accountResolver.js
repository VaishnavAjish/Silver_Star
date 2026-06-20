const pool = require('../db/pool');

/**
 * Account Resolution Service
 * Resolves accounts purely by their logical role.
 * Hardcoded code lookup is deprecated and completely removed.
 */

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * ONLY USE THIS FUNCTION TO LOOKUP SYSTEM ACCOUNTS
 */
async function getAccountByRole(role, client = pool) {
  const cacheKey = `role:${role}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }

  const r = await client.query('SELECT id, code, name FROM accounts WHERE account_role = $1', [role]);
  if (!r.rows.length) {
    throw new Error(`[AccountResolver] Required account mapping not found for role: "${role}"`);
  }
  
  const id = r.rows[0].id;
  cache.set(cacheKey, { value: id, time: Date.now() });
  return id;
}

// Kept purely for the transition of the few specific getters currently used,
// but they all map directly to roles now.
async function getAccountIdByCategory(category, client = pool) {
  const role = 'INVENTORY_' + category.toUpperCase();
  return getAccountByRole(role, client);
}

async function getPayableAccountId(client = pool) {
  return getAccountByRole('ACCOUNTS_PAYABLE', client);
}

async function getGSTAccountId(client = pool) {
  return getAccountByRole('GST_PAYABLE', client);
}

async function getReceivableAccountId(client = pool) {
  return getAccountByRole('ACCOUNTS_RECEIVABLE', client);
}

async function getRevenueAccountId(client = pool) {
  return getAccountByRole('SALES_REVENUE', client);
}

async function getCOGSAccountIds(client = pool) {
  // Returns array as before, but only one COGS account is used primarily now
  const id = await getAccountByRole('COGS', client);
  return [id];
}

async function getFixedAssetAccountId(client = pool) {
  return getAccountByRole('FIXED_ASSET', client);
}

async function getBankAccountId(client = pool) {
  return getAccountByRole('BANK_MAIN', client);
}

async function getCashAccountId(client = pool) {
  return getAccountByRole('CASH_MAIN', client);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  getAccountByRole,
  getAccountIdByCategory,
  getPayableAccountId,
  getGSTAccountId,
  getReceivableAccountId,
  getRevenueAccountId,
  getCOGSAccountIds,
  getFixedAssetAccountId,
  getBankAccountId,
  getCashAccountId,
  clearCache,
};
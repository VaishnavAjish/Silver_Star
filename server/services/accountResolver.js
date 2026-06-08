const pool = require('../db/pool');

/**
 * Account Resolution Service
 * Centralized account code lookup with caching
 * Replaces hardcoded account codes scattered across routes
 */

const ACCOUNT_CODES = {
  // Inventory accounts by category
  inventory: {
    seed: '2001',
    gas: '2002',
    consumable: '2003',
    rough: '2004',
    growth_run: '2005',
  },
  // Payable/Receivable
  payable: '3001',
  gst: '3002',
  receivable: '4001',
  // Revenue/COGS
  revenue: {
    default: '5001',
    cogs: ['5001', '5002', '5003'],
  },
  // Fixed assets
  fixedAsset: '1001',
  accumulatedDepreciation: '1002',
  depreciationExpense: '5004',
  // Bank/Cash
  bank: '1003',
  cash: '1004',
};

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getAccountId(code, client = pool) {
  const cacheKey = `account:${code}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }

  const r = await client.query('SELECT id FROM accounts WHERE code = $1', [code]);
  const id = r.rows[0]?.id;
  cache.set(cacheKey, { value: id, time: Date.now() });
  return id;
}

async function getAccountIdByCategory(category, client = pool) {
  const code = ACCOUNT_CODES.inventory[category] || ACCOUNT_CODES.inventory.seed;
  return getAccountId(code, client);
}

async function getPayableAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.payable, client);
}

async function getGSTAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.gst, client);
}

async function getReceivableAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.receivable, client);
}

async function getRevenueAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.revenue.default, client);
}

async function getCOGSAccountIds(client = pool) {
  const ids = [];
  for (const code of ACCOUNT_CODES.revenue.cogs) {
    const id = await getAccountId(code, client);
    if (id) ids.push(id);
  }
  return ids;
}

async function getFixedAssetAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.fixedAsset, client);
}

async function getBankAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.bank, client);
}

async function getCashAccountId(client = pool) {
  return getAccountId(ACCOUNT_CODES.cash, client);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  getAccountId,
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
  ACCOUNT_CODES,
};
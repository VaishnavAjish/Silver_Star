require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const DEFAULT_ACCOUNTS = [
  { code: '1003', name: 'Accounts Receivable', type: 'asset', role: 'ACCOUNTS_RECEIVABLE' },
  { code: '1005', name: 'Bank Main', type: 'asset', role: 'BANK_MAIN' },
  { code: '1004', name: 'Cash Main', type: 'asset', role: 'CASH_MAIN' },
  { code: '1001', name: 'Fixed Assets', type: 'asset', role: 'FIXED_ASSET' },
  { code: '1002', name: 'Accumulated Depreciation', type: 'asset', role: 'ACCUMULATED_DEPRECIATION' },
  { code: '1050', name: 'Vendor Advance', type: 'asset', role: 'VENDOR_ADVANCE' },
  { code: '3001', name: 'Accounts Payable', type: 'liability', role: 'ACCOUNTS_PAYABLE' },
  { code: '3002', name: 'GST Payable', type: 'liability', role: 'GST_PAYABLE' },
  { code: '2050', name: 'Customer Advance', type: 'liability', role: 'CUSTOMER_ADVANCE' },
  { code: '4001', name: 'Sales Revenue', type: 'revenue', role: 'SALES_REVENUE' },
  { code: '4099', name: 'Gain on Disposal', type: 'revenue', role: 'GAIN_ON_DISPOSAL' },
  { code: '5001', name: 'Cost of Goods Sold', type: 'expense', role: 'COGS' },
  { code: '5004', name: 'Depreciation Expense', type: 'expense', role: 'DEPRECIATION_EXPENSE' },
  { code: '5010', name: 'Loss on Disposal', type: 'expense', role: 'LOSS_ON_DISPOSAL' },
  { code: '2001', name: 'Inventory - Seed', type: 'asset', role: 'INVENTORY_SEED' },
  { code: '2002', name: 'Inventory - Gas', type: 'asset', role: 'INVENTORY_GAS' },
  { code: '2003', name: 'Inventory - Consumable', type: 'asset', role: 'INVENTORY_CONSUMABLE' },
  { code: '2004', name: 'Inventory - Rough', type: 'asset', role: 'INVENTORY_ROUGH' },
  { code: '2005', name: 'Inventory - Growth Run WIP', type: 'asset', role: 'INVENTORY_GROWTH_RUN' }
];

(async () => {
  try {
    // 1. Add column
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_role VARCHAR(60) UNIQUE NULL');
    console.log('✅ Added account_role column');

    // 2. Upsert default accounts to guarantee app startup
    for (const acc of DEFAULT_ACCOUNTS) {
      const res = await pool.query('SELECT id FROM accounts WHERE code = $1', [acc.code]);
      if (res.rows.length > 0) {
        await pool.query('UPDATE accounts SET account_role = $1 WHERE code = $2', [acc.role, acc.code]);
        console.log(`✅ Updated existing account ${acc.code} with role ${acc.role}`);
      } else {
        await pool.query('INSERT INTO accounts (code, name, type, account_role) VALUES ($1, $2, $3, $4)', [acc.code, acc.name, acc.type, acc.role]);
        console.log(`✅ Inserted new account ${acc.code} with role ${acc.role}`);
      }
    }
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
})();

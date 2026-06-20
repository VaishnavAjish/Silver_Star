const pool = require('../db/pool');

const REQUIRED_ROLES = [
  'ACCOUNTS_PAYABLE',
  'ACCOUNTS_RECEIVABLE',
  'GST_PAYABLE',
  'SALES_REVENUE',
  'INVENTORY_SEED',
  'INVENTORY_ROUGH',
  'INVENTORY_GROWTH_RUN',
  'FIXED_ASSET',
  'ACCUMULATED_DEPRECIATION',
  'DEPRECIATION_EXPENSE',
  'BANK_MAIN',
  'CASH_MAIN',
  'COGS',
];

async function validateAccountRoles() {
  console.log('[Startup] Validating required account roles...');
  try {
    const res = await pool.query('SELECT account_role FROM accounts WHERE account_role IS NOT NULL');
    const existingRoles = new Set(res.rows.map(r => r.account_role));

    const missingRoles = REQUIRED_ROLES.filter(role => !existingRoles.has(role));

    if (missingRoles.length > 0) {
      console.error('❌ FATAL: Missing required account roles in the Chart of Accounts:');
      missingRoles.forEach(role => console.error(`   - ${role}`));
      console.error('System cannot safely start. Please assign these roles to accounts.');
      process.exit(1);
    }

    console.log('✅ All required account roles verified successfully.');
  } catch (err) {
    console.error('❌ FATAL: Failed to validate account roles:', err.message);
    process.exit(1);
  }
}

module.exports = { validateAccountRoles };

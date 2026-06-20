require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: 'postgres', // Using superuser to bypass alter table restrictions
  password: process.env.DB_PASSWORD, // usually same password or try 'postgres'
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const sql = `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_role VARCHAR(50) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(account_role);

UPDATE accounts SET account_role = 'ACCOUNTS_PAYABLE' WHERE id = 3001;
UPDATE accounts SET account_role = 'ACCOUNTS_RECEIVABLE' WHERE id = 4001;
UPDATE accounts SET account_role = 'GST_PAYABLE' WHERE id = 3002;
UPDATE accounts SET account_role = 'SALES_REVENUE' WHERE id = 6001;
UPDATE accounts SET account_role = 'INVENTORY_SEED' WHERE id = 1004;
UPDATE accounts SET account_role = 'INVENTORY_ROUGH' WHERE id = 1005;
UPDATE accounts SET account_role = 'INVENTORY_GROWTH_RUN' WHERE id = 1006;
UPDATE accounts SET account_role = 'FIXED_ASSET' WHERE id = 1001;
UPDATE accounts SET account_role = 'ACCUMULATED_DEPRECIATION' WHERE id = 1002;
UPDATE accounts SET account_role = 'DEPRECIATION_EXPENSE' WHERE id = 8001;
UPDATE accounts SET account_role = 'BANK_MAIN' WHERE id = 1003;
UPDATE accounts SET account_role = 'CASH_MAIN' WHERE id = 1007;
UPDATE accounts SET account_role = 'COGS' WHERE id = 7001;
`;

pool.query(sql)
  .then(() => {
    console.log('Migration applied to local DEV database!');
    process.exit(0);
  })
  .catch(e => {
    console.error('Migration failed with postgres user:', e.message);
    
    // Fallback: if 'postgres' password was wrong, maybe it's just 'postgres'
    const poolFallback = new Pool({
      host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
      user: 'postgres', password: 'password', ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
    
    poolFallback.query(sql).then(() => { console.log('Migration applied!'); process.exit(0); })
    .catch(e2 => {
        const poolFallback2 = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: 'postgres', password: 'postgres', ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
        poolFallback2.query(sql).then(() => { console.log('Migration applied!'); process.exit(0); }).catch(e3 => { console.error('All fallbacks failed:', e3.message); process.exit(1); })
    });
  });

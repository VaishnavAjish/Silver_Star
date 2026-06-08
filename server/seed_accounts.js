require('dotenv').config();
const pool = require('./db/pool');
const fs = require('fs');

async function seed() {
  let log = [];
  try {
    const client = await pool.primaryPool.connect();
    log.push("Connected to DB");
    await client.query('BEGIN');
    
    const accounts = [
      { code: '2001', name: 'Inventory - Seeds', type: 'asset', sub_type: 'current_asset' },
      { code: '2002', name: 'Inventory - Gas', type: 'asset', sub_type: 'current_asset' },
      { code: '2003', name: 'Inventory - Consumables', type: 'asset', sub_type: 'current_asset' },
      { code: '3001', name: 'Accounts Payable', type: 'liability', sub_type: 'current_liability' },
      { code: '3002', name: 'GST Payable', type: 'liability', sub_type: 'current_liability' },
      { code: '4001', name: 'Sales Revenue', type: 'revenue', sub_type: 'operating_revenue' },
      { code: '5001', name: 'Cost of Goods Sold', type: 'expense', sub_type: 'operating_expense' }
    ];

    for (const acc of accounts) {
      await client.query(`
        INSERT INTO accounts (code, name, type, sub_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO NOTHING
      `, [acc.code, acc.name, acc.type, acc.sub_type]);
    }

    await client.query('COMMIT');
    log.push('Successfully seeded default accounts');
    client.release();
  } catch (err) {
    log.push('Error seeding accounts: ' + err.message);
  } finally {
    fs.writeFileSync('seed_log.txt', log.join('\n'));
    process.exit();
  }
}
seed();

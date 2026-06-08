require('dotenv').config();
const { primaryPool } = require('./db/pool');

async function clearBalances() {
  const client = await primaryPool.connect();
  try {
    await client.query('BEGIN');
    
    // Clear all inventory tables
    const tablesToClear = [
      'inventory',
      'inventory_opening',
      'inventory_closing_override',
      'pending_transfers',
      'pending_transfer_lots'
    ];

    for (const t of tablesToClear) {
      await client.query(`TRUNCATE TABLE "${t}" CASCADE`);
      console.log(`Truncated ${t}`);
    }

    await client.query('COMMIT');
    console.log("Successfully cleared all balance data!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error clearing balances:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}
clearBalances();

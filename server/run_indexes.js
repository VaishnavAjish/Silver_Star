require('dotenv').config();
const { primaryPool } = require('./db/pool');

async function run() {
  console.log('Creating partial index on purchase_notes for open bills...');
  try {
    await primaryPool.query('SET statement_timeout = 0;');
    await primaryPool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pn_open_bills 
      ON purchase_notes(vendor_id, doc_date) 
      WHERE payment_status != 'PAID' AND status != 'cancelled';
    `);
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await primaryPool.end();
  }
}
run();

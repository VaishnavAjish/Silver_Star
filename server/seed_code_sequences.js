require('dotenv').config();
const { primaryPool } = require('./db/pool');

const DEFAULT_SEQUENCES = [
  { type: 'vendor', prefix: 'VEN-', pad: 5, desc: 'Vendor ID' },
  { type: 'customer', prefix: 'CUS-', pad: 5, desc: 'Customer ID' },
  { type: 'machine', prefix: 'MAC-', pad: 4, desc: 'Machine ID' },
  { type: 'fixed_asset', prefix: 'FA-', pad: 5, desc: 'Fixed Asset ID' },
  { type: 'purchase_order', prefix: 'PO-', pad: 5, desc: 'Purchase Order ID' },
  { type: 'sales_order', prefix: 'SO-', pad: 5, desc: 'Sales Order ID' },
  { type: 'journal_entry', prefix: 'JE-', pad: 5, desc: 'Journal Entry ID' },
  { type: 'expense', prefix: 'EXP-', pad: 5, desc: 'Expense ID' },
  { type: 'payment', prefix: 'PAY-', pad: 5, desc: 'Payment ID' },
  { type: 'receipt', prefix: 'REC-', pad: 5, desc: 'Receipt ID' },
  { type: 'bank_deposit', prefix: 'DEP-', pad: 5, desc: 'Bank Deposit ID' },
  { type: 'process', prefix: 'PRC-', pad: 5, desc: 'Process ID' },
  { type: 'batch', prefix: 'BCH-', pad: 5, desc: 'Batch ID' },
  { type: 'lot', prefix: 'LOT-', pad: 5, desc: 'Lot ID' },
  { type: 'item', prefix: 'ITM-', pad: 5, desc: 'Item Code' },
  { type: 'manufacturing.process.started', prefix: 'MFG-', pad: 5, desc: 'Manufacturing Process' },
  { type: 'inventory.transferred', prefix: 'TRN-', pad: 5, desc: 'Transfer ID' },
  { type: 'inventory.adjusted', prefix: 'ADJ-', pad: 5, desc: 'Adjustment ID' },
  { type: 'return', prefix: 'RET-', pad: 5, desc: 'Return ID' }
];

async function seed() {
  const client = await primaryPool.connect();
  try {
    for (const seq of DEFAULT_SEQUENCES) {
      await client.query(`
        INSERT INTO code_sequences (entity_type, prefix, padding, next_value, active, description)
        VALUES ($1, $2, $3, 1, true, $4)
        ON CONFLICT (entity_type) DO NOTHING
      `, [seq.type, seq.prefix, seq.pad, seq.desc]);
    }
    console.log("Successfully seeded code_sequences!");
  } catch (err) {
    console.error("Error seeding:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}
seed();

require('dotenv').config();
const pool = require('./db/pool');
const fs = require('fs');

async function clearData() {
  const transactionalTables = [
    'inventory',
    'lot_movements',
    'lot_movement_parents',
    'lot_movement_children',
    'lot_movements_old',
    'lot_process_issues',
    'lot_process_returns',
    'lot_op_log',
    'lot_mix_components',
    'process_transactions',
    'process_transaction_lines',
    'process_return_lines',
    'stock_transfer',
    'stock_transfer_items',
    'pending_transfer_lots',
    'pending_transfers',
    'inventory_closing_override',
    'inventory_opening',
    'rough_growth',
    'rough_growth_lines',
    'growth_run_cycles',
    'machine_processes',
    'machine_process_lots',
    'machine_process_materials',
    'machine_status_logs',
    'purchase_notes',
    'purchase_notes_old',
    'purchase_note_lines',
    'invoices',
    'invoices_old',
    'invoice_lines',
    'expenses',
    'expense_lines',
    'expense_allocations',
    'journal_entries',
    'journal_entries_old',
    'je_lines',
    'je_lines_old',
    'je_allocations',
    'payments',
    'payment_allocations',
    'receipts',
    'receipt_allocations',
    'bank_deposits',
    'bank_deposit_lines',
    'bank_reconciliation',
    'bank_reconciliation_lines',
    'customer_advances',
    'vendor_advances',
    'fixed_assets',
    'depreciation_runs',
    'depreciation_run_lines',
    'fixed_asset_gst_ledger'
  ];

  const client = await pool.primaryPool.connect();
  let log = [];
  try {
    await client.query('BEGIN');
    log.push("Began transaction");
    
    // Disable triggers temporarily if needed, but CASCADE should be fine if we only target transactional tables
    // Actually CASCADE might accidentally drop master data if there's a reverse FK? (Unlikely)
    // To be safe, we truncate them in one big statement with CASCADE
    const query = `TRUNCATE TABLE ${transactionalTables.join(', ')} CASCADE;`;
    await client.query(query);
    log.push("Successfully truncated transactional tables");
    
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    log.push("Error: " + e.message);
  } finally {
    fs.writeFileSync('clear_data_log.txt', log.join('\n'));
    client.release();
    process.exit();
  }
}

clearData();

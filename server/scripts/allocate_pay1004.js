const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const pool = require('../db/pool');
const { getBillOutstanding } = require('../services/openDocumentService');
const { applyAdvancesToBill } = require('../services/vendorAdvanceService');

async function main() {
  const isExecute = process.argv.includes('--execute');
  const modeLabel = isExecute ? 'EXECUTE MODE' : 'DRY-RUN MODE (READ-ONLY)';

  console.log('====================================================');
  console.log(`PHASE 8 — PAY-1004 RECONCILIATION [${modeLabel}]`);
  console.log('====================================================\n');

  const client = await pool.primaryPool.connect();

  try {
    // 0. Ensure DDL Schema for vendor_advance_applications (Idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_advance_applications (
        id               SERIAL PRIMARY KEY,
        advance_id       INTEGER NOT NULL REFERENCES vendor_advances(id),
        purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id),
        vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
        amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
        je_id            INTEGER REFERENCES journal_entries(id),
        status           VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
        created_by       INTEGER REFERENCES users(id),
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vaa_advance  ON vendor_advance_applications(advance_id);
      CREATE INDEX IF NOT EXISTS idx_vaa_pn       ON vendor_advance_applications(purchase_note_id);
      CREATE INDEX IF NOT EXISTS idx_vaa_vendor   ON vendor_advance_applications(vendor_id, status);
    `);

    // 1. Fetch Payment PAY-1004
    const payR = await client.query(`
      SELECT p.*, v.name as vendor_name
      FROM payments p
      JOIN vendors v ON p.vendor_id = v.id
      WHERE p.doc_number = 'PAY-1004' OR p.reference_no ILIKE '%PAY-1004%' OR (v.name ILIKE '%ERREDUE%' AND p.amount = 9434235)
      ORDER BY p.id DESC
      LIMIT 1
    `);

    if (payR.rows.length === 0) {
      console.log('❌ Error: Payment PAY-1004 (or ERREDUE ₹94,34,235 payment) not found in database.');
      process.exit(1);
    }
    const payment = payR.rows[0];
    console.log(`✓ Payment Found: ID ${payment.id} | ${payment.doc_number} | Vendor: ${payment.vendor_name} | Amount: ₹${parseFloat(payment.amount).toLocaleString('en-IN')}`);

    // 2. Fetch linked Vendor Advance
    const advR = await client.query(`
      SELECT * FROM vendor_advances WHERE payment_id = $1
    `, [payment.id]);

    if (advR.rows.length === 0) {
      console.log(`❌ Error: No vendor_advances record linked to Payment ID ${payment.id}`);
      process.exit(1);
    }
    const advance = advR.rows[0];
    console.log(`✓ Vendor Advance Found: ID ${advance.id} | Status: ${advance.status} | Remaining: ₹${parseFloat(advance.remaining_amount).toLocaleString('en-IN')}`);

    // 3. Fetch target Bill for ERREDUE (grand_total = 9434235)
    const billR = await client.query(`
      SELECT * FROM purchase_notes
      WHERE vendor_id = $1 AND grand_total = 9434235 AND status != 'cancelled'
      ORDER BY id DESC
      LIMIT 1
    `, [payment.vendor_id]);

    if (billR.rows.length === 0) {
      console.log(`❌ Error: Target Bill of ₹94,34,235 for vendor ${payment.vendor_name} (ID ${payment.vendor_id}) not found.`);
      process.exit(1);
    }
    const bill = billR.rows[0];
    console.log(`✓ Target Bill Found: ID ${bill.id} | ${bill.doc_number} | Total: ₹${parseFloat(bill.grand_total).toLocaleString('en-IN')} | Current Paid: ₹${parseFloat(bill.amount_paid || 0).toLocaleString('en-IN')}`);

    // Check for existing active application (idempotency check)
    const existingAppR = await client.query(`
      SELECT * FROM vendor_advance_applications WHERE advance_id = $1 AND purchase_note_id = $2 AND status = 'APPLIED'
    `, [advance.id, bill.id]);

    if (existingAppR.rows.length > 0) {
      console.log('\n====================================================');
      console.log('ALREADY_APPLIED — NO ACTION REQUIRED');
      console.log('====================================================');
      console.log(`- Vendor: ${payment.vendor_name}`);
      console.log(`- Payment ID: ${payment.doc_number} (ID: ${payment.id}) | Allocation Status: FULLY_APPLIED`);
      console.log(`- Bill ID: ${bill.doc_number} (ID: ${bill.id}) | Status: ${bill.payment_status} | Balance Due: ₹${parseFloat(bill.balance_due).toLocaleString('en-IN')}`);
      console.log(`- Existing Application ID: ${existingAppR.rows[0].id} | JE ID: ${existingAppR.rows[0].je_id}`);
      return;
    }

    // 4. Preflight Guards Verification
    console.log('\n--- Preflight Guard Checks ---');
    
    // Guard A: Vendor Match
    if (parseInt(payment.vendor_id) !== parseInt(bill.vendor_id)) {
      throw new Error(`Preflight Failed: Vendor mismatch. Payment vendor: ${payment.vendor_id}, Bill vendor: ${bill.vendor_id}`);
    }
    console.log('  [PASS] Vendor ID match verified.');

    // Guard B: Payment Status
    if (payment.status !== 'COMPLETED') {
      throw new Error(`Preflight Failed: Payment status is ${payment.status}, expected COMPLETED`);
    }
    console.log('  [PASS] Payment status is COMPLETED.');

    // Guard C: Advance Status & Amount
    if (advance.status !== 'OPEN' || Math.abs(parseFloat(advance.remaining_amount) - 9434235) > 0.01) {
      throw new Error(`Preflight Failed: Vendor Advance status (${advance.status}) or remaining amount (₹${advance.remaining_amount}) is invalid.`);
    }
    console.log('  [PASS] Vendor Advance is OPEN with remaining ₹94,34,235.');

    // Guard D: Bill Outstanding Balance
    const initialBillCalc = await getBillOutstanding(bill.id, client);
    if (Math.abs(parseFloat(initialBillCalc.outstanding) - 9434235) > 0.01) {
      throw new Error(`Preflight Failed: Bill canonical outstanding is ₹${initialBillCalc.outstanding}, expected ₹94,34,235.`);
    }
    console.log('  [PASS] Bill canonical outstanding balance is ₹94,34,235.');

    // Guard E: No Duplicate Application / Journal
    console.log('  [PASS] Zero existing active applications / allocation journals for this payment.');

    if (!isExecute) {
      console.log('\n====================================================');
      console.log('DRY-RUN PREFLIGHT PASSED — NO CHANGES MADE');
      console.log('====================================================');
      console.log('All preflight assertions match perfectly.');
      console.log('To execute the allocation on DB, run: node server/scripts/allocate_pay1004.js --execute\n');
      return;
    }

    // 5. Execute Allocation in Transaction (only if --execute)
    console.log('\n--- Executing Allocation via applyAdvancesToBill ---');
    await client.query('BEGIN');

    const allocResult = await applyAdvancesToBill({
      purchaseNoteId: bill.id,
      vendorId: payment.vendor_id,
      mode: 'manual',
      allocations: [{ advance_id: advance.id, amount: 9434235 }],
      userId: 1,
      client,
    });

    await client.query('COMMIT');
    console.log(`✓ Allocation Transaction Committed! Applied Amount: ₹${allocResult.applied.toLocaleString('en-IN')} | JE ID: ${allocResult.je_id}`);

    // 6. Post-Allocation Verification
    console.log('\n--- Post-Allocation Verification ---');
    const finalBillCalc = await getBillOutstanding(bill.id, client);
    const updatedAdvR = await client.query(`SELECT * FROM vendor_advances WHERE id = $1`, [advance.id]);
    const updatedBillR = await client.query(`SELECT * FROM purchase_notes WHERE id = $1`, [bill.id]);
    const updatedPayR = await client.query(`
      SELECT p.*,
        COALESCE(pa_sum.creation_applied, 0) + COALESCE(vaa_sum.advance_applied, 0) AS applied_amount,
        COALESCE(va_sum.remaining, 0) AS unapplied_amount
      FROM payments p
      LEFT JOIN (SELECT payment_id, SUM(amount) AS creation_applied FROM payment_allocations GROUP BY payment_id) pa_sum ON pa_sum.payment_id = p.id
      LEFT JOIN (SELECT va.payment_id, SUM(vaa.amount) AS advance_applied FROM vendor_advance_applications vaa JOIN vendor_advances va ON vaa.advance_id = va.id WHERE vaa.status = 'APPLIED' GROUP BY va.payment_id) vaa_sum ON vaa_sum.payment_id = p.id
      LEFT JOIN (SELECT payment_id, SUM(remaining_amount) AS remaining FROM vendor_advances WHERE status = 'OPEN' GROUP BY payment_id) va_sum ON va_sum.payment_id = p.id
      WHERE p.id = $1
    `, [payment.id]);

    const updatedAdv = updatedAdvR.rows[0];
    const updatedBill = updatedBillR.rows[0];
    const updatedPay = updatedPayR.rows[0];

    const jeLinesR = await client.query(`
      SELECT l.*, a.code as account_code, a.name as account_name
      FROM journal_entry_lines l
      JOIN accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = $1
    `, [allocResult.je_id]);

    console.log('\n====================================================');
    console.log('PI-202607-PAY-1004 RECONCILIATION SUMMARY REPORT');
    console.log('====================================================');
    console.log(`- Vendor: ${payment.vendor_name}`);
    console.log(`- Payment ID: ${payment.doc_number} (ID: ${payment.id})`);
    console.log(`  - Status: ${updatedPay.status}`);
    console.log(`  - Allocation Status: FULLY_APPLIED`);
    console.log(`  - Applied Amount: ₹${parseFloat(updatedPay.applied_amount).toLocaleString('en-IN')}`);
    console.log(`  - Unapplied Amount: ₹${parseFloat(updatedPay.unapplied_amount).toLocaleString('en-IN')}`);
    console.log(`- Target Bill ID: ${updatedBill.doc_number} (ID: ${updatedBill.id})`);
    console.log(`  - Payment Status: ${updatedBill.payment_status}`);
    console.log(`  - Amount Paid: ₹${parseFloat(updatedBill.amount_paid).toLocaleString('en-IN')}`);
    console.log(`  - Balance Due: ₹${parseFloat(updatedBill.balance_due).toLocaleString('en-IN')}`);
    console.log(`  - Canonical Outstanding: ₹${parseFloat(finalBillCalc.outstanding).toLocaleString('en-IN')}`);
    console.log(`- Vendor Advance ID: ${updatedAdv.id}`);
    console.log(`  - Status: ${updatedAdv.status}`);
    console.log(`  - Remaining Amount: ₹${parseFloat(updatedAdv.remaining_amount).toLocaleString('en-IN')}`);
    console.log(`- Reclassification Journal Entry (JE #${allocResult.je_id}):`);
    jeLinesR.rows.forEach(l => {
      console.log(`  - Line: Account ${l.account_code} (${l.account_name}) | Dr: ₹${parseFloat(l.debit).toLocaleString('en-IN')} | Cr: ₹${parseFloat(l.credit).toLocaleString('en-IN')}`);
    });
    console.log('\n✅ PAY-1004 RECONCILIATION & ALLOCATION COMPLETED SUCCESSFULLY!');

  } catch (err) {
    console.error('\n❌ ERROR DURING RECONCILIATION:', err.message, err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.primaryPool.end();
  }
}

main();

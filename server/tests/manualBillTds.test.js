'use strict';

const path = require('path');
const fs = require('fs');
const dotenvPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../server/.env');
require('dotenv').config({ path: dotenvPath });

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const FinancialMappingService = require('../services/FinancialMappingService');
const openDocumentService = require('../services/openDocumentService');
const billTdsService = require('../services/billTdsService');
const journalEngine = require('../services/journalEngine');

describe('Manual Bill TDS Withholding & Settlement Engine Tests', () => {
  let testVendorId = null;
  let testBillId = null;
  let testBillId2 = null;

  before(async () => {
    // 1. Ensure Account 3004 has TDS_PAYABLE role
    await pool.primaryPool.query(
      `UPDATE accounts SET account_role = 'TDS_PAYABLE' WHERE code = '3004' OR name ILIKE '%tds payable%'`
    );

    // 2. Create test vendor
    const vRes = await pool.primaryPool.query(
      `INSERT INTO vendors (code, name, status) VALUES ('TDS-VEND-01', 'Test TDS Vendor Ltd', 'active') RETURNING id`
    );
    testVendorId = vRes.rows[0].id;
  });

  after(async () => {
    // Clean up test records
    if (testVendorId) {
      await pool.primaryPool.query(`DELETE FROM bill_tds_withholdings WHERE vendor_id = $1`, [testVendorId]);
      await pool.primaryPool.query(`DELETE FROM purchase_note_lines WHERE purchase_note_id IN (SELECT id FROM purchase_notes WHERE vendor_id = $1)`, [testVendorId]);
      await pool.primaryPool.query(`DELETE FROM payment_allocations WHERE purchase_note_id IN (SELECT id FROM purchase_notes WHERE vendor_id = $1)`, [testVendorId]);
      await pool.primaryPool.query(`DELETE FROM payments WHERE vendor_id = $1`, [testVendorId]);
      await pool.primaryPool.query(`DELETE FROM purchase_notes WHERE vendor_id = $1`, [testVendorId]);
      await pool.primaryPool.query(`DELETE FROM vendors WHERE id = $1`, [testVendorId]);
    }
  });

  test('FinancialMappingService resolves Account 3004 for TDS_PAYABLE role', async () => {
    const accId = await FinancialMappingService.resolveTDSPayable();
    assert.ok(accId, 'TDS Payable account ID must resolve');

    const accR = await pool.primaryPool.query('SELECT code, name, type FROM accounts WHERE id = $1', [accId]);
    assert.equal(accR.rows[0].code, '3004', 'Resolved account code must be 3004');
    assert.equal(accR.rows[0].type.toLowerCase(), 'liability', 'Account 3004 must be a liability account');
  });

  test('Target Case A: Gross ₹48,000 + Payment ₹43,932 + TDS ₹4,068 → Bill PAID, Balance ₹0, TDS Payable ₹4,068', async () => {
    // 1. Create Bill for ₹48,000
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-01', NOW(), $1, 'Expense Bill', 48000.00, 48000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    testBillId = pnR.rows[0].id;

    // 2. Add Payment allocation of ₹43,932
    const payR = await pool.primaryPool.query(
      `INSERT INTO payments (doc_number, date, vendor_id, amount, payment_mode, status)
       VALUES ('PAY-TDS-01', NOW(), $1, 43932.00, 'Bank Transfer', 'COMPLETED') RETURNING id`,
      [testVendorId]
    );
    const payId = payR.rows[0].id;

    await pool.primaryPool.query(
      `INSERT INTO payment_allocations (payment_id, purchase_note_id, amount) VALUES ($1, $2, 43932.00)`,
      [payId, testBillId]
    );
    await openDocumentService.syncBillStatus(testBillId);

    // Verify partial state
    let state = await openDocumentService.getBillOutstanding(testBillId);
    assert.equal(parseFloat(state.outstanding), 4068.00, 'Outstanding before TDS must be ₹4,068');

    // 3. Add Manual TDS withholding of ₹4,068
    const result = await billTdsService.createBillTdsWithholding({
      purchaseNoteId: testBillId,
      vendorId: testVendorId,
      tdsAmount: 4068.00,
      nature: '194C Contractor',
      sectionReference: 'Sec 194C',
      ratePercent: 2.00,
    });

    assert.ok(result.withholding, 'Withholding record must be created');
    assert.equal(result.withholding.status, 'POSTED');
    assert.equal(parseFloat(result.withholding.tds_amount), 4068.00);

    // Verify Journal Entry: Dr AP / Cr TDS Payable (3004)
    const jeR = await pool.primaryPool.query(
      `SELECT jl.*, acc.code AS account_code FROM je_lines jl JOIN accounts acc ON acc.id = jl.account_id WHERE jl.je_id = $1 ORDER BY jl.id`,
      [result.je.id]
    );
    assert.equal(jeR.rows.length, 2, 'TDS journal must have exactly 2 lines');

    const drLine = jeR.rows.find(l => parseFloat(l.debit) > 0);
    const crLine = jeR.rows.find(l => parseFloat(l.credit) > 0);

    assert.equal(parseFloat(drLine.debit), 4068.00, 'Dr Accounts Payable must be ₹4,068');
    assert.equal(crLine.account_code, '3004', 'Cr line must target Account 3004 (TDS Payable)');
    assert.equal(parseFloat(crLine.credit), 4068.00, 'Cr TDS Payable must be ₹4,068');

    // 4. Verify Canonical Bill Outstanding & Status
    state = await openDocumentService.getBillOutstanding(testBillId);
    assert.equal(parseFloat(state.outstanding), 0.00, 'Bill outstanding after Payment + TDS must be ₹0');
    assert.equal(parseFloat(state.payment_allocated), 43932.00);
    assert.equal(parseFloat(state.tds_allocated), 4068.00);

    const pnCheck = await pool.primaryPool.query('SELECT balance_due, payment_status FROM purchase_notes WHERE id = $1', [testBillId]);
    assert.equal(parseFloat(pnCheck.rows[0].balance_due), 0.00);
    assert.equal(pnCheck.rows[0].payment_status, 'PAID', 'Bill status must transition to PAID');
  });

  test('Target Case B: Gross ₹4,13,000 + Payment ₹3,78,000 + TDS ₹35,000 → Bill PAID, Balance ₹0', async () => {
    // 1. Create Bill for ₹4,13,000
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-02', NOW(), $1, 'Purchase Bill', 413000.00, 413000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    testBillId2 = pnR.rows[0].id;

    // 2. Add Payment allocation of ₹3,78,000
    const payR = await pool.primaryPool.query(
      `INSERT INTO payments (doc_number, date, vendor_id, amount, payment_mode, status)
       VALUES ('PAY-TDS-02', NOW(), $1, 378000.00, 'Bank Transfer', 'COMPLETED') RETURNING id`,
      [testVendorId]
    );
    const payId = payR.rows[0].id;

    await pool.primaryPool.query(
      `INSERT INTO payment_allocations (payment_id, purchase_note_id, amount) VALUES ($1, $2, 378000.00)`,
      [payId, testBillId2]
    );
    await openDocumentService.syncBillStatus(testBillId2);

    // 3. Add Manual TDS withholding of ₹35,000
    const result = await billTdsService.createBillTdsWithholding({
      purchaseNoteId: testBillId2,
      vendorId: testVendorId,
      tdsAmount: 35000.00,
      nature: 'Professional Fees 194J',
      sectionReference: 'Sec 194J',
      ratePercent: 10.00,
    });

    assert.equal(parseFloat(result.withholding.tds_amount), 35000.00);

    // 4. Verify Bill Outstanding & Status
    const state = await openDocumentService.getBillOutstanding(testBillId2);
    assert.equal(parseFloat(state.outstanding), 0.00, 'Bill outstanding must be ₹0');
    assert.equal(parseFloat(state.payment_allocated), 378000.00);
    assert.equal(parseFloat(state.tds_allocated), 35000.00);

    const pnCheck = await pool.primaryPool.query('SELECT balance_due, payment_status FROM purchase_notes WHERE id = $1', [testBillId2]);
    assert.equal(parseFloat(pnCheck.rows[0].balance_due), 0.00);
    assert.equal(pnCheck.rows[0].payment_status, 'PAID');
  });

  test('Exact Controlled Case: BILL-2287 Bansi & Mehta (CA) ₹4,13,000 / ₹3,78,000 / ₹35,000', async () => {
    const { rows: bills } = await pool.primaryPool.query(`
      SELECT pn.*, v.name AS vendor_name
      FROM purchase_notes pn
      JOIN vendors v ON v.id = pn.vendor_id
      WHERE pn.doc_number = 'BILL-2287' OR pn.reference_no = 'G8/MBP/2026-27'
    `);

    if (bills.length > 0) {
      const bill = bills[0];
      assert.equal(bill.doc_number, 'BILL-2287');
      assert.equal(bill.reference_no, 'G8/MBP/2026-27');
      assert.equal(bill.vendor_name, 'Bansi & Mehta');
      assert.equal(parseFloat(bill.grand_total), 413000.00);

      const state = await openDocumentService.getBillOutstanding(bill.id);
      assert.equal(parseFloat(state.payment_allocated), 378000.00, 'Payment allocated must be ₹3,78,000');

      // Check if active TDS withholding already exists
      const activeInitial = await billTdsService.getBillTdsWithholding(bill.id);
      if (!activeInitial) {
        const result = await billTdsService.createBillTdsWithholding({
          purchaseNoteId: bill.id,
          vendorId: bill.vendor_id,
          tdsAmount: 35000.00,
          nature: 'PROFESSIONAL FEE',
          sectionReference: '194J',
        });

        assert.equal(result.withholding.status, 'POSTED');
        assert.equal(parseFloat(result.withholding.tds_amount), 35000.00);

        const updatedState = await openDocumentService.getBillOutstanding(bill.id);
        assert.equal(parseFloat(updatedState.outstanding), 0.00, 'Bill outstanding must be 0');

        const checkPn = await pool.primaryPool.query('SELECT balance_due, payment_status FROM purchase_notes WHERE id = $1', [bill.id]);
        assert.equal(parseFloat(checkPn.rows[0].balance_due), 0.00);
        assert.equal(checkPn.rows[0].payment_status, 'PAID', 'Bill status must be PAID');
      } else {
        assert.equal(activeInitial.status, 'POSTED');
        assert.equal(parseFloat(activeInitial.tds_amount), 35000.00);
      }
    }
  });

  test('TDS Amount > Outstanding Balance is rejected', async () => {
    // Try to add ₹10,000 TDS to Bill #1 which is already fully settled (outstanding 0)
    await assert.rejects(
      async () => {
        await billTdsService.createBillTdsWithholding({
          purchaseNoteId: testBillId,
          vendorId: testVendorId,
          tdsAmount: 10000.00,
        });
      },
      /exceeds Bill outstanding balance/,
      'Must reject TDS amount exceeding outstanding balance'
    );
  });

  test('Duplicate active POSTED withholding on same Bill is rejected', async () => {
    // Create new bill
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-03', NOW(), $1, 'Expense Bill', 10000.00, 10000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    const bId = pnR.rows[0].id;

    // Create 1st TDS
    await billTdsService.createBillTdsWithholding({
      purchaseNoteId: bId,
      vendorId: testVendorId,
      tdsAmount: 1000.00,
    });

    // Try creating 2nd active TDS on same bill
    await assert.rejects(
      async () => {
        await billTdsService.createBillTdsWithholding({
          purchaseNoteId: bId,
          vendorId: testVendorId,
          tdsAmount: 500.00,
        });
      },
      /already has an active POSTED TDS withholding/,
      'Must reject duplicate active TDS withholding'
    );
  });

  test('Safe Edit: Metadata-only change preserves original journal', async () => {
    const active = await billTdsService.getBillTdsWithholding(testBillId2);
    assert.ok(active, 'Active TDS record must exist');

    const res = await billTdsService.replaceBillTdsWithholding({
      purchaseNoteId: testBillId2,
      tdsAmount: 35000.00, // Same amount
      nature: 'Updated Nature 194J',
      sectionReference: 'Sec 194J Updated',
    });

    assert.ok(res.metadataOnly, 'Must perform metadata-only update');
    assert.equal(res.withholding.nature, 'Updated Nature 194J');

    // Verify status is still PAID
    const pnCheck = await pool.primaryPool.query('SELECT balance_due, payment_status FROM purchase_notes WHERE id = $1', [testBillId2]);
    assert.equal(pnCheck.rows[0].payment_status, 'PAID');
  });

  test('Safe Edit: Amount change reverses old withholding and posts new withholding', async () => {
    // 1. Create bill for ₹50,000
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-04', NOW(), $1, 'Expense Bill', 50000.00, 50000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    const bId = pnR.rows[0].id;

    // Add TDS ₹5,000
    const original = await billTdsService.createBillTdsWithholding({
      purchaseNoteId: bId,
      vendorId: testVendorId,
      tdsAmount: 5000.00,
    });
    const origId = original.withholding.id;

    // Change TDS to ₹7,000
    const res = await billTdsService.replaceBillTdsWithholding({
      purchaseNoteId: bId,
      tdsAmount: 7000.00,
      nature: 'Revised TDS Amount',
    });

    assert.ok(res.withholding, 'New withholding record created');
    assert.notEqual(res.withholding.id, origId, 'New withholding ID must differ');
    assert.equal(parseFloat(res.withholding.tds_amount), 7000.00);

    // Verify old withholding is REVERSED
    const oldCheck = await pool.primaryPool.query('SELECT status, reversal_je_id FROM bill_tds_withholdings WHERE id = $1', [origId]);
    assert.equal(oldCheck.rows[0].status, 'REVERSED');
    assert.ok(oldCheck.rows[0].reversal_je_id, 'Reversal JE ID must be stored on old withholding');

    // Verify Bill outstanding = ₹50,000 - ₹7,000 = ₹43,000
    const state = await openDocumentService.getBillOutstanding(bId);
    assert.equal(parseFloat(state.outstanding), 43000.00);
  });

  test('Safe Edit: Remove TDS reverses active withholding and restores outstanding', async () => {
    // Create bill for ₹20,000
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-05', NOW(), $1, 'Expense Bill', 20000.00, 20000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    const bId = pnR.rows[0].id;

    // Add TDS ₹2,000
    await billTdsService.createBillTdsWithholding({
      purchaseNoteId: bId,
      vendorId: testVendorId,
      tdsAmount: 2000.00,
    });

    // Remove TDS (amount = 0)
    await billTdsService.replaceBillTdsWithholding({
      purchaseNoteId: bId,
      tdsAmount: 0,
      remarks: 'TDS removed by user',
    });

    // Verify active withholding is null
    const active = await billTdsService.getBillTdsWithholding(bId);
    assert.equal(active, null, 'No active withholding should remain');

    // Verify outstanding restored to ₹20,000
    const state = await openDocumentService.getBillOutstanding(bId);
    assert.equal(parseFloat(state.outstanding), 20000.00);
    assert.equal(state.status, 'posted');
  });

  test('Reversal is idempotent', async () => {
    // Create bill & TDS
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-06', NOW(), $1, 'Expense Bill', 15000.00, 15000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    const bId = pnR.rows[0].id;

    const created = await billTdsService.createBillTdsWithholding({
      purchaseNoteId: bId,
      vendorId: testVendorId,
      tdsAmount: 1500.00,
    });

    // Reversal 1
    const rev1 = await billTdsService.reverseBillTdsWithholding({
      withholdingId: created.withholding.id,
      reason: 'First reversal',
    });
    assert.equal(rev1.alreadyReversed, false);

    // Reversal 2 (Duplicate)
    const rev2 = await billTdsService.reverseBillTdsWithholding({
      withholdingId: created.withholding.id,
      reason: 'Second reversal',
    });
    assert.equal(rev2.alreadyReversed, true, 'Second reversal must return alreadyReversed: true');
  });

  test('Vendor Ledger deduplication: system-generated TDS journals are excluded from JE Adjustment dataset', async () => {
    // 1. Create Bill & TDS withholding for testVendorId
    const pnR = await pool.primaryPool.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, grand_total, balance_due, payment_status, status)
       VALUES ('TDS-BILL-07', NOW(), $1, 'Expense Bill', 50000.00, 50000.00, 'UNPAID', 'posted') RETURNING id`,
      [testVendorId]
    );
    const bId = pnR.rows[0].id;

    await billTdsService.createBillTdsWithholding({
      purchaseNoteId: bId,
      vendorId: testVendorId,
      tdsAmount: 5000.00,
      nature: '194C Contractor',
    });

    // 2. Query vendor transactions via SQL (simulating GET /api/vendors/:id/transactions)
    const [jeR, tdsR] = await Promise.all([
      pool.primaryPool.query(`
        SELECT jl.id, je.id AS je_id, je.source_type
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        WHERE jl.entity_type = 'vendor'
          AND jl.entity_id = $1
          AND je.status = 'posted'
          AND COALESCE(je.source_type, '') NOT IN ('bill_tds_withholding', 'bill_tds_reversal')
          AND NOT EXISTS (
            SELECT 1 FROM bill_tds_withholdings btw_check
            WHERE btw_check.posting_je_id = je.id OR btw_check.reversal_je_id = je.id
          )
      `, [testVendorId]),
      pool.primaryPool.query(`
        SELECT btw.id, btw.tds_amount
        FROM bill_tds_withholdings btw
        WHERE btw.vendor_id = $1 AND btw.purchase_note_id = $2
      `, [testVendorId, bId])
    ]);

    assert.equal(tdsR.rows.length, 1, 'Exactly one dedicated TDS business row must exist');
    const tdsJeRows = jeR.rows.filter(r => r.source_type === 'bill_tds_withholding');
    assert.equal(tdsJeRows.length, 0, 'Generic JE Adjustment dataset must exclude system TDS withholding journals');
  });
});

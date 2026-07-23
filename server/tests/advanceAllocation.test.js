const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  getBillOutstanding,
  getVendorOpenBills,
  syncBillStatus,
} = require('../services/openDocumentService');
const {
  applyAdvancesToBill,
  reverseAdvanceApplication,
  getOpenAdvances,
  getAvailableAdvanceTotal,
  getVendorPosition,
} = require('../services/vendorAdvanceService');

describe('Advance Payment Allocation Engine Tests', () => {

  test('Phase 1: getBillOutstanding includes payment_allocations, je_allocations, and APPLIED vendor_advance_applications', async () => {
    // Mock db client
    const mockClient = {
      query: async (sql, params) => {
        if (sql.includes('FROM purchase_notes pn')) {
          return {
            rows: [{
              id: params[0],
              doc_number: 'PN-101',
              doc_date: '2026-01-01',
              vendor_id: 5,
              grand_total: '1000.00',
              payment_term: 'Immediate',
              status: 'approved',
              payment_allocated: '200.00',
              je_allocated: '300.00',
              advance_allocated: '400.00',
              total_allocated: '900.00',
              outstanding: '100.00',
            }],
          };
        }
        return { rows: [] };
      },
    };

    const res = await getBillOutstanding(101, mockClient);
    assert.strictEqual(res.outstanding, '100.00');
    assert.strictEqual(res.advance_allocated, '400.00');
    assert.strictEqual(res.total_allocated, '900.00');
  });

  test('Phase 1: REVERSED vendor_advance_applications do not reduce Bill balance', async () => {
    // Mock query logic checking status = 'APPLIED' filter
    let checkedSql = '';
    const mockClient = {
      query: async (sql) => {
        checkedSql = sql;
        return {
          rows: [{
            id: 102,
            grand_total: '1000.00',
            payment_allocated: '0.00',
            je_allocated: '0.00',
            advance_allocated: '0.00',
            total_allocated: '0.00',
            outstanding: '1000.00',
          }],
        };
      },
    };

    const res = await getBillOutstanding(102, mockClient);
    assert.ok(checkedSql.includes("status = 'APPLIED'"), 'Must filter advance applications by status = APPLIED');
    assert.strictEqual(res.outstanding, '1000.00');
  });

  test('Phase 5: applyAdvancesToBill rejects vendor mismatch', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM purchase_notes')) {
          return { rows: [{ id: 10, vendor_id: 99, grand_total: '500.00', amount_paid: '0.00', status: 'approved' }] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      async () => {
        await applyAdvancesToBill({
          purchaseNoteId: 10,
          vendorId: 88, // Mismatched vendor
          mode: 'auto',
          userId: 1,
          client: mockClient,
        });
      },
      /Bill does not belong to the specified vendor/
    );
  });

  test('Phase 5: applyAdvancesToBill rejects allocation beyond Bill balance in manual mode', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM purchase_notes')) {
          return { rows: [{ id: 10, vendor_id: 5, grand_total: '500.00', amount_paid: '0.00', status: 'approved' }] };
        }
        if (sql.includes('FROM vendor_advances')) {
          return { rows: [{ id: 1, remaining_amount: '1000.00' }] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      async () => {
        await applyAdvancesToBill({
          purchaseNoteId: 10,
          vendorId: 5,
          mode: 'manual',
          allocations: [{ advance_id: 1, amount: 600.00 }], // Bill balance is 500
          userId: 1,
          client: mockClient,
        });
      },
      /exceeds bill balance/
    );
  });

  test('Phase 5: applyAdvancesToBill rejects allocation beyond advance remaining in manual mode', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM purchase_notes')) {
          return { rows: [{ id: 10, vendor_id: 5, grand_total: '1000.00', amount_paid: '0.00', status: 'approved' }] };
        }
        if (sql.includes('FROM vendor_advances')) {
          return { rows: [{ id: 1, remaining_amount: '200.00' }] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      async () => {
        await applyAdvancesToBill({
          purchaseNoteId: 10,
          vendorId: 5,
          mode: 'manual',
          allocations: [{ advance_id: 1, amount: 300.00 }], // Advance remaining is 200
          userId: 1,
          client: mockClient,
        });
      },
      /exceeds advance 1 remaining/
    );
  });

  test('Phase 7: reverseAdvanceApplication rejects second reversal (idempotent guard)', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql.includes('FROM vendor_advance_applications')) {
          return { rows: [{ id: 50, status: 'REVERSED', purchase_note_id: 10, advance_id: 1, amount: '100.00' }] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      async () => {
        await reverseAdvanceApplication({
          applicationId: 50,
          userId: 1,
          client: mockClient,
        });
      },
      /Application is already REVERSED/
    );
  });

});

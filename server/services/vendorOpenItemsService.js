const pool = require('../db/pool');
const { getVendorOpenBills } = require('./openDocumentService');

/**
 * Phase 4.9: Vendor Open Items Engine
 * Consolidates all open AP documents into a single source of truth.
 * Uses openDocumentService for canonical outstanding calculations (payment_allocations,
 * je_allocations, and vendor_advance_applications with status = 'APPLIED').
 */
async function getVendorOpenItems(vendorId, asOfDate = null, excludeJeId = null) {
  if (!vendorId) {
    throw new Error('vendorId is required');
  }

  const bills = await getVendorOpenBills(parseInt(vendorId), pool, excludeJeId);
  return bills.map(b => ({
    source_type: b.item_type === 'Expense Bill' ? 'expense' : 'purchase_note',
    source_id: b.id,
    voucher_no: b.doc_number,
    voucher_date: b.doc_date,
    due_date: b.doc_date,
    vendor_id: parseInt(vendorId),
    description: b.remark || '',
    original_amount: parseFloat(b.grand_total || 0),
    amount_paid: parseFloat(b.total_allocated || 0),
    outstanding_amount: parseFloat(b.outstanding || 0),
    status: b.status || 'posted',
  }));
}

module.exports = {
  getVendorOpenItems
};

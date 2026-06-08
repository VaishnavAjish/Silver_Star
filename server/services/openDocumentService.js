/**
 * openDocumentService.js
 *
 * Calculates DYNAMIC outstanding balances for bills and invoices, accounting
 * for ALL allocation sources:
 *   - payment_allocations  (payments against bills)
 *   - receipt_allocations  (receipts against invoices)
 *   - je_allocations       (JE adjustments against bills / invoices)
 *
 * IMPORTANT: Never trust stored balance_due/amount_paid columns directly for
 * "true outstanding" — always derive from allocation tables. The sync functions
 * (syncBillStatus, syncInvoiceStatus) write back to stored columns so existing
 * queries remain fast, but this service is the canonical source of truth.
 */

const pool = require('../db/pool');

// ── Bill outstanding (purchase_notes) ────────────────────────────────────────

async function getBillOutstanding(billId, client = pool) {
  const r = await (client).query(`
    SELECT
      pn.id,
      pn.doc_number,
      pn.doc_date,
      pn.vendor_id,
      pn.grand_total,
      pn.payment_term,
      pn.status,
      COALESCE(pa.payment_allocated, 0)                                   AS payment_allocated,
      COALESCE(ja.je_allocated,      0)                                   AS je_allocated,
      COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0)   AS total_allocated,
      GREATEST(
        0,
        pn.grand_total
          - COALESCE(pa.payment_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
      )                                                                   AS outstanding
    FROM purchase_notes pn
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS payment_allocated
      FROM   payment_allocations
      WHERE  purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) pa ON TRUE
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_allocated
      FROM   je_allocations
      WHERE  target_type = 'bill' AND target_id = $1
      GROUP  BY target_id
    ) ja ON TRUE
    WHERE pn.id = $1
  `, [billId]);
  return r.rows[0] || null;
}

// ── Invoice outstanding (invoices) ───────────────────────────────────────────

async function getInvoiceOutstanding(invoiceId, client = pool) {
  const r = await (client).query(`
    SELECT
      inv.id,
      inv.doc_number,
      inv.doc_date,
      inv.customer_id,
      inv.grand_total,
      inv.payment_term,
      inv.status,
      COALESCE(ra.receipt_allocated, 0)                                   AS receipt_allocated,
      COALESCE(ja.je_allocated,      0)                                   AS je_allocated,
      COALESCE(ra.receipt_allocated, 0) + COALESCE(ja.je_allocated, 0)   AS total_allocated,
      GREATEST(
        0,
        inv.grand_total
          - COALESCE(ra.receipt_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
      )                                                                   AS outstanding
    FROM invoices inv
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS receipt_allocated
      FROM   receipt_allocations
      WHERE  invoice_id = $1
      GROUP  BY invoice_id
    ) ra ON TRUE
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_allocated
      FROM   je_allocations
      WHERE  target_type = 'invoice' AND target_id = $1
      GROUP  BY target_id
    ) ja ON TRUE
    WHERE inv.id = $1
  `, [invoiceId]);
  return r.rows[0] || null;
}

// ── Open bills for a vendor (outstanding > 0, not cancelled) ────────────────
// excludeJeId: when re-editing, pass the current JE id so its allocations are
// not counted against the outstanding (they'll be deleted before re-saving).

async function getVendorOpenBills(vendorId, client = pool, excludeJeId = null) {
  const params = [vendorId];
  const jeFilter = excludeJeId
    ? `AND je_id != $${params.push(excludeJeId)}`
    : '';

  const r = await (client).query(`
    SELECT
      pn.id,
      pn.doc_number,
      pn.doc_date,
      pn.grand_total,
      pn.payment_term,
      pn.status,
      COALESCE(pa.payment_allocated, 0)                                   AS payment_allocated,
      COALESCE(ja.je_allocated,      0)                                   AS je_allocated,
      COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0)   AS total_allocated,
      GREATEST(
        0,
        pn.grand_total
          - COALESCE(pa.payment_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
      )                                                                   AS outstanding
    FROM purchase_notes pn
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS payment_allocated
      FROM   payment_allocations
      GROUP  BY purchase_note_id
    ) pa ON pa.purchase_note_id = pn.id
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_allocated
      FROM   je_allocations
      WHERE  target_type = 'bill' ${jeFilter}
      GROUP  BY target_id
    ) ja ON ja.target_id = pn.id
    WHERE pn.vendor_id   = $1
      AND pn.status      != 'cancelled'
      AND pn.grand_total  > COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0)
    ORDER BY pn.doc_date ASC
  `, params);
  return r.rows;
}

// ── Open invoices for a customer (outstanding > 0, not cancelled) ────────────

async function getCustomerOpenInvoices(customerId, client = pool, excludeJeId = null) {
  const params = [customerId];
  const jeFilter = excludeJeId
    ? `AND je_id != $${params.push(excludeJeId)}`
    : '';

  const r = await (client).query(`
    SELECT
      inv.id,
      inv.doc_number,
      inv.doc_date,
      inv.grand_total,
      inv.payment_term,
      inv.status,
      COALESCE(ra.receipt_allocated, 0)                                   AS receipt_allocated,
      COALESCE(ja.je_allocated,      0)                                   AS je_allocated,
      COALESCE(ra.receipt_allocated, 0) + COALESCE(ja.je_allocated, 0)   AS total_allocated,
      GREATEST(
        0,
        inv.grand_total
          - COALESCE(ra.receipt_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
      )                                                                   AS outstanding
    FROM invoices inv
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS receipt_allocated
      FROM   receipt_allocations
      GROUP  BY invoice_id
    ) ra ON ra.invoice_id = inv.id
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_allocated
      FROM   je_allocations
      WHERE  target_type = 'invoice' ${jeFilter}
      GROUP  BY target_id
    ) ja ON ja.target_id = inv.id
    WHERE inv.customer_id  = $1
      AND inv.status       != 'cancelled'
      AND inv.grand_total   > COALESCE(ra.receipt_allocated, 0) + COALESCE(ja.je_allocated, 0)
    ORDER BY inv.doc_date ASC
  `, params);
  return r.rows;
}

// ── Recompute & persist bill status (keeps stored columns in sync) ────────────
// Called within a transaction (pass the client).

async function syncBillStatus(billId, client) {
  const row = await getBillOutstanding(billId, client);
  if (!row) return;

  const outstanding = parseFloat(row.outstanding);
  const grandTotal  = parseFloat(row.grand_total);
  const totalPaid   = grandTotal - outstanding;

  const pStatus = outstanding <= 0.005 ? 'PAID'
    : totalPaid > 0.005 ? 'PARTIAL'
    : 'UNPAID';

  await client.query(
    `UPDATE purchase_notes
     SET amount_paid = $1, balance_due = $2, payment_status = $3
     WHERE id = $4`,
    [totalPaid, Math.max(0, outstanding), pStatus, billId]
  );
}

// ── Recompute & persist invoice status ───────────────────────────────────────

async function syncInvoiceStatus(invoiceId, client) {
  const row = await getInvoiceOutstanding(invoiceId, client);
  if (!row) return;

  const outstanding = parseFloat(row.outstanding);
  const grandTotal  = parseFloat(row.grand_total);
  const totalPaid   = grandTotal - outstanding;

  const pStatus = outstanding <= 0.005 ? 'PAID'
    : totalPaid > 0.005 ? 'PARTIAL'
    : 'UNPAID';

  await client.query(
    `UPDATE invoices
     SET amount_paid = $1, balance_due = $2, payment_status = $3
     WHERE id = $4`,
    [totalPaid, Math.max(0, outstanding), pStatus, invoiceId]
  );
}

module.exports = {
  getBillOutstanding,
  getInvoiceOutstanding,
  getVendorOpenBills,
  getCustomerOpenInvoices,
  syncBillStatus,
  syncInvoiceStatus,
};

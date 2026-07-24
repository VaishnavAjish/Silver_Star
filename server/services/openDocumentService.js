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
      COALESCE(vaa.advance_allocated, 0)                                 AS advance_allocated,
      COALESCE(btw.tds_allocated,     0)                                 AS tds_allocated,
      COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0) + COALESCE(vaa.advance_allocated, 0) + COALESCE(btw.tds_allocated, 0) AS total_allocated,
      GREATEST(
        0,
        pn.grand_total
          - COALESCE(pa.payment_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
          - COALESCE(vaa.advance_allocated, 0)
          - COALESCE(btw.tds_allocated,     0)
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
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS advance_allocated
      FROM   vendor_advance_applications
      WHERE  status = 'APPLIED' AND purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) vaa ON TRUE
    LEFT JOIN (
      SELECT purchase_note_id, SUM(tds_amount) AS tds_allocated
      FROM   bill_tds_withholdings
      WHERE  status = 'POSTED' AND purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) btw ON TRUE
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
      COALESCE(vaa.advance_allocated, 0)                                 AS advance_allocated,
      COALESCE(btw.tds_allocated,     0)                                 AS tds_allocated,
      COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0) + COALESCE(vaa.advance_allocated, 0) + COALESCE(btw.tds_allocated, 0) AS total_allocated,
      GREATEST(
        0,
        pn.grand_total
          - COALESCE(pa.payment_allocated, 0)
          - COALESCE(ja.je_allocated,      0)
          - COALESCE(vaa.advance_allocated, 0)
          - COALESCE(btw.tds_allocated,     0)
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
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS advance_allocated
      FROM   vendor_advance_applications
      WHERE  status = 'APPLIED'
      GROUP  BY purchase_note_id
    ) vaa ON vaa.purchase_note_id = pn.id
    LEFT JOIN (
      SELECT purchase_note_id, SUM(tds_amount) AS tds_allocated
      FROM   bill_tds_withholdings
      WHERE  status = 'POSTED'
      GROUP  BY purchase_note_id
    ) btw ON btw.purchase_note_id = pn.id
    WHERE pn.vendor_id   = $1
      AND pn.status      != 'cancelled'
      AND pn.grand_total  > COALESCE(pa.payment_allocated, 0) + COALESCE(ja.je_allocated, 0) + COALESCE(vaa.advance_allocated, 0) + COALESCE(btw.tds_allocated, 0)
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

// ── Auto-allocate Journal Entry against open bills / invoices (FIFO) ─────────
async function autoAllocateJE(jeId, client = pool) {
  // Check if JE is a TDS system journal (withholding or reversal) — TDS settlements are managed strictly via bill_tds_withholdings
  const jeCheck = await client.query(`
    SELECT je.source_type,
           EXISTS (
             SELECT 1 FROM bill_tds_withholdings btw
             WHERE btw.posting_je_id = je.id OR btw.reversal_je_id = je.id
           ) AS is_tds_linked
    FROM journal_entries je
    WHERE je.id = $1
  `, [jeId]);
  if (!jeCheck.rows.length) return;
  const { source_type, is_tds_linked } = jeCheck.rows[0];
  if (['bill_tds_withholding', 'bill_tds_reversal'].includes(source_type) || is_tds_linked) {
    // TDS posting and reversal JEs must never create or hold je_allocations
    return;
  }

  // Check if allocations already exist for this JE
  const existing = await client.query('SELECT 1 FROM je_allocations WHERE je_id = $1 LIMIT 1', [jeId]);
  if (existing.rows.length > 0) return; // Already allocated

  // Fetch posted JE lines for vendor/customer
  const lines = await client.query(`
    SELECT jl.*
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE jl.je_id = $1 AND je.status = 'posted' AND jl.entity_type IN ('vendor', 'customer') AND jl.entity_id IS NOT NULL
  `, [jeId]);

  const allocDate = new Date().toISOString().split('T')[0];

  for (const line of lines.rows) {
    const entityType = line.entity_type;
    const entityId   = parseInt(line.entity_id, 10);
    const debit      = parseFloat(line.debit) || 0;
    const credit     = parseFloat(line.credit) || 0;

    if (entityType === 'vendor' && debit > 0) {
      // Vendor debit line (or net reduction in vendor payable) -> allocate against open bills (FIFO)
      let available = debit;
      const openBills = await getVendorOpenBills(entityId, client);
      for (const bill of openBills) {
        if (available <= 0.005) break;
        const outstanding = parseFloat(bill.outstanding || 0);
        if (outstanding <= 0.005) continue;

        const take = Math.min(outstanding, available);
        await client.query(`
          INSERT INTO je_allocations
            (entity_type, entity_id, je_id, je_line_id, target_type, target_id, allocated_amount, allocation_date, notes)
          VALUES ($1, $2, $3, $4, 'bill', $5, $6, $7, $8)
        `, ['vendor', entityId, jeId, line.id, bill.id, take, allocDate, 'Auto-allocated JE adjustment']);

        await syncBillStatus(bill.id, client);
        available -= take;
      }
    } else if (entityType === 'customer' && credit > 0) {
      // Customer credit line (or net reduction in customer receivable) -> allocate against open invoices (FIFO)
      let available = credit;
      const openInvoices = await getCustomerOpenInvoices(entityId, client);
      for (const inv of openInvoices) {
        if (available <= 0.005) break;
        const outstanding = parseFloat(inv.outstanding || 0);
        if (outstanding <= 0.005) continue;

        const take = Math.min(outstanding, available);
        await client.query(`
          INSERT INTO je_allocations
            (entity_type, entity_id, je_id, je_line_id, target_type, target_id, allocated_amount, allocation_date, notes)
          VALUES ($1, $2, $3, $4, 'invoice', $5, $6, $7, $8)
        `, ['customer', entityId, jeId, line.id, inv.id, take, allocDate, 'Auto-allocated JE adjustment']);

        await syncInvoiceStatus(inv.id, client);
        available -= take;
      }
    }
  }
}

async function autoAllocateAllUnallocatedJEs(client = pool) {
  try {
    const unallocated = await client.query(`
      SELECT DISTINCT je.id
      FROM journal_entries je
      JOIN je_lines jl ON jl.je_id = je.id
      WHERE je.status = 'posted'
        AND jl.entity_type IN ('vendor', 'customer')
        AND jl.entity_id IS NOT NULL
        AND COALESCE(je.source_type, '') NOT IN ('bill_tds_withholding', 'bill_tds_reversal')
        AND NOT EXISTS (
          SELECT 1 FROM bill_tds_withholdings btw
          WHERE btw.posting_je_id = je.id OR btw.reversal_je_id = je.id
        )
        AND NOT EXISTS (SELECT 1 FROM je_allocations ja WHERE ja.je_id = je.id)
      ORDER BY je.id ASC
    `);

    for (const row of unallocated.rows) {
      await autoAllocateJE(row.id, client);
    }
  } catch (err) {
    console.error('[autoAllocateAllUnallocatedJEs] error:', err.message);
  }
}

module.exports = {
  getBillOutstanding,
  getInvoiceOutstanding,
  getVendorOpenBills,
  getCustomerOpenInvoices,
  syncBillStatus,
  syncInvoiceStatus,
  autoAllocateJE,
  autoAllocateAllUnallocatedJEs,
};

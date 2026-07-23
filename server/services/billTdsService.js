'use strict';

const pool = require('../db/pool');
const FinancialMappingService = require('./FinancialMappingService');
const journalEngine = require('./journalEngine');
const openDocumentService = require('./openDocumentService');

/**
 * Manual Bill TDS Withholding & Settlement Service — Silverstar Grow ERP
 *
 * Manages manual TDS withholding for Expense and Purchase Bills (purchase_notes).
 * Posts balanced journal: Dr Accounts Payable / Cr TDS Payable (Account 3004).
 */

async function getBillTdsWithholding(purchaseNoteId, outerClient = null) {
  const client = outerClient || pool.primaryPool;
  const res = await client.query(
    `SELECT btw.*, acc.code AS tds_account_code, acc.name AS tds_account_name,
            je_p.je_number AS posting_je_number, je_r.je_number AS reversal_je_number
     FROM bill_tds_withholdings btw
     JOIN accounts acc ON acc.id = btw.tds_account_id
     LEFT JOIN journal_entries je_p ON je_p.id = btw.posting_je_id
     LEFT JOIN journal_entries je_r ON je_r.id = btw.reversal_je_id
     WHERE btw.purchase_note_id = $1 AND btw.status = 'POSTED'`,
    [purchaseNoteId]
  );
  return res.rows[0] || null;
}

async function createBillTdsWithholding({
  purchaseNoteId,
  vendorId,
  tdsAmount,
  nature = null,
  sectionReference = null,
  ratePercent = null,
  remarks = null,
  userId = null,
}, outerClient = null) {
  const amount = parseFloat(tdsAmount);
  if (!(amount > 0)) {
    throw new Error('TDS amount must be greater than zero.');
  }

  const isSelfTx = !outerClient;
  const client = outerClient || await pool.primaryPool.connect();

  try {
    if (isSelfTx) await client.query('BEGIN');

    // 1. Lock and validate purchase_note
    const { rows: pnRows } = await client.query(
      `SELECT * FROM purchase_notes WHERE id = $1 FOR UPDATE`,
      [purchaseNoteId]
    );
    if (!pnRows.length) {
      throw new Error(`Bill #${purchaseNoteId} not found.`);
    }
    const pn = pnRows[0];

    if (pn.status === 'cancelled') {
      throw new Error(`Cannot add TDS to cancelled Bill #${pn.doc_number || purchaseNoteId}.`);
    }

    if (vendorId && parseInt(vendorId) !== parseInt(pn.vendor_id)) {
      throw new Error(`Vendor mismatch: Bill belongs to vendor #${pn.vendor_id}, but withholding vendor is #${vendorId}.`);
    }

    // 2. Check for existing active POSTED withholding
    const { rows: existingActive } = await client.query(
      `SELECT id FROM bill_tds_withholdings WHERE purchase_note_id = $1 AND status = 'POSTED' FOR UPDATE`,
      [purchaseNoteId]
    );
    if (existingActive.length > 0) {
      throw new Error(`Bill #${pn.doc_number || purchaseNoteId} already has an active POSTED TDS withholding.`);
    }

    // 3. Calculate Bill outstanding before TDS (ignoring any non-active TDS)
    const billState = await openDocumentService.getBillOutstanding(purchaseNoteId, client);
    if (!billState) {
      throw new Error(`Unable to resolve outstanding state for Bill #${purchaseNoteId}.`);
    }

    const currentOutstanding = parseFloat(billState.outstanding || 0);
    // Tolerance check: amount must not exceed current outstanding balance
    if (amount > currentOutstanding + 0.005) {
      throw new Error(
        `TDS amount (₹${amount.toFixed(2)}) exceeds Bill outstanding balance (₹${currentOutstanding.toFixed(2)}).`
      );
    }

    // 4. Resolve GL Accounts: AP (3001) & TDS Payable (3004)
    const payableAccId = await FinancialMappingService.resolveAP(client);
    if (!payableAccId) throw new Error('Accounts Payable account missing in Chart of Accounts.');
    const tdsAccId = await FinancialMappingService.resolveTDSPayable(client);
    if (!tdsAccId) throw new Error('TDS Payable account (3004) missing in Chart of Accounts.');

    // 5. Post Balanced Journal: Dr Accounts Payable / Cr TDS Payable
    const docRef = pn.doc_number || `#${pn.id}`;
    const je = await journalEngine.createEntry({
      date: pn.doc_date ? new Date(pn.doc_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      description: `TDS withheld against Bill ${docRef}`,
      sourceType: 'bill_tds_withholding',
      sourceId: pn.id,
      lines: [
        {
          accountId: payableAccId,
          debit: amount,
          credit: 0,
          narration: `TDS withheld on Bill ${docRef}${nature ? ' - ' + nature : ''}`,
          entityType: 'vendor',
          entityId: pn.vendor_id,
        },
        {
          accountId: tdsAccId,
          debit: 0,
          credit: amount,
          narration: `TDS Payable for Bill ${docRef}${nature ? ' - ' + nature : ''}`,
          entityType: 'vendor',
          entityId: pn.vendor_id,
        },
      ],
      autoPost: true,
      createdBy: userId,
      client,
    });

    // 6. Insert withholding record
    const { rows: [withholding] } = await client.query(
      `INSERT INTO bill_tds_withholdings
         (purchase_note_id, vendor_id, tds_account_id, nature, section_reference,
          rate_percent, tds_amount, status, posting_je_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', $8, $9)
       RETURNING *`,
      [
        pn.id,
        pn.vendor_id,
        tdsAccId,
        nature || null,
        sectionReference || null,
        ratePercent ? parseFloat(ratePercent) : null,
        amount,
        je.id,
        userId || null,
      ]
    );

    // 7. Sync Bill balance & status (PAID / PARTIAL / UNPAID)
    await openDocumentService.syncBillStatus(pn.id, client);

    if (isSelfTx) await client.query('COMMIT');

    return {
      withholding,
      je,
    };
  } catch (err) {
    if (isSelfTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isSelfTx) client.release();
  }
}

async function reverseBillTdsWithholding({
  withholdingId,
  reason = 'TDS withholding reversed',
  userId = null,
}, outerClient = null) {
  const isSelfTx = !outerClient;
  const client = outerClient || await pool.primaryPool.connect();

  try {
    if (isSelfTx) await client.query('BEGIN');

    // 1. Lock and validate withholding record
    const { rows: btwRows } = await client.query(
      `SELECT * FROM bill_tds_withholdings WHERE id = $1 FOR UPDATE`,
      [withholdingId]
    );
    if (!btwRows.length) {
      throw new Error(`TDS withholding #${withholdingId} not found.`);
    }
    const withholding = btwRows[0];

    // Idempotent / already reversed check
    if (withholding.status === 'REVERSED') {
      if (isSelfTx) await client.query('COMMIT');
      return { withholding, je: null, alreadyReversed: true };
    }

    // 2. Lock purchase_note
    const { rows: pnRows } = await client.query(
      `SELECT * FROM purchase_notes WHERE id = $1 FOR UPDATE`,
      [withholding.purchase_note_id]
    );
    if (!pnRows.length) {
      throw new Error(`Bill #${withholding.purchase_note_id} not found for TDS reversal.`);
    }
    const pn = pnRows[0];

    // 3. Resolve GL Accounts: AP (3001) & TDS Payable (3004)
    const payableAccId = await FinancialMappingService.resolveAP(client);
    const tdsAccId = await FinancialMappingService.resolveTDSPayable(client);

    const tdsAmt = parseFloat(withholding.tds_amount);
    const docRef = pn.doc_number || `#${pn.id}`;

    // 4. Post Reversal Journal: Dr TDS Payable / Cr Accounts Payable
    const reversalJe = await journalEngine.createEntry({
      date: new Date().toISOString().slice(0, 10),
      description: `Reversal of TDS withheld against Bill ${docRef}: ${reason}`,
      sourceType: 'bill_tds_reversal',
      sourceId: withholding.id,
      lines: [
        {
          accountId: tdsAccId,
          debit: tdsAmt,
          credit: 0,
          narration: `Reversal of TDS Payable on Bill ${docRef}`,
          entityType: 'vendor',
          entityId: withholding.vendor_id,
        },
        {
          accountId: payableAccId,
          debit: 0,
          credit: tdsAmt,
          narration: `Restoring Accounts Payable on Bill ${docRef}`,
          entityType: 'vendor',
          entityId: withholding.vendor_id,
        },
      ],
      autoPost: true,
      createdBy: userId,
      client,
    });

    // 5. Update withholding record to REVERSED
    const { rows: [updatedWithholding] } = await client.query(
      `UPDATE bill_tds_withholdings
       SET status = 'REVERSED',
           reversal_je_id = $1,
           reversal_reason = $2,
           reversed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reversalJe.id, reason || null, withholding.id]
    );

    // 6. Sync Bill balance & status
    await openDocumentService.syncBillStatus(pn.id, client);

    if (isSelfTx) await client.query('COMMIT');

    return {
      withholding: updatedWithholding,
      je: reversalJe,
      alreadyReversed: false,
    };
  } catch (err) {
    if (isSelfTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isSelfTx) client.release();
  }
}

async function replaceBillTdsWithholding({
  purchaseNoteId,
  tdsAmount,
  nature = null,
  sectionReference = null,
  ratePercent = null,
  remarks = null,
  userId = null,
}, outerClient = null) {
  const isSelfTx = !outerClient;
  const client = outerClient || await pool.primaryPool.connect();

  try {
    if (isSelfTx) await client.query('BEGIN');

    const newAmount = parseFloat(tdsAmount || 0);

    // Find active withholding for this Bill
    const { rows: activeRows } = await client.query(
      `SELECT * FROM bill_tds_withholdings WHERE purchase_note_id = $1 AND status = 'POSTED' FOR UPDATE`,
      [purchaseNoteId]
    );
    const active = activeRows[0] || null;

    if (active && newAmount <= 0) {
      // Remove TDS: reverse active withholding
      const res = await reverseBillTdsWithholding({
        withholdingId: active.id,
        reason: remarks || 'TDS withholding removed',
        userId,
      }, client);
      if (isSelfTx) await client.query('COMMIT');
      return res;
    }

    if (active && newAmount > 0) {
      const oldAmount = parseFloat(active.tds_amount);
      if (Math.abs(oldAmount - newAmount) < 0.001) {
        // Metadata-only edit (no amount change)
        const { rows: [updated] } = await client.query(
          `UPDATE bill_tds_withholdings
           SET nature = $1, section_reference = $2, rate_percent = $3, updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [
            nature || null,
            sectionReference || null,
            ratePercent ? parseFloat(ratePercent) : null,
            active.id,
          ]
        );
        if (isSelfTx) await client.query('COMMIT');
        return { withholding: updated, metadataOnly: true };
      }

      // Amount changed: reverse old withholding and create new withholding
      await reverseBillTdsWithholding({
        withholdingId: active.id,
        reason: `TDS amount changed from ₹${oldAmount.toFixed(2)} to ₹${newAmount.toFixed(2)}`,
        userId,
      }, client);

      const created = await createBillTdsWithholding({
        purchaseNoteId,
        vendorId: active.vendor_id,
        tdsAmount: newAmount,
        nature,
        sectionReference,
        ratePercent,
        remarks,
        userId,
      }, client);

      if (isSelfTx) await client.query('COMMIT');
      return created;
    }

    if (!active && newAmount > 0) {
      // No active withholding, create new
      const { rows: pnRows } = await client.query(
        `SELECT vendor_id FROM purchase_notes WHERE id = $1`,
        [purchaseNoteId]
      );
      if (!pnRows.length) throw new Error(`Bill #${purchaseNoteId} not found.`);

      const created = await createBillTdsWithholding({
        purchaseNoteId,
        vendorId: pnRows[0].vendor_id,
        tdsAmount: newAmount,
        nature,
        sectionReference,
        ratePercent,
        remarks,
        userId,
      }, client);

      if (isSelfTx) await client.query('COMMIT');
      return created;
    }

    if (isSelfTx) await client.query('COMMIT');
    return { withholding: null, noop: true };
  } catch (err) {
    if (isSelfTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isSelfTx) client.release();
  }
}

module.exports = {
  getBillTdsWithholding,
  createBillTdsWithholding,
  reverseBillTdsWithholding,
  replaceBillTdsWithholding,
};

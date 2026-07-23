'use strict';

/**
 * Vendor Advance Consumption Engine
 *
 * Applies OPEN vendor advances against vendor bills (purchase_notes), posting
 * a balanced journal entry per application and maintaining a full audit trail.
 *
 * Accounting rule (per application total):
 *     Dr  Accounts Payable      (role ACCOUNTS_PAYABLE)
 *     Cr  Vendor Advance         (role VENDOR_ADVANCE)
 *
 * Guarantees:
 *  - Never touches historical postings or existing payment_allocations.
 *  - Only ADDS new JEs + vendor_advance_applications rows; advances are drawn
 *    down via remaining_amount and flipped to status APPLIED when exhausted.
 *  - All mutations happen inside the caller's transaction when a client is
 *    supplied (so it can be embedded in Purchase Note creation atomically).
 *
 * Supports: one advance → many bills, many advances → one bill, partial
 * consumption, auto (FIFO) or manual allocation.
 */

const pool = require('../db/pool');
const journalEngine = require('./journalEngine');
const FinancialMappingService = require('./FinancialMappingService');
const { syncBillStatus } = require('./openDocumentService');

const EPS = 0.005;
const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/**
 * Open advances for a vendor (remaining > 0), FIFO by creation.
 * @param {number} vendorId
 * @param {object} [client] pg client or pool
 * @returns {Promise<Array<{id:number, amount:number, remaining_amount:number, created_at:string}>>}
 */
async function getOpenAdvances(vendorId, client = pool) {
  const r = await client.query(
    `SELECT id, amount, remaining_amount, created_at
       FROM vendor_advances
      WHERE vendor_id = $1 AND status = 'OPEN' AND remaining_amount > 0
      ORDER BY created_at, id`,
    [parseInt(vendorId)]
  );
  return r.rows.map((row) => ({
    id: row.id,
    amount: parseFloat(row.amount),
    remaining_amount: parseFloat(row.remaining_amount),
    created_at: row.created_at,
  }));
}

/**
 * Total unapplied advance balance for a vendor.
 * @param {number} vendorId
 * @param {object} [client]
 * @returns {Promise<number>}
 */
async function getAvailableAdvanceTotal(vendorId, client = pool) {
  const r = await client.query(
    `SELECT COALESCE(SUM(remaining_amount), 0) AS total
       FROM vendor_advances
      WHERE vendor_id = $1 AND status = 'OPEN'`,
    [parseInt(vendorId)]
  );
  return round2(r.rows[0].total);
}

/**
 * Net vendor position: outstanding bills, unapplied advances, and the net.
 * Outstanding is read from purchase_notes (grand_total - amount_paid), the
 * authoritative settled column maintained by both payments and this engine.
 * @param {number} vendorId
 * @param {object} [client]
 * @returns {Promise<{outstanding_bills:number, vendor_advances:number, net_position:number, bills:Array}>}
 */
async function getVendorPosition(vendorId, client = pool) {
  const vid = parseInt(vendorId);

  const billsR = await client.query(
    `SELECT id, doc_number, doc_date, grand_total,
            COALESCE(amount_paid, 0) AS amount_paid,
            GREATEST(grand_total - COALESCE(amount_paid, 0), 0) AS balance,
            COALESCE(payment_status, 'UNPAID') AS payment_status
       FROM purchase_notes
      WHERE vendor_id = $1 AND status != 'cancelled' AND payment_status != 'PAID'
      ORDER BY doc_date, id`,
    [vid]
  );

  const outstanding = round2(
    billsR.rows.reduce((s, b) => s + parseFloat(b.balance), 0)
  );
  const advances = await getAvailableAdvanceTotal(vid, client);

  return {
    outstanding_bills: outstanding,
    vendor_advances: advances,
    net_position: round2(outstanding - advances),
    bills: billsR.rows.map((b) => ({
      id: b.id,
      doc_number: b.doc_number,
      doc_date: b.doc_date,
      grand_total: parseFloat(b.grand_total),
      amount_paid: parseFloat(b.amount_paid),
      balance: parseFloat(b.balance),
      payment_status: b.payment_status,
    })),
  };
}

/**
 * Apply vendor advances against a single bill.
 *
 * @param {object}   params
 * @param {number}   params.purchaseNoteId
 * @param {number}   [params.vendorId]               Optional guard; derived from the bill if omitted.
 * @param {'auto'|'manual'} [params.mode='auto']     'auto' = FIFO up to bill balance; 'manual' = use allocations[].
 * @param {Array<{advance_id:number, amount:number}>} [params.allocations]  Required when mode='manual'.
 * @param {number}   params.userId
 * @param {object}   params.client                   Active pg transaction client (REQUIRED).
 * @returns {Promise<{applied:number, je_id:number|null, breakdown:Array, bill_balance_after:number}>}
 */
async function applyAdvancesToBill({ purchaseNoteId, vendorId, mode = 'auto', allocations = null, userId, client }) {
  if (!client) throw new Error('applyAdvancesToBill requires an active transaction client');
  const pnId = parseInt(purchaseNoteId);

  // Lock the bill so balance can't race with a concurrent payment.
  const pnR = await client.query(
    `SELECT id, vendor_id, grand_total, COALESCE(amount_paid, 0) AS amount_paid, status
       FROM purchase_notes
      WHERE id = $1
      FOR UPDATE`,
    [pnId]
  );
  if (!pnR.rows[0]) throw new Error('Purchase note not found');
  const pn = pnR.rows[0];
  if (pn.status === 'cancelled') throw new Error('Cannot apply advances to a cancelled bill');

  const vid = vendorId ? parseInt(vendorId) : pn.vendor_id;
  if (parseInt(pn.vendor_id) !== vid) {
    throw new Error('Bill does not belong to the specified vendor');
  }

  const grandTotal = round2(pn.grand_total);
  const amountPaid = round2(pn.amount_paid);
  let billBalance = round2(grandTotal - amountPaid);
  if (billBalance <= EPS) {
    return { applied: 0, je_id: null, breakdown: [], bill_balance_after: billBalance };
  }

  // Lock the candidate advances FOR UPDATE (FIFO order) to serialise draw-down.
  const advR = await client.query(
    `SELECT id, remaining_amount
       FROM vendor_advances
      WHERE vendor_id = $1 AND status = 'OPEN' AND remaining_amount > 0
      ORDER BY created_at, id
      FOR UPDATE`,
    [vid]
  );
  const openAdvances = advR.rows.map((a) => ({ id: a.id, remaining: round2(a.remaining_amount) }));
  if (openAdvances.length === 0) {
    return { applied: 0, je_id: null, breakdown: [], bill_balance_after: billBalance };
  }

  // Decide per-advance amounts.
  const plan = []; // { advance_id, amount }

  if (mode === 'manual') {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new Error('Manual mode requires a non-empty allocations array');
    }
    const byId = new Map(openAdvances.map((a) => [a.id, a]));
    for (const alloc of allocations) {
      const aid = parseInt(alloc.advance_id);
      const amt = round2(alloc.amount);
      if (amt <= EPS) continue;
      const adv = byId.get(aid);
      if (!adv) throw new Error(`Advance ${aid} is not an OPEN advance for this vendor`);
      if (amt > adv.remaining + EPS) {
        throw new Error(`Allocation ₹${amt.toFixed(2)} exceeds advance ${aid} remaining ₹${adv.remaining.toFixed(2)}`);
      }
      if (amt > billBalance + EPS) {
        throw new Error(`Allocation ₹${amt.toFixed(2)} exceeds bill balance ₹${billBalance.toFixed(2)}`);
      }
      plan.push({ advance_id: aid, amount: amt });
      billBalance = round2(billBalance - amt);
    }
  } else {
    // AUTO (FIFO): consume each advance up to the remaining bill balance.
    let remainingBill = billBalance;
    for (const adv of openAdvances) {
      if (remainingBill <= EPS) break;
      const take = round2(Math.min(adv.remaining, remainingBill));
      if (take <= EPS) continue;
      plan.push({ advance_id: adv.id, amount: take });
      remainingBill = round2(remainingBill - take);
    }
  }

  const totalApplied = round2(plan.reduce((s, p) => s + p.amount, 0));
  if (totalApplied <= EPS) {
    return { applied: 0, je_id: null, breakdown: [], bill_balance_after: round2(grandTotal - amountPaid) };
  }

  // Ensure table exists (Migration-safe)
  await client.query(`
    CREATE TABLE IF NOT EXISTS vendor_advance_applications (
      id               SERIAL PRIMARY KEY,
      advance_id       INTEGER NOT NULL,
      purchase_note_id INTEGER NOT NULL,
      vendor_id        INTEGER NOT NULL,
      amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      je_id            INTEGER,
      status           VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
      created_by       INTEGER,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_vaa_advance  ON vendor_advance_applications(advance_id);
    CREATE INDEX IF NOT EXISTS idx_vaa_pn       ON vendor_advance_applications(purchase_note_id);
    CREATE INDEX IF NOT EXISTS idx_vaa_vendor   ON vendor_advance_applications(vendor_id, status);
  `);

  // Resolve GL accounts.
  const payableAccId = await FinancialMappingService.resolveAP(client);
  if (!payableAccId) throw new Error('Accounts Payable (3001) missing in COA');
  const advanceAccId = await FinancialMappingService.resolveVendorAdvance(client);
  if (!advanceAccId) throw new Error('Vendor Advance (1050) missing in COA');

  // Post ONE balanced JE for the application total: Dr AP / Cr Vendor Advance.
  const je = await journalEngine.createEntry({
    date: new Date().toISOString().slice(0, 10),
    description: `Vendor advance applied to bill #${pnId}`,
    sourceType: 'advance_application',
    sourceId: pnId,
    lines: [
      { accountId: payableAccId, debit: totalApplied, credit: 0, narration: 'Advance adjusted against payable', entityType: 'vendor', entityId: vid },
      { accountId: advanceAccId, debit: 0, credit: totalApplied, narration: 'Vendor advance consumed', entityType: 'vendor', entityId: vid },
    ],
    autoPost: true,
    createdBy: userId,
    client,
  });

  // Draw down each advance + write the audit row.
  const breakdown = [];
  for (const p of plan) {
    const upd = await client.query(
      `UPDATE vendor_advances
          SET remaining_amount = remaining_amount - $1,
              status = CASE WHEN remaining_amount - $1 <= $2 THEN 'APPLIED' ELSE 'OPEN' END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING remaining_amount, status`,
      [p.amount, EPS, p.advance_id]
    );

    await client.query(
      `INSERT INTO vendor_advance_applications
         (advance_id, purchase_note_id, vendor_id, amount, je_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'APPLIED', $6)`,
      [p.advance_id, pnId, vid, p.amount, je.id, userId || null]
    );

    breakdown.push({
      advance_id: p.advance_id,
      amount: p.amount,
      remaining_after: round2(upd.rows[0].remaining_amount),
      advance_status: upd.rows[0].status,
    });
  }

  // Canonical bill status synchronization
  await syncBillStatus(pnId, client);

  const updatedPn = await client.query('SELECT balance_due FROM purchase_notes WHERE id = $1', [pnId]);
  const newBalance = parseFloat(updatedPn.rows[0]?.balance_due || 0);

  return { applied: totalApplied, je_id: je.id, breakdown, bill_balance_after: newBalance };
}

/**
 * Reverse a vendor advance application.
 *
 * @param {object} params
 * @param {number} params.applicationId
 * @param {number} [params.userId]
 * @param {object} params.client  Active pg transaction client (REQUIRED)
 */
async function reverseAdvanceApplication({ applicationId, userId, client }) {
  if (!client) throw new Error('reverseAdvanceApplication requires an active transaction client');
  const appId = parseInt(applicationId, 10);

  // 1. Lock application
  const appR = await client.query(
    `SELECT * FROM vendor_advance_applications WHERE id = $1 FOR UPDATE`,
    [appId]
  );
  if (!appR.rows[0]) throw new Error('Advance application not found');
  const app = appR.rows[0];
  if (app.status === 'REVERSED') {
    throw new Error('Application is already REVERSED');
  }

  // 2. Lock linked Bill & Advance
  await client.query(`SELECT id FROM purchase_notes WHERE id = $1 FOR UPDATE`, [app.purchase_note_id]);
  const advR = await client.query(`SELECT id, remaining_amount, amount FROM vendor_advances WHERE id = $1 FOR UPDATE`, [app.advance_id]);
  if (!advR.rows[0]) throw new Error('Linked vendor advance not found');

  const appAmount = round2(app.amount);

  // 3. Resolve GL accounts
  const payableAccId = await FinancialMappingService.resolveAP(client);
  const advanceAccId = await FinancialMappingService.resolveVendorAdvance(client);

  // 4. Post Reversing Journal Entry: Dr Vendor Advance / Cr Accounts Payable
  const je = await journalEngine.createEntry({
    date: new Date().toISOString().slice(0, 10),
    description: `Reversal of vendor advance application #${appId}`,
    sourceType: 'advance_application_reversal',
    sourceId: app.purchase_note_id,
    lines: [
      { accountId: advanceAccId, debit: appAmount, credit: 0, narration: `Reversal of advance application #${appId}`, entityType: 'vendor', entityId: app.vendor_id },
      { accountId: payableAccId, debit: 0, credit: appAmount, narration: `Reversal of payable adjustment #${appId}`, entityType: 'vendor', entityId: app.vendor_id },
    ],
    autoPost: true,
    createdBy: userId,
    client,
  });

  // 5. Restore vendor_advances remaining_amount and status
  await client.query(
    `UPDATE vendor_advances
        SET remaining_amount = remaining_amount + $1,
            status = 'OPEN',
            updated_at = NOW()
      WHERE id = $2`,
    [appAmount, app.advance_id]
  );

  // 6. Update application status to REVERSED
  await client.query(
    `UPDATE vendor_advance_applications
        SET status = 'REVERSED',
            reversal_je_id = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [je.id, appId]
  );

  // 7. Canonical Bill status synchronization
  await syncBillStatus(app.purchase_note_id, client);

  return { ok: true, application_id: appId, status: 'REVERSED', reversal_je_id: je.id };
}

module.exports = {
  getOpenAdvances,
  getAvailableAdvanceTotal,
  getVendorPosition,
  applyAdvancesToBill,
  reverseAdvanceApplication,
};

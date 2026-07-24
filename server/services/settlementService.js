/**
 * settlementService.js
 *
 * Canonical settlement breakdown for Bills (purchase_notes).
 * All consumers (vendor routes, AP reports, exports, syncBillStatus)
 * MUST use these functions to derive settlement numbers so that
 * every surface agrees on the same formula.
 *
 * Returns per-bill:
 *   gross_total, cash_paid, je_settled, advance_applied, tds_withheld,
 *   total_settled, raw_balance, balance_due, over_settled_amount,
 *   is_over_settled, payment_status
 */

'use strict';

const pool = require('../db/pool');

const TOLERANCE = 0.005;

/**
 * Settlement breakdown for a single Bill.
 * @param {number} billId
 * @param {object} [client=pool] - pg client or pool
 * @returns {object|null}
 */
async function getBillSettlement(billId, client = pool) {
  const r = await client.query(`
    SELECT
      pn.id,
      pn.doc_number,
      pn.doc_date,
      pn.vendor_id,
      pn.grand_total,
      pn.payment_term,
      pn.status,
      pn.payment_status AS stored_payment_status,
      pn.amount_paid    AS stored_amount_paid,
      pn.balance_due    AS stored_balance_due,
      COALESCE(pa.cash_paid,         0) AS cash_paid,
      COALESCE(ja.je_settled,        0) AS je_settled,
      COALESCE(vaa.advance_applied,  0) AS advance_applied,
      COALESCE(btw.tds_withheld,     0) AS tds_withheld
    FROM purchase_notes pn
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS cash_paid
      FROM   payment_allocations
      WHERE  purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) pa ON TRUE
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_settled
      FROM   je_allocations
      WHERE  target_type = 'bill' AND target_id = $1
      GROUP  BY target_id
    ) ja ON TRUE
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS advance_applied
      FROM   vendor_advance_applications
      WHERE  status = 'APPLIED' AND purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) vaa ON TRUE
    LEFT JOIN (
      SELECT purchase_note_id, SUM(tds_amount) AS tds_withheld
      FROM   bill_tds_withholdings
      WHERE  status = 'POSTED' AND purchase_note_id = $1
      GROUP  BY purchase_note_id
    ) btw ON TRUE
    WHERE pn.id = $1
  `, [billId]);

  if (!r.rows[0]) return null;
  return _deriveSettlement(r.rows[0]);
}

/**
 * Settlement breakdown for multiple Bills in a single query.
 * @param {number[]} billIds
 * @param {object} [client=pool] - pg client or pool
 * @returns {Map<number, object>} Map of billId → settlement object
 */
async function getBillSettlements(billIds, client = pool) {
  if (!billIds || billIds.length === 0) return new Map();

  const r = await client.query(`
    SELECT
      pn.id,
      pn.doc_number,
      pn.doc_date,
      pn.vendor_id,
      pn.grand_total,
      pn.payment_term,
      pn.status,
      pn.payment_status AS stored_payment_status,
      pn.amount_paid    AS stored_amount_paid,
      pn.balance_due    AS stored_balance_due,
      COALESCE(pa.cash_paid,         0) AS cash_paid,
      COALESCE(ja.je_settled,        0) AS je_settled,
      COALESCE(vaa.advance_applied,  0) AS advance_applied,
      COALESCE(btw.tds_withheld,     0) AS tds_withheld
    FROM purchase_notes pn
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS cash_paid
      FROM   payment_allocations
      WHERE  purchase_note_id = ANY($1)
      GROUP  BY purchase_note_id
    ) pa ON pa.purchase_note_id = pn.id
    LEFT JOIN (
      SELECT target_id, SUM(allocated_amount) AS je_settled
      FROM   je_allocations
      WHERE  target_type = 'bill' AND target_id = ANY($1)
      GROUP  BY target_id
    ) ja ON ja.target_id = pn.id
    LEFT JOIN (
      SELECT purchase_note_id, SUM(amount) AS advance_applied
      FROM   vendor_advance_applications
      WHERE  status = 'APPLIED' AND purchase_note_id = ANY($1)
      GROUP  BY purchase_note_id
    ) vaa ON vaa.purchase_note_id = pn.id
    LEFT JOIN (
      SELECT purchase_note_id, SUM(tds_amount) AS tds_withheld
      FROM   bill_tds_withholdings
      WHERE  status = 'POSTED' AND purchase_note_id = ANY($1)
      GROUP  BY purchase_note_id
    ) btw ON btw.purchase_note_id = pn.id
    WHERE pn.id = ANY($1)
  `, [billIds]);

  const map = new Map();
  for (const row of r.rows) {
    map.set(row.id, _deriveSettlement(row));
  }
  return map;
}

/**
 * Derive canonical settlement numbers from a raw DB row.
 * @private
 */
function _deriveSettlement(row) {
  const gross_total      = parseFloat(row.grand_total) || 0;
  const cash_paid        = parseFloat(row.cash_paid) || 0;
  const je_settled       = parseFloat(row.je_settled) || 0;
  const advance_applied  = parseFloat(row.advance_applied) || 0;
  const tds_withheld     = parseFloat(row.tds_withheld) || 0;

  const total_settled      = cash_paid + je_settled + advance_applied + tds_withheld;
  const raw_balance        = gross_total - total_settled;
  const balance_due        = Math.max(raw_balance, 0);
  const over_settled_amount = Math.max(-raw_balance, 0);
  const is_over_settled    = raw_balance < -TOLERANCE;

  // payment_status: keep PAID for over-settled Bills (safe model per owner decision)
  let payment_status;
  if (raw_balance <= TOLERANCE) {
    payment_status = 'PAID';
  } else if (total_settled > TOLERANCE) {
    payment_status = 'PARTIAL';
  } else {
    payment_status = 'UNPAID';
  }

  return {
    id:                   row.id,
    doc_number:           row.doc_number,
    doc_date:             row.doc_date,
    vendor_id:            row.vendor_id,
    gross_total,
    payment_term:         row.payment_term,
    status:               row.status,
    cash_paid,
    je_settled,
    advance_applied,
    tds_withheld,
    total_settled,
    raw_balance,
    balance_due,
    over_settled_amount,
    is_over_settled,
    payment_status,
    // Stored values for mismatch detection
    stored_payment_status: row.stored_payment_status,
    stored_amount_paid:    parseFloat(row.stored_amount_paid) || 0,
    stored_balance_due:    parseFloat(row.stored_balance_due) || 0,
  };
}

module.exports = {
  getBillSettlement,
  getBillSettlements,
  TOLERANCE,
};

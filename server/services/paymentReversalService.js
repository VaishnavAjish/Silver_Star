'use strict';

/**
 * ACCOUNTING PHASE 1B — CANONICAL PAYMENT REVERSAL ENGINE
 *
 * Reverses a NORMAL payment: one whose journal entry still exists. The GL
 * is corrected with a compensating entry (journalEngine.reverseEntry) and
 * the document chain is unwound with full evidence preservation:
 *
 *   - payment_allocations are marked REVERSED (Phase 1A columns), never
 *     DELETEd — the pre-1B route destroyed this history.
 *   - affected bills are RECOMPUTED from surviving active allocations via
 *     the canonical syncBillStatus, never patched with
 *     GREATEST(0, amount_paid - x).
 *   - APPLIED vendor-advance applications are individually reversed via
 *     vendorAdvanceService.reverseAdvanceApplication (their own
 *     compensating JEs), then the payment's advances are cancelled.
 *
 * DIVISION OF LABOUR WITH PHASE 1A
 *   JE exists      → THIS engine (compensating JE + document unwind).
 *   JE missing     → 409 ORPHAN_PAYMENT_JE_MISSING; the historical orphan
 *                    repair (orphanPaymentReconciliation) is the only path
 *                    allowed to touch such payments, because posting a
 *                    compensating JE for an already-deleted JE would
 *                    double-correct the ledger.
 */

const pool = require('../db/pool');
const journalEngine = require('./journalEngine');
const { syncBillStatus } = require('./openDocumentService');
const { reverseAdvanceApplication } = require('./vendorAdvanceService');

/** Advisory-lock class for payment reversal (two-int form). */
const REVERSAL_LOCK_CLASS = 88002;

const CODES = Object.freeze({
  REVERSED:                  'REVERSED',
  ALREADY_REVERSED:          'ALREADY_REVERSED',
  PAYMENT_NOT_FOUND:         'PAYMENT_NOT_FOUND',
  ORPHAN_PAYMENT_JE_MISSING: 'ORPHAN_PAYMENT_JE_MISSING',
  STATUS_NOT_ELIGIBLE:       'STATUS_NOT_ELIGIBLE',
  INVALID_INPUT:             'INVALID_INPUT',
  CONCURRENT_CHANGE:         'CONCURRENT_CHANGE',
});

function conflict(code, message, httpStatus = 409) {
  return { ok: false, code, httpStatus, message };
}

/**
 * Reverse a normal (JE-intact) payment.
 *
 * @param {Object} opts
 * @param {number} opts.paymentId
 * @param {number} [opts.actorId]
 * @param {string} opts.reason      mandatory human reason
 * @param {Object} [opts.client]    existing pg client; when absent the
 *                                  service owns connection + transaction
 * @returns {Object} { ok, code, httpStatus, message, payment?, summary? }
 */
async function reversePayment({ paymentId, actorId = null, reason, client: existingClient } = {}) {
  const pid = parseInt(paymentId, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'paymentId must be a positive integer' };
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'A valid reason for reversal is required' };
  }
  const cleanReason = reason.trim();

  const client = existingClient || await pool.primaryPool.connect();
  const ownsClient = !existingClient;
  let txOpen = false;

  const finish = async (r) => {
    if (txOpen) { await client.query('ROLLBACK'); txOpen = false; }
    return r;
  };

  try {
    await client.query('BEGIN');
    txOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [REVERSAL_LOCK_CLASS, pid]);

    // ── 1. Lock payment ──────────────────────────────────────────────
    const payR = await client.query(
      'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
      [pid]
    );
    const payment = payR.rows[0];
    if (!payment) {
      return await finish(conflict(CODES.PAYMENT_NOT_FOUND, `Payment id ${pid} not found`, 404));
    }

    const status = String(payment.status || '').toUpperCase();
    if (status === 'REVERSED' || status === 'CANCELLED') {
      return await finish({
        ok: true, code: CODES.ALREADY_REVERSED, httpStatus: 200, noop: true,
        message: `Payment ${payment.doc_number} is already ${status.toLowerCase()}`,
      });
    }
    if (status !== 'COMPLETED') {
      return await finish(conflict(
        CODES.STATUS_NOT_ELIGIBLE,
        `Payment ${payment.doc_number} has status ${payment.status}; only COMPLETED payments can be reversed`
      ));
    }

    // ── 2. The Phase 1A / 1B boundary ────────────────────────────────
    // A je_id pointing at a deleted JE means the GL effect is already
    // gone: a compensating entry here would double-correct the ledger.
    let jeRow = null;
    if (payment.je_id != null) {
      const jeR = await client.query('SELECT id, status FROM journal_entries WHERE id = $1', [payment.je_id]);
      jeRow = jeR.rows[0] || null;
      if (!jeRow) {
        return await finish(conflict(
          CODES.ORPHAN_PAYMENT_JE_MISSING,
          `Payment ${payment.doc_number} references journal entry ${payment.je_id} which no longer exists. ` +
          `This is a historical orphan payment — use the Phase 1A repair ` +
          `(scripts/reconcileOrphanedPayment.js), not the normal reversal engine.`
        ));
      }
    }

    // ── 3. Allocations: reverse in place, never delete ───────────────
    const allocR = await client.query(
      `SELECT id, purchase_note_id FROM payment_allocations
       WHERE payment_id = $1 AND status = 'ACTIVE'
       ORDER BY id ASC`,
      [pid]
    );
    const billIds = [...new Set(allocR.rows.map(a => parseInt(a.purchase_note_id, 10)))]
      .sort((a, b) => a - b);

    if (billIds.length > 0) {
      await client.query(
        'SELECT id FROM purchase_notes WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE',
        [billIds]
      );
    }

    if (allocR.rows.length > 0) {
      const revR = await client.query(
        `UPDATE payment_allocations
         SET status = 'REVERSED', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3
         WHERE payment_id = $1 AND status = 'ACTIVE'
         RETURNING id`,
        [pid, actorId, `PAYMENT_REVERSAL: ${cleanReason}`]
      );
      if (revR.rowCount !== allocR.rows.length) {
        throw Object.assign(
          new Error('Allocation reversal count mismatch — concurrent change, rolling back'),
          { code: CODES.CONCURRENT_CHANGE }
        );
      }
    }

    // ── 4. Vendor advances: reverse applications, then cancel ────────
    const advR = await client.query(
      'SELECT id, status FROM vendor_advances WHERE payment_id = $1 ORDER BY id ASC FOR UPDATE',
      [pid]
    );

    const reversedApplications = [];
    if (advR.rows.length > 0) {
      const appR = await client.query(
        `SELECT vaa.id, vaa.purchase_note_id
         FROM vendor_advance_applications vaa
         JOIN vendor_advances va ON va.id = vaa.advance_id
         WHERE va.payment_id = $1 AND vaa.status = 'APPLIED'
         ORDER BY vaa.id ASC`,
        [pid]
      );
      for (const app of appR.rows) {
        // Posts its own compensating JE, restores the advance, syncs the bill.
        const r = await reverseAdvanceApplication({ applicationId: app.id, userId: actorId, client });
        reversedApplications.push({ application_id: app.id, reversal_je_id: r.reversal_je_id, purchase_note_id: app.purchase_note_id });
      }

      // Whatever money returned to (or stayed in) the advances is now void:
      // the payment itself is being reversed.
      await client.query(
        `UPDATE vendor_advances
         SET status = 'CANCELLED', remaining_amount = 0, updated_at = NOW()
         WHERE payment_id = $1 AND status != 'CANCELLED'`,
        [pid]
      );
    }

    // ── 5. Recompute every affected bill from surviving allocations ──
    const allBillIds = [...new Set([
      ...billIds,
      ...reversedApplications.map(a => parseInt(a.purchase_note_id, 10)),
    ])].sort((a, b) => a - b);
    for (const billId of allBillIds) {
      await syncBillStatus(billId, client);
    }

    // ── 6. Compensating JE for the payment's own posting ─────────────
    let reversalJe = null;
    if (jeRow && String(jeRow.status).toLowerCase() === 'posted') {
      reversalJe = await journalEngine.reverseEntry(payment.je_id, {
        reason: `Payment ${payment.doc_number} reversed: ${cleanReason}`,
        userId: actorId,
        client,
      });
    }

    // ── 7. Terminal state ────────────────────────────────────────────
    const payUpd = await client.query(
      `UPDATE payments
       SET status = 'REVERSED',
           remark = COALESCE(remark, '') || $2,
           updated_at = NOW()
       WHERE id = $1 AND status = 'COMPLETED'
       RETURNING *`,
      [pid, ` [Reversed: ${cleanReason}]`]
    );
    if (payUpd.rowCount !== 1) {
      throw Object.assign(
        new Error(`Payment ${payment.doc_number} changed status mid-reversal — rolling back`),
        { code: CODES.CONCURRENT_CHANGE }
      );
    }

    await client.query('COMMIT');
    txOpen = false;

    return {
      ok: true,
      code: CODES.REVERSED,
      httpStatus: 200,
      message: `Payment ${payment.doc_number} successfully reversed`,
      payment: payUpd.rows[0],
      summary: {
        allocation_ids: allocR.rows.map(a => a.id),
        bill_ids: allBillIds,
        reversed_advance_applications: reversedApplications,
        reversal_je_id: reversalJe ? reversalJe.id : null,
      },
    };
  } catch (err) {
    if (txOpen) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection gone */ }
      txOpen = false;
    }
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

module.exports = {
  reversePayment,
  CODES,
  REVERSAL_LOCK_CLASS,
};

'use strict';

/**
 * ACCOUNTING PHASE 1A — HISTORICAL ORPHAN PAYMENT RECONCILIATION
 *
 * A payment is an ORPHANED PAYMENT when:
 *     payment exists
 * AND payments.je_id IS NOT NULL
 * AND the referenced journal_entries row does NOT exist.
 *
 * The original JE was physically deleted, so its Bank/AP GL effect is
 * already gone. This service reconciles the surviving document chain
 * (payment, allocations, bills, vendor advances) WITH the GL state that
 * already exists. It therefore must NEVER create a compensating JE and
 * must NEVER mutate journal_entries / je_lines / accounts.balance —
 * doing so would double-correct the ledger. That invariant is enforced
 * at runtime by a SQL guard wrapped around every query this service
 * issues (see createGlGuardedClient).
 *
 * This is NOT the generic reversal engine (Phase 1B). A payment whose
 * JE still exists is rejected with ORPHAN_PAYMENT_JE_EXISTS.
 *
 * CANONICAL ACTIVE-ALLOCATION PREDICATE
 *   A payment allocation contributes economically iff
 *       payment_allocations.status = 'ACTIVE'
 *   Every aggregate over payment_allocations in the codebase filters on
 *   this predicate (settlementService, openDocumentService, payments,
 *   vendors, reports, jeAllocations). Reversed rows stay in the table
 *   as historical evidence.
 */

const pool = require('../db/pool');
const { syncBillStatus } = require('./openDocumentService');

const OPERATION_TYPE = 'HISTORICAL_ORPHAN_PAYMENT_RECONCILIATION';

/** Canonical predicate — the single definition of "allocation counts". */
const ACTIVE_ALLOCATION_PREDICATE = "status = 'ACTIVE'";

/** Advisory-lock class for this repair (two-int form: class, payment id). */
const ORPHAN_LOCK_CLASS = 88001;

/** Machine-readable outcome codes. */
const CODES = Object.freeze({
  APPLIED:                             'APPLIED',
  DRY_RUN_OK:                          'DRY_RUN_OK',
  ALREADY_RECONCILED:                  'ALREADY_RECONCILED',
  PAYMENT_NOT_FOUND:                   'PAYMENT_NOT_FOUND',
  ORPHAN_PAYMENT_JE_EXISTS:            'ORPHAN_PAYMENT_JE_EXISTS',
  NOT_ORPHAN_NO_JE:                    'NOT_ORPHAN_NO_JE',
  STATUS_NOT_ELIGIBLE:                 'STATUS_NOT_ELIGIBLE',
  REFERENCE_MISMATCH:                  'REFERENCE_MISMATCH',
  AMOUNT_MISMATCH:                     'AMOUNT_MISMATCH',
  MISSING_JE_MISMATCH:                 'MISSING_JE_MISMATCH',
  ORPHAN_PAYMENT_HAS_APPLIED_ADVANCES: 'ORPHAN_PAYMENT_HAS_APPLIED_ADVANCES',
  CONCURRENT_CHANGE:                   'CONCURRENT_CHANGE',
  INVALID_INPUT:                       'INVALID_INPUT',
});

/**
 * SQL that would change the general ledger. Any match aborts the repair.
 * Kept deliberately broad: header, lines, and stored account balances.
 */
const GL_MUTATION_PATTERNS = [
  /^\s*insert\s+into\s+"?journal_entries\b/i,
  /^\s*update\s+"?journal_entries\b/i,
  /^\s*delete\s+from\s+"?journal_entries\b/i,
  /^\s*insert\s+into\s+"?je_lines\b/i,
  /^\s*update\s+"?je_lines\b/i,
  /^\s*delete\s+from\s+"?je_lines\b/i,
  /^\s*update\s+"?accounts\b/i,
];

class GlMutationAttemptError extends Error {
  constructor(sql) {
    super(`GL_MUTATION_BLOCKED: historical orphan reconciliation attempted a general-ledger mutation: ${String(sql).slice(0, 120)}`);
    this.name = 'GlMutationAttemptError';
    this.code = 'GL_MUTATION_BLOCKED';
  }
}

/**
 * Wrap a pg client so every query is screened against the GL mutation
 * patterns. The wrapper is what gets handed to every internal step,
 * INCLUDING the shared syncBillStatus/getBillSettlement helpers, so no
 * code path inside the repair can touch the ledger.
 */
function createGlGuardedClient(client) {
  let screened = 0;
  return {
    query(sql, params) {
      const text = typeof sql === 'string' ? sql : (sql && sql.text) || '';
      for (const pattern of GL_MUTATION_PATTERNS) {
        if (pattern.test(text)) throw new GlMutationAttemptError(text);
      }
      screened += 1;
      return client.query(sql, params);
    },
    get screenedCount() { return screened; },
  };
}

/** Conflict result helper (no throw — validation outcomes are data). */
function conflict(code, message, extra) {
  return { ok: false, code, httpStatus: 409, message, ...(extra || {}) };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Amounts travel as NUMERIC-rendered strings ("43932.00"). All arithmetic
 * happens inside PostgreSQL; JS only carries the strings. This normalises
 * a caller-supplied expected amount into a plain numeric string that is
 * safe to hand to a $n::numeric cast — no parseFloat anywhere.
 */
function normalizeAmountString(v) {
  const s = String(v == null ? '' : v).trim().replace(/,/g, '');
  return /^\d+(\.\d{1,2})?$/.test(s) ? s : null;
}

/**
 * Decimal-string equality without floating point: compares as scaled
 * integers using BigInt ("340000000.00" ≡ "340000000.0" ≡ "340000000").
 */
function numericEq(a, b) {
  const parse = (s) => {
    const m = String(s == null ? '' : s).trim().match(/^(-?)(\d+)(?:\.(\d*))?$/);
    if (!m) return null;
    const frac = (m[3] || '').padEnd(4, '0').slice(0, 4);
    return BigInt(m[1] + m[2] + frac);
  };
  const pa = parse(a);
  const pb = parse(b);
  return pa !== null && pb !== null && pa === pb;
}

/**
 * Reconcile one historical orphan payment.
 *
 * @param {Object} opts
 * @param {number}  opts.paymentId            payments.id
 * @param {string}  opts.expectedReference    payment doc_number (e.g. 'PAY-1179')
 * @param {string}  opts.expectedAmount       expected payment amount, decimal string
 * @param {number}  opts.expectedMissingJeId  the je_id the payment references
 * @param {number}  [opts.actorId]            users.id performing the repair
 * @param {string}  opts.reason               human reason (required for apply)
 * @param {boolean} [opts.dryRun=true]        no writes when true
 * @param {string}  opts.runId                UUID for audit correlation
 * @param {Object}  [opts.client]             existing pg client (test/route use);
 *                                            when absent the service owns the
 *                                            connection and transaction.
 * @returns {Object} { ok, code, httpStatus, message, report? }
 */
async function reconcileOrphanedPayment({
  paymentId,
  expectedReference,
  expectedAmount,
  expectedMissingJeId,
  actorId = null,
  reason,
  dryRun = true,
  runId,
  client: existingClient,
} = {}) {
  const pid = parseInt(paymentId, 10);
  const expectedJe = parseInt(expectedMissingJeId, 10);
  const amountStr = normalizeAmountString(expectedAmount);

  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'paymentId must be a positive integer' };
  }
  if (!isNonEmptyString(expectedReference)) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'expectedReference is required' };
  }
  if (!amountStr) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'expectedAmount must be a decimal string like "43932.00"' };
  }
  if (!Number.isInteger(expectedJe) || expectedJe <= 0) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'expectedMissingJeId must be a positive integer' };
  }
  if (!dryRun && !isNonEmptyString(reason)) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'A reason is mandatory for apply mode' };
  }
  if (!isNonEmptyString(runId)) {
    return { ok: false, code: CODES.INVALID_INPUT, httpStatus: 400, message: 'runId (UUID) is required for audit correlation' };
  }

  const rawClient = existingClient || await pool.primaryPool.connect();
  const ownsClient = !existingClient;
  const db = createGlGuardedClient(rawClient);

  let txOpen = false;

  /** Close the transaction for read-only/early exits, then return r. */
  const finish = async (r) => {
    if (txOpen) {
      await rawClient.query('ROLLBACK');
      txOpen = false;
    }
    return r;
  };

  try {
    // Dry-run runs inside a READ ONLY transaction so PostgreSQL itself
    // rejects any accidental write; apply runs in a normal transaction.
    await db.query(dryRun ? 'BEGIN READ ONLY' : 'BEGIN');
    txOpen = true;

    if (!dryRun) {
      // Serialise repairs of the same payment across processes.
      await db.query('SELECT pg_advisory_xact_lock($1, $2)', [ORPHAN_LOCK_CLASS, pid]);
    }

    // ── 1. Payment (locked in apply mode) ────────────────────────────
    const payR = await db.query(
      `/* ORPHAN_PAYMENT_FETCH */
       SELECT p.id, p.doc_number, p.reference_no, p.date::text AS date,
              p.vendor_id, v.name AS vendor_name,
              p.amount::text AS amount,
              (p.amount = $2::numeric) AS amount_matches,
              p.je_id, p.status, p.remark
       FROM payments p
       LEFT JOIN vendors v ON v.id = p.vendor_id
       WHERE p.id = $1
       ${dryRun ? '' : 'FOR UPDATE OF p'}`,
      [pid, amountStr]
    );
    const payment = payR.rows[0];
    if (!payment) {
      return await finish({ ok: false, code: CODES.PAYMENT_NOT_FOUND, httpStatus: 404, message: `Payment id ${pid} not found` });
    }

    const status = String(payment.status || '').toUpperCase();

    // ── 2. Idempotency ───────────────────────────────────────────────
    if (status === 'REVERSED' || status === 'CANCELLED') {
      const auditR = await db.query(
        `SELECT run_id, created_at FROM orphan_payment_reconciliation_audit
         WHERE payment_id = $1 AND operation_type = $2
         ORDER BY id ASC LIMIT 1`,
        [pid, OPERATION_TYPE]
      );
      const prior = auditR.rows[0];
      return await finish({
        ok: true,
        code: CODES.ALREADY_RECONCILED,
        httpStatus: 200,
        noop: true,
        message: prior
          ? `Payment ${payment.doc_number} was already historically reconciled (run ${prior.run_id})`
          : `Payment ${payment.doc_number} is already ${status}; nothing to reconcile`,
      });
    }

    if (status !== 'COMPLETED') {
      return await finish(conflict(
        CODES.STATUS_NOT_ELIGIBLE,
        `Payment ${payment.doc_number} has status ${payment.status}; only COMPLETED payments are eligible for historical orphan reconciliation`
      ));
    }

    // ── 3. Explicit two-person expectations (Stage 16) ───────────────
    if (payment.doc_number !== expectedReference.trim()) {
      return await finish(conflict(
        CODES.REFERENCE_MISMATCH,
        `Expected reference ${expectedReference} but payment ${pid} is ${payment.doc_number}`
      ));
    }
    if (payment.amount_matches !== true) {
      return await finish(conflict(
        CODES.AMOUNT_MISMATCH,
        `Expected amount ${amountStr} but payment ${payment.doc_number} is ${payment.amount}`
      ));
    }
    if (payment.je_id == null) {
      return await finish(conflict(
        CODES.NOT_ORPHAN_NO_JE,
        `Payment ${payment.doc_number} has no je_id; it is not an orphan payment`
      ));
    }
    if (parseInt(payment.je_id, 10) !== expectedJe) {
      return await finish(conflict(
        CODES.MISSING_JE_MISMATCH,
        `Expected missing JE ${expectedJe} but payment ${payment.doc_number} references JE ${payment.je_id}`
      ));
    }

    // ── 4. The orphan invariant itself ───────────────────────────────
    const jeR = await db.query(
      'SELECT id, je_number, status FROM journal_entries WHERE id = $1',
      [expectedJe]
    );
    if (jeR.rows.length > 0) {
      return await finish(conflict(
        CODES.ORPHAN_PAYMENT_JE_EXISTS,
        `Journal entry ${expectedJe} EXISTS (${jeR.rows[0].je_number || 'no number'}, status ${jeR.rows[0].status}). ` +
        `This is not an orphan repair case — a payment with an intact JE belongs to the normal reversal engine (Phase 1B).`
      ));
    }

    // ── 5. Allocations (history is evidence; never deleted) ──────────
    const allocR = await db.query(
      `SELECT id, purchase_note_id, amount::text AS amount, status
       FROM payment_allocations
       WHERE payment_id = $1
       ORDER BY id ASC`,
      [pid]
    );
    const activeAllocations = allocR.rows.filter(a => a.status === 'ACTIVE');
    const billIds = [...new Set(activeAllocations.map(a => parseInt(a.purchase_note_id, 10)))]
      .sort((a, b) => a - b); // deterministic ascending lock order

    // ── 6. Vendor advances tied to this payment ──────────────────────
    const advR = await db.query(
      `SELECT id, amount::text AS amount, remaining_amount::text AS remaining_amount, status
       FROM vendor_advances
       WHERE payment_id = $1
       ORDER BY id ASC
       ${dryRun ? '' : 'FOR UPDATE'}`,
      [pid]
    );
    const advances = advR.rows;

    if (advances.length > 0) {
      const appliedR = await db.query(
        `SELECT COUNT(*) AS applied_count
         FROM vendor_advance_applications vaa
         JOIN vendor_advances va ON va.id = vaa.advance_id
         WHERE va.payment_id = $1 AND vaa.status = 'APPLIED'`,
        [pid]
      );
      if (parseInt(appliedR.rows[0].applied_count, 10) > 0) {
        return await finish(conflict(
          CODES.ORPHAN_PAYMENT_HAS_APPLIED_ADVANCES,
          `Payment ${payment.doc_number} has vendor-advance applications with their own journal entries. ` +
          `Unwinding applied advances requires the generic reversal engine (Phase 1B) — manual review required.`
        ));
      }
    }

    // ── 7. Lock affected bills (apply), deterministic order ──────────
    if (!dryRun && billIds.length > 0) {
      await db.query(
        'SELECT id FROM purchase_notes WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE',
        [billIds]
      );
    }

    // ── 8. Before/after bill impact — all arithmetic in NUMERIC SQL ──
    let billImpacts = [];
    if (billIds.length > 0) {
      const impactR = await db.query(
        `/* ORPHAN_BILL_IMPACT */
         SELECT
           pn.id,
           pn.doc_number,
           pn.grand_total::text     AS grand_total,
           pn.amount_paid::text     AS before_paid,
           pn.balance_due::text     AS before_due,
           pn.payment_status        AS before_status,
           (COALESCE(pa_all.cash, 0) - COALESCE(pa_orphan.cash, 0)
             + COALESCE(ja.je_settled, 0)
             + COALESCE(vaa.advance_applied, 0)
             + COALESCE(btw.tds_withheld, 0))::text                     AS after_paid,
           GREATEST(pn.grand_total
             - (COALESCE(pa_all.cash, 0) - COALESCE(pa_orphan.cash, 0)
                + COALESCE(ja.je_settled, 0)
                + COALESCE(vaa.advance_applied, 0)
                + COALESCE(btw.tds_withheld, 0)), 0)::text              AS after_due,
           CASE
             WHEN pn.grand_total
                  - (COALESCE(pa_all.cash, 0) - COALESCE(pa_orphan.cash, 0)
                     + COALESCE(ja.je_settled, 0)
                     + COALESCE(vaa.advance_applied, 0)
                     + COALESCE(btw.tds_withheld, 0)) <= 0.005 THEN 'PAID'
             WHEN (COALESCE(pa_all.cash, 0) - COALESCE(pa_orphan.cash, 0)
                   + COALESCE(ja.je_settled, 0)
                   + COALESCE(vaa.advance_applied, 0)
                   + COALESCE(btw.tds_withheld, 0)) > 0.005 THEN 'PARTIAL'
             ELSE 'UNPAID'
           END                                                          AS after_status
         FROM purchase_notes pn
         LEFT JOIN (
           SELECT purchase_note_id, SUM(amount) AS cash
           FROM payment_allocations
           WHERE status = 'ACTIVE' AND purchase_note_id = ANY($1::int[])
           GROUP BY purchase_note_id
         ) pa_all ON pa_all.purchase_note_id = pn.id
         LEFT JOIN (
           SELECT purchase_note_id, SUM(amount) AS cash
           FROM payment_allocations
           WHERE status = 'ACTIVE' AND payment_id = $2
             AND purchase_note_id = ANY($1::int[])
           GROUP BY purchase_note_id
         ) pa_orphan ON pa_orphan.purchase_note_id = pn.id
         LEFT JOIN (
           SELECT target_id, SUM(allocated_amount) AS je_settled
           FROM je_allocations
           WHERE target_type = 'bill' AND target_id = ANY($1::int[])
           GROUP BY target_id
         ) ja ON ja.target_id = pn.id
         LEFT JOIN (
           SELECT purchase_note_id, SUM(amount) AS advance_applied
           FROM vendor_advance_applications
           WHERE status = 'APPLIED' AND purchase_note_id = ANY($1::int[])
           GROUP BY purchase_note_id
         ) vaa ON vaa.purchase_note_id = pn.id
         LEFT JOIN (
           SELECT purchase_note_id, SUM(tds_amount) AS tds_withheld
           FROM bill_tds_withholdings
           WHERE status = 'POSTED' AND purchase_note_id = ANY($1::int[])
           GROUP BY purchase_note_id
         ) btw ON btw.purchase_note_id = pn.id
         WHERE pn.id = ANY($1::int[])
         ORDER BY pn.id ASC`,
        [billIds, pid]
      );
      billImpacts = impactR.rows;
    }

    const openAdvances = advances.filter(a => String(a.status).toUpperCase() === 'OPEN');
    const advanceEffects = openAdvances.map(a => ({
      advance_id: a.id,
      before_status: a.status,
      before_remaining: a.remaining_amount,
      after_status: 'CANCELLED',
      after_remaining: '0.00',
    }));

    const report = {
      operation: OPERATION_TYPE,
      run_id: runId,
      mode: dryRun ? 'DRY_RUN' : 'APPLY',
      payment: {
        id: payment.id,
        reference: payment.doc_number,
        vendor_id: payment.vendor_id,
        vendor_name: payment.vendor_name,
        amount: payment.amount,
        date: payment.date,
        current_status: payment.status,
        after_status: 'REVERSED',
        missing_je_id: expectedJe,
      },
      allocations: allocR.rows.map(a => ({
        id: a.id,
        purchase_note_id: a.purchase_note_id,
        amount: a.amount,
        before_status: a.status,
        after_status: a.status === 'ACTIVE' ? 'REVERSED' : a.status,
      })),
      bills: billImpacts,
      advances: advanceEffects,
      gl: { journal_mutations: 0, je_line_mutations: 0, account_balance_mutations: 0 },
      audit_would_be_created: true,
    };

    // ── 9. Dry-run stops here: ZERO writes ───────────────────────────
    if (dryRun) {
      return await finish({
        ok: true,
        code: CODES.DRY_RUN_OK,
        httpStatus: 200,
        message: `Dry-run for ${payment.doc_number}: SAFE TO APPLY (no writes performed)`,
        report,
      });
    }

    // ── 10. APPLY — allocations become historical evidence ───────────
    if (activeAllocations.length > 0) {
      const revR = await db.query(
        `UPDATE payment_allocations
         SET status = 'REVERSED', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3
         WHERE payment_id = $1 AND status = 'ACTIVE'
         RETURNING id`,
        [pid, actorId, `${OPERATION_TYPE}: ${reason.trim()}`]
      );
      if (revR.rowCount !== activeAllocations.length) {
        throw Object.assign(
          new Error(`Allocation reversal count mismatch (expected ${activeAllocations.length}, got ${revR.rowCount}) — concurrent change, rolling back`),
          { code: CODES.CONCURRENT_CHANGE }
        );
      }
    }

    // ── 11. APPLY — open advances stop contributing ──────────────────
    if (openAdvances.length > 0) {
      const advUpd = await db.query(
        `UPDATE vendor_advances
         SET status = 'CANCELLED', remaining_amount = 0, updated_at = NOW()
         WHERE payment_id = $1 AND status = 'OPEN'
         RETURNING id`,
        [pid]
      );
      if (advUpd.rowCount !== openAdvances.length) {
        throw Object.assign(
          new Error('Vendor advance cancellation count mismatch — concurrent change, rolling back'),
          { code: CODES.CONCURRENT_CHANGE }
        );
      }
    }

    // ── 12. APPLY — recompute every bill from surviving allocations ──
    for (const impact of billImpacts) {
      await syncBillStatus(impact.id, db);
      const check = await db.query(
        `SELECT amount_paid::text AS amount_paid, balance_due::text AS balance_due, payment_status
         FROM purchase_notes WHERE id = $1`,
        [impact.id]
      );
      const stored = check.rows[0];
      const same = stored
        && numericEq(stored.amount_paid, impact.after_paid)
        && numericEq(stored.balance_due, impact.after_due)
        && stored.payment_status === impact.after_status;
      if (!same) {
        throw Object.assign(
          new Error(
            `Bill ${impact.doc_number} recompute verification failed: ` +
            `stored [${stored && stored.amount_paid}/${stored && stored.balance_due}/${stored && stored.payment_status}] ` +
            `vs expected [${impact.after_paid}/${impact.after_due}/${impact.after_status}] — rolling back`
          ),
          { code: CODES.CONCURRENT_CHANGE }
        );
      }
    }

    // ── 13. APPLY — payment reaches its terminal state ───────────────
    const payUpd = await db.query(
      `UPDATE payments
       SET status = 'REVERSED',
           remark = COALESCE(remark, '') || $2,
           updated_at = NOW()
       WHERE id = $1 AND status = 'COMPLETED'
       RETURNING id`,
      [pid, ` [${OPERATION_TYPE}: ${reason.trim()}]`]
    );
    if (payUpd.rowCount !== 1) {
      throw Object.assign(
        new Error(`Payment ${payment.doc_number} changed status mid-repair — rolling back`),
        { code: CODES.CONCURRENT_CHANGE }
      );
    }

    // ── 14. APPLY — durable audit (unique per payment) ───────────────
    await db.query(
      `INSERT INTO orphan_payment_reconciliation_audit
         (run_id, operation_type, payment_id, payment_reference, vendor_id,
          vendor_name, amount, missing_je_id, reason, actor_id,
          payment_status_before, payment_status_after,
          allocation_ids, bill_ids, bill_effects, advance_effects,
          gl_mutation_performed)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10,
               $11, $12, $13::int[], $14::int[], $15::jsonb, $16::jsonb, FALSE)`,
      [
        runId, OPERATION_TYPE, pid, payment.doc_number, payment.vendor_id,
        payment.vendor_name, payment.amount, expectedJe, reason.trim(), actorId,
        'COMPLETED', 'REVERSED',
        activeAllocations.map(a => a.id),
        billIds,
        JSON.stringify(billImpacts.map(b => ({
          bill_id: b.id,
          doc_number: b.doc_number,
          before_paid: b.before_paid,
          after_paid: b.after_paid,
          before_due: b.before_due,
          after_due: b.after_due,
          before_status: b.before_status,
          after_status: b.after_status,
        }))),
        JSON.stringify(advanceEffects),
      ]
    );

    // ── 15. Hard invariant re-assert before COMMIT ───────────────────
    const jeRecheck = await db.query('SELECT 1 FROM journal_entries WHERE id = $1', [expectedJe]);
    if (jeRecheck.rows.length > 0) {
      throw Object.assign(
        new Error(`Journal entry ${expectedJe} appeared during the repair — rolling back`),
        { code: CODES.ORPHAN_PAYMENT_JE_EXISTS }
      );
    }

    await db.query('COMMIT');
    txOpen = false;

    return {
      ok: true,
      code: CODES.APPLIED,
      httpStatus: 200,
      message: `Payment ${payment.doc_number} historically reconciled (GL untouched, allocations preserved as REVERSED)`,
      report,
    };
  } catch (err) {
    if (txOpen) {
      try { await rawClient.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
      txOpen = false;
    }
    throw err;
  } finally {
    if (ownsClient) rawClient.release();
  }
}

/** Human-readable Stage-33 dry-run/apply report. */
function formatReport(result) {
  const r = result.report;
  if (!r) return `${result.code}: ${result.message}`;
  const lines = [];
  const push = (s) => lines.push(s);

  push('='.repeat(64));
  push(`${r.operation} — ${r.mode}`);
  push(`Run: ${r.run_id}`);
  push('='.repeat(64));
  push('');
  push('PAYMENT');
  push(`  Reference:      ${r.payment.reference}`);
  push(`  ID:             ${r.payment.id}`);
  push(`  Vendor:         ${r.payment.vendor_name || r.payment.vendor_id}`);
  push(`  Amount:         ${r.payment.amount}`);
  push(`  Current Status: ${r.payment.current_status}`);
  push(`  After Status:   ${r.payment.after_status}`);
  push(`  Missing JE:     ${r.payment.missing_je_id}`);
  push('');
  push('ALLOCATIONS');
  if (r.allocations.length === 0) push('  (none)');
  for (const a of r.allocations) {
    push(`  #${a.id} bill=${a.purchase_note_id} amount=${a.amount} ${a.before_status} -> ${a.after_status}`);
  }
  push('');
  push('AFFECTED BILLS');
  if (r.bills.length === 0) push('  (none)');
  for (const b of r.bills) {
    push(`  Bill: ${b.doc_number} (id ${b.id}, total ${b.grand_total})`);
    push(`    Before Paid:   ${b.before_paid}`);
    push(`    After Paid:    ${b.after_paid}`);
    push(`    Before Due:    ${b.before_due}`);
    push(`    After Due:     ${b.after_due}`);
    push(`    Before Status: ${b.before_status}`);
    push(`    After Status:  ${b.after_status}`);
  }
  push('');
  push('VENDOR ADVANCES');
  if (r.advances.length === 0) push('  (none)');
  for (const adv of r.advances) {
    push(`  #${adv.advance_id} ${adv.before_status} (remaining ${adv.before_remaining}) -> ${adv.after_status} (remaining ${adv.after_remaining})`);
  }
  push('');
  push('GL');
  push(`  Journal mutations:         ${r.gl.journal_mutations}`);
  push(`  JE-line mutations:         ${r.gl.je_line_mutations}`);
  push(`  Account-balance mutations: ${r.gl.account_balance_mutations}`);
  push('');
  push('AUDIT');
  push(`  Would create reconciliation audit: ${r.audit_would_be_created ? 'YES' : 'NO'}`);
  push('');
  push(`RESULT: ${result.ok ? (r.mode === 'DRY_RUN' ? 'SAFE TO APPLY' : 'APPLIED') : 'BLOCKED'}`);
  push('='.repeat(64));
  return lines.join('\n');
}

module.exports = {
  reconcileOrphanedPayment,
  formatReport,
  createGlGuardedClient,
  GlMutationAttemptError,
  GL_MUTATION_PATTERNS,
  ACTIVE_ALLOCATION_PREDICATE,
  OPERATION_TYPE,
  ORPHAN_LOCK_CLASS,
  CODES,
  numericEq,
  normalizeAmountString,
};

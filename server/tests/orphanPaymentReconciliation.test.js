'use strict';

/**
 * ACCOUNTING PHASE 1A — Historical Orphan Payment Reconciliation suite.
 *
 * No PostgreSQL required: db/pool is stubbed through require.cache and the
 * service is driven against an in-memory fake database that
 *   - executes the service's SQL against JS tables,
 *   - does ALL money arithmetic in integer cents via BigInt (decimal-exact,
 *     proving the ₹3,40,00,000.00 case without JS float involvement),
 *   - snapshots tables on BEGIN and restores them on ROLLBACK (so the
 *     audit-failure test proves a REAL all-or-nothing rollback),
 *   - records every SQL string, so each scenario asserts ZERO general-ledger
 *     mutations (Stage 28),
 *   - rejects any write inside a READ ONLY transaction (dry-run guarantee).
 *
 * Run with:  node --test tests/orphanPaymentReconciliation.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');

// ── Stub db/pool BEFORE loading any service ──────────────────────────────────
const poolPath = require.resolve('../db/pool');
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    query: async () => { throw new Error('fake pool: use an explicit client'); },
    primaryPool: {
      connect: async () => { throw new Error('fake pool: tests must pass a client'); },
      end: async () => {},
    },
    connect: async () => { throw new Error('fake pool: tests must pass a client'); },
  },
};

const {
  reconcileOrphanedPayment,
  formatReport,
  createGlGuardedClient,
  GlMutationAttemptError,
  GL_MUTATION_PATTERNS,
  CODES,
  numericEq,
  normalizeAmountString,
} = require('../services/orphanPaymentReconciliation');

// ═════════════════════════ cents helpers (BigInt) ════════════════════════════

function toCents(v) {
  const m = String(v == null ? '0' : v).trim().match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) throw new Error(`fake db: not a decimal string: ${v}`);
  return BigInt((m[1] || '') + m[2] + (m[3] || '').padEnd(2, '0'));
}
function centsToStr(c) {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const s = abs.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}
// Emulates NUMERIC storage of a JS number arriving from settlementService.
function numberToCents(n) {
  return toCents(Number(n).toFixed(2));
}

// ═════════════════════════ fake database ═════════════════════════════════════

class FakeDb {
  constructor(seed) {
    this.t = {
      vendors: [], payments: [], purchase_notes: [], payment_allocations: [],
      journal_entries: [], vendor_advances: [], vendor_advance_applications: [],
      je_allocations: [], bill_tds_withholdings: [], orphan_audit: [],
      ...(seed || {}),
    };
    this.log = [];
    this.snapshot = null;
    this.readOnly = false;
    this.failOnAuditInsert = false;
    this.beforeHooks = []; // [{re, fn}] — fire once each
  }

  interceptBefore(re, fn) { this.beforeHooks.push({ re, fn }); }

  _snap() { return JSON.parse(JSON.stringify(this.t)); }

  settlementFor(billId, { excludePaymentId = null } = {}) {
    const pn = this.t.purchase_notes.find(b => b.id === billId);
    if (!pn) return null;
    const cash = this.t.payment_allocations
      .filter(a => a.purchase_note_id === billId && a.status === 'ACTIVE'
        && (excludePaymentId == null || a.payment_id !== excludePaymentId))
      .reduce((s, a) => s + toCents(a.amount), 0n);
    const je = this.t.je_allocations
      .filter(a => a.target_type === 'bill' && a.target_id === billId)
      .reduce((s, a) => s + toCents(a.allocated_amount), 0n);
    const adv = this.t.vendor_advance_applications
      .filter(a => a.purchase_note_id === billId && a.status === 'APPLIED')
      .reduce((s, a) => s + toCents(a.amount), 0n);
    const tds = this.t.bill_tds_withholdings
      .filter(a => a.purchase_note_id === billId && a.status === 'POSTED')
      .reduce((s, a) => s + toCents(a.tds_amount), 0n);
    const gross = toCents(pn.grand_total);
    const settled = cash + je + adv + tds;
    const raw = gross - settled;
    const status = raw <= 0n ? 'PAID' : (settled > 0n ? 'PARTIAL' : 'UNPAID');
    return { pn, cash, je, adv, tds, gross, settled, raw, due: raw > 0n ? raw : 0n, status };
  }

  async query(sql, params = []) {
    const text = typeof sql === 'string' ? sql : (sql && sql.text) || '';
    this.log.push(text);
    const norm = text.replace(/\s+/g, ' ').trim();

    for (let i = 0; i < this.beforeHooks.length; i++) {
      const h = this.beforeHooks[i];
      if (h.re.test(norm)) {
        this.beforeHooks.splice(i, 1);
        h.fn(this);
        break;
      }
    }

    // transactions
    if (/^BEGIN READ ONLY$/i.test(norm)) { this.snapshot = this._snap(); this.readOnly = true; return { rows: [], rowCount: 0 }; }
    if (/^BEGIN$/i.test(norm)) { this.snapshot = this._snap(); this.readOnly = false; return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(norm)) { this.snapshot = null; this.readOnly = false; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK$/i.test(norm)) {
      if (this.snapshot) this.t = this.snapshot;
      this.snapshot = null; this.readOnly = false;
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(norm)) return { rows: [], rowCount: 0 };

    const isWrite = /^(INSERT|UPDATE|DELETE)\b/i.test(norm);
    if (isWrite && this.readOnly) {
      throw new Error('fake db: cannot execute a write in a read-only transaction');
    }

    // ── payment fetch ──
    if (norm.includes('ORPHAN_PAYMENT_FETCH')) {
      const p = this.t.payments.find(x => x.id === params[0]);
      if (!p) return { rows: [], rowCount: 0 };
      const v = this.t.vendors.find(x => x.id === p.vendor_id);
      return {
        rows: [{
          id: p.id, doc_number: p.doc_number, reference_no: p.reference_no || null,
          date: p.date, vendor_id: p.vendor_id, vendor_name: v ? v.name : null,
          amount: p.amount, amount_matches: toCents(p.amount) === toCents(params[1]),
          je_id: p.je_id, status: p.status, remark: p.remark || null,
        }],
        rowCount: 1,
      };
    }

    // ── idempotency audit lookup ──
    if (norm.includes('FROM orphan_payment_reconciliation_audit')) {
      const rows = this.t.orphan_audit
        .filter(a => a.payment_id === params[0] && a.operation_type === params[1])
        .slice(0, 1)
        .map(a => ({ run_id: a.run_id, created_at: a.created_at }));
      return { rows, rowCount: rows.length };
    }

    // ── journal entry existence checks ──
    if (/SELECT id, je_number, status FROM journal_entries WHERE id = \$1/.test(norm)
      || /SELECT 1 FROM journal_entries WHERE id = \$1/.test(norm)) {
      const je = this.t.journal_entries.find(x => x.id === params[0]);
      return je
        ? { rows: [{ id: je.id, je_number: je.je_number, status: je.status }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    // ── allocations for payment ──
    if (norm.includes('FROM payment_allocations WHERE payment_id = $1 ORDER BY id ASC')) {
      const rows = this.t.payment_allocations
        .filter(a => a.payment_id === params[0])
        .sort((a, b) => a.id - b.id)
        .map(a => ({ id: a.id, purchase_note_id: a.purchase_note_id, amount: a.amount, status: a.status }));
      return { rows, rowCount: rows.length };
    }

    // ── advances for payment ──
    if (norm.includes('FROM vendor_advances WHERE payment_id = $1 ORDER BY id ASC')) {
      const rows = this.t.vendor_advances
        .filter(a => a.payment_id === params[0])
        .sort((a, b) => a.id - b.id)
        .map(a => ({ id: a.id, amount: a.amount, remaining_amount: a.remaining_amount, status: a.status }));
      return { rows, rowCount: rows.length };
    }

    // ── applied-advance count ──
    if (norm.includes('AS applied_count')) {
      const advIds = this.t.vendor_advances.filter(a => a.payment_id === params[0]).map(a => a.id);
      const n = this.t.vendor_advance_applications
        .filter(a => advIds.includes(a.advance_id) && a.status === 'APPLIED').length;
      return { rows: [{ applied_count: String(n) }], rowCount: 1 };
    }

    // ── bill lock ──
    if (norm.includes('SELECT id FROM purchase_notes WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE')) {
      const rows = this.t.purchase_notes.filter(b => params[0].includes(b.id)).map(b => ({ id: b.id }));
      return { rows, rowCount: rows.length };
    }

    // ── before/after impact ──
    if (norm.includes('ORPHAN_BILL_IMPACT')) {
      assert.ok(norm.includes("status = 'ACTIVE'"), 'impact SQL must carry the canonical active predicate');
      const rows = params[0].slice().sort((a, b) => a - b).map(billId => {
        const s = this.settlementFor(billId, { excludePaymentId: params[1] });
        return {
          id: s.pn.id,
          doc_number: s.pn.doc_number,
          grand_total: centsToStr(s.gross),
          before_paid: s.pn.amount_paid,
          before_due: s.pn.balance_due,
          before_status: s.pn.payment_status,
          after_paid: centsToStr(s.settled),
          after_due: centsToStr(s.due),
          after_status: s.status,
        };
      });
      return { rows, rowCount: rows.length };
    }

    // ── settlementService.getBillSettlement (canonical recompute) ──
    if (norm.includes('stored_payment_status') && norm.includes('cash_paid') && norm.includes('WHERE pn.id = $1')) {
      assert.ok(norm.includes("status = 'ACTIVE'"),
        'settlementService must filter payment_allocations on the canonical active predicate');
      const s = this.settlementFor(params[0]);
      if (!s) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: s.pn.id, doc_number: s.pn.doc_number, doc_date: s.pn.doc_date || null,
          vendor_id: s.pn.vendor_id, grand_total: centsToStr(s.gross),
          payment_term: s.pn.payment_term || null, status: s.pn.status || 'posted',
          stored_payment_status: s.pn.payment_status,
          stored_amount_paid: s.pn.amount_paid,
          stored_balance_due: s.pn.balance_due,
          cash_paid: centsToStr(s.cash),
          je_settled: centsToStr(s.je),
          advance_applied: centsToStr(s.adv),
          tds_withheld: centsToStr(s.tds),
        }],
        rowCount: 1,
      };
    }

    // ── mutations ──
    if (norm.startsWith("UPDATE payment_allocations SET status = 'REVERSED'")) {
      const hit = this.t.payment_allocations.filter(a => a.payment_id === params[0] && a.status === 'ACTIVE');
      for (const a of hit) {
        a.status = 'REVERSED';
        a.reversed_at = '2026-08-17T00:00:00Z';
        a.reversed_by = params[1];
        a.reversal_reason = params[2];
      }
      return { rows: hit.map(a => ({ id: a.id })), rowCount: hit.length };
    }

    if (norm.startsWith("UPDATE vendor_advances SET status = 'CANCELLED'")) {
      const hit = this.t.vendor_advances.filter(a => a.payment_id === params[0] && a.status === 'OPEN');
      for (const a of hit) { a.status = 'CANCELLED'; a.remaining_amount = '0.00'; }
      return { rows: hit.map(a => ({ id: a.id })), rowCount: hit.length };
    }

    if (norm.startsWith('UPDATE purchase_notes SET amount_paid = $1, balance_due = $2, payment_status = $3')) {
      const pn = this.t.purchase_notes.find(b => b.id === params[3]);
      if (!pn) return { rows: [], rowCount: 0 };
      pn.amount_paid = centsToStr(numberToCents(params[0]));
      pn.balance_due = centsToStr(numberToCents(params[1]));
      pn.payment_status = params[2];
      return { rows: [], rowCount: 1 };
    }

    if (norm.includes('SELECT amount_paid::text AS amount_paid, balance_due::text AS balance_due, payment_status FROM purchase_notes WHERE id = $1')) {
      const pn = this.t.purchase_notes.find(b => b.id === params[0]);
      return pn
        ? { rows: [{ amount_paid: pn.amount_paid, balance_due: pn.balance_due, payment_status: pn.payment_status }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (norm.startsWith("UPDATE payments SET status = 'REVERSED'")) {
      const p = this.t.payments.find(x => x.id === params[0] && x.status === 'COMPLETED');
      if (!p) return { rows: [], rowCount: 0 };
      p.status = 'REVERSED';
      p.remark = (p.remark || '') + params[1];
      return { rows: [{ id: p.id }], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO orphan_payment_reconciliation_audit')) {
      if (this.failOnAuditInsert) throw new Error('fake db: simulated audit insert failure');
      if (this.t.orphan_audit.some(a => a.payment_id === params[2])) {
        throw new Error('fake db: unique violation on uq_orphan_recon_payment');
      }
      this.t.orphan_audit.push({
        run_id: params[0], operation_type: params[1], payment_id: params[2],
        payment_reference: params[3], vendor_id: params[4], vendor_name: params[5],
        amount: params[6], missing_je_id: params[7], reason: params[8], actor_id: params[9],
        payment_status_before: params[10], payment_status_after: params[11],
        allocation_ids: params[12], bill_ids: params[13],
        bill_effects: JSON.parse(params[14]), advance_effects: JSON.parse(params[15]),
        gl_mutation_performed: false, created_at: '2026-08-17T00:00:00Z',
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`fake db: unhandled SQL: ${norm.slice(0, 160)}`);
  }
}

/** Assert no general-ledger mutation SQL was ever issued (Stage 28). */
function assertZeroGlMutations(db) {
  for (const sql of db.log) {
    for (const p of GL_MUTATION_PATTERNS) {
      assert.ok(!p.test(sql), `GL mutation SQL detected: ${sql.slice(0, 120)}`);
    }
  }
}

// ═════════════════════════ fixtures ══════════════════════════════════════════

const RUN_ID = '00000000-0000-4000-8000-000000000001';

/** PAY-1179-shaped fixture: one COMPLETED payment fully paying one bill,
 *  je_id points at a journal entry that does not exist. */
function fixture1179() {
  return new FakeDb({
    vendors: [{ id: 10, name: 'ICHHAPORE-LIKE TEXTILE FIXTURE LTD' }],
    journal_entries: [], // JE 605 deliberately missing
    payments: [{
      id: 900, doc_number: 'PAY-9001', date: '2025-11-04', vendor_id: 10,
      amount: '43932.00', je_id: 605, status: 'COMPLETED', remark: '',
    }],
    purchase_notes: [{
      id: 70, doc_number: 'BILL-7001', vendor_id: 10, grand_total: '43932.00',
      amount_paid: '43932.00', balance_due: '0.00', payment_status: 'PAID', status: 'posted',
    }],
    payment_allocations: [{
      id: 500, payment_id: 900, purchase_note_id: 70, amount: '43932.00', status: 'ACTIVE',
    }],
  });
}

/** PAY-1240-shaped fixture: ₹3,40,00,000.00 payment, missing JE 1180. */
function fixture1240() {
  return new FakeDb({
    vendors: [{ id: 11, name: 'GREEND-LIKE TECHNOLOGIES FIXTURE LLP' }],
    journal_entries: [],
    payments: [{
      id: 901, doc_number: 'PAY-9002', date: '2026-01-20', vendor_id: 11,
      amount: '34000000.00', je_id: 1180, status: 'COMPLETED', remark: '',
    }],
    purchase_notes: [{
      id: 71, doc_number: 'BILL-7101', vendor_id: 11, grand_total: '34000000.00',
      amount_paid: '34000000.00', balance_due: '0.00', payment_status: 'PAID', status: 'posted',
    }],
    payment_allocations: [{
      id: 501, payment_id: 901, purchase_note_id: 71, amount: '34000000.00', status: 'ACTIVE',
    }],
  });
}

const ARGS_1179 = {
  paymentId: 900, expectedReference: 'PAY-9001', expectedAmount: '43932.00',
  expectedMissingJeId: 605, actorId: 1, reason: 'fixture repair', runId: RUN_ID,
};

// ═════════════════════════ 1. dry-run ════════════════════════════════════════

test('dry-run computes full impact and performs ZERO writes', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: true, client: db });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.code, CODES.DRY_RUN_OK);
  assert.strictEqual(res.report.mode, 'DRY_RUN');
  assert.strictEqual(res.report.payment.reference, 'PAY-9001');
  assert.strictEqual(res.report.bills.length, 1);
  const b = res.report.bills[0];
  assert.strictEqual(b.before_paid, '43932.00');
  assert.strictEqual(b.after_paid, '0.00');
  assert.strictEqual(b.before_status, 'PAID');
  assert.strictEqual(b.after_status, 'UNPAID');
  assert.strictEqual(res.report.gl.journal_mutations, 0);

  // nothing changed
  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations[0].status, 'ACTIVE');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PAID');
  assert.strictEqual(db.t.orphan_audit.length, 0);
  assert.ok(!db.log.some(s => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s)), 'dry-run must not write');
  assert.ok(db.log.some(s => /BEGIN READ ONLY/i.test(s)), 'dry-run runs READ ONLY');
  assertZeroGlMutations(db);

  // Stage 33 report renders
  const text = formatReport(res);
  assert.match(text, /SAFE TO APPLY/);
  assert.match(text, /Journal mutations:\s+0/);
});

// ═════════════════════════ 2. PAY-1179 fixture apply ═════════════════════════

test('PAY-1179 fixture: apply reverses payment, preserves allocation, bill returns to UNPAID', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.code, CODES.APPLIED);

  const p = db.t.payments[0];
  assert.strictEqual(p.status, 'REVERSED');
  assert.match(p.remark, /HISTORICAL_ORPHAN_PAYMENT_RECONCILIATION/);

  const a = db.t.payment_allocations[0];
  assert.strictEqual(a.status, 'REVERSED', 'allocation is reversed, not deleted');
  assert.ok(a.reversed_at, 'reversal timestamp recorded');
  assert.strictEqual(db.t.payment_allocations.length, 1, 'allocation row retained as evidence');

  const bill = db.t.purchase_notes[0];
  assert.strictEqual(bill.amount_paid, '0.00');
  assert.strictEqual(bill.balance_due, '43932.00');
  assert.strictEqual(bill.payment_status, 'UNPAID');

  assert.strictEqual(db.t.orphan_audit.length, 1);
  const audit = db.t.orphan_audit[0];
  assert.strictEqual(audit.gl_mutation_performed, false);
  assert.strictEqual(audit.payment_reference, 'PAY-9001');
  assert.deepStrictEqual(audit.allocation_ids, [500]);
  assert.deepStrictEqual(audit.bill_ids, [70]);
  assert.strictEqual(audit.bill_effects[0].after_status, 'UNPAID');

  assert.strictEqual(db.t.journal_entries.length, 0, 'no JE was created');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 3. PAY-1240 fixture (large NUMERIC) ═══════════════

test('PAY-1240 fixture: ₹3,40,00,000.00 reconciles with exact decimal arithmetic', async () => {
  const db = fixture1240();
  const res = await reconcileOrphanedPayment({
    paymentId: 901, expectedReference: 'PAY-9002', expectedAmount: '34000000.00',
    expectedMissingJeId: 1180, actorId: 1, reason: 'fixture repair', runId: RUN_ID,
    dryRun: false, client: db,
  });

  assert.strictEqual(res.code, CODES.APPLIED);
  assert.strictEqual(db.t.payments[0].status, 'REVERSED');
  assert.strictEqual(db.t.purchase_notes[0].amount_paid, '0.00');
  assert.strictEqual(db.t.purchase_notes[0].balance_due, '34000000.00');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'UNPAID');
  assert.strictEqual(db.t.orphan_audit[0].amount, '34000000.00');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 4. multi-bill payment ═════════════════════════════

test('one orphan payment across two bills: every bill recomputed independently', async () => {
  const db = fixture1179();
  // second bill: orphan pays 40k of 100k, another (healthy) payment pays 60k
  db.t.purchase_notes.push({
    id: 72, doc_number: 'BILL-7201', vendor_id: 10, grand_total: '100000.00',
    amount_paid: '100000.00', balance_due: '0.00', payment_status: 'PAID', status: 'posted',
  });
  db.t.payments[0].amount = '83932.00'; // 43932 + 40000
  db.t.payments.push({
    id: 910, doc_number: 'PAY-9100', date: '2025-11-05', vendor_id: 10,
    amount: '60000.00', je_id: 4242, status: 'COMPLETED', remark: '',
  });
  db.t.journal_entries.push({ id: 4242, je_number: 'JE-4242', status: 'posted' });
  db.t.payment_allocations.push(
    { id: 510, payment_id: 900, purchase_note_id: 72, amount: '40000.00', status: 'ACTIVE' },
    { id: 511, payment_id: 910, purchase_note_id: 72, amount: '60000.00', status: 'ACTIVE' },
  );

  const res = await reconcileOrphanedPayment({
    ...ARGS_1179, expectedAmount: '83932.00', dryRun: false, client: db,
  });
  assert.strictEqual(res.code, CODES.APPLIED);

  const bill1 = db.t.purchase_notes.find(b => b.id === 70);
  assert.strictEqual(bill1.payment_status, 'UNPAID');

  // multi-payment bill safety: PAY-9100's 60k survives → PARTIAL
  const bill2 = db.t.purchase_notes.find(b => b.id === 72);
  assert.strictEqual(bill2.amount_paid, '60000.00');
  assert.strictEqual(bill2.balance_due, '40000.00');
  assert.strictEqual(bill2.payment_status, 'PARTIAL');

  // healthy payment untouched
  const healthy = db.t.payments.find(p => p.id === 910);
  assert.strictEqual(healthy.status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations.find(a => a.id === 511).status, 'ACTIVE');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 5. bill stays PAID via other allocations ══════════

test('bill remains PAID when surviving allocations still fully cover it', async () => {
  const db = fixture1179();
  // another payment fully covers bill 70 on its own
  db.t.payments.push({
    id: 911, doc_number: 'PAY-9110', date: '2025-11-06', vendor_id: 10,
    amount: '43932.00', je_id: 4243, status: 'COMPLETED', remark: '',
  });
  db.t.journal_entries.push({ id: 4243, je_number: 'JE-4243', status: 'posted' });
  db.t.payment_allocations.push(
    { id: 512, payment_id: 911, purchase_note_id: 70, amount: '43932.00', status: 'ACTIVE' },
  );
  db.t.purchase_notes[0].amount_paid = '87864.00'; // over-settled historically

  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(res.code, CODES.APPLIED);

  const bill = db.t.purchase_notes[0];
  assert.strictEqual(bill.amount_paid, '43932.00');
  assert.strictEqual(bill.balance_due, '0.00');
  assert.strictEqual(bill.payment_status, 'PAID');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 6. partial allocation + open advance ══════════════

test('partially applied orphan with OPEN advance: advance cancelled, remaining zeroed', async () => {
  const db = fixture1179();
  db.t.payments[0].amount = '60000.00'; // 43932 to bill, 16068 on account
  db.t.vendor_advances.push({
    id: 300, payment_id: 900, vendor_id: 10, amount: '16068.00',
    remaining_amount: '16068.00', status: 'OPEN',
  });

  const res = await reconcileOrphanedPayment({
    ...ARGS_1179, expectedAmount: '60000.00', dryRun: false, client: db,
  });
  assert.strictEqual(res.code, CODES.APPLIED);

  const adv = db.t.vendor_advances[0];
  assert.strictEqual(adv.status, 'CANCELLED');
  assert.strictEqual(adv.remaining_amount, '0.00');
  assert.strictEqual(db.t.orphan_audit[0].advance_effects[0].before_remaining, '16068.00');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 7. applied advances block the repair ══════════════

test('orphan with APPLIED vendor-advance applications is rejected (Phase 1B territory)', async () => {
  const db = fixture1179();
  db.t.vendor_advances.push({
    id: 301, payment_id: 900, vendor_id: 10, amount: '10000.00',
    remaining_amount: '0.00', status: 'APPLIED',
  });
  db.t.vendor_advance_applications.push({
    id: 400, advance_id: 301, purchase_note_id: 70, amount: '10000.00', status: 'APPLIED', je_id: 777,
  });

  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.ORPHAN_PAYMENT_HAS_APPLIED_ADVANCES);
  assert.strictEqual(res.httpStatus, 409);
  assert.strictEqual(db.t.payments[0].status, 'COMPLETED', 'zero mutation on rejection');
  assert.strictEqual(db.t.payment_allocations[0].status, 'ACTIVE');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 8. original JE exists → 409 ═══════════════════════

test('ORPHAN_PAYMENT_JE_EXISTS: payment with intact JE is rejected with zero mutation', async () => {
  const db = fixture1179();
  db.t.journal_entries.push({ id: 605, je_number: 'JE-605', status: 'posted' });

  for (const dryRun of [true, false]) {
    const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun, client: db });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, CODES.ORPHAN_PAYMENT_JE_EXISTS);
    assert.strictEqual(res.httpStatus, 409);
  }
  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations[0].status, 'ACTIVE');
  assert.strictEqual(db.t.orphan_audit.length, 0);
  assertZeroGlMutations(db);
});

// ═════════════════════════ 9. non-orphan rejections ══════════════════════════

test('payment without je_id is rejected', async () => {
  const db = fixture1179();
  db.t.payments[0].je_id = null;
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(res.code, CODES.NOT_ORPHAN_NO_JE);
  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assertZeroGlMutations(db);
});

test('reference mismatch is rejected', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({
    ...ARGS_1179, expectedReference: 'PAY-WRONG', dryRun: false, client: db,
  });
  assert.strictEqual(res.code, CODES.REFERENCE_MISMATCH);
  assertZeroGlMutations(db);
});

test('amount mismatch is rejected', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({
    ...ARGS_1179, expectedAmount: '43933.00', dryRun: false, client: db,
  });
  assert.strictEqual(res.code, CODES.AMOUNT_MISMATCH);
  assertZeroGlMutations(db);
});

test('expected missing-JE mismatch is rejected', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({
    ...ARGS_1179, expectedMissingJeId: 606, dryRun: false, client: db,
  });
  assert.strictEqual(res.code, CODES.MISSING_JE_MISMATCH);
  assertZeroGlMutations(db);
});

test('non-COMPLETED (draft-like) payment is rejected', async () => {
  const db = fixture1179();
  db.t.payments[0].status = 'DRAFT';
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(res.code, CODES.STATUS_NOT_ELIGIBLE);
  assertZeroGlMutations(db);
});

test('unknown payment id returns PAYMENT_NOT_FOUND', async () => {
  const db = fixture1179();
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, paymentId: 999999, dryRun: false, client: db });
  assert.strictEqual(res.code, CODES.PAYMENT_NOT_FOUND);
  assert.strictEqual(res.httpStatus, 404);
});

// ═════════════════════════ 10. idempotency ═══════════════════════════════════

test('second reconciliation returns ALREADY_RECONCILED with zero further change', async () => {
  const db = fixture1179();
  const first = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(first.code, CODES.APPLIED);

  const snapshot = JSON.stringify(db.t);
  const second = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.code, CODES.ALREADY_RECONCILED);
  assert.match(second.message, /already historically reconciled/);
  assert.strictEqual(JSON.stringify(db.t), snapshot, 'no second financial change');
  assert.strictEqual(db.t.orphan_audit.length, 1, 'no duplicate audit');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 11. concurrency ═══════════════════════════════════

test('concurrent status change mid-repair aborts with full rollback', async () => {
  const db = fixture1179();
  // Another session flips the payment right before the terminal UPDATE.
  db.interceptBefore(/UPDATE payments SET status = 'REVERSED'/, (fake) => {
    fake.t.payments[0].status = 'CANCELLED';
  });

  await assert.rejects(
    () => reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db }),
    (err) => err.code === CODES.CONCURRENT_CHANGE
  );

  // rollback restored everything (allocation reversal included)
  assert.strictEqual(db.t.payment_allocations[0].status, 'ACTIVE');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PAID');
  assert.strictEqual(db.t.orphan_audit.length, 0);
  assertZeroGlMutations(db);
});

test('payment reversed between dry-run and apply → ALREADY_RECONCILED (stale preview is not authority)', async () => {
  const db = fixture1179();
  const dry = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: true, client: db });
  assert.strictEqual(dry.code, CODES.DRY_RUN_OK);

  db.t.payments[0].status = 'REVERSED'; // someone else completed the repair
  const res = await reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db });
  assert.strictEqual(res.code, CODES.ALREADY_RECONCILED);
  assertZeroGlMutations(db);
});

// ═════════════════════════ 12. audit failure → rollback ══════════════════════

test('audit insert failure rolls back ALL document-side changes', async () => {
  const db = fixture1179();
  db.failOnAuditInsert = true;

  await assert.rejects(
    () => reconcileOrphanedPayment({ ...ARGS_1179, dryRun: false, client: db }),
    /simulated audit insert failure/
  );

  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations[0].status, 'ACTIVE');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PAID');
  assert.strictEqual(db.t.purchase_notes[0].amount_paid, '43932.00');
  assert.strictEqual(db.t.orphan_audit.length, 0);
  assert.ok(db.log.some(s => /^\s*ROLLBACK\s*$/i.test(s)), 'ROLLBACK was issued');
  assertZeroGlMutations(db);
});

// ═════════════════════════ 13. GL guard ══════════════════════════════════════

test('GL guard blocks every journal/je_lines/accounts mutation shape', async () => {
  const attempts = [
    'INSERT INTO journal_entries (je_number) VALUES ($1)',
    'UPDATE journal_entries SET status = $1',
    'DELETE FROM journal_entries WHERE id = $1',
    'INSERT INTO je_lines (je_id) VALUES ($1)',
    'UPDATE je_lines SET debit = 0',
    'DELETE FROM je_lines WHERE je_id = $1',
    'UPDATE accounts SET balance = balance + 1',
    '  update "accounts" set balance = 0',
  ];
  const inner = { query: async () => ({ rows: [], rowCount: 0 }) };
  const guarded = createGlGuardedClient(inner);
  for (const sql of attempts) {
    assert.throws(() => guarded.query(sql), GlMutationAttemptError, sql);
  }
  // non-GL SQL passes through
  await guarded.query('SELECT 1 FROM journal_entries WHERE id = $1');
  await guarded.query("UPDATE payments SET status = 'REVERSED' WHERE id = $1");
});

// ═════════════════════════ 14. helpers & input validation ════════════════════

test('numericEq compares decimal strings exactly', () => {
  assert.ok(numericEq('43932.00', '43932'));
  assert.ok(numericEq('34000000.00', '34000000.0'));
  assert.ok(!numericEq('43932.00', '43932.01'));
  assert.ok(!numericEq('abc', '1'));
});

test('normalizeAmountString accepts sane decimals and rejects garbage', () => {
  assert.strictEqual(normalizeAmountString('43,932.00'), '43932.00');
  assert.strictEqual(normalizeAmountString(' 34000000.00 '), '34000000.00');
  assert.strictEqual(normalizeAmountString('12.345'), null);
  assert.strictEqual(normalizeAmountString('-5.00'), null);
  assert.strictEqual(normalizeAmountString('DROP TABLE'), null);
});

test('invalid inputs are rejected before any DB work', async () => {
  const untouchable = { query: async () => { throw new Error('DB touched'); } };
  const cases = [
    { ...ARGS_1179, dryRun: true, paymentId: 0 },
    { ...ARGS_1179, dryRun: true, expectedReference: '' },
    { ...ARGS_1179, dryRun: true, expectedAmount: 'x' },
    { ...ARGS_1179, dryRun: true, expectedMissingJeId: -1 },
    { ...ARGS_1179, dryRun: true, runId: '' },
    { ...ARGS_1179, dryRun: false, reason: '   ' },
  ];
  for (const bad of cases) {
    const res = await reconcileOrphanedPayment({ ...bad, client: untouchable });
    assert.strictEqual(res.code, CODES.INVALID_INPUT, JSON.stringify(bad).slice(0, 80));
  }
});

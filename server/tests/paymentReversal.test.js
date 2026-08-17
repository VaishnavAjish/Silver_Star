'use strict';

/**
 * ACCOUNTING PHASE 1B — canonical payment reversal engine suite.
 *
 * db/pool, journalEngine and vendorAdvanceService are stubbed through
 * require.cache; the service runs against an in-memory fake database with
 * BEGIN-snapshot / ROLLBACK-restore semantics. openDocumentService and
 * settlementService are the REAL modules, so the canonical bill recompute
 * (including the Phase 1A active-allocation predicate) is exercised.
 *
 * Run with:  node --test tests/paymentReversal.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');

// ── stubs BEFORE loading the service ─────────────────────────────────────────
const poolPath = require.resolve('../db/pool');
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: {
    query: async () => { throw new Error('fake pool: use an explicit client'); },
    primaryPool: { connect: async () => { throw new Error('fake pool: tests pass a client'); }, end: async () => {} },
  },
};

const journalEngineCalls = [];
let journalEngineShouldThrow = false;
const jePath = require.resolve('../services/journalEngine');
require.cache[jePath] = {
  id: jePath, filename: jePath, loaded: true,
  exports: {
    reverseEntry: async (jeId, opts) => {
      if (journalEngineShouldThrow) throw new Error('simulated reverseEntry failure');
      journalEngineCalls.push({ jeId, reason: opts.reason });
      return { id: 7700 + journalEngineCalls.length, je_number: `JE-REV-${jeId}` };
    },
    createEntry: async () => { throw new Error('createEntry must not be called by payment reversal'); },
  },
};

const advanceReversalCalls = [];
const vasPath = require.resolve('../services/vendorAdvanceService');
require.cache[vasPath] = {
  id: vasPath, filename: vasPath, loaded: true,
  exports: {
    reverseAdvanceApplication: async ({ applicationId, client }) => {
      // emulate the real helper's document effect on the fake tables
      const t = client.t;
      const app = t.vendor_advance_applications.find(a => a.id === applicationId);
      if (!app || app.status === 'REVERSED') throw new Error('bad application');
      app.status = 'REVERSED';
      const adv = t.vendor_advances.find(a => a.id === app.advance_id);
      adv.remaining_amount = (parseFloat(adv.remaining_amount) + parseFloat(app.amount)).toFixed(2);
      adv.status = 'OPEN';
      advanceReversalCalls.push({ applicationId });
      return { ok: true, application_id: applicationId, status: 'REVERSED', reversal_je_id: 8800 + applicationId };
    },
  },
};

const { reversePayment, CODES } = require('../services/paymentReversalService');

// ═════════════════════════ fake database ═════════════════════════════════════

function toCents(v) {
  const m = String(v == null ? '0' : v).trim().match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) throw new Error(`fake db: not a decimal: ${v}`);
  return BigInt((m[1] || '') + m[2] + (m[3] || '').padEnd(2, '0'));
}
function centsToStr(c) {
  const neg = c < 0n; const abs = neg ? -c : c;
  const s = abs.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

class FakeDb {
  constructor(seed) {
    this.t = {
      payments: [], purchase_notes: [], payment_allocations: [], journal_entries: [],
      vendor_advances: [], vendor_advance_applications: [], je_allocations: [],
      bill_tds_withholdings: [],
      ...(seed || {}),
    };
    this.snapshot = null;
    this.log = [];
  }

  settlementFor(billId) {
    const pn = this.t.purchase_notes.find(b => b.id === billId);
    if (!pn) return null;
    const cash = this.t.payment_allocations
      .filter(a => a.purchase_note_id === billId && a.status === 'ACTIVE')
      .reduce((s, a) => s + toCents(a.amount), 0n);
    const adv = this.t.vendor_advance_applications
      .filter(a => a.purchase_note_id === billId && a.status === 'APPLIED')
      .reduce((s, a) => s + toCents(a.amount), 0n);
    const gross = toCents(pn.grand_total);
    const settled = cash + adv;
    return { pn, cash, adv, gross, settled };
  }

  async query(sql, params = []) {
    const text = typeof sql === 'string' ? sql : (sql && sql.text) || '';
    this.log.push(text);
    const norm = text.replace(/\s+/g, ' ').trim();

    if (/^BEGIN\b/i.test(norm)) { this.snapshot = JSON.parse(JSON.stringify(this.t)); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(norm)) { this.snapshot = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK$/i.test(norm)) {
      if (this.snapshot) this.t = this.snapshot;
      this.snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(norm)) return { rows: [], rowCount: 0 };

    if (norm.startsWith('SELECT * FROM payments WHERE id = $1')) {
      const p = this.t.payments.find(x => x.id === params[0]);
      return p ? { rows: [{ ...p }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (norm.startsWith('SELECT id, status FROM journal_entries WHERE id = $1')) {
      const je = this.t.journal_entries.find(x => x.id === params[0]);
      return je ? { rows: [{ id: je.id, status: je.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (norm.includes("FROM payment_allocations WHERE payment_id = $1 AND status = 'ACTIVE' ORDER BY id ASC")) {
      const rows = this.t.payment_allocations
        .filter(a => a.payment_id === params[0] && a.status === 'ACTIVE')
        .sort((a, b) => a.id - b.id)
        .map(a => ({ id: a.id, purchase_note_id: a.purchase_note_id }));
      return { rows, rowCount: rows.length };
    }

    if (norm.includes('SELECT id FROM purchase_notes WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE')) {
      const rows = this.t.purchase_notes.filter(b => params[0].includes(b.id)).map(b => ({ id: b.id }));
      return { rows, rowCount: rows.length };
    }

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

    if (norm.startsWith('SELECT id, status FROM vendor_advances WHERE payment_id = $1')) {
      const rows = this.t.vendor_advances
        .filter(a => a.payment_id === params[0])
        .sort((a, b) => a.id - b.id)
        .map(a => ({ id: a.id, status: a.status }));
      return { rows, rowCount: rows.length };
    }

    if (norm.includes("WHERE va.payment_id = $1 AND vaa.status = 'APPLIED'")) {
      const advIds = this.t.vendor_advances.filter(a => a.payment_id === params[0]).map(a => a.id);
      const rows = this.t.vendor_advance_applications
        .filter(a => advIds.includes(a.advance_id) && a.status === 'APPLIED')
        .sort((a, b) => a.id - b.id)
        .map(a => ({ id: a.id, purchase_note_id: a.purchase_note_id }));
      return { rows, rowCount: rows.length };
    }

    if (norm.startsWith("UPDATE vendor_advances SET status = 'CANCELLED'")) {
      const hit = this.t.vendor_advances.filter(a => a.payment_id === params[0] && a.status !== 'CANCELLED');
      for (const a of hit) { a.status = 'CANCELLED'; a.remaining_amount = '0.00'; }
      return { rows: [], rowCount: hit.length };
    }

    // real settlementService.getBillSettlement
    if (norm.includes('stored_payment_status') && norm.includes('cash_paid') && norm.includes('WHERE pn.id = $1')) {
      assert.ok(norm.includes("status = 'ACTIVE'"), 'settlement SQL must keep the active-allocation predicate');
      const s = this.settlementFor(params[0]);
      if (!s) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: s.pn.id, doc_number: s.pn.doc_number, doc_date: null, vendor_id: s.pn.vendor_id,
          grand_total: centsToStr(s.gross), payment_term: null, status: 'posted',
          stored_payment_status: s.pn.payment_status,
          stored_amount_paid: s.pn.amount_paid, stored_balance_due: s.pn.balance_due,
          cash_paid: centsToStr(s.cash), je_settled: '0.00',
          advance_applied: centsToStr(s.adv), tds_withheld: '0.00',
        }],
        rowCount: 1,
      };
    }

    if (norm.startsWith('UPDATE purchase_notes SET amount_paid = $1, balance_due = $2, payment_status = $3')) {
      const pn = this.t.purchase_notes.find(b => b.id === params[3]);
      pn.amount_paid = Number(params[0]).toFixed(2);
      pn.balance_due = Number(params[1]).toFixed(2);
      pn.payment_status = params[2];
      return { rows: [], rowCount: 1 };
    }

    if (norm.startsWith("UPDATE payments SET status = 'REVERSED'")) {
      const p = this.t.payments.find(x => x.id === params[0] && x.status === 'COMPLETED');
      if (!p) return { rows: [], rowCount: 0 };
      p.status = 'REVERSED';
      p.remark = (p.remark || '') + params[1];
      return { rows: [{ ...p }], rowCount: 1 };
    }

    throw new Error(`fake db: unhandled SQL: ${norm.slice(0, 140)}`);
  }
}

/** payment 950 pays 40k of a 100k bill; another payment covers 60k; JE 640 posted. */
function fixture() {
  journalEngineCalls.length = 0;
  advanceReversalCalls.length = 0;
  journalEngineShouldThrow = false;
  return new FakeDb({
    journal_entries: [{ id: 640, status: 'posted' }, { id: 641, status: 'posted' }],
    payments: [
      { id: 950, doc_number: 'PAY-9500', vendor_id: 20, amount: '40000.00', je_id: 640, status: 'COMPLETED', remark: '' },
      { id: 951, doc_number: 'PAY-9510', vendor_id: 20, amount: '60000.00', je_id: 641, status: 'COMPLETED', remark: '' },
    ],
    purchase_notes: [{
      id: 80, doc_number: 'BILL-8001', vendor_id: 20, grand_total: '100000.00',
      amount_paid: '100000.00', balance_due: '0.00', payment_status: 'PAID',
    }],
    payment_allocations: [
      { id: 600, payment_id: 950, purchase_note_id: 80, amount: '40000.00', status: 'ACTIVE' },
      { id: 601, payment_id: 951, purchase_note_id: 80, amount: '60000.00', status: 'ACTIVE' },
    ],
  });
}

const ARGS = { paymentId: 950, actorId: 5, reason: 'operator error' };

// ═════════════════════════ tests ═════════════════════════════════════════════

test('normal reversal: evidence preserved, bill recomputed, compensating JE posted', async () => {
  const db = fixture();
  const res = await reversePayment({ ...ARGS, client: db });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.code, CODES.REVERSED);

  // payment terminal
  assert.strictEqual(db.t.payments[0].status, 'REVERSED');
  // allocation preserved as evidence, not deleted
  assert.strictEqual(db.t.payment_allocations.length, 2);
  const alloc = db.t.payment_allocations.find(a => a.id === 600);
  assert.strictEqual(alloc.status, 'REVERSED');
  assert.match(alloc.reversal_reason, /PAYMENT_REVERSAL: operator error/);
  // no DELETE anywhere
  assert.ok(!db.log.some(s => /DELETE\s+FROM\s+payment_allocations/i.test(s)), 'allocations must never be deleted');

  // bill recomputed from the surviving 60k allocation — PARTIAL, not GREATEST-patched
  const bill = db.t.purchase_notes[0];
  assert.strictEqual(bill.amount_paid, '60000.00');
  assert.strictEqual(bill.balance_due, '40000.00');
  assert.strictEqual(bill.payment_status, 'PARTIAL');

  // compensating JE for the payment's posting
  assert.strictEqual(journalEngineCalls.length, 1);
  assert.strictEqual(journalEngineCalls[0].jeId, 640);
  assert.strictEqual(res.summary.reversal_je_id, 7701);

  // the other payment is untouched
  assert.strictEqual(db.t.payments[1].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations.find(a => a.id === 601).status, 'ACTIVE');
});

test('orphan payment (JE deleted) is refused and routed to Phase 1A', async () => {
  const db = fixture();
  db.t.journal_entries = db.t.journal_entries.filter(j => j.id !== 640); // JE 640 vanished

  const res = await reversePayment({ ...ARGS, client: db });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.ORPHAN_PAYMENT_JE_MISSING);
  assert.strictEqual(res.httpStatus, 409);
  assert.match(res.message, /reconcileOrphanedPayment/);

  // zero mutation
  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations.find(a => a.id === 600).status, 'ACTIVE');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PAID');
  assert.strictEqual(journalEngineCalls.length, 0);
});

test('already reversed payment is an idempotent no-op', async () => {
  const db = fixture();
  db.t.payments[0].status = 'REVERSED';
  const res = await reversePayment({ ...ARGS, client: db });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.code, CODES.ALREADY_REVERSED);
  assert.strictEqual(journalEngineCalls.length, 0);
});

test('missing reason is rejected before any DB work', async () => {
  const untouchable = { query: async () => { throw new Error('DB touched'); } };
  const res = await reversePayment({ paymentId: 950, actorId: 5, reason: '  ', client: untouchable });
  assert.strictEqual(res.code, CODES.INVALID_INPUT);
});

test('advances: APPLIED applications reversed individually, then advances cancelled', async () => {
  const db = fixture();
  // payment 950 also created an advance, partially applied to a second bill
  db.t.purchase_notes.push({
    id: 81, doc_number: 'BILL-8101', vendor_id: 20, grand_total: '20000.00',
    amount_paid: '15000.00', balance_due: '5000.00', payment_status: 'PARTIAL',
  });
  db.t.vendor_advances.push({ id: 320, payment_id: 950, vendor_id: 20, amount: '15000.00', remaining_amount: '0.00', status: 'APPLIED' });
  db.t.vendor_advance_applications.push({ id: 450, advance_id: 320, purchase_note_id: 81, amount: '15000.00', status: 'APPLIED', je_id: 900 });

  const res = await reversePayment({ ...ARGS, client: db });
  assert.strictEqual(res.code, CODES.REVERSED);

  // the application was reversed via the dedicated helper (own compensating JE)
  assert.deepStrictEqual(advanceReversalCalls, [{ applicationId: 450 }]);
  assert.strictEqual(db.t.vendor_advance_applications[0].status, 'REVERSED');
  // then the advance itself was voided
  assert.strictEqual(db.t.vendor_advances[0].status, 'CANCELLED');
  assert.strictEqual(db.t.vendor_advances[0].remaining_amount, '0.00');
  // the application's bill was recomputed from surviving settlement
  const bill81 = db.t.purchase_notes.find(b => b.id === 81);
  assert.strictEqual(bill81.amount_paid, '0.00');
  assert.strictEqual(bill81.payment_status, 'UNPAID');
  assert.deepStrictEqual(res.summary.bill_ids, [80, 81]);
});

test('reverseEntry failure rolls back the whole document unwind', async () => {
  const db = fixture();
  journalEngineShouldThrow = true;

  await assert.rejects(() => reversePayment({ ...ARGS, client: db }), /simulated reverseEntry failure/);

  assert.strictEqual(db.t.payments[0].status, 'COMPLETED');
  assert.strictEqual(db.t.payment_allocations.find(a => a.id === 600).status, 'ACTIVE');
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PAID');
  assert.strictEqual(db.t.purchase_notes[0].amount_paid, '100000.00');
  assert.ok(db.log.some(s => /^\s*ROLLBACK\s*$/i.test(s)), 'ROLLBACK issued');
});

test('payment with no je_id (legacy) reverses document side without touching GL', async () => {
  const db = fixture();
  db.t.payments[0].je_id = null;

  const res = await reversePayment({ ...ARGS, client: db });
  assert.strictEqual(res.code, CODES.REVERSED);
  assert.strictEqual(journalEngineCalls.length, 0);
  assert.strictEqual(res.summary.reversal_je_id, null);
  assert.strictEqual(db.t.purchase_notes[0].payment_status, 'PARTIAL');
});

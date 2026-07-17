// Stale-completion return guard — pure-predicate truth table (no DB).
// Covers the Return workspace entry guard + Return queue reconciliation-candidate
// contract used by lotProcessIssues.js (validate + POST /return + list).
const { test } = require('node:test');
const assert = require('node:assert');
const {
  isMachineProcessTerminal,
  isReconciliationCandidate,
  STALE_COMPLETION_MESSAGE,
} = require('../services/staleReturnGuard');

// ── isMachineProcessTerminal ──────────────────────────────────────────────────
test('terminal: completed and cancelled block further returns', () => {
  assert.equal(isMachineProcessTerminal('completed'), true);
  assert.equal(isMachineProcessTerminal('cancelled'), true);
});

test('terminal: active states remain returnable', () => {
  assert.equal(isMachineProcessTerminal('running'), false);
  assert.equal(isMachineProcessTerminal('hold'), false);
  assert.equal(isMachineProcessTerminal(null), false);
  assert.equal(isMachineProcessTerminal(undefined), false);
});

// ── isReconciliationCandidate ─────────────────────────────────────────────────
test('candidate: OPEN issue with remaining on a COMPLETED process (SSD-056 shape)', () => {
  // PI-202607-0325: issued 24, remaining 24, machine_process completed.
  assert.equal(isReconciliationCandidate({
    issueStatus: 'OPEN', remaining: 24, issuedQty: 24, machineProcessStatus: 'completed',
  }), true);
});

test('candidate: cancelled process with remaining is also a candidate', () => {
  assert.equal(isReconciliationCandidate({
    issueStatus: 'OPEN', remaining: 10, issuedQty: 24, machineProcessStatus: 'cancelled',
  }), true);
});

test('not a candidate: active process OPEN issue is normally returnable', () => {
  assert.equal(isReconciliationCandidate({
    issueStatus: 'OPEN', remaining: 24, issuedQty: 24, machineProcessStatus: 'running',
  }), false);
});

test('not a candidate: fully returned issue (remaining 0) on a completed process', () => {
  assert.equal(isReconciliationCandidate({
    issueStatus: 'OPEN', remaining: 0, issuedQty: 24, machineProcessStatus: 'completed',
  }), false);
});

test('not a candidate: already RETURNED issue', () => {
  assert.equal(isReconciliationCandidate({
    issueStatus: 'RETURNED', remaining: 0, issuedQty: 24, machineProcessStatus: 'completed',
  }), false);
});

test('candidate: null remaining falls back to issued qty', () => {
  assert.equal(isReconciliationCandidate({
    issueStatus: 'OPEN', remaining: null, issuedQty: 24, machineProcessStatus: 'completed',
  }), true);
});

// ── Message contract ──────────────────────────────────────────────────────────
test('message: block message names reconciliation, not a normal error', () => {
  assert.match(STALE_COMPLETION_MESSAGE, /already been completed/i);
  assert.match(STALE_COMPLETION_MESSAGE, /reconciliation/i);
});

'use strict';

// ============================================================================
// Legacy Seed Reconstruction — unit tests (no database).
//
// These tests exercise the service's pure logic and its FAIL-FAST ordering
// with a scripted client that records every SQL call. They complement — and
// never replace — the real-PostgreSQL end-to-end suite in
// legacySeedReconstruction.pg.test.js (concurrency, rollback, idempotency).
//
// Run: node --test server/tests/legacySeedResolution.test.js
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isCanonicalSuperAdmin,
  resolveLegacySeedValue,
  resolveOrReconstructLegacyAttachedSeed,
} = require('../services/legacySeedReconstruction');

// Scripted client: answers queries by first matching pattern; records calls.
function scriptedClient(script = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      for (const [pattern, rows] of script) {
        if (pattern.test(String(sql))) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    },
  };
}

const OPEN_ISSUE = { id: 501, issue_number: 'PI-UNIT-0001', status: 'OPEN', machine_process_id: 9 };
const PROCESS_LOT = { id: 601, lot_number: 'GR-UNIT-0001', lot_code: 'GR-UNIT-0001', run_no: 3 };
const SUPER = { id: 1, role: 'super_admin' };

test('canonical Super Admin identity: admin/administrator/operator are NOT super admin', () => {
  assert.equal(isCanonicalSuperAdmin('super_admin'), true);
  assert.equal(isCanonicalSuperAdmin('SuperAdmin'), true);
  assert.equal(isCanonicalSuperAdmin(' Super Admin '), true);
  assert.equal(isCanonicalSuperAdmin('admin'), false);
  assert.equal(isCanonicalSuperAdmin('administrator'), false);
  assert.equal(isCanonicalSuperAdmin('operator'), false);
  assert.equal(isCanonicalSuperAdmin('viewer'), false);
  assert.equal(isCanonicalSuperAdmin(''), false);
  assert.equal(isCanonicalSuperAdmin(null), false);
});

test('value resolver: root rate × authoritative qty, canonical rounding', () => {
  const r = resolveLegacySeedValue({
    rootSeed: { id: 7, lot_code: 'HX0001', rate: '5000' }, qty: 24,
  });
  assert.equal(r.resolved, true);
  assert.equal(r.value, 120000);
  assert.equal(r.rate, 5000);
  assert.equal(r.sourceType, 'ROOT_SEED_VALUATION');
  assert.equal(r.sourceId, 7);
  const frac = resolveLegacySeedValue({
    rootSeed: { id: 8, lot_code: 'HX0002', rate: '333.337' }, qty: 3,
  });
  assert.equal(frac.value, 1000.01, 'rounded to 2 decimals like the canonical issue writer');
});

test('value resolver: zero/absent rate or qty is UNRESOLVED, never a guess', () => {
  assert.equal(resolveLegacySeedValue({ rootSeed: { id: 7, rate: 0 }, qty: 24 }).resolved, false);
  assert.equal(resolveLegacySeedValue({ rootSeed: { id: 7, rate: null }, qty: 24 }).resolved, false);
  assert.equal(resolveLegacySeedValue({ rootSeed: null, qty: 24 }).resolved, false);
  assert.equal(resolveLegacySeedValue({ rootSeed: { id: 7, rate: 100 }, qty: 0 }).resolved, false);
  const u = resolveLegacySeedValue({ rootSeed: { id: 7, rate: 0 }, qty: 24 });
  assert.equal(u.value, null);
  assert.equal(u.sourceType, null);
});

test('authorization precedes ALL database work: non-super actors rejected with zero queries', async () => {
  for (const role of ['admin', 'administrator', 'operator', 'viewer', undefined]) {
    const client = scriptedClient();
    await assert.rejects(
      resolveOrReconstructLegacyAttachedSeed({
        client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
        override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: { id: 2, role },
      }),
      err => err.statusCode === 403 && err.code === 'LEGACY_SEED_SUPER_ADMIN_REQUIRED'
    );
    assert.equal(client.calls.length, 0, `role '${role}' must not reach the database`);
  }
});

test('override reason is mandatory before any database work', async () => {
  const client = scriptedClient();
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { root_lot_id: 'HX0001', override_reason: '   ' }, actor: SUPER,
    }),
    err => err.statusCode === 422 && err.code === 'LEGACY_SEED_REASON_REQUIRED'
  );
  assert.equal(client.calls.length, 0);
});

test('closed issue rejected as already processed', async () => {
  const client = scriptedClient();
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: { ...OPEN_ISSUE, status: 'RETURNED' }, processLot: PROCESS_LOT,
      currentRemaining: 24, override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: SUPER,
    }),
    err => err.statusCode === 409 && err.code === 'LEGACY_SEED_ALREADY_PROCESSED'
  );
});

test('prior return blocks reconstruction before any INSERT', async () => {
  const client = scriptedClient([
    [/FROM lot_process_returns/, [{ id: 1, return_number: 'PR-1' }]],
  ]);
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: SUPER,
    }),
    err => err.code === 'LEGACY_SEED_PRIOR_RETURN_EXISTS' && err.statusCode === 409
  );
  assert.ok(!client.calls.some(c => /INSERT/i.test(c.sql)), 'no INSERT was attempted');
});

test('existing reconstruction for the issue fails closed before any INSERT', async () => {
  const client = scriptedClient([
    [/reconstructed_for_issue_id = \$1 FOR UPDATE/, [{ id: 9, lot_code: 'HX0001-01' }]],
  ]);
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: SUPER,
    }),
    err => err.code === 'LEGACY_SEED_ALREADY_RECONSTRUCTED' && err.statusCode === 409
  );
  assert.ok(!client.calls.some(c => /INSERT/i.test(c.sql)), 'no INSERT was attempted');
});

test('surviving original attached-Seed row fails closed (duplicate-identity protection)', async () => {
  const client = scriptedClient([
    [/FROM lot_process_issues gi/, [{
      issue_id: 400, issue_number: 'PI-G-1', issued_qty: '24', process_lot_id: 700,
      lot_id: 700, lot_code: '1001-01', lot_status: 'CONSUMED',
    }]],
  ]);
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: SUPER,
    }),
    err => err.code === 'LEGACY_SEED_ORIGINAL_ROW_EXISTS'
  );
  assert.ok(!client.calls.some(c => /INSERT/i.test(c.sql)));
});

test('growth-issue quantity evidence disagreeing with the locked issue fails closed', async () => {
  const client = scriptedClient([
    [/FROM lot_process_issues gi/, [{
      issue_id: 400, issue_number: 'PI-G-1', issued_qty: '9', process_lot_id: 700, lot_id: null,
    }]],
  ]);
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { root_lot_id: 'HX0001', override_reason: 'x' }, actor: SUPER,
    }),
    err => err.code === 'LEGACY_SEED_QTY_MISMATCH'
  );
});

test('missing root reference fails closed before code generation', async () => {
  const client = scriptedClient();
  await assert.rejects(
    resolveOrReconstructLegacyAttachedSeed({
      client, issue: OPEN_ISSUE, processLot: PROCESS_LOT, currentRemaining: 24,
      override: { override_reason: 'x' }, actor: SUPER,
    }),
    err => err.code === 'LEGACY_SEED_ROOT_REQUIRED' && err.statusCode === 422
  );
  assert.ok(!client.calls.some(c => /INSERT/i.test(c.sql)));
});

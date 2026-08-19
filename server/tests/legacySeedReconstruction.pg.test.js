'use strict';

// ============================================================================
// Legacy Seed Reconstruction — REAL PostgreSQL end-to-end suite.
//
// Boots a disposable PostgreSQL cluster (helpers/disposablePg), loads the
// repository schema + phase62/67/89 migrations (phase89 rollback is also
// exercised), then drives the REAL POST /:id/return and /return/validate
// handlers through supertest. Concurrency, rollback and idempotency are
// proven against the live database — no mocks stand in for transactions.
//
// Run: node --test server/tests/legacySeedReconstruction.pg.test.js
// Requires local PostgreSQL binaries (PG_TEST_BIN or Program Files install).
// ============================================================================

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { DisposablePg } = require('./helpers/disposablePg');
const harness = require('./helpers/legacySeedHarness');

const pgAvailable = new DisposablePg().available;

if (!pgAvailable) {
  test('Legacy Seed Reconstruction PG suite (SKIPPED — no local PostgreSQL binaries; set PG_TEST_BIN)',
    { skip: true }, () => {});
} else {
  let pg, db, app, items;

  before(async () => {
    pg = new DisposablePg();
    await pg.start();
    db = harness.installTestDoubles(pg.connectionConfig());
    app = harness.buildApp();
    items = await harness.ensureBaseData(db);
  }, { timeout: 300000 });

  after(async () => {
    try { if (db) await db.end(); } catch (e) {}
    if (pg) pg.stop();
  });

  beforeEach(() => harness.setQueryInterceptor(null));

  const post = (issueId, body, user) =>
    request(app).post(`/api/lot-process-issues/${issueId}/return`)
      .set('x-test-user', user).send(body);
  const validate = (issueId, body, user) =>
    request(app).post(`/api/lot-process-issues/${issueId}/return/validate`)
      .set('x-test-user', user).send(body);

  const reconRows = async (issueId) => (await db.query(
    'SELECT * FROM inventory WHERE reconstructed_for_issue_id = $1', [issueId])).rows;
  const returnRows = async (issueId) => (await db.query(
    'SELECT * FROM lot_process_returns WHERE issue_id = $1', [issueId])).rows;
  const auditRows = async (issueId) => (await db.query(
    "SELECT * FROM lot_op_log WHERE operation = 'legacy_seed_reconstructed' AND reference_type = 'lot_process_issue' AND reference_id = $1",
    [issueId])).rows;

  const overrideFor = (sc, extra = {}) => ({
    root_lot_id: sc.root.lot_code,
    physical_recovered_weight_ct: 29.43,
    override_reason: 'Historical growth predates Phase A seed attachment records.',
    ...extra,
  });

  // ── STAGE 36: healthy canonical path — legacy branch NOT invoked ──────────
  test('healthy Seed Remove: canonical detach, no reconstruction, root untouched', async () => {
    const sc = await harness.createScenario(db, items, { healthy: true });
    const rootBefore = await harness.snapshotRow(db, 'inventory', sc.root.id);

    const res = await post(sc.issue.id, harness.seedRemoveBody(), harness.OPERATOR);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.is_final, true);

    assert.equal((await reconRows(sc.issue.id)).length, 0, 'no reconstruction on healthy path');
    assert.equal((await auditRows(sc.issue.id)).length, 0, 'no reconstruction audit on healthy path');

    const seedAfter = await harness.snapshotRow(db, 'inventory', sc.attachedSeed.id);
    assert.equal(seedAfter.status, 'IN STOCK');
    assert.equal(seedAfter.manufacturing_state, 'AVAILABLE');
    assert.equal(parseFloat(seedAfter.weight), 29.43, 'released Seed carries the physical measured weight');
    assert.equal(parseFloat(seedAfter.total_value), 120000, 'released Seed keeps its own carrying value');

    const biscuitAfter = await harness.snapshotRow(db, 'inventory', sc.biscuit.id);
    assert.equal(biscuitAfter.item_id, items.growth_diamond, 'carrier transformed in place to growth_diamond');
    assert.equal(biscuitAfter.id, sc.biscuit.id, 'same identity — no -R1 child');

    const rootAfter = await harness.snapshotRow(db, 'inventory', sc.root.id);
    assert.deepEqual(rootAfter, rootBefore, 'root Seed row is byte-identical');

    const issueAfter = await harness.snapshotRow(db, 'lot_process_issues', sc.issue.id);
    assert.equal(issueAfter.status, 'RETURNED');
    const mpAfter = await harness.snapshotRow(db, 'machine_processes', sc.machineProcess.id);
    assert.equal(mpAfter.status, 'completed');
    const macAfter = await harness.snapshotRow(db, 'machines', sc.machine.id);
    assert.equal(macAfter.status, 'idle');
  });

  // ── STAGE 37: legacy reconstruction happy path ─────────────────────────────
  test('legacy reconstruction: one intermediate Seed, canonical genealogy, authoritative value, atomic return, durable audit', async () => {
    const sc = await harness.createScenario(db, items);
    const rootBefore = await harness.snapshotRow(db, 'inventory', sc.root.id);

    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const recons = await reconRows(sc.issue.id);
    assert.equal(recons.length, 1, 'exactly one reconstructed Seed');
    const seed = recons[0];
    assert.equal(seed.item_id, items.seed, 'Seed item identity from the root, never the Growth Run');
    assert.equal(seed.parent_lot_id, sc.root.id, 'parent is the root Seed');
    assert.equal(seed.root_lot_id, sc.root.id, 'root lineage anchored');
    assert.equal(seed.split_level, 1);
    assert.equal(seed.lot_code, `${sc.root.lot_code}-01`, 'canonical sibling code under the root namespace');
    assert.equal(seed.genealogy_path, `${sc.root.lot_code}/${sc.root.lot_code}-01`);
    assert.equal(parseFloat(seed.total_value), 120000, 'value = 24 × root rate 5000 (ROOT_SEED_VALUATION)');
    assert.equal(parseFloat(seed.rate), 5000);
    assert.equal(parseInt(seed.qty), 24, 'quantity from the LOCKED issue, not operator input');
    assert.equal(parseFloat(seed.dim_length), 11.25, 'dimensions from the root Seed row');
    assert.equal(seed.source_module, 'Legacy Seed Reconstruction');
    // Released in place by the canonical detach in the SAME transaction:
    assert.equal(seed.status, 'IN STOCK');
    assert.equal(seed.manufacturing_state, 'AVAILABLE');
    assert.equal(parseFloat(seed.weight), 29.43, 'physical recovered weight — reference weight was never fabricated');

    const rootAfter = await harness.snapshotRow(db, 'inventory', sc.root.id);
    assert.deepEqual(rootAfter, rootBefore, 'root Seed row has 0 differences');

    assert.equal((await returnRows(sc.issue.id)).length, 1, 'exactly one process return');
    const audits = await auditRows(sc.issue.id);
    assert.equal(audits.length, 1, 'exactly one durable reconstruction audit');
    const note = JSON.parse(audits[0].notes);
    assert.equal(note.operation, 'LEGACY_ATTACHED_SEED_RECONSTRUCTED');
    assert.equal(note.value_source_type, 'ROOT_SEED_VALUATION');
    assert.equal(note.resolved_value, 120000);
    assert.equal(note.root_seed_id, sc.root.id);
    assert.equal(note.actor_role, 'super_admin');
    assert.equal(note.seed_reference_weight, 'UNRESOLVED');
    assert.equal(note.physical_recovered_weight_ct, 29.43);

    const issueAfter = await harness.snapshotRow(db, 'lot_process_issues', sc.issue.id);
    assert.equal(issueAfter.status, 'RETURNED', 'reconstruction and return complete in ONE transaction');
    const biscuitAfter = await harness.snapshotRow(db, 'inventory', sc.biscuit.id);
    assert.equal(biscuitAfter.item_id, items.growth_diamond, 'Growth Diamond output produced');
  });

  // ── STAGE 38: concurrent double submit — barrier at the contested lock ─────
  test('concurrent double-submit: 1 success, 1 conflict, single reconstruction/return', async () => {
    const sc = await harness.createScenario(db, items);
    const rootBefore = await harness.snapshotRow(db, 'inventory', sc.root.id);

    let arrivals = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    harness.setQueryInterceptor(async (sql) => {
      if (/FOR UPDATE OF i\b/.test(sql) && /FROM lot_process_issues i/.test(sql)) {
        arrivals += 1;
        if (arrivals >= 2) release();
        // Hold BOTH requests here until both have reached the contested
        // section, then let PostgreSQL serialize the row lock for real.
        await Promise.race([gate, new Promise(r => setTimeout(r, 3000))]);
      }
    });

    const body = harness.seedRemoveBody({ override: overrideFor(sc) });
    const [a, b] = await Promise.all([
      post(sc.issue.id, body, harness.SUPER),
      post(sc.issue.id, body, harness.SUPER),
    ]);
    harness.setQueryInterceptor(null);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `expected one success and one conflict, got ${a.status}/${b.status}`);
    const loser = a.status === 409 ? a : b;
    assert.match(loser.body.error, /already/i);
    assert.ok(arrivals >= 2, 'both requests reached the contested section');

    assert.equal((await reconRows(sc.issue.id)).length, 1, 'reconstructed Seeds = 1');
    assert.equal((await returnRows(sc.issue.id)).length, 1, 'physical returns = 1');
    assert.equal((await auditRows(sc.issue.id)).length, 1, 'audit rows = 1');
    const gd = await db.query(
      'SELECT count(*)::int AS n FROM inventory WHERE id = $1 AND item_id = $2',
      [sc.biscuit.id, items.growth_diamond]);
    assert.equal(gd.rows[0].n, 1, 'Growth Diamond outputs = 1 (same in-place identity)');
    assert.deepEqual(await harness.snapshotRow(db, 'inventory', sc.root.id), rootBefore, 'root modifications = 0');
  });

  // ── STAGE 39: retry after success ──────────────────────────────────────────
  test('retry of a completed request: safe conflict, zero new rows', async () => {
    const sc = await harness.createScenario(db, items);
    const body = harness.seedRemoveBody({ override: overrideFor(sc) });

    const first = await post(sc.issue.id, body, harness.SUPER);
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const retry = await post(sc.issue.id, body, harness.SUPER);
    assert.equal(retry.status, 409, JSON.stringify(retry.body));
    assert.match(retry.body.error, /already RETURNED/);

    assert.equal((await reconRows(sc.issue.id)).length, 1, 'no second Seed');
    assert.equal((await returnRows(sc.issue.id)).length, 1, 'no second return');
    assert.equal((await auditRows(sc.issue.id)).length, 1, 'no second success audit');
  });

  // ── STAGE 40: injected failure immediately after the child INSERT ─────────
  test('failure after child INSERT (before audit): full rollback', async () => {
    const sc = await harness.createScenario(db, items);
    const rootBefore = await harness.snapshotRow(db, 'inventory', sc.root.id);

    harness.setQueryInterceptor(async (sql) => {
      if (/INSERT INTO lot_op_log/i.test(sql)) throw new Error('Injected failure after child INSERT');
    });
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    harness.setQueryInterceptor(null);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Injected failure/);
    assert.equal((await reconRows(sc.issue.id)).length, 0, 'child count = 0 after rollback');
    assert.equal((await returnRows(sc.issue.id)).length, 0, 'return count = 0');
    assert.equal((await auditRows(sc.issue.id)).length, 0, 'no audit row');
    assert.deepEqual(await harness.snapshotRow(db, 'inventory', sc.root.id), rootBefore, 'root differences = 0');
    const issueAfter = await harness.snapshotRow(db, 'lot_process_issues', sc.issue.id);
    assert.equal(issueAfter.status, 'OPEN', 'issue state unchanged');
  });

  // ── STAGE 41: injected failure later in the canonical return ──────────────
  test('failure after audit (canonical return header): reconstruction audit rolls back too', async () => {
    const sc = await harness.createScenario(db, items);

    harness.setQueryInterceptor(async (sql) => {
      if (/INSERT INTO lot_process_returns/i.test(sql)) {
        throw new Error('Injected failure after reconstruction audit');
      }
    });
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    harness.setQueryInterceptor(null);

    assert.equal(res.status, 400);
    assert.equal((await reconRows(sc.issue.id)).length, 0, 'reconstruction rolled back');
    assert.equal((await auditRows(sc.issue.id)).length, 0,
      'no audit may claim a reconstruction succeeded when the transaction did not');
    assert.equal((await returnRows(sc.issue.id)).length, 0);
    assert.equal((await harness.snapshotRow(db, 'lot_process_issues', sc.issue.id)).status, 'OPEN');
  });

  // ── STAGE 42: unresolved value fails closed ────────────────────────────────
  test('unresolved value: LEGACY_SEED_VALUE_UNRESOLVED, zero rows', async () => {
    const sc = await harness.createScenario(db, items, { rootRate: 0 });
    const rootBefore = await harness.snapshotRow(db, 'inventory', sc.root.id);

    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_SEED_VALUE_UNRESOLVED');

    assert.equal((await reconRows(sc.issue.id)).length, 0, 'rows inserted = 0');
    assert.equal((await returnRows(sc.issue.id)).length, 0, 'returns = 0');
    assert.deepEqual(await harness.snapshotRow(db, 'inventory', sc.root.id), rootBefore, 'root updates = 0');
  });

  // ── STAGE 43: arbitrary operator value can never become financial truth ───
  test('arbitrary value attack: operator currency ignored, authoritative value stored, claim audited', async () => {
    const sc = await harness.createScenario(db, items);

    const res = await post(sc.issue.id, harness.seedRemoveBody({
      override: overrideFor(sc, { seed_value: 999999999, override_seed_value: 999999999 }),
    }), harness.SUPER);
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const [seed] = await reconRows(sc.issue.id);
    assert.equal(parseFloat(seed.total_value), 120000, 'server valuation wins');
    assert.notEqual(parseFloat(seed.total_value), 999999999);
    const { rows: poisoned } = await db.query(
      'SELECT count(*)::int AS n FROM inventory WHERE total_value = 999999999');
    assert.equal(poisoned[0].n, 0, 'the attacked figure exists nowhere in inventory');

    const [audit] = await auditRows(sc.issue.id);
    const note = JSON.parse(audit.notes);
    assert.equal(note.operator_claimed_value, 999999999, 'claim is recorded for traceability only');
    assert.equal(note.resolved_value, 120000);
  });

  // ── STAGE 44: authorization matrix ─────────────────────────────────────────
  test('authorization: super_admin permitted; admin, operator, viewer blocked', async () => {
    for (const user of [harness.ADMIN, harness.OPERATOR]) {
      const sc = await harness.createScenario(db, items);
      const res = await post(sc.issue.id,
        harness.seedRemoveBody({ override: overrideFor(sc) }), user);
      assert.equal(res.status, 403, `${user} → ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'LEGACY_SEED_SUPER_ADMIN_REQUIRED');
      assert.equal((await reconRows(sc.issue.id)).length, 0);
      assert.equal((await harness.snapshotRow(db, 'lot_process_issues', sc.issue.id)).status, 'OPEN');
    }
    // viewer: blocked earlier, by route-level authorize (not in the role list)
    const sc = await harness.createScenario(db, items);
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.VIEWER);
    assert.equal(res.status, 403);
    assert.equal((await reconRows(sc.issue.id)).length, 0);
  });

  // ── STAGE 31: stale-return guard cannot be bypassed by the override ───────
  test('stale machine process: override blocked before any reconstruction', async () => {
    const sc = await harness.createScenario(db, items, { machineProcessStatus: 'completed' });
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.ok(res.status >= 400, 'stale return must be rejected');
    assert.match(res.body.error, /Control Tower|reconcil/i);
    assert.equal((await reconRows(sc.issue.id)).length, 0, 'no reconstruction through the stale guard');
  });

  // ── STAGE 32: canonical resolution wins over the override flag ────────────
  test('existing attached Seed: override flag ignored, healthy path used', async () => {
    const sc = await harness.createScenario(db, items, { healthy: true });
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await reconRows(sc.issue.id)).length, 0, 'no reconstruction when canonical Seed exists');
    const seedAfter = await harness.snapshotRow(db, 'inventory', sc.attachedSeed.id);
    assert.equal(seedAfter.status, 'IN STOCK', 'the ORIGINAL attached Seed was released');
  });

  // ── STAGE 33: prior return blocks reconstruction ───────────────────────────
  test('prior return exists: reconstruction fails closed', async () => {
    const sc = await harness.createScenario(db, items);
    await db.query(
      `INSERT INTO lot_process_returns (return_number, issue_id, return_date, usable_qty, damaged_qty, consumed_qty, created_by, is_final, remaining_after)
       VALUES ($1, $2, '2026-08-01', 24, 0, 0, 1, true, 0)`,
      [`PR-TEST-PRIOR-${sc.issue.id}`, sc.issue.id]);
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_SEED_PRIOR_RETURN_EXISTS');
    assert.equal((await reconRows(sc.issue.id)).length, 0);
  });

  // ── STAGE 8: inconsistent existing reconstruction fails closed ─────────────
  test('existing reconstruction with OPEN issue: conflict, never a second sibling', async () => {
    const sc = await harness.createScenario(db, items);
    await db.query(
      `INSERT INTO inventory (item_id, lot_number, lot_code, qty, unit, rate, total_value, status,
         manufacturing_state, parent_lot_id, root_lot_id, split_level, lot_op_id, source_module,
         reconstructed_for_issue_id)
       VALUES ($1, $2, $2, 24, 'PCS', 5000, 120000, 'IN PROCESS', 'ATTACHED_TO_GROWTH', $3, $3, 1,
         nextval('lot_op_id_seq'), 'Legacy Seed Reconstruction', $4)`,
      [items.seed, `${sc.root.lot_code}-01`, sc.root.id, sc.issue.id]);
    const res = await post(sc.issue.id,
      harness.seedRemoveBody({ override: overrideFor(sc) }), harness.SUPER);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_SEED_ALREADY_RECONSTRUCTED');
    assert.equal((await reconRows(sc.issue.id)).length, 1, 'still exactly one — no new sibling minted');
  });

  // ── STAGE 13: root must be a real Seed ─────────────────────────────────────
  test('non-Seed root candidate rejected', async () => {
    const sc = await harness.createScenario(db, items);
    const res = await post(sc.issue.id, harness.seedRemoveBody({
      override: overrideFor(sc, { root_lot_id: sc.biscuit.lot_code }),
    }), harness.SUPER);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_SEED_ROOT_INVALID');
    assert.equal((await reconRows(sc.issue.id)).length, 0);
  });

  // ── STAGE 16: quantity confirmation mismatch ───────────────────────────────
  test('confirmed_qty disagreeing with the authoritative quantity is rejected', async () => {
    const sc = await harness.createScenario(db, items);
    const res = await post(sc.issue.id, harness.seedRemoveBody({
      override: overrideFor(sc, { confirmed_qty: 23 }),
    }), harness.SUPER);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_SEED_QTY_MISMATCH');
  });

  // ── STAGE 18: physical recovered weight cross-check ────────────────────────
  test('physical recovered weight disagreeing with the seed line weight is rejected', async () => {
    const sc = await harness.createScenario(db, items);
    const res = await post(sc.issue.id, harness.seedRemoveBody({
      override: overrideFor(sc, { physical_recovered_weight_ct: 10 }),
    }), harness.SUPER);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'LEGACY_RECOVERED_WEIGHT_MISMATCH');
  });

  // ── STAGE 23/46: read-only preview on the preflight ────────────────────────
  test('validate preflight: honest legacy preview, resolved and unresolved, zero writes', async () => {
    const sc = await harness.createScenario(db, items);
    // Unresolved variant fixture (zero-rate root) is created BEFORE the
    // baseline count so the zero-write assertion sees only preflight effects.
    const sc0 = await harness.createScenario(db, items, { rootRate: 0 });
    const countAll = async () => (await db.query(
      "SELECT (SELECT count(*) FROM inventory) + (SELECT count(*) FROM lot_process_returns) + (SELECT count(*) FROM lot_op_log) AS n")).rows[0].n;
    const beforeCount = await countAll();

    const res = await validate(sc.issue.id, harness.seedRemoveBody({
      override: { root_lot_id: sc.root.lot_code },
    }), harness.SUPER);
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, false);
    assert.equal(res.body.legacyResolutionRequired, true);
    const preview = res.body.legacy_resolution_preview;
    assert.ok(preview, 'preview present');
    assert.equal(preview.value_resolution.resolved, true);
    assert.equal(preview.value_resolution.value, 120000);
    assert.equal(preview.value_resolution.sourceType, 'ROOT_SEED_VALUATION');
    assert.equal(preview.authoritative_qty, 24);
    assert.equal(preview.seed_reference_weight, null, 'reference weight honestly unresolved');

    // Unresolved variant: zero-rate root → value unresolved + blocker.
    const res0 = await validate(sc0.issue.id, harness.seedRemoveBody({
      override: { root_lot_id: sc0.root.lot_code },
    }), harness.SUPER);
    assert.equal(res0.body.legacy_resolution_preview.value_resolution.resolved, false);
    assert.ok(res0.body.legacy_resolution_preview.blockers.some(b => b.code === 'LEGACY_SEED_VALUE_UNRESOLVED'));

    assert.equal(await countAll(), beforeCount, 'preflight performed zero writes');
  });

  // ── G5: shared root namespace under concurrency ────────────────────────────
  test('two issues sharing one root: concurrent reconstructions get distinct sibling codes', async () => {
    const scA = await harness.createScenario(db, items);
    const scB = await harness.createScenario(db, items);
    // Both overrides anchor on scA's root — the shared namespace owner.
    const [a, b] = await Promise.all([
      post(scA.issue.id, harness.seedRemoveBody({ override: overrideFor(scA) }), harness.SUPER),
      post(scB.issue.id, harness.seedRemoveBody({
        override: overrideFor(scB, { root_lot_id: scA.root.lot_code }),
      }), harness.SUPER),
    ]);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));
    const { rows: siblings } = await db.query(
      'SELECT lot_code FROM inventory WHERE parent_lot_id = $1 ORDER BY lot_code', [scA.root.id]);
    const codes = siblings.map(r => r.lot_code);
    assert.deepEqual(codes, [`${scA.root.lot_code}-01`, `${scA.root.lot_code}-02`],
      'root lock serializes the namespace — unique sequential siblings, no duplicates');
  });
}

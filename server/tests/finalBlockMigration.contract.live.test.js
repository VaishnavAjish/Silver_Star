// Phase 63 / Phase 64 Final Block migration CONTRACT tests.
//
// These exercise the ACTUAL migration SQL files against a real PostgreSQL
// instance — they are NOT string inspection. Because the dev environment has
// no reachable database, the whole suite is ENVIRONMENT-GATED: it runs only
// when MIGRATION_TEST_DATABASE_URL points at a throwaway Postgres, and is
// skipped (not failed) otherwise. Point it at any scratch database — the
// suite creates and drops its own isolated schema and never touches
// production tables.
//
//   MIGRATION_TEST_DATABASE_URL=postgres://user:pass@localhost:5433/scratch \
//     node --test tests/finalBlockMigration.contract.test.js
//
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DB_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const SCHEMA = 'phase63_contract_test';

const PHASE63 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'phase63-reconcile-legacy-processes.sql'), 'utf8');
const PHASE64 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'phase64-final-block-transform-config.sql'), 'utf8');

if (!DB_URL) {
  test('Final Block migration contract (SKIPPED — set MIGRATION_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const { Client } = require('pg');
  let client;

  // Minimal process_master with exactly the columns phase63/phase64 read/write.
  const CREATE_TABLE = `
    CREATE TABLE process_master (
      id                    SERIAL PRIMARY KEY,
      process_code          VARCHAR(50) UNIQUE NOT NULL,
      process_name          VARCHAR(100) NOT NULL,
      process_group         VARCHAR(20),
      eligible_machine_type VARCHAR(30),
      completion_mode       VARCHAR(20) NOT NULL DEFAULT 'RETURN_BASED',
      input_item_category   VARCHAR(20),
      active                BOOLEAN NOT NULL DEFAULT true,
      sort_order            INTEGER NOT NULL DEFAULT 0,
      allowed_outputs       JSONB NOT NULL DEFAULT '[]'::jsonb
    );`;

  // Out-of-scope neighbours that MUST survive both migrations untouched.
  const NEIGHBOURS = [
    ['block_cut', 'Block Cut', 'LASER', 999],
    ['growth_cut', 'Growth Cut', 'LASER', 999],
    ['growth', 'Growth', 'GROWTH', 10],
    ['pr-01', 'PR 01', 'LASER', 1],
    ['pr-02', 'PR 02', 'LASER', 2],
    ['pr-03', 'PR 03', 'LASER', 3],
    ['pr-04', 'PR 04', 'LASER', 4],
    ['pr-05', 'PR 05', 'LASER', 5],
  ];

  // Minimal transactional tables that resolve a process by CODE (process_type),
  // matching the columns phase63's reference guard audits.
  const CREATE_REF_TABLES = `
    DROP TABLE IF EXISTS lot_process_returns, lot_process_issues, machine_processes, growth_run_cycles CASCADE;
    CREATE TABLE lot_process_issues  (id SERIAL PRIMARY KEY, process_type VARCHAR(50));
    CREATE TABLE machine_processes   (id SERIAL PRIMARY KEY, process_type VARCHAR(50));
    CREATE TABLE growth_run_cycles   (id SERIAL PRIMARY KEY, process_type VARCHAR(40));
    CREATE TABLE lot_process_returns (id SERIAL PRIMARY KEY,
                                      issue_id INTEGER REFERENCES lot_process_issues(id));`;

  // refs: { issues, machines, cycles, returnsPr06 } counts of pr-06 references.
  async function reset(seedRows, refs = {}) {
    await client.query(`DROP TABLE IF EXISTS process_master CASCADE;`);
    await client.query(CREATE_TABLE);
    await client.query(CREATE_REF_TABLES);
    for (const [code, name, group, sort] of NEIGHBOURS) {
      await client.query(
        `INSERT INTO process_master (process_code, process_name, process_group, active, sort_order)
         VALUES ($1,$2,$3,true,$4)`, [code, name, group, sort]);
    }
    for (const row of seedRows) {
      await client.query(
        `INSERT INTO process_master (id, process_code, process_name, active, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, row.code, row.name || row.code, row.active !== false, row.sort ?? 0]);
    }
    for (let i = 0; i < (refs.issues || 0); i++) {
      await client.query(`INSERT INTO lot_process_issues (process_type) VALUES ('pr-06')`);
    }
    for (let i = 0; i < (refs.machines || 0); i++) {
      await client.query(`INSERT INTO machine_processes (process_type) VALUES ('pr-06')`);
    }
    for (let i = 0; i < (refs.cycles || 0); i++) {
      await client.query(`INSERT INTO growth_run_cycles (process_type) VALUES ('pr-06')`);
    }
    for (let i = 0; i < (refs.returnsPr06 || 0); i++) {
      const { rows } = await client.query(
        `INSERT INTO lot_process_issues (process_type) VALUES ('pr-06') RETURNING id`);
      await client.query(`INSERT INTO lot_process_returns (issue_id) VALUES ($1)`, [rows[0].id]);
    }
  }

  // Run a migration file (it carries its own BEGIN/COMMIT). On failure, clear
  // any aborted transaction so the next statement can run.
  async function runMigration(sql) {
    try {
      await client.query(sql);
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { ok: false, message: err.message };
    }
  }

  const count = async (code) =>
    Number((await client.query(
      `SELECT count(*) FROM process_master WHERE process_code=$1`, [code])).rows[0].count);

  async function snapshotNeighbours() {
    const { rows } = await client.query(
      `SELECT process_code, process_name, process_group, active, sort_order, completion_mode,
              input_item_category, allowed_outputs
       FROM process_master
       WHERE process_code IN ('block_cut','growth_cut','growth','pr-01','pr-02','pr-03','pr-04','pr-05')
       ORDER BY process_code`);
    return JSON.stringify(rows);
  }

  before(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`);
    await client.query(`CREATE SCHEMA ${SCHEMA};`);
    await client.query(`SET search_path TO ${SCHEMA};`);
  });

  after(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`).catch(() => {});
      await client.end();
    }
  });

  beforeEach(async () => {
    // search_path is session-level; re-assert in case a prior abort touched it.
    await client.query(`SET search_path TO ${SCHEMA};`);
  });

  // ── Phase 63 ──────────────────────────────────────────────────────────────

  test('Case A: pr-06 only → renamed to final_block, same id preserved', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }]);
    const before = await snapshotNeighbours();

    const res = await runMigration(PHASE63);
    assert.equal(res.ok, true, res.message);

    assert.equal(await count('pr-06'), 0);
    assert.equal(await count('final_block'), 1);
    const { rows } = await client.query(
      `SELECT id, process_name, process_group FROM process_master WHERE process_code='final_block'`);
    assert.equal(rows[0].id, 606, 'primary-key id must be preserved');
    assert.equal(rows[0].process_name, 'Final Block');
    assert.equal(rows[0].process_group, 'LASER');
    assert.equal(await snapshotNeighbours(), before, 'neighbours must be untouched');
  });

  test('Case A guard: pr-06 referenced by lot_process_issues → abort, no rename', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }], { issues: 2 });
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /still has transactional references/i);
    assert.match(res.message, /lot_process_issues=2/);
    assert.equal(await count('pr-06'), 1, 'row must NOT be renamed');
    assert.equal(await count('final_block'), 0);
  });

  test('Case A guard: pr-06 referenced by machine_processes → abort', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }], { machines: 1 });
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /machine_processes=1/);
    assert.equal(await count('pr-06'), 1);
  });

  test('Case A guard: pr-06 referenced by growth_run_cycles → abort', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }], { cycles: 3 });
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /growth_run_cycles=3/);
    assert.equal(await count('pr-06'), 1);
  });

  test('Case A guard: pr-06 referenced via lot_process_returns → abort', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }], { returnsPr06: 1 });
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /lot_process_returns=1/);
    assert.equal(await count('pr-06'), 1);
  });

  test('Case A guard: no reference is rewritten when the migration aborts', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }], { issues: 2, machines: 1 });
    await runMigration(PHASE63); // aborts
    const iss = Number((await client.query(
      `SELECT count(*) FROM lot_process_issues WHERE process_type='pr-06'`)).rows[0].count);
    const mac = Number((await client.query(
      `SELECT count(*) FROM machine_processes WHERE process_type='pr-06'`)).rows[0].count);
    assert.equal(iss, 2, 'issue references untouched');
    assert.equal(mac, 1, 'machine references untouched');
  });

  test('Case B: final_block only → idempotent no-op success', async () => {
    await reset([{ id: 700, code: 'final_block', name: 'Final Block' }]);
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, true, res.message);
    assert.equal(await count('final_block'), 1);
    assert.equal(await count('pr-06'), 0);
  });

  test('Case B: rerun does NOT require stale pr-06 references to be zero', async () => {
    // final_block already present AND stale pr-06 references still exist.
    await reset([{ id: 700, code: 'final_block', name: 'Final Block' }], { issues: 5, machines: 2 });
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, true, res.message);
    assert.equal(await count('final_block'), 1);
  });

  test('Case C: both codes → abort, no merge/delete', async () => {
    await reset([
      { id: 606, code: 'pr-06', name: 'Old PR6' },
      { id: 700, code: 'final_block', name: 'Final Block' },
    ]);
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /both pr-06 and final_block/i);
    assert.equal(await count('pr-06'), 1, 'nothing deleted');
    assert.equal(await count('final_block'), 1);
  });

  test('Case D: neither code → abort, invents nothing', async () => {
    await reset([]);
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /neither pr-06 nor final_block/i);
    assert.equal(await count('final_block'), 0);
  });

  test('Case E: duplicate pr-06 rows → abort, reports count', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'PR6 a' },
                 { id: 607, code: 'pr-06b', name: 'PR6 b' }]);
    // Force a genuine duplicate by dropping UNIQUE for this fixture only.
    await client.query(`ALTER TABLE process_master DROP CONSTRAINT IF EXISTS process_master_process_code_key`);
    await client.query(`UPDATE process_master SET process_code='pr-06' WHERE id=607`);
    const res = await runMigration(PHASE63);
    assert.equal(res.ok, false);
    assert.match(res.message, /at most one pr-06/i);
  });

  test('idempotent: applying Phase 63 twice ends in the same state', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }]);
    assert.equal((await runMigration(PHASE63)).ok, true);
    const second = await runMigration(PHASE63);
    assert.equal(second.ok, true, second.message);
    assert.equal(await count('final_block'), 1);
    assert.equal(await count('pr-06'), 0);
  });

  // ── Phase 64 ──────────────────────────────────────────────────────────────

  test('Phase 64: configures the single final_block row (activates transform)', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }]);
    assert.equal((await runMigration(PHASE63)).ok, true);
    const before = await snapshotNeighbours();

    const res = await runMigration(PHASE64);
    assert.equal(res.ok, true, res.message);

    const { rows } = await client.query(
      `SELECT completion_mode, input_item_category, active, process_group, allowed_outputs
       FROM process_master WHERE process_code='final_block'`);
    assert.equal(rows[0].completion_mode, 'RETURN_BASED');
    assert.equal(rows[0].input_item_category, 'growth_diamond');
    assert.equal(rows[0].active, true);
    assert.equal(rows[0].process_group, 'LASER');
    const usable = rows[0].allowed_outputs.find(o => o.type === 'usable');
    assert.equal(usable.transform_in_place, true);
    assert.equal(usable.item_category_override, 'rough');
    assert.equal(await snapshotNeighbours(), before, 'neighbours must be untouched');
  });

  test('Phase 64: rejects a remaining pr-06 (no silent no-op)', async () => {
    await reset([
      { id: 606, code: 'pr-06', name: 'Old PR6' },
      { id: 700, code: 'final_block', name: 'Final Block' },
    ]);
    const res = await runMigration(PHASE64);
    assert.equal(res.ok, false);
    assert.match(res.message, /pr-06 row\(s\) still present/i);
  });

  test('Phase 64: rejects a missing final_block (no silent no-op)', async () => {
    await reset([]);
    const res = await runMigration(PHASE64);
    assert.equal(res.ok, false);
    assert.match(res.message, /expected exactly one final_block row, found 0/i);
  });

  test('Phase 64: idempotent when configuration already present', async () => {
    await reset([{ id: 606, code: 'pr-06', name: 'Old PR6' }]);
    assert.equal((await runMigration(PHASE63)).ok, true);
    assert.equal((await runMigration(PHASE64)).ok, true);
    const second = await runMigration(PHASE64);
    assert.equal(second.ok, true, second.message);
    assert.equal(await count('final_block'), 1);
  });
}

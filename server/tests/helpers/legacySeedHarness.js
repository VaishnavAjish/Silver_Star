'use strict';

// ============================================================================
// Legacy Seed Remove test harness.
//
// Runs the REAL route handlers (routes/lotProcessIssues.js) against a REAL
// disposable PostgreSQL. Only the process edges are doubled, following the
// repository's established require.cache pattern (see copySetupPreview /
// brick7AdminConcurrency tests):
//   · db/pool            → a real pg.Pool aimed at the disposable cluster,
//                          with an optional per-query interceptor used for
//                          concurrency barriers and failure injection;
//   · middleware/auth    → authenticate from the x-test-user header;
//                          authorize replicating the REAL semantics
//                          (exact 'super_admin' bypass + explicit role list);
//   · eventDispatcher    → no-op (socket fan-out is out of scope).
//
// Everything else — planner, locks, genealogy, value pools, audit — is the
// production code under test.
// ============================================================================

const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const SERVER_ROOT = path.join(__dirname, '..', '..');

let realPool = null;
let interceptor = null; // async (sql, params, tag) => void — may throw/await

function setQueryInterceptor(fn) { interceptor = fn; }

function wrapClient(client, tag) {
  return {
    query: async (sql, params) => {
      if (interceptor) await interceptor(String(sql), params, tag);
      return client.query(sql, params);
    },
    release: (...a) => client.release(...a),
  };
}

let connectCounter = 0;

function installTestDoubles(pgConfig) {
  realPool = new Pool(pgConfig);

  const poolStub = {
    query: (sql, params) => realPool.query(sql, params),
    connect: async () => wrapClient(await realPool.connect(), `conn-${++connectCounter}`),
    transaction: async (fn) => {
      const c = await realPool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    end: () => realPool.end(),
    shutdown: () => realPool.end(),
    poolStats: () => ({}),
    healthCheck: async () => true,
    rlsContext: { run: (_s, fn) => fn(), getStore: () => undefined },
  };
  poolStub.primaryPool = {
    connect: poolStub.connect,
    query: poolStub.query,
    end: poolStub.end,
  };

  const poison = (relPath, exportsObj) => {
    const resolved = require.resolve(path.join(SERVER_ROOT, relPath));
    require.cache[resolved] = {
      id: resolved, filename: resolved, loaded: true, exports: exportsObj,
    };
  };

  poison('db/pool.js', poolStub);

  poison('middleware/auth.js', {
    authenticate: (req, res, next) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'No test user' });
      req.user = JSON.parse(raw);
      next();
    },
    // EXACT replica of middleware/auth.js authorize(): strict 'super_admin'
    // bypass, otherwise explicit role membership.
    authorize: (...roles) => (req, res, next) => {
      if (req.user.role === 'super_admin' || roles.includes(req.user.role)) return next();
      return res.status(403).json({ error: 'Forbidden' });
    },
  });

  poison('services/eventDispatcher.js', { dispatchEvent: () => {}, initDispatcher: () => {} });

  return poolStub;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  // Loaded AFTER the doubles are installed — real production handlers.
  app.use('/api/lot-process-issues', require(path.join(SERVER_ROOT, 'routes', 'lotProcessIssues.js')));
  return app;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// Phase 59 seed_remove component-group configuration (verbatim copy of the
// live migration's constant array — DETACH_TRANSFORM_IN_PLACE strategy).
const SEED_REMOVE_OUTPUTS = [
  { type: 'reprocess',        label: 'Recovered Seed',   suffix: 'S',  status: 'IN STOCK', item_category_override: 'seed',           component: 'seed' },
  { type: 'seed_damaged',     label: 'Seed Damaged',     suffix: 'SD', status: 'DAMAGED',  item_category_override: 'seed',           component: 'seed' },
  { type: 'seed_consumed',    label: 'Seed Consumed',    suffix: 'SC', status: 'CONSUMED', item_category_override: 'seed',           component: 'seed' },
  { type: 'seed_qc',          label: 'Seed QC Hold',     suffix: 'SQ', status: 'QC_HOLD',  item_category_override: 'seed',           component: 'seed' },
  { type: 'usable',           label: 'Growth Diamond',   suffix: 'R',  status: 'IN STOCK', item_category_override: 'growth_diamond', component: 'diamond' },
  { type: 'diamond_damaged',  label: 'Diamond Damaged',  suffix: 'GD', status: 'DAMAGED',  item_category_override: 'growth_diamond', component: 'diamond' },
  { type: 'diamond_consumed', label: 'Diamond Consumed', suffix: 'GC', status: 'CONSUMED', item_category_override: 'growth_diamond', component: 'diamond' },
  { type: 'diamond_qc',       label: 'Diamond QC Hold',  suffix: 'GQ', status: 'QC_HOLD',  item_category_override: 'growth_diamond', component: 'diamond' },
];

async function ensureBaseData(db) {
  // Columns present in production but newer than the repo schema dump.
  await db.query('ALTER TABLE process_master ADD COLUMN IF NOT EXISTS allowed_outputs jsonb');
  await db.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS run_no integer');
  await db.query('ALTER TABLE lot_process_returns ADD COLUMN IF NOT EXISTS pre_state jsonb');

  await db.query(`INSERT INTO users (id, username, password_hash, full_name, role)
    VALUES (1,'t_super','x','Test Super Admin','super_admin'),
           (2,'t_admin','x','Test Admin','admin'),
           (3,'t_operator','x','Test Operator','operator')
    ON CONFLICT (id) DO NOTHING`);

  const { rows: items } = await db.query(`
    INSERT INTO items (code, name, category, default_uom, status)
    VALUES ('T-SEED','Test Seed','seed','PCS','active'),
           ('T-GRUN','Test Growth Run','growth_run','PCS','active'),
           ('GROWTH_DIAMOND','Growth Diamond','growth_diamond','PCS','active'),
           ('T-ROUGH','Test Rough','rough','CTS','active')
    ON CONFLICT DO NOTHING
    RETURNING id, category`);
  const byCat = {};
  if (items.length) {
    for (const it of items) byCat[it.category] = it.id;
  } else {
    const { rows } = await db.query(
      "SELECT id, category FROM items WHERE category IN ('seed','growth_run','growth_diamond','rough')");
    for (const it of rows) byCat[it.category] = it.id;
  }

  await db.query(`
    INSERT INTO process_master (process_code, process_name, category, requires_inventory,
      requires_machine, active, completion_mode, process_group, allowed_outputs)
    VALUES ('seed_remove','Seed Remove','PRIMARY', true, true, true,
      'RETURN_BASED','LASER', $1::jsonb)
    ON CONFLICT DO NOTHING`, [JSON.stringify(SEED_REMOVE_OUTPUTS)]);
  await db.query(`
    INSERT INTO process_master (process_code, process_name, category, requires_inventory,
      requires_machine, active, completion_mode, process_group)
    VALUES ('growth','Growth','PRIMARY', true, true, true, 'RETURN_BASED','GROWTH')
    ON CONFLICT DO NOTHING`);

  return byCat;
}

let fixtureSeq = 0;

/**
 * Build a Seed Remove scenario on the disposable DB.
 *
 * Legacy (default): the Growth Run biscuit exists with an OPEN seed_remove
 * issue, but NO attached Seed, NO growth issue chain → canonical resolution
 * finds zero candidates and the planner REJECTs with legacyResolutionRequired.
 *
 * healthy: true additionally creates the RETURNED growth issue, the attached
 * Seed process lot (ATTACHED_TO_GROWTH / IN PROCESS) and the
 * growth_run_cycles linkage → the canonical resolver succeeds.
 */
async function createScenario(db, items, {
  healthy = false,
  rootRate = 5000,
  qty = 24,
  machineProcessStatus = 'running',
} = {}) {
  const n = ++fixtureSeq;
  const lop = async () => (await db.query("SELECT nextval('lot_op_id_seq') AS n")).rows[0].n;

  const { rows: [machine] } = await db.query(
    `INSERT INTO machines (code, name, type, status) VALUES ($1,$2,'laser','running') RETURNING *`,
    [`M-${n}`, `Test Laser ${n}`]);

  const { rows: [root] } = await db.query(
    `INSERT INTO inventory (item_id, lot_number, lot_code, lot_name, qty, unit, weight, rate, total_value,
       status, split_level, genealogy_path, lot_op_id, dim_length, dim_depth, dim_height, dim_unit,
       source_module)
     VALUES ($1,$2::varchar,$2::varchar,$3,100,'PCS',120.5,$4,$5,'IN STOCK',0,$2::text,$6,11.25,11.25,0.30,'mm','Purchase')
     RETURNING *`,
    [items.seed, `HXT${String(n).padStart(3, '0')}`, `Test Root Seed ${n}`,
      rootRate, Math.round(100 * rootRate * 100) / 100, await lop()]);

  const { rows: [biscuit] } = await db.query(
    `INSERT INTO inventory (item_id, lot_number, lot_code, lot_name, qty, unit, weight, rate, total_value,
       status, lot_op_id, run_no, source_module)
     VALUES ($1,$2::varchar,$2::varchar,$3,$4,'PCS',30.0000,0,80000,'IN PROCESS',$5,3,'Manufacturing')
     RETURNING *`,
    [items.growth_run, `GRT-TEST-${String(n).padStart(4, '0')}`, `Test Growth Run ${n}`, qty, await lop()]);

  let attachedSeed = null;
  if (healthy) {
    const { rows: [gmp] } = await db.query(
      `INSERT INTO machine_processes (process_number, machine_id, process_type, status, completed_at)
       VALUES ($1,$2,'growth','completed', now()) RETURNING *`,
      [`PR-G-${String(n).padStart(4, '0')}`, machine.id]);
    const { rows: [seedLot] } = await db.query(
      `INSERT INTO inventory (item_id, lot_number, lot_code, lot_name, qty, unit, weight, rate, total_value,
         status, manufacturing_state, parent_lot_id, root_lot_id, split_level, genealogy_path, lot_op_id,
         dim_length, dim_depth, dim_height, dim_unit, source_type, operation_type, source_module)
       VALUES ($1,$2::varchar,$2::varchar,$3,$4,'PCS',28.0000,$5,$6,'IN PROCESS','ATTACHED_TO_GROWTH',$7,$7,1,$8,$9,
         11.25,11.25,0.30,'mm','issue','issue','Process Issues')
       RETURNING *`,
      [items.seed, `${root.lot_code}-01`, `${root.lot_name} (in process)`, qty,
        rootRate, Math.round(qty * rootRate * 100) / 100, root.id,
        `${root.lot_code}/${root.lot_code}-01`, await lop()]);
    attachedSeed = seedLot;
    await db.query(
      `INSERT INTO lot_process_issues (issue_number, source_lot_id, process_lot_id, issued_qty,
         status, machine_id, machine_process_id, process_type, remaining_in_process, created_by)
       VALUES ($1,$2,$3,$4,'RETURNED',$5,$6,'growth',0,1)`,
      [`PI-TEST-G-${String(n).padStart(4, '0')}`, root.id, seedLot.id, qty, machine.id, gmp.id]);
    await db.query(
      `INSERT INTO growth_run_cycles (growth_run_id, machine_process_id, cycle_no, process_type)
       VALUES ($1,$2,1,'growth')`,
      [biscuit.id, gmp.id]);
  }

  const { rows: [mp] } = await db.query(
    `INSERT INTO machine_processes (process_number, machine_id, process_type, status, completed_at)
     VALUES ($1,$2,'seed_remove',$3::varchar, CASE WHEN $3::varchar = 'completed' THEN now() ELSE NULL END) RETURNING *`,
    [`PR-SR-${String(n).padStart(4, '0')}`, machine.id, machineProcessStatus]);

  const { rows: [issue] } = await db.query(
    `INSERT INTO lot_process_issues (issue_number, source_lot_id, process_lot_id, issued_qty,
       status, machine_id, machine_process_id, process_type, remaining_in_process, created_by)
     VALUES ($1,$2,$3,$4,'OPEN',$5,$6,'seed_remove',$4,1) RETURNING *`,
    [`PI-TEST-${String(n).padStart(4, '0')}`, biscuit.id, biscuit.id, qty, machine.id, mp.id]);

  return { machine, root, biscuit, attachedSeed, machineProcess: mp, issue, qty };
}

// Canonical Seed Remove request body (component groups, both families fully
// allocated) + the Super Admin legacy override envelope.
function seedRemoveBody({ qty = 24, seedWeight = 29.43, diamondWeight = 55.2, override = null } = {}) {
  const body = {
    return_date: '2026-08-19',
    lines: [
      { type: 'reprocess', qty, weight: seedWeight },
      { type: 'usable', qty, weight: diamondWeight },
    ],
  };
  if (override) body.legacy_seed_override = override;
  return body;
}

const SUPER = JSON.stringify({ id: 1, role: 'super_admin' });
const ADMIN = JSON.stringify({ id: 2, role: 'admin' });
const OPERATOR = JSON.stringify({ id: 3, role: 'operator' });
const VIEWER = JSON.stringify({ id: 3, role: 'viewer' });

async function snapshotRow(db, table, id) {
  const { rows: [row] } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return row;
}

module.exports = {
  installTestDoubles, buildApp, setQueryInterceptor,
  ensureBaseData, createScenario, seedRemoveBody, snapshotRow,
  SEED_REMOVE_OUTPUTS, SUPER, ADMIN, OPERATOR, VIEWER,
};

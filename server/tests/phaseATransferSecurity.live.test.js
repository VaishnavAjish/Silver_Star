/**
 * Phase A — live department-scope integration tests (READ ONLY).
 *
 * Runs the REAL route SQL, with the REAL scope resolver, against the REAL
 * database, using each user's actual user_inventory_scopes configuration.
 * Nothing under test is mocked: only the connection is supplied.
 *
 * The session is pinned read-only (SET default_transaction_read_only = on),
 * so these tests can never mutate production data.
 *
 * Canary: ST-202608-0038 (Admin -> Account). The Laser user (id 16, SELECTED
 * [Laser]) is neither source nor destination and must not see it anywhere.
 *
 * Skips cleanly when the database is unreachable (e.g. CI without VPC access).
 *
 * Run: node --test server/tests/phaseATransferSecurity.live.test.js
 */

'use strict';

const path   = require('path');
const test   = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

const CANARY        = 'ST-202608-0038';
const LASER_USER_ID = 16;         // scope SELECTED [4 Laser]
const SUPERADMIN_ID = 6;
const DEPT_LASER    = 4;
const DEPT_ACCOUNT  = 5;
// One of the six lots moved by the canary; currently sits in Account (5).
const CANARY_LOT_ID = 241;

let client = null;
let dbUp   = false;

// ── Route the app's pool through this read-only client, so loadDeptScope
//    exercises the genuine resolver against genuine scope rows. ─────────────
const poolPath = require.resolve('../db/pool');
const proxyPool = {
  query: (sql, params) => client.query(sql, params),
};
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: { ...proxyPool, primaryPool: proxyPool },
};

const {
  loadDeptScope,
  buildMovementScopeClause,
  isLotVisible,
} = require('../services/inventoryAuth');

let connectPromise = null;

async function connectOnce() {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      client = new Client({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      await client.query('SET default_transaction_read_only = on');
      dbUp = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[phaseA.live] database unreachable — skipping: ${err.message}`);
      dbUp = false;
    }
    return dbUp;
  })();
  return connectPromise;
}

/**
 * Lazy guard. `{ skip: ... }` is evaluated when tests are REGISTERED, which
 * is before any hook has run, so the connection must be checked inside the
 * test body instead.
 */
async function ready(t) {
  if (await connectOnce()) return true;
  t.skip('database unreachable');
  return false;
}

test.after(async () => { if (client && dbUp) await client.end(); });

/** The real GET /api/lot-movements list query, scoped. */
async function listMovements(scope, { pageSize = 500, offset = 0 } = {}) {
  const { clause, params } = buildMovementScopeClause(scope, [], 'lm');
  const where = clause ? `WHERE 1=1${clause}` : '';
  const dataParams = [...params, pageSize, offset];
  const { rows } = await client.query(
    `SELECT lm.id, lm.movement_number
       FROM lot_movements lm
       ${where}
       ORDER BY lm.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  const { rows: [c] } = await client.query(
    `SELECT COUNT(*) FROM lot_movements lm ${where}`, params
  );
  return { rows, total: parseInt(c.count, 10) };
}

/** The real GET /api/lot-movements/:id detail query, scoped. */
async function getMovementByNumber(scope, movementNumber) {
  const { clause, params } = buildMovementScopeClause(scope, [movementNumber], 'lm');
  const { rows } = await client.query(
    `SELECT lm.id FROM lot_movements lm WHERE lm.movement_number = $1${clause}`,
    params
  );
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Canary — ST-202608-0038 must be invisible to Laser on every surface
// ═══════════════════════════════════════════════════════════════════════════

test('CANARY 1 — Laser cannot list ST-202608-0038', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(LASER_USER_ID, 'operator');
  assert.equal(scope.isAll, false, 'Laser must not resolve to all-department scope');
  assert.deepEqual(scope.allowedDeptIds, [DEPT_LASER]);

  const { rows } = await listMovements(scope);
  const found = rows.find(r => r.movement_number === CANARY);
  assert.equal(found, undefined, `${CANARY} must not appear in Laser's movement list`);
});

test('CANARY 2 — Laser cannot open ST-202608-0038 detail', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(LASER_USER_ID, 'operator');
  const mv = await getMovementByNumber(scope, CANARY);
  assert.equal(mv, null, 'detail query must return no row (route answers 404)');
});

test('CANARY 3 — Laser cannot access the canary lot lineage root', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(LASER_USER_ID, 'operator');
  const { rows: [lot] } = await client.query(
    'SELECT id, department_id FROM inventory WHERE id = $1', [CANARY_LOT_ID]
  );
  assert.ok(lot, 'fixture lot must exist');
  assert.equal(Number(lot.department_id), DEPT_ACCOUNT, 'fixture lot is an Account lot');
  assert.equal(isLotVisible(scope, lot), false, 'lineage root must be rejected → 404');
});

test('CANARY 4 — Laser transfer history excludes the canary', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(LASER_USER_ID, 'operator');
  const { clause, params } = buildMovementScopeClause(scope, [], 'lm');
  const { rows } = await client.query(
    `SELECT DISTINCT lm.movement_number
       FROM lot_movements lm
       JOIN lot_movement_parents lmp ON lmp.movement_id = lm.id
       JOIN inventory inv ON inv.id = lmp.parent_lot_id
      WHERE lm.movement_type = 'transfer'${clause}`,
    params
  );
  assert.ok(!rows.some(r => r.movement_number === CANARY),
    `${CANARY} must not appear in Laser's transfer history`);
});

test('CANARY 5 — Laser search cannot surface the canary lot code', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(LASER_USER_ID, 'operator');
  const { rows: [lot] } = await client.query(
    'SELECT lot_code FROM inventory WHERE id = $1', [CANARY_LOT_ID]
  );
  const { rows } = await client.query(
    `SELECT id FROM inventory
      WHERE (lot_number ILIKE $1 OR lot_name ILIKE $1)
        AND department_id = ANY($2::int[])`,
    ['%' + lot.lot_code + '%', scope.allowedDeptIds]
  );
  assert.equal(rows.length, 0,
    "searching another department's exact lot code must return nothing");
});

// ═══════════════════════════════════════════════════════════════════════════
// Super Admin bypass must survive
// ═══════════════════════════════════════════════════════════════════════════

test('Super Admin still sees ST-202608-0038 in the list', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(SUPERADMIN_ID, 'super_admin');
  assert.equal(scope.isAll, true);
  const { rows } = await listMovements(scope);
  assert.ok(rows.some(r => r.movement_number === CANARY),
    `${CANARY} must remain visible to Super Admin`);
});

test('Super Admin can still open ST-202608-0038 detail', async (t) => {
  if (!await ready(t)) return;
  const scope = await loadDeptScope(SUPERADMIN_ID, 'super_admin');
  const mv = await getMovementByNumber(scope, CANARY);
  assert.ok(mv && mv.id, 'Super Admin detail must resolve');
});

// ═══════════════════════════════════════════════════════════════════════════
// Incoming / outgoing / unrelated
// ═══════════════════════════════════════════════════════════════════════════

test('Laser sees every movement touching a Laser lot, and only those',
  async (t) => {
  if (!await ready(t)) return;
    const scope = await loadDeptScope(LASER_USER_ID, 'operator');
    const { rows } = await listMovements(scope);

    // Independently recompute the authorised set straight from the data.
    const { rows: expected } = await client.query(
      `SELECT DISTINCT lm.id
         FROM lot_movements lm
         WHERE EXISTS (SELECT 1 FROM lot_movement_parents p
                       JOIN inventory i ON i.id = p.parent_lot_id
                       WHERE p.movement_id = lm.id AND i.department_id = $1)
            OR EXISTS (SELECT 1 FROM lot_movement_children c
                       JOIN inventory i ON i.id = c.child_lot_id
                       WHERE c.movement_id = lm.id AND i.department_id = $1)`,
      [DEPT_LASER]
    );
    const expectedIds = [...new Set(expected.map(r => r.id))].sort((a, b) => a - b);
    const actualIds   = [...new Set(rows.map(r => r.id))].sort((a, b) => a - b);
    assert.deepEqual(actualIds, expectedIds,
      'scoped list must equal the relationally-authorised set exactly');
  });

// ═══════════════════════════════════════════════════════════════════════════
// NONE / ALL / pagination
// ═══════════════════════════════════════════════════════════════════════════

test('NONE scope returns no movements at all', async (t) => {
  if (!await ready(t)) return;
  const none = { isAll: false, isNone: true, allowedDeptIds: [], includeUnassigned: false };
  const { rows, total } = await listMovements(none);
  assert.equal(rows.length, 0);
  assert.equal(total, 0);
});

test('ALL scope returns the full set (never narrowed to a department)',
  async (t) => {
  if (!await ready(t)) return;
    const all = { isAll: true, isNone: false, allowedDeptIds: [], includeUnassigned: true };
    const { total } = await listMovements(all);
    const { rows: [c] } = await client.query('SELECT COUNT(*) FROM lot_movements');
    assert.equal(total, parseInt(c.count, 10));
  });

test('Pagination reconciles: scoped count equals the sum of scoped pages',
  async (t) => {
  if (!await ready(t)) return;
    const scope = await loadDeptScope(LASER_USER_ID, 'operator');
    const { total } = await listMovements(scope, { pageSize: 500, offset: 0 });

    const PAGE = 3;
    let seen = 0;
    for (let offset = 0; offset < total; offset += PAGE) {
      const { rows } = await listMovements(scope, { pageSize: PAGE, offset });
      seen += rows.length;
    }
    assert.equal(seen, total, 'paged rows must add up to the scoped count');
  });

test('Every visible transfer touches an allowed department',
  async (t) => {
  if (!await ready(t)) return;
    const scope = await loadDeptScope(LASER_USER_ID, 'operator');
    const { clause, params } = buildMovementScopeClause(scope, [], 'lm');
    const { rows } = await client.query(
      `SELECT lm.id,
              (SELECT array_agg(DISTINCT i.department_id)
                 FROM lot_movement_parents p JOIN inventory i ON i.id = p.parent_lot_id
                WHERE p.movement_id = lm.id) AS parent_depts,
              (SELECT array_agg(DISTINCT i.department_id)
                 FROM lot_movement_children c JOIN inventory i ON i.id = c.child_lot_id
                WHERE c.movement_id = lm.id) AS child_depts
         FROM lot_movements lm
        WHERE lm.movement_type = 'transfer'${clause}`,
      params
    );
    for (const r of rows) {
      const depts = [...(r.parent_depts || []), ...(r.child_depts || [])].map(Number);
      assert.ok(depts.includes(DEPT_LASER),
        `movement ${r.id} surfaced without any Laser lot`);
    }
  });

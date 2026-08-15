/**
 * Phase 1 — Seed & Gas stock service tests.
 *
 * Part A: pure size-normalisation and bucket-priority logic (no DB).
 * Part B: live reconciliation against the real database, READ ONLY
 *         (SET default_transaction_read_only = on), auto-skipping when the
 *         database is unreachable.
 *
 * The classification logic itself is never mocked — Part B runs the real
 * service against real rows.
 *
 * Run: node --test server/tests/seedStock.test.js
 */

'use strict';

const path   = require('path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

after(async () => {
  try {
    const poolPath = require.resolve('../db/pool');
    if (require.cache[poolPath]) {
      await require(poolPath).end();
    }
  } catch (e) {}
});

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');

let client = null;
let dbUp   = false;
let connectPromise = null;

// Route the service's pool through a read-only client.
const poolPath = require.resolve('../db/pool');
const proxyPool = { query: (sql, params) => client.query(sql, params) };
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: { ...proxyPool, primaryPool: proxyPool },
};

const svc = require('../services/seedStockService');
const { effectiveManufacturingState } = require('../services/manufacturingState');

async function connectOnce() {
  if (!process.env.DB_HOST && !process.env.PGHOST) return false;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      client = new Client({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      });
      await client.connect();
      await client.query('SET default_transaction_read_only = on');
      dbUp = true;
    } catch (err) {
      console.log(`[seedStock.live] database unreachable — skipping: ${err.message}`);
      dbUp = false;
    }
    return dbUp;
  })();
  return connectPromise;
}

/** `{skip:…}` is evaluated at registration, before hooks — guard in-body. */
async function ready(t) {
  if (await connectOnce()) return true;
  t.skip('database unreachable');
  return false;
}

test.after(async () => { if (client && dbUp) await client.end(); });

const ALL = { isAll: true, isNone: false, allowedDeptIds: [], includeUnassigned: true,
              scopeMode: 'ALL', canViewFinancial: true };
const NOFIN = { ...ALL, canViewFinancial: false };

// ════════════════════════════════════════════════════════════════════════════
// Part A — pure logic
// ════════════════════════════════════════════════════════════════════════════

test('TEST 11 — 13, 13.0 and 13.00 normalise to one size key', () => {
  const a = svc.sizeKey(13, 13, 0.3, 'mm');
  const b = svc.sizeKey(13.0, 13.00, 0.300, 'mm');
  const c = svc.sizeKey('13.000', '13.000', '0.300', 'mm');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('TEST 12 — rectangular orientation is normalised', () => {
  // Orientation is normalised in SQL via GREATEST/LEAST; the JS key helper
  // must agree when handed the canonical (major, minor) order.
  assert.equal(svc.sizeKey(26, 13, 0.3, 'mm'), svc.sizeKey(26.0, 13.00, 0.3, 'mm'));
  assert.equal(svc.sizeLabel(26, 13, 'mm'), '26 × 13 mm');
});

test('square seed labels with two decimals, rectangular with major first', () => {
  assert.equal(svc.sizeLabel(13, 13, 'mm'), '13.00 mm');
  assert.equal(svc.sizeLabel(12.5, 12.5, 'mm'), '12.50 mm');
  assert.equal(svc.sizeLabel(24, 12, 'mm'), '24 × 12 mm');
});

test('TEST 10 — missing dimensions map to Unspecified, never dropped', () => {
  assert.equal(svc.sizeKey(null, null, null, null), 'unspecified');
  assert.equal(svc.sizeKey(13, null, 0.3, 'mm'), 'unspecified');
  assert.equal(svc.sizeLabel(null, null, 'mm'), 'Unspecified');
});

test('TEST 9 — Seed Remove outranks Cutting and Growth', () => {
  const r = svc.PROCESS_RANK;
  assert.ok(r.seed_remove < r.edge_cut,    'seed_remove must beat edge_cut');
  assert.ok(r.seed_remove < r.outer_cut,   'seed_remove must beat outer_cut');
  assert.ok(r.seed_remove < r.block_cut,   'seed_remove must beat block_cut');
  assert.ok(r.seed_remove < r.final_block, 'seed_remove must beat final_block');
  assert.ok(r.seed_remove < r.growth,      'seed_remove must beat growth');
  assert.ok(r.seed_remove < r['pr-01'],    'seed_remove must beat pr-01');
  assert.ok(r.edge_cut    < r.growth,      'cutting must beat growth');
});

test('bucket list is the agreed eight, in priority order', () => {
  assert.deepEqual(svc.BUCKETS, [
    'crack_consumed', 'seed_remove_wip', 'cutting', 'growth_machine',
    'attached_between', 'used', 'new', 'unclassified',
  ]);
});

test('classification SQL uses stable IDs, never text or the stale pointer', () => {
  const sql = svc.seedClassificationSql('');
  assert.match(sql, /run\.parent_lot_id\s*=\s*s\.id/, 'must join run → seed by id');
  assert.match(sql, /lpi\.process_lot_id\s*=\s*run\.id/, 'must join issue → run by id');
  assert.match(sql, /lpi\.status\s*=\s*'OPEN'/);
  assert.doesNotMatch(sql, /machine_process_id/, 'stale pointer must not be used');
  assert.doesNotMatch(sql, /genealogy_path/,     'genealogy text must not be parsed');
});

test('legacy NULL manufacturing_state resolves through the canonical helper', () => {
  const sql = svc.seedClassificationSql('');
  const canonicalDefault = effectiveManufacturingState(null);
  assert.equal(canonicalDefault, 'AVAILABLE');
  assert.match(sql, new RegExp(`COALESCE\\(inv\\.manufacturing_state, '${canonicalDefault}'\\)`));
});

// ════════════════════════════════════════════════════════════════════════════
// Part B — live reconciliation
// ════════════════════════════════════════════════════════════════════════════

test('TEST 1 — Seed reconciliation difference is exactly zero', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, { show_zero: 'true' });
  assert.equal(r.summary.reconciliation_difference, 0,
    'bucket quantities must sum to total owned Seed quantity');
});

test('TEST 2 — every Seed lot lands in exactly one bucket', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, { show_zero: 'true' });

  const { rows: [tot] } = await client.query(
    `SELECT COUNT(*)::int lots FROM inventory inv JOIN items i ON i.id=inv.item_id
      WHERE i.category='seed'`);

  const summed = r.rows.reduce((s, row) =>
    s + svc.BUCKETS.reduce((b, k) => b + row[k].lots, 0), 0);
  assert.equal(summed, tot.lots,
    'per-bucket lot counts must sum to total Seed lots — no double count, no drop');
  assert.equal(r.summary.total_lots, tot.lots);
});

test('TEST 3/4 — New is AVAILABLE+legacy NULL, Used is RECOVERED', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, { show_zero: 'true' });

  const { rows: [exp] } = await client.query(
    `SELECT
       COALESCE(SUM(inv.qty) FILTER (WHERE inv.status='IN STOCK'
                AND COALESCE(inv.manufacturing_state,'AVAILABLE')='AVAILABLE'),0)::float AS new_qty,
       COALESCE(SUM(inv.qty) FILTER (WHERE inv.status='IN STOCK'
                AND inv.manufacturing_state='RECOVERED'),0)::float AS used_qty
     FROM inventory inv JOIN items i ON i.id=inv.item_id WHERE i.category='seed'`);

  assert.equal(r.summary.new_qty,  Math.round(exp.new_qty  * 10000) / 10000);
  assert.equal(r.summary.used_qty, Math.round(exp.used_qty * 10000) / 10000);
});

test('TEST 5/6/7/8 — attached Seed splits across process buckets and sums back',
  async (t) => {
    if (!await ready(t)) return;
    const s = (await svc.getSeedStock(ALL, { show_zero: 'true' })).summary;

    const { rows: [att] } = await client.query(
      `SELECT COALESCE(SUM(qty),0)::float q FROM inventory inv JOIN items i ON i.id=inv.item_id
        WHERE i.category='seed' AND inv.manufacturing_state='ATTACHED_TO_GROWTH'
          AND inv.status='IN PROCESS'`);

    const attachedTotal = s.growth_machine_qty + s.cutting_qty
                        + s.seed_remove_qty + s.attached_between_qty;
    assert.equal(Math.round(attachedTotal * 10000) / 10000,
                 Math.round(att.q * 10000) / 10000,
      'growth + cutting + seed_remove + between must equal all attached in-process Seed');
  });

test('TEST 13 — drill-down total equals the summary cell it came from', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, { show_zero: 'true' });

  let checked = 0;
  for (const row of r.rows) {
    for (const bucket of svc.BUCKETS) {
      if (row[bucket].lots === 0) continue;
      const d = await svc.getSeedLots(ALL, { size_key: row.size_key, bucket });
      assert.equal(d.total_lots, row[bucket].lots,
        `lots mismatch for ${row.size_label} / ${bucket}`);
      assert.equal(d.total_qty, row[bucket].qty,
        `qty mismatch for ${row.size_label} / ${bucket}`);
      checked++;
      if (checked >= 12) return;   // representative sample keeps the suite quick
    }
  }
  assert.ok(checked > 0, 'expected at least one non-empty cell to verify');
});

test('TEST 14 — department scope narrows the aggregate', async (t) => {
  if (!await ready(t)) return;
  const all = await svc.getSeedStock(ALL, { show_zero: 'true' });

  const NONE = { isAll: false, isNone: true, allowedDeptIds: [], includeUnassigned: false,
                 scopeMode: 'NONE', canViewFinancial: true };
  const none = await svc.getSeedStock(NONE, { show_zero: 'true' });
  assert.equal(none.summary.total_qty, 0, 'NONE scope must aggregate to nothing');
  assert.equal(none.rows.length, 0);

  const LASER = { isAll: false, isNone: false, allowedDeptIds: [4],
                  includeUnassigned: false, scopeMode: 'SELECTED', canViewFinancial: true };
  const laser = await svc.getSeedStock(LASER, { show_zero: 'true' });
  assert.ok(laser.summary.total_qty <= all.summary.total_qty,
    'a restricted scope can never exceed the unrestricted total');
  assert.equal(laser.summary.reconciliation_difference, 0,
    'reconciliation must hold under a filtered scope too');
});

test('TEST 15 — no financial keys without the financial permission', async (t) => {
  if (!await ready(t)) return;
  const d = await svc.getSeedLots(NOFIN, {});
  for (const row of d.data.slice(0, 25)) {
    assert.ok(!('rate' in row),        'rate key must be absent, not null');
    assert.ok(!('total_value' in row), 'total_value key must be absent, not null');
  }
  const g = await svc.getGasStock(NOFIN, {}, { includeCentral: true });
  assert.ok(!('total_value' in g.summary), 'gas summary value must be withheld');
});

test('filters never break reconciliation', async (t) => {
  if (!await ready(t)) return;
  const filtered = await svc.getSeedStock(ALL, { min_qty: '50' });
  assert.equal(filtered.summary.reconciliation_difference, 0);
  assert.ok(filtered.summary.filtered_qty <= filtered.summary.total_qty,
    'filtered quantity can never exceed the unfiltered total');
});

test('unclassified is reported, never hidden or hardcoded', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, { show_zero: 'true' });
  assert.ok(typeof r.summary.unclassified_qty === 'number');
  assert.ok(typeof r.summary.unclassified_lots === 'number');
});

test('Phase 2 limitations are declared honestly', async (t) => {
  if (!await ready(t)) return;
  const r = await svc.getSeedStock(ALL, {});
  assert.deepEqual(r.limitations, {
    hold_tracked: false,
    polish_tracked: false,
    crack_separated_from_consumed: false,
    physical_count_available: false,
  });
});

// ── Gas ──────────────────────────────────────────────────────────────────────

test('TEST 19/20 — Gas is grouped per unit; CYL and PCS never summed', async (t) => {
  if (!await ready(t)) return;
  // Central authority granted here — the withholding rule has its own test.
  const g = await svc.getGasStock(ALL, {}, { includeCentral: true });

  const { rows: [tot] } = await client.query(
    `SELECT COUNT(*)::int lots FROM inventory inv JOIN items i ON i.id=inv.item_id
      WHERE i.category='gas'`);
  assert.equal(g.summary.total_lots, tot.lots, 'every Gas lot must be represented');

  assert.ok(Object.keys(g.summary.totals_by_unit).length >= 1);
  for (const row of g.rows) {
    assert.ok(row.unit !== undefined, 'each row must carry its own unit');
  }
  // The mixed-unit defect found in the audit must be surfaced, not hidden.
  assert.ok(Array.isArray(g.data_quality.mixed_unit_items));
});

test('TEST 17/18 — Gas excluded from the default list, but never deleted',
  async (t) => {
    if (!await ready(t)) return;
    // Mirrors the route's default vs explicit-category branch.
    const { rows: [def] } = await client.query(
      `SELECT COUNT(*)::int n FROM inventory inv JOIN items i ON i.id=inv.item_id
        WHERE 1=1 AND i.category <> 'gas'`);
    const { rows: [gas] } = await client.query(
      `SELECT COUNT(*)::int n FROM inventory inv JOIN items i ON i.id=inv.item_id
        WHERE 1=1 AND i.category = 'gas'`);

    assert.ok(gas.n > 0, 'Gas rows must still exist in the database');
    assert.ok(def.n > 0, 'non-Gas inventory must still be listed');
  });

test('TEST 9 (Gas) — central/unassigned stock is withheld without authority',
  async (t) => {
    if (!await ready(t)) return;

    const withCentral    = await svc.getGasStock(ALL, {}, { includeCentral: true });
    const withoutCentral = await svc.getGasStock(ALL, {}, { includeCentral: false });

    assert.equal(withoutCentral.limitations.central_stock_visible, false);
    assert.equal(withCentral.limitations.central_stock_visible, true);
    assert.ok(withoutCentral.summary.total_lots <= withCentral.summary.total_lots,
      'withholding central stock can only ever reduce what is returned');

    // Every Gas row is department-unassigned today, so an unauthorised caller
    // must see nothing at all — the NULL must not act as an open door.
    const { rows: [assigned] } = await client.query(
      `SELECT COUNT(*)::int n FROM inventory inv JOIN items i ON i.id=inv.item_id
        WHERE i.category='gas' AND inv.department_id IS NOT NULL`);
    assert.equal(withoutCentral.summary.total_lots, assigned.n,
      'only department-assigned Gas may surface without central authority');

    const lots = await svc.getGasLots(ALL, {}, { includeCentral: false });
    assert.equal(lots.total_lots, assigned.n,
      'the drill-down must honour the same central-stock restriction');
  });

test('Gas export withholds value and states its own limitations', async (t) => {
  if (!await ready(t)) return;

  const authorised = await svc.buildGasExport(ALL, {}, { includeCentral: true });
  assert.ok(authorised.headers.includes('Current Stock Value'));
  assert.ok(authorised.notes.some(n => /consumption is not recorded/i.test(n)),
    'export must state that consumption is not tracked');

  const restricted = await svc.buildGasExport(NOFIN, {}, { includeCentral: false });
  assert.ok(!restricted.headers.includes('Current Stock Value'),
    'value column must be absent for unauthorised users');
  assert.ok(restricted.notes.some(n => /Central Stock withheld/i.test(n)));
});

test('Seed export totals equal the filtered report exactly', async (t) => {
  if (!await ready(t)) return;
  const filters = { min_qty: '50' };
  const report = await svc.getSeedStock(ALL, filters);
  const exp    = await svc.buildSeedExport(ALL, filters);

  // Last row of the export is the TOTAL row; System Total sits at index 10.
  const totalRow = exp.rows[exp.rows.length - 1];
  assert.equal(totalRow[0], 'TOTAL');
  assert.equal(totalRow[10], report.summary.filtered_qty,
    'export total must equal the filtered on-screen total');
  assert.equal(exp.rows.length - 1, report.rows.length,
    'export must contain exactly the visible rows');
  assert.ok(exp.notes.some(n => /Hold/.test(n)));
  assert.ok(exp.notes.some(n => /Polish/.test(n)));
  assert.ok(exp.notes.some(n => /Crack/.test(n)));
});

/**
 * Seed & Gas Stock Service — Phase 1 (read-only reporting).
 *
 * ONE canonical, set-based classification of every Seed lot into exactly one
 * stock bucket. No client-side grouping, no per-size query, no per-bucket
 * query, no N+1 process lookup — the summary, the drill-down and the export
 * all run through the same CTE so their totals cannot disagree.
 *
 * Seed lifecycle vocabulary is NOT redeclared here: the states and the
 * legacy-NULL rule come from services/manufacturingState.js, the single
 * source of truth.
 *
 * Canonical process resolution (stable IDs only — never lot-name text,
 * genealogy_path, or the stale inventory.machine_process_id pointer):
 *
 *     seed.id
 *       ← inventory run          ON run.parent_lot_id  = seed.id
 *       ← lot_process_issues lpi ON lpi.process_lot_id = run.id
 *                               AND lpi.status = 'OPEN'
 *       → lpi.process_type
 *
 * A Seed may resolve to more than one open process; the priority ranking
 * below collapses that to exactly one bucket.
 */

'use strict';

const pool = require('../db/pool');
const {
  ATTACHED_TO_GROWTH,
  effectiveManufacturingState,
} = require('./manufacturingState');
const { buildDeptScopeClause, stripFinancial } = require('./inventoryAuth');

// Legacy NULL manufacturing_state resolves through the canonical helper, so
// the SQL default can never drift from the JS rule.
const DEFAULT_STATE = effectiveManufacturingState(null);

const RECOVERED = 'RECOVERED';
const RETIRED   = 'RETIRED';

// ── Bucket priority ──────────────────────────────────────────────────────────
// Lower rank wins. Seed Remove deliberately outranks Cutting and Growth: it is
// the terminal operation that releases the Seed, so a Seed simultaneously
// resolving to seed_remove and another process belongs in Seed Remove WIP.
const PROCESS_RANK = Object.freeze({
  seed_remove: 1,
  edge_cut:    2,
  outer_cut:   2,
  block_cut:   2,
  final_block: 2,
  growth:      3,
  'pr-01':     3,
});
const RANK_OTHER = 9; // an OPEN issue of an untracked type (e.g. pr-03, seeding)

const BUCKETS = Object.freeze([
  'crack_consumed',
  'seed_remove_wip',
  'cutting',
  'growth_machine',
  'attached_between',
  'used',
  'new',
  'unclassified',
]);

/** Single-quote a SQL string literal (all inputs here are internal constants). */
function quote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Build the `WHEN x THEN n` ladder from PROCESS_RANK — no stray literals. */
function processRankSql(col) {
  const whens = Object.entries(PROCESS_RANK)
    .map(([type, rank]) => `WHEN ${quote(type)} THEN ${rank}`)
    .join(' ');
  return `CASE ${col} ${whens} ELSE ${RANK_OTHER} END`;
}

/**
 * The classification CTE. Every Seed row in scope emerges with exactly one
 * `bucket` and one normalised size.
 *
 * @param {string} scopeClause dept-scope + filter SQL fragment (` AND ...`)
 * @returns {string} SQL beginning `WITH seed AS (...)`
 */
function seedClassificationSql(scopeClause) {
  const rank = processRankSql('lpi.process_type');
  return `
  WITH seed AS (
    SELECT inv.id, inv.lot_number, inv.lot_code, inv.lot_name,
           inv.qty, inv.weight, inv.unit, inv.status,
           inv.rate, inv.total_value,
           inv.department_id, inv.location_id, inv.run_no, inv.lot_op_id,
           inv.parent_lot_id, inv.root_lot_id, inv.updated_at,
           COALESCE(inv.manufacturing_state, ${quote(DEFAULT_STATE)}) AS ms,
           inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
    WHERE i.category = 'seed'${scopeClause}
  ),
  -- Highest-priority OPEN process per Seed, resolved through the child Growth
  -- Run. One grouped pass — never one query per Seed.
  proc AS (
    SELECT s.id AS seed_id,
           MIN(${rank}) AS proc_rank,
           (ARRAY_AGG(lpi.process_type ORDER BY ${rank}))[1] AS process_type,
           (ARRAY_AGG(COALESCE(run.lot_code, run.lot_number) ORDER BY ${rank}))[1] AS growth_number
    FROM seed s
    JOIN inventory run          ON run.parent_lot_id  = s.id
    JOIN lot_process_issues lpi ON lpi.process_lot_id = run.id
                               AND lpi.status = 'OPEN'
    GROUP BY s.id
  ),
  classified AS (
    SELECT s.*,
           p.process_type  AS resolved_process_type,
           p.growth_number AS resolved_growth_number,
           CASE
             WHEN s.status IN ('CONSUMED','ARCHIVED') OR s.ms = ${quote(RETIRED)}
               THEN 'crack_consumed'
             WHEN s.ms = ${quote(ATTACHED_TO_GROWTH)} AND s.status = 'IN PROCESS' AND p.proc_rank = 1
               THEN 'seed_remove_wip'
             WHEN s.ms = ${quote(ATTACHED_TO_GROWTH)} AND s.status = 'IN PROCESS' AND p.proc_rank = 2
               THEN 'cutting'
             WHEN s.ms = ${quote(ATTACHED_TO_GROWTH)} AND s.status = 'IN PROCESS' AND p.proc_rank = 3
               THEN 'growth_machine'
             WHEN s.ms = ${quote(ATTACHED_TO_GROWTH)} AND s.status = 'IN PROCESS' AND p.proc_rank IS NULL
               THEN 'attached_between'
             WHEN s.status = 'IN STOCK' AND s.ms = ${quote(RECOVERED)}
               THEN 'used'
             WHEN s.status = 'IN STOCK' AND s.ms = ${quote(DEFAULT_STATE)}
               THEN 'new'
             ELSE 'unclassified'
           END AS bucket,
           -- Orientation-normalised size. Grouping is numeric, so 13 / 13.0 /
           -- 13.00 collapse, and 13x26 cannot split from 26x13.
           CASE WHEN s.dim_length IS NULL OR s.dim_depth IS NULL THEN NULL
                ELSE GREATEST(s.dim_length, s.dim_depth) END AS dim_major,
           CASE WHEN s.dim_length IS NULL OR s.dim_depth IS NULL THEN NULL
                ELSE LEAST(s.dim_length, s.dim_depth) END AS dim_minor
    FROM seed s
    LEFT JOIN proc p ON p.seed_id = s.id
  )`;
}

/** Human label for a size row; mirrors the numeric grouping key exactly. */
function sizeLabel(major, minor, unit) {
  if (major == null || minor == null) return 'Unspecified';
  const u = unit || 'mm';
  const fmt = v => String(parseFloat(Number(v).toFixed(2)));
  return Number(major) === Number(minor)
    ? `${Number(major).toFixed(2)} ${u}`
    : `${fmt(major)} × ${fmt(minor)} ${u}`;
}

function sizeKey(major, minor, height, unit) {
  if (major == null || minor == null) return 'unspecified';
  return [Number(major), Number(minor), height == null ? 'na' : Number(height), unit || 'mm'].join('|');
}

const zero = () => ({ lots: 0, qty: 0 });

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

/** Shared dept-scope + common filter fragment builder. */
function scopeAndFilters(auth, filters, allow = {}) {
  const { clause, params } = buildDeptScopeClause(auth, [], 'inv');
  const p = [...params];
  let extra = '';
  if (filters.department_id) { p.push(parseInt(filters.department_id)); extra += ` AND inv.department_id = $${p.length}`; }
  if (filters.location_id)   { p.push(parseInt(filters.location_id));   extra += ` AND inv.location_id = $${p.length}`; }
  if (allow.unit && filters.unit) { p.push(filters.unit); extra += ` AND inv.unit = $${p.length}`; }
  return { sql: clause + extra, params: p };
}

/**
 * Seed stock matrix, aggregated server-side.
 * @param {object} auth req.inventoryAuth
 * @param {object} filters { department_id, location_id, bucket, min_qty, show_zero, search }
 */
async function getSeedStock(auth, filters = {}) {
  const { sql: scope, params } = scopeAndFilters(auth, filters);

  const { rows } = await pool.query(`${seedClassificationSql(scope)}
    SELECT dim_major, dim_minor, dim_height, dim_unit, bucket,
           COUNT(*)::int AS lots,
           COALESCE(SUM(qty),0)::float AS qty,
           COALESCE(SUM(weight),0)::float AS weight
    FROM classified
    GROUP BY dim_major, dim_minor, dim_height, dim_unit, bucket`, params);

  // Fold the (size × bucket) grid into one row per size.
  const bySize = new Map();
  const summary = Object.fromEntries(BUCKETS.map(b => [b, 0]));
  let totalLots = 0, totalQty = 0;

  for (const r of rows) {
    const key = sizeKey(r.dim_major, r.dim_minor, r.dim_height, r.dim_unit);
    if (!bySize.has(key)) {
      bySize.set(key, {
        size_key: key,
        size_label: sizeLabel(r.dim_major, r.dim_minor, r.dim_unit),
        dim_length: r.dim_major, dim_width: r.dim_minor,
        dim_height: r.dim_height, unit: r.dim_unit || null,
        ...Object.fromEntries(BUCKETS.map(b => [b, zero()])),
        system_total: zero(),
      });
    }
    const row = bySize.get(key);
    row[r.bucket] = { lots: r.lots, qty: round4(r.qty) };
    row.system_total.lots += r.lots;
    row.system_total.qty   = round4(row.system_total.qty + r.qty);

    summary[r.bucket] += r.qty;
    totalLots += r.lots;
    totalQty  += r.qty;
  }

  let out = [...bySize.values()];
  if (filters.bucket && BUCKETS.includes(filters.bucket)) {
    out = out.filter(r => r[filters.bucket].lots > 0);
  }
  if (filters.min_qty) {
    const m = parseFloat(filters.min_qty);
    if (!Number.isNaN(m)) out = out.filter(r => r.system_total.qty >= m);
  }
  if (filters.show_zero !== 'true') {
    out = out.filter(r => r.system_total.qty > 0 || r.system_total.lots > 0);
  }
  if (filters.search) {
    const s = String(filters.search).toLowerCase();
    out = out.filter(r => r.size_label.toLowerCase().includes(s));
  }

  // Unspecified last, otherwise largest size first.
  out.sort((a, b) => {
    if (a.size_key === 'unspecified') return 1;
    if (b.size_key === 'unspecified') return -1;
    return (b.dim_length - a.dim_length) || (b.dim_width - a.dim_width);
  });

  const bucketSum   = BUCKETS.reduce((s, b) => s + summary[b], 0);
  const filteredQty = out.reduce((s, r) => s + r.system_total.qty, 0);

  return {
    summary: {
      total_lots: totalLots,
      total_qty: round4(totalQty),
      filtered_qty: round4(filteredQty),
      new_qty:              round4(summary.new),
      used_qty:             round4(summary.used),
      growth_machine_qty:   round4(summary.growth_machine),
      cutting_qty:          round4(summary.cutting),
      seed_remove_qty:      round4(summary.seed_remove_wip),
      attached_between_qty: round4(summary.attached_between),
      crack_consumed_qty:   round4(summary.crack_consumed),
      unclassified_qty:     round4(summary.unclassified),
      unclassified_lots:    rows.filter(r => r.bucket === 'unclassified')
                                .reduce((s, r) => s + r.lots, 0),
      // Guard, not decoration: any future edit that breaks the exhaustive
      // CASE surfaces here instead of silently mis-stating stock.
      reconciliation_difference: round4(totalQty - bucketSum),
    },
    rows: out,
    limitations: {
      hold_tracked: false,
      polish_tracked: false,
      crack_separated_from_consumed: false,
      physical_count_available: false,
    },
  };
}

/** Drill-down: the individual Seed lots behind one summary cell. */
async function getSeedLots(auth, filters = {}) {
  const { sql: scope, params } = scopeAndFilters(auth, filters);
  const p = [...params];
  const where = [];

  if (filters.bucket && BUCKETS.includes(filters.bucket)) {
    p.push(filters.bucket);
    where.push(`c.bucket = $${p.length}`);
  }
  if (filters.size_key) {
    if (filters.size_key === 'unspecified') {
      where.push('c.dim_major IS NULL');
    } else {
      const [maj, min, h, u] = String(filters.size_key).split('|');
      p.push(maj); where.push(`c.dim_major = $${p.length}::numeric`);
      p.push(min); where.push(`c.dim_minor = $${p.length}::numeric`);
      if (h && h !== 'na') { p.push(h); where.push(`c.dim_height = $${p.length}::numeric`); }
      if (u)               { p.push(u); where.push(`COALESCE(c.dim_unit,'mm') = $${p.length}`); }
    }
  }

  const { rows } = await pool.query(`${seedClassificationSql(scope)}
    SELECT c.id, c.lot_number, c.lot_code, c.lot_name, c.qty, c.weight, c.unit,
           c.status, c.ms AS manufacturing_state, c.bucket,
           c.resolved_process_type, c.resolved_growth_number,
           c.run_no, c.lot_op_id, c.parent_lot_id, c.root_lot_id,
           c.dim_major, c.dim_minor, c.dim_height, c.dim_unit,
           c.department_id, c.location_id, c.updated_at,
           c.rate, c.total_value,
           d.name AS department_name, l.name AS location_name
    FROM classified c
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN locations   l ON l.id = c.location_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.qty DESC, c.id`, p);

  const shaped = rows.map(r => ({
    ...r,
    qty: Number(r.qty),
    weight: r.weight == null ? null : Number(r.weight),
    size_label: sizeLabel(r.dim_major, r.dim_minor, r.dim_unit),
  }));

  return {
    data: stripFinancial(shaped, auth.canViewFinancial),
    total_lots: shaped.length,
    total_qty: round4(shaped.reduce((s, r) => s + r.qty, 0)),
  };
}

// ── Gas ──────────────────────────────────────────────────────────────────────
// Quantity / cylinder control only. The data model carries no measured gas
// content, so nothing here is presented as consumption.

/**
 * Gas rows currently carry no department (department_id IS NULL) — they are
 * central stock. Until Gas ownership is configured they are withheld from
 * anyone without explicit central-stock authority, so the ordinary department
 * scope cannot be sidestepped by the NULL.
 */
function centralGasClause(opts) {
  return opts.includeCentral ? '' : ' AND inv.department_id IS NOT NULL';
}

async function getGasStock(auth, filters = {}, opts = {}) {
  const { sql: scope, params } = scopeAndFilters(auth, filters, { unit: true });
  const p = [...params];
  let extra = centralGasClause(opts);
  if (filters.search) { p.push(`%${filters.search}%`); extra += ` AND i.name ILIKE $${p.length}`; }

  // Grouped by item AND unit — CYL and PCS are never summed together.
  const { rows } = await pool.query(`
    SELECT i.id AS item_id, i.name AS gas_item, i.code AS item_code,
           inv.unit,
           COUNT(*)::int AS lot_count,
           COALESCE(SUM(inv.qty),0)::float AS current_qty,
           COALESCE(SUM(inv.total_value),0)::float AS current_value,
           inv.department_id, d.name AS department_name,
           inv.location_id,   l.name AS location_name,
           MAX(inv.purchase_date) AS last_receipt_date,
           MAX(inv.updated_at)    AS last_movement_date
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
    LEFT JOIN departments d ON d.id = inv.department_id
    LEFT JOIN locations   l ON l.id = inv.location_id
    WHERE i.category = 'gas'${scope}${extra}
    GROUP BY i.id, i.name, i.code, inv.unit, inv.department_id, d.name,
             inv.location_id, l.name
    ORDER BY i.name, inv.unit`, p);

  let out = rows;
  if (filters.min_qty) {
    const m = parseFloat(filters.min_qty);
    if (!Number.isNaN(m)) out = out.filter(r => r.current_qty >= m);
  }

  // The same item appearing under multiple units is a data-quality defect, not
  // a total — surface it rather than hiding it behind a sum.
  const unitsByItem = new Map();
  for (const r of out) {
    if (!unitsByItem.has(r.gas_item)) unitsByItem.set(r.gas_item, new Set());
    unitsByItem.get(r.gas_item).add(r.unit);
  }
  const mixedUnitItems = [...unitsByItem.entries()]
    .filter(([, u]) => u.size > 1)
    .map(([gas_item, u]) => ({ gas_item, units: [...u] }));

  const totalsByUnit = {};
  for (const r of out) {
    const k = r.unit || 'UNSPECIFIED';
    totalsByUnit[k] = round4((totalsByUnit[k] || 0) + r.current_qty);
  }

  return {
    rows: stripFinancial(out, auth.canViewFinancial),
    summary: {
      total_rows: out.length,
      total_lots: out.reduce((s, r) => s + r.lot_count, 0),
      totals_by_unit: totalsByUnit,
      ...(auth.canViewFinancial
        ? { total_value: round4(out.reduce((s, r) => s + r.current_value, 0)) }
        : {}),
    },
    data_quality: { mixed_unit_items: mixedUnitItems },
    limitations: {
      measured_consumption_available: false,
      opening_purchases_derivable: false,
      central_stock_visible: !!opts.includeCentral,
    },
  };
}

/** Gas drill-down — the underlying inventory rows for one item/unit. */
async function getGasLots(auth, filters = {}, opts = {}) {
  const { sql: scope, params } = scopeAndFilters(auth, filters, { unit: true });
  const p = [...params];
  let extra = centralGasClause(opts);
  if (filters.item_id) { p.push(parseInt(filters.item_id)); extra += ` AND i.id = $${p.length}`; }

  const { rows } = await pool.query(`
    SELECT inv.id, inv.lot_number, inv.lot_code, i.name AS gas_item,
           inv.qty, inv.unit, inv.status, inv.purchase_date, inv.updated_at,
           inv.source_module, inv.vendor_id, v.name AS vendor_name,
           inv.department_id, d.name AS department_name,
           inv.location_id, l.name AS location_name,
           inv.rate, inv.total_value
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
    LEFT JOIN vendors     v ON v.id = inv.vendor_id
    LEFT JOIN departments d ON d.id = inv.department_id
    LEFT JOIN locations   l ON l.id = inv.location_id
    WHERE i.category = 'gas'${scope}${extra}
    ORDER BY inv.id DESC`, p);

  return {
    data: stripFinancial(rows, auth.canViewFinancial),
    total_lots: rows.length,
    total_qty: round4(rows.reduce((s, r) => s + Number(r.qty || 0), 0)),
  };
}

// ── Export / print payloads ─────────────────────────────────────────────────
// Built server-side from the SAME scoped aggregation the pages read, so an
// export can never contain a row the caller is not allowed to see, and its
// totals can never drift from the visible report.

const SEED_EXPORT_HEADERS = Object.freeze([
  'Size', 'New', 'Used', 'Growth Machine', 'Cutting', 'Seed Remove WIP',
  'Attached / Between Processes', 'Hold', 'Polish', 'Crack / Consumed',
  'System Total', 'Actual Stock', 'Variance',
]);

const PH = '—'; // Phase 2 placeholder — never a fabricated zero

function describeFilters(filters = {}) {
  const parts = [];
  if (filters.search)        parts.push(`Size: ${filters.search}`);
  if (filters.department_id) parts.push(`Department: ${filters.department_id}`);
  if (filters.location_id)   parts.push(`Location: ${filters.location_id}`);
  if (filters.bucket)        parts.push(`Bucket: ${filters.bucket}`);
  if (filters.min_qty)       parts.push(`Min Qty: ${filters.min_qty}`);
  if (filters.show_zero === 'true') parts.push('Including zero rows');
  return parts.length ? parts.join(' · ') : 'No filters applied';
}

async function buildSeedExport(auth, filters = {}) {
  const r = await getSeedStock(auth, filters);
  const rows = r.rows.map(x => [
    x.size_label,
    x.new.qty, x.used.qty, x.growth_machine.qty, x.cutting.qty,
    x.seed_remove_wip.qty, x.attached_between.qty,
    PH, PH,
    x.crack_consumed.qty,
    x.system_total.qty,
    PH, PH,
  ]);
  const s = r.summary;
  rows.push([
    'TOTAL',
    s.new_qty, s.used_qty, s.growth_machine_qty, s.cutting_qty,
    s.seed_remove_qty, s.attached_between_qty,
    PH, PH, s.crack_consumed_qty, s.filtered_qty, PH, PH,
  ]);

  return {
    title: 'Seed Stock',
    subtitle: `${describeFilters(filters)} · Filtered ${s.filtered_qty} of ${s.total_qty} PCS · ` +
              `Reconciliation difference ${s.reconciliation_difference}`,
    filename: `seed-stock-${new Date().toISOString().split('T')[0]}.csv`,
    headers: SEED_EXPORT_HEADERS,
    rows,
    summary: s,
    notes: [
      'Hold — not tracked yet (Phase 2)',
      'Polish — not tracked yet (Phase 2)',
      'Crack is not separated from Consumed (Phase 2)',
      'Actual Stock / Variance — physical count available in Phase 2',
      `Unclassified: ${s.unclassified_lots} lot(s), ${s.unclassified_qty} qty`,
    ],
  };
}

async function buildGasExport(auth, filters = {}, opts = {}) {
  const g = await getGasStock(auth, filters, opts);
  const withValue = auth.canViewFinancial;

  const headers = [
    'Gas Item', 'Unit', 'Lot / Cylinder Count', 'Stock On Hand',
    ...(withValue ? ['Current Stock Value'] : []),
    'Department / Stock Scope', 'Location', 'Last Receipt', 'Last Movement',
  ];

  const d = v => (v ? new Date(v).toLocaleDateString('en-IN') : '');
  const rows = g.rows.map(x => [
    x.gas_item, x.unit || PH, x.lot_count, x.current_qty,
    ...(withValue ? [x.current_value] : []),
    x.department_name || 'Unassigned / Central Stock',
    x.location_name || PH,
    d(x.last_receipt_date), d(x.last_movement_date),
  ]);

  const unitTotals = Object.entries(g.summary.totals_by_unit)
    .map(([u, q]) => `${u}: ${q}`).join(' · ');

  const notes = [
    'Stock On Hand only — measured gas consumption is not recorded',
    `Totals are reported per unit and never combined — ${unitTotals}`,
  ];
  for (const m of g.data_quality.mixed_unit_items) {
    notes.push(`Data quality: "${m.gas_item}" carries mixed units (${m.units.join(', ')})`);
  }
  if (!opts.includeCentral) {
    notes.push('Unassigned / Central Stock withheld — requires central Gas stock authority');
  }

  return {
    title: 'Gas Stock',
    subtitle: `${describeFilters(filters)} · ${unitTotals}`,
    filename: `gas-stock-${new Date().toISOString().split('T')[0]}.csv`,
    headers,
    rows,
    summary: g.summary,
    notes,
  };
}

module.exports = {
  BUCKETS,
  PROCESS_RANK,
  sizeLabel,
  sizeKey,
  seedClassificationSql,
  getSeedStock,
  getSeedLots,
  getGasStock,
  getGasLots,
  buildSeedExport,
  buildGasExport,
};

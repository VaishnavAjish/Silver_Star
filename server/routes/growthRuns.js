// ============================================================
// Growth Runs (Biscuits) — Phase 32
// ------------------------------------------------------------
// Thin read/measure API over inventory(category='growth_run').
// CRUD, transfers, lineage and history are served by the existing
// inventory routes — this router only adds the growth-run specific
// surface: list with metrics, get with context, measurement entry.
// ============================================================

const express = require('express');
const pool    = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { applyMeasurements } = require('../services/growthRunService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// Shared select clause — pulls biscuit row + linked process + seed parent.
const GROWTH_RUN_SELECT = `
  SELECT
    inv.id, inv.lot_op_id, inv.lot_number, inv.lot_code, inv.lot_name,
    inv.status, inv.qty, inv.unit, inv.weight,
    inv.location_id, l.name AS location_name,
    inv.department_id, d.name AS department_name,
    inv.purchase_date,
    inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit,
    inv.seed_height_at_in, inv.weight_at_in,
    inv.actual_growth_mm, inv.weight_gain, inv.growth_pct,
    inv.parent_lot_id, inv.root_lot_id, inv.genealogy_path, inv.split_level,
    inv.source_type, inv.operation_type, inv.source_module,
    inv.remarks, inv.created_at, inv.updated_at,
    inv.machine_process_id,
    mp.process_number, mp.process_type, mp.status AS process_status,
    mp.started_at, mp.completed_at, mp.expected_height, mp.expected_rough_qty,
    mp.target_runtime_hours, mp.actual_yield_pct,
    m.id   AS machine_id,
    m.code AS machine_code,
    m.name AS machine_name,
    parent.lot_number AS parent_lot_number,
    parent.lot_code   AS parent_lot_code,
    op.full_name      AS operator_name
  FROM inventory inv
  JOIN items i        ON i.id = inv.item_id AND i.category = 'growth_run'
  LEFT JOIN machine_processes mp ON mp.id = inv.machine_process_id
  LEFT JOIN machines m           ON m.id = mp.machine_id
  LEFT JOIN users    op          ON op.id = mp.operator_id
  LEFT JOIN inventory parent     ON parent.id = inv.parent_lot_id
  LEFT JOIN locations   l        ON l.id = inv.location_id
  LEFT JOIN departments d        ON d.id = inv.department_id
`;

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/growth-runs
// List Growth Runs with growth metrics + linked process snapshot.
// Filters: status, machine_id, department_id, q (lot_number / GR-number search)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, machine_id, department_id, q, measured, limit = 200, offset = 0 } = req.query;

    const where  = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`inv.status = $${params.length}`);
    }
    if (machine_id) {
      params.push(parseInt(machine_id));
      where.push(`m.id = $${params.length}`);
    }
    if (department_id) {
      params.push(parseInt(department_id));
      where.push(`inv.department_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(inv.lot_number ILIKE $${params.length} OR inv.lot_code ILIKE $${params.length} OR m.code ILIKE $${params.length})`);
    }
    if (measured === 'true') {
      where.push(`inv.dim_height IS NOT NULL AND inv.weight IS NOT NULL`);
    } else if (measured === 'false') {
      where.push(`(inv.dim_height IS NULL OR inv.weight IS NULL)`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const dataSql = `${GROWTH_RUN_SELECT} ${whereSql} ORDER BY inv.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const countSql = `SELECT COUNT(*) AS cnt FROM inventory inv
                      JOIN items i ON i.id = inv.item_id AND i.category = 'growth_run'
                      LEFT JOIN machine_processes mp ON mp.id = inv.machine_process_id
                      LEFT JOIN machines m ON m.id = mp.machine_id
                      ${whereSql}`;

    const [data, count] = await Promise.all([
      pool.query(dataSql, params),
      pool.query(countSql, params.slice(0, params.length - 2)),
    ]);

    res.json({ data: data.rows, total: parseInt(count.rows[0].cnt) });
  } catch (err) {
    logger.error('[growth-runs] list error:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/growth-runs/:id
// Single Growth Run with children (rough lots), mix components, and op history.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const main = await pool.query(`${GROWTH_RUN_SELECT} WHERE inv.id = $1`, [id]);
    if (!main.rows.length) return res.status(404).json({ error: 'Growth Run not found' });

    const [children, mixComponents, ops] = await Promise.all([
      pool.query(
        `SELECT inv.id, inv.lot_number, inv.lot_code, inv.weight, inv.qty, inv.unit,
                inv.status, inv.created_at, i.category
           FROM inventory inv
           JOIN items i ON i.id = inv.item_id
          WHERE inv.parent_lot_id = $1
          ORDER BY inv.id`,
        [id]
      ),
      pool.query(
        `SELECT lmc.id, lmc.source_lot_id, lmc.qty,
                src.lot_number AS source_lot_number, src.lot_code AS source_lot_code
           FROM lot_mix_components lmc
           JOIN inventory src ON src.id = lmc.source_lot_id
          WHERE lmc.mixed_lot_id = $1`,
        [id]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT id, operation, reference_type, reference_id, qty_delta, new_status,
                notes, performed_by, created_at
           FROM lot_op_log
          WHERE lot_id = $1
          ORDER BY created_at ASC, id ASC`,
        [id]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      ...main.rows[0],
      children:       children.rows,
      mix_components: mixComponents.rows,
      history:        ops.rows,
    });
  } catch (err) {
    logger.error('[growth-runs] get error:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/growth-runs/:id/measurements
// Operator records final biscuit dimensions and weight.
// Generated columns (actual_growth_mm, weight_gain, growth_pct) recompute.
// Body: { weight, dim_height, dim_length, dim_depth, dim_unit?, remarks? }
// ──────────────────────────────────────────────────────────────────────────────
router.patch('/:id/measurements', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const id = parseInt(req.params.id);
    const { weight, dim_height, dim_length, dim_depth, dim_unit, remarks } = req.body;

    // Validate non-negative
    for (const [k, v] of Object.entries({ weight, dim_height, dim_length, dim_depth })) {
      if (v !== undefined && v !== null && parseFloat(v) < 0) {
        throw new Error(`${k} must be non-negative`);
      }
    }

    const updated = await applyMeasurements(client, id, {
      weight, dim_height, dim_length, dim_depth, dim_unit, remarks,
    });

    // Log the measurement op for history
    await client.query(
      `INSERT INTO lot_op_log (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
       VALUES ($1, 'growth_run_measured', 'inventory', $1, NULL, $2,
               $3, $4)`,
      [
        id,
        updated.status,
        `Measurements: weight=${updated.weight ?? '—'}, height=${updated.dim_height ?? '—'}${updated.dim_unit || 'mm'}, ` +
          `growth=${updated.actual_growth_mm ?? '—'}, growth_pct=${updated.growth_pct ?? '—'}%`,
        req.user.id,
      ]
    );

    await client.query('COMMIT');
    res.json(updated);
    dispatchEvent('batch.updated', { id, ...updated }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/growth-runs/by-process/:machineProcessId
// Convenience for the Rough Entry / Control Tower screens.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/by-process/:machineProcessId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${GROWTH_RUN_SELECT} WHERE inv.machine_process_id = $1 ORDER BY inv.id DESC LIMIT 1`,
      [parseInt(req.params.machineProcessId)]
    );
    if (!rows.length) return res.status(404).json({ error: 'No Growth Run for this process' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

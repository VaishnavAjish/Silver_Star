const express = require('express');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { nextMfgProcessNumber } = require('../services/seedLotCodeService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');
const {
  findActiveBiscuitByProcess,
  applyMeasurements,
  advanceGrowthRunToStock,
  recordGrowthCycle,
} = require('../services/growthRunService');

const router = express.Router();

// ── Controlled status vocabulary (lowercase — matches machine_status ENUM) ───
const MACHINE_STATUSES = ['idle','running','hold','maintenance','breakdown','completed','cleaning','awaiting_output'];

// ── Runtime computation SQL fragment ─────────────────────────────────────────
// Returns elapsed active hours (excludes paused time).
const RUNTIME_SQL = `
  CASE
    WHEN mp.status = 'running' THEN
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (NOW() - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
    WHEN mp.status = 'hold' THEN
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (COALESCE(mp.paused_at, NOW()) - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
    ELSE
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (COALESCE(mp.completed_at, NOW()) - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
  END
`;

// ── Helper: log machine status change ────────────────────────────────────────
async function logMachineStatus(client, machineId, oldStatus, newStatus, userId, remarks) {
  await client.query(
    `INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
     VALUES ($1, $2, $3, $4, $5)`,
    [machineId, oldStatus, newStatus, userId, remarks || null]
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/kpi
// ══════════════════════════════════════════════════════════════════════════════
router.get('/kpi', authenticate, async (req, res) => {
  try {
    const { rows: machineCounts } = await pool.query(`
      SELECT status::text, COUNT(*) AS cnt FROM machines GROUP BY status
    `);

    const { rows: completedToday } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM machine_processes
      WHERE status = 'completed' AND DATE(completed_at) = CURRENT_DATE
    `);

    const { rows: expectedYield } = await pool.query(`
      SELECT COALESCE(SUM(expected_rough_qty), 0) AS total
      FROM machine_processes WHERE status IN ('running','hold')
    `);

    const counts = {};
    MACHINE_STATUSES.forEach(s => { counts[s] = 0; });
    machineCounts.forEach(r => { counts[r.status] = parseInt(r.cnt); });

    res.json({
      total:            Object.values(counts).reduce((a, b) => a + b, 0),
      running:          counts.running          || 0,
      idle:             counts.idle             || 0,
      hold:             counts.hold             || 0,
      maintenance:      counts.maintenance      || 0,
      breakdown:        counts.breakdown        || 0,
      cleaning:         counts.cleaning         || 0,
      awaiting_output:  counts.awaiting_output  || 0,
      completed_today:  parseInt(completedToday[0].cnt),
      expected_yield:   parseFloat(expectedYield[0].total) || 0,
    });
  } catch (err) {
    logger.error('kpi error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/machines
// Machine grid — each row includes its active process data (if any)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/machines', authenticate, async (req, res) => {
  try {
    const { dept, status, operator, process_type, overdue, search, length_min, length_max, height_min, height_max, limit = 200, offset = 0 } = req.query;

    const params = [];
    const where  = ['1=1'];

    if (dept) {
      params.push(parseInt(dept));
      where.push(`m.department_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`m.status::text = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(m.code ILIKE $${params.length} OR m.name ILIKE $${params.length})`);
    }
    if (operator) {
      params.push(parseInt(operator));
      where.push(`mp.operator_id = $${params.length}`);
    }
    if (process_type) {
      params.push(process_type);
      where.push(`mp.process_type = $${params.length}`);
    }
    if (overdue === 'true') {
      where.push(`mp.expected_completion_at IS NOT NULL AND mp.expected_completion_at < NOW() AND mp.status = 'running'`);
    }

    const subWhere = [];
    if (length_min) subWhere.push(`dim_length >= ${parseFloat(length_min)}`);
    if (length_max) subWhere.push(`dim_length <= ${parseFloat(length_max)}`);
    if (height_min) subWhere.push(`dim_height >= ${parseFloat(height_min)}`);
    if (height_max) subWhere.push(`dim_height <= ${parseFloat(height_max)}`);
    const subWhereClause = subWhere.length > 0 ? `WHERE ${subWhere.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (m.id)
          m.id,
          m.code,
          m.name,
          m.type          AS machine_type,
          m.status::text  AS machine_status,
          m.department_id,
          d.name          AS department_name,
          l.name          AS location_name,
          m.capacity,
          m.next_service,
          mp.id                     AS process_id,
          mp.process_number,
          mp.process_type,
          mp.status                 AS process_status,
          mp.started_at,
          mp.paused_at,
          mp.expected_completion_at,
          mp.target_runtime_hours,
          mp.expected_rough_qty,
          mp.expected_height,
          mp.total_paused_minutes,
          mp.remarks                AS process_remarks,
          u.full_name               AS operator_name,
          mp.operator_id,
          ${RUNTIME_SQL} AS runtime_hours,
          (SELECT COALESCE(SUM(mpl.issued_qty), 0)
           FROM   machine_process_lots mpl
           WHERE  mpl.process_id = mp.id) AS seeds_issued,
          (SELECT COALESCE(SUM(mpm.qty), 0)
           FROM   machine_process_materials mpm
           WHERE  mpm.process_id = mp.id) AS materials_issued,
          -- Phase 32: Growth Run (Biscuit) for Control Tower display
          gr.lot_number          AS growth_run_number,
          COALESCE(gr.run_no, (SELECT i.run_no FROM inventory i JOIN machine_process_lots mpl ON mpl.inventory_lot_id = i.id WHERE mpl.process_id = mp.id ORDER BY mpl.id ASC LIMIT 1)) AS run_no,
          gr.id                  AS growth_run_id,
          gr.seed_height_at_in   AS seed_height,
          gr.dim_height          AS final_height,
          gr.actual_growth_mm    AS growth_mm,
          gr.weight_gain         AS weight_gain,
          gr.growth_pct          AS growth_pct,
          gr.weight              AS biscuit_weight,
          gr.status              AS biscuit_status,
          (SELECT i.dim_length FROM inventory i JOIN machine_process_lots mpl ON mpl.inventory_lot_id = i.id WHERE mpl.process_id = mp.id ORDER BY mpl.id ASC LIMIT 1) AS dim_length,
          (SELECT i.dim_depth FROM inventory i JOIN machine_process_lots mpl ON mpl.inventory_lot_id = i.id WHERE mpl.process_id = mp.id ORDER BY mpl.id ASC LIMIT 1) AS dim_width,
          (SELECT i.dim_height FROM inventory i JOIN machine_process_lots mpl ON mpl.inventory_lot_id = i.id WHERE mpl.process_id = mp.id ORDER BY mpl.id ASC LIMIT 1) AS dim_height,
          (
            SELECT json_build_object(
              'machine_process_id', cmp.id,
              'process_type', cmp.process_type,
              'growth_number', cgr.lot_number,
              'run_number', COALESCE(cgr.run_no, (SELECT i.run_no FROM inventory i JOIN machine_process_lots mpl ON mpl.inventory_lot_id = i.id WHERE mpl.process_id = cmp.id ORDER BY mpl.id ASC LIMIT 1)),
              'completed_at', cmp.completed_at
            )
            FROM machine_processes cmp
            LEFT JOIN inventory cgr
                   ON cgr.machine_process_id = cmp.id
                  AND cgr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
            WHERE cmp.machine_id = m.id
              AND cmp.status = 'completed'
              AND cmp.process_type ILIKE 'growth'
            ORDER BY cmp.completed_at DESC NULLS LAST, cmp.id DESC
            LIMIT 1
          ) AS last_completed_run
        FROM machines m
        LEFT JOIN departments d ON d.id = m.department_id
        LEFT JOIN locations   l ON l.id = m.location_id
        LEFT JOIN machine_processes mp
               ON mp.machine_id = m.id
              AND mp.status IN ('running','hold')
        LEFT JOIN users u ON u.id = mp.operator_id
        LEFT JOIN inventory gr
               ON gr.machine_process_id = mp.id
              AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
        WHERE ${where.join(' AND ')}
        ORDER BY m.id, CASE mp.status WHEN 'running' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END
      ) sub
      ${subWhereClause}
      ORDER BY
        CASE sub.machine_status
          WHEN 'running'          THEN 1
          WHEN 'awaiting_output'  THEN 2
          WHEN 'hold'             THEN 3
          WHEN 'breakdown'        THEN 4
          WHEN 'maintenance'      THEN 5
          WHEN 'cleaning'         THEN 6
          WHEN 'idle'             THEN 7
          ELSE 8
        END,
        LENGTH(sub.name) ASC, sub.name ASC
      LIMIT  $${params.length + 1}
      OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT m.id) AS cnt
       FROM machines m
       LEFT JOIN machine_processes mp ON mp.machine_id = m.id AND mp.status IN ('running','hold')
       WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ data: rows, total: parseInt(countRows[0].cnt) });
  } catch (err) {
    logger.error('machines error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/alerts
// ══════════════════════════════════════════════════════════════════════════════
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const [maintenance, overdue, hold, breakdown, yieldRisk, awaitingOutput] = await Promise.all([

      pool.query(`
        SELECT m.id, m.code, m.name, m.next_service
        FROM   machines m
        WHERE  m.status = 'maintenance'
           OR  (m.next_service IS NOT NULL AND m.next_service <= CURRENT_DATE + INTERVAL '7 days')
        ORDER  BY m.next_service NULLS LAST LIMIT 20
      `),

      pool.query(`
        SELECT m.id, m.code, m.name, mp.id AS process_id, mp.process_number,
               ${RUNTIME_SQL} AS runtime_hours,
               mp.target_runtime_hours
        FROM   machine_processes mp
        JOIN   machines m ON m.id = mp.machine_id
        WHERE  mp.status = 'running'
          AND  mp.expected_completion_at IS NOT NULL
          AND  mp.expected_completion_at < NOW()
        ORDER  BY mp.expected_completion_at LIMIT 20
      `),

      pool.query(`
        SELECT m.id, m.code, m.name, mp.id AS process_id, mp.process_number, mp.paused_at
        FROM   machines m
        JOIN   machine_processes mp ON mp.machine_id = m.id
        WHERE  mp.status = 'hold'
        ORDER  BY mp.paused_at LIMIT 20
      `),

      pool.query(`
        SELECT id, code, name FROM machines WHERE status = 'breakdown'
        ORDER BY code LIMIT 20
      `),

      pool.query(`
        SELECT m.id, m.code, m.name, mp.id AS process_id, mp.process_number,
               mp.expected_rough_qty,
               ${RUNTIME_SQL} AS runtime_hours,
               mp.target_runtime_hours
        FROM   machine_processes mp
        JOIN   machines m ON m.id = mp.machine_id
        WHERE  mp.status = 'running'
          AND  mp.target_runtime_hours IS NOT NULL
          AND  mp.expected_rough_qty IS NOT NULL
          AND  ${RUNTIME_SQL} > mp.target_runtime_hours * 1.1
        ORDER  BY m.code LIMIT 20
      `),

      pool.query(`
        SELECT m.id, m.code, m.name, mp.id AS process_id, mp.process_number,
               mp.process_type, mp.started_at,
               mp.expected_rough_qty, ${RUNTIME_SQL} AS runtime_hours
        FROM   machines m
        JOIN   machine_processes mp ON mp.machine_id = m.id AND mp.status = 'running'
        WHERE  m.status::text = 'awaiting_output'
        ORDER  BY mp.started_at LIMIT 20
      `),
    ]);

    res.json({
      maintenance_due:  maintenance.rows,
      overdue:          overdue.rows,
      hold:             hold.rows,
      breakdown:        breakdown.rows,
      yield_risk:       yieldRisk.rows,
      awaiting_output:  awaitingOutput.rows,
    });
  } catch (err) {
    logger.error('alerts error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/processes
// ══════════════════════════════════════════════════════════════════════════════
router.get('/processes', authenticate, async (req, res) => {
  try {
    const { status, machine_id, operator_id, process_type, date_from, date_to, limit = 50, offset = 0 } = req.query;

    const params = [];
    const where  = ['1=1'];

    if (status)      { params.push(status);               where.push(`mp.status = $${params.length}`); }
    if (machine_id)  { params.push(parseInt(machine_id)); where.push(`mp.machine_id = $${params.length}`); }
    if (operator_id) { params.push(parseInt(operator_id));where.push(`mp.operator_id = $${params.length}`); }
    if (process_type){ params.push(process_type);         where.push(`mp.process_type = $${params.length}`); }
    if (date_from)   { params.push(date_from);            where.push(`DATE(mp.started_at) >= $${params.length}`); }
    if (date_to)     { params.push(date_to);              where.push(`DATE(mp.started_at) <= $${params.length}`); }

    const { rows } = await pool.query(`
      SELECT mp.*, ${RUNTIME_SQL} AS runtime_hours,
             m.code AS machine_code, m.name AS machine_name,
             u.full_name AS operator_name
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      LEFT JOIN users u ON u.id = mp.operator_id
      WHERE ${where.join(' AND ')}
      ORDER BY mp.created_at DESC
      LIMIT  $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const { rows: cr } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM machine_processes mp WHERE ${where.join(' AND ')}`, params
    );

    res.json({ data: rows, total: parseInt(cr[0].cnt) });
  } catch (err) {
    logger.error('processes error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/processes/:id
// ══════════════════════════════════════════════════════════════════════════════
router.get('/processes/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mp.*, ${RUNTIME_SQL} AS runtime_hours,
             m.code AS machine_code, m.name AS machine_name,
             u.full_name AS operator_name
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      LEFT JOIN users u ON u.id = mp.operator_id
      WHERE mp.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Process not found' });

    const [lots, materials, logs] = await Promise.all([
      pool.query(`
        SELECT mpl.*, inv.lot_number, inv.lot_name, inv.qty AS lot_qty, inv.weight AS lot_weight
        FROM   machine_process_lots mpl
        JOIN   inventory inv ON inv.id = mpl.inventory_lot_id
        WHERE  mpl.process_id = $1
      `, [req.params.id]),
      pool.query(`SELECT * FROM machine_process_materials WHERE process_id = $1`, [req.params.id]),
      pool.query(`
        SELECT msl.*, u.full_name AS changed_by_name
        FROM   machine_status_logs msl
        LEFT JOIN users u ON u.id = msl.changed_by
        WHERE  msl.machine_id = (SELECT machine_id FROM machine_processes WHERE id = $1)
        ORDER  BY msl.changed_at DESC LIMIT 20
      `, [req.params.id]),
    ]);

    res.json({ process: rows[0], lots: lots.rows, materials: materials.rows, logs: logs.rows });
  } catch (err) {
    logger.error('process detail error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/processes/:id/output-context
// Full context for the Growth Output Form — loads everything the form needs
// to pre-populate: machine, operator, issued seeds, returns, runtime.
// ══════════════════════════════════════════════════════════════════════════════
router.get('/processes/:id/output-context', authenticate, async (req, res) => {
  try {
    const { rows: mpRows } = await pool.query(`
      SELECT mp.*, ${RUNTIME_SQL} AS runtime_hours,
             m.code AS machine_code, m.name AS machine_name, m.status::text AS machine_status,
             d.name AS department_name,
             u.full_name AS operator_name,
             pm.process_name, pm.completion_mode, pm.output_type
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users u ON u.id = mp.operator_id
      LEFT JOIN process_master pm ON pm.process_code = mp.process_type
      WHERE mp.id = $1
    `, [req.params.id]);

    if (!mpRows.length) return res.status(404).json({ error: 'Process not found' });
    const mp = mpRows[0];

    // All process issues (seeds) for this machine process
    const { rows: issues } = await pool.query(`
      SELECT pi.*,
             sl.lot_number AS source_lot_number, sl.lot_code AS source_lot_code,
             pl.lot_number AS process_lot_number, pl.lot_code AS process_lot_code,
             pl.qty AS process_lot_qty, pl.status AS process_lot_status,
             i.name AS item_name, i.category,
             COALESCE(pi.remaining_in_process, pi.issued_qty) AS remaining_qty,
             ROUND(pi.issued_qty - COALESCE(pi.remaining_in_process, pi.issued_qty), 4) AS returned_qty
      FROM lot_process_issues pi
      JOIN inventory sl ON sl.id = pi.source_lot_id
      JOIN items i ON i.id = sl.item_id
      LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
      WHERE pi.machine_process_id = $1
      ORDER BY pi.id
    `, [req.params.id]);

    // All return records for these issues
    const issueIds = issues.map(i => i.id);
    let returns = [];
    if (issueIds.length) {
      const { rows } = await pool.query(`
        SELECT r.*,
               COALESCE(json_agg(
                 json_build_object(
                   'return_type', l.return_type, 'qty', l.qty,
                   'lot_code', l.lot_code, 'lot_id', l.lot_id
                 ) ORDER BY l.id
               ) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
        FROM lot_process_returns r
        LEFT JOIN process_return_lines l ON l.return_id = r.id
        WHERE r.issue_id = ANY($1::int[])
        GROUP BY r.id
        ORDER BY r.created_at
      `, [issueIds]);
      returns = rows;
    }

    // Aggregated return summary across all issues
    const totalIssued   = issues.reduce((s, i) => s + parseFloat(i.issued_qty || 0), 0);
    const totalReturned = issues.reduce((s, i) => s + parseFloat(i.returned_qty || 0), 0);
    const totalRemaining = issues.reduce((s, i) => s + parseFloat(i.remaining_qty || 0), 0);

    // Per-type return totals (for yield analytics)
    const returnTotals = { usable: 0, damaged: 0, consumed: 0, reprocess: 0, qc_hold: 0 };
    for (const r of returns) {
      for (const l of r.lines || []) {
        if (returnTotals[l.return_type] !== undefined)
          returnTotals[l.return_type] += parseFloat(l.qty || 0);
      }
    }

    res.json({
      process:        mp,
      issues,
      returns,
      return_totals:  returnTotals,
      summary: {
        total_issued:    totalIssued,
        total_returned:  totalReturned,
        total_remaining: totalRemaining,
      },
    });
  } catch (err) {
    logger.error('output-context error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/lookup/awaiting-output
// Processes that need a growth output entry (machine is awaiting_output).
// ══════════════════════════════════════════════════════════════════════════════
router.get('/lookup/awaiting-output', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mp.id, mp.process_number, mp.process_type, mp.started_at,
             mp.expected_rough_qty, mp.target_runtime_hours,
             m.code AS machine_code, m.name AS machine_name, m.status::text AS machine_status,
             u.full_name AS operator_name,
             ${RUNTIME_SQL} AS runtime_hours
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      LEFT JOIN users u ON u.id = mp.operator_id
      WHERE mp.status = 'running'
        AND m.status::text = 'awaiting_output'
      ORDER BY mp.started_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/manufacturing/processes  — Start a new process
// ══════════════════════════════════════════════════════════════════════════════
router.post('/processes', authenticate, async (req, res) => {
  const {
    machine_id,
    operator_id,
    process_type = 'growth',
    target_runtime_hours,
    expected_rough_qty,
    expected_height,
    remarks,
    lots = [],
    materials = [],
  } = req.body;

  if (!machine_id) return res.status(400).json({ error: 'machine_id required' });

  const normalised = process_type.toLowerCase();

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '25000ms'");

    const { rows: active } = await client.query(
      `SELECT id FROM machine_processes WHERE machine_id = $1 AND status IN ('running','hold')`,
      [machine_id]
    );
    if (active.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Machine already has an active process. Complete or cancel it first.' });
    }

    const { rows: mRows } = await client.query(
      'SELECT status FROM machines WHERE id = $1', [machine_id]
    );
    if (!mRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Machine not found' });
    }

    const oldMachineStatus = mRows[0].status;
    const expectedCompletion = target_runtime_hours
      ? new Date(Date.now() + target_runtime_hours * 3600 * 1000)
      : null;

    const processNumber = await nextMfgProcessNumber(client);

    const { rows: pRows } = await client.query(`
      INSERT INTO machine_processes
        (process_number, machine_id, operator_id, process_type, status,
         target_runtime_hours, expected_completion_at,
         expected_rough_qty, expected_height, remarks, created_by)
      VALUES ($1,$2,$3,$4,'running',$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      processNumber,
      machine_id,
      operator_id || null,
      normalised,
      target_runtime_hours || null,
      expectedCompletion,
      expected_rough_qty || null,
      expected_height || null,
      remarks || null,
      req.user.id,
    ]);
    const process = pRows[0];

    for (const lot of lots) {
      // State-machine enforcement: only IN STOCK / LOW STOCK lots may be issued
      // into a process. Any lot currently IN PROCESS (e.g. a Growth Run still in
      // the chamber) must be rejected even if it slipped past the picker filter.
      const { rows: lkRows } = await client.query(
        `SELECT id, status, lot_number FROM inventory WHERE id = $1 FOR UPDATE`,
        [lot.inventory_lot_id]
      );
      if (!lkRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Lot ${lot.inventory_lot_id} not found` });
      }
      const lotStatus = String(lkRows[0].status || '').toUpperCase();
      if (lotStatus !== 'IN STOCK' && lotStatus !== 'LOW STOCK') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Lot ${lkRows[0].lot_number || lot.inventory_lot_id} is ${lkRows[0].status} and cannot be issued to a process. Only IN STOCK lots are selectable.`,
        });
      }
      await client.query(`
        INSERT INTO machine_process_lots (process_id, inventory_lot_id, issued_qty, issued_weight)
        VALUES ($1,$2,$3,$4)
      `, [process.id, lot.inventory_lot_id, lot.issued_qty || 0, lot.issued_weight || 0]);
    }

    for (const mat of materials) {
      await client.query(`
        INSERT INTO machine_process_materials (process_id, material_id, material_name, qty, unit)
        VALUES ($1,$2,$3,$4,$5)
      `, [process.id, mat.material_id || null, mat.material_name || null, mat.qty || 0, mat.unit || null]);
    }

    await client.query(`UPDATE machines SET status = 'running' WHERE id = $1`, [machine_id]);
    await logMachineStatus(client, machine_id, oldMachineStatus, 'running', req.user.id,
      `Process ${processNumber} started`);

    await client.query('COMMIT');
    dispatchEvent('manufacturing.process.started', { id: process.id, process_number: processNumber, machine_id, process_type: normalised, module: 'manufacturing' });
    res.status(201).json({ process, process_number: processNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('start process error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/manufacturing/processes/:id/hold
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/processes/:id/hold', authenticate, async (req, res) => {
  const { remarks } = req.body;
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '25000ms'");
    const { rows } = await client.query('SELECT * FROM machine_processes WHERE id=$1', [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Process not found' }); }
    const proc = rows[0];
    if (proc.status !== 'running') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Process is not running' }); }

    await client.query(
      `UPDATE machine_processes SET status='hold', paused_at=NOW(), remarks=COALESCE($1,remarks) WHERE id=$2`,
      [remarks || null, proc.id]
    );

    const { rows: mRows } = await client.query('SELECT status FROM machines WHERE id=$1', [proc.machine_id]);
    await client.query(`UPDATE machines SET status='hold' WHERE id=$1`, [proc.machine_id]);
    await logMachineStatus(client, proc.machine_id, mRows[0]?.status, 'hold', req.user.id,
      remarks || `Process ${proc.process_number} held`);

    await client.query('COMMIT');
    dispatchEvent('manufacturing.process.held', { id: proc.id, process_number: proc.process_number, machine_id: proc.machine_id, module: 'manufacturing' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('hold error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/manufacturing/processes/:id/resume
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/processes/:id/resume', authenticate, async (req, res) => {
  const { remarks } = req.body;
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '25000ms'");
    const { rows } = await client.query('SELECT * FROM machine_processes WHERE id=$1', [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Process not found' }); }
    const proc = rows[0];
    if (proc.status !== 'hold') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Process is not on hold' }); }

    await client.query(`
      UPDATE machine_processes
      SET status='running',
          total_paused_minutes = total_paused_minutes + EXTRACT(EPOCH FROM (NOW() - paused_at))/60,
          paused_at=NULL,
          remarks=COALESCE($1, remarks)
      WHERE id=$2
    `, [remarks || null, proc.id]);

    const { rows: mRows } = await client.query('SELECT status FROM machines WHERE id=$1', [proc.machine_id]);
    await client.query(`UPDATE machines SET status='running' WHERE id=$1`, [proc.machine_id]);
    await logMachineStatus(client, proc.machine_id, mRows[0]?.status, 'running', req.user.id,
      remarks || `Process ${proc.process_number} resumed`);

    await client.query('COMMIT');
    dispatchEvent('manufacturing.process.resumed', { id: proc.id, process_number: proc.process_number, machine_id: proc.machine_id, module: 'manufacturing' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('resume error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/manufacturing/processes/:id/complete
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/processes/:id/complete', authenticate, async (req, res) => {
  // Phase 35: a GROWTH process completes via the Growth Run Return dialog and
  // carries the operator-measured biscuit dimensions. Non-growth processes
  // continue to send only { remarks } and are unaffected.
  const { remarks, weight, length, width, height, dim_unit } = req.body;
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '25000ms'");
    const { rows } = await client.query(
      `SELECT mp.*,
              COALESCE(pm.process_group,
                       CASE WHEN mp.process_type = 'growth' THEN 'GROWTH' ELSE 'OTHER' END) AS process_group
         FROM machine_processes mp
         LEFT JOIN process_master pm ON pm.process_code = mp.process_type
        WHERE mp.id = $1`,
      [req.params.id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Process not found' }); }
    const proc = rows[0];
    if (!['running','hold'].includes(proc.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Process is not active' });
    }

    const isGrowth = String(proc.process_group || '').toUpperCase() === 'GROWTH';

    let extraMinutes = 0;
    if (proc.status === 'hold' && proc.paused_at) {
      extraMinutes = (Date.now() - new Date(proc.paused_at).getTime()) / 60000;
    }

    // ── GROWTH path: Growth Run Return ──────────────────────────────────────
    // The seed is physically embedded in the biscuit, so individual seed
    // returns are NOT required. Completion is driven by the operator's biscuit
    // measurements: update the EXISTING Growth Run (no new row, no child lots),
    // compute growth_mm (generated column actual_growth_mm), flip it IN STOCK,
    // then complete the process and release the machine.
    if (isGrowth) {
      const w   = weight  === undefined || weight  === null || weight  === '' ? null : parseFloat(weight);
      const h   = height  === undefined || height  === null || height  === '' ? null : parseFloat(height);
      const len = length  === undefined || length  === null || length  === '' ? null : parseFloat(length);
      const wid = width   === undefined || width   === null || width   === '' ? null : parseFloat(width);

      if (!(w > 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Weight must be greater than 0 to complete a Growth Run' });
      }
      if (!(h > 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Height must be greater than 0 to complete a Growth Run' });
      }

      const biscuit = await findActiveBiscuitByProcess(client, proc.id);
      if (!biscuit) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `No Growth Run found for process ${proc.process_number}` });
      }

      const prevWeight = biscuit.weight;
      const prevHeight = biscuit.dim_height;

      // Update the existing Growth Run only. Generated columns
      // (actual_growth_mm, weight_gain, growth_pct) recompute automatically.
      const updated = await applyMeasurements(client, biscuit.id, {
        weight:     w,
        dim_height: h,
        dim_length: len === null ? undefined : len,
        dim_depth:  wid === null ? undefined : wid,
        dim_unit:   dim_unit || biscuit.dim_unit || 'mm',
        remarks:    remarks || undefined,
      });

      // IN PROCESS → IN STOCK (single row, no duplicate status records).
      await advanceGrowthRunToStock(client, proc.id);

      // RULE 1 follow-through: the seed lot(s) issued to this growth process are
      // now physically embedded in the biscuit. Because issue no longer clones
      // the seed (it flipped the SAME row to IN PROCESS), consume those seed rows
      // here so they leave available stock. The biscuit (growth_run) is exempt —
      // it was just advanced to IN STOCK above.
      const { rows: consumedSeeds } = await client.query(
        `UPDATE inventory
            SET status = 'CONSUMED', qty = 0, weight = 0, total_value = 0, updated_at = NOW()
          WHERE machine_process_id = $1
            AND status = 'IN PROCESS'
            AND item_id <> (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
          RETURNING id, lot_number`,
        [proc.id]
      );
      for (const s of consumedSeeds) {
        await client.query(
          `INSERT INTO lot_op_log
             (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
           VALUES ($1, 'seed_consumed', 'machine_process', $2, 0, 'CONSUMED', $3, $4)`,
          [s.id, proc.id,
           `Seed ${s.lot_number} consumed into Growth Run ${biscuit.lot_number} (process ${proc.process_number})`,
           req.user.id]
        );
      }

      const growthMm = updated.actual_growth_mm;

      // RULE 5: append a persistent cycle-history row (never overwrite prior
      // cycles). Per-cycle growth is THIS height minus the height before this
      // run (seed height on cycle 1, previous biscuit height on Growth Again).
      await recordGrowthCycle(client, {
        growthRunId:      biscuit.id,
        machineProcessId: proc.id,
        processType:      proc.process_type,
        prevHeight:       prevHeight,
        newHeight:        h,
        prevWeight:       prevWeight,
        newWeight:        w,
        dimLength:        len,
        dimWidth:         wid,
        dimUnit:          updated.dim_unit || dim_unit || 'mm',
        remarks:          remarks || null,
        performedBy:      req.user.id,
      });

      // Audit/history: Growth Run Returned (prev vs new weight/height + growth mm).
      await client.query(
        `INSERT INTO lot_op_log
           (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
         VALUES ($1, 'growth_run_returned', 'machine_process', $2, 0, 'IN STOCK', $3, $4)`,
        [
          biscuit.id,
          proc.id,
          `Growth Run ${biscuit.lot_number} returned. ` +
            `Weight ${prevWeight ?? '—'} → ${w}; Height ${prevHeight ?? '—'} → ${h}${updated.dim_unit || 'mm'}; ` +
            `Growth ${growthMm ?? '—'} mm` + (remarks ? ` | ${remarks}` : ''),
          req.user.id,
        ]
      );
    } else {
      // ── Non-growth path (unchanged): block completion if items unreturned ──
      const { rows: unreturnedRows } = await client.query(`
        SELECT SUM(COALESCE(remaining_in_process, issued_qty)) as remaining
        FROM lot_process_issues
        WHERE machine_process_id = $1 AND status != 'RETURNED'
      `, [proc.id]);

      if (unreturnedRows[0]?.remaining > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot complete: there are still materials issued to this process. Please return them first via Process Issues or the Workspace.' });
      }
    }

    await client.query(`
      UPDATE machine_processes
      SET status='completed', completed_at=NOW(),
          total_paused_minutes = total_paused_minutes + $1,
          paused_at=NULL, remarks=COALESCE($2, remarks)
      WHERE id=$3
    `, [extraMinutes, remarks || null, proc.id]);

    const { rows: mRows } = await client.query('SELECT status FROM machines WHERE id=$1', [proc.machine_id]);
    await client.query(`UPDATE machines SET status='idle' WHERE id=$1`, [proc.machine_id]);
    await logMachineStatus(client, proc.machine_id, mRows[0]?.status, 'idle', req.user.id,
      remarks || `Process ${proc.process_number} completed`);

    await client.query('COMMIT');
    dispatchEvent('manufacturing.process.completed', { id: proc.id, process_number: proc.process_number, machine_id: proc.machine_id, process_type: proc.process_type, module: 'manufacturing' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('complete error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/manufacturing/machines/:id/status
// Direct machine status update (maintenance, breakdown, cleaning, idle, etc.)
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/machines/:id/status', authenticate, async (req, res) => {
  const { new_status, remarks } = req.body;
  const normalised = new_status ? new_status.toLowerCase() : '';

  if (!normalised || !MACHINE_STATUSES.includes(normalised)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${MACHINE_STATUSES.join(', ')}` });
  }

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL statement_timeout = '25000ms'");
    const { rows } = await client.query('SELECT status FROM machines WHERE id=$1', [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Machine not found' }); }

    const oldStatus = rows[0].status;

    if (['maintenance','breakdown','idle','cleaning'].includes(normalised)) {
      await client.query(`
        UPDATE machine_processes SET status='cancelled', completed_at=NOW()
        WHERE machine_id=$1 AND status IN ('running','hold')
      `, [req.params.id]);
    }

    await client.query(`UPDATE machines SET status=$1::machine_status WHERE id=$2`, [normalised, req.params.id]);
    await logMachineStatus(client, req.params.id, oldStatus, normalised, req.user.id, remarks || null);

    await client.query('COMMIT');
    dispatchEvent('manufacturing.machine.status_changed', { id: parseInt(req.params.id), old_status: oldStatus, new_status: normalised, module: 'manufacturing' });
    res.json({ ok: true, old_status: oldStatus, new_status: normalised });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('machine status error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/lookup/operators
// ══════════════════════════════════════════════════════════════════════════════
router.get('/lookup/operators', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, username FROM users WHERE is_active = true AND role = 'operator' ORDER BY full_name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/lookup/seed-lots
// ══════════════════════════════════════════════════════════════════════════════
router.get('/lookup/seed-lots', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    // Correction 1: Exclude growth_run lots from the seed-lots picker. Growth Runs
    // are biscuits — they are not seeds. Only actual seed items (category='seed') should
    // appear here. Also exclude IN PROCESS items (growth_run IN PROCESS blocks are
    // enforced at issue-time, but we keep the list clean from the start).
    let where = `status IN ('IN STOCK','LOW STOCK') AND (SELECT category FROM items WHERE id = inv.item_id) IN ('seed', 'growth_run')`;
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (lot_number ILIKE $1 OR lot_name ILIKE $1)`;
    }
    const { rows } = await pool.query(
      `SELECT id, lot_number, lot_name, qty, weight, status
       FROM inventory inv WHERE ${where} ORDER BY lot_number LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/manufacturing/machine-logs/:machineId
// ══════════════════════════════════════════════════════════════════════════════
router.get('/machine-logs/:machineId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT msl.*, u.full_name AS changed_by_name
      FROM   machine_status_logs msl
      LEFT JOIN users u ON u.id = msl.changed_by
      WHERE  msl.machine_id = $1
      ORDER  BY msl.changed_at DESC LIMIT 50
    `, [req.params.machineId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

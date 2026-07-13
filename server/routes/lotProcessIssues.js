const express = require('express');
const pool    = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { isSeedItem, nextSiblingCode, nextLotOpId, nextMfgProcessNumber } = require('../services/seedLotCodeService');
const { createGrowthRun, advanceGrowthRunToStock, applyMeasurements, recordGrowthCycle } = require('../services/growthRunService');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();

const CANNOT_ISSUE = ['CONSUMED', 'SOLD', 'DISPOSED', 'DAMAGED', 'ARCHIVED'];

function usesWeight(lot) { return lot.unit === 'CT'; }
function effQty(lot) {
  return usesWeight(lot) ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
}

async function genIssueNum(client) {
  const { rows } = await client.query("SELECT nextval('lot_issue_seq') as n");
  const d = new Date();
  return `PI-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}-${String(rows[0].n).padStart(4,'0')}`;
}
async function genReturnNum(client) {
  const { rows } = await client.query("SELECT nextval('lot_return_seq') as n");
  const d = new Date();
  return `PR-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}-${String(rows[0].n).padStart(4,'0')}`;
}


async function logMachineStatus(client, machineId, oldStatus, newStatus, userId, remarks) {
  await client.query(
    `INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
     VALUES ($1,$2,$3,$4,$5)`,
    [machineId, oldStatus, newStatus, userId, remarks || null]
  );
}

async function logOp(client, lotId, op, refType, refId, qtyDelta, newStatus, notes, userId) {
  await client.query(
    `INSERT INTO lot_op_log (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [lotId, op, refType || null, refId || null, qtyDelta || null, newStatus || null, notes || null, userId || null]
  );
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      status,           // backward-compat raw DB status filter
      display_status,   // operational status: OPEN | PARTIAL | RETURNED | OVERDUE
      lot_id,
      search,           // ILIKE on issue_number, item_name, operator
      machine_search,   // ILIKE filter on machine name
      machine_id,       // exact match on machine id
      date_from,        // filter by issue_date >= date_from
      date_to,          // filter by issue_date <= date_to
      process_type,         // exact match on pi.process_type
      department_id,        // source lot OR machine department
      expected_return_from, // expected_return >= (returns register due-date range)
      expected_return_to,   // expected_return <=
      sort_by,          // completion_asc | completion_desc | default (created_at DESC)
      limit  = 50,
      offset = 0,
    } = req.query;

    const params = [];
    let where = 'WHERE 1=1';

    // Raw DB status (backward compat for LotWorkspacePage etc.)
    if (status) {
      params.push(status);
      where += ` AND pi.status = $${params.length}`;
    }

    // Operational display_status filter
    if (display_status && !status) {
      switch (display_status) {
        case 'OPEN':
          where += ` AND pi.status = 'OPEN'
            AND (pi.remaining_in_process IS NULL OR pi.remaining_in_process >= pi.issued_qty - 0.0001)
            AND (pi.expected_return IS NULL OR pi.expected_return >= CURRENT_DATE)`;
          break;
        case 'PARTIAL':
          where += ` AND pi.status = 'OPEN'
            AND pi.remaining_in_process IS NOT NULL
            AND pi.remaining_in_process < pi.issued_qty - 0.0001
            AND (pi.expected_return IS NULL OR pi.expected_return >= CURRENT_DATE)`;
          break;
        case 'RETURNED':
          where += ` AND pi.status = 'RETURNED'`;
          break;
        case 'OVERDUE':
          where += ` AND pi.status = 'OPEN'
            AND pi.expected_return IS NOT NULL
            AND pi.expected_return < CURRENT_DATE`;
          break;
      }
    }

    if (lot_id) {
      params.push(parseInt(lot_id));
      where += ` AND (pi.source_lot_id = $${params.length} OR pi.process_lot_id = $${params.length} OR gr.id = $${params.length})`;
    }

    if (machine_id) {
      params.push(parseInt(machine_id));
      where += ` AND pi.machine_id = $${params.length}`;
    }

    if (machine_search) {
      params.push(`%${machine_search}%`);
      where += ` AND mach.name ILIKE $${params.length}`;
    }

    if (search) {
      // Covers issue no, item, operator, lot codes, growth number and barcode (lot_op_id)
      params.push(`%${search}%`);
      where += ` AND (pi.issue_number::text ILIKE $${params.length}
                  OR i.name ILIKE $${params.length}
                  OR op.full_name ILIKE $${params.length}
                  OR sl.lot_code ILIKE $${params.length}
                  OR sl.lot_number ILIKE $${params.length}
                  OR pl.lot_code ILIKE $${params.length}
                  OR pl.lot_number ILIKE $${params.length}
                  OR gr.lot_number ILIKE $${params.length}
                  OR sl.lot_op_id::text ILIKE $${params.length}
                  OR pl.lot_op_id::text ILIKE $${params.length})`;
    }

    if (date_from) {
      params.push(date_from);
      where += ` AND pi.issue_date >= $${params.length}::date`;
    }

    if (date_to) {
      params.push(date_to);
      where += ` AND pi.issue_date <= $${params.length}::date`;
    }

    if (process_type) {
      params.push(process_type);
      where += ` AND pi.process_type = $${params.length}`;
    }

    if (department_id) {
      params.push(parseInt(department_id));
      where += ` AND (sl.department_id = $${params.length} OR mach.department_id = $${params.length})`;
    }

    if (expected_return_from) {
      params.push(expected_return_from);
      where += ` AND pi.expected_return >= $${params.length}::date`;
    }

    if (expected_return_to) {
      params.push(expected_return_to);
      where += ` AND pi.expected_return <= $${params.length}::date`;
    }

    // Dynamic ORDER BY
    let orderBy = 'pi.created_at DESC';
    if (sort_by === 'completion_asc')  orderBy = 'completion_pct ASC,  pi.created_at DESC';
    if (sort_by === 'completion_desc') orderBy = 'completion_pct DESC, pi.created_at DESC';

    const baseParams = [...params];
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(
      `SELECT pi.*,
              sl.lot_number AS source_lot_number, sl.lot_code AS source_lot_code,
              pl.lot_number AS process_lot_number, pl.lot_code AS process_lot_code, pl.status AS process_lot_status,
              i.name AS item_name, i.category,
              u.full_name AS created_by_name,
              mach.code AS machine_code, mach.name AS machine_name,
              op.full_name AS operator_full_name,
              pm.process_name AS process_display_name,
              -- Growth Run linkage (biscuit created at process start): the biscuit's
              -- lot_number IS the Growth Number; run_no increments on Growth Again.
              gr.lot_number AS growth_number,
              gr.run_no,
              gri.name AS growth_item_name,
              gr.dim_length AS growth_dim_length, gr.dim_depth AS growth_dim_depth,
              gr.dim_height AS growth_dim_height, gr.dim_unit AS growth_dim_unit,
              rt.lot_number AS root_lot_number, rt.lot_code AS root_lot_code,
              sl.lot_op_id AS source_lot_op_id,
              -- Operational computed fields
              ROUND(pi.issued_qty - COALESCE(pi.remaining_in_process, pi.issued_qty), 4) AS returned_qty,
              COALESCE(pi.remaining_in_process, pi.issued_qty)                            AS remaining_qty,
              ROUND(
                CASE WHEN pi.issued_qty > 0
                  THEN ((pi.issued_qty - COALESCE(pi.remaining_in_process, pi.issued_qty)) / pi.issued_qty) * 100
                  ELSE 0
                END, 1
              ) AS completion_pct,
              -- Operational display status (OPEN / PARTIAL / RETURNED / OVERDUE)
              CASE
                WHEN pi.status = 'RETURNED' THEN 'RETURNED'
                WHEN pi.status = 'OPEN'
                     AND pi.expected_return IS NOT NULL
                     AND pi.expected_return < CURRENT_DATE
                     AND COALESCE(pi.remaining_in_process, pi.issued_qty) > 0.0001 THEN 'OVERDUE'
                WHEN pi.status = 'OPEN'
                     AND pi.remaining_in_process IS NOT NULL
                     AND pi.remaining_in_process < pi.issued_qty - 0.0001           THEN 'PARTIAL'
                ELSE pi.status
              END AS display_status
       FROM lot_process_issues pi
       JOIN inventory sl       ON sl.id   = pi.source_lot_id
       JOIN items i            ON i.id    = sl.item_id
       LEFT JOIN inventory pl  ON pl.id   = pi.process_lot_id
       LEFT JOIN users u       ON u.id    = pi.created_by
       LEFT JOIN machines mach ON mach.id = pi.machine_id
       LEFT JOIN users op      ON op.id   = pi.operator_id
       LEFT JOIN process_master pm ON pm.process_code = pi.process_type
       LEFT JOIN inventory gr  ON gr.machine_process_id = pi.machine_process_id
                              AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
       LEFT JOIN items gri     ON gri.id = gr.item_id
       LEFT JOIN inventory rt  ON rt.id = sl.root_lot_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Count query — must carry every JOIN the where clause can reference
    // (machine_search, search across op/pl/gr, department filter)
    const { rows: [cnt] } = await pool.query(
      `SELECT COUNT(*) FROM lot_process_issues pi
       JOIN inventory sl       ON sl.id   = pi.source_lot_id
       JOIN items i            ON i.id    = sl.item_id
       LEFT JOIN inventory pl  ON pl.id   = pi.process_lot_id
       LEFT JOIN users op      ON op.id   = pi.operator_id
       LEFT JOIN machines mach ON mach.id = pi.machine_id
       LEFT JOIN inventory gr  ON gr.machine_process_id = pi.machine_process_id
                              AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
       ${where}`,
      baseParams
    );
    res.json({ data: rows, total: parseInt(cnt.count) });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotProcessIssues.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── LOOKUP: MACHINES ──────────────────────────────────────────────────────────
// Must be before /:id to avoid wildcard match
// Returns operationally active machines (excludes maintenance/breakdown).
router.get('/lookup/machines', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.id,
        m.code,
        m.name,
        m.type         AS machine_type,
        m.status::text AS machine_status,
        m.capacity,
        m.department_id,
        d.name         AS department_name
      FROM  machines m
      LEFT  JOIN departments d ON d.id = m.department_id
      WHERE m.status::text NOT IN ('maintenance', 'breakdown')
      ORDER BY
        CASE m.status::text
          WHEN 'idle'             THEN 1
          WHEN 'cleaning'         THEN 2
          WHEN 'awaiting_output'  THEN 3
          WHEN 'hold'             THEN 4
          WHEN 'running'          THEN 5
          ELSE 6
        END,
        NULLIF(regexp_replace(m.name, '\\D', '', 'g'), '')::numeric ASC,
        m.name ASC
    `);
    res.json(rows);
  } catch (err) {
    logger.error('lookup/machines error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── OP LOG (must be before /:id) ──────────────────────────────────────────────
router.get('/op-log/:lotId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ol.*, u.full_name AS performed_by_name
       FROM lot_op_log ol
       LEFT JOIN users u ON u.id = ol.performed_by
       WHERE ol.lot_id = $1
       ORDER BY ol.performed_at DESC
       LIMIT 100`,
      [req.params.lotId]
    );
    res.json(rows);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotProcessIssues.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── DETAIL ─────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pi.*,
              sl.lot_number AS source_lot_number, sl.lot_code AS source_lot_code,
              sl.qty AS source_qty, sl.unit,
              pl.lot_number AS process_lot_number, pl.lot_code AS process_lot_code,
              pl.status AS process_lot_status, pl.qty AS process_lot_qty,
              pl.weight AS process_lot_weight,
              pl.dim_length AS process_lot_dim_length,
              pl.dim_depth AS process_lot_dim_depth,
              pl.dim_height AS process_lot_dim_height,
              pl.dim_unit AS process_lot_dim_unit,
              i.name AS item_name, i.category,
              u.full_name AS created_by_name,
              mach.code AS machine_code, mach.name AS machine_name,
              op.full_name AS operator_full_name,
              -- Phase A workspace context: the Growth Run biscuit linked to this
              -- process (its lot_number IS the Growth Number) + the root seed lot.
              gr.lot_number AS growth_number,
              gr.run_no,
              gr.dim_length AS growth_dim_length, gr.dim_depth AS growth_dim_depth,
              gr.dim_height AS growth_dim_height, gr.dim_unit AS growth_dim_unit,
              gri.name AS growth_item_name,
              rt.lot_number AS root_lot_number, rt.lot_code AS root_lot_code,
              COALESCE(pm1.allowed_outputs, pm2.allowed_outputs) AS allowed_outputs
       FROM lot_process_issues pi
       JOIN inventory sl      ON sl.id   = pi.source_lot_id
       JOIN items i           ON i.id    = sl.item_id
       LEFT JOIN inventory pl ON pl.id   = pi.process_lot_id
       LEFT JOIN users u      ON u.id    = pi.created_by
       LEFT JOIN machines mach ON mach.id = pi.machine_id
       LEFT JOIN users op     ON op.id   = pi.operator_id
       LEFT JOIN machine_processes mp ON pi.machine_process_id = mp.id
       LEFT JOIN process_master pm1 ON mp.process_type = pm1.process_code
       LEFT JOIN process_master pm2 ON pi.process_type = pm2.process_code
       LEFT JOIN inventory gr ON gr.machine_process_id = pi.machine_process_id
                             AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
       LEFT JOIN items gri    ON gri.id = gr.item_id
       LEFT JOIN inventory rt ON rt.id = sl.root_lot_id
       WHERE pi.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' });
    const { rows: rets } = await pool.query(
      `SELECT r.*,
         COALESCE(json_agg(
           json_build_object(
             'id', l.id, 'return_type', l.return_type, 'qty', l.qty,
             'lot_id', l.lot_id, 'lot_code', l.lot_code, 'remarks', l.remarks
           ) ORDER BY l.id
         ) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM lot_process_returns r
       LEFT JOIN process_return_lines l ON l.return_id = r.id
       WHERE r.issue_id = $1
       GROUP BY r.id
       ORDER BY r.created_at`,
      [req.params.id]
    );
    res.json({ ...rows[0], return: rets[rets.length - 1] || null, returns: rets });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotProcessIssues.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE ISSUE
// Supports two flows:
//   A) machine_id present → new machine-linked multi-lot flow (Phase 28)
//   B) source_lot_id only  → legacy single-lot flow (backward compat)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const {
    machine_id, operator_id, process_type,
    target_runtime_hours, expected_rough_qty,
    lots,                           // array [{source_lot_id, issued_qty}]
    source_lot_id, issued_qty,      // legacy single-lot fields
    issue_date, expected_return, department, operator, remarks,
  } = req.body;

  // ── Flow A: machine-linked ────────────────────────────────────────────────
  if (machine_id) {
    const lotsArr = Array.isArray(lots) && lots.length > 0
      ? lots
      : (source_lot_id ? [{ source_lot_id, issued_qty }] : []);

    const normalizedPType = (process_type || 'growth').toLowerCase().trim();

    const client = await pool.primaryPool.connect();
    try {
      await client.query('BEGIN');

      // 0. Validate process type against process_master
      const { rows: pmRows } = await client.query(
        'SELECT * FROM process_master WHERE process_code = $1 AND active = true',
        [normalizedPType]
      );
      if (!pmRows.length)
        throw new Error(`Unknown or inactive process type: '${normalizedPType}'. Configure it in Management → Process Master.`);
      const processRules = pmRows[0];

      // Growth Run state machine: is this a GROWTH-group process? (Growth Again
      // re-issues an existing biscuit back into a growth chamber.)
      const isGrowthGroup =
        String(processRules.process_group || (normalizedPType === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase() === 'GROWTH';
      // Set true when an existing biscuit is re-issued to a growth process, so we
      // reuse the same Growth Run row instead of minting a new one at Step 6.
      let isGrowthAgain = false;

      // Enforce inventory rules
      if (processRules.requires_inventory && !lotsArr.length)
        throw new Error(`Process '${processRules.process_name}' requires at least one inventory lot.`);
      if (!processRules.requires_inventory && lotsArr.length > 0)
        throw new Error(`Process '${processRules.process_name}' does not accept inventory lots.`);

      // 1. Lock and validate machine
      // FOR UPDATE OF m only — cannot lock nullable side of LEFT JOIN
      const { rows: machRows } = await client.query(
        `SELECT m.*, d.name AS department_name
         FROM machines m LEFT JOIN departments d ON d.id = m.department_id
         WHERE m.id = $1 FOR UPDATE OF m`,
        [parseInt(machine_id)]
      );
      if (!machRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Machine not found' }); }
      const machine = machRows[0];

      // 2. Validate and lock all source lots (skipped when requires_inventory = false)
      const lockedLots = [];
      for (const entry of lotsArr) {
        const qty = parseFloat(entry.issued_qty);
        if (!(qty > 0)) throw new Error(`Invalid issued_qty for lot #${entry.source_lot_id}`);

        const { rows: lotRows } = await client.query(
          `SELECT inv.*, i.category, i.name AS item_name
           FROM inventory inv JOIN items i ON inv.item_id = i.id
           WHERE inv.id = $1 FOR UPDATE OF inv`,
          [parseInt(entry.source_lot_id)]
        );
        if (!lotRows.length) throw new Error(`Lot #${entry.source_lot_id} not found`);
        const lot = lotRows[0];

        if (CANNOT_ISSUE.includes(lot.status))
          throw new Error(`Lot ${lot.lot_number} is ${lot.status} — cannot issue`);
        // RULE 7: state-machine enforcement. ONLY IN STOCK (or LOW STOCK) lots may
        // be issued to a process. Anything IN PROCESS is already inside a machine
        // and must be blocked — no exceptions. A Growth Run still in the chamber
        // gets a clearer, biscuit-specific message.
        if (lot.category === 'growth_run' && lot.status === 'IN PROCESS')
          throw new Error(`Growth Run ${lot.lot_number} is currently IN PROCESS (still in chamber). Complete the Growth Run Return first to release it to IN STOCK before issuing.`);
        if (lot.status !== 'IN STOCK' && lot.status !== 'LOW STOCK')
          throw new Error(`Lot ${lot.lot_number} is ${lot.status} — only IN STOCK lots can be issued to a process.`);

        const avail = effQty(lot);
        if (qty > avail + 0.0001)
          throw new Error(`Issue qty ${qty.toFixed(4)} exceeds available ${avail.toFixed(4)} for lot ${lot.lot_number}`);

        lockedLots.push({ lot, qty });
      }

      // 3. Create machine_processes record
      const processNum = await nextMfgProcessNumber(client);
      const effectiveRuntime = target_runtime_hours
        ? parseFloat(target_runtime_hours)
        : (processRules.default_runtime_hours ? parseFloat(processRules.default_runtime_hours) : null);
      const expCompletion = effectiveRuntime
        ? new Date(Date.now() + effectiveRuntime * 3600000)
        : null;

      const { rows: [machProc] } = await client.query(
        `INSERT INTO machine_processes
           (process_number, machine_id, operator_id, process_type, status,
            target_runtime_hours, expected_completion_at, expected_rough_qty,
            remarks, created_by)
         VALUES ($1,$2,$3,$4,'running',$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          processNum, parseInt(machine_id),
          operator_id ? parseInt(operator_id) : null,
          normalizedPType,
          effectiveRuntime,
          expCompletion,
          expected_rough_qty ? parseFloat(expected_rough_qty) : null,
          remarks || null,
          req.user.id,
        ]
      );

      // 4. Process each lot
      const issues = [];
      for (const { lot, qty } of lockedLots) {
        const issueNum  = await genIssueNum(client);
        const isSeed    = isSeedItem(lot);
        const rough     = usesWeight(lot);
        const pqty      = effQty(lot);

        // Phase 34 (FIX 2): a Growth Run (biscuit) issued to a LASER process is
        // NOT split, cloned, or given an -IP child. Laser ops (Edge Cut, Outer
        // Cut, Block Cut, Seed Remove, Growth Cut) operate against the SAME
        // inventory row — its id never changes through the laser stage. We
        // reference the biscuit directly and skip child-lot minting entirely,
        // so no phantom GR-xxxx-IP lots are ever created.
        const isGrowthRun = lot.category === 'growth_run';

        // RULE 1: Issuing a lot to a process is NOT a physical split. The lot
        // already exists (the legitimate split happened upstream, e.g. 1019 →
        // 1019-02). When the FULL available quantity goes into the machine the
        // SAME inventory record enters the process — only its status changes
        // IN STOCK → IN PROCESS. No -A / -B / -IP suffix is minted on issue.
        // A genuine PARTIAL issue (some units stay in stock) still splits, since
        // two physical groups then hold different states — but that is a split,
        // not an "issue clone".
        const isFullIssue  = qty >= pqty - 0.0001;
        const issueInPlace = isGrowthRun || isFullIssue;

        let childLot, childCode, childWeight;

        if (issueInPlace) {
          childLot    = lot;                       // operate on the lot itself
          childCode   = lot.lot_number;
          childWeight = parseFloat(lot.weight || 0);
        } else {
          const parentCode  = (isSeed && lot.lot_code) ? lot.lot_code : lot.lot_number;
          const parentLevel = isSeed ? (parseInt(lot.split_level) || 0) : 0;

          if (isSeed) {
            childCode = await nextSiblingCode(client, parentCode, parentLevel, lot.id);
            const { rows: dup } = await client.query(
              'SELECT 1 FROM inventory WHERE lot_code = $1 OR lot_number = $1', [childCode]
            );
            if (dup.length) throw new Error(`Lot code ${childCode} already exists — retry`);
          } else {
            const baseCode = lot.lot_number.replace(/-IP\d*$/, '');
            let suffixNum = 1;
            let uniqueCode = `${baseCode}-IP`;
            while (true) {
              const { rows: dup } = await client.query('SELECT 1 FROM inventory WHERE lot_number = $1', [uniqueCode]);
              if (!dup.length) break;
              suffixNum++;
              uniqueCode = `${baseCode}-IP${suffixNum}`;
            }
            childCode = uniqueCode;
          }

          const childQty    = rough ? 1 : qty;
          childWeight = rough
            ? qty
            : (parseFloat(lot.weight || 0) > 0
              ? Math.round((qty / (pqty || 1)) * parseFloat(lot.weight) * 10000) / 10000
              : 0);
          const childValue  = Math.round(qty * parseFloat(lot.rate) * 100) / 100;
          const seedLevel   = isSeed ? parentLevel + 1 : null;
          const parentPath  = isSeed ? (lot.genealogy_path || parentCode) : null;
          const childGenPath = isSeed ? `${parentPath}/${childCode}` : null;

          const issueLotOpId = await nextLotOpId(client);

          const { rows: [inserted] } = await client.query(
            `INSERT INTO inventory
               (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
                location_id, department_id, vendor_id, purchase_date,
                status, remarks, source_type,
                lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
                lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN PROCESS',$14,'issue',
                     $15,$16,$17,'issue',$18,$19,$20,$21,$22,$23,$24,'Process Issues')
             RETURNING *`,
            [
              lot.item_id, childCode,
              `${lot.lot_name || lot.lot_number} (in process)`,
              lot.batch_no, childQty, lot.unit, childWeight,
              parseFloat(lot.rate), childValue,
              lot.location_id,
              lot.department_id || machine.department_id || null,
              lot.vendor_id, lot.purchase_date,
              remarks || null,
              isSeed ? childCode : null,
              lot.id,
              isSeed ? (lot.root_lot_id || lot.id) : null,
              seedLevel, childGenPath,
              issueLotOpId,
              isSeed ? (lot.dim_length ?? null) : null,
              isSeed ? (lot.dim_depth  ?? null) : null,
              isSeed ? (lot.dim_height ?? null) : null,
              isSeed ? (lot.dim_unit   ?? null) : null,
            ]
          );
          childLot = inserted;
        }

        // Deduct from source lot.
        // Growth Run (biscuit): NEVER depleted and NEVER cloned. The single
        // physical biscuit enters the machine, so its state machine flips
        // IN STOCK → IN PROCESS (locking it out of other selections, req 1),
        // and it is repointed to THIS process so completion/return resolves the
        // SAME row. Qty/weight/genealogy are untouched. It returns to IN STOCK on
        // Growth Run Return (growth) or process return (laser); it is consumed
        // only at Growth Output.
        const remainQty  = issueInPlace ? pqty : Math.max(0, pqty - qty);
        const newSrcStat = issueInPlace
          ? 'IN PROCESS'
          : (remainQty <= 0.0001 ? 'CONSUMED' : (lot.status === 'IN PROCESS' ? 'IN PROCESS' : 'IN STOCK'));
        const remainVal  = Math.round(remainQty * parseFloat(lot.rate) * 100) / 100;
        if (issueInPlace) {
          // RULE 1/6: the SAME inventory row enters the machine. Flip
          // IN STOCK → IN PROCESS and repoint machine_process_id to THIS process
          // (so completion/return resolves the same row). qty/weight/genealogy
          // are untouched. No clone, no suffix.
          if (isGrowthRun && isGrowthGroup) isGrowthAgain = true;   // re-growing an existing biscuit
          await client.query(
            `UPDATE inventory SET status='IN PROCESS', machine_process_id=$1, updated_at=NOW() WHERE id=$2`,
            [machProc.id, lot.id]
          );
        } else if (rough) {
          await client.query(
            `UPDATE inventory SET qty=$1, weight=$2, total_value=$3, status=$4, updated_at=NOW() WHERE id=$5`,
            [remainQty <= 0.0001 ? 0 : 1, remainQty <= 0.0001 ? 0 : remainQty, remainVal, newSrcStat, lot.id]
          );
        } else {
          await client.query(
            `UPDATE inventory SET qty=$1, total_value=$2, status=$3, updated_at=NOW() WHERE id=$4`,
            [remainQty <= 0.0001 ? 0 : remainQty, remainVal, newSrcStat, lot.id]
          );
        }

        // Create lot_process_issues record (linked to machine process)
        const { rows: [issue] } = await client.query(
          `INSERT INTO lot_process_issues
             (issue_number, source_lot_id, process_lot_id, issued_qty,
              issue_date, expected_return, remarks, created_by,
              machine_id, operator_id, machine_process_id, process_type,
              target_runtime_hours, expected_rough_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            issueNum, lot.id, childLot.id, qty,
            issue_date || new Date().toISOString().split('T')[0],
            expected_return || null, remarks || null, req.user.id,
            parseInt(machine_id),
            operator_id ? parseInt(operator_id) : null,
            machProc.id,
            normalizedPType,
            effectiveRuntime,
            expected_rough_qty ? parseFloat(expected_rough_qty) : null,
          ]
        );

        // Link lot to machine process
        await client.query(
          `INSERT INTO machine_process_lots (process_id, inventory_lot_id, issued_qty, issued_weight)
           VALUES ($1,$2,$3,$4)`,
          [machProc.id, childLot.id, qty, childWeight]
        );

        // Operation log
        await logOp(client, lot.id, 'issue', 'lot_process_issue', issue.id,
          issueInPlace ? 0 : -qty, newSrcStat,
          isGrowthRun
            ? (isGrowthGroup
                ? `Growth Run ${lot.lot_number} re-issued to growth process ${processNum} (Growth Again → IN PROCESS)`
                : `Biscuit ${lot.lot_number} issued to ${normalizedPType} process ${processNum} → IN PROCESS (non-consuming)`)
            : (issueInPlace
                ? `${lot.lot_number} issued in place to ${normalizedPType} process ${processNum} → IN PROCESS (same lot, no clone)`
                : `Issued ${qty.toFixed(4)} ${lot.unit} to machine process ${processNum} (partial split)`),
          req.user.id);
        // When the lot enters the machine in place (RULE 1) there is no separate
        // child row, so skip the child "issue_receive" log — the single source
        // row IS the process lot. Only a genuine partial split has a child.
        if (!issueInPlace) {
          await logOp(client, childLot.id, 'issue_receive', 'lot_process_issue', issue.id, qty, 'IN PROCESS',
            `Received for machine process: ${processNum}`, req.user.id);
        }

        issues.push({
          issue_number:         issueNum,
          issue_id:             issue.id,
          process_lot:          { id: childLot.id, lot_number: childCode, qty },
          source_remaining_qty: remainQty,
          source_new_status:    newSrcStat,
        });
      }

      // 5. Set machine to 'running' and log status change
      const oldMachStatus = machine.status;
      await client.query(`UPDATE machines SET status = 'running' WHERE id = $1`, [parseInt(machine_id)]);
      await logMachineStatus(client, parseInt(machine_id), oldMachStatus, 'running', req.user.id,
        `Process ${processNum} started via Issue to Process`);

      // 6. Phase 34: create the Growth Run (biscuit) IMMEDIATELY at process start.
      //    createGrowthRun is gated to process_group='GROWTH' (returns null for
      //    LASER / other groups) and is idempotent, so the later seed-return
      //    transition simply finds the existing biscuit instead of creating one.
      //    GROWTH AGAIN: when an existing biscuit (category='growth_run') is
      //    re-issued into a GROWTH process, it must be reused in place — no new
      //    Growth Run, clone, or child lot. createGrowthRun is idempotent and
      //    returns the SAME biscuit row (already flipped to IN PROCESS during the
      //    issue loop), so we only emit a 'growth_again' history entry.
      let growthRun = null;
      try {
        growthRun = await createGrowthRun(client, machProc.id, { createdBy: req.user.id });
        if (growthRun) {
          if (isGrowthAgain) {
            await client.query('UPDATE inventory SET run_no = run_no + 1 WHERE id = $1', [growthRun.id]);
            await logOp(client, growthRun.id, 'growth_again', 'machine_process', machProc.id,
              0, 'IN PROCESS',
              `Growth Run ${growthRun.lot_number} re-issued into Growth Process ${processNum} (IN STOCK -> IN PROCESS)`, req.user.id);
          } else {
            await logOp(client, growthRun.id, 'growth_run_created', 'machine_process', machProc.id,
              1, growthRun.status,
              `Growth Run ${growthRun.lot_number} created at process start ${processNum}`, req.user.id);
          }
        }
      } catch (gErr) {
        throw new Error(`Failed to create Growth Run for process ${processNum}: ${gErr.message}`);
      }

      await client.query('COMMIT');

      // Real-Time: process started (machine-linked flow)
      dispatchEvent('process.started', {
        process_number: processNum, machine_process_id: machProc.id,
        process_type: normalizedPType, machine_id: parseInt(machine_id),
        issues_count: issues.length, created_by: req.user.id,
      });

      return res.status(201).json({
        process_number:     processNum,
        machine_process_id: machProc.id,
        machine_code:       machine.code,
        machine_name:       machine.name,
        issue_count:        issues.length,
        growth_run_number:  growthRun ? growthRun.lot_number : null,
        growth_run_id:      growthRun ? growthRun.id : null,
        issues,
      });
    } catch (err) {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const logPath = path.join(os.tmpdir(), 'silverstar-error.txt');
      fs.appendFileSync(logPath, new Date().toISOString() + ' ' + err.message + '\n' + err.stack + '\n\n');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: err.message });
    } finally { client.release(); }
  }

  // ── Flow B: legacy single-lot (backward compat) ───────────────────────────
  if (!source_lot_id) return res.status(400).json({ error: 'source_lot_id required' });
  const qty = parseFloat(issued_qty);
  if (!(qty > 0)) return res.status(400).json({ error: 'issued_qty must be positive' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { rows: lotRows } = await client.query(
      `SELECT inv.*, i.category, i.name AS item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1 FOR UPDATE`,
      [source_lot_id]
    );
    if (!lotRows.length) throw new Error('Lot not found');
    const lot = lotRows[0];

    if (CANNOT_ISSUE.includes(lot.status))
      throw new Error(`Lot is ${lot.status} — only IN STOCK lots can be issued to process`);
    // Unified with the primary issue path: IN STOCK and LOW STOCK are both issuable
    // (LOW STOCK is a quantity flag, not a workflow state).
    if (lot.status !== 'IN STOCK' && lot.status !== 'LOW STOCK')
      throw new Error(`Lot is ${lot.status} — only IN STOCK lots can be issued to process`);

    const pqty = effQty(lot);
    if (qty > pqty + 0.0001)
      throw new Error(`Issue qty (${qty.toFixed(4)}) exceeds available (${pqty.toFixed(4)})`);

    const { rows: existingOpen } = await client.query(
      `SELECT 1 FROM lot_process_issues WHERE source_lot_id = $1 AND status = 'OPEN'`,
      [source_lot_id]
    );
    if (existingOpen.length) throw new Error('This lot already has an open process issue');

    const issueNum = await genIssueNum(client);
    const isSeed   = isSeedItem(lot);
    const rough    = usesWeight(lot);

    const parentCode  = (isSeed && lot.lot_code) ? lot.lot_code : lot.lot_number;
    const parentLevel = isSeed ? (parseInt(lot.split_level) || 0) : 0;

    // RULE 1: issuing a lot into a process is NOT a split. When the FULL available
    // quantity goes into the machine the SAME inventory row enters the process —
    // status IN STOCK → IN PROCESS, no -A / -IP clone. A genuine PARTIAL issue
    // still splits (two physical groups, two states).
    const isFullIssue  = qty >= pqty - 0.0001;
    const issueInPlace = isFullIssue;

    let childLot, childCode, remainQty, newSrcStatus;

    if (issueInPlace) {
      childLot     = lot;
      childCode    = lot.lot_number;
      remainQty    = pqty;
      newSrcStatus = 'IN PROCESS';
      await client.query(
        `UPDATE inventory SET status='IN PROCESS', updated_at=NOW() WHERE id=$1`,
        [lot.id]
      );
    } else {
      if (isSeed) {
        childCode = await nextSiblingCode(client, parentCode, parentLevel, lot.id);
        const { rows: dup } = await client.query(
          'SELECT 1 FROM inventory WHERE lot_code = $1 OR lot_number = $1', [childCode]
        );
        if (dup.length) throw new Error(`Lot code ${childCode} already exists — retry`);
      } else {
        childCode = `${lot.lot_number}-IP`;
      }

      const childQty    = rough ? 1 : qty;
      const childWeight = rough ? qty : (parseFloat(lot.weight || 0) > 0
        ? Math.round((qty / (pqty || 1)) * parseFloat(lot.weight) * 10000) / 10000
        : 0);
      const childValue  = Math.round(qty * parseFloat(lot.rate) * 100) / 100;
      const seedLevel   = isSeed ? parentLevel + 1 : null;
      const parentPath  = isSeed ? (lot.genealogy_path || parentCode) : null;
      const childGenPath = isSeed ? `${parentPath}/${childCode}` : null;

      const issueLotOpId = await nextLotOpId(client);

      const { rows: [inserted] } = await client.query(
        `INSERT INTO inventory
           (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
            location_id, department_id, vendor_id, purchase_date,
            status, remarks, source_type,
            lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
            lot_op_id, dim_length, dim_depth, dim_height, dim_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN PROCESS',$14,'issue',
                 $15,$16,$17,'issue',$18,$19,$20,$21,$22,$23,$24)
         RETURNING *`,
        [
          lot.item_id, childCode,
          `${lot.lot_name || lot.lot_number} (in process)`,
          lot.batch_no, childQty, lot.unit, childWeight,
          parseFloat(lot.rate), childValue,
          lot.location_id, lot.department_id, lot.vendor_id, lot.purchase_date,
          remarks || null,
          isSeed ? childCode : null, lot.id,
          isSeed ? (lot.root_lot_id || lot.id) : null,
          seedLevel, childGenPath,
          issueLotOpId,
          isSeed ? (lot.dim_length ?? null) : null,
          isSeed ? (lot.dim_depth  ?? null) : null,
          isSeed ? (lot.dim_height ?? null) : null,
          isSeed ? (lot.dim_unit   ?? null) : null,
        ]
      );
      childLot = inserted;

      remainQty    = Math.max(0, pqty - qty);
      newSrcStatus = remainQty <= 0.0001 ? 'CONSUMED' : 'IN STOCK';
      const remainValue = Math.round(remainQty * parseFloat(lot.rate) * 100) / 100;
      if (rough) {
        await client.query(
          `UPDATE inventory SET qty=$1, weight=$2, total_value=$3, status=$4, updated_at=NOW() WHERE id=$5`,
          [remainQty <= 0.0001 ? 0 : 1, remainQty <= 0.0001 ? 0 : remainQty, remainValue, newSrcStatus, lot.id]
        );
      } else {
        await client.query(
          `UPDATE inventory SET qty=$1, total_value=$2, status=$3, updated_at=NOW() WHERE id=$4`,
          [remainQty <= 0.0001 ? 0 : remainQty, remainValue, newSrcStatus, lot.id]
        );
      }
    }

    const { rows: [issue] } = await client.query(
      `INSERT INTO lot_process_issues
         (issue_number, source_lot_id, process_lot_id, issued_qty,
          issue_date, expected_return, department, operator, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [issueNum, lot.id, childLot.id, qty,
       issue_date || new Date().toISOString().split('T')[0],
       expected_return || null, department || null, operator || null, remarks || null, req.user.id]
    );

    await logOp(client, lot.id, 'issue', 'lot_process_issue', issue.id,
      issueInPlace ? 0 : -qty, newSrcStatus,
      issueInPlace
        ? `${lot.lot_number} issued in place to process (${issueNum}) → IN PROCESS (same lot, no clone)`
        : `Issued ${qty.toFixed(4)} ${lot.unit} to process (${issueNum})`,
      req.user.id);
    if (!issueInPlace) {
      await logOp(client, childLot.id, 'issue_receive', 'lot_process_issue', issue.id, qty, 'IN PROCESS',
        `Received for process: ${issueNum}`, req.user.id);
    }

    await client.query('COMMIT');

    // Real-Time: process started (legacy flow)
    dispatchEvent('process.started', {
      issue_number: issueNum, issue_id: issue.id,
      source_lot_id, issued_qty: qty, created_by: req.user.id,
    });

    res.status(201).json({
      issue_number: issueNum,
      issue_id: issue.id,
      process_lot: { id: childLot.id, lot_number: childCode, qty },
      source_remaining_qty: remainQty,
      source_new_status: newSrcStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── RETURN LOT CODE HELPERS ───────────────────────────────────────────────────

/**
 * Generate next sequential return lot code for a given suffix char.
 * Queries existing children of processLotId matching `{parentCode}-{char}N` pattern.
 * Called inside a transaction — the parent row is already locked.
 */
async function nextReturnLotCode(client, processLotId, parentCode, suffixChar) {
  const { rows } = await client.query(
    `SELECT lot_code FROM inventory WHERE parent_lot_id = $1 AND lot_code LIKE $2`,
    [processLotId, `${parentCode}-${suffixChar}%`]
  );
  let maxN = 0;
  const prefix = `${parentCode}-${suffixChar}`;
  for (const { lot_code } of rows) {
    if (lot_code?.startsWith(prefix)) {
      const n = parseInt(lot_code.slice(prefix.length), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return `${parentCode}-${suffixChar}${maxN + 1}`;
}

// ── CREATE RETURN ──────────────────────────────────────────────────────────────
// Accepts multi-line returns, partial returns, and five return types.
// Body: { return_date, notes, lines: [{type, qty, remarks}], remaining_in_process? }
//
// Balance rule: sum(lines.qty) + remaining_after = current remaining_in_process
// If remaining_after = 0 → issue marked RETURNED, machine_process auto-completed
//   if all sibling issues are also RETURNED.
router.post('/:id/return', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const issueId = parseInt(req.params.id);
  const { return_date, notes, lines, remaining_in_process: remainingAfterInput,
          measurements } = req.body;

  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: 'At least one return line is required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the issue
    const { rows: issueRows } = await client.query(
      `SELECT i.*, COALESCE(p1.allowed_outputs, p2.allowed_outputs) AS allowed_outputs
       FROM lot_process_issues i
       LEFT JOIN machine_processes mp ON i.machine_process_id = mp.id
       LEFT JOIN process_master p1 ON mp.process_type = p1.process_code
       LEFT JOIN process_master p2 ON i.process_type = p2.process_code
       WHERE i.id = $1 FOR UPDATE OF i`,
      [issueId]
    );
    if (!issueRows.length) throw new Error('Issue not found');
    const issue = issueRows[0];
    if (issue.status !== 'OPEN') throw new Error(`Issue ${issue.issue_number} is already ${issue.status}`);

    const fallbackOutputs = [
      { type: 'usable',    label: 'Usable',   suffix: 'R', status: 'IN STOCK' },
      { type: 'damaged',   label: 'Damaged',  suffix: 'D', status: 'DAMAGED' },
      { type: 'consumed',  label: 'Consumed', suffix: 'C', status: 'CONSUMED' }
    ];
    const allowedOutputs = issue.allowed_outputs && issue.allowed_outputs.length > 0 
      ? issue.allowed_outputs 
      : fallbackOutputs;

    const validTypes = allowedOutputs.map(o => o.type);
    for (const line of lines) {
      if (!validTypes.includes(line.type))
        throw new Error(`Invalid return type: '${line.type}'. Allowed: ${validTypes.join(', ')}`);
      if (!(parseFloat(line.qty) > 0))
        throw new Error(`qty must be positive for type '${line.type}'`);
    }

    const issuedQty = parseFloat(issue.issued_qty);
    const currentRemaining = issue.remaining_in_process !== null
      ? parseFloat(issue.remaining_in_process)
      : issuedQty;
    // The balance gate lives further down, after the process lot is loaded — the
    // component-conservation rule needs the input lot's weight.

    // 2. Lock and load the process lot (fallback to source lot if process lot missing)
    const targetLotId = issue.process_lot_id || issue.source_lot_id;
    const { rows: lotRows } = await client.query(
      `SELECT inv.*, i.category, i.name AS item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1 FOR UPDATE OF inv`,
      [targetLotId]
    );
    if (!lotRows.length) throw new Error('Process/Source lot not found');
    const processLot = lotRows[0];

    const isSeed     = processLot.category === 'seed';
    // Genealogy fix: a Growth Run (biscuit) is a SINGLE lifecycle record. When it
    // is returned from a downstream process (laser ops, etc.) the engine must NOT
    // clone it into a `-R1` child lot and must NOT consume the original — the
    // biscuit stays in place. (The issue side was already guarded by FIX 2; this
    // is the symmetric guard on the return side.)
    const isGrowthRun = processLot.category === 'growth_run';

    if (isGrowthRun && lines.length > 1) {
      throw new Error('Growth Run returns must use a single disposition.');
    }
    const rough      = usesWeight(processLot);
    const rate       = parseFloat(processLot.rate);
    const parentCode = (isSeed && processLot.lot_code) ? processLot.lot_code : processLot.lot_number;
    const parentLevel = isSeed ? (parseInt(processLot.split_level) || 0) : 0;
    const parentPath  = isSeed ? (processLot.genealogy_path || parentCode) : null;
    const seedLevel   = isSeed ? parentLevel + 1 : null;

    // ── Conservation model ────────────────────────────────────────────────────
    // QUANTITY mode (growth, laser, cuts — the default): every output is the same
    // physical thing as the input, so quantities sum:
    //     issued = usable + damaged + consumed + qc_hold + reprocess
    //
    // COMPONENT mode (seed_remove): the input splits into DIFFERENT components in
    // DIFFERENT units — Growth Diamond (CT) and Recovered Seed (PCS). Adding those
    // together is physically meaningless, so each component is validated on its own
    // and the input lot is wholly consumed. Weight is the only quantity genuinely
    // conserved across a component split.
    //
    // The mode is derived from the process's allowed_outputs config: any output rule
    // carrying a "component" tag opts that process into COMPONENT mode. Processes
    // without the tag keep exactly the quantity behaviour they have today.
    const isComponentMode = allowedOutputs.some(o => o.component);

    let returnTotal, remainingAfter;

    if (isComponentMode) {
      // The input is wholly transformed — nothing stays in process.
      remainingAfter = 0;
      returnTotal    = currentRemaining;

      const byComponent = {};
      for (const line of lines) {
        const rule = allowedOutputs.find(o => o.type === line.type);
        const comp = rule.component || 'primary';
        byComponent[comp] = (byComponent[comp] || 0) + parseFloat(line.qty);
      }

      // Phase A: every component group declared in config must FULLY account
      // for the input on its own — N Partial Growth Runs contain exactly N
      // seeds AND N diamonds. Components are NEVER added to one another.
      const requiredComponents = [...new Set(
        allowedOutputs.filter(o => o.component).map(o => o.component)
      )];
      for (const comp of requiredComponents) {
        const qty = byComponent[comp] || 0;
        if (Math.abs(qty - currentRemaining) > 0.0001) {
          throw new Error(
            `${comp} outputs total ${qty.toFixed(4)} but must equal the ` +
            `${currentRemaining.toFixed(4)} in process. Each component group is ` +
            'validated on its own and never summed with another.'
          );
        }
      }
      // Untagged lines (mixed configs) may still never exceed the input.
      if (byComponent.primary != null && byComponent.primary > currentRemaining + 0.0001) {
        throw new Error(
          `Untagged output (${byComponent.primary.toFixed(4)}) exceeds the ` +
          `${currentRemaining.toFixed(4)} in process.`
        );
      }

      // Mass balance: outputs may weigh LESS than the input (process loss is normal)
      // but never more. Lines with no weight entered are skipped, not assumed zero.
      const inputWeight  = parseFloat(processLot.weight || 0);
      const outputWeight = lines.reduce((s, l) => (
        s + (l.weight !== undefined && l.weight !== null && l.weight !== '' ? parseFloat(l.weight) : 0)
      ), 0);
      if (inputWeight > 0 && outputWeight > inputWeight + 0.0001) {
        throw new Error(
          `Output weight ${outputWeight.toFixed(4)} exceeds input weight ${inputWeight.toFixed(4)} — ` +
          'a component split cannot create mass.'
        );
      }
    } else {
      returnTotal    = lines.reduce((s, l) => s + parseFloat(l.qty), 0);
      remainingAfter = remainingAfterInput !== undefined
        ? parseFloat(remainingAfterInput)
        : Math.max(0, currentRemaining - returnTotal);

      // Balance gate
      if (Math.abs(returnTotal + remainingAfter - currentRemaining) > 0.0001)
        throw new Error(
          `Balance mismatch: ${returnTotal.toFixed(4)} returning + ${remainingAfter.toFixed(4)} remaining ` +
          `= ${(returnTotal + remainingAfter).toFixed(4)}, but ${currentRemaining.toFixed(4)} is available`
        );
    }

    // 3. Create lot_process_returns header (backward compat summary)
    const returnNum   = await genReturnNum(client);
    const isFinal     = remainingAfter <= 0.0001;
    const aggUsable   = lines.filter(l => l.type === 'usable').reduce((s, l) => s + parseFloat(l.qty), 0);
    const aggDamaged  = lines.filter(l => l.type === 'damaged').reduce((s, l) => s + parseFloat(l.qty), 0);
    const aggConsumed = lines.filter(l => l.type === 'consumed').reduce((s, l) => s + parseFloat(l.qty), 0);

    const { rows: [ret] } = await client.query(
      `INSERT INTO lot_process_returns
         (return_number, issue_id, return_date,
          usable_qty, damaged_qty, consumed_qty,
          remarks, created_by, is_final, remaining_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        returnNum, issueId,
        return_date || new Date().toISOString().split('T')[0],
        aggUsable, aggDamaged, aggConsumed,
        notes || null, req.user.id, isFinal, remainingAfter,
      ]
    );

    // 4. Process each return line — create child inventory lots
    const outcomes = [];
    for (const line of lines) {
      const qty        = parseFloat(line.qty);
      const outputRule = allowedOutputs.find(o => o.type === line.type);
      const suffix     = outputRule.suffix;
      const lotStatus  = outputRule.status;

      // Growth Run: no clone, no child lot. Record the return against the biscuit
      // itself so history/genealogy stay intact on the single record, then move on.
      if (isGrowthRun) {
        await client.query(
          `INSERT INTO process_return_lines (return_id, return_type, qty, lot_id, lot_code, remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ret.id, line.type, qty, processLot.id, processLot.lot_code || processLot.lot_number, line.remarks || null]
        );
        await logOp(client, processLot.id, `return_${line.type}`, 'lot_process_return', ret.id,
          0, processLot.status,
          `${line.type} return of Growth Run ${processLot.lot_number} (in place — no clone, ${returnNum})`,
          req.user.id);
        outcomes.push({ type: line.type, lot_id: processLot.id, lot_code: processLot.lot_code || processLot.lot_number, qty, status: processLot.status, in_place: true });
        continue;
      }

      // Phase 1 Engine: Support Item Category transformations
      let outItemId = processLot.item_id;
      let outUnit = processLot.unit;
      let outRough = rough;
      
      // Override from Output Rule config (e.g. 'growth_diamond')
      if (outputRule.item_category_override) {
        const { rows: ruleItemRows } = await client.query('SELECT * FROM items WHERE category = $1 ORDER BY id LIMIT 1', [outputRule.item_category_override]);
        if (ruleItemRows.length) {
          outItemId = ruleItemRows[0].id;
          outUnit = ruleItemRows[0].unit;
          outRough = ['CTS', 'g', 'mg'].includes(outUnit) || (ruleItemRows[0].category === 'rough_diamond' || ruleItemRows[0].category === 'growth_diamond');
        }
      }

      if (line.item_id) {
        const { rows: iRows } = await client.query('SELECT * FROM items WHERE id = $1', [line.item_id]);
        if (iRows.length) {
          outItemId = iRows[0].id;
          outUnit = iRows[0].unit;
          outRough = ['CTS', 'g', 'mg'].includes(outUnit) || (iRows[0].category === 'rough_diamond' || iRows[0].category === 'growth_diamond');
        }
      }

      const childCode = await nextReturnLotCode(client, processLot.id, parentCode, suffix);
      const { rows: dup } = await client.query(
        'SELECT 1 FROM inventory WHERE lot_code=$1 OR lot_number=$1', [childCode]
      );
      if (dup.length) throw new Error(`Lot code ${childCode} already exists — retry`);

      const childWeight = outRough
        ? qty
        : (parseFloat(processLot.weight || 0) > 0
          ? Math.round((qty / issuedQty) * parseFloat(processLot.weight) * 10000) / 10000
          : 0);
      const childValue    = Math.round(qty * rate * 100) / 100;
      const childGenPath  = isSeed ? `${parentPath}/${childCode}` : null;
      const childLotOpId  = await nextLotOpId(client);

      const { rows: [childLot] } = await client.query(
        `INSERT INTO inventory
           (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
            location_id, department_id, vendor_id, purchase_date,
            status, remarks, source_type,
            lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
            lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'return',
                 $16,$17,$18,'return',$19,$20,$21,$22,$23,$24,$25,'Return from Process')
         RETURNING id, lot_number, lot_code, qty, weight`,
        [
          outItemId, childCode,
          `${processLot.lot_name || parentCode} (${line.type.replace('_', ' ')})`,
          processLot.batch_no, outRough ? 1 : qty, outUnit,
          outRough ? qty : childWeight,
          rate, childValue,
          processLot.location_id, processLot.department_id, processLot.vendor_id, processLot.purchase_date,
          lotStatus, line.remarks || null,
          isSeed ? childCode : null,
          processLot.id,
          isSeed ? (processLot.root_lot_id || processLot.id) : null,
          seedLevel, childGenPath,
          childLotOpId,
          isSeed ? (processLot.dim_length ?? null) : null,
          isSeed ? (processLot.dim_depth  ?? null) : null,
          isSeed ? (processLot.dim_height ?? null) : null,
          isSeed ? (processLot.dim_unit   ?? null) : null,
        ]
      );

      await client.query(
        `INSERT INTO process_return_lines (return_id, return_type, qty, lot_id, lot_code, remarks)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ret.id, line.type, qty, childLot.id, childCode, line.remarks || null]
      );

      await logOp(client, childLot.id, `return_${line.type}`, 'lot_process_return', ret.id,
        qty, lotStatus, `${line.type} return from process (${returnNum})`, req.user.id);

      outcomes.push({ type: line.type, lot_id: childLot.id, lot_code: childCode, qty, status: lotStatus });
    }

    // RULE 3: a laser return (Edge/Outer/Block/Seed Remove/Growth Cut) may carry
    // post-cut measurements. Apply them to the SAME Growth Run row (in place — no
    // clone, no new genealogy node) and append a cycle-history entry so the
    // before/after dimensions are preserved.
    if (isGrowthRun && measurements && (
      (measurements.weight != null && measurements.weight !== '') ||
      (measurements.height != null && measurements.height !== '') ||
      (measurements.length != null && measurements.length !== '') ||
      (measurements.width  != null && measurements.width  !== '')
    )) {
      const prevHeight = processLot.dim_height;
      const prevWeight = processLot.weight;
      const updated = await applyMeasurements(client, processLot.id, {
        weight:     measurements.weight  != null && measurements.weight  !== '' ? parseFloat(measurements.weight)  : undefined,
        dim_height: measurements.height  != null && measurements.height  !== '' ? parseFloat(measurements.height)  : undefined,
        dim_length: measurements.length  != null && measurements.length  !== '' ? parseFloat(measurements.length)  : undefined,
        dim_depth:  measurements.width   != null && measurements.width    !== '' ? parseFloat(measurements.width)   : undefined,
        dim_unit:   measurements.dim_unit || processLot.dim_unit || 'mm',
        remarks:    measurements.remarks || undefined,
      });
      await recordGrowthCycle(client, {
        growthRunId:      processLot.id,
        machineProcessId: issue.machine_process_id || null,
        processType:      issue.process_type || null,
        prevHeight,
        newHeight:        updated.dim_height,
        prevWeight,
        newWeight:        updated.weight,
        dimLength:        updated.dim_length,
        dimWidth:         updated.dim_depth,
        dimUnit:          updated.dim_unit || 'mm',
        remarks:          measurements.remarks || null,
        performedBy:      req.user.id,
      });
      await logOp(client, processLot.id, 'growth_run_measured', 'lot_process_return', ret.id,
        0, processLot.status,
        `Growth Run ${processLot.lot_number} measured after ${issue.process_type || 'laser'}: ` +
          `Weight ${prevWeight ?? '—'} → ${updated.weight}; Height ${prevHeight ?? '—'} → ${updated.dim_height}${updated.dim_unit || 'mm'}`,
        req.user.id);
    }

    // 5. Update issue remaining and status
    await client.query(
      `UPDATE lot_process_issues
         SET remaining_in_process = $1, status = $2, updated_at = NOW()
       WHERE id = $3`,
      [remainingAfter, isFinal ? 'RETURNED' : 'OPEN', issueId]
    );

    // 6. If final return: consume the process lot.
    //    EXCEPTION — a Growth Run biscuit is never consumed by a return; it is a
    //    single lifecycle record that survives downstream processes in place. It
    //    is consumed only at Growth Output (roughGrowth). So for a biscuit we just
    //    log the return-complete against the unchanged row.
    if (isFinal) {
      if (!isGrowthRun) {
        await client.query(
          `UPDATE inventory SET qty=0, weight=0, total_value=0, status='CONSUMED', updated_at=NOW() WHERE id=$1`,
          [processLot.id]
        );
        await logOp(client, processLot.id, 'return_complete', 'lot_process_return', ret.id,
          -currentRemaining, 'CONSUMED', `Process return final (${returnNum})`, req.user.id);
      } else {
        const finalStatusRule = allowedOutputs.find(o => o.type === lines[0].type);
        const finalStatus = finalStatusRule ? finalStatusRule.status : 'IN STOCK';

        await client.query(
          `UPDATE inventory SET status=$1, updated_at=NOW() WHERE id=$2`,
          [finalStatus, processLot.id]
        );

        await logOp(client, processLot.id, 'return_complete', 'lot_process_return', ret.id,
          0, finalStatus,
          `Growth Run ${processLot.lot_number} returned from process in place (${returnNum}) — transitioned to ${finalStatus}`,
          req.user.id);
      }

      // Auto-complete or transition machine_process when all sibling issues are RETURNED
      if (issue.machine_process_id) {
        const { rows: [{ cnt }] } = await client.query(
          `SELECT COUNT(*) AS cnt FROM lot_process_issues
           WHERE machine_process_id = $1 AND status = 'OPEN'`,
          [issue.machine_process_id]
        );
        if (parseInt(cnt) === 0) {
          const { rows: mpRows } = await client.query(
            'SELECT mp.*, pm.completion_mode FROM machine_processes mp \
             LEFT JOIN process_master pm ON pm.process_code = mp.process_type \
             WHERE mp.id = $1 FOR UPDATE OF mp',
            [issue.machine_process_id]
          );
          if (mpRows.length && ['running', 'hold'].includes(mpRows[0].status)) {
            const mp = mpRows[0];
            const completionMode = mp.completion_mode || 'RETURN_BASED';
            const pausedMinutes = mp.status === 'hold' && mp.paused_at
              ? (Date.now() - new Date(mp.paused_at).getTime()) / 60000
              : 0;

            if (completionMode === 'OUTPUT_BASED') {
              // Seed return finished but growth output not yet posted —
              // keep process running, transition machine to awaiting_output
              await client.query(
                `UPDATE machine_processes
                   SET total_paused_minutes = total_paused_minutes + $1, paused_at=NULL
                 WHERE id=$2`,
                [pausedMinutes, mp.id]
              );
              await client.query(
                `UPDATE machines SET status='awaiting_output' WHERE id=$1`,
                [mp.machine_id]
              );
              await logMachineStatus(client, mp.machine_id, mp.status, 'awaiting_output', req.user.id,
                `All seeds returned — awaiting output entry for process ${mp.process_number}`);

              // Phase 34 (FIX 1): the Growth Run (Biscuit) was already created at
              // process START (IN PROCESS). Now that all seeds are returned and the
              // growth process is complete, advance that SINGLE biscuit to IN STOCK
              // so it becomes available for laser ops / Growth Output. We do NOT
              // create a second biscuit here — there is exactly one Growth Run row.
              // Non-GROWTH groups have no biscuit, so this is a no-op for them.
              try {
                const biscuit = await advanceGrowthRunToStock(client, mp.id);
                if (biscuit) {
                  await logOp(client, biscuit.id, 'growth_run_in_stock', 'machine_process', mp.id,
                    0, 'IN STOCK',
                    `Growth Run ${biscuit.lot_number} completed → IN STOCK (all seeds returned for process ${mp.process_number})`,
                    req.user.id);
                }
              } catch (gErr) {
                // Surface the error — a failed transition should ROLLBACK the return,
                // otherwise the biscuit is stuck IN PROCESS with no machine running it.
                throw new Error(`Failed to advance Growth Run to IN STOCK for process ${mp.process_number}: ${gErr.message}`);
              }
            } else {
              // RETURN_BASED: auto-complete the process immediately
              await client.query(
                `UPDATE machine_processes
                   SET status='completed', completed_at=NOW(),
                       total_paused_minutes = total_paused_minutes + $1, paused_at=NULL
                 WHERE id=$2`,
                [pausedMinutes, mp.id]
              );
              await client.query(`UPDATE machines SET status='idle' WHERE id=$1`, [mp.machine_id]);
              await logMachineStatus(client, mp.machine_id, mp.status, 'idle', req.user.id,
                `All lots returned — process ${mp.process_number} auto-completed`);
              
              // Real-Time: process completed
              dispatchEvent('process.completed', {
                process_number: mp.process_number, machine_process_id: mp.id,
                process_type: mp.process_type, machine_id: mp.machine_id,
                completed_by: req.user.id
              });
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({
      return_number:   returnNum,
      return_id:       ret.id,
      issue_id:        issueId,
      is_final:        isFinal,
      remaining_after: remainingAfter,
      outcomes,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;


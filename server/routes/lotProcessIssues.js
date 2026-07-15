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
              COALESCE(pm1.allowed_outputs, pm2.allowed_outputs) AS allowed_outputs,
              -- Return Workspace UI: human-readable Process Master name (the
              -- technical code stays tooltip-only) + authoritative runtime
              -- timestamps. Read-only display fields — no posting semantics.
              COALESCE(pm1.process_name, pm2.process_name) AS process_display_name,
              mp.started_at   AS process_started_at,
              mp.completed_at AS process_completed_at
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

        // Phase A (Seed Lifecycle): shared attachment guard — an attached Seed
        // (embedded in an active Partial Growth Run) is never issuable; gives a
        // clearer reason than the generic status message below.
        const attachBlock = attachmentBlockReason(lot, 'issued to a process');
        if (attachBlock) throw new Error(attachBlock);

        // Transform-in-place processes (Final Block doctrine) only accept
        // their configured input category — enforced at issue time so a
        // wrong-category lot can never enter the machine. Configuration-driven:
        // no process code or name is ever checked.
        const transformRule = Array.isArray(processRules.allowed_outputs)
          ? processRules.allowed_outputs.find(o => o && o.transform_in_place === true)
          : null;
        if (transformRule) {
          const requiredCat = transformRule.input_item_category || 'growth_diamond';
          if (lot.category !== requiredCat)
            throw new Error(
              `Process '${processRules.process_name}' transforms ${requiredCat.replace(/_/g, ' ')} ` +
              `lots in place — lot ${lot.lot_number} is '${lot.category}'.`
            );
        }
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

        // Phase A (Seed Lifecycle): a Seed process lot entering a GROWTH
        // chamber is physically embedded in the Partial Growth Run — mark it
        // ATTACHED_TO_GROWTH (covers both the in-place full issue and the
        // partial-split child). The biscuit itself (Growth Again) is NOT a
        // seed attachment. The source-lot remainder stays NULL (AVAILABLE).
        // Requires phase62 — deploy coupling documented in the migration.
        if (isGrowthGroup && !isGrowthRun) {
          await client.query(
            `UPDATE inventory SET manufacturing_state = 'ATTACHED_TO_GROWTH', updated_at = NOW()
             WHERE id = $1`,
            [childLot.id]
          );
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

/**
 * Canonical Rough item resolution — the SAME lookup/auto-create rule the
 * legacy Growth Output uses (routes/roughGrowth.js), so both rough-creation
 * paths always land on one item record. Called inside a transaction.
 */
async function ensureRoughItem(client) {
  const r = await client.query(
    "SELECT id, default_uom AS unit FROM items WHERE category = 'rough' AND status = 'active'"
  );
  if (r.rows.length === 0) {
    throw new Error('Canonical rough item not found — cannot process rough output.');
  }
  if (r.rows.length > 1) {
    throw new Error(`Multiple active canonical rough items found (${r.rows.length}) — database ambiguous.`);
  }
  return r.rows[0];
}

// Growth-identity routing, shared return plan + reversal eligibility — pure
// helpers, unit-tested in tests/growthReturnRouting.test.js.
// buildReturnPlan is used by BOTH the read-only preflight below and the
// locked posting transaction (recomputed there — preflight is never trusted).
const {
  resolveAllowedOutputs, buildReturnPlan, reversalBlockReason,
} = require('../services/returnRouting');
// Phase A (Seed Lifecycle): shared attachment rule — see services/manufacturingState.js
const { attachmentBlockReason } = require('../services/manufacturingState');

// ── RETURN PREFLIGHT (read-only) ──────────────────────────────────────────────
// POST /:id/return/validate — authoritative Return Plan with ZERO database
// writes (SELECTs only, no locks, no transaction). Same auth as the actual
// return. Resolves the biscuit itself — it does not depend on the detail
// API's growth_number field. The posting endpoint re-resolves everything
// under FOR UPDATE; this response is display-only.
router.post('/:id/return/validate', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const issueId = parseInt(req.params.id);
  // remaining_in_process from the client is intentionally IGNORED — the
  // projected remaining is always server-calculated inside buildReturnPlan.
  const { lines, measurements } = req.body || {};
  try {
    const { rows: issueRows } = await pool.query(
      `SELECT i.*, COALESCE(p1.allowed_outputs, p2.allowed_outputs) AS allowed_outputs,
              COALESCE(p1.process_group, p2.process_group) AS process_group
       FROM lot_process_issues i
       LEFT JOIN machine_processes mp ON i.machine_process_id = mp.id
       LEFT JOIN process_master p1 ON mp.process_type = p1.process_code
       LEFT JOIN process_master p2 ON i.process_type = p2.process_code
       WHERE i.id = $1`,
      [issueId]
    );
    if (!issueRows.length)
      return res.json({ valid: false, route: 'REJECT', error: 'Issue not found' });
    const issue = issueRows[0];
    const allowedOutputs = resolveAllowedOutputs(issue.allowed_outputs);

    const targetLotId = issue.process_lot_id || issue.source_lot_id;
    const { rows: lotRows } = await pool.query(
      `SELECT inv.*, i.category, i.name AS item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1`,
      [targetLotId]
    );
    const processLot = lotRows[0] || null;

    const isGrowthGroupIssue =
      String(issue.process_group || (issue.process_type === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase() === 'GROWTH';
    const isGrowthRunInput = !!processLot && processLot.category === 'growth_run';
    let biscuit = null;
    let biscuitCandidateCount = 0;
    if (isGrowthGroupIssue && !isGrowthRunInput && issue.machine_process_id) {
      // ALL candidates — never silently pick one row. 0 → missing-biscuit
      // REJECT; >1 → identity-conflict REJECT (both inside buildReturnPlan).
      const { rows: bRows } = await pool.query(
        `SELECT inv.* FROM inventory inv
         WHERE inv.machine_process_id = $1
           AND inv.item_id IN (SELECT id FROM items WHERE category = 'growth_run')`,
        [issue.machine_process_id]
      );
      biscuitCandidateCount = bRows.length;
      biscuit = bRows.length === 1 ? bRows[0] : null;
    }

    // Phase C: read-only attached-Seed resolution for the preflight — the
    // same relational chain the posting transaction re-resolves under
    // FOR UPDATE, so the UI sees the exact block reasons before submitting.
    let attachedSeedCtx = null;
    if (isGrowthRunInput && allowedOutputs.some(o => o.component)) {
      const { rows: seedRows } = await pool.query(
        `SELECT s.id, s.root_lot_id, s.weight, s.total_value FROM inventory s
         WHERE s.manufacturing_state = 'ATTACHED_TO_GROWTH'
           AND s.status = 'IN PROCESS'
           AND s.id IN (
             SELECT gi.process_lot_id FROM lot_process_issues gi
             WHERE gi.status = 'RETURNED'
               AND gi.machine_process_id IN (
                 SELECT grc.machine_process_id FROM growth_run_cycles grc
                 WHERE grc.growth_run_id = $1 AND grc.machine_process_id IS NOT NULL
                 UNION
                 SELECT ol.reference_id FROM lot_op_log ol
                 WHERE ol.lot_id = $1 AND ol.reference_type = 'machine_process'
                   AND ol.operation IN ('growth_run_created','growth_again')
               )
           )`,
        [targetLotId]
      );
      const seedRoots = [...new Set(seedRows.map(r => r.root_lot_id || r.id))];
      attachedSeedCtx = {
        resolved: seedRows.length > 0,
        candidateCount: seedRows.length,
        rootCount: seedRoots.length,
        rootLotId: seedRoots.length === 1 ? seedRoots[0] : null,
        // Authoritative single attached-Seed identity for the in-place detach
        // (null when missing/ambiguous → planner rejects the detach).
        inventoryId: seedRows.length === 1 ? seedRows[0].id : null,
        refWeight: seedRows.reduce((s, r) => s + parseFloat(r.weight || 0), 0),
        refValue:  seedRows.reduce((s, r) => s + parseFloat(r.total_value || 0), 0),
      };
    }

    let openSiblingCount = 0;
    if (issue.machine_process_id) {
      const { rows: [s] } = await pool.query(
        `SELECT COUNT(*)::int AS open_siblings FROM lot_process_issues
         WHERE machine_process_id = $1 AND status = 'OPEN' AND id <> $2`,
        [issue.machine_process_id, issueId]
      );
      openSiblingCount = s.open_siblings;
    }

    const plan = buildReturnPlan({
      issue, processLot, biscuit, allowedOutputs, lines,
      measurements, openSiblingCount, biscuitCandidateCount,
      attachedSeed: attachedSeedCtx,
    });
    if (!plan.valid) return res.json(plan);

    // Per-line projected identities. CHILD codes are best-effort previews of
    // nextReturnLotCode — the posting transaction regenerates them under lock.
    const parentCode = (processLot.category === 'seed' && processLot.lot_code)
      ? processLot.lot_code : processLot.lot_number;
    const lineIdentities = [];
    const counters = {}; // suffix → last projected sequence number
    for (const line of lines) {
      // Both in-place routes resolve to the EXISTING lot — no code generation.
      if (plan.route === 'BISCUIT' || plan.route === 'TRANSFORM_IN_PLACE') {
        lineIdentities.push({ type: line.type, lot_code: plan.target_lot_code, will_create_new_lot: false });
        continue;
      }
      const rule = allowedOutputs.find(o => o.type === line.type);
      const suffix = rule && rule.suffix;
      if (!suffix) {
        lineIdentities.push({ type: line.type, lot_code: null, will_create_new_lot: true });
        continue;
      }
      if (counters[suffix] == null) {
        const first = await nextReturnLotCode(pool, processLot.id, parentCode, suffix);
        counters[suffix] = parseInt(first.slice(`${parentCode}-${suffix}`.length), 10);
        lineIdentities.push({ type: line.type, lot_code: first, will_create_new_lot: true });
      } else {
        counters[suffix] += 1;
        lineIdentities.push({ type: line.type, lot_code: `${parentCode}-${suffix}${counters[suffix]}`, will_create_new_lot: true });
      }
    }
    const generatedChild = lineIdentities.find(li => li.will_create_new_lot && li.lot_code);

    return res.json({
      ...plan,
      line_identities: lineIdentities,
      generated_child_code: generatedChild ? generatedChild.lot_code : null,
    });
  } catch (err) {
    return res.status(400).json({ valid: false, route: 'REJECT', error: err.message });
  }
});

// ── CREATE RETURN ──────────────────────────────────────────────────────────────
// Accepts multi-line returns, partial returns, and five return types.
// Body: { return_date, notes, lines: [{type, qty, remarks}], remaining_in_process? }
//
// Balance rule: sum(lines.qty) + remaining_after = current remaining_in_process
// If remaining_after = 0 → issue marked RETURNED, machine_process auto-completed
//   if all sibling issues are also RETURNED.
router.post('/:id/return', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const issueId = parseInt(req.params.id);
  // remaining_in_process from the client is intentionally IGNORED — the
  // projected remaining is always recomputed from the LOCKED issue row
  // inside buildReturnPlan (server-calculated, decimal-safe).
  const { return_date, notes, lines, measurements } = req.body;

  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: 'At least one return line is required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the issue
    const { rows: issueRows } = await client.query(
      `SELECT i.*, COALESCE(p1.allowed_outputs, p2.allowed_outputs) AS allowed_outputs,
              COALESCE(p1.process_group, p2.process_group) AS process_group
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

    const allowedOutputs = resolveAllowedOutputs(issue.allowed_outputs);

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

    // Phase C: COMPONENT mode (Seed Remove) legitimately posts multiple lines
    // against a biscuit input — the single-disposition rule is QUANTITY-only.
    const isComponentReturn = allowedOutputs.some(o => o.component);
    if (isGrowthRun && !isComponentReturn && lines.length > 1) {
      throw new Error('Growth Run returns must use a single disposition.');
    }

    // ── Growth biscuit resolution ─────────────────────────────────────────────
    // For a GROWTH-group issue the biscuit created at Start Process IS the
    // authoritative growth identity (permanent Growth Number + run_no). Lock it
    // so the usable output can reference it instead of minting a child lot.
    // Skipped when the process lot itself is the biscuit (laser ops in-place
    // path above) and for non-growth processes (incl. seed_remove/COMPONENT).
    const isGrowthGroupIssue =
      String(issue.process_group || (issue.process_type === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase() === 'GROWTH';
    let biscuit = null;
    let biscuitCandidateCount = 0;
    if (isGrowthGroupIssue && !isGrowthRun && issue.machine_process_id) {
      // Lock ALL candidate biscuit rows FIRST, then count — never silently
      // pick one row when multiple Growth biscuits exist (identity conflict
      // → buildReturnPlan REJECTs; 0 candidates → missing-biscuit REJECT).
      const { rows: bRows } = await client.query(
        `SELECT inv.* FROM inventory inv
         WHERE inv.machine_process_id = $1
           AND inv.item_id IN (SELECT id FROM items WHERE category = 'growth_run')
         FOR UPDATE OF inv`,
        [issue.machine_process_id]
      );
      biscuitCandidateCount = bRows.length;
      biscuit = bRows.length === 1 ? bRows[0] : null;
    }

    const rough      = usesWeight(processLot);
    const rate       = parseFloat(processLot.rate);
    const parentCode = (isSeed && processLot.lot_code) ? processLot.lot_code : processLot.lot_number;
    const parentLevel = isSeed ? (parseInt(processLot.split_level) || 0) : 0;
    const parentPath  = isSeed ? (processLot.genealogy_path || parentCode) : null;
    const seedLevel   = isSeed ? parentLevel + 1 : null;

    // ── Phase C: authoritative attached-Seed resolution (Seed Remove) ────────
    // Direct relational chain preferred: this biscuit's growth machine
    // processes (relational growth_run_cycles rows; the biscuit's op-log
    // growth references serve only as supporting disambiguation) → their
    // COMPLETED growth issues (status RETURNED — a reversed growth return
    // reopens the issue and drops out) → the issues' process lots that are
    // still physically embedded: manufacturing_state = ATTACHED_TO_GROWTH
    // AND status = IN PROCESS. ALL candidates are locked. The planner blocks
    // on 0 candidates and on multiple distinct Seed roots — no fallback
    // pricing, no guessed genealogy, no root collapsing.
    let attachedSeeds = [];
    let attachedSeedCtx = null;
    if (isGrowthRun && isComponentReturn) {
      const { rows: seedRows } = await client.query(
        `SELECT s.* FROM inventory s
         WHERE s.manufacturing_state = 'ATTACHED_TO_GROWTH'
           AND s.status = 'IN PROCESS'
           AND s.id IN (
             SELECT gi.process_lot_id FROM lot_process_issues gi
             WHERE gi.status = 'RETURNED'
               AND gi.machine_process_id IN (
                 SELECT grc.machine_process_id FROM growth_run_cycles grc
                 WHERE grc.growth_run_id = $1 AND grc.machine_process_id IS NOT NULL
                 UNION
                 SELECT ol.reference_id FROM lot_op_log ol
                 WHERE ol.lot_id = $1 AND ol.reference_type = 'machine_process'
                   AND ol.operation IN ('growth_run_created','growth_again')
               )
           )
         ORDER BY s.id
         FOR UPDATE OF s`,
        [processLot.id]
      );
      attachedSeeds = seedRows;
      const seedRoots = [...new Set(attachedSeeds.map(r => r.root_lot_id || r.id))];
      attachedSeedCtx = {
        resolved: attachedSeeds.length > 0,
        candidateCount: attachedSeeds.length,
        rootCount: seedRoots.length,
        rootLotId: seedRoots.length === 1 ? seedRoots[0] : null,
        inventoryId: attachedSeeds.length === 1 ? attachedSeeds[0].id : null,
        refWeight: attachedSeeds.reduce((s, r) => s + parseFloat(r.weight || 0), 0),
        refValue:  attachedSeeds.reduce((s, r) => s + parseFloat(r.total_value || 0), 0),
      };
    }
    // Allocation cursor: plan.component_allocation is index-aligned with the
    // request lines, and every Seed Remove line flows through the CHILD block
    // below in order.
    let componentAllocCursor = 0;

    // ── Authoritative return plan ─────────────────────────────────────────────
    // buildReturnPlan is the SAME pure resolver the read-only preflight
    // (POST /:id/return/validate) uses. It is recomputed HERE from the LOCKED
    // row images — a previously returned preflight plan is never trusted.
    // It enforces the conservation gates (QUANTITY + COMPONENT modes), the
    // growth-identity route (BISCUIT / CHILD / REJECT), the missing-biscuit
    // rejection, the GROWTH usable-output configuration-integrity rule, and
    // (Phase C) the Seed Remove weight/value safety gates.
    let openSiblingCount = 0;
    if (issue.machine_process_id) {
      const { rows: [s] } = await client.query(
        `SELECT COUNT(*)::int AS open_siblings FROM lot_process_issues
         WHERE machine_process_id = $1 AND status = 'OPEN' AND id <> $2`,
        [issue.machine_process_id, issueId]
      );
      openSiblingCount = s.open_siblings;
    }
    const plan = buildReturnPlan({
      issue, processLot, biscuit, allowedOutputs, lines,
      measurements, openSiblingCount, biscuitCandidateCount,
      attachedSeed: attachedSeedCtx,
    });
    if (!plan.valid) throw new Error(plan.error);
    const remainingAfter = plan.remaining_after;
    // The in-place biscuit-input path (growth again / laser ops) keeps its
    // dedicated branch in the line loop below; routesToBiscuit is ONLY the
    // full usable Growth Return that references the existing biscuit.
    const routesToBiscuit = plan.route === 'BISCUIT' && !plan.growth_run_input;
    // Growth Diamond → Rough Diamond in-place transformation (config-driven,
    // planner-approved): the SAME row changes category/weight/dims — no child
    // lot, no consumption, identity and genealogy untouched.
    const isTransformReturn = plan.route === 'TRANSFORM_IN_PLACE';
    // Seed Remove ASYMMETRIC DETACH: transform the Growth carrier row in place
    // and release the SAME attached Seed row — no child inventory identities.
    const isDetachTransform = plan.route === 'DETACH_TRANSFORM';

    // Phase C: attached-Seed resolution and locking happen BEFORE the plan is
    // computed (see above) — the plan itself validates the attachment context,
    // the mandatory operator weights, the physical weight balance and the
    // two-pool carrying-value allocation. No fallback path exists here.

    // 3. Create lot_process_returns header (backward compat summary)
    const returnNum   = await genReturnNum(client);
    const isFinal     = remainingAfter <= 0.0001;
    const aggUsable   = lines.filter(l => l.type === 'usable').reduce((s, l) => s + parseFloat(l.qty), 0);
    const aggDamaged  = lines.filter(l => l.type === 'damaged').reduce((s, l) => s + parseFloat(l.qty), 0);
    const aggConsumed = lines.filter(l => l.type === 'consumed').reduce((s, l) => s + parseFloat(l.qty), 0);

    // Immutable pre-return snapshot (phase60) enabling the admin-only reversal
    // of a full usable Growth Return. Captured from the LOCKED pre-images —
    // growth_run_cycles alone cannot restore length/width or the consumed seed
    // process lot. NULL for every other return type.
    let preState = null;
    if (routesToBiscuit) {
      let mpSnap = null;
      let machSnap = null;
      if (issue.machine_process_id) {
        const { rows } = await client.query(
          `SELECT status, total_paused_minutes, paused_at, completed_at FROM machine_processes WHERE id = $1 FOR UPDATE`,
          [issue.machine_process_id]
        );
        mpSnap = rows[0] || null;
      }
      if (issue.machine_id) {
        const { rows } = await client.query(
          `SELECT status FROM machines WHERE id = $1 FOR UPDATE`,
          [issue.machine_id]
        );
        machSnap = rows[0] || null;
      }

      preState = {
        version: 2,
        route: 'BISCUIT',
        process_lot: {
          id: processLot.id, qty: processLot.qty, weight: processLot.weight,
          total_value: processLot.total_value, status: processLot.status,
        },
        biscuit: {
          id: biscuit.id, lot_number: biscuit.lot_number, status: biscuit.status,
          run_no: biscuit.run_no, machine_process_id: biscuit.machine_process_id,
          weight: biscuit.weight, dim_length: biscuit.dim_length,
          dim_depth: biscuit.dim_depth, dim_height: biscuit.dim_height,
          dim_unit: biscuit.dim_unit,
        },
        issue: {
          id: issue.id,
          remaining_in_process: issue.remaining_in_process,
          status: issue.status,
        }
      };

      if (mpSnap) {
        preState.machine_process = {
          id: issue.machine_process_id,
          status: mpSnap.status,
          total_paused_minutes: mpSnap.total_paused_minutes,
          paused_at: mpSnap.paused_at,
          completed_at: mpSnap.completed_at,
        };
      }
      if (machSnap) {
        preState.machine = {
          id: issue.machine_id,
          status: machSnap.status
        };
      }
    } else if (isTransformReturn) {
      // Immutable FINAL_BLOCK snapshot — complete before-image of the in-place
      // category transformation. reversal_supported:false keeps the History
      // Cancel/Reverse actions disabled (policy-driven eligibility): snapshot
      // presence alone must never enable cancellation.
      let parentSnap = null;
      if (processLot.parent_lot_id) {
        const { rows } = await client.query(
          'SELECT id, lot_number, run_no FROM inventory WHERE id = $1',
          [processLot.parent_lot_id]
        );
        parentSnap = rows[0] || null;
      }
      let mpSnap = null;
      if (issue.machine_process_id) {
        const { rows } = await client.query(
          'SELECT status, total_paused_minutes, paused_at, completed_at FROM machine_processes WHERE id = $1 FOR UPDATE',
          [issue.machine_process_id]
        );
        mpSnap = rows[0] || null;
      }
      preState = {
        snapshot_type: 'FINAL_BLOCK',
        version: 1,
        reversal_supported: false,
        route: 'TRANSFORM_IN_PLACE',
        category_transition: plan.category_transition,
        // Growth lineage context: the diamond's parent IS the Growth Run
        // biscuit (its lot_number is the permanent Growth Number).
        growth_number: parentSnap ? parentSnap.lot_number : null,
        run_no: parentSnap && parentSnap.run_no != null ? parseInt(parentSnap.run_no) : null,
        inventory_pre: {
          id: processLot.id, lot_number: processLot.lot_number,
          lot_code: processLot.lot_code, item_id: processLot.item_id,
          qty: processLot.qty, weight: processLot.weight,
          rate: processLot.rate, total_value: processLot.total_value,
          status: processLot.status,
          dim_length: processLot.dim_length, dim_depth: processLot.dim_depth,
          dim_height: processLot.dim_height, dim_unit: processLot.dim_unit,
          parent_lot_id: processLot.parent_lot_id, root_lot_id: processLot.root_lot_id,
          manufacturing_state: processLot.manufacturing_state,
        },
        issue_pre: {
          id: issue.id, status: issue.status,
          remaining_in_process: issue.remaining_in_process,
        },
        machine_process_pre: mpSnap
          ? { id: issue.machine_process_id, status: mpSnap.status,
              total_paused_minutes: mpSnap.total_paused_minutes,
              paused_at: mpSnap.paused_at, completed_at: mpSnap.completed_at }
          : null,
        weight_equation: {
          input: plan.input_weight,
          output: plan.output_weight,
          loss: plan.process_loss_weight,
        },
        carrying_value_policy: 'PRESERVE',
      };
    }

    const { rows: [ret] } = await client.query(
      `INSERT INTO lot_process_returns
         (return_number, issue_id, return_date,
          usable_qty, damaged_qty, consumed_qty,
          remarks, created_by, is_final, remaining_after, pre_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        returnNum, issueId,
        return_date || new Date().toISOString().split('T')[0],
        aggUsable, aggDamaged, aggConsumed,
        notes || null, req.user.id, isFinal, remainingAfter,
        preState ? JSON.stringify(preState) : null,
      ]
    );

    // 4. Process each return line — create child inventory lots
    const outcomes = [];
    for (const line of lines) {
      const qty        = parseFloat(line.qty);
      const outputRule = allowedOutputs.find(o => o.type === line.type);
      const suffix     = outputRule.suffix;
      const lotStatus  = outputRule.status;

      // Seed Remove in-place detach: record each family line against its EXISTING
      // target identity (carrier for diamond, attached Seed for seed) — never a
      // child lot. The actual in-place row transforms happen in the isFinal block.
      if (isDetachTransform) {
        const isSeedFam  = outputRule.component === 'seed';
        const targetId   = isSeedFam ? plan.attached_seed_inventory_id : plan.growth_carrier_inventory_id;
        const targetCode = isSeedFam
          ? (attachedSeeds[0] ? (attachedSeeds[0].lot_code || attachedSeeds[0].lot_number) : null)
          : (processLot.lot_code || processLot.lot_number);
        await client.query(
          `INSERT INTO process_return_lines (return_id, return_type, qty, lot_id, lot_code, remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ret.id, line.type, qty, targetId, targetCode, line.remarks || null]
        );
        outcomes.push({ type: line.type, lot_id: targetId, lot_code: targetCode, qty,
          weight: parseFloat(line.weight) || 0, status: outputRule.status, in_place: true });
        continue;
      }

      // Growth Run: no clone, no child lot. Record the return against the biscuit
      // itself so history/genealogy stay intact on the single record, then move on.
      // Phase C: NOT for COMPONENT returns (Seed Remove) — those split the
      // assembly into diamond + recovered-seed CHILD lots below.
      if (isGrowthRun && !isComponentReturn) {
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

      // Growth identity rule: the usable output of a full all-usable GROWTH
      // return references the EXISTING biscuit (permanent Growth Number,
      // run_no untouched). No nextReturnLotCode, no inventory INSERT — the
      // biscuit's status advances via the existing completion flow
      // (OUTPUT_BASED → advanceGrowthRunToStock).
      if (routesToBiscuit) {
        await client.query(
          `INSERT INTO process_return_lines (return_id, return_type, qty, lot_id, lot_code, remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ret.id, line.type, qty, biscuit.id, biscuit.lot_code || biscuit.lot_number, line.remarks || null]
        );
        await logOp(client, biscuit.id, `return_${line.type}`, 'lot_process_return', ret.id,
          0, biscuit.status,
          `Usable growth return recorded against Growth Run ${biscuit.lot_number} (existing identity — no child lot, ${returnNum})`,
          req.user.id);
        outcomes.push({
          type: line.type, lot_id: biscuit.id,
          lot_code: biscuit.lot_code || biscuit.lot_number, qty,
          weight: biscuit.weight != null ? parseFloat(biscuit.weight) : null,
          status: biscuit.status, in_place: true,
          growth_number: biscuit.lot_number, run_no: biscuit.run_no,
        });
        continue;
      }

      // Growth Diamond → Rough Diamond: in-place transformation of the SAME
      // inventory row. item_id moves to the canonical Rough item; the
      // operator-measured output weight and dimensions are stored; id,
      // lot_number, qty, rate, total_value, parent_lot_id, root_lot_id and
      // genealogy_path are all untouched. No -R1, no child lot, no consume.
      // The planner has already enforced: single usable line, full remaining
      // quantity, growth_diamond source, rough target, weight ≤ input.
      if (isTransformReturn) {
        const roughItem = await ensureRoughItem(client);
        const outputWeight = parseFloat(line.weight);
        await client.query(
          `UPDATE inventory
             SET item_id    = $1,
                 unit       = $2,
                 weight     = $3,
                 dim_length = COALESCE($4, dim_length),
                 dim_depth  = COALESCE($5, dim_depth),
                 dim_height = COALESCE($6, dim_height),
                 dim_unit   = COALESCE($7, dim_unit),
                 updated_at = NOW()
           WHERE id = $8`,
          [
            roughItem.id,
            roughItem.unit,
            outputWeight,
            measurements && measurements.length != null && measurements.length !== '' ? parseFloat(measurements.length) : null,
            measurements && measurements.width  != null && measurements.width  !== '' ? parseFloat(measurements.width)  : null,
            measurements && measurements.height != null && measurements.height !== '' ? parseFloat(measurements.height) : null,
            measurements && measurements.dim_unit ? measurements.dim_unit : null,
            processLot.id,
          ]
        );
        await client.query(
          `INSERT INTO process_return_lines (return_id, return_type, qty, lot_id, lot_code, remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ret.id, line.type, qty, processLot.id, processLot.lot_code || processLot.lot_number, line.remarks || null]
        );
        await logOp(client, processLot.id, 'final_block_transform', 'lot_process_return', ret.id,
          0, plan.projected_inventory_status || 'IN STOCK',
          `Final Block transform (${returnNum}): ${processLot.lot_number} reclassified ` +
          `${plan.category_transition.before} → ${plan.category_transition.after} in place ` +
          `(same identity, no new lot); weight ${plan.input_weight.toFixed(4)} → ` +
          `${plan.output_weight.toFixed(4)} ct, process loss ${plan.process_loss_weight.toFixed(4)} ct; ` +
          `carrying value preserved`,
          req.user.id);
        outcomes.push({
          type: line.type, lot_id: processLot.id,
          lot_code: processLot.lot_code || processLot.lot_number, qty,
          weight: outputWeight, status: plan.projected_inventory_status || 'IN STOCK',
          in_place: true, transformed: true,
          category_transition: plan.category_transition,
        });
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
          outUnit = ruleItemRows[0].default_uom;
          outRough = ['CTS', 'g', 'mg'].includes(outUnit) || (ruleItemRows[0].category === 'rough_diamond' || ruleItemRows[0].category === 'growth_diamond');
        }
      }

      if (line.item_id) {
        const { rows: iRows } = await client.query('SELECT * FROM items WHERE id = $1', [line.item_id]);
        if (iRows.length) {
          outItemId = iRows[0].id;
          outUnit = iRows[0].default_uom;
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

      // Phase C: Seed Remove children — authoritative values, never derived.
      //   weight = operator-entered line weight EXACTLY (biscuit.weight is the
      //            full assembly incl. the embedded seed, so proportional
      //            derivation would double-count across the two families);
      //   value  = planner's deterministic two-pool allocation (biscuit
      //            carrying cost → diamond family, attached-Seed carrying
      //            cost → seed family, residue on each family's last line);
      //   seed-family rows additionally carry the EXACT original Seed root
      //   (single root guaranteed by the planner — never the biscuit's own
      //   root as a guess) and RECOVERED state for BOTH dispositions —
      //   recovered rows are disposition containers, never new Seed roots.
      if (isGrowthRun && isComponentReturn) {
        const alloc = plan.component_allocation
          ? plan.component_allocation[componentAllocCursor++]
          : null;
        const lineWeight = parseFloat(line.weight) || 0;
        const lineValue  = alloc ? alloc.value : 0;
        const lineRate   = qty > 0 ? Math.round((lineValue / qty) * 10000) / 10000 : 0;
        if (outputRule.component === 'seed') {
          await client.query(
            `UPDATE inventory
               SET rate=$1, total_value=$2, weight=$3, root_lot_id=$4,
                   manufacturing_state='RECOVERED', updated_at=NOW()
             WHERE id=$5`,
            [lineRate, lineValue, lineWeight, attachedSeedCtx.rootLotId, childLot.id]
          );
        } else {
          await client.query(
            `UPDATE inventory
               SET rate=$1, total_value=$2, weight=$3, updated_at=NOW()
             WHERE id=$4`,
            [lineRate, lineValue, lineWeight, childLot.id]
          );
        }
      }

      outcomes.push({ type: line.type, lot_id: childLot.id, lot_code: childCode, qty, status: lotStatus });
    }

    // RULE 3: a laser return (Edge/Outer/Block/Seed Remove/Growth Cut) may carry
    // post-cut measurements. Apply them to the SAME Growth Run row (in place — no
    // clone, no new genealogy node) and append a cycle-history entry so the
    // before/after dimensions are preserved.
    // ── Phase C item 10: immutable SEED_REMOVE posting snapshot ──────────────
    // Stored in the EXISTING pre_state JSONB — no new migration required.
    // reversal_supported:false + policy-driven eligibility: reversalBlockReason
    // accepts only route='BISCUIT' snapshots, and the history `reversible`
    // flag additionally requires reversal_supported ≠ 'false'. Seed Remove
    // cancellation therefore stays DISABLED — snapshot presence alone never
    // enables Cancel.
    if (isGrowthRun && isComponentReturn) {
      const snapshot = {
        snapshot_type: 'SEED_REMOVE',
        version: 1,
        reversal_supported: false,
        growth_number: processLot.lot_number,
        run_no: processLot.run_no != null ? parseInt(processLot.run_no) : null,
        issue_pre: {
          id: issue.id, status: issue.status,
          remaining_in_process: issue.remaining_in_process,
        },
        biscuit_pre: {
          id: processLot.id, qty: processLot.qty, weight: processLot.weight,
          total_value: processLot.total_value, status: processLot.status,
          root_lot_id: processLot.root_lot_id,
        },
        attached_seeds_pre: attachedSeeds.map(s => ({
          id: s.id, lot_code: s.lot_code || s.lot_number, qty: s.qty,
          weight: s.weight, total_value: s.total_value, root_lot_id: s.root_lot_id,
          status: s.status, manufacturing_state: s.manufacturing_state,
        })),
        value_pools: plan.value_pools,
        weight_equation: plan.component_weight,
        quantity_equation: { input: currentRemaining },
        outputs: outcomes.map(o => ({ id: o.lot_id, lot_code: o.lot_code, type: o.type, qty: o.qty })),
        genealogy: { parent_lot_id: processLot.id, seed_root_lot_id: attachedSeedCtx.rootLotId },
      };
      await client.query(
        `UPDATE lot_process_returns SET pre_state = $1 WHERE id = $2`,
        [JSON.stringify(snapshot), ret.id]
      );
    }

    // Phase C: never measure the biscuit on a COMPONENT return — it was just
    // consumed by the Seed Remove split.
    const measureTarget = (isGrowthRun && !isComponentReturn)
      ? processLot
      : (routesToBiscuit ? biscuit : null);
    if (measureTarget && measurements && (
      (measurements.weight != null && measurements.weight !== '') ||
      (measurements.height != null && measurements.height !== '') ||
      (measurements.length != null && measurements.length !== '') ||
      (measurements.width  != null && measurements.width  !== '')
    )) {
      const prevHeight = measureTarget.dim_height;
      const prevWeight = measureTarget.weight;
      const updated = await applyMeasurements(client, measureTarget.id, {
        weight:     measurements.weight  != null && measurements.weight  !== '' ? parseFloat(measurements.weight)  : undefined,
        dim_height: measurements.height  != null && measurements.height  !== '' ? parseFloat(measurements.height)  : undefined,
        dim_length: measurements.length  != null && measurements.length  !== '' ? parseFloat(measurements.length)  : undefined,
        dim_depth:  measurements.width   != null && measurements.width    !== '' ? parseFloat(measurements.width)   : undefined,
        dim_unit:   measurements.dim_unit || measureTarget.dim_unit || 'mm',
        remarks:    measurements.remarks || undefined,
      });
      await recordGrowthCycle(client, {
        growthRunId:      measureTarget.id,
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
      await logOp(client, measureTarget.id, 'growth_run_measured', 'lot_process_return', ret.id,
        0, measureTarget.status,
        `Growth Run ${measureTarget.lot_number} measured after ${issue.process_type || 'laser'}: ` +
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
    //    EXCEPTION 1 — a Growth Run biscuit is never consumed by a return; it is
    //    a single lifecycle record that survives downstream processes in place.
    //    It is consumed only at Growth Output (roughGrowth). So for a biscuit we
    //    just log the return-complete against the unchanged row.
    //    EXCEPTION 2 (Phase B, Seed Lifecycle) — the full usable Growth Return
    //    (BISCUIT route) returns the Growth ASSEMBLY; the Seed inside it is
    //    NEVER consumed. The Seed process lot keeps its qty, weight and its own
    //    carrying value (approved valuation: the biscuit carries growth value
    //    only; assembly value = biscuit value + attached Seed value) and stays
    //    IN PROCESS + ATTACHED_TO_GROWTH until Seed Remove (Phase C).
    if (isFinal) {
      if (routesToBiscuit) {
        await client.query(
          `UPDATE inventory
             SET status='IN PROCESS', manufacturing_state='ATTACHED_TO_GROWTH', updated_at=NOW()
           WHERE id=$1`,
          [processLot.id]
        );
        await logOp(client, processLot.id, 'return_complete', 'lot_process_return', ret.id,
          0, 'IN PROCESS',
          `Growth return final (${returnNum}) — Seed stays ATTACHED_TO_GROWTH inside Growth Run ${biscuit.lot_number} until Seed Remove (qty/weight/value retained)`,
          req.user.id);
      } else if (isDetachTransform) {
        // Seed Remove ASYMMETRIC DETACH — transform the Growth carrier row in
        // place (growth_run → growth_diamond) and release the SAME attached Seed
        // row. No child inventory identities; both existing IDs are preserved.
        const ct = plan.carrier_target;
        const st = plan.seed_target;
        // Revalidate authoritative targets against the LOCKED row images.
        if (!ct || !st || ct.inventory_id !== processLot.id)
          throw new Error('Seed Remove detach: Growth carrier identity changed under lock — aborting.');
        const seedRow = attachedSeeds.find(s => s.id === st.inventory_id);
        if (!seedRow)
          throw new Error('Seed Remove detach: attached Seed identity changed under lock — aborting.');
        const { rows: gdItem } = await client.query(
          "SELECT id, default_uom AS unit FROM items WHERE category = 'growth_diamond' AND status = 'active'"
        );
        if (gdItem.length === 0)
          throw new Error('Canonical growth_diamond item not found — cannot transform Growth carrier.');
        if (gdItem.length > 1)
          throw new Error(`Multiple active canonical growth_diamond items found (${gdItem.length}) — database ambiguous.`);

        // Growth carrier: SAME row → growth_diamond, IN STOCK. Value conserved
        // (keeps its own growth pool); qty is the ACTUAL returned Growth qty
        // (never forced to 1); unit stays the carrier's canonical PCS unit.
        const carrierValue = parseFloat(processLot.total_value) || 0;
        const carrierRate  = ct.qty > 0 ? Math.round((carrierValue / ct.qty) * 10000) / 10000 : parseFloat(processLot.rate || 0);
        await client.query(
          `UPDATE inventory
             SET item_id = $1, unit = $2, status = $3, qty = $4, weight = $5,
                 dim_length = COALESCE($6, dim_length),
                 dim_depth  = COALESCE($7, dim_depth),
                 dim_height = COALESCE($8, dim_height),
                 dim_unit   = COALESCE($9, dim_unit),
                 rate = $10, total_value = $11,
                 manufacturing_state = 'AVAILABLE', updated_at = NOW()
           WHERE id = $12`,
          [gdItem[0].id, gdItem[0].unit, ct.status, ct.qty, ct.weight,
           ct.dim_length, ct.dim_depth, ct.dim_height, ct.dim_unit,
           carrierRate, carrierValue, processLot.id]
        );
        await logOp(client, processLot.id, 'seed_remove_carrier_transform', 'lot_process_return', ret.id,
          0, ct.status,
          `Seed Remove (${returnNum}) — Growth carrier ${processLot.lot_number} transformed in place ` +
          `growth_run → growth_diamond (same identity, no -R1): qty ${ct.qty}, weight ${Number(ct.weight).toFixed(4)} ct → ${ct.status}`,
          req.user.id);

        // Attached Seed: SAME row released back to stock (never consumed).
        // Root lineage and lot name preserved; dims retained from the row.
        const seedValue = parseFloat(seedRow.total_value) || 0;
        const seedRate  = st.qty > 0 ? Math.round((seedValue / st.qty) * 10000) / 10000 : parseFloat(seedRow.rate || 0);
        await client.query(
          `UPDATE inventory
             SET status = $1, qty = $2, weight = $3, rate = $4, total_value = $5,
                 manufacturing_state = 'AVAILABLE', updated_at = NOW()
           WHERE id = $6`,
          [st.status, st.qty, st.weight, seedRate, seedValue, seedRow.id]
        );
        await logOp(client, seedRow.id, 'seed_remove_release', 'lot_process_return', ret.id,
          0, st.status,
          `Seed Remove (${returnNum}) — attached Seed ${seedRow.lot_code || seedRow.lot_number} released in place ` +
          `(same identity, no -S1; root lineage preserved): qty ${st.qty}, weight ${Number(st.weight).toFixed(4)} ct → ${st.status}, detached`,
          req.user.id);
      } else if (isGrowthRun && isComponentReturn && !isDetachTransform) {
        // Phase C: Seed Remove split the assembly — the Partial Growth Run is
        // no longer a usable inventory object. Its material continues as the
        // diamond + recovered-seed children created above.
        await client.query(
          `UPDATE inventory
             SET qty=0, weight=0, total_value=0, status='CONSUMED',
                 manufacturing_state='RETIRED', updated_at=NOW()
           WHERE id=$1`,
          [processLot.id]
        );
        await logOp(client, processLot.id, 'return_complete', 'lot_process_return', ret.id,
          -currentRemaining, 'CONSUMED',
          `Seed Remove final (${returnNum}) — assembly split into Growth Diamond + Recovered Seed`,
          req.user.id);
        // The attached Seed identities retire: their material and carrying
        // value moved onto the RECOVERED seed children (value conservation —
        // nothing vanishes, nothing duplicates).
        for (const s of attachedSeeds) {
          await client.query(
            `UPDATE inventory
               SET qty=0, weight=0, total_value=0, status='CONSUMED',
                   manufacturing_state='RETIRED', updated_at=NOW()
             WHERE id=$1`,
            [s.id]
          );
          await logOp(client, s.id, 'seed_retired', 'lot_process_return', ret.id,
            -parseFloat(s.qty || 0), 'CONSUMED',
            `Seed Remove (${returnNum}) — attached Seed retired; recovered material continues as the RECOVERED seed children of ${processLot.lot_number}`,
            req.user.id);
        }
      } else if (isTransformReturn) {
        // In-place transformation: the SAME row simply becomes available
        // stock under its new category — never consumed, never zeroed.
        const transformStatus = plan.projected_inventory_status || 'IN STOCK';
        await client.query(
          `UPDATE inventory SET status=$1, updated_at=NOW() WHERE id=$2`,
          [transformStatus, processLot.id]
        );
        await logOp(client, processLot.id, 'return_complete', 'lot_process_return', ret.id,
          0, transformStatus,
          `Final Block transform final (${returnNum}) — ${processLot.lot_number} continues as ` +
          `Rough Diamond in place (same inventory identity) → ${transformStatus}`,
          req.user.id);
      } else if (!isGrowthRun) {
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
            // An in-place transformation IS the terminal output of its process —
            // there is no separate output posting afterwards, so the machine
            // must complete now and never wait in awaiting_output.
            const completionMode = isTransformReturn
              ? 'RETURN_BASED'
              : (mp.completion_mode || 'RETURN_BASED');
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


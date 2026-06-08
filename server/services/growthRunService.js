// ============================================================
// Growth Run Service (Phase 32)
// ------------------------------------------------------------
// A "Growth Run" (Biscuit) is the physical output of a CVD growth process.
// It is stored as an inventory row with category='growth_run', NOT as a
// separate table. See Phase 32 Design Validation Audit for rationale.
//
// Genealogy: seed lot → growth_run lot → rough lots
//
// The biscuit is auto-created when machine_processes transitions to
// 'awaiting_output' (i.e. all seeds returned but rough output not yet posted).
// ============================================================

const { nextLotOpId } = require('./seedLotCodeService');

/**
 * Generate the next Growth Run number.
 * Format (Phase 34): GR-YYYYMM-NNNN  e.g. GR-202606-0001
 * The numeric part is drawn from the global growth_run_seq for guaranteed
 * uniqueness (lot_number is UNIQUE); the YYYYMM prefix makes runs sortable
 * and human-readable by month without risking a concurrent-reset collision.
 * @param {object} client  active transaction client
 */
async function nextGrowthRunNumber(client) {
  const { rows } = await client.query("SELECT nextval('growth_run_seq') AS n");
  const d  = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `GR-${ym}-${String(rows[0].n).padStart(4, '0')}`;
}

/**
 * Resolve the single BISCUIT master-item id (one row per category by convention).
 */
async function getBiscuitItemId(client) {
  const { rows } = await client.query(
    "SELECT id FROM items WHERE category = 'growth_run' AND status = 'active' LIMIT 1"
  );
  if (!rows.length) {
    throw new Error('No active growth_run item found in Item Master (expected code=BISCUIT)');
  }
  return rows[0].id;
}

/**
 * Determine the "first" seed source for this process — used to snapshot
 * seed_height_at_in and weight_at_in. If multiple seeds were issued (mix),
 * snapshot the FIRST issue's source lot; mix components are still tracked
 * via lot_mix_components against the biscuit row.
 *
 * @param {object} client            transaction client
 * @param {number} machineProcessId
 * @returns {Promise<{rows: Array, primarySeed: object|null}>}
 */
async function loadProcessSeedContext(client, machineProcessId) {
  const { rows } = await client.query(
    `SELECT pi.id           AS issue_id,
            pi.source_lot_id,
            pi.process_lot_id,
            pi.issued_qty,
            sl.lot_number    AS source_lot_number,
            sl.lot_code      AS source_lot_code,
            sl.dim_height    AS source_dim_height,
            sl.weight        AS source_weight,
            sl.root_lot_id   AS source_root_lot_id,
            sl.genealogy_path AS source_genealogy_path
       FROM lot_process_issues pi
       JOIN inventory sl ON sl.id = pi.source_lot_id
      WHERE pi.machine_process_id = $1
      ORDER BY pi.id`,
    [machineProcessId]
  );
  return {
    rows,
    primarySeed: rows[0] || null,
  };
}

/**
 * Create a Growth Run inventory row for a machine_process that has just
 * transitioned to 'awaiting_output'.
 *
 * Idempotent: if a biscuit already exists for this process, returns it
 * without inserting a duplicate.
 *
 * @param {object} client            active transaction client
 * @param {number} machineProcessId
 * @param {object} opts              { createdBy, departmentId, locationId, remarks }
 * @returns {Promise<object>}        the inventory row representing the biscuit
 */
async function createGrowthRun(client, machineProcessId, opts = {}) {
  // 1. Idempotency guard
  const existing = await client.query(
    `SELECT * FROM inventory
      WHERE machine_process_id = $1
        AND item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
      LIMIT 1`,
    [machineProcessId]
  );
  if (existing.rows.length) return existing.rows[0];

  // 2. Load machine process + seed context (with FOR UPDATE to serialise)
  const mpRes = await client.query(
    `SELECT mp.*, m.department_id AS machine_department_id, m.location_id AS machine_location_id,
            m.code AS machine_code,
            pm.process_group
       FROM machine_processes mp
       JOIN machines m ON m.id = mp.machine_id
       LEFT JOIN process_master pm ON pm.process_code = mp.process_type
      WHERE mp.id = $1
      FOR UPDATE OF mp`,
    [machineProcessId]
  );
  if (!mpRes.rows.length) {
    throw new Error(`machine_processes ${machineProcessId} not found`);
  }
  const mp = mpRes.rows[0];

  // Phase 34: only GROWTH-group processes produce biscuits. Resolve via the
  // process_group master flag, falling back to the legacy process_type='growth'
  // convention for rows created before Phase 34. Silently skip all others
  // (e.g. LASER processes operate ON an existing biscuit, they don't create one).
  const group = (mp.process_group || (mp.process_type === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase();
  if (group !== 'GROWTH') {
    return null;
  }

  const seedCtx = await loadProcessSeedContext(client, machineProcessId);
  if (!seedCtx.primarySeed) {
    throw new Error(`No seed issues found for machine_process ${machineProcessId}; cannot create Growth Run`);
  }

  // 3. Allocate identifiers
  const growthRunNumber = await nextGrowthRunNumber(client);
  const lotOpId         = await nextLotOpId(client);
  const biscuitItemId   = await getBiscuitItemId(client);

  // 4. Snapshot seed measurements from the PRIMARY seed at moment of biscuit creation
  const seedHeightAtIn = seedCtx.primarySeed.source_dim_height ?? null;
  const weightAtIn     = seedCtx.primarySeed.source_weight ?? null;

  // Phase 34 (FIX 3): the Growth Run carries the SEED QUANTITY, not a hardcoded 1.
  // Sum the issued seed qty across every seed issue for this process (mix-aware),
  // so Seed Qty 15 → Growth Run Qty 15. Weight/dimensions may still change later.
  const seedQty = seedCtx.rows.reduce((s, r) => s + parseFloat(r.issued_qty || 0), 0) || 1;

  // 5. Genealogy: biscuit's parent is the seed source lot (NOT the process lot)
  //    This skips the synthetic "process lot" link so the biscuit sits cleanly
  //    between seed and rough in the lineage tree.
  const parentLotId = seedCtx.primarySeed.source_lot_id;
  const rootLotId   = seedCtx.primarySeed.source_root_lot_id ?? seedCtx.primarySeed.source_lot_id;
  const genPath     = `${seedCtx.primarySeed.source_genealogy_path || seedCtx.primarySeed.source_lot_number}/${growthRunNumber}`;

  // 6. Insert biscuit inventory row
  //    qty=1 (always one biscuit), unit='PCS'.
  //    Phase 34: the biscuit is created at process START while it is still
  //    growing, so its initial state mirrors the seed:
  //      status     = 'IN PROCESS'  (actively growing in the machine)
  //      dim_height = seed_height_at_in  → actual_growth_mm = 0 (generated)
  //      weight     = weight_at_in       → weight_gain      = 0 (generated)
  //    Growth Output later overwrites weight/dim_height with the final
  //    measurements and consumes the biscuit.
  const insertRes = await client.query(
    `INSERT INTO inventory (
        item_id, lot_number, lot_name, lot_code,
        qty, unit, weight, rate, total_value,
        location_id, department_id, purchase_date,
        status, remarks, lot_op_id,
        parent_lot_id, root_lot_id, genealogy_path,
        source_type, operation_type, source_module, split_level,
        machine_process_id, seed_height_at_in, weight_at_in,
        dim_height, dim_unit
     ) VALUES (
        $1, $2, $3, $4,
        $15, 'PCS', $14, 0, 0,
        $5, $6, CURRENT_DATE,
        'IN PROCESS', $7, $8,
        $9, $10, $11,
        'growth', 'growth_output', 'Growth Run', COALESCE((SELECT split_level FROM inventory WHERE id = $9) + 1, 1),
        $12, $13, $14,
        $13, 'mm'
     ) RETURNING *`,
    [
      biscuitItemId,
      growthRunNumber,                                    // lot_number  (GR-000001)
      `Biscuit ${growthRunNumber} (${mp.machine_code})`,  // lot_name
      growthRunNumber,                                    // lot_code
      opts.locationId    ?? mp.machine_location_id    ?? null,
      opts.departmentId  ?? mp.machine_department_id  ?? null,
      opts.remarks ?? `Auto-created from process ${mp.process_number} on machine ${mp.machine_code}`,
      lotOpId,
      parentLotId,
      rootLotId,
      genPath,
      machineProcessId,
      seedHeightAtIn,
      weightAtIn,
      seedQty,
    ]
  );
  const biscuit = insertRes.rows[0];

  // 7. If multiple seed sources (mix scenario), record each as a mix component
  if (seedCtx.rows.length > 1) {
    for (const issue of seedCtx.rows) {
      await client.query(
        `INSERT INTO lot_mix_components (mixed_lot_id, source_lot_id, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (mixed_lot_id, source_lot_id) DO NOTHING`,
        [biscuit.id, issue.source_lot_id, issue.issued_qty || 0]
      );
    }
  }

  return biscuit;
}

/**
 * Apply operator-measured biscuit dimensions/weight.
 * Updates dim_height/dim_length/dim_depth and weight on the biscuit row.
 * Generated columns (actual_growth_mm, weight_gain, growth_pct) recompute
 * automatically.
 *
 * @param {object} client       transaction client
 * @param {number} inventoryId  biscuit inventory.id
 * @param {object} m            { weight, dim_height, dim_length, dim_depth, dim_unit, remarks }
 */
async function applyMeasurements(client, inventoryId, m) {
  const fields = [];
  const params = [];
  let i = 1;

  const push = (col, val) => {
    if (val === undefined) return;
    fields.push(`${col} = $${i++}`);
    params.push(val);
  };

  push('weight',     m.weight);
  push('dim_height', m.dim_height);
  push('dim_length', m.dim_length);
  push('dim_depth',  m.dim_depth);
  push('dim_unit',   m.dim_unit);
  push('remarks',    m.remarks);

  if (!fields.length) return null;
  params.push(inventoryId);

  const { rows } = await client.query(
    `UPDATE inventory
        SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${i}
        AND item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
      RETURNING *`,
    params
  );
  if (!rows.length) {
    throw new Error(`Growth Run inventory ${inventoryId} not found (or not a growth_run row)`);
  }
  return rows[0];
}

/**
 * Phase 34 (FIX 1): Advance the Growth Run biscuit from IN PROCESS → IN STOCK.
 *
 * Called when the GROWTH machine_process completes successfully (all seeds
 * returned). The single biscuit row created at process START is now a finished
 * physical object available for downstream laser ops / Growth Output — it is no
 * longer "growing in the machine". This is a pure state transition; it does NOT
 * create a new row (there is exactly ONE Growth Run record per process).
 *
 * Idempotent: only flips rows still IN PROCESS, so a re-call is a no-op.
 *
 * @param {object} client            active transaction client
 * @param {number} machineProcessId
 * @returns {Promise<object|null>}   the updated biscuit row, or null if none
 */
async function advanceGrowthRunToStock(client, machineProcessId) {
  const { rows } = await client.query(
    `UPDATE inventory
        SET status = 'IN STOCK', updated_at = NOW()
      WHERE machine_process_id = $1
        AND item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
        AND status = 'IN PROCESS'
      RETURNING *`,
    [machineProcessId]
  );
  return rows[0] || null;
}

/**
 * RULE 5: Append a row to the Growth Run cycle-history ledger.
 *
 * Each measurement-changing event in a biscuit's life (initial growth, Growth
 * Again, laser cuts) is recorded as its own cycle WITHOUT overwriting earlier
 * cycles. cycle_no auto-increments per growth_run_id. growth_mm/weight_delta are
 * the PER-CYCLE deltas (new − prev), so total growth = SUM(growth_mm).
 *
 * @param {object} client       transaction client
 * @param {object} c            cycle data
 * @param {number} c.growthRunId
 * @param {number} [c.machineProcessId]
 * @param {string} [c.processType]
 * @param {number} [c.prevHeight]
 * @param {number} [c.newHeight]
 * @param {number} [c.prevWeight]
 * @param {number} [c.newWeight]
 * @param {number} [c.dimLength]
 * @param {number} [c.dimWidth]
 * @param {string} [c.dimUnit]
 * @param {string} [c.remarks]
 * @param {number} [c.performedBy]
 * @returns {Promise<object>}   the inserted cycle row
 */
async function recordGrowthCycle(client, c) {
  const { rows: [{ next_no }] } = await client.query(
    `SELECT COALESCE(MAX(cycle_no), 0) + 1 AS next_no
       FROM growth_run_cycles WHERE growth_run_id = $1`,
    [c.growthRunId]
  );

  const num = (v) => (v === undefined || v === null || v === '' ? null : parseFloat(v));
  const ph = num(c.prevHeight), nh = num(c.newHeight);
  const pw = num(c.prevWeight), nw = num(c.newWeight);
  const growthMm    = (ph !== null && nh !== null) ? Math.round((nh - ph) * 1000) / 1000 : null;
  const weightDelta = (pw !== null && nw !== null) ? Math.round((nw - pw) * 10000) / 10000 : null;

  const { rows } = await client.query(
    `INSERT INTO growth_run_cycles
       (growth_run_id, machine_process_id, cycle_no, process_type,
        prev_height, new_height, growth_mm,
        prev_weight, new_weight, weight_delta,
        dim_length, dim_width, dim_unit, remarks, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      c.growthRunId, c.machineProcessId ?? null, next_no, c.processType ?? null,
      ph, nh, growthMm,
      pw, nw, weightDelta,
      num(c.dimLength), num(c.dimWidth), c.dimUnit || 'mm',
      c.remarks ?? null, c.performedBy ?? null,
    ]
  );
  return rows[0];
}

/**
 * Find the active (IN STOCK) biscuit for a machine_process, if any.
 */
async function findActiveBiscuitByProcess(client, machineProcessId) {
  const { rows } = await client.query(
    `SELECT * FROM inventory
      WHERE machine_process_id = $1
        AND item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
      ORDER BY id DESC
      LIMIT 1`,
    [machineProcessId]
  );
  return rows[0] || null;
}

module.exports = {
  nextGrowthRunNumber,
  getBiscuitItemId,
  createGrowthRun,
  advanceGrowthRunToStock,
  applyMeasurements,
  recordGrowthCycle,
  findActiveBiscuitByProcess,
};

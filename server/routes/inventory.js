const express = require('express');
const pool = require('../db/pool');
const cache = require('../db/cache');
const { authenticate, authorize } = require('../middleware/auth');
const { getInventoryValuationLines, round2 } = require('../services/inventoryAccounting');
const reversalOrchestrator = require('../services/reversalOrchestrator');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();



// GET /api/inventory
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      status, category, search, type_filter, stock_filter, sort_by,
      limit = 50, offset = 0,
      operation_type, process_type, date_from, date_to, mix_only, split_only,
      sort_dir = 'desc',
      vendor_id,
      qty_min, qty_max,
      weight_min, weight_max,
      ids,
      fields,
    } = req.query;

    const params = [];
    let where = 'WHERE 1=1';

    if (ids) {
      const idArr = ids.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      if (idArr.length > 0) {
        params.push(idArr);
        where += ` AND inv.id = ANY($${params.length}::int[])`;
      } else {
        where += ` AND 1=0`;
      }
    }

    if (status)         { params.push(status);         where += ` AND inv.status = $${params.length}`; }
    if (category) {
      if (category === 'growth_run') {
        where += ` AND i.category IN ('growth_run', 'growth_diamond')`;
      } else {
        params.push(category);
        where += ` AND i.category = $${params.length}`;
      }
    }
    if (type_filter)    { params.push(type_filter);    where += ` AND i.type = $${params.length}`; }
    if (operation_type) { params.push(operation_type); where += ` AND inv.operation_type = $${params.length}`; }
    if (process_type)   { params.push(process_type);   where += ` AND COALESCE(mp.process_type, lpi.process_type) = $${params.length}`; }
    if (date_from)      { params.push(date_from);      where += ` AND inv.purchase_date >= $${params.length}`; }
    if (date_to)        { params.push(date_to);        where += ` AND inv.purchase_date <= $${params.length}`; }
    if (mix_only   === 'true') where += " AND inv.source_type = 'mix'";
    if (split_only === 'true') where += " AND inv.source_type = 'split'";

    if (req.query.location_id && req.query.location_id !== '') {
      // Location filters through canonical Location IDs only (physical inventory
      // location, or the department's location). It must never match on
      // source_module — transaction origin is not a Location.
      const locId = parseInt(req.query.location_id);
      if (!isNaN(locId)) {
        params.push(locId);
        where += ` AND (inv.location_id = $${params.length} OR (inv.location_id IS NULL AND d.location_id = $${params.length}))`;
      }
    }
    if (req.query.account_base_id && req.query.account_base_id !== '') { params.push(parseInt(req.query.account_base_id)); where += ` AND d.location_id = $${params.length}`; }
    if (vendor_id && vendor_id !== '')     { params.push(parseInt(vendor_id));      where += ` AND inv.vendor_id = $${params.length}`; }
    if (qty_min    !== undefined && qty_min    !== '') { params.push(parseFloat(qty_min));    where += ` AND inv.qty >= $${params.length}`; }
    if (qty_max    !== undefined && qty_max    !== '') { params.push(parseFloat(qty_max));    where += ` AND inv.qty <= $${params.length}`; }
    if (weight_min !== undefined && weight_min !== '') { params.push(parseFloat(weight_min)); where += ` AND inv.weight >= $${params.length}`; }
    if (weight_max !== undefined && weight_max !== '') { params.push(parseFloat(weight_max)); where += ` AND inv.weight <= $${params.length}`; }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (inv.lot_number ILIKE $${params.length}
                   OR COALESCE(inv.lot_code,'') ILIKE $${params.length}
                   OR COALESCE(inv.lot_name,'') ILIKE $${params.length}
                   OR i.name ILIKE $${params.length}
                   OR COALESCE(v.name,'') ILIKE $${params.length}
                   OR COALESCE(inv.remarks,'') ILIKE $${params.length}
                   OR COALESCE(inv.genealogy_path,'') ILIKE $${params.length}
                   OR COALESCE(inv.batch_no,'') ILIKE $${params.length}
                   OR COALESCE(pl.lot_code, pl.lot_number, '') ILIKE $${params.length}
                   OR CAST(inv.lot_op_id AS TEXT) LIKE $${params.length})`;
    }

    if (stock_filter === 'positive') where += ' AND inv.qty > 0';
    else if (stock_filter === 'zero')     where += ' AND inv.qty = 0';
    else if (stock_filter === 'negative') where += ' AND inv.qty < 0';
    else if (stock_filter === 'low')      where += ' AND inv.qty > 0 AND i.reorder_level > 0 AND inv.qty <= i.reorder_level';

    const d = sort_dir === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
      qty:        `inv.qty ${d}`,
      weight:     `inv.weight ${d}`,
      value:      `inv.total_value ${d}`,
      name:       `i.name ${d}`,
      lot_name:   `COALESCE(inv.lot_code, inv.lot_number) ${d}`,
      lot_code:   `COALESCE(inv.lot_code, inv.lot_number) ${d}`,
      lot_op_id:  `inv.lot_op_id ${d}`,
      location:   `l.name ${d} NULLS LAST`,
      dept:       `d.name ${d} NULLS LAST`,
      dept_loc:   `dl.name ${d} NULLS LAST`,
      date:       `inv.purchase_date ${d} NULLS LAST`,
      vendor:     `v.name ${d} NULLS LAST`,
      status:     `inv.status ${d}`,
      op_type:       `inv.operation_type ${d}`,
      source_module: `inv.source_module ${d} NULLS LAST`,
      level:         `inv.split_level ${d}`,
      dim_length: `inv.dim_length ${d} NULLS LAST`,
      dim_depth:  `inv.dim_depth ${d} NULLS LAST`,
      dim_height: `inv.dim_height ${d} NULLS LAST`,
    };
const orderBy = sortMap[sort_by] || `inv.created_at ${d}`;

    // Build SELECT clause based on fields parameter
    const allFields = {
      // Core inventory fields
      id: 'inv.id',
      lot_number: 'inv.lot_number',
      lot_name: 'inv.lot_name',
      lot_code: 'inv.lot_code',
      lot_op_id: 'inv.lot_op_id',
      qty: 'inv.qty',
      unit: 'inv.unit',
      weight: 'inv.weight',
      rate: 'inv.rate',
      total_value: 'inv.total_value',
      status: 'inv.status',
      operation_type: 'inv.operation_type',
      split_level: 'inv.split_level',
      source_type: 'inv.source_type',
      source_module: 'inv.source_module',
      machine_process_id: 'inv.machine_process_id',
      parent_lot_id: 'inv.parent_lot_id',
      root_lot_id: 'inv.root_lot_id',
      genealogy_path: 'inv.genealogy_path',
      purchase_date: 'inv.purchase_date',
      created_at: 'inv.created_at',
      updated_at: 'inv.updated_at',
      dim_length: 'inv.dim_length',
      dim_depth: 'inv.dim_depth',
      dim_height: 'inv.dim_height',
      dim_unit: 'inv.dim_unit',
      seed_height_at_in: 'inv.seed_height_at_in',
      weight_at_in: 'inv.weight_at_in',
      actual_growth_mm: 'inv.actual_growth_mm',
      weight_gain: 'inv.weight_gain',
      growth_pct: 'inv.growth_pct',
      batch_no: 'inv.batch_no',
      run_no: 'inv.run_no',
      remarks: 'inv.remarks',
      // Item fields
      item_id: 'inv.item_id',
      item_name: 'i.name',
      item_code: 'i.code',
      item_category: 'i.category',
      item_type: 'i.type',
      item_reorder_level: 'i.reorder_level',
      // Location fields
      location_id: 'COALESCE(inv.location_id, m.location_id)',
      location_name: 'COALESCE(l.name, ml.name)',
      // Vendor fields
      vendor_id: 'inv.vendor_id',
      vendor_name: 'v.name',
      // Department fields
      department_id: 'COALESCE(inv.department_id, m.department_id)',
      dept_name: 'COALESCE(d.name, md.name)',
      dept_location_name: 'COALESCE(dl.name, mdl.name)',
      // Parent/Root lot fields
      parent_lot_name: 'COALESCE(pl.lot_code, pl.lot_number)',
      root_lot_name: 'COALESCE(rl.lot_code, rl.lot_number)',
      // Process fields
      current_process_name: 'COALESCE(pm.process_name, pm2.process_name)',
      process_type: 'COALESCE(mp.process_type, lpi.process_type)',
    };

    const requestedFields = fields ? fields.split(',').map(f => f.trim()) : null;
    const selectFields = requestedFields
      ? requestedFields.map(f => allFields[f] ? `${allFields[f]} AS ${f}` : null).filter(Boolean).join(', ')
      : Object.entries(allFields).map(([alias, col]) => `${col} AS ${alias}`).join(', ');

    const baseFrom = `FROM inventory inv JOIN items i ON inv.item_id = i.id
             LEFT JOIN locations l ON inv.location_id = l.id
             LEFT JOIN vendors v ON inv.vendor_id = v.id
             LEFT JOIN departments d ON inv.department_id = d.id
             LEFT JOIN locations dl ON d.location_id = dl.id
             LEFT JOIN inventory pl ON pl.id = inv.parent_lot_id
             LEFT JOIN inventory rl ON rl.id = inv.root_lot_id
             LEFT JOIN machine_processes mp ON mp.id = inv.machine_process_id
             LEFT JOIN machines m ON mp.machine_id = m.id
             LEFT JOIN departments md ON m.department_id = md.id
             LEFT JOIN locations ml ON m.location_id = ml.id
             LEFT JOIN locations mdl ON md.location_id = mdl.id
             LEFT JOIN process_master pm ON pm.process_code = mp.process_type
             LEFT JOIN lot_process_issues lpi ON lpi.process_lot_id = inv.id AND lpi.status = 'OPEN'
             LEFT JOIN process_master pm2 ON pm2.process_code = lpi.process_type
             ${where}`;

    const dataParams = [...params, parseInt(limit), parseInt(offset)];

    const q = `SELECT ${selectFields} ${baseFrom} ORDER BY ${orderBy}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

    const [result, countR, totalsR] = await Promise.all([
      pool.query(q, dataParams),
      pool.query(`SELECT COUNT(*) ${baseFrom}`, params),
      pool.query(
        `SELECT COALESCE(SUM(inv.qty),0) AS total_qty,
                COALESCE(SUM(inv.total_value),0) AS total_value
         ${baseFrom}`, params
      ),
    ]);

    res.json({
      data:   result.rows,
      total:  parseInt(countR.rows[0].count),
      totals: {
        qty:   parseFloat(totalsR.rows[0].total_qty),
        value: parseFloat(totalsR.rows[0].total_value),
      },
    });
  } catch (err) {
    logger.error('[inventory] GET / error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/filters/active
router.get('/filters/active', authenticate, async (req, res) => {
  try {
    const [locationsResult, accountBasesResult, vendorsResult, processesResult] = await Promise.all([
      pool.query(`
        SELECT id::text, name FROM locations
        ORDER BY name
      `),
      pool.query(`
        SELECT DISTINCT dl.id::text as id, dl.name
        FROM departments d
        JOIN locations dl ON d.location_id = dl.id
        WHERE dl.name IS NOT NULL
        ORDER BY dl.name
      `),
      pool.query(`
        SELECT id::text, name
        FROM vendors
        ORDER BY name
      `),
      pool.query(`
        SELECT DISTINCT pm.process_code AS id, pm.process_name AS name
        FROM machine_processes mp
        JOIN process_master pm ON pm.process_code = mp.process_type
        WHERE pm.process_name IS NOT NULL
        ORDER BY pm.process_name
      `),
    ]);

    res.json({
      locations: locationsResult.rows,
      accountBases: accountBasesResult.rows,
      vendors: vendorsResult.rows,
      processes: processesResult.rows,
    });
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// GET /api/inventory/opening/list
router.get('/opening/list', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT io.*, i.code AS item_code, i.name AS item_name, i.category
       FROM inventory_opening io
       JOIN items i ON i.id = io.item_id
       ORDER BY io.as_of_date DESC, i.code`
    );
    res.json({
      data: result.rows.map(r => ({
        ...r,
        quantity: Number(r.quantity) || 0,
        rate: Number(r.rate) || 0,
        value: Number(r.value) || 0,
      })),
      total: result.rows.length,
    });
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// POST /api/inventory/opening
router.post('/opening', authenticate, authorize('admin', 'operator'), async (req, res) => {
  let client;
  try {
    client = await pool.primaryPool.connect();
    await client.query('BEGIN');
    const { item_id, quantity, rate, as_of_date } = req.body;
    const qty = Number(quantity) || 0;
    const unitRate = Number(rate) || 0;
    if (!item_id) throw new Error('Item is required');
    if (!as_of_date) throw new Error('Opening date is required');
    if (qty <= 0 || unitRate <= 0) throw new Error('Quantity and rate must be greater than zero');
    const value = round2(qty * unitRate);

    const existing = await client.query(
      'SELECT id FROM inventory_opening WHERE item_id = $1 AND as_of_date = $2',
      [item_id, as_of_date]
    );
    if (existing.rows.length) throw new Error('Opening entry already exists for this item and date');

    const result = await client.query(
      `INSERT INTO inventory_opening (item_id, quantity, rate, value, as_of_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [item_id, qty, unitRate, value, as_of_date, req.user.id]
    );

    await client.query(
      `UPDATE items
       SET quantity_on_hand = quantity_on_hand + $1,
           inventory_value = inventory_value + $2,
           avg_cost = CASE
             WHEN quantity_on_hand + $1 > 0 THEN ROUND(((inventory_value + $2) / (quantity_on_hand + $1))::numeric, 4)
             ELSE 0
           END
       WHERE id = $3`,
      [qty, value, item_id]
    );

    await client.query('COMMIT');

    // Real-Time: notify all inventory users of the opening entry
    dispatchEvent('inventory.opening', {
      id: result.rows[0].id, item_id, quantity: qty, rate: unitRate,
      value, as_of_date, created_by: req.user.id,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { if (client) client.release(); }
});

// GET /api/inventory/opening (backward-friendly alias via query routing)
router.get('/opening', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    const offset = (page - 1) * pageSize;

    const query = `
      SELECT io.*, i.code AS item_code, i.name AS item_name, i.category
      FROM inventory_opening io
      JOIN items i ON i.id = io.item_id
      ORDER BY io.as_of_date DESC, i.code
      LIMIT $1 OFFSET $2
    `;
    const countQuery = `SELECT COUNT(*) FROM inventory_opening`;

    const [result, countR] = await Promise.all([
      pool.query(query, [pageSize, offset]),
      pool.query(countQuery)
    ]);

    const totalCount = parseInt(countR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({ data: result.rows, totalCount, page, pageSize, totalPages });
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// GET /api/inventory/closing
router.get('/closing', authenticate, async (req, res) => {
  try {
    const { as_of_date = new Date().toISOString().split('T')[0] } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    res.json(await getInventoryValuationLines(as_of_date, page, pageSize));
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// POST /api/inventory/closing
router.post('/closing', authenticate, authorize('admin'), async (req, res) => {
  let client;
  try {
    client = await pool.primaryPool.connect();
    await client.query('BEGIN');
    const { date, item_id, quantity, rate } = req.body;
    const qty = Number(quantity);
    const unitRate = Number(rate);
    if (!date) throw new Error('Closing date is required');
    if (!item_id) throw new Error('Item is required');
    if (qty < 0 || unitRate < 0) throw new Error('Quantity and rate must be zero or greater');
    const value = round2(qty * unitRate);

    const result = await client.query(
      `INSERT INTO inventory_closing_override (date, item_id, quantity, rate, value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [date, item_id, qty, unitRate, value, req.user.id]
    );
    await client.query('COMMIT');

    // Real-Time: notify inventory users of closing entry
    dispatchEvent('inventory.closing', {
      id: result.rows[0].id, item_id, quantity: qty, rate: unitRate, date,
      created_by: req.user.id,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    const status = err.code === '23505' ? 409 : 400;
    res.status(status).json({ error: err.code === '23505' ? 'Closing entry already exists for this item and date' : err.message });
  } finally { if (client) client.release(); }
});

// GET /api/inventory/by-category/:category
router.get('/by-category/:category', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT inv.*, i.name as item_name, i.code as item_code
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE i.category = $1 AND inv.status != 'CONSUMED'
       ORDER BY inv.lot_number`,
      [req.params.category]
    );
    res.json(result.rows);
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// GET /api/inventory/:id/movement-ledger
router.get('/:id/movement-ledger', authenticate, async (req, res) => {
  const lotId = parseInt(req.params.id);
  try {
    // Single batch query replacing N+1
    const { rows: lot } = await pool.query(
      `SELECT inv.*, i.name as item_name, i.category, NULL as created_by_name
       FROM inventory inv JOIN items i ON i.id = inv.item_id
       WHERE inv.id = $1`, [lotId]
    );
    if (!lot.length) return res.status(404).json({ error: 'Lot not found' });

    const { rows: events } = await pool.query(`
      -- Creation/intake event
      SELECT inv.created_at AS ts,
             COALESCE(inv.source_type, inv.operation_type, 'purchase') AS op_type,
             CASE WHEN inv.unit = 'CT' THEN inv.weight ELSE inv.qty END AS qty_delta,
             inv.status AS new_status,
             inv.remarks AS notes,
             NULL::text AS ref_type, NULL::int AS ref_id, NULL::text AS ref_number,
             NULL::text AS performed_by,
             'creation' AS source
      FROM inventory inv
      WHERE inv.id = $1

      UNION ALL

      -- Op-log entries
      SELECT ol.performed_at AS ts, ol.operation AS op_type,
             ol.qty_delta, ol.new_status, ol.notes,
             ol.reference_type AS ref_type, ol.reference_id::int AS ref_id, NULL AS ref_number,
             u.full_name AS performed_by, 'op_log' AS source
      FROM lot_op_log ol
      LEFT JOIN users u ON u.id = ol.performed_by
      WHERE ol.lot_id = $1

      UNION ALL

      -- Parent movements
      SELECT lm.movement_date::timestamp AS ts, (lm.movement_type || '_out') AS op_type,
             (-lmp.quantity_consumed) AS qty_delta, 'CONSUMED' AS new_status,
             lm.notes, 'lot_movement' AS ref_type, lm.id AS ref_id,
             lm.movement_number AS ref_number, u.full_name AS performed_by,
             'movement' AS source
      FROM lot_movement_parents lmp
      JOIN lot_movements lm ON lm.id = lmp.movement_id
      LEFT JOIN users u ON u.id = lm.created_by
      WHERE lmp.parent_lot_id = $1

      UNION ALL

      -- Child movements
      SELECT lm.movement_date::timestamp AS ts, (lm.movement_type || '_in') AS op_type,
             lmc.quantity AS qty_delta, 'IN STOCK' AS new_status,
             lm.notes, 'lot_movement' AS ref_type, lm.id AS ref_id,
             lm.movement_number AS ref_number, u.full_name AS performed_by,
             'movement' AS source
      FROM lot_movement_children lmc
      JOIN lot_movements lm ON lm.id = lmc.movement_id
      LEFT JOIN users u ON u.id = lm.created_by
      WHERE lmc.child_lot_id = $1

      ORDER BY ts ASC
    `, [lotId]);

    res.json({ lot: lot[0], events });
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// GET /api/inventory/:id/history — Unified Lot Transaction Register (P1 read-model)
// Query params: date_from, date_to (YYYY-MM-DD), source (creation|op_log|movement|growth_cycle),
//               limit (default 50), offset. Response: { data, total }.
// qty_after is RECONSTRUCTED from creation + op_log deltas only (movement rows
// mirror op_log for splits, so they are excluded from the running sum to avoid
// double counting). P2 stores authoritative balances at write time.
// txn_status is 'ACTIVE' for every row until the P2 reversal engine lands.
router.get('/:id/history', authenticate, async (req, res) => {
  const lotId = parseInt(req.params.id);
  const { date_from, date_to, source } = req.query;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 10000);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const { rows } = await pool.query(`
      WITH all_events AS (
        -- Creation/intake event
        SELECT inv.created_at::text AS ts,
               COALESCE(inv.source_type::text, inv.operation_type::text, 'purchase') AS event_type,
               'INVENTORY_MOVEMENT'::text AS event_class,
               TRUE AS affects_qty_balance,
               TRUE AS affects_weight_balance,
               TRUE AS affects_value_balance,
               NULL::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               inv.status::text AS status_change,
               NULL::text AS weight_change,
               NULL::text AS dimension_change,
               inv.remarks::text AS remarks,
               'creation'::text AS source,
               inv.qty::numeric AS qty_delta,
               NULL::text AS doc_no,
               NULL::int AS return_id,
               'ACTIVE'::text AS txn_status,
               FALSE AS reversible,
               'inventory'::text AS source_type,
               inv.id::int AS source_id
        FROM inventory inv
        WHERE inv.id = $1

        UNION ALL

        -- Generic Op-log entries (including Process Issued/Returned)
        SELECT ol.performed_at::text AS ts,
               ol.operation::text AS event_type,
               CASE
                 WHEN ol.operation IN ('issue', 'return_usable', 'return_reject', 'return_scrap', 'seed_consumed', 'issue_receive') THEN 'INVENTORY_MOVEMENT'::text
                 ELSE 'INFORMATIONAL'::text
               END AS event_class,
               CASE
                 WHEN ol.operation IN ('issue', 'seed_consumed') THEN TRUE
                 ELSE FALSE
               END AS affects_qty_balance,
               FALSE AS affects_weight_balance,
               FALSE AS affects_value_balance,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               ol.new_status::text AS status_change,
               CASE WHEN ol.qty_delta IS NOT NULL THEN (ol.qty_delta::text || ' units') ELSE NULL END AS weight_change,
               NULL::text AS dimension_change,
               ol.notes::text AS remarks,
               'op_log'::text AS source,
               CASE
                 WHEN ol.operation IN ('issue', 'return_usable', 'return_reject', 'return_scrap', 'seed_consumed') THEN ol.qty_delta::numeric
                 ELSE NULL::numeric
               END AS qty_delta,
               COALESCE(pi.issue_number, pr.return_number)::text AS doc_no,
               pr.id::int AS return_id,
               CASE WHEN pr.status = 'REVERSED' THEN 'REVERSED' ELSE 'ACTIVE' END AS txn_status,
               -- Phase C: reversal eligibility is POLICY-driven, never mere
               -- pre_state presence — SEED_REMOVE snapshots carry
               -- reversal_supported:false and must never enable Cancel.
               (pr.pre_state IS NOT NULL
                AND COALESCE(pr.pre_state->>'reversal_supported', 'true') <> 'false'
                AND COALESCE(pr.status, 'ACTIVE') <> 'REVERSED'
                AND ol.operation = 'return_usable') AS reversible,
               CASE
                 WHEN ol.operation = 'return_usable' AND pr.id IS NOT NULL THEN 'lot_process_return'::text
                 ELSE 'lot_op_log'::text
               END AS source_type,
               CASE
                 WHEN ol.operation = 'return_usable' AND pr.id IS NOT NULL THEN pr.id::int
                 ELSE ol.id::int
               END AS source_id
        FROM lot_op_log ol
        LEFT JOIN users u ON u.id = ol.performed_by
        LEFT JOIN lot_process_issues pi
               ON ol.reference_type = 'lot_process_issue' AND pi.id = ol.reference_id
        LEFT JOIN lot_process_returns pr
               ON ol.reference_type = 'lot_process_return' AND pr.id = ol.reference_id
        WHERE ol.lot_id = $1

        UNION ALL

        -- Movements (Splits, Stock Transfers, Consumptions) — parent perspective
        SELECT lm.movement_date::text AS ts,
               (lm.movement_type::text || '_out') AS event_type,
               'INVENTORY_MOVEMENT'::text AS event_class,
               TRUE AS affects_qty_balance,
               FALSE AS affects_weight_balance,
               FALSE AS affects_value_balance,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               'CONSUMED'::text AS status_change,
               ('-' || lmp.quantity_consumed::text) AS weight_change,
               NULL::text AS dimension_change,
               lm.notes::text AS remarks,
               'movement'::text AS source,
               -(lmp.quantity_consumed::numeric) AS qty_delta,
               NULL::text AS doc_no,
               NULL::int AS return_id,
               'ACTIVE'::text AS txn_status,
               FALSE AS reversible,
               'lot_movement_parents'::text AS source_type,
               lmp.id::int AS source_id
        FROM lot_movement_parents lmp
        JOIN lot_movements lm ON lm.id = lmp.movement_id
        LEFT JOIN users u ON u.id = lm.created_by
        WHERE lmp.parent_lot_id = $1

        UNION ALL

        -- Child perspective
        SELECT lm.movement_date::text AS ts,
               (lm.movement_type::text || '_in') AS event_type,
               'INVENTORY_MOVEMENT'::text AS event_class,
               FALSE AS affects_qty_balance, -- Child handled by 'creation'
               FALSE AS affects_weight_balance,
               FALSE AS affects_value_balance,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               'IN STOCK'::text AS status_change,
               ('+' || lmc.quantity::text) AS weight_change,
               NULL::text AS dimension_change,
               lm.notes::text AS remarks,
               'movement'::text AS source,
               lmc.quantity::numeric AS qty_delta,
               NULL::text AS doc_no,
               NULL::int AS return_id,
               'ACTIVE'::text AS txn_status,
               FALSE AS reversible,
               'lot_movement_children'::text AS source_type,
               lmc.id::int AS source_id
        FROM lot_movement_children lmc
        JOIN lot_movements lm ON lm.id = lmc.movement_id
        LEFT JOIN users u ON u.id = lm.created_by
        WHERE lmc.child_lot_id = $1

        UNION ALL

        -- Growth Run Cycles (Dimension/Weight changes)
        SELECT grc.created_at::text AS ts,
               (COALESCE(pm.process_name::text, grc.process_type::text, 'Growth Cycle') || ' (#' || grc.cycle_no::text || ')') AS event_type,
               'INFORMATIONAL'::text AS event_class,
               FALSE AS affects_qty_balance,
               TRUE AS affects_weight_balance,
               FALSE AS affects_value_balance,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               NULL::text AS status_change,
               ('Weight: ' || COALESCE(grc.prev_weight::text, '0') || ' → ' || COALESCE(grc.new_weight::text, '0')) AS weight_change,
               ('Height: ' || COALESCE(grc.prev_height::text, '0') || ' → ' || COALESCE(grc.new_height::text, '0') || ' (+' || COALESCE(grc.growth_mm::text, '0') || ' ' || COALESCE(grc.dim_unit::text, 'mm') || ')') AS dimension_change,
               grc.remarks::text AS remarks,
               'growth_cycle'::text AS source,
               NULL::numeric AS qty_delta,
               NULL::text AS doc_no,
               NULL::int AS return_id,
               'ACTIVE'::text AS txn_status,
               FALSE AS reversible,
               'growth_run_cycles'::text AS source_type,
               grc.id::int AS source_id
        FROM growth_run_cycles grc
        LEFT JOIN machine_processes mp ON mp.id = grc.machine_process_id
        LEFT JOIN process_master pm ON pm.process_code = mp.process_type
        LEFT JOIN users u ON u.id = grc.performed_by
        WHERE grc.growth_run_id = $1
      ),
      with_balance AS (
        -- Running balance over the FULL chronology. Only affects_qty_balance events count.
        SELECT e.*,
               SUM(CASE
                     WHEN e.operation IN ('creation', 'purchase_receipt', 'opening', 'child_lot_creation') THEN COALESCE(e.qty_delta, 0)
                     WHEN e.operation IN ('issue', 'seed_consumed', 'consumption') THEN COALESCE(e.qty_delta, 0)
                     WHEN e.operation IN ('split_out', 'transfer_out') THEN COALESCE(e.qty_delta, 0)
                     WHEN e.operation IN ('split_in', 'transfer_in') THEN COALESCE(e.qty_delta, 0)
                     WHEN e.operation = 'adjustment' THEN COALESCE(e.qty_delta, 0)
                     WHEN e.operation IN ('growth_run_created', 'return_usable', 'return_reject', 'return_scrap') THEN 0
                     WHEN e.operation IN ('return_reversed') THEN 0
                     WHEN e.operation IN ('informational') THEN 0
                     ELSE 0
                   END) OVER (ORDER BY e.ts ASC, e.source ASC ROWS UNBOUNDED PRECEDING) AS qty_after
        FROM (
          -- Intercept affects_qty_balance mapping directly in this wrapper so that mappedRows reads it
          SELECT a.*,
                 CASE
                   WHEN a.event_type IN ('creation', 'purchase_receipt', 'opening', 'child_lot_creation') THEN TRUE
                   WHEN a.event_type IN ('issue', 'seed_consumed', 'consumption') THEN TRUE
                   WHEN a.event_type IN ('split_out', 'transfer_out') THEN TRUE
                   WHEN a.event_type IN ('split_in', 'transfer_in') THEN TRUE
                   WHEN a.event_type = 'adjustment' THEN TRUE
                   WHEN a.event_type IN ('growth_run_created', 'return_usable', 'return_reject', 'return_scrap') THEN FALSE
                   WHEN a.event_type IN ('return_reversed') THEN FALSE
                   WHEN a.event_type IN ('informational') THEN FALSE
                   ELSE a.affects_qty_balance -- fallback to source definition
                 END AS explicit_affects_qty,
                 -- provide a stable 'operation' column for the SUM logic above
                 COALESCE(a.event_type, a.source) AS operation
          FROM all_events a
        ) e
      ),
      latest_mov AS (
        SELECT MAX(ts) as max_mov_ts FROM with_balance WHERE affects_qty_balance = TRUE AND txn_status = 'ACTIVE'
      )
      SELECT wb.*, COUNT(*) OVER () AS total_count,
             (wb.source_type || ':' || wb.source_id) AS canonical_transaction_key,
             (wb.ts = lm.max_mov_ts) AS is_latest_mov,
             CASE
               WHEN wb.reversible AND (wb.ts = lm.max_mov_ts) THEN TRUE
               ELSE FALSE
             END AS preliminary_can_cancel
      FROM with_balance wb
      CROSS JOIN latest_mov lm
      WHERE ($2::date IS NULL OR wb.ts::timestamp >= $2::date)
        AND ($3::date IS NULL OR wb.ts::timestamp < ($3::date + INTERVAL '1 day'))
        AND ($4::text IS NULL OR wb.source = $4::text)
      ORDER BY wb.ts DESC
      LIMIT $5 OFFSET $6
    `, [lotId, date_from || null, date_to || null, source || null, limit, offset]);

    // Map rows to explicitly match the requested API payload structure for history
    const mappedRows = rows.map(r => ({
      ...r,
      affects_qty_balance: r.explicit_affects_qty,
      history_id: r.canonical_transaction_key, // For frontend backward compatibility, though they should use canonical key
      can_view_union: r.return_id != null || r.source_type === 'lot_movement_parents' || r.source_type === 'lot_movement_children' || r.source_type === 'lot_process_issue' || r.source_type === 'lot_process_return',
      can_view_action: true,
      can_cancel: r.preliminary_can_cancel,
    }));

    res.json({ data: mappedRows, total: rows.length ? parseInt(rows[0].total_count) : 0 });
  } catch (err) {
    logger.error('[inventory] history error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// P2: Server-Authoritative Eligibility Check
router.get('/history/eligibility', authenticate, async (req, res) => {
  try {
    const { canonical_transaction_key, lot_id } = req.query;
    if (!canonical_transaction_key || !lot_id) {
      return res.status(400).json({ error: 'Missing canonical_transaction_key or lot_id.' });
    }
    const eligibility = await reversalOrchestrator.getReversalEligibility(canonical_transaction_key, parseInt(lot_id, 10));
    res.json(eligibility);
  } catch (err) {
    logger.error('[inventory] history eligibility error:', { error: err.message, stack: err.stack });
    res.status(400).json({ error: err.message });
  }
});

// P2: View Union (Exact Backend Resolver)
router.get('/history/union', authenticate, async (req, res) => {
  try {
    const { canonical_transaction_key, lot_id } = req.query;
    if (!canonical_transaction_key || !lot_id) {
      return res.status(400).json({ error: 'Missing canonical_transaction_key or lot_id.' });
    }
    const parts = canonical_transaction_key.split(':');
    if (parts.length < 2) return res.status(400).json({ error: 'Invalid canonical key format.' });

    const sourceType = parts[0];
    const sourceId = parseInt(parts[1], 10);
    const parsedLotId = parseInt(lot_id, 10);

    // We determine EXACT grouping based on the type of record
    let unionEvents = [];

    // lot_process_return source (Growth Return)
    if (sourceType === 'lot_process_return') {
      const { rows: prRows } = await pool.query('SELECT pre_state FROM lot_process_returns WHERE id = $1', [sourceId]);
      if (!prRows.length) return res.status(404).json({ error: 'Return not found' });
      const pre = prRows[0].pre_state;
      if (!pre || (pre.biscuit.id !== parsedLotId && pre.process_lot.id !== parsedLotId)) {
        return res.status(403).json({ error: 'Cross-lot canonical keys rejected.' });
      }

      const { rows: exactRows } = await pool.query(`
        SELECT ol.*, u.full_name as user
        FROM lot_op_log ol
        LEFT JOIN users u ON u.id = ol.performed_by
        WHERE ol.reference_type = 'lot_process_return' AND ol.reference_id = $1
        ORDER BY ol.performed_at ASC
      `, [sourceId]);
      unionEvents = exactRows.map(r => ({ ...r, grouping_quality: 'EXACT' }));
    }
    // lot_op_log source
    else if (sourceType === 'lot_op_log') {
      const { rows: opLogRows } = await pool.query('SELECT lot_id, reference_type, reference_id FROM lot_op_log WHERE id = $1', [sourceId]);
      if (!opLogRows.length) return res.status(404).json({ error: 'Transaction not found' });
      if (opLogRows[0].lot_id !== parsedLotId) {
        return res.status(403).json({ error: 'Cross-lot canonical keys rejected.' });
      }

      if (opLogRows[0].reference_type && opLogRows[0].reference_id) {
        const refType = opLogRows[0].reference_type;
        const refId = opLogRows[0].reference_id;
        const { rows: exactRows } = await pool.query(`
          SELECT ol.*, u.full_name as user
          FROM lot_op_log ol
          LEFT JOIN users u ON u.id = ol.performed_by
          WHERE ol.reference_type = $1 AND ol.reference_id = $2
          ORDER BY ol.performed_at ASC
        `, [refType, refId]);
        unionEvents = exactRows.map(r => ({ ...r, grouping_quality: 'EXACT' }));
      }
    }
    // movement source
    else if (sourceType === 'lot_movement_parents' || sourceType === 'lot_movement_children') {
      const idCol = sourceType === 'lot_movement_parents' ? 'parent_id' : 'child_id';
      const query = sourceType === 'lot_movement_parents'
        ? 'SELECT movement_id FROM lot_movement_parents WHERE id = $1'
        : 'SELECT movement_id FROM lot_movement_children WHERE id = $1';
      const { rows: movRows } = await pool.query(query, [sourceId]);
      if (movRows.length > 0) {
        const movId = movRows[0].movement_id;
        const { rows: mParents } = await pool.query('SELECT * FROM lot_movement_parents WHERE movement_id = $1', [movId]);
        const { rows: mChildren } = await pool.query('SELECT * FROM lot_movement_children WHERE movement_id = $1', [movId]);
        unionEvents = [
          ...mParents.map(r => ({ ...r, source_type: 'lot_movement_parents', grouping_quality: 'EXACT' })),
          ...mChildren.map(r => ({ ...r, source_type: 'lot_movement_children', grouping_quality: 'EXACT' }))
        ];
      }
    }

    res.json({ data: unionEvents });
  } catch (err) {
    logger.error('[inventory] history union error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// P2: Unified Reversal Endpoint
router.post('/history/reverse', authenticate, async (req, res) => {
  try {
    const { canonical_transaction_key, reason, lot_id } = req.body;
    if (!canonical_transaction_key || !reason || !lot_id) {
      return res.status(400).json({ error: 'Missing required reversal fields.' });
    }
    const result = await reversalOrchestrator.reverseTransaction({
      canonical_transaction_key,
      lotId: parseInt(lot_id, 10),
      reason,
      userId: req.user.id
    });
    res.json(result);
  } catch (err) {
    logger.error('[inventory] history reverse error:', { error: err.message, stack: err.stack });
    res.status(400).json({ error: err.message });
  }
});

// GET /api/inventory/summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    const summaryR = await pool.query(`
      SELECT
        COUNT(DISTINCT item_id) AS total_items,
        SUM(qty) AS total_qty,
        SUM(amount) AS total_value
      FROM inventory
      WHERE qty > 0
    `);
    res.json(summaryR.rows[0]);
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// GET /api/inventory/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT inv.*, i.name as item_name, i.code as item_code, i.category,
              l.name as location_name, v.name as vendor_name,
              COALESCE(pl.lot_code, pl.lot_number) AS parent_lot_name,
              COALESCE(rl.lot_code, rl.lot_number) AS root_lot_name,
              -- Phase A (Seed Lifecycle): attached Growth identity DERIVED from
              -- the existing issue → machine_process → biscuit relationship
              -- (read-only; no new table; biscuit.run_no stays the single
              -- authoritative Run source — nothing is stored on the Seed row).
              (SELECT gb.lot_number FROM lot_process_issues lpi2
                 JOIN inventory gb ON gb.machine_process_id = lpi2.machine_process_id
                  AND gb.item_id IN (SELECT id FROM items WHERE category = 'growth_run')
                WHERE lpi2.process_lot_id = inv.id
                ORDER BY lpi2.id DESC LIMIT 1) AS attached_growth_number,
              (SELECT gb.run_no FROM lot_process_issues lpi2
                 JOIN inventory gb ON gb.machine_process_id = lpi2.machine_process_id
                  AND gb.item_id IN (SELECT id FROM items WHERE category = 'growth_run')
                WHERE lpi2.process_lot_id = inv.id
                ORDER BY lpi2.id DESC LIMIT 1) AS attached_run_no
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       LEFT JOIN locations l ON inv.location_id = l.id
       LEFT JOIN vendors v ON inv.vendor_id = v.id
       LEFT JOIN inventory pl ON pl.id = inv.parent_lot_id
       LEFT JOIN inventory rl ON rl.id = inv.root_lot_id
       WHERE inv.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { logger.error('[inventory] ' + req.path, { error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

module.exports = router;

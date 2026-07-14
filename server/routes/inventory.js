const express = require('express');
const pool = require('../db/pool');
const cache = require('../db/cache');
const { authenticate, authorize } = require('../middleware/auth');
const { getInventoryValuationLines, round2 } = require('../services/inventoryAccounting');
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
    if (category)       { params.push(category);       where += ` AND i.category = $${params.length}`; }
    if (type_filter)    { params.push(type_filter);    where += ` AND i.type = $${params.length}`; }
    if (operation_type) { params.push(operation_type); where += ` AND inv.operation_type = $${params.length}`; }
    if (process_type)   { params.push(process_type);   where += ` AND COALESCE(mp.process_type, lpi.process_type) = $${params.length}`; }
    if (date_from)      { params.push(date_from);      where += ` AND inv.purchase_date >= $${params.length}`; }
    if (date_to)        { params.push(date_to);        where += ` AND inv.purchase_date <= $${params.length}`; }
    if (mix_only   === 'true') where += " AND inv.source_type = 'mix'";
    if (split_only === 'true') where += " AND inv.source_type = 'split'";

    if (req.query.location_id && req.query.location_id !== '') {
      const val = req.query.location_id;
      if (isNaN(parseInt(val))) {
        params.push(val);
        where += ` AND inv.location_id IS NULL AND d.location_id IS NULL AND inv.source_module = $${params.length}`;
      } else {
        params.push(parseInt(val));
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
      location_id: 'inv.location_id',
      location_name: 'l.name',
      // Vendor fields
      vendor_id: 'inv.vendor_id',
      vendor_name: 'v.name',
      // Department fields
      department_id: 'inv.department_id',
      dept_name: 'd.name',
      dept_location_name: 'dl.name',
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
        UNION
        SELECT DISTINCT inv.source_module as id, INITCAP(inv.source_module) as name 
        FROM inventory inv
        LEFT JOIN departments d ON inv.department_id = d.id
        WHERE inv.source_module IS NOT NULL AND inv.source_module != ''
          AND inv.location_id IS NULL AND d.location_id IS NULL
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
               NULL::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               inv.status::text AS status_change,
               NULL::text AS weight_change,
               NULL::text AS dimension_change,
               inv.remarks::text AS remarks,
               'creation'::text AS source,
               inv.qty::numeric AS qty_delta,
               NULL::text AS doc_no
        FROM inventory inv
        WHERE inv.id = $1

        UNION ALL

        -- Generic Op-log entries (including Process Issued/Returned)
        SELECT ol.performed_at::text AS ts,
               ol.operation::text AS event_type,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               ol.new_status::text AS status_change,
               CASE WHEN ol.qty_delta IS NOT NULL THEN (ol.qty_delta::text || ' units') ELSE NULL END AS weight_change,
               NULL::text AS dimension_change,
               ol.notes::text AS remarks,
               'op_log'::text AS source,
               ol.qty_delta::numeric AS qty_delta,
               COALESCE(pi.issue_number, pr.return_number)::text AS doc_no
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
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               'CONSUMED'::text AS status_change,
               ('-' || lmp.quantity_consumed::text) AS weight_change,
               NULL::text AS dimension_change,
               lm.notes::text AS remarks,
               'movement'::text AS source,
               NULL::numeric AS qty_delta,
               NULL::text AS doc_no
        FROM lot_movement_parents lmp
        JOIN lot_movements lm ON lm.id = lmp.movement_id
        LEFT JOIN users u ON u.id = lm.created_by
        WHERE lmp.parent_lot_id = $1

        UNION ALL

        -- Child perspective
        SELECT lm.movement_date::text AS ts,
               (lm.movement_type::text || '_in') AS event_type,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               'IN STOCK'::text AS status_change,
               ('+' || lmc.quantity::text) AS weight_change,
               NULL::text AS dimension_change,
               lm.notes::text AS remarks,
               'movement'::text AS source,
               NULL::numeric AS qty_delta,
               NULL::text AS doc_no
        FROM lot_movement_children lmc
        JOIN lot_movements lm ON lm.id = lmc.movement_id
        LEFT JOIN users u ON u.id = lm.created_by
        WHERE lmc.child_lot_id = $1

        UNION ALL

        -- Growth Run Cycles (Dimension/Weight changes)
        SELECT grc.created_at::text AS ts,
               (COALESCE(pm.process_name::text, grc.process_type::text, 'Growth Cycle') || ' (#' || grc.cycle_no::text || ')') AS event_type,
               u.full_name::text AS user,
               NULL::text AS source_loc, NULL::text AS dest_loc,
               NULL::text AS status_change,
               ('Weight: ' || COALESCE(grc.prev_weight::text, '0') || ' → ' || COALESCE(grc.new_weight::text, '0')) AS weight_change,
               ('Height: ' || COALESCE(grc.prev_height::text, '0') || ' → ' || COALESCE(grc.new_height::text, '0') || ' (+' || COALESCE(grc.growth_mm::text, '0') || ' ' || COALESCE(grc.dim_unit::text, 'mm') || ')') AS dimension_change,
               grc.remarks::text AS remarks,
               'growth_cycle'::text AS source,
               NULL::numeric AS qty_delta,
               NULL::text AS doc_no
        FROM growth_run_cycles grc
        LEFT JOIN machine_processes mp ON mp.id = grc.machine_process_id
        LEFT JOIN process_master pm ON pm.process_code = mp.process_type
        LEFT JOIN users u ON u.id = grc.performed_by
        WHERE grc.growth_run_id = $1
      ),
      with_balance AS (
        -- Running balance over the FULL chronology (before filters) so a date
        -- filter never distorts qty_after. Only creation + op_log deltas count.
        SELECT e.*,
               SUM(CASE WHEN e.source IN ('creation', 'op_log')
                        THEN COALESCE(e.qty_delta, 0) ELSE 0 END)
                 OVER (ORDER BY e.ts ASC, e.source ASC ROWS UNBOUNDED PRECEDING) AS qty_after,
               'ACTIVE'::text AS txn_status
        FROM all_events e
      )
      SELECT *, COUNT(*) OVER () AS total_count
      FROM with_balance
      WHERE ($2::date IS NULL OR ts::timestamp >= $2::date)
        AND ($3::date IS NULL OR ts::timestamp < ($3::date + INTERVAL '1 day'))
        AND ($4::text IS NULL OR source = $4::text)
      ORDER BY ts DESC
      LIMIT $5 OFFSET $6
    `, [lotId, date_from || null, date_to || null, source || null, limit, offset]);

    res.json({ data: rows, total: rows.length ? parseInt(rows[0].total_count) : 0 });
  } catch (err) {
    logger.error('[inventory] history error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
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
              COALESCE(rl.lot_code, rl.lot_number) AS root_lot_name
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

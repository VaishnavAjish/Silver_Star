const express  = require('express');
const pool     = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

const VALID_CATEGORIES   = ['PRIMARY','SUPPORT','QC','OTHER'];
const VALID_OUTPUT_TYPES = ['ROUGH','POLISHED','NONE','CUSTOM'];
// Phase 34: routing group for the Start Process screen.
const VALID_GROUPS       = ['GROWTH','LASER','POLISHING','QC','PACKING','OTHER'];

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { active, category, search } = req.query;
    const limit  = Math.min(parseInt(req.query.limit) || 500, 2000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const params = [];
    const where  = ['1=1'];

    if (active !== undefined) {
      params.push(active === 'true');
      where.push(`active = $${params.length}`);
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(process_code ILIKE $${params.length} OR process_name ILIKE $${params.length})`);
    }

    const whereClause = where.join(' AND ');
    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM process_master WHERE ${whereClause}`, params),
      pool.query(
        `SELECT * FROM process_master WHERE ${whereClause}
         ORDER BY sort_order, process_name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({ data: rowsRes.rows, total: parseInt(countRes.rows[0].count, 10) });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processMaster.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── GET BY CODE (lookup for forms) — must be before /:id wildcard ─────────────
router.get('/by-code/:code', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM process_master WHERE process_code = $1',
      [req.params.code.toLowerCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Process not found' });
    res.json(rows[0]);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processMaster.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── GET BY ID ─────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM process_master WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Process not found' });
    res.json(rows[0]);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processMaster.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const {
    process_code, process_name,
    category              = 'PRIMARY',
    requires_inventory    = true,
    requires_machine      = true,
    requires_operator     = false,
    requires_runtime      = false,
    requires_expected_yield = false,
    allows_consumables    = false,
    output_type           = 'NONE',
    default_runtime_hours,
    sort_order            = 0,
    process_group         = 'OTHER',
    input_item_category,
    eligible_machine_type,
    allowed_outputs = [],
  } = req.body;

  if (!process_code?.trim() || !process_name?.trim())
    return res.status(400).json({ error: 'process_code and process_name are required' });
  if (!VALID_CATEGORIES.includes(category))
    return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  if (!VALID_OUTPUT_TYPES.includes(output_type))
    return res.status(400).json({ error: `output_type must be one of: ${VALID_OUTPUT_TYPES.join(', ')}` });
  if (!VALID_GROUPS.includes(process_group))
    return res.status(400).json({ error: `process_group must be one of: ${VALID_GROUPS.join(', ')}` });

  try {
    const { rows } = await pool.query(
      `INSERT INTO process_master
         (process_code, process_name, category,
          requires_inventory, requires_machine, requires_operator,
          requires_runtime, requires_expected_yield, allows_consumables,
          output_type, default_runtime_hours, sort_order,
          process_group, input_item_category, eligible_machine_type,
          allowed_outputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        process_code.toLowerCase().trim(), process_name.trim(), category,
        !!requires_inventory, !!requires_machine, !!requires_operator,
        !!requires_runtime, !!requires_expected_yield, !!allows_consumables,
        output_type, default_runtime_hours ? parseFloat(default_runtime_hours) : null,
        parseInt(sort_order) || 0,
        process_group,
        input_item_category ? String(input_item_category).trim() : null,
        eligible_machine_type ? String(eligible_machine_type).trim() : null,
        JSON.stringify(allowed_outputs),
      ]
    );
    dispatchEvent('process_master.created', { id: rows[0].id, process_code: rows[0].process_code, process_name: rows[0].process_name, module: 'manufacturing' });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: `Process code '${process_code}' already exists` });
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM process_master WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!existing.length) return res.status(404).json({ error: 'Process not found' });
    const p = existing[0];

    const {
      process_name,
      category,
      requires_inventory,
      requires_machine,
      requires_operator,
      requires_runtime,
      requires_expected_yield,
      allows_consumables,
      output_type,
      default_runtime_hours,
      sort_order,
      active,
      process_group,
      input_item_category,
      eligible_machine_type,
      allowed_outputs,
    } = req.body;

    if (category    !== undefined && !VALID_CATEGORIES.includes(category))
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    if (output_type !== undefined && !VALID_OUTPUT_TYPES.includes(output_type))
      return res.status(400).json({ error: `output_type must be one of: ${VALID_OUTPUT_TYPES.join(', ')}` });
    if (process_group !== undefined && !VALID_GROUPS.includes(process_group))
      return res.status(400).json({ error: `process_group must be one of: ${VALID_GROUPS.join(', ')}` });

    const { rows } = await pool.query(
      `UPDATE process_master SET
         process_name            = $1,
         category                = $2,
         requires_inventory      = $3,
         requires_machine        = $4,
         requires_operator       = $5,
         requires_runtime        = $6,
         requires_expected_yield = $7,
         allows_consumables      = $8,
         output_type             = $9,
         default_runtime_hours   = $10,
         sort_order              = $11,
         active                  = $12,
         process_group           = $13,
         input_item_category     = $14,
         eligible_machine_type   = $15,
         allowed_outputs         = COALESCE($16, allowed_outputs),
         updated_at              = NOW()
       WHERE id = $17
       RETURNING *`,
      [
        process_name    !== undefined ? process_name.trim() : p.process_name,
        category        !== undefined ? category            : p.category,
        requires_inventory      !== undefined ? !!requires_inventory      : p.requires_inventory,
        requires_machine        !== undefined ? !!requires_machine        : p.requires_machine,
        requires_operator       !== undefined ? !!requires_operator       : p.requires_operator,
        requires_runtime        !== undefined ? !!requires_runtime        : p.requires_runtime,
        requires_expected_yield !== undefined ? !!requires_expected_yield : p.requires_expected_yield,
        allows_consumables      !== undefined ? !!allows_consumables      : p.allows_consumables,
        output_type             !== undefined ? output_type               : p.output_type,
        default_runtime_hours   !== undefined
          ? (default_runtime_hours ? parseFloat(default_runtime_hours) : null)
          : p.default_runtime_hours,
        sort_order !== undefined ? (parseInt(sort_order) || 0) : p.sort_order,
        active     !== undefined ? !!active                    : p.active,
        process_group !== undefined ? process_group : p.process_group,
        input_item_category   !== undefined
          ? (input_item_category ? String(input_item_category).trim() : null)
          : p.input_item_category,
        eligible_machine_type !== undefined
          ? (eligible_machine_type ? String(eligible_machine_type).trim() : null)
          : p.eligible_machine_type,
        allowed_outputs !== undefined ? JSON.stringify(allowed_outputs) : null,
        parseInt(req.params.id),
      ]
    );
    dispatchEvent('process_master.updated', { id: rows[0].id, process_code: rows[0].process_code, process_name: rows[0].process_name, module: 'manufacturing' });
    res.json(rows[0]);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processMaster.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

module.exports = router;

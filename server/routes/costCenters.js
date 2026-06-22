const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ---------------------------------------------------------------------------
// Usage count: how many records reference a cost centre across the system.
// Used to show "in use" on the master page and to guard de-activation.
// Counts the LIVE je_lines (never je_lines_old), expense_lines and fixed_assets.
// ---------------------------------------------------------------------------
async function getUsageCount(id) {
  // Resilient: if a referenced column does not exist yet (migration not applied),
  // return zeros instead of failing the whole request.
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM je_lines      WHERE cost_center_id = $1)::int AS je_lines,
         (SELECT COUNT(*) FROM expense_lines WHERE cost_center_id = $1)::int AS expense_lines,
         (SELECT COUNT(*) FROM fixed_assets  WHERE cost_center_id = $1)::int AS fixed_assets`,
      [id]
    );
    const r = rows[0] || { je_lines: 0, expense_lines: 0, fixed_assets: 0 };
    return { ...r, total: r.je_lines + r.expense_lines + r.fixed_assets };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[costCenters] usage count failed:', err.message);
    return { je_lines: 0, expense_lines: 0, fixed_assets: 0, total: 0 };
  }
}

// Append an audit row for a master-data change. entity_type = 'cost_center'.
// Never throws into the caller — audit failure must not break the operation,
// but it is logged so it is never silently swallowed.
async function auditMasterChange(client, { userId, costCenterId, reason }) {
  // Wrap in a SAVEPOINT so that if the audit table is missing (migration not yet
  // applied) the failed INSERT does NOT abort the surrounding transaction — which
  // would otherwise turn the caller's COMMIT into a silent ROLLBACK and lose the
  // create/update. On failure we roll back only to the savepoint and continue.
  try {
    await client.query('SAVEPOINT cc_audit');
    await client.query(
      `INSERT INTO cost_center_audit
         (user_id, entity_type, entity_id, old_cost_center_id, new_cost_center_id, reason)
       VALUES ($1, 'cost_center', $2, $2, $2, $3)`,
      [userId || null, costCenterId, reason]
    );
    await client.query('RELEASE SAVEPOINT cc_audit');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT cc_audit').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('[costCenters] audit write failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/cost-centers
// Backward compatible: with no query params it returns ACTIVE centres only
// (existing dropdown behaviour). The master page passes ?status=all&withUsage=true.
//   ?status=active | inactive | all   (default: active)
//   ?search=<text>                    (matches code or name, case-insensitive)
//   ?withUsage=true                   (adds usage_count to each row)
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const { status = 'active', search, withUsage } = req.query;

    const where = [];
    const params = [];
    if (status && status !== 'all') {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, name, code, status, created_at
         FROM cost_centers
         ${whereSql}
        ORDER BY code NULLS LAST, name`,
      params
    );

    let data = result.rows;
    if (String(withUsage) === 'true' && data.length) {
      data = await Promise.all(
        data.map(async (cc) => ({ ...cc, usage_count: (await getUsageCount(cc.id)).total }))
      );
    }

    res.json({ data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cost-centers/:id  — single centre with full usage breakdown
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, code, status, created_at
         FROM cost_centers WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cost center not found' });
    const usage = await getUsageCount(req.params.id);
    res.json({ ...rows[0], usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cost-centers  — create
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, code, description, status = 'active' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO cost_centers (name, code, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), code?.trim() || null, status]
    );
    const cc = result.rows[0];
    await auditMasterChange(client, { userId: req.user?.id, costCenterId: cc.id, reason: 'created' });
    await client.query('COMMIT');

    res.status(201).json(cc);
    dispatchEvent('master.created', cc).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ error: 'Cost center code already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/cost-centers/:id  — edit name / code / description (NOT status)
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, code, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE cost_centers
          SET name = $1, code = $2
        WHERE id = $3
        RETURNING *`,
      [name.trim(), code?.trim() || null, req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cost center not found' });
    }
    const cc = result.rows[0];
    await auditMasterChange(client, { userId: req.user?.id, costCenterId: cc.id, reason: 'updated' });
    await client.query('COMMIT');

    res.json(cc);
    dispatchEvent('master.updated', cc).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ error: 'Cost center code already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/cost-centers/:id/status  — activate / deactivate (no hard delete)
// Deactivation is the safe alternative to deletion: historical references are
// preserved, the centre simply stops appearing in active dropdowns.
router.patch('/:id/status', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE cost_centers SET status = $1
        WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cost center not found' });
    }
    const cc = result.rows[0];
    await auditMasterChange(client, {
      userId: req.user?.id,
      costCenterId: cc.id,
      reason: status === 'active' ? 'activated' : 'deactivated',
    });
    await client.query('COMMIT');

    res.json(cc);
    dispatchEvent('master.updated', cc).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/cost-centers/:id/usage  — usage breakdown (also used to guard deletes)
router.get('/:id/usage', authenticate, async (req, res) => {
  try {
    const usage = await getUsageCount(req.params.id);
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cost-centers/bulk-reassign
// Safe bulk correction capability so wrongly tagged entries can be corrected
// without affecting accounting balances.
router.post('/bulk-reassign', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { je_line_ids, new_cost_center_id, reason, preview } = req.body;
    if (!Array.isArray(je_line_ids) || je_line_ids.length === 0) {
      return res.status(400).json({ error: 'je_line_ids array is required' });
    }

    // Fetch current state
    const linesRes = await client.query(
      `SELECT jl.id AS je_line_id, jl.je_id, jl.cost_center_id AS old_cost_center_id, 
              cc_old.code AS old_cc_code, cc_old.name AS old_cc_name,
              jl.debit, jl.credit, jl.narration, a.name AS account_name
         FROM je_lines jl
         LEFT JOIN cost_centers cc_old ON cc_old.id = jl.cost_center_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.id = ANY($1)`,
      [je_line_ids]
    );

    let newCcInfo = { code: null, name: 'None' };
    if (new_cost_center_id) {
      const ccRes = await client.query('SELECT code, name FROM cost_centers WHERE id = $1', [new_cost_center_id]);
      if (ccRes.rows.length) newCcInfo = ccRes.rows[0];
    }

    const snapshot = linesRes.rows.map(row => ({
      ...row,
      new_cost_center_id: new_cost_center_id || null,
      new_cc_code: newCcInfo.code,
      new_cc_name: newCcInfo.name
    }));

    if (preview) {
      return res.json({ preview: true, lines: snapshot });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required for bulk reassignment' });
    }

    await client.query('BEGIN');
    
    // Update je_lines
    await client.query(
      `UPDATE je_lines SET cost_center_id = $1 WHERE id = ANY($2)`,
      [new_cost_center_id || null, je_line_ids]
    );

    // Audit trailing for each line
    for (const line of linesRes.rows) {
      if (line.old_cost_center_id === (new_cost_center_id || null)) continue;
      
      await client.query('SAVEPOINT bulk_audit');
      try {
        await client.query(
          `INSERT INTO cost_center_audit
             (user_id, entity_type, entity_id, old_cost_center_id, new_cost_center_id, reason)
           VALUES ($1, 'je_line', $2, $3, $4, $5)`,
          [req.user?.id || null, line.je_line_id, line.old_cost_center_id, new_cost_center_id || null, reason.trim()]
        );
        await client.query('RELEASE SAVEPOINT bulk_audit');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT bulk_audit').catch(() => {});
        // Silently swallow audit failures as per requirements
        console.error('[costCenters bulk-reassign] audit write failed:', err.message);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, updated_count: je_line_ids.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


module.exports = router;

const express = require('express');
const pool    = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category_id, status, limit = 200, offset = 0 } = req.query;
    const where  = ['1=1'];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`at.status = $${params.length}`);
    }
    if (category_id) {
      params.push(parseInt(category_id));
      where.push(`at.category_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(at.name ILIKE $${params.length} OR at.code ILIKE $${params.length}` +
        ` OR COALESCE(at.default_brand,'') ILIKE $${params.length}` +
        ` OR COALESCE(at.default_manufacturer,'') ILIKE $${params.length})`
      );
    }

    const whereClause = where.join(' AND ');
    const listParams  = [...params, parseInt(limit), parseInt(offset)];

    const [countR, listR] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM asset_templates at WHERE ${whereClause}`,
        params
      ),
      pool.query(
        `SELECT at.*,
           fac.name AS category_name,
           fac.depreciation_rate_pct,
           fac.depreciation_method,
           fac.useful_life_years,
           u.code AS uom_code,
           u.name AS uom_name,
           (SELECT COUNT(*) FROM fixed_assets fa WHERE fa.template_id = at.id) AS asset_count
         FROM asset_templates at
         JOIN fixed_asset_categories fac ON at.category_id = fac.id
         LEFT JOIN uom u ON at.default_uom_id = u.id
         WHERE ${whereClause}
         ORDER BY at.name ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      ),
    ]);

    res.json({ data: listR.rows, total: parseInt(countR.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DETAIL ────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT at.*,
         fac.name AS category_name,
         fac.depreciation_rate_pct,
         fac.depreciation_method,
         fac.useful_life_years,
         u.code AS uom_code,
         u.name AS uom_name
       FROM asset_templates at
       JOIN fixed_asset_categories fac ON at.category_id = fac.id
       LEFT JOIN uom u ON at.default_uom_id = u.id
       WHERE at.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const {
      code,
      name,
      category_id,
      default_model_no,
      default_brand,
      default_manufacturer,
      default_uom_id,
      default_useful_life,
      default_depr_rate,
      description,
      status = 'active',
    } = req.body;

    if (!name?.trim())   return res.status(400).json({ error: 'name is required' });
    if (!category_id)    return res.status(400).json({ error: 'category_id is required' });

    // Auto-generate code from name if not provided
    let templateCode = code?.trim();
    if (!templateCode) {
      templateCode = 'AT-' + name.toUpperCase()
        .replace(/[^A-Z0-9 ]/g, '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 3)
        .join('-')
        .slice(0, 27);
    }

    const r = await pool.query(
      `INSERT INTO asset_templates
         (code, name, category_id, default_model_no, default_brand,
          default_manufacturer, default_uom_id, default_useful_life,
          default_depr_rate, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        templateCode,
        name.trim(),
        parseInt(category_id),
        default_model_no   || null,
        default_brand      || null,
        default_manufacturer || null,
        default_uom_id     ? parseInt(default_uom_id) : null,
        default_useful_life ? parseFloat(default_useful_life) : null,
        default_depr_rate  ? parseFloat(default_depr_rate) : null,
        description        || null,
        ['active', 'inactive'].includes(status) ? status : 'active',
      ]
    );
    dispatchEvent('asset_template.created', { id: r.rows[0].id, code: r.rows[0].code, name: r.rows[0].name, module: 'fixed_assets' });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A template with this name or code already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
/**
 * CATEGORY CASCADE BEHAVIOUR:
 * When a template's category_id is changed, all fixed_assets linked to this template
 * (via template_id) that have NO posted depreciation runs will automatically inherit
 * the new category. Assets that already have posted depreciation are skipped to
 * preserve GL reconciliation — those require the Asset Reclassification Utility.
 */
router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the current template to detect a category change
    const currentR = await client.query(
      'SELECT * FROM asset_templates WHERE id = $1',
      [req.params.id]
    );
    if (!currentR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const currentTemplate = currentR.rows[0];
    const newCategoryId = req.body.category_id !== undefined
      ? (req.body.category_id === '' ? null : parseInt(req.body.category_id))
      : null;
    const categoryChanged = newCategoryId && newCategoryId !== parseInt(currentTemplate.category_id);

    // Build the SET clause for the template update
    const sets   = [];
    const params = [];
    const add    = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    const allowed = [
      'code', 'name', 'category_id', 'default_model_no', 'default_brand',
      'default_manufacturer', 'default_uom_id', 'default_useful_life',
      'default_depr_rate', 'description', 'status',
    ];
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        add(f, req.body[f] === '' ? null : req.body[f]);
      }
    }

    if (!sets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const r = await client.query(
      `UPDATE asset_templates SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const updatedTemplate = r.rows[0];

    // ── CASCADE category to linked fixed_assets ───────────────────────────────
    let assetsUpdated = 0;
    let assetsSkipped = 0;

    if (categoryChanged) {
      // Find all assets linked to this template
      const linkedR = await client.query(
        'SELECT id FROM fixed_assets WHERE template_id = $1',
        [req.params.id]
      );

      for (const asset of linkedR.rows) {
        // Check if this asset has any posted depreciation runs
        const deprR = await client.query(
          `SELECT COUNT(*) FROM depreciation_run_lines drl
           JOIN depreciation_runs dr ON drl.run_id = dr.id
           WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted'`,
          [asset.id]
        );
        const hasPostedDepr = parseInt(deprR.rows[0].count) > 0;

        if (hasPostedDepr) {
          // Skip — changing category after depreciation is posted requires
          // a formal Asset Reclassification Journal via the Reclassification Utility
          assetsSkipped++;
        } else {
          // Safe to update — no GL impact since depreciation has not been posted yet
          await client.query(
            'UPDATE fixed_assets SET category_id = $1, updated_at = NOW() WHERE id = $2',
            [newCategoryId, asset.id]
          );
          assetsUpdated++;
        }
      }
    }

    await client.query('COMMIT');

    dispatchEvent('asset_template.updated', {
      id: updatedTemplate.id,
      code: updatedTemplate.code,
      name: updatedTemplate.name,
      module: 'fixed_assets',
      category_cascaded: categoryChanged,
      assets_updated: assetsUpdated,
      assets_skipped: assetsSkipped,
    });

    res.json({
      ...updatedTemplate,
      category_cascaded: categoryChanged,
      assets_updated: assetsUpdated,
      assets_skipped: assetsSkipped,
      ...(assetsSkipped > 0 && {
        skip_reason: `${assetsSkipped} asset(s) have posted depreciation and were not updated. Use the Asset Reclassification Utility to move them.`,
      }),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A template with this name or code already exists' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const usageR = await pool.query(
      'SELECT COUNT(*) FROM fixed_assets WHERE template_id = $1',
      [req.params.id]
    );
    const count = parseInt(usageR.rows[0].count);
    if (count > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${count} asset${count > 1 ? 's' : ''} reference this template. Deactivate instead.`,
      });
    }
    const r = await pool.query(
      'DELETE FROM asset_templates WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    dispatchEvent('asset_template.deleted', { id: parseInt(req.params.id), module: 'fixed_assets' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

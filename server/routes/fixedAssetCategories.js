const express = require('express');
const pool    = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

const SELECT = `
  SELECT fac.*,
    a1.code as gl_asset_code,   a1.name as gl_asset_name,
    a2.code as gl_accum_code,   a2.name as gl_accum_name,
    a3.code as gl_depr_code,    a3.name as gl_depr_name
  FROM fixed_asset_categories fac
  LEFT JOIN accounts a1 ON fac.gl_asset_account_id        = a1.id
  LEFT JOIN accounts a2 ON fac.gl_accum_depr_account_id   = a2.id
  LEFT JOIN accounts a3 ON fac.gl_depr_expense_account_id = a3.id
`;

router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let q = SELECT + ' WHERE 1=1';
    const params = [];
    if (status) { params.push(status); q += ` AND fac.status = $${params.length}`; }
    q += ' ORDER BY fac.code';
    const result = await pool.query(q, params);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssetCategories.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(SELECT + ' WHERE fac.id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssetCategories.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
            gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id, status } = req.body;
    const result = await pool.query(
      `INSERT INTO fixed_asset_categories
         (code,name,depreciation_rate_pct,depreciation_method,useful_life_years,
          gl_asset_account_id,gl_accum_depr_account_id,gl_depr_expense_account_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, name, depreciation_rate_pct, depreciation_method || 'SLM', useful_life_years || null,
       gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id, status || 'active']
    );
    dispatchEvent('fa_category.created', { id: result.rows[0].id, code, name, module: 'fixed_assets' });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
            gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id, status } = req.body;
    const result = await pool.query(
      `UPDATE fixed_asset_categories SET
         code=$1, name=$2, depreciation_rate_pct=$3, depreciation_method=$4, useful_life_years=$5,
         gl_asset_account_id=$6, gl_accum_depr_account_id=$7, gl_depr_expense_account_id=$8, status=$9
       WHERE id=$10 RETURNING *`,
      [code, name, depreciation_rate_pct, depreciation_method || 'SLM', useful_life_years || null,
       gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id,
       status || 'active', req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    dispatchEvent('fa_category.updated', { id: result.rows[0].id, code: result.rows[0].code, name: result.rows[0].name, module: 'fixed_assets' });
    res.json(result.rows[0]);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssetCategories.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM fixed_asset_categories WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    dispatchEvent('fa_category.deleted', { id: parseInt(req.params.id), module: 'fixed_assets' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Cannot delete: referenced by assets or items' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

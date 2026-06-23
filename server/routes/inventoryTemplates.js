const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Auto-create tables if they don't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS inventory_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    columns_config JSONB DEFAULT '[]',
    filters_config JSONB DEFAULT '{}',
    created_by INT REFERENCES users(id) ON DELETE CASCADE,
    is_global BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => {
  return pool.query(`
    CREATE TABLE IF NOT EXISTS template_shares (
      template_id INT REFERENCES inventory_templates(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, user_id)
    );
  `);
}).catch(err => {
  console.error("Error creating inventory templates tables:", err);
});

// GET templates accessible by the current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    // Get templates created by user, shared with user, or global
    const q = `
      SELECT t.*, u.full_name 
      FROM inventory_templates t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.created_by = $1 
         OR t.is_global = true
         OR t.id IN (SELECT template_id FROM template_shares WHERE user_id = $1)
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(q, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET templates error:', err);
    res.status(500).json({ error: 'Server error fetching templates', details: err.message, stack: err.stack });
  }
});

// POST create a new template
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, columns_config, filters_config, is_global } = req.body;
    
    // Only admins/superadmins can create global templates
    let globalFlag = false;
    if (is_global && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
      globalFlag = true;
    }

    const q = `
      INSERT INTO inventory_templates (name, columns_config, filters_config, created_by, is_global)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [name, JSON.stringify(columns_config || []), JSON.stringify(filters_config || {}), userId, globalFlag];
    const result = await pool.query(q, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating template' });
  }
});

// PUT update a template
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;
    const { name, columns_config, filters_config } = req.body;

    // Check ownership
    const check = await pool.query('SELECT * FROM inventory_templates WHERE id = $1', [templateId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    
    const template = check.rows[0];
    if (template.created_by !== userId && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized to update this template' });
    }

    const q = `
      UPDATE inventory_templates 
      SET name = COALESCE($1, name),
          columns_config = COALESCE($2, columns_config),
          filters_config = COALESCE($3, filters_config)
      WHERE id = $4
      RETURNING *
    `;
    const values = [
      name, 
      columns_config ? JSON.stringify(columns_config) : null, 
      filters_config ? JSON.stringify(filters_config) : null, 
      templateId
    ];
    const result = await pool.query(q, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating template' });
  }
});

// DELETE a template
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;

    // Check ownership
    const check = await pool.query('SELECT * FROM inventory_templates WHERE id = $1', [templateId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    
    const template = check.rows[0];
    if (template.created_by !== userId && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized to delete this template' });
    }

    await pool.query('DELETE FROM inventory_templates WHERE id = $1', [templateId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting template' });
  }
});

// POST share a template
router.post('/:id/share', async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;
    const { target_user_id } = req.body;

    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only admins can share templates' });
    }

    const check = await pool.query('SELECT * FROM inventory_templates WHERE id = $1', [templateId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    // Upsert share record
    const q = `
      INSERT INTO template_shares (template_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (template_id, user_id) DO NOTHING
    `;
    await pool.query(q, [templateId, target_user_id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error sharing template' });
  }
});

module.exports = router;

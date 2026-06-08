const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/cost-centers
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, status, created_at
       FROM cost_centers
       WHERE status = 'active'
       ORDER BY code NULLS LAST, name`
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cost-centers
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { name, code, status = 'active' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const result = await pool.query(
      `INSERT INTO cost_centers (name, code, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), code?.trim() || null, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Cost center code already exists' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

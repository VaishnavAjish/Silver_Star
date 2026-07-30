'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const pool = require('../db/pool');
const { correctLotName, reopenBatch } = require('../services/nidhiConnectService');

/**
 * GET /api/nidhi-connect/lots
 */
router.get('/lots', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, b.status as batch_status, s.series_prefix
       FROM import_row_lots r
       JOIN import_batches b ON r.batch_id = b.id
       JOIN lot_series s ON r.lot_series_id = s.id
       ORDER BY r.id DESC LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/nidhi-connect/lots/:id/correct-name
 * Body: { new_lot_name, reason, expected_row_version }
 */
router.post('/lots/:id/correct-name', authenticate, authorize('admin', 'super_admin', 'operator'), async (req, res) => {
  try {
    const importRowLotId = parseInt(req.params.id, 10);
    const { new_lot_name, reason, expected_row_version } = req.body;
    const requestId = req.headers['x-request-id'] || null;

    const updatedLot = await correctLotName({
      importRowLotId,
      newLotName: new_lot_name,
      reason,
      actorId: req.user ? req.user.id : 1,
      requestId,
      expectedRowVersion: expected_row_version !== undefined ? expected_row_version : null,
    });

    res.json({
      success: true,
      message: 'Lot name corrected successfully',
      lot: updatedLot,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.message,
      code: err.code || 'CORRECT_LOT_NAME_ERROR',
    });
  }
});

/**
 * POST /api/nidhi-connect/batches/:id/reopen
 */
router.post('/batches/:id/reopen', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const batch = await reopenBatch(batchId, req.user ? req.user.id : 1);
    res.json({
      success: true,
      message: 'Batch reopened successfully',
      batch,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

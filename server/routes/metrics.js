const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { snapshot, getBridgeStatus } = require('../services/metricsService');

const router = express.Router();

// GET /metrics - Prometheus-format metrics (admin only)
router.get('/', authenticate, authorize('admin'), (req, res) => {
  res.type('text/plain');
  res.send(snapshot());
});

// GET /metrics/bridges - Bridge connectivity status
router.get('/bridges', authenticate, authorize('admin'), (req, res) => {
  res.json(getBridgeStatus());
});

module.exports = router;

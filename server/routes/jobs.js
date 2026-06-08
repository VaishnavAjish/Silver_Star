/**
 * ─── Silverstar Grow — Job Status API ────────────────────────────────────────
 *
 * Clients poll this endpoint to check the status of background jobs.
 * GET /api/jobs/:id — returns job status and result if completed
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getJob } = require('../services/queueService');

const router = express.Router();

// GET /api/jobs/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

'use strict';

/**
 * Vendor Advance Consumption — API routes
 *
 *   GET  /api/vendor-advances/available/:vendorId   → OPEN advances + total
 *   GET  /api/vendor-advances/position/:vendorId    → outstanding / advances / net
 *   POST /api/vendor-advances/apply                 → apply advances to a bill
 *
 * Auth + RLS are applied globally in app.js for all /api routes.
 */

const express = require('express');
const pool = require('../db/pool');
const {
  getOpenAdvances,
  getAvailableAdvanceTotal,
  getVendorPosition,
  applyAdvancesToBill,
} = require('../services/vendorAdvanceService');

const router = express.Router();

// ── Available (unapplied) advances for a vendor ──────────────────────────────
router.get('/available/:vendorId', async (req, res) => {
  try {
    const vendorId = parseInt(req.params.vendorId, 10);
    if (!Number.isInteger(vendorId)) {
      return res.status(400).json({ ok: false, error: 'Invalid vendor id' });
    }
    const [advances, total] = await Promise.all([
      getOpenAdvances(vendorId),
      getAvailableAdvanceTotal(vendorId),
    ]);
    res.json({ ok: true, vendor_id: vendorId, total_available: total, advances });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Net vendor position (outstanding bills, advances, net) ───────────────────
router.get('/position/:vendorId', async (req, res) => {
  try {
    const vendorId = parseInt(req.params.vendorId, 10);
    if (!Number.isInteger(vendorId)) {
      return res.status(400).json({ ok: false, error: 'Invalid vendor id' });
    }
    const position = await getVendorPosition(vendorId);
    res.json({ ok: true, vendor_id: vendorId, ...position });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Apply advances against a bill (auto FIFO or manual allocations) ──────────
router.post('/apply', async (req, res) => {
  const { purchase_note_id, vendor_id, mode, allocations } = req.body || {};

  if (!purchase_note_id || !Number.isInteger(parseInt(purchase_note_id, 10))) {
    return res.status(400).json({ ok: false, error: 'purchase_note_id is required' });
  }
  if (mode && !['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ ok: false, error: "mode must be 'auto' or 'manual'" });
  }

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const result = await applyAdvancesToBill({
      purchaseNoteId: parseInt(purchase_note_id, 10),
      vendorId: vendor_id ? parseInt(vendor_id, 10) : undefined,
      mode: mode || 'auto',
      allocations: Array.isArray(allocations) ? allocations : null,
      userId: req.user && req.user.id,
      client,
    });
    await client.query('COMMIT');
    res.json({ ok: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const billTdsService = require('../services/billTdsService');

/**
 * Bill TDS Withholding Routes — Silverstar Grow ERP
 */

// GET /api/purchase-notes/:id/tds — Fetch active TDS withholding for a Bill
router.get('/purchase-notes/:id/tds', authenticate, authorize('admin', 'accountant'), async (req, res) => {
  try {
    const billId = parseInt(req.params.id);
    const withholding = await billTdsService.getBillTdsWithholding(billId);
    res.json({ withholding });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/purchase-notes/:id/tds — Add TDS withholding to an existing Bill
router.post('/purchase-notes/:id/tds', authenticate, authorize('admin', 'accountant'), async (req, res) => {
  try {
    const billId = parseInt(req.params.id);
    const { tds_amount, nature, section_reference, rate_percent, remarks, vendor_id } = req.body;

    const result = await billTdsService.createBillTdsWithholding({
      purchaseNoteId: billId,
      vendorId: vendor_id ? parseInt(vendor_id) : null,
      tdsAmount: tds_amount,
      nature,
      sectionReference: section_reference,
      ratePercent: rate_percent,
      remarks,
      userId: req.user.id,
    });

    res.status(201).json({
      message: 'TDS withholding created successfully',
      withholding: result.withholding,
      posting_je_number: result.je?.je_number || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/purchase-notes/:id/tds — Update/Replace TDS withholding
router.put('/purchase-notes/:id/tds', authenticate, authorize('admin', 'accountant'), async (req, res) => {
  try {
    const billId = parseInt(req.params.id);
    const { tds_amount, nature, section_reference, rate_percent, remarks } = req.body;

    const result = await billTdsService.replaceBillTdsWithholding({
      purchaseNoteId: billId,
      tdsAmount: tds_amount,
      nature,
      sectionReference: section_reference,
      ratePercent: rate_percent,
      remarks,
      userId: req.user.id,
    });

    res.json({
      message: 'TDS withholding updated successfully',
      withholding: result.withholding,
      metadataOnly: result.metadataOnly || false,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/purchase-notes/:id/tds/reverse — Reverse active TDS withholding
router.post('/purchase-notes/:id/tds/reverse', authenticate, authorize('admin', 'accountant'), async (req, res) => {
  try {
    const billId = parseInt(req.params.id);
    const { withholding_id, reason } = req.body;

    let targetWithholdingId = withholding_id ? parseInt(withholding_id) : null;
    if (!targetWithholdingId) {
      const active = await billTdsService.getBillTdsWithholding(billId);
      if (!active) {
        return res.status(404).json({ error: `No active TDS withholding found for Bill #${billId}.` });
      }
      targetWithholdingId = active.id;
    }

    const result = await billTdsService.reverseBillTdsWithholding({
      withholdingId: targetWithholdingId,
      reason: reason || 'TDS withholding manually reversed',
      userId: req.user.id,
    });

    res.json({
      message: result.alreadyReversed ? 'TDS withholding already reversed' : 'TDS withholding reversed successfully',
      withholding: result.withholding,
      reversal_je_number: result.je?.je_number || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

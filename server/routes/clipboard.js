const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

const router = express.Router();

const CLIPBOARD_MAX = 100;

const VALID_TYPES = new Set([
  'inventory', 'invoice', 'voucher', 'account',
  'customer', 'vendor', 'fixed_asset',
]);

// GET /api/clipboard — list current user's items newest-first
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, entity_type, entity_id, label, added_at
       FROM user_clipboard
       WHERE user_id = $1
       ORDER BY added_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error('Clipboard GET error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clipboard — add one item (upsert on duplicate)
router.post('/', authenticate, async (req, res) => {
  try {
    const { entity_type, entity_id, label } = req.body;

    if (!entity_type || !entity_id || !label) {
      return res.status(400).json({ error: 'entity_type, entity_id, and label are required' });
    }
    if (!VALID_TYPES.has(entity_type)) {
      return res.status(400).json({ error: `Invalid entity_type: ${entity_type}` });
    }

    // Atomic upsert with cap enforcement.
    // The WHERE allows the INSERT when the item already exists (upsert path)
    // OR when the count is under the cap (new-item path). ON CONFLICT then
    // handles the upsert. Returns empty when cap would be exceeded by a new item.
    const { rows } = await pool.query(
      `INSERT INTO user_clipboard (user_id, entity_type, entity_id, label)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (
         SELECT 1 FROM user_clipboard
         WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
       ) OR (SELECT COUNT(*) FROM user_clipboard WHERE user_id = $1) < $5
       ON CONFLICT (user_id, entity_type, entity_id)
       DO UPDATE SET label = EXCLUDED.label, added_at = now()
       RETURNING id, entity_type, entity_id, label, added_at`,
      [req.user.id, entity_type, entity_id.toString(), label, CLIPBOARD_MAX]
    );

    if (!rows.length) {
      return res.status(422).json({ error: 'Clipboard full — clear some items first' });
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Clipboard POST error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clipboard/:id — remove one item (must belong to this user)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM user_clipboard WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Clipboard DELETE/:id error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clipboard — clear all for this user
router.delete('/', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_clipboard WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Clipboard DELETE all error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clipboard/bulk-action
router.post('/bulk-action', authenticate, async (req, res) => {
  try {
    const { action, ids } = req.body;

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'action and ids[] are required' });
    }

    // Fetch the selected clipboard rows — enforce ownership
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const { rows: items } = await pool.query(
      `SELECT id, entity_type, entity_id, label
       FROM user_clipboard
       WHERE user_id = $1 AND id IN (${placeholders})`,
      [req.user.id, ...ids]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No matching clipboard items found' });
    }

    // All selected items must be the same entity_type
    const types = [...new Set(items.map(r => r.entity_type))];
    if (types.length > 1) {
      return res.status(400).json({ error: 'All selected items must be the same type' });
    }
    const entityType = types[0];

    // ── Action handlers ────────────────────────────────────────────────────────

    if (action === 'print_labels') {
      if (entityType !== 'inventory') {
        return res.status(400).json({ error: 'Print labels is only available for lots' });
      }
      const lotIds = items.map(r => r.entity_id).join(',');
      return res.json({ redirect_url: `/labels/print?ids=${lotIds}` });
    }

    if (action === 'create_mix_lot') {
      if (entityType !== 'inventory') {
        return res.status(400).json({ error: 'Mix lot is only available for inventory lots' });
      }
      const lotIds = items.map(r => r.entity_id).join(',');
      return res.json({ redirect_url: `/inventory/mix?ids=${lotIds}` });
    }

    if (action === 'bulk_pdf') {
      if (entityType !== 'invoice') {
        return res.status(400).json({ error: 'Bulk PDF is only available for invoices' });
      }
      const invoiceIds = items.map(r => r.entity_id).join(',');
      return res.json({ redirect_url: `/invoices?bulk=${invoiceIds}` });
    }

    if (action === 'mark_as_paid') {
      if (entityType !== 'invoice') {
        return res.status(400).json({ error: 'Mark as paid is only available for invoices' });
      }
      // Admin only
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can bulk-mark invoices as paid' });
      }
      const invoiceEntityIds = items.map(r => r.entity_id);
      const ph = invoiceEntityIds.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `UPDATE invoices SET payment_status = 'PAID', status = 'closed'
         WHERE id IN (${ph})`,
        invoiceEntityIds
      );
      return res.json({ ok: true, updated: invoiceEntityIds.length });
    }

    if (action === 'open_journal') {
      if (entityType !== 'account') {
        return res.status(400).json({ error: 'Open journal is only available for accounts' });
      }
      const accountIds = items.map(r => r.entity_id).join(',');
      return res.json({ redirect_url: `/ledger?accounts=${accountIds}` });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    logger.error('Clipboard bulk-action error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

/**
 * Quick-Create Routes
 * POST /api/quick-create/vendors    → creates vendor + auto-creates payable ledger
 * POST /api/quick-create/customers  → creates customer + auto-creates receivable ledger
 * POST /api/quick-create/accounts   → creates GL account
 *
 * Designed for inline "+ Add New" modals inside dropdowns.
 */
const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { reserveCode } = require('../services/codeGeneratorService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ── POST /api/quick-create/vendors ────────────────────────────────────────────
router.post('/vendors', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const name = (req.body.name || '').trim();
    if (!name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Name is required' }); }

    // Auto-generate code if caller does not supply one
    const code = (req.body.code || '').trim() || await reserveCode('vendor', client);

    const vendorResult = await client.query(
      `INSERT INTO vendors (code, name) VALUES ($1, $2) RETURNING *`,
      [code, name]
    );
    const vendor = vendorResult.rows[0];

    // Auto-create payable ledger — atomic: failure rolls back the whole transaction
    const acctResult = await client.query(
      `INSERT INTO accounts (code, name, type, sub_type, is_group, currency)
       VALUES ($1, $2, 'liability', 'payable', false, 'INR')
       RETURNING id, code, name, type, sub_type`,
      [`AP-${code}`, `${name} - Payable`]
    );
    const account = acctResult.rows[0];

    await client.query('COMMIT');
    dispatchEvent('vendor.created', { id: vendor.id, code: vendor.code, name: vendor.name, module: 'purchasing' });
    res.status(201).json({ ...vendor, account });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Vendor code or payable account already exists' });
    logger.error('[quickCreate/vendors]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/quick-create/customers ──────────────────────────────────────────
router.post('/customers', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const name = (req.body.name || '').trim();
    if (!name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Name is required' }); }

    // Auto-generate code if caller does not supply one
    const code = (req.body.code || '').trim() || await reserveCode('customer', client);

    const custResult = await client.query(
      `INSERT INTO customers (code, name) VALUES ($1, $2) RETURNING *`,
      [code, name]
    );
    const customer = custResult.rows[0];

    // Auto-create receivable ledger — atomic: failure rolls back the whole transaction
    const acctResult = await client.query(
      `INSERT INTO accounts (code, name, type, sub_type, is_group, currency)
       VALUES ($1, $2, 'asset', 'receivable', false, 'INR')
       RETURNING id, code, name, type, sub_type`,
      [`AR-${code}`, `${name} - Receivable`]
    );
    const account = acctResult.rows[0];

    await client.query('COMMIT');
    dispatchEvent('customer.created', { id: customer.id, code: customer.code, name: customer.name, module: 'sales' });
    res.status(201).json({ ...customer, account });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Customer code or receivable account already exists' });
    logger.error('[quickCreate/customers]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/quick-create/accounts ───────────────────────────────────────────
router.post('/accounts', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const code     = (req.body.code     || '').trim();
    const name     = (req.body.name     || '').trim();
    const type     = (req.body.type     || 'revenue').trim();
    const sub_type = (req.body.sub_type || '').trim() || null;

    if (!code || !name) return res.status(400).json({ error: 'Code and name are required' });

    const VALID_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `Invalid type: ${type}` });

    const result = await pool.query(
      `INSERT INTO accounts (code, name, type, sub_type, is_group, currency)
       VALUES ($1, $2, $3, $4, false, 'INR')
       RETURNING id, code, name, type, sub_type`,
      [code, name, type, sub_type]
    );
    dispatchEvent('account.created', { id: result.rows[0].id, code, name, type, sub_type, module: 'accounting' });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Account code or name already exists' });
    logger.error('[quickCreate/accounts]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { reserveCode } = require('../services/codeGeneratorService');
const { logger } = require('../middleware/logger');

const router = express.Router();

/**
 * GET /api/transfers
 * Fetch all transfers
 */
router.get('/', authenticate, authorize('admin', 'operator', 'viewer'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search, fromDate, toDate } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT t.*, 
             fa.name as from_account_name, fa.code as from_account_code,
             ta.name as to_account_name, ta.code as to_account_code,
             u.full_name as created_by_name
      FROM transfers t
      JOIN accounts fa ON t.from_account_id = fa.id
      JOIN accounts ta ON t.to_account_id = ta.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (search) {
      query += ` AND (t.transfer_no ILIKE $${paramIdx} OR t.reference_no ILIKE $${paramIdx} OR t.memo ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (fromDate) {
      query += ` AND t.transfer_date >= $${paramIdx}`;
      params.push(fromDate);
      paramIdx++;
    }

    if (toDate) {
      query += ` AND t.transfer_date <= $${paramIdx}`;
      params.push(toDate);
      paramIdx++;
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS c`;
    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    query += ` ORDER BY t.transfer_date DESC, t.id DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      data: result.rows,
      meta: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching transfers', err);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

/**
 * GET /api/transfers/:id
 */
router.get('/:id', authenticate, authorize('admin', 'operator', 'viewer'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT t.*, 
             fa.name as from_account_name, fa.code as from_account_code, fa.current_balance as from_account_balance,
             ta.name as to_account_name, ta.code as to_account_code, ta.current_balance as to_account_balance,
             d.name as department_name, c.name as cost_center_name
      FROM transfers t
      JOIN accounts fa ON t.from_account_id = fa.id
      JOIN accounts ta ON t.to_account_id = ta.id
      LEFT JOIN departments d ON t.department_id = d.id
      LEFT JOIN cost_centers c ON t.cost_center_id = c.id
      WHERE t.id = $1
    `, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error fetching transfer', err);
    res.status(500).json({ error: 'Failed to fetch transfer' });
  }
});

/**
 * POST /api/transfers
 * Create and post a new transfer
 */
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { 
      transfer_date, 
      from_account_id, 
      to_account_id, 
      amount, 
      reference_no, 
      memo, 
      department_id, 
      cost_center_id, 
      attachment 
    } = req.body;

    // 1. Validation
    if (!transfer_date) throw new Error('Transfer date is required');
    if (!from_account_id || !to_account_id) throw new Error('Both From and To accounts are required');
    if (from_account_id === to_account_id) throw new Error('Cannot transfer to the same account');
    if (!amount || parseFloat(amount) <= 0) throw new Error('Amount must be greater than zero');

    // 2. Validate Accounts
    const accQuery = await client.query(`
      SELECT id, name, is_group, sub_type, status 
      FROM accounts 
      WHERE id IN ($1, $2)
    `, [from_account_id, to_account_id]);

    if (accQuery.rows.length !== 2) throw new Error('One or both accounts not found');

    for (const acc of accQuery.rows) {
      if (acc.is_group) throw new Error(`Account ${acc.name} is a group account and cannot be posted to`);
      if (acc.status !== 'active') throw new Error(`Account ${acc.name} is inactive`);
    }

    // 3. Generate Transfer Number
    const transfer_no = await reserveCode('transfer', client, { date: transfer_date });

    // 4. Create Journal Entry lines
    // For a transfer: Debit the TO account, Credit the FROM account
    const jeLines = [
      {
        accountId: to_account_id, // Debit
        debit: amount,
        credit: 0,
        narration: memo || `Transfer from ${accQuery.rows.find(a => String(a.id) === String(from_account_id)).name}`
      },
      {
        accountId: from_account_id, // Credit
        debit: 0,
        credit: amount,
        narration: memo || `Transfer to ${accQuery.rows.find(a => String(a.id) === String(to_account_id)).name}`
      }
    ];

    // 5. Post Journal Entry
    const je = await journalEngine.createEntry({
      date: transfer_date,
      description: `Internal Transfer ${transfer_no} - ${reference_no || ''}`,
      sourceType: 'transfer',
      sourceId: null, // We'll update this after creating the transfer record
      lines: jeLines
    }, client);

    // 6. Save Transfer Record
    const result = await client.query(`
      INSERT INTO transfers (
        transfer_no, transfer_date, from_account_id, to_account_id, amount,
        reference_no, memo, department_id, cost_center_id, attachment, je_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, transfer_no
    `, [
      transfer_no, transfer_date, from_account_id, to_account_id, amount,
      reference_no || null, memo || null, department_id || null, cost_center_id || null, 
      attachment || null, je.id, req.user.id
    ]);

    const newTransferId = result.rows[0].id;

    // 7. Update JE sourceId
    await client.query(`UPDATE journal_entries SET source_id = $1 WHERE id = $2`, [newTransferId, je.id]);

    await client.query('COMMIT');
    res.json({ success: true, id: newTransferId, transfer_no: result.rows[0].transfer_no });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error creating transfer', err);
    res.status(400).json({ error: err.message || 'Failed to create transfer' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/transfers/:id
 * Reverse a transfer
 */
router.delete('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    
    // Check if transfer exists and is not already reversed
    const tResult = await client.query(`SELECT * FROM transfers WHERE id = $1`, [id]);
    if (!tResult.rows.length) throw new Error('Transfer not found');
    const transfer = tResult.rows[0];
    
    if (transfer.status === 'reversed') {
      throw new Error('Transfer is already reversed');
    }

    if (!transfer.je_id) {
      throw new Error('No journal entry linked to this transfer');
    }

    // Use Journal Engine to reverse
    const reverseJE = await journalEngine.reverseEntry(transfer.je_id, client, req.user.id, `Reversal of Transfer ${transfer.transfer_no}`);

    // Update status
    await client.query(`UPDATE transfers SET status = 'reversed', updated_at = NOW() WHERE id = $1`, [id]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Transfer reversed successfully' });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error reversing transfer', err);
    res.status(400).json({ error: err.message || 'Failed to reverse transfer' });
  } finally {
    client.release();
  }
});

module.exports = router;

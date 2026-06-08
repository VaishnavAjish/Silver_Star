const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { reserveCode } = require('../services/codeGeneratorService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function validateLines(lines, client) {
  // Returns { validatedLines, totalAmount } or throws with a user-friendly message
  let totalAmount = 0;
  const validatedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const amount = Math.round((parseFloat(line.amount) || 0) * 100) / 100;

    if (amount <= 0)
      throw Object.assign(new Error(`Line ${lineNum}: amount must be greater than 0`), { status: 400 });
    if (!line.account_id)
      throw Object.assign(new Error(`Line ${lineNum}: account is required`), { status: 400 });

    const accId = parseInt(line.account_id);
    if (isNaN(accId))
      throw Object.assign(new Error(`Line ${lineNum}: invalid account_id`), { status: 400 });

    const accResult = await client.query(
      `SELECT id, name, sub_type FROM accounts WHERE id = $1 AND status = 'active'`, [accId]
    );
    if (!accResult.rows[0])
      throw Object.assign(new Error(`Line ${lineNum}: account not found or inactive`), { status: 400 });

    const lineAcc = accResult.rows[0];
    if (lineAcc.sub_type === 'bank' || lineAcc.sub_type === 'cash')
      throw Object.assign(
        new Error(`Line ${lineNum}: cannot use bank/cash account "${lineAcc.name}" as a credit line`),
        { status: 400 }
      );

    totalAmount += amount;
    validatedLines.push({
      account_id:          accId,
      received_from_type:  line.received_from_type || null,
      received_from_id:    line.received_from_id ? parseInt(line.received_from_id) : null,
      party_name:          line.party_name         || null,
      description:         line.description        || null,
      amount,
      payment_method:      line.payment_method     || null,
      ref_no:              line.ref_no             || null,
    });
  }

  return { validatedLines, totalAmount: Math.round(totalAmount * 100) / 100 };
}

function buildJELines(bankAccountId, totalAmount, memo, validatedLines) {
  return [
    {
      accountId: parseInt(bankAccountId),
      debit:     totalAmount,
      credit:    0,
      narration: `Bank Deposit${memo ? ' - ' + memo : ''}`,
    },
    ...validatedLines.map(l => ({
      accountId: l.account_id,
      debit:     0,
      credit:    l.amount,
      narration: l.description || `Receipt from ${l.party_name || 'Unknown'}`,
    })),
  ];
}

// ─── GET /api/bank-deposits ───────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    const offset = (page - 1) * pageSize;

    const [dataR, countR] = await Promise.all([
      pool.query(
        `SELECT bd.*, a.name AS bank_account_name, u.full_name AS created_by_name,
                je.status AS je_status, je.je_number
         FROM bank_deposits bd
         LEFT JOIN accounts a ON bd.bank_account_id = a.id
         LEFT JOIN users u ON bd.created_by = u.id
         LEFT JOIN journal_entries je ON bd.je_id = je.id
         ORDER BY bd.date DESC, bd.id DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM bank_deposits bd`)
    ]);

    const totalCount = parseInt(countR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({ success: true, data: dataR.rows, totalCount, page, pageSize, totalPages });
  } catch (err) {
    logger.error('[bankDeposits GET]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bank-deposits/:id ───────────────────────────────────────────────

router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const headerResult = await pool.query(
      `SELECT bd.*, a.name AS bank_account_name, u.full_name AS created_by_name,
              je.status AS je_status, je.je_number
       FROM bank_deposits bd
       LEFT JOIN accounts a ON bd.bank_account_id = a.id
       LEFT JOIN users u ON bd.created_by = u.id
       LEFT JOIN journal_entries je ON bd.je_id = je.id
       WHERE bd.id = $1`,
      [id]
    );
    if (!headerResult.rows[0]) return res.status(404).json({ error: 'Deposit not found' });

    const linesResult = await pool.query(
      `SELECT bdl.*, a.name AS account_name, a.code AS account_code
       FROM bank_deposit_lines bdl
       LEFT JOIN accounts a ON bdl.account_id = a.id
       WHERE bdl.deposit_id = $1
       ORDER BY bdl.id`,
      [id]
    );

    res.json({ success: true, data: { ...headerResult.rows[0], lines: linesResult.rows } });
  } catch (err) {
    logger.error('[bankDeposits GET /:id]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/bank-deposits (create) ────────────────────────────────────────

router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { date, bank_account_id, memo, lines } = req.body;

    if (!date)                                       { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Date is required' }); }
    if (!bank_account_id)                            { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bank account is required' }); }
    if (!Array.isArray(lines) || lines.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'At least one deposit line is required' }); }

    const bankAccResult = await client.query(
      `SELECT id, name, sub_type FROM accounts WHERE id = $1 AND status = 'active'`,
      [parseInt(bank_account_id)]
    );
    if (!bankAccResult.rows[0])                      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bank account not found or inactive' }); }
    const bankAcc = bankAccResult.rows[0];
    if (bankAcc.sub_type !== 'bank' && bankAcc.sub_type !== 'cash')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: `Account "${bankAcc.name}" is not a bank or cash account` }); }

    const { validatedLines, totalAmount } = await validateLines(lines, client);

    const docNumber = await reserveCode('bank_deposit', client, { date });

    const je = await journalEngine.createEntry({
      date,
      description: `Bank Deposit ${docNumber} - ${bankAcc.name}`,
      sourceType:  'bank_deposit',
      sourceId:    null,
      lines:       buildJELines(bank_account_id, totalAmount, memo, validatedLines),
      autoPost:    true,
      createdBy:   req.user.id,
      client,
    });

    const depositResult = await client.query(
      `INSERT INTO bank_deposits (date, bank_account_id, total_amount, memo, je_id, doc_number, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7)
       RETURNING *`,
      [date, parseInt(bank_account_id), totalAmount, memo || null, je.id, docNumber, req.user.id]
    );
    const deposit = depositResult.rows[0];

    const insertedLines = [];
    for (const line of validatedLines) {
      const r = await client.query(
        `INSERT INTO bank_deposit_lines
           (deposit_id, received_from_type, received_from_id, party_name,
            account_id, description, amount, payment_method, ref_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [deposit.id, line.received_from_type, line.received_from_id, line.party_name,
         line.account_id, line.description, line.amount, line.payment_method, line.ref_no]
      );
      insertedLines.push(r.rows[0]);
    }

    await client.query('UPDATE journal_entries SET source_id = $1 WHERE id = $2', [deposit.id, je.id]);
    await client.query('COMMIT');
    dispatchEvent('bank_deposit.created', { id: deposit.id, doc_number: docNumber, total_amount: totalAmount, module: 'banking' });

    res.status(201).json({
      success: true, id: deposit.id, doc_number: docNumber, je_number: je.je_number,
      total_amount: totalAmount, bank_account_name: bankAcc.name, lines: insertedLines,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[bankDeposits POST]', { error: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/bank-deposits/:id (edit — draft deposits only) ─────────────────

router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id);
    if (isNaN(id)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid ID' }); }

    const depResult = await client.query(
      `SELECT bd.*, je.status AS je_status
       FROM bank_deposits bd
       LEFT JOIN journal_entries je ON bd.je_id = je.id
       WHERE bd.id = $1`,
      [id]
    );
    if (!depResult.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deposit not found' }); }
    const dep = depResult.rows[0];

    if (dep.status === 'reversed')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reversed. Cannot edit a reversed deposit.' }); }
    if (dep.je_status === 'posted')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot edit posted deposit. Reverse first.' }); }

    const { date, bank_account_id, memo, lines } = req.body;
    if (!date)                                       { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Date is required' }); }
    if (!bank_account_id)                            { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bank account is required' }); }
    if (!Array.isArray(lines) || lines.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'At least one line is required' }); }

    const bankAccResult = await client.query(
      `SELECT id, name, sub_type FROM accounts WHERE id = $1 AND status = 'active'`,
      [parseInt(bank_account_id)]
    );
    if (!bankAccResult.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Bank account not found or inactive' }); }
    const bankAcc = bankAccResult.rows[0];
    if (bankAcc.sub_type !== 'bank' && bankAcc.sub_type !== 'cash')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: `Account "${bankAcc.name}" is not a bank or cash account` }); }

    const { validatedLines, totalAmount } = await validateLines(lines, client);

    await client.query(
      `UPDATE bank_deposits SET date = $1, bank_account_id = $2, total_amount = $3, memo = $4, updated_at = NOW()
       WHERE id = $5`,
      [date, parseInt(bank_account_id), totalAmount, memo || null, id]
    );

    await client.query('DELETE FROM bank_deposit_lines WHERE deposit_id = $1', [id]);
    for (const line of validatedLines) {
      await client.query(
        `INSERT INTO bank_deposit_lines
           (deposit_id, received_from_type, received_from_id, party_name,
            account_id, description, amount, payment_method, ref_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, line.received_from_type, line.received_from_id, line.party_name,
         line.account_id, line.description, line.amount, line.payment_method, line.ref_no]
      );
    }

    // Update draft JE header + lines if one is linked
    if (dep.je_id) {
      await client.query('DELETE FROM je_lines WHERE je_id = $1', [dep.je_id]);
      for (const jl of buildJELines(bank_account_id, totalAmount, memo, validatedLines)) {
        await client.query(
          `INSERT INTO je_lines (je_id, account_id, debit, credit, narration) VALUES ($1, $2, $3, $4, $5)`,
          [dep.je_id, jl.accountId, jl.debit, jl.credit, jl.narration]
        );
      }
      await client.query(
        `UPDATE journal_entries SET date = $1, total_debit = $2, total_credit = $2, description = $3 WHERE id = $4`,
        [date, totalAmount, `Bank Deposit - ${bankAcc.name}`, dep.je_id]
      );
    }

    await client.query('COMMIT');
    dispatchEvent('bank_deposit.updated', { id, module: 'banking' });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[bankDeposits PUT]', { error: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── POST /api/bank-deposits/:id/reverse ─────────────────────────────────────

router.post('/:id/reverse', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id);
    if (isNaN(id)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid ID' }); }

    const depResult = await client.query(
      `SELECT bd.*, je.status AS je_status, je.je_number, a.name AS bank_account_name
       FROM bank_deposits bd
       LEFT JOIN journal_entries je ON bd.je_id = je.id
       LEFT JOIN accounts a ON bd.bank_account_id = a.id
       WHERE bd.id = $1`,
      [id]
    );
    if (!depResult.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deposit not found' }); }
    const dep = depResult.rows[0];

    if (dep.status === 'reversed')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reversed' }); }
    if (dep.je_status !== 'posted')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Can only reverse a posted deposit' }); }

    const jeLinesResult = await client.query('SELECT * FROM je_lines WHERE je_id = $1', [dep.je_id]);

    // Swap debit ↔ credit to build the reversal JE
    const reverseLines = jeLinesResult.rows.map(l => ({
      accountId: l.account_id,
      debit:     parseFloat(l.credit),
      credit:    parseFloat(l.debit),
      narration: `Reversal: ${l.narration || ''}`,
    }));

    const reverseJE = await journalEngine.createEntry({
      date:        new Date().toISOString().split('T')[0],
      description: `Reversal of Bank Deposit #${id} — ${dep.bank_account_name || ''}`,
      sourceType:  'bank_deposit',
      sourceId:    id,
      lines:       reverseLines,
      autoPost:    true,
      createdBy:   req.user.id,
      client,
    });

    // Mark original JE as reversed (excluded from ledger going forward)
    await client.query(`UPDATE journal_entries SET status = 'reversed' WHERE id = $1`, [dep.je_id]);

    // Mark deposit as reversed and link the reversal JE
    await client.query(
      `UPDATE bank_deposits SET status = 'reversed', reverse_je_id = $1 WHERE id = $2`,
      [reverseJE.id, id]
    );

    await client.query('COMMIT');
    dispatchEvent('bank_deposit.reversed', { id, reverse_je_id: reverseJE.id, module: 'banking' });
    res.json({ success: true, reverse_je_id: reverseJE.id, reverse_je_number: reverseJE.je_number });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[bankDeposits REVERSE]', { error: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── DELETE /api/bank-deposits/:id (admin only) ───────────────────────────────

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id);
    if (isNaN(id)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid ID' }); }

    const depResult = await client.query(
      `SELECT bd.*, je.status AS je_status
       FROM bank_deposits bd
       LEFT JOIN journal_entries je ON bd.je_id = je.id
       WHERE bd.id = $1`,
      [id]
    );
    if (!depResult.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deposit not found' }); }
    const dep = depResult.rows[0];

    if (dep.je_status === 'posted')
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot delete posted deposit. Reverse first.' }); }

    if (dep.je_id && dep.je_status === 'draft')
      await client.query(`UPDATE journal_entries SET status = 'cancelled' WHERE id = $1`, [dep.je_id]);

    // Cascade deletes lines via FK ON DELETE CASCADE
    await client.query('DELETE FROM bank_deposits WHERE id = $1', [id]);
    await client.query('COMMIT');
    dispatchEvent('bank_deposit.deleted', { id, module: 'banking' });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[bankDeposits DELETE]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

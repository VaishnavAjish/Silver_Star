const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { syncBillStatus, syncInvoiceStatus } = require('../services/openDocumentService');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();

function validateLines(lines) {
  if (!lines || lines.length < 2) throw new Error('At least 2 lines required');
  let totalDebit = 0, totalCredit = 0;
  const clean = lines.map(line => {
    const debit = parseFloat(line.debit) || 0;
    const credit = parseFloat(line.credit) || 0;
    if (!line.accountId && !line.account_id) throw new Error('Account required on every line');
    if (debit < 0 || credit < 0) throw new Error('Debit and credit must be non-negative');
    if (debit > 0 && credit > 0) throw new Error('A line cannot have both debit and credit');
    if (debit === 0 && credit === 0) throw new Error('A line must have debit or credit');
    totalDebit += debit;
    totalCredit += credit;
    return {
      accountId:    parseInt(line.accountId || line.account_id),
      debit,
      credit,
      narration:    line.narration || null,
      costCenterId: line.costCenterId ? parseInt(line.costCenterId) : null,
      entityType:   line.entityType  || null,
      entityId:     line.entityId    ? parseInt(line.entityId) : null,
      referenceNo:  line.referenceNo || null,
    };
  });
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  if (totalDebit !== totalCredit) throw new Error(`Entry is not balanced: Debit ${totalDebit} != Credit ${totalCredit}`);
  return { lines: clean, totalDebit, totalCredit };
}

async function updateBalances(client, lines, sign = 1) {
  if (!lines || lines.length === 0) return;
  const uniqueIds = [...new Set(lines.map(l => l.accountId))];
  const accResult = await client.query(
    'SELECT id, type FROM accounts WHERE id = ANY($1::bigint[])',
    [uniqueIds]
  );
  if (accResult.rows.length !== uniqueIds.length) {
    const foundIds = new Set(accResult.rows.map(r => Number(r.id)));
    const missing  = uniqueIds.find(id => !foundIds.has(id));
    throw new Error(`Account ID ${missing} not found`);
  }
  const typeMap = {};
  for (const row of accResult.rows) typeMap[Number(row.id)] = row.type;

  const changeMap = {};
  for (const line of lines) {
    const accType = typeMap[line.accountId];
    const delta = ['asset', 'expense'].includes(accType)
      ? (parseFloat(line.debit) || 0) - (parseFloat(line.credit) || 0)
      : (parseFloat(line.credit) || 0) - (parseFloat(line.debit) || 0);
    changeMap[line.accountId] = ((changeMap[line.accountId] || 0) + delta * sign);
  }
  const ids    = Object.keys(changeMap).map(Number);
  const deltas = ids.map(id => Math.round(changeMap[id] * 100) / 100);
  await client.query(
    `UPDATE accounts SET balance = accounts.balance + v.delta
     FROM (SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::numeric[]) AS delta) v
     WHERE accounts.id = v.id`,
    [ids, deltas]
  );
}

async function insertJournal(client, { date, description, sourceType, sourceId, lines, status, createdBy, referenceNo }) {
  const { lines: cleanLines, totalDebit, totalCredit } = validateLines(lines);
  const seqR = await client.query("SELECT nextval('je_seq') as num");
  const jeNumber = `JE-${seqR.rows[0].num}`;
  const jeR = await client.query(
    `INSERT INTO journal_entries (je_number, date, description, source_type, source_id, total_debit, total_credit, status, created_by, posted_at, reference_no)
     VALUES ($1::text,$2::date,$3::text,$4::text,$5::int,$6::numeric,$7::numeric,$8::je_status,$9::int,CASE WHEN $10::boolean THEN NOW() ELSE NULL END,$11::text)
     RETURNING *`,
    [jeNumber, date, description, sourceType, sourceId, totalDebit, totalCredit, status, createdBy, status === 'posted', referenceNo || null]
  );
  for (const line of cleanLines) {
    await client.query(
      `INSERT INTO je_lines (je_id, account_id, debit, credit, narration, cost_center_id, entity_type, entity_id, reference_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [jeR.rows[0].id, line.accountId, line.debit, line.credit, line.narration, line.costCenterId || null,
       line.entityType || null, line.entityId || null, line.referenceNo || null]
    );
  }
  if (status === 'posted') await updateBalances(client, cleanLines);
  return jeR.rows[0];
}

async function getEntryLines(client, jeId) {
  const linesR = await client.query(
    'SELECT account_id, debit, credit, narration, cost_center_id, entity_type, entity_id, reference_no FROM je_lines WHERE je_id = $1 ORDER BY id',
    [jeId]
  );
  return linesR.rows.map(l => ({
    accountId:    l.account_id,
    debit:        parseFloat(l.debit)  || 0,
    credit:       parseFloat(l.credit) || 0,
    narration:    l.narration,
    costCenterId: l.cost_center_id,
    entityType:   l.entity_type,
    entityId:     l.entity_id,
    referenceNo:  l.reference_no,
  }));
}

// GET /api/journal-entries
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, source_type, from_date, to_date, page = 1, pageSize = 50 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (source_type) { params.push(source_type); where += ` AND source_type = $${params.length}`; }
    if (from_date) { params.push(from_date); where += ` AND date >= $${params.length}`; }
    if (to_date) { params.push(to_date); where += ` AND date <= $${params.length}`; }

    // Count total (separate from the paginated query to avoid fragile string replacement)
    const countResult = await pool.query(`SELECT COUNT(*) FROM journal_entries ${where}`, params);
    const totalCount = parseInt(countResult.rows[0].count);
    let query = `SELECT * FROM journal_entries ${where}`;

    const pg = parseInt(page);
    const sz = parseInt(pageSize);
    const offset = (pg - 1) * sz;
    const totalPages = Math.ceil(totalCount / sz);

    query += ' ORDER BY date DESC, id DESC';
    params.push(sz); query += ` LIMIT $${params.length}`;
    params.push(offset); query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows, totalCount, page: pg, pageSize: sz, totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal-entries/ledger/:accountId
// NOTE: must be registered BEFORE /:id to prevent route shadowing
router.get('/ledger/:accountId', authenticate, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const fromDate = from_date || '2025-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const account = await pool.query('SELECT * FROM accounts WHERE id = $1', [req.params.accountId]);
    if (account.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    const entries = await journalEngine.getLedger(req.params.accountId, fromDate, toDate);

    let runningBalance = 0;
    const accType = account.rows[0].type;
    const enriched = entries.map(e => {
      if (['asset', 'expense'].includes(accType)) {
        runningBalance += parseFloat(e.debit) - parseFloat(e.credit);
      } else {
        runningBalance += parseFloat(e.credit) - parseFloat(e.debit);
      }
      return { ...e, running_balance: Math.round(runningBalance * 100) / 100 };
    });

    res.json({ account: account.rows[0], entries: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal-entries/:id (with lines)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const jeResult = await pool.query('SELECT * FROM journal_entries WHERE id = $1', [req.params.id]);
    if (jeResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const [linesResult, reversalResult] = await Promise.all([
      pool.query(
        `SELECT jl.*, a.code as account_code, a.name as account_name, a.type as account_type, a.is_group as account_is_group
         FROM je_lines jl JOIN accounts a ON jl.account_id = a.id
         WHERE jl.je_id = $1 ORDER BY jl.id`,
        [req.params.id]
      ),
      // Find the JE that reversed this one (using source_type — works without migration)
      pool.query(
        `SELECT id, je_number, date
         FROM journal_entries
         WHERE source_type IN ('reversal','edit_reversal') AND source_id = $1
         LIMIT 1`,
        [req.params.id]
      ),
    ]);

    const je = jeResult.rows[0];

    // If this is a reversal JE, fetch the original it points to via source_id
    let original_je = null;
    if (je.source_type === 'reversal' || je.source_type === 'edit_reversal') {
      const srcId = je.reversal_of_je_id || je.source_id;
      if (srcId) {
        const origR = await pool.query(
          'SELECT id, je_number, date FROM journal_entries WHERE id = $1',
          [srcId]
        );
        original_je = origR.rows[0] || null;
      }
    }

    res.json({
      ...je,
      lines:       linesResult.rows,
      reversal_je: reversalResult.rows[0] || null,
      original_je,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal-entries (create new JE)
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { date, description, sourceType, sourceId, lines, autoPost, referenceNo } = req.body;

    if (!date || !lines || lines.length < 2) {
      return res.status(400).json({ error: 'Date and at least 2 lines required' });
    }

    const je = await journalEngine.createEntry({
      date,
      description,
      sourceType:  sourceType  || 'manual',
      sourceId:    sourceId    || null,
      lines,
      autoPost:    autoPost !== false,
      createdBy:   req.user.id,
      referenceNo: referenceNo || null,
    });

    dispatchEvent('journal.created', { id: je.id, je_number: je.je_number, source_type: je.source_type, status: je.status });
    res.status(201).json(je);
  } catch (err) {
    logger.error(`[journalEntries POST /] 400 Bad Request: ${err.message}`, { body: req.body, stack: err.stack });
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/journal-entries/:id/post (post a draft JE)
router.put('/:id/post', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const je = await journalEngine.postEntry(parseInt(req.params.id));
    dispatchEvent('journal.posted', { id: parseInt(req.params.id), je_number: je?.je_number, status: 'posted' });
    res.json({ success: true, message: 'Journal entry posted successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/journal-entries/:id (draft edit, or posted correction by reversal + replacement)
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { date, description, lines, reason, autoPost } = req.body;
    if (!reason || !reason.trim()) throw new Error('Edit reason is required');
    if (!date) throw new Error('Date is required');
    const parsed = validateLines(lines);

    await client.query('BEGIN');
    const jeR = await client.query('SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!jeR.rows.length) throw new Error('Journal entry not found');
    const je = jeR.rows[0];
    if (je.status === 'cancelled') throw new Error('Cannot edit a cancelled entry');

    if (je.status === 'draft') {
      const status = autoPost === false ? 'draft' : 'posted';
      await client.query(
        `UPDATE journal_entries
         SET date=$1, description=$2, total_debit=$3, total_credit=$4, status=$5,
             posted_at=CASE WHEN $5='posted' THEN NOW() ELSE NULL END
         WHERE id=$6`,
        [`${date}`, `${description || ''} [Edit: ${reason}]`, parsed.totalDebit, parsed.totalCredit, status, je.id]
      );
      await client.query('DELETE FROM je_lines WHERE je_id = $1', [je.id]);
      for (const line of parsed.lines) {
        await client.query(
          `INSERT INTO je_lines (je_id, account_id, debit, credit, narration, cost_center_id, entity_type, entity_id, reference_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [je.id, line.accountId, line.debit, line.credit, line.narration, line.costCenterId || null,
           line.entityType || null, line.entityId || null, line.referenceNo || null]
        );
      }
      if (status === 'posted') await updateBalances(client, parsed.lines);
      await client.query('COMMIT');
      dispatchEvent('journal.updated', { id: je.id, je_number: je.je_number, action: 'draft_updated' });
      return res.json({ success: true, id: je.id, mode: 'draft_updated' });
    }

    const reversalCheck = await client.query(
      "SELECT id FROM journal_entries WHERE source_type IN ('reversal','edit_reversal') AND source_id = $1 LIMIT 1",
      [je.id]
    );
    if (reversalCheck.rows.length) throw new Error('This entry already has a reversal/correction');

    const oldLines = await getEntryLines(client, je.id);
    const reversalLines = oldLines.map(l => ({
      accountId:    l.accountId,
      debit:        l.credit,
      credit:       l.debit,
      narration:    `Correction reversal of ${je.je_number}`,
      entityType:   l.entityType   || null,
      entityId:     l.entityId     || null,
      costCenterId: l.costCenterId || null,
      referenceNo:  l.referenceNo  || null,
    }));
    const reversal = await insertJournal(client, {
      date,
      description: `Correction reversal of ${je.je_number}. Reason: ${reason}`,
      sourceType: 'edit_reversal',
      sourceId: je.id,
      lines: reversalLines,
      status: 'posted',
      createdBy: req.user.id,
    });
    const replacement = await insertJournal(client, {
      date,
      description: `${description || je.description || ''} [Corrected from ${je.je_number}: ${reason}]`,
      sourceType: 'manual_correction',
      sourceId: je.id,
      lines: parsed.lines,
      status: 'posted',
      createdBy: req.user.id,
    });

    // Mark original as reversed (requires Phase 21 migration — skip safely if pending)
    try {
      await client.query(
        `UPDATE journal_entries
         SET is_reversed = TRUE, reversed_at = NOW(), reversed_by = $1
         WHERE id = $2`,
        [req.user.id, je.id]
      );
      await client.query(
        'UPDATE journal_entries SET reversal_of_je_id = $1 WHERE id = $2',
        [je.id, reversal.id]
      );
    } catch (colErr) {
      logger.warn('[edit-reverse] is_reversed columns not yet migrated:', { error: colErr.message });
    }

    // Remove any JE allocations on the original + resync document statuses
    const allocDocs = await client.query(
      'SELECT DISTINCT target_type, target_id FROM je_allocations WHERE je_id = $1',
      [je.id]
    );
    await client.query('DELETE FROM je_allocations WHERE je_id = $1', [je.id]);
    for (const row of allocDocs.rows) {
      if (row.target_type === 'bill')    await syncBillStatus(parseInt(row.target_id), client);
      if (row.target_type === 'invoice') await syncInvoiceStatus(parseInt(row.target_id), client);
    }

    await client.query('COMMIT');
    dispatchEvent('journal.updated', { id: je.id, je_number: je.je_number, action: 'posted_corrected', reversal_id: reversal?.id, replacement_id: replacement?.id });
    res.json({ success: true, mode: 'posted_corrected', reversal, replacement });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/journal-entries/:id/reverse
router.post('/:id/reverse', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { reason, date = new Date().toISOString().split('T')[0] } = req.body || {};
    if (!reason || !reason.trim()) throw new Error('Reversal reason is required');
    await client.query('BEGIN');
    const jeR = await client.query('SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!jeR.rows.length) throw new Error('Journal entry not found');
    const je = jeR.rows[0];
    if (je.status !== 'posted') throw new Error('Only posted entries can be reversed');
    const existingR = await client.query(
      "SELECT id FROM journal_entries WHERE source_type = 'reversal' AND source_id = $1 LIMIT 1",
      [je.id]
    );
    if (existingR.rows.length) throw new Error('Journal entry already reversed');

    const oldLines = await getEntryLines(client, je.id);
    const reversalLines = oldLines.map(l => ({
      accountId:    l.accountId,
      debit:        l.credit,          // flip debit ↔ credit
      credit:       l.debit,
      narration:    `Reversal of ${je.je_number}`,
      // Preserve entity tagging so the reversal appears in vendor/customer
      // ledgers and cancels out the original JE in the je_adjustment formula.
      entityType:   l.entityType   || null,
      entityId:     l.entityId     || null,
      costCenterId: l.costCenterId || null,
      referenceNo:  l.referenceNo  || null,
    }));
    const reversal = await insertJournal(client, {
      date,
      description: `Reversal of ${je.je_number}. Reason: ${reason}`,
      sourceType: 'reversal',
      sourceId: je.id,
      lines: reversalLines,
      status: 'posted',
      createdBy: req.user.id,
    });

    // Mark original JE as reversed (requires Phase 21 migration — safe to skip if columns missing)
    try {
      await client.query(
        `UPDATE journal_entries
         SET is_reversed = TRUE, reversed_at = NOW(), reversed_by = $1
         WHERE id = $2`,
        [req.user.id, je.id]
      );
      await client.query(
        'UPDATE journal_entries SET reversal_of_je_id = $1 WHERE id = $2',
        [je.id, reversal.id]
      );
    } catch (colErr) {
      // Columns not yet added (migration pending) — skip flag update, allocation
      // cleanup below still runs so accounting is correct
      logger.warn('[reverse] is_reversed columns not yet migrated:', { error: colErr.message });
    }

    // ── Remove JE allocations on original + resync document statuses ──────────
    // This is the critical step: if the original JE was allocated against vendor
    // bills or customer invoices, those allocations must be removed so that
    // balance_due / payment_status are restored to their pre-allocation state.
    const allocDocs = await client.query(
      'SELECT DISTINCT target_type, target_id FROM je_allocations WHERE je_id = $1',
      [je.id]
    );
    if (allocDocs.rows.length > 0) {
      await client.query('DELETE FROM je_allocations WHERE je_id = $1', [je.id]);
      for (const row of allocDocs.rows) {
        if (row.target_type === 'bill')    await syncBillStatus(parseInt(row.target_id), client);
        if (row.target_type === 'invoice') await syncInvoiceStatus(parseInt(row.target_id), client);
      }
    }

    await client.query('COMMIT');
    dispatchEvent('journal.reversed', { id: je.id, je_number: je.je_number, reversal_id: reversal.id, reason });
    res.json({ success: true, reversal, allocations_removed: allocDocs.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE /api/journal-entries/:id
router.delete('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM journal_entries WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Journal entry not found' });
    dispatchEvent('journal.deleted', { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

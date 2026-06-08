const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ── CSV helpers (used when the client sends raw CSV text) ─────────────────────

function splitCSVLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (cols, ...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i >= 0 && cols[i] !== undefined) return cols[i].trim();
    }
    return '';
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols  = splitCSVLine(lines[i]);
    const dateStr = col(cols, 'date', 'txndate', 'transactiondate', 'valuedate');
    const amtStr  = col(cols, 'amount', 'debit', 'credit', 'withdrawal', 'deposit', 'dr', 'cr');
    const ref     = col(cols, 'ref', 'description', 'narration', 'particulars', 'remarks', 'desc');
    if (!dateStr) continue;
    const amount = parseFloat(amtStr.replace(/[,₹\s]/g, ''));
    if (isNaN(amount)) continue;
    rows.push({ idx: i - 1, date: dateStr, amount, ref });
  }
  return rows;
}

// ── GET /api/bank-recon/system ────────────────────────────────────────────────
// Returns posted JE lines for a bank account in the given period + opening balance.
// READ-ONLY — does not touch journal_entries or je_lines.
router.get('/system', authenticate, async (req, res) => {
  try {
    const { account_id, from, to } = req.query;
    if (!account_id)
      return res.status(400).json({ error: 'account_id is required' });

    let dateFilterStr = '';
    let params = [account_id];
    let paramIdx = 2;

    if (from && to) {
      dateFilterStr = `AND je.date BETWEEN $${paramIdx} AND $${paramIdx+1}`;
      params.push(from, to);
      paramIdx += 2;
    } else if (from) {
      dateFilterStr = `AND je.date >= $${paramIdx}`;
      params.push(from);
      paramIdx += 1;
    } else if (to) {
      dateFilterStr = `AND je.date <= $${paramIdx}`;
      params.push(to);
      paramIdx += 1;
    }

    const txnR = await pool.query(
      `SELECT
         je.id          AS je_id,
         je.je_number,
         je.date,
         je.description,
         je.source_type,
         jl.id          AS je_line_id,
         jl.debit,
         jl.credit,
         (jl.debit - jl.credit) AS amount
       FROM journal_entries je
       JOIN je_lines jl ON jl.je_id = je.id
       WHERE jl.account_id = $1
         AND je.status = 'posted'
         ${dateFilterStr}
       ORDER BY je.date ASC, je.id ASC`,
      params
    );

    // Opening balance: all posted JEs for this account before 'from'
    let openingBalance = 0;
    if (from) {
      const openR = await pool.query(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS opening
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
         WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date < $2`,
        [account_id, from]
      );
      openingBalance = parseFloat(openR.rows[0].opening) || 0;
    }

    res.json({
      transactions: txnR.rows.map(r => ({
        ...r,
        debit:  parseFloat(r.debit)  || 0,
        credit: parseFloat(r.credit) || 0,
        amount: parseFloat(r.amount) || 0,
      })),
      openingBalance,
    });
  } catch (err) {
    logger.error('[bankRecon /system]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bank-recon/upload ───────────────────────────────────────────────
// Accept either:
//   { csv: "<raw CSV text>" }          -- server-side parse
//   { rows: [{ date, amount, ref }] }  -- pre-parsed by browser
router.post('/upload', authenticate, (req, res) => {
  try {
    const { csv, rows } = req.body;

    if (Array.isArray(rows)) {
      const validated = rows
        .map((r, i) => ({
          idx:    i,
          date:   String(r.date   || '').trim(),
          amount: parseFloat(r.amount) || 0,
          ref:    String(r.ref || r.description || '').trim(),
        }))
        .filter(r => r.date);
      return res.json({ rows: validated, count: validated.length });
    }

    if (typeof csv === 'string') {
      const parsed = parseCSV(csv);
      return res.json({ rows: parsed, count: parsed.length });
    }

    res.status(400).json({ error: 'Provide csv string or rows array' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bank-recon/auto-match ──────────────────────────────────────────
// Pure computation — no DB writes. Returns match suggestions.
router.post('/auto-match', authenticate, (req, res) => {
  try {
    const { systemTxns, bankRows } = req.body;
    if (!Array.isArray(systemTxns) || !Array.isArray(bankRows))
      return res.status(400).json({ error: 'systemTxns and bankRows arrays required' });

    const usedBank = new Set();
    const usedSys  = new Set();
    const matches  = [];

    // Enrich system rows with Date objects for fast comparison
    const sysEnriched = systemTxns.map(t => ({
      ...t,
      _date:   new Date(t.date),
      _amount: Math.abs(parseFloat(t.amount) || 0),
    }));

    for (const bankRow of bankRows) {
      if (!bankRow.date) continue;
      const bankDate   = new Date(bankRow.date);
      if (isNaN(bankDate.getTime())) continue;
      const bankAmount = Math.abs(parseFloat(bankRow.amount) || 0);

      let best      = null;
      let bestScore = Infinity;

      for (const sys of sysEnriched) {
        const sysKey = sys.je_line_id || sys.je_id;
        if (usedSys.has(sysKey)) continue;

        const amtDiff  = Math.abs(sys._amount - bankAmount);
        const daysDiff = Math.abs((sys._date - bankDate) / 86400000);

        if (amtDiff < 1 && daysDiff <= 3) {
          const score = amtDiff * 10 + daysDiff;
          if (score < bestScore) { bestScore = score; best = sys; }
        }
      }

      if (best) {
        const sysKey = best.je_line_id || best.je_id;
        if (!usedBank.has(bankRow.idx) && !usedSys.has(sysKey)) {
          usedBank.add(bankRow.idx);
          usedSys.add(sysKey);
          matches.push({
            je_id:         best.je_id,
            je_line_id:    best.je_line_id,
            bank_idx:      bankRow.idx,
            system_amount: parseFloat(best.amount) || 0,
            bank_amount:   parseFloat(bankRow.amount) || 0,
            bank_date:     bankRow.date,
            bank_ref:      bankRow.ref || '',
            match_status:  'matched',
          });
        }
      }
    }

    res.json({
      matches,
      matched:    matches.length,
      total_bank: bankRows.length,
      total_sys:  systemTxns.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bank-recon/save ─────────────────────────────────────────────────
// Persist the completed reconciliation. READ-ONLY on accounting tables.
router.post('/save', authenticate, async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const {
      account_id,
      statement_date,
      statement_balance,
      matches       = [],
      unmatched_sys  = [],
      unmatched_bank = [],
    } = req.body;

    if (!account_id || !statement_date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'account_id and statement_date are required' });
    }

    const reconR = await client.query(
      `INSERT INTO bank_reconciliation (account_id, statement_date, statement_balance, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [account_id, statement_date, parseFloat(statement_balance) || 0, req.user.id]
    );
    const reconId = reconR.rows[0].id;

    // Matched pairs
    for (const m of matches) {
      await client.query(
        `INSERT INTO bank_reconciliation_lines
           (reconciliation_id, je_id, system_amount, bank_amount, match_status, bank_date, bank_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reconId, m.je_id || null, m.system_amount || 0, m.bank_amount || 0,
         m.match_status || 'matched', m.bank_date || null, m.bank_ref || null]
      );
    }

    // Unmatched system entries
    for (const s of unmatched_sys) {
      await client.query(
        `INSERT INTO bank_reconciliation_lines
           (reconciliation_id, je_id, system_amount, bank_amount, match_status)
         VALUES ($1, $2, $3, 0, 'unmatched')`,
        [reconId, s.je_id || null, parseFloat(s.amount) || 0]
      );
    }

    // Unmatched bank entries
    for (const b of unmatched_bank) {
      await client.query(
        `INSERT INTO bank_reconciliation_lines
           (reconciliation_id, je_id, system_amount, bank_amount, match_status, bank_date, bank_ref)
         VALUES ($1, NULL, 0, $2, 'unmatched', $3, $4)`,
        [reconId, parseFloat(b.amount) || 0, b.date || null, b.ref || null]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, id: reconId });
    dispatchEvent('recon.created', { id: reconId, account_id, statement_date, statement_balance }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[bankRecon /save]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── GET /api/bank-recon ───────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT br.id, br.statement_date, br.statement_balance, br.created_at,
              a.name AS account_name,
              u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM bank_reconciliation_lines brl
               WHERE brl.reconciliation_id = br.id AND brl.match_status != 'unmatched') AS matched_count,
              (SELECT COUNT(*) FROM bank_reconciliation_lines brl
               WHERE brl.reconciliation_id = br.id) AS total_lines
       FROM bank_reconciliation br
       LEFT JOIN accounts a ON a.id = br.account_id
       LEFT JOIN users u ON u.id = br.created_by
       ORDER BY br.statement_date DESC, br.id DESC
       LIMIT 50`
    );
    res.json({ data: result.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[bankRecon.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── GET /api/bank-recon/:id ───────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const reconR = await pool.query(
      `SELECT br.*, a.name AS account_name, u.full_name AS created_by_name
       FROM bank_reconciliation br
       LEFT JOIN accounts a ON a.id = br.account_id
       LEFT JOIN users u ON u.id = br.created_by
       WHERE br.id = $1`,
      [id]
    );
    if (!reconR.rows[0]) return res.status(404).json({ error: 'Reconciliation not found' });

    const linesR = await pool.query(
      `SELECT brl.*,
              je.date AS je_date, je.description AS je_desc, je.je_number
       FROM bank_reconciliation_lines brl
       LEFT JOIN journal_entries je ON je.id = brl.je_id
       WHERE brl.reconciliation_id = $1
       ORDER BY brl.id`,
      [id]
    );

    res.json({ data: { ...reconR.rows[0], lines: linesR.rows } });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[bankRecon.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

module.exports = router;

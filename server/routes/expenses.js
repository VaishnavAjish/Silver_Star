const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

async function getAccountByCode(code, client = pool) {
  const r = await client.query('SELECT id FROM accounts WHERE code = $1', [code]);
  return r.rows[0]?.id || null;
}

// GET /api/expenses
router.get('/', authenticate, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100000);
    const offset = parseInt(req.query.offset || '0', 10);
    const { category, method, department, status, date_from, date_to } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (category) {
      conditions.push(`(ec.name ILIKE $${idx} OR a_cat.name ILIKE $${idx})`);
      params.push(category);
      idx++;
    }
    if (method) {
      conditions.push(`e.payment_mode = $${idx++}`);
      params.push(method);
    }
    if (department) {
      conditions.push(`d.name ILIKE $${idx++}`);
      params.push(department);
    }
    if (status) {
      conditions.push(`e.status = $${idx++}`);
      params.push(status);
    }
    if (date_from) {
      conditions.push(`e.date >= $${idx++}`);
      params.push(date_from);
    }
    if (date_to) {
      conditions.push(`e.date <= $${idx++}`);
      params.push(date_to);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(limit, offset);
    const [dataR, countR] = await Promise.all([
      pool.query(
        `SELECT e.*, COALESCE(a_cat.name, ec.name) as category_name, d.name as dept_name,
                a.name as payment_account_name, v.name as vendor_name
         FROM expenses e
         LEFT JOIN accounts a_cat ON e.category_id = a_cat.id AND a_cat.type = 'expense'
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN accounts a ON e.payment_account_id = a.id
         LEFT JOIN vendors v ON e.vendor_id = v.id
         ${where}
         ORDER BY e.date DESC, e.id DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM expenses e
         LEFT JOIN accounts a_cat ON e.category_id = a_cat.id AND a_cat.type = 'expense'
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN departments d ON e.department_id = d.id
         ${where}`,
        params.slice(0, -2)
      ),
    ]);
    res.json({ data: dataR.rows, total: parseInt(countR.rows[0].count) });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[expenses.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// POST /api/expenses
// Supports two modes automatically:
//   MODE 1 (no vendor_id): direct expense — Dr Expense lines → Cr Bank
//   MODE 2 (vendor_id set): vendor expense — Dr Expense + Dr AP → Cr Bank
//
// Body fields:
//   date, payment_account_id, payment_mode, reference_no, memo  (header)
//   vendor_id                                                    (optional — activates MODE 2)
//   lines[]  = [{category_id, description, amount, department_id, cost_center_id}]
//   allocations[] = [{purchase_note_id, amount}]                (optional — bill settlement)
//
// Backward compat: if lines[] absent, reads legacy fields category_id + amount + description.
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const {
      // Header
      date, payment_account_id, payment_mode,
      reference_no, memo, vendor_id,
      // Multi-line (new)
      lines: rawLines,
      // Legacy single-line fields (backward compat)
      category_id: legacyCatId, description: legacyDesc,
      amount: legacyAmount, paid_via,
      department_id: legacyDept, cost_center_id: legacyCC,
      // AP settlement
      allocations: rawAllocations,
    } = req.body;

    if (!date) throw new Error('Date is required');
    if (!payment_account_id) throw new Error('Payment account is required');

    // ── Normalise lines (multi-line or legacy single-line) ──────────────────
    let lines = [];
    if (Array.isArray(rawLines) && rawLines.length > 0) {
      lines = rawLines.filter(l => parseFloat(l.amount) > 0);
    } else if (legacyAmount && parseFloat(legacyAmount) > 0) {
      lines = [{
        category_id:   legacyCatId   || null,
        description:   legacyDesc    || '',
        amount:        legacyAmount,
        department_id: legacyDept    || null,
        cost_center_id: legacyCC     || null,
      }];
    }

    // ── Normalise allocations ────────────────────────────────────────────────
    const hasAllocations = Array.isArray(rawAllocations) && rawAllocations.length > 0;
    let allocations = hasAllocations ? rawAllocations : [];

    if (lines.length === 0 && !hasAllocations) {
      throw new Error('At least one expense line with an amount is required');
    }

    // ── Compute totals ───────────────────────────────────────────────────────
    const expenseSum = Math.round(
      lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0) * 100
    ) / 100;
    let appliedToBills = 0;
    if (hasAllocations) {
      for (const a of allocations) {
        const amt = parseFloat(a.amount);
        if (isNaN(amt) || amt <= 0) throw new Error('Each allocation must have amount > 0');
        appliedToBills += amt;
      }
      appliedToBills = Math.round(appliedToBills * 100) / 100;
    }
    const totalAmount = Math.round((expenseSum + appliedToBills) * 100) / 100;
    if (totalAmount <= 0) throw new Error('Total payment amount must be greater than 0');

    // ── Validate allocation amounts vs bill balances ─────────────────────────
    if (hasAllocations && vendor_id) {
      for (const a of allocations) {
        const pnR = await client.query(
          `SELECT id, COALESCE(balance_due, grand_total) AS balance_due
           FROM purchase_notes WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
          [parseInt(a.purchase_note_id), parseInt(vendor_id)]
        );
        if (!pnR.rows[0]) throw new Error('A selected bill was not found for this vendor');
        const bd = parseFloat(pnR.rows[0].balance_due);
        const amt = parseFloat(a.amount);
        if (amt > bd + 0.005) {
          throw new Error(`Allocated ₹${amt.toFixed(2)} exceeds outstanding ₹${bd.toFixed(2)}`);
        }
      }
    }

    // ── Doc number ───────────────────────────────────────────────────────────
    const seqR = await client.query("SELECT nextval('exp_seq') as num");
    const docNumber = `EXP-${String(seqR.rows[0].num).padStart(3, '0')}`;

    // ── Resolve Accounts Payable GL (needed for AP settlement) ───────────────
    let payableAccId = null;
    if (hasAllocations && appliedToBills > 0.005) {
      payableAccId = await getAccountByCode('3001', client);
      if (!payableAccId) throw new Error('Accounts Payable (3001) not configured in chart of accounts');
    }

    // ── Resolve vendor name for JE description ───────────────────────────────
    let vendorName = '';
    if (vendor_id) {
      const vr = await client.query('SELECT name FROM vendors WHERE id = $1', [parseInt(vendor_id)]);
      vendorName = vr.rows[0]?.name || '';
    }

    // ── Build JE lines — resolve category GL accounts once, reuse below ────────
    const jeLines = [];
    const primaryCCId = lines[0]?.cost_center_id ? parseInt(lines[0].cost_center_id) : null;

    // Cache category → gl_account_id to avoid querying twice per line
    const catGlMap = {};
    for (const line of lines) {
      if (!line.category_id) throw new Error('Each expense line must have a category');
      if (catGlMap[line.category_id] === undefined) {
        const accR = await client.query(
          'SELECT id FROM accounts WHERE id = $1 AND type = $2',
          [parseInt(line.category_id), 'expense']
        );
        if (accR.rows.length) {
          catGlMap[line.category_id] = accR.rows[0].id;
        } else {
          const catR = await client.query(
            'SELECT gl_account_id FROM expense_categories WHERE id = $1',
            [parseInt(line.category_id)]
          );
          catGlMap[line.category_id] = catR.rows[0]?.gl_account_id || null;
        }
      }
      const expAccId = catGlMap[line.category_id];
      if (!expAccId) throw new Error(`Expense category ${line.category_id} has no GL account mapped`);
      jeLines.push({
        accountId:    expAccId,
        debit:        parseFloat(line.amount),
        credit:       0,
        narration:    line.description || docNumber,
        costCenterId: line.cost_center_id ? parseInt(line.cost_center_id) : null,
      });
    }

    // Dr Accounts Payable (bill settlements)
    if (hasAllocations && appliedToBills > 0.005) {
      jeLines.push({
        accountId:    payableAccId,
        debit:        appliedToBills,
        credit:       0,
        narration:    `Bill settlement${vendorName ? ' – ' + vendorName : ''} – ${docNumber}`,
        costCenterId: null,
      });
    }

    // Cr Bank / Cash (total payment)
    jeLines.push({
      accountId:    parseInt(payment_account_id),
      debit:        0,
      credit:       totalAmount,
      narration:    `${payment_mode || paid_via || 'Payment'} – ${reference_no || docNumber}`,
      costCenterId: primaryCCId,
    });

    // ── Create JE ────────────────────────────────────────────────────────────
    const jeDesc = vendorName
      ? `Expense${hasAllocations ? ' + AP Settlement' : ''} – ${vendorName} – ${docNumber}`
      : `Expense – ${docNumber}`;

    const je = await journalEngine.createEntry({
      date,
      description:  jeDesc,
      sourceType:   'expense',
      sourceId:     null,
      lines:        jeLines,
      autoPost:     true,
      createdBy:    req.user.id,
      client,
    });

    // ── Insert expense header ─────────────────────────────────────────────────
    const primaryLine = lines[0] || {};
    const expR = await client.query(
      `INSERT INTO expenses
         (doc_number, date, category_id, description, amount, paid_via,
          payment_account_id, reference_no, department_id, je_id, status, created_by,
          vendor_id, payment_mode, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PAID',$11,$12,$13,$14)
       RETURNING *`,
      [
        docNumber, date,
        null, // category_id: legacy FK col pointing to expense_categories — GL account stored in expense_lines.gl_account_id
        primaryLine.description   || legacyDesc || '',
        totalAmount,
        paid_via || payment_mode  || 'Bank Transfer',
        parseInt(payment_account_id),
        reference_no              || null,
        primaryLine.department_id ? parseInt(primaryLine.department_id) : null,
        je.id,
        req.user.id,
        vendor_id                 ? parseInt(vendor_id)                 : null,
        payment_mode              || paid_via || 'Bank Transfer',
        memo                      || null,
      ]
    );
    const expenseId = expR.rows[0].id;

    // ── Insert expense_lines (reuse catGlMap built above — no extra DB queries) ─
    for (const [idx, line] of lines.entries()) {
      await client.query(
        `INSERT INTO expense_lines
           (expense_id, seq, category_id, description, department_id, cost_center_id, amount, gl_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          expenseId, idx + 1,
          parseInt(line.category_id),
          line.description || null,
          line.department_id   ? parseInt(line.department_id)   : null,
          line.cost_center_id  ? parseInt(line.cost_center_id)  : null,
          parseFloat(line.amount),
          catGlMap[line.category_id] || null,
        ]
      );
    }

    // ── Insert expense_allocations + update purchase_note balances ────────────
    if (hasAllocations) {
      for (const alloc of allocations) {
        const allocAmt = parseFloat(alloc.amount);
        await client.query(
          `INSERT INTO expense_allocations (expense_id, purchase_note_id, amount, allocated_date)
           VALUES ($1, $2, $3, $4)`,
          [expenseId, parseInt(alloc.purchase_note_id), allocAmt, date]
        );
        await client.query(
          `UPDATE purchase_notes
           SET amount_paid    = COALESCE(amount_paid, 0) + $1,
               balance_due    = GREATEST(COALESCE(balance_due, grand_total) - $1, 0),
               payment_status = CASE
                 WHEN GREATEST(COALESCE(balance_due, grand_total) - $1, 0) <= 0.005 THEN 'PAID'
                 WHEN COALESCE(amount_paid, 0) + $1 > 0.005                         THEN 'PARTIAL'
                 ELSE 'UNPAID' END
           WHERE id = $2`,
          [allocAmt, parseInt(alloc.purchase_note_id)]
        );
      }
    }

    await client.query('COMMIT');
    dispatchEvent('expense.created', { id: expenseId, doc_number: docNumber, amount: totalAmount, vendor_id: vendor_id || null, je_id: je.id, je_number: je.je_number });
    res.status(201).json({ ...expR.rows[0], je_number: je.je_number });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/expenses/:id  — full detail with lines & allocations
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [expR, linesR, allocR] = await Promise.all([
      pool.query(
        `SELECT e.*,
                COALESCE(a_cat.name, ec.name)  AS category_name,
                d.name   AS dept_name,
                a.name   AS payment_account_name,
                a.code   AS payment_account_code,
                v.name   AS vendor_name, v.code AS vendor_code,
                je.je_number
         FROM   expenses e
         LEFT JOIN accounts a_cat ON e.category_id = a_cat.id AND a_cat.type = 'expense'
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN departments        d  ON e.department_id = d.id
         LEFT JOIN accounts           a  ON e.payment_account_id = a.id
         LEFT JOIN vendors            v  ON e.vendor_id = v.id
         LEFT JOIN journal_entries    je ON e.je_id = je.id
         WHERE  e.id = $1`, [id]
      ),
      pool.query(
        `SELECT el.*,
                COALESCE(a_cat.name, ec.name) AS category_name,
                d.name  AS dept_name,
                cc.name AS cost_center_name
         FROM   expense_lines     el
         LEFT JOIN accounts a_cat ON el.category_id = a_cat.id AND a_cat.type = 'expense'
         LEFT JOIN expense_categories ec ON el.category_id = ec.id
         LEFT JOIN departments        d  ON el.department_id = d.id
         LEFT JOIN cost_centers       cc ON el.cost_center_id = cc.id
         WHERE  el.expense_id = $1
         ORDER  BY el.seq`, [id]
      ),
      pool.query(
        `SELECT ea.*, pn.doc_number, pn.grand_total, pn.doc_date
         FROM   expense_allocations ea
         JOIN   purchase_notes      pn ON pn.id = ea.purchase_note_id
         WHERE  ea.expense_id = $1
         ORDER  BY ea.id`, [id]
      ),
    ]);

    if (!expR.rows.length) return res.status(404).json({ error: 'Expense not found' });

    res.json({
      ...expR.rows[0],
      lines:       linesR.rows,
      allocations: allocR.rows,
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[expenses.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

module.exports = router;

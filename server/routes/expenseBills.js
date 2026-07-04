const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');

const gstEngine = require('../services/gstEngine');
const { buildPurchaseJournal } = require('../services/purchaseJournalBuilder');

const router = express.Router();

// GET /api/expense-bills
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 1000);
    const offset = parseInt(req.query.offset || '0', 10);
    const { status, search } = req.query;

    const conditions = [];
    const params = [];

    if (status) {
      params.push(status.toLowerCase());
      conditions.push(`pn.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(pn.doc_number ILIKE $${params.length} OR v.name ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit, offset);

    const [dataR, countR] = await Promise.all([
      pool.query(`
        SELECT pn.*, v.name as vendor_name, d.name as dept_name
        FROM purchase_notes pn
        LEFT JOIN vendors v ON pn.vendor_id = v.id
        LEFT JOIN departments d ON pn.department_id = d.id
        ${where}
        ORDER BY pn.doc_date DESC, pn.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params),
      pool.query(`
        SELECT COUNT(*) FROM purchase_notes pn
        LEFT JOIN vendors v ON pn.vendor_id = v.id
        ${where}
      `, params.slice(0, -2))
    ]);

    res.json({ data: dataR.rows, total: parseInt(countR.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expense-bills/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [pnR, linesR] = await Promise.all([
      pool.query(`
        SELECT pn.*, v.name as vendor_name, d.name as dept_name,
               je.je_number
        FROM purchase_notes pn
        LEFT JOIN vendors v ON pn.vendor_id = v.id
        LEFT JOIN departments d ON pn.department_id = d.id
        LEFT JOIN journal_entries je ON pn.je_id = je.id
        WHERE pn.id = $1
      `, [id]),
      pool.query(`
        SELECT pnl.*, a.name as category_name,
               d.name as dept_name, cc.name as cost_center_name
        FROM purchase_note_lines pnl
        LEFT JOIN accounts a ON pnl.expense_account_id = a.id
        LEFT JOIN departments d ON pnl.department_id = d.id
        LEFT JOIN cost_centers cc ON pnl.cost_center_id = cc.id
        WHERE pnl.purchase_note_id = $1
        ORDER BY pnl.line_no
      `, [id])
    ]);

    if (!pnR.rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json({ ...pnR.rows[0], lines: linesR.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expense-bills
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { doc_date, vendor_id, reference_no, remark, lines, department_id, cost_center_id } = req.body;

    if (!doc_date || !vendor_id) throw new Error('Date and Vendor are required');
    if (!lines || lines.length === 0) throw new Error('At least one line item is required');

    // Calculate totals using shared GST engine
    const gstData = gstEngine.calculateDocumentGST(lines);
    const totalAmount = gstData.totalTaxable;
    const taxAmount = gstData.totalTax;
    const grandTotal = gstData.grandTotal;

    if (grandTotal <= 0) throw new Error('Total amount must be greater than 0');

    // Generate Bill Number
    const seqR = await client.query("SELECT nextval('pn_seq') as num");
    const docNumber = `BILL-${String(seqR.rows[0].num).padStart(4, '0')}`;

    // Insert Header
    const pnR = await client.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, department_id,
          reference_no, remark, total_qty, total_amount, tax_amount, grand_total,
          balance_due, amount_paid, payment_status, status, created_by, cost_center_id)
       VALUES ($1,$2,$3,'Expense Bill',$4,$5,$6,0,$7,$8,$9,$10,0,'UNPAID','open',$11,$12) RETURNING *`,
      [docNumber, doc_date, vendor_id, department_id || null, reference_no, remark,
       totalAmount, taxAmount, grandTotal, grandTotal, req.user.id, cost_center_id || null]
    );
    const pn = pnR.rows[0];

    const debitLines = [];
    const insertedLines = [];

    for (let i = 0; i < gstData.lines.length; i++) {
      const line = gstData.lines[i];
      const amt = line.computed_amount;
      const taxAmt = line.computed_tax_amount;
      const lineTotal = line.computed_total;
      
      if (amt <= 0) continue;
      if (!line.expense_account_id) throw new Error('Expense Category is required for all lines');

      const lineR = await client.query(
        `INSERT INTO purchase_note_lines
           (purchase_note_id, line_no, expense_account_id, description, department_id, cost_center_id, amount, tax_pct, tax_amount, total, qty, rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11) RETURNING *`,
        [pn.id, i + 1, parseInt(line.expense_account_id), line.description || '',
         line.department_id ? parseInt(line.department_id) : null,
         line.cost_center_id ? parseInt(line.cost_center_id) : null,
         amt, parseFloat(line.tax_pct) || 0, taxAmt, lineTotal, amt]
      );
      insertedLines.push(lineR.rows[0]);

      debitLines.push({
        accountId: parseInt(line.expense_account_id),
        amount: amt,
        narration: `Vendor Bill ${docNumber}`,
        costCenterId: line.cost_center_id ? parseInt(line.cost_center_id) : (cost_center_id ? parseInt(cost_center_id) : null)
      });
    }

    // Build JE using shared routine
    const vendorNameR = await client.query('SELECT name FROM vendors WHERE id=$1', [vendor_id]);
    const jeLines = await buildPurchaseJournal({
      client,
      docNumber,
      date: doc_date,
      vendorName: vendorNameR.rows[0]?.name,
      itemType: 'Expense Bill',
      debitLines,
      taxAmount,
      grandTotal,
      globalCostCenterId: cost_center_id ? parseInt(cost_center_id) : null
    });

    const je = await journalEngine.createEntry({
      date: doc_date,
      description: `Vendor Bill ${docNumber}`,
      sourceType: 'purchase',
      sourceId: pn.id,
      lines: jeLines,
      autoPost: true,
      createdBy: req.user.id,
    }, client);

    await client.query('UPDATE purchase_notes SET je_id = $1 WHERE id = $2', [je.id, pn.id]);

    await client.query('COMMIT');

    dispatchEvent('purchase.created', {
      id: pn.id, doc_number: docNumber, item_type: 'Expense Bill', vendor_id,
      grand_total: grandTotal, created_by: req.user.id,
    }, { targetUserId: req.user.id });

    res.status(201).json({ ...pn, lines: insertedLines, je_id: je.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/expense-bills/:id
router.delete('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id, 10);
    const pnR = await client.query('SELECT status, je_id, amount_paid FROM purchase_notes WHERE id = $1 FOR UPDATE', [id]);
    if (!pnR.rows.length) throw new Error('Bill not found');
    const pn = pnR.rows[0];

    if (parseFloat(pn.amount_paid) > 0) throw new Error('Cannot delete a bill with payments applied. Remove payments first.');

    // 1. Delete lines
    await client.query('DELETE FROM purchase_note_lines WHERE purchase_note_id = $1', [id]);
    
    // 2. Delete main record
    await client.query('DELETE FROM purchase_notes WHERE id = $1', [id]);

    // 3. Delete JE if exists (cascade should handle je_lines)
    if (pn.je_id) {
      await client.query('DELETE FROM je_lines WHERE je_id = $1', [pn.je_id]);
      await client.query('DELETE FROM journal_entries WHERE id = $1', [pn.je_id]);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/expense-bills/:id
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id, 10);
    
    const { doc_date, vendor_id, reference_no, remark, lines, department_id, cost_center_id } = req.body;

    if (!doc_date || !vendor_id) throw new Error('Date and Vendor are required');
    if (!lines || lines.length === 0) throw new Error('At least one line item is required');

    const pnR = await client.query('SELECT * FROM purchase_notes WHERE id = $1 FOR UPDATE', [id]);
    if (!pnR.rows.length) throw new Error('Bill not found');
    const pn = pnR.rows[0];

    if (parseFloat(pn.amount_paid) > 0) {
      throw new Error('Cannot edit a bill with payments applied. Remove payments first.');
    }

    // Calculate totals using shared GST engine
    const gstData = gstEngine.calculateDocumentGST(lines);
    const totalAmount = gstData.totalTaxable;
    const taxAmount = gstData.totalTax;
    const grandTotal = gstData.grandTotal;

    if (grandTotal <= 0) throw new Error('Total amount must be greater than 0');

    // 1. Delete old lines
    await client.query('DELETE FROM purchase_note_lines WHERE purchase_note_id = $1', [id]);
    
    // 2. Delete old JE if exists
    if (pn.je_id) {
      await client.query('DELETE FROM je_lines WHERE je_id = $1', [pn.je_id]);
      await client.query('DELETE FROM journal_entries WHERE id = $1', [pn.je_id]);
    }

    // 3. Update main record
    await client.query(
      `UPDATE purchase_notes 
       SET doc_date=$1, vendor_id=$2, department_id=$3, reference_no=$4, remark=$5, 
           total_amount=$6, tax_amount=$7, grand_total=$8, balance_due=$9, cost_center_id=$10
       WHERE id = $11`,
      [doc_date, vendor_id, department_id || null, reference_no, remark,
       totalAmount, taxAmount, grandTotal, grandTotal, cost_center_id || null, id]
    );

    const debitLines = [];
    const insertedLines = [];

    // 4. Insert new lines
    for (let i = 0; i < gstData.lines.length; i++) {
      const line = gstData.lines[i];
      const amt = line.computed_amount;
      const taxAmt = line.computed_tax_amount;
      const lineTotal = line.computed_total;
      
      if (amt <= 0) continue;
      if (!line.expense_account_id) throw new Error('Expense Category is required for all lines');

      const lineR = await client.query(
        `INSERT INTO purchase_note_lines
           (purchase_note_id, line_no, expense_account_id, description, department_id, cost_center_id, amount, tax_pct, tax_amount, total, qty, rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11) RETURNING *`,
        [id, i + 1, parseInt(line.expense_account_id), line.description || '',
         line.department_id ? parseInt(line.department_id) : null,
         line.cost_center_id ? parseInt(line.cost_center_id) : null,
         amt, parseFloat(line.tax_pct) || 0, taxAmt, lineTotal, amt]
      );
      insertedLines.push(lineR.rows[0]);

      debitLines.push({
        accountId: parseInt(line.expense_account_id),
        amount: amt,
        narration: `Vendor Bill ${pn.doc_number} (Edited)`,
        costCenterId: line.cost_center_id ? parseInt(line.cost_center_id) : (cost_center_id ? parseInt(cost_center_id) : null)
      });
    }

    // Build JE using shared routine
    const vendorNameR = await client.query('SELECT name FROM vendors WHERE id=$1', [vendor_id]);
    const jeLines = await buildPurchaseJournal({
      client,
      docNumber: pn.doc_number,
      date: doc_date,
      vendorName: vendorNameR.rows[0]?.name,
      itemType: 'Expense Bill',
      debitLines,
      taxAmount,
      grandTotal,
      globalCostCenterId: cost_center_id ? parseInt(cost_center_id) : null
    });

    // 5. Create new JE
    const je = await journalEngine.createEntry({
      date: doc_date,
      description: `Vendor Bill ${pn.doc_number} (Edited)`,
      sourceType: 'purchase',
      sourceId: id,
      lines: jeLines,
      autoPost: true,
      createdBy: req.user.id,
    }, client);

    await client.query('UPDATE purchase_notes SET je_id = $1 WHERE id = $2', [je.id, id]);

    await client.query('COMMIT');
    res.json({ success: true, lines: insertedLines, je_id: je.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

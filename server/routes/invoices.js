const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { applyStockOut, stockQty, round2 } = require('../services/inventoryAccounting');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');
const { getAccountByRole } = require('../services/accountResolver');

const router = express.Router();

// GET /api/invoices
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, payment_status, search, from_date, to_date, limit = 100, offset = 0 } = req.query;
    let q = `SELECT inv.*, c.name as customer_name, c.city as customer_city
             FROM invoices inv LEFT JOIN customers c ON inv.customer_id = c.id WHERE 1=1`;
    let countQ = `SELECT COUNT(*) FROM invoices inv LEFT JOIN customers c ON inv.customer_id = c.id WHERE 1=1`;
    const params = [];
    const countParams = [];
    if (status) { params.push(status); q += ` AND inv.status = $${params.length}`; countParams.push(status); countQ += ` AND inv.status = $${countParams.length}`; }
    if (payment_status) { params.push(payment_status); q += ` AND inv.payment_status = $${params.length}`; countParams.push(payment_status); countQ += ` AND inv.payment_status = $${countParams.length}`; }
    if (search) { params.push(`%${search}%`); q += ` AND (inv.doc_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`; countParams.push(`%${search}%`); countQ += ` AND (inv.doc_number ILIKE $${countParams.length} OR c.name ILIKE $${countParams.length})`; }
    if (from_date) { params.push(from_date); q += ` AND inv.doc_date >= $${params.length}`; countParams.push(from_date); countQ += ` AND inv.doc_date >= $${countParams.length}`; }
    if (to_date) { params.push(to_date); q += ` AND inv.doc_date <= $${params.length}`; countParams.push(to_date); countQ += ` AND inv.doc_date <= $${countParams.length}`; }
    q += ' ORDER BY inv.doc_date DESC, inv.id DESC';
    params.push(parseInt(limit)); q += ` LIMIT $${params.length}`;
    params.push(parseInt(offset)); q += ` OFFSET $${params.length}`;
    const result = await pool.query(q, params);
    const countR = await pool.query(countQ, countParams);
    res.json({ data: result.rows, total: parseInt(countR.rows[0].count) });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[invoices.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const inv = await pool.query(
      `SELECT inv.*, c.name as customer_name FROM invoices inv LEFT JOIN customers c ON inv.customer_id = c.id WHERE inv.id = $1`,
      [req.params.id]
    );
    if (inv.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const lines = await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_no', [req.params.id]);
    res.json({ ...inv.rows[0], lines: lines.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[invoices.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// POST /api/invoices (Create invoice + two JEs: Revenue + COGS)
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const { doc_date, customer_id, payment_term, currency, reference_no, remark, tax_pct, lines, cost_center_id } = req.body;

    if (!lines || lines.length === 0) throw new Error('At least one line item required');
    if (!customer_id) throw new Error('Customer required');

    const seqR = await client.query("SELECT nextval('inv_seq') as num");
    const docNumber = `RI-${seqR.rows[0].num}`;

    // Calculate sales totals. COGS is finalized after inventory locks below.
    let totalQty = 0, totalWeight = 0, subTotal = 0;
    for (const line of lines) {
      const wt = parseFloat(line.weight) || 0;
      const rate = parseFloat(line.rate_per_carat) || 0;
      const amt = wt * rate;
      totalQty += parseFloat(line.qty) || 1;
      totalWeight += wt;
      subTotal += amt;
    }
    const taxRate = parseFloat(tax_pct) || 5;
    const taxAmount = Math.round(subTotal * (taxRate / 100) * 100) / 100;
    const grandTotal = subTotal + taxAmount;

    // Insert invoice header
    const invR = await client.query(
      `INSERT INTO invoices (doc_number, doc_date, customer_id, payment_term, currency, reference_no, remark,
        total_qty, total_weight, sub_total, tax_pct, tax_amount, grand_total, balance_due, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15) RETURNING *`,
      [docNumber, doc_date, customer_id, payment_term || '30 Days', currency || 'INR',
       reference_no, remark, totalQty, totalWeight, subTotal, taxRate, taxAmount, grandTotal, grandTotal, req.user.id]
    );
    const inv = invR.rows[0];

    // Insert lines and update inventory
    let totalCogs = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const wt = parseFloat(line.weight) || 0;
      const rate = parseFloat(line.rate_per_carat) || 0;
      const amt = wt * rate;

      // Get locked cost from inventory for COGS and block invalid stock-outs.
      let costValue = parseFloat(line.cost_value) || 0;
      let stockOutQty = parseFloat(line.qty) || 1;
      let itemId = null;
      if (line.inventory_id) {
        const invCheck = await client.query(
          `SELECT inv.*, i.category
           FROM inventory inv
           JOIN items i ON i.id = inv.item_id
           WHERE inv.id = $1 FOR UPDATE`,
          [line.inventory_id]
        );
        if (!invCheck.rows.length) throw new Error(`Inventory lot ${line.inventory_id} not found`);
        const invLot = invCheck.rows[0];
        if (invLot.status !== 'IN STOCK') throw new Error(`Lot ${invLot.lot_number} is not available for sale`);
        itemId = invLot.item_id;
        stockOutQty = stockQty(invLot);
        costValue = round2(parseFloat(invLot.total_value) || costValue);
      }
      totalCogs += costValue;

      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, inventory_id, lot_number, lot_name, qty, weight, color, clarity, rate_per_carat, amount, cost_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [inv.id, i + 1, line.inventory_id || null, line.lot_number, line.lot_name,
         line.qty || 1, wt, line.color, line.clarity, rate, amt, costValue]
      );

      // Mark inventory as SOLD
      if (line.inventory_id) {
        await client.query("UPDATE inventory SET status = 'SOLD', last_used = $1 WHERE id = $2", [doc_date, line.inventory_id]);
        await applyStockOut(client, itemId, stockOutQty, costValue);
      }
    }

    // JE 1: Revenue booking — Dr Accounts Receivable, Cr Sales Revenue (+ Cr GST Payable if tax)
    const arAccId = await getAccountByRole('ACCOUNTS_RECEIVABLE', client);
    const revenueAccId = await getAccountByRole('SALES_REVENUE', client);
    const gstAccId = await getAccountByRole('GST_PAYABLE', client);

    if (!arAccId || !revenueAccId) throw new Error('Revenue accounts not found in COA');

    const ccId = cost_center_id ? parseInt(cost_center_id) : null;
    const revJELines = [
      { accountId: arAccId, debit: grandTotal, credit: 0, narration: `Invoice ${docNumber} receivable`, costCenterId: ccId },
      { accountId: revenueAccId, debit: 0, credit: subTotal, narration: `Rough diamond sale ${docNumber}`, costCenterId: ccId },
    ];
    if (taxAmount > 0 && gstAccId) {
      revJELines.push({ accountId: gstAccId, debit: 0, credit: taxAmount, narration: `GST on ${docNumber}`, costCenterId: ccId });
    }

    const revJE = await journalEngine.createEntry({
      date: doc_date, description: `Invoice ${docNumber} - Revenue`,
      sourceType: 'invoice', sourceId: inv.id, lines: revJELines,
      autoPost: true, createdBy: req.user.id,
      client,
    });

    // JE 2: COGS booking — Dr COGS-Diamonds, Cr Rough Diamond Inventory
    let cogsJeId = null;
    if (totalCogs > 0) {
      const cogsAccId = await getAccountByRole('COGS', client);
      const roughInvAccId = await getAccountByRole('INVENTORY_ROUGH', client);
      if (cogsAccId && roughInvAccId) {
        const cogsJE = await journalEngine.createEntry({
          date: doc_date, description: `Invoice ${docNumber} - COGS`,
          sourceType: 'invoice_cogs', sourceId: inv.id,
          lines: [
            { accountId: cogsAccId, debit: totalCogs, credit: 0, narration: `Cost of rough sold ${docNumber}` },
            { accountId: roughInvAccId, debit: 0, credit: totalCogs, narration: `Inventory reduced ${docNumber}` },
          ],
          autoPost: true, createdBy: req.user.id,
          client,
        });
        cogsJeId = cogsJE.id;
      }
    }

    // Update customer outstanding
    await client.query('UPDATE customers SET outstanding = outstanding + $1 WHERE id = $2', [grandTotal, customer_id]);

    // Link JEs
    await client.query('UPDATE invoices SET je_id = $1, cogs_je_id = $2 WHERE id = $3', [revJE.id, cogsJeId, inv.id]);

    await client.query('COMMIT');

    // Real-Time: notify sales + inventory rooms
    dispatchEvent('sale.created', {
      id: inv.id, doc_number: docNumber, customer_id,
      grand_total: grandTotal, lines_count: lines.length,
      created_by: req.user.id,
    }, { targetUserId: req.user.id });

    res.status(201).json({ ...inv, doc_number: docNumber, je_number: revJE.je_number });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;

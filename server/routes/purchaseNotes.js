const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { applyPurchase } = require('../services/inventoryAccounting');
const { authenticate, authorize } = require('../middleware/auth');
const { isSeedItem, nextPurchaseLotCode, nextLotOpId } = require('../services/seedLotCodeService');
const { reserveCode } = require('../services/codeGeneratorService');
const { dispatchEvent } = require('../services/eventDispatcher');
const { logger } = require('../middleware/logger');

const router = express.Router();


const { getAccountByRole } = require('../services/accountResolver');

// GET /api/purchase-notes/debug
router.get('/debug', async (req, res) => {
  try {
    const pn = await pool.query('SELECT id, doc_number FROM purchase_notes ORDER BY id DESC LIMIT 10');
    res.json(pn.rows);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// GET /api/purchase-notes
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, type, search, date_from, date_to, limit = 50, offset = 0 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (status)    { params.push(status.toLowerCase()); where += ` AND pn.status = $${params.length}`; }
    if (type)      { params.push(type);                 where += ` AND pn.item_type = $${params.length}`; }
    if (date_from) { params.push(date_from);            where += ` AND pn.doc_date::date >= $${params.length}::date`; }
    if (date_to)   { params.push(date_to);              where += ` AND pn.doc_date::date <= $${params.length}::date`; }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (pn.doc_number ILIKE $${params.length} OR v.name ILIKE $${params.length} OR pn.remark ILIKE $${params.length})`;
    }

    const dataParams = [...params, parseInt(limit), parseInt(offset)];
    
    let q = `SELECT pn.*, v.name as vendor_name, d.name as dept_name, je.je_number
             FROM purchase_notes pn
             LEFT JOIN vendors v ON pn.vendor_id = v.id
             LEFT JOIN departments d ON pn.department_id = d.id 
             LEFT JOIN journal_entries je ON pn.je_id = je.id
             ${where}
             ORDER BY pn.doc_date DESC, pn.id DESC
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
             
    const result = await pool.query(q, dataParams);

    let countSql;
    if (search) {
      countSql = `SELECT COUNT(*) FROM purchase_notes pn LEFT JOIN vendors v ON pn.vendor_id = v.id ${where}`;
    } else {
      countSql = `SELECT COUNT(*) FROM purchase_notes pn ${where}`;
    }
    const countR = await pool.query(countSql, params);
    
    res.json({ data: result.rows, total: parseInt(countR.rows[0].count) });
  } catch (err) { logger.error('GET /api/purchase-notes error:', { error: err.message }); res.status(500).json({ error: err.message }); }
});

// GET /api/purchase-notes/:id (with lines)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const pn = await pool.query(
      `SELECT pn.*, v.name as vendor_name, d.name as dept_name, cc.name as cost_center_name
       FROM purchase_notes pn
       LEFT JOIN vendors v ON pn.vendor_id = v.id
       LEFT JOIN departments d ON pn.department_id = d.id
       LEFT JOIN cost_centers cc ON pn.cost_center_id = cc.id
       WHERE pn.id = $1`,
      [req.params.id]
    );
    if (pn.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const header = pn.rows[0];

    let linesResult = await pool.query(
      `SELECT pnl.*, i.name as item_name, i.code as item_code,
              inv.weight, inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit, inv.lot_number
       FROM purchase_note_lines pnl 
       LEFT JOIN items i ON pnl.item_id = i.id
       LEFT JOIN inventory inv ON pnl.inventory_id = inv.id
       WHERE pnl.purchase_note_id = $1 ORDER BY pnl.line_no`,
      [req.params.id]
    );

    // Fallback: if no lines in purchase_note_lines, reconstruct from inventory
    // using the doc_number embedded in lot_number (e.g. 'GAS-B-19988382-1')
    if (linesResult.rows.length === 0 && header.doc_number) {
      const docSuffix = header.doc_number.replace(/^PN-/, ''); // e.g. 'B-19988382'
      const fallback = await pool.query(
        `SELECT
           inv.id,
           inv.item_id,
           COALESCE(inv.remarks, '') AS description,
           COALESCE(inv.batch_no, '') AS batch_no,
           inv.qty,
           inv.unit,
           inv.weight,
           inv.rate,
           inv.total_value AS amount,
           0 AS tax_pct,
           0 AS tax_amount,
           inv.total_value AS total,
           inv.lot_number AS batch_no,
           inv.dim_length,
           inv.dim_depth,
           inv.dim_height,
           inv.dim_unit,
           i.name AS item_name,
           i.code AS item_code
         FROM inventory inv
         LEFT JOIN items i ON inv.item_id = i.id
         WHERE inv.lot_number ILIKE $1
            OR inv.lot_number ILIKE $2
            OR inv.lot_number ILIKE $3
            OR inv.lot_number ILIKE $4
         ORDER BY inv.id`,
        [
          `SEED-${docSuffix}-%`,
          `GAS-${docSuffix}-%`,
          `CON-${docSuffix}-%`,
          `%-${docSuffix}-%`,
        ]
      );
      linesResult = fallback;
    }

    // Last resort: if still no lines, build a synthetic summary row from the header totals
    // (This happens when inventory was wiped by a DB reset — the accounting data is preserved
    //  but individual lot records no longer exist)
    let syntheticLines = [];
    if (linesResult.rows.length === 0) {
      const totalQty = parseFloat(header.total_qty) || 0;
      const totalAmt = parseFloat(header.total_amount) || 0;
      const taxAmt   = parseFloat(header.tax_amount) || 0;
      const grandTot = parseFloat(header.grand_total) || 0;
      if (totalQty > 0 || totalAmt > 0) {
        syntheticLines = [{
          _synthetic: true,
          item_id: '',
          item_name: `(${header.item_type || 'Items'} — detail not available)`,
          item_code: '',
          description: header.remark || '',
          batch_no: '',
          qty: totalQty,
          unit: 'PCS',
          weight: '',
          rate: totalQty > 0 ? (totalAmt / totalQty).toFixed(2) : 0,
          amount: totalAmt,
          tax_pct: totalAmt > 0 ? ((taxAmt / totalAmt) * 100).toFixed(2) : 0,
          tax_amount: taxAmt,
          total: grandTot,
          dim_length: '', dim_depth: '', dim_height: '', dim_unit: 'mm',
        }];
      }
    }

    res.json({ ...header, lines: linesResult.rows.length > 0 ? linesResult.rows : syntheticLines });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[purchaseNotes.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// POST /api/purchase-notes (Create + inventory + JE)
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { doc_date, vendor_id, item_type, department_id, payment_term, currency,
            reference_no, remark, lines, cost_center_id } = req.body;
    const costCenterId = cost_center_id ? parseInt(cost_center_id) : null;

    if (!lines || lines.length === 0) throw new Error('At least one line item required');

    // Generate doc number
    const seqR = await client.query("SELECT nextval('pn_seq') as num");
    const docNumber = `PN-${seqR.rows[0].num}`;

    // Calculate totals
    let totalQty = 0, totalAmount = 0, taxAmount = 0;
    for (const line of lines) {
      const amt = (parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0);
      const tax = amt * ((parseFloat(line.tax_pct) || 0) / 100);
      totalQty += parseFloat(line.qty) || 0;
      totalAmount += amt;
      taxAmount += tax;
    }
    const grandTotal = totalAmount + taxAmount;

    // Insert purchase note header
    const pnR = await client.query(
      `INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, department_id,
        payment_term, currency, reference_no, remark, total_qty, total_amount, tax_amount, grand_total,
        balance_due, amount_paid, payment_status, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,'UNPAID','open',$15) RETURNING *`,
      [docNumber, doc_date, vendor_id || null, item_type, department_id || null,
       payment_term || 'Immediate', currency || 'INR', reference_no, remark,
       totalQty, totalAmount, taxAmount, grandTotal, grandTotal, req.user.id]
    );
    const pn = pnR.rows[0];

    // Insert lines — handle capital vs regular items
    const insertedLines = [];
    const createdAssets = [];
    const invAccountCodeMap = { seed: '2001', gas: '2002', consumable: '2003' };
    const drAccountMap = {}; // { accountId: totalAmount (pre-tax) }

    // Batch-fetch all items in a single query instead of N+1
    const itemIds = [...new Set(lines.map(l => parseInt(l.item_id)))];
    const itemsR = await client.query(
      'SELECT id, code, name, category, is_capital_asset, fixed_asset_category_id FROM items WHERE id = ANY($1::int[])',
      [itemIds]
    );
    const itemsById = {};
    for (const row of itemsR.rows) itemsById[row.id] = row;

    // Batch-fetch fixed_asset_categories if any capital items
    const capitalItemIds = itemsR.rows.filter(r => r.is_capital_asset && r.fixed_asset_category_id).map(r => r.fixed_asset_category_id);
    const catIds = [...new Set(capitalItemIds)];
    let catsById = {};
    if (catIds.length > 0) {
      const catR = await client.query('SELECT id, gl_asset_account_id FROM fixed_asset_categories WHERE id = ANY($1::int[])', [catIds]);
      for (const row of catR.rows) catsById[row.id] = row;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const amt     = (parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0);
      const taxAmt  = amt * ((parseFloat(line.tax_pct) || 0) / 100);
      const lineTotal = amt + taxAmt;

      const item = itemsById[parseInt(line.item_id)];
      if (!item) throw new Error(`Item ID ${line.item_id} not found`);

      if (item.is_capital_asset) {
        // ── Capital asset path ──────────────────────────────────────────────
        if (!item.fixed_asset_category_id)
          throw new Error(`Item "${item.name}" is marked as capital asset but has no asset category assigned`);

        const catRow = catsById[item.fixed_asset_category_id];
        if (!catRow) throw new Error(`Asset category ${item.fixed_asset_category_id} not found`);
        const assetAccId = catRow.gl_asset_account_id;
        drAccountMap[assetAccId] = Math.round(((drAccountMap[assetAccId] || 0) + amt) * 100) / 100;

        // Insert line first (no inventory)
        const lineR = await client.query(
          `INSERT INTO purchase_note_lines
             (purchase_note_id,line_no,item_id,description,batch_no,
              qty,unit,rate,amount,tax_pct,tax_amount,total,is_capital)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
          [pn.id, i + 1, line.item_id, line.description, line.batch_no,
           line.qty, line.unit || 'PCS', line.rate, amt, line.tax_pct || 0, taxAmt, lineTotal]
        );

        const assetCode = await reserveCode('fixed_asset', client, { date: doc_date });

        const faR = await client.query(
          `INSERT INTO fixed_assets
             (asset_code,asset_name,category_id,purchase_note_id,purchase_note_line_id,
              vendor_id,purchase_date,in_service_date,purchase_cost,salvage_value,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,0,$9) RETURNING *`,
          [assetCode, item.name, item.fixed_asset_category_id, pn.id, lineR.rows[0].id,
           vendor_id || null, doc_date, amt, req.user.id]
        );
        createdAssets.push(faR.rows[0]);
        insertedLines.push(lineR.rows[0]);
      } else {
        // ── Regular inventory path ────────────────────────────────────────
        // Seed items: use genealogy sequence for lot_code and lot_number.
        // Non-seed items: use legacy prefix format, no lot_code.
        let lotNumber, lotCode;
        if (isSeedItem(item)) {
          lotCode   = await nextPurchaseLotCode(client);
          lotNumber = lotCode;
        } else {
          const catPrefix = item.category === 'gas' ? 'GAS' : 'CON';
          lotNumber = `${catPrefix}-${docNumber.replace('PN-', '')}-${i + 1}`;
          lotCode   = null;
        }

        // Dimension fields — seed items only
        const isSeed = isSeedItem(item);
        const dimLength = isSeed && line.dim_length !== '' && line.dim_length != null
          ? parseFloat(line.dim_length) : null;
        const dimDepth  = isSeed && line.dim_depth  !== '' && line.dim_depth  != null
          ? parseFloat(line.dim_depth)  : null;
        const dimHeight = isSeed && line.dim_height !== '' && line.dim_height != null
          ? parseFloat(line.dim_height) : null;
        const dimUnit   = isSeed ? (line.dim_unit || 'mm') : null;

        const DIM_MAX = 99999;
        if (dimLength !== null && dimLength < 0) throw new Error('Dimension values cannot be negative');
        if (dimLength !== null && dimLength > DIM_MAX) throw new Error(`Dimension length cannot exceed ${DIM_MAX}mm`);
        if (dimDepth  !== null && dimDepth  < 0) throw new Error('Dimension values cannot be negative');
        if (dimDepth  !== null && dimDepth  > DIM_MAX) throw new Error(`Dimension depth cannot exceed ${DIM_MAX}mm`);
        if (dimHeight !== null && dimHeight < 0) throw new Error('Dimension values cannot be negative');
        if (dimHeight !== null && dimHeight > DIM_MAX) throw new Error(`Dimension height cannot exceed ${DIM_MAX}mm`);

        const lotOpId = await nextLotOpId(client);

        const invR = await client.query(
          `INSERT INTO inventory
             (item_id,lot_number,lot_name,batch_no,qty,unit,weight,rate,total_value,
              location_id,department_id,vendor_id,purchase_date,status,remarks,
              lot_code,operation_type,split_level,lot_op_id,dim_length,dim_depth,dim_height,dim_unit,
              source_module)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN STOCK',$14,
                   $15,'purchase',0,$16,$17,$18,$19,$20,
                   'Purchase Notes') RETURNING id`,
          [line.item_id, lotNumber, `${item.code}-${lotNumber}`, line.batch_no,
           line.qty, line.unit || 'PCS', parseFloat(line.weight) || 0, line.rate, amt,
           line.location_id || null, department_id || null, vendor_id || null, doc_date,
           line.description, lotCode, lotOpId, dimLength, dimDepth, dimHeight, dimUnit]
        );

        // For seed lots: root_lot_id = self, genealogy_path = lot_code
        if (isSeedItem(item)) {
          const newId = invR.rows[0].id;
          await client.query(
            'UPDATE inventory SET root_lot_id = $1, genealogy_path = $2 WHERE id = $1',
            [newId, lotCode]
          );
        }

        const lineR = await client.query(
          `INSERT INTO purchase_note_lines
             (purchase_note_id,line_no,item_id,description,batch_no,
              qty,unit,rate,amount,tax_pct,tax_amount,total,inventory_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [pn.id, i + 1, line.item_id, line.description, line.batch_no,
           line.qty, line.unit || 'PCS', line.rate, amt, line.tax_pct || 0, taxAmt, lineTotal, invR.rows[0].id]
        );
        insertedLines.push(lineR.rows[0]);

        // Accumulate Dr line by item category
        const invRoleMap = { seed: 'INVENTORY_SEED', gas: 'INVENTORY_GAS', consumable: 'INVENTORY_CONSUMABLE' };
        const invAccRole = invRoleMap[item.category] || 'INVENTORY_SEED';
        const invAccId   = await getAccountByRole(invAccRole, client);
        if (!invAccId) throw new Error(`Inventory account role '${invAccRole}' not found in Chart of Accounts.`);
        drAccountMap[invAccId] = Math.round(((drAccountMap[invAccId] || 0) + amt) * 100) / 100;
        await applyPurchase(client, line.item_id, line.qty, line.rate, amt);
      }
    }

    const payableAccId = await getAccountByRole('ACCOUNTS_PAYABLE', client);
    if (!payableAccId) throw new Error(`Payable account role 'ACCOUNTS_PAYABLE' not found in Chart of Accounts.`);

    // Build JE debit lines from drAccountMap
    const jeLines = [];
    for (const [accId, amount] of Object.entries(drAccountMap)) {
      jeLines.push({ accountId: parseInt(accId), debit: amount, credit: 0,
                     narration: `Purchase ${item_type} - ${docNumber}`,
                     costCenterId });
    }

    // Add GST if applicable
    if (taxAmount > 0) {
      const gstAccId = await getAccountByRole('GST_PAYABLE', client);
      if (gstAccId) {
        jeLines.push({ accountId: gstAccId, debit: Math.round(taxAmount * 100) / 100, credit: 0,
                       narration: `GST on ${docNumber}`,
                       costCenterId });
      }
    }

    const vendorNameR = vendor_id
      ? await client.query('SELECT name FROM vendors WHERE id=$1', [vendor_id])
      : { rows: [{ name: 'Unknown Vendor' }] };
    if (vendor_id && !vendorNameR.rows[0]) throw new Error(`Vendor ID ${vendor_id} not found`);
    jeLines.push({
      accountId: payableAccId, debit: 0, credit: Math.round(grandTotal * 100) / 100,
      narration: `Payable to ${vendorNameR.rows[0]?.name || 'Unknown Vendor'}`,
      costCenterId,
    });

    const je = await journalEngine.createEntry({
      date: doc_date,
      description: `Purchase Note ${docNumber} - ${item_type}`,
      sourceType: 'purchase',
      sourceId: pn.id,
      lines: jeLines,
      autoPost: true,
      createdBy: req.user.id,
      client,
    });

    // Link JE to purchase note
    await client.query('UPDATE purchase_notes SET je_id = $1 WHERE id = $2', [je.id, pn.id]);

    await client.query('COMMIT');

    // ── Real-Time Sync: fire events AFTER successful commit ──────────────────
    dispatchEvent('purchase.created', {
      id: pn.id, doc_number: docNumber, item_type, vendor_id,
      grand_total: grandTotal, created_by: req.user.id,
    }, { targetUserId: req.user.id });

    dispatchEvent('inventory.created', {
      source: 'purchase', doc_number: docNumber,
      lines_count: insertedLines.length,
    });

    res.status(201).json({
      ...pn, doc_number: docNumber, lines: insertedLines, je_number: je.je_number,
      capital_assets: createdAssets, capital_assets_count: createdAssets.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

});

module.exports = router;

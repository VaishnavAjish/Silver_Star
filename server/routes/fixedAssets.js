const express = require('express');
const pool    = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { calculateForAsset, projectSchedule } = require('../services/depreciationEngine');
const { reserveCode } = require('../services/codeGeneratorService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

const { getAccountByRole } = require('../services/accountResolver');

const money = value => Math.round((parseFloat(value) || 0) * 100) / 100;

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, category_id, search, limit = 100, offset = 0 } = req.query;
    const where  = ['1=1'];
    const params = [];
    if (status)      { params.push(status);               where.push(`fa.status = $${params.length}`); }
    if (category_id) { params.push(parseInt(category_id)); where.push(`fa.category_id = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(fa.asset_name ILIKE $${params.length} OR fa.asset_code ILIKE $${params.length} OR fa.serial_no ILIKE $${params.length} OR fa.asset_tag ILIKE $${params.length})`);
    }
    const whereClause = where.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(fa.id) FROM fixed_assets fa WHERE ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const listParams = [...params];
    listParams.push(parseInt(limit));  const li = listParams.length;
    listParams.push(parseInt(offset)); const oi = listParams.length;

    const result = await pool.query(
      `SELECT fa.id, fa.asset_code, fa.asset_name, fa.category_id,
         fa.template_id,
         fa.purchase_date, fa.in_service_date, fa.purchase_cost,
         fa.accumulated_depreciation, fa.status,
         fa.serial_no, fa.brand, fa.model_no, fa.asset_tag,
         fa.qty, fa.condition, fa.manufacturer, fa.custodian,
         fa.location_id, fa.department_id,
         (fa.purchase_cost - fa.accumulated_depreciation) AS wdv_today,
         fac.name  AS category_name,
         fac.depreciation_rate_pct,
         fac.depreciation_method,
         v.name    AS vendor_name,
         l.name    AS location_name,
         d.name    AS department_name,
         tmpl.name AS template_name,
         tmpl.code AS template_code
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       LEFT JOIN vendors          v    ON fa.vendor_id     = v.id
       LEFT JOIN locations        l    ON fa.location_id   = l.id
       LEFT JOIN departments      d    ON fa.department_id = d.id
       LEFT JOIN asset_templates  tmpl ON fa.template_id   = tmpl.id
       WHERE ${whereClause}
       ORDER BY fa.purchase_date DESC, fa.id DESC
       LIMIT $${li} OFFSET $${oi}`,
      listParams
    );
    res.json({ data: result.rows, total });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssets.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── DETAIL ────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const faR = await pool.query(
      `SELECT fa.*,
         fac.name AS category_name,
         fac.depreciation_rate_pct, fac.depreciation_method, fac.useful_life_years,
         fac.gl_asset_account_id, fac.gl_accum_depr_account_id, fac.gl_depr_expense_account_id,
         fac.gl_asset_code, fac.gl_asset_name,
         (fa.purchase_cost - fa.accumulated_depreciation) AS wdv_today,
         v.name  AS vendor_name,
         l.name  AS location_name,
         d.name  AS department_name,
         pn.doc_number AS purchase_note_number,
         u.code AS uom_code, u.name AS uom_name,
         tmpl.name AS template_name, tmpl.code AS template_code
       FROM fixed_assets fa
       JOIN (
         SELECT fac2.*,
           a1.code AS gl_asset_code, a1.name AS gl_asset_name
         FROM fixed_asset_categories fac2
         LEFT JOIN accounts a1 ON fac2.gl_asset_account_id = a1.id
       ) fac ON fa.category_id = fac.id
       LEFT JOIN vendors      v  ON fa.vendor_id        = v.id
       LEFT JOIN locations    l  ON fa.location_id      = l.id
       LEFT JOIN departments  d  ON fa.department_id    = d.id
       LEFT JOIN purchase_notes  pn   ON fa.purchase_note_id = pn.id
       LEFT JOIN uom             u    ON fa.uom_id           = u.id
       LEFT JOIN asset_templates tmpl ON fa.template_id      = tmpl.id
       WHERE fa.id = $1`,
      [req.params.id]
    );
    if (!faR.rows.length) return res.status(404).json({ error: 'Not found' });

    const histR = await pool.query(
      `SELECT drl.*, dr.period_from, dr.period_to, dr.run_number, dr.status AS run_status
       FROM depreciation_run_lines drl
       JOIN depreciation_runs dr ON drl.run_id = dr.id
       WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted'
       ORDER BY dr.period_to DESC LIMIT 12`,
      [req.params.id]
    );

    res.json({ ...faR.rows[0], depreciation_history: histR.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssets.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── TRANSACTIONS (all JEs linked to this asset) ───────────────────────────────
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id);
    if (!assetId || isNaN(assetId)) return res.status(400).json({ error: 'Invalid asset id' });

    // Direct JEs: purchase (fixed_asset_purchase) + disposal
    const directR = await pool.query(
      `SELECT je.id, je.je_number, je.date::text AS date,
              je.description, je.source_type, je.total_debit AS amount, je.status
       FROM journal_entries je
       WHERE je.source_type IN ('fixed_asset_purchase', 'disposal')
         AND je.source_id = $1
       ORDER BY je.date DESC, je.id DESC`,
      [assetId]
    );

    // Depreciation JEs: linked via depreciation_run_lines → depreciation_runs → journal_entries
    const deprR = await pool.query(
      `SELECT je.id, je.je_number, dr.period_to::text AS date,
              je.description, je.source_type, drl.depreciation_amount AS amount, je.status
       FROM depreciation_run_lines drl
       JOIN depreciation_runs   dr ON drl.run_id = dr.id
       JOIN journal_entries      je ON dr.je_id   = je.id
       WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted'
       ORDER BY dr.period_to DESC, dr.id DESC`,
      [assetId]
    );

    const all = [...directR.rows, ...deprR.rows].sort(
      (a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id
    );

    res.json({ data: all, total: all.length });
  } catch (err) {
    logger.error('[fixed-assets GET /:id/transactions]', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── MANUAL ENTRY (opening-balance assets) ─────────────────────────────────────
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const {
      asset_name, category_id, vendor_id, location_id, department_id,
      purchase_date, in_service_date, purchase_cost, salvage_value,
      accumulated_depreciation, remarks, invoice_no, invoice_date,
      taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
      gst_claimable_amount, gst_non_claimable_amount, gst_treatment,
      total_invoice_value,
      // Physical fields
      serial_no, model_no, brand, manufacturer, qty, uom_id,
      asset_tag, condition, warranty_expiry, installation_date, custodian,
      // Template linkage (optional — standardization layer only)
      template_id,
      // Cost centre (optional analytical metadata only)
      cost_center_id,
    } = req.body;

    if (!asset_name || !category_id || !purchase_date || !in_service_date || purchase_cost == null)
      return res.status(400).json({ error: 'Required: asset_name, category_id, purchase_date, in_service_date, purchase_cost' });

    const taxable = money(taxable_value);
    const cgst = money(cgst_amount);
    const sgst = money(sgst_amount);
    const igst = money(igst_amount);
    const totalGst = money(cgst + sgst + igst);
    const invoiceTotal = money(total_invoice_value || taxable + totalGst || purchase_cost);
    const capitalizedCost = money(purchase_cost || invoiceTotal);
    const treatment = ['claimable', 'non_claimable', 'partial'].includes(gst_treatment)
      ? gst_treatment : 'non_claimable';
    const claimable    = money(gst_claimable_amount);
    const nonClaimable = money(gst_non_claimable_amount);

    if (money(claimable + nonClaimable) > totalGst) {
      return res.status(400).json({ error: 'Claimable + non-claimable GST cannot exceed total GST' });
    }

    await client.query('BEGIN');

    const assetCode = await reserveCode('fixed_asset', client, { date: purchase_date });

    const vendorNameR = vendor_id
      ? await client.query('SELECT name FROM vendors WHERE id=$1', [vendor_id])
      : { rows: [{ name: 'vendor' }] };
    const vendorName = vendorNameR.rows[0]?.name || 'vendor';

    // Purchase note for audit trail
    const pnResult = await client.query(
      `INSERT INTO purchase_notes
         (doc_number, doc_date, vendor_id, item_type, department_id, payment_term,
          currency, reference_no, remark, total_qty, total_amount, tax_amount,
          grand_total, balance_due, amount_paid, payment_status, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,0,'UNPAID','open',$14)
       RETURNING *`,
      [assetCode, purchase_date, vendor_id || null, 'fixed_asset', department_id || null,
       'Immediate', 'INR', invoice_no || null, `Fixed asset purchase - ${asset_name}`,
       1, taxable || capitalizedCost, totalGst, capitalizedCost, req.user.id]
    );
    const pn = pnResult.rows[0];

    const result = await client.query(
      `INSERT INTO fixed_assets
         (asset_code, asset_name, category_id, vendor_id, location_id, department_id,
          purchase_note_id, template_id,
          purchase_date, in_service_date, invoice_no, invoice_date,
          taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
          gst_claimable_amount, gst_non_claimable_amount, gst_treatment, total_invoice_value,
          purchase_cost, salvage_value, accumulated_depreciation, remarks,
          serial_no, model_no, brand, manufacturer, qty, uom_id,
          asset_tag, condition, warranty_expiry, installation_date, custodian,
          created_by, cost_center_id)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
       RETURNING *`,
      [
        assetCode, asset_name, category_id,
        vendor_id || null, location_id || null, department_id || null,
        pn.id,
        template_id ? parseInt(template_id) : null,
        purchase_date, in_service_date,
        invoice_no || null, invoice_date || purchase_date,
        taxable, money(gst_rate), cgst, sgst, igst,
        claimable, nonClaimable, treatment, invoiceTotal,
        capitalizedCost, money(salvage_value), money(accumulated_depreciation),
        remarks || null,
        serial_no || null, model_no || null, brand || null, manufacturer || null,
        money(qty) || 1, uom_id || null,
        asset_tag || null,
        ['new','good','fair','poor','damaged'].includes(condition) ? condition : 'new',
        warranty_expiry || null, installation_date || null, custodian || null,
        req.user.id,
        cost_center_id ? parseInt(cost_center_id) : null,
      ]
    );
    const asset = result.rows[0];

    await client.query(
      `INSERT INTO purchase_note_lines
         (purchase_note_id, line_no, item_id, description, qty, unit, rate, amount, tax_pct, tax_amount, total, is_capital)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pn.id, 1, null, asset_name, 1, 'NOS',
       taxable || capitalizedCost, taxable || capitalizedCost,
       money(gst_rate), totalGst, capitalizedCost, true]
    );

    if (taxable > 0 || totalGst > 0 || invoice_no) {
      await client.query(
        `INSERT INTO fixed_asset_gst_ledger
           (fixed_asset_id, vendor_id, invoice_no, invoice_date, taxable_value,
            cgst_amount, sgst_amount, igst_amount, gst_claimable_amount,
            gst_non_claimable_amount, total_invoice_value, treatment, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [asset.id, vendor_id || null, invoice_no || null, invoice_date || purchase_date,
         taxable, cgst, sgst, igst, claimable, nonClaimable, invoiceTotal, treatment,
         'Fixed asset GST tracking']
      );
    }

    // Fetch category's asset GL account
    const catR = await client.query(
      'SELECT gl_asset_account_id FROM fixed_asset_categories WHERE id = $1',
      [category_id]
    );
    const assetAccId = catR.rows[0]?.gl_asset_account_id;
    if (!assetAccId) throw new Error('Fixed asset category is missing an asset GL account');

    const payableAccId = await getAccountByRole('ACCOUNTS_PAYABLE', client);
    if (!payableAccId) throw new Error('Accounts Payable account role not found in COA');

    // JE: Dr category FA account / Cr AP — unchanged from before
    const je = await journalEngine.createEntry({
      date:        purchase_date,
      description: `Fixed Asset Purchase ${assetCode} - ${asset_name}`,
      sourceType:  'fixed_asset_purchase',
      sourceId:    asset.id,
      lines: [
        { accountId: assetAccId,   debit: capitalizedCost, credit: 0,
          narration: `Capitalized asset cost - ${assetCode}`,
          costCenterId: asset.cost_center_id || null },
        { accountId: payableAccId, debit: 0, credit: capitalizedCost,
          narration: `Payable to ${vendorName} - ${assetCode}`,
          costCenterId: asset.cost_center_id || null },
      ],
      autoPost:   true,
      createdBy:  req.user.id,
      client,
    });

    await client.query('UPDATE purchase_notes SET je_id = $1 WHERE id = $2', [je.id, pn.id]);

    await client.query('COMMIT');
    res.status(201).json({ ...asset, purchase_note_id: pn.id, je_id: je.id, je_number: je.je_number });
    dispatchEvent('asset.created', asset).catch(() => {});
  } catch (err) {
    console.error('[POST /api/fixed-assets] ERROR:', err);
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PATCH (edit metadata; cost locked once depreciation posted) ───────────────
router.patch('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const deprCheck = await pool.query(
      `SELECT COUNT(*) FROM depreciation_run_lines drl
       JOIN depreciation_runs dr ON drl.run_id = dr.id
       WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted'`,
      [req.params.id]
    );
    const locked = parseInt(deprCheck.rows[0].count) > 0;

    const sets   = [];
    const params = [];
    const add    = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    // Always editable
    if (req.body.template_id      !== undefined) add('template_id',      req.body.template_id      ? parseInt(req.body.template_id) : null);
    if (req.body.cost_center_id   !== undefined) add('cost_center_id',   req.body.cost_center_id   ? parseInt(req.body.cost_center_id)   : null);
    if (req.body.asset_name       !== undefined) add('asset_name',       req.body.asset_name);
    if (req.body.location_id      !== undefined) add('location_id',      req.body.location_id      || null);
    if (req.body.department_id    !== undefined) add('department_id',    req.body.department_id    || null);
    if (req.body.remarks          !== undefined) add('remarks',          req.body.remarks);
    if (req.body.serial_no        !== undefined) add('serial_no',        req.body.serial_no        || null);
    if (req.body.model_no         !== undefined) add('model_no',         req.body.model_no         || null);
    if (req.body.brand            !== undefined) add('brand',            req.body.brand            || null);
    if (req.body.manufacturer     !== undefined) add('manufacturer',     req.body.manufacturer     || null);
    if (req.body.asset_tag        !== undefined) add('asset_tag',        req.body.asset_tag        || null);
    if (req.body.condition        !== undefined) add('condition',        req.body.condition        || null);
    if (req.body.warranty_expiry  !== undefined) add('warranty_expiry',  req.body.warranty_expiry  || null);
    if (req.body.installation_date !== undefined) add('installation_date', req.body.installation_date || null);
    if (req.body.custodian        !== undefined) add('custodian',        req.body.custodian        || null);
    if (req.body.uom_id           !== undefined) add('uom_id',           req.body.uom_id           || null);
    if (req.body.qty              !== undefined) add('qty',              money(req.body.qty) || 1);

    // Cost fields locked once depreciation has been posted
    if (!locked) {
      if (req.body.in_service_date  !== undefined) add('in_service_date',  req.body.in_service_date);
      if (req.body.purchase_cost    !== undefined) add('purchase_cost',    req.body.purchase_cost);
      if (req.body.salvage_value    !== undefined) add('salvage_value',    req.body.salvage_value);
      if (req.body.category_id      !== undefined) add('category_id',      req.body.category_id);
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE fixed_assets SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...result.rows[0], cost_locked: locked });
    dispatchEvent('asset.updated', result.rows[0]).catch(() => {});
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssets.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── DISPOSE ───────────────────────────────────────────────────────────────────
router.post('/:id/dispose', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const { disposal_date, disposal_value, remarks } = req.body;
    if (!disposal_date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'disposal_date required' });
    }

    const faR = await client.query(
      `SELECT fa.*, fac.gl_asset_account_id, fac.gl_accum_depr_account_id
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE fa.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!faR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const asset = faR.rows[0];
    if (asset.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Asset is not active' });
    }

    const cost       = parseFloat(asset.purchase_cost);
    const accDepr    = parseFloat(asset.accumulated_depreciation);
    const nbv        = cost - accDepr;
    const proceeds   = parseFloat(disposal_value) || 0;
    const gainOrLoss = Math.round((proceeds - nbv) * 100) / 100;

    const jeLines = [];

    if (accDepr > 0) {
      jeLines.push({
        accountId: asset.gl_accum_depr_account_id,
        debit: accDepr, credit: 0,
        narration: `Disposal: clear accumulated depreciation — ${asset.asset_code}`,
      });
    }

    if (proceeds > 0) {
      const cashId = await getAccountByRole('CASH_MAIN', client);
      if (!cashId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cash account role not found in COA' });
      }
      jeLines.push({ accountId: cashId, debit: proceeds, credit: 0,
                     narration: `Disposal proceeds — ${asset.asset_code}` });
    }

    jeLines.push({
      accountId: asset.gl_asset_account_id,
      debit: 0, credit: cost,
      narration: `Disposal: derecognize asset — ${asset.asset_code}`,
    });

    if (Math.abs(gainOrLoss) >= 0.01) {
      if (gainOrLoss < 0) {
        const lossId = await getAccountByRole('LOSS_ON_DISPOSAL', client);
        if (!lossId) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Loss on disposal account role not found' });
        }
        jeLines.push({ accountId: lossId, debit: Math.abs(gainOrLoss), credit: 0,
                       narration: `Loss on disposal — ${asset.asset_code}` });
      } else {
        const gainId = await getAccountByRole('GAIN_ON_DISPOSAL', client);
        if (!gainId) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Gain on disposal account role not found' });
        }
        jeLines.push({ accountId: gainId, debit: 0, credit: gainOrLoss,
                       narration: `Gain on disposal — ${asset.asset_code}` });
      }
    }

    const je = await journalEngine.createEntry({
      date:        disposal_date,
      description: `Disposal of ${asset.asset_name} (${asset.asset_code})`,
      sourceType:  'disposal',
      sourceId:    asset.id,
      lines:       jeLines,
      autoPost:    true,
      createdBy:   req.user.id,
      client,
    });

    await client.query(
      `UPDATE fixed_assets SET status='disposed', disposal_date=$1, disposal_value=$2,
       remarks=COALESCE($3, remarks), updated_at=NOW() WHERE id=$4`,
      [disposal_date, proceeds, remarks || null, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, je_number: je.je_number, gain_loss: gainOrLoss,
               nbv_at_disposal: nbv, proceeds });
    dispatchEvent('asset.deleted', { id: parseInt(req.params.id) }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PROJECTED SCHEDULE ────────────────────────────────────────────────────────
router.get('/:id/schedule', authenticate, async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const faR = await pool.query(
      `SELECT fa.*, fac.depreciation_rate_pct, fac.depreciation_method
       FROM fixed_assets fa
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE fa.id = $1`,
      [req.params.id]
    );
    if (!faR.rows.length) return res.status(404).json({ error: 'Not found' });
    const asset = faR.rows[0];
    const schedule = projectSchedule(
      asset,
      { depreciation_rate_pct: asset.depreciation_rate_pct, depreciation_method: asset.depreciation_method },
      Math.min(parseInt(months) || 12, 120)
    );
    res.json({ asset_code: asset.asset_code, asset_name: asset.asset_name,
               purchase_cost: parseFloat(asset.purchase_cost), schedule });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssets.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── WDV AS OF DATE ────────────────────────────────────────────────────────────
router.get('/:id/wdv', authenticate, async (req, res) => {
  try {
    const { asOfDate = new Date().toISOString().split('T')[0] } = req.query;
    const faR = await pool.query('SELECT * FROM fixed_assets WHERE id = $1', [req.params.id]);
    if (!faR.rows.length) return res.status(404).json({ error: 'Not found' });
    const asset = faR.rows[0];

    const futureR = await pool.query(
      `SELECT COALESCE(SUM(drl.depreciation_amount), 0) AS future_depr
       FROM depreciation_run_lines drl
       JOIN depreciation_runs dr ON drl.run_id = dr.id
       WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted' AND dr.period_to > $2`,
      [req.params.id, asOfDate]
    );
    const futureDepr = parseFloat(futureR.rows[0].future_depr);
    const currentWdv = parseFloat(asset.purchase_cost) - parseFloat(asset.accumulated_depreciation);
    const wdvAsOf    = Math.round((currentWdv + futureDepr) * 100) / 100;

    res.json({
      asset_code:  asset.asset_code,
      asset_name:  asset.asset_name,
      as_of_date:  asOfDate,
      purchase_cost: parseFloat(asset.purchase_cost),
      accumulated_depreciation_as_of: Math.round((parseFloat(asset.accumulated_depreciation) - futureDepr) * 100) / 100,
      wdv_as_of:   wdvAsOf,
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[fixedAssets.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const pool    = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');
const { calculateForAsset } = require('../services/depreciationEngine');

const router = express.Router();

// ── Shared: build preview lines ───────────────────────────────────────────────
async function buildPreviewLines(period_from, period_to) {
  const assetsR = await pool.query(
    `SELECT fa.*, fac.depreciation_rate_pct, fac.depreciation_method,
            fac.gl_depr_expense_account_id, fac.gl_accum_depr_account_id,
            fac.name as category_name
     FROM fixed_assets fa
     JOIN fixed_asset_categories fac ON fa.category_id = fac.id
     WHERE fa.status = 'active'
     ORDER BY fa.asset_code`
  );

  const lines = [];
  for (const asset of assetsR.rows) {
    const result = calculateForAsset(
      asset,
      { depreciation_rate_pct: asset.depreciation_rate_pct, depreciation_method: asset.depreciation_method },
      period_from, period_to
    );
    if (result.skip) continue;
    if (result.depreciation_amount <= 0) continue;

    lines.push({
      fixed_asset_id:            asset.id,
      asset_code:                asset.asset_code,
      asset_name:                asset.asset_name,
      category_id:               asset.category_id,
      category_name:             asset.category_name,
      gl_depr_expense_account_id: asset.gl_depr_expense_account_id,
      gl_accum_depr_account_id:  asset.gl_accum_depr_account_id,
      cost_center_id:            asset.cost_center_id || null,
      opening_wdv:               result.opening_wdv,
      depreciation_amount:       result.depreciation_amount,
      closing_wdv:               result.closing_wdv,
      days_in_period:            result.days_in_period,
    });
  }
  return lines;
}

// ── PREVIEW (no save) ─────────────────────────────────────────────────────────
router.post('/preview', authenticate, async (req, res) => {
  try {
    const { period_from, period_to } = req.body;
    if (!period_from || !period_to)
      return res.status(400).json({ error: 'period_from and period_to required' });
    if (period_to < period_from)
      return res.status(400).json({ error: 'period_to must be >= period_from' });

    const lines = await buildPreviewLines(period_from, period_to);
    const total = lines.reduce((s, l) => s + l.depreciation_amount, 0);
    res.json({ period_from, period_to, lines, total: Math.round(total * 100) / 100 });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[depreciationRuns.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── CREATE RUN ────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { period_from, period_to, remarks } = req.body;
    if (!period_from || !period_to)
      return res.status(400).json({ error: 'period_from and period_to required' });

    // Build preview lines BEFORE acquiring the transaction (avoids holding TX open during slow calc)
    const lines = await buildPreviewLines(period_from, period_to);
    if (!lines.length)
      return res.status(400).json({ error: 'No assets with depreciable amount for this period' });

    await client.query('BEGIN');

    // Generate run number
    const seqR      = await client.query("SELECT nextval('dr_seq') as num");
    const year      = new Date().getFullYear();
    const runNumber = `DR-${year}-${String(seqR.rows[0].num).padStart(4, '0')}`;
    const totalAmt  = Math.round(lines.reduce((s, l) => s + l.depreciation_amount, 0) * 100) / 100;

    // Insert run header
    const runR = await client.query(
      `INSERT INTO depreciation_runs (run_number,period_from,period_to,total_amount,status,remarks,created_by)
       VALUES ($1,$2,$3,$4,'posted',$5,$6) RETURNING *`,
      [runNumber, period_from, period_to, totalAmt, remarks || null, req.user.id]
    );
    const run = runR.rows[0];

    // ── Batch insert all run lines in a single round-trip ─────────────────
    await client.query(
      `INSERT INTO depreciation_run_lines
         (run_id, fixed_asset_id, opening_wdv, depreciation_amount, closing_wdv, days_in_period)
       SELECT $1,
              UNNEST($2::int[]),
              UNNEST($3::numeric[]),
              UNNEST($4::numeric[]),
              UNNEST($5::numeric[]),
              UNNEST($6::int[])`,
      [
        run.id,
        lines.map(l => l.fixed_asset_id),
        lines.map(l => l.opening_wdv),
        lines.map(l => l.depreciation_amount),
        lines.map(l => l.closing_wdv),
        lines.map(l => l.days_in_period),
      ]
    );

    // ── Batch update accumulated_depreciation in a single round-trip ──────
    await client.query(
      `UPDATE fixed_assets
       SET    accumulated_depreciation = fixed_assets.accumulated_depreciation + v.delta,
              updated_at = NOW()
       FROM   (SELECT UNNEST($1::int[]) AS id, UNNEST($2::numeric[]) AS delta) v
       WHERE  fixed_assets.id = v.id`,
      [
        lines.map(l => l.fixed_asset_id),
        lines.map(l => l.depreciation_amount),
      ]
    );

    // ── Build JE lines grouped by (expense_account, accum_account) ────────
    // Group by (expense_account, accum_account, cost_centre) so each cost centre
    // posts its own balanced line pair. Totals are identical to the ungrouped sum —
    // this only splits the same debit/credit more granularly by cost centre.
    const groupMap = {};
    for (const l of lines) {
      const cc  = l.cost_center_id || null;
      const key = `${l.gl_depr_expense_account_id}_${l.gl_accum_depr_account_id}_${cc ?? 'none'}`;
      if (!groupMap[key]) groupMap[key] = {
        expAccId:     l.gl_depr_expense_account_id,
        accumAccId:   l.gl_accum_depr_account_id,
        costCenterId: cc,
        total:        0,
      };
      groupMap[key].total = Math.round((groupMap[key].total + l.depreciation_amount) * 100) / 100;
    }

    const jeLines = [];
    for (const g of Object.values(groupMap)) {
      jeLines.push({ accountId: g.expAccId,   debit: g.total, credit: 0,
                     narration: `Depreciation ${period_from} to ${period_to}`,
                     costCenterId: g.costCenterId });
      jeLines.push({ accountId: g.accumAccId, debit: 0, credit: g.total,
                     narration: `Accumulated depreciation ${period_from} to ${period_to}`,
                     costCenterId: g.costCenterId });
    }

    // ── Create JE inside the SAME transaction so everything is atomic ─────
    const je = await journalEngine.createEntry({
      date:        period_to,
      description: `Depreciation Run ${runNumber} (${period_from} – ${period_to})`,
      sourceType:  'depreciation',
      sourceId:    run.id,
      lines:       jeLines,
      autoPost:    true,
      createdBy:   req.user.id,
      client,                    // pass existing client → no second transaction opened
    });

    // Link JE back to the run (still in the same transaction)
    await client.query(
      'UPDATE depreciation_runs SET je_id=$1 WHERE id=$2',
      [je.id, run.id]
    );

    await client.query('COMMIT');
    dispatchEvent('depreciation.created', { id: run.id, run_number: runNumber, period_from, period_to, total_amount: totalAmt, module: 'fixed_assets' });

    res.status(201).json({
      ...run, je_id: je.id, je_number: je.je_number,
      lines_count: lines.length, total_amount: totalAmt,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    const offset = (page - 1) * pageSize;
    // Single query — JOIN aggregate instead of correlated subquery (much faster)
    const result = await pool.query(
      `SELECT dr.*, je.je_number,
         COALESCE(lc.cnt, 0)::int AS lines_count
       FROM depreciation_runs dr
       LEFT JOIN journal_entries je ON dr.je_id = je.id
       LEFT JOIN (
         SELECT run_id, COUNT(*) AS cnt
         FROM depreciation_run_lines
         GROUP BY run_id
       ) lc ON lc.run_id = dr.id
       ORDER BY dr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    const countR = await pool.query('SELECT COUNT(*) FROM depreciation_runs');
    const totalCount = parseInt(countR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);
    res.json({ data: result.rows, totalCount, page, pageSize, totalPages });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[depreciationRuns.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── DETAIL ────────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const runR = await pool.query(
      `SELECT dr.*, je.je_number FROM depreciation_runs dr
       LEFT JOIN journal_entries je ON dr.je_id = je.id
       WHERE dr.id = $1`,
      [req.params.id]
    );
    if (!runR.rows.length) return res.status(404).json({ error: 'Not found' });

    const linesR = await pool.query(
      `SELECT drl.*, fa.asset_code, fa.asset_name, fac.name as category_name
       FROM depreciation_run_lines drl
       JOIN fixed_assets fa ON drl.fixed_asset_id = fa.id
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE drl.run_id = $1
       ORDER BY fa.asset_code`,
      [req.params.id]
    );

    res.json({ ...runR.rows[0], lines: linesR.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[depreciationRuns.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── CANCEL RUN ────────────────────────────────────────────────────────────────
router.post('/:id/cancel', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    // BEGIN first — all validation runs inside the transaction to eliminate
    // the race window where a concurrent run could be posted between check and lock.
    await client.query('BEGIN');

    // Lock the run row so concurrent cancels are serialised
    const runR = await client.query(
      'SELECT * FROM depreciation_runs WHERE id=$1 FOR UPDATE',
      [req.params.id]
    );
    if (!runR.rows.length) return res.status(404).json({ error: 'Not found' });
    const run = runR.rows[0];
    if (run.status !== 'posted') return res.status(400).json({ error: 'Only posted runs can be cancelled' });

    // Check no later posted runs exist for the same assets (inside the transaction)
    const laterR = await client.query(
      `SELECT DISTINCT dr.id FROM depreciation_runs dr
       JOIN depreciation_run_lines drl ON drl.run_id = dr.id
       WHERE dr.status = 'posted' AND dr.period_from > $1
         AND drl.fixed_asset_id IN
             (SELECT fixed_asset_id FROM depreciation_run_lines WHERE run_id = $2)`,
      [run.period_to, req.params.id]
    );
    if (laterR.rows.length > 0)
      return res.status(400).json({ error: 'Cannot cancel: later posted depreciation runs depend on this run' });

    // Get run lines for reversal (inside the transaction)
    const linesR = await client.query(
      `SELECT drl.*, fa.category_id, fa.cost_center_id,
              fac.gl_depr_expense_account_id, fac.gl_accum_depr_account_id
       FROM depreciation_run_lines drl
       JOIN fixed_assets fa ON drl.fixed_asset_id = fa.id
       JOIN fixed_asset_categories fac ON fa.category_id = fac.id
       WHERE drl.run_id = $1`,
      [req.params.id]
    );

    // Batch-reverse accumulated_depreciation in a single round-trip
    await client.query(
      `UPDATE fixed_assets
       SET    accumulated_depreciation = fixed_assets.accumulated_depreciation - v.delta,
              updated_at = NOW()
       FROM   (SELECT UNNEST($1::int[]) AS id, UNNEST($2::numeric[]) AS delta) v
       WHERE  fixed_assets.id = v.id`,
      [
        linesR.rows.map(l => l.fixed_asset_id),
        linesR.rows.map(l => parseFloat(l.depreciation_amount)),
      ]
    );

    // Mark run cancelled
    await client.query(
      "UPDATE depreciation_runs SET status='cancelled' WHERE id=$1", [req.params.id]
    );

    // Build reversal JE (Cr expense, Dr accum)
    // Mirror the original grouping (incl. cost centre) so the reversal nets each
    // cost centre back to zero. Totals identical to the original run.
    const groupMap = {};
    for (const l of linesR.rows) {
      const cc  = l.cost_center_id || null;
      const key = `${l.gl_depr_expense_account_id}_${l.gl_accum_depr_account_id}_${cc ?? 'none'}`;
      if (!groupMap[key]) groupMap[key] = {
        expAccId: l.gl_depr_expense_account_id, accumAccId: l.gl_accum_depr_account_id,
        costCenterId: cc, total: 0,
      };
      groupMap[key].total = Math.round((groupMap[key].total + parseFloat(l.depreciation_amount)) * 100) / 100;
    }

    const jeLines = [];
    for (const g of Object.values(groupMap)) {
      jeLines.push({ accountId: g.accumAccId, debit: g.total, credit: 0,
                     narration: `Reversal of depreciation run ${run.run_number}`,
                     costCenterId: g.costCenterId });
      jeLines.push({ accountId: g.expAccId,   debit: 0, credit: g.total,
                     narration: `Reversal of depreciation run ${run.run_number}`,
                     costCenterId: g.costCenterId });
    }

    // Create reversal JE inside the same transaction → fully atomic
    const je = await journalEngine.createEntry({
      date:        new Date().toISOString().split('T')[0],
      description: `Cancellation of Depreciation Run ${run.run_number}`,
      sourceType:  'depreciation_reversal',
      sourceId:    run.id,
      lines:       jeLines,
      autoPost:    true,
      createdBy:   req.user.id,
      client,                    // share transaction — commit handled below
    });

    await client.query('COMMIT');
    dispatchEvent('depreciation.cancelled', { id: run.id, run_number: run.run_number, module: 'fixed_assets' });

    res.json({ success: true, reversal_je_number: je.je_number });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

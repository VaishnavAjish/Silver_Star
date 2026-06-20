const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { nextLotOpId } = require('../services/seedLotCodeService');
const { findActiveBiscuitByProcess, applyMeasurements } = require('../services/growthRunService');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

const { getAccountByRole } = require('../services/accountResolver');

// GET /api/rough-growth
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rg.*, m.name as machine_name, inv.lot_number as seed_lot,
              inv.lot_name as seed_name
       FROM rough_growth rg
       LEFT JOIN machines m ON rg.machine_id = m.id
       LEFT JOIN inventory inv ON rg.seed_inventory_id = inv.id
       ORDER BY rg.growth_date DESC, rg.id DESC`
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[roughGrowth.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/rough-growth/:id (with lines)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const rg = await pool.query(
      `SELECT rg.*, m.name as machine_name, inv.lot_number as seed_lot,
              d.name as department_name
       FROM rough_growth rg
       LEFT JOIN machines m ON rg.machine_id = m.id
       LEFT JOIN inventory inv ON rg.seed_inventory_id = inv.id
       LEFT JOIN departments d ON rg.department_id = d.id
       WHERE rg.id = $1`,
      [req.params.id]
    );
    if (rg.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const lines = await pool.query('SELECT * FROM rough_growth_lines WHERE growth_id = $1 ORDER BY line_no', [req.params.id]);
    res.json({ ...rg.rows[0], lines: lines.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[roughGrowth.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/rough-growth/process-context/:processId
// Thin wrapper — delegates to the manufacturing processes route's output-context logic.
// Returns everything the GrowthOutputPage needs to pre-populate.
router.get('/process-context/:processId', authenticate, async (req, res) => {
  try {
    const RUNTIME_SQL = `
      CASE
        WHEN mp.status = 'running' THEN
          ROUND(GREATEST(0,
            EXTRACT(EPOCH FROM (NOW() - mp.started_at))/3600
            - mp.total_paused_minutes/60.0
          )::numeric, 2)
        ELSE
          ROUND(GREATEST(0,
            EXTRACT(EPOCH FROM (COALESCE(mp.completed_at, NOW()) - mp.started_at))/3600
            - mp.total_paused_minutes/60.0
          )::numeric, 2)
      END`;

    const { rows: mpRows } = await pool.query(`
      SELECT mp.*, ${RUNTIME_SQL} AS runtime_hours,
             m.code AS machine_code, m.name AS machine_name, m.status::text AS machine_status,
             d.name AS department_name,
             u.full_name AS operator_name,
             pm.process_name, pm.completion_mode, pm.output_type
      FROM machine_processes mp
      JOIN machines m ON m.id = mp.machine_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users u ON u.id = mp.operator_id
      LEFT JOIN process_master pm ON pm.process_code = mp.process_type
      WHERE mp.id = $1
    `, [req.params.processId]);

    if (!mpRows.length) return res.status(404).json({ error: 'Process not found' });
    const mp = mpRows[0];

    // Phase 33: load the linked Growth Run (biscuit) so the Rough Output screen
    // can display + pre-fill its current measurements (seed snapshot + dimensions).
    const growthRun = await findActiveBiscuitByProcess(pool, parseInt(req.params.processId));

    const { rows: issues } = await pool.query(`
      SELECT pi.*,
             sl.lot_number AS source_lot_number, sl.lot_code AS source_lot_code,
             pl.lot_number AS process_lot_number, pl.lot_code AS process_lot_code,
             pl.qty AS process_lot_qty, pl.status AS process_lot_status,
             pl.root_lot_id AS process_root_lot_id,
             i.name AS item_name, i.category,
             COALESCE(pi.remaining_in_process, pi.issued_qty) AS remaining_qty,
             ROUND(pi.issued_qty - COALESCE(pi.remaining_in_process, pi.issued_qty), 4) AS returned_qty
      FROM lot_process_issues pi
      JOIN inventory sl ON sl.id = pi.source_lot_id
      JOIN items i ON i.id = sl.item_id
      LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
      WHERE pi.machine_process_id = $1
      ORDER BY pi.id
    `, [req.params.processId]);

    const issueIds = issues.map(i => i.id);
    let returns = [];
    if (issueIds.length) {
      const { rows } = await pool.query(`
        SELECT r.*,
               COALESCE(json_agg(
                 json_build_object(
                   'return_type', l.return_type, 'qty', l.qty,
                   'lot_code', l.lot_code, 'lot_id', l.lot_id
                 ) ORDER BY l.id
               ) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
        FROM lot_process_returns r
        LEFT JOIN process_return_lines l ON l.return_id = r.id
        WHERE r.issue_id = ANY($1::int[])
        GROUP BY r.id
        ORDER BY r.created_at
      `, [issueIds]);
      returns = rows;
    }

    const totalIssued    = issues.reduce((s, i) => s + parseFloat(i.issued_qty    || 0), 0);
    const totalReturned  = issues.reduce((s, i) => s + parseFloat(i.returned_qty  || 0), 0);
    const totalRemaining = issues.reduce((s, i) => s + parseFloat(i.remaining_qty || 0), 0);

    const returnTotals = { usable: 0, damaged: 0, consumed: 0, reprocess: 0, qc_hold: 0 };
    for (const r of returns) {
      for (const l of r.lines || []) {
        if (returnTotals[l.return_type] !== undefined)
          returnTotals[l.return_type] += parseFloat(l.qty || 0);
      }
    }

    res.json({
      process:       mp,
      growth_run:    growthRun,
      issues,
      returns,
      return_totals: returnTotals,
      summary: {
        total_issued:    totalIssued,
        total_returned:  totalReturned,
        total_remaining: totalRemaining,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rough-growth/seed-history/:seedInventoryId
router.get('/seed-history/:seedId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rg.growth_number, rg.growth_date, rg.cycle_no, rg.total_lots, rg.total_weight,
              rg.cost_per_carat, rg.status, m.name as machine_name
       FROM rough_growth rg
       LEFT JOIN machines m ON rg.machine_id = m.id
       WHERE rg.seed_inventory_id = $1
       ORDER BY rg.cycle_no`,
      [req.params.seedId]
    );
    res.json(result.rows);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[roughGrowth.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// PUT /api/rough-growth/:id (update header fields — date, cycle, dept, remark, costs)
router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { growth_date, cycle_no, department_id, remark,
            cost_seed, cost_gas, cost_power, cost_labour, cost_consumable, cost_maintenance,
            lines: lineUpdates } = req.body;

    const existing = await pool.query('SELECT * FROM rough_growth WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });

    const totalCost = [cost_seed, cost_gas, cost_power, cost_labour, cost_consumable, cost_maintenance]
      .reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const totalWeight = parseFloat(existing.rows[0].total_weight) || 0;
    const costPerCarat = totalWeight > 0 ? Math.round(totalCost / totalWeight) : 0;

    const result = await pool.query(
      `UPDATE rough_growth SET
        growth_date=$1, cycle_no=$2, department_id=$3, remark=$4,
        cost_seed=$5, cost_gas=$6, cost_power=$7, cost_labour=$8,
        cost_consumable=$9, cost_maintenance=$10, total_cost=$11, cost_per_carat=$12
       WHERE id=$13 RETURNING *`,
      [growth_date, cycle_no || 1, department_id || null, remark,
       parseFloat(cost_seed) || 0, parseFloat(cost_gas) || 0, parseFloat(cost_power) || 0,
       parseFloat(cost_labour) || 0, parseFloat(cost_consumable) || 0, parseFloat(cost_maintenance) || 0,
       totalCost, costPerCarat, req.params.id]
    );

    if (Array.isArray(lineUpdates)) {
      let newTotalWeight = 0;
      for (const line of lineUpdates) {
        if (line.line_no) {
          const w = parseFloat(line.weight) || 0;
          newTotalWeight += w;
          const updated = await pool.query(
            `UPDATE rough_growth_lines SET weight=$1, size_ref=$2, shape=$3, color_est=$4, clarity_est=$5, remark=$6
             WHERE growth_id=$7 AND line_no=$8 RETURNING inventory_id`,
            [w, line.size_ref, line.shape || 'Rough', line.color_est || 'D-E',
             line.clarity_est || 'VS Est.', line.remark || '', req.params.id, line.line_no]
          );
          const invId = updated.rows[0]?.inventory_id;
          if (invId && w > 0) {
            await pool.query('UPDATE inventory SET weight=$1 WHERE id=$2', [w, invId]);
          }
        }
      }
      if (newTotalWeight > 0) {
        const newCostPerCarat = Math.round(totalCost / newTotalWeight);
        await pool.query(
          'UPDATE rough_growth SET total_weight=$1, cost_per_carat=$2 WHERE id=$3',
          [newTotalWeight, newCostPerCarat, req.params.id]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/rough-growth (Create rough lots + inventory + JE)
router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { growth_date, cycle_no, department_id, remark,
            cost_seed, cost_gas, cost_power, cost_labour, cost_consumable, cost_maintenance,
            lines,
            growth_run_id,       // Phase 34 (FIX 4): operator selects an IN STOCK Growth Run directly
            machine_process_id,  // Phase 31.5: link to machine process for OUTPUT_BASED completion (back-compat)
            // Phase 33 (Decision 1): final Growth Run measurements captured at output time
            gr_weight, gr_length, gr_width, gr_height, gr_dim_unit,
          } = req.body;

    if (!lines || lines.length === 0) throw new Error('At least one rough diamond lot required');

    // ────────────────────────────────────────────────────────────────────────
    // Phase 34 (FIX 4): GROWTH RUN IS THE ENTRY POINT.
    // Rough lots are created from an IN STOCK Growth Run (biscuit) selected
    // DIRECTLY by the operator. Laser ops (Edge/Outer/Block/Seed/Growth Cut) run
    // AFTER growth completion, so we no longer gate on machine.status =
    // 'awaiting_output'. We accept either an explicit growth_run_id (preferred)
    // or a machine_process_id (back-compat), resolve the single biscuit, and
    // require it to be IN STOCK.
    // ────────────────────────────────────────────────────────────────────────
    let biscuit = null;
    let resolvedProcessId = machine_process_id ? parseInt(machine_process_id) : null;

    if (growth_run_id) {
      const { rows: bRows } = await client.query(
        `SELECT inv.*, i.category
           FROM inventory inv
           JOIN items i ON i.id = inv.item_id
          WHERE inv.id = $1 FOR UPDATE OF inv`,
        [parseInt(growth_run_id)]
      );
      if (!bRows.length) throw new Error('Growth Run not found');
      biscuit = bRows[0];
      if (biscuit.category !== 'growth_run')
        throw new Error('Selected lot is not a Growth Run');
      resolvedProcessId = biscuit.machine_process_id || resolvedProcessId;
    } else if (resolvedProcessId) {
      biscuit = await findActiveBiscuitByProcess(client, resolvedProcessId);
    } else {
      throw new Error('Rough Output requires a Growth Run. Select an IN STOCK Growth Run to post output.');
    }

    if (!biscuit) {
      throw new Error('No Growth Run found. A Growth Run must exist (IN STOCK) before rough output can be posted.');
    }
    if (biscuit.status === 'CONSUMED') {
      throw new Error(`Growth Run ${biscuit.lot_number} has already been consumed; rough output was already posted.`);
    }
    if (biscuit.status !== 'IN STOCK') {
      throw new Error(`Growth Run ${biscuit.lot_number} is not available for output (status: ${biscuit.status}). It must be IN STOCK.`);
    }

    // Load + lock the linked machine process (if any) for completion bookkeeping.
    let linkedProcess = null;
    if (resolvedProcessId) {
      const { rows: mpRows } = await client.query(
        `SELECT mp.*, m.status::text AS machine_status
           FROM machine_processes mp
           JOIN machines m ON m.id = mp.machine_id
          WHERE mp.id = $1 FOR UPDATE OF mp`,
        [resolvedProcessId]
      );
      if (mpRows.length) linkedProcess = mpRows[0];
    }

    // Load all issues for this process (for seed context).
    const { rows: linkedIssues } = resolvedProcessId
      ? await client.query(
          `SELECT pi.*, pl.root_lot_id AS process_root_lot_id, pl.genealogy_path AS process_genealogy_path
             FROM lot_process_issues pi
             LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
            WHERE pi.machine_process_id = $1
            ORDER BY pi.id`,
          [resolvedProcessId]
        )
      : { rows: [] };

    // Resolve the seed record (first issue's source lot) for display/JE narration.
    let seedRow = null;
    if (linkedIssues.length) {
      const srcR = await client.query('SELECT * FROM inventory WHERE id = $1', [linkedIssues[0].source_lot_id]);
      seedRow = srcR.rows[0];
    }

    const effectiveMachineId = linkedProcess ? linkedProcess.machine_id : null;

    // Generate growth number
    const seqR = await client.query("SELECT nextval('gr_seq') as num");
    const growthNumber = `GR-${String(seqR.rows[0].num).padStart(4, '0')}`;

    // Calculate totals
    let totalLots = lines.length;
    let totalWeight = 0;
    for (const line of lines) {
      totalWeight += parseFloat(line.weight) || 0;
    }

    const cSeed = parseFloat(cost_seed) || 0;
    const cGas = parseFloat(cost_gas) || 0;
    const cPower = parseFloat(cost_power) || 0;
    const cLabour = parseFloat(cost_labour) || 0;
    const cCons = parseFloat(cost_consumable) || 0;
    const cMaint = parseFloat(cost_maintenance) || 0;
    const totalCost = cSeed + cGas + cPower + cLabour + cCons + cMaint;
    const costPerCarat = totalWeight > 0 ? Math.round((totalCost / totalWeight) * 100) / 100 : 0;

    // Insert rough growth header
    const effectiveSeedId = seedRow?.id || null;
    const rgR = await client.query(
      `INSERT INTO rough_growth (growth_number, growth_date, cycle_no, machine_id, seed_inventory_id,
        department_id, remark, total_lots, total_weight,
        cost_seed, cost_gas, cost_power, cost_labour, cost_consumable, cost_maintenance,
        total_cost, cost_per_carat, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'COMPLETED',$18)
       RETURNING *`,
      [growthNumber, growth_date, cycle_no || 1, effectiveMachineId, effectiveSeedId,
       department_id || null, remark, totalLots, totalWeight,
       cSeed, cGas, cPower, cLabour, cCons, cMaint, totalCost, costPerCarat, req.user.id]
    );
    const rg = rgR.rows[0];

    // Get the rough diamond item for inventory
    let roughItemR = await client.query("SELECT id FROM items WHERE category = 'rough' AND status = 'active' LIMIT 1");
    if (roughItemR.rows.length === 0) {
      // Auto-create a generic rough diamond item so the process isn't blocked
      roughItemR = await client.query(`
        INSERT INTO items (code, name, category, type, status, default_uom) 
        VALUES ('ROUGH-001', 'Rough Diamond', 'rough', 'raw_material', 'active', 'CT') 
        RETURNING id
      `);
    }
    const roughItemId = roughItemR.rows[0].id;
    const insertedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const seqRD = await client.query("SELECT nextval('rd_seq') as num");
      const lotNumber = `RD-${seqRD.rows[0].num}`;
      const lotCost = totalWeight > 0 ? Math.round((parseFloat(line.weight) / totalWeight) * totalCost * 100) / 100 : 0;

      // Phase 33: rough lots ALWAYS descend from the Growth Run (biscuit).
      // The biscuit is guaranteed to exist (enforced above) so genealogy is
      // never null — seed → growth_run → rough is preserved on every lot.
      const genParentLotId = biscuit.id;
      const genRootLotId   = biscuit.root_lot_id || biscuit.id;
      const genPath        = `${biscuit.genealogy_path || biscuit.lot_number}/${lotNumber}`;

      // Create rough diamond inventory record
      const roughLotOpId = await nextLotOpId(client);
      const seedLotNum   = seedRow?.lot_number || '';
      const invR = await client.query(
        `INSERT INTO inventory (item_id, lot_number, lot_name, qty, unit, weight, rate, total_value,
          location_id, department_id, purchase_date, status, remarks, lot_op_id,
          parent_lot_id, root_lot_id, genealogy_path, source_type, operation_type, source_module)
         VALUES ($1,$2,$3,1,'CT',$4,$5,$6,$7,$8,$9,'IN STOCK',$10,$11,$12,$13,$14,'growth','growth_output','Rough Growth')
         RETURNING id`,
        [roughItemId, lotNumber, `Rough-CVD-${lotNumber.replace('RD-','')}`,
         line.weight, costPerCarat, lotCost,
         department_id || null, department_id || null, growth_date,
         `From ${growthNumber}, seed ${seedLotNum}, ${line.shape || 'Rough'}`,
         roughLotOpId,
         genParentLotId, genRootLotId, genPath]
      );

      const lineR = await client.query(
        `INSERT INTO rough_growth_lines (growth_id, line_no, lot_number, weight, size_ref, shape, color_est, clarity_est, remark, inventory_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [rg.id, i + 1, lotNumber, line.weight, line.size_ref, line.shape || 'Rough',
         line.color_est || 'D-E', line.clarity_est || 'VS Est.', line.remark, invR.rows[0].id]
      );
      insertedLines.push(lineR.rows[0]);
    }

    // Update seed last_used
    if (effectiveSeedId) {
      await client.query('UPDATE inventory SET last_used = $1 WHERE id = $2', [growth_date, effectiveSeedId]);
    }

    // Create JE: Dr Rough Diamond Inventory (2004), Cr Work-in-Progress (2005)
    const roughAccId = await getAccountByRole('INVENTORY_ROUGH', client);
    const wipAccId   = await getAccountByRole('INVENTORY_GROWTH_RUN', client);

    if (roughAccId && wipAccId && totalCost > 0) {
      const je = await journalEngine.createEntry({
        date: growth_date,
        description: `Rough Growth ${growthNumber} - ${totalLots} lots, ${totalWeight.toFixed(2)} ct`,
        sourceType: 'growth',
        sourceId: rg.id,
        lines: [
          { accountId: roughAccId, debit: totalCost, credit: 0, narration: `${totalLots} rough diamonds from seed ${seedRow?.lot_number || ''}` },
          { accountId: wipAccId, debit: 0, credit: totalCost, narration: `WIP consumed for growth ${growthNumber}` },
        ],
        autoPost: true,
        createdBy: req.user.id,
      });
      await client.query('UPDATE rough_growth SET je_id = $1 WHERE id = $2', [je.id, rg.id]);
    }

    // Phase 33 (Decision 1): apply the operator's FINAL Growth Run measurements
    // (taken immediately before rough creation) onto the biscuit BEFORE consuming.
    // Generated columns (actual_growth_mm, weight_gain, growth_pct) recompute,
    // preserving accurate end-to-end growth analytics on the consumed biscuit.
    const measurement = {};
    if (gr_weight   !== undefined && gr_weight   !== '' && gr_weight   !== null) measurement.weight     = parseFloat(gr_weight);
    if (gr_height   !== undefined && gr_height   !== '' && gr_height   !== null) measurement.dim_height = parseFloat(gr_height);
    if (gr_length   !== undefined && gr_length   !== '' && gr_length   !== null) measurement.dim_length = parseFloat(gr_length);
    if (gr_width    !== undefined && gr_width    !== '' && gr_width    !== null) measurement.dim_depth  = parseFloat(gr_width);
    if (gr_dim_unit !== undefined && gr_dim_unit !== '' && gr_dim_unit !== null) measurement.dim_unit   = gr_dim_unit;
    if (Object.keys(measurement).length) {
      await applyMeasurements(client, biscuit.id, measurement);
    }

    // Phase 32: consume the Growth Run (biscuit) — it has been split into rough lots.
    {
      await client.query(
        `UPDATE inventory
            SET status = 'CONSUMED', qty = 0, updated_at = NOW(),
                remarks = COALESCE(remarks, '') ||
                  ' | Consumed by ' || $2 || ' (' || $3 || ' rough lots, ' || $4 || ' ct)'
          WHERE id = $1`,
        [biscuit.id, growthNumber, totalLots, totalWeight.toFixed(4)]
      );
    }

    // Phase 31.5: complete the machine_process and set machine idle
    if (linkedProcess) {
      const actualYieldPct = linkedProcess.expected_rough_qty && parseFloat(linkedProcess.expected_rough_qty) > 0
        ? Math.round((totalWeight / parseFloat(linkedProcess.expected_rough_qty)) * 10000) / 100
        : null;

      await client.query(
        `UPDATE machine_processes
           SET status='completed', completed_at=NOW(),
               output_entry_id=$1, output_completed_at=NOW(),
               actual_output_qty=$2, actual_yield_pct=$3
         WHERE id=$4`,
        [rg.id, totalWeight, actualYieldPct, linkedProcess.id]
      );
      await client.query(
        `UPDATE machines SET status='idle' WHERE id=$1`,
        [linkedProcess.machine_id]
      );
      await client.query(
        `INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
         VALUES ($1,$2,'idle',$3,$4)`,
        [linkedProcess.machine_id, linkedProcess.machine_status || 'running', req.user.id,
         `Growth output posted (${growthNumber}) — process ${linkedProcess.process_number} completed`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...rg, growth_number: growthNumber, lines: insertedLines });
    dispatchEvent('rough.created', { id: rg.id, growth_number: growthNumber, total_lots: totalLots, total_weight: totalWeight }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    require('fs').writeFileSync('rough_growth_error.log', err.stack);
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;

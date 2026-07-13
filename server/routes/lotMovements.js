const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { isSeedItem, nextMixLotCode, childSplitCode, nextSiblingCode, nextLotOpId } = require('../services/seedLotCodeService');
const { resolveMixDimensions, mixDimensionError } = require('../services/lotDimensions');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert index 0→A, 1→B, …, 25→Z, 26→AA, 27→AB … */
function getSuffix(idx) {
  let s = '', n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Rough-diamond lots use weight (ct) as their effective quantity; others use qty. */
function usesWeight(lot) {
  return lot.unit === 'CT';
}

function effQty(lot) {
  return usesWeight(lot) ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
}

/** Generate next LM-YYYYMM-NNNN movement number. */
async function genMovNum(client) {
  const { rows } = await client.query("SELECT nextval('lm_seq') as n");
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `LM-${ym}-${String(rows[0].n).padStart(4, '0')}`;
}

/** Return a lot_number that does not yet exist in inventory. */
async function uniqueLotCode(client, base) {
  let code = base, attempt = 0;
  for (;;) {
    const { rows } = await client.query(
      'SELECT 1 FROM inventory WHERE lot_number = $1', [code]
    );
    if (!rows.length) return code;
    attempt++;
    code = `${base}-${attempt}`;
  }
}

const CONSUMED = ['CONSUMED', 'SOLD', 'DISPOSED', 'DAMAGED', 'ARCHIVED', 'IN PROCESS'];

// ── SPLIT PREVIEW ─────────────────────────────────────────────────────────────

router.post('/split/preview', authenticate, async (req, res) => {
  try {
    const { parent_lot_id, children } = req.body;
    if (!parent_lot_id || !Array.isArray(children) || children.length < 1)
      return res.status(400).json({ error: 'parent_lot_id and children[] required' });

    const { rows } = await pool.query(
      `SELECT inv.*, i.category, i.name as item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1`,
      [parent_lot_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lot not found' });
    const parent = rows[0];

    if (CONSUMED.includes(parent.status))
      return res.status(409).json({ error: `Lot is already ${parent.status}` });

    const pqty = effQty(parent);
    if (pqty <= 0)
      return res.status(409).json({ error: 'Parent lot has zero quantity' });

    const isSeed   = isSeedItem(parent);
    const childSum = children.reduce((s, c) => s + (parseFloat(c.quantity) || 0), 0);

    let valid, diff, message;
    if (isSeed) {
      const remaining = pqty - childSum;
      valid   = childSum > 0 && childSum <= pqty + 0.0001;
      diff    = remaining;
      message = valid
        ? `Will extract ${childSum.toFixed(4)} — ${Math.max(0, remaining).toFixed(4)} ${parent.unit} remains with parent`
        : (childSum <= 0 ? 'Extract qty must be positive' : `Extract qty exceeds available by ${(childSum - pqty).toFixed(4)} ${parent.unit}`);
    } else {
      diff    = Math.abs(childSum - pqty);
      valid   = diff <= 0.0001;
      message = valid
        ? 'Totals match — ready to split'
        : `Quantity mismatch by ${diff.toFixed(4)} ${parent.unit}`;
    }

    const parentWeight = parseFloat(parent.weight || 0);
    const rough = usesWeight(parent);

    const parentCode  = (isSeed && parent.lot_code) ? parent.lot_code : parent.lot_number;
    const parentLevel = isSeed ? (parseInt(parent.split_level) || 0) : null;

    // For seeds: count existing direct children so the preview codes continue correctly.
    // Uses the stateless childSplitCode (no DB write) — safe for preview.
    let existingSeedChildCount = 0;
    if (isSeed) {
      const { rows: ec } = await pool.query(
        'SELECT COUNT(*) AS cnt FROM inventory WHERE parent_lot_id = $1',
        [parent.id]
      );
      existingSeedChildCount = parseInt(ec[0].cnt) || 0;
    }

    const preview = children.map((c, i) => {
      const cqty = parseFloat(c.quantity) || 0;
      // Weight: use explicit if provided, else proportional from parent
      let cWeight = null;
      if (!rough && parentWeight > 0) {
        cWeight = c.weight != null && c.weight !== ''
          ? parseFloat(c.weight)
          : Math.round((cqty / (pqty || 1)) * parentWeight * 10000) / 10000;
      }
      // Seed: sequential from where existing children left off; non-seed: letter suffix
      const lotCodePreview = isSeed
        ? childSplitCode(parentCode, parentLevel, existingSeedChildCount + i)
        : `${parent.lot_number}-${getSuffix(i)}`;
      return {
        index: i,
        lot_code_preview: lotCodePreview,
        quantity: cqty,
        weight: cWeight,
        cost_per_unit: parseFloat(parent.rate),
        total_value: Math.round(cqty * parseFloat(parent.rate) * 100) / 100,
        remark: c.remark || null,
      };
    });

    res.json({
      parent: {
        id: parent.id, lot_number: parent.lot_number, item_name: parent.item_name,
        effective_qty: pqty, rate: parseFloat(parent.rate), unit: parent.unit,
        weight: parentWeight, total_value: parseFloat(parent.total_value),
      },
      children_preview: preview,
      total_child_qty: childSum,
      parent_qty: pqty,
      remaining_parent_qty: isSeed ? Math.max(0, pqty - childSum) : 0,
      difference: diff,
      valid,
      message,
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotMovements.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── SPLIT EXECUTE ─────────────────────────────────────────────────────────────

router.post('/split', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const { parent_lot_id, children, notes } = req.body;

  if (!parent_lot_id || !Array.isArray(children) || children.length < 1)
    return res.status(400).json({ error: 'parent_lot_id and children[] required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Lock parent row
    const { rows: pr } = await client.query(
      `SELECT inv.*, i.category, i.name as item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1 FOR UPDATE`,
      [parent_lot_id]
    );
    if (!pr.length) throw new Error('Lot not found');
    const parent = pr[0];

    // Action Matrix enforcement: a Growth Run (biscuit) is a single CVD crystal
    // slab and is never splittable. Cutting it is Growth Output, not Split.
    if (parent.category === 'growth_run')
      throw new Error(`Lot ${parent.lot_number} is a Growth Run and cannot be split. Use Growth Output to extract rough.`);

    if (CONSUMED.includes(parent.status))
      throw new Error(`Lot ${parent.lot_number} is already ${parent.status}`);

    const pqty = effQty(parent);
    if (pqty <= 0) throw new Error('Parent lot has zero quantity — cannot split');

    const isSeedLot = isSeedItem(parent);
    const childSum  = children.reduce((s, c) => s + (parseFloat(c.quantity) || 0), 0);
    if (isSeedLot) {
      if (childSum <= 0 || childSum > pqty + 0.0001)
        throw new Error(`Extract qty (${childSum.toFixed(4)}) must be between 0 and ${pqty.toFixed(4)} ${parent.unit}`);
    } else {
      if (Math.abs(childSum - pqty) > 0.0001)
        throw new Error(`Children qty sum (${childSum.toFixed(4)}) must equal parent qty (${pqty.toFixed(4)}) exactly`);
    }

    if (children.some(c => (parseFloat(c.quantity) || 0) <= 0))
      throw new Error('All child quantities must be positive');

    const movNum = await genMovNum(client);
    const { rows: [mv] } = await client.query(
      `INSERT INTO lot_movements (movement_number, movement_type, movement_date, notes, created_by)
       VALUES ($1, 'split', CURRENT_DATE, $2, $3) RETURNING *`,
      [movNum, notes || null, req.user.id]
    );

    // Record parent consumption (childSum = extracted qty; equals pqty for non-seeds)
    await client.query(
      `INSERT INTO lot_movement_parents (movement_id, parent_lot_id, quantity_consumed, cost_per_unit)
       VALUES ($1, $2, $3, $4)`,
      [mv.id, parent.id, childSum, parseFloat(parent.rate)]
    );

    const rough = usesWeight(parent);
    const createdLots = [];

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      const cqty = parseFloat(c.quantity);
      const cRate = parseFloat(parent.rate);
      const cValue = Math.round(cqty * cRate * 100) / 100;

      // Determine qty / weight for the new inventory row
      let invQty, invWeight;
      if (rough) {
        invQty    = 1;     // each rough lot = 1 stone
        invWeight = cqty;  // cqty IS the weight in carats for rough
      } else {
        invQty = cqty;
        const parentWt = parseFloat(parent.weight || 0);
        if (c.weight != null && c.weight !== '' && !isNaN(parseFloat(c.weight))) {
          // Operator explicitly entered weight for this child
          invWeight = Math.round(parseFloat(c.weight) * 10000) / 10000;
        } else if (parentWt > 0) {
          // Proportional fallback
          invWeight = Math.round((cqty / pqty) * parentWt * 10000) / 10000;
        } else {
          invWeight = 0;
        }
      }

      // Determine lot code and genealogy metadata
      const isSeed      = isSeedItem(parent);
      let lotCode, seedLotCode, seedParentId, seedRootId, seedSplitLevel, seedGenPath;

      if (isSeed) {
        const parentCode  = parent.lot_code || parent.lot_number;
        const parentLevel = parseInt(parent.split_level) || 0;
        // DB-driven: reads existing children inside the transaction (parent is locked)
        seedLotCode = await nextSiblingCode(client, parentCode, parentLevel, parent.id);
        // Belt-and-suspenders guard against any remaining race
        const { rows: dup } = await client.query(
          'SELECT 1 FROM inventory WHERE lot_code = $1 OR lot_number = $1', [seedLotCode]
        );
        if (dup.length) throw new Error(`Lot code ${seedLotCode} already exists — concurrent modification detected`);
        lotCode       = seedLotCode;
        seedParentId  = parent.id;
        seedRootId    = parent.root_lot_id || parent.id;
        seedSplitLevel = parentLevel + 1;
        const parentPath = parent.genealogy_path || parentCode;
        seedGenPath   = `${parentPath}/${seedLotCode}`;
      } else {
        const baseCode = `${parent.lot_number}-${getSuffix(i)}`;
        lotCode        = await uniqueLotCode(client, baseCode);
        seedLotCode    = null;
        seedParentId   = null;
        seedRootId     = null;
        seedSplitLevel = null;
        seedGenPath    = null;
      }

      // Inherit dimensions from parent (seed lots); allow future override from Lot Workspace
      const childDimLength = isSeed ? (parent.dim_length ?? null) : null;
      const childDimDepth  = isSeed ? (parent.dim_depth  ?? null) : null;
      const childDimHeight = isSeed ? (parent.dim_height ?? null) : null;
      const childDimUnit   = isSeed ? (parent.dim_unit   ?? null) : null;

      const childLotOpId = await nextLotOpId(client);

      const { rows: [inv] } = await client.query(
        `INSERT INTO inventory
           (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
            location_id, department_id, vendor_id, purchase_date,
            status, remarks, source_movement_id, source_type,
            lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
            lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN STOCK',$14,$15,'split',
                 $16,$17,$18,'split',$19,$20,$21,$22,$23,$24,$25,'Split Lot')
         RETURNING *`,
        [
          parent.item_id,
          lotCode,
          c.remark || `${parent.lot_name || parent.lot_number} (split ${getSuffix(i)})`,
          parent.batch_no,
          invQty,
          parent.unit,
          invWeight,
          cRate,
          cValue,
          parent.location_id,
          parent.department_id,
          parent.vendor_id,
          parent.purchase_date,
          c.remark || null,
          mv.id,
          seedLotCode,
          seedParentId,
          seedRootId,
          seedSplitLevel,
          seedGenPath,
          childLotOpId,
          childDimLength,
          childDimDepth,
          childDimHeight,
          childDimUnit,
        ]
      );

      await client.query(
        `INSERT INTO lot_movement_children (movement_id, child_lot_id, quantity, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, inv.id, cqty, cRate]
      );

      createdLots.push({ id: inv.id, lot_number: lotCode, quantity: cqty, rate: cRate, total_value: cValue });
    }

    // Update parent: partial retention for seeds, full consumption for non-seeds
    if (isSeedLot) {
      const remainingQty = Math.max(0, pqty - childSum);
      const newStatus    = remainingQty <= 0.0001 ? 'CONSUMED' : 'IN STOCK';
      const remainVal    = Math.round(remainingQty * parseFloat(parent.rate) * 100) / 100;
      if (rough) {
        await client.query(
          `UPDATE inventory
           SET qty = $1, weight = $2, total_value = $3, status = $4, updated_at = NOW()
           WHERE id = $5`,
          [remainingQty <= 0.0001 ? 0 : 1, remainingQty <= 0.0001 ? 0 : remainingQty, remainVal, newStatus, parent.id]
        );
      } else {
        await client.query(
          `UPDATE inventory
           SET qty = $1, total_value = $2, status = $3, updated_at = NOW()
           WHERE id = $4`,
          [remainingQty <= 0.0001 ? 0 : remainingQty, remainVal, newStatus, parent.id]
        );
      }
    } else {
      await client.query(
        `UPDATE inventory
         SET qty = 0, weight = 0, total_value = 0, status = 'CONSUMED', updated_at = NOW()
         WHERE id = $1`,
        [parent.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      movement_number: movNum,
      movement_id: mv.id,
      parent_lot: parent.lot_number,
      children: createdLots,
    });
    dispatchEvent('lot.split', { movement_id: mv.id, movement_number: movNum, parent_lot_id: parseInt(parent_lot_id), children: createdLots }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── MIX PREVIEW ───────────────────────────────────────────────────────────────

router.post('/mix/preview', authenticate, async (req, res) => {
  try {
    const { parent_lot_ids } = req.body;
    if (!Array.isArray(parent_lot_ids) || parent_lot_ids.length < 2)
      return res.status(400).json({ error: 'At least 2 parent_lot_ids required' });

    const { rows } = await pool.query(
      `SELECT inv.*, i.category, i.name as item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ANY($1::int[]) ORDER BY inv.id`,
      [parent_lot_ids.map(Number)]
    );

    if (rows.length !== parent_lot_ids.length)
      return res.status(404).json({ error: 'One or more lots not found' });

    const uniqueItems = [...new Set(rows.map(r => r.item_id))];
    if (uniqueItems.length > 1)
      return res.status(400).json({ error: 'All lots must belong to the same item to mix' });

    const consumed = rows.filter(r => CONSUMED.includes(r.status));
    if (consumed.length)
      return res.status(409).json({
        error: `Lots already consumed: ${consumed.map(r => r.lot_number).join(', ')}`,
      });

    // Dimensions are per-piece, not additive: a mixed lot may only carry a
    // dimension every measured parent agrees on. Preview must reject exactly what
    // execute rejects, or the operator discovers the block only after confirming.
    const isSeed = isSeedItem(rows[0]);
    const mixDims = resolveMixDimensions(rows);
    if (isSeed && mixDims.conflict) {
      return res.status(409).json({
        error: mixDimensionError(mixDims),
        dimensions_conflict: true,
        conflicting_lots: mixDims.conflictingLots,
      });
    }

    const totalEffQty = rows.reduce((s, r) => s + effQty(r), 0);
    const totalVal    = rows.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    const wAvgRate    = totalEffQty > 0
      ? Math.round((totalVal / totalEffQty) * 10000) / 10000
      : 0;

    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;

    res.json({
      child_dimensions: isSeed ? mixDims.dims : null,
      dimensions_conflict: false,
      parents: rows.map(r => ({
        id: r.id,
        lot_number: r.lot_number,
        effective_qty: effQty(r),
        rate: parseFloat(r.rate),
        total_value: parseFloat(r.total_value),
        status: r.status,
      })),
      child_effective_qty: totalEffQty,
      child_cost_per_unit: wAvgRate,
      child_total_value: Math.round(totalVal * 100) / 100,
      child_lot_code_preview: rows[0].category === 'seed' ? 'MX####' : `MIX-${ym}-XXXX`,
      unit: rows[0].unit,
      item_name: rows[0].item_name,
      valid: true,
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotMovements.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── MIX EXECUTE ───────────────────────────────────────────────────────────────

router.post('/mix', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const { parent_lot_ids, notes } = req.body;

  if (!Array.isArray(parent_lot_ids) || parent_lot_ids.length < 2)
    return res.status(400).json({ error: 'At least 2 parent_lot_ids required' });

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Lock all parents in ascending id order to prevent deadlocks
    const sortedIds = [...parent_lot_ids].map(Number).sort((a, b) => a - b);
    const { rows } = await client.query(
      `SELECT inv.*, i.category, i.name as item_name
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ANY($1::int[]) ORDER BY inv.id
       FOR UPDATE`,
      [sortedIds]
    );

    if (rows.length !== parent_lot_ids.length)
      throw new Error('One or more lots not found');

    // Action Matrix enforcement: Growth Run (biscuit) lots cannot be mixed —
    // two crystal slabs cannot be physically merged.
    const growthRuns = rows.filter(r => r.category === 'growth_run');
    if (growthRuns.length)
      throw new Error(`Growth Run lots cannot be mixed: ${growthRuns.map(r => r.lot_number).join(', ')}`);

    const uniqueItems = [...new Set(rows.map(r => r.item_id))];
    if (uniqueItems.length > 1)
      throw new Error('All lots must belong to the same item to mix');

    const consumed = rows.filter(r => CONSUMED.includes(r.status));
    if (consumed.length)
      throw new Error(`Lots already consumed: ${consumed.map(r => r.lot_number).join(', ')}`);

    const zeroQty = rows.filter(r => effQty(r) <= 0);
    if (zeroQty.length)
      throw new Error(`Lots have zero quantity: ${zeroQty.map(r => r.lot_number).join(', ')}`);

    const rough         = usesWeight(rows[0]);
    const totalEffQty   = rows.reduce((s, r) => s + effQty(r), 0);
    const totalVal      = rows.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    const totalQtySum   = rows.reduce((s, r) => s + parseFloat(r.qty || 0), 0);
    const totalWeightSum = rows.reduce((s, r) => s + parseFloat(r.weight || 0), 0);
    const wAvgRate      = totalEffQty > 0
      ? Math.round((totalVal / totalEffQty) * 10000) / 10000
      : 0;
    const childTotalValue = Math.round(totalVal * 100) / 100;

    const firstParent = rows[0];
    const isSeed      = isSeedItem(firstParent);

    // Dimensions are per-piece attributes, never additive. The child may only
    // inherit a dimension that every measured parent agrees on — otherwise the
    // mixed lot would claim a size that isn't true of its contents. Reject here,
    // before the first write, so the transaction rolls back clean.
    const mixDims = resolveMixDimensions(rows);
    if (isSeed && mixDims.conflict) throw new Error(mixDimensionError(mixDims));
    const childDims = isSeed
      ? mixDims.dims
      : { dim_length: null, dim_depth: null, dim_height: null, dim_unit: null };

    // batch_no is likewise not mergeable: keep it only when the parents agree.
    const batchNos     = [...new Set(rows.map(r => r.batch_no || null))];
    const childBatchNo = batchNos.length === 1 ? batchNos[0] : null;

    const movNum = await genMovNum(client);
    const { rows: [mv] } = await client.query(
      `INSERT INTO lot_movements (movement_number, movement_type, movement_date, notes, created_by)
       VALUES ($1, 'mix', CURRENT_DATE, $2, $3) RETURNING *`,
      [movNum, notes || null, req.user.id]
    );

    // Record all parents (use wAvgRate for both parents & child so the
    // trigger balance check uses identical cost_per_unit values)
    for (const p of rows) {
      await client.query(
        `INSERT INTO lot_movement_parents (movement_id, parent_lot_id, quantity_consumed, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, p.id, effQty(p), wAvgRate]
      );
    }

    // Create the single child lot
    let childCode, mixLotCode;
    if (isSeed) {
      mixLotCode = await nextMixLotCode(client);
      childCode  = mixLotCode;
    } else {
      childCode  = await uniqueLotCode(client, movNum.replace('LM-', 'MIX-'));
      mixLotCode = null;
    }

    const invQty    = rough ? totalQtySum  : totalEffQty;
    const invWeight = rough ? totalWeightSum : 0;

    const mixLotOpId = await nextLotOpId(client);

    const { rows: [childInv] } = await client.query(
      `INSERT INTO inventory
         (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
          location_id, department_id, vendor_id, purchase_date,
          status, remarks, source_movement_id, source_type,
          lot_code, operation_type, split_level, lot_op_id, source_module,
          dim_length, dim_depth, dim_height, dim_unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_DATE,'IN STOCK',$13,$14,'mix',
               $15,'mix',0,$16,'Mix Lots',$17,$18,$19,$20)
       RETURNING *`,
      [
        firstParent.item_id,
        childCode,
        `Mixed lot ${movNum}`,
        childBatchNo,
        invQty,
        firstParent.unit,
        invWeight,
        wAvgRate,
        childTotalValue,
        firstParent.location_id,
        firstParent.department_id,
        firstParent.vendor_id,
        notes || `Mixed from: ${rows.map(r => r.lot_number).join(', ')}`,
        mv.id,
        mixLotCode,
        mixLotOpId,
        childDims.dim_length,
        childDims.dim_depth,
        childDims.dim_height,
        childDims.dim_unit,
      ]
    );

    // For seed mixes: set root_lot_id = self (mix creates a new genealogy root)
    if (isSeed) {
      await client.query(
        'UPDATE inventory SET root_lot_id = id WHERE id = $1',
        [childInv.id]
      );
    }

    // Track mix components for genealogy
    for (const p of rows) {
      await client.query(
        `INSERT INTO lot_mix_components (mixed_lot_id, source_lot_id, qty) VALUES ($1, $2, $3)`,
        [childInv.id, p.id, effQty(p)]
      );
    }

    await client.query(
      `INSERT INTO lot_movement_children (movement_id, child_lot_id, quantity, cost_per_unit)
       VALUES ($1, $2, $3, $4)`,
      [mv.id, childInv.id, totalEffQty, wAvgRate]
    );

    // Consume all parents
    for (const p of rows) {
      await client.query(
        `UPDATE inventory
         SET qty = 0, weight = 0, total_value = 0, status = 'CONSUMED', updated_at = NOW()
         WHERE id = $1`,
        [p.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      movement_number: movNum,
      movement_id: mv.id,
      parents: rows.map(r => r.lot_number),
      child_lot: {
        id: childInv.id,
        lot_number: childCode,
        effective_qty: totalEffQty,
        rate: wAvgRate,
        total_value: Math.round(totalVal * 100) / 100,
        dimensions: isSeed ? childDims : null,
      },
    });
    dispatchEvent('lot.merged', { movement_id: mv.id, movement_number: movNum, parent_lot_ids, child_lot_id: childInv.id, child_lot_number: childCode }).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ── LINEAGE ───────────────────────────────────────────────────────────────────

router.get('/lineage/:lotId', authenticate, async (req, res) => {
  try {
    const lotId = parseInt(req.params.lotId);

    const { rows: lotRows } = await pool.query(
      `SELECT inv.*, i.name as item_name, i.category,
              (COALESCE(inv.qty, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0) + COALESCE((SELECT SUM(issued_qty) FROM lot_process_issues WHERE source_lot_id = inv.id), 0)) AS historical_qty,
              (COALESCE(inv.weight, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0)) AS historical_weight
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = $1`,
      [lotId]
    );
    if (!lotRows.length) return res.status(404).json({ error: 'Lot not found' });
    const lot = lotRows[0];

    // Walk UP: ancestors of this lot
    const { rows: ancestors } = await pool.query(
      `WITH RECURSIVE anc AS (
         -- lots that are parents of the given lot (depth 1)
         SELECT lmp.parent_lot_id AS lot_id,
                lm.id AS movement_id, lm.movement_number, lm.movement_type::text,
                1 AS depth
         FROM lot_movement_children lmc
         JOIN lot_movements          lm  ON lm.id  = lmc.movement_id
         JOIN lot_movement_parents   lmp ON lmp.movement_id = lmc.movement_id
         WHERE lmc.child_lot_id = $1

         UNION ALL

         -- parents of parents
         SELECT lmp2.parent_lot_id,
                lm2.id, lm2.movement_number, lm2.movement_type::text,
                a.depth + 1
         FROM anc a
         JOIN lot_movement_children lmc2 ON lmc2.child_lot_id = a.lot_id
         JOIN lot_movements          lm2  ON lm2.id = lmc2.movement_id
         JOIN lot_movement_parents   lmp2 ON lmp2.movement_id = lmc2.movement_id
       )
       SELECT DISTINCT
              a.lot_id, a.movement_id, a.movement_number, a.movement_type, a.depth,
              inv.lot_number, inv.lot_name, inv.qty, inv.weight, inv.rate, inv.unit,
              inv.status, inv.total_value, inv.source_type,
              (COALESCE(inv.qty, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0) + COALESCE((SELECT SUM(issued_qty) FROM lot_process_issues WHERE source_lot_id = inv.id), 0)) AS historical_qty,
              (COALESCE(inv.weight, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0)) AS historical_weight,
              i.name AS item_name, i.category
       FROM anc a
       JOIN inventory inv ON inv.id = a.lot_id
       JOIN items     i   ON i.id   = inv.item_id
       ORDER BY a.depth`,
      [lotId]
    );

    // Walk DOWN: descendants of this lot
    const { rows: descendants } = await pool.query(
      `WITH RECURSIVE des AS (
         -- lots that are children of the given lot (depth 1)
         SELECT lmc.child_lot_id AS lot_id,
                lm.id AS movement_id, lm.movement_number, lm.movement_type::text,
                1 AS depth
         FROM lot_movement_parents  lmp
         JOIN lot_movements          lm  ON lm.id  = lmp.movement_id
         JOIN lot_movement_children  lmc ON lmc.movement_id = lmp.movement_id
         WHERE lmp.parent_lot_id = $1

         UNION ALL

         -- children of children
         SELECT lmc2.child_lot_id,
                lm2.id, lm2.movement_number, lm2.movement_type::text,
                d.depth + 1
         FROM des d
         JOIN lot_movement_parents  lmp2 ON lmp2.parent_lot_id = d.lot_id
         JOIN lot_movements          lm2  ON lm2.id = lmp2.movement_id
         JOIN lot_movement_children  lmc2 ON lmc2.movement_id = lmp2.movement_id
       )
       SELECT DISTINCT
              d.lot_id, d.movement_id, d.movement_number, d.movement_type, d.depth,
              inv.lot_number, inv.lot_name, inv.qty, inv.weight, inv.rate, inv.unit,
              inv.status, inv.total_value, inv.source_type,
              (COALESCE(inv.qty, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0) + COALESCE((SELECT SUM(issued_qty) FROM lot_process_issues WHERE source_lot_id = inv.id), 0)) AS historical_qty,
              (COALESCE(inv.weight, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0)) AS historical_weight,
              i.name AS item_name, i.category
       FROM des d
       JOIN inventory inv ON inv.id = d.lot_id
       JOIN items     i   ON i.id   = inv.item_id
       ORDER BY d.depth`,
      [lotId]
    );

    // ── Process genealogy fallback (parent_lot_id chain) ─────────────────────
    // Lots created by process issue/return have parent_lot_id set but no
    // lot_movements record. Walk up/down parent_lot_id independently and
    // merge with movement-based ancestry, deduplicating by lot id.

    // Collect lot ids already found via movements so we don't double-report
    const movAncIds  = new Set(ancestors.map(a => a.lot_id));
    const movDescIds = new Set(descendants.map(d => d.lot_id));

    // Ancestors via parent_lot_id (recursive CTE, limit depth 20)
    const { rows: procAncestors } = await pool.query(
      `WITH RECURSIVE pa AS (
         SELECT inv.id AS lot_id, inv.parent_lot_id, inv.operation_type,
                1 AS depth
         FROM inventory inv
         WHERE inv.id = $1 AND inv.parent_lot_id IS NOT NULL

         UNION ALL

         SELECT p2.id, p2.parent_lot_id, p2.operation_type,
                pa.depth + 1
         FROM pa
         JOIN inventory p2 ON p2.id = pa.parent_lot_id
         WHERE pa.depth < 20
       )
       SELECT DISTINCT
              pa.parent_lot_id AS lot_id,
              pa.operation_type,
              pa.depth,
              inv.lot_number, inv.lot_name, inv.qty, inv.weight, inv.rate, inv.unit,
              inv.status, inv.total_value, inv.source_type,
              (COALESCE(inv.qty, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0) + COALESCE((SELECT SUM(issued_qty) FROM lot_process_issues WHERE source_lot_id = inv.id), 0)) AS historical_qty,
              (COALESCE(inv.weight, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0)) AS historical_weight,
              i.name AS item_name, i.category
       FROM pa
       JOIN inventory inv ON inv.id = pa.parent_lot_id
       JOIN items     i   ON i.id   = inv.item_id
       ORDER BY pa.depth`,
      [lotId]
    );

    // Descendants via parent_lot_id (lots whose parent_lot_id points here, recursive)
    const { rows: procDescendants } = await pool.query(
      `WITH RECURSIVE pd AS (
         SELECT inv.id AS lot_id, inv.operation_type,
                1 AS depth
         FROM inventory inv
         WHERE inv.parent_lot_id = $1

         UNION ALL

         SELECT p2.id, p2.operation_type,
                pd.depth + 1
         FROM pd
         JOIN inventory p2 ON p2.parent_lot_id = pd.lot_id
         WHERE pd.depth < 20
       )
       SELECT DISTINCT
              pd.lot_id, pd.operation_type, pd.depth,
              inv.lot_number, inv.lot_name, inv.qty, inv.weight, inv.rate, inv.unit,
              inv.status, inv.total_value, inv.source_type,
              (COALESCE(inv.qty, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0) + COALESCE((SELECT SUM(issued_qty) FROM lot_process_issues WHERE source_lot_id = inv.id), 0)) AS historical_qty,
              (COALESCE(inv.weight, 0) + COALESCE((SELECT SUM(quantity_consumed) FROM lot_movement_parents WHERE parent_lot_id = inv.id), 0)) AS historical_weight,
              i.name AS item_name, i.category
       FROM pd
       JOIN inventory inv ON inv.id = pd.lot_id
       JOIN items     i   ON i.id   = inv.item_id
       ORDER BY pd.depth`,
      [lotId]
    );

    const lotShape = r => ({
      id: r.lot_id || r.id,
      lot_number: r.lot_number,
      lot_name: r.lot_name,
      qty: r.qty,
      weight: r.weight,
      historical_qty: r.historical_qty,
      historical_weight: r.historical_weight,
      rate: r.rate,
      unit: r.unit,
      status: r.status,
      total_value: r.total_value,
      source_type: r.source_type,
      item_name: r.item_name,
      category: r.category,
    });

    // Merge: movement-based first, then process-based (skip duplicates)
    const allAncestors = [
      ...ancestors.map(a => ({
        lot: lotShape(a),
        via_movement: { id: a.movement_id, movement_number: a.movement_number, movement_type: a.movement_type },
        via_operation: null,
        depth: a.depth,
      })),
      ...procAncestors
        .filter(a => !movAncIds.has(a.lot_id))
        .map(a => ({
          lot: lotShape(a),
          via_movement: null,
          via_operation: a.operation_type || a.source_type || 'process',
          depth: a.depth,
        })),
    ];

    const allDescendants = [
      ...descendants.map(d => ({
        lot: lotShape(d),
        via_movement: { id: d.movement_id, movement_number: d.movement_number, movement_type: d.movement_type },
        via_operation: null,
        depth: d.depth,
      })),
      ...procDescendants
        .filter(d => !movDescIds.has(d.lot_id))
        .map(d => ({
          lot: lotShape(d),
          via_movement: null,
          via_operation: d.operation_type || d.source_type || 'process',
          depth: d.depth,
        })),
    ];

    res.json({
      lot: { ...lotShape({ ...lot, lot_id: lot.id }), source_type: lot.source_type },
      ancestors:   allAncestors,
      descendants: allDescendants,
    });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotMovements.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── LIST ──────────────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 100000);
    const offset = (page - 1) * pageSize;
    const { type, from, to, lot_id, search } = req.query;
    const params = [];
    const filters = [];

    if (type) {
      params.push(type);
      filters.push(`lm.movement_type = $${params.length}::lot_movement_type`);
    }
    if (from) { params.push(from);   filters.push(`lm.movement_date >= $${params.length}`); }
    if (to)   { params.push(to);     filters.push(`lm.movement_date <= $${params.length}`); }
    if (lot_id) {
      params.push(parseInt(lot_id));
      filters.push(
        `(EXISTS (SELECT 1 FROM lot_movement_parents WHERE movement_id = lm.id AND parent_lot_id = $${params.length})
       OR EXISTS (SELECT 1 FROM lot_movement_children WHERE movement_id = lm.id AND child_lot_id = $${params.length}))`
      );
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`lm.movement_number ILIKE $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countParams = [...params];

    const { rows: [cr] } = await pool.query(
      `SELECT COUNT(*) FROM lot_movements lm ${where}`,
      countParams
    );

    params.push(pageSize, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await pool.query(
      `SELECT lm.*, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM lot_movement_parents  WHERE movement_id = lm.id) AS parent_count,
              (SELECT COUNT(*) FROM lot_movement_children WHERE movement_id = lm.id) AS child_count
       FROM lot_movements lm
       LEFT JOIN users u ON lm.created_by = u.id
       ${where}
       ORDER BY lm.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const totalCount = parseInt(cr.count);
    const totalPages = Math.ceil(totalCount / pageSize);
    res.json({ data: rows, totalCount, page, pageSize, totalPages });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotMovements.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// ── DETAIL ────────────────────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows: [mv] } = await pool.query(
      `SELECT lm.*, u.full_name AS created_by_name
       FROM lot_movements lm LEFT JOIN users u ON lm.created_by = u.id
       WHERE lm.id = $1`,
      [req.params.id]
    );
    if (!mv) return res.status(404).json({ error: 'Movement not found' });

    const { rows: parents } = await pool.query(
      `SELECT lmp.*, inv.lot_number, inv.lot_name, inv.status, inv.unit,
              i.name AS item_name, i.category
       FROM lot_movement_parents lmp
       JOIN inventory inv ON inv.id = lmp.parent_lot_id
       JOIN items i       ON i.id   = inv.item_id
       WHERE lmp.movement_id = $1
       ORDER BY lmp.id`,
      [mv.id]
    );

    const { rows: children } = await pool.query(
      `SELECT lmc.*, inv.lot_number, inv.lot_name, inv.status, inv.unit,
              i.name AS item_name, i.category
       FROM lot_movement_children lmc
       JOIN inventory inv ON inv.id = lmc.child_lot_id
       JOIN items i       ON i.id   = inv.item_id
       WHERE lmc.movement_id = $1
       ORDER BY lmc.id`,
      [mv.id]
    );

    res.json({ ...mv, parents, children });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[lotMovements.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

module.exports = router;

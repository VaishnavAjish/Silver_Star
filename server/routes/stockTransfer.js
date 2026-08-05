const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');
// Phase A (Seed Lifecycle): shared attachment rule — see services/manufacturingState.js
const { attachmentBlockReason } = require('../services/manufacturingState');
const { generateLineage } = require('../services/inventoryLineageService');

const router = express.Router();

async function genTransferNum(client) {
  const { rows } = await client.query("SELECT nextval('st_seq') as n");
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `ST-${ym}-${String(rows[0].n).padStart(4, '0')}`;
}

// ── Database Initialization ──
(async () => {
  try {
    const client = await pool.primaryPool.connect();
    try {
      // Step 1: Sequences and tables (app user has permission for these)
      const queries = [
        `CREATE SEQUENCE IF NOT EXISTS st_seq START 1;`,
        `CREATE SEQUENCE IF NOT EXISTS lot_op_id_seq START 1;`,
        `CREATE TABLE IF NOT EXISTS pending_transfers (
          id SERIAL PRIMARY KEY,
          transfer_id VARCHAR(50) UNIQUE NOT NULL,
          source_location_id INTEGER REFERENCES locations(id),
          destination_location_id INTEGER REFERENCES locations(id),
          source_account_name VARCHAR(100),
          dest_account_name VARCHAR(100),
          status VARCHAR(20) DEFAULT 'Pending',
          created_at TIMESTAMP DEFAULT NOW(),
          created_by INTEGER REFERENCES users(id),
          approved_by INTEGER REFERENCES users(id),
          approved_at TIMESTAMP
        );`,
        `ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);`,
        `ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;`,
        `ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS dest_location_name VARCHAR(100);`,
        `ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS destination_department_id INTEGER REFERENCES departments(id);`,
        `ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS source_department_id INTEGER REFERENCES departments(id);`,
        `CREATE TABLE IF NOT EXISTS pending_transfer_lots (
          id SERIAL PRIMARY KEY,
          pending_transfer_id INTEGER REFERENCES pending_transfers(id) ON DELETE CASCADE,
          lot_id INTEGER REFERENCES inventory(id),
          transfer_qty NUMERIC(15,4)
        );`
      ];

      for (const q of queries) {
        try {
          await client.query(q);
        } catch (queryErr) {
          logger.warn(`stockTransfer init query failed: ${q.substring(0, 50)}...`, { error: queryErr.message });
        }
      }
      logger.info('stockTransfer DB init complete (sequences + tables ready)');
    } finally {
      client.release();
    }

    // Step 2: Try to add enum value — requires type ownership; skip if not allowed
    try {
      const client2 = await pool.primaryPool.connect();
      try {
        await client2.query(`ALTER TYPE lot_movement_type ADD VALUE IF NOT EXISTS 'transfer';`);
        logger.info('stockTransfer: lot_movement_type enum updated');
      } finally {
        client2.release();
      }
    } catch (enumErr) {
      logger.warn('stockTransfer: could not alter lot_movement_type (needs superuser/owner) — value may already exist', { error: enumErr.message });
    }
  } catch (e) {
    logger.error('stockTransfer DB init failed', { error: e.message, stack: e.stack });
  }
})();

// ── Startup Schema Validation ──
// Verifies the column added by the hardening migration exists before
// the module accepts any requests. Logs a precise developer error if not.
(async () => {
  try {
    await pool.query(`SELECT destination_department_id FROM pending_transfers LIMIT 0`);
    logger.info('stockTransfer: schema validation passed — all required columns present');
  } catch (e) {
    logger.error(
      'stockTransfer: SCHEMA VALIDATION FAILED — destination_department_id is missing from ' +
      'pending_transfers. Run: ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS ' +
      'destination_department_id INTEGER REFERENCES departments(id);',
      { error: e.message }
    );
  }
})();


router.post('/preview', authenticate, async (req, res) => {
  try {
    const { lots: payloadLots, destination_department_id } = req.body;
    if (!payloadLots?.length || !destination_department_id)
      return res.status(400).json({ error: 'lots[] and destination_department_id required' });

    // ── Phase A: effective Stock Transfer VIEW or CREATE is required ───────
    const [mayView, mayCreate] = await Promise.all([
      hasPermission(req.user.id, 'inventory', 'view',   'stock_transfer', req.user.role),
      hasPermission(req.user.id, 'inventory', 'create', 'stock_transfer', req.user.role),
    ]);
    if (!mayView && !mayCreate) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // ── Phase A: every requested lot must be within department scope ──────
    // The whole request is rejected if any lot is out of scope, and the
    // generic message leaks nothing about which lot or whether it exists.
    const scope = await loadDeptScope(req.user.id, req.user.role);
    if (scope.isNone) return res.status(403).json({ error: 'Permission denied' });

    const lot_ids = payloadLots.map(l => l.lot_id);

    if (!scope.isAll) {
      const { rows: scopeRows } = await pool.query(
        'SELECT id, department_id FROM inventory WHERE id = ANY($1)',
        [lot_ids]
      );
      const visibleIds = new Set(
        scopeRows.filter(r => isLotVisible(scope, r)).map(r => Number(r.id))
      );
      const allVisible = lot_ids.every(id => visibleIds.has(Number(id)));
      if (!allVisible) return res.status(403).json({ error: 'Permission denied' });
    }

    const { rows: lots } = await pool.query(
      `SELECT inv.id, inv.lot_number, inv.lot_code, inv.qty, inv.weight, inv.unit,
              inv.total_value, inv.rate, inv.status, inv.location_id, inv.department_id,
              i.name as item_name, i.category,
              d.name as source_department_name
       FROM inventory inv
       JOIN items i ON inv.item_id = i.id
       LEFT JOIN departments d ON inv.department_id = d.id
       WHERE inv.id = ANY($1)`,
      [lot_ids]
    );

    if (!lots.length) return res.status(404).json({ error: 'No lots found' });

    const invalid = lots.filter(l => l.status !== 'IN STOCK');
    if (invalid.length)
      return res.status(409).json({
        error: `Cannot transfer lots not IN STOCK: ${invalid.map(l => l.lot_number).join(', ')}`
      });

    const wrongDept = lots.filter(l => l.department_id === parseInt(destination_department_id));
    if (wrongDept.length)
      return res.status(409).json({
        error: `Source and destination department cannot be the same. Lots already in this department: ${wrongDept.map(l => l.lot_number).join(', ')}`
      });

    const { rows: [dest] } = await pool.query(
      'SELECT name FROM departments WHERE id = $1', [destination_department_id]
    );

    const previewLots = lots.map(l => {
      const p = payloadLots.find(pl => pl.lot_id === l.id);
      const requestedQty = parseFloat(p.transfer_qty || 0);
      const available = l.unit === 'CT' ? parseFloat(l.weight || 0) : parseFloat(l.qty || 0);
      const proportion = available > 0 ? (requestedQty / available) : 0;
      return {
        id: l.id, lot_number: l.lot_number, lot_code: l.lot_code,
        item_name: l.item_name, category: l.category,
        qty: requestedQty, weight: l.unit === 'CT' ? requestedQty : null,
        unit: l.unit, rate: parseFloat(l.rate),
        total_value: parseFloat(l.total_value || 0) * proportion,
      };
    });

    // Phase A: without inventory_financial VIEW the money keys are REMOVED,
    // not nulled — stripFinancial deletes rate/total_value/cost/… entirely.
    const body = {
      lots: stripFinancial(previewLots, scope.canViewFinancial),
      total_lots: previewLots.length,
      source_location_name: lots[0].source_department_name,
      destination_location_name: dest?.name || 'Unassigned',
    };
    if (scope.canViewFinancial) {
      body.total_value = previewLots.reduce((s, l) => s + l.total_value, 0);
    }

    res.json(body);
  } catch (err) { logger.error('[stockTransfer] /preview error', { path: req.path, error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// Phase A (Department Scope): single canonical scope model — see
// services/inventoryAuth.js. The previous local resolver narrowed scope_mode
// ALL down to the user's primary department and treated a *missing* primary
// department as all-department access; both rules are gone.
const {
  loadDeptScope,
  isLotVisible,
  stripFinancial,
  buildMovementScopeClause,
} = require('../services/inventoryAuth');
const { hasPermission } = require('../utils/permissions');

const getTransferDeptScope = loadDeptScope;

router.post('/pending', authenticate, async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { transferId, destination_department_id, selectedLotIds, transferQtys } = req.body;

    const { rows: [userRow] } = await client.query('SELECT department_id FROM users WHERE id = $1', [req.user.id]);
    const sourceDeptId = userRow?.department_id ? parseInt(userRow.department_id) : null;
    if (!sourceDeptId) {
      client.release();
      return res.status(400).json({ error: 'Primary Department is not configured for this user.' });
    }

    await client.query('BEGIN');

    const { rows: [destDept] } = await client.query(
      'SELECT d.name as dest_department_name, d.location_id FROM departments d WHERE d.id = $1', [destination_department_id]
    );
    if (!destDept) throw new Error('Invalid destination department');
    const destLocationId = destDept.location_id;
    const destDeptName = destDept.dest_department_name;

    const { rows: [srcDept] } = await client.query(
      'SELECT d.location_id FROM departments d WHERE d.id = $1', [sourceDeptId]
    );

    const { rows: [pt] } = await client.query(`
      INSERT INTO pending_transfers (transfer_id, source_department_id, source_location_id, destination_location_id, destination_department_id, dest_location_name, created_by, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
      ON CONFLICT (transfer_id) DO UPDATE SET
        source_department_id = EXCLUDED.source_department_id,
        source_location_id = EXCLUDED.source_location_id,
        destination_location_id = EXCLUDED.destination_location_id,
        destination_department_id = EXCLUDED.destination_department_id,
        dest_location_name = EXCLUDED.dest_location_name,
        status = 'Pending'
      RETURNING id
    `, [transferId, sourceDeptId, srcDept?.location_id || null, destLocationId || null, destination_department_id || null, destDeptName || null, req.user?.id || null]);
    
    await client.query('DELETE FROM pending_transfer_lots WHERE pending_transfer_id = $1', [pt.id]);
    
    if (selectedLotIds && selectedLotIds.length > 0) {
      for (const lotId of selectedLotIds) {
        const qty = transferQtys && transferQtys[lotId] !== undefined ? transferQtys[lotId] : null;
        await client.query(`
          INSERT INTO pending_transfer_lots (pending_transfer_id, lot_id, transfer_qty)
          VALUES ($1, $2, $3)
        `, [pt.id, lotId, qty]);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, pending_transfer_id: pt.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Diagnostic: see exact state of one pending transfer + current lot statuses
router.get('/pending/:id/debug', authenticate, async (req, res) => {
  try {
    const scope = await getTransferDeptScope(req.user.id, req.user.role);
    const { rows: [pt] } = await pool.query(
      `SELECT pt.*, sd.name AS src_name, d.name AS dst_name, u.full_name AS created_by_name
       FROM pending_transfers pt
       LEFT JOIN departments sd ON sd.id = pt.source_department_id
       LEFT JOIN departments d ON d.id = pt.destination_department_id
       LEFT JOIN users u ON u.id = pt.created_by
       WHERE pt.id = $1`,
      [req.params.id]
    );
    if (!pt) return res.status(404).json({ error: 'Transfer not found' });

    if (!scope.isAll) {
      if (scope.isNone) return res.status(403).json({ error: 'Permission denied: department scope restriction' });
      const srcId = pt.source_department_id ? parseInt(pt.source_department_id) : null;
      const dstId = pt.destination_department_id ? parseInt(pt.destination_department_id) : null;
      const hasAccess = (srcId && scope.allowedDeptIds.includes(srcId)) || (dstId && scope.allowedDeptIds.includes(dstId));
      if (!hasAccess) return res.status(403).json({ error: 'Permission denied: department scope restriction' });
    }

    const { rows: lots } = await pool.query(
      `SELECT ptl.lot_id, ptl.transfer_qty,
              inv.lot_code, inv.lot_number, inv.status AS current_status,
              inv.qty, inv.weight, inv.unit, inv.location_id,
              loc.name AS current_location
       FROM pending_transfer_lots ptl
       LEFT JOIN inventory inv ON inv.id = ptl.lot_id
       LEFT JOIN locations loc ON loc.id = inv.location_id
       WHERE ptl.pending_transfer_id = $1`,
      [pt.id]
    );
    res.json({ transfer: pt, lots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Single scoped read used by the Stock Transfer list AND by export/print, so
 * exported rows can never differ from what the list is allowed to show.
 */
async function queryScopedTransfers(scope, status) {
  if (scope.isNone) return [];

  const whereClauses = [];
  const params = [];
  let paramIdx = 1;

  if (status) {
    whereClauses.push(`pt.status = $${paramIdx}`);
    params.push(status);
    paramIdx++;
  }

  // Phase A: scope on the stored source/destination departments only.
  // No primary-department inference, no hardcoded department 3 fallback —
  // a transfer with neither department resolvable stays hidden.
  if (!scope.isAll) {
    whereClauses.push(`(
      pt.source_department_id = ANY($${paramIdx}::int[])
      OR
      pt.destination_department_id = ANY($${paramIdx}::int[])
    )`);
    params.push(scope.allowedDeptIds);
    paramIdx++;
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const { rows } = await pool.query(`
      SELECT
        pt.*,
        COALESCE(sd.name, sl.name, 'Unassigned') AS source_location_name,
        COALESCE(d.name, dl.name, 'Unassigned')  AS destination_location_name,
        COALESCE(sd.name, 'Unassigned') AS source_department_name,
        COALESCE(d.name, 'Unassigned') AS destination_department_name,
        u.full_name AS created_by_name,
        approver.full_name AS approved_by_name,
        (
          SELECT json_agg(json_build_object(
            'lot_id',           ptl.lot_id,
            'transfer_qty',     ptl.transfer_qty,
            'lot_code',         inv.lot_code,
            'lot_number',       inv.lot_number,
            'item_name',        i.name,
            'item_description', i.description,
            'item_category',    i.category,
            'unit',             inv.unit,
            'weight',           inv.weight,
            'dim_length',       inv.dim_length,
            'dim_depth',        inv.dim_depth,
            'dim_height',       inv.dim_height,
            'total_value',      inv.total_value
          ) ORDER BY ptl.id)
          FROM pending_transfer_lots ptl
          JOIN inventory inv ON inv.id = ptl.lot_id
          JOIN items     i   ON i.id   = inv.item_id
          WHERE ptl.pending_transfer_id = pt.id
        ) AS lots
      FROM pending_transfers pt
      LEFT JOIN users u ON u.id = pt.created_by
      LEFT JOIN departments sd ON sd.id = pt.source_department_id
      LEFT JOIN locations sl ON sl.id = pt.source_location_id
      LEFT JOIN locations dl ON dl.id = pt.destination_location_id
      LEFT JOIN departments d ON d.id = pt.destination_department_id
      LEFT JOIN users approver ON approver.id = pt.approved_by
      ${whereSql}
      ORDER BY pt.created_at DESC
    `, params);

  return rows;
}

router.get('/pending', authenticate, async (req, res) => {
  try {
    const scope = await getTransferDeptScope(req.user.id, req.user.role);
    const rows = await queryScopedTransfers(scope, req.query.status);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pending/:id/approve', authenticate, async (req, res) => {
  const client = await pool.primaryPool.connect();
  const transferId = req.params.id;
  const userId    = req.user?.id   || null;
  const userRole  = req.user?.role || null;

  try {
    await client.query('BEGIN');

    // ── 1. Lock + fetch pending_transfer ────────────────────────────────────
    const { rows: [pt] } = await client.query(
      `SELECT pt.*, sl.name AS src_name, d.name AS dst_name
       FROM pending_transfers pt
       LEFT JOIN locations sl ON sl.id = pt.source_location_id
       LEFT JOIN departments d ON d.id = pt.destination_department_id
       WHERE pt.id = $1
       FOR UPDATE OF pt`,
      [transferId]
    );

    // ── DIAGNOSTIC LOG (shows exact DB values before every check) ───────────
    logger.debug('APPROVE diagnostic', {
      transferId,
      userId,
      userRole,
      found:        !!pt,
      dbStatus:     pt?.status,
      dbCreatedBy:  pt?.created_by,
      transferNum:  pt?.transfer_id,
      srcName:      pt?.src_name,
      dstName:      pt?.dst_name,
    });

    if (!pt) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Transfer id=${transferId} not found.` });
    }

    // ── 2. Case-insensitive status check ────────────────────────────────────
    const statusLower = (pt.status || '').toLowerCase();
    logger.debug('APPROVE status check', { dbStatus: pt.status, expected: 'pending' });

    if (statusLower !== 'pending') {
      await client.query('ROLLBACK');
      const msg =
        statusLower === 'approved' ? 'Transfer has already been approved.' :
        statusLower === 'rejected' ? 'Transfer has already been rejected.' :
        `Transfer cannot be approved — DB status is "${pt.status}" (expected "Pending").`;
      logger.error('APPROVE status mismatch', { dbStatus: pt.status, transferId: pt.transfer_id });
      return res.status(409).json({ error: msg });
    }

    // ── 3. Self-approval guard ───────────────────────────────────────────────
    if (userRole !== 'admin' && userId && String(pt.created_by) === String(userId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot approve a transfer you created.' });
    }

    // ── 4. Fetch pending lots ────────────────────────────────────────────────
    const { rows: ptLots } = await client.query(
      'SELECT * FROM pending_transfer_lots WHERE pending_transfer_id = $1',
      [pt.id]
    );
    logger.debug('APPROVE ptLots', { count: ptLots.length, lotIds: ptLots.map(l => l.lot_id) });

    if (!ptLots.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No lots found in this transfer record.' });
    }

    const lotIds = ptLots.map(l => l.lot_id);

    // ── 5. Lock + fetch inventory lots ──────────────────────────────────────
    const { rows: lots } = await client.query(
      `SELECT inv.*, i.name AS item_name, i.category
       FROM inventory inv
       JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ANY($1)
       FOR UPDATE`,
      [lotIds]
    );
    logger.debug('APPROVE inventory lots fetched', {
      count: lots.length,
      lots: lots.map(l => ({ id: l.id, lot_code: l.lot_code, dbStatus: l.status, qty: l.qty, location_id: l.location_id }))
    });

    // ── 6. Lots existence check ──────────────────────────────────────────────
    if (lots.length === 0) {
      await client.query('ROLLBACK');
      logger.error('APPROVE lots not found', { lotIds });
      return res.status(409).json({
        error: `Lot IDs [${lotIds.join(', ')}] were not found in inventory. They may have been deleted.`,
      });
    }

    // ── 7. Status check — block only terminal/consumed statuses ─────────────
    const TRANSFERABLE = ['IN STOCK', 'IN PROCESS'];
    const invalidLots = lots.filter(l => !TRANSFERABLE.includes((l.status || '').toUpperCase()));
    if (invalidLots.length) {
      await client.query('ROLLBACK');
      logger.error('APPROVE lots not transferable', {
        lots: invalidLots.map(l => ({ id: l.id, lot_code: l.lot_code, dbStatus: l.status }))
      });
      return res.status(409).json({
        error: `Cannot approve: lot(s) [${
          invalidLots.map(l => l.lot_code || l.lot_number || l.id).join(', ')
        }] have status "${
          [...new Set(invalidLots.map(l => l.status))].join(', ')
        }" — lot may already be consumed, sold, or damaged.`,
      });
    }
    // Correction 1 & 5: Growth Runs that are IN PROCESS (still in chamber) must
    // complete the Growth Run Return (→ IN STOCK) before they can be transferred.
    const blockedGrowthRuns = lots.filter(
      l => l.category === 'growth_run' && (l.status || '').toUpperCase() === 'IN PROCESS'
    );
    if (blockedGrowthRuns.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot transfer Growth Run(s) [${
          blockedGrowthRuns.map(l => l.lot_code || l.lot_number || l.id).join(', ')
        }] — they are IN PROCESS (still inside the chamber). Complete the Growth Run Return first to release them to IN STOCK.`,
      });
    }

    // Phase A (Seed Lifecycle): this approve path deliberately allows
    // IN PROCESS lots — but an attached Seed (physically embedded in an
    // active Partial Growth Run) must never move independently of its run.
    const attachedBlock = lots.map(l => attachmentBlockReason(l, 'transferred')).find(Boolean);
    if (attachedBlock) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: attachedBlock });
    }

    // ── 6. Resolve destination location_id and department ──────────────────
    // Use stored destination_location_id; fall back to name-based lookups
    let resolvedLocationId = pt.destination_location_id
      ? parseInt(pt.destination_location_id)
      : null;

    if (!resolvedLocationId && pt.dst_name) {
      const { rows: [locRow] } = await client.query(
        `SELECT id FROM locations WHERE name = $1 LIMIT 1`,
        [pt.dst_name]
      );
      if (locRow) resolvedLocationId = locRow.id;
    }
    if (!resolvedLocationId && pt.dest_account_name) {
      const { rows: [locRow] } = await client.query(
        `SELECT id FROM locations WHERE name = $1 LIMIT 1`,
        [pt.dest_account_name]
      );
      if (locRow) resolvedLocationId = locRow.id;
    }

    let destDepartmentId = null;
    if (resolvedLocationId) {
      // Strategy 1: exact department name + location_id
      if (pt.dest_location_name) {
        const { rows: [d] } = await client.query(
          `SELECT id FROM departments WHERE name = $1 AND location_id = $2 LIMIT 1`,
          [pt.dest_location_name, resolvedLocationId]
        );
        if (d) destDepartmentId = d.id;
      }
      // Strategy 2: department whose location name matches dest_account_name
      if (!destDepartmentId && pt.dest_account_name) {
        const { rows: [d] } = await client.query(
          `SELECT dep.id FROM departments dep
           JOIN locations loc ON dep.location_id = loc.id
           WHERE loc.name = $1
           ORDER BY dep.id LIMIT 1`,
          [pt.dest_account_name]
        );
        if (d) destDepartmentId = d.id;
      }
      // Strategy 3: first department at the resolved destination location
      if (!destDepartmentId) {
        const { rows: [d] } = await client.query(
          `SELECT id FROM departments WHERE location_id = $1 ORDER BY id LIMIT 1`,
          [resolvedLocationId]
        );
        if (d) destDepartmentId = d.id;
      }
    }

    logger.debug('APPROVE location/dept resolved', {
      stored_location_id: pt.destination_location_id,
      resolvedLocationId,
      destDepartmentId,
      dest_location_name: pt.dest_location_name,
      dest_account_name: pt.dest_account_name,
      dst_name: pt.dst_name,
    });

    // ── 7. Generate transfer number and process lots ─────────────────────────
    const transferNumber = await genTransferNum(client);

    // Insert one lot_movement record for the whole transfer (movement_number is UNIQUE)
    const hasPartial = lots.some(lot => {
      const ptLot = ptLots.find(p => p.lot_id === lot.id);
      const requested = parseFloat(ptLot?.transfer_qty || 0);
      const available = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
      return requested < available && requested > 0;
    });
    const { rows: [srcDept] } = await client.query(
      `SELECT d.name FROM departments d WHERE d.id = $1 LIMIT 1`,
      [lots[0]?.department_id]
    );
    const srcDeptName = srcDept?.name || 'Unknown';

    const { rows: [mv] } = await client.query(
      `INSERT INTO lot_movements (movement_number, movement_type, movement_date, notes, created_by)
       VALUES ($1, 'transfer', NOW(), $2, $3) RETURNING id`,
      [
        transferNumber,
        `Transfer -> ${srcDeptName} -> ${pt.dst_name || '?'}${hasPartial ? ' (Partial)' : ''}`,
        userId,
      ]
    );

    for (const lot of lots) {
      const ptLot = ptLots.find(p => p.lot_id === lot.id);
      const requestedQty = parseFloat(ptLot.transfer_qty || 0);
      const available = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
      const isPartial = requestedQty < available && requestedQty > 0;
      let destLotId = lot.id;

      if (isPartial) {
        const remaining = available - requestedQty;
        const valReq = parseFloat(lot.total_value || 0) * (requestedQty / available);
        const valRem = parseFloat(lot.total_value || 0) * (remaining / available);
        
        // Split Remaining Parent
        const { root_lot_id: rR, genealogy_path: gR, split_level: sR } = generateLineage(lot);
        const { rows: [opSeqRem] } = await client.query("SELECT nextval('lot_op_id_seq')");
        const remCode = `${lot.lot_code || lot.lot_number}-SPLIT${opSeqRem.nextval}`;

        await client.query(
          `UPDATE inventory SET 
             qty = $1, weight = $2, total_value = $3, 
             lot_code = $4, lot_number = $4, genealogy_path = $5, split_level = $6,
             updated_at = NOW() 
           WHERE id = $7`,
          [lot.unit === 'CT' ? lot.qty : remaining,
           lot.unit === 'CT' ? remaining : lot.weight,
           valRem, remCode, gR, sR, lot.id]
        );

        // Create Child Transfer Lot
        const { rows: [opSeq] } = await client.query("SELECT nextval('lot_op_id_seq')");
        const newCode = `${lot.lot_code || lot.lot_number}-ST${opSeq.nextval}`;
        const { root_lot_id, genealogy_path, split_level } = generateLineage(lot);
        const { rows: [newLot] } = await client.query(
          `INSERT INTO inventory
             (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
              location_id, department_id, vendor_id, purchase_date,
              status, source_type,
              lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
              lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN STOCK','transfer',
                   $14,$15,$16,'split',$17,$18,$19,$20,$21,$22,$23,'Stock Transfer')
           RETURNING id`,
          [lot.item_id, newCode, newCode, lot.batch_no,
           lot.unit === 'CT' ? lot.qty : requestedQty,
           lot.unit,
           lot.unit === 'CT' ? requestedQty : lot.weight,
           lot.rate, valReq,
           resolvedLocationId, destDepartmentId || lot.department_id, lot.vendor_id, lot.purchase_date,
           newCode, lot.id, root_lot_id,
           split_level,
           genealogy_path,
           opSeq.nextval,
           lot.dim_length, lot.dim_depth, lot.dim_height, lot.dim_unit]
        );
        destLotId = newLot.id;
      } else {
        await client.query(
          `UPDATE inventory
           SET location_id = $1, department_id = $2, source_module = 'Stock Transfer', updated_at = NOW()
           WHERE id = $3`,
          [resolvedLocationId, destDepartmentId || lot.department_id, lot.id]
        );
      }

      await client.query(
        `INSERT INTO lot_movement_parents (movement_id, parent_lot_id, quantity_consumed, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, lot.id, requestedQty, lot.rate]
      );
      await client.query(
        `INSERT INTO lot_movement_children (movement_id, child_lot_id, quantity, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, destLotId, requestedQty, lot.rate]
      );
    }

    // ── 8. Update pending_transfer status ───────────────────────────────────
    await client.query(
      `UPDATE pending_transfers SET status = 'Approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
      [userId, pt.id]
    );

    await client.query('COMMIT');

    logger.info('Transfer approved successfully', {
      transferId,
      transferNumber: pt.transfer_id,
      status: 'Approved',
      sourceDepartment: pt.src_name,
      destinationDepartment: pt.dst_name,
      approvedBy: userId,
      lotsTransferred: lots.length,
    });

    // Real-Time Sync Engine: Emit event
    dispatchEvent('inventory.transferred', {
      transfer_number: transferNumber, transfer_id: pt.id,
      source_name: pt.src_name, dest_name: pt.dst_name,
      lots_count: lots.length, approved_by: userId
    });

    res.json({ success: true, transfer_number: transferNumber, lots_transferred: lots.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Transfer approval — error', {
      transferId,
      userId,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join('; '),
    });
    res.status(500).json({ error: err.message || 'Approval failed. Please try again.' });
  } finally {
    client.release();
  }
});

router.post('/pending/:id/reject', authenticate, async (req, res) => {
  try {
    const { rows: [pt] } = await pool.query(
      `SELECT id, transfer_id, status FROM pending_transfers WHERE id = $1`,
      [req.params.id]
    );

    logger.debug('REJECT diagnostic', {
      transferId: req.params.id,
      userId: req.user?.id || null,
      found: !!pt,
      dbStatus: pt?.status,
    });

    if (!pt) {
      return res.status(404).json({ error: 'Transfer not found.' });
    }
    if ((pt.status || '').toLowerCase() !== 'pending') {
      return res.status(409).json({
        error: (pt.status || '').toLowerCase() === 'approved'
          ? 'Transfer has already been approved.'
          : `Transfer cannot be rejected — current status: "${pt.status}".`,
      });
    }

    await pool.query(
      `UPDATE pending_transfers SET status = 'Rejected', approved_by = $1, approved_at = NOW() WHERE id = $2`,
      [req.user?.id || null, req.params.id]
    );

    logger.info('Transfer rejected', {
      transferId: req.params.id,
      transferNumber: pt.transfer_id,
      status: 'Rejected',
      rejectedBy: req.user?.id || null,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Transfer rejection — error', {
      transferId: req.params.id,
      userId: req.user?.id || null,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pending/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM pending_transfers WHERE id = $1 AND created_by = $2 AND status = 'Pending' RETURNING id`,
      [req.params.id, req.user?.id || null]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Transfer not found or cannot be deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const { lots: payloadLots, destination_department_id, notes } = req.body;

  if (!payloadLots?.length || !destination_department_id)
    return res.status(400).json({ error: 'lots[] and destination_department_id required' });

  const client = await pool.primaryPool.connect();
  try {
    const { rows: [userRow] } = await client.query('SELECT department_id FROM users WHERE id = $1', [req.user.id]);
    const sourceDeptId = userRow?.department_id ? parseInt(userRow.department_id) : null;
    if (!sourceDeptId) {
      client.release();
      return res.status(400).json({ error: 'Primary Department is not configured for this user.' });
    }

    await client.query('BEGIN');

    const lot_ids = payloadLots.map(l => l.lot_id);
    const { rows: lots } = await client.query(
      `SELECT inv.*, i.name as item_name, i.category, d.name as department_name
       FROM inventory inv 
       JOIN items i ON inv.item_id = i.id
       LEFT JOIN departments d ON inv.department_id = d.id
       WHERE inv.id = ANY($1) FOR UPDATE`,
      [lot_ids]
    );

    const invalid = lots.filter(l => l.status !== 'IN STOCK');
    if (invalid.length)
      throw new Error(`Cannot transfer lots not IN STOCK: ${invalid.map(l => l.lot_number).join(', ')}`);

    const wrongDept = lots.filter(l => l.department_id === parseInt(destination_department_id));
    if (wrongDept.length)
      throw new Error(`Source and destination department cannot be the same. Lots already in this department: ${wrongDept.map(l => l.lot_number).join(', ')}`);

    const transferNumber = await genTransferNum(client);
    const userId = req.user?.id || null;

    const { rows: [destDept] } = await client.query(
      'SELECT d.name as dest_department_name, d.location_id FROM departments d WHERE d.id = $1', [destination_department_id]
    );
    if (!destDept) throw new Error('Invalid destination department');
    const destination_location_id = destDept.location_id;
    const destDeptName = destDept.dest_department_name;
    const srcDeptName = lots[0]?.department_name || 'Unknown';

    // Insert one lot_movement record for the whole transfer (movement_number is UNIQUE)
    const hasPartialDirect = lots.some(lot => {
      const pLot = payloadLots.find(pl => pl.lot_id === lot.id);
      const requested = parseFloat(pLot?.transfer_qty || 0);
      const available = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
      return requested < available && requested > 0;
    });
    const { rows: [mv] } = await client.query(
      `INSERT INTO lot_movements (movement_number, movement_type, movement_date, notes, created_by)
       VALUES ($1, 'transfer', NOW(), $2, $3) RETURNING id`,
      [
        transferNumber,
        `Transfer -> ${srcDeptName} -> ${destDeptName}${notes ? ': ' + notes : ''}${hasPartialDirect ? ' (Partial)' : ''}`,
        userId,
      ]
    );

    for (const lot of lots) {
      const pLot = payloadLots.find(pl => pl.lot_id === lot.id);
      const requestedQty = parseFloat(pLot.transfer_qty || 0);
      const available = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);

      const isPartial = requestedQty < available && requestedQty > 0;
      let destLotId = lot.id;

      if (isPartial) {
        const remaining = available - requestedQty;
        const proportionReq = requestedQty / available;
        const proportionRem = remaining / available;
        const valReq = parseFloat(lot.total_value || 0) * proportionReq;
        const valRem = parseFloat(lot.total_value || 0) * proportionRem;

        const upQ = lot.unit === 'CT' ? lot.qty : remaining;
        const upW = lot.unit === 'CT' ? remaining : lot.weight;
        await client.query(
          `UPDATE inventory
           SET qty = $1, weight = $2, total_value = $3, updated_at = NOW()
           WHERE id = $4`,
          [upQ, upW, valRem, lot.id]
        );

        const { rows: [opSeq] } = await client.query("SELECT nextval('lot_op_id_seq')");
        const newLotCode = `${lot.lot_code || lot.lot_number}-ST${opSeq.nextval}`;

        const nQ = lot.unit === 'CT' ? lot.qty : requestedQty;
        const nW = lot.unit === 'CT' ? requestedQty : lot.weight;
        const { rows: [newLot] } = await client.query(
          `INSERT INTO inventory
             (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
              location_id, department_id, vendor_id, purchase_date,
              status, source_type,
              lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
              lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IN STOCK','transfer',
                   $14,$15,$16,'split',$17,$18,$19,$20,$21,$22,$23,'Stock Transfer')
           RETURNING id`,
          [
            lot.item_id, newLotCode, newLotCode, lot.batch_no,
            nQ, lot.unit, nW, lot.rate, valReq,
            destination_location_id, lot.department_id, lot.vendor_id, lot.purchase_date,
            newLotCode, lot.id, lot.root_lot_id || lot.id,
            (lot.split_level || 0) + 1,
            (lot.genealogy_path || String(lot.id)) + '->' + newLotCode,
            opSeq.nextval,
            lot.dim_length, lot.dim_depth, lot.dim_height, lot.dim_unit
          ]
        );
        destLotId = newLot.id;
      } else {
        await client.query(
          `UPDATE inventory SET location_id = $1, department_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [destination_location_id, destination_department_id, lot.id]
        );
      }

      await client.query(
        `INSERT INTO lot_movement_parents (movement_id, parent_lot_id, quantity_consumed, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, lot.id, requestedQty, lot.rate]
      );

      await client.query(
        `INSERT INTO lot_movement_children (movement_id, child_lot_id, quantity, cost_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [mv.id, destLotId, requestedQty, lot.rate]
      );
    }

    await client.query('COMMIT');

    // Real-Time Sync Engine: Emit event
    dispatchEvent('inventory.updated', { module: 'Inventory', action: 'StockTransferred', lots: lot_ids }, 'room:inventory').catch(e => logger.error('dispatchEvent failed', { error: e.message, stack: e.stack }));

    res.status(201).json({
      transfer_number: transferNumber,
      lots_transferred: lots.length,
      source: srcLoc.name,
      destination: destLoc.name,
      lot_ids,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.pageSize) || 50, 1), 500);
    const offset = (page - 1) * limit;

    // Phase A: these rows come from lot_movements, which stores no source or
    // destination department. Authorise relationally through the linked
    // inventory lots and fail closed when nothing can be proven.
    const scope = await loadDeptScope(req.user.id, req.user.role);
    if (scope.isNone) return res.json({ data: [], total: 0 });

    const { clause: scopeClause, params: scopedParams } =
      buildMovementScopeClause(scope, [], 'lm');

    const countR = await pool.query(
      `SELECT COUNT(*) FROM lot_movements lm
       WHERE lm.movement_type = 'transfer'${scopeClause}`,
      scopedParams
    );

    const dataParams = [...scopedParams, limit, offset];
    const { rows } = await pool.query(
      `SELECT lm.*,
              (SELECT name FROM locations WHERE id = ANY(
                ARRAY(SELECT DISTINCT inv.location_id
                      FROM lot_movement_children lmc
                      JOIN inventory inv ON inv.id = lmc.child_lot_id
                      WHERE lmc.movement_id = lm.id)
              )) as destination_name
       FROM lot_movements lm
       WHERE lm.movement_type = 'transfer'${scopeClause}
       ORDER BY lm.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    res.json({ data: rows, total: parseInt(countR.rows[0].count) });
  } catch (err) { logger.error('[stockTransfer] GET / error', { path: req.path, error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

router.get('/history', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 50, search } = req.query;
    const limit = Math.min(parseInt(pageSize) || 50, 500);
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    // Phase A: relational department scope. lot_movements has no source or
    // destination department column, so authorisation is proven only through
    // the linked inventory lots — never by parsing lm.notes.
    const scope = await loadDeptScope(req.user.id, req.user.role);
    if (scope.isNone) {
      return res.json({ data: [], total: 0, page: parseInt(page), pageSize: limit });
    }

    let where = "WHERE lm.movement_type = 'transfer'";
    const params = [];
    let idx = 0;

    if (search) {
      idx++;
      where += ` AND (lm.movement_number ILIKE $${idx} OR i.name ILIKE $${idx} OR i.code ILIKE $${idx} OR inv.lot_code ILIKE $${idx})`;
      params.push(`%${search}%`);
    }

    const { clause: scopeClause, params: scopedParams } =
      buildMovementScopeClause(scope, params, 'lm');
    where += scopeClause;
    params.length = 0;
    params.push(...scopedParams);
    idx = params.length;

    const countSql = `SELECT COUNT(*) FROM lot_movements lm
      JOIN lot_movement_parents lmp ON lmp.movement_id = lm.id
      JOIN inventory inv ON inv.id = lmp.parent_lot_id
      JOIN items i ON i.id = inv.item_id ${where}`;
    const countR = await pool.query(countSql, params);

    idx++;
    const limitP = idx;
    idx++;
    const offsetP = idx;

    const dataSql = `
      SELECT
        lm.id,
        lm.movement_number AS transfer_id,
        lm.movement_date,
        lm.created_at,
        lm.notes AS remarks,
        inv.lot_code AS material_code,
        inv.lot_number,
        i.code AS item_code,
        i.name AS material_name,
        i.category,
        lmp.quantity_consumed AS qty,
        lmp.unit,
        lmp.cost_per_unit,
        -- Phase A: source is NOT derived from lm.notes. lot_movements stores
        -- no source department, so it is reported as unknown rather than
        -- guessed. A real source column arrives in Phase D.
        NULL::text AS source_warehouse,
        dst_loc.name AS destination_warehouse,
        u.full_name AS requested_by
      FROM lot_movements lm
      JOIN lot_movement_parents lmp ON lmp.movement_id = lm.id
      JOIN inventory inv ON inv.id = lmp.parent_lot_id
      JOIN items i ON i.id = inv.item_id
      LEFT JOIN locations dst_loc ON dst_loc.id = inv.location_id
      LEFT JOIN users u ON u.id = lm.created_by
      ${where}
      ORDER BY lm.created_at DESC
      LIMIT $${limitP} OFFSET $${offsetP}
    `;

    params.push(limit, offset);
    const { rows } = await pool.query(dataSql, params);

    res.json({
      data: rows.map(r => ({
        ...r,
        source_warehouse: r.source_warehouse || '—',
        destination_warehouse: r.destination_warehouse || '—',
        qty: parseFloat(r.qty || 0),
      })),
      total: parseInt(countR.rows[0].count),
      page: parseInt(page),
      pageSize: limit,
    });
  } catch (err) { logger.error('[stockTransfer] /history error', { path: req.path, error: err.message, stack: err.stack }); res.status(500).json({ error: err.message }); }
});

// ── EXPORT / PRINT (Phase A — server-authorised) ─────────────────────────────
// The browser must not build CSV or print output from rows it already holds,
// because that bypasses the EXPORT/PRINT permission bits. Both formats are
// produced here, behind the effective Phase 86 permission check, from the
// SAME scoped query that backs the list — so totals always reconcile.

const EXPORT_HEADERS = Object.freeze([
  'Transfer ID', 'Material Code', 'Material Name',
  'Transfer Qty', 'Unit', 'From Department', 'To Department',
  'Status', 'Transfer Date', 'Approved By', 'Approve Date',
]);

const asDate = v => (v ? new Date(v).toLocaleDateString('en-IN') : '');

function transferToRow(t) {
  const lots = t.lots || [];
  return [
    t.transfer_id || '',
    lots.length === 1 ? (lots[0].lot_code || lots[0].lot_number || '') : `${lots.length} lots`,
    lots.map(l => l.item_name).filter(Boolean).join('; '),
    String(lots.reduce((s, l) => s + parseFloat(l.transfer_qty || 0), 0)),
    lots[0]?.unit || '',
    t.source_location_name || '',
    t.destination_location_name || '',
    t.status || '',
    asDate(t.created_at),
    t.approved_by_name || '',
    asDate(t.approved_at),
  ];
}

router.get('/export', authenticate, async (req, res) => {
  try {
    const format = req.query.format === 'print' ? 'print' : 'csv';
    const action = format === 'print' ? 'print' : 'export';

    const allowed = await hasPermission(
      req.user.id, 'inventory', action, 'stock_transfer', req.user.role
    );
    if (!allowed) {
      return res.status(403).json({ error: `Permission denied: ${action} not allowed` });
    }

    const scope = await getTransferDeptScope(req.user.id, req.user.role);
    const rows = (await queryScopedTransfers(scope, req.query.status))
      .map(transferToRow);

    res.json({
      title: 'Stock Transfers',
      subtitle: `${rows.length} records · ${new Date().toLocaleString('en-IN')}`,
      filename: `stock-transfers-${new Date().toISOString().split('T')[0]}.csv`,
      headers: EXPORT_HEADERS,
      rows,
    });
  } catch (err) {
    logger.error('[stockTransfer] /export error', { path: req.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

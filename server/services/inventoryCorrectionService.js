/**
 * Inventory Correction Service — Stage 1 (Growth Diamond final weight).
 *
 * A typing error in a Growth Diamond's final weight must not spawn a
 * replacement lot, repeat a Process Return, or reverse manufacturing history.
 * It corrects the ONE authoritative column, in place, under an immutable audit
 * record.
 *
 * Why inventory.weight alone is sufficient (verified against the live schema):
 *   lot_process_issues carries issued_qty / remaining_in_process and NO weight
 *   column of any kind, and the Process Return writes no lot_movement for the
 *   Growth Diamond. There is therefore no second stored copy of the output
 *   weight that could fall out of step.
 *
 * Lineage repair is deliberately NOT performed here. The audit proved the
 * missing root_lot_id / genealogy_path / split_level / lot_code defect is
 * SYSTEMIC (7 rows across 4 creation paths, most recent 2026-08-04), so it
 * belongs in a separate guarded remediation plus a write-path fix — not
 * smuggled into a single-row correction.
 */

'use strict';

const pool = require('../db/pool');
const { isLotInScope } = require('./inventoryAuth');
const { hasPermission } = require('../utils/permissions');

const CORRECTABLE_CATEGORY = 'growth_diamond';
const CORRECTABLE_STATUS   = 'IN STOCK';
const MIN_REASON_LENGTH    = 5;
/** Movements that consume their parent. A plain transfer does not. */
const CONSUMING_MOVEMENTS  = ['mix', 'split'];

const AUDIT_ACTION = 'inventory_weight_correction';

/** Typed failure so the route maps cause → HTTP status without string matching. */
class CorrectionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The ONE audit writer for corrections.
 *
 * Deliberately NOT middleware/auditLog: that export is Express middleware
 * (req, res, next). Callers passing (pool, userId, action, …) make it execute
 * `return next()` against a string and throw `next is not a function` — which
 * is why audit_logs contains zero copy_user_setup rows. This is a plain
 * parameterized insert matching the real audit_logs columns.
 */
async function writeCorrectionAudit(client, {
  userId, recordId, oldValues, newValues, ip, userAgent, statusCode = 200,
}) {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, old_values, new_values,
        ip_address, user_agent, duration_ms, status_code)
     VALUES ($1,$2,'inventory',$3,$4,$5,$6,$7,0,$8)`,
    [
      userId || null,
      AUDIT_ACTION,
      recordId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      ip || null,
      userAgent || null,
      statusCode,
    ]
  );
}

function parseWeight(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Compare at the column's stored scale (NUMERIC(_,4)) to avoid float noise. */
function sameWeight(a, b) {
  return Math.round(Number(a) * 10000) === Math.round(Number(b) * 10000);
}

/**
 * Correct a Growth Diamond's final weight in place.
 *
 * @param {object} ctx  { userId, userRole, inventoryAuth, ip, userAgent }
 * @param {number} inventoryId
 * @param {object} body { expected_old_weight, new_weight, reason }
 */
async function correctGrowthDiamondWeight(ctx, inventoryId, body = {}) {
  const { expected_old_weight, new_weight, reason } = body;

  // ── Input validation (cheap, before any lock) ─────────────────────────────
  const newWeight = parseWeight(new_weight);
  if (newWeight === null || newWeight <= 0) {
    throw new CorrectionError(400, 'Corrected weight must be a positive number.');
  }
  const expectedOld = parseWeight(expected_old_weight);
  if (expectedOld === null) {
    throw new CorrectionError(400, 'expected_old_weight is required.');
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < MIN_REASON_LENGTH) {
    throw new CorrectionError(400,
      `A meaningful reason is required (at least ${MIN_REASON_LENGTH} characters).`);
  }

  // ── Permission: a DEDICATED capability. Ordinary inventory view/edit must
  //    never confer correction authority, so this is its own submodule. ──────
  const allowed = await hasPermission(
    ctx.userId, 'inventory', 'edit', 'inventory_correction', ctx.userRole
  );
  if (!allowed) {
    throw new CorrectionError(403, 'Permission denied: weight correction not allowed.');
  }

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // ── Lock the row for the whole check-then-write window ──────────────────
    const { rows: [lot] } = await client.query(
      `SELECT inv.*, i.category
         FROM inventory inv JOIN items i ON i.id = inv.item_id
        WHERE inv.id = $1
        FOR UPDATE OF inv`,
      [inventoryId]
    );

    // Out of scope is reported as "not found" — never confirm existence.
    if (!lot || !isLotInScope(ctx.inventoryAuth, lot)) {
      throw new CorrectionError(404, 'Lot not found.');
    }

    // ── Eligibility ─────────────────────────────────────────────────────────
    if (lot.category !== CORRECTABLE_CATEGORY) {
      throw new CorrectionError(409,
        `Only Growth Diamond lots can be weight-corrected in Stage 1 (this lot is "${lot.category}").`);
    }
    // IN STOCK simultaneously excludes SOLD, DELIVERED, CONSUMED, ARCHIVED and
    // IN PROCESS — one authoritative check rather than a list that can drift.
    if (lot.status !== CORRECTABLE_STATUS) {
      throw new CorrectionError(409,
        `Lot status is "${lot.status}" — only ${CORRECTABLE_STATUS} lots can be corrected.`);
    }
    if (!(Number(lot.qty) > 0)) {
      throw new CorrectionError(409, 'Lot has no remaining quantity.');
    }

    const { rows: children } = await client.query(
      'SELECT id FROM inventory WHERE parent_lot_id = $1 LIMIT 5', [inventoryId]);
    if (children.length) {
      throw new CorrectionError(409,
        `Lot has descendant inventory (${children.map(c => c.id).join(', ')}) — ` +
        'correct the descendant instead.');
    }

    const { rows: openIssues } = await client.query(
      `SELECT id, issue_number FROM lot_process_issues
        WHERE (source_lot_id = $1 OR process_lot_id = $1) AND status = 'OPEN' LIMIT 5`,
      [inventoryId]);
    if (openIssues.length) {
      throw new CorrectionError(409,
        `Lot is in an open process (${openIssues.map(i => i.issue_number).join(', ')}).`);
    }

    const { rows: consumed } = await client.query(
      `SELECT lm.movement_number FROM lot_movement_parents lmp
         JOIN lot_movements lm ON lm.id = lmp.movement_id
        WHERE lmp.parent_lot_id = $1 AND lm.movement_type::text = ANY($2) LIMIT 5`,
      [inventoryId, CONSUMING_MOVEMENTS]);
    if (consumed.length) {
      throw new CorrectionError(409,
        `Lot was consumed by ${consumed.map(m => m.movement_number).join(', ')} — ` +
        'correct the resulting lot instead.');
    }

    // Stage 1 deliberately refuses anything with a value to restate. A
    // corrected weight on a rated lot changes valuation, and there is no
    // verified costing rule to apply yet — so it escalates rather than guesses.
    if (Number(lot.rate) !== 0 || Number(lot.total_value) !== 0) {
      throw new CorrectionError(409,
        'Lot carries a rate or value — valuation impact cannot be recalculated ' +
        'safely in Stage 1. Escalate for a controlled reversal.');
    }

    // ── Optimistic concurrency: refuse to overwrite a parallel correction ───
    if (!sameWeight(lot.weight, expectedOld)) {
      throw new CorrectionError(409,
        `Weight has changed since it was read (now ${Number(lot.weight).toFixed(4)}, ` +
        `expected ${expectedOld.toFixed(4)}). Reload and try again.`);
    }
    if (sameWeight(lot.weight, newWeight)) {
      throw new CorrectionError(400, 'Corrected weight is identical to the current weight.');
    }

    // ── The correction: ONE column. Nothing else. ───────────────────────────
    const oldWeight = Number(lot.weight);
    await client.query(
      'UPDATE inventory SET weight = $1, updated_at = NOW() WHERE id = $2',
      [newWeight, inventoryId]
    );

    const variance = Math.round((newWeight - oldWeight) * 10000) / 10000;

    await writeCorrectionAudit(client, {
      userId: ctx.userId,
      recordId: inventoryId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      oldValues: {
        inventory_id: inventoryId,
        lot_name: lot.lot_code || lot.lot_number,
        category: lot.category,
        parent_lot_id: lot.parent_lot_id,
        weight: oldWeight,
        qty: Number(lot.qty),
        status: lot.status,
        rate: Number(lot.rate),
        total_value: Number(lot.total_value),
      },
      newValues: {
        inventory_id: inventoryId,
        field: 'weight',
        weight: newWeight,
        variance,
        reason: cleanReason,
        corrected_by: ctx.userId,
        lineage_repaired: false,
        lineage_note: 'Systemic lineage defect — remediated separately, not here.',
      },
    });

    await client.query('COMMIT');

    return {
      success: true,
      inventory_id: inventoryId,
      lot_name: lot.lot_code || lot.lot_number,
      old_weight: oldWeight,
      new_weight: newWeight,
      variance,
      reason: cleanReason,
      lineage_repaired: false,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Read-only correction history for one lot, from audit_logs. */
async function getWeightCorrectionHistory(ctx, inventoryId) {
  const canView = await hasPermission(
    ctx.userId, 'inventory', 'view', 'inventory_correction', ctx.userRole
  );
  if (!canView) throw new CorrectionError(403, 'Permission denied.');

  const { rows: [lot] } = await pool.query(
    'SELECT id, department_id FROM inventory WHERE id = $1', [inventoryId]);
  if (!lot || !isLotInScope(ctx.inventoryAuth, lot)) {
    throw new CorrectionError(404, 'Lot not found.');
  }

  // Only this action — never mixed with unrelated audit traffic.
  const { rows } = await pool.query(
    `SELECT a.id, a.timestamp, a.user_id, a.old_values, a.new_values, u.full_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action = $1 AND a.table_name = 'inventory' AND a.record_id = $2
      ORDER BY a.timestamp DESC`,
    [AUDIT_ACTION, inventoryId]
  );

  const safeParse = v => { try { return JSON.parse(v); } catch { return null; } };

  return {
    data: rows.map(r => {
      const o = safeParse(r.old_values) || {};
      const n = safeParse(r.new_values) || {};
      return {
        audit_id: r.id,
        corrected_at: r.timestamp,
        corrected_by: r.full_name || r.user_id,
        previous_weight: o.weight ?? null,
        corrected_weight: n.weight ?? null,
        variance: n.variance ?? null,
        reason: n.reason ?? null,
      };
    }),
  };
}

module.exports = {
  AUDIT_ACTION,
  CorrectionError,
  correctGrowthDiamondWeight,
  getWeightCorrectionHistory,
  writeCorrectionAudit,
};

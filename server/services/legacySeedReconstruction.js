// ============================================================================
// Legacy Seed Reconstruction — the EXCEPTIONAL Seed Remove repair branch.
//
// When a historical Growth Run reaches Seed Remove without a resolvable
// attached Seed (pre-Phase-A data, legacy Control Tower completions), the
// canonical resolver in routes/lotProcessIssues.js finds zero candidates and
// the Return Plan REJECTs with legacyResolutionRequired. This service is the
// ONLY path that may then reconstruct the missing intermediate attached Seed:
//
//   Historical Root Seed  (NEVER mutated — read/locked only)
//        ↓
//   NEW reconstructed intermediate Seed  (ATTACHED_TO_GROWTH / IN PROCESS)
//        ↓
//   Canonical Seed Remove (same transaction — detach/release or child split)
//
// Hard rules enforced here:
//   · Super Admin only (canonical identity — utils/permissions.js semantics).
//   · The historical root Seed row is never written.
//   · Quantity comes from the LOCKED issue (remaining_in_process), never from
//     operator input.
//   · Inventory value comes from an authoritative resolver; operator-supplied
//     currency is NEVER stored as financial truth (recorded as a claim in the
//     audit only). Unresolved value fails closed (LEGACY_SEED_VALUE_UNRESOLVED).
//   · At most ONE reconstructed Seed per Process Issue — guarded by the issue
//     row lock (taken by the caller), an explicit pre-check, and the partial
//     unique index on inventory.reconstructed_for_issue_id (phase89).
//   · Durable audit (lot_op_log) is written on the SAME transaction client —
//     audit failure rolls back the reconstruction.
//
// The caller (POST /:id/return) MUST hold:
//   1. the lot_process_issues row lock (FOR UPDATE),
//   2. the process-lot (Growth carrier) row lock.
// This service then locks, in order: existing-reconstruction candidates,
// the root Seed row. Deterministic order: issue → process lot → attached-seed
// candidates → reconstruction candidate → root Seed.
// ============================================================================

'use strict';

const { nextSiblingCode, nextLotOpId } = require('./seedLotCodeService');

// Canonical Super Admin identity — EXACTLY the normalization used by
// utils/permissions.js resolveEffectivePermission. Plain 'admin' is NOT
// Super Admin anywhere in the canonical security model.
const SUPER_ADMIN_ROLES = Object.freeze(['super_admin', 'superadmin', 'super admin']);

function isCanonicalSuperAdmin(role) {
  return SUPER_ADMIN_ROLES.includes(String(role || '').toLowerCase().trim());
}

// Stable business error with an HTTP status + machine-readable code; the
// return route maps err.statusCode/err.code onto the JSON error envelope.
function legacyError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const EPS = 0.0001;

// Root Seeds in these states can never legitimately source a reconstruction.
// CONSUMED is deliberately allowed: a historical root that was fully split is
// CONSUMED yet remains the authoritative genealogy/valuation anchor.
const ROOT_BLOCKED_STATUSES = Object.freeze(['SOLD', 'DISPOSED', 'ARCHIVED', 'DAMAGED']);

/**
 * Growth-issue evidence for this Growth Run — the SAME relational chain the
 * canonical attached-Seed resolver walks (growth_run_cycles + op-log growth
 * references → RETURNED growth issues), but WITHOUT the physical-state filter,
 * so it also surfaces original Seed lots that still exist in a wrong state.
 */
async function findGrowthIssueEvidence(db, growthRunId) {
  const { rows } = await db.query(
    `SELECT gi.id AS issue_id, gi.issue_number, gi.issued_qty, gi.process_lot_id,
            s.id AS lot_id, s.lot_code AS lot_code, s.lot_number AS lot_number,
            s.status AS lot_status, s.manufacturing_state AS lot_manufacturing_state,
            s.total_value AS lot_total_value, s.qty AS lot_qty,
            i.category AS item_category
     FROM lot_process_issues gi
     LEFT JOIN inventory s ON s.id = gi.process_lot_id
     LEFT JOIN items i ON i.id = s.item_id
     WHERE gi.status = 'RETURNED'
       AND gi.machine_process_id IN (
         SELECT grc.machine_process_id FROM growth_run_cycles grc
         WHERE grc.growth_run_id = $1 AND grc.machine_process_id IS NOT NULL
         UNION
         SELECT ol.reference_id FROM lot_op_log ol
         WHERE ol.lot_id = $1 AND ol.reference_type = 'machine_process'
           AND ol.operation IN ('growth_run_created','growth_again')
       )
     ORDER BY gi.id`,
    [growthRunId]
  );
  return rows;
}

/**
 * Resolve the root Seed candidate by inventory id or EXACT lot code/number
 * (case-insensitive equality — never a substring match). Joined with items so
 * category is validated at the source. forUpdate locks the row (read lock for
 * nextSiblingCode safety — the row itself is never written).
 */
async function resolveRootSeed(db, rootRef, { forUpdate = false } = {}) {
  if (rootRef === undefined || rootRef === null || rootRef === '') return null;
  const lock = forUpdate ? 'FOR UPDATE OF inv' : '';
  const asId = Number(rootRef);
  if (Number.isInteger(asId) && asId > 0 && String(rootRef).trim() === String(asId)) {
    const { rows } = await db.query(
      `SELECT inv.*, i.category AS item_category, i.name AS item_name
       FROM inventory inv JOIN items i ON i.id = inv.item_id
       WHERE inv.id = $1 ${lock}`,
      [asId]
    );
    return rows[0] || null;
  }
  const code = String(rootRef).trim();
  const { rows } = await db.query(
    `SELECT inv.*, i.category AS item_category, i.name AS item_name
     FROM inventory inv JOIN items i ON i.id = inv.item_id
     WHERE LOWER(inv.lot_code) = LOWER($1) OR LOWER(inv.lot_number) = LOWER($1)
     ORDER BY inv.id ${lock}`,
    [code]
  );
  if (rows.length > 1) {
    throw legacyError(409, 'LEGACY_SEED_ROOT_AMBIGUOUS',
      `Root Seed reference '${code}' matches ${rows.length} inventory rows — supply the exact inventory id.`);
  }
  return rows[0] || null;
}

/**
 * Authoritative Seed value resolution (value-provenance audit result).
 *
 * Sources considered, in evidence order:
 *   1. ATTACHED_SEED_HISTORY — the original attached-Seed inventory row (via
 *      the growth-issue chain). When such a row still EXISTS the correct
 *      repair is state reconciliation of THAT row, not a duplicate identity,
 *      so reconstruction fails closed instead of using it as a value source.
 *   2. ROOT_SEED_VALUATION — the root Seed's carrying rate × the authoritative
 *      quantity. This is EXACTLY how the canonical issue writer priced every
 *      attached Seed it ever created (routes/lotProcessIssues.js: childValue =
 *      qty × lot.rate, rate = lot.rate), so it reproduces the canonical
 *      valuation the missing row would have carried.
 *   3. Nothing else — lot_process_issues carries no value snapshot and there
 *      is no separate valuation pool for Seeds; if the root rate is absent or
 *      zero the value is UNRESOLVED and reconstruction is blocked.
 */
function resolveLegacySeedValue({ rootSeed, qty }) {
  const rate = rootSeed ? parseFloat(rootSeed.rate || 0) : 0;
  if (!(qty > 0) || !(rate > 0)) {
    return {
      resolved: false,
      value: null,
      rate: null,
      sourceType: null,
      sourceId: null,
      explanation: 'No authoritative valuation evidence: the root Seed carries no positive rate ' +
        'and no historical attached-Seed value snapshot exists for this operation.',
    };
  }
  return {
    resolved: true,
    value: Math.round(qty * rate * 100) / 100,
    rate,
    sourceType: 'ROOT_SEED_VALUATION',
    sourceId: rootSeed.id,
    explanation: `Canonical issue-writer pricing: ${qty} PCS × root Seed ` +
      `${rootSeed.lot_code || rootSeed.lot_number} rate ${rate} (inventory #${rootSeed.id}).`,
  };
}

/**
 * Read-only preview for the client. NO locks, NO writes — safe on the
 * /return/validate preflight. Returns the same provenance shape the posting
 * path enforces, so the UI can show the resolved value + source, or an
 * honest "Unresolved / BLOCKED" state.
 */
async function previewLegacySeedReconstruction({ db, processLot, rootRef, currentRemaining }) {
  const preview = {
    authoritative_qty: currentRemaining,
    seed_reference_weight: null,          // honest: UNRESOLVED for legacy rows
    root: null,
    value_resolution: {
      resolved: false, value: null, rate: null,
      sourceType: null, sourceId: null,
      explanation: 'Root Seed not identified yet.',
    },
    blockers: [],
  };

  try {
    const evidence = await findGrowthIssueEvidence(db, processLot.id);
    const existingLots = evidence.filter(e => e.lot_id != null);
    if (existingLots.length > 0) {
      preview.blockers.push({
        code: 'LEGACY_SEED_ORIGINAL_ROW_EXISTS',
        message: `Original attached-Seed row(s) still exist (${existingLots
          .map(e => e.lot_code || e.lot_number).join(', ')}) — reconcile their state instead of reconstructing.`,
      });
    }
    for (const e of evidence) {
      if (Math.abs(parseFloat(e.issued_qty) - currentRemaining) > EPS) {
        preview.blockers.push({
          code: 'LEGACY_SEED_QTY_MISMATCH',
          message: `Growth issue ${e.issue_number} issued ${e.issued_qty} but ${currentRemaining} is in process.`,
        });
      }
    }

    const root = await resolveRootSeed(db, rootRef);
    if (!root) {
      preview.blockers.push({ code: 'LEGACY_SEED_ROOT_NOT_FOUND', message: 'Root Seed lot not found.' });
      return preview;
    }
    preview.root = {
      id: root.id, lot_code: root.lot_code || root.lot_number, status: root.status,
      item_id: root.item_id, item_category: root.item_category,
      dim_length: root.dim_length, dim_depth: root.dim_depth,
      dim_height: root.dim_height, dim_unit: root.dim_unit,
    };
    if (root.item_category !== 'seed') {
      preview.blockers.push({
        code: 'LEGACY_SEED_ROOT_INVALID',
        message: `Root candidate ${root.lot_code || root.lot_number} is '${root.item_category}', not a Seed.`,
      });
      return preview;
    }
    if (ROOT_BLOCKED_STATUSES.includes(root.status)) {
      preview.blockers.push({
        code: 'LEGACY_SEED_ROOT_INVALID',
        message: `Root Seed ${root.lot_code || root.lot_number} is ${root.status} and cannot anchor a reconstruction.`,
      });
      return preview;
    }
    preview.value_resolution = resolveLegacySeedValue({ rootSeed: root, qty: currentRemaining });
    if (!preview.value_resolution.resolved) {
      preview.blockers.push({
        code: 'LEGACY_SEED_VALUE_UNRESOLVED',
        message: 'Seed value cannot be reconstructed from authoritative historical data. ' +
          'Resolve valuation before completing Seed Remove.',
      });
    }
  } catch (err) {
    if (err.code && err.statusCode) {
      preview.blockers.push({ code: err.code, message: err.message });
    } else {
      throw err;
    }
  }
  return preview;
}

/**
 * The exceptional legacy reconstruction. MUST run on the posting transaction
 * client, after the issue row and process-lot row are locked and after the
 * canonical attached-Seed resolver returned ZERO candidates.
 *
 * Returns { attachedSeedCtx, reconstructedSeed, valueResolution }.
 * Throws typed business errors (statusCode/code) — never writes on failure.
 */
async function resolveOrReconstructLegacyAttachedSeed({
  client, issue, processLot, currentRemaining, override, actor,
  seedLineWeight = null, correlationId = null,
}) {
  // ── 1. Authorization: canonical Super Admin ONLY. Route-level authorize()
  //      already ran; this branch additionally requires Super Admin identity.
  //      Super Admin authorizes the exceptional repair — none of the integrity
  //      gates below are skippable for any role.
  if (!actor || !isCanonicalSuperAdmin(actor.role)) {
    throw legacyError(403, 'LEGACY_SEED_SUPER_ADMIN_REQUIRED',
      'Legacy Seed reconstruction requires the Super Admin identity.');
  }

  const overrideReason = override && override.override_reason != null
    ? String(override.override_reason).trim() : '';
  if (!overrideReason) {
    throw legacyError(422, 'LEGACY_SEED_REASON_REQUIRED',
      'Override reason is required for legacy Seed reconstruction.');
  }

  // ── 2. Business-state validation under the caller-held issue lock.
  if (issue.status !== 'OPEN') {
    throw legacyError(409, 'LEGACY_SEED_ALREADY_PROCESSED',
      `Issue ${issue.issue_number} is already ${issue.status}.`);
  }
  if (!(currentRemaining > 0)) {
    throw legacyError(409, 'LEGACY_SEED_QTY_UNRESOLVED',
      'No authoritative in-process quantity remains on this issue.');
  }

  // ── 3. Prior return / prior output — one physical outcome maximum.
  const { rows: priorReturns } = await client.query(
    'SELECT id, return_number FROM lot_process_returns WHERE issue_id = $1 ORDER BY id',
    [issue.id]
  );
  if (priorReturns.length > 0) {
    throw legacyError(409, 'LEGACY_SEED_PRIOR_RETURN_EXISTS',
      `A process return (${priorReturns[0].return_number}) already exists for issue ${issue.issue_number}.`);
  }

  // ── 4. Existing reconstruction for THIS business operation (idempotency
  //      key: the Process Issue). Locked to serialize with any concurrent
  //      classifier. The issue is OPEN with no return, so a committed
  //      reconstruction here means an inconsistent partial state — fail closed.
  const { rows: existingRecon } = await client.query(
    'SELECT * FROM inventory WHERE reconstructed_for_issue_id = $1 FOR UPDATE',
    [issue.id]
  );
  if (existingRecon.length > 0) {
    throw legacyError(409, 'LEGACY_SEED_ALREADY_RECONSTRUCTED',
      `A reconstructed Seed (${existingRecon[0].lot_code || existingRecon[0].lot_number}) already exists ` +
      `for issue ${issue.issue_number} but the issue is still OPEN — reconcile before retrying.`);
  }

  // ── 5. Growth-issue evidence: if the ORIGINAL attached-Seed row still
  //      exists in any state, reconstruction would mint a duplicate identity.
  //      If evidence exists and disagrees on quantity, fail closed.
  let evidence = await findGrowthIssueEvidence(client, processLot.id);
  // Isolate evidence for the Seed. Biscuits (the carrier) are returned to the machine
  // for Growth Again, but they are NOT the attached Seed. We also preserve deleted lots
  // (lot_id == null) because they are the exact missing Seed rows we are looking for.
  evidence = evidence.filter(e => e.item_category === 'seed' || (e.lot_id == null && e.process_lot_id !== processLot.id));
  
  const existingLots = evidence.filter(e => e.lot_id != null);
  if (existingLots.length > 0) {
    // Super Admin with explicit force_existing flag: use the existing seed row
    // directly instead of reconstructing a duplicate. This is the safe path —
    // no new identity is minted; we reconcile the original row.
    if (override && override.force_existing && isCanonicalSuperAdmin(actor.role)) {
      const seedRow = existingLots[0];
      console.log(`[LEGACY-SEED] Super Admin override: using existing seed row ${seedRow.lot_code || seedRow.lot_number} (id=${seedRow.lot_id}) instead of reconstructing.`);
      
      // Return the existing seed as the "reconstructed" seed — the caller
      // will use it identically (subtract value, update status, etc.).
      return {
        reconstructedSeed: {
          id:          seedRow.lot_id,
          lot_code:    seedRow.lot_code,
          lot_number:  seedRow.lot_number,
          qty:         parseFloat(seedRow.lot_qty) || currentRemaining,
          total_value: parseFloat(seedRow.lot_total_value) || 0,
          status:      seedRow.lot_status,
          root_lot_id: seedRow.lot_id,
        },
        attachedSeedCtx: {
          resolved: true,
          candidateCount: existingLots.length,
          rootCount: 1,
          rootLotId: seedRow.lot_id,
          inventoryId: seedRow.lot_id,
          refWeight: parseFloat(seedRow.lot_qty) || currentRemaining,
          refValue: parseFloat(seedRow.lot_total_value) || 0,
          method: 'EXISTING_SEED_SUPERADMIN_OVERRIDE',
          overrideReason: overrideReason,
        },
      };
    }
    throw legacyError(409, 'LEGACY_SEED_ORIGINAL_ROW_EXISTS',
      `Original attached-Seed row(s) still exist for this Growth Run (${existingLots
        .map(e => e.lot_code || e.lot_number).join(', ')}). Reconcile their state — do not reconstruct a duplicate.`);
  }
  for (const e of evidence) {
    if (Math.abs(parseFloat(e.issued_qty) - currentRemaining) > EPS) {
      throw legacyError(409, 'LEGACY_SEED_QTY_MISMATCH',
        `Growth issue ${e.issue_number} issued ${e.issued_qty} PCS but ${currentRemaining} PCS is in process — ` +
        'quantity evidence disagrees; resolve before reconstructing.');
    }
  }

  // ── 6. Root Seed: resolve by exact reference and LOCK it (namespace owner
  //      for sibling-code generation). The row is never written.
  if (!override || override.root_lot_id === undefined || override.root_lot_id === null || override.root_lot_id === '') {
    throw legacyError(422, 'LEGACY_SEED_ROOT_REQUIRED',
      'The historical root Seed lot must be explicitly identified.');
  }
  const rootSeed = await resolveRootSeed(client, override.root_lot_id, { forUpdate: true });
  if (!rootSeed) {
    throw legacyError(422, 'LEGACY_SEED_ROOT_NOT_FOUND',
      `Root Seed '${override.root_lot_id}' was not found in inventory.`);
  }
  if (rootSeed.item_category !== 'seed') {
    throw legacyError(422, 'LEGACY_SEED_ROOT_INVALID',
      `Root candidate ${rootSeed.lot_code || rootSeed.lot_number} is '${rootSeed.item_category}' — ` +
      'only a real Seed lot can anchor a legacy reconstruction.');
  }
  if (ROOT_BLOCKED_STATUSES.includes(rootSeed.status)) {
    throw legacyError(422, 'LEGACY_SEED_ROOT_INVALID',
      `Root Seed ${rootSeed.lot_code || rootSeed.lot_number} is ${rootSeed.status} and cannot anchor a reconstruction.`);
  }
  if (rootSeed.id === processLot.id) {
    throw legacyError(422, 'LEGACY_SEED_ROOT_INVALID',
      'The Growth carrier cannot be its own root Seed.');
  }

  // ── 7. Authoritative quantity: the LOCKED issue's in-process quantity.
  //      Operator confirmation may be supplied but never replaces it.
  const qty = currentRemaining;
  if (override.confirmed_qty !== undefined && override.confirmed_qty !== null && override.confirmed_qty !== '') {
    const confirmed = parseFloat(override.confirmed_qty);
    if (Math.abs(confirmed - qty) > EPS) {
      throw legacyError(409, 'LEGACY_SEED_QTY_MISMATCH',
        `Confirmed quantity ${confirmed} does not match the authoritative in-process quantity ${qty}.`);
    }
  }

  // ── 8. Authoritative value. Operator currency is recorded as a CLAIM in
  //      the audit and never stored on inventory.
  const valueResolution = resolveLegacySeedValue({ rootSeed, qty });
  if (!valueResolution.resolved) {
    throw legacyError(422, 'LEGACY_SEED_VALUE_UNRESOLVED',
      'Seed value cannot be reconstructed from authoritative historical data. ' +
      'Resolve valuation before completing Seed Remove.');
  }
  const operatorClaimedValue =
    override.seed_value !== undefined ? override.seed_value :
    override.override_seed_value !== undefined ? override.override_seed_value : null;

  // ── 9. Physical recovered weight is OUTPUT metadata only: it may
  //      cross-check the seed-family line weight but never becomes the
  //      reference weight of the reconstructed Seed (which stays UNRESOLVED).
  const physicalRecoveredWeight =
    override.physical_recovered_weight_ct !== undefined && override.physical_recovered_weight_ct !== null &&
    override.physical_recovered_weight_ct !== ''
      ? parseFloat(override.physical_recovered_weight_ct)
      : null;
  if (physicalRecoveredWeight != null && seedLineWeight != null &&
      Math.abs(physicalRecoveredWeight - seedLineWeight) > EPS) {
    throw legacyError(422, 'LEGACY_RECOVERED_WEIGHT_MISMATCH',
      `Physical recovered weight ${physicalRecoveredWeight} ct does not match the ` +
      `recovered-Seed line weight ${seedLineWeight} ct.`);
  }

  // ── 10. Canonical child identity under the LOCKED root namespace — the
  //       exact writer semantics of the canonical attached-Seed issue path.
  const rootCode = rootSeed.lot_code || rootSeed.lot_number;
  const rootLevel = parseInt(rootSeed.split_level) || 0;
  const childCode = await nextSiblingCode(client, rootCode, rootLevel, rootSeed.id);
  const { rows: dup } = await client.query(
    'SELECT 1 FROM inventory WHERE lot_code = $1 OR lot_number = $1', [childCode]
  );
  if (dup.length) {
    throw legacyError(409, 'LEGACY_SEED_CODE_CONFLICT',
      `Lot code ${childCode} already exists — retry.`);
  }

  const parentPath = rootSeed.genealogy_path || rootCode;
  const childGenPath = `${parentPath}/${childCode}`;
  const childLotOpId = await nextLotOpId(client);

  let reconstructedSeed;
  try {
    const { rows: [inserted] } = await client.query(
      `INSERT INTO inventory
         (item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value,
          location_id, department_id, vendor_id, purchase_date,
          status, remarks, source_type,
          lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path,
          lot_op_id, dim_length, dim_depth, dim_height, dim_unit,
          source_module, manufacturing_state, reconstructed_for_issue_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               'IN PROCESS',$14,'issue',
               $15,$16,$17,'issue',$18,$19,
               $20,$21,$22,$23,$24,
               'Legacy Seed Reconstruction','ATTACHED_TO_GROWTH',$25)
       RETURNING *`,
      [
        rootSeed.item_id, childCode,
        `${rootSeed.lot_name || rootCode} (in process)`,
        rootSeed.batch_no, qty, rootSeed.unit || 'PCS',
        null, // weight — Seed reference weight is UNRESOLVED, never fabricated
        valueResolution.rate, valueResolution.value,
        rootSeed.location_id, rootSeed.department_id, rootSeed.vendor_id, rootSeed.purchase_date,
        `Legacy reconstruction for ${issue.issue_number}: ${overrideReason}`,
        childCode,
        rootSeed.id,
        rootSeed.root_lot_id || rootSeed.id,
        rootLevel + 1, childGenPath,
        childLotOpId,
        rootSeed.dim_length ?? null, rootSeed.dim_depth ?? null,
        rootSeed.dim_height ?? null, rootSeed.dim_unit ?? null,
        issue.id,
      ]
    );
    reconstructedSeed = inserted;
  } catch (err) {
    // The phase89 partial unique index makes a concurrent duplicate a DB
    // error, and the lot_number unique key backs the namespace — surface both
    // as a stable conflict instead of minting another sibling.
    if (err.code === '23505') {
      throw legacyError(409, 'LEGACY_SEED_ALREADY_RECONSTRUCTED',
        `A reconstructed Seed already exists for issue ${issue.issue_number} (concurrent request).`);
    }
    throw err;
  }

  // ── 11. Durable audit — SAME transaction client; failure rolls everything
  //       back. lot_op_log is the canonical manufacturing audit mechanism.
  const auditPayload = {
    operation: 'LEGACY_ATTACHED_SEED_RECONSTRUCTED',
    actor_id: actor.id,
    actor_role: actor.role,
    process_issue_id: issue.id,
    issue_number: issue.issue_number,
    process_lot_id: processLot.id,
    process_lot_code: processLot.lot_code || processLot.lot_number,
    growth_run: processLot.lot_number,
    run_no: processLot.run_no != null ? parseInt(processLot.run_no) : null,
    machine_process_id: issue.machine_process_id || null,
    root_seed_id: rootSeed.id,
    root_seed_code: rootCode,
    root_seed_status: rootSeed.status,
    reconstructed_seed_id: reconstructedSeed.id,
    reconstructed_seed_code: childCode,
    seed_item_id: rootSeed.item_id,
    qty,
    dimensions: {
      dim_length: rootSeed.dim_length, dim_depth: rootSeed.dim_depth,
      dim_height: rootSeed.dim_height, dim_unit: rootSeed.dim_unit,
      source: 'ROOT_SEED_ROW',
    },
    seed_reference_weight: 'UNRESOLVED',
    physical_recovered_weight_ct: physicalRecoveredWeight,
    seed_line_weight_ct: seedLineWeight,
    resolved_value: valueResolution.value,
    resolved_rate: valueResolution.rate,
    value_source_type: valueResolution.sourceType,
    value_source_id: valueResolution.sourceId,
    value_explanation: valueResolution.explanation,
    operator_claimed_value: operatorClaimedValue,   // claim only — never stored on inventory
    override_reason: overrideReason,
    why: 'Canonical attached-Seed resolution found zero candidates for this Growth Run; ' +
      'Super Admin authorized reconstruction of the missing intermediate Seed.',
    genealogy: {
      parent_lot_id: rootSeed.id,
      root_lot_id: rootSeed.root_lot_id || rootSeed.id,
      genealogy_path: childGenPath,
      split_level: rootLevel + 1,
    },
    correlation_id: correlationId,
  };
  const auditIns = await client.query(
    `INSERT INTO lot_op_log (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      reconstructedSeed.id, 'legacy_seed_reconstructed', 'lot_process_issue', issue.id,
      qty, 'IN PROCESS', JSON.stringify(auditPayload), actor.id,
    ]
  );
  if (!auditIns.rows.length) {
    throw new Error('Legacy reconstruction audit write failed — aborting transaction.');
  }

  return {
    reconstructedSeed,
    valueResolution,
    attachedSeedCtx: {
      resolved: true,
      candidateCount: 1,
      rootCount: 1,
      rootLotId: rootSeed.root_lot_id || rootSeed.id,
      inventoryId: reconstructedSeed.id,
      refWeight: null,                       // Seed reference weight: UNRESOLVED
      refValue: valueResolution.value,       // authoritative — never operator input
      isLegacyOverride: true,
      valueProvenance: {
        source_type: valueResolution.sourceType,
        source_id: valueResolution.sourceId,
        explanation: valueResolution.explanation,
      },
    },
  };
}

module.exports = {
  isCanonicalSuperAdmin,
  resolveLegacySeedValue,
  resolveRootSeed,
  findGrowthIssueEvidence,
  previewLegacySeedReconstruction,
  resolveOrReconstructLegacyAttachedSeed,
  SUPER_ADMIN_ROLES,
  ROOT_BLOCKED_STATUSES,
};

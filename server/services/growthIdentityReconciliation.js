/**
 * Growth-Again identity reconciliation guards — pure JS mirror of the guard
 * logic embedded in migrations/phase70-growth-again-identity-reconciliation.sql
 * (inventory 100594 SSD013-APR26-011 vs duplicate 100867 SSD001-JUL26-055).
 *
 * The SQL script is the production artifact and re-checks every guard itself
 * under FOR UPDATE locks; this module exists so the guard DECISIONS are unit
 * tested (node --test) without a database. Keep both in sync — each guard here
 * carries the same abort message intent as its SQL counterpart.
 *
 * No I/O, no DB, no side effects.
 */

/**
 * Downstream-reference counts of the DUPLICATE identity that must all be zero
 * before it may be neutralized. opLogBeyondCreation excludes the single
 * 'growth_run_created' entry (that entry is expected and retained as history).
 */
const DUPLICATE_REF_KEYS = [
  'issues',              // lot_process_issues.source_lot_id / process_lot_id
  'returnLines',         // process_return_lines.lot_id
  'growthCycles',        // growth_run_cycles.growth_run_id
  'mixComponents',       // lot_mix_components.mixed_lot_id / source_lot_id
  'childLots',           // inventory.parent_lot_id / root_lot_id
  'processLotLinks',     // machine_process_lots.inventory_lot_id
  'opLogBeyondCreation', // lot_op_log beyond the creation entry
];

/**
 * Already reconciled? (idempotency — a second run must be a no-op)
 */
function isAlreadyReconciled({ original, duplicate }) {
  return !!original && !!duplicate
    && duplicate.status === 'CONSUMED'
    && (duplicate.machineProcessId == null)
    && parseFloat(duplicate.qty || 0) === 0
    && parseInt(original.runNo) === 2
    && original.manufacturingState !== 'ATTACHED_TO_GROWTH';
}

/**
 * First violated precondition, or null when reconciliation may proceed.
 * Mirrors phase70 guard order. `ctx`:
 *   original  — { id, category, lotNumber, status, runNo, machineProcessId,
 *                 manufacturingState, qty, weight }
 *   duplicate — { id, category, lotNumber, status, runNo, machineProcessId,
 *                 totalValue, qty }
 *   duplicateRefs — counts per DUPLICATE_REF_KEYS
 *   issueProcessLotId — the growth issue's process_lot_id
 */
function reconciliationBlockReason(ctx) {
  const { original, duplicate, duplicateRefs, issueProcessLotId } = ctx || {};

  if (!original) return 'Original carrier row not found.';
  if (!duplicate) return 'Duplicate Growth Run row not found.';

  if (String(original.category) !== 'growth_diamond')
    return `Original ${original.lotNumber} is '${original.category}' (expected growth_diamond).`;
  if (String(duplicate.category) !== 'growth_run')
    return `Duplicate ${duplicate.lotNumber} is '${duplicate.category}' (expected growth_run).`;

  if (original.status !== 'IN PROCESS')
    return `Original ${original.lotNumber} is ${original.status} (expected IN PROCESS — frozen state changed).`;
  if (duplicate.status !== 'IN PROCESS')
    return `Duplicate ${duplicate.lotNumber} is ${duplicate.status} (expected IN PROCESS — frozen state changed).`;

  if (parseInt(original.runNo) !== 1)
    return `Original run_no is R${original.runNo} (expected R1 — frozen state changed).`;

  if (original.machineProcessId == null
      || duplicate.machineProcessId == null
      || original.machineProcessId !== duplicate.machineProcessId)
    return 'Original and duplicate are not linked to the same machine process.';

  if (issueProcessLotId !== original.id)
    return 'The growth issue does not reference the original carrier as its process lot — manual review required.';

  if (parseFloat(duplicate.totalValue || 0) !== 0)
    return `Duplicate carries a non-zero value (${duplicate.totalValue}) — single-carrying-value assumption broken.`;

  const refs = duplicateRefs || {};
  for (const key of DUPLICATE_REF_KEYS) {
    const n = parseInt(refs[key], 10);
    if (!Number.isFinite(n))
      return `Downstream reference count '${key}' was not measured — aborting.`;
    if (n > 0)
      return `Duplicate has downstream activity (${key}: ${n}) — reconciliation must not proceed.`;
  }

  return null;
}

/**
 * The intended post-reconciliation end state (what phase70 asserts in its
 * postconditions): exactly ONE active physical carrier remains.
 */
function reconciliationEndState({ original, duplicate }) {
  return {
    original: {
      id: original.id,
      status: 'IN PROCESS',            // still in the chamber, awaiting Return
      runNo: 2,                        // the Growth Again that DID happen
      manufacturingState: null,        // wrong ATTACHED_TO_GROWTH cleared
      machineProcessId: original.machineProcessId,
    },
    duplicate: {
      id: duplicate.id,
      status: 'CONSUMED',              // neutralized, never hard-deleted
      manufacturingState: 'RETIRED',
      qty: 0, weight: 0, totalValue: 0,
      machineProcessId: null,          // detached so it can never be resolved
    },                                 // as a biscuit candidate again
    activeCarrierCount: 1,
  };
}

module.exports = {
  DUPLICATE_REF_KEYS,
  isAlreadyReconciled,
  reconciliationBlockReason,
  reconciliationEndState,
};

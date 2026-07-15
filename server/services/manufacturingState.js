/**
 * Seed Lifecycle Phase A — Manufacturing State (two-state architecture).
 *
 * Inventory Status keeps controlling ERP workflow; manufacturing_state
 * describes the PHYSICAL manufacturing condition of a lot. This module is
 * the ONE shared availability rule for attachment — every mutation path
 * (issue, transfer, split, mix) calls attachmentBlockReason instead of
 * duplicating the check. Pure: no I/O, no DB.
 *
 * Legacy rows: manufacturing_state is NULL and MUST be read as AVAILABLE.
 */

const MANUFACTURING_STATES = ['AVAILABLE', 'ATTACHED_TO_GROWTH', 'RECOVERED', 'RETIRED'];
const ATTACHED_TO_GROWTH = 'ATTACHED_TO_GROWTH';

/**
 * @param {{ manufacturing_state?: string|null }|null} row inventory row
 * @returns {string} effective state — NULL/undefined coalesce to AVAILABLE
 */
function effectiveManufacturingState(row) {
  return (row && row.manufacturing_state) || 'AVAILABLE';
}

/**
 * Shared attachment guard. Returns a human-readable block reason when the lot
 * is physically embedded in an active Partial Growth Run, otherwise null.
 * Deploy-safe before phase62: an absent column reads as undefined → AVAILABLE.
 *
 * @param {object|null} row     inventory row (lot_code/lot_number for message)
 * @param {string} [action]     e.g. 'issued to a process', 'transferred', 'split', 'mixed'
 * @returns {string|null}
 */
function attachmentBlockReason(row, action) {
  if (effectiveManufacturingState(row) !== ATTACHED_TO_GROWTH) return null;
  const name = row.lot_code || row.lot_number || `#${row.id}`;
  return (
    `Lot ${name} is ATTACHED_TO_GROWTH — the Seed is physically embedded in an ` +
    `active Partial Growth Run and cannot be ${action || 'used'} until Seed Remove.`
  );
}

module.exports = {
  MANUFACTURING_STATES,
  ATTACHED_TO_GROWTH,
  effectiveManufacturingState,
  attachmentBlockReason,
};

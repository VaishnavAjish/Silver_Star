'use strict';

/**
 * LOT DIMENSIONS — merge rules for lot-combining operations (Mix).
 *
 * Dimensions are INTENSIVE attributes: "12 × 12 × 0.3 mm" describes a single seed
 * plate, not the lot as a whole. Unlike qty / weight / total_value they must never
 * be summed or averaged. A combined lot therefore only carries a dimension when
 * every measured parent already agrees on one.
 *
 * NULL means "not yet measured" — NOT "a different size". It neither blocks a mix
 * nor overwrites a measured value. Treating NULL as a conflict would permanently
 * freeze every legacy lot (and every lot created before this rule existed), since
 * such lots could then never be mixed again.
 */

/** The three physical axes stored on inventory. dim_unit is handled separately. */
const DIM_FIELDS = ['dim_length', 'dim_depth', 'dim_height'];

/**
 * dim_* are NUMERIC(10,3), and node-pg returns NUMERIC as a string ('12.000'),
 * so raw === would report '12.000' !== '12.00'. Compare numerically, below the
 * column's own 3-decimal precision.
 */
const EPSILON = 0.0005;

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function numEq(a, b) {
  return Math.abs(a - b) < EPSILON;
}

function normUnit(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '' ? null : s;
}

/** True when the lot carries at least one measured axis. */
function isMeasured(lot) {
  return DIM_FIELDS.some(field => toNum(lot[field]) !== null);
}

/** "12 × 12 × 0.3 mm" for operator-facing messages; null when wholly unmeasured. */
function formatDimensions(lot) {
  if (!lot || !isMeasured(lot)) return null;
  const axis = (value) => {
    const n = toNum(value);
    return n === null ? '—' : String(n);
  };
  return `${axis(lot.dim_length)} × ${axis(lot.dim_depth)} × ${axis(lot.dim_height)} ${lot.dim_unit || 'mm'}`;
}

/**
 * Resolve the dimensions a mixed child lot should inherit from its parents.
 *
 * Per axis: all measured parents must agree. One distinct value → the child
 * inherits it. Two or more distinct values → conflict. No measured value → null.
 * dim_unit follows the same rule, across parents that are measured at all.
 *
 * @param {Array<Object>} parents inventory rows (dim_* may be strings, per node-pg)
 * @returns {{
 *   dims: { dim_length: number|null, dim_depth: number|null, dim_height: number|null, dim_unit: string|null },
 *   conflict: boolean,
 *   conflictFields: string[],
 *   conflictingLots: Array<{ lot_number: string, dimensions: string|null }>,
 * }}
 */
function resolveMixDimensions(parents) {
  const lots = Array.isArray(parents) ? parents : [];
  const dims = { dim_length: null, dim_depth: null, dim_height: null, dim_unit: null };
  const conflictFields = [];

  for (const field of DIM_FIELDS) {
    const distinct = [];
    for (const lot of lots) {
      const value = toNum(lot[field]);
      if (value === null) continue;
      if (!distinct.some(seen => numEq(seen, value))) distinct.push(value);
    }
    if (distinct.length > 1) conflictFields.push(field);
    else if (distinct.length === 1) dims[field] = distinct[0];
  }

  // Unit is only meaningful on a lot that has actually been measured.
  const distinctUnits = [];
  let firstUnitAsStored = null;
  for (const lot of lots) {
    if (!isMeasured(lot)) continue;
    const unit = normUnit(lot.dim_unit);
    if (unit === null || distinctUnits.includes(unit)) continue;
    distinctUnits.push(unit);
    if (firstUnitAsStored === null) firstUnitAsStored = lot.dim_unit;
  }
  if (distinctUnits.length > 1) conflictFields.push('dim_unit');
  else dims.dim_unit = firstUnitAsStored;

  const conflict = conflictFields.length > 0;

  return {
    dims,
    conflict,
    conflictFields,
    // Only measured lots can be the source of a disagreement, so unmeasured ones
    // stay out of the message the operator has to act on.
    conflictingLots: conflict
      ? lots.filter(isMeasured).map(lot => ({
          lot_number: lot.lot_number,
          dimensions: formatDimensions(lot),
        }))
      : [],
  };
}

/** Operator-facing rejection message naming the lots that disagree. */
function mixDimensionError(resolved) {
  const detail = resolved.conflictingLots
    .map(lot => `${lot.lot_number} (${lot.dimensions})`)
    .join(', ');
  return `Cannot mix lots with different dimensions: ${detail}. `
       + 'All lots in a mix must share the same length, depth, height and unit.';
}

module.exports = {
  DIM_FIELDS,
  resolveMixDimensions,
  mixDimensionError,
  formatDimensions,
};

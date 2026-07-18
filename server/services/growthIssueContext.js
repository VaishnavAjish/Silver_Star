// ============================================================================
// Growth issue display context — pure resolver (no DB, no side effects).
//
// A Growth-Again carrier keeps ONE identity (same inventory row, same lot,
// same permanent Growth Number, Run increments in place). The Process Return
// queue and the Return workspace must therefore resolve Growth Number / Run /
// dimensions in a deterministic source order and never show "—" while the
// carrier row holds the data:
//
//   1. immutable machine-process snapshot — issued qty/weight come from
//      machine_process_lots (*_snapshot columns selected by the routes);
//   2. linked carrier inventory identity — for identity-preserving issues the
//      process lot IS the carrier (growth_run OR growth_diamond), so its
//      lot_number/run_no/dims are authoritative;
//   3. legacy growth-run linkage (inventory row pointing at the same
//      machine_process) as compatibility fallback only.
//
// The legacy linkage alone fails for Growth-Again: a growth_diamond carrier
// never matched the growth_run-only item filter, and the carrier's
// machine_process_id moves on every re-issue — exactly how PI-202607-0385
// rendered "Growth Number: — / Run: — / Dimension: —" while inventory 100594
// held SSD013-APR26-011 / R4 / 12×12×5.74.
// ============================================================================

const { isGrowthCarrierCategory } = require('./growthCarrier');

const present = v => v !== null && v !== undefined && v !== '';
const pick = (primary, fallback) => (present(primary) ? primary : (present(fallback) ? fallback : null));

/**
 * Resolve the growth identity fields for one Process Issue row. Returns a NEW
 * row object (input untouched) whose growth_number / run_no / growth_dim_*
 * follow the deterministic source order above.
 *
 * Expected optional inputs on `row`:
 *   process_lot_category, process_lot_number, process_lot_run_no,
 *   process_lot_dim_length, process_lot_dim_depth, process_lot_dim_height,
 *   process_lot_dim_unit  — the linked carrier (source 2);
 *   growth_number, run_no, growth_dim_*  — the legacy linkage (source 3).
 *
 * @param {object} row
 * @returns {object}
 */
function resolveIssueGrowthContext(row) {
  const carrier = isGrowthCarrierCategory(row.process_lot_category);
  if (!carrier) {
    // Non-carrier issues (seed → growth first cycle, plain lots): the legacy
    // growth-run linkage remains the only growth context; leave the row as-is
    // but normalise absent values to null for a stable contract.
    return {
      ...row,
      growth_number: pick(row.growth_number, null),
      run_no: pick(row.run_no, null),
      growth_identity_source: present(row.growth_number) ? 'growth_run_link' : 'none',
    };
  }
  return {
    ...row,
    growth_number:     pick(row.process_lot_number,     row.growth_number),
    run_no:            pick(row.process_lot_run_no,     row.run_no),
    growth_dim_length: pick(row.process_lot_dim_length, row.growth_dim_length),
    growth_dim_depth:  pick(row.process_lot_dim_depth,  row.growth_dim_depth),
    growth_dim_height: pick(row.process_lot_dim_height, row.growth_dim_height),
    growth_dim_unit:   pick(row.process_lot_dim_unit,   row.growth_dim_unit),
    growth_identity_source: 'carrier',
  };
}

module.exports = { resolveIssueGrowthContext };

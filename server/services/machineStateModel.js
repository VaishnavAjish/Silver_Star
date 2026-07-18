// ============================================================================
// Canonical machine lifecycle classification — ONE source of truth shared by
// the Control Tower card query (/machines) and the KPI counts (/kpi).
//
// Order of precedence (owner-approved state machine):
//   1. maintenance / breakdown / cleaning — protected machine-level overrides;
//   2. active machine_process on hold     → 'hold';
//   3. active machine_process running     → 'running';
//   4. no active process + machine idle   → 'idle' (AVAILABLE);
//   5. anything else                      → 'review' (explicit diagnostic
//      state — e.g. a stale awaiting_output/running machines.status with no
//      active process). Never silently rendered as a false normal state.
//
// 'awaiting_output' is retired as a live lifecycle state: it can only ever
// surface as 'review' until reconciled. READY FOR RETURN is a computed
// presentation badge on top of 'running', never a state.
// ============================================================================

const PROTECTED_OVERRIDES = Object.freeze(['maintenance', 'breakdown', 'cleaning']);
const DERIVED_STATES = Object.freeze(['running', 'hold', 'idle', 'maintenance', 'breakdown', 'cleaning', 'review']);

/**
 * SQL fragment computing the derived lifecycle state. `machineAlias` must be
 * a machines row; `mpAlias` must be the machine's single ACTIVE process row
 * (status IN ('running','hold')) or NULL.
 * @param {string} machineAlias
 * @param {string} mpAlias
 * @returns {string}
 */
function derivedStateSql(machineAlias, mpAlias) {
  return `CASE
    WHEN ${machineAlias}.status::text IN ('maintenance','breakdown','cleaning') THEN ${machineAlias}.status::text
    WHEN ${mpAlias}.status = 'hold' THEN 'hold'
    WHEN ${mpAlias}.status = 'running' THEN 'running'
    WHEN ${mpAlias}.id IS NULL AND ${machineAlias}.status::text = 'idle' THEN 'idle'
    ELSE 'review'
  END`;
}

/**
 * Pure JS mirror of derivedStateSql — same classification, unit-testable.
 * @param {{ machineStatus: string|null|undefined, activeProcessStatus: string|null|undefined }} p
 * @returns {string}
 */
function deriveMachineState({ machineStatus, activeProcessStatus }) {
  const ms = String(machineStatus || '').toLowerCase();
  if (PROTECTED_OVERRIDES.includes(ms)) return ms;
  if (activeProcessStatus === 'hold') return 'hold';
  if (activeProcessStatus === 'running') return 'running';
  if (!activeProcessStatus && ms === 'idle') return 'idle';
  return 'review';
}

module.exports = {
  PROTECTED_OVERRIDES,
  DERIVED_STATES,
  derivedStateSql,
  deriveMachineState,
};

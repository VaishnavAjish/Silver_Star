// ============================================================================
// Completion-engine guard — pure predicates (no DB, no side effects).
//
// The Return Engine is the only completion path for RETURN_BASED processes.
// The legacy PATCH /processes/:id/complete endpoint may only complete a
// process that is explicitly OUTPUT_BASED — and Growth-group processes must
// NEVER use it regardless of stored completion_mode (owner doctrine), so a
// stale OUTPUT_BASED pr-01 row cannot re-open the legacy path.
//
// An unknown / missing completion_mode defaults to RETURN_BASED: an
// unconfigured process must never fall back to legacy direct completion.
// ============================================================================

const RETURN_ENGINE_REQUIRED_MESSAGE =
  'This process must be completed through Process Return.';

/**
 * True when the process may only complete through the Return Engine and the
 * legacy direct-completion endpoint must reject with 409.
 * @param {{ completionMode: string|null|undefined, processGroup: string|null|undefined }} p
 * @returns {boolean}
 */
function requiresReturnEngineCompletion({ completionMode, processGroup }) {
  const mode = String(completionMode || 'RETURN_BASED').toUpperCase();
  const group = String(processGroup || '').toUpperCase();
  return mode !== 'OUTPUT_BASED' || group === 'GROWTH';
}

module.exports = {
  RETURN_ENGINE_REQUIRED_MESSAGE,
  requiresReturnEngineCompletion,
};

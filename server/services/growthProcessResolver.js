// ============================================================================
// Canonical Growth process resolution — pure (no DB, no side effects).
//
// process_master.process_group is the business authority, but legacy rows can
// carry a NULL/blank group. The canonical Growth process code (pr-01, plus the
// original 'growth' code) must still resolve as Growth — the old silent
// fallback `process_type === 'growth'` missed pr-01, which let a Growth
// Diamond carrier reach the generic Return usable-output branch and mint
// '-R1' child lots (SSD027-APR26-033-R1 / SSD047-JUN26-032-R1: new inventory
// id, Run reset to R1, blank Root Lot, original consumed).
//
// Fail-closed contract: when the selected input is an identity-bearing Growth
// carrier and the process cannot be reliably resolved, the transaction must be
// REJECTED — never silently routed to generic output creation.
// ============================================================================

const CANONICAL_GROWTH_PROCESS_CODES = Object.freeze(['pr-01', 'growth']);

const GROWTH_PROCESS_UNRESOLVED_MESSAGE =
  'Growth carrier process classification is unresolved. No lot was created.';

const RETURN_PROCESS_UNRESOLVED_MESSAGE =
  'Return process classification is unresolved. No inventory or process state was changed.';

/**
 * Resolve whether a process is a Growth process from stable Process Master
 * data. Client-provided display strings are never consulted; an explicit
 * process_group always wins over the canonical-code fallback.
 * @param {{ processMasterId?: number|null, processCode?: string|null, processGroup?: string|null }} p
 * @returns {{ isGrowthProcess: boolean, isResolved: boolean,
 *             processMasterId: number|null, processCode: string|null,
 *             processGroup: string|null, resolutionSource: string }}
 */
function resolveGrowthProcessContext({ processMasterId = null, processCode = null, processGroup = null } = {}) {
  const code = String(processCode || '').toLowerCase().trim();
  const group = String(processGroup || '').toUpperCase().trim();

  if (group) {
    return {
      isGrowthProcess: group === 'GROWTH',
      isResolved: true,
      processMasterId: processMasterId ?? null,
      processCode: code || null,
      processGroup: group,
      resolutionSource: 'process_master.process_group',
    };
  }
  if (CANONICAL_GROWTH_PROCESS_CODES.includes(code)) {
    return {
      isGrowthProcess: true,
      isResolved: true,
      processMasterId: processMasterId ?? null,
      processCode: code,
      processGroup: 'GROWTH',
      resolutionSource: 'canonical_process_code',
    };
  }
  return {
    isGrowthProcess: false,
    isResolved: false,
    processMasterId: processMasterId ?? null,
    processCode: code || null,
    processGroup: null,
    resolutionSource: 'unresolved',
  };
}

module.exports = {
  CANONICAL_GROWTH_PROCESS_CODES,
  GROWTH_PROCESS_UNRESOLVED_MESSAGE,
  RETURN_PROCESS_UNRESOLVED_MESSAGE,
  resolveGrowthProcessContext,
};

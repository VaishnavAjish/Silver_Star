/**
 * Action Matrix — single source of truth for which actions a lot permits.
 *
 * Drives action visibility for the Lot Workspace today, and is intentionally
 * decoupled from any UI so it can be reused by:
 *   1. Lot Workspace Actions menu      (Phase 1 — wired now)
 *   2. Future Inventory row menu
 *   3. Future Clipboard actions
 *   4. Future bulk actions             (see getAllowedActionsForSelection)
 *
 * Rules are keyed by (category × status):
 *   - View History and View Lineage are ALWAYS permitted (read-only floor).
 *   - LOW STOCK is treated as an alias of IN STOCK (a quantity flag, not a
 *     workflow state), so it inherits the IN STOCK action set.
 *   - Any category/status not explicitly listed falls back to the read-only
 *     floor (history + lineage only) — a safe default that never exposes a
 *     mutating action by accident.
 *
 * This file contains NO business side effects and performs NO I/O. It only maps
 * a lot's (category, status) to a set of boolean capability flags.
 */

/**
 * Internal capability keys. Each maps 1:1 to a `can*` flag returned to callers.
 * Using constants (not bare strings) avoids silent typos in the matrix below.
 */
export const CAPABILITY = {
  VIEW_HISTORY:        'viewHistory',
  VIEW_LINEAGE:        'viewLineage',
  TRANSFER:            'transfer',
  ISSUE_PROCESS:       'issueProcess',
  SPLIT:               'split',
  MIX:                 'mix',
  GROWTH_AGAIN:        'growthAgain',
  GROWTH_OUTPUT:       'growthOutput',
  COMPLETE_GROWTH_RUN: 'completeGrowthRun',
  RETURN:              'return',  // Navigate directly to LotReturnPage for IN PROCESS lots
};

/** Inventory categories recognised by the matrix. */
export const CATEGORY = {
  SEED:       'seed',
  GROWTH_RUN: 'growth_run',
  ROUGH:      'rough',
  GAS:        'gas',
  CONSUMABLE: 'consumable',
};

/** LOW STOCK behaves exactly like IN STOCK (quantity flag, not a workflow state). */
const STATUS_ALIASES = {
  'LOW STOCK': 'IN STOCK',
};

/** Read-only capabilities granted to every lot, including unknown combinations. */
const ALWAYS = [CAPABILITY.VIEW_HISTORY, CAPABILITY.VIEW_LINEAGE];

const C = CAPABILITY;

/**
 * Per (category → status) capability grants, in ADDITION to the always-on floor.
 * Statuses are stored upper-cased to match normalised lookups.
 *
 * @type {Record<string, Record<string, string[]>>}
 */
const MATRIX = {
  [CATEGORY.SEED]: {
    'IN STOCK':   [C.TRANSFER, C.SPLIT, C.MIX, C.ISSUE_PROCESS],
    // TASK 5 — Return action available directly from Inventory for IN PROCESS lots.
    // Operator navigates straight to LotReturnPage without searching Process Issues.
    'IN PROCESS': [C.RETURN],
    'CONSUMED':   [],
    'DAMAGED':    [],
    'QC_HOLD':    [C.TRANSFER],
    'REPROCESS':  [C.TRANSFER, C.ISSUE_PROCESS, C.SPLIT],
  },
  [CATEGORY.ROUGH]: {
    'IN STOCK':   [C.TRANSFER, C.SPLIT, C.ISSUE_PROCESS], // NOTE: rough has no Mix
    'IN PROCESS': [C.RETURN],
    'CONSUMED':   [],
    // DAMAGED / QC_HOLD / REPROCESS intentionally unlisted → read-only floor.
  },
  [CATEGORY.GROWTH_RUN]: {
    'IN STOCK':   [C.TRANSFER, C.GROWTH_AGAIN, C.GROWTH_OUTPUT, C.ISSUE_PROCESS],
    // Two distinct operations coexist for an IN PROCESS Growth Run:
    //   COMPLETE_GROWTH_RUN — finish the GROWTH process itself (Control Tower flow).
    //   RETURN — return the Growth Assembly from a DOWNSTREAM process
    //            (seed_remove / laser ops) via the unified Return workspace,
    //            which resolves the lot's OPEN issue by stable id.
    'IN PROCESS': [C.COMPLETE_GROWTH_RUN, C.RETURN],
    'CONSUMED':   [],
    'DAMAGED':    [],
    'QC_HOLD':    [C.TRANSFER],
    'REPROCESS':  [C.TRANSFER, C.ISSUE_PROCESS],
  },
  [CATEGORY.GAS]: {
    'IN STOCK':   [C.TRANSFER, C.ISSUE_PROCESS],
    'IN PROCESS': [C.RETURN],
    'CONSUMED':   [],
  },
  [CATEGORY.CONSUMABLE]: {
    'IN STOCK':   [C.TRANSFER, C.ISSUE_PROCESS],
    'IN PROCESS': [C.RETURN],
    'CONSUMED':   [],
  },
};

/**
 * Selection-size constraints per action, for bulk/Clipboard reuse.
 * `max: null` means unbounded. Actions not listed here accept any size >= 1.
 *
 * @type {Record<string, { min: number, max: number | null }>}
 */
export const SELECTION_RULES = {
  canSplit:             { min: 1, max: 1 },    // split operates on exactly one lot
  canMix:               { min: 2, max: null }, // mix requires at least two lots
  canGrowthAgain:       { min: 1, max: 1 },
  canGrowthOutput:      { min: 1, max: 1 },
  canCompleteGrowthRun: { min: 1, max: 1 },
  canViewHistory:       { min: 1, max: 1 },
  canViewLineage:       { min: 1, max: 1 },
  canTransfer:          { min: 1, max: null },
  canIssueProcess:      { min: 1, max: null },
  canReturn:            { min: 1, max: 1 },    // return is always single-lot
};

/**
 * @param {string | undefined | null} raw
 * @returns {string}
 */
function normalizeCategory(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * @param {string | undefined | null} raw
 * @returns {string}
 */
function normalizeStatus(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return STATUS_ALIASES[s] || s;
}

/**
 * Build the full `can*` flag object from a list of granted capabilities.
 * Every flag is present; unlisted capabilities default to false.
 *
 * @param {string[]} granted
 * @returns {{
 *   canViewHistory: boolean,
 *   canViewLineage: boolean,
 *   canTransfer: boolean,
 *   canIssueProcess: boolean,
 *   canSplit: boolean,
 *   canMix: boolean,
 *   canGrowthAgain: boolean,
 *   canGrowthOutput: boolean,
 *   canCompleteGrowthRun: boolean,
 * }}
 */
function toFlags(granted) {
  const set = new Set([...ALWAYS, ...granted]);
  return {
    canViewHistory:       set.has(C.VIEW_HISTORY),
    canViewLineage:       set.has(C.VIEW_LINEAGE),
    canTransfer:          set.has(C.TRANSFER),
    canIssueProcess:      set.has(C.ISSUE_PROCESS),
    canSplit:             set.has(C.SPLIT),
    canMix:               set.has(C.MIX),
    canGrowthAgain:       set.has(C.GROWTH_AGAIN),
    canGrowthOutput:      set.has(C.GROWTH_OUTPUT),
    canCompleteGrowthRun: set.has(C.COMPLETE_GROWTH_RUN),
    canReturn:            set.has(C.RETURN),
  };
}

/** @returns {Record<string, boolean>} every capability flag set to false. */
function noFlags() {
  const flags = toFlags([]);
  for (const key of Object.keys(flags)) flags[key] = false;
  return flags;
}

/**
 * Resolve the allowed actions for a SINGLE lot, from its category and status.
 * This is the primary entry point used by the Lot Workspace.
 *
 * @param {{ category?: string, status?: string } | null | undefined} lot
 * @returns {ReturnType<typeof toFlags>}
 */
export function getAllowedActions(lot) {
  if (!lot) return toFlags([]); // floor: a missing lot still permits read-only intent
  const category = normalizeCategory(lot.category || lot.item_category);
  const status = normalizeStatus(lot.status);
  let granted = (MATRIX[category] && MATRIX[category][status]) || [];
  if (granted.length === 0 && status === 'IN STOCK') {
    granted = [C.TRANSFER, C.SPLIT, C.ISSUE_PROCESS];
  }
  
  if (category === CATEGORY.GROWTH_RUN && status === 'IN PROCESS') {
    if (lot.current_process_name && String(lot.current_process_name).toUpperCase() === 'GROWTH RUN') {
      granted = granted.filter(a => a !== C.RETURN);
    }
  }

  const flags = toFlags(granted);
  return flags;
}

/**
 * Resolve allowed actions across a MULTI-LOT selection (future bulk/Clipboard).
 * An action is allowed only if EVERY selected lot permits it AND the selection
 * size satisfies SELECTION_RULES. Returns all-false for an empty selection.
 *
 * @param {Array<{ category?: string, status?: string }>} lots
 * @returns {ReturnType<typeof toFlags>}
 */
export function getAllowedActionsForSelection(lots) {
  const list = Array.isArray(lots) ? lots : [];
  if (list.length === 0) return noFlags();

  // Intersect per-lot capabilities: an action survives only if all lots allow it.
  const perLot = list.map(getAllowedActions);
  const result = { ...perLot[0] };
  for (const key of Object.keys(result)) {
    result[key] = perLot.every(flags => flags[key]);
  }

  // Apply selection-count constraints.
  for (const [key, rule] of Object.entries(SELECTION_RULES)) {
    if (!result[key]) continue;
    if (list.length < rule.min || (rule.max != null && list.length > rule.max)) {
      result[key] = false;
    }
  }
  return result;
}

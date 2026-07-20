/**
 * Growth-Again carrier classification — pure decision helpers for the CREATE
 * ISSUE flow (routes/lotProcessIssues.js). No I/O, no DB, no side effects —
 * extracted for unit tests, same pattern as returnRouting.js.
 *
 * A "carrier" is a physical object that re-enters a GROWTH chamber as the SAME
 * inventory identity (Growth Again): an existing Partial Growth Run biscuit
 * (category 'growth_run') OR a grown diamond block (category 'growth_diamond').
 * Both re-grow in place — never split, cloned, seed-attached, or re-minted as
 * a new Growth Run row. Seeds are the only inputs that start a NEW growth
 * identity.
 */

const EPS = 0.0001;

const GROWTH_CARRIER_CATEGORIES = ['growth_run', 'growth_diamond'];

/** True when this item category is an identity-preserving Growth-Again carrier. */
function isGrowthCarrierCategory(category) {
  return GROWTH_CARRIER_CATEGORIES.includes(String(category || '').toLowerCase());
}

/**
 * Seed-attachment rule (Phase A, Seed Lifecycle): only NON-carrier inputs of a
 * GROWTH process are physically embedded into the growing biscuit and marked
 * ATTACHED_TO_GROWTH. A carrier IS the growth identity — attaching it to
 * itself created the SSD013-APR26-011 / SSD001-JUL26-055 duplicate defect.
 */
function appliesSeedAttachment(category, isGrowthGroup) {
  return !!isGrowthGroup && !isGrowthCarrierCategory(category);
}

/**
 * Atomic Run increment — single-statement, evaluated inside the UPDATE under
 * the carrier's FOR UPDATE row lock, so concurrent Growth-Again issues can
 * never read-modify-write a stale value. COALESCE guards legacy NULL run_no
 * (phase55 default is 1): a carrier is never reset to R1 by a re-issue.
 * Used verbatim by the route; nextRunNo() documents the same semantics in JS.
 */
const RUN_INCREMENT_SQL = 'COALESCE(run_no, 1) + 1';

/** JS mirror of RUN_INCREMENT_SQL: R1→R2, R2→R3, NULL→R2. Never resets. */
function nextRunNo(current) {
  const n = parseInt(current, 10);
  return (Number.isFinite(n) && n >= 1 ? n : 1) + 1;
}

/**
 * Classify the full lot set of one CREATE ISSUE request against the
 * Growth-Again rules. Called AFTER every lot is locked (FOR UPDATE), so the
 * status it sees is authoritative — a concurrent duplicate Issue serializes on
 * the row lock and then fails the IN STOCK gate here.
 *
 * Rules (GROWTH-group processes only; non-growth requests always pass):
 *   1. Rough Diamond ('rough') is never Growth-eligible.
 *   2. At most ONE carrier per growth issue — two carriers cannot share one
 *      growth identity/run.
 *   3. A carrier re-issue (Growth Again) must be the ONLY lot in the request —
 *      mixing a carrier with seeds would attach seeds to a process whose
 *      identity is the carrier itself.
 *   4. A growth_diamond carrier must be issued at its FULL available quantity —
 *      identity preservation is incompatible with a partial split. (growth_run
 *      biscuits already always issue in place; their legacy qty behaviour is
 *      unchanged.)
 *   5. A carrier must be IN STOCK / LOW STOCK — an IN PROCESS carrier is a
 *      duplicate/concurrent issue attempt.
 *
 * @param {{ isGrowthGroup: boolean,
 *           lots: Array<{ category: string, status: string, lotNumber: string,
 *                         requestedQty: number, availableQty: number }> }} ctx
 * @returns {{ valid: boolean, error?: string,
 *             isGrowthAgain: boolean, carrierIndex: number|null }}
 */
function classifyGrowthIssueLots({ isGrowthGroup, lots }) {
  const ok = (isGrowthAgain, carrierIndex) => ({ valid: true, isGrowthAgain, carrierIndex });
  const fail = error => ({ valid: false, error, isGrowthAgain: false, carrierIndex: null });

  const list = Array.isArray(lots) ? lots : [];
  if (!isGrowthGroup) return ok(false, null);

  const carrierIndexes = [];
  for (let i = 0; i < list.length; i++) {
    const lot = list[i];
    const category = String(lot.category || '').toLowerCase();
    if (category === 'rough') {
      return fail(
        `Rough Diamond lot ${lot.lotNumber} cannot be issued to a Growth process — ` +
        'rough output is a terminal product of Growth, not a Growth input.'
      );
    }
    if (isGrowthCarrierCategory(category)) carrierIndexes.push(i);
  }

  if (carrierIndexes.length === 0) return ok(false, null);
  if (carrierIndexes.length > 1) {
    const names = carrierIndexes.map(i => list[i].lotNumber).join(', ');
    return fail(
      `Only one Growth carrier can be re-issued per growth process — got ${carrierIndexes.length} (${names}). ` +
      'Each carrier keeps its own Growth identity and Run; start one process per carrier.'
    );
  }

  const idx = carrierIndexes[0];
  const carrier = list[idx];
  if (list.length > 1) {
    return fail(
      `Growth Again re-issues carrier ${carrier.lotNumber} as the SAME identity — ` +
      'it cannot be combined with other lots in one growth issue. Issue the carrier alone.'
    );
  }
  if (carrier.status !== 'IN STOCK' && carrier.status !== 'LOW STOCK') {
    return fail(
      `Growth carrier ${carrier.lotNumber} is ${carrier.status} — it is already inside a process ` +
      'or otherwise unavailable. A carrier can be re-issued only from IN STOCK (duplicate issue blocked).'
    );
  }
  if (String(carrier.category || '').toLowerCase() === 'growth_diamond') {
    const req = parseFloat(carrier.requestedQty);
    const avail = parseFloat(carrier.availableQty);
    if (!(req > 0) || Math.abs(req - avail) > EPS) {
      return fail(
        `Growth Diamond ${carrier.lotNumber} must be re-issued at its full quantity ` +
        `(${Number.isFinite(avail) ? avail.toFixed(4) : avail}) — identity-preserving Growth Again ` +
        'cannot split the carrier. Split the lot first if only part of it should re-grow.'
      );
    }
  }

  return ok(true, idx);
}

/**
 * Canonical carrier category from stable Item Master identity — never from a
 * display label alone. Explicit non-carrier categories return null; a legacy
 * row with an EMPTY category resolves through the approved item-name aliases
 * ('Growth Run' / 'Partial Growth Run' / 'Growth Diamond') so migrated records
 * with incomplete category data are still identity-preserving carriers.
 * @param {{ category?: string|null, name?: string|null }} item
 * @returns {'growth_run'|'growth_diamond'|null}
 */
function resolveCarrierCategory({ category, name } = {}) {
  const cat = String(category || '').toLowerCase().trim();
  if (GROWTH_CARRIER_CATEGORIES.includes(cat)) return cat;
  if (cat) return null; // explicit non-carrier category (seed, rough, …)
  const n = String(name || '').toLowerCase().trim();
  if (/^(partial\s+)?growth\s+run$/.test(n)) return 'growth_run';
  if (/^growth\s+diamond$/.test(n)) return 'growth_diamond';
  return null;
}

/**
 * ONE canonical predicate: is this inventory row an identity-preserving Growth
 * carrier? Accepts the inventory row (with joined category / item_name fields)
 * and the item row where separately available. Ambiguous rows resolve to
 * false and are handled fail-closed by the callers — never via child-lot output.
 */
function isIdentityPreservingGrowthCarrier(inventoryRow, itemRow) {
  return resolveCarrierCategory({
    category: (itemRow && itemRow.category) ?? (inventoryRow && inventoryRow.category),
    name: (itemRow && itemRow.name) ?? (inventoryRow && inventoryRow.item_name),
  }) !== null;
}

module.exports = {
  GROWTH_CARRIER_CATEGORIES,
  isGrowthCarrierCategory,
  appliesSeedAttachment,
  classifyGrowthIssueLots,
  RUN_INCREMENT_SQL,
  nextRunNo,
  resolveCarrierCategory,
  isIdentityPreservingGrowthCarrier,
};

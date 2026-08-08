/**
 * RBAC Brick 6 — effective-access impact of a permission copy.
 *
 * PURE FUNCTIONS ONLY. No React, no network, no writes.
 *
 * THIS IS NOT A SECOND RESOLVER AND NOT A SECOND RISK CATALOG.
 * Both sides of the comparison are produced by Brick 5's `buildAccessIndex`,
 * which itself delegates every verdict to Brick 3's precedence
 *   Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 * The only Brick 6 contribution is running it twice — once with the target's
 * CURRENT override rows and once with the override rows the copy WOULD leave
 * behind — and joining the two row sets by their stable row id. Risk levels come
 * off those rows, which carry the Brick 1 catalog's `risk_level` verbatim.
 *
 * THE BASELINE IS THE TARGET'S, ON BOTH SIDES.
 * Copy Setup never writes users.role, user_roles or role_permissions, so the
 * role baseline after a copy is the same one the target has now. Using the
 * source's baseline would predict access the copy cannot produce.
 *
 * REPLACE, NOT MERGE.
 * The predicted override map is the source's rows exactly — see
 * copySetupPreviewModel's `diffReplace`. Nothing is unioned in.
 */

import { buildGroups, validateCatalog } from '../permissions/permissionCatalogModel';
import { OVERRIDE_STATE } from '../permissions/permissionEditorModel';
import { buildAccessIndex, EFFECT, OVERRIDE_VIEW_LABELS } from '../effective-access/effectiveAccessModel';

export const IMPACT_UNAVAILABLE_NOTE =
  'Effective-access impact is unavailable because the permission catalog could not be '
  + 'loaded. The row-level diff above is unaffected — it is read directly from the stored '
  + 'rows and does not depend on the catalog.';

export const BASELINE_UNAVAILABLE_NOTE =
  'The target user\'s role baseline could not be read, so before/after totals cannot be '
  + 'stated. The stored override rows that will change are still listed above.';

export const DIRECTION = Object.freeze({
  GRANTED: 'GRANTED',
  REVOKED: 'REVOKED',
  CHANGED: 'CHANGED',
  UNCHANGED: 'UNCHANGED',
});

export const DIRECTION_LABELS = Object.freeze({
  GRANTED: 'Denied → Allowed',
  REVOKED: 'Allowed → Denied',
  CHANGED: 'Result changes',
  UNCHANGED: 'No change to the result',
});

/** The catalog's own elevated tiers. Nothing here re-declares what is risky. */
const ELEVATED_RISK = Object.freeze(['CRITICAL', 'HIGH']);

function directionOf(before, after) {
  if (before.status === after.status) return DIRECTION.UNCHANGED;
  if (after.status === EFFECT.ALLOWED) return DIRECTION.GRANTED;
  if (before.status === EFFECT.ALLOWED) return DIRECTION.REVOKED;
  return DIRECTION.CHANGED;
}

function toChange(beforeRow, afterRow) {
  const overrideChanged = beforeRow.user_override.state !== afterRow.user_override.state;
  const direction = directionOf(beforeRow.effective, afterRow.effective);

  return {
    id: beforeRow.id,
    group: beforeRow.group,
    capability_label: beforeRow.capability_label,
    action_label: beforeRow.action.label,
    code: beforeRow.code,
    canonical_code: beforeRow.canonical_code,
    storage_key: beforeRow.storage_key,
    risk_level: beforeRow.risk_level,
    enforcement_label: beforeRow.enforcement.label,
    override: {
      before: beforeRow.user_override.state,
      after: afterRow.user_override.state,
      before_label: OVERRIDE_VIEW_LABELS[beforeRow.user_override.state],
      after_label: OVERRIDE_VIEW_LABELS[afterRow.user_override.state],
      changed: overrideChanged,
    },
    effective: {
      before: beforeRow.effective.label,
      after: afterRow.effective.label,
      before_status: beforeRow.effective.status,
      after_status: afterRow.effective.status,
      after_source_text: afterRow.effective.source_text,
      changed: direction !== DIRECTION.UNCHANGED,
    },
    direction,
    directionLabel: DIRECTION_LABELS[direction],
    /* Elevated risk AND newly granted. A high-risk capability that was already
       allowed is not a change and must not be counted as one. */
    highRisk: direction === DIRECTION.GRANTED && ELEVATED_RISK.includes(beforeRow.risk_level),
  };
}

function totalsOf(summary) {
  return {
    allowed: summary.allowed,
    denied: summary.denied,
    unverified: summary.unverified,
    overrides: summary.overrides,
    explicitAllows: summary.explicitAllows,
    explicitDenies: summary.explicitDenies,
    totalActions: summary.totalActions,
  };
}

/**
 * Before/after effective access for a permission copy.
 *
 * `currentOverrides` and `resultOverrides` are both in the
 * `{ 'module:submodule': { allow_mask, deny_mask } }` shape — use
 * `overridesToMap` from copySetupPreviewModel to build them from preview rows.
 *
 * Neither input is mutated, and calling this twice with the same inputs returns
 * the same result.
 */
export function buildPermissionImpact({
  catalog,
  catalogFailed = false,
  baseline,
  isSuperAdmin = false,
  currentOverrides = {},
  resultOverrides = {},
}) {
  const catalogCheck = catalogFailed
    ? { ok: false, reason: 'the catalog endpoint failed' }
    : validateCatalog(catalog);

  if (!catalogCheck.ok) {
    return { available: false, reason: IMPACT_UNAVAILABLE_NOTE, changes: [], highRisk: [] };
  }
  if (!isSuperAdmin && baseline?.available === false) {
    return { available: false, reason: BASELINE_UNAVAILABLE_NOTE, changes: [], highRisk: [] };
  }

  const groups = buildGroups(catalog);
  const before = buildAccessIndex({ groups, overrides: currentOverrides, baseline, isSuperAdmin });
  const after = buildAccessIndex({ groups, overrides: resultOverrides, baseline, isSuperAdmin });

  const afterById = new Map(after.rows.map(row => [row.id, row]));
  const changes = before.rows
    .map(row => toChange(row, afterById.get(row.id)))
    .filter(change => change.override.changed || change.effective.changed);

  const beforeTotals = totalsOf(before.summary);
  const afterTotals = totalsOf(after.summary);

  return {
    available: true,
    isSuperAdmin,
    before: beforeTotals,
    after: afterTotals,
    delta: {
      allowed: afterTotals.allowed - beforeTotals.allowed,
      denied: afterTotals.denied - beforeTotals.denied,
      unverified: afterTotals.unverified - beforeTotals.unverified,
      overrides: afterTotals.overrides - beforeTotals.overrides,
    },
    changes,
    granted: changes.filter(c => c.direction === DIRECTION.GRANTED),
    revoked: changes.filter(c => c.direction === DIRECTION.REVOKED),
    /* Sorted CRITICAL first so the acknowledgement text names the worst case. */
    highRisk: changes
      .filter(c => c.highRisk)
      .sort((a, b) => ELEVATED_RISK.indexOf(a.risk_level) - ELEVATED_RISK.indexOf(b.risk_level)),
    highRiskRevoked: changes.filter(
      c => c.direction === DIRECTION.REVOKED && ELEVATED_RISK.includes(c.risk_level),
    ),
    /* Stored rows that move without moving the result. On a Super Admin target
       every row lands here, which is exactly the point the warning makes. */
    storedOnlyChanges: changes.filter(c => c.override.changed && !c.effective.changed),
  };
}

export { OVERRIDE_STATE, EFFECT };

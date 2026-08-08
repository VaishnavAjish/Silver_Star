/**
 * RBAC Brick 5 — the Data Visibility half of the Effective Access Preview.
 *
 * PURE FUNCTIONS ONLY. No React, no network, no writes.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a second inventory-scope interpretation. Department visibility,
 *     financial-field visibility and the stored `vis.*` rows are produced by
 *     Brick 4's `buildRestrictionsView` and re-presented here. That includes
 *     Brick 4's downgrade-only bypass handling, so the partial-enforcement
 *     finding it recorded for admin/manager/owner is carried through rather than
 *     silently restored to ENFORCED.
 *   - It is NOT a second bypass role list. `SCOPE_BYPASS_ROLES` and
 *     `FINANCIAL_BYPASS_ROLES` live in Brick 4 and are imported, never copied.
 *
 * WHAT IT ADDS
 *   1. An availability layer: a scope fetch that failed must read "Unavailable",
 *      not "All Departments". Failing open visually is the one thing this panel
 *      may never do.
 *   2. The two authority dimensions that are deliberately NOT modelled. They are
 *      stated as absent so a later brick can add them as real, separate storage
 *      instead of someone inferring them from department visibility.
 */

import {
  RESTRICTION_STATUS,
  RESTRICTION_STATUS_LABELS,
  buildRestrictionsView,
  isScopeBypassRole,
} from '../restrictions/viewRestrictionsModel';

export { RESTRICTION_STATUS, RESTRICTION_STATUS_LABELS };

export const SCOPE_UNAVAILABLE_SUMMARY = 'Unavailable';

export const SCOPE_UNAVAILABLE_NOTE =
  'The inventory scope could not be read. No department list is shown, because showing '
  + 'the default of all departments would overstate this user\'s visibility.';

export const STORED_NOT_ENFORCED_WARNING =
  'Stored preference only — no verified backend data restriction. These values exist on '
  + 'the account and no backend code reads them.';

/* ── Authority dimensions that do not exist yet ─────────────── */

/**
 * Brick 4 established that neither of these has dedicated storage or a resolver.
 * They are rendered as explicit "Not modelled" rows rather than omitted, because
 * an omitted dimension is the one an administrator assumes something else on the
 * screen already covers.
 *
 * Nothing may derive them from inventory visibility, primary department, role
 * string or the stock-transfer permission.
 */
export const AUTHORITY_ROWS = Object.freeze([
  Object.freeze({
    code: 'authority.operational',
    label: 'Operational Authority',
    summary: 'Not modelled',
    explanation: 'No dedicated operational-authority storage or resolver has been verified.',
  }),
  Object.freeze({
    code: 'authority.approval',
    label: 'Approval Authority',
    summary: 'Not modelled',
    explanation: 'Approval permissions exist for individual capabilities, but a separate '
      + 'department-level approval-authority model has not been verified.',
  }),
]);

/* ── Whole-section derivation ───────────────────────────────── */

/**
 * The Data Visibility section as plain data.
 *
 * `scopeAvailable: false` replaces the summary and drops the status to UNKNOWN —
 * an unread scope has no enforcement state to report, and inventing one is the
 * "fail open visually" this section exists to prevent.
 */
export function buildDataVisibility({
  catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
  inventoryScope, departments, scopeAvailable = true, overridesAvailable = true,
}) {
  const restrictions = buildRestrictionsView({
    catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
    inventoryScope, departments,
  });

  const scope = scopeAvailable
    ? { ...restrictions.scope, available: true }
    : {
      ...restrictions.scope,
      available: false,
      summary: SCOPE_UNAVAILABLE_SUMMARY,
      status: RESTRICTION_STATUS.UNKNOWN,
      warning: SCOPE_UNAVAILABLE_NOTE,
      emptySelection: false,
    };

  /* Super Admin has no scope to report against — the resolver ignores it. */
  const scopeApplies = !isScopeBypassRole(role) && !isSuperAdmin;

  return {
    catalogAvailable: restrictions.catalogAvailable,
    scope: { ...scope, applies: scopeApplies },
    financial: {
      ...restrictions.financial,
      /* An override outage makes the financial verdict unverifiable for the same
         reason it does for every other permission row. */
      available: overridesAvailable || isSuperAdmin,
    },
    stored: restrictions.stored,
    storedWarning: STORED_NOT_ENFORCED_WARNING,
    diagnostics: restrictions.diagnostics,
    authority: AUTHORITY_ROWS,
    counts: restrictions.counts,
  };
}

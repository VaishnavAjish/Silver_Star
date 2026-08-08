/**
 * RBAC Brick 5 — pure derivation for the read-only Effective Access Preview.
 *
 * PURE FUNCTIONS ONLY. No React, no network, no writes. Brick 5 explains access;
 * it never changes it.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a second resolver. Every verdict comes from Brick 3's
 *     `baselineStateFor` / `overrideStateFor` / `effectiveFor`, which are the
 *     server resolver's precedence
 *       Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 *     `resolveEffective` below wraps those with exactly one Brick 5 addition —
 *     the "user overrides could not be read" case — and delegates everything else.
 *   - It is NOT a second catalog. Groups, labels, actions, risk, lifecycle and
 *     per-surface enforcement come from the Brick 1 payload through Brick 3's
 *     `buildGroups`. There is no 96-entry client registry here and never may be.
 *   - It is NOT a second action-bit table. Bits arrive on the capability objects
 *     Brick 3 built from shared/constants/permissions, whose values are pinned
 *     against server/utils/permissions.js by permissionEditorModel.test.js.
 *   - It is NOT a second inventory-scope interpretation. Department visibility
 *     and financial-field visibility are delegated to Brick 4's
 *     `buildRestrictionsView`, including its downgrade-only bypass handling.
 *
 * THE DOWNGRADE-ONLY RULE, AGAIN
 * `overallEnforcementOf` refines Brick 3's four-level badge into the catalog's
 * eight-value vocabulary. It may only ever describe access as LESS protected than
 * Brick 3 does, never more — the parity test pins that for every entry in the
 * real catalog.
 *
 * PERMISSION DECISION != ENFORCEMENT COVERAGE
 * These are two independent dimensions and are counted, filtered and rendered
 * separately throughout. "Allowed" never implies "securely enforced".
 */

import {
  BASELINE,
  BASELINE_LABELS,
  EFFECT,
  EFFECT_LABELS,
  SOURCE,
  OVERRIDE_STATE,
  OVERRIDE_STATE_LABELS,
  baselineStateFor,
  overrideStateFor,
  effectiveFor,
  describeSource,
} from '../permissions/permissionEditorModel';
import { ENFORCEMENT_LEVEL } from '../permissions/permissionCatalogModel';

export { BASELINE, EFFECT, SOURCE, OVERRIDE_STATE, BASELINE_LABELS, EFFECT_LABELS };

/* ── Override state, plus the one state Brick 3 has no need for ─── */

/**
 * The override row set failed to load. Rendering INHERIT here would state that
 * zero overrides were verified, which is exactly the false claim the brick must
 * not make.
 */
export const OVERRIDE_UNAVAILABLE = 'UNAVAILABLE';

export const OVERRIDE_VIEW_LABELS = Object.freeze({
  ...OVERRIDE_STATE_LABELS,
  [OVERRIDE_UNAVAILABLE]: 'Unavailable',
});

/** Brick-5-only sources. Brick 3's SOURCE values pass through untouched. */
export const BRICK5_SOURCE = Object.freeze({
  OVERRIDES_UNAVAILABLE: 'OVERRIDES_UNAVAILABLE',
});

const BRICK5_SOURCE_TEXT = Object.freeze({
  OVERRIDES_UNAVAILABLE: 'User overrides unavailable — result unverified',
});

export const OVERRIDES_UNAVAILABLE_NOTE =
  'The user override rows could not be read, so no result that depends on them can be '
  + 'stated. This is a reporting outage, not a permission decision.';

export const BASELINE_UNAVAILABLE_NOTE =
  'The role baseline could not be read for this key. An explicit user override is still '
  + 'conclusive; everything else is reported as Unverified rather than as a denial.';

export const ENFORCEMENT_SEPARATION_NOTE =
  'Effective permission and backend enforcement are separate. A permission may resolve '
  + 'Allowed while some backend routes remain partially or not enforced.';

/**
 * Deliberately NOT the same sentence as Brick 3's SUPER_ADMIN_NOTE, which is
 * rendered by the editor lower down the same tab. Two identical paragraphs on
 * one screen read as a rendering bug rather than as emphasis.
 */
export const SUPER_ADMIN_SUMMARY_NOTE =
  'Every result below is granted by the Super Admin bypass, which the resolver applies '
  + 'before any mask is read. The baselines and overrides shown are diagnostic only and '
  + 'do not restrict this user.';

export const CATALOG_UNAVAILABLE_NOTE =
  'Effective access preview unavailable because permission catalog diagnostics could not '
  + 'be loaded. The permission editor and view restrictions below are unaffected.';

/**
 * server/utils/permissions.js:65 — when a module/submodule has no role mask AND
 * no override row, the resolver falls back to the legacy `user_permissions`
 * table. Brick 5 cannot read that table, so a default-deny verdict carries this
 * caveat rather than being stated as an unqualified certainty.
 */
export const LEGACY_FALLBACK_NOTE =
  'The resolver falls back to the legacy user_permissions table when a key has neither a '
  + 'role mask nor an override row. No admin endpoint exposes that table, so a row there '
  + 'would not be visible here.';

/* ── Enforcement vocabulary (the Brick 1 catalog's own eight) ──── */

export const ENFORCEMENT = Object.freeze({
  ENFORCED: 'ENFORCED',
  PARTIALLY_ENFORCED: 'PARTIALLY_ENFORCED',
  FRONTEND_ONLY: 'FRONTEND_ONLY',
  ROLE_STRING_ONLY: 'ROLE_STRING_ONLY',
  AUTHENTICATE_ONLY: 'AUTHENTICATE_ONLY',
  NOT_ENFORCED: 'NOT_ENFORCED',
  NO_ACTIVE_FEATURE: 'NO_ACTIVE_FEATURE',
  UNKNOWN: 'UNKNOWN',
});

export const ENFORCEMENT_LABELS = Object.freeze({
  ENFORCED: 'Enforced',
  PARTIALLY_ENFORCED: 'Partial',
  FRONTEND_ONLY: 'Frontend only',
  ROLE_STRING_ONLY: 'Role based',
  AUTHENTICATE_ONLY: 'Authentication only',
  NOT_ENFORCED: 'Not enforced',
  NO_ACTIVE_FEATURE: 'No active feature',
  UNKNOWN: 'Unknown',
});

export const ENFORCEMENT_SURFACE_LABELS = Object.freeze({
  navigation: 'Navigation',
  frontend_route: 'Frontend route',
  frontend_action: 'Frontend action',
  api_list: 'API — list',
  api_detail: 'API — detail',
  api_create: 'API — create',
  api_edit: 'API — edit',
  api_delete: 'API — delete',
  api_approve: 'API — approve',
  export: 'Export',
  print: 'Print',
});

/**
 * Collapses the per-surface classifications into one honest headline.
 *
 * Below the partial tier the checks run weakest-claim-first, so a capability
 * with one role-string gate and three authenticate-only gates reports the
 * role-string gate rather than flattering itself. Nothing here can raise a
 * claim above Brick 3's badge — see `enforcementRankFor` and the parity test.
 */
export function overallEnforcementOf(enforcement) {
  const statuses = Object.values(enforcement || {})
    .filter(status => status !== ENFORCEMENT.NO_ACTIVE_FEATURE);

  if (statuses.length === 0) return ENFORCEMENT.NO_ACTIVE_FEATURE;
  if (statuses.every(status => status === ENFORCEMENT.ENFORCED)) return ENFORCEMENT.ENFORCED;
  if (statuses.some(status => status === ENFORCEMENT.ENFORCED
    || status === ENFORCEMENT.PARTIALLY_ENFORCED)) {
    return ENFORCEMENT.PARTIALLY_ENFORCED;
  }

  // No surface consults the resolver at all. Report the strongest gate that does
  // exist, while being clear that none of them is a permission check.
  if (statuses.includes(ENFORCEMENT.ROLE_STRING_ONLY)) return ENFORCEMENT.ROLE_STRING_ONLY;
  if (statuses.includes(ENFORCEMENT.FRONTEND_ONLY)) return ENFORCEMENT.FRONTEND_ONLY;
  if (statuses.includes(ENFORCEMENT.AUTHENTICATE_ONLY)) return ENFORCEMENT.AUTHENTICATE_ONLY;
  if (statuses.includes(ENFORCEMENT.UNKNOWN)) return ENFORCEMENT.UNKNOWN;
  return ENFORCEMENT.NOT_ENFORCED;
}

/** How strong a claim each value makes, for the downgrade-only assertion. */
export function enforcementRankFor(overall) {
  if (overall === ENFORCEMENT.ENFORCED) return 3;
  if (overall === ENFORCEMENT.PARTIALLY_ENFORCED) return 2;
  if (overall === ENFORCEMENT.NO_ACTIVE_FEATURE) return 0;
  return 1;
}

/** Brick 3's coarse level on the same scale. */
export function brick3RankFor(level) {
  if (level === ENFORCEMENT_LEVEL.ENFORCED) return 3;
  if (level === ENFORCEMENT_LEVEL.PARTIAL) return 2;
  if (level === ENFORCEMENT_LEVEL.NO_ACTIVE_FEATURE) return 0;
  return 1;
}

/** Anything short of full backend coverage, for the "Unenforced" filter and count. */
export function isEnforcementGap(overall) {
  return overall !== ENFORCEMENT.ENFORCED && overall !== ENFORCEMENT.NO_ACTIVE_FEATURE;
}

/* ── Risk ───────────────────────────────────────────────────── */

export const RISK_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const RISK_LABELS = Object.freeze({
  CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low',
});

const ELEVATED_RISK = Object.freeze(['CRITICAL', 'HIGH']);

/**
 * The combination worth an explicit callout: this user may do it, and the
 * backend does not reliably stop anyone else from doing it either.
 */
export function isRiskyGap(row) {
  return ELEVATED_RISK.includes(row.risk_level)
    && row.effective.allowed === true
    && isEnforcementGap(row.enforcement.overall);
}

/* ── Per-action resolution ──────────────────────────────────── */

/**
 * Brick 3's precedence, plus the override-outage case it has no need for.
 *
 * Super Admin still short-circuits first: the bypass is decided in the resolver
 * before any mask is read, so an override outage cannot make it unverifiable.
 */
export function resolveEffective({
  baselineState, overrideState, isSuperAdmin, overridesAvailable = true,
}) {
  if (isSuperAdmin) return effectiveFor({ baselineState, overrideState, isSuperAdmin });
  if (!overridesAvailable) {
    return { effect: EFFECT.UNKNOWN, source: BRICK5_SOURCE.OVERRIDES_UNAVAILABLE };
  }
  return effectiveFor({ baselineState, overrideState, isSuperAdmin });
}

export function describeAccessSource(source, roleNames) {
  return BRICK5_SOURCE_TEXT[source] || describeSource(source, roleNames);
}

/** Plain-language reason, shown under the verdict rather than only in a tooltip. */
export function explainSource(source) {
  switch (source) {
    case SOURCE.SUPER_ADMIN:
      return 'Granted by the Super Admin bypass before any mask is read.';
    case SOURCE.EXPLICIT_DENY:
      return 'A user-specific deny is set. Deny wins over the role baseline and over an allow.';
    case SOURCE.EXPLICIT_ALLOW:
      return 'A user-specific allow is set and no deny opposes it.';
    case SOURCE.ROLE_ALLOW:
      return 'Inherited from the role baseline; no user override changes it.';
    case SOURCE.ROLE_NOT_GRANTED:
      return 'The role baseline row exists but does not grant this action.';
    case SOURCE.NO_BASELINE:
      return 'No role baseline row exists for this capability and no user override grants it.';
    case SOURCE.NOT_REPORTED:
      return 'A baseline row is known to exist but the role API cannot report this key, '
        + 'so the stored grant cannot be shown.';
    case BRICK5_SOURCE.OVERRIDES_UNAVAILABLE:
      return OVERRIDES_UNAVAILABLE_NOTE;
    default:
      return 'The role baseline could not be read, so no verdict can be stated.';
  }
}

function warningsFor({ baselineState, overrideState, effect, source, overall }) {
  const warnings = [];
  if (source === SOURCE.NOT_REPORTED || source === SOURCE.UNKNOWN) {
    warnings.push(BASELINE_UNAVAILABLE_NOTE);
  }
  if (source === BRICK5_SOURCE.OVERRIDES_UNAVAILABLE) warnings.push(OVERRIDES_UNAVAILABLE_NOTE);
  if (source === SOURCE.NO_BASELINE && overrideState === OVERRIDE_STATE.INHERIT) {
    warnings.push(LEGACY_FALLBACK_NOTE);
  }
  if (effect === EFFECT.ALLOWED && isEnforcementGap(overall)) {
    warnings.push('Allowed by the resolver, but the backend does not enforce this capability '
      + 'on every surface. Removing the permission may not remove the access.');
  }
  if (baselineState === BASELINE.NO_ROW && overrideState === OVERRIDE_STATE.ALLOW) {
    warnings.push('This access exists only because of a user-specific allow. No role grants it.');
  }
  return warnings;
}

/**
 * One action of one capability as the preview presents it. Presentation data
 * only — nothing here is persisted, and no component recomputes any of it.
 */
export function buildAccessRow({
  capability, action, group, overrides, baseline, isSuperAdmin, overridesAvailable = true,
}) {
  const baselineState = baselineStateFor(capability, action.bit, baseline);
  const overrideState = overridesAvailable
    ? overrideStateFor(overrides, capability.storageKey, action.bit)
    : OVERRIDE_UNAVAILABLE;

  const { effect, source } = resolveEffective({
    baselineState, overrideState, isSuperAdmin, overridesAvailable,
  });

  const overall = overallEnforcementOf(capability.enforcement);
  const entry = overridesAvailable ? overrides?.[capability.storageKey] : null;
  /* null, not 0: "not read" and "no bits set" must stay distinguishable. */
  const roleMask = baseline?.available && baseline.masks.has(capability.storageKey)
    ? baseline.masks.get(capability.storageKey)
    : null;

  return {
    id: `${capability.code}::${action.id}`,
    canonical_code: capability.canonicalCode || capability.code,
    code: capability.code,
    backend_module: capability.module,
    backend_submodule: capability.submodule,
    submodule_label: capability.submoduleLabel,
    storage_key: capability.storageKey,
    group,
    capability_label: capability.label,
    capability_description: capability.description,
    action,

    role_baseline: {
      status: baselineState,
      label: BASELINE_LABELS[baselineState],
      mask: roleMask,
      roles: baseline?.roleNames || [],
      reported: baselineState !== BASELINE.NOT_REPORTED,
    },

    user_override: {
      state: overrideState,
      label: OVERRIDE_VIEW_LABELS[overrideState],
      allow_mask: overridesAvailable ? (entry?.allow_mask || 0) : null,
      deny_mask: overridesAvailable ? (entry?.deny_mask || 0) : null,
    },

    effective: {
      allowed: effect === EFFECT.ALLOWED ? true : (effect === EFFECT.DENIED ? false : null),
      status: effect,
      label: EFFECT_LABELS[effect],
      source,
      source_text: describeAccessSource(source, baseline?.roleNames),
      explanation: explainSource(source),
    },

    enforcement: { ...capability.enforcement, overall, label: ENFORCEMENT_LABELS[overall] },

    lifecycle_status: capability.status,
    risk_level: capability.riskLevel,
    warnings: warningsFor({ baselineState, overrideState, effect, source, overall }),
  };
}

/* ── Summary metrics ────────────────────────────────────────── */

function emptySummary() {
  return {
    totalActions: 0,
    totalCapabilities: 0,
    allowed: 0,
    denied: 0,
    unverified: 0,
    explicitAllows: 0,
    explicitDenies: 0,
    overrides: 0,
    roleBaselineAllows: 0,
    roleBaselineDenies: 0,
    defaultDenies: 0,
    notReported: 0,
    superAdminBypass: 0,
    enforced: 0,
    partiallyEnforced: 0,
    frontendOnly: 0,
    roleStringOnly: 0,
    authenticateOnly: 0,
    notEnforced: 0,
    noActiveFeature: 0,
    unknownEnforcement: 0,
    enforcementGaps: 0,
    riskyGaps: 0,
    inactiveDiagnostics: 0,
  };
}

const ENFORCEMENT_COUNTER = Object.freeze({
  [ENFORCEMENT.ENFORCED]: 'enforced',
  [ENFORCEMENT.PARTIALLY_ENFORCED]: 'partiallyEnforced',
  [ENFORCEMENT.FRONTEND_ONLY]: 'frontendOnly',
  [ENFORCEMENT.ROLE_STRING_ONLY]: 'roleStringOnly',
  [ENFORCEMENT.AUTHENTICATE_ONLY]: 'authenticateOnly',
  [ENFORCEMENT.NOT_ENFORCED]: 'notEnforced',
  [ENFORCEMENT.NO_ACTIVE_FEATURE]: 'noActiveFeature',
  [ENFORCEMENT.UNKNOWN]: 'unknownEnforcement',
});

/**
 * Counts across ACTIVE capabilities only.
 *
 * Duplicate-legacy, orphaned and planned-inactive entries are excluded by
 * construction — they never enter `rows` — so a capability whose stored key is
 * mirrored by a legacy code is counted exactly once. They are tallied separately
 * as `inactiveDiagnostics`.
 *
 * The permission counters (allowed / denied / unverified) and the enforcement
 * counters each partition the same `totalActions`, because enforcement is a
 * property of the capability that all of its actions share. They are two
 * independent readings of one population, never a single score.
 */
export function summariseRows(rows, diagnosticCount = 0) {
  const summary = emptySummary();
  summary.totalActions = rows.length;
  summary.inactiveDiagnostics = diagnosticCount;

  const capabilities = new Set();

  for (const row of rows) {
    capabilities.add(row.code);

    if (row.effective.status === EFFECT.ALLOWED) summary.allowed += 1;
    else if (row.effective.status === EFFECT.DENIED) summary.denied += 1;
    else summary.unverified += 1;

    if (row.user_override.state === OVERRIDE_STATE.ALLOW) summary.explicitAllows += 1;
    if (row.user_override.state === OVERRIDE_STATE.DENY) summary.explicitDenies += 1;

    switch (row.effective.source) {
      case SOURCE.SUPER_ADMIN: summary.superAdminBypass += 1; break;
      case SOURCE.ROLE_ALLOW: summary.roleBaselineAllows += 1; break;
      case SOURCE.ROLE_NOT_GRANTED: summary.roleBaselineDenies += 1; break;
      case SOURCE.NO_BASELINE: summary.defaultDenies += 1; break;
      case SOURCE.NOT_REPORTED: summary.notReported += 1; break;
      default: break;
    }

    summary[ENFORCEMENT_COUNTER[row.enforcement.overall]] += 1;
    if (isEnforcementGap(row.enforcement.overall)) summary.enforcementGaps += 1;
    if (isRiskyGap(row)) summary.riskyGaps += 1;
  }

  summary.overrides = summary.explicitAllows + summary.explicitDenies;
  summary.totalCapabilities = capabilities.size;
  return summary;
}

/* ── The normalised index (computed once per data change) ───── */

/**
 * Every ACTIVE action row, grouped in the catalog's own order, plus the
 * inactive entries kept aside for the diagnostics toggle.
 *
 * This is the expensive step and it depends only on data, never on search or
 * filter state — which is what keeps typing cheap. `filterAccessView` consumes
 * this and does not resolve a single mask.
 */
export function buildAccessIndex({
  groups, overrides, baseline, isSuperAdmin, overridesAvailable = true,
}) {
  const allRows = [];
  let diagnosticCount = 0;

  const indexed = (groups || []).map((group) => {
    const rows = [];
    for (const capability of group.capabilities) {
      for (const action of capability.actions) {
        rows.push(buildAccessRow({
          capability, action, group: group.name, overrides, baseline,
          isSuperAdmin, overridesAvailable,
        }));
      }
    }
    allRows.push(...rows);
    diagnosticCount += group.diagnostics.length;

    return { name: group.name, rows, diagnostics: group.diagnostics };
  }).filter(group => group.rows.length > 0 || group.diagnostics.length > 0);

  return {
    groups: indexed,
    rows: allRows,
    summary: summariseRows(allRows, diagnosticCount),
  };
}

/* ── Search and filters (cheap, run per keystroke) ──────────── */

export const EMPTY_ACCESS_FILTERS = Object.freeze({
  allowedOnly: false,
  deniedOnly: false,
  overridesOnly: false,
  defaultDeniedOnly: false,
  unenforcedOnly: false,
  missingBaselineOnly: false,
  notReportedOnly: false,
  showDiagnostics: false,
  risk: Object.freeze([]),
});

export function activeAccessFilterCount(filters) {
  const flags = [
    filters.allowedOnly, filters.deniedOnly, filters.overridesOnly,
    filters.defaultDeniedOnly, filters.unenforcedOnly,
    filters.missingBaselineOnly, filters.notReportedOnly, filters.showDiagnostics,
  ].filter(Boolean).length;
  return flags + (filters.risk?.length ? 1 : 0);
}

export function toggleRiskLevel(filters, level) {
  const current = filters.risk || [];
  return {
    ...filters,
    risk: current.includes(level)
      ? current.filter(value => value !== level)
      : [...current, level],
  };
}

/** Search spans business language, backend keys and the rendered source text. */
export function rowHaystack(row) {
  return [
    row.group,
    row.capability_label,
    row.capability_description,
    row.action.label,
    row.action.id,
    row.canonical_code,
    row.code,
    row.backend_module,
    row.backend_submodule,
    row.submodule_label,
    row.effective.source_text,
    row.effective.label,
    row.enforcement.label,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function matchesRowSearch(row, query) {
  const needle = String(query || '').trim().toLowerCase();
  return needle === '' ? true : rowHaystack(row).includes(needle);
}

/** All active filters must pass — they narrow, they never union. */
export function matchesRowFilters(row, filters) {
  if (filters.allowedOnly && row.effective.status !== EFFECT.ALLOWED) return false;
  if (filters.deniedOnly && row.effective.status !== EFFECT.DENIED) return false;
  if (filters.overridesOnly
    && row.user_override.state !== OVERRIDE_STATE.ALLOW
    && row.user_override.state !== OVERRIDE_STATE.DENY) return false;
  if (filters.defaultDeniedOnly && row.effective.source !== SOURCE.NO_BASELINE) return false;
  if (filters.unenforcedOnly && !isEnforcementGap(row.enforcement.overall)) return false;
  if (filters.missingBaselineOnly && row.role_baseline.status !== BASELINE.NO_ROW) return false;
  if (filters.notReportedOnly && row.role_baseline.status !== BASELINE.NOT_REPORTED) return false;
  if (filters.risk?.length && !filters.risk.includes(row.risk_level)) return false;
  return true;
}

function diagnosticHaystack(capability, groupName) {
  return [
    groupName, capability.label, capability.description,
    capability.code, capability.canonicalCode, capability.module, capability.submodule,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * The visible slice of an index. Group headers carry the counts OF WHAT IS
 * SHOWN, so a filtered view never advertises rows it is hiding.
 */
export function filterAccessView(index, { search = '', filters = EMPTY_ACCESS_FILTERS } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  let matchedRows = 0;

  const groups = index.groups.map((group) => {
    const rows = group.rows.filter(
      row => matchesRowSearch(row, needle) && matchesRowFilters(row, filters),
    );
    matchedRows += rows.length;

    const diagnostics = (filters.showDiagnostics ? group.diagnostics : []).filter(
      capability => needle === '' || diagnosticHaystack(capability, group.name).includes(needle),
    );

    const capabilities = new Set(rows.map(row => row.code));
    return {
      name: group.name,
      rows,
      diagnostics,
      counts: {
        capabilities: capabilities.size,
        actions: rows.length,
        allowed: rows.filter(row => row.effective.status === EFFECT.ALLOWED).length,
        denied: rows.filter(row => row.effective.status === EFFECT.DENIED).length,
        overrides: rows.filter(row => row.user_override.state === OVERRIDE_STATE.ALLOW
          || row.user_override.state === OVERRIDE_STATE.DENY).length,
        gaps: rows.filter(row => isEnforcementGap(row.enforcement.overall)).length,
      },
      hasVisibleContent: rows.length > 0 || diagnostics.length > 0,
    };
  }).filter(group => group.hasVisibleContent);

  return { groups, matchedRows, isFiltered: needle !== '' || activeAccessFilterCount(filters) > 0 };
}

/* ── Diagnostic mask detail (details dialog only) ───────────── */

/**
 * The raw arithmetic behind one row. Exposed ONLY in the details dialog: masks
 * are how the resolver thinks, not how an administrator should have to.
 *
 * Returns nulls rather than zeros for values that were not actually read, so the
 * dialog can distinguish "no bits set" from "not available".
 */
export function maskDetailFor(row) {
  const roleMask = row.role_baseline.mask;
  const allowMask = row.user_override.allow_mask;
  const denyMask = row.user_override.deny_mask;
  const known = roleMask !== null && allowMask !== null && denyMask !== null;

  return {
    bit: row.action.bit,
    roleMask,
    allowMask,
    denyMask,
    effectiveMask: known ? (((roleMask | allowMask) & ~denyMask) & 4095) >>> 0 : null,
  };
}

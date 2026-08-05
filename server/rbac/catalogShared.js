/**
 * RBAC Brick 1 — canonical catalog vocabulary.
 *
 * METADATA ONLY. Nothing here participates in permission resolution. The one
 * and only permission engine remains server/utils/permissions.js:
 *   Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 *
 * This file defines the closed vocabularies every catalog entry must use, plus
 * the `defineEntry` factory that normalises an entry and fails fast on an
 * undocumented value. Adding a new status / enforcement value REQUIRES adding
 * it here first, so the catalog can never grow silent unclassified states.
 */

'use strict';

const { PERM_BITS } = require('../utils/permissions');

/* ── Business groups (approved Brick 1 taxonomy — order is display order) ──── */
const BUSINESS_GROUPS = Object.freeze([
  'General & Dashboard',
  'Inventory',
  'Inventory Management',
  'Manufacturing',
  'Rough Diamonds',
  'Purchase',
  'Sales',
  'Accounting',
  'Fixed Assets',
  'Reports',
  'Administration',
  'View Restrictions',
]);

/* ── Lifecycle status ──────────────────────────────────────────────────────
 * ACTIVE           — a live feature reads this permission key today.
 * PLANNED_INACTIVE — permission rows exist, no verified page/route/API.
 * DUPLICATE_LEGACY — a second key for a capability owned by another code.
 * LEGACY_ORPHAN    — permission rows exist, the feature they guarded is gone
 *                    or was re-keyed; no live caller reads this exact key.
 */
const STATUSES = Object.freeze(['ACTIVE', 'PLANNED_INACTIVE', 'DUPLICATE_LEGACY', 'LEGACY_ORPHAN']);

/* ── Risk (metadata only — Brick 1 never changes access based on risk) ────── */
const RISK_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/* ── How the future editor should render the entry ─────────────────────────
 * ACTION_MATRIX   — per-action checkboxes.
 * MODULE_ACCESS   — the legacy submodule = '' row (module-wide baseline).
 * CAPABILITY_FLAG — a single dedicated capability (one meaningful action).
 * REPORT_ACCESS   — view / export / print only.
 * SCOPE_SELECTOR  — a data-scope control, not a bitmask (view restrictions).
 * VISIBILITY_FLAG — a stored boolean preference (view restrictions).
 */
const CONTROL_TYPES = Object.freeze([
  'ACTION_MATRIX', 'MODULE_ACCESS', 'CAPABILITY_FLAG', 'REPORT_ACCESS',
  'SCOPE_SELECTOR', 'VISIBILITY_FLAG',
]);

/* ── Enforcement classification (per surface — never aggregated) ───────────
 * ENFORCED           — the surface consults the effective-permission resolver.
 * PARTIALLY_ENFORCED — some handlers on the surface check, others do not.
 * FRONTEND_ONLY      — client hides it; the API does not check.
 * ROLE_STRING_ONLY   — guarded by authorize('admin'|'operator'), not by bits.
 * AUTHENTICATE_ONLY  — any logged-in user passes.
 * NOT_ENFORCED       — no gate at all on this surface.
 * NO_ACTIVE_FEATURE  — the surface does not exist for this capability.
 * UNKNOWN            — not established by Brick 1 verification.
 */
const ENFORCEMENT_STATUSES = Object.freeze([
  'ENFORCED', 'PARTIALLY_ENFORCED', 'FRONTEND_ONLY', 'ROLE_STRING_ONLY',
  'AUTHENTICATE_ONLY', 'NOT_ENFORCED', 'NO_ACTIVE_FEATURE', 'UNKNOWN',
]);

/* ── The surfaces classified for every entry ───────────────────────────────
 * Deliberately granular: no single "secured" flag may hide a partial gap.
 */
const ENFORCEMENT_SURFACES = Object.freeze([
  'navigation',      // sidebar / command palette / pinned shortcuts
  'frontend_route',  // <PermissionGuard> / <AdminGuard> on the route
  'frontend_action', // in-page buttons gated by hasPermission()
  'api_list',
  'api_detail',
  'api_create',
  'api_edit',
  'api_delete',      // delete / cancel / reverse
  'api_approve',     // approve / reject
  'export',
  'print',
]);

/* Every surface defaults to the honest baseline for this codebase: the global
 * `app.use('/api', … authenticate …)` gate in server/app.js means an unguarded
 * API surface is AUTHENTICATE_ONLY, and an absent surface must be stated. */
const DEFAULT_ENFORCEMENT = Object.freeze({
  navigation:      'NOT_ENFORCED',
  frontend_route:  'NOT_ENFORCED',
  frontend_action: 'NOT_ENFORCED',
  api_list:        'AUTHENTICATE_ONLY',
  api_detail:      'AUTHENTICATE_ONLY',
  api_create:      'AUTHENTICATE_ONLY',
  api_edit:        'AUTHENTICATE_ONLY',
  api_delete:      'AUTHENTICATE_ONLY',
  api_approve:     'NO_ACTIVE_FEATURE',
  export:          'NO_ACTIVE_FEATURE',
  print:           'NO_ACTIVE_FEATURE',
});

/* An entry with no live feature at all — every surface absent. */
const NO_FEATURE_ENFORCEMENT = Object.freeze(
  ENFORCEMENT_SURFACES.reduce((acc, s) => Object.assign(acc, { [s]: 'NO_ACTIVE_FEATURE' }), {})
);

/**
 * Canonical code suffix for the legacy `submodule = ''` rows. The DB keys are
 * never renamed — `backend_submodule` still carries the real empty string, so
 * the resolver keeps matching byte-identically. Only the display code differs.
 */
const MODULE_ACCESS_SUBMODULE = '__module__';

/** Build the catalog code from the real database module/submodule keys. */
function codeFor(backendModule, backendSubmodule) {
  return `${backendModule}.${backendSubmodule === '' ? MODULE_ACCESS_SUBMODULE : backendSubmodule}`;
}

function assertOneOf(value, allowed, field, code) {
  if (!allowed.includes(value)) {
    throw new Error(`[permission-catalog] ${code}: invalid ${field} "${value}"`);
  }
}

/**
 * Normalise + validate one catalog entry.
 *
 * @param {object}   input
 * @param {string}   input.module                 real role_permissions.module value
 * @param {string}   input.submodule              real role_permissions.submodule value ('' allowed)
 * @param {string}   input.group                  one of BUSINESS_GROUPS
 * @param {string}   [input.subgroup]
 * @param {string}   input.label
 * @param {string}   input.description
 * @param {string}   input.status                 one of STATUSES
 * @param {string}   input.risk                   one of RISK_LEVELS
 * @param {string}   input.control                one of CONTROL_TYPES
 * @param {string[]} input.actions                PERM_BITS keys only
 * @param {object}   [input.enforcement]          surface → ENFORCEMENT_STATUSES
 * @param {string[]} [input.frontendRefs]
 * @param {string[]} [input.backendRefs]
 * @param {string[]} [input.notes]
 * @param {string}   [input.canonicalCode]        required on DUPLICATE_LEGACY
 * @param {string}   [input.emptySubmoduleMeaning] required when submodule === ''
 * @param {boolean}  [input.hasBaselineRows]      false ⇒ no seeded role_permissions row
 * @returns {Readonly<object>} frozen catalog entry
 */
function defineEntry(input) {
  const code = codeFor(input.module, input.submodule);

  assertOneOf(input.group, BUSINESS_GROUPS, 'business_group', code);
  assertOneOf(input.status, STATUSES, 'status', code);
  assertOneOf(input.risk, RISK_LEVELS, 'risk_level', code);
  assertOneOf(input.control, CONTROL_TYPES, 'control_type', code);

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new Error(`[permission-catalog] ${code}: supported_actions must be a non-empty array`);
  }
  for (const action of input.actions) {
    if (PERM_BITS[action] === undefined) {
      throw new Error(`[permission-catalog] ${code}: unknown action "${action}" (not in PERM_BITS)`);
    }
  }
  if (!String(input.label || '').trim()) {
    throw new Error(`[permission-catalog] ${code}: label must not be empty`);
  }
  if (input.submodule === '' && !input.emptySubmoduleMeaning) {
    throw new Error(`[permission-catalog] ${code}: empty submodule requires emptySubmoduleMeaning`);
  }
  if (input.status === 'DUPLICATE_LEGACY' && !input.canonicalCode) {
    throw new Error(`[permission-catalog] ${code}: DUPLICATE_LEGACY requires canonicalCode`);
  }

  const enforcement = { ...DEFAULT_ENFORCEMENT, ...(input.enforcement || {}) };
  for (const [surface, status] of Object.entries(enforcement)) {
    if (!ENFORCEMENT_SURFACES.includes(surface)) {
      throw new Error(`[permission-catalog] ${code}: unknown enforcement surface "${surface}"`);
    }
    assertOneOf(status, ENFORCEMENT_STATUSES, `enforcement.${surface}`, code);
  }

  return Object.freeze({
    code,
    backend_module:    input.module,
    backend_submodule: input.submodule,

    business_group:    input.group,
    business_subgroup: input.subgroup || null,

    label:       input.label,
    description: input.description,

    status:     input.status,
    risk_level: input.risk,

    supported_actions: Object.freeze([...input.actions]),
    supported_bitmask: input.actions.reduce((m, a) => m | PERM_BITS[a], 0),
    control_type:      input.control,

    /** false ⇒ live feature with NO seeded role_permissions baseline row. */
    has_baseline_rows: input.hasBaselineRows !== false,
    /** Explicit classification for the legacy submodule = '' convention. */
    empty_submodule_meaning: input.submodule === '' ? input.emptySubmoduleMeaning : null,
    /** Surviving code recommended for a later brick (DUPLICATE_LEGACY only). */
    canonical_code: input.canonicalCode || null,

    enforcement:   Object.freeze(enforcement),
    frontend_refs: Object.freeze([...(input.frontendRefs || [])]),
    backend_refs:  Object.freeze([...(input.backendRefs || [])]),
    notes:         Object.freeze([...(input.notes || [])]),
  });
}

module.exports = {
  BUSINESS_GROUPS,
  STATUSES,
  RISK_LEVELS,
  CONTROL_TYPES,
  ENFORCEMENT_STATUSES,
  ENFORCEMENT_SURFACES,
  DEFAULT_ENFORCEMENT,
  NO_FEATURE_ENFORCEMENT,
  MODULE_ACCESS_SUBMODULE,
  codeFor,
  defineEntry,
};

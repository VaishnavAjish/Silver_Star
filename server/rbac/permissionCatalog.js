/**
 * RBAC Brick 1 — THE canonical permission catalog.
 *
 * This module is the single source of truth for permission METADATA:
 * grouping, labels, applicable actions, lifecycle status, risk and per-surface
 * enforcement. It is deliberately inert.
 *
 * IT IS NOT A PERMISSION ENGINE.
 *   - It never queries the database.
 *   - It never computes an effective mask.
 *   - Nothing in the request path consults it.
 * The one and only engine remains server/utils/permissions.js:
 *   Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 *
 * Consumers (Brick 2+): grouped permission editor, effective-access preview,
 * search/filters, copy-setup preview, enforcement coverage report.
 */

'use strict';

const shared = require('./catalogShared');
const { VIEW_RESTRICTIONS, UNENFORCED_WARNING } = require('./viewRestrictions');

/** Bump on any catalog content change so consumers can cache-bust. */
const CATALOG_VERSION = '1.0.0';

const PERMISSIONS = Object.freeze([
  ...require('./catalog/general'),
  ...require('./catalog/inventory'),
  ...require('./catalog/manufacturing'),
  ...require('./catalog/commerce'),
  ...require('./catalog/accounting'),
  ...require('./catalog/administration'),
]);

/**
 * Structural validation that must hold for every build.
 * Throws on the first violation so a broken catalog can never be served.
 * Returns the catalog so callers can validate-and-use in one expression.
 */
function validateCatalog(permissions = PERMISSIONS) {
  const seenCodes = new Set();
  const groupByCode = new Map();

  for (const entry of permissions) {
    if (seenCodes.has(entry.code)) {
      throw new Error(`[permission-catalog] duplicate code "${entry.code}"`);
    }
    seenCodes.add(entry.code);

    // A code may appear in exactly one business group.
    if (groupByCode.has(entry.code) && groupByCode.get(entry.code) !== entry.business_group) {
      throw new Error(`[permission-catalog] "${entry.code}" claims two business groups`);
    }
    groupByCode.set(entry.code, entry.business_group);

    if (entry.canonical_code && !permissions.some(p => p.code === entry.canonical_code)) {
      throw new Error(
        `[permission-catalog] "${entry.code}" points at unknown canonical_code "${entry.canonical_code}"`
      );
    }
  }
  return permissions;
}

validateCatalog();

/* ── Lookups ───────────────────────────────────────────────────────────────── */

const BY_CODE = new Map(PERMISSIONS.map(p => [p.code, p]));

/** @returns {object|null} the catalog entry for a code, or null. */
function getByCode(code) {
  return BY_CODE.get(code) || null;
}

/**
 * Resolve a raw database module/submodule pair to its catalog entry.
 * Accepts the real '' submodule and normalises it to the __module__ code.
 */
function getByDbKey(module, submodule = '') {
  return getByCode(shared.codeFor(module, submodule));
}

/** @returns {object[]} entries in a business group, in declaration order. */
function getByGroup(group) {
  return PERMISSIONS.filter(p => p.business_group === group);
}

/** Group summary for the endpoint payload — counts never hide inactive entries. */
function getGroups() {
  return shared.BUSINESS_GROUPS.map(name => {
    const entries = getByGroup(name);
    return {
      name,
      permission_count: entries.length,
      active_count:     entries.filter(e => e.status === 'ACTIVE').length,
      inactive_count:   entries.filter(e => e.status !== 'ACTIVE').length,
      subgroups: [...new Set(entries.map(e => e.business_subgroup).filter(Boolean))],
    };
  });
}

/**
 * Per-surface enforcement tally. Deliberately returns the full breakdown —
 * there is no aggregate "secured" flag, because that would hide partial gaps.
 */
function getEnforcementSummary(permissions = PERMISSIONS) {
  const active = permissions.filter(p => p.status === 'ACTIVE');
  const bySurface = {};

  for (const surface of shared.ENFORCEMENT_SURFACES) {
    const counts = {};
    for (const status of shared.ENFORCEMENT_STATUSES) counts[status] = 0;
    for (const entry of active) counts[entry.enforcement[surface]] += 1;
    bySurface[surface] = counts;
  }

  const API_SURFACES = ['api_list', 'api_detail', 'api_create', 'api_edit', 'api_delete'];
  const UNGUARDED = ['AUTHENTICATE_ONLY', 'NOT_ENFORCED', 'NO_ACTIVE_FEATURE'];

  return {
    active_permission_count: active.length,
    by_surface: bySurface,
    // Active entries whose every API surface is unguarded by the resolver.
    api_unguarded_active: active
      .filter(p => API_SURFACES.every(s => UNGUARDED.includes(p.enforcement[s])))
      .map(p => p.code),
  };
}

/** Counts used by the diagnostic view and the endpoint header. */
function getTotals(permissions = PERMISSIONS) {
  const byStatus = {};
  for (const status of shared.STATUSES) {
    byStatus[status] = permissions.filter(p => p.status === status).length;
  }
  return {
    total: permissions.length,
    by_status: byStatus,
    missing_baseline_rows: permissions.filter(p => !p.has_baseline_rows).map(p => p.code),
    module_access_entries: permissions.filter(p => p.backend_submodule === '').map(p => p.code),
  };
}

/** Duplicate-namespace map: canonical code → the legacy codes pointing at it. */
function getDuplicateMap(permissions = PERMISSIONS) {
  const map = {};
  for (const entry of permissions) {
    if (entry.status !== 'DUPLICATE_LEGACY') continue;
    if (!map[entry.canonical_code]) map[entry.canonical_code] = [];
    map[entry.canonical_code].push(entry.code);
  }
  return map;
}

module.exports = {
  CATALOG_VERSION,
  PERMISSIONS,
  VIEW_RESTRICTIONS,
  UNENFORCED_WARNING,

  // Vocabulary re-exported so consumers never redefine it.
  BUSINESS_GROUPS:         shared.BUSINESS_GROUPS,
  STATUSES:                shared.STATUSES,
  RISK_LEVELS:             shared.RISK_LEVELS,
  CONTROL_TYPES:           shared.CONTROL_TYPES,
  ENFORCEMENT_STATUSES:    shared.ENFORCEMENT_STATUSES,
  ENFORCEMENT_SURFACES:    shared.ENFORCEMENT_SURFACES,
  MODULE_ACCESS_SUBMODULE: shared.MODULE_ACCESS_SUBMODULE,
  codeFor: shared.codeFor,

  validateCatalog,
  getByCode,
  getByDbKey,
  getByGroup,
  getGroups,
  getEnforcementSummary,
  getTotals,
  getDuplicateMap,
};

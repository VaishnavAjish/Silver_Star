/**
 * RBAC Brick 8 — route classification vocabulary and entry factory.
 *
 * Every registered endpoint must land in exactly one STATUS. There is no
 * "unclassified", and the coverage test fails the build if a route reaches
 * production without an entry here.
 *
 * This file deliberately mirrors rbac/catalogShared.js `defineEntry`: closed
 * vocabularies, fail fast on an undocumented value, freeze the result. Adding a
 * new status requires adding it here first, so the manifest can never grow a
 * silent sixth state the reports do not count.
 *
 * It does NOT restate catalog metadata. An entry names a catalog code; label,
 * risk, supported actions and enforcement history stay in Brick 1.
 */

'use strict';

const { PERM_BITS } = require('../../../utils/permissions');
const catalog = require('../../../rbac/permissionCatalog');
const { ROLLOUT_GROUPS } = require('../enforcementConfig');

/* ── Status: the six terminal classifications ──────────────────────────────── */

const STATUS = Object.freeze({
  /** A capability check decides. Either a route guard or the handler itself. */
  EFFECTIVE_PERMISSION_ENFORCED: 'EFFECTIVE_PERMISSION_ENFORCED',
  /** Any authenticated user may call it, and that is the intended answer. */
  INTENTIONALLY_AUTHENTICATED_ONLY: 'INTENTIONALLY_AUTHENTICATED_ONLY',
  /** Reachable without a session, by design (login, health, SPA shell). */
  PUBLIC: 'PUBLIC',
  /** authorize('admin', …) is kept because the route is role-identity-specific. */
  LEGACY_ROLE_GUARD: 'LEGACY_ROLE_GUARD',
  /** Registered, but the feature behind it is not live. */
  FEATURE_INACTIVE: 'FEATURE_INACTIVE',
  /** No safe capability mapping exists yet. Strict must not be turned on. */
  SECURITY_BLOCKED: 'SECURITY_BLOCKED',
});

const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/* ── Guard placement ───────────────────────────────────────────────────────── */

const GUARD = Object.freeze({
  /** Brick 8 installs a guard in front of this route's handler chain. */
  ROUTE: 'ROUTE',
  /**
   * The handler already calls the canonical resolver itself, usually because
   * the required capability depends on the request (export vs print) or is a
   * disjunction a single guard cannot express (view OR create). Installing a
   * route guard here would be STRICTER than today's behaviour, which is exactly
   * the silent access loss the rollout exists to prevent.
   */
  HANDLER: 'HANDLER',
  /** No capability guard. Correct for PUBLIC, LEGACY_ROLE_GUARD, BLOCKED. */
  NONE: 'NONE',
});

const ALL_GUARDS = Object.freeze(Object.values(GUARD));

/* ── What guards the route TODAY — the legacy baseline being replaced ──────── */

const LEGACY = Object.freeze({
  NONE: 'NONE',
  AUTHENTICATE_ONLY: 'AUTHENTICATE_ONLY',
  ROLE_STRING: 'ROLE_STRING',
  SUPER_ADMIN_ONLY: 'SUPER_ADMIN_ONLY',
  EFFECTIVE_PERMISSION: 'EFFECTIVE_PERMISSION',
  INVENTORY_SCOPE: 'INVENTORY_SCOPE',
});

const ALL_LEGACY = Object.freeze(Object.values(LEGACY));

/* ── Authority gaps that a capability bit does not answer ──────────────────── */

const AUTHORITY = Object.freeze({
  /** Nothing beyond the capability is required. */
  NONE: 'NONE',
  /**
   * The route needs "may this user act FOR this department/entity", which Brick
   * 5 recorded as not modelled. A capability check alone does not answer it, and
   * Brick 8 does not invent an answer.
   */
  MODEL_MISSING: 'AUTHORITY_MODEL_MISSING',
  /** An existing verified departmental/ownership rule already runs in-handler. */
  IN_HANDLER: 'IN_HANDLER',
});

const ALL_AUTHORITY = Object.freeze(Object.values(AUTHORITY));

/* ── Factory ───────────────────────────────────────────────────────────────── */

function fail(key, message) {
  throw new Error(`[rbac-route-manifest] ${key}: ${message}`);
}

/**
 * @param {string} method
 * @param {string} path       the Express PATTERN, e.g. /api/inventory/:id
 * @param {object} spec
 * @param {string} spec.status      one of STATUS
 * @param {string} [spec.group]     one of ROLLOUT_GROUPS (omit for PUBLIC)
 * @param {string} [spec.guard]     one of GUARD; defaults from status
 * @param {string} [spec.module]    role_permissions.module
 * @param {string} [spec.submodule] role_permissions.submodule ('' = module access)
 * @param {string} [spec.action]    a PERM_BITS key
 * @param {string} spec.legacy      one of LEGACY — what guards it today
 * @param {string} spec.reason      why this classification. Required, always.
 * @param {string} [spec.authority] one of AUTHORITY
 * @param {string[]} [spec.notes]
 */
function defineRoute(method, path, spec) {
  const key = `${String(method).toUpperCase()} ${path}`;

  if (!ALL_STATUSES.includes(spec.status)) {
    fail(key, `invalid status "${spec.status}"`);
  }
  if (!ALL_LEGACY.includes(spec.legacy)) {
    fail(key, `invalid legacy baseline "${spec.legacy}"`);
  }
  if (!String(spec.reason || '').trim()) {
    fail(key, 'reason is required for every classification');
  }

  const guard = spec.guard || (
    spec.status === STATUS.EFFECTIVE_PERMISSION_ENFORCED ? GUARD.ROUTE : GUARD.NONE
  );
  if (!ALL_GUARDS.includes(guard)) fail(key, `invalid guard "${guard}"`);

  const authority = spec.authority || AUTHORITY.NONE;
  if (!ALL_AUTHORITY.includes(authority)) fail(key, `invalid authority "${authority}"`);

  const needsCapability = spec.status === STATUS.EFFECTIVE_PERMISSION_ENFORCED;
  let capability = null;

  if (needsCapability) {
    if (spec.module === undefined || spec.submodule === undefined || !spec.action) {
      fail(key, 'EFFECTIVE_PERMISSION_ENFORCED requires module, submodule and action');
    }
    if (PERM_BITS[spec.action] === undefined) {
      fail(key, `action "${spec.action}" is not a PERM_BITS key`);
    }
    const entry = catalog.getByDbKey(spec.module, spec.submodule);
    if (!entry) {
      fail(key, `no catalog entry for ${spec.module}/${spec.submodule || "''"}`);
    }
    if (!entry.supported_actions.includes(spec.action)) {
      fail(
        key,
        `catalog entry ${entry.code} does not support action "${spec.action}" ` +
          `(supported: ${entry.supported_actions.join(', ')})`,
      );
    }
    if (entry.status === 'DUPLICATE_LEGACY') {
      fail(
        key,
        `${entry.code} is DUPLICATE_LEGACY — use the canonical code ` +
          `"${entry.canonical_code}" instead`,
      );
    }
    capability = entry.code;
  } else if (spec.module !== undefined || spec.action !== undefined) {
    fail(key, `status ${spec.status} must not carry a capability mapping`);
  }

  if (guard !== GUARD.NONE && !needsCapability) {
    fail(key, `status ${spec.status} cannot install a ${guard} guard`);
  }

  if (spec.status === STATUS.PUBLIC) {
    if (spec.group) fail(key, 'PUBLIC routes have no rollout group');
  } else if (!ROLLOUT_GROUPS.includes(spec.group)) {
    fail(key, `invalid rollout group "${spec.group}"`);
  }

  return Object.freeze({
    key,
    method: String(method).toUpperCase(),
    path,
    status: spec.status,
    guard,
    group: spec.group || null,
    module: needsCapability ? spec.module : null,
    submodule: needsCapability ? spec.submodule : null,
    action: needsCapability ? spec.action : null,
    capability,
    legacy: spec.legacy,
    authority,
    mutation: !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()),
    reason: spec.reason,
    notes: Object.freeze([...(spec.notes || [])]),
  });
}

/**
 * The same handler published under several prefixes — `app.use(['/api/journal',
 * '/api/journal-entries', '/api/general-ledger'], …)` and friends. Each alias is
 * a genuinely reachable URL and gets its own entry, so none can be forgotten.
 */
function defineRoutes(methods, paths, spec) {
  const out = [];
  for (const method of [].concat(methods)) {
    for (const path of [].concat(paths)) out.push(defineRoute(method, path, spec));
  }
  return out;
}

module.exports = {
  STATUS,
  GUARD,
  LEGACY,
  AUTHORITY,
  ALL_STATUSES,
  ALL_GUARDS,
  ALL_LEGACY,
  ALL_AUTHORITY,
  defineRoute,
  defineRoutes,
};

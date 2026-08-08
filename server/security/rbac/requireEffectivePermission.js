/**
 * RBAC Brick 8 — the one route authorization guard.
 *
 * WHAT THIS DOES NOT DO
 * ──────────────────────
 * It does not implement permission algebra. The single engine remains
 * server/utils/permissions.js:
 *     Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 * with the Super Admin bypass inside that resolver. This file asks the resolver
 * a question and turns the answer into an HTTP outcome.
 *
 * It does not apply data scope. "May this user perform this action at all?" and
 * "which departments' rows may they see?" are different questions with different
 * answers — a user can hold inventory EDIT and still see nothing, or see a lot
 * and hold no EDIT. Department scope stays in services/inventoryAuth.js exactly
 * where it is.
 *
 * It does not model operational or approval authority. Holding `approve` says
 * the user may perform an approval; it does not say for which department. The
 * existing destination and self-approval rules in routes/stockTransfer.js remain
 * the authority on that and are untouched.
 *
 * THE THREE MODES
 * ────────────────
 * LEGACY  return immediately. Zero queries, zero behaviour change. The guard is
 *         one function call on the route stack and nothing else.
 * SHADOW  compute the strict decision, let the request continue, and compare the
 *         strict decision against the response the legacy chain actually
 *         produced. Cannot allow, cannot deny, writes nothing.
 * STRICT  the strict decision is the answer.
 *
 * FAILURE POLICY
 * ───────────────
 * A resolver error under STRICT is 503 SECURITY_CHECK_UNAVAILABLE, never a pass.
 * A database outage must not become an implicit allow, and it must not become a
 * 403 either — the user's permissions did not change, we simply could not read
 * them, and 503 is the only honest answer. This mirrors middleware/auth.js,
 * which answers 503 when it cannot verify a token's security version.
 */

'use strict';

// Imported as a module object, not destructured: the resolver is looked up at
// call time so a test can substitute it, and so this file can never end up
// holding a stale reference to a different implementation than the rest of the
// server is using.
const permissions = require('../../utils/permissions');
const { PERM_BITS } = permissions;
const catalog = require('../../rbac/permissionCatalog');
const config = require('./enforcementConfig');
const telemetry = require('./authorizationTelemetry');
const { logger } = require('../../middleware/logger');

const { DENIAL_REASONS } = telemetry;

/** Stable machine-readable codes. Clients branch on these, not on prose. */
const ERROR_CODES = Object.freeze({
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  SECURITY_CHECK_UNAVAILABLE: 'SECURITY_CHECK_UNAVAILABLE',
});

/* ── Request-scoped resolution cache ───────────────────────────────────────── */

/**
 * A single request can check several capabilities (a guard, then an in-handler
 * `hasPermission`). Each resolver call is two uncached queries, so repeating
 * them within one request is pure waste.
 *
 * The cache lives on the request object and dies with it. It is deliberately
 * NOT a cross-request cache: any TTL would be a window in which a revoked
 * permission still works, and Brick 7 spent its whole budget removing exactly
 * that kind of window from the access token.
 */
const CACHE_KEY = '__rbacPermissionCache';

function maskFor(req, module, submodule) {
  if (!req[CACHE_KEY]) req[CACHE_KEY] = new Map();
  const cache = req[CACHE_KEY];
  const key = `${module} ${submodule}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      permissions.resolveEffectivePermission(req.user.id, module, submodule, req.user.role),
    );
  }
  return cache.get(key);
}

/* ── Strict decision ───────────────────────────────────────────────────────── */

/**
 * Decide as STRICT would, without producing any HTTP outcome.
 *
 * @param {object} req
 * @param {{module:string, submodule:string, action:string}} spec
 * @returns {Promise<{allowed:boolean, reason:string|null, mask:number|null, error:Error|null}>}
 */
async function evaluateStrict(req, spec) {
  if (!req.user || req.user.id === undefined || req.user.id === null) {
    return { allowed: false, reason: DENIAL_REASONS.NO_USER, mask: null, error: null };
  }

  const bit = PERM_BITS[spec.action];
  if (bit === undefined) {
    // An action name that is not a permission bit can never be satisfied. This
    // codebase has shipped at least one of these (`seed_remove_override`), and
    // an unsatisfiable check must read as a denial, not as an accident.
    return { allowed: false, reason: DENIAL_REASONS.UNKNOWN_ACTION, mask: null, error: null };
  }

  const entry = catalog.getByDbKey(spec.module, spec.submodule);
  if (!entry || !entry.supported_actions.includes(spec.action)) {
    return {
      allowed: false,
      reason: DENIAL_REASONS.UNKNOWN_CAPABILITY,
      mask: null,
      error: null,
    };
  }

  let mask;
  try {
    mask = await maskFor(req, spec.module, spec.submodule);
  } catch (err) {
    return { allowed: false, reason: DENIAL_REASONS.RESOLVER_UNAVAILABLE, mask: null, error: err };
  }

  if ((mask & bit) === bit) {
    return { allowed: true, reason: null, mask, error: null };
  }
  return { allowed: false, reason: DENIAL_REASONS.MISSING_BIT, mask, error: null };
}

/* ── Shadow comparison ─────────────────────────────────────────────────────── */

/**
 * A response the legacy chain refused. 401 is included because a legacy
 * `authorize()` answers 401 when there is no user at all; both mean "the caller
 * did not get through".
 */
function legacyAllowedFrom(statusCode) {
  return statusCode !== 401 && statusCode !== 403;
}

function attachShadowComparison(req, res, spec, decision) {
  res.on('finish', () => {
    telemetry.recordShadow({
      method: req.method,
      route: spec.route,
      group: spec.group,
      capability: spec.capability,
      action: spec.action,
      legacyAllowed: legacyAllowedFrom(res.statusCode),
      strictAllowed: decision.allowed,
      reason: decision.reason,
      strictError: decision.error ? decision.error.message : null,
      userId: req.user ? req.user.id : null,
      role: req.user ? req.user.role : null,
      statusCode: res.statusCode,
    });
  });
}

/* ── The guard ─────────────────────────────────────────────────────────────── */

/**
 * Build the middleware for one capability on one route.
 *
 * @param {object} spec
 * @param {string} spec.module      role_permissions.module
 * @param {string} spec.submodule   role_permissions.submodule ('' for module access)
 * @param {string} spec.action      a PERM_BITS key
 * @param {string} spec.group       rollout group from enforcementConfig
 * @param {string} spec.capability  catalog code, for telemetry and errors
 * @param {string} spec.route       route pattern, for telemetry (never a live URL)
 * @returns {import('express').RequestHandler}
 */
function requireEffectivePermission(spec) {
  const frozen = Object.freeze({ ...spec });

  async function rbacEffectivePermissionGuard(req, res, next) {
    const mode = config.getMode(frozen.group);

    // LEGACY is the shipped default and must cost nothing at all.
    if (mode === config.MODES.LEGACY) return next();

    let decision;
    try {
      decision = await evaluateStrict(req, frozen);
    } catch (err) {
      // evaluateStrict already converts resolver failures into a decision, so
      // reaching here is a defect in the guard itself. Under SHADOW it must
      // still not affect the response.
      logger.error('[rbac] permission guard failed', {
        capability: frozen.capability,
        action: frozen.action,
        error: err.message,
      });
      if (mode === config.MODES.SHADOW) return next();
      return res.status(503).json({
        error: 'Security verification is temporarily unavailable. Please retry.',
        code: ERROR_CODES.SECURITY_CHECK_UNAVAILABLE,
      });
    }

    if (mode === config.MODES.SHADOW) {
      attachShadowComparison(req, res, frozen, decision);
      return next();
    }

    /* ── STRICT ── */

    if (decision.reason === DENIAL_REASONS.RESOLVER_UNAVAILABLE) {
      logger.error('[rbac] could not resolve effective permission', {
        capability: frozen.capability,
        action: frozen.action,
        userId: req.user ? req.user.id : null,
        error: decision.error ? decision.error.message : null,
      });
      return res.status(503).json({
        error: 'Security verification is temporarily unavailable. Please retry.',
        code: ERROR_CODES.SECURITY_CHECK_UNAVAILABLE,
      });
    }

    if (decision.reason === DENIAL_REASONS.NO_USER) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!decision.allowed) {
      telemetry.recordDenial({
        group: frozen.group,
        capability: frozen.capability,
        action: frozen.action,
        reason: decision.reason,
        method: req.method,
        route: frozen.route,
        userId: req.user ? req.user.id : null,
        role: req.user ? req.user.role : null,
      });
      // The body names the capability the caller lacks and nothing else. It
      // never reports another user's mask, a hidden department id, or SQL.
      return res.status(403).json({
        error: `Permission denied: ${frozen.module}.${frozen.action}`,
        code: ERROR_CODES.PERMISSION_DENIED,
        module: frozen.module,
        submodule: frozen.submodule,
        action: frozen.action,
      });
    }

    // Handlers that need the mask they were admitted with can read it here
    // instead of resolving a second time.
    req.rbacPermission = {
      capability: frozen.capability,
      module: frozen.module,
      submodule: frozen.submodule,
      action: frozen.action,
      mask: decision.mask,
    };
    return next();
  }

  /* Own enumerable properties survive the express-async-errors wrapper (it copies
     them), which is what lets tests and the coverage report find the guard on a
     built route stack — `handle.name` there is always the wrapper's. */
  rbacEffectivePermissionGuard.__rbacGuard = frozen;
  return rbacEffectivePermissionGuard;
}

module.exports = {
  ERROR_CODES,
  CACHE_KEY,
  requireEffectivePermission,
  evaluateStrict,
  legacyAllowedFrom,
};

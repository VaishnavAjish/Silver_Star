'use strict';

/**
 * RBAC Brick 7 — stable, machine-readable error contracts for security writes.
 *
 * WHY CODES AND NOT MESSAGES
 *   The client must be able to tell "your admin edit lost a race" (409, keep the
 *   unsaved edits, offer Reload) apart from "your session is no longer valid"
 *   (401, clear auth, go to login). Branching on English prose would break the
 *   moment a message is reworded, so every branch the client takes is keyed on
 *   `code`. The message stays free to change.
 *
 * HTTP SEMANTICS USED HERE
 *   401  the caller's own session is not (or is no longer) valid
 *   403  authenticated, but not permitted — unchanged, owned by existing code
 *   409  the write's precondition failed: someone else changed this first
 *   503  the security precondition could not be evaluated at all
 *
 * NOTE ON 503: a database outage must not read as "your session was revoked".
 * Answering 401 there would log every user out on an infrastructure blip, and
 * answering 200 would grant access without checking. 503 is the honest answer
 * and the client leaves the session alone.
 */

/** Every code the API is allowed to emit. Frozen so a typo cannot invent one. */
const SECURITY_ERROR_CODES = Object.freeze({
  /* 409 — stale administrative write. The named domain is the one that moved. */
  STALE_PERMISSION_VERSION: 'STALE_PERMISSION_VERSION',
  STALE_INVENTORY_SCOPE: 'STALE_INVENTORY_SCOPE',
  STALE_ROLE_ASSIGNMENT: 'STALE_ROLE_ASSIGNMENT',
  STALE_ROLE_PERMISSIONS: 'STALE_ROLE_PERMISSIONS',
  STALE_COPY_PREVIEW: 'STALE_COPY_PREVIEW',

  /* 401 — the caller's own access token is no longer usable. */
  SESSION_INVALIDATED: 'SESSION_INVALIDATED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  /* 503 — the check itself could not run. */
  SECURITY_CHECK_UNAVAILABLE: 'SECURITY_CHECK_UNAVAILABLE',
});

const STALE_CODES = Object.freeze([
  SECURITY_ERROR_CODES.STALE_PERMISSION_VERSION,
  SECURITY_ERROR_CODES.STALE_INVENTORY_SCOPE,
  SECURITY_ERROR_CODES.STALE_ROLE_ASSIGNMENT,
  SECURITY_ERROR_CODES.STALE_ROLE_PERMISSIONS,
  SECURITY_ERROR_CODES.STALE_COPY_PREVIEW,
]);

/**
 * Base class. `httpStatus` travels with the error so a route never has to
 * remember which status a given code maps to.
 */
class SecurityError extends Error {
  constructor(code, message, { httpStatus = 400, details = null } = {}) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    /* Marks this as a deliberate, client-facing refusal rather than a crash, so
       the existing generic 500 handlers can let it through untouched. */
    this.isSecurityError = true;
  }
}

/**
 * A full-replacement write whose precondition no longer holds.
 *
 * `expected` and `actual` are opaque fingerprints, never the underlying rows: a
 * 409 body must not become a side channel that leaks another administrator's
 * pending permission configuration to a caller who was not allowed to read it.
 */
class StaleWriteError extends SecurityError {
  constructor(code, message, { expected = null, actual = null, domain = null } = {}) {
    super(code, message, { httpStatus: 409, details: { domain, expected, actual } });
    this.name = 'StaleWriteError';
    this.expected = expected;
    this.actual = actual;
    this.domain = domain;
  }
}

/** The caller's own token is no longer valid. Always 401. */
class SessionInvalidError extends SecurityError {
  constructor(code = SECURITY_ERROR_CODES.SESSION_INVALIDATED, message = 'Session is no longer valid') {
    super(code, message, { httpStatus: 401 });
    this.name = 'SessionInvalidError';
  }
}

function isSecurityError(err) {
  return Boolean(err && err.isSecurityError === true);
}

function isStaleWriteError(err) {
  return isSecurityError(err) && STALE_CODES.includes(err.code);
}

/**
 * Render a SecurityError onto a response. Returns true when it handled the
 * error, so a catch block reads:
 *
 *   catch (err) {
 *     if (sendSecurityError(res, err)) return;
 *     ...existing 500 handling, entirely unchanged...
 *   }
 *
 * Anything that is not a SecurityError is left to the existing handler, which is
 * what keeps this additive.
 */
function sendSecurityError(res, err) {
  if (!isSecurityError(err)) return false;
  const body = { error: err.message, code: err.code };
  if (err.details && err.details.domain) body.domain = err.details.domain;
  res.status(err.httpStatus).json(body);
  return true;
}

module.exports = {
  SECURITY_ERROR_CODES,
  STALE_CODES,
  SecurityError,
  StaleWriteError,
  SessionInvalidError,
  isSecurityError,
  isStaleWriteError,
  sendSecurityError,
};

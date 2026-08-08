const jwt = require('jsonwebtoken');
const securityConfig = require('../config/security');
const pool = require('../db/pool');
const { logger } = require('./logger');
const {
  TOKEN_VERSION_CLAIM,
  readAuthState,
  isMissingSchemaError,
} = require('../services/security/securityVersionService');
const { SECURITY_ERROR_CODES } = require('../services/security/securityErrors');

/**
 * RBAC Brick 7 — access tokens are now revocable.
 *
 * BEFORE THIS CHANGE
 *   `authenticate` was `jwt.verify` and nothing else. With 8-hour access tokens
 *   (config/security.js), an administrator who removed a permission, changed a
 *   role, disabled an account or reset a password affected only the NEXT token.
 *   The token already in the user's browser kept its old authority for the rest
 *   of those 8 hours, and revoking refresh tokens could not touch it, because
 *   the access token was never checked against any stored state.
 *
 * AFTER
 *   Every access token carries `av` — the user's `users.auth_version` at mint
 *   time. This middleware re-reads the stored value and requires equality. A
 *   security change increments it, so tokens minted before the change stop
 *   verifying on the very next request. Enforcement is server-side and needs no
 *   cooperation from the client: ignoring the socket notification, or never
 *   calling /refresh, does not preserve stale authority.
 *
 * THE ADDED COST, STATED PLAINLY
 *   One indexed primary-key lookup on `users` per authenticated request, where
 *   there were previously zero queries. Routes guarded by `checkPermission`
 *   already issue two to three uncached queries against `role_permissions` and
 *   `user_permission_overrides` on the same request, so this is a small addition
 *   there and the only database cost on unguarded routes. No cache is used: a
 *   cache TTL would be a window during which a revoked token still works, and
 *   this middleware would then be unable to honestly claim immediate revocation.
 *
 * FAILURE POLICY — THE THREE CASES ARE DELIBERATELY DIFFERENT
 *   version mismatch    401 SESSION_INVALIDATED         the token really is dead
 *   database error      503 SECURITY_CHECK_UNAVAILABLE  we could not tell
 *   migration missing   pass through, unverified        schema is not there yet
 *
 *   Answering 401 for a database blip would log every user out during a brief
 *   outage; answering 200 would grant access without checking. 503 says what is
 *   true — the precondition could not be evaluated — and the client leaves the
 *   session alone instead of clearing it.
 */

/**
 * Master switch. Default ON. Setting AUTH_ENFORCE_TOKEN_VERSION=false restores
 * the exact pre-Brick-7 behaviour without a code change or a schema rollback,
 * which is the fast lever if enforcement misbehaves in production.
 */
const ENFORCE_TOKEN_VERSION = process.env.AUTH_ENFORCE_TOKEN_VERSION !== 'false';

/**
 * Legacy transition. Default OFF, and that default is an intentional, documented
 * deployment decision.
 *
 * Tokens minted by the pre-Brick-7 backend have no `av` claim. Rejecting them
 * would log out every signed-in user at the instant the backend is deployed. So
 * by default a claimless token is accepted for the remainder of its own 8-hour
 * lifetime, and the deployment is invisible to users.
 *
 * THE COST OF THAT DEFAULT, EXPLICITLY: during the transition window a user
 * holding a pre-deployment token is NOT protected by session invalidation. An
 * administrator revoking that user's permissions invalidates their refresh
 * token, but their current access token keeps working until it expires.
 *
 * Setting AUTH_REJECT_LEGACY_TOKENS=true closes the window immediately, at the
 * cost of one forced re-login for everyone. The intended rollout is: deploy with
 * the default, then flip this on at a quiet moment — or simply let 8 hours pass,
 * after which no claimless token can still be valid.
 */
const REJECT_LEGACY_TOKENS = process.env.AUTH_REJECT_LEGACY_TOKENS === 'true';

/** Emitted once per process, so the running enforcement posture is greppable. */
let postureLogged = false;
function logPostureOnce() {
  if (postureLogged) return;
  postureLogged = true;
  logger.info('[Auth] Token-version enforcement posture', {
    enforceTokenVersion: ENFORCE_TOKEN_VERSION,
    rejectLegacyTokens: REJECT_LEGACY_TOKENS,
  });
}

function denySession(res, code, message) {
  return res.status(401).json({ error: message, code });
}

// Verify the JWT, then verify it has not been invalidated since it was minted.
async function authenticate(req, res, next) {
  logPostureOnce();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    const token = header.split(' ')[1];
    decoded = jwt.verify(token, securityConfig.jwt.accessSecret);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!ENFORCE_TOKEN_VERSION) {
    req.user = decoded;
    req.authVersionChecked = false;
    return next();
  }

  const claimedVersion = decoded[TOKEN_VERSION_CLAIM];

  if (claimedVersion === undefined || claimedVersion === null) {
    if (REJECT_LEGACY_TOKENS) {
      return denySession(
        res,
        SECURITY_ERROR_CODES.SESSION_INVALIDATED,
        'Your session predates a security update. Please sign in again.',
      );
    }
    req.user = decoded;
    req.authVersionChecked = false;
    return next();
  }

  let state;
  try {
    state = await readAuthState(pool, decoded.id);
  } catch (err) {
    if (isMissingSchemaError(err)) {
      /* The backend is running ahead of its migration. Tokens were minted with
         the fallback version and there is no stored value to compare, so the
         check is skipped rather than failing every request. This is the mirror
         image of securityVersionService.readAuthVersionForToken, and it is what
         makes the migration/backend deployment order recoverable. */
      req.user = decoded;
      req.authVersionChecked = false;
      return next();
    }
    logger.error('[Auth] Could not verify token security version', {
      error: err.message,
      userId: decoded?.id,
    });
    return res.status(503).json({
      error: 'Security verification is temporarily unavailable. Please retry.',
      code: SECURITY_ERROR_CODES.SECURITY_CHECK_UNAVAILABLE,
    });
  }

  if (!state.exists) {
    return denySession(
      res,
      SECURITY_ERROR_CODES.SESSION_INVALIDATED,
      'Your account is no longer available. Please sign in again.',
    );
  }

  if (!state.isActive) {
    /* A disabled account is rejected here as well as by the version bump. The
       bump is what kills the token; this is the backstop for an account
       deactivated by any path that did not go through the invalidation service. */
    return denySession(
      res,
      SECURITY_ERROR_CODES.ACCOUNT_DISABLED,
      'This account has been deactivated.',
    );
  }

  if (Number(claimedVersion) !== state.authVersion) {
    return denySession(
      res,
      SECURITY_ERROR_CODES.SESSION_INVALIDATED,
      'Your access settings changed. Please sign in again.',
    );
  }

  req.user = decoded;
  req.authVersion = state.authVersion;
  req.authVersionChecked = true;
  return next();
}

// Role-based authorization — super_admin bypasses all checks.
//
// UNCHANGED BY BRICK 7. The Super Admin bypass affects the permission RESULT,
// not session validity: a Super Admin whose sessions were invalidated is
// rejected by `authenticate` above before this ever runs.
//
// UNCHANGED BY BRICK 8 EITHER. The returned guard decides exactly as it did
// before. It only carries a `__rbacLegacyGuard` tag so the Brick 8 installer can
// recognise a coarse role-string check and step over it once that capability's
// rollout group reaches STRICT. Without the tag the installer would have to
// identify these closures by position, and a role guard left stacked behind a
// capability guard would veto users holding an explicit per-user ALLOW.
function authorize(...roles) {
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'super_admin' || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
  guard.__rbacLegacyGuard = { kind: 'authorize', roles: [...roles] };
  return guard;
}

/* Lets the Brick 8 installer find the point in a route's stack where req.user
   becomes available, so a capability guard is never inserted ahead of it. */
authenticate.__rbacAuthenticate = true;

module.exports = {
  authenticate,
  authorize,
  ENFORCE_TOKEN_VERSION,
  REJECT_LEGACY_TOKENS,
};

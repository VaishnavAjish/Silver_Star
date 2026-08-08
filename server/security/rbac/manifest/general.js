/**
 * RBAC Brick 8 — route classification: General, Dashboard, session, operations.
 *
 * Rollout group: `general`.
 *
 * The interesting decisions in this file are the ones that are NOT capability
 * checks. Self-service endpoints — your own dashboard layout, your own nav
 * preferences, your own MFA enrolment — operate on `req.user.id` and nothing
 * else. Putting a capability in front of them would let an administrator revoke
 * a user's ability to configure their own screen, which is not a security
 * boundary anybody asked for.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, GUARD, LEGACY, AUTHORITY } = require('./defineRoute');

const SELF_SERVICE = "Operates only on req.user.id; there is no other user's data to reach.";

module.exports = [
  /* ── Unauthenticated by design ─────────────────────────────────────────── */

  defineRoute('GET', '/api/health', {
    status: STATUS.PUBLIC,
    legacy: LEGACY.NONE,
    reason: 'Load-balancer and container probe. Returns liveness and a database up/down flag only.',
  }),
  defineRoute('POST', '/api/auth/login', {
    status: STATUS.PUBLIC,
    legacy: LEGACY.NONE,
    reason: 'Credential exchange — the endpoint that creates a session cannot require one.',
  }),
  defineRoute('POST', '/api/auth/refresh', {
    status: STATUS.PUBLIC,
    legacy: LEGACY.NONE,
    reason: 'Authenticates by refresh cookie, not by access token. Brick 7 owns its revocation checks.',
  }),
  defineRoute('POST', '/api/auth/logout', {
    status: STATUS.PUBLIC,
    legacy: LEGACY.NONE,
    reason: 'Clears the refresh cookie. Must succeed for a caller whose access token has already expired.',
  }),
  defineRoute('GET', '*', {
    status: STATUS.PUBLIC,
    legacy: LEGACY.NONE,
    reason: 'SPA shell fallback. Serves index.html for non-/api paths; carries no data.',
  }),

  /* ── The one unauthenticated endpoint that should not exist ────────────── */

  defineRoute('GET', '/api/auth/fix-qty-2', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'general',
    legacy: LEGACY.NONE,
    reason:
      'A one-off data-repair route left in place. It sits under /api/auth, which app.js excludes ' +
      'from the global authenticate middleware, and it declares no route-level guard — so it is ' +
      'reachable with no session at all. It has no capability mapping because it should be deleted, ' +
      'not permissioned.',
    notes: [
      'Introduced by commit 493476b "move fix route to auth.js to bypass global api authentication".',
      'Brick 8 does not remove it: deletion is a behaviour change outside an enforcement brick.',
      'RECOMMENDED BEFORE ANY STRICT ROLLOUT: delete the route.',
    ],
  }),

  /* ── Self-service session endpoints ────────────────────────────────────── */

  defineRoute('GET', '/api/auth/me', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Returns the caller's own identity and effective permissions. " + SELF_SERVICE,
  }),
  ...defineRoutes(['POST'], ['/api/auth/mfa/setup', '/api/auth/mfa/verify'], {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Second-factor enrolment for the caller's own account. " + SELF_SERVICE,
  }),
  ...defineRoutes(['GET'], ['/api/me/preferences', '/api/me/access'], {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Reads the caller's own navigation preferences and access summary. " + SELF_SERVICE,
  }),
  defineRoute('PUT', '/api/me/preferences', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Writes the caller's own navigation preferences. " + SELF_SERVICE,
  }),

  /* ── Dashboard ─────────────────────────────────────────────────────────── */

  defineRoute('GET', '/api/dashboard', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "The caller's own saved dashboard layout. " + SELF_SERVICE,
  }),
  defineRoute('POST', '/api/dashboard', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Saves the caller's own dashboard layout. " + SELF_SERVICE,
  }),
  defineRoute('POST', '/api/dashboard/refresh', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: "Recomputes the caller's own widget data. Reads nothing the widgets themselves do not gate.",
  }),
  ...defineRoutes(
    ['GET'],
    ['/api/dashboard/catalog', '/api/dashboard/widgets', '/api/dashboard/widget/:key'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'general',
      guard: GUARD.HANDLER,
      module: 'dashboard',
      submodule: 'dashboard',
      action: 'view',
      legacy: LEGACY.EFFECTIVE_PERMISSION,
      reason:
        'routes/dashboard.js isEntryAuthorized() already resolves a per-widget mask through ' +
        "getUserPermissionBitmask for the widget's own module/submodule. A single route-level " +
        'capability would be coarser than what already runs and could hide widgets a user is ' +
        'entitled to.',
      notes: ['Per-widget capability resolution lives in routes/dashboard.js isEntryAuthorized().'],
    },
  ),
  defineRoute('GET', '/api/dashboard/operator-summary', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'general',
    module: 'dashboard',
    submodule: 'dashboard',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Aggregated operator figures. Dashboard VIEW is the correct gate for a dashboard panel.',
  }),

  /* ── Clipboard ─────────────────────────────────────────────────────────── */

  defineRoute('GET', '/api/clipboard', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'general',
    module: 'clipboard',
    submodule: 'clipboard',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Reads the clipboard list.',
  }),
  defineRoute('POST', '/api/clipboard', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'general',
    module: 'clipboard',
    submodule: 'clipboard',
    action: 'create',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Pins an entity to the clipboard.',
  }),
  ...defineRoutes(['DELETE'], ['/api/clipboard', '/api/clipboard/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'general',
    module: 'clipboard',
    submodule: 'clipboard',
    action: 'delete',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Removes clipboard entries.',
  }),
  defineRoute('POST', '/api/clipboard/bulk-action', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'general',
    legacy: LEGACY.ROLE_STRING,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'One endpoint, several unrelated effects chosen by a body field. Most branches only build a ' +
      'redirect URL, but `mark_as_paid` writes invoices.payment_status directly and guards itself ' +
      'with an inline `req.user.role !== "admin"` string check. No single capability describes the ' +
      'endpoint: the honest mapping is sales.invoice EDIT for that one branch, which requires ' +
      'splitting the route.',
    notes: [
      'routes/clipboard.js — the mark_as_paid branch bypasses the invoice module entirely.',
      'RECOMMENDED: split mark_as_paid onto the invoices router, then classify as sales.invoice EDIT.',
    ],
  }),

  /* ── Cross-module search ───────────────────────────────────────────────── */

  defineRoute('GET', '/api/search', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'general',
    module: 'dashboard',
    submodule: 'dashboard',
    action: 'view',
    legacy: LEGACY.INVENTORY_SCOPE,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'Global search already narrows inventory results through loadDeptScope, so department ' +
      'visibility is applied. The capability gate here is only "may this user use the application ' +
      'shell at all" — per-module filtering of results stays where it is.',
    notes: [
      'routes/search.js:24 applies the canonical department scope.',
      'OPEN: search spans modules the caller may lack VIEW on; per-module result filtering is not ' +
        'implemented and is recorded as a follow-up, not silently fixed here.',
    ],
  }),

  /* ── Background jobs ───────────────────────────────────────────────────── */

  defineRoute('GET', '/api/jobs/:id', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Polls the status of a queued job by id. Returns progress and completion state, not the ' +
      "job's result payload.",
    notes: ['OPEN: job ids are not scoped to their submitter. Enumeration reveals job existence only.'],
  }),

  /* ── Operational endpoints ─────────────────────────────────────────────── */

  defineRoute('GET', '/api/health/detailed', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Uptime, memory and correlation id for internal monitoring. No business data.',
  }),
  defineRoute('GET', '/api/ws/stats', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'WebSocket connection counters. No business data.',
  }),
  ...defineRoutes(['GET'], ['/metrics', '/api/metrics', '/api/metrics/bridges'], {
    status: STATUS.LEGACY_ROLE_GUARD,
    group: 'general',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Prometheus and bridge metrics are an operator-identity surface, not a business capability. ' +
      'There is no catalog entry for "may read process metrics", and inventing one would put an ' +
      'operations control into a business permission editor.',
    notes: ['KEEP AS ROLE IDENTITY — reviewed and intentional.'],
  }),
  defineRoute('POST', '/api/cache/flush', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Any authenticated user can evict the entire application cache. It is a denial-of-service ' +
      'lever rather than a data exposure, but it is a mutation with no guard and no catalog ' +
      'capability that describes it.',
    notes: ['RECOMMENDED: move behind the same operator-identity guard as /api/metrics.'],
  }),
  defineRoute('POST', '/api/admin/logger/frontend-logs', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'general',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'The browser posts its own console errors here. Every authenticated client must be able to ' +
      'write to it; reading the buffer back is separately guarded.',
  }),
];

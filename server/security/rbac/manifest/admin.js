/**
 * RBAC Brick 8 — route classification: Administration.
 *
 * Rollout group: `admin`. Last in the recommended activation order.
 *
 * THE LOCK-OUT PROBLEM, STATED PLAINLY
 * ─────────────────────────────────────
 * Brick 1 recorded that the whole Admin Panel is gated on the ROLE STRING and
 * never on a bitmask: "granting or revoking admin.users bits changes nothing".
 * Turning that around is the point of this group, and it is also the one place
 * where getting it wrong removes the surface that would fix it.
 *
 * Two things make that survivable:
 *
 *   1. Super Admin bypass is inside the resolver, which returns the full mask
 *      before any role or override row is read. A Super Admin therefore passes
 *      every guard in this file even if every permission row in the database is
 *      deleted. That is the bootstrap path, and Brick 8 does not touch it.
 *   2. admin.users and admin.roles both have seeded baseline rows, so an ordinary
 *      administrator does not lose the panel the moment STRICT is enabled — in
 *      contrast to, say, management.cost_centres, which has none.
 *
 * The Super Admin bypass is a PERMISSION bypass and not a SESSION bypass. A
 * Super Admin whose auth_version was bumped, or whose account was disabled, is
 * rejected by middleware/auth.js long before any of these guards run.
 *
 * THE THREE MOUNT PREFIXES
 * ─────────────────────────
 * app.js mounts adminUsers at /api/admin/users and again at /api/admin, and
 * adminPermissions at /api/admin/permissions, /api/permissions and
 * /api/admin/users. Every resulting path is separately reachable and separately
 * classified — /api/permissions/:id/permission-overrides is as real an entry
 * point as its /api/admin twin.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, LEGACY } = require('./defineRoute');

/** adminUsers is reachable under both prefixes; both are live. */
const USER_PREFIXES = ['/api/admin/users/users', '/api/admin/users'];
/** adminPermissions is reachable under three prefixes; all three are live. */
const PERM_PREFIXES = ['/api/admin/permissions', '/api/permissions', '/api/admin/users'];

module.exports = [
  /* ── User administration ───────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/admin/users/users', '/api/admin/users', '/api/auth/users'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'view',
    legacy: LEGACY.ROLE_STRING,
    reason: 'The user list. /api/auth/users returns the same data from the auth router.',
  }),
  ...defineRoutes(['POST'], ['/api/admin/users/users', '/api/admin/users', '/api/auth/register'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Creates a user account. /api/auth/register is the same operation reached through the auth ' +
      'router and is gated identically, so registration is not a way around user administration.',
  }),
  ...defineRoutes(['PUT'], USER_PREFIXES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a user account, including its role assignment.',
  }),
  ...defineRoutes(['PATCH'], USER_PREFIXES.map((p) => `${p}/:id/status`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Enables or disables an account. Brick 7 makes this immediately effective by bumping ' +
      'auth_version, so it terminates live sessions rather than only blocking new logins.',
  }),
  ...defineRoutes(['POST'], USER_PREFIXES.map((p) => `${p}/:id/reset-password`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason:
      "Resetting another user's password is account takeover by design. MANAGE rather than EDIT, " +
      'so it can be withheld from someone who may otherwise maintain user records.',
  }),

  /* ── Effective access, setup summary, copy setup ───────────────────────── */

  ...defineRoutes(
    ['GET'],
    USER_PREFIXES.flatMap((p) => [
      `${p}/:id/effective-access`,
      `${p}/:id/setup-summary`,
      `${p}/:id/copy-setup/preview`,
    ]),
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'users',
      action: 'view',
      legacy: LEGACY.ROLE_STRING,
      reason:
        "Read-only views of another user's resolved access (Bricks 5 and 6). They expose one user's " +
        'complete permission picture to another, so they are gated with the user list.',
    },
  ),
  ...defineRoutes(['POST'], USER_PREFIXES.map((p) => `${p}/:id/copy-setup`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason:
      "Overwrites a user's roles, overrides, preferences and inventory scope from a template user. " +
      'MANAGE: this is the widest single write in the panel.',
  }),

  /* ── Inventory scope administration ────────────────────────────────────── */

  ...defineRoutes(['GET'], USER_PREFIXES.map((p) => `${p}/:id/inventory-scope`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'view',
    legacy: LEGACY.ROLE_STRING,
    reason: "Reads a user's department visibility configuration.",
  }),
  ...defineRoutes(['PUT'], USER_PREFIXES.map((p) => `${p}/:id/inventory-scope`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Writes department visibility. This is the control that decides which inventory rows a user ' +
      'can ever see, so it is MANAGE rather than EDIT.',
  }),

  /* ── Permission override administration ────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    PERM_PREFIXES.flatMap((p) => [
      `${p}/:id/permission-overrides`,
      `${p}/:id/permissions`,
      `${p}/:id/preferences`,
    ]),
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'users',
      action: 'view',
      legacy: LEGACY.ROLE_STRING,
      reason: "Reads a user's overrides, resolved permissions and stored preferences.",
    },
  ),
  ...defineRoutes(
    ['PUT'],
    PERM_PREFIXES.flatMap((p) => [
      `${p}/:id/permission-overrides`,
      `${p}/:id/permissions`,
      `${p}/:id/preferences`,
    ]),
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'users',
      action: 'manage',
      legacy: LEGACY.ROLE_STRING,
      reason:
        'Writes per-user allow and deny masks — the controls that decide what everyone else can do. ' +
        'MANAGE is the right grain: editing a user record and rewriting their authority are ' +
        'different powers.',
      notes: [
        'PRESERVED: Brick 3 override algebra and the Brick 7 fingerprint concurrency check both run ' +
          'inside these handlers and are untouched.',
      ],
    },
  ),
  ...defineRoutes(['DELETE'], PERM_PREFIXES.map((p) => `${p}/:id/permission-overrides`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Clears every override for a user, returning them to their role baseline.',
  }),

  /* ── Role administration ───────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/roles',
      '/api/roles/:id/permissions',
      '/api/roles/modules',
      '/api/roles/users-with-roles',
      '/api/roles/users/:id/roles',
      '/api/admin/users/roles',
      '/api/admin/roles',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'roles',
      action: 'view',
      legacy: LEGACY.ROLE_STRING,
      reason: 'Role list, role permission masks, and which users hold which roles.',
    },
  ),
  ...defineRoutes(['POST'], ['/api/roles', '/api/roles/:id/clone'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'roles',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a role, from scratch or by cloning an existing one.',
  }),
  defineRoute('PUT', '/api/roles/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'roles',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Renames or re-describes a role.',
  }),
  defineRoute('PUT', '/api/roles/:id/permissions', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'roles',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason:
      "Rewrites a role's permission mask, changing the baseline for every user holding it. MANAGE, " +
      'not EDIT — renaming a role and re-authorising it are different acts.',
    notes: [
      'PRESERVED: the requireRoleAuthority hierarchy check (canManageRole) runs inside the handler ' +
        'and still prevents an administrator from editing a role above their own.',
    ],
  }),
  defineRoute('DELETE', '/api/roles/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'roles',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes a role.',
  }),
  defineRoute('PUT', '/api/roles/users/:id/roles', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'admin',
    module: 'admin',
    submodule: 'users',
    action: 'manage',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Assigns roles to a user. Deliberately mapped to admin.users MANAGE rather than admin.roles: ' +
      "the object being changed is the user's authority, not the role's definition.",
  }),

  /* ── Audit logs ────────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/audit-logs/overview', '/api/audit-logs/user/:userId', '/api/roles/audit-log'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'audit_logs',
      action: 'view',
      legacy: LEGACY.ROLE_STRING,
      reason:
        'Audit trails, whether served from the audit-logs router or the role router. Brick 1 noted ' +
        'that /api/audit-logs was authenticate-only in an earlier revision; it now carries a role ' +
        'guard, and STRICT replaces that with the audit_logs capability.',
    },
  ),

  /* ── Permission catalog (read-only) ────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/admin/permission-catalog', '/api/admin/permission-catalog/diagnostics'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'admin',
      module: 'admin',
      submodule: 'roles',
      action: 'view',
      legacy: LEGACY.ROLE_STRING,
      reason:
        'The Brick 1 catalog and its diagnostics. It describes the permission model rather than any ' +
        "user's access, so it is gated with role viewing.",
    },
  ),

  /* ── System logger ─────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/admin/logger/backend-logs',
      '/api/admin/logger/frontend-logs',
      '/api/admin/logger/migrations',
    ],
    {
      status: STATUS.LEGACY_ROLE_GUARD,
      group: 'admin',
      legacy: LEGACY.SUPER_ADMIN_ONLY,
      reason:
        'Raw server logs and migration state. This is an operator-identity surface with no catalog ' +
        'capability, and putting server logs into a business permission editor would be the wrong ' +
        'control.',
      notes: [
        'MISNAMED GUARD: routes/adminLogger.js `superAdminOnly` admits any role containing "super" ' +
          'OR the exact role "admin", so plain administrators pass a guard whose name and error ' +
          'message both say Super Admin only. Recorded, not changed — narrowing it would remove ' +
          'access somebody has today.',
      ],
    },
  ),
  defineRoute('DELETE', '/api/admin/logger/clear', {
    status: STATUS.LEGACY_ROLE_GUARD,
    group: 'admin',
    legacy: LEGACY.SUPER_ADMIN_ONLY,
    reason:
      'Clears the in-memory log buffer. Same operator-identity surface as reading it, and subject ' +
      'to the same misnamed-guard note above.',
  }),
];

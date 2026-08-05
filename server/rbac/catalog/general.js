/**
 * Catalog data — GENERAL & DASHBOARD.
 *
 * Verified against:
 *   client/src/core/navigation/registry.js   (sidebar entries `dashboard`, `clipboard`)
 *   client/src/modules/dashboard/routes.js   (index route — no <PermissionGuard>)
 *   server/routes/dashboard.js               (isEntryAuthorized, line 30)
 *   server/routes/clipboard.js               (authenticate only)
 *   server/migrations/phase35-rbac.sql       (dashboard module-level '' rows)
 */

'use strict';

const { defineEntry } = require('../catalogShared');

module.exports = [
  defineEntry({
    module: 'dashboard', submodule: '',
    group: 'General & Dashboard',
    label: 'Dashboard (module access)',
    description: 'Legacy module-wide dashboard baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'LOW',
    control: 'MODULE_ACCESS',
    actions: ['view'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Nothing reads dashboard:'' directly; the sidebar uses dashboard.dashboard.
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/migrations/phase35-rbac.sql:83'],
    notes: [
      'Seeded for operator and viewer only (mask 1). Admin/Super Admin have no \'\' row.',
      'AuthContext.hasPermission falls back to the module-level row when a submodule row is absent.',
    ],
  }),

  defineEntry({
    module: 'dashboard', submodule: 'dashboard',
    group: 'General & Dashboard',
    label: 'Dashboard',
    description: 'Home dashboard: KPI widgets, shortcuts and quick-create tiles.',
    status: 'ACTIVE',
    risk: 'LOW',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar'],
    enforcement: {
      navigation: 'ENFORCED',
      // dashboard/routes.js index route carries no requirePermission.
      frontend_route: 'NOT_ENFORCED',
      // GET /api/dashboard/catalog filters shortcuts/widgets through the
      // resolver; every other dashboard endpoint is authenticate-only.
      api_list: 'PARTIALLY_ENFORCED',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:30',
      'client/src/modules/dashboard/routes.js',
    ],
    backendRefs: ['server/routes/dashboard.js:30', 'server/routes/dashboard.js:63'],
    notes: [
      'server/routes/dashboard.js:31 short-circuits the dashboard and clipboard entries to always-authorized inside the catalog filter.',
      'No dashboard export endpoint exists, so no export action is catalogued.',
    ],
  }),

  defineEntry({
    module: 'clipboard', submodule: 'clipboard',
    group: 'General & Dashboard',
    label: 'Clipboard',
    description: 'Personal staging clipboard for lots and documents.',
    status: 'ACTIVE',
    risk: 'LOW',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'delete'],
    enforcement: {
      navigation: 'ENFORCED',
      // Mounted directly in client/src/router/index.jsx with no guard.
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY',
      api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY',
      api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'AUTHENTICATE_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:31',
      'client/src/router/index.jsx:110',
    ],
    backendRefs: ['server/routes/clipboard.js:16'],
    notes: [
      'The clipboard module has no submodule = \'\' baseline row; only clipboard.clipboard is seeded.',
      'Clipboard rows are already scoped to the calling user id inside the handlers.',
    ],
  }),
];

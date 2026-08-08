/**
 * RBAC Brick 8 — route classification: master data.
 *
 * Rollout group: `master_data`.
 *
 * These endpoints exist in no route file. `createMasterRouter` in
 * routes/masterFactory.js builds a fresh router per table at startup, so the
 * only way to enumerate them is to read the built router tree — which is what
 * routeIntrospection.js does, and why a grep-based audit would have missed the
 * whole group.
 *
 * CANONICAL KEYS ONLY
 * ────────────────────
 * Brick 1 records two namespaces for this data: `management.*` (ACTIVE) and both
 * `manufacturing.*` and `master_data.*` (DUPLICATE_LEGACY and LEGACY_ORPHAN).
 * Every mapping here uses `management.*`. defineRoute refuses a DUPLICATE_LEGACY
 * code outright, so the duplicate namespaces cannot be reintroduced by accident.
 *
 * BULK UPLOAD IS CREATE
 * ──────────────────────
 * PERM_BITS has an `import` bit, but no management.* entry lists `import` among
 * its supported actions. Using it would mean inventing a capability. Bulk upload
 * creates rows, so it is mapped to CREATE — the same authority as adding them
 * one at a time, which is what it does.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, LEGACY } = require('./defineRoute');

/**
 * The six endpoints every master router publishes, mapped onto one catalog code.
 */
function masterCrud(prefix, submodule, label) {
  return [
    ...defineRoutes(['GET'], [prefix, `${prefix}/:id`], {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'master_data',
      module: 'management',
      submodule,
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: `${label} list and detail. Authenticate-only today.`,
    }),
    ...defineRoutes(['POST'], [prefix, `${prefix}/bulk-upload`], {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'master_data',
      module: 'management',
      submodule,
      action: 'create',
      legacy: LEGACY.ROLE_STRING,
      reason:
        `Creates ${label} rows, singly or by spreadsheet upload. Bulk upload is CREATE because ` +
        'that is what it does; no management.* capability declares an `import` action.',
    }),
    defineRoute('PUT', `${prefix}/:id`, {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'master_data',
      module: 'management',
      submodule,
      action: 'edit',
      legacy: LEGACY.ROLE_STRING,
      reason: `Edits a ${label} row.`,
    }),
    defineRoute('DELETE', `${prefix}/:id`, {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'master_data',
      module: 'management',
      submodule,
      action: 'delete',
      legacy: LEGACY.ROLE_STRING,
      reason: `Deletes a ${label} row. Referenced rows are protected by foreign keys, not by this.`,
    }),
  ];
}

module.exports = [
  ...masterCrud('/api/items', 'items_master', 'Item master'),
  ...masterCrud('/api/departments', 'departments', 'Department'),
  ...masterCrud('/api/locations', 'locations', 'Location'),
  ...masterCrud('/api/machines', 'machines', 'Machine'),
  ...masterCrud('/api/uom', 'uom', 'Unit of measure'),
  ...masterCrud('/api/expense-categories', 'expense_categories', 'Expense category'),

  /* ── Fixed asset categories: same shape, different router ──────────────── */

  ...defineRoutes(['GET'], ['/api/fixed-asset-categories', '/api/fixed-asset-categories/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'master_data',
    module: 'management',
    submodule: 'asset_categories',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Fixed asset category list and detail.',
  }),
  defineRoute('POST', '/api/fixed-asset-categories', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'master_data',
    module: 'management',
    submodule: 'asset_categories',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a fixed asset category, which carries the depreciation defaults.',
  }),
  defineRoute('PUT', '/api/fixed-asset-categories/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'master_data',
    module: 'management',
    submodule: 'asset_categories',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a fixed asset category, changing depreciation for every asset that uses it.',
  }),
  defineRoute('DELETE', '/api/fixed-asset-categories/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'master_data',
    module: 'management',
    submodule: 'asset_categories',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes a fixed asset category.',
  }),

  /* ── The unnamed generic master router ─────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/master', '/api/master/:id'], {
    status: STATUS.SECURITY_BLOCKED,
    group: 'master_data',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'app.js mounts createMasterRouter("master") — a generic router over a table literally named ' +
      '`master`, with no column allow-list and no catalog capability describing what it holds. ' +
      'Nothing can be mapped honestly until it is established what this table is and whether the ' +
      'mount is still wanted.',
    notes: ['RECOMMENDED: identify or remove the /api/master mount before any strict rollout.'],
  }),
  ...defineRoutes(['POST'], ['/api/master', '/api/master/bulk-upload'], {
    status: STATUS.SECURITY_BLOCKED,
    group: 'master_data',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Writes to the same unidentified generic table. Remains guarded by ' +
      'authorize("admin", "operator").',
  }),
  defineRoute('PUT', '/api/master/:id', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'master_data',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Writes to the same unidentified generic table.',
  }),
  defineRoute('DELETE', '/api/master/:id', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'master_data',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes from the same unidentified generic table.',
  }),
];

/**
 * RBAC Brick 8 — route classification: Fixed Assets and Reports.
 *
 * Rollout groups: `assets`, `reports`.
 *
 * NINETEEN REPORT ENDPOINTS, NO PERMISSION CHECK
 * ───────────────────────────────────────────────
 * Every GET under /api/reports is `authenticate` and nothing else. The one place
 * that does consult a capability is POST /api/reports/export, whose
 * isAuthorizedForReport() resolves per-report VIEW. So today a user who cannot
 * export the Trial Balance can still fetch the same numbers from
 * GET /api/reports/trial-balance. STRICT closes that.
 *
 * NO CREATE, EDIT OR DELETE ANYWHERE IN THIS GROUP
 * ─────────────────────────────────────────────────
 * Reports are mapped to VIEW and EXPORT only. A report endpoint that appeared to
 * need `create` would be a sign it is not a report.
 *
 * CANONICAL KEYS FOR THE ASSET REPORTS
 * ─────────────────────────────────────
 * reports.fixed_asset_register, reports.depreciation_schedule and
 * reports.bank_reconciliation are all DUPLICATE_LEGACY in Brick 1. The asset
 * report routes therefore map to assets.fixed_asset_register and
 * assets.depreciation_schedule. defineRoute rejects the duplicates outright.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, GUARD, LEGACY } = require('./defineRoute');

const GENERIC_REPORT_NOTE =
  'No dedicated catalog capability exists for this report, so it is gated at the Reports ' +
  'module-access level. RECOMMENDED: add a specific capability so it can be granted independently.';

module.exports = [
  /* ── Fixed assets ──────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/fixed-assets', '/api/fixed-assets/:id', '/api/fixed-assets/:id/transactions'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'assets',
      module: 'assets',
      submodule: 'asset_list',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: 'Asset register list, detail and the transactions posted against an asset.',
    },
  ),
  ...defineRoutes(['GET'], ['/api/fixed-assets/:id/schedule', '/api/fixed-assets/:id/wdv'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'depreciation_schedule',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Depreciation schedule and written-down value for one asset. Mapped to the schedule ' +
      'capability rather than the register, because that is the data being returned.',
  }),
  defineRoute('POST', '/api/fixed-assets', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'asset_list',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Capitalises an asset.',
  }),
  defineRoute('PATCH', '/api/fixed-assets/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'asset_list',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits an asset record.',
  }),
  defineRoute('POST', '/api/fixed-assets/:id/dispose', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'asset_list',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Disposal retires the asset and posts the gain or loss. DELETE authority rather than EDIT: ' +
      'taking an asset off the books is not an amendment.',
  }),
  defineRoute('DELETE', '/api/fixed-assets/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'asset_list',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes an asset record.',
  }),

  /* ── Depreciation runs ─────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/depreciation-runs', '/api/depreciation-runs/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'depreciation_runs',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Depreciation run history.',
  }),
  defineRoute('POST', '/api/depreciation-runs/preview', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'depreciation_runs',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Computes what a run would post without posting it. A dry run is a read.',
  }),
  defineRoute('POST', '/api/depreciation-runs', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'assets',
    module: 'assets',
    submodule: 'depreciation_runs',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Posts a depreciation run across the register.',
  }),
  defineRoute('POST', '/api/depreciation-runs/:id/cancel', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'assets',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'assets.depreciation_runs declares view / sidebar / create only. Cancelling a posted run ' +
      'unwinds ledger entries and cannot honestly be expressed as CREATE, which is the only write ' +
      'action the capability has.',
    notes: [
      'Remains guarded by authorize("admin").',
      'RECOMMENDED: add a delete action to assets.depreciation_runs, then reclassify.',
    ],
  }),

  /* ── Asset templates ───────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/asset-templates', '/api/asset-templates/:id'], {
    status: STATUS.SECURITY_BLOCKED,
    group: 'assets',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Asset templates carry the default useful life, salvage value and depreciation method applied ' +
      'to new assets. No catalog capability describes them: assets.asset_list governs asset records, ' +
      'not the templates that shape them.',
    notes: ['RECOMMENDED: add assets.asset_templates to the catalog, then reclassify.'],
  }),
  defineRoute('POST', '/api/asset-templates', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'assets',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Same missing capability. Remains guarded by authorize("admin").',
  }),
  ...defineRoutes(['PATCH', 'DELETE'], ['/api/asset-templates/:id'], {
    status: STATUS.SECURITY_BLOCKED,
    group: 'assets',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Same missing capability. Editing a template changes depreciation for every asset created ' +
      'from it afterwards. Remains guarded by authorize("admin").',
  }),

  /* ── Reports with a dedicated capability ───────────────────────────────── */

  defineRoute('GET', '/api/reports/ledger/:accountId', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'ledger',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Account ledger report.',
  }),
  ...defineRoutes(
    ['GET'],
    [
      '/api/reports/trial-balance',
      '/api/reports/trial-balance-detailed',
      '/api/reports/trial-balance-hierarchy',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'reports',
      module: 'reports',
      submodule: 'trial_balance',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Three presentations of one report. All three are gated identically so a denied user cannot ' +
        'read the summary through the detailed variant.',
    },
  ),
  defineRoute('GET', '/api/reports/pnl', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'profit_loss',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Profit and loss statement.',
  }),
  defineRoute('GET', '/api/reports/balance-sheet', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'balance_sheet',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Balance sheet.',
  }),
  defineRoute('GET', '/api/reports/costing', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'costing_report',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Costing report.',
  }),
  defineRoute('GET', '/api/reports/accounts-receivable', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'accounts_receivable',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Accounts receivable ageing.',
  }),
  defineRoute('GET', '/api/reports/accounts-payable', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'reports',
    submodule: 'accounts_payable',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Accounts payable ageing.',
  }),
  ...defineRoutes(
    ['GET'],
    [
      '/api/reports/pl-by-cost-center',
      '/api/reports/cost-center-transactions',
      '/api/cost-center-reports/trial-balance',
      '/api/cost-center-reports/dashboard',
      '/api/cost-center-reports/report',
      '/api/cost-center-reports/transactions',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'reports',
      module: 'reports',
      submodule: 'cost_center_pl',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Cost-centre reporting, whether served from /api/reports or the dedicated ' +
        '/api/cost-center-reports router. One capability, because it is one report family.',
    },
  ),

  /* ── Asset reports served from the reports router ──────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/reports/fixed-asset-register',
      '/api/reports/fixed-asset-dashboard',
      '/api/reports/fixed-asset-trial-balance',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'reports',
      module: 'assets',
      submodule: 'fixed_asset_register',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'The canonical key is assets.fixed_asset_register; reports.fixed_asset_register is ' +
        'DUPLICATE_LEGACY and must not become independently grantable.',
    },
  ),
  defineRoute('GET', '/api/reports/depreciation-schedule', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    module: 'assets',
    submodule: 'depreciation_schedule',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Canonical key assets.depreciation_schedule; reports.depreciation_schedule is DUPLICATE_LEGACY.',
  }),

  /* ── Reports without a dedicated capability ────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/reports/inventory-valuation',
      '/api/reports/transactions',
      '/api/reports/fund-utilization',
      '/api/reports/fund-utilization/drill-down/:accountId',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'reports',
      module: 'reports',
      submodule: '',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Gated at Reports module access. Module-level VIEW is a real gate — it is what an ' +
        'administrator removes to take somebody out of reporting entirely — but it cannot be ' +
        'granted per report.',
      notes: [GENERIC_REPORT_NOTE],
    },
  ),

  /* ── Export ────────────────────────────────────────────────────────────── */

  defineRoute('POST', '/api/reports/export', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'reports',
    guard: GUARD.HANDLER,
    module: 'reports',
    submodule: '',
    action: 'export',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'One endpoint that serves every registered report, selected by a body field. ' +
      'isAuthorizedForReport() already resolves VIEW for the specific report requested, which is ' +
      'finer than any single route guard could be.',
    notes: [
      'DEFECT RECORDED, NOT FIXED: isAuthorizedForReport falls back to the legacy user_permissions ' +
        'table and then to the hard-coded ROLE_DEFAULTS map (routes/reports.js:40-48). Those are a ' +
        'second and third permission algebra beside the canonical resolver. Removing them changes ' +
        'who can export and is therefore a permission decision, not an enforcement one.',
      'It checks VIEW but never EXPORT, so a user denied EXPORT can still export any report they ' +
        'can view. Recorded for the module owner.',
    ],
  }),

  /* ── Reporting preferences ─────────────────────────────────────────────── */

  defineRoute('GET', '/api/reporting-preferences', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'reports',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Organisation-wide reporting settings — financial year start, rounding, presentation ' +
      'currency. Every client needs them to render correctly any report the caller is entitled to. ' +
      'They contain no business figures.',
  }),
  defineRoute('PUT', '/api/reporting-preferences', {
    status: STATUS.LEGACY_ROLE_GUARD,
    group: 'reports',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Writes organisation-wide reporting configuration. No catalog capability describes it — ' +
      'reports.* entries govern reading reports, not configuring the reporting system.',
    notes: [
      'Guarded today by authorize("admin", "management").',
      'RECOMMENDED: add an admin.settings-style capability, then reclassify.',
    ],
  }),
];

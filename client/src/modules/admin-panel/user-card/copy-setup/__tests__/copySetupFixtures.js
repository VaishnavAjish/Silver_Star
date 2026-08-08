/**
 * RBAC Brick 6 — shared test fixtures.
 *
 * These are shaped exactly like the payload GET
 * /api/admin/users/:id/copy-setup/preview returns, so a test that passes here is
 * a test against the real wire shape. Every identity is invented; no fixture
 * carries a real username, department, template name or credential, and the
 * payload contains no timestamp column because the endpoint selects none.
 */

import { STATUS } from '../../permissions/permissionCatalogModel';

export const ENFORCED_ALL = Object.freeze({
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'ENFORCED',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
});

export function catalogEntry(overrides = {}) {
  const module = overrides.backend_module || 'inventory';
  const submodule = overrides.backend_submodule ?? 'stock_transfer';
  return {
    code: `${module}.${submodule === '' ? '__module__' : submodule}`,
    backend_module: module,
    backend_submodule: submodule,
    business_group: 'Inventory',
    label: 'Stock Transfer',
    description: 'Move lots between departments',
    status: STATUS.ACTIVE,
    risk_level: 'HIGH',
    control_type: 'ACTION_MATRIX',
    supported_actions: ['view', 'approve'],
    has_baseline_rows: true,
    canonical_code: null,
    empty_submodule_meaning: submodule === '' ? 'MODULE_ACCESS' : null,
    enforcement: ENFORCED_ALL,
    notes: [],
    ...overrides,
  };
}

/** Two capabilities: one HIGH risk with approve, one LOW risk view-only. */
export const CATALOG = Object.freeze({
  groups: ['Inventory', 'Accounting'],
  permissions: [
    catalogEntry(),
    catalogEntry({
      backend_module: 'accounting',
      backend_submodule: 'journal_entries',
      business_group: 'Accounting',
      label: 'Journal Entries',
      risk_level: 'LOW',
      supported_actions: ['view'],
    }),
  ],
});

/** Operator baseline: may view both, may not approve transfers. */
export const OPERATOR_ROLE_TREE = [
  { module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: 1 }] },
  { module: 'accounting', submodules: [{ key: 'journal_entries', permissions: 1 }] },
];

export function user(overrides = {}) {
  return {
    id: 2,
    username: 'test.source',
    full_name: 'Test Source',
    role: 'operator',
    is_active: true,
    department_id: 3,
    department_name: 'Growing',
    ...overrides,
  };
}

/**
 * A payload with a deliberate example of every diff kind:
 *   overrides  1 added, 1 changed, 1 removed, 1 unchanged
 *   scope      target SELECTED[3] → source SELECTED[3,4]
 *   prefs      1 added, 1 changed, 1 removed, 1 excluded vis.*, 1 removed vis.*
 *   dashboard  1 added, 1 changed, 1 removed
 *   templates  1 shared, 1 owned, 1 duplicate, 1 removed
 */
export function payload(overrides = {}) {
  return {
    source: user(),
    target: user({
      id: 9,
      username: 'test.target',
      full_name: 'Test Target',
      department_id: 4,
      department_name: 'Polish 2',
    }),
    categories: {
      permissions: {
        semantics: 'REPLACE',
        source: {
          overrides: [
            /* approve (bit 16) — the HIGH-risk grant the impact preview must flag. */
            { module: 'inventory', submodule: 'stock_transfer', allow_mask: 16, deny_mask: 0 },
            { module: 'accounting', submodule: 'journal_entries', allow_mask: 0, deny_mask: 1 },
            { module: 'purchase', submodule: 'notes', allow_mask: 1, deny_mask: 0 },
          ],
          legacy: [{ module: 'inventory', permission_key: 'legacy_view', allowed: true }],
        },
        target: {
          overrides: [
            { module: 'accounting', submodule: 'journal_entries', allow_mask: 1, deny_mask: 0 },
            { module: 'purchase', submodule: 'notes', allow_mask: 1, deny_mask: 0 },
            { module: 'reports', submodule: 'stock', allow_mask: 2, deny_mask: 0 },
          ],
          legacy: [{ module: 'reports', permission_key: 'legacy_export', allowed: true }],
        },
      },
      visibility: {
        semantics: 'REPLACE',
        source: {
          has_row: true,
          scope_mode: 'SELECTED',
          include_unassigned: false,
          departments: [
            { department_id: 3, name: 'Growing' },
            { department_id: 4, name: 'Polish 2' },
          ],
        },
        target: {
          has_row: true,
          scope_mode: 'SELECTED',
          include_unassigned: true,
          departments: [{ department_id: 3, name: 'Growing' }],
        },
      },
      preferences: {
        semantics: 'REPLACE',
        excluded_key_prefix: 'vis.',
        source: [
          { pref_key: 'theme', pref_value: 'dark' },
          { pref_key: 'rows_per_page', pref_value: '50' },
          { pref_key: 'landing_page', pref_value: '/inventory' },
          { pref_key: 'vis.show_cogs', pref_value: 'true' },
        ],
        target: [
          { pref_key: 'theme', pref_value: 'light' },
          { pref_key: 'rows_per_page', pref_value: '50' },
          { pref_key: 'compact_mode', pref_value: 'true' },
          { pref_key: 'vis.show_margin', pref_value: 'false' },
        ],
      },
      dashboard: {
        semantics: 'REPLACE',
        source: [
          { widget_key: 'stock_summary', position: 0, is_visible: true },
          { widget_key: 'pending_transfers', position: 1, is_visible: true },
        ],
        target: [
          { widget_key: 'stock_summary', position: 2, is_visible: false },
          { widget_key: 'cash_position', position: 1, is_visible: true },
        ],
      },
      templates: {
        semantics: 'REPLACE',
        source: {
          shares: [
            { template_id: 11, name: 'Growing view' },
            { template_id: 12, name: 'Transfer audit' },
          ],
          owned_non_global: [
            { template_id: 12, name: 'Transfer audit' },
            { template_id: 13, name: 'Source private view' },
          ],
        },
        target: {
          shares: [
            { template_id: 11, name: 'Growing view' },
            { template_id: 20, name: 'Target only view' },
          ],
          owned_non_global: [],
        },
      },
    },
    ...overrides,
  };
}

export const ALL_SELECTED = Object.freeze({
  permissions: true, visibility: true, preferences: true, dashboard: true, templates: true,
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

import {
  RESTRICTION_STATUS,
  RESTRICTION_STATUS_LABELS,
  SCOPE_MODE,
  SCOPE_RESTRICTION_CODE,
  FINANCIAL_RESTRICTION_CODE,
  FINANCIAL_STORAGE_KEY,
  isSecurityControl,
  humaniseVisKey,
  summariseScope,
  selectedDepartmentNames,
  scopesEqual,
  isEmptySelection,
  setScopeMode,
  toggleDepartment,
  selectDepartments,
  clearDepartments,
  filterDepartments,
  resolveScopeStatus,
  resolveFinancialRow,
  buildStoredRows,
  buildDiagnosticRows,
  buildRestrictionsView,
  EFFECT,
  SOURCE,
  BASELINE,
} from '../viewRestrictionsModel';

import {
  buildScopePayload,
  buildPreferencesPayload,
  buildOverridesPayload,
  canonicalPrefs,
} from '../../userCardModel';

/* ══════════════════════════════════════════════════════════════
   Fixtures — shaped exactly like GET /api/admin/permission-catalog
   ══════════════════════════════════════════════════════════════ */

const DEPARTMENTS = [
  { id: 1, name: 'Growing' },
  { id: 2, name: 'Polish 2' },
  { id: 3, name: 'Surat HO' },
  { id: 4, name: 'Mumbai' },
  { id: 5, name: 'Assortment' },
  { id: 6, name: 'Laser' },
];

const SCOPE_META = {
  code: SCOPE_RESTRICTION_CODE,
  business_group: 'View Restrictions',
  label: 'Inventory Departments',
  description: "Restricts which departments' lots a user may see.",
  setting_type: 'DEPARTMENT_SCOPE',
  storage: 'user_inventory_scopes.scope_mode + user_inventory_scope_depts.department_id',
  status: 'ENFORCED',
  risk_level: 'CRITICAL',
  warning: null,
  enforced_by: ['server/services/inventoryAuth.js:168 buildDeptScopeClause'],
  refs: [],
  notes: [],
};

const FINANCIAL_META = {
  code: FINANCIAL_RESTRICTION_CODE,
  business_group: 'View Restrictions',
  label: 'Financial Fields',
  description: 'Controls whether rate / cost / value / margin fields are serialised.',
  setting_type: 'CAPABILITY_PERMISSION',
  storage: 'role_permissions / user_permission_overrides',
  status: 'ENFORCED',
  risk_level: 'CRITICAL',
  warning: null,
  enforced_by: ['server/services/inventoryAuth.js:57 resolveCanViewFinancial'],
  refs: [],
  notes: [],
};

const visMeta = (code, label) => ({
  code,
  business_group: 'View Restrictions',
  label,
  description: `Stored per-user flag intended to control whether ${label} is displayed.`,
  setting_type: 'USER_PREFERENCE',
  storage: 'user_preferences.pref_key (TEXT "true"/"false", default "true")',
  status: 'STORED_NOT_ENFORCED',
  risk_level: 'LOW',
  warning: 'Stored configuration; no active backend enforcement.',
  enforced_by: [],
  refs: [],
  notes: ['Turning this off hides nothing today.'],
});

const CATALOG = {
  version: '1.0.0',
  groups: [{ name: 'Inventory' }],
  permissions: [
    {
      code: FINANCIAL_RESTRICTION_CODE,
      backend_module: 'inventory',
      backend_submodule: 'inventory_financial',
      business_group: 'Inventory',
      label: 'Financial Fields',
      status: 'ACTIVE',
      supported_actions: ['view'],
      has_baseline_rows: false,
      enforcement: {},
    },
  ],
  view_restrictions: [
    SCOPE_META,
    FINANCIAL_META,
    visMeta('vis.show_cogs', 'Cost of Goods (COGS)'),
    visMeta('vis.show_margin', 'Margin %'),
    visMeta('vis.show_balances', 'Account Balances'),
  ],
};

/** Preferences as the card holds them: PREF_DEFAULTS merged with server rows. */
const PREFS = {
  landing_page: '/',
  theme: 'light',
  'vis.show_cogs': 'true',
  'vis.show_margin': 'false',
};

const EMPTY_BASELINE = { available: true, masks: new Map(), roleNames: ['Operator'] };

/* ══════════════════════════════════════════════════════════════
   Catalog parity — the codes this model keys on are the server's
   ══════════════════════════════════════════════════════════════ */

describe('Brick 1 catalog parity', () => {
  it('keys on codes the server catalog actually publishes', () => {
    const requireServer = createRequire(import.meta.url);
    const server = requireServer('../../../../../../../server/rbac/viewRestrictions.js');
    const codes = server.VIEW_RESTRICTIONS.map(entry => entry.code);

    expect(codes).toContain(SCOPE_RESTRICTION_CODE);
    expect(codes).toContain(FINANCIAL_RESTRICTION_CODE);

    // Every remaining entry is a vis.* preference, which is what buildStoredRows
    // and buildDiagnosticRows assume when they split the list.
    const rest = codes.filter(
      code => code !== SCOPE_RESTRICTION_CODE && code !== FINANCIAL_RESTRICTION_CODE,
    );
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every(code => code.startsWith('vis.'))).toBe(true);

    // And the server still classifies every one of them as unenforced.
    const stored = server.VIEW_RESTRICTIONS.filter(entry => entry.code.startsWith('vis.'));
    expect(stored.every(entry => entry.status === 'STORED_NOT_ENFORCED')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════
   Scope summaries — model tests 1 to 5
   ══════════════════════════════════════════════════════════════ */

describe('scope summary', () => {
  it('summarises No Access (test 1)', () => {
    expect(summariseScope({ scope_mode: SCOPE_MODE.NONE, department_ids: [] }, DEPARTMENTS))
      .toBe('No inventory departments');
  });

  it('summarises All Departments (test 2)', () => {
    expect(summariseScope({ scope_mode: SCOPE_MODE.ALL, department_ids: [] }, DEPARTMENTS))
      .toBe('All inventory departments');
  });

  it('summarises a single selected department (test 3)', () => {
    expect(summariseScope({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [1] }, DEPARTMENTS))
      .toBe('Growing');
  });

  it('summarises two selected departments (test 4)', () => {
    expect(summariseScope({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [1, 2] }, DEPARTMENTS))
      .toBe('Growing, Polish 2');
  });

  it('overflows beyond the name limit as "+3 more" (test 5)', () => {
    expect(summariseScope(
      { scope_mode: SCOPE_MODE.SELECTED, department_ids: [1, 2, 3, 4, 5] }, DEPARTMENTS,
    )).toBe('Growing, Polish 2 +3 more');
  });

  it('names the empty SELECTED case rather than showing a blank value', () => {
    expect(summariseScope({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [] }, DEPARTMENTS))
      .toBe('No departments selected');
  });

  it('counts departments the department list cannot resolve instead of dropping them', () => {
    // A department the admin cannot see must never silently vanish from the summary.
    expect(summariseScope({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [1, 99] }, DEPARTMENTS))
      .toBe('Growing +1 more');
    expect(summariseScope({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [98, 99] }, DEPARTMENTS))
      .toBe('2 selected departments');
  });

  it('reads names from the department list order, not the selection order', () => {
    expect(selectedDepartmentNames({ department_ids: [2, 1] }, DEPARTMENTS))
      .toEqual(['Growing', 'Polish 2']);
  });
});

/* ══════════════════════════════════════════════════════════════
   Comparison — model tests 6 and 7
   ══════════════════════════════════════════════════════════════ */

describe('scope comparison', () => {
  it('treats department-order differences as equal (test 6)', () => {
    const a = { scope_mode: SCOPE_MODE.SELECTED, department_ids: [1, 2, 3] };
    const b = { scope_mode: SCOPE_MODE.SELECTED, department_ids: [3, 1, 2] };
    expect(scopesEqual(a, b)).toBe(true);
    expect(summariseScope(a, DEPARTMENTS)).toBe(summariseScope(b, DEPARTMENTS));
  });

  it('keeps scope-mode differences meaningful (test 7)', () => {
    const everyId = DEPARTMENTS.map(d => d.id);
    const all = { scope_mode: SCOPE_MODE.ALL, department_ids: [] };
    const everySelected = { scope_mode: SCOPE_MODE.SELECTED, department_ids: everyId };

    // "All" and "every department individually ticked" are NOT the same setting:
    // ALL includes departments created later. The distinction must survive.
    expect(scopesEqual(all, everySelected)).toBe(false);
    expect(scopesEqual(all, { scope_mode: SCOPE_MODE.NONE, department_ids: [] })).toBe(false);
    expect(scopesEqual(
      { scope_mode: SCOPE_MODE.SELECTED, department_ids: [1] },
      { scope_mode: SCOPE_MODE.SELECTED, department_ids: [2] },
    )).toBe(false);
  });

  it('flags SELECTED with nothing ticked, which the API rejects', () => {
    expect(isEmptySelection({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [] })).toBe(true);
    expect(isEmptySelection({ scope_mode: SCOPE_MODE.NONE, department_ids: [] })).toBe(false);
    expect(isEmptySelection({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [1] })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Draft transitions — model tests 8 to 10
   ══════════════════════════════════════════════════════════════ */

describe('dialog draft transitions', () => {
  const original = { scope_mode: SCOPE_MODE.SELECTED, department_ids: [1, 2] };

  it('never mutates the original, so Cancel preserves it (test 8)', () => {
    const snapshot = JSON.stringify(original);

    toggleDepartment(original, 3);
    selectDepartments(original, [4, 5]);
    clearDepartments(original);
    setScopeMode(original, SCOPE_MODE.ALL);

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('produces the expected local state on Apply (test 9)', () => {
    const added = toggleDepartment(original, 3);
    expect(added.department_ids).toEqual([1, 2, 3]);

    const removed = toggleDepartment(added, 1);
    expect(removed.department_ids).toEqual([2, 3]);

    const all = selectDepartments(original, DEPARTMENTS.map(d => d.id));
    expect(all.department_ids).toEqual([1, 2, 3, 4, 5, 6]);

    expect(clearDepartments(original).department_ids).toEqual([]);
  });

  it('returns to clean when the original state is restored (test 10)', () => {
    const changed = toggleDepartment(original, 3);
    expect(scopesEqual(changed, original)).toBe(false);

    const restored = toggleDepartment(changed, 3);
    expect(scopesEqual(restored, original)).toBe(true);

    // Add-then-remove of the same department is clean regardless of resulting order.
    const churned = toggleDepartment(toggleDepartment(original, 5), 5);
    expect(scopesEqual(churned, original)).toBe(true);
  });

  it('clears the whitelist when leaving SELECTED, exactly as the endpoint stores it', () => {
    expect(setScopeMode(original, SCOPE_MODE.ALL))
      .toEqual({ scope_mode: SCOPE_MODE.ALL, department_ids: [] });
    expect(setScopeMode(original, SCOPE_MODE.NONE))
      .toEqual({ scope_mode: SCOPE_MODE.NONE, department_ids: [] });
    // Entering SELECTED keeps what the draft held, so a mis-click is recoverable.
    expect(setScopeMode(original, SCOPE_MODE.SELECTED).department_ids).toEqual([1, 2]);
  });

  it('filters departments without touching the selection', () => {
    expect(filterDepartments(DEPARTMENTS, 'pol').map(d => d.name)).toEqual(['Polish 2']);
    expect(filterDepartments(DEPARTMENTS, '  ').length).toBe(DEPARTMENTS.length);
    expect(filterDepartments(DEPARTMENTS, 'zzz')).toEqual([]);
  });

  it('does not duplicate a department already selected', () => {
    expect(selectDepartments(original, [1, 2, 3]).department_ids).toEqual([1, 2, 3]);
  });
});

/* ══════════════════════════════════════════════════════════════
   Status mapping — model tests 11 to 15
   ══════════════════════════════════════════════════════════════ */

describe('status mapping', () => {
  it('maps the enforced department scope correctly (test 11)', () => {
    const result = resolveScopeStatus({ catalog: CATALOG, role: 'operator' });
    expect(result.status).toBe(RESTRICTION_STATUS.ENFORCED);
    expect(result.warning).toBeNull();
    expect(RESTRICTION_STATUS_LABELS[result.status]).toBe('Enforced');
  });

  it('maps the permission-controlled financial row correctly (test 12)', () => {
    const row = resolveFinancialRow({
      catalog: CATALOG, overrides: {}, baseline: EMPTY_BASELINE,
      role: 'operator', isSuperAdmin: false,
    });
    expect(row.status).toBe(RESTRICTION_STATUS.PERMISSION_CONTROLLED);
    // Brick 1 verified there is no seeded role_permissions row for this capability.
    expect(row.baselineState).toBe(BASELINE.NO_ROW);
    expect(row.effect).toBe(EFFECT.DENIED);
    expect(row.source).toBe(SOURCE.NO_BASELINE);
    expect(row.summary).toBe('Hidden');
    expect(row.sourceText).toBe('Default deny — no baseline configured');
  });

  it('maps stored-but-unenforced preferences correctly (test 13)', () => {
    const rows = buildStoredRows({ prefs: PREFS, catalog: CATALOG });
    expect(rows.map(r => r.code)).toEqual(['vis.show_cogs', 'vis.show_margin']);
    expect(rows.every(r => r.status === RESTRICTION_STATUS.STORED_NOT_ENFORCED)).toBe(true);
    expect(rows[0].summary).toBe('Visible');
    expect(rows[1].summary).toBe('Hidden');
    expect(rows[0].description).toBe('Stored setting — backend enforcement not implemented');
    expect(rows[0].label).toBe('Cost of Goods (COGS)');
  });

  it('maps a catalogued restriction with no stored value to planned-inactive (test 14)', () => {
    const rows = buildDiagnosticRows({ prefs: PREFS, catalog: CATALOG });
    // vis.show_balances is catalogued but this user holds no value for it.
    expect(rows.map(r => r.code)).toEqual(['vis.show_balances']);
    expect(rows[0].status).toBe(RESTRICTION_STATUS.PLANNED_INACTIVE);
    expect(rows[0].storedValue).toBeNull();
    expect(rows[0].description).toBe('Inactive — not granted to any standard role');
  });

  it('never presents an unverified status as a security control (test 15)', () => {
    // No catalog ⇒ the ENFORCED claim cannot be made.
    const noCatalog = resolveScopeStatus({ catalog: null, role: 'operator' });
    expect(noCatalog.status).toBe(RESTRICTION_STATUS.UNKNOWN);
    expect(RESTRICTION_STATUS_LABELS[noCatalog.status]).toBe('Unverified');

    expect(isSecurityControl(RESTRICTION_STATUS.ENFORCED)).toBe(true);
    expect(isSecurityControl(RESTRICTION_STATUS.PARTIALLY_ENFORCED)).toBe(true);
    expect(isSecurityControl(RESTRICTION_STATUS.PERMISSION_CONTROLLED)).toBe(true);
    expect(isSecurityControl(RESTRICTION_STATUS.UNKNOWN)).toBe(false);
    expect(isSecurityControl(RESTRICTION_STATUS.STORED_NOT_ENFORCED)).toBe(false);
    expect(isSecurityControl(RESTRICTION_STATUS.PLANNED_INACTIVE)).toBe(false);
    expect(isSecurityControl(RESTRICTION_STATUS.NOT_APPLICABLE)).toBe(false);
  });

  it('downgrades, never upgrades, the catalog claim for a bypassing role', () => {
    // server/services/inventoryAuth.js:127 forces scopeMode ALL for these roles on
    // /api/inventory while loadDeptScope still applies the stored scope elsewhere.
    const admin = resolveScopeStatus({ catalog: CATALOG, role: 'admin' });
    expect(admin.status).toBe(RESTRICTION_STATUS.PARTIALLY_ENFORCED);
    expect(admin.warning).toMatch(/does not restrict \/api\/inventory/);

    const superAdmin = resolveScopeStatus({ catalog: CATALOG, role: 'super_admin' });
    expect(superAdmin.status).toBe(RESTRICTION_STATUS.NOT_APPLICABLE);

    // A bypassing role cannot be promoted above what the catalog supports either.
    expect(resolveScopeStatus({ catalog: null, role: 'manager' }).status)
      .toBe(RESTRICTION_STATUS.PARTIALLY_ENFORCED);
    expect(resolveScopeStatus({ catalog: null, role: 'viewer' }).status)
      .toBe(RESTRICTION_STATUS.UNKNOWN);
  });

  it('warns that Restricted Operator defaults to NONE while the admin API reports ALL', () => {
    const result = resolveScopeStatus({ catalog: CATALOG, role: 'operator_restricted' });
    expect(result.status).toBe(RESTRICTION_STATUS.ENFORCED);
    expect(result.warning).toMatch(/defaults this role to NONE/);
  });

  it('humanises a preference key only when the catalog carries no label', () => {
    expect(humaniseVisKey('vis.show_gross_profit')).toBe('Gross Profit');
    const rows = buildStoredRows({ prefs: { 'vis.show_gross_profit': 'true' }, catalog: null });
    expect(rows[0].label).toBe('Gross Profit');
    expect(rows[0].status).toBe(RESTRICTION_STATUS.STORED_NOT_ENFORCED);
  });
});

/* ══════════════════════════════════════════════════════════════
   Inactive by default — model tests 16 to 18
   ══════════════════════════════════════════════════════════════ */

describe('new capability defaults', () => {
  it('defaults an unrecognised catalogued restriction to inactive (test 16)', () => {
    const withNew = {
      ...CATALOG,
      view_restrictions: [
        ...CATALOG.view_restrictions,
        visMeta('vis.show_landed_cost', 'Landed Cost'),
      ],
    };
    const rows = buildDiagnosticRows({ prefs: PREFS, catalog: withNew });
    const added = rows.find(r => r.code === 'vis.show_landed_cost');

    expect(added.status).toBe(RESTRICTION_STATUS.PLANNED_INACTIVE);
    expect(added.storedValue).toBeNull();
    expect(isSecurityControl(added.status)).toBe(false);
  });

  it('gives a standard role no new grant from a new restriction (test 17)', () => {
    const withNew = {
      ...CATALOG,
      view_restrictions: [
        ...CATALOG.view_restrictions,
        visMeta('vis.show_landed_cost', 'Landed Cost'),
      ],
    };
    const view = buildRestrictionsView({
      catalog: withNew, catalogFailed: false, prefs: PREFS, overrides: {},
      baseline: EMPTY_BASELINE, role: 'operator', isSuperAdmin: false,
      inventoryScope: { scope_mode: SCOPE_MODE.ALL, department_ids: [] },
      departments: DEPARTMENTS,
    });

    // The new entry is invisible to a standard role, and the financial verdict is
    // unchanged: still default-denied, still no baseline row.
    expect(view.diagnostics).toEqual([]);
    expect(view.stored.map(r => r.code)).toEqual(['vis.show_cogs', 'vis.show_margin']);
    expect(view.financial.effect).toBe(EFFECT.DENIED);
    expect(view.financial.source).toBe(SOURCE.NO_BASELINE);

    // Nothing in the view is an override the save path would write.
    expect(buildOverridesPayload({})).toEqual({ overrides: [] });
  });

  it('grants Super Admin through the bypass, not through seeded role rows (test 18)', () => {
    const row = resolveFinancialRow({
      catalog: CATALOG,
      overrides: {},
      baseline: { available: true, masks: new Map(), roleNames: [] },
      role: 'super_admin',
      isSuperAdmin: true,
    });
    expect(row.effect).toBe(EFFECT.ALLOWED);
    expect(row.source).toBe(SOURCE.SUPER_ADMIN);
    expect(row.sourceText).toBe('Super Admin bypass');
    // The baseline is still empty — the allow came from the bypass, not from a row.
    expect(row.baselineState).toBe(BASELINE.NO_ROW);
    expect(buildOverridesPayload({})).toEqual({ overrides: [] });
  });

  it('reports the verified financial role bypass without weakening the permission verdict', () => {
    const row = resolveFinancialRow({
      catalog: CATALOG, overrides: {}, baseline: EMPTY_BASELINE,
      role: 'admin', isSuperAdmin: false,
    });
    expect(row.effect).toBe(EFFECT.DENIED);
    expect(row.bypass).toBe(true);
    expect(row.warning).toMatch(/regardless of/);
  });
});

/* ══════════════════════════════════════════════════════════════
   Data freeze — model tests 19 and 20
   ══════════════════════════════════════════════════════════════ */

describe('data freeze', () => {
  it('serialises existing vis.* values unchanged (test 19)', () => {
    const before = canonicalPrefs(PREFS);
    const view = buildRestrictionsView({
      catalog: CATALOG, catalogFailed: false, prefs: PREFS, overrides: {},
      baseline: EMPTY_BASELINE, role: 'operator', isSuperAdmin: false,
      inventoryScope: { scope_mode: SCOPE_MODE.SELECTED, department_ids: [1] },
      departments: DEPARTMENTS,
    });
    expect(view.stored.length).toBe(2);

    // Building the view cannot alter the object the payload builder reads.
    expect(canonicalPrefs(PREFS)).toBe(before);
    expect(buildPreferencesPayload(PREFS)).toEqual({
      preferences: [
        { pref_key: 'landing_page', pref_value: '/' },
        { pref_key: 'theme', pref_value: 'light' },
        { pref_key: 'vis.show_cogs', pref_value: 'true' },
        { pref_key: 'vis.show_margin', pref_value: 'false' },
      ],
    });
  });

  it('leaves missing preference keys missing (test 20)', () => {
    const sparse = { theme: 'light' };
    const view = buildRestrictionsView({
      catalog: CATALOG, catalogFailed: false, prefs: sparse, overrides: {},
      baseline: EMPTY_BASELINE, role: 'super_admin', isSuperAdmin: true,
      inventoryScope: { scope_mode: SCOPE_MODE.ALL, department_ids: [] },
      departments: DEPARTMENTS,
    });

    // Three vis.* keys are catalogued; the user holds none, so none becomes a
    // stored row and none is created. They appear only as read-only diagnostics.
    expect(view.stored).toEqual([]);
    expect(view.diagnostics.map(r => r.code))
      .toEqual(['vis.show_cogs', 'vis.show_margin', 'vis.show_balances']);
    expect(Object.keys(sparse)).toEqual(['theme']);
    expect(buildPreferencesPayload(sparse))
      .toEqual({ preferences: [{ pref_key: 'theme', pref_value: 'light' }] });
  });

  it('keeps the scope payload byte-compatible with the pre-Brick-4 builder', () => {
    const applied = toggleDepartment({ scope_mode: SCOPE_MODE.SELECTED, department_ids: [1] }, 2);
    expect(buildScopePayload(applied)).toEqual({
      scope_mode: 'SELECTED',
      include_unassigned: false,
      department_ids: [1, 2],
    });
    expect(Object.keys(buildScopePayload(applied)))
      .toEqual(['scope_mode', 'include_unassigned', 'department_ids']);
  });

  it('exposes the financial storage key the resolver actually reads', () => {
    expect(FINANCIAL_STORAGE_KEY).toBe('inventory:inventory_financial');
  });
});

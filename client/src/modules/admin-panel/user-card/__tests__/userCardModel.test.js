import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  computeDirty,
  buildBasicPayload,
  buildRolesPayload,
  buildPreferencesPayload,
  buildScopePayload,
  buildOverridesPayload,
  getOverrideState,
  nextOverrideState,
  applyOverrideState,
  countOverrideRecords,
  describeScope,
  computeEffectiveAccess,
} from '../userCardModel';

/* ── Synthetic fixtures ─────────────────────────────────────── */
const BASIC = {
  username: 'rohit',
  email: 'rohit@example.com',
  full_name: 'Rohit',
  role: 'operator',
  department_id: '3',
};

const PREFS = {
  landing_page: '/', rows_per_page: '50', theme: 'light',
  compact_mode: 'false', default_branch: '',
  'vis.show_cogs': 'true', 'vis.show_purchase_rate': 'true',
  'vis.show_sale_rate': 'true', 'vis.show_margin': 'true',
  'vis.show_gross_profit': 'true', 'vis.show_net_profit': 'true',
  'vis.show_balances': 'true',
};

const OVERRIDES = {
  'inventory:all_inventory': { allow_mask: 1, deny_mask: 0 },
  'manufacturing:lot_workspace': { allow_mask: 0, deny_mask: 8 },
};

const SCOPE = { scope_mode: 'SELECTED', department_ids: [3, 1] };
const ROLE_IDS = [2];

const baseState = () => ({
  basic: { ...BASIC },
  prefs: { ...PREFS },
  overrides: { ...OVERRIDES },
  scope: { ...SCOPE, department_ids: [...SCOPE.department_ids] },
  roleIds: [...ROLE_IDS],
});

const snapshotOf = (state = baseState()) => buildSnapshot(state);

const dirtyOf = (patch = {}) => {
  const state = { ...baseState(), ...patch };
  return computeDirty({
    snapshot: snapshotOf(),
    basic: state.basic,
    prefs: state.prefs,
    overrides: state.overrides,
    scope: state.scope,
    roleIds: state.roleIds,
    password: state.password || '',
  });
};

/* ══════════════════════════════════════════════════════════════
   Payload byte-identity — tests 21 and 22
   ══════════════════════════════════════════════════════════════ */
describe('payload builders reproduce the pre-Brick-2 request bodies byte for byte', () => {
  it('serialises the permission-overrides payload identically (test 21)', () => {
    // Exactly what the previous UserDrawer.handleSave produced for these masks.
    const expected = '{"overrides":[{"module":"inventory","submodule":"all_inventory","allow_mask":1,"deny_mask":0},{"module":"manufacturing","submodule":"lot_workspace","allow_mask":0,"deny_mask":8}]}';
    expect(JSON.stringify(buildOverridesPayload(OVERRIDES))).toBe(expected);
  });

  it('omits zero-mask override entries, as the old builder did', () => {
    const withCleared = {
      ...OVERRIDES,
      'accounting:ledger': { allow_mask: 0, deny_mask: 0 },
    };
    expect(buildOverridesPayload(withCleared).overrides).toHaveLength(2);
  });

  it('preserves insertion order of the override map', () => {
    const reordered = {
      'manufacturing:lot_workspace': { allow_mask: 0, deny_mask: 8 },
      'inventory:all_inventory': { allow_mask: 1, deny_mask: 0 },
    };
    expect(buildOverridesPayload(reordered).overrides.map(o => o.module))
      .toEqual(['manufacturing', 'inventory']);
  });

  it('emits an empty submodule string for module-level entries', () => {
    expect(buildOverridesPayload({ 'dashboard:': { allow_mask: 1, deny_mask: 0 } }))
      .toEqual({ overrides: [{ module: 'dashboard', submodule: '', allow_mask: 1, deny_mask: 0 }] });
  });

  it('serialises the inventory-scope payload identically (test 22)', () => {
    const expected = '{"scope_mode":"SELECTED","include_unassigned":false,"department_ids":[3,1]}';
    expect(JSON.stringify(buildScopePayload(SCOPE))).toBe(expected);
  });

  it('serialises the basic-info payload identically', () => {
    const expected = '{"username":"rohit","email":"rohit@example.com","full_name":"Rohit","role":"operator","department_id":3}';
    expect(JSON.stringify(buildBasicPayload(BASIC))).toBe(expected);
  });

  it('sends department_id as null when no department is selected', () => {
    expect(buildBasicPayload({ ...BASIC, department_id: '' }).department_id).toBeNull();
  });

  it('serialises the preferences payload in insertion order with string values', () => {
    const payload = buildPreferencesPayload(PREFS);
    expect(payload.preferences).toHaveLength(12);
    expect(payload.preferences[0]).toEqual({ pref_key: 'landing_page', pref_value: '/' });
    expect(payload.preferences[11]).toEqual({ pref_key: 'vis.show_balances', pref_value: 'true' });
    expect(payload.preferences.every(p => typeof p.pref_value === 'string')).toBe(true);
  });

  it('serialises the role payload identically', () => {
    expect(JSON.stringify(buildRolesPayload(ROLE_IDS))).toBe('{"role_ids":[2]}');
  });
});

/* ══════════════════════════════════════════════════════════════
   Dirty tracking — tests 7 and 8
   ══════════════════════════════════════════════════════════════ */
describe('per-category dirty tracking against the server snapshot', () => {
  it('reports every category clean for untouched state', () => {
    const dirty = dirtyOf();
    expect(dirty.any).toBe(false);
    expect(dirty.byCategory).toEqual({
      general: false, access: false, preferences: false, security: false,
    });
  });

  it('marks only General dirty when a basic field changes (test 7)', () => {
    const dirty = dirtyOf({ basic: { ...BASIC, full_name: 'Rohit Kumar' } });
    expect(dirty.byCategory.general).toBe(true);
    expect(dirty.byCategory.access).toBe(false);
    expect(dirty.byCategory.preferences).toBe(false);
    expect(dirty.dirtyCategories).toEqual(['general']);
  });

  it('clears dirty when a changed field is reverted to its original value (test 8)', () => {
    const changed = dirtyOf({ basic: { ...BASIC, email: 'other@example.com' } });
    expect(changed.byCategory.general).toBe(true);

    const reverted = dirtyOf({ basic: { ...BASIC } });
    expect(reverted.byCategory.general).toBe(false);
  });

  it('treats a permission toggled back to its original mask as clean (test 8)', () => {
    const bit = 4; // edit
    const key = 'inventory:all_inventory';

    let masks = OVERRIDES[key];
    masks = applyOverrideState(masks, bit, 'ALLOW');
    expect(dirtyOf({ overrides: { ...OVERRIDES, [key]: masks } }).byCategory.access).toBe(true);

    masks = applyOverrideState(masks, bit, 'INHERIT');
    expect(dirtyOf({ overrides: { ...OVERRIDES, [key]: masks } }).byCategory.access).toBe(false);
  });

  it('treats an all-zero override entry as equivalent to no entry', () => {
    const withEmpty = { ...OVERRIDES, 'accounting:ledger': { allow_mask: 0, deny_mask: 0 } };
    expect(dirtyOf({ overrides: withEmpty }).byCategory.access).toBe(false);
  });

  it('treats selecting then deselecting the same department as clean (test 8)', () => {
    const added = { scope_mode: 'SELECTED', department_ids: [3, 1, 9] };
    expect(dirtyOf({ scope: added }).byCategory.access).toBe(true);

    const removed = { scope_mode: 'SELECTED', department_ids: [3, 1] };
    expect(dirtyOf({ scope: removed }).byCategory.access).toBe(false);
  });

  it('ignores department order, which carries no meaning', () => {
    expect(dirtyOf({ scope: { scope_mode: 'SELECTED', department_ids: [1, 3] } }).byCategory.access)
      .toBe(false);
  });

  it('treats department_id "3" and 3 as the same value', () => {
    expect(dirtyOf({ basic: { ...BASIC, department_id: 3 } }).byCategory.general).toBe(false);
  });

  it('marks Access dirty when the scope mode changes', () => {
    expect(dirtyOf({ scope: { scope_mode: 'ALL', department_ids: [] } }).byCategory.access).toBe(true);
  });

  it('marks Preferences dirty only for a real preference change', () => {
    expect(dirtyOf({ prefs: { ...PREFS, theme: 'dark' } }).byCategory.preferences).toBe(true);
    expect(dirtyOf({ prefs: { ...PREFS } }).byCategory.preferences).toBe(false);
  });

  it('marks Security dirty only while a password has been typed', () => {
    expect(dirtyOf({ password: 'hunter2' }).byCategory.security).toBe(true);
    expect(dirtyOf({ password: '' }).byCategory.security).toBe(false);
  });

  it('exposes sub-part flags so a category only calls the endpoints it needs', () => {
    const dirty = dirtyOf({ scope: { scope_mode: 'ALL', department_ids: [] } });
    expect(dirty.parts.scopeDirty).toBe(true);
    expect(dirty.parts.overridesDirty).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Mask helpers — unchanged three-state semantics
   ══════════════════════════════════════════════════════════════ */
describe('override mask helpers keep the pre-Brick-2 semantics', () => {
  it('cycles INHERIT → ALLOW → DENY → INHERIT', () => {
    expect(nextOverrideState('INHERIT')).toBe('ALLOW');
    expect(nextOverrideState('ALLOW')).toBe('DENY');
    expect(nextOverrideState('DENY')).toBe('INHERIT');
  });

  it('sets the allow bit and clears the deny bit for ALLOW', () => {
    expect(applyOverrideState({ allow_mask: 0, deny_mask: 4 }, 4, 'ALLOW'))
      .toEqual({ allow_mask: 4, deny_mask: 0 });
  });

  it('sets the deny bit and clears the allow bit for DENY', () => {
    expect(applyOverrideState({ allow_mask: 4, deny_mask: 0 }, 4, 'DENY'))
      .toEqual({ allow_mask: 0, deny_mask: 4 });
  });

  it('clears both bits for INHERIT and leaves other bits intact', () => {
    expect(applyOverrideState({ allow_mask: 5, deny_mask: 4 }, 4, 'INHERIT'))
      .toEqual({ allow_mask: 1, deny_mask: 0 });
  });

  it('reads the state of a single action bit', () => {
    expect(getOverrideState(OVERRIDES, 'inventory', 'all_inventory', 1)).toBe('ALLOW');
    expect(getOverrideState(OVERRIDES, 'manufacturing', 'lot_workspace', 8)).toBe('DENY');
    expect(getOverrideState(OVERRIDES, 'accounting', 'ledger', 1)).toBe('INHERIT');
  });

  it('counts only override records that would be written', () => {
    expect(countOverrideRecords(OVERRIDES)).toBe(2);
    expect(countOverrideRecords({ ...OVERRIDES, 'a:b': { allow_mask: 0, deny_mask: 0 } })).toBe(2);
    expect(countOverrideRecords({})).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   Summaries
   ══════════════════════════════════════════════════════════════ */
describe('read-only summaries', () => {
  it('describes each inventory scope mode', () => {
    expect(describeScope({ scope_mode: 'NONE', department_ids: [] })).toBe('No Access');
    expect(describeScope({ scope_mode: 'ALL', department_ids: [] })).toBe('All Departments');
    expect(describeScope({ scope_mode: 'SELECTED', department_ids: [1, 2] }))
      .toBe('Selected Departments (2)');
  });

  it('resolves DENY over ALLOW over the role baseline', () => {
    const moduleTree = [{ module: 'inventory', submodules: [{ key: 'all_inventory' }] }];
    const actions = [{ id: 'view' }, { id: 'create' }, { id: 'edit' }];
    const permBits = { view: 1, create: 2, edit: 4 };
    // Baseline grants view + create; the override denies create and adds edit.
    const roleTree = [{ module: 'inventory', submodules: [{ key: 'all_inventory', permissions: 3 }] }];
    const overrides = { 'inventory:all_inventory': { allow_mask: 4, deny_mask: 2 } };

    expect(computeEffectiveAccess({ moduleTree, actions, permBits, roleTree, overrides })).toEqual({
      allowed: 2,            // view from baseline, edit from override
      deniedByOverride: 1,   // create
      allowedByOverride: 1,  // edit
      defaultDenied: 0,
      total: 3,
      hasBaseline: true,
    });
  });

  it('flags the baseline as unavailable when the role tree could not be read', () => {
    const result = computeEffectiveAccess({
      moduleTree: [{ module: 'inventory', submodules: [{ key: 'all_inventory' }] }],
      actions: [{ id: 'view' }],
      permBits: { view: 1 },
      roleTree: null,
      overrides: {},
    });
    expect(result.hasBaseline).toBe(false);
    expect(result.defaultDenied).toBe(1);
  });
});

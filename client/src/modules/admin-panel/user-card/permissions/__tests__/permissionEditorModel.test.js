import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { PERM_BITS, ALL_PERMISSION_BITS } from '../../../../../shared/constants/permissions';
import { buildOverridesPayload, canonicalOverrides } from '../../userCardModel';
import {
  validateCatalog, buildGroups, buildCapability, activeStorageKeys,
  enforcementLevelOf, ENFORCEMENT_LEVEL, STATUS,
} from '../permissionCatalogModel';
import {
  OVERRIDE_STATE, BASELINE, EFFECT, SOURCE,
  effectiveMask, mergeRoleTrees, buildBaseline,
  baselineStateFor, overrideStateFor, effectiveFor, resolveActionRow,
  setActionOverride, clearCapabilityOverrides, clearCapabilitiesOverrides,
  countCapabilityOverrides, countHiddenOverrideRecords,
  buildEditorView, visibleCapabilitiesOf, EMPTY_FILTERS, describeSource,
} from '../permissionEditorModel';

/* ══════════════════════════════════════════════════════════════
   Fixtures — shaped exactly like the Brick 1 endpoint payload
   ══════════════════════════════════════════════════════════════ */

const ENFORCED_ALL = {
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'NO_ACTIVE_FEATURE',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const UNGUARDED_ALL = {
  navigation: 'NOT_ENFORCED', frontend_route: 'NOT_ENFORCED', frontend_action: 'NOT_ENFORCED',
  api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY', api_create: 'AUTHENTICATE_ONLY',
  api_edit: 'AUTHENTICATE_ONLY', api_delete: 'AUTHENTICATE_ONLY',
  api_approve: 'NO_ACTIVE_FEATURE', export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

function entry(overrides) {
  const module = overrides.backend_module;
  const submodule = overrides.backend_submodule ?? '';
  return {
    code: `${module}.${submodule === '' ? '__module__' : submodule}`,
    backend_module: module,
    backend_submodule: submodule,
    business_group: 'Inventory',
    label: 'Fixture',
    description: '',
    status: STATUS.ACTIVE,
    risk_level: 'MEDIUM',
    control_type: 'ACTION_MATRIX',
    supported_actions: ['view'],
    has_baseline_rows: true,
    canonical_code: null,
    empty_submodule_meaning: submodule === '' ? 'MODULE_ACCESS' : null,
    enforcement: ENFORCED_ALL,
    notes: [],
    ...overrides,
  };
}

const CATALOG = {
  version: '1.0.0',
  groups: [{ name: 'Inventory' }, { name: 'Manufacturing' }, { name: 'Administration' }],
  permissions: [
    entry({
      backend_module: 'inventory', backend_submodule: 'stock_transfer',
      business_group: 'Inventory', label: 'Stock Transfer',
      description: 'Move lots between departments.',
      risk_level: 'HIGH',
      supported_actions: ['view', 'create', 'approve', 'export'],
    }),
    entry({
      backend_module: 'inventory', backend_submodule: '',
      business_group: 'Inventory', label: 'Inventory (module access)',
      control_type: 'MODULE_ACCESS', supported_actions: ['view'],
    }),
    entry({
      backend_module: 'inventory', backend_submodule: 'seed_stock',
      business_group: 'Inventory', label: 'Seed Stock',
      has_baseline_rows: false,
      supported_actions: ['view', 'export'],
      enforcement: UNGUARDED_ALL,
    }),
    entry({
      backend_module: 'process_return', backend_submodule: '',
      business_group: 'Manufacturing', label: 'Process Return Overrides',
      control_type: 'CAPABILITY_FLAG', has_baseline_rows: false,
      supported_actions: ['override_weight_variance'],
    }),
    // Hidden: a duplicate legacy key for a capability owned elsewhere.
    entry({
      backend_module: 'manufacturing', backend_submodule: 'machines',
      business_group: 'Manufacturing', label: 'Machines (manufacturing duplicate)',
      status: STATUS.DUPLICATE_LEGACY, canonical_code: 'management.machines',
      supported_actions: ['view', 'create'],
    }),
    // Hidden: a permission with no live feature.
    entry({
      backend_module: 'hr', backend_submodule: 'employees',
      business_group: 'Administration', label: 'Employees',
      status: STATUS.PLANNED_INACTIVE, supported_actions: ['view', 'create'],
    }),
    entry({
      backend_module: 'admin', backend_submodule: 'users',
      business_group: 'Administration', label: 'Users',
      supported_actions: ['view', 'create', 'manage'],
    }),
  ],
};

const GROUPS = buildGroups(CATALOG);
const capabilityByCode = code => GROUPS
  .flatMap(g => [...g.capabilities, ...g.diagnostics])
  .find(c => c.code === code);

const STOCK_TRANSFER = capabilityByCode('inventory.stock_transfer');
const SEED_STOCK = capabilityByCode('inventory.seed_stock');
const PROCESS_RETURN = capabilityByCode('process_return.__module__');
const MODULE_ACCESS = capabilityByCode('inventory.__module__');

const ROLE_TREE = [{
  module: 'inventory',
  label: 'Inventory',
  submodules: [
    // view + create granted, approve and export withheld.
    { key: 'stock_transfer', label: 'Stock Transfer', permissions: PERM_BITS.view | PERM_BITS.create },
    { key: '', label: 'Inventory', permissions: PERM_BITS.view },
  ],
}, {
  module: 'admin',
  label: 'Admin',
  submodules: [{ key: 'users', label: 'Users', permissions: 0 }],
}];

const BASE = buildBaseline({ roleTree: ROLE_TREE, roleNames: ['Operator'] });
const action = (capability, id) => capability.actions.find(a => a.id === id);

/* ══════════════════════════════════════════════════════════════
   Bit definitions — parity with the server, not a second table
   ══════════════════════════════════════════════════════════════ */

describe('permission bit parity with the server resolver', () => {
  /**
   * Read as text rather than required: server/utils/permissions.js pulls in the
   * pg pool at import time. Parsing the literal is enough to prove the client
   * map has not drifted, which is the whole reason Brick 3 reuses it instead of
   * adding a third bit table.
   */
  function locateServerPermissions() {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(dir, 'server', 'utils', 'permissions.js');
      if (existsSync(candidate)) return candidate;
      dir = dirname(dir);
    }
    throw new Error('server/utils/permissions.js not found — parity cannot be verified');
  }

  const serverSource = readFileSync(locateServerPermissions(), 'utf8');

  function parseServerBits() {
    const block = serverSource.match(/const PERM_BITS = \{([\s\S]*?)\};/);
    const bits = {};
    for (const line of block[1].split('\n')) {
      const found = line.match(/^\s*([a-z_]+)\s*:\s*(\d+)\s*,/);
      if (found) bits[found[1]] = Number(found[2]);
    }
    return bits;
  }

  it('matches server/utils/permissions.js exactly', () => {
    expect(parseServerBits()).toEqual(PERM_BITS);
  });

  it('maps override_weight_variance to its real backend bit (test 11)', () => {
    expect(PERM_BITS.override_weight_variance).toBe(2048);
    expect(parseServerBits().override_weight_variance).toBe(2048);
  });

  it('keeps the full supported mask at 4095 (test 12)', () => {
    expect(ALL_PERMISSION_BITS).toBe(4095);
    expect(Object.values(PERM_BITS).reduce((a, b) => a | b, 0)).toBe(4095);
  });
});

/* ══════════════════════════════════════════════════════════════
   Tri-state mask arithmetic — tests 1 to 4
   ══════════════════════════════════════════════════════════════ */

describe('tri-state override arithmetic', () => {
  const KEY = 'inventory:stock_transfer';
  const BIT = PERM_BITS.approve;

  it('INHERIT clears both bits (test 1)', () => {
    const start = { [KEY]: { allow_mask: BIT, deny_mask: 0 } };
    expect(setActionOverride(start, KEY, BIT, OVERRIDE_STATE.INHERIT)[KEY])
      .toEqual({ allow_mask: 0, deny_mask: 0 });
  });

  it('ALLOW sets allow and clears deny (test 2)', () => {
    const start = { [KEY]: { allow_mask: 0, deny_mask: BIT } };
    expect(setActionOverride(start, KEY, BIT, OVERRIDE_STATE.ALLOW)[KEY])
      .toEqual({ allow_mask: BIT, deny_mask: 0 });
  });

  it('DENY sets deny and clears allow (test 3)', () => {
    const start = { [KEY]: { allow_mask: BIT, deny_mask: 0 } };
    expect(setActionOverride(start, KEY, BIT, OVERRIDE_STATE.DENY)[KEY])
      .toEqual({ allow_mask: 0, deny_mask: BIT });
  });

  it('can never produce overlapping allow and deny bits (test 4)', () => {
    let overrides = {};
    const states = [OVERRIDE_STATE.ALLOW, OVERRIDE_STATE.DENY, OVERRIDE_STATE.INHERIT];
    for (const capability of [STOCK_TRANSFER, SEED_STOCK, PROCESS_RETURN]) {
      for (const act of capability.actions) {
        for (const state of states) {
          overrides = setActionOverride(overrides, capability.storageKey, act.bit, state);
          for (const value of Object.values(overrides)) {
            expect(value.allow_mask & value.deny_mask).toBe(0);
          }
        }
      }
    }
  });

  it('leaves the map untouched when the state does not change', () => {
    const start = { [KEY]: { allow_mask: BIT, deny_mask: 0 } };
    expect(setActionOverride(start, KEY, BIT, OVERRIDE_STATE.ALLOW)).toBe(start);
  });
});

/* ══════════════════════════════════════════════════════════════
   Resolution precedence — tests 5 to 10
   ══════════════════════════════════════════════════════════════ */

describe('effective resolution', () => {
  const resolve = (capability, actionId, overrides = {}, opts = {}) => resolveActionRow({
    capability,
    action: action(capability, actionId),
    overrides,
    baseline: opts.baseline || BASE,
    isSuperAdmin: opts.isSuperAdmin || false,
  });

  it('role allow plus inherit resolves Allowed (test 5)', () => {
    const row = resolve(STOCK_TRANSFER, 'view');
    expect(row.baselineState).toBe(BASELINE.ALLOWED);
    expect(row.overrideState).toBe(OVERRIDE_STATE.INHERIT);
    expect(row.effect).toBe(EFFECT.ALLOWED);
    expect(row.source).toBe(SOURCE.ROLE_ALLOW);
    expect(describeSource(row.source, ['Operator'])).toBe('Role baseline — Operator');
  });

  it('role not-granted plus inherit resolves Denied (test 6)', () => {
    const row = resolve(STOCK_TRANSFER, 'approve');
    expect(row.baselineState).toBe(BASELINE.NOT_GRANTED);
    expect(row.effect).toBe(EFFECT.DENIED);
    expect(describeSource(row.source)).toBe('Role baseline — not granted');
  });

  it('a user Allow overrides a missing role grant (test 7)', () => {
    const overrides = {
      [STOCK_TRANSFER.storageKey]: { allow_mask: PERM_BITS.approve, deny_mask: 0 },
    };
    const row = resolve(STOCK_TRANSFER, 'approve', overrides);
    expect(row.baselineState).toBe(BASELINE.NOT_GRANTED);
    expect(row.effect).toBe(EFFECT.ALLOWED);
    expect(describeSource(row.source)).toBe('Explicit user allow');
  });

  it('a user Deny overrides a role allow (test 8)', () => {
    const overrides = {
      [STOCK_TRANSFER.storageKey]: { allow_mask: 0, deny_mask: PERM_BITS.view },
    };
    const row = resolve(STOCK_TRANSFER, 'view', overrides);
    expect(row.baselineState).toBe(BASELINE.ALLOWED);
    expect(row.effect).toBe(EFFECT.DENIED);
    expect(describeSource(row.source)).toBe('Explicit user deny');
  });

  it('Super Admin always resolves Allowed, whatever the masks say (test 9)', () => {
    const overrides = { [STOCK_TRANSFER.storageKey]: { allow_mask: 0, deny_mask: 4095 } };
    for (const act of STOCK_TRANSFER.actions) {
      const row = resolveActionRow({
        capability: STOCK_TRANSFER, action: act, overrides, baseline: BASE, isSuperAdmin: true,
      });
      expect(row.effect).toBe(EFFECT.ALLOWED);
      expect(describeSource(row.source)).toBe('Super Admin bypass');
    }
  });

  it('a capability with no baseline row resolves Default Deny (test 10)', () => {
    const row = resolve(SEED_STOCK, 'view');
    expect(row.baselineState).toBe(BASELINE.NO_ROW);
    expect(row.effect).toBe(EFFECT.DENIED);
    expect(describeSource(row.source)).toBe('Default deny — no baseline configured');
  });

  it('separates "not granted by role" from "no baseline row at all"', () => {
    // admin.users exists in the tree with mask 0 → not granted.
    expect(baselineStateFor(capabilityByCode('admin.users'), PERM_BITS.view, BASE))
      .toBe(BASELINE.NOT_GRANTED);
    // process_return is catalogued as having no seeded row at all.
    expect(baselineStateFor(PROCESS_RETURN, PERM_BITS.override_weight_variance, BASE))
      .toBe(BASELINE.NO_ROW);
  });

  it('never claims "no baseline" for a row the role API simply cannot report', () => {
    // GET /api/roles/:id/permissions builds its tree from MODULE_TREE, which
    // carries no submodule = '' keys. Reporting those as "no baseline
    // configured" would be a false claim about the database, so they resolve to
    // an explicit not-reported state instead of a fabricated Denied.
    const treeWithoutModuleRow = buildBaseline({
      roleTree: [{
        module: 'inventory',
        submodules: [{ key: 'stock_transfer', permissions: PERM_BITS.view }],
      }],
      roleNames: ['Operator'],
    });

    expect(MODULE_ACCESS.hasBaselineRow).toBe(true);
    const state = baselineStateFor(MODULE_ACCESS, PERM_BITS.view, treeWithoutModuleRow);
    expect(state).toBe(BASELINE.NOT_REPORTED);

    const { effect, source } = effectiveFor({
      baselineState: state, overrideState: OVERRIDE_STATE.INHERIT, isSuperAdmin: false,
    });
    expect(effect).toBe(EFFECT.UNKNOWN);
    expect(describeSource(source)).toBe('Role baseline exists but is not reported for this key');
  });

  it('lets an explicit override still decide a not-reported row', () => {
    const treeWithoutModuleRow = buildBaseline({ roleTree: [], roleNames: [] });
    const overrides = {
      [MODULE_ACCESS.storageKey]: { allow_mask: PERM_BITS.view, deny_mask: 0 },
    };
    const row = resolveActionRow({
      capability: MODULE_ACCESS,
      action: action(MODULE_ACCESS, 'view'),
      overrides,
      baseline: treeWithoutModuleRow,
      isSuperAdmin: false,
    });
    expect(row.baselineState).toBe(BASELINE.NOT_REPORTED);
    expect(row.effect).toBe(EFFECT.ALLOWED);
    expect(describeSource(row.source)).toBe('Explicit user allow');
  });

  it('says Unavailable rather than Denied when the baseline could not be read', () => {
    const unread = buildBaseline({ roleTree: null, available: false });
    const row = resolve(STOCK_TRANSFER, 'view', {}, { baseline: unread });
    expect(row.baselineState).toBe(BASELINE.UNKNOWN);
    expect(row.effect).toBe(EFFECT.UNKNOWN);
  });

  it('still stores an override for a capability with no baseline row', () => {
    const bit = PERM_BITS.override_weight_variance;
    const next = setActionOverride({}, PROCESS_RETURN.storageKey, bit, OVERRIDE_STATE.ALLOW);
    expect(next[PROCESS_RETURN.storageKey]).toEqual({ allow_mask: bit, deny_mask: 0 });
    expect(buildOverridesPayload(next).overrides).toEqual([
      { module: 'process_return', submodule: '', allow_mask: bit, deny_mask: 0 },
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════
   Parity with the backend algebra — tests 13 to 15
   ══════════════════════════════════════════════════════════════ */

describe('parity with the server resolver expression', () => {
  /** Frozen vectors: role mask, allow mask, deny mask → effective mask. */
  const VECTORS = [
    { role: 0, allow: 0, deny: 0, expected: 0 },
    { role: 1, allow: 0, deny: 0, expected: 1 },
    { role: 0, allow: 1, deny: 0, expected: 1 },
    { role: 1, allow: 0, deny: 1, expected: 0 },
    { role: 3, allow: 4, deny: 1, expected: 6 },
    { role: 4095, allow: 0, deny: 2048, expected: 2047 },
    { role: 0, allow: 2048, deny: 0, expected: 2048 },
    { role: 4095, allow: 4095, deny: 4095, expected: 0 },
    { role: 65535, allow: 0, deny: 0, expected: 4095 },
  ];

  it('reproduces the frozen resolver vectors (test 14)', () => {
    for (const v of VECTORS) {
      expect(effectiveMask(v.role, v.allow, v.deny)).toBe(v.expected);
    }
  });

  it('agrees with the mask expression for every action of every capability (test 15)', () => {
    const overrides = {
      [STOCK_TRANSFER.storageKey]: { allow_mask: PERM_BITS.approve, deny_mask: PERM_BITS.view },
      [SEED_STOCK.storageKey]: { allow_mask: PERM_BITS.view, deny_mask: 0 },
    };

    for (const capability of GROUPS.flatMap(g => g.capabilities)) {
      const roleMask = BASE.masks.get(capability.storageKey) || 0;
      const stored = overrides[capability.storageKey] || { allow_mask: 0, deny_mask: 0 };
      const mask = effectiveMask(roleMask, stored.allow_mask, stored.deny_mask);

      for (const act of capability.actions) {
        const row = resolveActionRow({
          capability, action: act, overrides, baseline: BASE, isSuperAdmin: false,
        });
        expect(row.effect === EFFECT.ALLOWED).toBe((mask & act.bit) === act.bit);
      }
    }
  });

  it('rejects an unknown action safely (test 13)', () => {
    const broken = {
      ...CATALOG,
      permissions: [...CATALOG.permissions, entry({
        backend_module: 'inventory', backend_submodule: 'ghost',
        supported_actions: ['teleport'],
      })],
    };
    const result = validateCatalog(broken);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unknown action "teleport"');
    // Nothing throws, and the capability builder simply drops it.
    expect(buildCapability(broken.permissions.at(-1)).actions).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   Serialization and preservation — tests 16 to 20, 25
   ══════════════════════════════════════════════════════════════ */

describe('override serialization', () => {
  /** What the server GET returns for a user who also carries hidden rows. */
  const LOADED = {
    'inventory:stock_transfer': { allow_mask: PERM_BITS.approve, deny_mask: 0 },
    'manufacturing:machines': { allow_mask: PERM_BITS.view, deny_mask: PERM_BITS.create },
    'hr:employees': { allow_mask: 0, deny_mask: PERM_BITS.create },
    'process:send_to_process': { allow_mask: PERM_BITS.view, deny_mask: 0 },
  };

  it('emits the existing payload shape (test 16)', () => {
    const payload = buildOverridesPayload({
      'inventory:stock_transfer': { allow_mask: 16, deny_mask: 1 },
    });
    expect(payload).toEqual({
      overrides: [{
        module: 'inventory', submodule: 'stock_transfer', allow_mask: 16, deny_mask: 1,
      }],
    });
    expect(Object.keys(payload.overrides[0]))
      .toEqual(['module', 'submodule', 'allow_mask', 'deny_mask']);
  });

  it('omits zero-mask rows as the existing contract requires (test 17)', () => {
    const payload = buildOverridesPayload({
      'inventory:stock_transfer': { allow_mask: 0, deny_mask: 0 },
      'inventory:seed_stock': { allow_mask: 1, deny_mask: 0 },
    });
    expect(payload.overrides).toEqual([
      { module: 'inventory', submodule: 'seed_stock', allow_mask: 1, deny_mask: 0 },
    ]);
  });

  it('serialises the module-access row with the real empty submodule', () => {
    const next = setActionOverride(
      {}, MODULE_ACCESS.storageKey, PERM_BITS.view, OVERRIDE_STATE.DENY,
    );
    expect(buildOverridesPayload(next).overrides).toEqual([
      { module: 'inventory', submodule: '', allow_mask: 0, deny_mask: PERM_BITS.view },
    ]);
  });

  it('keeps hidden legacy and inactive rows byte-identical across a visible edit (test 18)', () => {
    const edited = setActionOverride(
      LOADED, STOCK_TRANSFER.storageKey, PERM_BITS.export, OVERRIDE_STATE.DENY,
    );
    const rows = buildOverridesPayload(edited).overrides;
    const find = key => rows.find(r => `${r.module}:${r.submodule}` === key);

    expect(find('manufacturing:machines')).toEqual({
      module: 'manufacturing', submodule: 'machines',
      allow_mask: PERM_BITS.view, deny_mask: PERM_BITS.create,
    });
    expect(find('hr:employees')).toEqual({
      module: 'hr', submodule: 'employees', allow_mask: 0, deny_mask: PERM_BITS.create,
    });
    expect(find('process:send_to_process')).toEqual({
      module: 'process', submodule: 'send_to_process', allow_mask: PERM_BITS.view, deny_mask: 0,
    });
    expect(find('inventory:stock_transfer').deny_mask).toBe(PERM_BITS.export);
  });

  it('keeps hidden rows when every visible override is reset', () => {
    const visible = visibleCapabilitiesOf(buildEditorView({
      groups: GROUPS, overrides: LOADED, baseline: BASE, isSuperAdmin: false,
    }));
    const reset = clearCapabilitiesOverrides(LOADED, visible);

    expect(countHiddenOverrideRecords(reset, activeStorageKeys(GROUPS))).toBe(3);
    expect(buildOverridesPayload(reset).overrides.map(r => `${r.module}:${r.submodule}`).sort())
      .toEqual(['hr:employees', 'manufacturing:machines', 'process:send_to_process']);
  });

  it('clears only the bits a capability displays', () => {
    // A stray bit outside the capability's supported actions is not the
    // editor's to delete.
    const stray = {
      [STOCK_TRANSFER.storageKey]: {
        allow_mask: PERM_BITS.approve | PERM_BITS.import, deny_mask: 0,
      },
    };
    expect(clearCapabilityOverrides(stray, STOCK_TRANSFER)[STOCK_TRANSFER.storageKey])
      .toEqual({ allow_mask: PERM_BITS.import, deny_mask: 0 });
  });

  it('serialises filtered-out rows unchanged (test 19)', () => {
    const filtered = buildEditorView({
      groups: GROUPS, overrides: LOADED, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, deniedOnly: true },
    });
    const searched = buildEditorView({
      groups: GROUPS, overrides: LOADED, baseline: BASE, isSuperAdmin: false,
      search: 'nothing matches this',
    });
    expect(searched.totals.matchedCapabilities).toBe(0);
    expect(filtered.totals.matchedCapabilities).toBeGreaterThan(0);

    // Neither derivation touched the map the payload is built from.
    expect(buildOverridesPayload(LOADED).overrides).toHaveLength(4);
    expect(canonicalOverrides(LOADED)).toBe(canonicalOverrides(LOADED));
  });

  it('serialises collapsed rows unchanged (test 20)', () => {
    // Collapse is component state; the model never receives it, which is the
    // structural reason a collapsed row cannot be dropped from the payload.
    const before = JSON.stringify(buildOverridesPayload(LOADED));
    buildEditorView({ groups: GROUPS, overrides: LOADED, baseline: BASE, isSuperAdmin: false });
    expect(JSON.stringify(buildOverridesPayload(LOADED))).toBe(before);
  });

  it('never emits a duplicate module/submodule row (test 25)', () => {
    let overrides = { ...LOADED };
    for (const capability of GROUPS.flatMap(g => g.capabilities)) {
      for (const act of capability.actions) {
        overrides = setActionOverride(overrides, capability.storageKey, act.bit, OVERRIDE_STATE.DENY);
      }
    }
    const keys = buildOverridesPayload(overrides).overrides.map(r => `${r.module}:${r.submodule}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ══════════════════════════════════════════════════════════════
   Catalog mapping — tests 21 to 24
   ══════════════════════════════════════════════════════════════ */

describe('catalog mapping', () => {
  it('accepts the fixture catalog', () => {
    expect(validateCatalog(CATALOG)).toEqual({ ok: true, reason: null });
  });

  it('never renders a duplicate legacy entry as an editable capability (test 21)', () => {
    const editableCodes = GROUPS.flatMap(g => g.capabilities).map(c => c.code);
    const diagnosticCodes = GROUPS.flatMap(g => g.diagnostics).map(c => c.code);

    expect(editableCodes).not.toContain('manufacturing.machines');
    expect(diagnosticCodes).toContain('manufacturing.machines');
    // Exactly once, in exactly one place.
    expect([...editableCodes, ...diagnosticCodes].filter(c => c === 'manufacturing.machines'))
      .toHaveLength(1);
  });

  it('maps every active catalog entry exactly once (test 22)', () => {
    const active = CATALOG.permissions.filter(p => p.status === STATUS.ACTIVE);
    const mapped = GROUPS.flatMap(g => g.capabilities);
    expect(mapped).toHaveLength(active.length);
    expect(new Set(mapped.map(c => c.storageKey)).size).toBe(active.length);
  });

  it('never makes a PLANNED_INACTIVE entry editable (test 23)', () => {
    expect(GROUPS.flatMap(g => g.capabilities).every(c => c.status === STATUS.ACTIVE)).toBe(true);
    expect(GROUPS.flatMap(g => g.diagnostics).map(c => c.code)).toContain('hr.employees');
  });

  it('never renders a blank submodule label (test 24)', () => {
    const all = GROUPS.flatMap(g => [...g.capabilities, ...g.diagnostics]);
    expect(all.every(c => String(c.submoduleLabel).trim() !== '')).toBe(true);
    expect(MODULE_ACCESS.submoduleLabel).toBe('module-level access');
  });

  it('renders groups in the catalog declared order', () => {
    expect(GROUPS.map(g => g.name)).toEqual(['Inventory', 'Manufacturing', 'Administration']);
  });

  it('shows only the actions the catalog declares for a capability', () => {
    expect(STOCK_TRANSFER.actions.map(a => a.id)).toEqual(['view', 'create', 'approve', 'export']);
    expect(PROCESS_RETURN.actions.map(a => a.id)).toEqual(['override_weight_variance']);
    expect(PROCESS_RETURN.actions[0].bit).toBe(2048);
  });

  it('uses the entry backend key for storage, never the canonical code', () => {
    const duplicate = capabilityByCode('manufacturing.machines');
    expect(duplicate.storageKey).toBe('manufacturing:machines');
    expect(duplicate.canonicalCode).toBe('management.machines');
  });
});

describe('catalog validation rejects unusable payloads', () => {
  const cases = [
    ['no catalog was returned', null],
    ['the catalog contains no permission entries', { permissions: [] }],
    ['the catalog group list is malformed', { permissions: CATALOG.permissions, groups: 'nope' }],
  ];

  for (const [reason, payload] of cases) {
    it(`rejects: ${reason}`, () => {
      const result = validateCatalog(payload);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
    });
  }

  it('rejects a duplicate active code', () => {
    const duped = { ...CATALOG, permissions: [...CATALOG.permissions, CATALOG.permissions[0]] };
    expect(validateCatalog(duped).reason).toContain('duplicate catalog code');
  });

  it('rejects two active entries writing the same key', () => {
    const clash = {
      ...CATALOG,
      permissions: [...CATALOG.permissions, {
        ...entry({ backend_module: 'inventory', backend_submodule: 'stock_transfer' }),
        code: 'inventory.stock_transfer_alias',
      }],
    };
    expect(validateCatalog(clash).reason).toContain('two active entries write the same key');
  });

  it('rejects an active entry with no label', () => {
    const blank = {
      ...CATALOG,
      permissions: [entry({ backend_module: 'x', backend_submodule: 'y', label: '  ' })],
    };
    expect(validateCatalog(blank).reason).toContain('has no label');
  });
});

/* ══════════════════════════════════════════════════════════════
   Enforcement, counts, search and filters
   ══════════════════════════════════════════════════════════════ */

describe('enforcement classification', () => {
  it('reports Enforced only when every present surface is enforced', () => {
    expect(enforcementLevelOf(ENFORCED_ALL)).toBe(ENFORCEMENT_LEVEL.ENFORCED);
  });

  it('reports Partial when some surfaces are guarded and others are not', () => {
    expect(enforcementLevelOf({ ...ENFORCED_ALL, api_edit: 'AUTHENTICATE_ONLY' }))
      .toBe(ENFORCEMENT_LEVEL.PARTIAL);
    expect(enforcementLevelOf({ ...UNGUARDED_ALL, api_list: 'PARTIALLY_ENFORCED' }))
      .toBe(ENFORCEMENT_LEVEL.PARTIAL);
  });

  it('reports Not enforced when nothing consults the resolver', () => {
    expect(enforcementLevelOf(UNGUARDED_ALL)).toBe(ENFORCEMENT_LEVEL.NOT_ENFORCED);
  });

  it('reports No active feature when every surface is absent', () => {
    const absent = Object.fromEntries(Object.keys(ENFORCED_ALL).map(k => [k, 'NO_ACTIVE_FEATURE']));
    expect(enforcementLevelOf(absent)).toBe(ENFORCEMENT_LEVEL.NO_ACTIVE_FEATURE);
  });
});

describe('counts, search and filters', () => {
  const OVERRIDES = {
    [STOCK_TRANSFER.storageKey]: { allow_mask: PERM_BITS.approve, deny_mask: PERM_BITS.view },
    'hr:employees': { allow_mask: PERM_BITS.view, deny_mask: 0 },
  };

  it('counts only the actions a capability displays', () => {
    expect(countCapabilityOverrides(OVERRIDES, STOCK_TRANSFER)).toBe(2);
    expect(countCapabilityOverrides(OVERRIDES, SEED_STOCK)).toBe(0);
  });

  it('counts hidden override records separately', () => {
    expect(countHiddenOverrideRecords(OVERRIDES, activeStorageKeys(GROUPS))).toBe(1);
  });

  it('matches a search on the business label', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: false, search: 'stock transfer',
    });
    expect(view.groups.flatMap(g => g.capabilities).map(c => c.capability.code))
      .toEqual(['inventory.stock_transfer']);
  });

  it('matches a search on the backend module/submodule key', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: false, search: 'seed_stock',
    });
    expect(view.groups.flatMap(g => g.capabilities).map(c => c.capability.code))
      .toEqual(['inventory.seed_stock']);
  });

  it('filters to actions that carry an override', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: OVERRIDES, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, overridesOnly: true },
    });
    const rows = view.groups.flatMap(g => g.capabilities).flatMap(c => c.visibleRows);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.overrideState !== OVERRIDE_STATE.INHERIT)).toBe(true);
  });

  it('filters to effectively denied actions', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: OVERRIDES, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, deniedOnly: true },
    });
    const rows = view.groups.flatMap(g => g.capabilities).flatMap(c => c.visibleRows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.effect === EFFECT.DENIED)).toBe(true);
  });

  it('filters to capabilities without full enforcement', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, unenforced: true },
    });
    expect(view.groups.flatMap(g => g.capabilities).map(c => c.capability.code))
      .toEqual(['inventory.seed_stock']);
  });

  it('combines filters', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: OVERRIDES, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, overridesOnly: true, deniedOnly: true },
    });
    const rows = view.groups.flatMap(g => g.capabilities).flatMap(c => c.visibleRows);
    expect(rows).toHaveLength(1);
    expect(rows[0].action.id).toBe('view');
  });

  it('exposes diagnostics only when asked', () => {
    const off = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: false,
    });
    const on = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: false,
      filters: { ...EMPTY_FILTERS, showInactive: true },
    });
    expect(off.groups.flatMap(g => g.diagnostics)).toHaveLength(0);
    expect(on.groups.flatMap(g => g.diagnostics).map(c => c.code).sort())
      .toEqual(['hr.employees', 'manufacturing.machines']);
  });

  it('reports Super Admin as fully allowed in the totals', () => {
    const view = buildEditorView({
      groups: GROUPS, overrides: {}, baseline: BASE, isSuperAdmin: true,
    });
    expect(view.totals.denied).toBe(0);
    expect(view.totals.allowed).toBe(view.totals.actions);
  });
});

describe('role tree aggregation', () => {
  it('BIT_ORs the masks across every assigned role', () => {
    const a = [{ module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: 1 }] }];
    const b = [{ module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: 4 }] }];
    expect(mergeRoleTrees([a, b])[0].submodules[0].permissions).toBe(5);
  });

  it('keeps submodules that only one role declares', () => {
    const a = [{ module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: 1 }] }];
    const b = [{ module: 'inventory', submodules: [{ key: 'seed_stock', permissions: 2 }] }];
    expect(mergeRoleTrees([a, b])[0].submodules.map(s => s.key).sort())
      .toEqual(['seed_stock', 'stock_transfer']);
  });

  it('returns null when no role tree could be read', () => {
    expect(mergeRoleTrees([null, undefined])).toBeNull();
    expect(mergeRoleTrees([])).toBeNull();
  });

  it('reads the override state straight out of the stored masks', () => {
    const overrides = { 'inventory:stock_transfer': { allow_mask: 2, deny_mask: 1 } };
    expect(overrideStateFor(overrides, 'inventory:stock_transfer', 2)).toBe(OVERRIDE_STATE.ALLOW);
    expect(overrideStateFor(overrides, 'inventory:stock_transfer', 1)).toBe(OVERRIDE_STATE.DENY);
    expect(overrideStateFor(overrides, 'inventory:stock_transfer', 4)).toBe(OVERRIDE_STATE.INHERIT);
    expect(overrideStateFor(overrides, 'missing:key', 1)).toBe(OVERRIDE_STATE.INHERIT);
  });

  it('short-circuits Super Admin ahead of every other rule', () => {
    expect(effectiveFor({
      baselineState: BASELINE.NO_ROW, overrideState: OVERRIDE_STATE.DENY, isSuperAdmin: true,
    })).toEqual({ effect: EFFECT.ALLOWED, source: SOURCE.SUPER_ADMIN });
  });
});

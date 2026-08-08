import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { PERM_BITS, ALL_PERMISSION_BITS } from '../../../../../shared/constants/permissions';
import {
  STATUS, buildGroups, buildCapability, enforcementLevelOf,
} from '../../permissions/permissionCatalogModel';
import {
  BASELINE, EFFECT, SOURCE, OVERRIDE_STATE,
  buildBaseline, mergeRoleTrees, effectiveMask,
} from '../../permissions/permissionEditorModel';
import {
  ENFORCEMENT,
  OVERRIDE_UNAVAILABLE,
  BRICK5_SOURCE,
  EMPTY_ACCESS_FILTERS,
  RISK_LEVELS,
  overallEnforcementOf,
  enforcementRankFor,
  brick3RankFor,
  isEnforcementGap,
  isRiskyGap,
  resolveEffective,
  buildAccessRow,
  summariseRows,
  buildAccessIndex,
  filterAccessView,
  matchesRowFilters,
  matchesRowSearch,
  toggleRiskLevel,
  activeAccessFilterCount,
  maskDetailFor,
  describeAccessSource,
} from '../effectiveAccessModel';
import { buildDataVisibility, AUTHORITY_ROWS } from '../dataVisibilityModel';

/* ══════════════════════════════════════════════════════════════
   Fixtures — shaped exactly like the Brick 1 endpoint payload
   ══════════════════════════════════════════════════════════════ */

const ENFORCED_ALL = {
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'NO_ACTIVE_FEATURE',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const PARTIAL_ALL = { ...ENFORCED_ALL, api_delete: 'AUTHENTICATE_ONLY' };

const AUTH_ONLY_ALL = {
  navigation: 'NOT_ENFORCED', frontend_route: 'NOT_ENFORCED', frontend_action: 'NOT_ENFORCED',
  api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY', api_create: 'AUTHENTICATE_ONLY',
  api_edit: 'AUTHENTICATE_ONLY', api_delete: 'AUTHENTICATE_ONLY',
  api_approve: 'NO_ACTIVE_FEATURE', export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const ROLE_STRING_ALL = { ...AUTH_ONLY_ALL, api_edit: 'ROLE_STRING_ONLY' };

const NO_FEATURE_ALL = Object.keys(ENFORCED_ALL)
  .reduce((acc, key) => Object.assign(acc, { [key]: 'NO_ACTIVE_FEATURE' }), {});

function entry(overrides = {}) {
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

const CAP = buildCapability(entry());
const VIEW = CAP.actions.find(a => a.id === 'view');
const APPROVE = CAP.actions.find(a => a.id === 'approve');

/** Baseline with a role row granting exactly the given mask on the fixture key. */
function baselineWith(mask, { available = true, roleNames = ['Operator'] } = {}) {
  return buildBaseline({
    roleTree: [{
      module: 'inventory',
      submodules: [{ key: 'stock_transfer', permissions: mask }],
    }],
    roleNames,
    available,
  });
}

/** Baseline that carries no entry at all for the fixture key. */
const EMPTY_BASELINE = buildBaseline({ roleTree: [], roleNames: [], available: true });
const UNAVAILABLE_BASELINE = buildBaseline({ roleTree: null, roleNames: [], available: false });

function row(options = {}) {
  return buildAccessRow({
    capability: options.capability || CAP,
    action: options.action || APPROVE,
    group: 'Inventory',
    overrides: options.overrides || {},
    baseline: options.baseline || baselineWith(PERM_BITS.view | PERM_BITS.approve),
    isSuperAdmin: options.isSuperAdmin || false,
    overridesAvailable: options.overridesAvailable !== false,
  });
}

/** The real catalog, so the parity claim below is not fixture-based. */
function loadServerCatalogEntries() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'server', 'rbac', 'permissionCatalog.js');
    if (existsSync(candidate)) {
      return createRequire(import.meta.url)(candidate).PERMISSIONS;
    }
    dir = dirname(dir);
  }
  throw new Error('server/rbac/permissionCatalog.js not found — parity cannot be verified');
}

/* ══════════════════════════════════════════════════════════════
   Effective algebra — tests 1 to 18
   ══════════════════════════════════════════════════════════════ */

describe('effective algebra', () => {
  it('Role Allow + Inherit = Allowed (test 1)', () => {
    const result = row({ baseline: baselineWith(PERM_BITS.approve) });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
    expect(result.effective.allowed).toBe(true);
    expect(result.effective.source).toBe(SOURCE.ROLE_ALLOW);
    expect(result.role_baseline.status).toBe(BASELINE.ALLOWED);
  });

  it('Role not granted + Inherit = Denied (test 2)', () => {
    const result = row({ baseline: baselineWith(PERM_BITS.view) });
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.source).toBe(SOURCE.ROLE_NOT_GRANTED);
    expect(result.role_baseline.status).toBe(BASELINE.NOT_GRANTED);
  });

  it('explicit Allow overrides a missing role grant (test 3)', () => {
    const result = row({
      baseline: baselineWith(PERM_BITS.view),
      overrides: { 'inventory:stock_transfer': { allow_mask: PERM_BITS.approve, deny_mask: 0 } },
    });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_ALLOW);
  });

  it('explicit Deny overrides a role Allow (test 4)', () => {
    const result = row({
      baseline: baselineWith(PERM_BITS.approve),
      overrides: { 'inventory:stock_transfer': { allow_mask: 0, deny_mask: PERM_BITS.approve } },
    });
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.allowed).toBe(false);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_DENY);
  });

  it('DENY wins when the role and the allow mask also grant (test 5)', () => {
    const result = row({
      baseline: baselineWith(PERM_BITS.approve),
      overrides: {
        'inventory:stock_transfer': { allow_mask: PERM_BITS.approve, deny_mask: PERM_BITS.approve },
      },
    });
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_DENY);
    // and the resolver's own arithmetic agrees bit for bit
    expect(effectiveMask(PERM_BITS.approve, PERM_BITS.approve, PERM_BITS.approve)
      & PERM_BITS.approve).toBe(0);
  });

  it('Super Admin is Allowed even against an explicit deny (test 6)', () => {
    const result = row({
      isSuperAdmin: true,
      baseline: EMPTY_BASELINE,
      overrides: { 'inventory:stock_transfer': { allow_mask: 0, deny_mask: PERM_BITS.approve } },
    });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
  });

  it('Super Admin source is the bypass, never a role (test 7)', () => {
    const result = row({ isSuperAdmin: true });
    expect(result.effective.source).toBe(SOURCE.SUPER_ADMIN);
    expect(result.effective.source_text).toBe('Super Admin bypass');
  });

  it('no baseline row + no override = Default Deny (test 8)', () => {
    const capability = buildCapability(entry({ has_baseline_rows: false }));
    const result = row({ capability, baseline: EMPTY_BASELINE });
    expect(result.role_baseline.status).toBe(BASELINE.NO_ROW);
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.source).toBe(SOURCE.NO_BASELINE);
    expect(result.effective.source_text).toBe('Default deny — no baseline configured');
  });

  it('NOT_REPORTED does not become a false Default Deny (test 9)', () => {
    // A module-access row: verified to exist, absent from the role API's tree.
    const capability = buildCapability(entry({ backend_submodule: '' }));
    const result = buildAccessRow({
      capability,
      action: capability.actions[0],
      group: 'Inventory',
      overrides: {},
      baseline: EMPTY_BASELINE,
      isSuperAdmin: false,
    });
    expect(result.role_baseline.status).toBe(BASELINE.NOT_REPORTED);
    expect(result.role_baseline.reported).toBe(false);
    expect(result.effective.status).toBe(EFFECT.UNKNOWN);
    expect(result.effective.source).toBe(SOURCE.NOT_REPORTED);
    expect(result.effective.source).not.toBe(SOURCE.NO_BASELINE);
    expect(result.effective.allowed).toBeNull();
  });

  it('NOT_REPORTED + explicit Allow = Allowed (test 10)', () => {
    const capability = buildCapability(entry({ backend_submodule: '' }));
    const { bit } = capability.actions[0];
    const result = buildAccessRow({
      capability,
      action: capability.actions[0],
      group: 'Inventory',
      overrides: { 'inventory:': { allow_mask: bit, deny_mask: 0 } },
      baseline: EMPTY_BASELINE,
      isSuperAdmin: false,
    });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_ALLOW);
  });

  it('NOT_REPORTED + explicit Deny = Denied (test 11)', () => {
    const capability = buildCapability(entry({ backend_submodule: '' }));
    const { bit } = capability.actions[0];
    const result = buildAccessRow({
      capability,
      action: capability.actions[0],
      group: 'Inventory',
      overrides: { 'inventory:': { allow_mask: 0, deny_mask: bit } },
      baseline: EMPTY_BASELINE,
      isSuperAdmin: false,
    });
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_DENY);
  });

  it('multi-role masks aggregate exactly like the backend BIT_OR (test 12)', () => {
    const roleA = [{ module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: PERM_BITS.view }] }];
    const roleB = [{ module: 'inventory', submodules: [{ key: 'stock_transfer', permissions: PERM_BITS.approve }] }];
    const baseline = buildBaseline({
      roleTree: mergeRoleTrees([roleA, roleB]),
      roleNames: ['Operator', 'Reporting'],
      available: true,
    });

    const viewRow = row({ action: VIEW, baseline });
    const approveRow = row({ action: APPROVE, baseline });

    expect(viewRow.effective.status).toBe(EFFECT.ALLOWED);
    expect(approveRow.effective.status).toBe(EFFECT.ALLOWED);
    expect(approveRow.role_baseline.mask).toBe(PERM_BITS.view | PERM_BITS.approve);
    expect(approveRow.effective.source_text).toBe('Role baseline — Operator, Reporting');
    // No primary role is invented from assignedRoleIds[0].
    expect(approveRow.role_baseline.roles).toEqual(['Operator', 'Reporting']);
  });

  it('carries all twelve action bits from the shared table (test 13)', () => {
    expect(Object.keys(PERM_BITS)).toHaveLength(12);
    const full = buildCapability(entry({ supported_actions: Object.keys(PERM_BITS) }));
    expect(full.actions).toHaveLength(12);
    expect(full.supportedMask).toBe(4095);
  });

  it('keeps the full mask at 4095 (test 14)', () => {
    expect(ALL_PERMISSION_BITS).toBe(4095);
    expect(effectiveMask(4095, 0, 0)).toBe(4095);
  });

  it('resolves override_weight_variance on its real bit (test 15)', () => {
    const capability = buildCapability(entry({ supported_actions: ['override_weight_variance'] }));
    const action = capability.actions[0];
    expect(action.bit).toBe(2048);

    const allowed = buildAccessRow({
      capability, action, group: 'Inventory', overrides: {},
      baseline: baselineWith(2048), isSuperAdmin: false,
    });
    expect(allowed.effective.status).toBe(EFFECT.ALLOWED);
  });

  it('rejects an unknown action safely (test 16)', () => {
    // The catalog model never builds an action for an unknown id, so no row can
    // exist for it — which is how an unknown action is "rejected" here.
    const capability = buildCapability(entry({ supported_actions: ['view', 'teleport'] }));
    expect(capability.actions.map(a => a.id)).toEqual(['view']);
    expect(capability.supportedMask).toBe(PERM_BITS.view);
  });

  it('holds the allow/deny invariant — deny always wins (test 17)', () => {
    for (const bit of Object.values(PERM_BITS)) {
      expect(effectiveMask(bit, bit, bit) & bit).toBe(0);
      expect(effectiveMask(0, bit, 0) & bit).toBe(bit);
    }
  });

  it('reproduces the frozen resolver vectors unchanged (test 18)', () => {
    // ((role | allow) & ~deny) & 4095
    expect(effectiveMask(2047, 0, 32)).toBe(2015);
    expect(effectiveMask(0, 0, 0)).toBe(0);
    expect(effectiveMask(4095, 0, 4095)).toBe(0);
    expect(effectiveMask(1, 2, 0)).toBe(3);
    expect(effectiveMask(4095, 4095, 0)).toBe(4095);
  });

  it('never mutates the inputs it is given', () => {
    const overrides = Object.freeze({
      'inventory:stock_transfer': Object.freeze({ allow_mask: 0, deny_mask: PERM_BITS.approve }),
    });
    expect(() => row({ overrides })).not.toThrow();
    expect(overrides['inventory:stock_transfer'].deny_mask).toBe(PERM_BITS.approve);
  });
});

/* ══════════════════════════════════════════════════════════════
   Failure states — an outage is never a verdict
   ══════════════════════════════════════════════════════════════ */

describe('data-outage handling', () => {
  it('a failed role read reports Unverified, not Denied', () => {
    const result = row({ baseline: UNAVAILABLE_BASELINE });
    expect(result.role_baseline.status).toBe(BASELINE.UNKNOWN);
    expect(result.effective.status).toBe(EFFECT.UNKNOWN);
    expect(result.effective.status).not.toBe(EFFECT.DENIED);
    expect(result.role_baseline.mask).toBeNull();
  });

  it('a failed role read still lets an explicit deny be conclusive', () => {
    const result = row({
      baseline: UNAVAILABLE_BASELINE,
      overrides: { 'inventory:stock_transfer': { allow_mask: 0, deny_mask: PERM_BITS.approve } },
    });
    expect(result.effective.status).toBe(EFFECT.DENIED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_DENY);
  });

  it('a failed role read still lets an explicit allow be conclusive', () => {
    const result = row({
      baseline: UNAVAILABLE_BASELINE,
      overrides: { 'inventory:stock_transfer': { allow_mask: PERM_BITS.approve, deny_mask: 0 } },
    });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
    expect(result.effective.source).toBe(SOURCE.EXPLICIT_ALLOW);
  });

  it('a failed override read never renders as Inherit', () => {
    const result = row({ overridesAvailable: false });
    expect(result.user_override.state).toBe(OVERRIDE_UNAVAILABLE);
    expect(result.user_override.state).not.toBe(OVERRIDE_STATE.INHERIT);
    expect(result.user_override.label).toBe('Unavailable');
    expect(result.user_override.allow_mask).toBeNull();
    expect(result.user_override.deny_mask).toBeNull();
    expect(result.effective.status).toBe(EFFECT.UNKNOWN);
    expect(result.effective.source).toBe(BRICK5_SOURCE.OVERRIDES_UNAVAILABLE);
  });

  it('an override outage cannot make Super Admin unverifiable', () => {
    const result = row({ overridesAvailable: false, isSuperAdmin: true });
    expect(result.effective.status).toBe(EFFECT.ALLOWED);
    expect(result.effective.source).toBe(SOURCE.SUPER_ADMIN);
  });

  it('resolveEffective delegates every non-outage case to Brick 3', () => {
    expect(resolveEffective({
      baselineState: BASELINE.ALLOWED,
      overrideState: OVERRIDE_STATE.INHERIT,
      isSuperAdmin: false,
    })).toEqual({ effect: EFFECT.ALLOWED, source: SOURCE.ROLE_ALLOW });
  });

  it('mask detail prints Not available rather than a fabricated zero', () => {
    const detail = maskDetailFor(row({ overridesAvailable: false }));
    expect(detail.allowMask).toBeNull();
    expect(detail.denyMask).toBeNull();
    expect(detail.effectiveMask).toBeNull();
  });

  it('mask detail reproduces the resolver expression when everything is known', () => {
    const detail = maskDetailFor(row({
      baseline: baselineWith(2047),
      overrides: { 'inventory:stock_transfer': { allow_mask: 0, deny_mask: 32 } },
    }));
    expect(detail.roleMask).toBe(2047);
    expect(detail.effectiveMask).toBe(2015);
  });

  it('names the Brick 5 source without shadowing Brick 3 wording', () => {
    expect(describeAccessSource(BRICK5_SOURCE.OVERRIDES_UNAVAILABLE))
      .toBe('User overrides unavailable — result unverified');
    expect(describeAccessSource(SOURCE.EXPLICIT_DENY)).toBe('Explicit user deny');
  });

  it('attaches the legacy-fallback caveat only to an unqualified default deny', () => {
    const capability = buildCapability(entry({ has_baseline_rows: false }));
    const defaultDeny = row({ capability, baseline: EMPTY_BASELINE });
    expect(defaultDeny.warnings.some(w => w.includes('legacy user_permissions'))).toBe(true);

    const explicit = row({
      capability,
      baseline: EMPTY_BASELINE,
      overrides: { 'inventory:stock_transfer': { allow_mask: PERM_BITS.approve, deny_mask: 0 } },
    });
    expect(explicit.warnings.some(w => w.includes('legacy user_permissions'))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Enforcement presentation — downgrade only
   ══════════════════════════════════════════════════════════════ */

describe('enforcement presentation', () => {
  it('reports ENFORCED only when every present surface is enforced', () => {
    expect(overallEnforcementOf(ENFORCED_ALL)).toBe(ENFORCEMENT.ENFORCED);
  });

  it('drops to partial as soon as one surface stops checking', () => {
    expect(overallEnforcementOf(PARTIAL_ALL)).toBe(ENFORCEMENT.PARTIALLY_ENFORCED);
  });

  it('reports authenticate-only when nothing consults the resolver', () => {
    expect(overallEnforcementOf(AUTH_ONLY_ALL)).toBe(ENFORCEMENT.AUTHENTICATE_ONLY);
  });

  it('prefers the strongest surviving gate below the partial tier', () => {
    expect(overallEnforcementOf(ROLE_STRING_ALL)).toBe(ENFORCEMENT.ROLE_STRING_ONLY);
  });

  it('reports no active feature when no surface exists', () => {
    expect(overallEnforcementOf(NO_FEATURE_ALL)).toBe(ENFORCEMENT.NO_ACTIVE_FEATURE);
    expect(overallEnforcementOf({})).toBe(ENFORCEMENT.NO_ACTIVE_FEATURE);
    expect(isEnforcementGap(ENFORCEMENT.NO_ACTIVE_FEATURE)).toBe(false);
  });

  it('treats everything short of full coverage as a gap', () => {
    expect(isEnforcementGap(ENFORCEMENT.ENFORCED)).toBe(false);
    expect(isEnforcementGap(ENFORCEMENT.PARTIALLY_ENFORCED)).toBe(true);
    expect(isEnforcementGap(ENFORCEMENT.AUTHENTICATE_ONLY)).toBe(true);
    expect(isEnforcementGap(ENFORCEMENT.NOT_ENFORCED)).toBe(true);
    expect(isEnforcementGap(ENFORCEMENT.UNKNOWN)).toBe(true);
  });

  /**
   * THE DOWNGRADE-ONLY RULE, pinned against the real Brick 1 catalog. Brick 5's
   * eight-value refinement may describe a capability as less protected than
   * Brick 3's four-value badge, never as more.
   */
  it('never claims more enforcement than Brick 3 for any real catalog entry', () => {
    const permissions = loadServerCatalogEntries();
    expect(permissions.length).toBeGreaterThan(0);

    for (const permission of permissions) {
      const mine = overallEnforcementOf(permission.enforcement);
      const brick3 = enforcementLevelOf(permission.enforcement);
      expect(enforcementRankFor(mine)).toBeLessThanOrEqual(brick3RankFor(brick3));
    }
  });

  it('agrees with Brick 3 exactly on the fully-enforced entries', () => {
    for (const permission of loadServerCatalogEntries()) {
      if (overallEnforcementOf(permission.enforcement) === ENFORCEMENT.ENFORCED) {
        expect(enforcementLevelOf(permission.enforcement)).toBe('ENFORCED');
      }
    }
  });

  it('flags allowed high-risk actions whose backend coverage is incomplete', () => {
    const capability = buildCapability(entry({ risk_level: 'HIGH', enforcement: AUTH_ONLY_ALL }));
    const risky = buildAccessRow({
      capability, action: capability.actions[1], group: 'Inventory', overrides: {},
      baseline: baselineWith(PERM_BITS.view | PERM_BITS.approve), isSuperAdmin: false,
    });
    expect(isRiskyGap(risky)).toBe(true);
    expect(risky.warnings.some(w => w.includes('does not enforce'))).toBe(true);
  });

  it('does not flag a denied high-risk action as a risky gap', () => {
    const capability = buildCapability(entry({ risk_level: 'HIGH', enforcement: AUTH_ONLY_ALL }));
    const denied = buildAccessRow({
      capability, action: capability.actions[1], group: 'Inventory', overrides: {},
      baseline: baselineWith(0), isSuperAdmin: false,
    });
    expect(isRiskyGap(denied)).toBe(false);
  });

  it('does not flag a low-risk unenforced action', () => {
    const capability = buildCapability(entry({ risk_level: 'LOW', enforcement: AUTH_ONLY_ALL }));
    const low = buildAccessRow({
      capability, action: capability.actions[0], group: 'Inventory', overrides: {},
      baseline: baselineWith(PERM_BITS.view), isSuperAdmin: false,
    });
    expect(isRiskyGap(low)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Summary counts
   ══════════════════════════════════════════════════════════════ */

describe('summary counts', () => {
  const GROUPS = buildGroups({
    groups: [{ name: 'Inventory' }],
    permissions: [
      entry({ backend_submodule: 'stock_transfer' }),
      entry({
        backend_submodule: 'lot_movements',
        label: 'Lot Movements',
        supported_actions: ['view'],
        enforcement: AUTH_ONLY_ALL,
        risk_level: 'LOW',
      }),
      entry({
        backend_submodule: 'seed_stock',
        label: 'Seed Stock',
        supported_actions: ['view'],
        has_baseline_rows: false,
      }),
      // A duplicate legacy mirror of stock_transfer — must never be counted twice.
      entry({
        backend_submodule: 'stock_transfer_legacy',
        label: 'Stock Transfer (legacy)',
        status: STATUS.DUPLICATE_LEGACY,
        canonical_code: 'inventory.stock_transfer',
        supported_actions: ['view', 'approve'],
      }),
    ],
  });

  const OVERRIDES = {
    'inventory:stock_transfer': { allow_mask: 0, deny_mask: PERM_BITS.approve },
    'inventory:lot_movements': { allow_mask: PERM_BITS.view, deny_mask: 0 },
  };

  const index = buildAccessIndex({
    groups: GROUPS,
    overrides: OVERRIDES,
    baseline: baselineWith(PERM_BITS.view | PERM_BITS.approve),
    isSuperAdmin: false,
  });

  it('counts only the active capabilities as action results (tests 1, 14)', () => {
    // stock_transfer view+approve, lot_movements view, seed_stock view = 4
    expect(index.summary.totalActions).toBe(4);
    expect(index.summary.totalCapabilities).toBe(3);
    expect(index.summary.inactiveDiagnostics).toBe(1);
  });

  it('does not double-count a duplicate legacy entry', () => {
    const codes = index.rows.map(r => r.code);
    expect(codes.filter(c => c === 'inventory.stock_transfer_legacy')).toHaveLength(0);
    expect(new Set(codes).size).toBe(3);
  });

  it('counts allowed and denied (tests 1, 2)', () => {
    // view: role allow. approve: explicit deny. lot view: explicit allow.
    // seed view: no baseline row → default deny.
    expect(index.summary.allowed).toBe(2);
    expect(index.summary.denied).toBe(2);
    expect(index.summary.unverified).toBe(0);
  });

  it('counts explicit allows and denies (tests 3, 4)', () => {
    expect(index.summary.explicitAllows).toBe(1);
    expect(index.summary.explicitDenies).toBe(1);
    expect(index.summary.overrides).toBe(2);
  });

  it('counts default denies and role-baseline outcomes (tests 5, 6)', () => {
    expect(index.summary.defaultDenies).toBe(1);
    expect(index.summary.roleBaselineAllows).toBe(1);
    expect(index.summary.roleBaselineDenies).toBe(0);
  });

  it('counts missing baseline rows (test 7)', () => {
    const missing = index.rows.filter(r => r.role_baseline.status === BASELINE.NO_ROW);
    expect(missing).toHaveLength(1);
    expect(missing[0].code).toBe('inventory.seed_stock');
  });

  it('counts not-reported baselines separately from default denies (test 8)', () => {
    const moduleGroups = buildGroups({
      groups: [{ name: 'Inventory' }],
      permissions: [entry({ backend_submodule: '', supported_actions: ['view'] })],
    });
    const moduleIndex = buildAccessIndex({
      groups: moduleGroups, overrides: {}, baseline: EMPTY_BASELINE, isSuperAdmin: false,
    });
    expect(moduleIndex.summary.notReported).toBe(1);
    expect(moduleIndex.summary.defaultDenies).toBe(0);
    expect(moduleIndex.summary.unverified).toBe(1);
  });

  it('counts Super Admin bypass actions (test 9)', () => {
    const superIndex = buildAccessIndex({
      groups: GROUPS, overrides: OVERRIDES, baseline: EMPTY_BASELINE, isSuperAdmin: true,
    });
    expect(superIndex.summary.superAdminBypass).toBe(4);
    expect(superIndex.summary.allowed).toBe(4);
    expect(superIndex.summary.denied).toBe(0);
  });

  it('counts enforcement tiers separately from permission outcomes (tests 10-13)', () => {
    expect(index.summary.enforced).toBe(3);
    expect(index.summary.authenticateOnly).toBe(1);
    expect(index.summary.partiallyEnforced).toBe(0);
    expect(index.summary.notEnforced).toBe(0);
    expect(index.summary.enforcementGaps).toBe(1);
  });

  it('partitions the same population twice, never as one score', () => {
    const { summary } = index;
    expect(summary.allowed + summary.denied + summary.unverified).toBe(summary.totalActions);
    const enforcementTotal = summary.enforced + summary.partiallyEnforced + summary.frontendOnly
      + summary.roleStringOnly + summary.authenticateOnly + summary.notEnforced
      + summary.noActiveFeature + summary.unknownEnforcement;
    expect(enforcementTotal).toBe(summary.totalActions);
  });

  it('an empty row set summarises to zeroes rather than throwing', () => {
    const summary = summariseRows([]);
    expect(summary.totalActions).toBe(0);
    expect(summary.allowed).toBe(0);
    expect(summary.overrides).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   Search and filters
   ══════════════════════════════════════════════════════════════ */

describe('search and filters', () => {
  const GROUPS = buildGroups({
    groups: [{ name: 'Inventory' }],
    permissions: [
      entry({ backend_submodule: 'stock_transfer' }),
      entry({
        backend_submodule: 'lot_movements',
        label: 'Lot Movements',
        supported_actions: ['view'],
        enforcement: AUTH_ONLY_ALL,
        risk_level: 'LOW',
      }),
      entry({
        backend_submodule: 'seed_stock',
        label: 'Seed Stock',
        supported_actions: ['view'],
        has_baseline_rows: false,
        risk_level: 'CRITICAL',
      }),
      entry({
        backend_submodule: 'orphan',
        label: 'Orphan Key',
        status: STATUS.LEGACY_ORPHAN,
        supported_actions: ['view'],
      }),
    ],
  });

  const index = buildAccessIndex({
    groups: GROUPS,
    overrides: {
      'inventory:stock_transfer': { allow_mask: 0, deny_mask: PERM_BITS.approve },
    },
    baseline: baselineWith(PERM_BITS.view | PERM_BITS.approve),
    isSuperAdmin: false,
  });

  const visible = result => result.groups.flatMap(g => g.rows);

  it('matches on business language', () => {
    const result = filterAccessView(index, { search: 'lot movements' });
    expect(visible(result).map(r => r.code)).toEqual(['inventory.lot_movements']);
  });

  it('matches on the backend key an engineer would search for', () => {
    const result = filterAccessView(index, { search: 'inventory.seed_stock' });
    expect(visible(result)).toHaveLength(1);
  });

  it('matches on the rendered source text', () => {
    const result = filterAccessView(index, { search: 'explicit user deny' });
    expect(visible(result).length).toBeGreaterThan(0);
    expect(visible(result).every(r => r.effective.source === SOURCE.EXPLICIT_DENY)).toBe(true);
  });

  it('filters to allowed only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, allowedOnly: true },
    });
    expect(visible(result).length).toBeGreaterThan(0);
    expect(visible(result).every(r => r.effective.status === EFFECT.ALLOWED)).toBe(true);
  });

  it('filters to denied only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, deniedOnly: true },
    });
    expect(visible(result).every(r => r.effective.status === EFFECT.DENIED)).toBe(true);
  });

  it('filters to explicit overrides only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, overridesOnly: true },
    });
    expect(visible(result)).toHaveLength(1);
    expect(visible(result)[0].user_override.state).toBe(OVERRIDE_STATE.DENY);
  });

  it('filters to default denied only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, defaultDeniedOnly: true },
    });
    expect(visible(result).map(r => r.code)).toEqual(['inventory.seed_stock']);
  });

  it('filters to unenforced only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, unenforcedOnly: true },
    });
    expect(visible(result).map(r => r.code)).toEqual(['inventory.lot_movements']);
  });

  it('filters to missing baseline only', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, missingBaselineOnly: true },
    });
    expect(visible(result).every(r => r.role_baseline.status === BASELINE.NO_ROW)).toBe(true);
  });

  it('filters by risk level', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, risk: ['CRITICAL'] },
    });
    expect(visible(result).map(r => r.code)).toEqual(['inventory.seed_stock']);
  });

  it('combines filters with AND, never with OR', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, deniedOnly: true, overridesOnly: true },
    });
    expect(visible(result)).toHaveLength(1);
    expect(visible(result)[0].action.id).toBe('approve');
  });

  it('hides legacy and orphaned entries unless diagnostics are requested', () => {
    const off = filterAccessView(index, {});
    expect(off.groups[0].diagnostics).toHaveLength(0);

    const on = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, showDiagnostics: true },
    });
    expect(on.groups[0].diagnostics.map(c => c.code)).toEqual(['inventory.orphan']);
  });

  it('reports group counts for what is shown, not for what exists', () => {
    const result = filterAccessView(index, {
      filters: { ...EMPTY_ACCESS_FILTERS, deniedOnly: true },
    });
    const [group] = result.groups;
    expect(group.counts.allowed).toBe(0);
    expect(group.counts.denied).toBe(group.rows.length);
  });

  it('clearing filters restores the whole index', () => {
    const cleared = filterAccessView(index, { filters: EMPTY_ACCESS_FILTERS, search: '' });
    expect(cleared.matchedRows).toBe(index.summary.totalActions);
    expect(cleared.isFiltered).toBe(false);
  });

  it('counts active filters including risk as one', () => {
    expect(activeAccessFilterCount(EMPTY_ACCESS_FILTERS)).toBe(0);
    expect(activeAccessFilterCount({
      ...EMPTY_ACCESS_FILTERS, deniedOnly: true, risk: ['HIGH', 'LOW'],
    })).toBe(2);
  });

  it('toggles a risk level immutably', () => {
    const on = toggleRiskLevel(EMPTY_ACCESS_FILTERS, 'HIGH');
    expect(on.risk).toEqual(['HIGH']);
    expect(EMPTY_ACCESS_FILTERS.risk).toEqual([]);
    expect(toggleRiskLevel(on, 'HIGH').risk).toEqual([]);
  });

  it('exposes exactly the four documented risk levels', () => {
    expect(RISK_LEVELS).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('an empty search matches everything', () => {
    expect(matchesRowSearch(index.rows[0], '   ')).toBe(true);
    expect(matchesRowFilters(index.rows[0], EMPTY_ACCESS_FILTERS)).toBe(true);
  });

  it('filtering never mutates the index it reads', () => {
    const before = JSON.stringify(index.summary);
    filterAccessView(index, { search: 'stock', filters: { ...EMPTY_ACCESS_FILTERS, deniedOnly: true } });
    expect(JSON.stringify(index.summary)).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════
   Data visibility
   ══════════════════════════════════════════════════════════════ */

describe('data visibility', () => {
  const DEPARTMENTS = [{ id: 3, name: 'Growing' }, { id: 7, name: 'Polish 2' }];
  const CATALOG = {
    groups: [{ name: 'Inventory' }],
    permissions: [entry({ backend_submodule: 'inventory_financial', supported_actions: ['view'] })],
    view_restrictions: [
      { code: 'scope.inventory_department', label: 'Inventory Departments', status: 'ENFORCED' },
      { code: 'inventory.inventory_financial', label: 'Financial Fields' },
      { code: 'vis.show_cogs', label: 'Cost of Goods Sold' },
    ],
  };

  /* The role reports a financial row that grants nothing — the ordinary shape
     for a user who simply is not allowed to see money. An EMPTY baseline would
     be the NOT_REPORTED case instead, which is asserted separately below. */
  const FINANCIAL_BASELINE = buildBaseline({
    roleTree: [{
      module: 'inventory',
      submodules: [{ key: 'inventory_financial', permissions: 0 }],
    }],
    roleNames: ['Operator'],
    available: true,
  });

  const base = {
    catalog: CATALOG,
    catalogFailed: false,
    prefs: { 'vis.show_cogs': 'true', 'vis.show_margin': 'false' },
    overrides: {},
    baseline: FINANCIAL_BASELINE,
    role: 'operator',
    isSuperAdmin: false,
    inventoryScope: { scope_mode: 'SELECTED', department_ids: [3, 7] },
    departments: DEPARTMENTS,
  };

  it('names the selected departments through Brick 4', () => {
    const visibility = buildDataVisibility(base);
    expect(visibility.scope.summary).toBe('Growing, Polish 2');
    expect(visibility.scope.applies).toBe(true);
  });

  it('never falls back to All Departments when the scope could not be read', () => {
    const visibility = buildDataVisibility({ ...base, scopeAvailable: false });
    expect(visibility.scope.summary).toBe('Unavailable');
    expect(visibility.scope.summary).not.toContain('All');
    expect(visibility.scope.available).toBe(false);
    expect(visibility.scope.warning).toContain('could not be read');
  });

  it('carries Brick 4 partial department enforcement rather than restoring ENFORCED', () => {
    const visibility = buildDataVisibility({ ...base, role: 'manager' });
    expect(visibility.scope.status).toBe('PARTIALLY_ENFORCED');
    expect(visibility.scope.warning).toContain('inventoryAuth.js:127');
  });

  it('marks the scope not applicable for Super Admin', () => {
    const visibility = buildDataVisibility({ ...base, role: 'super_admin', isSuperAdmin: true });
    expect(visibility.scope.applies).toBe(false);
  });

  it('derives Financial Fields from the real permission, not from vis.*', () => {
    const hidden = buildDataVisibility(base);
    expect(hidden.financial.summary).toBe('Hidden');

    const visible = buildDataVisibility({
      ...base,
      overrides: { 'inventory:inventory_financial': { allow_mask: PERM_BITS.view, deny_mask: 0 } },
    });
    expect(visible.financial.summary).toBe('Visible');
    expect(visible.financial.source).toBe(SOURCE.EXPLICIT_ALLOW);
  });

  it('reports Financial Fields as unverifiable when overrides could not be read', () => {
    const visibility = buildDataVisibility({ ...base, overridesAvailable: false });
    expect(visibility.financial.available).toBe(false);
  });

  it('reports Financial Fields as Unverified when the baseline cannot report the key', () => {
    const visibility = buildDataVisibility({ ...base, baseline: EMPTY_BASELINE });
    expect(visibility.financial.summary).toBe('Unverified');
    expect(visibility.financial.summary).not.toBe('Hidden');
    expect(visibility.financial.source).toBe(SOURCE.NOT_REPORTED);
  });

  it('lists stored vis.* keys as not enforced and creates none', () => {
    const visibility = buildDataVisibility(base);
    expect(visibility.stored.map(r => r.code).sort())
      .toEqual(['vis.show_cogs', 'vis.show_margin']);
    expect(visibility.stored.every(r => r.status === 'STORED_NOT_ENFORCED')).toBe(true);
    expect(visibility.storedWarning).toContain('no verified backend data restriction');
  });

  it('does not invent a stored row for a key the account does not hold', () => {
    const visibility = buildDataVisibility({ ...base, prefs: {} });
    expect(visibility.stored).toHaveLength(0);
  });

  it('states both authority dimensions as not modelled', () => {
    const visibility = buildDataVisibility(base);
    expect(visibility.authority).toEqual(AUTHORITY_ROWS);
    expect(visibility.authority.map(r => r.label))
      .toEqual(['Operational Authority', 'Approval Authority']);
    expect(visibility.authority.every(r => r.summary === 'Not modelled')).toBe(true);
  });

  it('does not derive authority from department visibility', () => {
    const wide = buildDataVisibility({
      ...base, inventoryScope: { scope_mode: 'ALL', department_ids: [] },
    });
    expect(wide.authority).toEqual(AUTHORITY_ROWS);
  });
});

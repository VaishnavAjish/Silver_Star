/**
 * RBAC Brick 3 — permission algebra and view derivation for the grouped editor.
 *
 * PURE FUNCTIONS ONLY. No React, no network. Every mask transformation and every
 * displayed verdict is produced here so the components stay dumb and the algebra
 * lives in one testable place.
 *
 * THE ALGEBRA IS NOT REIMPLEMENTED. The server resolver
 * (server/utils/permissions.js) computes
 *
 *     Effective = ((role_mask | allow_mask) & ~deny_mask) & ALL_PERMISSION_BITS
 *
 * and `effectiveMask()` below is that same expression, kept so the tests can
 * prove the per-action verdicts this file renders agree with it bit for bit. The
 * display path presents the resolver's precedence; it is not a second resolver,
 * and nothing here is consulted at request time.
 *
 * MUTATION RULE. Overrides are edited immutably and only ever through
 * `applyOverrideState` from userCardModel, which is the pre-Brick-2 arithmetic.
 * Keys the editor does not display are never touched, because
 * PUT /permission-overrides replaces the whole row set: an omitted row is a
 * deleted row.
 */

import { ALL_PERMISSION_BITS } from '../../../../shared/constants/permissions';
import { applyOverrideState } from '../userCardModel';
import { ENFORCEMENT_LEVEL } from './permissionCatalogModel';

/* ── Tri-state user override ────────────────────────────────── */

export const OVERRIDE_STATE = { INHERIT: 'INHERIT', ALLOW: 'ALLOW', DENY: 'DENY' };
export const OVERRIDE_STATES = [OVERRIDE_STATE.INHERIT, OVERRIDE_STATE.ALLOW, OVERRIDE_STATE.DENY];
export const OVERRIDE_STATE_LABELS = { INHERIT: 'Inherit', ALLOW: 'Allow', DENY: 'Deny' };

/* ── Role baseline ──────────────────────────────────────────── */

export const BASELINE = {
  ALLOWED: 'ALLOWED',
  NOT_GRANTED: 'NOT_GRANTED',
  NO_ROW: 'NO_ROW',
  /** A row exists, but the role API's tree does not carry this key. */
  NOT_REPORTED: 'NOT_REPORTED',
  UNKNOWN: 'UNKNOWN',
};

export const BASELINE_LABELS = {
  ALLOWED: 'Allowed',
  NOT_GRANTED: 'Not granted',
  NO_ROW: 'No baseline',
  NOT_REPORTED: 'Not reported',
  UNKNOWN: 'Unavailable',
};

/* ── Effective result ───────────────────────────────────────── */

export const EFFECT = { ALLOWED: 'ALLOWED', DENIED: 'DENIED', UNKNOWN: 'UNKNOWN' };
export const EFFECT_LABELS = { ALLOWED: 'Allowed', DENIED: 'Denied', UNKNOWN: 'Unknown' };

export const SOURCE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  EXPLICIT_DENY: 'EXPLICIT_DENY',
  EXPLICIT_ALLOW: 'EXPLICIT_ALLOW',
  ROLE_ALLOW: 'ROLE_ALLOW',
  ROLE_NOT_GRANTED: 'ROLE_NOT_GRANTED',
  NO_BASELINE: 'NO_BASELINE',
  NOT_REPORTED: 'NOT_REPORTED',
  UNKNOWN: 'UNKNOWN',
};

const SOURCE_TEXT = {
  SUPER_ADMIN: 'Super Admin bypass',
  EXPLICIT_DENY: 'Explicit user deny',
  EXPLICIT_ALLOW: 'Explicit user allow',
  ROLE_ALLOW: 'Role baseline',
  ROLE_NOT_GRANTED: 'Role baseline — not granted',
  NO_BASELINE: 'Default deny — no baseline configured',
  NOT_REPORTED: 'Role baseline exists but is not reported for this key',
  UNKNOWN: 'Role baseline could not be read',
};

export const NOT_REPORTED_NOTE =
  'The role API returns its tree from the module list, which carries no entry for this '
  + 'key, so the seeded role mask cannot be shown. The resolver still reads the stored row.';

export const NO_BASELINE_NOTE =
  'No role baseline row exists for this capability. A user override is still stored '
  + 'and applied by the resolver.';

export const SUPER_ADMIN_NOTE =
  'Super Admin effective access bypasses role and user override masks.';

/** Names the granting roles when the backend supplied them. */
export function describeSource(source, roleNames) {
  if (source === SOURCE.ROLE_ALLOW && roleNames?.length) {
    return `Role baseline — ${roleNames.join(', ')}`;
  }
  return SOURCE_TEXT[source] || SOURCE_TEXT.UNKNOWN;
}

/* ── The resolver's expression, for parity testing ──────────── */

export function effectiveMask(roleMask, allowMask, denyMask) {
  return (((roleMask | allowMask) & ~denyMask) & ALL_PERMISSION_BITS) >>> 0;
}

/* ── Role baseline index ────────────────────────────────────── */

/**
 * Merges the per-role permission trees the way the server does — BIT_OR across
 * every assigned role — so a user holding two roles is never shown one role's
 * view. The result keeps the shape the single-role endpoint returns, which is
 * what computeEffectiveAccess and the access summary already consume.
 */
export function mergeRoleTrees(trees) {
  const usable = (trees || []).filter(Array.isArray);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const merged = new Map();
  for (const tree of usable) {
    for (const mod of tree) {
      const existing = merged.get(mod.module) || { ...mod, submodules: new Map() };
      for (const sub of mod.submodules || []) {
        const previous = existing.submodules.get(sub.key);
        existing.submodules.set(sub.key, {
          ...sub,
          permissions: (previous?.permissions || 0) | (Number(sub.permissions) || 0),
        });
      }
      merged.set(mod.module, existing);
    }
  }
  return [...merged.values()].map(mod => ({ ...mod, submodules: [...mod.submodules.values()] }));
}

/**
 * `available: false` means the baseline could not be read at all — the editor
 * then says "Unavailable" instead of inventing a Denied.
 */
export function buildBaseline({ roleTree, roleNames = [], available = true }) {
  const masks = new Map();
  for (const mod of roleTree || []) {
    for (const sub of mod.submodules || []) {
      masks.set(`${mod.module}:${sub.key}`, Number(sub.permissions) || 0);
    }
  }
  return { available, masks, roleNames };
}

/* ── Per-action resolution ──────────────────────────────────── */

export function baselineStateFor(capability, bit, baseline) {
  // Brick 1 verified these capabilities have no seeded role_permissions row at
  // all; the role tree pads absent rows with 0, so it cannot tell us this.
  if (!capability.hasBaselineRow) return BASELINE.NO_ROW;
  if (!baseline?.available) return BASELINE.UNKNOWN;

  // The catalog says a row exists but the key is missing from the role tree.
  // GET /api/roles/:id/permissions builds that tree from MODULE_TREE, which has
  // no submodule = '' entries, so module-access rows land here. Reporting them
  // as "no baseline configured" would be a false statement about the database.
  if (!baseline.masks.has(capability.storageKey)) return BASELINE.NOT_REPORTED;

  return (baseline.masks.get(capability.storageKey) & bit) === bit
    ? BASELINE.ALLOWED
    : BASELINE.NOT_GRANTED;
}

export function overrideStateFor(overrides, storageKey, bit) {
  const entry = overrides?.[storageKey];
  if (!entry) return OVERRIDE_STATE.INHERIT;
  if (((entry.deny_mask || 0) & bit) === bit) return OVERRIDE_STATE.DENY;
  if (((entry.allow_mask || 0) & bit) === bit) return OVERRIDE_STATE.ALLOW;
  return OVERRIDE_STATE.INHERIT;
}

/** Precedence, in the resolver's order. Super Admin short-circuits first. */
export function effectiveFor({ baselineState, overrideState, isSuperAdmin }) {
  if (isSuperAdmin) return { effect: EFFECT.ALLOWED, source: SOURCE.SUPER_ADMIN };
  if (overrideState === OVERRIDE_STATE.DENY) {
    return { effect: EFFECT.DENIED, source: SOURCE.EXPLICIT_DENY };
  }
  if (overrideState === OVERRIDE_STATE.ALLOW) {
    return { effect: EFFECT.ALLOWED, source: SOURCE.EXPLICIT_ALLOW };
  }
  if (baselineState === BASELINE.NO_ROW) {
    return { effect: EFFECT.DENIED, source: SOURCE.NO_BASELINE };
  }
  if (baselineState === BASELINE.NOT_REPORTED) {
    return { effect: EFFECT.UNKNOWN, source: SOURCE.NOT_REPORTED };
  }
  if (baselineState === BASELINE.UNKNOWN) {
    return { effect: EFFECT.UNKNOWN, source: SOURCE.UNKNOWN };
  }
  if (baselineState === BASELINE.ALLOWED) {
    return { effect: EFFECT.ALLOWED, source: SOURCE.ROLE_ALLOW };
  }
  return { effect: EFFECT.DENIED, source: SOURCE.ROLE_NOT_GRANTED };
}

export function resolveActionRow({ capability, action, overrides, baseline, isSuperAdmin }) {
  const baselineState = baselineStateFor(capability, action.bit, baseline);
  const overrideState = overrideStateFor(overrides, capability.storageKey, action.bit);
  const { effect, source } = effectiveFor({ baselineState, overrideState, isSuperAdmin });
  return { action, baselineState, overrideState, effect, source };
}

/* ── Mask editing ───────────────────────────────────────────── */

/**
 * Sets one action of one capability to INHERIT / ALLOW / DENY.
 * Returns the same object reference when nothing changed, and can never produce
 * overlapping allow/deny bits because applyOverrideState clears the opposite.
 */
export function setActionOverride(overrides, storageKey, bit, state) {
  const current = overrides[storageKey] || { allow_mask: 0, deny_mask: 0 };
  const next = applyOverrideState(current, bit, state);
  if (next.allow_mask === (current.allow_mask || 0)
    && next.deny_mask === (current.deny_mask || 0)) return overrides;
  return { ...overrides, [storageKey]: next };
}

/**
 * Returns one capability's actions to INHERIT.
 *
 * Only the bits this capability actually displays are cleared. Any other bit
 * stored under the same key is invisible to the editor and therefore not the
 * editor's to delete — the same rule that protects hidden legacy rows.
 */
export function clearCapabilityOverrides(overrides, capability) {
  const current = overrides[capability.storageKey];
  if (!current) return overrides;
  const allow = (current.allow_mask || 0) & ~capability.supportedMask;
  const deny = (current.deny_mask || 0) & ~capability.supportedMask;
  if (allow === (current.allow_mask || 0) && deny === (current.deny_mask || 0)) return overrides;
  return { ...overrides, [capability.storageKey]: { allow_mask: allow, deny_mask: deny } };
}

/** Reset across many capabilities — hidden keys are simply never visited. */
export function clearCapabilitiesOverrides(overrides, capabilities) {
  return capabilities.reduce(
    (acc, capability) => clearCapabilityOverrides(acc, capability),
    overrides,
  );
}

/* ── Counting ───────────────────────────────────────────────── */

export function countCapabilityOverrides(overrides, capability) {
  const entry = overrides?.[capability.storageKey];
  if (!entry) return 0;
  const touched = ((entry.allow_mask || 0) | (entry.deny_mask || 0)) & capability.supportedMask;
  return capability.actions.filter(a => (touched & a.bit) === a.bit).length;
}

/**
 * Override records stored against keys no ACTIVE capability owns. These are the
 * rows the grouped editor hides and must carry through every save untouched.
 */
export function countHiddenOverrideRecords(overrides, visibleKeys) {
  return Object.entries(overrides || {}).filter(([key, value]) => (
    !visibleKeys.has(key) && ((value?.allow_mask || 0) > 0 || (value?.deny_mask || 0) > 0)
  )).length;
}

/* ── Search and filters ─────────────────────────────────────── */

export const EMPTY_FILTERS = Object.freeze({
  overridesOnly: false,
  deniedOnly: false,
  unenforced: false,
  showInactive: false,
});

export function activeFilterCount(filters) {
  return [filters.overridesOnly, filters.deniedOnly, filters.unenforced, filters.showInactive]
    .filter(Boolean).length;
}

/** Search spans business language and backend keys, so both audiences can find a row. */
export function capabilityHaystack(capability, groupName) {
  return [
    groupName,
    capability.label,
    capability.description,
    capability.code,
    capability.canonicalCode,
    capability.module,
    capability.submodule,
    capability.submoduleLabel,
    ...capability.actions.map(a => a.label),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function matchesSearch(capability, groupName, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle === '') return true;
  return capabilityHaystack(capability, groupName).includes(needle);
}

function rowsPassingFilters(rows, filters) {
  let out = rows;
  if (filters.overridesOnly) out = out.filter(r => r.overrideState !== OVERRIDE_STATE.INHERIT);
  if (filters.deniedOnly) out = out.filter(r => r.effect === EFFECT.DENIED);
  return out;
}

const UNENFORCED_LEVELS = [
  ENFORCEMENT_LEVEL.PARTIAL,
  ENFORCEMENT_LEVEL.NOT_ENFORCED,
  ENFORCEMENT_LEVEL.NO_ACTIVE_FEATURE,
];

export function isUnenforced(capability) {
  return UNENFORCED_LEVELS.includes(capability.enforcementLevel);
}

/* ── View derivation ────────────────────────────────────────── */

function buildCapabilityView({
  capability, groupName, overrides, baseline, isSuperAdmin, filters, search,
}) {
  const rows = capability.actions.map(action => resolveActionRow({
    capability, action, overrides, baseline, isSuperAdmin,
  }));

  const matches = matchesSearch(capability, groupName, search)
    && (!filters.unenforced || isUnenforced(capability));

  return {
    capability,
    rows,
    visibleRows: rowsPassingFilters(rows, filters),
    overrideCount: rows.filter(r => r.overrideState !== OVERRIDE_STATE.INHERIT).length,
    deniedCount: rows.filter(r => r.effect === EFFECT.DENIED).length,
    allowedCount: rows.filter(r => r.effect === EFFECT.ALLOWED).length,
    matches,
  };
}

function tallyGroup(totals, capabilities) {
  for (const view of capabilities) {
    totals.capabilities += 1;
    totals.actions += view.rows.length;
    totals.overrides += view.overrideCount;
    totals.allowed += view.allowedCount;
    totals.denied += view.deniedCount;
    if (view.overrideCount > 0) totals.capabilitiesWithOverrides += 1;
    if (isUnenforced(view.capability)) totals.unenforcedCapabilities += 1;
  }
}

/**
 * The whole editor as plain data: groups → capabilities → action rows, plus the
 * counts the toolbar and group headers show.
 *
 * Search, filters and expansion are presentation only. They shape THIS structure
 * and nothing else — the override map handed to the payload builder is never
 * derived from it, which is why a filtered-out or collapsed row still saves.
 */
export function buildEditorView({
  groups, overrides, baseline, isSuperAdmin, search = '', filters = EMPTY_FILTERS,
}) {
  const totals = {
    capabilities: 0, actions: 0, overrides: 0, allowed: 0, denied: 0,
    capabilitiesWithOverrides: 0, unenforcedCapabilities: 0, matchedCapabilities: 0,
  };

  const viewGroups = groups.map((group) => {
    const capabilities = group.capabilities.map(capability => buildCapabilityView({
      capability, groupName: group.name, overrides, baseline, isSuperAdmin, filters, search,
    }));
    tallyGroup(totals, capabilities);

    // A capability survives when it matches the search AND still has at least one
    // action row left after the action-level filters.
    const visible = capabilities.filter(v => v.matches && v.visibleRows.length > 0);
    totals.matchedCapabilities += visible.length;

    const diagnostics = (filters.showInactive ? group.diagnostics : [])
      .filter(capability => matchesSearch(capability, group.name, search));

    return {
      name: group.name,
      capabilities: visible,
      diagnostics,
      totalCapabilities: group.capabilities.length,
      overrideCount: capabilities.reduce((n, v) => n + v.overrideCount, 0),
      deniedCount: capabilities.reduce((n, v) => n + v.deniedCount, 0),
      unenforcedCount: group.capabilities.filter(isUnenforced).length,
      hasVisibleContent: visible.length > 0 || diagnostics.length > 0,
    };
  });

  return { groups: viewGroups, totals };
}

/** Every ACTIVE capability currently on screen — the target of "reset visible". */
export function visibleCapabilitiesOf(view) {
  return view.groups.flatMap(group => group.capabilities.map(v => v.capability));
}

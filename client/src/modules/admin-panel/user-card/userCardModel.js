/**
 * RBAC Brick 2 — pure model for the compact User Card.
 *
 * Everything here is a plain function over plain data: no React, no network.
 * Two jobs:
 *
 *   1. CANONICALISATION + DIRTY COMPARISON. A category is dirty only when its
 *      current value differs from the snapshot loaded from the server, so
 *      editing a field and putting it back makes the category clean again.
 *
 *   2. PAYLOAD BUILDERS. These reproduce the exact request bodies the previous
 *      UserDrawer sent, key order included. Brick 2 is a UI change only — the
 *      permission model, masks and endpoints are untouched, and
 *      user-card/__tests__/userCardModel.test.js pins the serialised bytes.
 *
 * The override key format `${module}:${submodule}` and the mask arithmetic are
 * carried over verbatim from the previous drawer. Do not "improve" them here;
 * the resolver on the server reads these masks.
 */

/* ── Category identifiers ───────────────────────────────────── */
export const CATEGORIES = ['general', 'access', 'preferences', 'security'];

export const CATEGORY_LABELS = {
  general: 'General',
  access: 'Access Control',
  preferences: 'Preferences',
  security: 'Security',
};

/** Save states. Rendered as text, never colour alone. */
export const SAVE_STATE = {
  NOT_CHANGED: 'not_changed',
  SAVING: 'saving',
  SAVED: 'saved',
  FAILED: 'failed',
  /* RBAC Brick 7. A stale-write 409 is NOT the same as a failure: nothing went
     wrong with the request, and retrying it unchanged would either fail again
     or — if the check were skipped — silently revert another administrator's
     newer change. It gets its own state so the footer can say "changed
     elsewhere" and offer Reload rather than Retry. Edits are kept either way. */
  CONFLICT: 'conflict',
};

export const SAVE_STATE_LABELS = {
  [SAVE_STATE.NOT_CHANGED]: 'Not Changed',
  [SAVE_STATE.SAVING]: 'Saving',
  [SAVE_STATE.SAVED]: 'Saved',
  [SAVE_STATE.FAILED]: 'Failed',
  [SAVE_STATE.CONFLICT]: 'Changed elsewhere',
};

/** Codes the server sends for a stale administrative write (HTTP 409). */
export const STALE_WRITE_CODES = Object.freeze([
  'STALE_PERMISSION_VERSION',
  'STALE_INVENTORY_SCOPE',
  'STALE_ROLE_ASSIGNMENT',
  'STALE_ROLE_PERMISSIONS',
  'STALE_COPY_PREVIEW',
]);

/**
 * True when an error is a stale-write conflict.
 *
 * Keyed on the stable code, with the HTTP status as the fallback for a response
 * that carried no code. Never on the message text, which is free to be reworded.
 */
export function isStaleWriteError(err) {
  if (!err) return false;
  if (err.code && STALE_WRITE_CODES.includes(err.code)) return true;
  return err.status === 409;
}

/* ── Canonicalisation ───────────────────────────────────────── */

/**
 * Basic-info fields compared as strings: a department picked from a `<select>`
 * arrives as "7" while the server sends 7, and those must count as equal.
 */
export function canonicalBasic(basic) {
  return JSON.stringify({
    username: String(basic?.username ?? '').trim(),
    email: String(basic?.email ?? '').trim(),
    full_name: String(basic?.full_name ?? '').trim(),
    role: String(basic?.role ?? ''),
    department_id: basic?.department_id === '' || basic?.department_id == null
      ? ''
      : String(basic.department_id),
  });
}

/** Preference values are stored as text server-side, so compare as text. */
export function canonicalPrefs(prefs) {
  const out = {};
  for (const key of Object.keys(prefs || {}).sort()) {
    out[key] = String(prefs[key] ?? '');
  }
  return JSON.stringify(out);
}

/**
 * Overrides drop to their meaningful content: an entry both of whose masks are
 * zero is identical to no entry at all, and key order is irrelevant. This is
 * what makes "toggle a permission and toggle it back" register as clean.
 */
export function canonicalOverrides(overrides) {
  const out = {};
  for (const key of Object.keys(overrides || {}).sort()) {
    const allow = Number(overrides[key]?.allow_mask || 0);
    const deny = Number(overrides[key]?.deny_mask || 0);
    if (allow === 0 && deny === 0) continue;
    out[key] = { allow_mask: allow, deny_mask: deny };
  }
  return JSON.stringify(out);
}

/**
 * Department order carries no meaning, and the id list is only meaningful in
 * SELECTED mode — the previous drawer already cleared it for NONE and ALL.
 */
export function canonicalScope(scope) {
  const mode = String(scope?.scope_mode || 'ALL');
  const ids = mode === 'SELECTED'
    ? [...new Set((scope?.department_ids || []).map(Number))].sort((a, b) => a - b)
    : [];
  return JSON.stringify({ scope_mode: mode, department_ids: ids });
}

export function canonicalRoleIds(roleIds) {
  return JSON.stringify([...new Set((roleIds || []).map(Number))].sort((a, b) => a - b));
}

/* ── Snapshots ──────────────────────────────────────────────── */

/**
 * The server snapshot every dirty check is measured against. `security` holds
 * no server value — a password is never read back — so its baseline is the
 * empty form, which is also what "reverted" looks like.
 */
export function buildSnapshot({ basic, prefs, overrides, scope, roleIds }) {
  return {
    general: {
      basic: canonicalBasic(basic),
      roleIds: canonicalRoleIds(roleIds),
    },
    access: {
      overrides: canonicalOverrides(overrides),
      scope: canonicalScope(scope),
    },
    preferences: {
      prefs: canonicalPrefs(prefs),
    },
    security: {
      password: '',
    },
  };
}

/**
 * Per-category dirty flags plus the finer-grained flags the save step needs to
 * decide which of a category's two endpoints to call.
 */
export function computeDirty({ snapshot, basic, prefs, overrides, scope, roleIds, password }) {
  const basicDirty = !!snapshot && canonicalBasic(basic) !== snapshot.general.basic;
  const roleIdsDirty = !!snapshot && canonicalRoleIds(roleIds) !== snapshot.general.roleIds;
  const overridesDirty = !!snapshot && canonicalOverrides(overrides) !== snapshot.access.overrides;
  const scopeDirty = !!snapshot && canonicalScope(scope) !== snapshot.access.scope;
  const prefsDirty = !!snapshot && canonicalPrefs(prefs) !== snapshot.preferences.prefs;
  const passwordDirty = String(password || '') !== '';

  const byCategory = {
    general: basicDirty || roleIdsDirty,
    access: overridesDirty || scopeDirty,
    preferences: prefsDirty,
    security: passwordDirty,
  };

  return {
    byCategory,
    parts: { basicDirty, roleIdsDirty, overridesDirty, scopeDirty, prefsDirty, passwordDirty },
    any: CATEGORIES.some(c => byCategory[c]),
    dirtyCategories: CATEGORIES.filter(c => byCategory[c]),
  };
}

/* ── Payload builders (byte-identical to the pre-Brick-2 drawer) ── */

/** PUT /api/admin/users/:id */
export function buildBasicPayload(basic) {
  return {
    username: basic.username,
    email: basic.email,
    full_name: basic.full_name,
    role: basic.role,
    department_id: basic.department_id ? Number(basic.department_id) : null,
  };
}

/** PUT /api/roles/users/:id/roles */
export function buildRolesPayload(assignedRoleIds) {
  return { role_ids: assignedRoleIds };
}

/**
 * PUT /api/admin/users/:id/preferences
 * Insertion order of `prefs` is the wire order, exactly as before. Callers must
 * keep building the prefs object as `{ ...PREF_DEFAULTS }` then server rows.
 */
export function buildPreferencesPayload(prefs) {
  const preferences = Object.entries(prefs).map(([pref_key, pref_value]) => ({
    pref_key,
    pref_value: String(pref_value ?? ''),
  }));
  return { preferences };
}

/** PUT /api/admin/users/:id/inventory-scope */
export function buildScopePayload(inventoryScope) {
  return {
    scope_mode: inventoryScope.scope_mode,
    include_unassigned: false,
    department_ids: inventoryScope.department_ids,
  };
}

/**
 * PUT /api/admin/users/:id/permission-overrides
 * Zero-mask entries are omitted and insertion order is preserved — both
 * carried over from the previous implementation.
 */
export function buildOverridesPayload(userOverrides) {
  const overrides = [];
  Object.entries(userOverrides).forEach(([key, val]) => {
    const [module, submodule] = key.split(':');
    if ((val.allow_mask || 0) > 0 || (val.deny_mask || 0) > 0) {
      overrides.push({
        module,
        submodule: submodule || '',
        allow_mask: val.allow_mask || 0,
        deny_mask: val.deny_mask || 0,
      });
    }
  });
  return { overrides };
}

/* ── Override mask helpers (unchanged semantics) ─────────────── */

export function overrideKey(moduleKey, submoduleKey) {
  return `${moduleKey}:${submoduleKey}`;
}

/** 'ALLOW' | 'DENY' | 'INHERIT' for one action of one submodule. */
export function getOverrideState(overrides, moduleKey, submoduleKey, bit) {
  if (bit === undefined) return 'INHERIT';
  const ov = overrides[overrideKey(moduleKey, submoduleKey)] || { allow_mask: 0, deny_mask: 0 };
  if ((ov.allow_mask & bit) === bit) return 'ALLOW';
  if ((ov.deny_mask & bit) === bit) return 'DENY';
  return 'INHERIT';
}

/** INHERIT → ALLOW → DENY → INHERIT */
export function nextOverrideState(current) {
  if (current === 'ALLOW') return 'DENY';
  if (current === 'DENY') return 'INHERIT';
  return 'ALLOW';
}

/** Applies `nextState` for one bit, returning a new masks object. */
export function applyOverrideState(masks, bit, nextState) {
  let allow = masks?.allow_mask || 0;
  let deny = masks?.deny_mask || 0;
  if (nextState === 'ALLOW') {
    allow |= bit;
    deny &= ~bit;
  } else if (nextState === 'DENY') {
    allow &= ~bit;
    deny |= bit;
  } else {
    allow &= ~bit;
    deny &= ~bit;
  }
  return { allow_mask: allow, deny_mask: deny };
}

/** Number of override records that would be written (non-zero masks only). */
export function countOverrideRecords(overrides) {
  return Object.values(overrides || {})
    .filter(v => (v?.allow_mask || 0) > 0 || (v?.deny_mask || 0) > 0)
    .length;
}

/* ── Read-only summaries ────────────────────────────────────── */

export const SCOPE_LABELS = {
  NONE: 'No Access',
  SELECTED: 'Selected Departments',
  ALL: 'All Departments',
};

export function describeScope(scope, departmentCount) {
  const mode = scope?.scope_mode || 'ALL';
  if (mode === 'SELECTED') {
    const n = departmentCount ?? (scope?.department_ids || []).length;
    return `${SCOPE_LABELS.SELECTED} (${n})`;
  }
  return SCOPE_LABELS[mode] || mode;
}

/**
 * Effective-access tally from the role baseline combined with user overrides,
 * following the same precedence the server resolver uses: an explicit DENY wins
 * over an explicit ALLOW, which wins over the role baseline.
 *
 * `roleTree` is the response of GET /api/roles/:id/permissions. When it is
 * absent the baseline is unknown, so `hasBaseline` is false and callers must
 * not present the numbers as effective access.
 */
export function computeEffectiveAccess({ moduleTree, actions, permBits, roleTree, overrides }) {
  const baseline = new Map();
  for (const mod of roleTree || []) {
    for (const sm of mod.submodules || []) {
      baseline.set(overrideKey(mod.module, sm.key), Number(sm.permissions || 0));
    }
  }

  let allowed = 0;
  let deniedByOverride = 0;
  let allowedByOverride = 0;
  let defaultDenied = 0;
  let total = 0;

  for (const mod of moduleTree) {
    for (const sm of mod.submodules || []) {
      const key = overrideKey(mod.module, sm.key);
      const base = baseline.get(key) || 0;
      const ov = (overrides || {})[key] || { allow_mask: 0, deny_mask: 0 };

      for (const action of actions) {
        const bit = permBits[action.id];
        if (bit === undefined) continue;
        total += 1;

        const isDenied = (ov.deny_mask & bit) === bit;
        const isAllowed = (ov.allow_mask & bit) === bit;

        if (isDenied) {
          deniedByOverride += 1;
        } else if (isAllowed) {
          allowed += 1;
          allowedByOverride += 1;
        } else if ((base & bit) === bit) {
          allowed += 1;
        } else {
          defaultDenied += 1;
        }
      }
    }
  }

  return {
    allowed,
    deniedByOverride,
    allowedByOverride,
    defaultDenied,
    total,
    hasBaseline: Array.isArray(roleTree) && roleTree.length > 0,
  };
}

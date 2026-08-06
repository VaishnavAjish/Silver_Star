import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MODULE_TREE, PERM_BITS, ACTIONS } from '../../../shared/constants/permissions';
import {
  SAVE_STATE,
  buildSnapshot,
  computeDirty,
  canonicalBasic,
  canonicalRoleIds,
  canonicalOverrides,
  canonicalScope,
  canonicalPrefs,
  buildBasicPayload,
  buildRolesPayload,
  buildPreferencesPayload,
  buildScopePayload,
  buildOverridesPayload,
  computeEffectiveAccess,
  countOverrideRecords,
} from './userCardModel';
import { mergeRoleTrees, buildBaseline } from './permissions/permissionEditorModel';

/**
 * Preference keys and their defaults. Kept in the exact order the previous
 * drawer used, because that order is the wire order of the preferences payload.
 */
export const PREF_DEFAULTS = {
  landing_page: '/', rows_per_page: '50', theme: 'light',
  compact_mode: 'false', default_branch: '',
  'vis.show_cogs': 'true', 'vis.show_purchase_rate': 'true',
  'vis.show_sale_rate': 'true', 'vis.show_margin': 'true',
  'vis.show_gross_profit': 'true', 'vis.show_net_profit': 'true',
  'vis.show_balances': 'true',
};

const EMPTY_SAVE_STATE = {
  general: SAVE_STATE.NOT_CHANGED,
  access: SAVE_STATE.NOT_CHANGED,
  preferences: SAVE_STATE.NOT_CHANGED,
  security: SAVE_STATE.NOT_CHANGED,
};

/**
 * All state behind the compact User Card: server snapshot, form values,
 * per-category dirty flags and per-category save reporting.
 *
 * Saves stay on the pre-Brick-2 per-category endpoints. There is no composite
 * transaction, so `saveCategories` reports each category's own outcome and
 * never a single global success — a category that fails keeps its edited values
 * and its dirty flag so the admin can retry it.
 */
export function useUserCard({ user, api, onAfterSave }) {
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState(null);

  /* Server snapshot every dirty check is measured against. */
  const [snapshot, setSnapshot] = useState(null);

  /* Form state */
  const [basic, setBasic] = useState({ username: '', email: '', full_name: '', role: 'operator', department_id: '' });
  const [prefs, setPrefs] = useState({ ...PREF_DEFAULTS });
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [assignedRoleIds, setAssignedRoleIds] = useState([]);
  const [inventoryScope, setInventoryScope] = useState({ scope_mode: 'ALL', department_ids: [] });
  const [userOverrides, setUserOverrides] = useState({});

  /* Reference data */
  const [departments, setDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [roleTree, setRoleTree] = useState(null);
  /* True only when the role masks could not be read at all — distinct from a
     user who legitimately has no role rows. */
  const [baselineFailed, setBaselineFailed] = useState(false);

  /* Brick 1 catalog — diagnostics only, never required for editing. */
  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  /* Save reporting */
  const [saveState, setSaveState] = useState(EMPTY_SAVE_STATE);
  const [saveErrors, setSaveErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [resetting, setResetting] = useState(false);

  const userId = user?.id;

  /* ── Load ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    setFetching(true);
    setLoadError(null);
    setSaveState(EMPTY_SAVE_STATE);
    setSaveErrors({});
    setPw({ password: '', confirm: '' });
    setRoleTree(null);
    setBaselineFailed(false);

    const nextBasic = {
      username: user.username,
      email: user.email || '',
      full_name: user.full_name,
      role: user.role,
      department_id: user.department_id || '',
    };
    setBasic(nextBasic);

    Promise.all([
      apiRef.current.get(`/api/admin/users/${userId}/preferences`),
      apiRef.current.get('/api/departments', { limit: 500, offset: 0 })
        .then(r => (Array.isArray(r) ? r : (r?.data || []))).catch(() => []),
      apiRef.current.get('/api/roles').then(r => (r?.data || [])).catch(() => []),
      apiRef.current.get(`/api/admin/users/${userId}/inventory-scope`).catch(() => null),
      apiRef.current.get(`/api/admin/users/${userId}/permission-overrides`)
        .then(r => r?.data || []).catch(() => []),
    ]).then(([prefRows, deptData, rolesData, invScopeData, overridesData]) => {
      if (cancelled) return;

      setDepartments(deptData || []);
      setAllRoles(rolesData || []);

      const nextScope = invScopeData
        ? {
          scope_mode: invScopeData.scope_mode || 'ALL',
          department_ids: Array.isArray(invScopeData.departments)
            ? invScopeData.departments.map(d => d.department_id)
            : [],
        }
        : { scope_mode: 'ALL', department_ids: [] };
      setInventoryScope(nextScope);

      // Defaults first, then server rows — this order is the preferences wire order.
      const nextPrefs = { ...PREF_DEFAULTS };
      (prefRows || []).forEach(r => { nextPrefs[r.pref_key] = r.pref_value; });
      setPrefs(nextPrefs);

      const matchingRole = (rolesData || []).find(r => r.slug === user.role);
      const nextRoleIds = matchingRole ? [matchingRole.id] : [];
      setAssignedRoleIds(nextRoleIds);

      const nextOverrides = {};
      (overridesData || []).forEach(ov => {
        nextOverrides[`${ov.module}:${ov.submodule || ''}`] = {
          allow_mask: ov.allow_mask || 0,
          deny_mask: ov.deny_mask || 0,
        };
      });
      setUserOverrides(nextOverrides);

      setSnapshot(buildSnapshot({
        basic: nextBasic,
        prefs: nextPrefs,
        overrides: nextOverrides,
        scope: nextScope,
        roleIds: nextRoleIds,
      }));
      setFetching(false);
    }).catch(err => {
      if (cancelled) return;
      setLoadError(err?.message || 'Failed to load user settings');
      setFetching(false);
    });

    return () => { cancelled = true; };
  }, [userId]);

  /* ── Brick 1 catalog: read-only metadata, must never block editing ── */
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setCatalogFailed(false);
    apiRef.current.get('/api/admin/permission-catalog')
      .then(data => { if (!cancelled) setCatalog(data); })
      .catch(() => { if (!cancelled) { setCatalog(null); setCatalogFailed(true); } });
    return () => { cancelled = true; };
  }, [userId]);

  /* ── Role baseline (read-only) ─────────────────────────────
   * Every assigned role is read and the masks are BIT_ORed, which is what the
   * server resolver does across user_roles. Picking one role would show a user
   * with two roles a baseline they do not actually have. One request per role,
   * never per capability. */
  const roleIdsKey = assignedRoleIds.join(',');
  useEffect(() => {
    const ids = roleIdsKey === '' ? [] : roleIdsKey.split(',');
    if (ids.length === 0) { setRoleTree(null); setBaselineFailed(false); return undefined; }

    let cancelled = false;
    Promise.all(ids.map(id => apiRef.current.get(`/api/roles/${id}/permissions`)
      .then(res => (Array.isArray(res?.data) ? res.data : null))
      .catch(() => null)))
      .then((trees) => {
        if (cancelled) return;
        const merged = mergeRoleTrees(trees);
        setRoleTree(merged);
        setBaselineFailed(merged === null);
      });
    return () => { cancelled = true; };
  }, [roleIdsKey]);

  /** Role names for the effective-result source line, from the server role list. */
  const roleNames = useMemo(
    () => assignedRoleIds
      .map(id => allRoles.find(r => Number(r.id) === Number(id))?.name)
      .filter(Boolean),
    [assignedRoleIds, allRoles],
  );

  /**
   * The baseline the grouped editor resolves against. `available: false` means
   * the masks could not be read, and the editor must say so rather than render
   * an unearned "Denied". A user with no assigned role has an empty — but
   * available — baseline, which is genuinely "no baseline configured".
   */
  const roleBaseline = useMemo(() => buildBaseline({
    roleTree,
    roleNames,
    available: !baselineFailed,
  }), [roleTree, roleNames, baselineFailed]);

  /* ── Dirty state ──────────────────────────────────────────── */
  const dirty = useMemo(() => computeDirty({
    snapshot, basic, prefs, overrides: userOverrides,
    scope: inventoryScope, roleIds: assignedRoleIds, password: pw.password,
  }), [snapshot, basic, prefs, userOverrides, inventoryScope, assignedRoleIds, pw.password]);

  /* Warn on browser refresh/close, and only while something is unsaved. */
  useEffect(() => {
    if (!dirty.any) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty.any]);

  /* ── Editing helpers ──────────────────────────────────────── */
  const updateBasic = useCallback((patch) => setBasic(b => ({ ...b, ...patch })), []);
  const updatePrefs = useCallback((patch) => setPrefs(p => ({ ...p, ...patch })), []);
  const updatePw = useCallback((patch) => setPw(p => ({ ...p, ...patch })), []);

  /** Role and role_ids move together, as they did before Brick 2. */
  const changeRole = useCallback((newRole) => {
    setBasic(b => ({ ...b, role: newRole }));
    const match = allRoles.find(r => r.slug === newRole);
    setAssignedRoleIds(match ? [match.id] : []);
  }, [allRoles]);

  /* ── Effective access + override counts ───────────────────── */
  const effectiveAccess = useMemo(() => computeEffectiveAccess({
    moduleTree: MODULE_TREE, actions: ACTIONS, permBits: PERM_BITS,
    roleTree, overrides: userOverrides,
  }), [roleTree, userOverrides]);

  const overrideRecordCount = useMemo(
    () => countOverrideRecords(userOverrides), [userOverrides],
  );

  /* ── Save ─────────────────────────────────────────────────── */

  /**
   * Saves the given categories, skipping clean ones. Returns
   * `{ results: { [category]: 'saved' | 'failed' }, allSaved }`. `allSaved` is
   * true only when every requested dirty category succeeded, so callers can
   * never present a partial save as a global success.
   */
  const saveCategories = useCallback(async (categories) => {
    if (busyRef.current) return { results: {}, allSaved: false, skipped: true };

    const targets = categories.filter(c => dirty.byCategory[c]);
    if (targets.length === 0) return { results: {}, allSaved: false, nothingToSave: true };

    // One category's requests. Each returns the snapshot fragment to adopt when
    // every request in that category succeeded.
    const runners = {
      general: async () => {
        if (dirty.parts.basicDirty) {
          if (!basic.username.trim() || !basic.full_name.trim()) {
            throw new Error('Username and full name are required');
          }
          await apiRef.current.put(`/api/admin/users/${userId}`, buildBasicPayload(basic));
        }
        if (dirty.parts.roleIdsDirty) {
          await apiRef.current.put(`/api/roles/users/${userId}/roles`, buildRolesPayload(assignedRoleIds));
        }
        return { general: { basic: canonicalBasic(basic), roleIds: canonicalRoleIds(assignedRoleIds) } };
      },

      access: async () => {
        if (dirty.parts.scopeDirty) {
          await apiRef.current.put(
            `/api/admin/users/${userId}/inventory-scope`, buildScopePayload(inventoryScope),
          );
        }
        if (dirty.parts.overridesDirty) {
          await apiRef.current.put(
            `/api/admin/users/${userId}/permission-overrides`, buildOverridesPayload(userOverrides),
          );
        }
        return {
          access: {
            overrides: canonicalOverrides(userOverrides),
            scope: canonicalScope(inventoryScope),
          },
        };
      },

      preferences: async () => {
        await apiRef.current.put(
          `/api/admin/users/${userId}/preferences`, buildPreferencesPayload(prefs),
        );
        return { preferences: { prefs: canonicalPrefs(prefs) } };
      },

      security: async () => {
        if (pw.password.length < 6) throw new Error('Password must be at least 6 characters');
        if (pw.password !== pw.confirm) throw new Error('Passwords do not match');
        await apiRef.current.post(`/api/admin/users/${userId}/reset-password`, { password: pw.password });
        return { security: { password: '' } };
      },
    };

    busyRef.current = true;
    setBusy(true);
    setSaveState(prev => {
      const next = { ...prev };
      targets.forEach(c => { next[c] = SAVE_STATE.SAVING; });
      return next;
    });
    setSaveErrors(prev => {
      const next = { ...prev };
      targets.forEach(c => { delete next[c]; });
      return next;
    });

    const results = {};
    const errors = {};
    const snapshotPatch = {};

    // Sequential on purpose: a category-level failure must not leave it
    // ambiguous which requests already went out.
    for (const category of targets) {
      try {
        Object.assign(snapshotPatch, await runners[category]());
        results[category] = SAVE_STATE.SAVED;
      } catch (err) {
        results[category] = SAVE_STATE.FAILED;
        errors[category] = err?.message || 'Save failed';
      }
    }

    // Only successful categories advance their baseline; a failed category keeps
    // its old baseline and therefore stays dirty and retryable.
    if (Object.keys(snapshotPatch).length > 0) {
      setSnapshot(prev => (prev ? { ...prev, ...snapshotPatch } : prev));
    }
    if (results.security === SAVE_STATE.SAVED) setPw({ password: '', confirm: '' });

    setSaveState(prev => ({ ...prev, ...results }));
    setSaveErrors(prev => ({ ...prev, ...errors }));
    busyRef.current = false;
    setBusy(false);

    if (Object.values(results).includes(SAVE_STATE.SAVED)) onAfterSave?.(results);

    return {
      results,
      allSaved: targets.every(c => results[c] === SAVE_STATE.SAVED),
      failedCategories: targets.filter(c => results[c] === SAVE_STATE.FAILED),
    };
  }, [dirty, basic, prefs, userOverrides, inventoryScope, assignedRoleIds, pw, userId, onAfterSave]);

  /**
   * Clears every override for this user through the existing reset endpoint —
   * the role baseline is not touched. Not a client-side visual clear: on success
   * the server holds no override rows, so the baseline moves with it.
   */
  const resetOverrides = useCallback(async () => {
    if (busyRef.current || resetting) return { ok: false, skipped: true };
    setResetting(true);
    try {
      await apiRef.current.del(`/api/admin/users/${userId}/permission-overrides`);
      setUserOverrides({});
      setSnapshot(prev => (prev
        ? { ...prev, access: { ...prev.access, overrides: canonicalOverrides({}) } }
        : prev));
      onAfterSave?.({ access: SAVE_STATE.SAVED });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to reset overrides' };
    } finally {
      setResetting(false);
    }
  }, [userId, resetting, onAfterSave]);

  return {
    fetching, loadError,
    basic, updateBasic, changeRole,
    prefs, updatePrefs,
    pw, updatePw,
    departments, allRoles,
    assignedRoleIds,
    inventoryScope, setInventoryScope,
    userOverrides, setUserOverrides,
    overrideRecordCount,
    roleTree, roleNames, roleBaseline, effectiveAccess,
    catalog, catalogFailed,
    dirty,
    saveState, saveErrors, busy, resetting,
    saveCategories, resetOverrides,
  };
}

export default useUserCard;

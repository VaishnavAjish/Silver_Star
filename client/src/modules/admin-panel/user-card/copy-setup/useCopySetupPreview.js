/**
 * RBAC Brick 6 — every read the Copy Setup wizard performs.
 *
 * READ-ONLY BY CONSTRUCTION. This hook issues `api.get` and nothing else. There
 * is no `post`, `put`, `patch` or `del` anywhere in this file — the apply request
 * lives in the wizard, behind explicit confirmation, and is the only write in the
 * whole flow.
 *
 * ONE FETCH PER SOURCE, NOT PER CATEGORY.
 * The preview endpoint returns state, not a decision, so category selection is
 * applied afterwards by the pure diff model. Toggling a category therefore costs
 * zero requests and can never be mistaken for an operation.
 *
 * The catalog and role baseline are fetched separately because they belong to the
 * TARGET and do not change when the source does. Both are optional: a failure
 * degrades the effective-access impact panel to a stated unavailability and
 * leaves the row-level diff, which is read straight from the stored rows,
 * untouched.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { mergeRoleTrees, buildBaseline } from '../permissions/permissionEditorModel';

/**
 * Target-side reference data: the Brick 1 catalog and the target's own role
 * baseline. The baseline is the target's on both sides of the impact comparison
 * because Copy Setup never writes a role.
 */
export function useCopySetupContext({ api, targetUser }) {
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [baseline, setBaseline] = useState(() => buildBaseline({ roleTree: null, roleNames: [] }));

  const targetRole = targetUser?.role;

  useEffect(() => {
    let cancelled = false;
    setCatalogFailed(false);
    apiRef.current.get('/api/admin/permission-catalog')
      .then((data) => { if (!cancelled) setCatalog(data); })
      .catch(() => { if (!cancelled) { setCatalog(null); setCatalogFailed(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!targetRole) return undefined;
    let cancelled = false;

    apiRef.current.get('/api/roles')
      .then(r => (r?.data || []))
      .catch(() => null)
      .then(async (roles) => {
        if (cancelled) return;
        if (roles === null) {
          setBaseline(buildBaseline({ roleTree: null, roleNames: [], available: false }));
          return;
        }
        const match = roles.find(r => r.slug === targetRole);
        if (!match) {
          // A user with no matching role row genuinely has no baseline; that is
          // available-and-empty, not an outage.
          setBaseline(buildBaseline({ roleTree: null, roleNames: [], available: true }));
          return;
        }
        const tree = await apiRef.current.get(`/api/roles/${match.id}/permissions`)
          .then(res => (Array.isArray(res?.data) ? res.data : null))
          .catch(() => null);
        if (cancelled) return;
        const merged = mergeRoleTrees([tree]);
        setBaseline(buildBaseline({
          roleTree: merged,
          roleNames: [match.name].filter(Boolean),
          available: merged !== null,
        }));
      });

    return () => { cancelled = true; };
  }, [targetRole]);

  return { catalog, catalogFailed, baseline };
}

/**
 * The stored state of both users across all five copyable categories.
 *
 * `refetch` is also what the stale check re-runs immediately before apply, which
 * is why it returns the payload rather than only writing it to state.
 */
export function useCopySetupPayload({ api, targetId, sourceId }) {
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPayload = useCallback(async (source) => {
    if (!targetId || !source) return null;
    return apiRef.current.get(
      `/api/admin/users/${targetId}/copy-setup/preview`,
      { source_user_id: source },
    );
  }, [targetId]);

  useEffect(() => {
    if (!targetId || !sourceId) { setPayload(null); setError(null); return undefined; }
    let cancelled = false;

    setLoading(true);
    setError(null);
    fetchPayload(sourceId)
      .then((data) => { if (!cancelled) { setPayload(data); setLoading(false); } })
      .catch((err) => {
        if (cancelled) return;
        // The payload is left null on purpose: a partial or stale read must never
        // be the thing an Apply decision is made from.
        setPayload(null);
        setError(err?.message || 'Could not load the copy preview');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [targetId, sourceId, fetchPayload]);

  /**
   * Re-read and adopt. Used by the staleness check immediately before apply, so
   * it both returns the fresh payload for comparison and puts it on screen —
   * an admin told their preview is stale must be looking at the current one.
   */
  const reload = useCallback(async () => {
    if (!sourceId) return null;
    setLoading(true);
    try {
      const data = await fetchPayload(sourceId);
      setPayload(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err?.message || 'Could not re-read the copy preview');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchPayload, sourceId]);

  return { payload, loading, error, refetch: fetchPayload, reload };
}

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Shield, SearchX } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import PermissionEditorToolbar from './PermissionEditorToolbar';
import PermissionGroupAccordion from './PermissionGroupAccordion';
import { buildGroups, activeStorageKeys } from './permissionCatalogModel';
import {
  EMPTY_FILTERS,
  buildEditorView,
  visibleCapabilitiesOf,
  setActionOverride,
  clearCapabilityOverrides,
  clearCapabilitiesOverrides,
  countCapabilityOverrides,
  countHiddenOverrideRecords,
  SUPER_ADMIN_NOTE,
} from './permissionEditorModel';
import './permissionEditor.css';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * RBAC Brick 3 — the catalog-driven grouped permission editor.
 *
 * Owns only presentation state: search text, filters and which groups are open.
 * The override map itself stays where Brick 2 put it, in useUserCard, so the
 * existing snapshot/dirty/save machinery is unchanged and there is no second
 * dirty-state engine.
 *
 * THE PRESERVATION INVARIANT. PUT /permission-overrides replaces every row for
 * the user, so an omitted row is a deleted row. This editor therefore edits the
 * COMPLETE override map in place and only ever clears bits belonging to a
 * capability it is actually showing. Search, filters and collapsed groups shape
 * `view` and nothing else; the map handed to buildOverridesPayload is never
 * derived from `view`. That is what keeps duplicate-legacy, orphaned and
 * planned-inactive rows byte-identical across a visible edit.
 */
export default function GroupedPermissionEditor({
  catalog, overrides, setOverrides, baseline, roleLabel, editable,
  userLabel, overrideRecordCount, onResetAllStored, focusRequest, busy,
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState(() => new Set());
  const [pendingReset, setPendingReset] = useState(null);

  /* Typing stays responsive; the expensive re-derivation runs once it settles. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* Brick 4 deep link. `token` changes per request so asking for the same
     capability twice still re-focuses it, and search is applied immediately
     rather than through the debounce because this is a navigation, not typing.
     The existing search-reveals-matches effect opens the containing group.
     PRESENTATION ONLY — no mask is read or written here. */
  const focusToken = focusRequest?.token;
  const focusCode = focusRequest?.code;
  useEffect(() => {
    if (!focusToken || !focusCode) return;
    setSearchInput(focusCode);
    setSearch(focusCode);
  }, [focusToken, focusCode]);

  const groups = useMemo(() => buildGroups(catalog), [catalog]);
  const visibleKeys = useMemo(() => activeStorageKeys(groups), [groups]);

  const view = useMemo(() => buildEditorView({
    groups, overrides, baseline, isSuperAdmin: !editable, search, filters,
  }), [groups, overrides, baseline, editable, search, filters]);

  const hiddenRecordCount = useMemo(
    () => countHiddenOverrideRecords(overrides, visibleKeys), [overrides, visibleKeys],
  );

  /* A search reveals its matches by opening those groups; it never closes the
     groups the admin opened by hand. */
  const matchedKey = view.groups.filter(g => g.hasVisibleContent).map(g => g.name).join('|');
  useEffect(() => {
    if (search.trim() === '') return;
    const names = matchedKey === '' ? [] : matchedKey.split('|');
    setExpanded((prev) => {
      const missing = names.filter(name => !prev.has(name));
      return missing.length === 0 ? prev : new Set([...prev, ...missing]);
    });
  }, [search, matchedKey]);

  /* ── Presentation handlers (never touch the override map) ─── */
  const toggleGroup = useCallback((name) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  }), []);

  const expandAll = useCallback(() => setExpanded(new Set(groups.map(g => g.name))), [groups]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const toggleFilter = useCallback(id => setFilters(prev => ({ ...prev, [id]: !prev[id] })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  /* ── Editing handlers ─────────────────────────────────────── */
  const changeAction = useCallback((capability, action, next) => {
    setOverrides(prev => setActionOverride(prev, capability.storageKey, action.bit, next));
  }, [setOverrides]);

  const askResetCapability = useCallback(
    capability => setPendingReset({ kind: 'capability', capabilities: [capability] }), [],
  );

  const askResetVisible = useCallback(() => setPendingReset({
    kind: 'visible',
    capabilities: visibleCapabilitiesOf(view)
      .filter(capability => countCapabilityOverrides(overrides, capability) > 0),
  }), [view, overrides]);

  const applyReset = useCallback(() => {
    const { kind, capabilities } = pendingReset;
    setOverrides(prev => (kind === 'capability'
      ? clearCapabilityOverrides(prev, capabilities[0])
      : clearCapabilitiesOverrides(prev, capabilities)));
    setPendingReset(null);
  }, [pendingReset, setOverrides]);

  const resetActionCount = (pendingReset?.capabilities || [])
    .reduce((sum, capability) => sum + countCapabilityOverrides(overrides, capability), 0);

  const nothingMatches = view.totals.matchedCapabilities === 0
    && view.groups.every(group => group.diagnostics.length === 0);

  return (
    <div className="pe-editor">
      {!editable && (
        <div className="uc-notice uc-notice-admin pe-notice">
          <Shield size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>{SUPER_ADMIN_NOTE} Overrides are shown for reference and are not editable.</span>
        </div>
      )}

      <PermissionEditorToolbar
        totals={view.totals}
        roleLabel={roleLabel}
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        onToggleFilter={toggleFilter}
        onClearFilters={clearFilters}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onResetVisible={askResetVisible}
        onResetAll={onResetAllStored}
        editable={editable}
        hiddenRecordCount={hiddenRecordCount}
        overrideRecordCount={overrideRecordCount}
        busy={busy}
      />

      <div className="pe-groups">
        {nothingMatches ? (
          <div className="pe-noresults">
            <SearchX size={18} aria-hidden="true" />
            <p>No capability matches the current search and filters.</p>
            <button
              type="button"
              className="pe-btn"
              onClick={() => { setSearchInput(''); clearFilters(); }}
            >
              Clear search and filters
            </button>
          </div>
        ) : view.groups.filter(group => group.hasVisibleContent).map(group => (
          <PermissionGroupAccordion
            key={group.name}
            group={group}
            expanded={expanded.has(group.name)}
            onToggle={toggleGroup}
            roleNames={baseline.roleNames}
            editable={editable}
            overrides={overrides}
            onChangeAction={changeAction}
            onResetCapability={askResetCapability}
          />
        ))}
      </div>

      {pendingReset && (
        <ConfirmDialog
          title={pendingReset.kind === 'capability'
            ? `Reset ${pendingReset.capabilities[0].label}?`
            : 'Reset visible overrides?'}
          labelledBy="pe-reset-title"
          onCancel={() => setPendingReset(null)}
          actions={[
            { label: 'Cancel', onClick: () => setPendingReset(null) },
            { label: 'Reset to Inherit', onClick: applyReset, className: 'btn btn-primary' },
          ]}
        >
          <p style={{ margin: 0 }}>
            Returns <strong>{resetActionCount}</strong> action
            {resetActionCount === 1 ? ' override' : ' overrides'} across
            {' '}<strong>{pendingReset.capabilities.length}</strong> capability
            {pendingReset.capabilities.length === 1 ? ' row' : ' rows'} to Inherit for
            {' '}<strong>{userLabel}</strong>.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            The role baseline is not changed. Overrides stored on legacy or inactive keys
            that this editor does not show are left untouched.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            This is a pending change — it is written only when Access Control is saved.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

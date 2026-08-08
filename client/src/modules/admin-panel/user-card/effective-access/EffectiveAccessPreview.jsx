import { useState, useMemo, useCallback, useEffect } from 'react';
import { SearchX, Info } from 'lucide-react';
import EffectiveAccessSummary from './EffectiveAccessSummary';
import EffectiveAccessToolbar from './EffectiveAccessToolbar';
import EffectiveAccessGroup from './EffectiveAccessGroup';
import EffectiveAccessDetails from './EffectiveAccessDetails';
import DataVisibilitySummary from './DataVisibilitySummary';
import { buildGroups, validateCatalog } from '../permissions/permissionCatalogModel';
import {
  EMPTY_ACCESS_FILTERS,
  CATALOG_UNAVAILABLE_NOTE,
  buildAccessIndex,
  filterAccessView,
  toggleRiskLevel,
} from './effectiveAccessModel';
import { buildDataVisibility } from './dataVisibilityModel';
import './effectiveAccess.css';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * RBAC Brick 5 — the read-only Effective Access Preview.
 *
 * THE READ-ONLY GUARANTEE IS STRUCTURAL, NOT A PROMISE. This component is never
 * handed the api client, and it is never handed an override or scope setter. It
 * therefore has nothing to write with: the only callback that leaves it is
 * `onOpenPermission`, which scrolls Brick 3 into view and seeds its search.
 * Search, filters, expansion and the details dialog are local React state and
 * touch neither the override map nor the card's dirty flags.
 *
 * WORK IS SPLIT SO TYPING IS CHEAP. `buildAccessIndex` resolves every action of
 * every capability and depends only on data; `filterAccessView` slices that
 * result and depends only on search and filter state. A keystroke therefore
 * re-runs a filter over pre-computed rows and never re-runs the algebra — which
 * matters at roughly six hundred action results.
 *
 * IT DEGRADES BY SAYING SO. A failed catalog, role read, override read or scope
 * read each produce an explicit unavailable state. None of them may become a
 * verdict: an outage never renders as Default Deny, as Inherit, or as All
 * Departments.
 */
export default function EffectiveAccessPreview({
  catalog,
  catalogFailed,
  overrides,
  overridesFailed,
  baseline,
  isSuperAdmin,
  prefs,
  role,
  inventoryScope,
  scopeFailed,
  departments,
  onOpenPermission,
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_ACCESS_FILTERS);
  const [expanded, setExpanded] = useState(() => new Set());
  const [detailRow, setDetailRow] = useState(null);

  /* Typing stays responsive; the re-slice runs once it settles. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const catalogCheck = useMemo(
    () => (catalogFailed
      ? { ok: false, reason: 'the catalog endpoint failed' }
      : validateCatalog(catalog)),
    [catalog, catalogFailed],
  );

  const groups = useMemo(
    () => (catalogCheck.ok ? buildGroups(catalog) : []),
    [catalog, catalogCheck.ok],
  );

  const overridesAvailable = !overridesFailed;

  /* The expensive pass. Depends on data only — never on search or filters. */
  const index = useMemo(() => buildAccessIndex({
    groups, overrides, baseline, isSuperAdmin, overridesAvailable,
  }), [groups, overrides, baseline, isSuperAdmin, overridesAvailable]);

  /* The cheap pass, re-run per keystroke and per filter click. */
  const view = useMemo(
    () => filterAccessView(index, { search, filters }),
    [index, search, filters],
  );

  const visibility = useMemo(() => buildDataVisibility({
    catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
    inventoryScope, departments,
    scopeAvailable: !scopeFailed,
    overridesAvailable,
  }), [
    catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
    inventoryScope, departments, scopeFailed, overridesAvailable,
  ]);

  /* A search reveals its matches by opening those groups, and never closes a
     group the admin opened by hand. */
  const matchedKey = view.groups.map(group => group.name).join('|');
  useEffect(() => {
    if (search.trim() === '') return;
    const names = matchedKey === '' ? [] : matchedKey.split('|');
    setExpanded((prev) => {
      const missing = names.filter(name => !prev.has(name));
      return missing.length === 0 ? prev : new Set([...prev, ...missing]);
    });
  }, [search, matchedKey]);

  /* ── Presentation handlers. None of these can write. ───────── */
  const toggleGroup = useCallback(name => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  }), []);

  const expandAll = useCallback(
    () => setExpanded(new Set(index.groups.map(group => group.name))), [index],
  );
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const toggleFilter = useCallback(
    id => setFilters(prev => ({ ...prev, [id]: !prev[id] })), [],
  );
  const toggleRisk = useCallback(
    level => setFilters(prev => toggleRiskLevel(prev, level)), [],
  );
  const clearFilters = useCallback(() => setFilters(EMPTY_ACCESS_FILTERS), []);

  /* Hands the row to Brick 3 and closes the dialog. No mask is touched — the
     admin still has to make and save the change there. */
  const editPermission = useCallback((row) => {
    setDetailRow(null);
    onOpenPermission?.({ code: row.code });
  }, [onOpenPermission]);

  if (!catalogCheck.ok) {
    return (
      <div className="ea-preview">
        <div className="uc-notice uc-notice-neutral ea-notice">
          <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          {/* The specific catalog fault is reported once, by the editor below,
              which is on this same tab. Repeating it here would put the same
              sentence on screen twice without adding anything. */}
          <span>{CATALOG_UNAVAILABLE_NOTE}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ea-preview">
      <EffectiveAccessSummary
        summary={index.summary}
        isSuperAdmin={isSuperAdmin}
        scopeSummary={visibility.scope.summary}
        baselineAvailable={baseline?.available !== false}
        overridesAvailable={overridesAvailable}
      />

      <DataVisibilitySummary visibility={visibility} isSuperAdmin={isSuperAdmin} />

      <EffectiveAccessToolbar
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        onToggleFilter={toggleFilter}
        onToggleRisk={toggleRisk}
        onClearFilters={clearFilters}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        matchedRows={view.matchedRows}
        totalRows={index.summary.totalActions}
      />

      <div className="ea-groups">
        {view.groups.length === 0 ? (
          <div className="ea-noresults">
            <SearchX size={18} aria-hidden="true" />
            <p>No action result matches the current search and filters.</p>
            <button
              type="button"
              className="ea-btn"
              onClick={() => { setSearchInput(''); clearFilters(); }}
            >
              Clear search and filters
            </button>
          </div>
        ) : view.groups.map(group => (
          <EffectiveAccessGroup
            key={group.name}
            group={group}
            expanded={expanded.has(group.name)}
            onToggle={toggleGroup}
            onOpenDetails={setDetailRow}
            onEditPermission={onOpenPermission ? editPermission : null}
          />
        ))}
      </div>

      {detailRow && (
        <EffectiveAccessDetails
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onEditPermission={onOpenPermission ? editPermission : null}
        />
      )}
    </div>
  );
}

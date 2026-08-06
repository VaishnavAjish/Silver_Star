import { Search, X, AlertTriangle, RotateCcw, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { activeFilterCount } from './permissionEditorModel';
import { ENFORCEMENT_WARNING } from './permissionCatalogModel';

function Tile({ label, value, sub }) {
  return (
    <div className="pe-tile">
      <span className="pe-tile-label">{label}</span>
      <span className="pe-tile-value">{value}</span>
      {sub && <span className="pe-tile-sub">{sub}</span>}
    </div>
  );
}

/** Filters are toggle buttons, so their state is exposed through aria-pressed. */
function FilterToggle({ id, label, pressed, onToggle }) {
  return (
    <button
      type="button"
      className={`pe-filter${pressed ? ' pe-filter-on' : ''}`}
      aria-pressed={pressed}
      onClick={() => onToggle(id)}
    >
      {label}
    </button>
  );
}

/**
 * Counts, search, filters and the reset actions for the grouped editor.
 *
 * The two reset actions are deliberately separate and separately worded: one
 * clears what is on screen (and is then saved with the rest of Access Control),
 * the other removes every stored override row through the dedicated endpoint.
 * They are never presented as the same thing.
 */
export default function PermissionEditorToolbar({
  totals, roleLabel, search, onSearch, filters, onToggleFilter, onClearFilters,
  onExpandAll, onCollapseAll, onResetVisible, onResetAll,
  editable, hiddenRecordCount, overrideRecordCount, busy,
}) {
  const filterCount = activeFilterCount(filters);

  return (
    <div className="pe-toolbar">
      <div className="pe-tiles">
        <Tile label="Role Baseline" value={roleLabel} sub="Inherited from role" />
        <Tile
          label="User Overrides"
          value={totals.overrides}
          sub={`${totals.capabilitiesWithOverrides} capabilities`}
        />
        <Tile label="Effective Allow" value={totals.allowed} sub={`of ${totals.actions} actions`} />
        <Tile label="Effective Deny" value={totals.denied} sub={`of ${totals.actions} actions`} />
      </div>

      {totals.unenforcedCapabilities > 0 && (
        <div className="uc-notice uc-notice-warn pe-notice">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>
            <strong>{totals.unenforcedCapabilities}</strong> of {totals.capabilities} capabilities
            are not fully enforced by backend APIs. {ENFORCEMENT_WARNING}
          </span>
        </div>
      )}

      {hiddenRecordCount > 0 && (
        <p className="pe-hidden-note">
          {hiddenRecordCount} stored override {hiddenRecordCount === 1 ? 'record' : 'records'} belong
          to legacy or inactive keys that are not shown here. They are preserved unchanged on save.
        </p>
      )}

      <div className="pe-controls">
        <div className="pe-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            id="pe-search-input"
            aria-label="Search permissions by capability, description, action or backend key"
            placeholder="Search capabilities, actions or backend keys…"
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          {search !== '' && (
            <button type="button" className="pe-search-clear" onClick={() => onSearch('')}>
              <X size={13} aria-hidden="true" />
              <span className="uc-sr-only">Clear search</span>
            </button>
          )}
        </div>

        <div className="pe-buttons">
          <button type="button" className="pe-btn" onClick={onExpandAll}>
            <ChevronsUpDown size={13} aria-hidden="true" /> Expand All
          </button>
          <button type="button" className="pe-btn" onClick={onCollapseAll}>
            <ChevronsDownUp size={13} aria-hidden="true" /> Collapse All
          </button>
        </div>
      </div>

      <div className="pe-filters" role="group" aria-label="Permission filters">
        <FilterToggle
          id="overridesOnly" label="Show Overrides Only"
          pressed={filters.overridesOnly} onToggle={onToggleFilter}
        />
        <FilterToggle
          id="deniedOnly" label="Show Denied Only"
          pressed={filters.deniedOnly} onToggle={onToggleFilter}
        />
        <FilterToggle
          id="unenforced" label="Show Unenforced"
          pressed={filters.unenforced} onToggle={onToggleFilter}
        />
        <FilterToggle
          id="showInactive" label="Show Inactive Diagnostics"
          pressed={filters.showInactive} onToggle={onToggleFilter}
        />

        {filterCount > 0 && (
          <button type="button" className="pe-linkbtn" onClick={onClearFilters}>
            Clear Filters ({filterCount} active)
          </button>
        )}
      </div>

      {editable && (
        <div className="pe-resets">
          <button
            type="button"
            className="pe-btn"
            onClick={onResetVisible}
            disabled={busy || totals.overrides === 0}
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset Visible Overrides
          </button>
          <button
            type="button"
            className="pe-btn pe-btn-danger"
            onClick={onResetAll}
            disabled={busy || overrideRecordCount === 0}
          >
            Reset All Stored Overrides
          </button>
        </div>
      )}
    </div>
  );
}

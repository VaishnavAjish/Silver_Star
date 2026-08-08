import { Search, X, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { RISK_LEVELS, RISK_LABELS, activeAccessFilterCount } from './effectiveAccessModel';

/**
 * RBAC Brick 5 — read-only search and filter bar.
 *
 * DELIBERATELY CARRIES NO EDITING AFFORDANCE. Brick 3's toolbar has Reset
 * Visible and Reset All Stored; putting those next to a preview would make the
 * read-only guarantee a matter of the admin reading the section heading. Every
 * control here narrows what is displayed and touches nothing else.
 *
 * Filters combine with AND, so each one can only ever shrink the result set —
 * an admin who ticks "Denied" and "Unenforced" sees the intersection, which is
 * the question they were asking.
 */

const TOGGLES = [
  { id: 'allowedOnly', label: 'Allowed' },
  { id: 'deniedOnly', label: 'Denied' },
  { id: 'overridesOnly', label: 'Overrides' },
  { id: 'defaultDeniedOnly', label: 'Default deny' },
  { id: 'unenforcedOnly', label: 'Unenforced' },
  { id: 'missingBaselineOnly', label: 'Missing baseline' },
  { id: 'notReportedOnly', label: 'Not reported' },
  { id: 'showDiagnostics', label: 'Show diagnostics' },
];

export default function EffectiveAccessToolbar({
  search, onSearch, filters, onToggleFilter, onToggleRisk, onClearFilters,
  onExpandAll, onCollapseAll, matchedRows, totalRows,
}) {
  const activeCount = activeAccessFilterCount(filters);
  const filtered = matchedRows !== totalRows;

  return (
    <div className="ea-toolbar">
      <div className="ea-toolbar-top">
        <div className="ea-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="ea-search-input"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search capability, action, code or module"
            aria-label="Search effective access"
          />
          {search !== '' && (
            <button
              type="button"
              className="ea-search-clear"
              onClick={() => onSearch('')}
              aria-label="Clear search"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="ea-toolbar-actions">
          <button type="button" className="ea-btn" onClick={onExpandAll}>
            <ChevronsUpDown size={13} aria-hidden="true" /> Expand all
          </button>
          <button type="button" className="ea-btn" onClick={onCollapseAll}>
            <ChevronsDownUp size={13} aria-hidden="true" /> Collapse all
          </button>
        </div>
      </div>

      <div className="ea-filters" role="group" aria-label="Effective access filters">
        {TOGGLES.map(toggle => (
          <button
            key={toggle.id}
            type="button"
            className={`ea-chip${filters[toggle.id] ? ' ea-chip-on' : ''}`}
            aria-pressed={Boolean(filters[toggle.id])}
            onClick={() => onToggleFilter(toggle.id)}
          >
            {toggle.label}
          </button>
        ))}
      </div>

      <div className="ea-filters" role="group" aria-label="Filter by risk level">
        <span className="ea-filters-label">Risk</span>
        {RISK_LEVELS.map(level => (
          <button
            key={level}
            type="button"
            className={`ea-chip ea-chip-risk${filters.risk?.includes(level) ? ' ea-chip-on' : ''}`}
            aria-pressed={Boolean(filters.risk?.includes(level))}
            onClick={() => onToggleRisk(level)}
          >
            {RISK_LABELS[level]}
          </button>
        ))}

        {activeCount > 0 && (
          <button type="button" className="ea-btn ea-btn-clear" onClick={onClearFilters}>
            Clear Filters ({activeCount})
          </button>
        )}
      </div>

      <p className="ea-toolbar-count" aria-live="polite">
        {filtered
          ? `Showing ${matchedRows} of ${totalRows} action results`
          : `${totalRows} action results`}
      </p>
    </div>
  );
}

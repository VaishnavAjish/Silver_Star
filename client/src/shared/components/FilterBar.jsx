/**
 * FilterBar — generic column-filter + search bar for any table
 *
 * Props:
 *   filters    {object}               current filter values  { key: value }
 *   onChange   {function(key,value)}  called when a filter changes
 *   onReset    {function}             clears all filters
 *   fields     {Array<FieldDef>}      defines which filters to render
 *
 * FieldDef shape:
 *   { key, label, type }
 *   type = 'text' | 'select' | 'date' | 'daterange'
 *   For 'select': also supply options: [{ value, label }]
 *
 * Example:
 *   <FilterBar
 *     filters={filters}
 *     onChange={(k,v) => setFilters(f => ({ ...f, [k]: v }))}
 *     onReset={() => setFilters({})}
 *     fields={[
 *       { key: 'search', label: 'Search', type: 'text' },
 *       { key: 'status', label: 'Status', type: 'select',
 *         options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
 *       { key: 'from_date', label: 'From', type: 'date' },
 *       { key: 'to_date',   label: 'To',   type: 'date' },
 *     ]}
 *   />
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DatePicker from './DatePicker';
import SearchableSelect from './SearchableSelect';
import { DropdownGroupProvider, useDropdownGroup } from './DropdownGroup';

function RouteChangeCloser() {
  const location = useLocation();
  const group = useDropdownGroup();
  useEffect(() => { group?.close(); }, [location.pathname]); // eslint-disable-line
  return null;
}

export default function FilterBar({ filters = {}, onChange, onReset, fields = [], children }) {
  const hasActive = fields.some(f => filters[f.key] !== undefined && filters[f.key] !== '');

  return (
    <DropdownGroupProvider>
    <RouteChangeCloser />
    <div className="filter-bar">
      {fields.map(f => (
        <div key={f.key} className="filter-field">
          <label className="filter-label">{f.label}</label>

          {f.type === 'select' ? (
            <SearchableSelect
              value={(() => {
                const v = filters[f.key] ?? '';
                if (!v) return null;
                const match = (f.options || []).find(o => o.value === v);
                return match ? { id: match.value, name: match.label, code: '' } : { id: v, name: v, code: '' };
              })()}
              onChange={opt => onChange(f.key, opt?.id || '')}
              options={(f.options || []).map(o => ({ id: o.value, name: o.label, code: '' }))}
              placeholder="All"
              style={{ minWidth: 120 }}
              dropdownSearch
              dropdownId={f.key}
            />
          ) : f.type === 'date' ? (
            <DatePicker
              value={filters[f.key] ?? ''}
              onChange={v => onChange(f.key, v)}
              placeholder="Select date"
              className="dp-compact"
            />
          ) : (
            <input
              type="text"
              className="filter-input filter-text"
              placeholder={`Filter ${f.label.toLowerCase()}…`}
              value={filters[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
            />
          )}
        </div>
      ))}

      {hasActive && (
        <button className="filter-reset-btn" onClick={onReset}>
          Clear All
        </button>
      )}
      {children && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>}
    </div>
    </DropdownGroupProvider>
  );
}

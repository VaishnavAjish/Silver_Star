import { useState } from 'react';
import { Shield } from 'lucide-react';

const MODES = [
  { value: 'NONE', label: 'No Access' },
  { value: 'SELECTED', label: 'Selected Departments' },
  { value: 'ALL', label: 'All Departments' },
];

/**
 * Inventory department scope — a genuinely enforced control, so it stays fully
 * editable. Behaviour is carried over from the old drawer: switching away from
 * SELECTED clears the department list, matching what the endpoint stores.
 *
 * Super Admin bypasses scope in the resolver, so for that role the section
 * states the bypass rather than offering controls that would have no effect.
 */
export default function InventoryScopeEditor({
  inventoryScope,
  setInventoryScope,
  departments,
  isSuperAdmin,
}) {
  const [search, setSearch] = useState('');

  if (isSuperAdmin) {
    return (
      <div className="uc-notice uc-notice-admin" style={{ marginBottom: 0 }}>
        <Shield size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Full inventory access — system enforced for Super Admin.</span>
      </div>
    );
  }

  const visible = departments.filter(
    d => d.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <p className="uc-section-hint">
        Restrict the inventory this user can view or interact with to specific departments.
        Enforced by the inventory APIs.
      </p>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend className="uc-sr-only">Inventory scope mode</legend>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {MODES.map(mode => (
            <label
              key={mode.value}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="uc_scope_mode"
                value={mode.value}
                checked={inventoryScope.scope_mode === mode.value}
                onChange={() => setInventoryScope(s => ({
                  scope_mode: mode.value,
                  department_ids: mode.value === 'SELECTED' ? s.department_ids : [],
                }))}
              />
              {mode.label}
            </label>
          ))}
        </div>
      </fieldset>

      {inventoryScope.scope_mode === 'SELECTED' && (
        <div style={{ border: '1px solid var(--g200)', background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid var(--g200)', background: 'var(--g50)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--g700)' }}>
              Allowed Inventory Departments
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
              {inventoryScope.department_ids.length} selected
            </div>
          </div>

          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--g200)' }}>
            <input
              type="text"
              placeholder="Search departments…"
              aria-label="Search departments"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="app-input"
              style={{ width: '100%', fontSize: 12, padding: '6px 10px' }}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
              <button
                type="button"
                onClick={() => setInventoryScope(s => ({
                  ...s,
                  department_ids: Array.from(new Set([...s.department_ids, ...visible.map(d => d.id)])),
                }))}
                style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Select All Visible
              </button>
              <button
                type="button"
                onClick={() => setInventoryScope(s => ({ ...s, department_ids: [] }))}
                style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Clear All
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 180, overflowY: 'auto', padding: 8 }}>
            {visible.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--g400)', fontSize: 12 }}>
                No departments found
              </div>
            ) : (
              visible.map(d => (
                <label
                  key={d.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 4, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={inventoryScope.department_ids.includes(d.id)}
                    onChange={e => {
                      const { checked } = e.target;
                      setInventoryScope(s => ({
                        ...s,
                        department_ids: checked
                          ? [...s.department_ids, d.id]
                          : s.department_ids.filter(id => id !== d.id),
                      }));
                    }}
                  />
                  {d.name}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

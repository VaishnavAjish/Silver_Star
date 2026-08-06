import SelectDropdown from '../../../../shared/components/SelectDropdown';

/**
 * Editable preference definitions. The seven `vis.*` keys are deliberately absent:
 * they live in the same prefs object (and therefore in the same unchanged
 * preferences payload) but are surfaced read-only under Access Control, because
 * no backend reader enforces them yet.
 */
const PREF_DEFS = [
  {
    key: 'landing_page', label: 'Landing Page', type: 'select',
    options: [
      { value: '/', label: 'Dashboard' },
      { value: '/inventory', label: 'Inventory' },
      { value: '/invoices', label: 'Invoices' },
      { value: '/purchase-notes', label: 'Purchase Notes' },
      { value: '/ledger', label: 'Ledger' },
      { value: '/rough-growth', label: 'Rough Growth' },
    ],
  },
  {
    key: 'rows_per_page', label: 'Rows Per Page', type: 'select',
    options: [
      { value: '25', label: '25 rows' }, { value: '50', label: '50 rows' },
      { value: '100', label: '100 rows' }, { value: '200', label: '200 rows' },
    ],
  },
  {
    key: 'theme', label: 'Theme', type: 'select',
    options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark (coming soon)' }],
  },
  { key: 'compact_mode', label: 'Compact Mode', type: 'toggle', desc: 'Reduce table row spacing' },
  { key: 'default_branch', label: 'Default Branch', type: 'text', placeholder: 'e.g. Surat HO' },
];

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0,
        background: checked ? 'var(--brand)' : 'var(--g300)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background .2s', flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </button>
  );
}

/** Preferences tab — the previous drawer's controls, behaviour unchanged. */
export default function PreferencesTab({ prefs, updatePrefs }) {
  return (
    <div>
      <p className="uc-section-hint">UI defaults applied when this user logs in.</p>
      <div>
        {PREF_DEFS.map(({ key, label, type, options, placeholder, desc }) => (
          <div key={key} className="uc-row" role="group" aria-label={label}>
            <div style={{ flex: 1 }}>
              <div className="uc-row-label" id={`uc-pref-${key}-label`}>{label}</div>
              {desc && <div className="uc-row-desc">{desc}</div>}
            </div>

            {type === 'toggle' ? (
              <Toggle
                label={label}
                checked={prefs[key] === 'true' || prefs[key] === true}
                onChange={v => updatePrefs({ [key]: String(v) })}
              />
            ) : type === 'select' ? (
              // SelectDropdown renders a button and forwards no aria props, so the
              // surrounding labelled group carries the field name.
              <SelectDropdown
                value={prefs[key] || ''}
                onChange={e => updatePrefs({ [key]: e.target.value })}
                style={{ minWidth: 160 }}
              >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectDropdown>
            ) : (
              <input
                aria-labelledby={`uc-pref-${key}-label`}
                value={prefs[key] || ''}
                onChange={e => updatePrefs({ [key]: e.target.value })}
                placeholder={placeholder}
                style={{
                  padding: '5px 8px', border: '1px solid var(--g300)', borderRadius: 6,
                  fontSize: 12, width: 180, outline: 'none',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

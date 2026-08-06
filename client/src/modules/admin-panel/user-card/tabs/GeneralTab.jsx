import SelectDropdown from '../../../../shared/components/SelectDropdown';

const ROLES = ['super_admin', 'admin', 'operator', 'viewer'];

/**
 * General tab — the previous drawer's Basic Info, unchanged in behaviour.
 *
 * Account status is shown read-only: PUT /api/admin/users/:id accepts no status
 * field, and activation has its own endpoint driven from the Users list. Showing
 * a toggle here would imply a save path that does not exist.
 */
export default function GeneralTab({ user, basic, updateBasic, changeRole, departments, isSelf }) {
  return (
    <div>
      <p className="uc-section-hint">Account details and role assignment.</p>

      <div className="form-row">
        <div className="fg">
          <label htmlFor="uc-username">Username *</label>
          <input
            id="uc-username"
            value={basic.username}
            onChange={e => updateBasic({ username: e.target.value })}
            placeholder="username"
            autoComplete="off"
          />
        </div>
        <div className="fg">
          <label htmlFor="uc-full-name">Full Name *</label>
          <input
            id="uc-full-name"
            value={basic.full_name}
            onChange={e => updateBasic({ full_name: e.target.value })}
            placeholder="Full Name"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="fg w">
          <label htmlFor="uc-email">Email</label>
          <input
            id="uc-email"
            type="email"
            value={basic.email}
            onChange={e => updateBasic({ email: e.target.value })}
            placeholder="user@example.com"
            autoComplete="off"
          />
        </div>
        {/* SelectDropdown renders a button, not a native select, so it cannot be
            associated with a <label htmlFor>. A labelled group gives assistive
            technology the field name instead. */}
        <div className="fg" role="group" aria-label="Role">
          <label>Role *</label>
          <SelectDropdown
            value={basic.role}
            onChange={e => changeRole(e.target.value)}
            disabled={isSelf}
          >
            {ROLES.map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </SelectDropdown>
          {isSelf && (
            <span style={{ fontSize: 10, color: 'var(--g400)', marginTop: 2 }}>
              Cannot change your own role
            </span>
          )}
        </div>
      </div>

      <div className="form-row">
        <div className="fg w" role="group" aria-label="Primary Department">
          <label>Primary Department</label>
          <SelectDropdown
            value={basic.department_id}
            onChange={e => updateBasic({ department_id: e.target.value })}
          >
            <option value="">— None —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectDropdown>
          <span style={{ fontSize: 11, color: 'var(--g500)', marginTop: 4 }}>
            Organizational department only. Inventory visibility is configured under Access Control.
          </span>
        </div>
      </div>

      <div className="uc-row" style={{ marginTop: 12 }}>
        <div>
          <div className="uc-row-label">Account Status</div>
          <div className="uc-row-desc">
            Activation and deactivation are performed from the Users list.
          </div>
        </div>
        <span className={`badge ${user.is_active ? 'b-active' : 'b-cancelled'}`}>
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
}

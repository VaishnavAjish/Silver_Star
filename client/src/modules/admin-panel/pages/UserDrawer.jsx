import { useState, useEffect, useRef } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth, ROLE_DEFAULTS } from '../../../core/context/AuthContext';
import { X, Save, Key, User, Shield, Eye, Settings, Lock, AlertTriangle, ChevronDown, ChevronRight, Info, Copy, RotateCcw, Check, Minus } from 'lucide-react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import toast from 'react-hot-toast';
import { MODULE_TREE, PERM_BITS, ACTIONS as PERM_ACTIONS, ALL_PERMISSION_BITS } from '../../../shared/constants/permissions';

/* ── Static config ──────────────────────────────────────────── */
const ROLES = ['super_admin', 'admin', 'operator', 'viewer'];

const VISIBILITY_KEYS = [
  { key: 'vis.show_cogs', label: 'Cost of Goods (COGS)', desc: 'Per-lot cost figures' },
  { key: 'vis.show_purchase_rate', label: 'Purchase Rate', desc: 'Per-unit buy price' },
  { key: 'vis.show_sale_rate', label: 'Sale Rate', desc: 'Per-unit sell price' },
  { key: 'vis.show_margin', label: 'Margin %', desc: 'Profit margin percentage' },
  { key: 'vis.show_gross_profit', label: 'Gross Profit', desc: 'Revenue minus direct costs' },
  { key: 'vis.show_net_profit', label: 'Net Profit', desc: 'After all deductions' },
  { key: 'vis.show_balances', label: 'Account Balances', desc: 'Ledger balance amounts' },
];

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

const PREF_DEFAULTS = {
  landing_page: '/', rows_per_page: '50', theme: 'light',
  compact_mode: 'false', default_branch: '',
  'vis.show_cogs': 'true', 'vis.show_purchase_rate': 'true',
  'vis.show_sale_rate': 'true', 'vis.show_margin': 'true',
  'vis.show_gross_profit': 'true', 'vis.show_net_profit': 'true',
  'vis.show_balances': 'true',
};

const TABS = [
  { id: 'basic', label: 'Basic Info', icon: User },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'visibility', label: 'Data Visibility', icon: Eye },
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'security', label: 'Security', icon: Lock },
];

/* ── Toggle switch ──────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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

/* ── Drawer ─────────────────────────────────────────────────── */
export default function UserDrawer({ user, onClose, onSaved, onCopySetup }) {
  const api = useApi();
  const { user: me, refreshUser } = useAuth();

  const [tab, setTab] = useState('basic');
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);

  const [basic, setBasic] = useState({ username: '', email: '', full_name: '', role: 'operator', department_id: '' });
  const [prefs, setPrefs] = useState({ ...PREF_DEFAULTS });
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [departments, setDepartments] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState([]);
  const [inventoryScope, setInventoryScope] = useState({ scope_mode: 'ALL', department_ids: [] });
  const [deptSearch, setDeptSearch] = useState('');

  // Per-user overrides map: { 'module:submodule': { allow_mask, deny_mask } }
  const [userOverrides, setUserOverrides] = useState({});
  const [expanded, setExpanded] = useState({}); // { moduleKey: bool }
  const [permsDirty, setPermsDirty] = useState(false);

  // Stable api ref
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  // Load when target user changes
  useEffect(() => {
    if (!user) return;
    setTab('basic');
    setSaving(false);
    setPw({ password: '', confirm: '' });
    setExpanded({});
    setPermsDirty(false);
    setDeptSearch('');
    setBasic({ username: user.username, email: user.email || '', full_name: user.full_name, role: user.role, department_id: user.department_id || '' });
    setFetching(true);

    Promise.all([
      apiRef.current.get(`/api/admin/users/${user.id}/preferences`),
      apiRef.current.get('/api/departments', { limit: 500, offset: 0 }).then(r => Array.isArray(r) ? r : (r?.data || [])).catch(() => []),
      apiRef.current.get('/api/roles').then(r => (r?.data || [])).catch(() => []),
      apiRef.current.get(`/api/admin/users/${user.id}/inventory-scope`).catch(() => null),
      apiRef.current.get(`/api/admin/users/${user.id}/permission-overrides`).then(r => r?.data || []).catch(() => []),
    ]).then(([prefRows, deptData, rolesData, invScopeData, overridesData]) => {
      setDepartments(deptData || []);
      setAllRoles(rolesData || []);
      if (invScopeData) {
        setInventoryScope({
          scope_mode: invScopeData.scope_mode || 'ALL',
          department_ids: Array.isArray(invScopeData.departments) 
            ? invScopeData.departments.map(d => d.department_id)
            : []
        });
      } else {
        setInventoryScope({ scope_mode: 'ALL', department_ids: [] });
      }

      const p = { ...PREF_DEFAULTS };
      prefRows.forEach(r => { p[r.pref_key] = r.pref_value; });
      setPrefs(p);

      const matchingRole = (rolesData || []).find(r => r.slug === user.role);
      const roleIds = matchingRole ? [matchingRole.id] : [];
      setAssignedRoleIds(roleIds);

      // Load overrides into map
      const ovMap = {};
      (overridesData || []).forEach(ov => {
        const key = `${ov.module}:${ov.submodule || ''}`;
        ovMap[key] = { allow_mask: ov.allow_mask || 0, deny_mask: ov.deny_mask || 0 };
      });
      setUserOverrides(ovMap);
      setPermsDirty(false);
      setFetching(false);
    }).catch(() => {
      toast.error('Failed to load user settings');
      setFetching(false);
    });
  }, [user?.id]);

  // When role dropdown changes, update role and keep overrides intact with prompt
  const handleRoleChange = (newRole) => {
    setBasic(b => ({ ...b, role: newRole }));
    const matchingRole = allRoles.find(r => r.slug === newRole);
    const newIds = matchingRole ? [matchingRole.id] : [];
    setAssignedRoleIds(newIds);
  };

  const toggleExpand = (moduleKey) =>
    setExpanded(prev => ({ ...prev, [moduleKey]: !(prev[moduleKey] !== false) }));

  // Get current override state for action: 'ALLOW' | 'DENY' | 'INHERIT'
  const getOverrideState = (moduleKey, smKey, actionId) => {
    const key = `${moduleKey}:${smKey}`;
    const ov = userOverrides[key] || { allow_mask: 0, deny_mask: 0 };
    const bit = PERM_BITS[actionId];
    if (bit === undefined) return 'INHERIT';

    if ((ov.allow_mask & bit) === bit) return 'ALLOW';
    if ((ov.deny_mask & bit) === bit) return 'DENY';
    return 'INHERIT';
  };

  // Cycle action override state: INHERIT -> ALLOW -> DENY -> INHERIT
  const cycleOverrideState = (moduleKey, smKey, actionId) => {
    const key = `${moduleKey}:${smKey}`;
    const bit = PERM_BITS[actionId];
    if (bit === undefined) return;

    const currentState = getOverrideState(moduleKey, smKey, actionId);
    let nextState = 'ALLOW';
    if (currentState === 'ALLOW') nextState = 'DENY';
    else if (currentState === 'DENY') nextState = 'INHERIT';

    setUserOverrides(prev => {
      const cur = prev[key] || { allow_mask: 0, deny_mask: 0 };
      let allow = cur.allow_mask || 0;
      let deny = cur.deny_mask || 0;

      if (nextState === 'ALLOW') {
        allow |= bit;
        deny &= ~bit;
      } else if (nextState === 'DENY') {
        allow &= ~bit;
        deny |= bit;
      } else {
        allow &= ~bit;
        deny &= ~bit;
      }

      return {
        ...prev,
        [key]: { allow_mask: allow, deny_mask: deny }
      };
    });
    setPermsDirty(true);
  };

  const resetAllOverrides = () => {
    setUserOverrides({});
    setPermsDirty(true);
    toast.success('All permission overrides reset to INHERIT');
  };

  /* ── Save all tabs ── */
  const handleSave = async () => {
    if (!basic.username.trim() || !basic.full_name.trim())
      return toast.error('Username and full name are required');
    setSaving(true);
    try {
      const prefArray = Object.entries(prefs).map(([pref_key, pref_value]) => ({
        pref_key, pref_value: String(pref_value ?? ''),
      }));

      const saves = [
        apiRef.current.put(`/api/admin/users/${user.id}`, {
          username: basic.username, email: basic.email,
          full_name: basic.full_name, role: basic.role,
          department_id: basic.department_id ? Number(basic.department_id) : null,
        }),
        apiRef.current.put(`/api/admin/users/${user.id}/preferences`, { preferences: prefArray }),
        apiRef.current.put(`/api/roles/users/${user.id}/roles`, { role_ids: assignedRoleIds }),
        apiRef.current.put(`/api/admin/users/${user.id}/inventory-scope`, {
          scope_mode: inventoryScope.scope_mode,
          include_unassigned: false,
          department_ids: inventoryScope.department_ids,
        })
      ];

      // Save per-user permission overrides ONLY (never modify role permissions)
      if (permsDirty) {
        const overridesList = [];
        Object.entries(userOverrides).forEach(([key, val]) => {
          const [module, submodule] = key.split(':');
          if ((val.allow_mask || 0) > 0 || (val.deny_mask || 0) > 0) {
            overridesList.push({
              module,
              submodule: submodule || '',
              allow_mask: val.allow_mask || 0,
              deny_mask: val.deny_mask || 0,
            });
          }
        });
        saves.push(
          apiRef.current.put(`/api/admin/users/${user.id}/permission-overrides`, { overrides: overridesList })
        );
      }

      await Promise.all(saves);

      toast.success('User settings saved successfully');
      if (user.id === me?.id) await refreshUser();
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const isAdmin = basic.role === 'super_admin';
  const isSelf = user.id === me?.id;
  const roleCls = { super_admin: 'b-active', admin: 'b-active', operator: 'b-draft', viewer: 'b-inactive' };
  const hasOverrides = Object.values(userOverrides).some(v => (v.allow_mask || 0) > 0 || (v.deny_mask || 0) > 0);

  return (
    <>
      <style>{`
        @keyframes drawerSlideIn {
          from { transform: translateX(100%); opacity: .6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .udr-panel { animation: drawerSlideIn .24s cubic-bezier(.4,0,.2,1); }
        .udr-tab-btn { display:flex; align-items:center; gap:6px; padding:10px 15px; border:none; background:none; cursor:pointer; font-size:12px; font-weight:600; white-space:nowrap; border-bottom:2px solid transparent; transition:all .14s; }
        .udr-tab-btn:hover { color:var(--brand); }
        .udr-tab-btn.active { color:var(--brand); border-bottom-color:var(--brand); }
        .udr-vis-row { display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border:1px solid var(--g200); border-radius:8px; background:#fff; }
        .udr-pref-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 14px; border:1px solid var(--g200); border-radius:8px; }
        .state-btn { padding: 3px 6px; font-size: 10px; font-weight: 700; border-radius: 4px; border: 1px solid transparent; cursor: pointer; user-select: none; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; min-width: 54px; }
        .state-inherit { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }
        .state-allow { background: #dcfce7; color: #15803d; border-color: #86efac; }
        .state-deny { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
      `}</style>

      {/* Overlay */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.42)', zIndex: 600 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div className="udr-panel" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(760px, 100vw)',
        background: '#fff', zIndex: 601,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-6px 0 32px rgba(0,0,0,.16)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px',
          borderBottom: '1px solid var(--g200)',
          background: 'linear-gradient(135deg,var(--sidebar-start),var(--sidebar-end))',
          flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: 'var(--brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 15, fontWeight: 700, flexShrink: 0,
            boxShadow: '0 2px 8px rgba(13,124,95,.3)',
          }}>
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--g900)' }}>{user.full_name}</div>
            <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              @{user.username}
              <span className={`badge ${roleCls[user.role] || 'b-inactive'}`} style={{ fontSize: 9 }}>{user.role}</span>
              {isSelf && <span style={{ fontSize: 9, background: 'var(--brand-50)', color: 'var(--brand-dark)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>YOU</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, border: '1px solid var(--g300)', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g500)', flexShrink: 0 }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--g200)', background: '#fff', flexShrink: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} className={`udr-tab-btn ${tab === t.id ? 'active' : ''}`}
              style={{ color: tab === t.id ? 'var(--brand)' : 'var(--g500)' }}
              onClick={() => setTab(t.id)}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {fetching ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* ── Basic Info ── */}
              {tab === 'basic' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 16 }}>Edit account details and role assignment.</p>
                  <div className="form-row">
                    <div className="fg">
                      <label>Username *</label>
                      <input value={basic.username} onChange={e => setBasic(b => ({ ...b, username: e.target.value }))} placeholder="username" autoComplete="off" />
                    </div>
                    <div className="fg">
                      <label>Full Name *</label>
                      <input value={basic.full_name} onChange={e => setBasic(b => ({ ...b, full_name: e.target.value }))} placeholder="Full Name" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="fg w">
                      <label>Email</label>
                      <input type="email" value={basic.email} onChange={e => setBasic(b => ({ ...b, email: e.target.value }))} placeholder="user@example.com" autoComplete="off" />
                    </div>
                    <div className="fg">
                      <label>Role *</label>
                      <SelectDropdown value={basic.role} onChange={e => handleRoleChange(e.target.value)} disabled={isSelf}>
                        {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                      </SelectDropdown>
                      {isSelf && <span style={{ fontSize: 10, color: 'var(--g400)', marginTop: 2 }}>Cannot change your own role</span>}
                    </div>
                  </div>

                  {hasOverrides && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: '#FFF8E1', borderRadius: 8, border: '1px solid #FFE082', color: '#E65100', fontSize: 12, marginTop: 12 }}>
                      <div>
                        This user has custom permission overrides. Overrides remain intact when changing roles.
                      </div>
                      <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={resetAllOverrides}>
                        Reset Overrides
                      </button>
                    </div>
                  )}

                  <div className="form-row" style={{ marginTop: 12 }}>
                    <div className="fg w">
                      <label>Primary Department</label>
                      <SelectDropdown value={basic.department_id} onChange={e => setBasic(b => ({ ...b, department_id: e.target.value }))}>
                        <option value="">— None —</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </SelectDropdown>
                      <span style={{ fontSize: 11, color: 'var(--g500)', marginTop: 4 }}>
                        Organizational department only. Inventory visibility is configured under Data Visibility.
                      </span>
                    </div>
                  </div>
                  
                  {/* Advanced Actions */}
                  {!isSelf && onCopySetup && (
                    <div style={{ marginTop: 24, padding: '16px', background: 'var(--g50)', borderRadius: 8, border: '1px solid var(--g200)' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--g800)' }}>Advanced Actions</h4>
                      <p style={{ fontSize: 11, color: 'var(--g500)', marginBottom: 12 }}>
                        Copy permissions, data visibility, dashboard layout, and templates from an existing user to quickly configure this account.
                      </p>
                      <button 
                        className="btn btn-secondary" 
                        onClick={(e) => {
                          e.preventDefault();
                          onCopySetup(user);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Copy size={14} /> Copy Setup From Existing User...
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Permissions (User-Specific Overrides) ── */}
              {tab === 'permissions' && (
                <div>
                  {isAdmin ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#E8EAF6', borderRadius: 8, border: '1px solid #C5CAE9', color: '#283593', fontSize: 12, marginBottom: 12 }}>
                      <Shield size={15} style={{ flexShrink: 0 }} />
                      {basic.role === 'super_admin' ? 'Super Admin' : 'Admin'} — full unrestricted access granted. Overrides matrix shown for reference.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: '#E3F2FD', borderRadius: 8, border: '1px solid #90CAF9', color: '#1565C0', fontSize: 12, marginBottom: 12 }}>
                      <div>
                        Editing <strong>{basic.full_name} ({basic.username})</strong> User Overrides. This changes only this user. Operator role defaults and other users are not modified.
                        {permsDirty && <span style={{ marginLeft: 8, background: '#1565C0', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>Unsaved changes</span>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={resetAllOverrides}
                      >
                        <RotateCcw size={12} /> Reset Overrides
                      </button>
                    </div>
                  )}

                  {/* Tri-state Legend */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, marginBottom: 10, padding: '6px 12px', background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--g700)' }}>Override State Legend:</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="state-btn state-inherit">—</span> Inherit (Role Baseline)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="state-btn state-allow">✓ ALLOW</span> Explicit Allow
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="state-btn state-deny">✕ DENY</span> Explicit Deny
                    </span>
                  </div>

                  <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--table-header)', position: 'sticky', top: 0, zIndex: 2 }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--g600)', fontSize: 11, textTransform: 'uppercase', letterSpacing: .4, borderBottom: '2px solid #D4E8DC', minWidth: 180 }}>
                            Module / Submodule
                          </th>
                          {PERM_ACTIONS.map(a => (
                            <th key={a.id} style={{ minWidth: 64, padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--g600)', borderBottom: '2px solid #D4E8DC' }}>
                              {a.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {MODULE_TREE.map(mod => {
                          const isExpanded = expanded[mod.module] !== false;

                          return (
                            <tr key={mod.module}>
                              <td colSpan={PERM_ACTIONS.length + 1} style={{ padding: 0, borderBottom: '1px solid var(--g200)' }}>

                                {/* Module header row */}
                                <div
                                  onClick={() => toggleExpand(mod.module)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '7px 10px', background: 'var(--g50)',
                                    cursor: 'pointer', userSelect: 'none',
                                  }}
                                >
                                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{mod.label}</span>
                                  <span style={{ fontSize: 10, color: 'var(--g400)' }}>
                                    {(mod.submodules || []).length} submodules
                                  </span>
                                </div>

                                {/* Submodule rows */}
                                {isExpanded && (mod.submodules || []).map((sm, si) => {
                                  return (
                                    <div key={sm.key} style={{
                                      display: 'flex', alignItems: 'center',
                                      borderTop: '1px solid var(--g100)',
                                      background: si % 2 === 0 ? '#fff' : 'var(--table-alt)',
                                    }}>
                                      <div style={{
                                        flex: 1, padding: '6px 8px 6px 32px',
                                        fontSize: 12, fontWeight: 500, color: 'var(--g700)',
                                        minWidth: 160,
                                      }}>
                                        {sm.label}
                                      </div>
                                      {PERM_ACTIONS.map(a => {
                                        const state = getOverrideState(mod.module, sm.key, a.id);
                                        const editable = !isAdmin;

                                        return (
                                          <div key={a.id} style={{ minWidth: 64, textAlign: 'center', padding: '5px 4px' }}>
                                            <button
                                              type="button"
                                              disabled={!editable}
                                              className={`state-btn ${state === 'ALLOW' ? 'state-allow' : state === 'DENY' ? 'state-deny' : 'state-inherit'}`}
                                              onClick={() => editable && cycleOverrideState(mod.module, sm.key, a.id)}
                                              title={`Click to toggle: Inherit -> Allow -> Deny`}
                                            >
                                              {state === 'ALLOW' ? '✓ ALLOW' : state === 'DENY' ? '✕ DENY' : '—'}
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--g400)', marginTop: 8 }}>
                    Showing {MODULE_TREE.reduce((s, m) => s + (m.submodules?.length || 0), 0)} submodules across {MODULE_TREE.length} modules
                  </div>
                </div>
              )}

              {/* ── Data Visibility ── */}
              {tab === 'visibility' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 14 }}>
                    Control which sensitive financial figures this user can see across the system.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {VISIBILITY_KEYS.map(({ key, label, desc }) => (
                      <div key={key} className="udr-vis-row">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--g800)' }}>{label}</div>
                          <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>{desc}</div>
                        </div>
                        <Toggle
                          checked={prefs[key] === 'true' || prefs[key] === true}
                          onChange={v => setPrefs(p => ({ ...p, [key]: String(v) }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 24, padding: '16px', background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--g800)', marginBottom: 8 }}>Inventory Department Access</div>
                    
                    {basic.role === 'super_admin' ? (
                      <div style={{ fontSize: 12, color: 'var(--g600)', padding: '8px 12px', background: '#fff', border: '1px solid var(--g200)', borderRadius: 4 }}>
                        <Shield size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 6, color: 'var(--brand)' }} />
                        Full Inventory Access — system enforced
                      </div>
                    ) : (
                      <>
                        <p style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 12 }}>
                          Restrict the inventory this user can view or interact with to specific departments.
                        </p>
                        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                          {['NONE', 'SELECTED', 'ALL'].map(mode => (
                            <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="scope_mode"
                                value={mode}
                                checked={inventoryScope.scope_mode === mode}
                                onChange={() => {
                                  setInventoryScope(s => ({
                                    scope_mode: mode,
                                    department_ids: mode === 'SELECTED' ? s.department_ids : []
                                  }));
                                }}
                              />
                              {mode === 'NONE' ? 'No Access' : mode === 'SELECTED' ? 'Selected Departments' : 'All Departments'}
                            </label>
                          ))}
                        </div>

                        {inventoryScope.scope_mode === 'SELECTED' && (() => {
                          const visibleDepts = departments.filter(d => d.name.toLowerCase().includes(deptSearch.toLowerCase()));
                          
                          return (
                            <div style={{ border: '1px solid var(--g200)', background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--g200)', background: 'var(--g50)', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--g700)' }}>Allowed Inventory Departments</div>
                                <div style={{ flex: 1 }} />
                                <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
                                  {inventoryScope.department_ids.length} Departments selected
                                </div>
                              </div>
                              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--g200)' }}>
                                <input
                                  type="text"
                                  placeholder="Search departments..."
                                  value={deptSearch}
                                  onChange={e => setDeptSearch(e.target.value)}
                                  className="app-input"
                                  style={{ width: '100%', fontSize: 12, padding: '6px 10px' }}
                                />
                                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                                  <button type="button" onClick={() => {
                                    const visibleIds = visibleDepts.map(d => d.id);
                                    setInventoryScope(s => ({ ...s, department_ids: Array.from(new Set([...s.department_ids, ...visibleIds])) }));
                                  }} style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Select All Visible</button>
                                  <button type="button" onClick={() => {
                                    setInventoryScope(s => ({ ...s, department_ids: [] }));
                                  }} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear All</button>
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 180, overflowY: 'auto', padding: 8 }}>
                                {visibleDepts.length === 0 ? (
                                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--g400)', fontSize: 12 }}>No departments found</div>
                                ) : (
                                  visibleDepts.map(d => (
                                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                                      <input
                                        type="checkbox"
                                        checked={inventoryScope.department_ids.includes(d.id)}
                                        onChange={e => {
                                          const checked = e.target.checked;
                                          setInventoryScope(s => ({
                                            ...s,
                                            department_ids: checked 
                                              ? [...s.department_ids, d.id] 
                                              : s.department_ids.filter(id => id !== d.id)
                                          }));
                                        }}
                                      />
                                      {d.name}
                                    </label>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── Preferences ── */}
              {tab === 'preferences' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 14 }}>
                    UI defaults applied when this user logs in.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {PREF_DEFS.map(({ key, label, type, options, placeholder, desc }) => (
                      <div key={key} className="udr-pref-row">
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--g800)' }}>{label}</div>
                          {desc && <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>{desc}</div>}
                        </div>
                        {type === 'toggle' ? (
                          <Toggle
                            checked={prefs[key] === 'true' || prefs[key] === true}
                            onChange={v => setPrefs(p => ({ ...p, [key]: String(v) }))}
                          />
                        ) : type === 'select' ? (
                          <SelectDropdown
                            value={prefs[key] || ''}
                            onChange={e => setPrefs(p => ({ ...p, [key]: e.target.value }))}
                            style={{ minWidth: 160 }}
                          >
                            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </SelectDropdown>
                        ) : (
                          <input
                            value={prefs[key] || ''}
                            onChange={e => setPrefs(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ padding: '5px 8px', border: '1px solid var(--g300)', borderRadius: 6, fontSize: 12, width: 180, outline: 'none' }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Security ── */}
              {tab === 'security' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', background: '#FFF3E0', borderRadius: 8, border: '1px solid #FFE0B2', color: '#E65100', fontSize: 12, marginBottom: 20 }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    Setting a new password will invalidate the user's current session token on next request.
                  </div>
                  <div className="form-row">
                    <div className="fg w">
                      <label>New Password</label>
                      <input type="password" name="sec-new-pw" autoComplete="new-password" value={pw.password} onChange={e => setPw(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="fg w">
                      <label>Confirm Password</label>
                      <input type="password" name="sec-confirm-pw" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat password" />
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 12 }}>
                    {saving ? 'Updating Password...' : 'Update Password'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          padding: '12px 18px', borderTop: '1px solid var(--g200)', background: 'var(--g50)', flexShrink: 0,
        }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>
    </>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import {
  Shield, Plus, Trash2, Copy, Edit3, Save, X, Search,
  ChevronDown, ChevronRight, Users, Clock, CheckSquare, Square,
} from 'lucide-react';
import { ACTIONS, MODULE_TREE, PERM_BITS, FULL_ACCESS, maskToActions, actionsToMask } from '../../../shared/constants/permissions';
import { useAuth } from '../../../core/context/AuthContext';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import AuditDetailModal from '../components/AuditDetailModal';
import UserAuditHistoryModal from '../components/UserAuditHistoryModal';

/* ── Role hierarchy (highest → lowest) ───────────────────── */
const ROLE_HIERARCHY = { super_admin: 4, admin: 3, operator: 2, viewer: 1 };
const HIERARCHY_LABELS = { super_admin: 'Super Admin', admin: 'Admin', operator: 'Operator', viewer: 'Viewer' };
const HIERARCHY_COLORS = { super_admin: '#7B1FA2', admin: '#1565C0', operator: '#0D7C5F', viewer: '#E65100' };

/* ── Tabs ────────────────────────────────────────────────── */
const TABS = [
  { id: 'roles',       label: 'Roles',        icon: Shield },
  { id: 'permissions', label: 'Permissions',   icon: CheckSquare },
  { id: 'assign',      label: 'Assign Users',  icon: Users },
  { id: 'audit',       label: 'Audit Trail',   icon: Clock },
];

/* ── Color map for role badges ───────────────────────────── */
const roleColors = ['#0D7C5F', '#1565C0', '#6A1B9A', '#E65100', '#2E7D32', '#C62828', '#283593', '#00838F'];

export default function RoleManagementPage() {
  const api = useApi();
  const { user } = useAuth();

  const [tab, setTab] = useState('roles');
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'role_assignment');

  /* ── Role editor (drawer-like inline panel) ────────────── */
  const [editingRole, setEditingRole] = useState(null);         // role object or null
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editDesc, setEditDesc] = useState('');

  /* ── Permission matrix ─────────────────────────────────── */
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [permTree, setPermTree] = useState([]);
  const [permLoading, setPermLoading] = useState(false);
  const [expanded, setExpanded] = useState({});                 // module key → boolean
  const [moduleSearch, setModuleSearch] = useState('');
  const [submodSearch, setSubmodSearch] = useState('');
  const [permDirty, setPermDirty] = useState(false);

  /* ── User assignment ───────────────────────────────────── */
  const [usersWithRoles, setUsersWithRoles] = useState([]);
  const [assignRoleId, setAssignRoleId] = useState('');
  const [assignUserIds, setAssignUserIds] = useState([]);

  /* ── Audit log ─────────────────────────────────────────── */
  const [auditLog, setAuditLog] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [selectedUserForHistory, setSelectedUserForHistory] = useState(null);

  /* ═══════════════════════════════════════════════════════════
     DATA LOADING
     ═══════════════════════════════════════════════════════════ */

  const loadRoles = useCallback(async () => {
    try {
      const res = await api.get('/api/roles');
      setRoles(res.data || []);
    } catch { toast.error('Failed to load roles'); }
    finally { setLoading(false); }
  }, [api]);

  const loadPerms = useCallback(async (roleId) => {
    if (!roleId) return;
    setPermLoading(true);
    try {
      const res = await api.get(`/api/roles/${roleId}/permissions`);
      setPermTree(res.data || []);
      setPermDirty(false);
    } catch { toast.error('Failed to load permissions'); }
    finally { setPermLoading(false); }
  }, [api]);

  const loadUsersWithRoles = useCallback(async () => {
    try {
      const res = await api.get('/api/roles/users-with-roles');
      setUsersWithRoles(res.data || []);
    } catch {}
  }, [api]);

  const loadAuditLog = useCallback(async (p = 1) => {
    try {
      const res = await api.get(`/api/roles/audit-log?page=${p}&pageSize=30`);
      setAuditLog(res.data || []);
      setAuditTotal(res.total || 0);
      setAuditPage(res.page || 1);
    } catch {}
  }, [api]);

  useEffect(() => { loadRoles(); loadUsersWithRoles(); loadAuditLog(); }, [loadRoles, loadUsersWithRoles, loadAuditLog]);

  useEffect(() => { if (selectedRoleId) loadPerms(selectedRoleId); }, [selectedRoleId, loadPerms]);

  /* ═══════════════════════════════════════════════════════════
     ROLE CRUD HANDLERS
     ═══════════════════════════════════════════════════════════ */

  const openNewRole = () => {
    setEditingRole({ id: null });
    setEditName('');
    setEditSlug('');
    setEditDesc('');
  };

  const openEditRole = (role) => {
    setEditingRole(role);
    setEditName(role.name);
    setEditSlug(role.slug);
    setEditDesc(role.description || '');
  };

  const closeEditor = () => setEditingRole(null);

  const saveRole = async () => {
    if (!editName.trim() || !editSlug.trim()) return toast.error('Name and slug are required');
    if (!/^[a-z0-9_]+$/.test(editSlug)) return toast.error('Slug: lowercase alphanumeric + underscores only');
    setSaving(true);
    try {
      if (editingRole?.id) {
        await api.put(`/api/roles/${editingRole.id}`, { name: editName.trim(), description: editDesc.trim() || null });
        toast.success('Role updated');
      } else {
        await api.post('/api/roles', { name: editName.trim(), slug: editSlug.trim(), description: editDesc.trim() || null });
        toast.success('Role created');
      }
      closeEditor();
      await loadRoles();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  const deleteRole = async (role) => {
    if (role.is_system) return toast.error('System roles cannot be deleted');
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/roles/${role.id}`);
      toast.success('Role deleted');
      if (selectedRoleId === role.id) { setSelectedRoleId(null); setPermTree([]); }
      await loadRoles();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  const cloneRole = async (role) => {
    try {
      const res = await api.post(`/api/roles/${role.id}/clone`);
      toast.success(`Role cloned as "${res.data?.name}"`);
      await loadRoles();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  /* ═══════════════════════════════════════════════════════════
     PERMISSION MATRIX HANDLERS
     ═══════════════════════════════════════════════════════════ */

  const getPerm = (moduleKey, subKey, actionId) => {
    const mod = permTree.find(m => m.module === moduleKey);
    if (!mod) return false;
    const sm = mod.submodules?.find(s => s.key === subKey);
    if (!sm) return false;
    return (sm.permissions & PERM_BITS[actionId]) === PERM_BITS[actionId];
  };

  const setPerm = (moduleKey, subKey, actionId, value) => {
    setPermTree(prev => prev.map(m => {
      if (m.module !== moduleKey) return m;
      return {
        ...m,
        submodules: (m.submodules || []).map(s => {
          if (s.key !== subKey) return s;
          const newMask = value ? (s.permissions | PERM_BITS[actionId]) : (s.permissions & ~PERM_BITS[actionId]);
          return { ...s, permissions: newMask };
        }),
      };
    }));
    setPermDirty(true);
  };

  const toggleSubmoduleRow = (moduleKey, subKey) => {
    const mod = permTree.find(m => m.module === moduleKey);
    if (!mod) return;
    const sm = mod.submodules?.find(s => s.key === subKey);
    if (!sm) return;
    const allOn = ACTIONS.every(a => (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id]);
    const newMask = allOn ? 0 : FULL_ACCESS;
    setPermTree(prev => prev.map(m => {
      if (m.module !== moduleKey) return m;
      return {
        ...m,
        submodules: (m.submodules || []).map(s => s.key === subKey ? { ...s, permissions: newMask } : s),
      };
    }));
    setPermDirty(true);
  };

  const toggleModuleRow = (moduleKey) => {
    const mod = permTree.find(m => m.module === moduleKey);
    if (!mod || !mod.submodules?.length) return;
    const allOn = mod.submodules.every(sm => ACTIONS.every(a => (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id]));
    const newMask = allOn ? 0 : FULL_ACCESS;
    setPermTree(prev => prev.map(m => {
      if (m.module !== moduleKey) return m;
      return {
        ...m,
        submodules: (m.submodules || []).map(s => ({ ...s, permissions: newMask })),
      };
    }));
    setPermDirty(true);
  };

  const toggleActionCol = (actionId) => {
    let allOn = true;
    for (const mod of permTree) {
      for (const sm of (mod.submodules || [])) {
        if ((sm.permissions & PERM_BITS[actionId]) !== PERM_BITS[actionId]) { allOn = false; break; }
      }
      if (!allOn) break;
    }
    setPermTree(prev => prev.map(m => ({
      ...m,
      submodules: (m.submodules || []).map(s => ({
        ...s,
        permissions: allOn ? (s.permissions & ~PERM_BITS[actionId]) : (s.permissions | PERM_BITS[actionId]),
      })),
    })));
    setPermDirty(true);
  };

  const selectAllPerms = () => {
    setPermTree(prev => prev.map(m => ({
      ...m,
      submodules: (m.submodules || []).map(s => ({ ...s, permissions: FULL_ACCESS })),
    })));
    setPermDirty(true);
  };

  const deselectAllPerms = () => {
    setPermTree(prev => prev.map(m => ({
      ...m,
      submodules: (m.submodules || []).map(s => ({ ...s, permissions: 0 })),
    })));
    setPermDirty(true);
  };

  const savePermissions = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = [];
      for (const mod of permTree) {
        for (const sm of (mod.submodules || [])) {
          payload.push({ module: mod.module, submodule: sm.key, permissions: sm.permissions });
        }
      }
      await api.put(`/api/roles/${selectedRoleId}/permissions`, { permissions: payload });
      toast.success('Permissions saved');
      setPermDirty(false);
      await loadAuditLog();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  /* ═══════════════════════════════════════════════════════════
     USER ASSIGNMENT HANDLERS
     ═══════════════════════════════════════════════════════════ */

  const toggleUserAssign = (userId) => {
    setAssignUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const saveUserAssignments = async () => {
    if (!assignRoleId) return toast.error('Select a role first');
    setSaving(true);
    try {
      for (const userId of assignUserIds) {
        const existing = usersWithRoles.find(u => u.id === userId);
        const currentRoleIds = (existing?.roles || []).map(r => r.role_id);
        if (!currentRoleIds.includes(parseInt(assignRoleId))) {
          await api.put(`/api/roles/users/${userId}/roles`, { role_ids: [...currentRoleIds, parseInt(assignRoleId)] });
        }
      }
      toast.success(`Assigned ${assignUserIds.length} user(s) to role`);
      setAssignUserIds([]);
      await loadUsersWithRoles();
      await loadAuditLog();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  const removeUserRole = async (userId, roleId) => {
    const existing = usersWithRoles.find(u => u.id === userId);
    const currentRoleIds = (existing?.roles || []).map(r => r.role_id);
    const updated = currentRoleIds.filter(id => id !== roleId);
    try {
      await api.put(`/api/roles/users/${userId}/roles`, { role_ids: updated });
      toast.success('Role removed from user');
      await loadUsersWithRoles();
      await loadAuditLog();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  /* ═══════════════════════════════════════════════════════════
     FILTERED DATA
     ═══════════════════════════════════════════════════════════ */

  const selectedRole = roles.find(r => r.id === selectedRoleId);

  const filteredPermTree = useMemo(() => {
    if (!moduleSearch && !submodSearch) return permTree;
    return permTree.filter(mod => {
      const modMatch = !moduleSearch || mod.label.toLowerCase().includes(moduleSearch.toLowerCase());
      if (submodSearch) {
        const hasSubmod = (mod.submodules || []).some(s => s.label.toLowerCase().includes(submodSearch.toLowerCase()));
        return modMatch && hasSubmod;
      }
      return modMatch;
    }).map(mod => ({
      ...mod,
      submodules: submodSearch ? (mod.submodules || []).filter(s =>
        s.label.toLowerCase().includes(submodSearch.toLowerCase())
      ) : mod.submodules,
    }));
  }, [permTree, moduleSearch, submodSearch]);

  const toggleExpand = (moduleKey) => {
    setExpanded(prev => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  };

  /* ── Sticky header style ────────────────────────────────── */
  const stickyStyle = { position: 'sticky', top: 0, zIndex: 10, background: '#fff' };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Tabs ────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--g200)', background: '#fff', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '11px 20px',
              border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--brand)' : 'transparent'}`,
              background: 'none', cursor: 'pointer', fontWeight: tab === t.id ? 700 : 500,
              fontSize: 13, color: tab === t.id ? 'var(--brand)' : 'var(--g600)',
              transition: 'all .15s',
            }}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
         TAB: ROLES
         ═══════════════════════════════════════════════════════ */}
      {tab === 'roles' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>System Roles</h3>
            <button className="btn btn-primary btn-sm" onClick={openNewRole}>
              <Plus size={14} /> New Role
            </button>
          </div>

          {editingRole && (
            <div style={{ padding: 16, border: '1px solid var(--brand)', borderRadius: 10, background: '#F0FAF6', marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>{editingRole.id ? 'Edit Role' : 'Create Role'}</h4>
              <div className="form-row">
                <div className="fg">
                  <label>Role Name *</label>
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="e.g. Warehouse Manager" />
                </div>
                <div className="fg">
                  <label>Slug *</label>
                  <input value={editSlug} onChange={e => setEditSlug(e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase())}
                    placeholder="e.g. warehouse_manager" disabled={editingRole?.is_system} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg w">
                  <label>Description</label>
                  <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Optional description" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={saveRole} disabled={saving}>
                  <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-sm" onClick={closeEditor}><X size={13} /> Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="spinner" /> : roles.length === 0 ? (
            <div className="empty-state"><Shield size={32} /><p>No roles found</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {roles.map((role, i) => {
                const userLevel = ROLE_HIERARCHY[user?.role] ?? 0;
                const roleLevel = ROLE_HIERARCHY[role.slug] ?? 0;
                const canEditRole = userLevel > roleLevel;
                const hierColor = HIERARCHY_COLORS[role.slug] || roleColors[i % roleColors.length];
                return (
                <div key={role.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', border: '1px solid var(--g200)', borderRadius: 8,
                    background: selectedRoleId === role.id ? '#F0FAF6' : '#fff',
                    cursor: 'pointer', opacity: role.is_active === false ? 0.6 : 1,
                  }}
                  onClick={() => { setSelectedRoleId(role.id); setTab('permissions'); }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: hierColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
                  }}>
                    {role.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {role.name}
                      <span style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                        color: hierColor, letterSpacing: 0.5,
                      }}>
                        Lv.{roleLevel} · {HIERARCHY_LABELS[role.slug] || role.slug}
                      </span>
                      {role.is_system && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--g400)' }}>SYSTEM</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>
                      {role.slug} · {role.user_count || 0} user{(role.user_count || 0) !== 1 ? 's' : ''}
                      {role.description ? ` · ${role.description}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {canEditRole ? (
                      <>
                        <button className="icon-btn" title="Edit" onClick={() => openEditRole(role)}><Edit3 size={14} /></button>
                        <button className="icon-btn" title="Clone" onClick={() => cloneRole(role)}><Copy size={14} /></button>
                        {!role.is_system && (
                          <button className="icon-btn" title="Delete" onClick={() => deleteRole(role)} style={{ color: '#C62828' }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--g400)', padding: '4px 8px', fontStyle: 'italic' }}>
                        Locked
                      </span>
                    )}
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
         TAB: PERMISSIONS
         ═══════════════════════════════════════════════════════ */}
      {tab === 'permissions' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {!selectedRoleId ? (
            <div className="empty-state"><Shield size={32} /><p>Select a role from the Roles tab first</p></div>
          ) : permLoading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : (
            (() => {
              const userLevel = ROLE_HIERARCHY[user?.role] ?? 0;
              const roleLevel = ROLE_HIERARCHY[selectedRole?.slug] ?? 0;
              const canModify = userLevel > roleLevel;
              return (
              <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                    Permissions: <span style={{ color: 'var(--brand)' }}>{selectedRole?.name}</span>
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--g500)' }}>Click a submodule row or action header to toggle all</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={selectAllPerms} disabled={!canModify}><CheckSquare size={13} /> Select All</button>
                  <button className="btn btn-sm" onClick={deselectAllPerms} disabled={!canModify}><Square size={13} /> Deselect All</button>
                  <button className="btn btn-primary btn-sm" onClick={savePermissions} disabled={saving || !permDirty || !canModify}>
                    <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>

              {/* Hierarchy warning banner */}
              {!canModify && selectedRole?.slug !== user?.role && (
                <div style={{ padding: '10px 14px', background: '#FFF3E0', borderRadius: 8, border: '1px solid #FFE082', fontSize: 12, color: '#E65100', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={16} style={{ flexShrink: 0 }} />
                  You do not have authority to modify permissions for <strong>{selectedRole?.name}</strong>. Only higher-level roles can manage this role's permissions.
                </div>
              )}
              {!canModify && selectedRole?.slug === user?.role && (
                <div style={{ padding: '10px 14px', background: '#E3F2FD', borderRadius: 8, border: '1px solid #90CAF9', fontSize: 12, color: '#1565C0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={16} style={{ flexShrink: 0 }} />
                  Editing your own role (<strong>{selectedRole?.name}</strong>). Be careful — changes affect your own permissions.
                </div>
              )}

              {/* Search */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--g300)', borderRadius: 6, padding: '4px 10px', background: '#fff' }}>
                  <Search size={13} style={{ color: 'var(--g400)' }} />
                  <input placeholder="Search module…" value={moduleSearch} onChange={e => setModuleSearch(e.target.value)}
                    style={{ border: 'none', outline: 'none', fontSize: 12, width: 140 }} />
                  {moduleSearch && <X size={12} style={{ cursor: 'pointer', color: 'var(--g400)' }} onClick={() => setModuleSearch('')} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--g300)', borderRadius: 6, padding: '4px 10px', background: '#fff' }}>
                  <Search size={13} style={{ color: 'var(--g400)' }} />
                  <input placeholder="Search submodule…" value={submodSearch} onChange={e => setSubmodSearch(e.target.value)}
                    style={{ border: 'none', outline: 'none', fontSize: 12, width: 140 }} />
                  {submodSearch && <X size={12} style={{ cursor: 'pointer', color: 'var(--g400)' }} onClick={() => setSubmodSearch('')} />}
                </div>
                <span style={{ fontSize: 11, color: 'var(--g400)', alignSelf: 'center' }}>
                  {permTree.reduce((s, m) => s + (m.submodules?.length || 0), 0)} submodules
                </span>
              </div>

              {/* Permission Table */}
              <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ ...stickyStyle, background: 'var(--table-header)', borderBottom: '2px solid #D4E8DC' }}>
                      <th style={{ minWidth: 200, padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Module / Submodule
                      </th>
                      {ACTIONS.map(a => (
                        <th key={a.id}
                          onClick={() => { if (canModify) toggleActionCol(a.id); }}
                          style={{
                            minWidth: 72, padding: '8px 4px', textAlign: 'center', fontWeight: 700,
                            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4,
                            color: 'var(--g600)', cursor: canModify ? 'pointer' : 'default', userSelect: 'none',
                            borderBottom: '2px solid #D4E8DC',
                          }}
                          onMouseEnter={e => { if (canModify) e.currentTarget.style.background = '#D6EDE4'; }}
                          onMouseLeave={e => { if (canModify) e.currentTarget.style.background = ''; }}>
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPermTree.map(mod => {
                      const isExpanded = expanded[mod.module] !== false;
                      const modAllOn = mod.submodules?.length > 0 && mod.submodules.every(sm =>
                        ACTIONS.every(a => (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id])
                      );
                      return (
                        <tr key={mod.module} style={{ background: 'var(--g50)' }}>
                          <td colSpan={ACTIONS.length + 1}
                            style={{ padding: 0, borderBottom: '1px solid var(--g200)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button onClick={() => toggleExpand(mod.module)}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '6px 4px 6px 8px' }}>
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                              <span onClick={() => { if (canModify) toggleModuleRow(mod.module); }}
                                style={{ fontWeight: 700, fontSize: 13, cursor: canModify ? 'pointer' : 'default', userSelect: 'none', padding: '8px 0', flex: 1 }}>
                                {mod.label}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--g400)', paddingRight: 12 }}>
                                {mod.submodules?.length || 0} submodules
                              </span>
                            </div>
                            {isExpanded && (mod.submodules || []).map(sm => {
                              const smAllOn = ACTIONS.every(a => (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id]);
                              return (
                                <div key={sm.key}
                                  style={{
                                    display: 'flex', alignItems: 'center',
                                    borderTop: '1px solid var(--g100)',
                                    background: smAllOn ? '#F0FAF6' : undefined,
                                  }}>
                                  <div
                                    onClick={() => { if (canModify) toggleSubmoduleRow(mod.module, sm.key); }}
                                    style={{
                                      flex: 1, padding: '7px 8px 7px 32px', fontSize: 12,
                                      cursor: canModify ? 'pointer' : 'default', userSelect: 'none',
                                      color: smAllOn ? 'var(--brand)' : 'var(--g700)',
                                      fontWeight: smAllOn ? 600 : 400,
                                    }}>
                                    {sm.label}
                                  </div>
                                  {ACTIONS.map(a => {
                                    const checked = (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id];
                                    return (
                                      <div key={a.id}
                                        style={{ minWidth: 72, textAlign: 'center', padding: '4px 4px' }}>
                                        <input type="checkbox" checked={checked}
                                          onChange={() => { if (canModify) setPerm(mod.module, sm.key, a.id, !checked); }}
                                          disabled={!canModify}
                                          style={{ width: 15, height: 15, accentColor: 'var(--brand)', cursor: canModify ? 'pointer' : 'not-allowed', opacity: canModify ? 1 : 0.5 }} />
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
              </>
              );
            })()
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
         TAB: ASSIGN USERS
         ═══════════════════════════════════════════════════════ */}
      {tab === 'assign' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="fg" style={{ width: 250 }}>
              <label>Select Role</label>
              <select value={assignRoleId} onChange={e => setAssignRoleId(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--g300)', borderRadius: 6, fontSize: 12 }}>
                <option value="">— Choose a role —</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveUserAssignments} disabled={saving || !assignRoleId || assignUserIds.length === 0}>
              <Users size={13} /> Assign {assignUserIds.length > 0 ? `${assignUserIds.length} user(s)` : ''}
            </button>
          </div>

          {usersWithRoles.length === 0 ? (
            <div className="empty-state"><Users size={32} /><p>No users found</p></div>
          ) : (
            <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto' }} ref={tableWrapRef}>
              <table className="dgrid" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}><input type="checkbox"
                      checked={assignUserIds.length > 0 && assignUserIds.length === usersWithRoles.length}
                      onChange={() => setAssignUserIds(assignUserIds.length > 0 ? [] : usersWithRoles.map(u => u.id))} /></th>
                    <th>User</th>
                    <th>Email</th>
                    <th style={{ width: 80 }}>Legacy Role</th>
                    <th>Assigned Roles</th>
                    <th style={{ width: 80 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersWithRoles.map(u => (
                    <tr key={u.id} style={{ background: assignUserIds.includes(u.id) ? '#F0FAF6' : undefined }}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={assignUserIds.includes(u.id)}
                          onChange={() => toggleUserAssign(u.id)}
                          style={{ width: 15, height: 15, accentColor: 'var(--brand)' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{u.full_name} <span style={{ color: 'var(--g400)', fontWeight: 400 }}>@{u.username}</span></td>
                      <td style={{ color: 'var(--g500)' }}>{u.email || '—'}</td>
                      <td><span className={`badge ${u.legacy_role === 'admin' ? 'b-active' : u.legacy_role === 'viewer' ? 'b-inactive' : 'b-draft'}`}>{u.legacy_role}</span></td>
                      <td>
                        {(u.roles || []).map(r => (
                          <span key={r.role_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '2px 4px 2px 0', padding: '2px 8px', background: '#E8F5E9', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                            {r.role_name}
                            <X size={10} style={{ cursor: 'pointer', color: '#C62828' }}
                              onClick={() => removeUserRole(u.id, r.role_id)} />
                          </span>
                        ))}
                        {(u.roles || []).length === 0 && <span style={{ color: 'var(--g400)', fontSize: 11 }}>No roles assigned</span>}
                      </td>
                      <td>
                        {assignRoleId && !assignUserIds.includes(u.id) && (
                          <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}
                            onClick={() => setAssignUserIds([u.id])}>
                            Select
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
         TAB: AUDIT TRAIL
         ═══════════════════════════════════════════════════════ */}
      {tab === 'audit' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Permission Change Audit Log</h3>
          {auditLog.length === 0 ? (
            <div className="empty-state"><Clock size={32} /><p>No audit entries yet</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {auditLog.map(entry => (
                <div key={entry.id} onClick={() => setSelectedAudit(entry)} style={{
                  padding: '10px 14px', border: '1px solid var(--g200)', borderRadius: 6,
                  fontSize: 12, background: '#fff', cursor: 'pointer', transition: 'all 0.15s ease'
                }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand-light)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--g200)'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: entry.action?.includes('delete') ? '#FFEBEE' :
                        entry.action?.includes('create') ? '#E8F5E9' : '#E3F2FD',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {entry.action?.includes('delete') ? <Trash2 size={13} style={{ color: '#C62828' }} /> :
                       entry.action?.includes('create') ? <Plus size={13} style={{ color: '#2E7D32' }} /> :
                       <Edit3 size={13} style={{ color: '#1565C0' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <strong 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (entry.user_id) setSelectedUserForHistory({ id: entry.user_id, full_name: entry.user_name || 'Unknown', username: `user_${entry.user_id}` });
                        }}
                        style={{ color: 'var(--brand)', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}
                      >{entry.user_name || 'System'}</strong> 
                      <span style={{ color: 'var(--g500)', margin: '0 4px' }}>(ID: {entry.user_id})</span> 
                      {entry.action?.replace(/_/g, ' ')} on{' '}
                      <strong>{entry.target_type}</strong> #{entry.target_id}
                      <span style={{ color: 'var(--g400)', marginLeft: 8 }}>
                        {new Date(entry.created_at).toLocaleString('en-IN')}
                      </span>
                    </div>
                    {entry.changes && (
                      <span style={{ fontSize: 10, color: 'var(--g400)', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {JSON.stringify(entry.changes).slice(0, 80)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--g500)' }}>
                    {entry.ip_address && <span>IP: {entry.ip_address}</span>}
                    {entry.user_agent && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                        System: {entry.user_agent}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {auditTotal > 30 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-sm" disabled={auditPage <= 1} onClick={() => loadAuditLog(auditPage - 1)}>Previous</button>
              <span style={{ fontSize: 12, alignSelf: 'center' }}>Page {auditPage} of {Math.ceil(auditTotal / 30)}</span>
              <button className="btn btn-sm" disabled={auditPage >= Math.ceil(auditTotal / 30)} onClick={() => loadAuditLog(auditPage + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {selectedAudit && (
        <AuditDetailModal entry={selectedAudit} onClose={() => setSelectedAudit(null)} roles={roles} />
      )}

      {selectedUserForHistory && (
        <UserAuditHistoryModal user={selectedUserForHistory} onClose={() => setSelectedUserForHistory(null)} roles={roles} />
      )}

    </div>
  );
}

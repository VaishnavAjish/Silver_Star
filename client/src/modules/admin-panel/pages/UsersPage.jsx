import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import Modal from '../../../shared/components/Modal';
import UserDrawer from './UserDrawer';
import UserAuditHistoryModal from '../components/UserAuditHistoryModal';
import {
  Plus, Edit2, ToggleLeft, ToggleRight, Users, Search, Save,
  ShieldCheck, UserCheck, UserX, Shield, Trash2, Copy, Edit3, X,
  ChevronDown, ChevronRight, CheckSquare, Square, Clock, Key,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import { ACTIONS, MODULE_TREE, PERM_BITS, FULL_ACCESS } from '../../../shared/constants/permissions';

/* ── Constants ──────────────────────────────────────────────── */
const ROLES      = ['super_admin', 'admin', 'operator', 'viewer'];
const EMPTY_FORM = { username: '', email: '', full_name: '', role: 'operator', password: '', department_id: '' };

const ROLE_META = {
  super_admin: { cls: 'b-active',   label: 'Super Admin', avatarBg: '#E8EAF6', avatarColor: '#283593' },
  admin:       { cls: 'b-active',   label: 'Admin',       avatarBg: '#E8F5E9', avatarColor: '#2E7D32' },
  operator:    { cls: 'b-draft',    label: 'Operator',    avatarBg: '#FFF3E0', avatarColor: '#E65100' },
  viewer:      { cls: 'b-inactive', label: 'Viewer',      avatarBg: 'var(--g100)', avatarColor: 'var(--g500)' },
};

const roleColors = ['#0D7C5F', '#1565C0', '#6A1B9A', '#E65100', '#2E7D32', '#C62828', '#283593', '#00838F'];

const PAGE_TABS = [
  { id: 'users', label: 'Users',       icon: Users },
  { id: 'audit', label: 'Audit Trail', icon: Clock },
];

/* ── Skeleton shimmer ───────────────────────────────────────── */
const SK_LINE = {
  display: 'inline-block', width: 32, height: 12, borderRadius: 4,
  background: 'linear-gradient(90deg,var(--g200) 25%,var(--g100) 50%,var(--g200) 75%)',
  backgroundSize: '200% 100%', animation: 'adm-shimmer 1.2s ease-in-out infinite',
};

function SkRow() {
  const cell = (w) => (
    <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--g200)' }}>
      <span style={{ ...SK_LINE, width: w }} />
    </td>
  );
  return <tr>{cell(120)}{cell(150)}{cell(80)}{cell(90)}{cell(60)}{cell(90)}{cell(80)}{cell(70)}</tr>;
}

/* ── Stat card ──────────────────────────────────────────────── */
function StatCard({ icon: Icon, value, label, iconBg, loading }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: iconBg }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="stat-val">{loading ? <span style={SK_LINE} /> : value}</div>
        <div className="stat-lbl">{label}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   COMBINED USERS PAGE
   ══════════════════════════════════════════════════════════════ */
export default function UsersPage() {
  const api    = useApi();
  const { user: me } = useAuth();

  /* ── Main tab ── */
  const [pageTab, setPageTab] = useState('users');

  /* ── Shared saving flag ── */
  const [saving, setSaving] = useState(false);

  /* ── Refs ── */
  const apiRef        = useRef(api);
  const usersTableRef = useRef(null);
  const assignTableRef = useRef(null);
  useEffect(() => { apiRef.current = api; });
  useResizableColumns(usersTableRef,  'users');
  useResizableColumns(assignTableRef, 'role_assignment');

  /* ════════════════════════════════
     USERS tab state
  ════════════════════════════════ */
  const [users,       setUsers]       = useState([]);
  const [usersLoading,setUsersLoading]= useState(true);
  const [search,      setSearch]      = useState('');
  const [addOpen,     setAddOpen]     = useState(false);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [drawerUser,  setDrawerUser]  = useState(null);
  const [departments, setDepartments] = useState([]);

  const loadUsers = useCallback(() => {
    setUsersLoading(true);
    apiRef.current.get('/api/admin/users')
      .then(setUsers)
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setUsersLoading(false));
  }, []);

  const loadDepartments = useCallback(() => {
    apiRef.current.get('/api/departments', { limit: 500, offset: 0 })
      .then(r => setDepartments(Array.isArray(r) ? r : (r?.data || [])))
      .catch(() => {});
  }, []);

  const fetchedUsers = useRef(false);
  useEffect(() => {
    if (fetchedUsers.current) return;
    fetchedUsers.current = true;
    loadUsers();
    loadDepartments();
  }, []);

  const handleAdd = async () => {
    if (!form.username.trim() || !form.full_name.trim()) return toast.error('Username and full name are required');
    if (!form.password) return toast.error('Password required');
    if (form.password.length < 6) return toast.error('Password must be at least 6 characters');
    setSaving(true);
    try {
      await apiRef.current.post('/api/admin/users', form);
      toast.success('User created');
      setAddOpen(false);
      loadUsers();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleToggle = async (u) => {
    if (u.id === me?.id) return toast.error('Cannot deactivate your own account');
    if (!window.confirm(`${u.is_active ? 'Deactivate' : 'Activate'} "${u.username}"?`)) return;
    try {
      await apiRef.current.patch(`/api/admin/users/${u.id}/status`, {});
      toast.success(`User ${u.is_active ? 'deactivated' : 'activated'}`);
      loadUsers();
    } catch (err) { toast.error(err.message); }
  };

  const usersList = Array.isArray(users) ? users : (users?.data || []);
  const filtered  = usersList.filter(u =>
    !search || [u?.username || '', u?.full_name || '', u?.email || ''].some(
      s => s.toLowerCase().includes(search.toLowerCase())
    )
  );
  const stats = {
    total:    usersList.length,
    active:   usersList.filter(u => u?.is_active).length,
    admins:   usersList.filter(u => ['admin', 'super_admin'].includes(u?.role)).length,
    inactive: usersList.filter(u => !u?.is_active).length,
  };
  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(filtered, []);

  /* ════════════════════════════════
     ROLES tab state
  ════════════════════════════════ */
  const [roles,       setRoles]       = useState([]);
  const [rolesLoading,setRolesLoading]= useState(true);
  const [editingRole, setEditingRole] = useState(null);
  const [editName,    setEditName]    = useState('');
  const [editSlug,    setEditSlug]    = useState('');
  const [editDesc,    setEditDesc]    = useState('');

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await apiRef.current.get('/api/roles');
      setRoles(res.data || []);
    } catch { toast.error('Failed to load roles'); }
    finally { setRolesLoading(false); }
  }, []);

  const openNewRole  = () => { setEditingRole({ id: null }); setEditName(''); setEditSlug(''); setEditDesc(''); };
  const openEditRole = (role) => { setEditingRole(role); setEditName(role.name); setEditSlug(role.slug); setEditDesc(role.description || ''); };
  const closeEditor  = () => setEditingRole(null);

  const saveRole = async () => {
    if (!editName.trim() || !editSlug.trim()) return toast.error('Name and slug are required');
    if (!/^[a-z0-9_]+$/.test(editSlug)) return toast.error('Slug: lowercase alphanumeric + underscores only');
    setSaving(true);
    try {
      if (editingRole?.id) {
        await apiRef.current.put(`/api/roles/${editingRole.id}`, { name: editName.trim(), description: editDesc.trim() || null });
        toast.success('Role updated');
      } else {
        await apiRef.current.post('/api/roles', { name: editName.trim(), slug: editSlug.trim(), description: editDesc.trim() || null });
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
      await apiRef.current.del(`/api/roles/${role.id}`);
      toast.success('Role deleted');
      if (selectedRoleId === role.id) { setSelectedRoleId(null); setPermTree([]); }
      await loadRoles();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  const cloneRole = async (role) => {
    try {
      const res = await apiRef.current.post(`/api/roles/${role.id}/clone`);
      toast.success(`Role cloned as "${res.data?.name}"`);
      await loadRoles();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  /* ════════════════════════════════
     PERMISSIONS tab state
  ════════════════════════════════ */
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [permTree,       setPermTree]       = useState([]);
  const [permLoading,    setPermLoading]    = useState(false);
  const [expanded,       setExpanded]       = useState({});
  const [moduleSearch,   setModuleSearch]   = useState('');
  const [submodSearch,   setSubmodSearch]   = useState('');
  const [permDirty,      setPermDirty]      = useState(false);

  const loadPerms = useCallback(async (roleId) => {
    if (!roleId) return;
    setPermLoading(true);
    try {
      const res = await apiRef.current.get(`/api/roles/${roleId}/permissions`);
      setPermTree(res.data || []);
      setPermDirty(false);
    } catch { toast.error('Failed to load permissions'); }
    finally { setPermLoading(false); }
  }, []);

  useEffect(() => { if (selectedRoleId) loadPerms(selectedRoleId); }, [selectedRoleId, loadPerms]);

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
      return { ...m, submodules: (m.submodules || []).map(s => s.key === subKey ? { ...s, permissions: newMask } : s) };
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
      return { ...m, submodules: (m.submodules || []).map(s => ({ ...s, permissions: newMask })) };
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

  const selectAllPerms   = () => { setPermTree(prev => prev.map(m => ({ ...m, submodules: (m.submodules || []).map(s => ({ ...s, permissions: FULL_ACCESS })) }))); setPermDirty(true); };
  const deselectAllPerms = () => { setPermTree(prev => prev.map(m => ({ ...m, submodules: (m.submodules || []).map(s => ({ ...s, permissions: 0 })) }))); setPermDirty(true); };

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
      await apiRef.current.put(`/api/roles/${selectedRoleId}/permissions`, { permissions: payload });
      toast.success('Permissions saved');
      setPermDirty(false);
      await loadAuditLog();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  const toggleExpand    = (moduleKey) => setExpanded(prev => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  const selectedRole    = roles.find(r => r.id === selectedRoleId);

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
      submodules: submodSearch ? (mod.submodules || []).filter(s => s.label.toLowerCase().includes(submodSearch.toLowerCase())) : mod.submodules,
    }));
  }, [permTree, moduleSearch, submodSearch]);

  /* ════════════════════════════════
     ASSIGN USERS tab state
  ════════════════════════════════ */
  const [usersWithRoles, setUsersWithRoles] = useState([]);
  const [assignRoleId,   setAssignRoleId]   = useState('');
  const [assignUserIds,  setAssignUserIds]  = useState([]);

  const loadUsersWithRoles = useCallback(async () => {
    try {
      const res = await apiRef.current.get('/api/roles/users-with-roles');
      setUsersWithRoles(res.data || []);
    } catch {}
  }, []);

  const toggleUserAssign = (userId) =>
    setAssignUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);

  const saveUserAssignments = async () => {
    if (!assignRoleId) return toast.error('Select a role first');
    setSaving(true);
    try {
      for (const userId of assignUserIds) {
        const existing = usersWithRoles.find(u => u.id === userId);
        const currentRoleIds = (existing?.roles || []).map(r => r.role_id);
        if (!currentRoleIds.includes(parseInt(assignRoleId))) {
          await apiRef.current.put(`/api/roles/users/${userId}/roles`, { role_ids: [...currentRoleIds, parseInt(assignRoleId)] });
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
      await apiRef.current.put(`/api/roles/users/${userId}/roles`, { role_ids: updated });
      toast.success('Role removed from user');
      await loadUsersWithRoles();
      await loadAuditLog();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  };

  /* ════════════════════════════════
     AUDIT TRAIL tab state
  ════════════════════════════════ */
  const [auditLog,   setAuditLog]   = useState([]);
  const [auditPage,   setAuditPage]   = useState(1);
  const [auditTotal,  setAuditTotal]  = useState(0);
  const [selectedUserForHistory, setSelectedUserForHistory] = useState(null);

  const loadAuditLog = useCallback(async (p = 1) => {
    try {
      const res = await apiRef.current.get(`/api/roles/audit-log?page=${p}&pageSize=30`);
      setAuditLog(res.data || []);
      setAuditTotal(res.total || 0);
      setAuditPage(res.page || 1);
    } catch {}
  }, []);

  /* ── Initial data load (roles + assign + audit) ── */
  useEffect(() => { loadRoles(); loadUsersWithRoles(); loadAuditLog(); }, [loadRoles, loadUsersWithRoles, loadAuditLog]);

  /* ════════════════════════════════
     RENDER
  ════════════════════════════════ */
  return (
    <>
      <style>{`
        @keyframes adm-shimmer {
          0%   { background-position:  200% 0; }
          100% { background-position: -200% 0; }
        }
        .adm-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .adm-table thead { position:sticky; top:0; z-index:5; }
        .adm-table th {
          background:var(--table-header); padding:9px 14px; text-align:left;
          font-size:11px; font-weight:700; color:var(--g600);
          text-transform:uppercase; letter-spacing:.5px;
          border-bottom:2px solid #D4E8DC; white-space:nowrap;
        }
        .adm-table td { padding:10px 14px; border-bottom:1px solid var(--g200); vertical-align:middle; }
        .adm-table tbody tr { transition:background .1s; }
        .adm-table tbody tr:nth-child(even) { background:var(--table-alt); }
        .adm-table tbody tr:hover { background:#EBF5F0; }
        .adm-icon-btn {
          width:28px; height:28px; border-radius:6px; border:1px solid var(--g300);
          background:#fff; display:inline-flex; align-items:center; justify-content:center;
          cursor:pointer; color:var(--g500); transition:all .12s; padding:0;
        }
        .adm-icon-btn:hover            { background:var(--brand-50); color:var(--brand); border-color:var(--brand-light); }
        .adm-icon-btn.adm-danger:hover { background:#FFEBEE; color:var(--red); border-color:#FFCDD2; }
        .adm-icon-btn:disabled         { opacity:.35; cursor:not-allowed; pointer-events:none; }
        .adm-avatar { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; }
        .adm-page-tab {
          display:flex; align-items:center; gap:6px; padding:10px 18px;
          border:none; border-bottom:2px solid transparent;
          background:none; cursor:pointer; font-size:13px; font-weight:600;
          color:var(--g500); white-space:nowrap; transition:all .14s;
        }
        .adm-page-tab:hover { color:var(--brand); }
        .adm-page-tab.active { color:var(--brand); border-bottom-color:var(--brand); }
        .perm-sticky { position:sticky; top:0; z-index:10; background:#fff; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'linear-gradient(150deg,#edf6f2 0%,#f5faf8 40%,#fff 100%)' }}>

        {/* ── Page Header ── */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 2px 8px rgba(13,124,95,.3)', flexShrink: 0 }}>
                <ShieldCheck size={20} />
              </div>
              <div>
                <h1 style={{ fontSize: 19, fontWeight: 700, color: 'var(--g900)', lineHeight: 1.25 }}>Admin Panel</h1>
                <p style={{ fontSize: 12, color: 'var(--g500)', marginTop: 1 }}>Manage system users, roles, permissions and preferences</p>
              </div>
            </div>

            {/* Stat cards — always visible */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 12, marginBottom: 16 }}>
              <StatCard icon={Users}       value={stats.total}    label="Total Users"    iconBg="var(--brand)" loading={usersLoading} />
              <StatCard icon={UserCheck}   value={stats.active}   label="Active Users"   iconBg="#2E7D32"      loading={usersLoading} />
              <StatCard icon={ShieldCheck} value={stats.admins}   label="Administrators" iconBg="#7B1FA2"      loading={usersLoading} />
              <StatCard icon={UserX}       value={stats.inactive} label="Inactive"       iconBg="#C62828"      loading={usersLoading} />
            </div>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div style={{ borderBottom: '1px solid var(--g200)', background: '#fff', flexShrink: 0 }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', overflowX: 'auto' }}>
            {PAGE_TABS.map(t => (
              <button key={t.id}
                className={`adm-page-tab${pageTab === t.id ? ' active' : ''}`}
                onClick={() => setPageTab(t.id)}>
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>

            {/* ══════════════════════════════════════════
               TAB: USERS
            ══════════════════════════════════════════ */}
            {pageTab === 'users' && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--g200)', boxShadow: '0 1px 6px rgba(0,0,0,.06)', overflow: 'hidden' }}>

                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid var(--g200)', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--g800)' }}>All Users</span>
                    {!usersLoading && (
                      <span style={{ fontSize: 10, background: 'var(--brand-50)', color: 'var(--brand-dark)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                        {filtered.length}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--g400)', pointerEvents: 'none' }} />
                      <input
                        type="search" name="user-search" autoComplete="off" autoCorrect="off" spellCheck={false}
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, username, email…"
                        style={{ paddingLeft: 30, width: 230, height: 33, border: '1px solid var(--g300)', borderRadius: 6, fontSize: 12, outline: 'none', color: 'var(--g800)' }}
                        onFocus={e => { e.target.style.borderColor = 'var(--brand)'; }}
                        onBlur={e  => { e.target.style.borderColor = 'var(--g300)'; }}
                      />
                    </div>
                    <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setAddOpen(true); }} style={{ height: 33, padding: '0 14px', fontSize: 12 }}>
                      <Plus size={13} /> Add User
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: 'auto' }} ref={usersTableRef}>
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Status</th>
                        <th>Last Login</th>
                        <th>Joined</th>
                        <th style={{ textAlign: 'center', width: 96 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersLoading && Array.from({ length: 5 }).map((_, i) => <SkRow key={i} />)}

                      {!usersLoading && filtered.length === 0 && (
                        <tr>
                          <td colSpan={8}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '52px 24px', gap: 10 }}>
                              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--g100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Users size={26} style={{ color: 'var(--g400)' }} />
                              </div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--g700)' }}>
                                {search ? `No results for "${search}"` : 'No users yet'}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--g400)' }}>
                                {search ? 'Try a different search term' : 'Click "Add User" to create the first user'}
                              </div>
                              {search && <button className="btn btn-sm" onClick={() => setSearch('')} style={{ marginTop: 4 }}>Clear search</button>}
                            </div>
                          </td>
                        </tr>
                      )}

                      {!usersLoading && paginatedItems.map(u => {
                        const rm = ROLE_META[u.role] || ROLE_META.viewer;
                        return (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div className="adm-avatar" style={{ background: rm.avatarBg, color: rm.avatarColor }}>
                                  {u.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, color: 'var(--g900)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {u.full_name}
                                    {u.id === me?.id && <span style={{ fontSize: 9, background: 'var(--brand-50)', color: 'var(--brand-dark)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>YOU</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 1 }}>@{u.username}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--g500)' }}>{u.email || <span style={{ color: 'var(--g300)' }}>—</span>}</td>
                            <td><span className={`badge ${rm.cls}`}>{rm.label}</span></td>
                            <td style={{ fontSize: 12, color: 'var(--g500)' }}>{u.department_name || <span style={{ color: 'var(--g300)' }}>—</span>}</td>
                            <td><span className={`badge ${u.is_active ? 'b-active' : 'b-cancelled'}`}><span style={{ fontSize: 8 }}>{u.is_active ? '●' : '○'}</span> {u.is_active ? 'Active' : 'Inactive'}</span></td>
                            <td style={{ fontSize: 12, color: 'var(--g500)' }}>
                              {u.last_login ? new Date(u.last_login).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : <span style={{ color: 'var(--g300)' }}>Never</span>}
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--g500)' }}>
                              {new Date(u.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                <button className="adm-icon-btn" title="Edit user, permissions & preferences" onClick={() => setDrawerUser(u)}><Edit2 size={13} /></button>
                                <button
                                  className={`adm-icon-btn ${u.is_active && u.id !== me?.id ? 'adm-danger' : ''}`}
                                  title={u.is_active ? 'Deactivate' : 'Activate'}
                                  disabled={u.id === me?.id}
                                  onClick={() => handleToggle(u)}
                                >
                                  {u.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} style={{ color: '#2E7D32' }} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {filtered.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                    <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span>
                    <Paginator page={page} totalPages={totalPages} onPage={setPage} />
                  </div>
                )}

                {!usersLoading && usersList.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                    <span>{search ? `${filtered.length} of ${usersList.length} users` : `${usersList.length} user${usersList.length !== 1 ? 's' : ''} total`}</span>
                    <span>{stats.active} active · {stats.inactive} inactive</span>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════
               TAB: ROLES (hidden — managed via User drawer)
            ══════════════════════════════════════════ */}
            {false && pageTab === 'roles' && (
              <div>
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
                          placeholder="e.g. warehouse_manager" disabled={!!editingRole?.is_system} />
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

                {rolesLoading ? <div className="spinner" /> : roles.length === 0 ? (
                  <div className="empty-state"><Shield size={32} /><p>No roles found</p></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {roles.map((role, i) => (
                      <div key={role.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px', border: '1px solid var(--g200)', borderRadius: 8,
                          background: selectedRoleId === role.id ? '#F0FAF6' : '#fff',
                          cursor: 'pointer',
                        }}
                        onClick={() => { setSelectedRoleId(role.id); setPageTab('permissions'); }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: roleColors[i % roleColors.length],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>
                          {role.name.charAt(0)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {role.name}
                            {role.is_system && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--g400)' }}>SYSTEM</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>
                            {role.slug} · {role.user_count || 0} user{(role.user_count || 0) !== 1 ? 's' : ''}
                            {role.description ? ` · ${role.description}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button className="icon-btn" title="Edit" onClick={() => openEditRole(role)}><Edit3 size={14} /></button>
                          <button className="icon-btn" title="Clone" onClick={() => cloneRole(role)}><Copy size={14} /></button>
                          {!role.is_system && (
                            <button className="icon-btn" title="Delete" onClick={() => deleteRole(role)} style={{ color: '#C62828' }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════
               TAB: PERMISSIONS (hidden — managed via User drawer)
            ══════════════════════════════════════════ */}
            {false && pageTab === 'permissions' && (
              <div>
                {!selectedRoleId ? (
                  <div className="empty-state">
                    <Shield size={32} />
                    <p>Select a role from the <button className="btn btn-sm" style={{ margin: '0 4px' }} onClick={() => setPageTab('roles')}>Roles</button> tab first</p>
                  </div>
                ) : permLoading ? (
                  <div className="empty-state"><div className="spinner" /></div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                          Permissions: <span style={{ color: 'var(--brand)' }}>{selectedRole?.name}</span>
                        </h3>
                        <span style={{ fontSize: 11, color: 'var(--g500)' }}>Click a submodule row or action header to toggle all</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" onClick={selectAllPerms}><CheckSquare size={13} /> Select All</button>
                        <button className="btn btn-sm" onClick={deselectAllPerms}><Square size={13} /> Deselect All</button>
                        <button className="btn btn-primary btn-sm" onClick={savePermissions} disabled={saving || !permDirty}>
                          <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </div>

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

                    <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr className="perm-sticky" style={{ background: 'var(--table-header)', borderBottom: '2px solid #D4E8DC' }}>
                            <th style={{ minWidth: 200, padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                              Module / Submodule
                            </th>
                            {ACTIONS.map(a => (
                              <th key={a.id}
                                onClick={() => toggleActionCol(a.id)}
                                style={{
                                  minWidth: 72, padding: '8px 4px', textAlign: 'center', fontWeight: 700,
                                  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4,
                                  color: 'var(--g600)', cursor: 'pointer', userSelect: 'none',
                                  borderBottom: '2px solid #D4E8DC',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#D6EDE4'}
                                onMouseLeave={e => e.currentTarget.style.background = ''}>
                                {a.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPermTree.map(mod => {
                            const isExpanded = expanded[mod.module] !== false;
                            return (
                              <tr key={mod.module} style={{ background: 'var(--g50)' }}>
                                <td colSpan={ACTIONS.length + 1} style={{ padding: 0, borderBottom: '1px solid var(--g200)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <button onClick={() => toggleExpand(mod.module)}
                                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '6px 4px 6px 8px' }}>
                                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </button>
                                    <span onClick={() => toggleModuleRow(mod.module)}
                                      style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer', userSelect: 'none', padding: '8px 0', flex: 1 }}>
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
                                          onClick={() => toggleSubmoduleRow(mod.module, sm.key)}
                                          style={{
                                            flex: 1, padding: '7px 8px 7px 32px', fontSize: 12,
                                            cursor: 'pointer', userSelect: 'none',
                                            color: smAllOn ? 'var(--brand)' : 'var(--g700)',
                                            fontWeight: smAllOn ? 600 : 400,
                                          }}>
                                          {sm.label}
                                        </div>
                                        {ACTIONS.map(a => {
                                          const checked = (sm.permissions & PERM_BITS[a.id]) === PERM_BITS[a.id];
                                          return (
                                            <div key={a.id} style={{ minWidth: 72, textAlign: 'center', padding: '4px' }}>
                                              <input type="checkbox" checked={checked}
                                                onChange={() => setPerm(mod.module, sm.key, a.id, !checked)}
                                                style={{ width: 15, height: 15, accentColor: 'var(--brand)', cursor: 'pointer' }} />
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
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════
               TAB: ASSIGN USERS (hidden — managed via User drawer)
            ══════════════════════════════════════════ */}
            {false && pageTab === 'assign' && (
              <div>
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
                  <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto' }} ref={assignTableRef}>
                    <table className="dgrid" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 40, textAlign: 'center' }}>
                            <input type="checkbox"
                              checked={assignUserIds.length > 0 && assignUserIds.length === usersWithRoles.length}
                              onChange={() => setAssignUserIds(assignUserIds.length > 0 ? [] : usersWithRoles.map(u => u.id))} />
                          </th>
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

            {/* ══════════════════════════════════════════
               TAB: AUDIT TRAIL
            ══════════════════════════════════════════ */}
            {pageTab === 'audit' && (
              <div>
                <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Permission Change Audit Log</h3>
                {auditLog.length === 0 ? (
                  <div className="empty-state"><Clock size={32} /><p>No audit entries yet</p></div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Latest Action</th>
                          <th>Total Actions</th>
                          <th>Latest IP Address</th>
                          <th>Last Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(auditLog.reduce((acc, entry) => {
                          if (!acc[entry.user_id]) acc[entry.user_id] = { ...entry, total_actions: 1 };
                          else acc[entry.user_id].total_actions += 1;
                          return acc;
                        }, {})).map(entry => (
                          <tr key={entry.user_id} 
                            onDoubleClick={() => {
                              if (entry.user_id) setSelectedUserForHistory({ id: entry.user_id, full_name: entry.user_name || 'Unknown', username: `user_${entry.user_id}` });
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <div 
                                style={{ display: 'flex', alignItems: 'center', gap: 10, transition: 'opacity 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
                                onMouseLeave={e => e.currentTarget.style.opacity = 1}
                              >
                                <div className="adm-avatar" style={{ 
                                  background: (ROLE_META[entry.role] || ROLE_META.viewer)?.avatarBg || '#F5F5F5', 
                                  color: (ROLE_META[entry.role] || ROLE_META.viewer)?.avatarColor || '#616161' 
                                }}>
                                  {String(entry.user_name || 'S').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, color: 'var(--g900)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {String(entry.user_name || 'System')}
                                    {entry.user_id === me?.id && <span style={{ fontSize: 9, background: 'var(--brand-50)', color: 'var(--brand-dark)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>YOU</span>}
                                    <span style={{ color: 'var(--g400)', fontWeight: 400, marginLeft: 2 }}>(ID: {String(entry.user_id)})</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 1 }}>
                                    @{String(entry.username || `user_${entry.user_id}`)}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 24, height: 24, borderRadius: 4,
                                  background: String(entry.action || '').includes('delete') ? '#FFEBEE' : String(entry.action || '').includes('create') ? '#E8F5E9' : '#E3F2FD',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                  {String(entry.action || '').includes('delete') ? <Trash2 size={12} style={{ color: '#C62828' }} /> :
                                  String(entry.action || '').includes('create') ? <Plus size={12} style={{ color: '#2E7D32' }} /> :
                                  <Edit3 size={12} style={{ color: '#1565C0' }} />}
                                </div>
                                <div>
                                  <div style={{ textTransform: 'capitalize', fontSize: 12, fontWeight: 500, color: 'var(--g800)' }}>
                                    {String(entry.action || '').replace(/_/g, ' ')}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--g500)' }}>
                                    on {String(entry.target_type)} #{String(entry.target_id)}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, color: 'var(--g700)', fontWeight: 600 }}>
                                {Number(entry.total_actions)}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--g600)' }}>
                                {(entry.ip_address === '::1' || entry.ip_address === '127.0.0.1') ? '192.168.1.53' : String(entry.ip_address || '—')}
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: 11, color: 'var(--g500)' }}>
                                {entry.created_at ? new Date(entry.created_at).toLocaleString('en-IN') : '—'}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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

          </div>
        </div>
      </div>

      {/* ── Add User modal ── */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        closeOnOverlay={false}
        title="Add New User"
        footer={
          <>
            <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
              <Save size={14} /> {saving ? 'Creating…' : 'Create User'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="fg">
            <label>Username *</label>
            <input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder="e.g. john_doe" autoComplete="off" />
          </div>
          <div className="fg">
            <label>Full Name *</label>
            <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="John Doe" />
          </div>
        </div>
        <div className="form-row">
          <div className="fg w">
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" autoComplete="off" />
          </div>
          <div className="fg">
            <label>Role *</label>
            <SelectDropdown value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </SelectDropdown>
          </div>
        </div>
        <div className="form-row">
          <div className="fg w">
            <label>Department</label>
            <SelectDropdown value={form.department_id} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectDropdown>
          </div>
        </div>
        <div className="form-row">
          <div className="fg w">
            <label>Password *</label>
            <input type="password" name="add-user-password" autoComplete="new-password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" />
          </div>
        </div>
        <div style={{ padding: '9px 12px', background: 'var(--brand-50)', borderRadius: 6, border: '1px solid #C8E6D8', fontSize: 11.5, color: 'var(--brand-dark)' }}>
          You can configure detailed permissions after creation via the Edit drawer.
        </div>
      </Modal>

      {/* ── Edit user drawer ── */}
      <UserDrawer
        user={drawerUser}
        onClose={() => setDrawerUser(null)}
        onSaved={loadUsers}
      />

      {/* ── User Audit History modal ── */}
      {selectedUserForHistory && (
        <UserAuditHistoryModal
          user={selectedUserForHistory}
          onClose={() => setSelectedUserForHistory(null)}
          roles={roles}
        />
      )}
    </>
  );
}

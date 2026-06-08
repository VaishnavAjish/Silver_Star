import { useState, useEffect, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import FilterBar from '../../../shared/components/FilterBar';
import Modal from '../../../shared/components/Modal';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import {
  Plus, Save, Building2, Edit3, Trash2, X,
  ChevronRight, ChevronDown, Folder, FileText,
  FolderPlus, FilePlus
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── constants ────────────────────────────────────────────────────────────────

const SUB_TYPE_OPTIONS = {
  asset:     ['bank', 'cash', 'receivable', 'inventory', 'fixed_asset', 'other'],
  liability: ['payable', 'credit_card', 'loan', 'other'],
  equity:    [],
  revenue:   [],
  expense:   [],
};

const ALL_SUB_TYPES = [...new Set(Object.values(SUB_TYPE_OPTIONS).flat())].sort();

const ACCOUNT_FILTER_FIELDS = [
  { key: 'nameFilter', label: 'Search', type: 'text' },
  { key: 'typeFilter', label: 'Type', type: 'select',
    options: [
      { value: 'asset', label: 'Asset' },
      { value: 'liability', label: 'Liability' },
      { value: 'equity', label: 'Equity' },
      { value: 'revenue', label: 'Revenue' },
      { value: 'expense', label: 'Expense' },
    ] },
  { key: 'subTypeFilter', label: 'Sub-Type', type: 'select',
    options: ALL_SUB_TYPES.map(st => ({ value: st, label: st.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })) },
  { key: 'statusFilter', label: 'Status', type: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ] },
];

const TYPE_PILL = {
  asset:     { bg: '#e3f2fd', color: '#1565c0' },
  liability: { bg: '#fce4ec', color: '#c62828' },
  equity:    { bg: '#f3e5f5', color: '#6a1b9a' },
  revenue:   { bg: '#e8f5e9', color: '#2e7d32' },
  expense:   { bg: '#fff3e0', color: '#e65100' },
};

const EMPTY = {
  code: '', name: '', type: 'asset', sub_type: '',
  parent_id: '', is_group: false,
  currency: 'INR', status: 'active', description: '',
};

const fmt = (v) => {
  const n = parseFloat(v) || 0;
  if (n === 0) return '—';
  return `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

// ─── component ────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const api = useApi();
  const { canEdit, hasRole } = useAuth();
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'accounts');

  const [treeData,   setTreeData]   = useState([]);   // nested from /tree
  const [flatGroups, setFlatGroups] = useState([]);   // flat groups for parent selector
  const [loading,    setLoading]    = useState(true);
  const [expanded,   setExpanded]   = useState(new Set());
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editItem,   setEditItem]   = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);

  const [_af, _setAf] = usePersistedFilters('accounts_filters', {
    nameFilter: '', typeFilter: '', subTypeFilter: '', statusFilter: '',
  });
  const { nameFilter, typeFilter, subTypeFilter, statusFilter } = _af;

  const hasFilter = !!(nameFilter || typeFilter || subTypeFilter || statusFilter);

  const applyFilters = (nodes) => {
    if (!hasFilter) return nodes;
    return nodes.reduce((acc, node) => {
      const nodeName = String(node.name || '');
      const nodeCode = String(node.code || '');
      const nameOk    = !nameFilter   || nodeName.toLowerCase().includes(nameFilter.toLowerCase()) || nodeCode.toLowerCase().includes(nameFilter.toLowerCase());
      const typeOk    = !typeFilter   || node.type === typeFilter;
      const subTypeOk = !subTypeFilter || node.sub_type === subTypeFilter;
      const statusOk  = !statusFilter || node.status === statusFilter;
      const selfMatch = nameOk && typeOk && subTypeOk && statusOk;
      const filteredChildren = node.children ? applyFilters(node.children) : [];
      if (selfMatch || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
      return acc;
    }, []);
  };

  const handleFilterChange = (key, value) => _setAf(f => ({ ...f, [key]: value }));
  const handleFilterReset = () => _setAf({ nameFilter: '', typeFilter: '', subTypeFilter: '', statusFilter: '' });

  // ── data loading ────────────────────────────────────────────────────────────

  const loadData = async () => {
    setLoading(true);
    try {
      const [tree, flat] = await Promise.all([
        api.get('/api/accounts/tree'),
        api.get('/api/accounts'),
      ]);
      const treeArr = Array.isArray(tree) ? tree : [];
      const flatArr = Array.isArray(flat) ? flat : [];
      setTreeData(treeArr);
      setFlatGroups(flatArr.filter(a => a.is_group));

      // Auto-expand top 2 levels on first load
      setExpanded(prev => {
        if (prev.size > 0) return prev; // don't reset on reload
        const ids = new Set();
        const collect = (nodes, depth) => {
          if (depth >= 2) return;
          for (const n of nodes) {
            if (n.children?.length) { ids.add(n.id); collect(n.children, depth + 1); }
          }
        };
        collect(treeArr, 0);
        return ids;
      });
    } catch {
      toast.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── expand / collapse ───────────────────────────────────────────────────────

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const expandAll = () => {
    const ids = new Set();
    const collect = (nodes) => {
      for (const n of nodes) { if (n.children?.length) { ids.add(n.id); collect(n.children); } }
    };
    collect(treeData);
    setExpanded(ids);
  };

  const collapseAll = () => setExpanded(new Set());

  // ── modal helpers ───────────────────────────────────────────────────────────

  const openCreate = (parentNode = null, asGroup = false) => {
    setEditItem(null);
    setForm({
      ...EMPTY,
      parent_id: parentNode?.id ? String(parentNode.id) : '',
      type:      parentNode?.type || 'asset',
      is_group:  asGroup,
    });
    setModalOpen(true);
  };

  const openEdit = (node) => {
    setEditItem(node);
    setForm({
      code:        node.code,
      name:        node.name,
      type:        node.type,
      sub_type:    node.sub_type    || '',
      parent_id:   node.parent_id   ? String(node.parent_id) : '',
      is_group:    !!node.is_group,
      currency:    node.currency    || 'INR',
      status:      node.status      || 'active',
      description: node.description || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, parent_id: form.parent_id || null, is_group: !!form.is_group };
      if (editItem) {
        await api.put(`/api/accounts/${editItem.id}`, payload);
        toast.success('Account updated');
      } else {
        await api.post('/api/accounts', payload);
        toast.success('Account created');
      }
      setModalOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (node) => {
    if (!window.confirm(`Delete "${node.code} — ${node.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.del(`/api/accounts/${node.id}`);
      toast.success('Account deleted');
      loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to delete account');
    }
  };

  // ── auto-expand when filter active ──────────────────────────────────────────
  // NOTE: filteredTreeData and treeData are included so the effect always has
  // fresh data and never works from a stale closure snapshot.

  useEffect(() => {
    if (hasFilter) {
      const ids = new Set();
      const collect = (nodes) => { for (const n of nodes) { if (n.children?.length) { ids.add(n.id); collect(n.children); } } };
      collect(filteredTreeData);
      setExpanded(ids);
    } else {
      setExpanded(prev => {
        if (prev.size > 0) return prev;
        const ids = new Set();
        const collect = (nodes, depth) => { if (depth >= 2) return; for (const n of nodes) { if (n.children?.length) { ids.add(n.id); collect(n.children, depth + 1); } } };
        collect(treeData, 0);
        return ids;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFilter, typeFilter, subTypeFilter, statusFilter, treeData]);

  // ── tree rendering ──────────────────────────────────────────────────────────

  const renderRows = (nodes, depth = 0) =>
    nodes.flatMap(node => {
      const isExpanded   = expanded.has(node.id);
      const hasChildren  = (node.children?.length || 0) > 0;
      const isGroup      = node.is_group;
      const balance      = isGroup
        ? (node.group_total ?? node.balance)
        : node.balance;
      const indent       = depth * 18;
      const tc           = TYPE_PILL[node.type] || {};

      const bgColor = !isGroup ? 'white'
        : depth === 0 ? '#eef1f9'
        : depth === 1 ? '#f4f6fb'
        : '#f8f9fd';

      const balColor = parseFloat(balance) < 0 ? 'var(--red)'
        : parseFloat(balance) > 0 ? 'var(--green)'
        : '#ccc';

      const row = (
        <tr key={node.id} style={{ background: bgColor }}>

          {/* Toggle + icon — indented */}
          <td style={{ verticalAlign: 'middle' }}>
            <div style={{ display: 'flex', alignItems: 'center', paddingLeft: indent + 4 }}>
              <button
                onClick={() => hasChildren && toggle(node.id)}
                style={{
                  background: 'none', border: 'none',
                  cursor: hasChildren ? 'pointer' : 'default',
                  padding: '1px 2px', lineHeight: 1,
                  color: hasChildren ? '#555' : 'transparent',
                  display: 'flex', alignItems: 'center',
                }}
                title={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
              >
                {hasChildren
                  ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
                  : <span style={{ width: 12 }} />}
              </button>
              <span style={{ marginLeft: 3, lineHeight: 1 }}>
                {isGroup
                  ? <Folder size={13} style={{ color: '#5c7cfa', verticalAlign: 'middle' }} />
                  : <FileText size={12} style={{ color: '#bbb', verticalAlign: 'middle' }} />}
              </span>
            </div>
          </td>

          {/* Code */}
          <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#777' }}>
            {node.code}
          </td>

          {/* Name */}
          <td style={{ fontWeight: isGroup ? 600 : 400 }}>{node.name}</td>

          {/* Type */}
          <td>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: tc.bg, color: tc.color,
            }}>
              {node.type}
            </span>
          </td>

          {/* Sub-type */}
          <td style={{ fontSize: 12 }}>
            {node.sub_type
              ? <span className="badge b-active" style={{ textTransform: 'capitalize' }}>
                  {node.sub_type.replace(/_/g, ' ')}
                </span>
              : <span style={{ color: '#ccc' }}>—</span>}
          </td>

          {/* Level */}
          <td style={{ textAlign: 'center', fontSize: 11, color: '#bbb' }}>
            L{node.level ?? depth + 1}
          </td>

          {/* Balance / group total */}
          <td className="num" style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: isGroup ? 700 : 400, color: balColor }}>
            {isGroup
              ? (hasChildren && isExpanded ? '' : fmt(balance))
              : fmt(balance)}
          </td>

          {/* Status */}
          <td>
            <span className={`badge b-${node.status}`}>{node.status}</span>
          </td>

          {/* Actions */}
          <td>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center' }}>
              {canEdit() && isGroup && (node.level ?? 1) < 4 && (
                <button
                  className="icon-btn"
                  title="Add Sub-Group"
                  onClick={() => openCreate(node, true)}
                >
                  <FolderPlus size={12} />
                </button>
              )}
              {canEdit() && isGroup && (
                <button
                  className="icon-btn"
                  title="Add Ledger"
                  onClick={() => openCreate(node, false)}
                >
                  <FilePlus size={12} />
                </button>
              )}
              {canEdit() && (
                <button className="icon-btn" title="Edit" onClick={() => openEdit(node)}>
                  <Edit3 size={12} />
                </button>
              )}
              {(hasRole('admin') || hasRole('super_admin')) && (
                <button className="icon-btn" title="Delete" onClick={() => deleteAccount(node)}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </td>
        </tr>
      );

      const childRows = hasChildren && isExpanded ? renderRows(node.children, depth + 1) : [];
      return [row, ...childRows];
    });

  // ── modal derived values ────────────────────────────────────────────────────

  const selectedParent = form.parent_id
    ? flatGroups.find(g => g.id === parseInt(form.parent_id))
    : null;
  const derivedLevel = selectedParent ? (selectedParent.level || 1) + 1 : 1;
  const derivedPath  = selectedParent
    ? `${selectedParent.path || selectedParent.code} / ${form.code || '?'}`
    : (form.code || '?');

  // Parent options: only groups, exclude the account being edited + its descendants
  const parentOptions = flatGroups
    .filter(g => !editItem || g.id !== editItem.id)
    .sort((a, b) => (String(a.path || a.code || '')).localeCompare(String(b.path || b.code || '')));

  const countAll = (nodes) =>
    nodes.reduce((s, n) => s + 1 + countAll(n.children || []), 0);

  const filteredTreeData = applyFilters(treeData);
  const totalCount = countAll(treeData);
  const filteredCount = hasFilter ? countAll(filteredTreeData) : totalCount;

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid-page animate-in">

      {/* ── HEADER ──────────────────────────────────────────────── */}

      {/* ── FILTER BAR ──────────────────────────────────────────── */}
      <FilterBar
        filters={_af}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
        fields={ACCOUNT_FILTER_FIELDS}
      >
        <button className="btn btn-secondary btn-sm" onClick={expandAll} title="Expand all">+ All</button>
        <button className="btn btn-secondary btn-sm" onClick={collapseAll} title="Collapse all">− All</button>
        {canEdit() && (
          <>
            <button className="btn btn-secondary" onClick={() => openCreate(null, true)}>
              <Plus size={13} /> Group
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => openCreate(null, false)} style={{ height: 32.73 }}>
              <Plus size={13} /> Ledger
            </button>
          </>
        )}
      </FilterBar>

      {/* ── TREE TABLE ──────────────────────────────────────────── */}
      <div className="grid-wrap" style={{ padding: 0 }} ref={tableWrapRef}>
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 38 }} />
                <th style={{ width: 90 }}>Code</th>
                <th style={{ width: 310 }}>Account Name</th>
                <th style={{ width: 90 }}>Type</th>
                <th style={{ width: 105 }}>Sub-Type</th>
                <th style={{ width: 40, textAlign: 'center' }}>Lvl</th>
                <th style={{ width: 140, textAlign: 'right' }}>Balance</th>
                <th style={{ width: 76 }}>Status</th>
                <th style={{ width: 170, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTreeData.length === 0
                ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>No accounts found.</td></tr>
                : renderRows(filteredTreeData)
              }
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-footer">
        <span>{hasFilter ? `${filteredCount} of ${totalCount} accounts` : `${totalCount} accounts`}</span>
      </div>

      {/* ── MODAL ───────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditItem(null); }}
        title={editItem ? `Edit: ${editItem.code} — ${editItem.name}` : 'New Account'}
        footer={
          <>
            <button className="btn" onClick={() => { setModalOpen(false); setEditItem(null); }}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {/* Path + level indicator */}
        <div style={{
          marginBottom: 12, padding: '7px 11px',
          background: '#f4f6fb', borderRadius: 5,
          fontSize: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span>
            <span style={{ color: '#888', fontWeight: 600 }}>Path: </span>
            <span style={{ fontFamily: 'var(--mono)', color: '#333' }}>{derivedPath}</span>
          </span>
          <span>
            <span style={{ color: '#888' }}>Level: </span>
            <strong style={{ color: derivedLevel > 4 ? '#c62828' : '#2e7d32' }}>
              L{derivedLevel}
            </strong>
            {derivedLevel > 4 && (
              <span style={{ color: '#c62828', marginLeft: 4 }}>⚠ max depth is 4</span>
            )}
          </span>
        </div>

        <div className="form-row">
          <div className="fg">
            <label>Code *</label>
            <input
              autoFocus
              value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
              placeholder="e.g. 1101"
            />
          </div>
          <div className="fg w">
            <label>Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="fg">
            <label>Type</label>
            <SelectDropdown
              value={form.type}
              disabled={!!selectedParent}
              onChange={e => setForm(p => ({ ...p, type: e.target.value, sub_type: '' }))}
            >
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </SelectDropdown>
          </div>

          {(SUB_TYPE_OPTIONS[form.type] || []).length > 0 && (
            <div className="fg">
              <label>Sub-Type</label>
              <SelectDropdown
                value={form.sub_type}
                onChange={e => setForm(p => ({ ...p, sub_type: e.target.value }))}
              >
                <option value="">— None —</option>
                {SUB_TYPE_OPTIONS[form.type].map(st => (
                  <option key={st} value={st}>
                    {st.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </option>
                ))}
              </SelectDropdown>
            </div>
          )}

          <div className="fg">
            <label>Account Kind</label>
            <SelectDropdown
              value={form.is_group ? 'true' : 'false'}
              onChange={e => setForm(p => ({ ...p, is_group: e.target.value === 'true' }))}
            >
              <option value="false">Ledger (posting)</option>
              <option value="true">Group (non-posting)</option>
            </SelectDropdown>
          </div>
        </div>

        <div className="form-row">
          <div className="fg w">
            <label>Parent Group</label>
            <SelectDropdown
              value={form.parent_id}
              onChange={e => {
                const pid    = e.target.value;
                const parent = flatGroups.find(g => g.id === parseInt(pid));
                setForm(p => ({ ...p, parent_id: pid, type: parent ? parent.type : p.type }));
              }}
            >
              <option value="">— None (Top Level) —</option>
              {parentOptions.map(g => (
                <option key={g.id} value={g.id}>
                  {'· '.repeat(Math.max((g.level || 1) - 1, 0))}{g.name} ({g.code})
                </option>
              ))}
            </SelectDropdown>
          </div>
        </div>

        <div className="form-row">
          <div className="fg" style={{ maxWidth: 90 }}>
            <label>Currency</label>
            <input
              value={form.currency}
              onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label>Status</label>
            <SelectDropdown value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectDropdown>
          </div>
          <div className="fg w">
            <label>Description</label>
            <input
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

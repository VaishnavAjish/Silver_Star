import { useState, useEffect } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import Modal from '../../../shared/components/Modal';
import { Plus, Save, Pencil, Power, PowerOff } from 'lucide-react';
import toast from 'react-hot-toast';

const EMPTY = { code: '', name: '', description: '', status: 'active' };

export default function CostCenterMasterPage() {
  const api = useApi();
  const { canEdit } = useAuth();
  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [open, setOpen]             = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, withUsage: 'true' });
      if (search.trim()) params.set('search', search.trim());
      const r = await api.get(`/api/cost-centers?${params.toString()}`);
      setData(r.data || []);
    } catch { toast.error('Failed to load cost centres'); }
    finally { setLoading(false); }
  };

  // Reload when filters change (lightly debounced on search).
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (row) => {
    if (!canEdit()) return;
    setEditing(row);
    setForm({
      code: row.code || '', name: row.name || '',
      description: row.description || '', status: row.status,
    });
    setOpen(true);
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    try {
      if (editing) {
        await api.put(`/api/cost-centers/${editing.id}`, {
          name: form.name, code: form.code, description: form.description,
        });
        toast.success('Cost centre updated');
      } else {
        await api.post('/api/cost-centers', form);
        toast.success('Cost centre created');
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  // Activate / Deactivate (no hard delete — rule 6).
  const toggleStatus = async (row) => {
    if (!canEdit()) return;
    const next = row.status === 'active' ? 'inactive' : 'active';
    const verb = next === 'active' ? 'Activate' : 'Deactivate';
    if (!window.confirm(`${verb} cost centre "${row.code || row.name}"?`)) return;
    try {
      await api.patch(`/api/cost-centers/${row.id}/status`, { status: next });
      toast.success(`Cost centre ${next === 'active' ? 'activated' : 'deactivated'}`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="grid-page">
      <DataGrid
        exportTitle="Cost Centres"
        storageKey="cost_centers_cols"
        hideExportLabel
        fetchExportData={async () => {
          const r = await api.get('/api/cost-centers?status=all&withUsage=true');
          return r.data || r;
        }}
        columns={[
          { key: 'code', label: 'Code', width: 110, render: v => v || '—' },
          { key: 'name', label: 'Cost Centre Name' },
          { key: 'description', label: 'Description', render: v => v || '—' },
          { key: 'usage_count', label: 'Usage', width: 80, numeric: true,
            render: v => v ?? 0 },
          { key: 'status', label: 'Status', width: 90,
            render: v => <span className={`badge b-${v}`}>{v}</span> },
          ...(canEdit() ? [{
            key: '_act', label: '', width: 80,
            render: (_, row) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" title="Edit"
                  onClick={e => { e.stopPropagation(); openEdit(row); }}
                  onDoubleClick={e => e.stopPropagation()}><Pencil size={12} /></button>
                <button className="icon-btn"
                  title={row.status === 'active' ? 'Deactivate' : 'Activate'}
                  onClick={e => { e.stopPropagation(); toggleStatus(row); }}
                  onDoubleClick={e => e.stopPropagation()}
                  style={{ color: row.status === 'active' ? 'var(--red)' : 'var(--green)' }}>
                  {row.status === 'active' ? <PowerOff size={12} /> : <Power size={12} />}
                </button>
              </div>
            ),
          }] : []),
        ]}
        data={data} loading={loading}
        onRefresh={load}
        toolbarActions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              placeholder="Search code or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ minWidth: 180 }}
            />
            <SelectDropdown value={statusFilter} onChange={e => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectDropdown>
            {canEdit() && (
              <button className="btn btn-primary" onClick={openCreate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={13} /> New Cost Centre
              </button>
            )}
          </div>
        }
      />

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit Cost Centre' : 'New Cost Centre'}
        footer={<>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}><Save size={14} /> Save</button>
        </>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div className="fg" style={{ minWidth: 160, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label>Code</label>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. CC004" />
          </div>
          <div className="fg w" style={{ minWidth: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label>Cost Centre Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="fg w" style={{ minWidth: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label>Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          {editing && (
            <div className="fg" style={{ minWidth: 160, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label>Status</label>
              <div><span className={`badge b-${form.status}`}>{form.status}</span>
                <span style={{ fontSize: 11, color: 'var(--g500)', marginLeft: 8 }}>
                  (use the Activate/Deactivate button to change)
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

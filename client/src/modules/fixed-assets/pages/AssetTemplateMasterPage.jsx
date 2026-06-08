import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import {
  BookOpen, Plus, Search, Save, X, Trash2, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Paginator from '../../../shared/components/Paginator';

const PAGE_SIZE = 500;

const BLANK = {
  name: '', category_id: '', default_model_no: '', default_brand: '',
  default_manufacturer: '', default_uom_id: '', default_useful_life: '',
  default_depr_rate: '', description: '', status: 'active',
};

function StatusBadge({ status }) {
  return (
    <span className={`badge ${status === 'active' ? 'b-active' : 'b-draft'}`} style={{ fontSize: 10 }}>
      {status}
    </span>
  );
}

export default function AssetTemplateMaster() {
  const { get, post, patch, del } = useApi();
  const navigate = useNavigate();
  const { user }  = useAuth();
  const isAdmin   = ['admin', 'super_admin'].includes(user?.role);

  const [templates, setTemplates] = useState([]);
  const [cats,      setCats]      = useState([]);
  const [uoms,      setUoms]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [_atf, _setAtf] = usePersistedFilters('asset_template_filters', {
    search: '', filterCat: '', filterSt: 'active',
  });
  const { search, filterCat, filterSt } = _atf;
  const setSearch    = v => _setAtf(f => ({ ...f, search:    v }));
  const setFilterCat = v => _setAtf(f => ({ ...f, filterCat: v }));
  const setFilterSt  = v => _setAtf(f => ({ ...f, filterSt:  v }));

  // Form state — null means panel closed
  const [formData,  setFormData]  = useState(null);  // null | { ...fields }
  const [editId,    setEditId]    = useState(null);   // null = new, number = edit
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null);   // id being deleted
  const [page,      setPage]      = useState(1);

  useEffect(() => { setPage(1); }, [search, filterSt, filterCat]);

  // Stable load function
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 500 });
      if (filterSt)  params.set('status',      filterSt);
      if (filterCat) params.set('category_id', filterCat);
      if (search)    params.set('search',       search);

      const [tRes, cRes, uRes] = await Promise.all([
        get(`/api/asset-templates?${params}`),
        get('/api/fixed-asset-categories?status=active'),
        get('/api/uom'),
      ]);
      setTemplates(tRes.data || []);
      setCats(cRes.data || []);
      setUoms(uRes.data || []);
    } catch {
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [filterSt, filterCat, search, get]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, filterSt, filterCat, load]);

  const filtered = useMemo(() => {
    const arr = [...templates];
    arr.sort((a, b) => {
      if (a.created_at && b.created_at) return new Date(b.created_at) - new Date(a.created_at);
      if (typeof a.id === 'number' && typeof b.id === 'number') return b.id - a.id;
      return 0;
    });
    return arr;
  }, [templates]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const openNew = () => {
    setFormData({ ...BLANK });
    setEditId(null);
  };

  const openEdit = tpl => {
    setFormData({
      name:                 tpl.name,
      category_id:          String(tpl.category_id),
      default_model_no:     tpl.default_model_no     || '',
      default_brand:        tpl.default_brand        || '',
      default_manufacturer: tpl.default_manufacturer || '',
      default_uom_id:       tpl.default_uom_id ? String(tpl.default_uom_id) : '',
      default_useful_life:  tpl.default_useful_life  != null ? String(tpl.default_useful_life) : '',
      default_depr_rate:    tpl.default_depr_rate    != null ? String(tpl.default_depr_rate)   : '',
      description:          tpl.description          || '',
      status:               tpl.status,
    });
    setEditId(tpl.id);
  };

  const closeForm = () => { setFormData(null); setEditId(null); };

  const setField = (k, v) => setFormData(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!formData.name?.trim())  return toast.error('Template name is required');
    if (!formData.category_id)   return toast.error('Asset category is required');

    setSaving(true);
    try {
      const payload = {
        name:                 formData.name.trim(),
        category_id:          parseInt(formData.category_id),
        default_model_no:     formData.default_model_no     || undefined,
        default_brand:        formData.default_brand        || undefined,
        default_manufacturer: formData.default_manufacturer || undefined,
        default_uom_id:       formData.default_uom_id ? parseInt(formData.default_uom_id) : undefined,
        default_useful_life:  formData.default_useful_life  ? parseFloat(formData.default_useful_life)  : undefined,
        default_depr_rate:    formData.default_depr_rate    ? parseFloat(formData.default_depr_rate)    : undefined,
        description:          formData.description          || undefined,
        status:               formData.status,
      };

      if (editId) {
        await patch(`/api/asset-templates/${editId}`, payload);
        toast.success('Template updated');
      } else {
        await post('/api/asset-templates', payload);
        toast.success('Template created');
      }
      closeForm();
      load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async id => {
    if (!window.confirm('Delete this template? Assets already linked will keep their data.')) return;
    setDeleting(id);
    try {
      await del(`/api/asset-templates/${id}`);
      toast.success('Template deleted');
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleStatus = async tpl => {
    const newStatus = tpl.status === 'active' ? 'inactive' : 'active';
    try {
      await patch(`/api/asset-templates/${tpl.id}`, { status: newStatus });
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, status: newStatus } : t));
      toast.success(`Template ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="animate-in" style={{ padding: 20, maxWidth: 1100 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={18} style={{ color: 'var(--brand)' }} />
            Asset Template Master
          </h2>
          <div style={{ fontSize: 12, color: 'var(--g500)', marginTop: 2 }}>
            Standardized asset definitions — Category → Template → Fixed Asset Register
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => navigate('/assets')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            ← Go Back
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={14} /> New Template
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner ── */}
      <div style={{ padding: '10px 14px', background: '#EEF2FF', border: '1px solid #C7D2FE',
                    borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#4338CA',
                    display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Templates are a standardization layer only.</strong> They do NOT create GL accounts or
          change accounting behaviour. GL posting is still controlled by the Asset Category.
          Selecting a template auto-fills category, brand, and specs when creating a new fixed asset.
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
          <Search size={13} style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--g400)', pointerEvents: 'none',
          }} />
          <input
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 28, width: '100%', fontSize: 12 }}
          />
        </div>
        <SelectDropdown value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Categories</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectDropdown>
        <SelectDropdown value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </SelectDropdown>
        <span style={{ fontSize: 11, color: 'var(--g500)' }}>{filtered.length} templates</span>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── Table ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={40} />
              <p>No templates found{search ? ` for "${search}"` : ''}.</p>
              {isAdmin && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus size={14} /> Create First Template
                </button>
              )}
            </div>
          ) : (
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Code</th>
                  <th>Template Name</th>
                  <th style={{ width: 160 }}>Category</th>
                  <th style={{ width: 130 }}>Brand / Manufacturer</th>
                  <th style={{ width: 70, textAlign: 'right' }}>Assets</th>
                  <th style={{ width: 70 }}>Status</th>
                  {isAdmin && <th style={{ width: 90 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map(tpl => (
                  <tr key={tpl.id} style={{ cursor: 'pointer' }}
                      onClick={() => isAdmin && openEdit(tpl)}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>
                      {tpl.code}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                      {tpl.description && (
                        <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 1, maxWidth: 260,
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tpl.description}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--g600)' }}>{tpl.category_name}</td>
                    <td style={{ color: 'var(--g600)', fontSize: 11 }}>
                      <div>{tpl.default_brand || '—'}</div>
                      {tpl.default_manufacturer && (
                        <div style={{ color: 'var(--g400)' }}>{tpl.default_manufacturer}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {tpl.asset_count || 0}
                    </td>
                    <td onClick={e => { e.stopPropagation(); isAdmin && handleToggleStatus(tpl); }}>
                      <StatusBadge status={tpl.status} />
                    </td>
                    {isAdmin && (
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-sm"
                            style={{ padding: '2px 8px', fontSize: 11 }}
                            onClick={() => openEdit(tpl)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ padding: '2px 6px', fontSize: 11, color: 'var(--red)', border: 'none' }}
                            onClick={() => handleDelete(tpl.id)}
                            disabled={deleting === tpl.id || parseInt(tpl.asset_count) > 0}
                            title={parseInt(tpl.asset_count) > 0 ? 'Cannot delete — assets exist' : 'Delete template'}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          
          {filtered.length > 0 && !loading && (
            <div className="grid-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span>Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} records</span>
              <Paginator page={page} totalPages={totalPages} onPage={setPage} />
            </div>
          )}
        </div>

        {/* ── Edit / New panel Modal ── */}
        {formData && isAdmin && (
          <div className="modal-overlay">
            <div className="modal animate-in" style={{ width: 420 }}>
              <div className="modal-header">
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--g900)' }}>
                  {editId ? 'Edit Template' : 'New Template'}
                </h3>
                <button type="button" onClick={closeForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g400)' }}>
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div className="fg">
                  <label>Template Name *</label>
                  <input
                    value={formData.name}
                    onChange={e => setField('name', e.target.value)}
                    placeholder="e.g. Hydrogen Diffusion Purifier"
                    autoFocus={!editId}
                  />
                </div>

                <div className="fg">
                  <label>Asset Category *</label>
                  <SelectDropdown value={formData.category_id} onChange={e => setField('category_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectDropdown>
                </div>

                <div className="form-row" style={{ gap: 10, marginBottom: 0 }}>
                  <div className="fg" style={{ flex: 1 }}>
                    <label>Brand</label>
                    <input value={formData.default_brand} onChange={e => setField('default_brand', e.target.value)} placeholder="e.g. Siemens" />
                  </div>
                  <div className="fg" style={{ flex: 1 }}>
                    <label>Model No</label>
                    <input value={formData.default_model_no} onChange={e => setField('default_model_no', e.target.value)} placeholder="Default model" />
                  </div>
                </div>

                <div className="fg">
                  <label>Manufacturer</label>
                  <input value={formData.default_manufacturer} onChange={e => setField('default_manufacturer', e.target.value)} placeholder="Company name" />
                </div>

                <div className="fg">
                  <label>Default UOM</label>
                  <SelectDropdown value={formData.default_uom_id} onChange={e => setField('default_uom_id', e.target.value)}>
                    <option value="">NOS (default)</option>
                    {uoms.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                  </SelectDropdown>
                </div>

                <div className="form-row" style={{ gap: 10, marginBottom: 0 }}>
                  <div className="fg" style={{ flex: 1 }}>
                    <label>Useful Life (years)</label>
                    <input type="number" min="0" step="0.5" value={formData.default_useful_life}
                      onChange={e => setField('default_useful_life', e.target.value)}
                      placeholder="From category" />
                  </div>
                  <div className="fg" style={{ flex: 1 }}>
                    <label>Depr Rate (%)</label>
                    <input type="number" min="0" max="100" step="0.01" value={formData.default_depr_rate}
                      onChange={e => setField('default_depr_rate', e.target.value)}
                      placeholder="From category" />
                  </div>
                </div>

                <div className="fg">
                  <label>Description</label>
                  <input value={formData.description} onChange={e => setField('description', e.target.value)}
                    placeholder="Brief description of asset type" />
                </div>

                <div className="fg">
                  <label>Status</label>
                  <SelectDropdown value={formData.status} onChange={e => setField('status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </SelectDropdown>
                </div>

                <div style={{ padding: '10px 12px', background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)', fontSize: 10, color: 'var(--g500)', lineHeight: 1.4 }}>
                  Useful life and depreciation rate on a template are reference defaults only. Actual accounting is always controlled by the Asset Category GL accounts.
                </div>
              </div>

              <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0, paddingBottom: 16 }}>
                <button type="button" className="btn" onClick={closeForm}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Save Template'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

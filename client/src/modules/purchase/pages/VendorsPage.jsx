import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import FilterBar from '../../../shared/components/FilterBar';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../../core/tabs';
import { ShoppingCart, Plus, AlertCircle, CheckCircle, Clock, RefreshCw, X, GripVertical } from 'lucide-react';
import ExportMenu from '../../../shared/components/ExportMenu';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import useColumnManager from '../../../shared/components/useColumnManager';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import toast from 'react-hot-toast';
import SelectDropdown from '../../../shared/components/SelectDropdown';

const fmt = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const PAGE_SIZE = 500;

const EMPTY_FORM = {
  code: '', name: '', category: 'general', contact_person: '',
  phone: '', email: '', address: '', city: 'Surat', state: 'Gujarat',
  gstin: '', pan: '', payment_term: 'Immediate', bank_details: '', status: 'active',
};

const CATEGORIES    = ['seed', 'gas', 'consumable', 'general'];
const PAYMENT_TERMS = ['Immediate', '7 Days', '15 Days', '30 Days', '60 Days'];

const VENDOR_COLUMNS = [
  { key: 'code', label: 'Code', width: 80 },
  { key: 'name', label: 'Vendor Name' },
  { key: 'category', label: 'Category', width: 100 },
  { key: 'phone', label: 'Phone', width: 130 },
  { key: 'email', label: 'Email' },
  { key: 'open_balance', label: 'Open Balance', width: 140, textAlign: 'right', numeric: true },
  { key: 'status', label: 'Status', width: 80 },
  { key: '_actions', label: 'Actions', width: 190, mandatory: true },
];

const FILTER_FIELDS = [
  { key: 'search', label: 'Search',   type: 'text'   },
  { key: 'status', label: 'Status',   type: 'select',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  { key: 'category', label: 'Category', type: 'select',
    options: CATEGORIES.map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
];

export default function VendorsPage() {
  const { get, post, put } = useApi();
  const navigate  = useNavigate();
  const { openTab } = useTabs();
  const { canEdit } = useAuth();

  // ── Data state ────────────────────────────────────────────────────────────
  const [vendors,  setVendors]  = useState([]);
  const [summary,  setSummary]  = useState({ total_payables: 0, overdue: 0, paid_last_30: 0 });
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [spinning, setSpinning] = useState(false);

  // ── Pagination + filters ──────────────────────────────────────────────────
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = usePersistedFilters('vendors_filters', {});
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Modal state ───────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);

  // ── Column manager ──────────────────────────────────────────────────────────
  const colMgr = useColumnManager({
    columns: VENDOR_COLUMNS,
    storageKey: 'vendors_cols',
    mandatoryKeys: ['_actions'],
  });
  const [dragOverKey, setDragOverKey] = useState(null);

  // ── Debounce ref ──────────────────────────────────────────────────────────
  const debounceRef = useRef(null);

  // ── Resize cleanup (prevent listener leak on unmount mid-drag) ──────────
  const resizeCleanupRef = useRef(null);
  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  const loadData = useCallback(async (pg, flt) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, pageSize: PAGE_SIZE });
      if (flt.search)   params.set('search', flt.search);
      if (flt.status)   params.set('status', flt.status);
      if (flt.category) params.set('category', flt.category);

      const [vRes, sRes] = await Promise.all([
        get(`/api/vendors?${params}`),
        get('/api/vendors/summary'),
      ]);
      setVendors(vRes.data || []);
      setTotal(vRes.total  || 0);
      setSummary(sRes || { total_payables: 0, overdue: 0, paid_last_30: 0 });
    } catch {
      toast.error('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [get]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await loadData(page, filters); } finally { setSpinning(false); }
  }, [loadData, page, filters]);

  // Re-fetch whenever page or filters change (with 300ms debounce for text input)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const delay = filters.search ? 300 : 0;
    debounceRef.current = setTimeout(() => loadData(page, filters), delay);
    return () => clearTimeout(debounceRef.current);
  }, [page, filters, loadData]);

  // Reset to page 1 when filters change
  const handleFilterChange = (key, value) => {
    setPage(1);
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  const handleFilterReset = () => { setPage(1); setFilters({}); };

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openNew = () => { setEditingId(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (v, e) => {
    e.stopPropagation();
    setEditingId(v.id);
    setForm({
      code: v.code || '', name: v.name || '', category: v.category || 'general',
      contact_person: v.contact_person || '', phone: v.phone || '', email: v.email || '',
      address: v.address || '', city: v.city || '', state: v.state || '',
      gstin: v.gstin || '', pan: v.pan || '', payment_term: v.payment_term || 'Immediate',
      bank_details: v.bank_details || '', status: v.status || 'active',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Vendor name is required');
    setSaving(true);
    try {
      if (editingId) {
        await put(`/api/vendors/${editingId}`, form);
        toast.success('Vendor updated');
      } else {
        await post('/api/vendors', form);
        toast.success('Vendor created');
      }
      setShowModal(false);
      loadData(page, filters);
    } catch (err) {
      toast.error(err.message || 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Summary cards ─────────────────────────────────────────────────────────
  const summaryCards = [
    { label: 'Total Payables',     value: fmt(summary.total_payables), bg: '#FFEBEE', c: '#C62828', icon: <AlertCircle size={15} /> },
    { label: 'Overdue Amount',     value: fmt(summary.overdue),        bg: '#FFF3E0', c: '#E65100', icon: <Clock size={15} />        },
    { label: 'Paid (Last 30 Days)',value: fmt(summary.paid_last_30),   bg: '#E8F5E9', c: '#2E7D32', icon: <CheckCircle size={15} />   },
  ];

  const handleFetchExportRows = async () => {
    const res = await get('/api/vendors?limit=10000');
    const rows = res.data || [];
    return rows.map(v => [
      v.code || '',
      v.name || '',
      v.category || '',
      v.phone || '',
      v.email || '',
      v.open_balance != null ? `₹${Math.round(Number(v.open_balance)).toLocaleString('en-IN')}` : '',
      v.status || '',
    ]);
  };

  const showing = vendors.length;
  const fromRow  = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toRow    = Math.min(page * PAGE_SIZE, total);

  const { page: clientPage, setPage: setClientPage, paginatedItems, totalPages: clientTotalPages, pageSize: clientPageSize } = usePagination(vendors, []);

  return (
    <div className="grid-page animate-in">

      {/* ── Toolbar ── */}
      <div className="grid-toolbar">

        {/* Summary chips */}
        {summaryCards.map((c, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 20,
            background: c.bg, color: c.c, fontSize: 11, fontWeight: 600,
          }}>
            {c.icon} {c.label}: {c.value}
          </div>
        ))}

        <div className="grid-toolbar-right">
          {canEdit() && (
            <button className="btn btn-primary btn-sm" onClick={openNew}>
              <Plus size={13} /> New Vendor
            </button>
          )}
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
        fields={FILTER_FIELDS}
      >
        <span className="grid-count">
          {total === 0 ? 'No records' : `${fromRow}–${toRow} of ${total.toLocaleString()}`}
        </span>
        <ColumnSettings
          columns={colMgr.columns}
          visibleColumns={colMgr.visibleColumns}
          toggleColumn={colMgr.toggleColumn}
          resetLayout={colMgr.resetLayout}
          mandatoryKeys={['_actions']}
        />
        <ExportMenu
          title="Vendors"
          headers={['Code', 'Vendor Name', 'Category', 'Phone', 'Email', 'Open Balance', 'Status']}
          fetchRows={handleFetchExportRows}
        />
        <button className="icon-btn" onClick={handleRefresh} disabled={spinning}
          style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
          <RefreshCw size={14} />
        </button>
      </FilterBar>

      {/* ── Table ── */}
      <div className="grid-wrap">
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : showing === 0 ? (
          <div className="empty-state">
            <ShoppingCart size={38} />
            <p>No vendors found.</p>
            {canEdit() && !filters.search && (
              <button className="btn btn-primary" onClick={openNew}>
                <Plus size={14} /> Add First Vendor
              </button>
            )}
          </div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                {colMgr.visibleColumns.map(col => {
                  const isActions = col.key === '_actions';
                  return (
                    <th
                      key={col.key}
                      data-col-key={col.key}
                      draggable={!isActions}
                      onDragStart={e => {
                        if (isActions) { e.preventDefault(); return; }
                        e.dataTransfer.setData('text/plain', col.key);
                      }}
                      onDragOver={e => { if (!isActions) { e.preventDefault(); setDragOverKey(col.key); } }}
                      onDragLeave={() => setDragOverKey(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverKey(null);
                        const fromKey = e.dataTransfer.getData('text/plain');
                        if (fromKey && fromKey !== col.key) colMgr.reorder(fromKey, col.key);
                      }}
                      style={{
                        width: col.width || undefined,
                        minWidth: col.width || 60,
                        maxWidth: col.width || undefined,
                        textAlign: col.textAlign || undefined,
                        cursor: isActions ? 'default' : 'grab',
                        position: 'relative',
                        ...(dragOverKey === col.key ? { borderLeft: '2px solid var(--brand)' } : {}),
                      }}
                    >
                      {!isActions && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 4, opacity: 0.3 }}>
                          <GripVertical size={10} />
                        </span>
                      )}
                      {col.label}
                      {!isActions && (
                        <span
                          className="col-resize-handle"
                          style={{
                            position: 'absolute', right: 0, top: 0, bottom: 0,
                            width: 4, cursor: 'col-resize', zIndex: 2,
                          }}
                          onMouseDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            const startX = e.clientX;
                            const startW = col.width || 100;
                            const doMove = (ev) => {
                              const diff = ev.clientX - startX;
                              colMgr.setWidth(col.key, Math.max(60, startW + diff));
                            };
                            const doUp = () => {
                              resizeCleanupRef.current = null;
                              document.removeEventListener('mousemove', doMove);
                              document.removeEventListener('mouseup', doUp);
                              document.body.style.cursor = '';
                              document.body.style.userSelect = '';
                            };
                            resizeCleanupRef.current = doUp;
                            document.addEventListener('mousemove', doMove);
                            document.addEventListener('mouseup', doUp);
                            document.body.style.cursor = 'col-resize';
                            document.body.style.userSelect = 'none';
                          }}
                          onDoubleClick={e => { e.stopPropagation(); colMgr.autoFitWidth(col.key); }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map(v => (
                <tr key={v.id} onDoubleClick={() => navigate(`/vendors/${v.id}`)} style={{ cursor: 'pointer' }}>
                  {colMgr.visibleColumns.map(col => {
                    if (col.key === '_actions') {
                      return (
                        <td key={col.key} data-col-key={col.key} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary"
                              onClick={() => navigate('/purchase-notes/new')}>Bill</button>
                            <button className="btn btn-sm"
                              onClick={() => navigate('/payments/new', { state: { vendor_id: v.id, vendor_name: v.name } })}>Pay</button>
                            <button className="btn btn-sm"
                              onClick={() => {
                                const vendorPath = `/vendors/${v.id}`;
                                openTab({ id: vendorPath, name: `Vendor: ${v.name || `#${v.id}`}`, icon: ShoppingCart, path: vendorPath, closable: true });
                                navigate(vendorPath);
                              }}>View</button>
                            {canEdit() && (
                              <button className="btn btn-sm" onClick={e => openEdit(v, e)}>Edit</button>
                            )}
                          </div>
                        </td>
                      );
                    }
                    const val = v[col.key];
                    let content;
                    switch (col.key) {
                      case 'code':
                        content = <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)' }}>{val}</span>;
                        break;
                      case 'name':
                        content = <span style={{ fontWeight: 500, color: 'var(--brand-dark)' }}>{val}</span>;
                        break;
                      case 'category':
                        content = <span style={{ color: 'var(--g600)', textTransform: 'capitalize' }}>{val || '—'}</span>;
                        break;
                      case 'phone':
                        content = val || '—';
                        break;
                      case 'email':
                        content = <span style={{ color: 'var(--g600)' }}>{val || '—'}</span>;
                        break;
                      case 'open_balance':
                        content = <span style={{
                          textAlign: 'right', fontFamily: 'var(--mono)',
                          fontWeight: val > 0 ? 600 : 400,
                          color: val > 0 ? '#C62828' : 'var(--g500)',
                        }}>{fmt(val)}</span>;
                        break;
                      case 'status':
                        content = <span className={`badge b-${val}`}>{val}</span>;
                        break;
                      default:
                        content = val ?? '';
                    }
                    return <td key={col.key} data-col-key={col.key}>{content}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Client Paginator ── */}
      {!loading && vendors.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)', flexShrink: 0 }}>
          <span>Showing {(clientPage - 1) * clientPageSize + 1} to {Math.min(clientPage * clientPageSize, vendors.length)} of {vendors.length} records</span>
          <Paginator page={clientPage} totalPages={clientTotalPages} onPage={setClientPage} />
        </div>
      )}

      {/* ── Server Paginator (if applicable) ── */}
      {!loading && total > PAGE_SIZE && (
        <Paginator page={page} totalPages={totalPages} onPage={p => { setPage(p); document.querySelector('.grid-wrap').scrollTo(0, 0); }} />
      )}

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><ShoppingCart size={16} /> {editingId ? 'Edit Vendor' : 'New Vendor'}</h3>
              <button className="icon-btn" onClick={() => setShowModal(false)}><X size={16} /></button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="fg">
                  <label>Code</label>
                  <input value={form.code} onChange={e => f('code', e.target.value)}
                    placeholder={editingId ? '' : 'Auto-generated if blank'}
                    disabled={!!editingId} style={editingId ? { background: 'var(--g100)' } : {}} />
                </div>
                <div className="fg w">
                  <label>Vendor Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full vendor name" />
                </div>
              </div>

              <div className="form-row">
                <div className="fg">
                  <label>Category</label>
                  <SelectDropdown value={form.category} onChange={e => f('category', e.target.value)}>
                    {CATEGORIES.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Payment Term</label>
                  <SelectDropdown value={form.payment_term} onChange={e => f('payment_term', e.target.value)}>
                    {PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Status</label>
                  <SelectDropdown value={form.status} onChange={e => f('status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </SelectDropdown>
                </div>
              </div>

              <div className="form-row">
                <div className="fg"><label>Contact Person</label>
                  <input value={form.contact_person} onChange={e => f('contact_person', e.target.value)} /></div>
                <div className="fg"><label>Phone</label>
                  <input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+91 XXXXX XXXXX" /></div>
                <div className="fg"><label>Email</label>
                  <input type="email" value={form.email} onChange={e => f('email', e.target.value)} /></div>
              </div>

              <div className="form-row">
                <div className="fg w"><label>Address</label>
                  <input value={form.address} onChange={e => f('address', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="fg"><label>City</label>
                  <input value={form.city} onChange={e => f('city', e.target.value)} /></div>
                <div className="fg"><label>State</label>
                  <input value={form.state} onChange={e => f('state', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="fg"><label>GSTIN</label>
                  <input value={form.gstin} onChange={e => f('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" /></div>
                <div className="fg"><label>PAN</label>
                  <input value={form.pan} onChange={e => f('pan', e.target.value)} placeholder="AAAAA0000A" /></div>
              </div>
              <div className="form-row">
                <div className="fg w"><label>Bank Details</label>
                  <textarea value={form.bank_details} onChange={e => f('bank_details', e.target.value)}
                    rows={3} placeholder="Account No, IFSC, Bank Name..." /></div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Update Vendor' : 'Create Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import FilterBar from '../../../shared/components/FilterBar';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../../core/tabs';
import { Users, Plus, AlertCircle, CheckCircle, Clock, X, RefreshCw } from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import toast from 'react-hot-toast';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import useColumnManager from '../../../shared/components/useColumnManager';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';

const PAGE_SIZE = 500;

const FILTER_FIELDS = [
  { key: 'search', label: 'Search', type: 'text' },
  { key: 'status', label: 'Status', type: 'select',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

const fmt = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;

const EMPTY_FORM = {
  code: '', name: '', contact_person: '',
  phone: '', email: '', address: '', city: 'Surat', state: 'Gujarat',
  gstin: '', pan: '', payment_term: '30 Days', credit_limit: 0, status: 'active',
};

const CUSTOMER_COLUMNS = [
  { key: 'code', label: 'Code', width: 80 },
  { key: 'name', label: 'Customer Name', width: 200 },
  { key: 'phone', label: 'Phone', width: 130 },
  { key: 'email', label: 'Email', width: 200 },
  { key: 'open_balance', label: 'Open Balance', width: 130, numeric: true },
  { key: 'status', label: 'Status', width: 80 },
  { key: '_actions', label: 'Actions', width: 220 },
];

const PAYMENT_TERMS = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days'];

export default function CustomersPage() {
  const { get, post, put } = useApi();
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { canEdit } = useAuth();

  const [customers,  setCustomers]  = useState([]);
  const [summary,    setSummary]    = useState({ total_receivables: 0, overdue: 0, received_last_30: 0 });
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [page,       setPage]       = useState(1);
  const [filters,    setFilters]    = usePersistedFilters('customers_filters', {});
  const totalPages   = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const debounceRef  = useRef(null);
  const colMgr = useColumnManager({ columns: CUSTOMER_COLUMNS, storageKey: 'customers_cols', mandatoryKeys: ['_actions'] });
  const resizeCleanupRef = useRef(null);
  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  const handleFetchExportRows = useCallback(async () => {
    return customers.map(c =>
      colMgr.getExportCols().map(col => {
        switch (col.key) {
          case 'code': return c.code;
          case 'name': return c.name;
          case 'phone': return c.phone || '';
          case 'email': return c.email || '';
          case 'open_balance': return `₹${Math.round(Number(c.open_balance) || 0).toLocaleString('en-IN')}`;
          case 'status': return c.status;
          default: return '';
        }
      })
    );
  }, [customers, colMgr]);

  const [showModal,  setShowModal]  = useState(false);
  const [editingId,  setEditingId]  = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);

  const loadData = useCallback(async (pg, flt) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, pageSize: PAGE_SIZE });
      if (flt.search) params.set('search', flt.search);
      if (flt.status) params.set('status', flt.status);
      const [cRes, sRes] = await Promise.all([
        get(`/api/customers?${params}`),
        get('/api/customers/summary'),
      ]);
      setCustomers(cRes.data || []);
      setTotal(cRes.total || 0);
      setSummary(sRes || { total_receivables: 0, overdue: 0, received_last_30: 0 });
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadData(page, filters), filters.search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [page, filters, loadData]);

  const handleFilterChange = (key, value) => { setPage(1); setFilters(p => ({ ...p, [key]: value })); };
  const handleFilterReset  = () => { setPage(1); setFilters({}); };

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await loadData(page, filters); } finally { setSpinning(false); }
  }, [loadData, page, filters]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (c, e) => {
    e.stopPropagation();
    setEditingId(c.id);
    setForm({
      code: c.code || '', name: c.name || '',
      contact_person: c.contact_person || '', phone: c.phone || '', email: c.email || '',
      address: c.address || '', city: c.city || '', state: c.state || '',
      gstin: c.gstin || '', pan: c.pan || '',
      payment_term: c.payment_term || '30 Days',
      credit_limit: c.credit_limit || 0, status: c.status || 'active',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Customer name is required');
    setSaving(true);
    try {
      if (editingId) {
        await put(`/api/customers/${editingId}`, form);
        toast.success('Customer updated');
      } else {
        await post('/api/customers', form);
        toast.success('Customer created');
      }
      setShowModal(false);
      loadData(page, filters);
    } catch (err) {
      toast.error(err.message || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const summaryCards = [
    { label: 'Total Receivables',    value: fmt(summary.total_receivables), bg: '#E3F2FD', c: '#1565C0', icon: <AlertCircle size={15} /> },
    { label: 'Overdue Amount',        value: fmt(summary.overdue),           bg: '#FFF3E0', c: '#E65100', icon: <Clock size={15} />        },
    { label: 'Received (Last 30 Days)', value: fmt(summary.received_last_30), bg: '#E8F5E9', c: '#2E7D32', icon: <CheckCircle size={15} />  },
  ];

  const fromRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toRow   = Math.min(page * PAGE_SIZE, total);

  const { page: clientPage, setPage: setClientPage, paginatedItems, totalPages: clientTotalPages, pageSize: clientPageSize } = usePagination(customers, []);

  return (
    <div className="grid-page animate-in">

      {/* ── Toolbar ── */}
      <div className="grid-toolbar">
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
          <span className="grid-count">
            {total === 0 ? 'No records' : `${fromRow}–${toRow} of ${total.toLocaleString()}`}
          </span>
          {canEdit() && (
            <button className="btn btn-primary btn-sm" onClick={openNew}>
              <Plus size={13} /> New Customer
            </button>
          )}
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <FilterBar filters={filters} onChange={handleFilterChange} onReset={handleFilterReset} fields={FILTER_FIELDS}>
        <span className="grid-count" style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--g500)' }}>{(total || customers.length || 0).toLocaleString()} records</span>
        <ColumnSettings
          columns={colMgr.columns}
          visibleColumns={colMgr.visibleColumns}
          toggleColumn={colMgr.toggleColumn}
          resetLayout={colMgr.resetLayout}
          mandatoryKeys={['_actions']}
        />
        <ExportMenu
          title="Customers"
          headers={(colMgr.getExportCols?.() || []).map(c => c.label)}
          fetchRows={handleFetchExportRows}
        />
        <button className="icon-btn" title="Refresh table" onClick={handleRefresh} disabled={spinning}
          style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
          <RefreshCw size={14} />
        </button>
      </FilterBar>

      {/* ── Table ── */}
      <div className="grid-wrap">
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : customers.length === 0 ? (
          <div className="empty-state">
            <Users size={38} />
            <p>No customers found.</p>
            {canEdit() && !filters.search && (
              <button className="btn btn-primary" onClick={openNew}><Plus size={14} /> Add First Customer</button>
            )}
          </div>
        ) : (
          <table className="dgrid">
            <thead><tr>
              {colMgr.visibleColumns.map(col => (
                <th key={col.key} data-col-key={col.key} style={{
                  width: col.width,
                  minWidth: col.width,
                  maxWidth: col.width,
                  position: 'relative',
                  ...(col.numeric ? { textAlign: 'right' } : {}),
                }}>
                  {col.label}
                  <div
                    className="col-resize-handle"
                    onMouseDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startX = e.clientX;
                      const startW = col.width;
                      const onMove = ev => colMgr.setWidth(col.key, Math.max(60, startW + (ev.clientX - startX)));
                      const onUp = () => {
                        resizeCleanupRef.current = null;
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                      };
                      resizeCleanupRef.current = onUp;
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                      document.body.style.cursor = 'col-resize';
                      document.body.style.userSelect = 'none';
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      const tbl = e.currentTarget.closest('table');
                      if (tbl) colMgr.autoFitWidth(col.key, tbl);
                    }}
                  />
                </th>
              ))}
            </tr></thead>
            <tbody>
              {paginatedItems.map(c => (
                <tr key={c.id} onDoubleClick={() => { openTab({ id: `/customers/${c.id}`, name: c.name, path: `/customers/${c.id}`, closable: true }); navigate(`/customers/${c.id}`); }} style={{ cursor: 'pointer' }}>
                  {colMgr.visibleColumns.map(col => {
                    switch (col.key) {
                      case 'code':
                        return <td key={col.key} data-col-key={col.key} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)' }}>{c.code}</td>;
                      case 'name':
                        return <td key={col.key} data-col-key={col.key} style={{ fontWeight: 500, color: 'var(--brand-dark)' }}>{c.name}</td>;
                      case 'phone':
                        return <td key={col.key} data-col-key={col.key}>{c.phone || '—'}</td>;
                      case 'email':
                        return <td key={col.key} data-col-key={col.key} style={{ color: 'var(--g600)' }}>{c.email || '—'}</td>;
                      case 'open_balance':
                        return <td key={col.key} data-col-key={col.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: c.open_balance > 0 ? 600 : 400, color: c.open_balance > 0 ? '#1565C0' : 'var(--g500)' }}>{fmt(c.open_balance)}</td>;
                      case 'status':
                        return <td key={col.key} data-col-key={col.key}><span className={`badge b-${c.status}`}>{c.status}</span></td>;
                      case '_actions':
                        return (
                          <td key={col.key} data-col-key={col.key} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm btn-primary" onClick={() => navigate('/invoices/new')}>Invoice</button>
                              <button className="btn btn-sm" onClick={() => { openTab({ id: '/receipts/new', name: 'New Receipt', path: '/receipts/new', closable: true }); navigate('/receipts/new', { state: { customer_id: c.id, customer_name: c.name } }); }}>Receive</button>
                              <button className="btn btn-sm" onClick={() => { openTab({ id: `/customers/${c.id}`, name: c.name, path: `/customers/${c.id}`, closable: true }); navigate(`/customers/${c.id}`); }}>View</button>
                              {canEdit() && <button className="btn btn-sm" onClick={e => openEdit(c, e)}>Edit</button>}
                            </div>
                          </td>
                        );
                      default:
                        return <td key={col.key} data-col-key={col.key}>—</td>;
                    }
                  })}
                </tr>
              ))}
            </tbody>
          <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{customers.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {customers.length === 0 ? 0 : (clientPage - 1) * clientPageSize + 1} to {Math.min(clientPage * clientPageSize, customers.length)} of {customers.length} records</span>
                <Paginator page={clientPage} totalPages={clientTotalPages} onPage={setClientPage} />
              </div>
            )}
</td></tr></tfoot>
</table>

        )}
      </div>

      {/* ── Paginator ── */}
      {!loading && total > PAGE_SIZE && (
        <Paginator page={page} totalPages={totalPages} onPage={p => { setPage(p); window.scrollTo(0, 0); }} />
      )}

      {/* ── Customer create/edit modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal modal-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{editingId ? 'Edit Customer' : 'New Customer'}</h3>
              <button className="icon-btn" onClick={() => setShowModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="fg">
                  <label>Code</label>
                  <input
                    value={form.code}
                    onChange={e => f('code', e.target.value)}
                    placeholder={editingId ? '' : 'Auto-generated if left blank'}
                    disabled={!!editingId}
                    style={editingId ? { background: 'var(--g100)' } : {}}
                  />
                </div>
                <div className="fg w">
                  <label>Customer Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full customer name" />
                </div>
              </div>

              <div className="form-row">
                <div className="fg">
                  <label>Payment Term</label>
                  <SelectDropdown value={form.payment_term} onChange={e => f('payment_term', e.target.value)}>
                    {PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Credit Limit (₹)</label>
                  <input
                    type="number" min="0" step="1000"
                    value={form.credit_limit}
                    onChange={e => f('credit_limit', e.target.value)}
                  />
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
                <div className="fg">
                  <label>Contact Person</label>
                  <input value={form.contact_person} onChange={e => f('contact_person', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Phone</label>
                  <input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+91 XXXXX XXXXX" />
                </div>
                <div className="fg">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => f('email', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <div className="fg w">
                  <label>Address</label>
                  <input value={form.address} onChange={e => f('address', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <div className="fg">
                  <label>City</label>
                  <input value={form.city} onChange={e => f('city', e.target.value)} />
                </div>
                <div className="fg">
                  <label>State</label>
                  <input value={form.state} onChange={e => f('state', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <div className="fg">
                  <label>GSTIN</label>
                  <input value={form.gstin} onChange={e => f('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" />
                </div>
                <div className="fg">
                  <label>PAN</label>
                  <input value={form.pan} onChange={e => f('pan', e.target.value)} placeholder="AAAAA0000A" />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update Customer' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import DataGrid from '../../../shared/components/DataGrid';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { Plus, Receipt, X, Save, Trash2, Edit, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, NotesAttachmentsPanel
} from '../../../core/layout';
import DatePicker from '../../../shared/components/DatePicker';

const BILL_PAGE_SIZE = 500;
const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const newLine = () => ({ expense_account_id: '', description: '', amount: '', tax_pct: '', department_id: '', cost_center_id: '' });

const STATUS_OPTIONS = [
  { value: 'open',      label: 'Open' },
  { value: 'cancelled', label: 'Cancelled' },
];

// ─────────────────────────────────────────────────────────────────────────────
// VendorBillsPage - List View
// ─────────────────────────────────────────────────────────────────────────────

export const VendorBillsPage = () => {
  const api = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('vendorbills_filters', {});
  const debRef = useRef(null);

  const loadBills = useRef((pg, flt) => {
    setLoading(true);
    const params = new URLSearchParams({ page: pg, pageSize: BILL_PAGE_SIZE });
    if (flt.search) params.set('search', flt.search);
    if (flt.status) params.set('status', flt.status);
    
    api.get(`/api/expense-bills?${params.toString()}`)
      .then(r => { setData(r.data || []); setTotal(r.total || 0); })
      .catch(err => console.error('Failed to load bills:', err))
      .finally(() => setLoading(false));
  });

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => loadBills.current(page, filters), 0);
    return () => clearTimeout(debRef.current);
  }, [page, filters]);

  const handleFilterChange = (k, v) => { setPage(1); setFilters(p => ({ ...p, [k]: v })); };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to completely delete this bill? This action cannot be undone.')) return;
    setLoading(true);
    try {
      await api.delete(`/api/expense-bills/${id}`);
      toast.success('Bill deleted successfully');
      loadBills.current(page, filters);
    } catch (err) {
      toast.error(err.message || 'Failed to delete bill');
      setLoading(false);
    }
  };

  const filterFields = useMemo(() => [
    { key: 'search', label: 'Search by Bill No or Vendor', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  ], []);

  const actions = useMemo(() => (
    <button type="button" className="btn btn-primary" onClick={() => navigate('/bills/new')}>
      <Plus size={13} /> New Bill
    </button>
  ), [navigate]);

  return (
    <div className="grid-page">
      <DataGrid
        exportTitle="Vendor Bills"
        hideExportLabel
        storageKey="vendor_bills_cols"
        columns={[
          { key: 'doc_number', label: 'Bill No', width: 110, sticky: true, render: (v, r) => <Link to={`/bills/${r.id}`} className="cell-link">{v}</Link> },
          { key: 'doc_date',   label: 'Date',    width: 90,  render: v => fmtDate(v) },
          { key: 'vendor_name',label: 'Vendor',  width: 180 },
          { key: 'grand_total',label: 'Amount (₹)', width: 110, numeric: true, render: v => `₹${fmt(v)}` },
          { key: 'status',     label: 'Status',  width: 100, render: (v, r) => {
            const isCan = v === 'cancelled';
            const statusLabel = isCan ? 'CANCELLED' : r.payment_status || 'OPEN';
            const colorClass = isCan ? 'b-cancelled' : 
                               statusLabel === 'PAID' ? 'b-posted' : 'b-draft';
            return <span className={colorClass}>{statusLabel}</span>;
          }},
          { key: 'actions',    label: 'Actions', width: 90, render: (_, r) => (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); navigate(`/bills/${r.id}`); }} title="Edit">
                <Edit size={14} />
              </button>
              <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          )}
        ]}
        data={data}
        total={total}
        page={page}
        pageSize={BILL_PAGE_SIZE}
        onPageChange={setPage}
        filters={filters}
        filterFields={filterFields}
        onFilterChange={handleFilterChange}
        loading={loading}
        onRefresh={() => loadBills.current(page, filters)}
        toolbarActions={actions}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// QuickCreateVendorModal
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_VENDOR = {
  name: '', code: '', category: 'general', contact_person: '',
  phone: '', email: '', address: '', city: 'Surat', state: 'Gujarat',
  gstin: '', pan: '', payment_term: 'Immediate', bank_details: '', status: 'active',
};
const VENDOR_CATEGORIES = ['seed', 'gas', 'consumable', 'general'];
const VENDOR_PAYMENT_TERMS = ['Immediate', '7 Days', '15 Days', '30 Days', '60 Days'];

const QuickCreateVendorModal = ({ onClose, onCreated, api }) => {
  const [form, setForm] = useState(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Vendor name is required'); return; }
    setSaving(true);
    try {
      const created = await api.post('/api/vendors', form);
      toast.success('Vendor created');
      onCreated(created);
    } catch (err) {
      toast.error(err.message || 'Failed to create vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><ShoppingCart size={16} /> New Vendor</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="fg">
              <label>Code</label>
              <input value={form.code} onChange={e => f('code', e.target.value)} placeholder="Auto-generated if blank" />
            </div>
            <div className="fg w">
              <label>Vendor Name *</label>
              <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full vendor name" autoFocus />
            </div>
          </div>
          <div className="form-row">
            <div className="fg">
              <label>Category</label>
              <SelectDropdown value={form.category} onChange={e => f('category', e.target.value)}>
                {VENDOR_CATEGORIES.map(o => <option key={o} value={o}>{o}</option>)}
              </SelectDropdown>
            </div>
            <div className="fg">
              <label>Payment Term</label>
              <SelectDropdown value={form.payment_term} onChange={e => f('payment_term', e.target.value)}>
                {VENDOR_PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
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
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Create Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// VendorBillForm - Create/View/Cancel
// ─────────────────────────────────────────────────────────────────────────────

export const VendorBillForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const isEdit = !!id;

  const [form, setForm] = useState({
    doc_date: new Date().toISOString().split('T')[0],
    vendor_id: '', department_id: '', cost_center_id: '', reference_no: '', remark: ''
  });
  const [lines, setLines] = useState([newLine()]);
  const [vendors, setVendors] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [showVendorModal, setShowVendorModal] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/vendors?limit=1000').then(res => setVendors(res.data || [])),
      api.get('/api/accounts?status=active&is_group=false').then(res => setAccounts((Array.isArray(res) ? res : (res?.data || [])).filter(a => a.is_posting && a.type?.toLowerCase() === 'expense'))),
      api.get('/api/departments?limit=1000').then(res => setDepartments(res.data || [])),
      api.get('/api/cost-centers?limit=1000').then(res => setCostCenters(res.data || []))
    ]).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (isEdit) {
      api.get(`/api/expense-bills/${id}`).then(d => {
        setDetailData(d);
        setForm({
          doc_date: d.doc_date.split('T')[0],
          vendor_id: d.vendor_id || '', department_id: d.department_id || '',
          cost_center_id: d.cost_center_id || '', reference_no: d.reference_no || '', remark: d.remark || '',
          doc_number: d.doc_number, status: d.status, payment_status: d.payment_status
        });
        if (d.lines && d.lines.length > 0) {
          setLines(d.lines.map(l => ({
            expense_account_id: l.expense_account_id || '', description: l.description || '',
            amount: l.amount || '', tax_pct: l.tax_pct || '', department_id: l.department_id || '', cost_center_id: l.cost_center_id || ''
          })));
        } else {
           setLines([]);
        }
      }).catch(() => toast.error('Failed to load bill'));
    }
  }, [id, isEdit, api]);

  const updateLine = (idx, field, val) => {
    const arr = [...lines]; arr[idx][field] = val; setLines(arr);
  };
  const removeLine = idx => {
    if (lines.length > 1) setLines(lines.filter((_, i) => i !== idx));
    else setLines([newLine()]);
  };

  const { subtotal, taxTotal, grandTotal } = useMemo(() => {
    let s = 0, t = 0;
    lines.forEach(l => {
      const amt = parseFloat(l.amount) || 0;
      const pct = parseFloat(l.tax_pct) || 0;
      const tax = amt * (pct / 100);
      s += amt;
      t += tax;
    });
    return { subtotal: s, taxTotal: t, grandTotal: s + t };
  }, [lines]);

  const handleVendorCreated = (newVendor) => {
    setVendors(prev => [...prev, newVendor]);
    setForm(f => ({ ...f, vendor_id: String(newVendor.id) }));
    setShowVendorModal(false);
  };

  const handleSave = async () => {
    if (!form.doc_date || !form.vendor_id) return toast.error('Date and Vendor are required');
    const validLines = lines.filter(l => l.expense_account_id && parseFloat(l.amount) > 0);
    if (validLines.length === 0) return toast.error('At least one valid line is required (Category and Amount > 0)');

    setLoading(true);
    try {
      if (isEdit) {
        await api.put(`/api/expense-bills/${id}`, { ...form, lines: validLines });
        toast.success('Bill updated');
        navigate('/bills');
      } else {
        await api.post('/api/expense-bills', { ...form, lines: validLines });
        toast.success('Bill saved');
        navigate('/bills');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save bill');
    }
    setLoading(false);
  };

  const handleCancelBill = async () => {
    if (!window.confirm('Are you sure you want to cancel this bill?')) return;
    try {
      await api.delete(`/api/expense-bills/${id}`);
      toast.success('Bill cancelled');
      navigate('/bills');
    } catch (err) {
      toast.error(err.message || 'Failed to cancel bill');
    }
  };

  const modeBadge = isEdit ? { label: detailData?.status === 'cancelled' ? 'CANCELLED' : detailData?.payment_status || 'OPEN', className: detailData?.status === 'cancelled' ? 'b-cancelled' : 'b-draft' } : undefined;
  
  const vendorOpts = useMemo(() => vendors.map(v => ({ value: v.id, label: v.name })), [vendors]);
  const catOpts    = useMemo(() => accounts.map(a => ({ value: String(a.id), label: a.name })), [accounts]);
  const deptOpts   = useMemo(() => departments.map(d => ({ value: String(d.id), label: d.name })), [departments]);
  const ccOpts     = useMemo(() => costCenters.map(c => ({ value: String(c.id), label: c.name })), [costCenters]);

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={isEdit ? `Vendor Bill: ${form.doc_number}` : "New Vendor Bill"}
          icon={<Receipt size={18} />}
          badge={modeBadge}
          breadcrumbs={[
            { label: 'Purchase', href: '/bills' },
            { label: 'Vendor Bills', href: '/bills' },
            { label: isEdit ? form.doc_number : 'New Vendor Bill' },
          ]}
          backTo="/bills"
          backLabel="Vendor Bills"
          auditMeta={isEdit ? `Dated: ${fmtDate(form.doc_date)}` : (grandTotal > 0 ? `Total: ₹${fmt(grandTotal)}` : undefined)}
        />
      }
      footer={(!isEdit || detailData?.status !== 'cancelled') && (
        <StickyActionFooter
          left={<button className="btn" onClick={() => navigate('/bills')}>Cancel</button>}
          hint={grandTotal > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--g600)' }}>
              Vendor Bill &nbsp;·&nbsp; Total: <strong style={{ color: 'var(--brand-dark)', fontFamily: 'var(--mono)' }}>₹{fmt(grandTotal)}</strong>
            </span>
          ) : undefined}
          right={
            <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
              <Save size={13} /> {loading ? 'Posting...' : 'Save & Post JE'}
            </button>
          }
        />
      )}
    >
      <FormSectionCard title="Payment Details" icon={<Receipt size={13} />}>
        <div className="form-row">
          <div className="fg w" style={{ minWidth: 240 }}>
            <label>Vendor *</label>
            <SelectDropdown 
              value={String(form.vendor_id || '')} 
              onChange={e => {
                if (e.target.value === '__create_new__') {
                  setShowVendorModal(true);
                } else {
                  setForm({ ...form, vendor_id: e.target.value });
                }
              }}
              disabled={isEdit && detailData?.status === 'cancelled'} 
            >
              <option value="">- Select Vendor -</option>
              <option value="__create_new__" style={{ color: 'var(--brand)', fontWeight: 600 }}>+ Create New Vendor</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w" style={{ minWidth: 220 }}>
            <label>Department</label>
            <SelectDropdown 
              value={String(form.department_id || '')} 
              onChange={e => setForm({ ...form, department_id: e.target.value })} 
              disabled={isEdit && detailData?.status === 'cancelled'} 
            >
              <option value="">-- None --</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w" style={{ minWidth: 220 }}>
            <label>Cost Center</label>
            <SelectDropdown 
              value={String(form.cost_center_id || '')} 
              onChange={e => setForm({ ...form, cost_center_id: e.target.value })} 
              disabled={isEdit && detailData?.status === 'cancelled'} 
            >
              <option value="">-- None --</option>
              {costCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectDropdown>
          </div>
        </div>
        <div className="form-row">
          <div className="fg">
            <label>Date *</label>
            <DatePicker 
              value={form.doc_date} 
              onChange={v => setForm({ ...form, doc_date: v })} 
              disabled={isEdit && detailData?.status === 'cancelled'} 
            />
          </div>
          <div className="fg" style={{ minWidth: 180 }}>
            <label>Reference No</label>
            <input 
              value={form.reference_no} 
              onChange={e => setForm({ ...form, reference_no: e.target.value })} 
              disabled={isEdit && detailData?.status === 'cancelled'} 
            />
          </div>
        </div>
      </FormSectionCard>

      <FormSectionCard
        title="Expense Lines"
        icon={<Receipt size={13} />}
        noPad
        actions={
          (!isEdit || detailData?.status !== 'cancelled') && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {grandTotal > 0 && (
                <span style={{ fontSize: 11, color: 'var(--g600)', fontFamily: 'var(--mono)' }}>
                  ₹{fmt(grandTotal)}
                </span>
              )}
              <button className="btn btn-sm btn-primary" onClick={() => setLines([...lines, newLine()])}>
                <Plus size={11} /> Add Line
              </button>
            </div>
          )
        }
      >
        <table className="je-lines-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th style={{ minWidth: 160 }}>Category *</th>
              <th>Description</th>
              <th style={{ width: 110 }}>Department</th>
              <th style={{ width: 140 }}>Cost Center</th>
              <th style={{ width: 130, textAlign: 'right' }}>Amount (₹) *</th>
              <th style={{ width: 90, textAlign: 'right' }}>Tax %</th>
              <th style={{ width: 110, textAlign: 'right' }}>Tax Amount</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{idx + 1}</td>
                <td>
                  <SelectDropdown 
                    value={String(line.expense_account_id || '')} 
                    onChange={e => updateLine(idx, 'expense_account_id', e.target.value)} 
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  >
                    <option value="">- Select Category -</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <input 
                    value={line.description} 
                    onChange={e => updateLine(idx, 'description', e.target.value)} 
                    placeholder="What is this for?"
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  />
                </td>
                <td>
                  <SelectDropdown 
                    value={String(line.department_id || '')} 
                    onChange={e => updateLine(idx, 'department_id', e.target.value)} 
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  >
                    <option value="">Default</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <SelectDropdown 
                    value={String(line.cost_center_id || '')} 
                    onChange={e => updateLine(idx, 'cost_center_id', e.target.value)} 
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  >
                    <option value="">Default</option>
                    {costCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <input 
                    type="number" 
                    value={line.amount} 
                    onChange={e => updateLine(idx, 'amount', e.target.value)} 
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    style={{ textAlign: 'right' }} 
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  />
                </td>
                <td>
                  <input 
                    type="number" 
                    value={line.tax_pct} 
                    onChange={e => updateLine(idx, 'tax_pct', e.target.value)} 
                    placeholder="0"
                    min="0"
                    step="0.01"
                    style={{ textAlign: 'right' }} 
                    disabled={isEdit && detailData?.status === 'cancelled'} 
                  />
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--g700)', verticalAlign: 'middle', paddingRight: 10 }}>
                  {fmt((parseFloat(line.amount) || 0) * ((parseFloat(line.tax_pct) || 0) / 100))}
                </td>
                <td>
                  {(!isEdit || detailData?.status !== 'cancelled') && lines.length > 1 && (
                    <button className="icon-btn" onClick={() => removeLine(idx)} title="Remove line">
                      <X size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} style={{ textAlign: 'right', fontWeight: 500, paddingRight: 10, fontSize: 12, color: 'var(--g600)' }}>
                  Subtotal
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 12 }}>
                  ₹{fmt(subtotal)}
                </td>
                <td />
              </tr>
              {taxTotal > 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 500, paddingRight: 10, fontSize: 12, color: 'var(--g600)' }}>
                    GST
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 12 }}>
                    ₹{fmt(taxTotal)}
                  </td>
                  <td />
                </tr>
              )}
              <tr>
                <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>
                  Grand Total
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>
                  ₹{fmt(grandTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </FormSectionCard>

      <NotesAttachmentsPanel
        value={form.remark}
        onChange={e => setForm({ ...form, remark: e.target.value })}
      />

      {isEdit && detailData?.status !== 'cancelled' && (
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            className="btn" 
            style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={handleCancelBill}
          >
            Cancel Bill
          </button>
        </div>
      )}

      {showVendorModal && (
        <QuickCreateVendorModal
          api={api}
          onClose={() => setShowVendorModal(false)}
          onCreated={handleVendorCreated}
        />
      )}
    </TransactionPageLayout>
  );
};

import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import DataGrid from '../../../shared/components/DataGrid';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { Plus, Receipt, X, Save } from 'lucide-react';
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
const newLine = () => ({ expense_account_id: '', description: '', amount: '', department_id: '', cost_center_id: '' });

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
          }}
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
            amount: l.amount || '', department_id: l.department_id || '', cost_center_id: l.cost_center_id || ''
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

  const grandTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  const handleSave = async () => {
    if (!form.doc_date || !form.vendor_id) return toast.error('Date and Vendor are required');
    const validLines = lines.filter(l => l.expense_account_id && parseFloat(l.amount) > 0);
    if (validLines.length === 0) return toast.error('At least one valid line is required (Category and Amount > 0)');

    setLoading(true);
    try {
      if (isEdit) {
        toast.error('Editing bills is not supported. Please cancel and create a new one if necessary.');
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
      footer={!isEdit && (
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
              onChange={e => setForm({ ...form, vendor_id: e.target.value })} 
              disabled={isEdit} 
            >
              <option value="">- Select Vendor -</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w" style={{ minWidth: 220 }}>
            <label>Department</label>
            <SelectDropdown 
              value={String(form.department_id || '')} 
              onChange={e => setForm({ ...form, department_id: e.target.value })} 
              disabled={isEdit} 
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
              disabled={isEdit} 
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
              disabled={isEdit} 
            />
          </div>
          <div className="fg" style={{ minWidth: 180 }}>
            <label>Reference No</label>
            <input 
              value={form.reference_no} 
              onChange={e => setForm({ ...form, reference_no: e.target.value })} 
              disabled={isEdit} 
            />
          </div>
        </div>
      </FormSectionCard>

      <FormSectionCard
        title="Expense Lines"
        icon={<Receipt size={13} />}
        noPad
        actions={
          !isEdit && (
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
                    disabled={isEdit} 
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
                    disabled={isEdit} 
                  />
                </td>
                <td>
                  <SelectDropdown 
                    value={String(line.department_id || '')} 
                    onChange={e => updateLine(idx, 'department_id', e.target.value)} 
                    disabled={isEdit} 
                  >
                    <option value="">Default</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <SelectDropdown 
                    value={String(line.cost_center_id || '')} 
                    onChange={e => updateLine(idx, 'cost_center_id', e.target.value)} 
                    disabled={isEdit} 
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
                    disabled={isEdit} 
                  />
                </td>
                <td>
                  {!isEdit && lines.length > 1 && (
                    <button className="icon-btn" onClick={() => removeLine(idx)} title="Remove line">
                      <X size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>
                  Expense Total
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
    </TransactionPageLayout>
  );
};

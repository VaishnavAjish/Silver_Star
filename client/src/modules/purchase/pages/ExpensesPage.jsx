import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { useNavigate, Link } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import Modal from '../../../shared/components/Modal';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import CostCenterSelect from '../../../features/cost-center/CostCenterSelect';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, SummaryCardsRow, SideSummaryPanel,
  JournalPreviewPanel, NotesAttachmentsPanel,
} from '../../../core/layout';
import { useTabs } from '../../../core/tabs';
import DatePicker from '../../../shared/components/DatePicker';
import { Plus, Receipt, X, FileText, Save, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

const EXP_PAGE_SIZE = 500;
const today = () => new Date().toISOString().split('T')[0];
const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const newLine = () => ({ _id: Math.random(), category_id: '', description: '', amount: '', department_id: '', cost_center_id: '' });

const METHOD_OPTIONS = [
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Cash',          label: 'Cash' },
  { value: 'RTGS',          label: 'RTGS' },
  { value: 'NEFT',          label: 'NEFT' },
  { value: 'UPI',           label: 'UPI' },
  { value: 'Cheque',        label: 'Cheque' },
];
const STATUS_OPTIONS = [
  { value: 'PAID',    label: 'PAID' },
  { value: 'PENDING', label: 'PENDING' },
  { value: 'DRAFT',   label: 'DRAFT' },
];

// ─── Expense Detail Modal ────────────────────────────────────────────────────

function ExpenseDetailModal({ expenseId, onClose }) {
  const api = useApi();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!expenseId) return;
    setLoading(true);
    api.get(`/api/expenses/${expenseId}`)
      .then(d => setDetail(d))
      .catch(err => { toast.error(err.message || 'Failed to load expense'); onClose(); })
      .finally(() => setLoading(false));
  }, [expenseId]);

  const totalLines = detail?.lines?.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0) || 0;
  const totalAlloc = detail?.allocations?.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0) || 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={detail ? `Expense — ${detail.doc_number}` : 'Loading…'}
      icon={<Receipt size={15} style={{ marginRight: 6 }} />}
      large
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="spinner" />
        </div>
      ) : detail ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Header Meta ─────────────────────────────────────── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: '10px 20px',
            background: 'var(--g50)',
            border: '1px solid var(--g200)',
            borderRadius: 8,
            padding: '14px 18px',
          }}>
            {[
              { label: 'Document No',  value: detail.doc_number },
              { label: 'Date',         value: fmtDate(detail.date) },
              { label: 'Status',       value: (
                <span className={`badge ${detail.status === 'PAID' ? 'b-closed' : 'b-draft'}`}>{detail.status}</span>
              )},
              { label: 'Amount (₹)',   value: `₹${fmt(detail.amount)}` },
              { label: 'Payment Mode', value: detail.payment_mode || detail.paid_via || '—' },
              { label: 'Reference',    value: detail.reference_no || '—' },
              { label: 'Payee',        value: detail.vendor_name ? `${detail.vendor_name} (${detail.vendor_code})` : '— Direct Expense —' },
              { label: 'Bank / Cash',  value: detail.payment_account_name ? `${detail.payment_account_name} (${detail.payment_account_code})` : '—' },
              { label: 'Department',   value: detail.dept_name || '—' },
              { label: 'Journal Entry',value: detail.je_number || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--g900)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── Expense Lines ─────────────────────────────────────── */}
          {detail.lines?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Expense Lines
              </div>
              <table className="je-lines-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Department</th>
                    <th>Cost Center</th>
                    <th style={{ textAlign: 'right' }}>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line, i) => (
                    <tr key={line.id || i}>
                      <td style={{ textAlign: 'center', color: 'var(--g400)', fontSize: 11 }}>{i + 1}</td>
                      <td>{line.category_name || '—'}</td>
                      <td style={{ color: 'var(--g600)' }}>{line.description || '—'}</td>
                      <td style={{ color: 'var(--g600)' }}>{line.dept_name || '—'}</td>
                      <td style={{ color: 'var(--g600)' }}>{line.cost_center_name || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>₹{fmt(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {detail.lines.length > 1 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Total</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>₹{fmt(totalLines)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* ── Bill Allocations ──────────────────────────────────── */}
          {detail.allocations?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Applied to Bills
              </div>
              <table className="je-lines-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>Bill #</th>
                    <th>Bill Date</th>
                    <th style={{ textAlign: 'right' }}>Bill Total</th>
                    <th style={{ textAlign: 'right' }}>Amount Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.allocations.map((a, i) => (
                    <tr key={a.id || i}>
                      <td style={{ textAlign: 'center', color: 'var(--g400)', fontSize: 11 }}>{i + 1}</td>
                      <td>
                        <Link to={`/purchase-notes/${a.purchase_note_id}`} className="cell-link" target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {a.doc_number} <ExternalLink size={11} />
                        </Link>
                      </td>
                      <td style={{ color: 'var(--g600)' }}>{fmtDate(a.doc_date)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>₹{fmt(a.grand_total)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>₹{fmt(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Applied Total</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>₹{fmt(totalAlloc)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── Memo ─────────────────────────────────────────────── */}
          {detail.memo && (
            <div style={{ background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--g700)' }}>
              <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase' }}>Memo: </span>
              {detail.memo}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

// ─── List Page ──────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const api = useApi();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('expenses_filters', {});
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const debRef = useRef(null);
  const totalPages = Math.max(1, Math.ceil(total / EXP_PAGE_SIZE));

  // Detail modal state
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    api.get('/api/accounts?status=active&is_group=false')
       .then(r => setCategories((Array.isArray(r) ? r : (r?.data || [])).filter(a => a.is_posting && a.type?.toLowerCase() === 'expense')))
       .catch(() => {});
    api.get('/api/departments?limit=100').then(r => setDepartments(r.data || [])).catch(() => {});
  }, []);

  const loadExpenses = useRef((pg, flt) => {
    setLoading(true);
    const params = new URLSearchParams({ page: pg, pageSize: EXP_PAGE_SIZE });
    if (flt.category)   params.set('category',   flt.category);
    if (flt.method)     params.set('method',     flt.method);
    if (flt.department) params.set('department', flt.department);
    if (flt.status)     params.set('status',     flt.status);
    if (flt.date_from)  params.set('date_from',  flt.date_from);
    if (flt.date_to)    params.set('date_to',    flt.date_to);
    const qs = params.toString();
    api.get(`/api/expenses${qs ? '?' + qs : ''}`)
      .then(r => { setData(r.data || []); setTotal(r.total || 0); })
      .catch(err => console.error('Failed to load expenses:', err))
      .finally(() => setLoading(false));
  });

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => loadExpenses.current(page, filters), 0);
    return () => clearTimeout(debRef.current);
  }, [page, filters]);

  const handleFilterChange = (k, v) => { setPage(1); setFilters(p => ({ ...p, [k]: v })); };

  const fetchExportData = async () => {
    const params = new URLSearchParams({ limit: 100000, offset: 0 });
    if (filters.category)   params.set('category',   filters.category);
    if (filters.method)     params.set('method',     filters.method);
    if (filters.department) params.set('department', filters.department);
    if (filters.status)     params.set('status',     filters.status);
    if (filters.date_from)  params.set('date_from',  filters.date_from);
    if (filters.date_to)    params.set('date_to',    filters.date_to);
    const qs = params.toString();
    const r = await api.get(`/api/expenses${qs ? '?' + qs : ''}`);
    return r.data || [];
  };

  const filterFields = useMemo(() => [
    { key: 'category',   label: 'Category',   type: 'select',
      options: categories.map(c => ({ value: c.name, label: c.name })) },
    { key: 'method',     label: 'Method',     type: 'select', options: METHOD_OPTIONS },
    { key: 'department', label: 'Department', type: 'select',
      options: departments.map(d => ({ value: d.name, label: d.name })) },
    { key: 'status',     label: 'Status',     type: 'select', options: STATUS_OPTIONS },
    { key: 'date_from',  label: 'From Date',  type: 'date' },
    { key: 'date_to',    label: 'To Date',    type: 'date' },
  ], [categories, departments]);

  return (
    <div className="grid-page">
      <DataGrid
        exportTitle="Expenses"
        hideExportLabel
        fetchExportData={fetchExportData}
        storageKey="expenses_cols"
        columns={[
          { key: 'doc_number',    label: 'Exp ID',      width: 90,  sticky: true, render: v => <span className="cell-link">{v}</span> },
          { key: 'date',          label: 'Date',         width: 90,  render: v => v ? new Date(v).toLocaleDateString('en-IN') : '' },
          { key: 'vendor_name',   label: 'Payee',        width: 140 },
          { key: 'category_name', label: 'Category' },
          { key: 'description',   label: 'Description' },
          { key: 'amount',        label: 'Amount (₹)',   width: 110, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'payment_mode',  label: 'Method',       width: 100 },
          { key: 'dept_name',     label: 'Department',   width: 110 },
          { key: 'status',        label: 'Status',       width: 70,  render: v => <span className={`badge ${v === 'PAID' ? 'b-closed' : 'b-draft'}`}>{v}</span> },
        ]}
        data={data}
        totalRecords={total}
        loading={loading}
        filterFields={filterFields}
        filters={filters}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={EXP_PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        onRefresh={() => loadExpenses.current(page, filters)}
        onRowDoubleClick={row => setDetailId(row.id)}
        toolbarActions={
          canEdit() && (
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/expenses/new')}>
              <Plus size={13} /> New Record
            </button>
          )
        }
      />

      {detailId && (
        <ExpenseDetailModal
          expenseId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ─── Expense Form ────────────────────────────────────────────────────────────

export function ExpenseForm() {
  const api = useApi();
  const navigate = useNavigate();

  // Master data
  const [categories,  setCategories]  = useState([]);
  const [accounts,    setAccounts]    = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [depts,       setDepts]       = useState([]);
  const [costCenters, setCostCenters] = useState([]);

  // Vendor AP panel
  const [openBills,    setOpenBills]    = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);

  const [saving, setSaving] = useState(false);

  // Header form
  const [form, setForm] = useState({
    date:               today(),
    vendor_id:          '',
    payment_account_id: '',
    payment_mode:       'Bank Transfer',
    reference_no:       '',
    memo:               '',
  });

  // Expense lines (multi-line)
  const [lines, setLines] = useState([newLine()]);

  // Bill allocations (vendor mode)
  const [allocations, setAllocations] = useState([]);

  // ── Load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/accounts?status=active&is_group=false')
       .then(r => setCategories((Array.isArray(r) ? r : (r?.data || [])).filter(a => a.is_posting && a.type?.toLowerCase() === 'expense')))
       .catch(() => {});
    api.get('/api/accounts?is_group=false&status=active').then(r => setAccounts(Array.isArray(r) ? r : (r.data || []))).catch(() => {});
    api.get('/api/vendors?limit=300').then(r => setVendors(r.data || [])).catch(() => {});
    api.get('/api/departments?limit=100').then(r => setDepts(r.data || [])).catch(() => {});
    api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {});
  }, []);

  // ── Load open bills when vendor changes ──────────────────────────────────
  useEffect(() => {
    if (!form.vendor_id) { setOpenBills([]); setAllocations([]); return; }
    setLoadingBills(true);
    api.get(`/api/payments/open?vendor_id=${form.vendor_id}`)
      .then(r => setOpenBills(r?.data?.data || r?.data || []))
      .catch(err => { setOpenBills([]); toast.error(err?.message || 'Could not load bills'); })
      .finally(() => setLoadingBills(false));
  }, [form.vendor_id]);

  // ── Derived values ────────────────────────────────────────────────────────
  const bankAccounts  = accounts.filter(a => !a.is_group && a.status === 'active' &&
    (a.sub_type?.toLowerCase() === 'bank' || a.sub_type?.toLowerCase() === 'cash'));
  const hasVendor     = !!form.vendor_id;
  const allocatedIds  = useMemo(() => new Set(allocations.map(a => a.purchase_note_id)), [allocations]);
  const unappliedBills = openBills.filter(b => !allocatedIds.has(b.id));

  const expenseSum = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0), [lines]
  );
  const appliedToBills = useMemo(
    () => allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0), [allocations]
  );
  const totalPayment = Math.round((expenseSum + appliedToBills) * 100) / 100;
  const overAllocated = allocations.some(a => {
    const bill = openBills.find(b => b.id === a.purchase_note_id);
    return bill && parseFloat(a.amount) > parseFloat(bill.balance_due) + 0.005;
  });

  const selectedAccount = bankAccounts.find(a => String(a.id) === String(form.payment_account_id));

  // ── JE preview lines ─────────────────────────────────────────────────────
  const jePreviewLines = useMemo(() => {
    const result = [];
    for (const line of lines) {
      if ((parseFloat(line.amount) || 0) <= 0 || !line.category_id) continue;
      const cat = categories.find(c => String(c.id) === String(line.category_id));
      result.push({ account: cat?.name || 'Expense Account', dr: `₹${fmt(parseFloat(line.amount))}`, cr: '' });
    }
    if (appliedToBills > 0.005) {
      result.push({ account: 'Accounts Payable (3001)', dr: `₹${fmt(appliedToBills)}`, cr: '' });
    }
    if (totalPayment > 0.005) {
      result.push({ account: selectedAccount?.name || 'Payment Account', dr: '', cr: `₹${fmt(totalPayment)}` });
    }
    return result;
  }, [lines, categories, appliedToBills, totalPayment, selectedAccount]);

  // ── Summary cards (shown in aside when vendor selected) ──────────────────
  const summaryCards = useMemo(() => {
    const cards = [
      { label: 'Total Payment', value: totalPayment > 0 ? `₹${fmt(totalPayment)}` : '—', variant: totalPayment > 0 ? 'highlight' : undefined },
      { label: 'Expense Amount', value: `₹${fmt(expenseSum)}` },
      { label: 'Applied to Bills', value: `₹${fmt(appliedToBills)}` },
    ];
    if (overAllocated) cards.push({ label: 'Over-Allocated', value: '!', variant: 'danger', sub: 'Reduce allocation' });
    return cards;
  }, [totalPayment, expenseSum, appliedToBills, overAllocated]);

  // ── Line management ───────────────────────────────────────────────────────
  const addLine = () => setLines(p => [...p, newLine()]);
  const removeLine = id => setLines(p => p.filter(l => l._id !== id));
  const updateLine = (id, field, val) =>
    setLines(p => p.map(l => l._id === id ? { ...l, [field]: val } : l));

  // ── Bill allocation management ────────────────────────────────────────────
  const addBill = bill => {
    if (allocatedIds.has(bill.id)) return;
    setAllocations(p => [...p, {
      purchase_note_id: bill.id,
      doc_number:       bill.doc_number,
      doc_date:         bill.doc_date,
      grand_total:      parseFloat(bill.grand_total || 0),
      balance_due:      parseFloat(bill.balance_due || 0),
      amount:           String(parseFloat(bill.balance_due || 0).toFixed(2)),
    }]);
  };
  const addAllBills = () => {
    const toAdd = unappliedBills;
    if (!toAdd.length) return;
    setAllocations(p => [...p, ...toAdd.map(b => ({
      purchase_note_id: b.id,
      doc_number:       b.doc_number,
      doc_date:         b.doc_date,
      grand_total:      parseFloat(b.grand_total || 0),
      balance_due:      parseFloat(b.balance_due || 0),
      amount:           String(parseFloat(b.balance_due || 0).toFixed(2)),
    }))]);
  };
  const removeBillLine = idx => setAllocations(p => p.filter((_, i) => i !== idx));
  const updateBillAmount = (idx, val) =>
    setAllocations(p => p.map((a, i) => i === idx ? { ...a, amount: val } : a));

  // ── Validate & Save ───────────────────────────────────────────────────────
  const validate = () => {
    if (!form.date)               return 'Date is required';
    if (!form.payment_account_id) return 'Payment account is required';
    const validLines = lines.filter(l => parseFloat(l.amount) > 0);
    if (validLines.length === 0 && allocations.length === 0) return 'Add at least one expense line';
    for (const l of validLines) {
      if (!l.category_id) return 'Each expense line must have a category';
      if ((parseFloat(l.amount) || 0) <= 0) return 'Expense line amount must be > 0';
    }
    if (totalPayment <= 0) return 'Total payment must be greater than 0';
    if (overAllocated) return 'One or more bill allocations exceed outstanding amount';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setSaving(true);
    try {
      const validLines = lines.filter(l => parseFloat(l.amount) > 0 && l.category_id);
      const payload = {
        date:               form.date,
        vendor_id:          form.vendor_id || undefined,
        payment_account_id: form.payment_account_id,
        payment_mode:       form.payment_mode,
        reference_no:       form.reference_no || undefined,
        memo:               form.memo || undefined,
        lines:              validLines.map(l => ({
          category_id:   l.category_id,
          description:   l.description,
          amount:        parseFloat(l.amount),
          department_id: l.department_id || undefined,
          cost_center_id: l.cost_center_id || undefined,
        })),
        allocations: allocations.length > 0
          ? allocations.map(a => ({
              purchase_note_id: a.purchase_note_id,
              amount:           parseFloat(parseFloat(a.amount).toFixed(2)),
            }))
          : undefined,
      };
      const result = await api.post('/api/expenses', payload);
      toast.success(`Expense ${result.doc_number} posted! JE: ${result.je_number}`);
      navigate('/expenses');
    } catch (err) {
      toast.error(err.error || err.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const modeLabel = hasVendor ? 'Vendor Expense' : 'Direct Expense';
  const modeBadge = hasVendor
    ? { label: 'Vendor Expense', className: 'b-process' }
    : { label: 'Direct Expense', className: 'b-draft' };

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title="Record Expense"
          icon={<Receipt size={18} />}
          badge={modeBadge}
          breadcrumbs={[
            { label: 'Expenses', href: '/expenses' },
            { label: 'New Expense' },
          ]}
          backTo="/expenses"
          backLabel="Expenses"
          auditMeta={totalPayment > 0 ? `Total: ₹${fmt(totalPayment)}` : undefined}
        />
      }
      aside={
        hasVendor ? (
          <>
            <SummaryCardsRow cards={summaryCards} />

            <SideSummaryPanel
              title="Open Bills"
              actions={unappliedBills.length > 0 && (
                <button className="btn btn-sm btn-primary" onClick={addAllBills}>
                  <Plus size={11} /> Add all
                </button>
              )}
              maxHeight={320}
            >
              {loadingBills ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
                </div>
              ) : openBills.length === 0 ? (
                <div className="empty-state" style={{ padding: '20px 16px' }}>
                  <FileText size={26} />
                  <p>No open bills for this vendor</p>
                </div>
              ) : (
                openBills.map(bill => {
                  const isAdded = allocatedIds.has(bill.id);
                  return (
                    <div key={bill.id} className={`bill-card${isAdded ? ' bill-card-added' : ''}`}>
                      <div className="bill-card-num">{bill.doc_number}</div>
                      <div className="bill-card-date">{fmtDate(bill.doc_date)}</div>
                      <div className="bill-card-amt">₹{fmt(bill.balance_due)}</div>
                      <div className="bill-card-actions">
                        <button className={`btn btn-sm${isAdded ? '' : ' btn-primary'}`} onClick={() => addBill(bill)} disabled={isAdded}>
                          {isAdded ? 'Added' : 'Add'}
                        </button>
                        <Link to={`/purchase-notes/${bill.id}`} className="btn btn-sm" target="_blank" rel="noopener noreferrer">
                          Open
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </SideSummaryPanel>

            {jePreviewLines.length > 0 && (
              <JournalPreviewPanel title="Journal Entry Preview" lines={jePreviewLines} />
            )}
          </>
        ) : undefined
      }
      footer={
        <StickyActionFooter
          left={<button className="btn" onClick={() => navigate('/expenses')} disabled={saving}>Cancel</button>}
          hint={totalPayment > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--g600)' }}>
              {modeLabel} &nbsp;·&nbsp; Total: <strong style={{ color: 'var(--brand-dark)', fontFamily: 'var(--mono)' }}>₹{fmt(totalPayment)}</strong>
            </span>
          ) : undefined}
          right={
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || overAllocated}>
              <Save size={13} /> {saving ? 'Posting…' : 'Save & Post JE'}
            </button>
          }
        />
      }
    >
      {/* ── Payment Details ─────────────────────────────────────────────── */}
      <FormSectionCard title="Payment Details" icon={<Receipt size={13} />}>
        <div className="form-row">
          <div className="fg w" style={{ minWidth: 240 }}>
            <label>Payee (Vendor / optional)</label>
            <SelectDropdown
              value={form.vendor_id}
              onChange={e => { setForm(p => ({ ...p, vendor_id: e.target.value })); setAllocations([]); }}
            >
              <option value="">— No Payee (Direct Expense) —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w" style={{ minWidth: 220 }}>
            <label>Payment Account (Bank / Cash) *</label>
            <SelectDropdown
              value={form.payment_account_id}
              onChange={e => setForm(p => ({ ...p, payment_account_id: e.target.value }))}
            >
              <option value="">— Select Account —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </SelectDropdown>
          </div>
          {selectedAccount && (
            <div className="fg" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
              <span className="entry-balance-tag">Balance ₹{fmt(selectedAccount.balance || 0)}</span>
            </div>
          )}
        </div>
        <div className="form-row">
          <div className="fg">
            <label>Date *</label>
            <DatePicker value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} />
          </div>
          <div className="fg">
            <label>Payment Method</label>
            <SelectDropdown value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
              <option>Bank Transfer</option>
              <option>Cash</option>
              <option>RTGS</option>
              <option>NEFT</option>
              <option>UPI</option>
              <option>Cheque</option>
            </SelectDropdown>
          </div>
          <div className="fg" style={{ minWidth: 180 }}>
            <label>Reference / UTR No</label>
            <input
              value={form.reference_no}
              onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))}
              placeholder="UTR / Ref / Cheque no"
            />
          </div>
        </div>
      </FormSectionCard>

      {/* ── Expense Lines ────────────────────────────────────────────────── */}
      <FormSectionCard
        title="Expense Lines"
        icon={<Receipt size={13} />}
        noPad
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {expenseSum > 0 && (
              <span style={{ fontSize: 11, color: 'var(--g600)', fontFamily: 'var(--mono)' }}>
                ₹{fmt(expenseSum)}
              </span>
            )}
            <button className="btn btn-sm btn-primary" onClick={addLine}>
              <Plus size={11} /> Add Line
            </button>
          </div>
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
              <tr key={line._id}>
                <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{idx + 1}</td>
                <td>
                  <SelectDropdown
                    value={line.category_id}
                    onChange={e => updateLine(line._id, 'category_id', e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <input
                    value={line.description}
                    onChange={e => updateLine(line._id, 'description', e.target.value)}
                    placeholder="What is this for?"
                  />
                </td>
                <td>
                  <SelectDropdown value={line.department_id} onChange={e => updateLine(line._id, 'department_id', e.target.value)}>
                    <option value="">—</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </SelectDropdown>
                </td>
                <td>
                  <CostCenterSelect
                    value={line.cost_center_id}
                    onChange={v => updateLine(line._id, 'cost_center_id', v)}
                    costCenters={costCenters}
                    onRefresh={() => api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {})}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={line.amount}
                    onChange={e => updateLine(line._id, 'amount', e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    style={{ textAlign: 'right' }}
                  />
                </td>
                <td>
                  {lines.length > 1 && (
                    <button className="icon-btn" onClick={() => removeLine(line._id)} title="Remove line">
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
                  ₹{fmt(expenseSum)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </FormSectionCard>

      {/* ── Apply to Bills (vendor mode only, when allocations exist) ──── */}
      {hasVendor && allocations.length > 0 && (
        <FormSectionCard
          title="Applied to Bills"
          icon={<FileText size={13} />}
          noPad
          actions={
            <span style={{ fontSize: 11, color: 'var(--g500)', fontWeight: 400, textTransform: 'none' }}>
              {allocations.length} bill{allocations.length !== 1 ? 's' : ''} selected
            </span>
          }
        >
          <table className="je-lines-table entry-alloc-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Bill #</th>
                <th style={{ width: 100 }}>Bill Date</th>
                <th style={{ width: 120, textAlign: 'right' }}>Original</th>
                <th style={{ width: 120, textAlign: 'right' }}>Outstanding</th>
                <th style={{ width: 140, textAlign: 'right' }}>Amount to Pay *</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a, idx) => {
                const amt   = parseFloat(a.amount);
                const isOver = !isNaN(amt) && amt > a.balance_due + 0.005;
                return (
                  <tr key={a.purchase_note_id}>
                    <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{idx + 1}</td>
                    <td>
                      <Link to={`/purchase-notes/${a.purchase_note_id}`} className="cell-link" target="_blank" rel="noopener noreferrer">
                        {a.doc_number}
                      </Link>
                    </td>
                    <td style={{ color: 'var(--g600)' }}>{fmtDate(a.doc_date)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>₹{fmt(a.grand_total)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>₹{fmt(a.balance_due)}</td>
                    <td>
                      <input
                        type="number" value={a.amount} min="0.01" max={a.balance_due} step="0.01"
                        onChange={e => updateBillAmount(idx, e.target.value)}
                        style={{ textAlign: 'right', borderColor: isOver ? 'var(--red)' : undefined }}
                      />
                      {isOver && <div style={{ fontSize: 10, color: 'var(--red)' }}>Exceeds outstanding</div>}
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => removeBillLine(idx)} title="Remove"><X size={12} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Applied to Bills</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>₹{fmt(appliedToBills)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          <div style={{
            display: 'flex', gap: 20, padding: '9px 14px',
            background: 'var(--brand-50)', borderTop: '1px solid var(--g200)',
            fontSize: 12, alignItems: 'center', flexWrap: 'wrap',
          }}>
            {expenseSum > 0.005 && <span>Expense: <strong>₹{fmt(expenseSum)}</strong></span>}
            <span>Bills: <strong>₹{fmt(appliedToBills)}</strong></span>
            <span>Total: <strong>₹{fmt(totalPayment)}</strong></span>
            {overAllocated && (
              <span style={{ color: 'var(--red)', fontWeight: 600 }}>Over-allocated — reduce amounts above</span>
            )}
          </div>
        </FormSectionCard>
      )}

      {/* ── JE Preview (no-vendor mode, inline) ─────────────────────────── */}
      {!hasVendor && jePreviewLines.length > 0 && (
        <JournalPreviewPanel title="Journal Entry Preview" lines={jePreviewLines} />
      )}

      {/* ── Notes ────────────────────────────────────────────────────────── */}
      <NotesAttachmentsPanel
        value={form.memo}
        onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
      />
    </TransactionPageLayout>
  );
}

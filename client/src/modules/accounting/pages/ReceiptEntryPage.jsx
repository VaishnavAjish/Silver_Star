import { useState, useEffect } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DatePicker from '../../../shared/components/DatePicker';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { HandCoins, FileText, X, Plus, TrendingDown, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import CostCenterSelect from '../../../features/cost-center/CostCenterSelect';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, SummaryCardsRow, SideSummaryPanel, JournalPreviewPanel,
  NotesAttachmentsPanel,
} from '../../../core/layout';

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const newManualLine = () => ({ _id: Math.random(), account_id: '', description: '', cost_center_id: '', amount: '' });
const blankForm = () => ({
  date:            new Date().toISOString().split('T')[0],
  customer_id:     '',
  payment_mode:    'Bank Transfer',
  bank_account_id: '',
  reference_no:    '',
  cheque_no:       '',
  remark:          '',
  cost_center_id:  '',
});

export default function ReceiptEntryPage() {
  const api      = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { canEdit } = useAuth();

  const [customers,       setCustomers]       = useState([]);
  const [accounts,        setAccounts]        = useState([]);
  const [costCenters,     setCostCenters]     = useState([]);
  const [openInvoices,    setOpenInvoices]    = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [saving,          setSaving]          = useState(null); // null | 'stay' | 'close' | 'new'

  const [receiptAmount, setReceiptAmount] = useState('');
  const [form,          setForm]          = useState(blankForm());
  const [allocations,   setAllocations]   = useState([]);
  const [manualLines,   setManualLines]   = useState([newManualLine()]);

  // ── Master data ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/customers?limit=200').then(r => setCustomers(r.data || [])).catch(() => {});
    api.get('/api/accounts?is_group=false&status=active').then(r => setAccounts(Array.isArray(r) ? r : (r.data || []))).catch(() => {});
    api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {});
  }, []);

  // ── Pre-fill customer from navigation state (e.g. from Customers page Receive button) ──
  useEffect(() => {
    const state = location.state;
    if (state?.customer_id) {
      setForm(prev => ({ ...prev, customer_id: String(state.customer_id) }));
      // Clear the state so refreshing doesn't re-apply it
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // ── Open invoices when customer changes ────────────────────────────────────
  useEffect(() => {
    if (!form.customer_id) { setOpenInvoices([]); return; }
    setLoadingInvoices(true);
    api.get(`/api/receipts/open?customer_id=${form.customer_id}`)
      .then(r => setOpenInvoices(r?.data?.data || r?.data || []))
      .catch(err => { setOpenInvoices([]); toast.error(err?.message || 'Could not load open invoices'); })
      .finally(() => setLoadingInvoices(false));
  }, [form.customer_id]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const bankAccounts    = accounts.filter(a => !a.is_group && a.status === 'active' &&
    (a.sub_type?.toLowerCase() === 'bank' || a.sub_type?.toLowerCase() === 'cash'));
  const nonBankAccounts = accounts.filter(a => !a.is_group && a.status === 'active' &&
    a.sub_type?.toLowerCase() !== 'bank' && a.sub_type?.toLowerCase() !== 'cash');

  const allocatedIds      = new Set(allocations.map(a => a.invoice_id));
  const hasAllocations    = allocations.length > 0;

  const appliedToInvoices = allocations.reduce((s, a) => { const v = parseFloat(a.amount); return s + (isNaN(v) ? 0 : v); }, 0);
  const rcpAmt            = parseFloat(receiptAmount || 0);
  const advanceAmt        = Math.max(0, Math.round((rcpAmt - appliedToInvoices) * 100) / 100);
  const overAllocated     = appliedToInvoices > rcpAmt + 0.005;

  const activeManualLines = manualLines.filter(ml => ml.account_id && parseFloat(ml.amount) > 0);
  const manualLinesTotal  = activeManualLines.reduce((s, ml) => s + (parseFloat(ml.amount) || 0), 0);
  const manualOverAdvance = manualLinesTotal > advanceAmt + 0.005;
  const remainingAdvance  = Math.max(0, Math.round((advanceAmt - manualLinesTotal) * 100) / 100);

  const selectedAccount   = bankAccounts.find(a => String(a.id) === String(form.bank_account_id));
  const unappliedInvoices = openInvoices.filter(i => !allocatedIds.has(i.id));
  const showManualSection = !!form.customer_id;

  // ── JE preview (text) ──────────────────────────────────────────────────────
  const jePreview = (() => {
    const bankLabel = selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : 'Bank Account';
    if (!rcpAmt) return `Dr. ${bankLabel} → Cr. Accounts Receivable`;
    const crParts = [];
    if (appliedToInvoices > 0.005)
      crParts.push(`Cr. Accounts Receivable ₹${fmt(appliedToInvoices)}`);
    for (const ml of activeManualLines) {
      const acc = nonBankAccounts.find(a => String(a.id) === String(ml.account_id));
      crParts.push(`Cr. ${acc?.name || 'Account'} ₹${fmt(parseFloat(ml.amount))}`);
    }
    if (remainingAdvance > 0.005)
      crParts.push(`Cr. Customer Advance ₹${fmt(remainingAdvance)}`);
    if (!crParts.length) crParts.push('Cr. Customer Advance');
    return `Dr. ${bankLabel} ₹${fmt(rcpAmt)} → ${crParts.join(' + ')}`;
  })();

  // ── Summary cards ──────────────────────────────────────────────────────────
  const summaryCards = [
    { label: 'Receipt Amount',       value: rcpAmt > 0 ? `₹${fmt(rcpAmt)}` : '—', variant: rcpAmt > 0 ? 'highlight' : undefined },
    { label: 'Applied to Invoices',  value: `₹${fmt(appliedToInvoices)}` },
    {
      label: 'On-Account',
      value: `₹${fmt(advanceAmt)}`,
      variant: advanceAmt > 0.005 ? 'warn' : undefined,
      sub:    advanceAmt > 0.005 ? (activeManualLines.length > 0 ? 'manual posting' : 'customer advance') : undefined,
    },
  ];
  if (overAllocated)     summaryCards.push({ label: 'Over-Allocated', value: `₹${fmt(appliedToInvoices - rcpAmt)}`, variant: 'danger' });
  if (manualOverAdvance) summaryCards.push({ label: 'Manual Excess',  value: `₹${fmt(manualLinesTotal - advanceAmt)}`, variant: 'danger' });

  // ── Invoice allocation handlers ────────────────────────────────────────────
  const addInvoice = inv => {
    if (allocatedIds.has(inv.id)) return;
    setAllocations(prev => [...prev, {
      invoice_id: inv.id, doc_number: inv.doc_number, doc_date: inv.doc_date,
      grand_total: parseFloat(inv.grand_total || 0), balance_due: parseFloat(inv.balance_due || 0),
      amount: String(parseFloat(inv.balance_due || 0).toFixed(2)),
    }]);
  };
  const addAllInvoices = () => {
    const toAdd = unappliedInvoices;
    if (!toAdd.length) return;
    setAllocations(prev => [...prev, ...toAdd.map(i => ({
      invoice_id: i.id, doc_number: i.doc_number, doc_date: i.doc_date,
      grand_total: parseFloat(i.grand_total || 0), balance_due: parseFloat(i.balance_due || 0),
      amount: String(parseFloat(i.balance_due || 0).toFixed(2)),
    }))]);
  };
  const removeLine       = idx => setAllocations(prev => prev.filter((_, i) => i !== idx));
  const updateLineAmount = (idx, val) => setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, amount: val } : a));

  // ── Manual line handlers ───────────────────────────────────────────────────
  const addManualLine    = () => setManualLines(p => [...p, newManualLine()]);
  const removeManualLine = id => setManualLines(p => p.filter(l => l._id !== id));
  const updateManualLine = (id, field, val) =>
    setManualLines(p => p.map(l => l._id === id ? { ...l, [field]: val } : l));

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleBack = () => navigate(-1);

  // ── Reset for Save & New ───────────────────────────────────────────────────
  const resetForm = () => {
    setReceiptAmount('');
    setAllocations([]);
    setManualLines([newManualLine()]);
    setOpenInvoices([]);
    setForm(prev => ({
      ...prev,
      customer_id:    '',
      reference_no:   '',
      cheque_no:      '',
      remark:         '',
      cost_center_id: '',
      // keep: date, payment_mode, bank_account_id
    }));
  };

  // ── Validate ───────────────────────────────────────────────────────────────
  const validate = () => {
    if (!form.customer_id)     return 'Customer is required';
    if (!form.bank_account_id) return 'Deposit account is required';
    if (!form.date)            return 'Date is required';
    const amt = parseFloat(receiptAmount);
    if (isNaN(amt) || amt <= 0) return 'Receipt amount must be greater than 0';
    if (hasAllocations) {
      for (const a of allocations) {
        const lineAmt = parseFloat(a.amount);
        if (isNaN(lineAmt) || lineAmt <= 0) return `Amount must be > 0 for ${a.doc_number}`;
        if (lineAmt > a.balance_due + 0.005)
          return `₹${fmt(lineAmt)} exceeds outstanding ₹${fmt(a.balance_due)} for ${a.doc_number}`;
      }
      if (overAllocated)
        return `Invoice allocations ₹${fmt(appliedToInvoices)} exceed receipt amount ₹${fmt(amt)}`;
    }
    if (activeManualLines.length > 0) {
      for (const ml of activeManualLines) {
        if (!ml.account_id) return 'Select an account for each manual posting line';
        if ((parseFloat(ml.amount) || 0) <= 0) return 'Manual posting line amount must be > 0';
      }
      if (manualOverAdvance)
        return `Manual lines ₹${fmt(manualLinesTotal)} exceed on-account amount ₹${fmt(advanceAmt)}`;
    }
    return null;
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async (action) => {
    const err = validate();
    if (err) return toast.error(err);
    setSaving(action);
    try {
      const payload = {
        ...form,
        customer_id:     parseInt(form.customer_id),
        bank_account_id: parseInt(form.bank_account_id),
        amount:          parseFloat(parseFloat(receiptAmount).toFixed(2)),
      };
      if (hasAllocations) {
        payload.allocations = allocations.map(a => ({
          invoice_id: a.invoice_id,
          amount:     parseFloat(parseFloat(a.amount).toFixed(2)),
        }));
      }
      if (activeManualLines.length > 0) {
        payload.manual_lines = activeManualLines.map(ml => ({
          account_id:    parseInt(ml.account_id),
          description:   ml.description || undefined,
          cost_center_id: ml.cost_center_id ? parseInt(ml.cost_center_id) : undefined,
          amount:        parseFloat(parseFloat(ml.amount).toFixed(2)),
        }));
      }

      const result = await api.post('/api/receipts', payload);
      toast.success(editMode ? 'Receipt updated!' : 'Receipt posted!');
      if (action === 'new') {
        setForm(blankForm());
        setReceiptAmount('');
        setAllocations([]);
        setManualLines([newManualLine()]);
        if (editMode) navigate('/receipts/new');
      } else navigate('/receipts');
    } catch (err) {
      toast.error(err.message || 'Failed to save receipt');
    } finally {
      setSaving(null);
    }
  };

  if (!canEdit()) {
    return <div className="empty-state"><p>You do not have permission to create receipts.</p></div>;
  }

  const isSaving = !!saving;

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(allocations, []);

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title="New Receipt from Customer"
          icon={<HandCoins size={18} />}
          breadcrumbs={[
            { label: 'Accounting', href: '/receipts' },
            { label: 'Receipts',   href: '/receipts' },
            { label: 'New Receipt' },
          ]}
          backTo={handleBack}
          backLabel="Back"
        />
      }
      aside={
        <>
          <SummaryCardsRow cards={summaryCards} />

          <SideSummaryPanel
            title="Open Invoices"
            actions={unappliedInvoices.length > 0 && (
              <button className="btn btn-sm btn-primary" onClick={addAllInvoices}>
                <Plus size={11} /> Add all
              </button>
            )}
            maxHeight={360}
          >
            {!form.customer_id ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <FileText size={28} /><p>Select a customer to see open invoices</p>
              </div>
            ) : loadingInvoices ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
              </div>
            ) : openInvoices.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <FileText size={28} /><p>No open invoices for this customer</p>
              </div>
            ) : (
              openInvoices.map(inv => {
                const isAdded = allocatedIds.has(inv.id);
                return (
                  <div key={inv.id} className={`bill-card${isAdded ? ' bill-card-added' : ''}`}>
                    <div className="bill-card-num">{inv.doc_number}</div>
                    <div className="bill-card-date">{fmtDate(inv.doc_date)}</div>
                    <div className="bill-card-amt">₹{fmt(inv.balance_due)}</div>
                    <div className="bill-card-actions">
                      <button className={`btn btn-sm${isAdded ? '' : ' btn-primary'}`} onClick={() => addInvoice(inv)} disabled={isAdded}>
                        {isAdded ? 'Added' : 'Add'}
                      </button>
                      <Link to={`/invoices/${inv.id}`} className="btn btn-sm" target="_blank" rel="noopener noreferrer">Open</Link>
                    </div>
                  </div>
                );
              })
            )}
          </SideSummaryPanel>

          <JournalPreviewPanel text={jePreview} />
        </>
      }
      footer={
        <StickyActionFooter
          left={
            <button className="btn" onClick={handleBack} disabled={isSaving}>Cancel</button>
          }
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={() => handleSave('new')}
                disabled={isSaving}
                style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}
              >
                {isSaving ? 'Processing…' : 'Save & New'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleSave('close')}
                disabled={isSaving}
              >
                <Save size={13} /> {isSaving ? 'Processing…' : 'Save & Close'}
              </button>
            </div>
          }
        />
      }
    >
      {/* ── Receipt Details ── */}
      <FormSectionCard title="Receipt Details" icon={<HandCoins size={13} />}>
        <div className="form-row">
          <div className="fg w">
            <label>Customer *</label>
            <SelectDropdown value={form.customer_id} onChange={e => { setForm(p => ({ ...p, customer_id: e.target.value })); setAllocations([]); setManualLines([newManualLine()]); }}>
              <option value="">— Select Customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w">
            <label>Deposit To (Bank / Cash) *</label>
            <SelectDropdown value={form.bank_account_id} onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))}>
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
            <label>Receipt Date *</label>
            <DatePicker value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} />
          </div>
          <div className="fg">
            <label>Receipt Amount (₹) *</label>
            <input
              type="number" value={receiptAmount}
              onChange={e => setReceiptAmount(e.target.value)}
              placeholder="0.00" min="0.01" step="0.01"
              style={{ borderColor: overAllocated ? 'var(--red)' : undefined }}
            />
          </div>
          <div className="fg">
            <label>Payment Method</label>
            <SelectDropdown value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))}>
              <option>Cash</option><option>Bank Transfer</option><option>RTGS</option>
              <option>NEFT</option><option>UPI</option><option>Cheque</option>
            </SelectDropdown>
          </div>
          <div className="fg">
            <label>Ref No</label>
            <input value={form.reference_no} onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))} placeholder="UTR / Transaction ID" />
          </div>
          {form.payment_mode === 'Cheque' && (
            <div className="fg">
              <label>Cheque No</label>
              <input value={form.cheque_no} onChange={e => setForm(p => ({ ...p, cheque_no: e.target.value }))} />
            </div>
          )}
          <div className="fg">
            <label>Cost Center</label>
            <CostCenterSelect
              value={form.cost_center_id}
              onChange={v => setForm(p => ({ ...p, cost_center_id: v }))}
              costCenters={costCenters}
              onRefresh={() => api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {})}
            />
          </div>
        </div>
      </FormSectionCard>

      {/* ── Apply to Invoices ── */}
      <FormSectionCard
        title="Apply to Invoices"
        icon={<FileText size={13} />}
        noPad
        actions={hasAllocations && (
          <span style={{ fontSize: 11, color: 'var(--g500)', fontWeight: 400, textTransform: 'none' }}>
            {allocations.length} invoice{allocations.length !== 1 ? 's' : ''} selected
          </span>
        )}
      >
        {hasAllocations ? (
          <>
            <table className="je-lines-table entry-alloc-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Invoice #</th>
                  <th style={{ width: 100 }}>Date</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Invoice Total</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Outstanding</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Amount Received *</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((a, idx) => {
                  const amt    = parseFloat(a.amount);
                  const isOver = !isNaN(amt) && amt > a.balance_due + 0.005;
                  return (
                    <tr key={a.invoice_id}>
                      <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{idx + 1}</td>
                      <td>
                        <Link to={`/invoices/${a.invoice_id}`} className="cell-link" target="_blank" rel="noopener noreferrer">
                          {a.doc_number}
                        </Link>
                      </td>
                      <td style={{ color: 'var(--g600)' }}>{fmtDate(a.doc_date)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>₹{fmt(a.grand_total)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>₹{fmt(a.balance_due)}</td>
                      <td>
                        <input
                          type="number" value={a.amount} min="0.01" max={a.balance_due} step="0.01"
                          onChange={e => updateLineAmount(idx, e.target.value)}
                          style={{ textAlign: 'right', borderColor: isOver ? 'var(--red)' : undefined }}
                        />
                        {isOver && <div style={{ fontSize: 10, color: 'var(--red)' }}>Exceeds outstanding</div>}
                      </td>
                      <td>
                        <button className="icon-btn" onClick={() => removeLine(idx)} title="Remove"><X size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Applied to Invoices</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>₹{fmt(appliedToInvoices)}</td>
                  <td />
                </tr>
              </tfoot>
            <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{allocations.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {allocations.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, allocations.length)} of {allocations.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
</td></tr></tfoot>
</table>


            {rcpAmt > 0 && (
              <div style={{
                position: 'sticky', bottom: 0, zIndex: 10,
                display: 'flex', gap: 20, padding: '9px 14px',
                background: advanceAmt > 0.005 ? 'var(--brand-50)' : 'var(--g50)',
                borderTop: '1px solid var(--g200)', fontSize: 12, alignItems: 'center', flexWrap: 'wrap',
                boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
              }}>
                <span>Applied: <strong>₹{fmt(appliedToInvoices)}</strong></span>
                <span>Total: <strong>₹{fmt(rcpAmt)}</strong></span>
                {overAllocated && <span style={{ color: 'var(--red)', fontWeight: 600 }}>Over-allocated by ₹{fmt(appliedToInvoices - rcpAmt)}</span>}
                {advanceAmt > 0.005 && !overAllocated && (
                  <span style={{ color: 'var(--brand)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrendingDown size={12} /> On-account: ₹{fmt(advanceAmt)}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--g500)', fontSize: 13, padding: '14px 14px' }}>
            No invoices selected — add from the panel on the right, or post on-account using the section below.
          </div>
        )}
      </FormSectionCard>

      {/* ── Manual Posting Lines (on-account / advance) ── */}
      {showManualSection && (
        <FormSectionCard
          title="On-Account / Manual Posting"
          icon={<TrendingDown size={13} />}
          noPad
          actions={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {advanceAmt > 0.005 && (
                <span style={{ fontSize: 11, color: 'var(--g600)', fontFamily: 'var(--mono)' }}>
                  Unallocated: ₹{fmt(advanceAmt)}
                </span>
              )}
              <button className="btn btn-sm" onClick={addManualLine}><Plus size={11} /> Add Line</button>
            </div>
          }
        >
          {advanceAmt <= 0.005 && hasAllocations ? (
            <div style={{ color: 'var(--g500)', fontSize: 13, padding: '14px 14px' }}>
              All allocated to invoices — no on-account amount remaining.
            </div>
          ) : (
            <>
              <table className="je-lines-table entry-alloc-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>#</th>
                    <th style={{ minWidth: 180 }}>Posting Ledger</th>
                    <th>Description</th>
                    <th style={{ width: 140 }}>Cost Center</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Amount (₹)</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {manualLines.map((ml, idx) => {
                    const mlAmt  = parseFloat(ml.amount) || 0;
                    const isOver = mlAmt > 0 && manualOverAdvance;
                    return (
                      <tr key={ml._id}>
                        <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{idx + 1}</td>
                        <td>
                          <SelectDropdown value={ml.account_id} onChange={e => updateManualLine(ml._id, 'account_id', e.target.value)}>
                            <option value="">— Select Ledger —</option>
                            {nonBankAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
                          </SelectDropdown>
                        </td>
                        <td>
                          <input value={ml.description} onChange={e => updateManualLine(ml._id, 'description', e.target.value)} placeholder="Narration" />
                        </td>
                        <td>
                          <CostCenterSelect
                            value={ml.cost_center_id}
                            onChange={v => updateManualLine(ml._id, 'cost_center_id', v)}
                            costCenters={costCenters}
                            onRefresh={() => api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {})}
                          />
                        </td>
                        <td>
                          <input
                            type="number" value={ml.amount} min="0.01" step="0.01"
                            onChange={e => updateManualLine(ml._id, 'amount', e.target.value)}
                            placeholder="0.00"
                            style={{ textAlign: 'right', borderColor: isOver ? 'var(--red)' : undefined }}
                          />
                        </td>
                        <td>
                          {manualLines.length > 1 && (
                            <button className="icon-btn" onClick={() => removeManualLine(ml._id)} title="Remove"><X size={12} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {activeManualLines.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Manual Total</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: manualOverAdvance ? 'var(--red)' : undefined }}>
                        ₹{fmt(manualLinesTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>

              <div style={{
                display: 'flex', gap: 20, padding: '8px 14px',
                background: 'var(--g50)', borderTop: '1px solid var(--g200)',
                fontSize: 12, alignItems: 'center', flexWrap: 'wrap',
              }}>
                {activeManualLines.length > 0
                  ? <>
                      <span>Manual: <strong>₹{fmt(manualLinesTotal)}</strong></span>
                      {remainingAdvance > 0.005 && <span style={{ color: 'var(--brand)' }}>Remainder → Customer Advance: <strong>₹{fmt(remainingAdvance)}</strong></span>}
                      {manualOverAdvance && <span style={{ color: 'var(--red)', fontWeight: 600 }}>Exceeds on-account amount by ₹{fmt(manualLinesTotal - advanceAmt)}</span>}
                    </>
                  : <span style={{ color: 'var(--g400)' }}>Leave empty to use automatic Customer Advance account, or add lines above to post manually.</span>
                }
              </div>
            </>
          )}
        </FormSectionCard>
      )}

      {/* ── Notes ── */}
      <NotesAttachmentsPanel
        value={form.remark}
        onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
      />
    </TransactionPageLayout>
  );
}

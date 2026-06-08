import { useState, useEffect } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DatePicker from '../../../shared/components/DatePicker';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { CreditCard, FileText, X, Plus, TrendingUp } from 'lucide-react';
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
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const newManualLine = () => ({ _id: Math.random(), account_id: '', description: '', cost_center_id: '', amount: '' });
const blankForm = (vendorId = '') => ({
  date:            new Date().toISOString().split('T')[0],
  vendor_id:       vendorId,
  payment_mode:    'Bank Transfer',
  bank_account_id: '',
  reference_no:    '',
  cheque_no:       '',
  remark:          '',
  cost_center_id:  '',
});

export default function PaymentEntryPage() {
  const api      = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { canEdit } = useAuth();

  const fromVendorId = location.state?.vendor_id ? String(location.state.vendor_id) : '';

  const [vendors,      setVendors]      = useState([]);
  const [accounts,     setAccounts]     = useState([]);
  const [costCenters,  setCostCenters]  = useState([]);
  const [openBills,    setOpenBills]    = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [saving,       setSaving]       = useState(null); // null | 'stay' | 'close' | 'new'

  const [paymentAmount, setPaymentAmount] = useState('');
  const [form,          setForm]          = useState(blankForm(fromVendorId));
  const [allocations,   setAllocations]   = useState([]);
  const [manualLines,   setManualLines]   = useState([newManualLine()]);

  // ── Master data ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/vendors?limit=200').then(r => setVendors(r.data || [])).catch(() => {});
    api.get('/api/accounts?is_group=false&status=active').then(r => setAccounts(Array.isArray(r) ? r : (r.data || []))).catch(() => {});
    api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {});
  }, []);

  // ── Open bills when vendor changes ─────────────────────────────────────────
  useEffect(() => {
    if (!form.vendor_id) { setOpenBills([]); return; }
    setLoadingBills(true);
    api.get(`/api/payments/open?vendor_id=${form.vendor_id}`)
      .then(r => setOpenBills(r?.data?.data || r?.data || []))
      .catch(err => { setOpenBills([]); toast.error(err?.message || 'Could not load open bills'); })
      .finally(() => setLoadingBills(false));
  }, [form.vendor_id]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const bankAccounts    = accounts.filter(a => !a.is_group && a.status === 'active' &&
    (a.sub_type?.toLowerCase() === 'bank' || a.sub_type?.toLowerCase() === 'cash'));
  const nonBankAccounts = accounts.filter(a => !a.is_group && a.status === 'active' &&
    a.sub_type?.toLowerCase() !== 'bank' && a.sub_type?.toLowerCase() !== 'cash');

  const allocatedIds  = new Set(allocations.map(a => a.purchase_note_id));
  const hasAllocations = allocations.length > 0;

  const appliedToBills = allocations.reduce((s, a) => { const v = parseFloat(a.amount); return s + (isNaN(v) ? 0 : v); }, 0);
  const payAmt         = parseFloat(paymentAmount || 0);
  const advanceAmt     = Math.max(0, Math.round((payAmt - appliedToBills) * 100) / 100);
  const overAllocated  = appliedToBills > payAmt + 0.005;

  const activeManualLines  = manualLines.filter(ml => ml.account_id && parseFloat(ml.amount) > 0);
  const manualLinesTotal   = activeManualLines.reduce((s, ml) => s + (parseFloat(ml.amount) || 0), 0);
  const manualOverAdvance  = manualLinesTotal > advanceAmt + 0.005;
  const remainingAdvance   = Math.max(0, Math.round((advanceAmt - manualLinesTotal) * 100) / 100);

  const selectedAccount  = bankAccounts.find(a => String(a.id) === String(form.bank_account_id));
  const unappliedBills   = openBills.filter(b => !allocatedIds.has(b.id));
  const showManualSection = !!form.vendor_id;

  // ── JE preview (text) ──────────────────────────────────────────────────────
  const jePreview = (() => {
    const bankLabel = selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : 'Payment Account';
    if (!payAmt) return `Dr. Accounts Payable → Cr. ${bankLabel}`;
    const parts = [];
    if (appliedToBills > 0.005)
      parts.push(`Dr. Accounts Payable ₹${fmt(appliedToBills)}`);
    for (const ml of activeManualLines) {
      const acc = nonBankAccounts.find(a => String(a.id) === String(ml.account_id));
      parts.push(`Dr. ${acc?.name || 'Account'} ₹${fmt(parseFloat(ml.amount))}`);
    }
    if (remainingAdvance > 0.005)
      parts.push(`Dr. Vendor Advance ₹${fmt(remainingAdvance)}`);
    if (!parts.length) parts.push('Dr. Vendor Advance');
    return `${parts.join(' + ')} → Cr. ${bankLabel} ₹${fmt(payAmt)}`;
  })();

  // ── Summary cards ──────────────────────────────────────────────────────────
  const summaryCards = [
    { label: 'Payment Amount',     value: payAmt > 0 ? `₹${fmt(payAmt)}` : '—', variant: payAmt > 0 ? 'highlight' : undefined },
    { label: 'Applied to Bills',   value: `₹${fmt(appliedToBills)}` },
    {
      label: 'On-Account',
      value: `₹${fmt(advanceAmt)}`,
      variant: advanceAmt > 0.005 ? 'warn' : undefined,
      sub:    advanceAmt > 0.005 ? (activeManualLines.length > 0 ? 'manual posting' : 'vendor advance') : undefined,
    },
  ];
  if (overAllocated)     summaryCards.push({ label: 'Over-Allocated', value: `₹${fmt(appliedToBills - payAmt)}`, variant: 'danger' });
  if (manualOverAdvance) summaryCards.push({ label: 'Manual Excess',  value: `₹${fmt(manualLinesTotal - advanceAmt)}`, variant: 'danger' });

  // ── Bill allocation handlers ───────────────────────────────────────────────
  const addBill = bill => {
    if (allocatedIds.has(bill.id)) return;
    setAllocations(prev => [...prev, {
      purchase_note_id: bill.id, doc_number: bill.doc_number, doc_date: bill.doc_date,
      grand_total: parseFloat(bill.grand_total || 0), balance_due: parseFloat(bill.balance_due || 0),
      amount: String(parseFloat(bill.balance_due || 0).toFixed(2)),
    }]);
  };
  const addAllBills = () => {
    const toAdd = unappliedBills;
    if (!toAdd.length) return;
    setAllocations(prev => [...prev, ...toAdd.map(b => ({
      purchase_note_id: b.id, doc_number: b.doc_number, doc_date: b.doc_date,
      grand_total: parseFloat(b.grand_total || 0), balance_due: parseFloat(b.balance_due || 0),
      amount: String(parseFloat(b.balance_due || 0).toFixed(2)),
    }))]);
  };
  const removeLine      = idx => setAllocations(prev => prev.filter((_, i) => i !== idx));
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
    setPaymentAmount('');
    setAllocations([]);
    setManualLines([newManualLine()]);
    setOpenBills([]);
    setForm(prev => ({
      ...prev,
      vendor_id:      '',
      reference_no:   '',
      cheque_no:      '',
      remark:         '',
      cost_center_id: '',
      // keep: date, payment_mode, bank_account_id (useful for batch entry)
    }));
  };

  // ── Validate ───────────────────────────────────────────────────────────────
  const validate = () => {
    if (!form.vendor_id)       return 'Vendor is required';
    if (!form.bank_account_id) return 'Payment account is required';
    if (!form.date)            return 'Date is required';
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) return 'Payment amount must be greater than 0';
    if (hasAllocations) {
      for (const a of allocations) {
        const lineAmt = parseFloat(a.amount);
        if (isNaN(lineAmt) || lineAmt <= 0) return `Amount must be > 0 for ${a.doc_number}`;
        if (lineAmt > a.balance_due + 0.005)
          return `₹${fmt(lineAmt)} exceeds outstanding ₹${fmt(a.balance_due)} for ${a.doc_number}`;
      }
      if (overAllocated)
        return `Bill allocations ₹${fmt(appliedToBills)} exceed payment amount ₹${fmt(amt)}`;
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
        vendor_id:       parseInt(form.vendor_id),
        bank_account_id: parseInt(form.bank_account_id),
        amount:          parseFloat(parseFloat(paymentAmount).toFixed(2)),
      };
      if (hasAllocations) {
        payload.allocations = allocations.map(a => ({
          purchase_note_id: a.purchase_note_id,
          amount:           parseFloat(parseFloat(a.amount).toFixed(2)),
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

      const result = await api.post('/api/payments', payload);
      const adv = parseFloat(result.advance_amount || 0);
      toast.success(adv > 0.005
        ? `Payment ${result.doc_number} posted! On-account ₹${fmt(adv)}. JE: ${result.je_number}`
        : `Payment ${result.doc_number} posted! JE: ${result.je_number}`
      );

      if (action === 'close')     navigate(-1);
      else if (action === 'new')  resetForm();
      // 'stay': do nothing — form stays visible
    } catch (err) {
      toast.error(err.error || err.message || 'Failed to save payment');
    } finally {
      setSaving(null);
    }
  };

  if (!canEdit()) {
    return <div className="empty-state"><p>You do not have permission to create payments.</p></div>;
  }

  const isSaving = !!saving;

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(allocations, []);

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title="New Payment to Vendor"
          icon={<CreditCard size={18} />}
          breadcrumbs={[
            { label: 'Accounting', href: '/payments' },
            { label: 'Payments',   href: '/payments' },
            { label: 'New Payment' },
          ]}
          backTo={handleBack}
          backLabel="Back"
        />
      }
      aside={
        <>
          <SummaryCardsRow cards={summaryCards} />

          <SideSummaryPanel
            title="Open Bills"
            actions={unappliedBills.length > 0 && (
              <button className="btn btn-sm btn-primary" onClick={addAllBills}>
                <Plus size={11} /> Add all
              </button>
            )}
            maxHeight={360}
          >
            {!form.vendor_id ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <FileText size={28} /><p>Select a vendor to see open bills</p>
              </div>
            ) : loadingBills ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
              </div>
            ) : openBills.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <FileText size={28} /><p>No open bills for this vendor</p>
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
                      <Link to={`/purchase-notes/${bill.id}`} className="btn btn-sm" target="_blank" rel="noopener noreferrer">Open</Link>
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
            <>
              <button className="btn" onClick={() => handleSave('new')} disabled={isSaving}>
                {saving === 'new' ? 'Posting…' : 'Save & New'}
              </button>
              <button className="btn" onClick={() => handleSave('stay')} disabled={isSaving}>
                {saving === 'stay' ? 'Posting…' : 'Save'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={isSaving}>
                {saving === 'close' ? 'Posting…' : 'Save & Close'}
              </button>
            </>
          }
        />
      }
    >
      {/* ── Payment Details ── */}
      <FormSectionCard title="Payment Details" icon={<CreditCard size={13} />}>
        <div className="form-row">
          <div className="fg w">
            <label>Payee (Vendor) *</label>
            <SelectDropdown value={form.vendor_id} onChange={e => { setForm(p => ({ ...p, vendor_id: e.target.value })); setAllocations([]); setManualLines([newManualLine()]); }}>
              <option value="">— Select Vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </SelectDropdown>
          </div>
          <div className="fg w">
            <label>Payment Account (Bank / Cash) *</label>
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
            <label>Payment Date *</label>
            <DatePicker value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} />
          </div>
          <div className="fg">
            <label>Payment Amount (₹) *</label>
            <input
              type="number" value={paymentAmount}
              onChange={e => setPaymentAmount(e.target.value)}
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

      {/* ── Apply to Bills ── */}
      <FormSectionCard
        title="Apply to Bills"
        icon={<FileText size={13} />}
        noPad
        actions={hasAllocations && (
          <span style={{ fontSize: 11, color: 'var(--g500)', fontWeight: 400, textTransform: 'none' }}>
            {allocations.length} bill{allocations.length !== 1 ? 's' : ''} selected
          </span>
        )}
      >
        {hasAllocations ? (
          <>
            <table className="je-lines-table entry-alloc-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Bill #</th>
                  <th style={{ width: 100 }}>Date</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Original Amt</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Outstanding</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Amount to Pay *</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((a, idx) => {
                  const amt    = parseFloat(a.amount);
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
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, paddingRight: 10, fontSize: 12 }}>Applied to Bills</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>₹{fmt(appliedToBills)}</td>
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


            {payAmt > 0 && (
              <div style={{
                display: 'flex', gap: 20, padding: '9px 14px',
                background: advanceAmt > 0.005 ? 'var(--brand-50)' : 'var(--g50)',
                borderTop: '1px solid var(--g200)', fontSize: 12, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <span>Applied: <strong>₹{fmt(appliedToBills)}</strong></span>
                <span>Total: <strong>₹{fmt(payAmt)}</strong></span>
                {overAllocated && <span style={{ color: 'var(--red)', fontWeight: 600 }}>Over-allocated by ₹{fmt(appliedToBills - payAmt)}</span>}
                {advanceAmt > 0.005 && !overAllocated && (
                  <span style={{ color: 'var(--brand)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrendingUp size={12} /> On-account: ₹{fmt(advanceAmt)}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--g500)', fontSize: 13, padding: '14px 14px' }}>
            No bills selected — add from the panel on the right, or post on-account using the section below.
          </div>
        )}
      </FormSectionCard>

      {/* ── Manual Posting Lines (on-account / advance) ── */}
      {showManualSection && (
        <FormSectionCard
          title="On-Account / Manual Posting"
          icon={<TrendingUp size={13} />}
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
              All allocated to bills — no on-account amount remaining.
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
                      {remainingAdvance > 0.005 && <span style={{ color: 'var(--brand)' }}>Remainder → Vendor Advance: <strong>₹{fmt(remainingAdvance)}</strong></span>}
                      {manualOverAdvance && <span style={{ color: 'var(--red)', fontWeight: 600 }}>Exceeds on-account amount by ₹{fmt(manualLinesTotal - advanceAmt)}</span>}
                    </>
                  : <span style={{ color: 'var(--g400)' }}>Leave empty to use automatic Vendor Advance account, or add lines above to post manually.</span>
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

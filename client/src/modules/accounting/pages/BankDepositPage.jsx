import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DatePicker from '../../../shared/components/DatePicker';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import QuickCreateModal from '../../../features/quick-create/QuickCreateModal';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, SummaryCardsRow, SideSummaryPanel, JournalPreviewPanel,
  NotesAttachmentsPanel,
} from '../../../core/layout';

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAYMENT_METHODS = ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card', 'Other'];
const FROM_TYPES = [
  { value: 'customer', label: 'Customer' },
  { value: 'vendor',   label: 'Vendor'   },
  { value: 'other',    label: 'Other'    },
];

const emptyLine = () => ({
  received_from_type: 'customer',
  received_from_obj: null,
  party_name: '',
  account_obj: null,
  account_id: '',
  description: '',
  payment_method: 'Cash',
  ref_no: '',
  amount: '',
});

export default function BankDepositPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { id: depositId } = useParams();
  const editMode = !!depositId;
  const { canEdit } = useAuth();

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    bank_account_obj: null,
    bank_account_id: '',
    memo: '',
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [loadingDeposit, setLoadingDeposit] = useState(editMode);
  const [quickCreate, setQuickCreate] = useState(null);

  useEffect(() => {
    if (!editMode) return;
    setLoadingDeposit(true);
    api.get(`/api/bank-deposits/${depositId}`)
      .then(r => {
        const dep = r.data;
        if (dep.status === 'reversed' || dep.je_status === 'posted') {
          toast.error('Cannot edit a posted deposit. Reverse it first.');
          navigate(`/bank-deposits/${depositId}`);
          return;
        }
        setForm({
          date: dep.date ? dep.date.split('T')[0] : '',
          bank_account_obj: { id: dep.bank_account_id, name: dep.bank_account_name },
          bank_account_id: String(dep.bank_account_id),
          memo: dep.memo || '',
        });
        setLines(
          (dep.lines || []).length > 0
            ? dep.lines.map(l => ({
                received_from_type: l.received_from_type || 'customer',
                received_from_obj: l.received_from_id ? { id: l.received_from_id, name: l.party_name } : null,
                party_name: l.party_name || '',
                account_obj: { id: l.account_id, name: l.account_name, code: l.account_code },
                account_id: String(l.account_id),
                description: l.description || '',
                payment_method: l.payment_method || 'Cash',
                ref_no: l.ref_no || '',
                amount: String(l.amount),
              }))
            : [emptyLine()]
        );
      })
      .catch(err => { toast.error(err.message || 'Failed to load deposit'); navigate('/bank-deposits'); })
      .finally(() => setLoadingDeposit(false));
  }, [depositId]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchBankAccounts = useCallback(async (q) => {
    const r = await api.get(`/api/accounts/search?q=${encodeURIComponent(q)}&sub_types=bank,cash&limit=20`);
    return Array.isArray(r) ? r : [];
  }, [api]);

  const searchLineAccounts = useCallback(async (q) => {
    const r = await api.get(`/api/accounts/search?q=${encodeURIComponent(q)}&exclude_sub_types=bank,cash&limit=20`);
    return Array.isArray(r) ? r : [];
  }, [api]);

  const searchCustomers = useCallback(async (q) => {
    const r = await api.get(`/api/customers?search=${encodeURIComponent(q)}&status=active&limit=20`);
    return Array.isArray(r.data ? r.data : r) ? (r.data || r) : [];
  }, [api]);

  const searchVendors = useCallback(async (q) => {
    const r = await api.get(`/api/vendors?search=${encodeURIComponent(q)}&status=active&limit=20`);
    return Array.isArray(r.data ? r.data : r) ? (r.data || r) : [];
  }, [api]);

  const getPartySearch = useCallback((type) => {
    if (type === 'customer') return searchCustomers;
    if (type === 'vendor') return searchVendors;
    return null;
  }, [searchCustomers, searchVendors]);

  const addLine    = () => setLines(p => [...p, emptyLine()]);
  const removeLine = (i) => { if (lines.length > 1) setLines(p => p.filter((_, j) => j !== i)); };
  const clearAllLines = () => setLines([emptyLine()]);
  const updateLine = (i, patch) => setLines(p => p.map((l, j) => j === i ? { ...l, ...patch } : l));

  const handleFromTypeChange = (i, type) => updateLine(i, { received_from_type: type, received_from_obj: null, party_name: '' });
  const handlePartySelect = (i, obj) => updateLine(i, { received_from_obj: obj, party_name: obj ? obj.name : '' });
  const handleAccountSelect = (i, obj) => updateLine(i, { account_obj: obj, account_id: obj ? String(obj.id) : '' });
  const handleBankSelect = (obj) => setForm(p => ({ ...p, bank_account_obj: obj, bank_account_id: obj ? String(obj.id) : '' }));

  const total = useMemo(() => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0), [lines]);
  const isValid = useMemo(() => {
    if (!form.date || !form.bank_account_id) return false;
    return lines.some(l => l.account_id && parseFloat(l.amount) > 0);
  }, [form, lines]);

  const handleSubmit = async () => {
    if (!form.date)           { toast.error('Date is required'); return; }
    if (!form.bank_account_id){ toast.error('Bank account is required'); return; }
    const validLines = lines.filter(l => l.account_id && parseFloat(l.amount) > 0);
    if (!validLines.length)   { toast.error('At least one line with account and amount > 0 is required'); return; }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.account_id && !(parseFloat(l.amount) > 0)) { toast.error(`Line ${i + 1}: amount must be > 0`); return; }
    }
    const payload = {
      date: form.date, bank_account_id: form.bank_account_id, memo: form.memo,
      lines: validLines.map(l => ({
        received_from_type: l.received_from_type || null,
        received_from_id: l.received_from_obj?.id || null,
        party_name: l.party_name || null,
        account_id: l.account_id,
        description: l.description || null,
        amount: parseFloat(l.amount),
        payment_method: l.payment_method || null,
        ref_no: l.ref_no || null,
      })),
    };
    setSaving(true);
    try {
      if (editMode) {
        await api.put(`/api/bank-deposits/${depositId}`, payload);
        toast.success('Deposit updated');
      } else {
        const res = await api.post('/api/bank-deposits', payload);
        toast.success(`Deposit saved — ${res.je_number || 'JE posted'}`);
      }
      navigate('/bank-deposits');
    } catch (err) {
      toast.error(err.message || 'Failed to save bank deposit');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickCreated = (result) => {
    if (!quickCreate) return;
    const { type, lineIndex } = quickCreate;
    if (lineIndex === 'bank') {
      if (result.account || result.id) {
        const acc = result.account || result;
        handleBankSelect({ id: acc.id, name: acc.name, code: acc.code });
      }
    } else if (type === 'account') {
      handleAccountSelect(lineIndex, { id: result.id, name: result.name, code: result.code });
    } else {
      handlePartySelect(lineIndex, { id: result.id, name: result.name, code: result.code });
    }
    setQuickCreate(null);
  };

  if (loadingDeposit) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="spinner" />
        <p>Loading deposit…</p>
      </div>
    );
  }

  const validLineCount = lines.filter(l => parseFloat(l.amount) > 0).length;

  return (
    <>
      <TransactionPageLayout
        header={
          <TransactionHeader
            title={editMode ? 'Edit Bank Deposit' : 'New Bank Deposit'}
            icon={<Landmark size={18} />}
            breadcrumbs={[
              { label: 'Accounting', href: '/bank-deposits' },
              { label: 'Bank Deposits', href: '/bank-deposits' },
              { label: editMode ? 'Edit Deposit' : 'New Deposit' },
            ]}
            backTo="/bank-deposits"
            backLabel="Bank Deposits"
          />
        }
        aside={
          <>
            <SummaryCardsRow cards={[
              { label: 'Lines', value: validLineCount },
              { label: 'Total Amount', value: `₹${fmt(total)}`, variant: total > 0 ? 'highlight' : undefined },
            ]} />

            <SideSummaryPanel title="JE Preview">
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--g700)', lineHeight: 1.7 }}>
                <div><strong>Dr.</strong> {form.bank_account_obj?.name || 'Bank Account'}</div>
                <div style={{ color: 'var(--g500)', fontSize: 11, marginLeft: 12 }}>₹{fmt(total)}</div>
                {lines.filter(l => l.account_id).length > 0 && (
                  <>
                    <div style={{ marginTop: 6 }}><strong>Cr.</strong> {lines.filter(l => l.account_id).length} account(s)</div>
                    {lines.filter(l => l.account_id && parseFloat(l.amount) > 0).map((l, i) => (
                      <div key={i} style={{ color: 'var(--g500)', fontSize: 11, marginLeft: 12 }}>
                        {l.account_obj?.name || l.account_id} — ₹{fmt(l.amount)}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </SideSummaryPanel>

            {!isValid && (
              <div style={{
                background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 'var(--radius)',
                padding: '8px 12px', fontSize: 11, color: '#E65100',
              }}>
                {!form.bank_account_id ? '⚠ Select a bank account' :
                  !lines.some(l => l.account_id && parseFloat(l.amount) > 0)
                    ? '⚠ Add at least one line with account + amount'
                    : ''}
              </div>
            )}
          </>
        }
        footer={
          <StickyActionFooter
            left={
              <>
                <button className="btn" onClick={() => navigate('/bank-deposits')}>Cancel</button>
                <button className="btn" onClick={clearAllLines} disabled={!canEdit() || lines.length <= 1}>Clear Lines</button>
              </>
            }
            right={
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={saving || !canEdit() || !isValid}
              >
                {saving ? 'Saving…' : editMode ? 'Update Deposit' : 'Save & Post JE'}
              </button>
            }
          />
        }
      >
        {/* ── Deposit Header ── */}
        <FormSectionCard title="Deposit Details" icon={<Landmark size={13} />}>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="fg w">
              <label>Account (Bank / Cash) *</label>
              <SearchableSelect
                value={form.bank_account_obj}
                onChange={handleBankSelect}
                onSearch={searchBankAccounts}
                placeholder="Search bank/cash account…"
                disabled={!canEdit()}
                onAddNew={canEdit() ? () => setQuickCreate({ type: 'account', lineIndex: 'bank' }) : undefined}
                addNewLabel="+ Add New Bank Account"
              />
            </div>
            <div className="fg">
              <label>Date *</label>
              <DatePicker value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} disabled={!canEdit()} />
            </div>
            <div className="fg">
              <label>Currency</label>
              <SelectDropdown disabled style={{ background: 'var(--g100)', color: 'var(--g500)', cursor: 'not-allowed' }}>
                <option>INR — Indian Rupee</option>
              </SelectDropdown>
            </div>
          </div>
        </FormSectionCard>

        {/* ── Line Items ── */}
        <FormSectionCard
          title="Add Funds to This Deposit"
          icon={<Plus size={13} />}
          noPad
          actions={
            <button className="btn btn-sm" onClick={addLine} disabled={!canEdit()}>
              <Plus size={11} /> Add Line
            </button>
          }
        >
          {/* Column headers */}
          <div style={{
            display: 'flex', gap: 6, padding: '7px 12px', borderBottom: '1px solid var(--g200)',
            background: 'var(--g50)', fontSize: 10.5, fontWeight: 700, color: 'var(--g600)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <div style={{ width: 26, flexShrink: 0 }}>#</div>
            <div style={{ width: 108, flexShrink: 0 }}>From Type</div>
            <div style={{ width: 168, flexShrink: 0 }}>Received From</div>
            <div style={{ width: 208, flexShrink: 0 }}>Account (Credit)</div>
            <div style={{ flex: 1, minWidth: 80 }}>Description</div>
            <div style={{ width: 128, flexShrink: 0 }}>Method</div>
            <div style={{ width: 98, flexShrink: 0 }}>Ref No.</div>
            <div style={{ width: 108, flexShrink: 0, textAlign: 'right' }}>Amount (₹)</div>
            <div style={{ width: 28, flexShrink: 0 }} />
          </div>

          {/* Data rows */}
          <div style={{ overflowX: 'auto' }}>
            {lines.map((line, i) => {
              const partySearch = getPartySearch(line.received_from_type);
              const inputStyle = (extra = {}) => ({
                height: 34, padding: '0 8px', border: '1px solid var(--g300)',
                borderRadius: 'var(--radius)', fontSize: 12.5, boxSizing: 'border-box',
                backgroundColor: '#fff', outline: 'none', fontFamily: 'inherit',
                width: '100%', transition: 'border-color .12s', ...extra,
              });
              const wrapStyle = (extra = {}) => ({
                width: '100%', ...extra,
              });

              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 6, alignItems: 'center',
                    padding: '4px 12px', borderBottom: '1px solid var(--g100)',
                    background: i % 2 === 0 ? '#fff' : 'var(--table-alt)',
                  }}
                >
                  <div style={{ width: 26, textAlign: 'center', fontSize: 11, color: 'var(--g400)', flexShrink: 0 }}>{i + 1}</div>

                  <SelectDropdown
                    value={line.received_from_type}
                    onChange={e => handleFromTypeChange(i, e.target.value)}
                    disabled={!canEdit()}
                    style={wrapStyle({ width: 108, flexShrink: 0 })}
                  >
                    {FROM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </SelectDropdown>

                  {line.received_from_type === 'other' ? (
                    <input
                      type="text" value={line.party_name}
                      placeholder="Name / Description"
                      onChange={e => updateLine(i, { party_name: e.target.value })}
                      disabled={!canEdit()}
                      style={inputStyle({ width: 168, flexShrink: 0 })}
                    />
                  ) : (
                    <div style={{ width: 168, flexShrink: 0 }}>
                      <SearchableSelect
                        value={line.received_from_obj}
                        onChange={obj => handlePartySelect(i, obj)}
                        onSearch={partySearch}
                        placeholder={line.received_from_type === 'customer' ? 'Search customer…' : 'Search vendor…'}
                        disabled={!canEdit()}
                        onAddNew={canEdit() ? () => setQuickCreate({ type: line.received_from_type, lineIndex: i }) : undefined}
                        addNewLabel={`+ Add New ${line.received_from_type === 'customer' ? 'Customer' : 'Vendor'}`}
                      />
                    </div>
                  )}

                  <div style={{ width: 208, flexShrink: 0 }}>
                    <SearchableSelect
                      value={line.account_obj}
                      onChange={obj => handleAccountSelect(i, obj)}
                      onSearch={searchLineAccounts}
                      placeholder="Search account…"
                      disabled={!canEdit()}
                      onAddNew={canEdit() ? () => setQuickCreate({ type: 'account', lineIndex: i }) : undefined}
                      addNewLabel="+ Add New Account"
                    />
                  </div>

                  <input
                    type="text" value={line.description}
                    placeholder="Memo / Description"
                    onChange={e => updateLine(i, { description: e.target.value })}
                    disabled={!canEdit()}
                    style={inputStyle({ flex: 1, minWidth: 80 })}
                  />

                  <SelectDropdown
                    value={line.payment_method}
                    onChange={e => updateLine(i, { payment_method: e.target.value })}
                    disabled={!canEdit()}
                    style={wrapStyle({ width: 128, flexShrink: 0 })}
                  >
                    {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                  </SelectDropdown>

                  <input
                    type="text" value={line.ref_no}
                    placeholder="Ref / Cheque"
                    onChange={e => updateLine(i, { ref_no: e.target.value })}
                    disabled={!canEdit()}
                    style={inputStyle({ width: 98, flexShrink: 0 })}
                  />

                  <input
                    type="number" step="0.01" min="0" value={line.amount}
                    placeholder="0.00"
                    onChange={e => updateLine(i, { amount: e.target.value })}
                    disabled={!canEdit()}
                    style={inputStyle({ width: 108, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--mono)' })}
                  />

                  <button
                    onClick={() => removeLine(i)}
                    disabled={!canEdit() || lines.length === 1}
                    title="Remove line"
                    style={{
                      width: 28, height: 28, border: 'none', background: 'none', flexShrink: 0,
                      cursor: (canEdit() && lines.length > 1) ? 'pointer' : 'default',
                      color: 'var(--g400)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Sub-total row */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            padding: '8px 48px 8px 0', borderTop: '1px solid var(--g200)',
            background: 'var(--g50)', gap: 24, fontSize: 12,
          }}>
            <span style={{ color: 'var(--g500)' }}>Lines total</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand-dark)', fontSize: 14 }}>
              ₹{fmt(total)}
            </span>
          </div>
        </FormSectionCard>

        {/* ── Memo ── */}
        <NotesAttachmentsPanel
          value={form.memo}
          onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
          label="Memo"
          placeholder="Add a memo for this deposit…"
          rows={3}
        />
      </TransactionPageLayout>

      {quickCreate && (
        <QuickCreateModal
          type={quickCreate.type}
          onClose={() => setQuickCreate(null)}
          onCreated={handleQuickCreated}
        />
      )}
    </>
  );
}

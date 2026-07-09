import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../core/context/AuthContext';
import DatePicker from '../../../shared/components/DatePicker';
import { ArrowRightLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import { getTransfer, createTransfer } from '../services/transferService';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, SideSummaryPanel, NotesAttachmentsPanel,
} from '../../../core/layout';

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TransferEntryPage() {
  const navigate = useNavigate();
  const { id: transferId } = useParams();
  const editMode = !!transferId;
  const { canEdit } = useAuth();

  const [form, setForm] = useState({
    transfer_date: new Date().toISOString().split('T')[0],
    from_account_obj: null,
    from_account_id: '',
    to_account_obj: null,
    to_account_id: '',
    amount: '',
    reference_no: '',
    memo: '',
  });

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editMode);

  useEffect(() => {
    if (!editMode) return;
    setLoading(true);
    getTransfer(transferId)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const tr = data;
        if (tr.status === 'reversed') {
          toast.error('Cannot edit a reversed transfer.');
          navigate(`/transfers/${transferId}`);
          return;
        }
        setForm({
          transfer_date: tr.transfer_date ? tr.transfer_date.split('T')[0] : '',
          from_account_obj: { id: tr.from_account_id, name: tr.from_account_name, code: tr.from_account_code, balance: tr.from_account_balance },
          from_account_id: String(tr.from_account_id),
          to_account_obj: { id: tr.to_account_id, name: tr.to_account_name, code: tr.to_account_code, balance: tr.to_account_balance },
          to_account_id: String(tr.to_account_id),
          amount: String(tr.amount),
          reference_no: tr.reference_no || '',
          memo: tr.memo || '',
        });
      })
      .catch(err => { toast.error(err.message || 'Failed to load transfer'); navigate('/transfers'); })
      .finally(() => setLoading(false));
  }, [transferId, navigate, editMode]);

  // Exclude groups, revenue, expense, cogs, control, system. Show only postable asset/liab/equity.
  const searchAccounts = useCallback(async (q, api) => {
    try {
      const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(q)}&is_group=false&exclude_sub_types=revenue,expenses,cogs,system,control,accounts_receivable,accounts_payable,inventory&limit=20`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      return await res.json();
    } catch(e) {
      return [];
    }
  }, []);

  const handleFromSelect = (obj) => setForm(p => ({ ...p, from_account_obj: obj, from_account_id: obj ? String(obj.id) : '' }));
  const handleToSelect = (obj) => setForm(p => ({ ...p, to_account_obj: obj, to_account_id: obj ? String(obj.id) : '' }));

  const isValid = useMemo(() => {
    if (!form.transfer_date || !form.from_account_id || !form.to_account_id || !form.amount) return false;
    if (parseFloat(form.amount) <= 0) return false;
    if (form.from_account_id === form.to_account_id) return false;
    return true;
  }, [form]);

  const handleSubmit = async (action = 'close') => {
    if (!isValid) return;
    setSaving(true);
    try {
      if (editMode) {
        toast.error('Editing transfers is not supported. Please reverse and recreate.');
      } else {
        const payload = {
          transfer_date: form.transfer_date,
          from_account_id: form.from_account_id,
          to_account_id: form.to_account_id,
          amount: parseFloat(form.amount),
          reference_no: form.reference_no,
          memo: form.memo,
        };
        const res = await createTransfer(payload);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        toast.success(`Transfer saved — ${data.transfer_no}`);
        if (action === 'new') window.location.href = window.location.pathname.replace(/\/[^/]+(\/edit)?$/, '/new');
        else navigate('/transfers');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save transfer');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="spinner" />
        <p>Loading transfer…</p>
      </div>
    );
  }

  const amt = parseFloat(form.amount) || 0;

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={editMode ? 'View Internal Transfer' : 'New Internal Transfer'}
          icon={<ArrowRightLeft size={18} />}
          breadcrumbs={[
            { label: 'Accounting', href: '/transfers' },
            { label: 'Transfers', href: '/transfers' },
            { label: editMode ? 'View Transfer' : 'New Transfer' },
          ]}
          backTo="/transfers"
          backLabel="Transfers"
        />
      }
      aside={
        <>
          <SideSummaryPanel title="Transfer Preview">
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--g700)', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--g100)' }}>
                <span style={{ color: 'var(--g500)' }}>Amount</span>
                <strong style={{ fontSize: 14, color: 'var(--brand-dark)' }}>₹{fmt(amt)}</strong>
              </div>
              
              <div><strong>Dr.</strong> {form.to_account_obj?.name || 'To Ledger'}</div>
              <div style={{ color: 'var(--g500)', fontSize: 11, marginLeft: 12 }}>₹{fmt(amt)}</div>
              
              <div style={{ marginTop: 6 }}><strong>Cr.</strong> {form.from_account_obj?.name || 'From Ledger'}</div>
              <div style={{ color: 'var(--g500)', fontSize: 11, marginLeft: 12 }}>₹{fmt(amt)}</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, color: '#1b7e4a', fontSize: 11, fontWeight: 600 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#e6f5ec', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                Double Entry Balanced
              </div>
            </div>
          </SideSummaryPanel>

          {!isValid && !editMode && (
            <div style={{
              background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 'var(--radius)',
              padding: '8px 12px', fontSize: 11, color: '#E65100',
            }}>
              {!form.from_account_id ? '⚠ Select From Ledger' :
               !form.to_account_id ? '⚠ Select To Ledger' :
               form.from_account_id === form.to_account_id ? '⚠ From and To Ledgers cannot be the same' :
               amt <= 0 ? '⚠ Enter an amount greater than 0' : ''}
            </div>
          )}
        </>
      }
      footer={
        <StickyActionFooter
          left={
            <button className="btn" onClick={() => navigate('/transfers')}>Cancel</button>
          }
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              {!editMode && (
                <>
                  <button
                    className="btn"
                    onClick={() => handleSubmit('new')}
                    disabled={saving || !canEdit() || !isValid}
                    style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}
                  >
                    {saving ? 'Saving…' : 'Save & New'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSubmit('close')}
                    disabled={saving || !canEdit() || !isValid}
                  >
                    {saving ? 'Saving…' : 'Save & Close'}
                  </button>
                </>
              )}
            </div>
          }
        />
      }
    >
      <FormSectionCard title="Transfer Details" icon={<ArrowRightLeft size={13} />}>
        <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="fg w">
            <label>From Ledger *</label>
            <SearchableSelect
              value={form.from_account_obj}
              onChange={handleFromSelect}
              onSearch={searchAccounts}
              placeholder="Search source account…"
              disabled={!canEdit() || editMode}
            />
            {form.from_account_obj?.balance !== undefined && (
              <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 4 }}>
                Current Balance: ₹{fmt(form.from_account_obj.balance)}
              </div>
            )}
          </div>
          <div className="fg w">
            <label>To Ledger *</label>
            <SearchableSelect
              value={form.to_account_obj}
              onChange={handleToSelect}
              onSearch={searchAccounts}
              placeholder="Search destination account…"
              disabled={!canEdit() || editMode}
            />
            {form.to_account_obj?.balance !== undefined && (
              <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 4 }}>
                Current Balance: ₹{fmt(form.to_account_obj.balance)}
              </div>
            )}
          </div>
        </div>
        
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="fg">
            <label>Date *</label>
            <DatePicker value={form.transfer_date} onChange={v => setForm(p => ({ ...p, transfer_date: v }))} disabled={!canEdit() || editMode} />
          </div>
          <div className="fg">
            <label>Amount *</label>
            <input
              type="number" step="0.01" min="0" value={form.amount}
              placeholder="0.00"
              onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
              disabled={!canEdit() || editMode}
              style={{
                height: 34, padding: '0 8px', border: '1px solid var(--g300)',
                borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box',
                backgroundColor: (editMode || !canEdit()) ? 'var(--g100)' : '#fff', 
                outline: 'none', width: '100%'
              }}
            />
          </div>
          <div className="fg">
            <label>Reference No.</label>
            <input
              type="text" value={form.reference_no}
              placeholder="Cheque / UTR"
              onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))}
              disabled={!canEdit() || editMode}
              style={{
                height: 34, padding: '0 8px', border: '1px solid var(--g300)',
                borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box',
                backgroundColor: (editMode || !canEdit()) ? 'var(--g100)' : '#fff', 
                outline: 'none', width: '100%'
              }}
            />
          </div>
        </div>
      </FormSectionCard>

      <NotesAttachmentsPanel
        value={form.memo}
        onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
        label="Narration"
        placeholder="Reason for transfer..."
        disabled={!canEdit() || editMode}
        rows={3}
      />
    </TransactionPageLayout>
  );
}

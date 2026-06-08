import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { Landmark, Edit2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  TransactionPageLayout, TransactionHeader, FormSectionCard,
  SummaryCardsRow, JournalPreviewPanel,
} from '../../../core/layout';

const fmt = v =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = d => {
  if (!d) return '—';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const DASH = <span style={{ color: 'var(--g300)' }}>—</span>;

export default function BankDepositViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { canEdit } = useAuth();

  const [deposit, setDeposit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reversing, setReversing] = useState(false);

  const loadDeposit = () => {
    setLoading(true);
    api.get(`/api/bank-deposits/${id}`)
      .then(r => setDeposit(r.data))
      .catch(err => { toast.error(err.message || 'Failed to load deposit'); navigate('/bank-deposits'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDeposit(); }, [id]);

  const handleReverse = async () => {
    if (!window.confirm(
      'Reverse this deposit?\n\nThis will create a reversal journal entry and cannot be undone.'
    )) return;

    setReversing(true);
    try {
      const res = await api.post(`/api/bank-deposits/${id}/reverse`, {});
      toast.success(`Reversed — ${res.reverse_je_number || 'reversal JE created'}`);
      loadDeposit();
    } catch (err) {
      toast.error(err.message || 'Failed to reverse deposit');
    } finally {
      setReversing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#888', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (!deposit) return null;

  const depositStatus = deposit.status || (deposit.je_status === 'posted' ? 'posted' : 'draft');
  const isPosted   = deposit.je_status === 'posted';
  const isDraft    = !isPosted && depositStatus !== 'reversed';
  const isReversed = depositStatus === 'reversed';

  const lines = deposit.lines || [];

  const summaryCards = [
    { label: 'Bank Account', value: deposit.bank_account_name || '—' },
    { label: 'Total Amount', value: `₹${fmt(deposit.total_amount)}`, variant: 'highlight' },
    ...(deposit.je_number ? [{ label: 'JE Number', value: deposit.je_number }] : []),
    ...(isReversed && deposit.reverse_je_id ? [{ label: 'Reversal JE', value: `#${deposit.reverse_je_id}`, variant: 'danger' }] : []),
  ];

  const jeLines = [
    { account: deposit.bank_account_name || 'Bank', dr: `₹${fmt(deposit.total_amount)}`, cr: '' },
    ...lines.map(l => ({ account: l.account_name || l.account_code || '—', dr: '', cr: `₹${fmt(l.amount)}` })),
  ];

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={`Bank Deposit${deposit.doc_number ? ` — ${deposit.doc_number}` : ''}`}
          icon={<Landmark size={18} />}
          badge={{ label: depositStatus.charAt(0).toUpperCase() + depositStatus.slice(1), className: `b-${depositStatus}` }}
          breadcrumbs={[
            { label: 'Accounting', href: '/bank-deposits' },
            { label: 'Bank Deposits', href: '/bank-deposits' },
            { label: deposit.doc_number || `#${id}` },
          ]}
          backTo="/bank-deposits"
          backLabel="Bank Deposits"
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              {isDraft && canEdit() && (
                <button className="btn btn-sm" onClick={() => navigate(`/bank-deposits/${id}/edit`)}>
                  <Edit2 size={13} /> Edit
                </button>
              )}
              {isPosted && !isReversed && canEdit() && (
                <button className="btn btn-sm" onClick={handleReverse} disabled={reversing}
                  style={{ background: '#fff3e0', color: '#e65100', borderColor: '#ffcc80' }}>
                  <RotateCcw size={13} /> {reversing ? 'Reversing…' : 'Reverse'}
                </button>
              )}
            </div>
          }
          auditMeta={`Dated: ${fmtDate(deposit.date)}`}
        />
      }
    >
      {/* Summary cards */}
      <SummaryCardsRow cards={summaryCards} />

      {deposit.memo && (
        <div style={{ padding: '8px 12px', background: 'var(--g50)', borderRadius: 6, fontSize: 13, color: 'var(--g700)', border: '1px solid var(--g200)' }}>
          <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--g500)', marginRight: 6 }}>Memo</span>
          {deposit.memo}
        </div>
      )}

      {/* Lines table */}
      <FormSectionCard title="Deposit Lines" icon={<Landmark size={13} />} noPad>
        <table className="je-lines-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Received From</th>
              <th>Account (Credit)</th>
              <th>Description</th>
              <th>Method</th>
              <th>Ref No.</th>
              <th style={{ textAlign: 'right' }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--g400)' }}>No lines</td></tr>
            ) : lines.map((line, i) => (
              <tr key={line.id || i}>
                <td style={{ textAlign: 'center', color: 'var(--g500)' }}>{i + 1}</td>
                <td>{line.party_name || DASH}</td>
                <td>
                  <span style={{ fontWeight: 500 }}>{line.account_name || line.account_code || DASH}</span>
                  {line.account_code && line.account_name && (
                    <span style={{ fontSize: 11, color: 'var(--g400)', marginLeft: 6 }}>{line.account_code}</span>
                  )}
                </td>
                <td>{line.description || DASH}</td>
                <td>{line.payment_method || DASH}</td>
                <td>{line.ref_no || DASH}</td>
                <td className="num" style={{ fontWeight: 600 }}>₹{fmt(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--brand-50)', borderTop: '2px solid var(--brand)' }}>
              <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right', fontSize: 13, color: 'var(--brand-dark)' }}>Total</td>
              <td className="num" style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)', padding: '10px 14px', fontFamily: 'var(--mono)' }}>
                ₹{fmt(deposit.total_amount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </FormSectionCard>

      {/* JE Preview */}
      <JournalPreviewPanel
        title={`Journal Entry${deposit.je_number ? ` (${deposit.je_number})` : ' Preview'}`}
        lines={jeLines}
      />

      <div style={{ fontSize: 12, color: 'var(--g400)', padding: '4px 2px' }}>
        Created by <strong>{deposit.created_by_name || 'Unknown'}</strong> on {fmtDate(deposit.created_at)}
      </div>
    </TransactionPageLayout>
  );
}


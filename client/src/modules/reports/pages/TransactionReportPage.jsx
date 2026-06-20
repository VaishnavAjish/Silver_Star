import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { ArrowLeft, FileText } from 'lucide-react';
import Paginator from '../../../shared/components/Paginator';

const fmt2 = v => `₹${Math.abs(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSign = v => {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function getVoucherPath(sourceType, sourceId, jeId) {
  if (sourceId) {
    switch (sourceType) {
      case 'bank_deposit':  return `/bank-deposits/${sourceId}`;
      case 'purchase_note':
      case 'purchase':      return `/purchase-notes/${sourceId}`;
      case 'invoice':       return `/invoices/${sourceId}`;
      case 'rough_growth':  return `/rough-growth/${sourceId}`;
      case 'receipt':       return `/receipts/${sourceId}`;
      case 'payment':       return `/payments/${sourceId}`;
      case 'fixed_asset':   return `/fixed-assets/${sourceId}`;
    }
  }
  return jeId ? `/journal-entries/${jeId}` : null;
}

export default function TransactionReportPage() {
  const api = useApi();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [accountId]   = useState(() => searchParams.get('account_id'));
  const [fromDate]    = useState(() => searchParams.get('from') || '1900-01-01');
  const [toDate]      = useState(() => searchParams.get('to')   || new Date().toISOString().split('T')[0]);
  const [accountName] = useState(() => searchParams.get('account_name') || '');

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [page,    setPage]    = useState(1);
  const PAGE_SIZE = 500;

  useEffect(() => {
    if (!accountId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({
      account_id: accountId,
      from_date: fromDate,
      to_date: toDate,
      page: page,
      pageSize: PAGE_SIZE
    });
    api.get(`/api/reports/transactions?${p.toString()}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId, fromDate, toDate, page]);

  const periodLabel = fromDate === '1900-01-01'
    ? `All time → ${toDate}`
    : `${fromDate} → ${toDate}`;

  return (
    <div style={{ padding: 20 }} className="animate-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <button
          className="btn"
          onClick={() => navigate(-1)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <FileText size={18} style={{ color: 'var(--brand)' }} />
            Transaction Report
            {(accountName || data?.account?.name) && (
              <span style={{ color: 'var(--brand-dark)' }}>
                — {accountName || data.account.name}
              </span>
            )}
          </h2>
          <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 3 }}>
            {data?.account?.code && <span style={{ marginRight: 10 }}>Code: {data.account.code}</span>}
            <span>{periodLabel}</span>
          </div>
        </div>
      </div>

      {!accountId && !data && !loading && (
        <div className="empty-state" style={{ padding: '40px 0', color: 'var(--g400)' }}>
          Please select an account to view transactions.
        </div>
      )}

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {error && (
        <div style={{ padding: '12px 16px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 8, color: 'var(--red)', fontWeight: 600 }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Opening Balance', value: data.openingBalance,  bg: 'var(--brand-50)', border: 'var(--sidebar-border)', color: 'var(--brand-dark)' },
              { label: 'Total Debit',     value: data.totalDebit,      bg: '#E8F5E9',         border: '#A5D6A7',              color: 'var(--green)' },
              { label: 'Total Credit',    value: data.totalCredit,     bg: '#FFEBEE',         border: '#EF9A9A',              color: 'var(--red)' },
              { label: 'Closing Balance', value: data.closingBalance,  bg: '#E3F2FD',         border: '#90CAF9',              color: '#0D47A1' },
            ].map((c, i) => (
              <div key={i} style={{ padding: '10px 18px', background: c.bg, borderRadius: 8, border: `1px solid ${c.border}`, minWidth: 160 }}>
                <div style={{ fontSize: 10, color: c.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color, marginTop: 2 }}>
                  {fmtSign(c.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Transaction table */}
          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Date</th>
                <th style={{ width: 85 }}>JE No</th>
                <th style={{ width: 80 }}>Type</th>
                <th style={{ width: 180 }}>Description</th>
                <th>Posting Ledger</th>
                <th style={{ width: 115, textAlign: 'right' }}>Debit (₹)</th>
                <th style={{ width: 115, textAlign: 'right' }}>Credit (₹)</th>
                <th style={{ width: 125, textAlign: 'right' }}>Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening balance row */}
              <tr style={{ background: 'var(--brand-50)', fontWeight: 600 }}>
                <td colSpan={5} style={{ color: 'var(--brand-dark)' }}>Opening Balance</td>
                <td /><td />
                <td className="num" style={{ fontWeight: 700, color: 'var(--brand-dark)', fontFamily: 'var(--mono)' }}>
                  {fmtSign(data.openingBalance)}
                </td>
              </tr>

              {data.transactions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--g400)', padding: '24px 0', fontStyle: 'italic' }}>
                    No transactions in this period
                  </td>
                </tr>
              )}

              {data.transactions.map((t, i) => {
                const voucherPath = getVoucherPath(t.source_type, t.source_id, t.je_id);
                return (
                <tr key={i}>
                  <td>{new Date(t.date).toLocaleDateString('en-IN')}</td>
                  <td>
                    <span
                      className="cell-link"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/journal-entries/${t.je_id}`)}
                      title="Open journal entry"
                    >
                      {t.je_number || '—'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--g600)' }}>
                    {voucherPath ? (
                      <span
                        className="cell-link"
                        style={{ cursor: 'pointer', color: 'var(--brand)' }}
                        onClick={() => navigate(voucherPath)}
                        title="Open source document"
                      >
                        {t.source_type || '—'}
                      </span>
                    ) : (
                      t.source_type || '—'
                    )}
                  </td>
                  {(() => {
                    const desc = t.description || '—';
                    const parts = desc.split(' - ');
                    const first = parts[0];
                    const second = parts.length > 1 ? parts.slice(1).join(' - ') : '—';
                    return (
                      <>
                        <td style={{ color: 'var(--g700)' }}>{first}</td>
                        <td style={{ color: 'var(--g700)' }}>{second}</td>
                      </>
                    );
                  })()}
                  <td className="num" style={{ color: t.debit > 0 ? 'var(--green)' : 'var(--g300)', fontWeight: t.debit > 0 ? 600 : 400 }}>
                    {t.debit > 0 ? fmt2(t.debit) : ''}
                  </td>
                  <td className="num" style={{ color: t.credit > 0 ? 'var(--red)' : 'var(--g300)', fontWeight: t.credit > 0 ? 600 : 400 }}>
                    {t.credit > 0 ? fmt2(t.credit) : ''}
                  </td>
                  <td className="num" style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>
                    {fmtSign(t.balance)}
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--g300)' }}>
                <td colSpan={5} style={{ textAlign: 'right', color: 'var(--g700)' }}>Period Totals</td>
                <td className="num" style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{fmt2(data.totalDebit)}</td>
                <td className="num" style={{ color: 'var(--red)',   fontFamily: 'var(--mono)' }}>{fmt2(data.totalCredit)}</td>
                <td className="num" style={{ color: 'var(--brand-dark)', fontSize: 13, fontFamily: 'var(--mono)' }}>
                  {fmtSign(data.closingBalance)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--g400)' }}>
              Showing {data.transactions.length} records on this page
            </div>
            {data.total > PAGE_SIZE && (
              <Paginator page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} onPage={setPage} />
            )}
            <div style={{ fontSize: 11, color: 'var(--g400)', textAlign: 'right' }}>
              {data.total} total transaction{data.total !== 1 ? 's' : ''} in period
            </div>
          </div>
        </>
      )}
    </div>
  );
}

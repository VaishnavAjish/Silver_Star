import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { ArrowLeft, BarChart2 } from 'lucide-react';
import Paginator from '../../../shared/components/Paginator';

const fmt2 = v => `₹${Math.abs(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

export default function CostCenterTransactionsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [costCenterId] = useState(() => searchParams.get('cost_center_id'));
  const [fromDate]     = useState(() => searchParams.get('from_date') || '');
  const [toDate]       = useState(() => searchParams.get('to_date')   || '');
  const [ccName]       = useState(() => searchParams.get('name') || '');

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [page,    setPage]    = useState(1);
  const PAGE_SIZE = 500;

  useEffect(() => {
    if (!costCenterId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cost_center_id: costCenterId, page: page, pageSize: PAGE_SIZE });
    if (fromDate) params.set('from_date', fromDate);
    if (toDate)   params.set('to_date',   toDate);
    api.get(`/api/reports/cost-center-transactions?${params.toString()}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [costCenterId, fromDate, toDate, page]);

  const periodLabel = fromDate && toDate ? `${fromDate} → ${toDate}` : fromDate ? `From ${fromDate}` : 'All time';

  return (
    <div style={{ padding: 20 }} className="animate-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-sm" onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <BarChart2 size={18} style={{ color: 'var(--brand)' }} />
            Cost Center Transactions
            <span style={{ color: 'var(--brand-dark)' }}>— {ccName || data?.costCenter?.name || ''}</span>
          </h2>
          <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 3 }}>
            {data?.costCenter?.code && <span style={{ marginRight: 10 }}>Code: {data.costCenter.code}</span>}
            <span>{periodLabel}</span>
          </div>
        </div>
      </div>

      {!costCenterId && !data && !loading && (
        <div className="empty-state" style={{ padding: '40px 0', color: 'var(--g400)' }}>
          Please select a cost center to view transactions.
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
              { label: 'Total Income',  value: data.totalCredit, bg: '#E8F5E9', border: '#A5D6A7', color: 'var(--green)' },
              { label: 'Total Expense', value: data.totalDebit,  bg: '#FFEBEE', border: '#EF9A9A', color: 'var(--red)' },
              { label: 'Net',           value: data.totalCredit - data.totalDebit,
                bg: (data.totalCredit - data.totalDebit) >= 0 ? '#E3F2FD' : '#FFF3E0',
                border: (data.totalCredit - data.totalDebit) >= 0 ? '#90CAF9' : '#FFCC80',
                color:  (data.totalCredit - data.totalDebit) >= 0 ? '#0D47A1' : '#E65100' },
            ].map((c, i) => (
              <div key={i} style={{ padding: '10px 18px', background: c.bg, borderRadius: 8, border: `1px solid ${c.border}`, minWidth: 160 }}>
                <div style={{ fontSize: 10, color: c.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color, marginTop: 2 }}>
                  {c.value < 0 ? '-' : ''}{fmt2(Math.abs(c.value))}
                </div>
              </div>
            ))}
          </div>

          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Date</th>
                <th style={{ width: 85 }}>JE No</th>
                <th style={{ width: 80 }}>Type</th>
                <th style={{ width: 160 }}>Account</th>
                <th>Description</th>
                <th style={{ width: 115, textAlign: 'right' }}>Debit (₹)</th>
                <th style={{ width: 115, textAlign: 'right' }}>Credit (₹)</th>
              </tr>
            </thead>
            <tbody>
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
                      {voucherPath ? (
                        <span className="cell-link" style={{ cursor: 'pointer' }} onClick={() => navigate(voucherPath)} title="Open voucher">
                          {t.je_number || '—'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--g500)' }}>{t.je_number || '—'}</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--g600)' }}>{t.source_type || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--g700)' }}>{t.account_code} – {t.account_name}</td>
                    <td style={{ color: 'var(--g700)' }}>{t.description || '—'}</td>
                    <td className="num" style={{ color: t.debit > 0 ? 'var(--red)' : 'var(--g300)', fontWeight: t.debit > 0 ? 600 : 400 }}>
                      {t.debit > 0 ? fmt2(t.debit) : ''}
                    </td>
                    <td className="num" style={{ color: t.credit > 0 ? 'var(--green)' : 'var(--g300)', fontWeight: t.credit > 0 ? 600 : 400 }}>
                      {t.credit > 0 ? fmt2(t.credit) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--g300)' }}>
                <td colSpan={5} style={{ textAlign: 'right', color: 'var(--g700)' }}>Totals</td>
                <td className="num" style={{ color: 'var(--red)',   fontFamily: 'var(--mono)' }}>{fmt2(data.totalDebit)}</td>
                <td className="num" style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{fmt2(data.totalCredit)}</td>
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

import { useState, useEffect } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { BarChart2, ArrowLeft } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';

const fmt2 = v => `₹${Math.abs(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = new Date().toISOString().split('T')[0];
const firstOfYear = `${new Date().getFullYear()}-04-01`;

export default function CostCenterReportPage() {
  const api = useApi();
  const navigate = useNavigate();

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get(`/api/reports/pl-by-cost-center?from=${from}&to=${to}`)
      .then(r => setData(r.data || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totalIncome = data.reduce((s, r) => s + r.income, 0);
  const totalExpense = data.reduce((s, r) => s + r.expense, 0);
  const totalProfit = data.reduce((s, r) => s + r.profit, 0);

  const drill = (row) => {
    navigate(
      `/reports/cost-center-transactions?cost_center_id=${row.id}&from_date=${from}&to_date=${to}&name=${encodeURIComponent(row.name)}`
    );
  };

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(data, []);

  return (
    <div style={{ padding: 20 }} className="animate-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--g500)', marginBottom: 3 }}>From</div>
            <DatePicker value={from} onChange={v => setFrom(v)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--g500)', marginBottom: 3 }}>To</div>
            <DatePicker value={to} onChange={v => setTo(v)} />
          </div>
          <button className="btn btn-primary" onClick={load} disabled={loading} style={{ height: 32 }}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 8, color: 'var(--red)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Summary cards */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Income', value: totalIncome, bg: '#E8F5E9', border: '#A5D6A7', color: 'var(--green)' },
            { label: 'Total Expense', value: totalExpense, bg: '#FFEBEE', border: '#EF9A9A', color: 'var(--red)' },
            { label: 'Net Profit', value: totalProfit, bg: totalProfit >= 0 ? '#E3F2FD' : '#FFF3E0', border: totalProfit >= 0 ? '#90CAF9' : '#FFCC80', color: totalProfit >= 0 ? '#0D47A1' : '#E65100' },
          ].map((c, i) => (
            <div key={i} style={{ padding: '10px 18px', background: c.bg, borderRadius: 8, border: `1px solid ${c.border}`, minWidth: 160 }}>
              <div style={{ fontSize: 10, color: c.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color, marginTop: 2 }}>{fmt2(c.value)}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {!loading && data.length === 0 && !error && (
        <div className="empty-state">
          <BarChart2 size={40} />
          <p>No cost center data for selected period.<br />Tag transactions with a cost center to see analytics here.</p>
        </div>
      )}

      {!loading && data.length > 0 && (
        <table className="dgrid" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Cost Center</th>
              <th style={{ width: 60 }}>Code</th>
              <th style={{ width: 140, textAlign: 'right' }}>Income (₹)</th>
              <th style={{ width: 140, textAlign: 'right' }}>Expense (₹)</th>
              <th style={{ width: 150, textAlign: 'right' }}>Net Profit (₹)</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map(row => (
              <tr
                key={row.id}
                style={{ cursor: 'pointer' }}
                onDoubleClick={() => drill(row)}
                title="Double click to view transactions"
              >
                <td style={{ fontWeight: 600, color: 'var(--brand-dark)' }}>{row.name}</td>
                <td style={{ color: 'var(--g500)', fontSize: 11 }}>{row.code || '—'}</td>
                <td className="num" style={{ color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                  {fmt2(row.income)}
                </td>
                <td className="num" style={{ color: 'var(--red)', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                  {fmt2(row.expense)}
                </td>
                <td className="num" style={{
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  color: row.profit >= 0 ? '#0D47A1' : 'var(--red)',
                }}>
                  {row.profit < 0 ? '-' : ''}{fmt2(Math.abs(row.profit))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--g300)', background: 'var(--g50)' }}>
              <td colSpan={2} style={{ color: 'var(--g700)' }}>Grand Total</td>
              <td className="num" style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{fmt2(totalIncome)}</td>
              <td className="num" style={{ color: 'var(--red)', fontFamily: 'var(--mono)' }}>{fmt2(totalExpense)}</td>
              <td className="num" style={{ color: totalProfit >= 0 ? '#0D47A1' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                {totalProfit < 0 ? '-' : ''}{fmt2(Math.abs(totalProfit))}
              </td>
            </tr>
          </tfoot>
          <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
            {data.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {data.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, data.length)} of {data.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
          </td></tr></tfoot>
        </table>

      )}
    </div>
  );
}

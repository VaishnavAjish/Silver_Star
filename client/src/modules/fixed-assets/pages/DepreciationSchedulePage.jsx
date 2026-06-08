import { useState, useEffect } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { Search, TrendingDown, X } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import toast from 'react-hot-toast';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';

export default function DepreciationSchedule() {
  const api     = useApi();
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [expand,  setExpand]  = useState(null);

  const load = async (fd, td) => {
    setLoading(true);
    setData(null);
    try {
      const from = fd || fromDate || '2000-01-01';
      const to   = td || toDate   || '2099-12-31';
      const r = await api.get(`/api/reports/depreciation-schedule?fromDate=${from}&toDate=${to}`);
      setData(r);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: 20 }} className="animate-in">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="fg"><label>From</label>
            <DatePicker value={fromDate} onChange={v => setFromDate(v)} />
          </div>
          <div className="fg"><label>To</label>
            <DatePicker value={toDate} onChange={v => setToDate(v)} />
          </div>
          <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={() => { setFromDate(''); setToDate(''); load('', ''); }}><X size={14} /> Clear</button>
          <button className="btn btn-primary" onClick={() => load()} disabled={loading}><Search size={14} /> Generate</button>
        </div>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ padding: '10px 18px', background: 'var(--brand-50)', border: '1px solid var(--sidebar-border)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-dark)' }}>Grand Total Depreciation</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand-dark)' }}>{fmt(data.grand_total)}</div>
            </div>
            <div style={{ padding: '10px 18px', background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--g600)' }}>Periods</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--g700)' }}>{data.schedule.length}</div>
            </div>
          </div>

          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Period From</th>
                <th style={{ width: 110 }}>Period To</th>
                <th style={{ width: 80, textAlign: 'right' }}>Assets</th>
                <th style={{ width: 140, textAlign: 'right' }}>Total Depreciation</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((period, i) => (<>
                <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setExpand(expand === i ? null : i)}>
                  <td>{fmtDate(period.period_from)}</td>
                  <td>{fmtDate(period.period_to)}</td>
                  <td className="num">{period.asset_count}</td>
                  <td className="num" style={{ fontWeight: 600, color: 'var(--red)' }}>{fmt(period.total_depr)}</td>
                  <td style={{ textAlign: 'center', fontSize: 10, color: 'var(--g400)' }}>
                    {expand === i ? '▲' : '▼'}
                  </td>
                </tr>
                {expand === i && (
                  <tr key={`exp-${i}`}>
                    <td colSpan={5} style={{ padding: 0, background: 'var(--g50)' }}>
                      <div style={{ padding: '8px 16px' }}>
                        <table className="dgrid" style={{ fontSize: 11 }}>
                          <thead><tr><th>Asset Code</th><th>Asset Name</th><th>Category</th><th style={{ textAlign: 'right' }}>Depr (₹)</th></tr></thead>
                          <tbody>
                            {period.lines.map((l, j) => (
                              <tr key={j}>
                                <td>{l.asset_code}</td><td>{l.asset_name}</td>
                                <td>{l.category_name}</td>
                                <td className="num" style={{ color: 'var(--red)' }}>{fmt(l.depreciation_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </>))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right', color: 'var(--brand-dark)' }}>Grand Total</td>
                <td className="num" style={{ color: 'var(--red)', fontSize: 13 }}>{fmt(data.grand_total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

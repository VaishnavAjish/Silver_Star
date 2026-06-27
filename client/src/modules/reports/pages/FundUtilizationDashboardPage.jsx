import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';
import DatePicker from '../../../shared/components/DatePicker';
import { Search, Printer, X, Download, TrendingUp, TrendingDown, PiggyBank, Landmark, Layers } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const fmt = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtBS = v => `₹${Math.abs(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLORS = ['#0D7C5F', '#1565C0', '#E87722', '#D32F2F', '#455A64', '#7B1FA2', '#FBC02D', '#0097A7'];

export default function FundUtilizationDashboardPage() {
  const api = useApi();
  const navigate = useNavigate();

  const fyYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [fromDate, setFromDate] = useState(`${fyYear}-04-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Drill-down state
  const [drillDownAcct, setDrillDownAcct] = useState(null);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reports/fund-utilization?from_date=${fromDate}&to_date=${toDate}&as_of_date=${asOfDate}`);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleDrillDown = async (acct) => {
    if (!acct.drillable) return;
    setDrillDownAcct(acct);
    setDrillLoading(true);
    try {
      const res = await api.get(`/api/reports/fund-utilization/drill-down/${acct.id}?from_date=${fromDate}&to_date=${toDate}`);
      setDrillData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setDrillLoading(false);
    }
  };

  if (!data && loading) {
    return <div className="grid-page animate-in"><div className="empty-state"><div className="spinner" /></div></div>;
  }

  const {
    sources_of_funds: sources,
    applications_of_funds: applications,
    available_liquidity: liquidity,
    working_capital: wc,
    funding_mix: mix,
    utilization_analysis: utilization
  } = data || {};

  return (
    <div className="grid-page animate-in">
      {/* ─── HEADER ─── */}
      <div className="page-section page-actions-bar no-print">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="fg" style={{ margin: 0 }}><label style={{ margin: '0 8px 0 0' }}>Period From</label><DatePicker value={fromDate} onChange={setFromDate} /></div>
          <div className="fg" style={{ margin: 0 }}><label style={{ margin: '0 8px 0 0' }}>To</label><DatePicker value={toDate} onChange={setToDate} /></div>
          <div className="fg" style={{ margin: 0 }}><label style={{ margin: '0 8px 0 0' }}>Snapshot As-Of</label><DatePicker value={asOfDate} onChange={setAsOfDate} /></div>
          <button className="btn btn-primary" onClick={fetchDashboard} disabled={loading}>
            {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Search size={14} />} 
            Generate
          </button>
        </div>
        <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}><Printer size={14} /> Print</button>
      </div>

      <div className="page-section page-content" style={{ padding: '24px', background: 'transparent', border: 'none' }}>
        
        {/* ─── TOP KPI CARDS ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--green)', marginBottom: '8px' }}>
              <TrendingUp size={18} /> <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase' }}>Total Sources</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmt(sources?.total)}</div>
            <div style={{ fontSize: '12px', color: 'var(--g500)', marginTop: '4px' }}>Inflows during period</div>
          </div>
          <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--red)', marginBottom: '8px' }}>
              <TrendingDown size={18} /> <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase' }}>Total Applications</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmt(applications?.total)}</div>
            <div style={{ fontSize: '12px', color: 'var(--g500)', marginTop: '4px' }}>Outflows during period</div>
          </div>
          <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand)', marginBottom: '8px' }}>
              <Layers size={18} /> <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase' }}>Net Working Capital</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmt(wc?.net_working_capital)}</div>
            <div style={{ fontSize: '12px', color: 'var(--g500)', marginTop: '4px' }}>Ratio: {wc?.current_ratio || 'N/A'} (As of {new Date(asOfDate).toLocaleDateString('en-GB')})</div>
          </div>
          <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1565C0', marginBottom: '8px' }}>
              <Landmark size={18} /> <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase' }}>Available Liquidity</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmt(liquidity?.total)}</div>
            <div style={{ fontSize: '12px', color: 'var(--g500)', marginTop: '4px' }}>Bank & Cash (As of {new Date(asOfDate).toLocaleDateString('en-GB')})</div>
          </div>
        </div>

        {/* ─── CHARTS ROW ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          
          {/* Funding Mix Chart */}
          <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid var(--g200)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '20px', color: 'var(--gray-800)' }}>Funding Mix</h3>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '50%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mix?.breakdown.filter(d => d.amount > 0)} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                      {mix?.breakdown.filter(d => d.amount > 0).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => fmt(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ width: '50%' }}>
                {mix?.breakdown.filter(d => d.amount > 0).map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                      <span>{item.label}</span>
                    </div>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{item.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Utilization Bar Chart */}
          <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid var(--g200)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '20px', color: 'var(--gray-800)' }}>Fund Utilization</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={utilization?.items.slice(0, 5)} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="label" type="category" width={120} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => fmt(value)} cursor={{ fill: 'var(--g50)' }} />
                  <Bar dataKey="amount" fill="var(--brand)" radius={[0, 4, 4, 0]}>
                    {utilization?.items.slice(0, 5).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 1) % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ─── DETAILED TABLES ROW ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          
          {/* Sources Table */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: 'var(--g50)', borderBottom: '1px solid var(--g200)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
              <span>Sources of Funds</span>
              <span style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{fmt(sources?.total)}</span>
            </div>
            <div style={{ padding: '0 20px' }}>
              {sources?.groups && Object.values(sources.groups).filter(g => g.total > 0).map((group, idx) => (
                <div key={idx} style={{ padding: '12px 0', borderBottom: '1px solid var(--g100)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>{group.label}</strong>
                    <strong style={{ fontSize: '13px', fontFamily: 'var(--mono)' }}>{fmt(group.total)}</strong>
                  </div>
                  {group.items.map(acct => (
                    <div key={acct.id} 
                         onClick={() => handleDrillDown(acct)}
                         style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 6px 16px', fontSize: '12px', cursor: 'pointer', transition: 'background 0.2s' }}
                         className="hover-row">
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{acct.name}</span>
                      <span className="num" style={{ color: 'var(--g700)' }}>{fmt(acct.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Applications Table */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: 'var(--g50)', borderBottom: '1px solid var(--g200)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
              <span>Applications of Funds</span>
              <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)' }}>{fmt(applications?.total)}</span>
            </div>
            <div style={{ padding: '0 20px' }}>
              {applications?.groups && Object.values(applications.groups).filter(g => g.total > 0).map((group, idx) => (
                <div key={idx} style={{ padding: '12px 0', borderBottom: '1px solid var(--g100)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>{group.label}</strong>
                    <strong style={{ fontSize: '13px', fontFamily: 'var(--mono)' }}>{fmt(group.total)}</strong>
                  </div>
                  {group.items.map(acct => (
                    <div key={acct.id} 
                         onClick={() => handleDrillDown(acct)}
                         style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 6px 16px', fontSize: '12px', cursor: 'pointer', transition: 'background 0.2s' }}
                         className="hover-row">
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{acct.name}</span>
                      <span className="num" style={{ color: 'var(--g700)' }}>{fmt(acct.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* ─── DRILL-DOWN MODAL ─── */}
      <Modal open={!!drillDownAcct} onClose={() => { setDrillDownAcct(null); setDrillData(null); }} title={drillDownAcct ? `Ledger Drill-down: ${drillDownAcct.name}` : 'Loading...'} large>
        {drillLoading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
        {drillData && !drillLoading && (
          <div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 12, background: 'var(--g50)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--g200)' }}>
              <div><strong>Account:</strong> {drillData.account.name} ({drillData.account.code})</div>
              <div><strong>Type:</strong> {drillData.account.type}</div>
              <div><strong>Period Movement:</strong> {fmt(drillData.summary.net_balance)}</div>
            </div>
            
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Date</th>
                  <th style={{ width: 100 }}>JE No</th>
                  <th>Description</th>
                  <th style={{ width: 100 }}>Source Doc</th>
                  <th style={{ width: 120 }}>Debit (₹)</th>
                  <th style={{ width: 120 }}>Credit (₹)</th>
                </tr>
              </thead>
              <tbody>
                {drillData.entries.map((e, i) => (
                  <tr key={i}>
                    <td>{new Date(e.date).toLocaleDateString('en-IN')}</td>
                    <td onClick={() => {
                        // Open standard JE window if needed, for now just show ID
                        window.open('/journal-entries?search=' + e.je_number, '_blank');
                      }} style={{ cursor: 'pointer' }}>
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{e.je_number}</span>
                    </td>
                    <td>{e.description || e.narration}</td>
                    <td>{e.source_id ? `${e.source_type} #${e.source_id}` : '—'}</td>
                    <td className="num" style={{ color: e.debit > 0 ? 'var(--green)' : '' }}>{e.debit > 0 ? fmt(e.debit) : ''}</td>
                    <td className="num" style={{ color: e.credit > 0 ? 'var(--red)' : '' }}>{e.credit > 0 ? fmt(e.credit) : ''}</td>
                  </tr>
                ))}
                {drillData.entries.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--g500)' }}>No journal entries found in this period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Totals:</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(drillData.summary.total_debit)}</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(drillData.summary.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>

      <style>{`
        .hover-row:hover { background-color: var(--brand-50); border-radius: 4px; }
      `}</style>
    </div>
  );
}

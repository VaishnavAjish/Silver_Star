import { useState, useEffect } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';
import { BookOpen, TrendingUp, Calculator, Search, BarChart3, ChevronRight, ChevronDown, Folder, FileText, X, Printer } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import ReportToolbar from '../../../shared/components/ReportToolbar';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid, Legend } from 'recharts';

const fmt = v => `₹${Math.round(Number(v)||0).toLocaleString('en-IN')}`;
const fmtBS = v => `₹${Math.abs(Number(v)||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ===== LEDGER PAGE =====
export function LedgerPage() {
  const api = useApi();
  const [accounts, setAccounts] = useState([]);
  const [selectedAcct, setSelectedAcct] = useState('');
  const [fromDate, setFromDate] = useState('2025-04-01');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [selectedJEId, setSelectedJEId] = useState(null);
  const [jeDetail, setJeDetail] = useState(null);
  const [jeLoading, setJeLoading] = useState(false);

  useEffect(() => { api.get('/api/accounts?is_group=false&status=active').then(setAccounts).catch(()=>{}); }, []);

  const loadLedger = async () => {
    if (!selectedAcct) return;
    setLoading(true);
    try {
      const data = await api.get(`/api/reports/ledger/${selectedAcct}?from_date=${fromDate}&to_date=${toDate}`);
      setLedgerData(data);
    } catch (err) {} finally { setLoading(false); }
  };

  const handleJEDoubleClick = async (jeId) => {
    if (!jeId) return;
    setSelectedJEId(jeId);
    setJeLoading(true);
    try {
      const data = await api.get(`/api/journal-entries/${jeId}`);
      setJeDetail(data);
    } catch (err) {
      console.error(err);
    } finally {
      setJeLoading(false);
    }
  };

  return (
    <div className="grid-page animate-in">

      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>From</label><DatePicker value={fromDate} onChange={v => setFromDate(v)} /></div>
        <div className="fg"><label>To</label><DatePicker value={toDate} onChange={v => setToDate(v)} /></div>
        <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={() => { setFromDate(''); setToDate(''); setLedgerData(null); }}><X size={14} /> Clear</button>
        <button className="btn btn-primary" onClick={loadLedger} disabled={!selectedAcct}><Search size={14} /> Generate</button>
        <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}><Printer size={14} /> Print</button>
      </div>

      <div className="page-section page-content">
        <div className="form-row" style={{ marginBottom: 16, background: 'var(--g50)', padding: 14, borderRadius: 10, border: '1px solid var(--g200)' }}>
          <div className="fg w"><label>Account *</label>
            <SelectDropdown value={selectedAcct} onChange={e => setSelectedAcct(e.target.value)} style={{ minWidth: 300 }}>
              <option value="">— Select Account —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </SelectDropdown>
          </div>
        </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {ledgerData && !loading && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 16px', background: 'var(--brand-50)', borderRadius: 8, border: '1px solid var(--sidebar-border)' }}>
              <div style={{ fontSize: 10, color: 'var(--brand-dark)', fontWeight: 700, textTransform: 'uppercase' }}>Opening Balance</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand-dark)' }}>{fmt(ledgerData.openingBalance)}</div>
            </div>
            <div style={{ padding: '10px 16px', background: '#E8F5E9', borderRadius: 8, border: '1px solid #A5D6A7' }}>
              <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase' }}>Total Debit</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(ledgerData.totalDebit)}</div>
            </div>
            <div style={{ padding: '10px 16px', background: '#FFEBEE', borderRadius: 8, border: '1px solid #EF9A9A' }}>
              <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase' }}>Total Credit</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--red)' }}>{fmt(ledgerData.totalCredit)}</div>
            </div>
            <div style={{ padding: '10px 16px', background: '#E3F2FD', borderRadius: 8, border: '1px solid #90CAF9' }}>
              <div style={{ fontSize: 10, color: '#0D47A1', fontWeight: 700, textTransform: 'uppercase' }}>Closing Balance</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: '#0D47A1' }}>{fmt(ledgerData.closingBalance)}</div>
            </div>
          </div>

          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead><tr><th style={{width:90}}>Date</th><th style={{width:80}}>JE No</th><th>Description</th><th style={{width:80}}>Source</th><th style={{width:100}}>Doc ID</th><th style={{width:100}}>Debit (₹)</th><th style={{width:100}}>Credit (₹)</th><th style={{width:110}}>Balance (₹)</th></tr></thead>
            <tbody>
              <tr style={{background:'var(--brand-50)', fontWeight:600}}>
                <td colSpan={5} style={{color:'var(--brand-dark)'}}>Opening Balance</td><td></td><td></td>
                <td className="num" style={{fontWeight:700, color:'var(--brand-dark)'}}>{fmt(ledgerData.openingBalance)}</td>
              </tr>
              {ledgerData.entries.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.date).toLocaleDateString('en-IN')}</td>
                  <td onDoubleClick={() => handleJEDoubleClick(e.je_id)} style={{ cursor: 'pointer' }} title="Double click to view details">
                    <span className="cell-link" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{e.je_number}</span>
                  </td>
                  <td>{e.description}</td>
                  <td>{e.source_type || '—'}</td>
                  <td>{e.doc_id || '—'}</td>
                  <td className="num" style={{color: e.debit > 0 ? 'var(--green)' : '', fontWeight: e.debit > 0 ? 600 : 400}}>{e.debit > 0 ? fmt(e.debit) : ''}</td>
                  <td className="num" style={{color: e.credit > 0 ? 'var(--red)' : '', fontWeight: e.credit > 0 ? 600 : 400}}>{e.credit > 0 ? fmt(e.credit) : ''}</td>
                  <td className="num" style={{fontWeight:600}}>{fmt(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={5} style={{textAlign:'right', fontWeight:700}}>Period Totals:</td>
              <td className="num" style={{fontWeight:700, color:'var(--green)'}}>{fmt(ledgerData.totalDebit)}</td>
              <td className="num" style={{fontWeight:700, color:'var(--red)'}}>{fmt(ledgerData.totalCredit)}</td>
              <td className="num" style={{fontWeight:700, color:'var(--brand-dark)', fontSize:13}}>{fmt(ledgerData.closingBalance)}</td>
            </tr></tfoot>
          </table>
        </>
      )}

      {/* JE Detail Modal */}
      <Modal open={!!selectedJEId} onClose={() => { setSelectedJEId(null); setJeDetail(null); }} title={jeDetail ? `Journal Entry: ${jeDetail.je_number}` : 'Loading...'} large>
        {jeLoading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
        {jeDetail && !jeLoading && (
          <div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 12, background: 'var(--g50)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--g200)' }}>
              <div><strong>Date:</strong> {new Date(jeDetail.date).toLocaleDateString('en-IN')}</div>
              <div><strong>Status:</strong> <span className={`badge ${jeDetail.status === 'posted' ? 'b-active' : 'b-draft'}`}>{jeDetail.status}</span></div>
              <div><strong>Source:</strong> {jeDetail.source_type} {jeDetail.source_id && `(#${jeDetail.source_id})`}</div>
              <div><strong>Description:</strong> {jeDetail.description || '—'}</div>
            </div>
            <table className="dgrid">
              <thead>
                <tr>
                  <th>Account</th>
                  <th style={{ width: 120 }}>Debit (₹)</th>
                  <th style={{ width: 120 }}>Credit (₹)</th>
                  <th>Narration</th>
                </tr>
              </thead>
              <tbody>
                {jeDetail.lines?.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.account_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--g500)' }}>{l.account_code}</div>
                    </td>
                    <td className="num" style={{ color: Number(l.debit) > 0 ? 'var(--green)' : '' }}>{Number(l.debit) > 0 ? fmt(l.debit) : ''}</td>
                    <td className="num" style={{ color: Number(l.credit) > 0 ? 'var(--red)' : '' }}>{Number(l.credit) > 0 ? fmt(l.credit) : ''}</td>
                    <td style={{ fontSize: 11, color: 'var(--g600)' }}>{l.narration || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--g50)', fontWeight: 700 }}>
                  <td style={{ textAlign: 'right' }}>Totals</td>
                  <td className="num" style={{ color: 'var(--green)' }}>{fmt(jeDetail.lines?.reduce((sum, l) => sum + Number(l.debit), 0))}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{fmt(jeDetail.lines?.reduce((sum, l) => sum + Number(l.credit), 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>

      </div>
    </div>
  );
}

// ===== PROFIT & LOSS PAGE =====
export function PnLPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState('2025-04-01');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('INR');
  const [format, setFormat] = useState('INDIAN');
  const [decimals, setDecimals] = useState(2);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [purchasePopup, setPurchasePopup] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await api.get(`/api/reports/pnl?from_date=${fromDate}&to_date=${toDate}&currency=${currency}&format=${format}&decimals=${decimals}`)); }
    catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [currency, format, decimals]);

  return (
    <div className="grid-page animate-in">

      <ReportToolbar 
        currency={currency} onCurrencyChange={setCurrency}
        format={format} onFormatChange={setFormat}
        decimals={decimals} onDecimalsChange={setDecimals}
        onPrint={() => setTimeout(() => window.print(), 100)}
      />

      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>From</label><DatePicker value={fromDate} onChange={v => setFromDate(v)} /></div>
        <div className="fg"><label>To</label><DatePicker value={toDate} onChange={v => setToDate(v)} /></div>
        <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={() => { setFromDate(''); setToDate(''); api.get('/api/reports/pnl').then(setData).catch(()=>{}); }}><X size={14} /> Clear</button>
        <button className="btn btn-primary" onClick={load}><Search size={14} /> Generate</button>
        <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}><Printer size={14} /> Print</button>
      </div>

      <div className="page-section page-content">

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {data && !loading && (() => {
        const chartData = [
          { name: 'Revenue', value: Math.abs(data.totalRevenue || 0), raw: data.totalRevenue || 0, color: '#3b82f6', label: 'Income generated' },
          { name: 'COGS', value: Math.abs(data.totalCogs || 0), raw: data.totalCogs || 0, color: '#f97316', label: 'Direct costs' },
          { name: 'OpEx', value: Math.abs(data.totalOpex || 0), raw: data.totalOpex || 0, color: '#ef4444', label: 'Indirect expenses' },
          { name: 'Net Profit', value: Math.abs(data.netProfit || 0), raw: data.netProfit || 0, color: (data.netProfit || 0) >= 0 ? '#22c55e' : '#ef4444', label: 'Bottom line' },
        ];
        
        return (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <table className="dgrid" style={{ fontSize: 13, flex: 1, minWidth: 500 }}>
              <thead><tr><th style={{width:'60%'}}>Particulars</th><th style={{textAlign:'right'}}>Amount (₹)</th></tr></thead>
              <tbody>
                <tr style={{background:'var(--brand-50)'}}><td style={{fontWeight:700, color:'var(--brand-dark)'}}>Revenue</td><td></td></tr>
                {data.revenue.map((r, i) => (
                  <tr key={i}>
                    <td style={{paddingLeft:30}}>{r.name}</td>
                    <td
                      className="num"
                      title={r.id ? 'Click to view transactions' : undefined}
                      style={{ 
                        cursor: r.id ? 'pointer' : 'default',
                        color: r.id ? 'var(--brand)' : 'inherit',
                      }}
                      onMouseEnter={r.id ? e => e.currentTarget.style.textDecoration = 'underline' : undefined}
                      onMouseLeave={r.id ? e => e.currentTarget.style.textDecoration = 'none' : undefined}
                      onClick={r.id ? () => navigate(`/reports/transactions?account_id=${r.id}&from=${fromDate}&to=${toDate}&account_name=${encodeURIComponent(r.name)}`) : undefined}
                    >
                      {r.amount_display}
                    </td>
                  </tr>
                ))}
                <tr style={{fontWeight:700, borderTop:'2px solid var(--g300)'}}><td>Total Revenue</td><td className="num" style={{color:'var(--green)', fontSize:14, whiteSpace: 'pre-wrap'}}>{data.totalRevenue_display}</td></tr>

                <tr><td>&nbsp;</td><td></td></tr>
                <tr style={{background:'#FFF3E0'}}><td style={{fontWeight:700, color:'#E65100'}}>Cost of Goods Sold</td><td></td></tr>
                <tr>
                  <td style={{paddingLeft:30}}>Opening Stock</td>
                  <td 
                    className="num"
                    title={(data.inventory?.openingStock !== 0) ? 'Click to view opening stock' : undefined}
                    style={{ 
                      cursor: (data.inventory?.openingStock !== 0) ? 'pointer' : 'default',
                      color: (data.inventory?.openingStock !== 0) ? 'var(--brand)' : 'inherit',
                    }}
                    onMouseEnter={(data.inventory?.openingStock !== 0) ? e => e.currentTarget.style.textDecoration = 'underline' : undefined}
                    onMouseLeave={(data.inventory?.openingStock !== 0) ? e => e.currentTarget.style.textDecoration = 'none' : undefined}
                    onClick={(data.inventory?.openingStock !== 0) ? () => navigate('/inventory/opening') : undefined}
                  >
                    {data.inventory?.openingStock_display || '-'}
                  </td>
                </tr>
                <tr>
                  <td style={{paddingLeft:30}}>Purchases</td>
                  <td 
                    className="num"
                    title={(data.inventory?.purchases !== 0) ? 'Click to view purchases breakdown' : undefined}
                    style={{ 
                      cursor: (data.inventory?.purchases !== 0) ? 'pointer' : 'default',
                      color: (data.inventory?.purchases !== 0) ? 'var(--brand)' : 'inherit',
                    }}
                    onMouseEnter={(data.inventory?.purchases !== 0) ? e => e.currentTarget.style.textDecoration = 'underline' : undefined}
                    onMouseLeave={(data.inventory?.purchases !== 0) ? e => e.currentTarget.style.textDecoration = 'none' : undefined}
                    onClick={(data.inventory?.purchases !== 0) ? () => setPurchasePopup(true) : undefined}
                  >
                    {data.inventory?.purchases_display || '-'}
                  </td>
                </tr>
                <tr>
                  <td style={{paddingLeft:30}}>Less: Closing Stock <span style={{color:'var(--g500)', fontSize:11}}>({data.inventory?.closingMode})</span></td>
                  <td 
                    className="num"
                    title={(data.inventory?.closingStock !== 0) ? 'Click to view closing stock details' : undefined}
                    style={{ 
                      cursor: (data.inventory?.closingStock !== 0) ? 'pointer' : 'default',
                      color: (data.inventory?.closingStock !== 0) ? 'var(--brand)' : 'inherit',
                    }}
                    onMouseEnter={(data.inventory?.closingStock !== 0) ? e => e.currentTarget.style.textDecoration = 'underline' : undefined}
                    onMouseLeave={(data.inventory?.closingStock !== 0) ? e => e.currentTarget.style.textDecoration = 'none' : undefined}
                    onClick={(data.inventory?.closingStock !== 0) ? () => navigate('/inventory/closing') : undefined}
                  >
                    -{data.inventory?.closingStock_display || '-'}
                  </td>
                </tr>
                <tr style={{fontWeight:700, borderTop:'2px solid var(--g300)'}}><td>Total COGS</td><td className="num" style={{color:'var(--red)', whiteSpace: 'pre-wrap'}}>{data.totalCogs_display}</td></tr>

                <tr><td>&nbsp;</td><td></td></tr>
                <tr style={{background:'#E8F5E9', fontWeight:700, fontSize:14}}><td style={{color:'var(--green)'}}>Gross Profit</td><td className="num" style={{color:'var(--green)', whiteSpace: 'pre-wrap'}}>{data.grossProfit_display}</td></tr>

                <tr><td>&nbsp;</td><td></td></tr>
                <tr style={{background:'var(--g100)'}}><td style={{fontWeight:700}}>Operating Expenses</td><td></td></tr>
                {data.opex.map((r, i) => (
                  <tr key={i}>
                    <td style={{paddingLeft:30}}>{r.name}</td>
                    <td
                      className="num"
                      title={(r.id && r.amount !== 0) ? 'Click to view transactions' : undefined}
                      style={{ 
                        cursor: (r.id && r.amount !== 0) ? 'pointer' : 'default',
                        color: (r.id && r.amount !== 0) ? 'var(--brand)' : 'inherit',
                      }}
                      onMouseEnter={(r.id && r.amount !== 0) ? e => e.currentTarget.style.textDecoration = 'underline' : undefined}
                      onMouseLeave={(r.id && r.amount !== 0) ? e => e.currentTarget.style.textDecoration = 'none' : undefined}
                      onClick={(r.id && r.amount !== 0) ? () => navigate(`/reports/transactions?account_id=${r.id}&from=${fromDate}&to=${toDate}&account_name=${encodeURIComponent(r.name)}`) : undefined}
                    >
                      {r.amount_display}
                    </td>
                  </tr>
                ))}
                <tr style={{fontWeight:700, borderTop:'2px solid var(--g300)'}}><td>Total OpEx</td><td className="num" style={{whiteSpace: 'pre-wrap'}}>{data.totalOpex_display}</td></tr>

                <tr><td>&nbsp;</td><td></td></tr>
                <tr style={{background: data.netProfit >= 0 ? '#E8F5E9' : '#FFEBEE', fontWeight:700, fontSize:15, borderTop:'3px solid var(--brand)'}}>
                  <td style={{color: data.netProfit >= 0 ? 'var(--brand-dark)' : 'var(--red)'}}>Net Profit</td>
                  <td className="num" style={{color: data.netProfit >= 0 ? 'var(--brand-dark)' : 'var(--red)', fontSize:15, whiteSpace: 'pre-wrap'}}>{data.netProfit_display}</td>
                </tr>
                <tr><td style={{color:'var(--g500)', fontSize:11}}>Net Margin</td><td className="num" style={{color:'var(--g500)', fontSize:11}}>{data.netMargin}%</td></tr>
              </tbody>
            </table>

            {/* Financial Breakdown Chart Card */}
            <div className="no-print" style={{ background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, padding: '24px 20px', width: 400, flexShrink: 0 }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--g900)' }}>Financial Breakdown</h3>
                <p style={{ fontSize: 12, color: 'var(--g500)', marginTop: 2 }}>Revenue vs COGS vs Expenses</p>
              </div>
              
              <div style={{ height: 160, width: '100%', marginBottom: 32 }}>
                <ResponsiveContainer width="99%" height={160} debounce={50}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--g500)' }} dy={10} />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      width={60}
                      tickMargin={4}
                      tick={{ fontSize: 11, fill: 'var(--g500)' }} 
                      tickFormatter={(v) => new Intl.NumberFormat('en-IN', { 
                        style: 'currency', 
                        currency: 'INR', 
                        notation: 'compact', 
                        maximumFractionDigits: 2 
                      }).format(v).replace(/\s/g, '')}
                    />
                    <Tooltip 
                      cursor={{ fill: 'transparent' }} 
                      formatter={(v, n, props) => [`₹${props.payload.raw.toLocaleString('en-IN')}`, 'Amount']} 
                      contentStyle={{ borderRadius: 6, border: '1px solid var(--g200)', fontSize: 12, fontWeight: 600 }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={32}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {chartData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--g900)', fontWeight: 500 }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>{d.label}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--g900)' }}>
                      {fmt(d.raw)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      {data && !loading && purchasePopup && (
        <Modal open={purchasePopup} onClose={() => setPurchasePopup(false)} title="Purchases Breakdown">
          <div style={{ padding: '16px' }}>
            <table className="dgrid">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data?.inventory?.purchaseBreakdown?.map((cat, i) => (
                  <tr key={i}>
                    <td 
                      style={{ cursor: 'pointer', color: 'var(--brand)', textTransform: 'capitalize' }}
                      onClick={() => {
                        sessionStorage.setItem('purchase_notes_filters', JSON.stringify({ type: cat.category, date_from: fromDate, date_to: toDate }));
                        navigate('/purchase-notes');
                      }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {cat.category}
                    </td>
                    <td className="num">{cat.amount_display}</td>
                  </tr>
                ))}
                {(!data?.inventory?.purchaseBreakdown || data.inventory.purchaseBreakdown.length === 0) && (
                  <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--g500)' }}>No purchases found in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      </div>
    </div>
  );
}

// ===== TRIAL BALANCE PAGE (TALLY STYLE) =====
export function TrialBalancePage() {
  const api      = useApi();
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState('2025-04-01');
  const [toDate,   setToDate]   = useState(new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('INR');
  const [format, setFormat] = useState('INDIAN');
  const [decimals, setDecimals] = useState(2);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  const load = async (fd, td) => {
    setLoading(true);
    try {
      const f = fd || fromDate || '2000-01-01';
      const t = td || toDate   || '2099-12-31';
      const d = await api.get(`/api/reports/trial-balance-hierarchy?from_date=${f}&to_date=${t}&currency=${currency}&format=${format}&decimals=${decimals}`);
      setData(d);
      const ids = new Set();
      const autoExpand = (nodes, depth) => {
        for (const n of nodes) {
          if (n.children?.length && depth < 2) { ids.add(n.id); autoExpand(n.children, depth + 1); }
        }
      };
      autoExpand(d.roots || [], 0);
      setExpanded(ids);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [currency, format, decimals]);

  const toggle = (id) => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const drillTo = (node) =>
    navigate(`/reports/transactions?account_id=${node.id}&from=${fromDate}&to=${toDate}&account_name=${encodeURIComponent(node.name)}`);

  const hoverOn  = e => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.textDecoration = 'underline'; };
  const hoverOff = e => { e.currentTarget.style.color = ''; e.currentTarget.style.textDecoration = ''; };

  const renderRows = (nodes, depth = 0) =>
    nodes.flatMap(node => {
      const isExp   = expanded.has(node.id);
      const hasKids = (node.children?.length || 0) > 0;
      const isGroup = node.is_group;
      const showAmt = !hasKids || !isExp;
      
      const drVal = node.dr_val;
      const crVal = node.cr_val;

      const bg  = !isGroup ? 'transparent' : depth === 0 ? '#eef1f8' : depth === 1 ? '#f4f6fb' : '#fafafa';
      const fw  = depth === 0 ? 700 : depth === 1 ? 600 : isGroup ? 500 : 400;
      const ind = depth * 20;

      const headerRow = (
        <tr key={node.id} style={{ background: bg, fontSize: 12 }}>
          <td style={{ paddingLeft: ind + 4 }}>
            {hasKids
              ? <button onClick={() => toggle(node.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginRight: 3, lineHeight: 1, verticalAlign: 'middle' }}>
                  {isExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
              : <span style={{ display: 'inline-block', width: 14 }} />}
            {isGroup
              ? <Folder   size={11} style={{ color: '#5c7cfa', marginRight: 4, verticalAlign: 'middle' }} />
              : <FileText size={10} style={{ color: '#ccc',    marginRight: 4, verticalAlign: 'middle' }} />}
            <span style={{ fontWeight: fw }}>{node.name}</span>
            {!isGroup && node.code && (
              <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--g400)' }}>{node.code}</span>
            )}
          </td>
          <td
            className="num"
            title={!isGroup && drVal > 0 ? 'Click to view transactions' : undefined}
            style={{ fontFamily: 'var(--mono)', fontWeight: fw, cursor: !isGroup && drVal > 0 ? 'pointer' : 'default' }}
            onClick={!isGroup && drVal > 0 ? () => drillTo(node) : undefined}
            onMouseEnter={!isGroup && drVal > 0 ? hoverOn : undefined}
            onMouseLeave={!isGroup && drVal > 0 ? hoverOff : undefined}
          >
            {showAmt && drVal > 0 ? (node.dr_val_display || '') : ''}
          </td>
          <td
            className="num"
            title={!isGroup && crVal > 0 ? 'Click to view transactions' : undefined}
            style={{ fontFamily: 'var(--mono)', fontWeight: fw, cursor: !isGroup && crVal > 0 ? 'pointer' : 'default' }}
            onClick={!isGroup && crVal > 0 ? () => drillTo(node) : undefined}
            onMouseEnter={!isGroup && crVal > 0 ? hoverOn : undefined}
            onMouseLeave={!isGroup && crVal > 0 ? hoverOff : undefined}
          >
            {showAmt && crVal > 0 ? (node.cr_val_display || '') : ''}
          </td>
        </tr>
      );

      const childRows = hasKids && isExp ? renderRows(node.children, depth + 1) : [];

      const totalRow = hasKids && isExp ? (() => {
        const tDr  = node.dr_val;
        const tCr  = node.cr_val;
        return (
          <tr key={`${node.id}__total`} style={{ background: bg, borderTop: `1px solid ${depth === 0 ? 'var(--g300)' : 'var(--g200)'}` }}>
            <td style={{ paddingLeft: ind + 28, fontWeight: 700, color: 'var(--g600)', fontSize: 11 }}>
              Total {node.name}
            </td>
            <td className="num" style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: tDr > 0 ? 'var(--green)' : '' }}>
              {tDr > 0 ? (node.dr_val_display || '') : ''}
            </td>
            <td className="num" style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: tCr > 0 ? 'var(--red)' : '' }}>
              {tCr > 0 ? (node.cr_val_display || '') : ''}
            </td>
          </tr>
        );
      })() : null;

      return [headerRow, ...childRows, ...(totalRow ? [totalRow] : [])];
    });

  return (
    <div className="grid-page animate-in">

      <ReportToolbar 
        currency={currency} onCurrencyChange={setCurrency}
        format={format} onFormatChange={setFormat}
        decimals={decimals} onDecimalsChange={setDecimals}
        onPrint={() => setTimeout(() => window.print(), 100)}
      />

      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>From</label><DatePicker value={fromDate} onChange={v => setFromDate(v)} /></div>
        <div className="fg"><label>To</label><DatePicker value={toDate} onChange={v => setToDate(v)} /></div>
        {(fromDate || toDate) && (
          <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={() => { setFromDate(''); setToDate(''); load('', ''); }}><X size={14} /> Clear</button>
        )}
        <button className="btn btn-primary" onClick={() => load()}><Search size={14} /> Generate</button>
      </div>

      <div className="page-section page-content" style={{ display: 'flex', flexDirection: 'column' }}>
        {loading && <div className="empty-state"><div className="spinner" /></div>}

        {data && !loading && (
          <>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 8, marginBottom: 14,
              background: data.balanced ? '#E8F5E9' : '#FFEBEE',
              border: `1px solid ${data.balanced ? '#A5D6A7' : '#EF9A9A'}`,
              color: data.balanced ? 'var(--green)' : 'var(--red)',
              fontWeight: 700, fontSize: 13,
            }}>
              {data.balanced
                ? '✓ Balanced'
                : `⚠ Out of balance by ₹${Math.abs(data.grandDebit - data.grandCredit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
              <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--g500)' }}>
                {data.period.from} → {data.period.to}
              </span>
            </div>

            <div className="print-scroll-reset" style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--g200)', borderRadius: 8, backgroundColor: '#fff' }}>
              <table className="dgrid" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '10px 12px', verticalAlign: 'middle' }}>Account</th>
                    <th className="text-right" style={{ width: 180, padding: '10px 12px', verticalAlign: 'middle' }}>Debit</th>
                    <th className="text-right" style={{ width: 180, padding: '10px 12px', verticalAlign: 'middle' }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {renderRows(data.roots || [])}
                </tbody>
                <tbody style={{ zIndex: 10 }}>
                  <tr style={{ fontWeight: 800 }}>
                    <td style={{ position: 'sticky', bottom: -1, zIndex: 10, color: 'var(--brand-dark)', fontSize: 13, background: 'var(--brand-50)', borderTop: '3px solid var(--brand)', borderBottom: 'none' }}>Grand Total</td>
                    <td className="num" style={{ position: 'sticky', bottom: -1, zIndex: 10, fontFamily: 'var(--mono)', color: 'var(--green)', fontSize: 13, background: 'var(--brand-50)', borderTop: '3px solid var(--brand)', borderBottom: 'none', whiteSpace: 'pre-wrap' }}>
                      {data.grandDebit_display}
                    </td>
                    <td className="num" style={{ position: 'sticky', bottom: -1, zIndex: 10, fontFamily: 'var(--mono)', color: 'var(--red)', fontSize: 13, background: 'var(--brand-50)', borderTop: '3px solid var(--brand)', borderBottom: 'none', whiteSpace: 'pre-wrap' }}>
                      {data.grandCredit_display}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===== BALANCE SHEET PAGE =====
export function BalanceSheetPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('INR');
  const [format, setFormat] = useState('INDIAN');
  const [decimals, setDecimals] = useState(2);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [bsExp,    setBsExp]    = useState(new Set());

  const load = async (date) => {
    setLoading(true);
    try {
      const d = await api.get(`/api/reports/balance-sheet?asOfDate=${date}&currency=${currency}&format=${format}&decimals=${decimals}`);
      setData(d);
      if (d.hierarchy) {
        const ids = new Set();
        const collectL1 = (nodes) => { for (const n of nodes) { if (n.children?.length) ids.add(n.id); } };
        collectL1(d.hierarchy.assets     || []);
        collectL1(d.hierarchy.liabilities || []);
        collectL1(d.hierarchy.equity     || []);
        setBsExp(ids);
      }
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(asOfDate); }, [currency, format, decimals]);

  const handleDateChange = (v) => { setAsOfDate(v); load(v); };

  const toggleBS = (id) => setBsExp(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const renderHierarchyRows = (nodes, depth = 0) =>
    nodes.flatMap(node => {
      const isExpanded  = bsExp.has(node.id);
      const hasChildren = (node.children?.length || 0) > 0;
      const isGroup     = node.is_group;
      const balance     = isGroup ? (node.group_total ?? node.balance) : node.balance;
      const indent      = depth * 16;
      const bgColor     = !isGroup ? 'transparent'
        : depth === 0 ? '#eef1f8'
        : depth === 1 ? '#f4f6fb'
        : '#f9fafb';

      const row = (
        <tr key={node.id} style={{ background: bgColor }}>
          <td style={{ width: 70, color: 'var(--g500)', fontSize: 11 }}>{node.code}</td>
          <td style={{ paddingLeft: indent + 4 }}>
            {hasChildren ? (
              <button
                onClick={() => toggleBS(node.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: 3, padding: 0, lineHeight: 1, verticalAlign: 'middle' }}
              >
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            ) : (
              <span style={{ marginRight: 14 }} />
            )}
            {isGroup
              ? <Folder size={11} style={{ color: '#5c7cfa', marginRight: 4, verticalAlign: 'middle' }} />
              : <FileText size={10} style={{ color: '#ccc', marginRight: 4, verticalAlign: 'middle' }} />}
            <span style={{ fontWeight: isGroup ? 700 : 400 }}>{node.name}</span>
          </td>
          <td
            className="num"
            title={!isGroup && node.id !== '__re' ? 'Click to view transactions' : undefined}
            style={{
              fontFamily: 'var(--mono)',
              fontWeight: isGroup ? 700 : 400,
              cursor: !isGroup && node.id !== '__re' ? 'pointer' : 'default',
            }}
            onClick={!isGroup && node.id !== '__re' ? () => navigate(
              `/reports/transactions?account_id=${node.id}&from=1900-01-01&to=${asOfDate}&account_name=${encodeURIComponent(node.name)}`
            ) : undefined}
            onMouseEnter={!isGroup && node.id !== '__re' ? e => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.textDecoration = 'underline'; } : undefined}
            onMouseLeave={!isGroup && node.id !== '__re' ? e => { e.currentTarget.style.color = ''; e.currentTarget.style.textDecoration = ''; } : undefined}
          >
            {(!isGroup || !hasChildren || !isExpanded) ? (node.balance_display || '') : ''}
          </td>
        </tr>
      );

      const childRows = hasChildren && isExpanded ? renderHierarchyRows(node.children, depth + 1) : [];
      return [row, ...childRows];
    });

  const HierarchySection = ({ title, nodes, totalDisplay, headerBg, headerColor }) => (
    <tbody>
      <tr style={{ background: headerBg, fontWeight: 800 }}>
        <td colSpan={3} style={{ color: headerColor }}>{title}</td>
      </tr>
      {nodes.length > 0
        ? renderHierarchyRows(nodes)
        : <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--g400)', padding: '10px 0' }}>—</td></tr>}
      <tr style={{ fontWeight: 800, borderTop: '2px solid var(--g300)' }}>
        <td colSpan={2} style={{ color: headerColor }}>Total {title}</td>
        <td className="num" style={{ color: headerColor, fontFamily: 'var(--mono)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{totalDisplay}</td>
      </tr>
    </tbody>
  );

  return (
    <div className="grid-page animate-in">

      <ReportToolbar 
        currency={currency} onCurrencyChange={setCurrency}
        format={format} onFormatChange={setFormat}
        decimals={decimals} onDecimalsChange={setDecimals}
        onPrint={() => setTimeout(() => window.print(), 100)}
      />

      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>As of Date</label><DatePicker value={asOfDate} onChange={handleDateChange} /></div>
        <button className="btn btn-primary" onClick={() => load(asOfDate)}><Search size={14} /> Generate</button>
      </div>

      <div className="page-section page-content" style={{ display: 'flex', flexDirection: 'column' }}>

      <div className="print-only" style={{ display: 'none', textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>SILVERSTAR DIAM PVT. LTD.</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Balance Sheet</div>
        <div style={{ fontSize: 12 }}>As of {data?.asOfDate}</div>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {data && !loading && (
        <>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', borderRadius: 8, marginBottom: 16,
            background: data.isBalanced ? '#E8F5E9' : '#FFEBEE',
            border: `1px solid ${data.isBalanced ? '#A5D6A7' : '#EF9A9A'}`,
            color: data.isBalanced ? 'var(--green)' : 'var(--red)',
            fontWeight: 700, fontSize: 13,
          }}>
            {data.isBalanced
              ? '✓ Balanced'
              : `⚠ Out of balance by ₹${Math.abs(data.totalAssets - data.totalLiabilities - data.totalEquity - data.retainedEarnings).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--g600)' }}>as of {data.asOfDate}</span>
          </div>

          <div className="print-scroll-reset" style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--g200)', borderRadius: 8, backgroundColor: '#fff', maxWidth: 820, margin: '0 auto 16px', width: '100%' }}>
            <table className="dgrid" style={{ fontSize: 12, margin: 0, borderStyle: 'none', borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Code</th>
                <th>Particulars</th>
                <th style={{ width: 160 }} className="num">Amount</th>
              </tr>
            </thead>

            {data.hierarchy ? (
              <>
                <HierarchySection
                  title="LIABILITIES"
                  nodes={data.hierarchy.liabilities || []}
                  totalDisplay={data.totalLiabilities_display}
                  headerBg="#FFEBEE" headerColor="#c62828"
                />
                <HierarchySection
                  title="EQUITY"
                  nodes={[
                    ...(data.hierarchy.equity || []),
                    { id: '__re', code: '', name: 'Current Year Profit (Retained Earnings)', is_group: false, balance_display: data.retainedEarnings_display, children: [] },
                  ]}
                  totalDisplay={data.totalEquity_display} 
                  headerBg="var(--brand-50)" headerColor="var(--brand-dark)"
                />
                <HierarchySection
                  title="ASSETS"
                  nodes={data.hierarchy.assets || []}
                  totalDisplay={data.totalAssets_display}
                  headerBg="#E3F2FD" headerColor="#1565c0"
                />
              </>
            ) : (
              <tbody>
                <tr style={{ background: '#FFEBEE', fontWeight: 800 }}><td colSpan={3}>LIABILITIES</td></tr>
                {data.liabilities.map((r, i) => <tr key={i}><td style={{ color: 'var(--g500)' }}>{r.code}</td><td>{r.name}</td><td className="num">{r.balance_display}</td></tr>)}
                <tr style={{ fontWeight: 800 }}><td colSpan={2}>Total Liabilities</td><td className="num">{data.totalLiabilities_display}</td></tr>
                <tr style={{ background: 'var(--brand-50)', fontWeight: 800 }}><td colSpan={3}>EQUITY</td></tr>
                {data.equity.map((r, i) => <tr key={i}><td style={{ color: 'var(--g500)' }}>{r.code}</td><td>{r.name}</td><td className="num">{r.balance_display}</td></tr>)}
                <tr><td style={{ color: 'var(--g500)' }} /><td>Current Year Profit</td><td className="num">{data.retainedEarnings_display}</td></tr>
                <tr style={{ fontWeight: 800 }}><td colSpan={2}>Total Equity</td><td className="num">{data.totalEquity_display}</td></tr>
                <tr style={{ background: '#E3F2FD', fontWeight: 800 }}><td colSpan={3}>ASSETS</td></tr>
                {data.assets.map((r, i) => <tr key={i}><td style={{ color: 'var(--g500)' }}>{r.code}</td><td>{r.name}</td><td className="num">{r.balance_display}</td></tr>)}
                <tr style={{ fontWeight: 800 }}><td colSpan={2}>Total Assets</td><td className="num">{data.totalAssets_display}</td></tr>
              </tbody>
            )}
          </table>
          <div className="no-print" style={{ position: 'sticky', bottom: 0, zIndex: 10, flexShrink: 0, padding: 12, background: 'var(--brand-50)', border: '1px solid var(--sidebar-border)', borderRadius: 8, display: 'flex', gap: 28, flexWrap: 'wrap', maxWidth: 820, margin: '0 auto' }}>
            {[
              { label: 'Total Assets',                  valueDisplay: data.totalAssets_display,                              color: '#1565c0' },
              { label: 'Total Liabilities',             valueDisplay: data.totalLiabilities_display,                         color: 'var(--red)' },
              { label: 'Total Equity incl. Retained',   valueDisplay: data.totalEquity_display,      color: 'var(--brand-dark)' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: s.color }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: s.color, whiteSpace: 'pre-wrap' }}>{s.valueDisplay}</div>
              </div>
            ))}
          </div>
        </div>

        </>
      )}
      </div>
    </div>
  );
}

// ===== COSTING REPORT PAGE =====
export function CostingPage() {
  const api = useApi();
  const [fromDate, setFromDate] = useState('2025-01-01');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await api.get(`/api/reports/costing?from_date=${fromDate}&to_date=${toDate}`)); }
    catch (err) {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const icons = ['🌱', '💨', '⚡', '👷', '📦', '🔧'];

  return (
    <div className="grid-page animate-in">

      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>From</label><DatePicker value={fromDate} onChange={v => setFromDate(v)} /></div>
        <div className="fg"><label>To</label><DatePicker value={toDate} onChange={v => setToDate(v)} /></div>
        <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={() => { setFromDate(''); setToDate(''); api.get('/api/reports/costing').then(setData).catch(()=>{}); }}><X size={14} /> Clear</button>
        <button className="btn btn-primary" onClick={load}><Search size={14} /> Generate</button>
        <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}><Printer size={14} /> Print</button>
      </div>

      <div className="page-section page-content">
        {loading && <div className="empty-state"><div className="spinner" /></div>}

        {data && !loading && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { v: data.summary.total_growths, l: 'Growth Cycles', bg: 'var(--brand-50)', c: 'var(--brand-dark)', bc: 'var(--sidebar-border)' },
                { v: data.summary.total_lots, l: 'Total Lots', bg: '#E3F2FD', c: '#0D47A1', bc: '#90CAF9' },
                { v: `${Number(data.summary.total_weight).toFixed(2)} ct`, l: 'Total Weight', bg: '#E3F2FD', c: '#0D47A1', bc: '#90CAF9' },
                { v: `₹${data.summary.cost_per_carat?.toLocaleString('en-IN')}`, l: 'Cost / Carat', bg: '#FFF3E0', c: '#E65100', bc: '#FFCC80' },
                { v: `₹${data.summary.avg_sale_rate?.toLocaleString('en-IN')}`, l: 'Avg Sale Rate', bg: '#E8F5E9', c: '#2E7D32', bc: '#A5D6A7' },
                { v: `₹${data.summary.margin_per_carat?.toLocaleString('en-IN')}`, l: 'Margin / Carat', bg: data.summary.margin_per_carat >= 0 ? '#E8F5E9' : '#FFEBEE', c: data.summary.margin_per_carat >= 0 ? '#2E7D32' : 'var(--red)', bc: data.summary.margin_per_carat >= 0 ? '#A5D6A7' : '#EF9A9A' },
              ].map((c, i) => (
                <div key={i} style={{ padding: 12, background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.c, fontFamily: 'var(--mono)' }}>{c.v}</div>
                  <div style={{ fontSize: 10, color: c.c, fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>{c.l}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              <div style={{ width: '100%' }}>
                <table className="dgrid" style={{ fontSize: 12.5, width: '100%' }}>
                  <thead><tr><th style={{width:'40%'}}>Cost Component</th><th style={{width:'20%'}}>Total (₹)</th><th style={{width:'20%'}}>Per Carat (₹)</th><th style={{width:'20%'}}>% of Total</th></tr></thead>
                  <tbody>
                    {data.components.map((c, i) => (
                      <tr key={i}><td><span style={{marginRight:6}}>{icons[i]}</span>{c.name}</td><td className="num">{fmt(c.amount)}</td><td className="num">{fmt(c.per_carat)}</td><td className="num">{c.pct}%</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{background:'var(--brand-50)'}}>
                    <td style={{fontWeight:700, color:'var(--brand-dark)'}}>Total Cost per Carat</td>
                    <td className="num" style={{fontWeight:700, color:'var(--brand-dark)', fontSize:14}}>{fmt(data.summary.grand_total)}</td>
                    <td className="num" style={{fontWeight:700, color:'var(--brand-dark)', fontSize:14}}>₹{data.summary.cost_per_carat?.toLocaleString('en-IN')}/ct</td>
                    <td className="num" style={{fontWeight:700, color:'var(--brand-dark)'}}>100%</td>
                  </tr></tfoot>
                </table>
              </div>
              
              <div style={{ width: '100%', height: 350, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, padding: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Cost Breakdown Analysis</h3>
                  <p style={{ fontSize: 12, color: '#64748b' }}>Component-wise cost distribution</p>
                </div>
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%' }}>
                  <ResponsiveContainer width="99%" height={280} debounce={50}>
                    <BarChart data={data.components.filter(c => c.amount > 0)} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="name" 
                        tick={{fontSize: 11, fill: '#64748b'}} 
                        tickLine={false} 
                        axisLine={{stroke: '#e2e8f0'}} 
                        interval={0} 
                      />
                      <YAxis 
                        tickFormatter={v => `₹${v}`} 
                        tick={{fontSize: 11, fill: '#64748b'}} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <Tooltip 
                        formatter={(value) => `₹${value.toLocaleString('en-IN')}`}
                        cursor={{fill: '#f1f5f9'}}
                        contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      />
                      <Bar 
                        dataKey="amount" 
                        name="Total Cost (₹)" 
                        fill="#1e40af" 
                        radius={[4, 4, 0, 0]} 
                        maxBarSize={60} 
                        isAnimationActive={true}
                        animationBegin={100}
                        animationDuration={1500}
                        animationEasing="ease-out"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
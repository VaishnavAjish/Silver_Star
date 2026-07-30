import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useTabs } from '../../../core/tabs';
import Modal from '../../../shared/components/Modal';
import DatePicker from '../../../shared/components/DatePicker';
import { Search, Printer, CheckCircle2, AlertTriangle, ArrowUpRight, ArrowDownRight, Landmark, RefreshCw, Filter } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const fmt = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtBS = v => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLORS = ['#0D7C5F', '#1565C0', '#E87722', '#D32F2F', '#455A64', '#7B1FA2', '#FBC02D', '#0097A7', '#6D4C41', '#546E7A'];

export default function FundUtilizationDashboardPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { openTab } = useTabs();

  const fyYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [fromDate, setFromDate] = useState(`${fyYear}-04-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filter state for detail tables
  const [selectedReceiptCategory, setSelectedReceiptCategory] = useState('ALL');
  const [selectedPaymentCategory, setSelectedPaymentCategory] = useState('ALL');
  const [selectedBankId, setSelectedBankId] = useState('ALL');

  // Account Ledger Drill-down Modal
  const [drillDownAcct, setDrillDownAcct] = useState(null);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reports/fund-utilization?from_date=${fromDate}&to_date=${toDate}`);
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
    opening_balance = 0,
    total_receipts = 0,
    total_payments = 0,
    internal_transfers = 0,
    net_cash_movement = 0,
    expected_closing = 0,
    actual_closing = 0,
    reconciliation_difference = 0,
    is_reconciled = true,
    receipts_by_category = [],
    payments_by_category = [],
    bank_accounts = [],
    receipt_details = [],
    payment_details = []
  } = data || {};

  // Filtered detail rows
  const filteredReceiptDetails = receipt_details.filter(r => {
    if (selectedReceiptCategory !== 'ALL' && r.category_key !== selectedReceiptCategory) return false;
    if (selectedBankId !== 'ALL' && String(r.bank_account_id) !== String(selectedBankId)) return false;
    return true;
  });

  const filteredPaymentDetails = payment_details.filter(p => {
    if (selectedPaymentCategory !== 'ALL' && p.category_key !== selectedPaymentCategory) return false;
    if (selectedBankId !== 'ALL' && String(p.bank_account_id) !== String(selectedBankId)) return false;
    return true;
  });

  return (
    <div className="grid-page animate-in">
      {/* ─── HEADER BAR ─── */}
      <div className="page-section page-actions-bar no-print">
        <div className="fg"><label>Period From</label><DatePicker value={fromDate} onChange={setFromDate} /></div>
        <div className="fg"><label>Period To</label><DatePicker value={toDate} onChange={setToDate} /></div>
        <div className="fg">
          <label>Bank/Cash Account</label>
          <select className="input" value={selectedBankId} onChange={e => setSelectedBankId(e.target.value)}>
            <option value="ALL">All Bank & Cash Accounts</option>
            {bank_accounts.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={fetchDashboard} disabled={loading}>
          {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Search size={14} />} 
          Generate Report
        </button>
        <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}><Printer size={14} /> Print Report</button>
      </div>

      <div className="page-section page-content" style={{ padding: '24px', background: 'transparent', border: 'none', overflowY: 'auto' }}>
        
        {/* ─── RECONCILIATION BANNER ─── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justify: 'space-between',
          padding: '14px 20px',
          background: is_reconciled ? '#E8F5E9' : '#FFEBEE',
          border: `1px solid ${is_reconciled ? '#A5D6A7' : '#EF9A9A'}`,
          borderRadius: '10px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {is_reconciled ? (
              <CheckCircle2 size={22} style={{ color: '#2E7D32' }} />
            ) : (
              <AlertTriangle size={22} style={{ color: '#C62828' }} />
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: is_reconciled ? '#1B5E20' : '#B71C1C' }}>
                {is_reconciled ? 'RECONCILED — Cash Movement Invariant Holding' : 'NOT RECONCILED — Cash Movement Discrepancy'}
              </div>
              <div style={{ fontSize: '12px', color: is_reconciled ? '#2E7D32' : '#C62828' }}>
                Opening ({fmtBS(opening_balance)}) + Receipts ({fmtBS(total_receipts)}) − Payments ({fmtBS(total_payments)}) = Expected Closing ({fmtBS(expected_closing)}) vs Actual ({fmtBS(actual_closing)})
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--g600)' }}>Reconciliation Difference</span>
            <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--mono)', color: is_reconciled ? '#2E7D32' : '#C62828' }}>
              {fmtBS(reconciliation_difference)}
            </div>
          </div>
        </div>

        {/* ─── TARGET KPI CARDS ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          
          <div style={{ padding: '18px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--g700)', marginBottom: '6px' }}>
              <Landmark size={16} /> <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Opening Bank & Cash</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmtBS(opening_balance)}</div>
            <div style={{ fontSize: '11px', color: 'var(--g500)', marginTop: '4px' }}>Before {new Date(fromDate).toLocaleDateString('en-GB')}</div>
          </div>

          <div style={{ padding: '18px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2E7D32', marginBottom: '6px' }}>
              <ArrowUpRight size={16} /> <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Total Receipts</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#2E7D32' }}>{fmtBS(total_receipts)}</div>
            <div style={{ fontSize: '11px', color: 'var(--g500)', marginTop: '4px' }}>Actual Cash Inflow</div>
          </div>

          <div style={{ padding: '18px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#C62828', marginBottom: '6px' }}>
              <ArrowDownRight size={16} /> <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Total Payments</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#C62828' }}>{fmtBS(total_payments)}</div>
            <div style={{ fontSize: '11px', color: 'var(--g500)', marginTop: '4px' }}>Actual Cash Outflow</div>
          </div>

          <div style={{ padding: '18px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand)', marginBottom: '6px' }}>
              <RefreshCw size={16} /> <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Net Cash Movement</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: net_cash_movement >= 0 ? '#2E7D32' : '#C62828' }}>
              {net_cash_movement >= 0 ? `+${fmtBS(net_cash_movement)}` : `-${fmtBS(Math.abs(net_cash_movement))}`}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--g500)', marginTop: '4px' }}>Receipts − Payments</div>
          </div>

          <div style={{ padding: '18px', background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1565C0', marginBottom: '6px' }}>
              <Landmark size={16} /> <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Closing Bank & Cash</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--gray-900)' }}>{fmtBS(actual_closing)}</div>
            <div style={{ fontSize: '11px', color: 'var(--g500)', marginTop: '4px' }}>As of {new Date(toDate).toLocaleDateString('en-GB')}</div>
          </div>

        </div>

        {/* ─── CHARTS ROW ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          
          {/* Receipt Mix Chart */}
          <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid var(--g200)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', color: 'var(--gray-800)' }}>Receipt Mix (Inflows)</h3>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '50%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={receipts_by_category} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={2}>
                      {receipts_by_category.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => fmtBS(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ width: '50%', paddingLeft: 12 }}>
                {receipts_by_category.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span>{item.label}</span>
                    </div>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{item.percentage}%</span>
                  </div>
                ))}
                {receipts_by_category.length === 0 && <div style={{ fontSize: 12, color: 'var(--g500)' }}>No receipts in period</div>}
              </div>
            </div>
          </div>

          {/* Payment Utilization Bar Chart */}
          <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid var(--g200)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', color: 'var(--gray-800)' }}>Payment Utilization (Outflows)</h3>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payments_by_category.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="label" type="category" width={140} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => fmtBS(value)} cursor={{ fill: 'var(--g50)' }} />
                  <Bar dataKey="amount" fill="#C62828" radius={[0, 4, 4, 0]}>
                    {payments_by_category.slice(0, 6).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ─── SECTION C: BANK & CASH POSITION ─── */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', background: 'var(--g50)', borderBottom: '1px solid var(--g200)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Section C: Bank & Cash Closing Position</span>
            {internal_transfers > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--brand)', background: 'var(--brand-50)', padding: '4px 10px', borderRadius: '12px', fontWeight: 500 }}>
                Internal Transfers Excluded: {fmtBS(internal_transfers)}
              </span>
            )}
          </div>
          <table className="dgrid" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Account Name</th>
                <th style={{ width: 100 }}>Code</th>
                <th style={{ width: 90 }}>Role / Type</th>
                <th style={{ width: 130, textAlign: 'right' }}>Opening Balance</th>
                <th style={{ width: 120, textAlign: 'right' }}>Receipts</th>
                <th style={{ width: 120, textAlign: 'right' }}>Payments</th>
                <th style={{ width: 110, textAlign: 'right' }}>Transfers In</th>
                <th style={{ width: 110, textAlign: 'right' }}>Transfers Out</th>
                <th style={{ width: 140, textAlign: 'right' }}>Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {bank_accounts.map(b => (
                <tr key={b.id}>
                  <td>
                    <span onClick={() => handleDrillDown(b)} style={{ color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 500 }}>
                      {b.name}
                    </span>
                  </td>
                  <td className="num" style={{ color: 'var(--g600)' }}>{b.code}</td>
                  <td style={{ textTransform: 'capitalize', color: 'var(--g600)', fontSize: 11 }}>{b.account_role || b.sub_type}</td>
                  <td className="num">{fmtBS(b.opening_balance)}</td>
                  <td className="num" style={{ color: '#2E7D32', fontWeight: b.receipts > 0 ? 600 : 400 }}>{fmtBS(b.receipts)}</td>
                  <td className="num" style={{ color: '#C62828', fontWeight: b.payments > 0 ? 600 : 400 }}>{fmtBS(b.payments)}</td>
                  <td className="num" style={{ color: 'var(--g600)' }}>{fmtBS(b.transfers_in)}</td>
                  <td className="num" style={{ color: 'var(--g600)' }}>{fmtBS(b.transfers_out)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmtBS(b.closing_balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 700, textAlign: 'right' }}>Total Bank & Cash:</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtBS(opening_balance)}</td>
                <td className="num" style={{ fontWeight: 700, color: '#2E7D32' }}>{fmtBS(total_receipts)}</td>
                <td className="num" style={{ fontWeight: 700, color: '#C62828' }}>{fmtBS(total_payments)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtBS(internal_transfers)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtBS(internal_transfers)}</td>
                <td className="num" style={{ fontWeight: 700, fontSize: 14 }}>{fmtBS(actual_closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ─── CATEGORIES COMPARISON ROW (SECTIONS A & B) ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          
          {/* Section A: Receipts Table */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', background: '#F1F8E9', borderBottom: '1px solid #DCEDC8', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#2E7D32' }}>Section A: Receipt Mix</span>
              <span style={{ color: '#2E7D32', fontFamily: 'var(--mono)', fontSize: 15 }}>{fmtBS(total_receipts)}</span>
            </div>
            <div style={{ padding: '8px 16px' }}>
              <div 
                onClick={() => setSelectedReceiptCategory('ALL')}
                style={{
                  display: 'flex', justifyContent: 'space-between', padding: '8px 10px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px',
                  background: selectedReceiptCategory === 'ALL' ? '#E8F5E9' : 'transparent', fontWeight: selectedReceiptCategory === 'ALL' ? 600 : 400
                }}>
                <span>All Receipts</span>
                <span className="num">{fmtBS(total_receipts)} (100%)</span>
              </div>
              {receipts_by_category.map(cat => (
                <div key={cat.key}
                  onClick={() => setSelectedReceiptCategory(cat.key === selectedReceiptCategory ? 'ALL' : cat.key)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', padding: '8px 10px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px',
                    background: selectedReceiptCategory === cat.key ? '#E8F5E9' : 'transparent', transition: 'background 0.2s'
                  }}>
                  <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{cat.label} ({cat.count})</span>
                  <span className="num" style={{ fontWeight: 600 }}>{fmtBS(cat.amount)} ({cat.percentage}%)</span>
                </div>
              ))}
              {receipts_by_category.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--g500)', fontSize: 13 }}>No receipt transactions in selected period</div>
              )}
            </div>
          </div>

          {/* Section B: Payments Table */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', background: '#FFEBEE', borderBottom: '1px solid #FFCDD2', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#C62828' }}>Section B: Payment Utilization</span>
              <span style={{ color: '#C62828', fontFamily: 'var(--mono)', fontSize: 15 }}>{fmtBS(total_payments)}</span>
            </div>
            <div style={{ padding: '8px 16px' }}>
              <div 
                onClick={() => setSelectedPaymentCategory('ALL')}
                style={{
                  display: 'flex', justifyContent: 'space-between', padding: '8px 10px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px',
                  background: selectedPaymentCategory === 'ALL' ? '#FFEBEE' : 'transparent', fontWeight: selectedPaymentCategory === 'ALL' ? 600 : 400
                }}>
                <span>All Payments</span>
                <span className="num">{fmtBS(total_payments)} (100%)</span>
              </div>
              {payments_by_category.map(cat => (
                <div key={cat.key}
                  onClick={() => setSelectedPaymentCategory(cat.key === selectedPaymentCategory ? 'ALL' : cat.key)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', padding: '8px 10px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px',
                    background: selectedPaymentCategory === cat.key ? '#FFEBEE' : 'transparent', transition: 'background 0.2s'
                  }}>
                  <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{cat.label} ({cat.count})</span>
                  <span className="num" style={{ fontWeight: 600 }}>{fmtBS(cat.amount)} ({cat.percentage}%)</span>
                </div>
              ))}
              {payments_by_category.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--g500)', fontSize: 13 }}>No payment transactions in selected period</div>
              )}
            </div>
          </div>

        </div>

        {/* ─── SECTION D: RECEIPT DETAILS TABLE ─── */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', background: 'var(--g50)', borderBottom: '1px solid var(--g200)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={14} style={{ color: 'var(--brand)' }} />
              <span>Section D: Receipt Transaction Details</span>
              {selectedReceiptCategory !== 'ALL' && (
                <span style={{ fontSize: '12px', background: 'var(--brand-50)', color: 'var(--brand)', padding: '2px 8px', borderRadius: 4 }}>
                  Filtered: {receipts_by_category.find(c => c.key === selectedReceiptCategory)?.label}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--g600)' }}>Showing {filteredReceiptDetails.length} of {receipt_details.length} receipts</span>
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto' }}>
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  <th style={{ width: 85 }}>Date</th>
                  <th style={{ width: 100 }}>JE Number</th>
                  <th>Received From / Account</th>
                  <th style={{ width: 120 }}>Bank Account</th>
                  <th style={{ width: 140 }}>Category</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Amount (₹)</th>
                  <th>Narration</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceiptDetails.map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.date).toLocaleDateString('en-IN')}</td>
                    <td onClick={() => {
                        openTab({ id: `/journal-entries/${r.je_id}`, name: `JE ${r.je_number}`, path: `/journal-entries/${r.je_id}`, closable: true });
                        navigate(`/journal-entries/${r.je_id}`);
                      }} style={{ cursor: 'pointer' }}>
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{r.je_number}</span>
                    </td>
                    <td>{r.party_name}</td>
                    <td>{r.bank_account_name} ({r.bank_account_code})</td>
                    <td><span style={{ fontSize: 11, background: '#E8F5E9', color: '#2E7D32', padding: '2px 6px', borderRadius: 4 }}>{r.category_label}</span></td>
                    <td className="num" style={{ fontWeight: 600, color: '#2E7D32' }}>{fmtBS(r.amount)}</td>
                    <td style={{ color: 'var(--g700)', fontSize: 11 }}>{r.narration}</td>
                  </tr>
                ))}
                {filteredReceiptDetails.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--g500)' }}>No receipt transactions match the selected filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── SECTION E: PAYMENT DETAILS TABLE ─── */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', background: 'var(--g50)', borderBottom: '1px solid var(--g200)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={14} style={{ color: 'var(--brand)' }} />
              <span>Section E: Payment Transaction Details</span>
              {selectedPaymentCategory !== 'ALL' && (
                <span style={{ fontSize: '12px', background: 'var(--brand-50)', color: 'var(--brand)', padding: '2px 8px', borderRadius: 4 }}>
                  Filtered: {payments_by_category.find(c => c.key === selectedPaymentCategory)?.label}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--g600)' }}>Showing {filteredPaymentDetails.length} of {payment_details.length} payments</span>
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto' }}>
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  <th style={{ width: 85 }}>Date</th>
                  <th style={{ width: 100 }}>JE Number</th>
                  <th>Paid To / Account</th>
                  <th style={{ width: 120 }}>Bank Account</th>
                  <th style={{ width: 140 }}>Category</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Amount (₹)</th>
                  <th>Narration</th>
                </tr>
              </thead>
              <tbody>
                {filteredPaymentDetails.map((p, i) => (
                  <tr key={i}>
                    <td>{new Date(p.date).toLocaleDateString('en-IN')}</td>
                    <td onClick={() => {
                        openTab({ id: `/journal-entries/${p.je_id}`, name: `JE ${p.je_number}`, path: `/journal-entries/${p.je_id}`, closable: true });
                        navigate(`/journal-entries/${p.je_id}`);
                      }} style={{ cursor: 'pointer' }}>
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{p.je_number}</span>
                    </td>
                    <td>{p.party_name}</td>
                    <td>{p.bank_account_name} ({p.bank_account_code})</td>
                    <td><span style={{ fontSize: 11, background: '#FFEBEE', color: '#C62828', padding: '2px 6px', borderRadius: 4 }}>{p.category_label}</span></td>
                    <td className="num" style={{ fontWeight: 600, color: '#C62828' }}>{fmtBS(p.amount)}</td>
                    <td style={{ color: 'var(--g700)', fontSize: 11 }}>{p.narration}</td>
                  </tr>
                ))}
                {filteredPaymentDetails.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--g500)' }}>No payment transactions match the selected filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── SECTION F: RECONCILIATION FOOTER ─── */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--g200)', padding: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px', color: 'var(--gray-800)' }}>Section F: GL Cash Movement Reconciliation Proof</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '13px' }}>
            <div style={{ padding: '10px 14px', background: 'var(--g50)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--g600)' }}>Opening Balance</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtBS(opening_balance)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: '#F1F8E9', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#2E7D32' }}>+ Total Receipts</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#2E7D32' }}>+{fmtBS(total_receipts)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: '#FFEBEE', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#C62828' }}>− Total Payments</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#C62828' }}>−{fmtBS(total_payments)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--g50)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--g600)' }}>= Expected Closing</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtBS(expected_closing)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--g50)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--g600)' }}>Actual GL Closing</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtBS(actual_closing)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: is_reconciled ? '#E8F5E9' : '#FFEBEE', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: is_reconciled ? '#2E7D32' : '#C62828' }}>Difference</div>
              <div style={{ fontWeight: 800, fontFamily: 'var(--mono)', color: is_reconciled ? '#2E7D32' : '#C62828' }}>
                {fmtBS(reconciliation_difference)}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ─── DRILL-DOWN MODAL ─── */}
      <Modal open={!!drillDownAcct} onClose={() => { setDrillDownAcct(null); setDrillData(null); }} title={drillDownAcct ? `Ledger Transactions: ${drillDownAcct.name} (${drillDownAcct.code})` : 'Loading...'} large>
        {drillLoading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
        {drillData && !drillLoading && (
          <div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 12, background: 'var(--g50)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--g200)' }}>
              <div><strong>Account:</strong> {drillData.account.name} ({drillData.account.code})</div>
              <div><strong>Type:</strong> {drillData.account.type}</div>
              <div><strong>Net Movement:</strong> {fmtBS(drillData.summary.net_balance)}</div>
            </div>
            
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 85 }}>Date</th>
                  <th style={{ width: 100 }}>JE No</th>
                  <th>Description</th>
                  <th style={{ width: 100 }}>Source Doc</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Debit (₹)</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Credit (₹)</th>
                </tr>
              </thead>
              <tbody>
                {drillData.entries.map((e, i) => (
                  <tr key={i}>
                    <td>{new Date(e.date).toLocaleDateString('en-IN')}</td>
                    <td onClick={() => {
                        openTab({ id: `/journal-entries/${e.je_id}`, name: `JE ${e.je_number}`, path: `/journal-entries/${e.je_id}`, closable: true });
                        navigate(`/journal-entries/${e.je_id}`);
                      }} style={{ cursor: 'pointer' }}>
                      <span style={{ color: 'var(--brand)', textDecoration: 'underline' }}>{e.je_number}</span>
                    </td>
                    <td>{e.description || e.narration}</td>
                    <td>{e.source_id ? `${e.source_type} #${e.source_id}` : '—'}</td>
                    <td className="num" style={{ color: e.debit > 0 ? '#2E7D32' : '' }}>{e.debit > 0 ? fmtBS(e.debit) : ''}</td>
                    <td className="num" style={{ color: e.credit > 0 ? '#C62828' : '' }}>{e.credit > 0 ? fmtBS(e.credit) : ''}</td>
                  </tr>
                ))}
                {drillData.entries.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--g500)' }}>No journal entries found in this period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Totals:</td>
                  <td className="num" style={{ fontWeight: 700, color: '#2E7D32' }}>{fmtBS(drillData.summary.total_debit)}</td>
                  <td className="num" style={{ fontWeight: 700, color: '#C62828' }}>{fmtBS(drillData.summary.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

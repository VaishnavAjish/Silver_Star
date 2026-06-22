import { useState, useEffect, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import DatePicker from '../../../shared/components/DatePicker';
import SearchableSelect from '../../../shared/components/SearchableSelect';

const money = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VIEWS = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'report',        label: 'Cost Centre Report' },
];

const MODES = [
  { key: 'category', label: 'Category View' },
  { key: 'summary',  label: 'Summary View' },
  { key: 'detailed', label: 'Detailed View' },
];

const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--g200)', fontSize: 12, color: 'var(--g600)' };
const td = { padding: '5px 10px', borderBottom: '1px solid var(--g100)', fontSize: 13 };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function CostCenterReportsPage() {
  const api = useApi();
  const [view, setView]   = useState('dashboard');
  const [mode, setMode]   = useState('category');
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [ccId, setCcId]   = useState('');
  const [costCenters, setCostCenters] = useState([]);
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {});
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set('date_from', from);
      if (to)   p.set('date_to', to);
      if (view === 'report') {
        p.set('mode', mode);
        if (ccId) p.set('cost_center_id', ccId);
      }
      const r = await api.get(`/api/cost-center-reports/${view}?${p.toString()}`);
      setRows(r.data || []);
    } catch (err) { toast.error(err.message); setRows([]); }
    finally { setLoading(false); }
  }, [view, mode, ccId, from, to, api]);

  useEffect(() => { load(); }, [view, mode, ccId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-page" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {VIEWS.map(v => (
          <button key={v.key}
            className={`btn ${view === v.key ? 'btn-primary' : ''}`}
            onClick={() => { setView(v.key); setRows([]); }}>{v.label}</button>
        ))}
        
        <div style={{ flex: 1 }} />
        
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          {view === 'report' && (
            <>
              <div className="filter-field" style={{ width: 150 }}>
                <label className="filter-label">Cost Centre</label>
                <SearchableSelect
                  dropdownSearch
                  placeholder="-- ALL --"
                  value={ccId ? { id: ccId, name: costCenters.find(c => c.id === ccId)?.name, code: costCenters.find(c => c.id === ccId)?.code } : null}
                  onChange={v => setCcId(v ? v.id : '')}
                  options={costCenters.map(c => ({ id: c.id, name: c.name, code: c.code }))}
                />
              </div>
              <div className="filter-field" style={{ width: 150 }}>
                <label className="filter-label">View Mode</label>
                <SearchableSelect
                  dropdownSearch
                  placeholder="Category View"
                  value={MODES.find(m => m.key === mode) ? { id: mode, name: MODES.find(m => m.key === mode).label } : null}
                  onChange={v => setMode(v ? v.id : 'category')}
                  options={MODES.map(m => ({ id: m.key, name: m.label }))}
                />
              </div>
            </>
          )}
          <div className="filter-field" style={{ width: 150 }}>
            <label className="filter-label">From</label>
            <DatePicker value={from} onChange={v => setFrom(v || '')} />
          </div>
          <div className="filter-field" style={{ width: 150 }}>
            <label className="filter-label">To</label>
            <DatePicker value={to} onChange={v => setTo(v || '')} />
          </div>
          <button className="btn" onClick={load}>Apply</button>
        </div>
      </div>

      {loading ? <p style={{ padding: 24 }}>Loading...</p> : (
        view === 'dashboard'     ? <DashboardTable rows={rows} /> :
        view === 'trial-balance' ? <TrialBalanceTable rows={rows} /> :
        view === 'report' && mode === 'summary'  ? <CostCentreReportSummaryTable rows={rows} /> :
        view === 'report' && mode === 'detailed' ? <CostCentreReportDetailedTable rows={rows} /> :
        view === 'report' && mode === 'category' ? <CostCentreReportCategoryTable rows={rows} /> : null
      )}
    </div>
  );
}

function DashboardTable({ rows }) {
  if (!rows.length) return <Empty />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={th}>Code</th><th style={th}>Cost Centre</th><th style={th}>Status</th>
        <th style={{ ...th, textAlign: 'right' }}>Lines</th>
        <th style={{ ...th, textAlign: 'right' }}>Debit</th>
        <th style={{ ...th, textAlign: 'right' }}>Credit</th>
        <th style={{ ...th, textAlign: 'right' }}>Net</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={td}>{r.code || '-'}</td>
            <td style={td}>{r.name}</td>
            <td style={td}><span className={`badge b-${r.status}`}>{r.status}</span></td>
            <td style={tdNum}>{r.line_count}</td>
            <td style={tdNum}>{money(r.total_debit)}</td>
            <td style={tdNum}>{money(r.total_credit)}</td>
            <td style={tdNum}>{money(r.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrialBalanceTable({ rows }) {
  if (!rows.length) return <Empty />;
  let debit = 0, credit = 0;
  rows.forEach(r => { debit += Number(r.debit || 0); credit += Number(r.credit || 0); });
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={th}>Cost Centre</th><th style={th}>Account</th><th style={th}>Type</th>
        <th style={{ ...th, textAlign: 'right' }}>Debit</th>
        <th style={{ ...th, textAlign: 'right' }}>Credit</th>
        <th style={{ ...th, textAlign: 'right' }}>Net</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={td}>{r.cost_center_code ? `${r.cost_center_code} - ${r.cost_center_name}` : r.cost_center_name}</td>
            <td style={td}>{r.account_code} {r.account_name}</td>
            <td style={td}>{r.type}</td>
            <td style={tdNum}>{money(r.debit)}</td>
            <td style={tdNum}>{money(r.credit)}</td>
            <td style={tdNum}>{money(r.net)}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total</td>
          <td style={{ ...tdNum, fontWeight: 700 }}>{money(debit)}</td>
          <td style={{ ...tdNum, fontWeight: 700 }}>{money(credit)}</td>
          <td style={{ ...tdNum, fontWeight: 700 }}>{money(debit - credit)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Empty() {
  return <p style={{ padding: 24, color: 'var(--g500)' }}>No data for the selected period.</p>;
}

// -----------------------------------------------------------------------------
// Cost Centre Report Tables
// -----------------------------------------------------------------------------

function CostCentreReportSummaryTable({ rows }) {
  if (!rows.length) return <Empty />;
  let totalNet = 0;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
      <thead><tr>
        <th style={th}>Cost Centre</th>
        <th style={{ ...th, textAlign: 'right' }}>Amount (Net)</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => {
          totalNet += Number(r.net || 0);
          return (
            <tr key={i}>
              <td style={td}>{r.cost_center_code} - {r.cost_center_name}</td>
              <td style={tdNum}>{money(r.net)}</td>
            </tr>
          );
        })}
        <tr>
          <td style={{ ...td, fontWeight: 800, fontSize: 15, textAlign: 'right' }}>Grand Total</td>
          <td style={{ ...tdNum, fontWeight: 800, fontSize: 15 }}>{money(totalNet)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function CostCentreReportDetailedTable({ rows }) {
  if (!rows.length) return <Empty />;
  
  // Group by cost centre
  const grouped = {};
  let overallTotal = 0;
  rows.forEach(r => {
    const key = `${r.cost_center_code} - ${r.cost_center_name}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
    overallTotal += Number(r.net || 0);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginTop: 12 }}>
      {Object.entries(grouped).map(([ccName, items]) => {
        let ccTotal = 0;
        return (
          <div key={ccName}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--g800)' }}>{ccName}</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Date</th>
                <th style={th}>Voucher No</th>
                <th style={th}>Module</th>
                <th style={th}>Account</th>
                <th style={th}>Narration</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              </tr></thead>
              <tbody>
                {items.map((r, i) => {
                  ccTotal += Number(r.net || 0);
                  return (
                    <tr key={i}>
                      <td style={td}>{new Date(r.date).toLocaleDateString('en-GB')}</td>
                      <td style={td}><Link to={`/journal-entries/${r.id}`} style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>{r.je_number}</Link></td>
                      <td style={td}>{r.source_type}</td>
                      <td style={td}>{r.account_code} {r.account_name}</td>
                      <td style={td}>{r.remarks || '-'}</td>
                      <td style={tdNum}>{money(r.net)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={5} style={{ ...td, fontWeight: 600, textAlign: 'right', color: 'var(--g600)' }}>Cost Centre Total</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{money(ccTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <div style={{ padding: '16px 10px', display: 'flex', justifyContent: 'flex-end', gap: 24, borderTop: '2px solid var(--g200)' }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>Overall Grand Total</span>
        <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(overallTotal)}</span>
      </div>
    </div>
  );
}

function CostCentreReportCategoryTable({ rows }) {
  if (!rows.length) return <Empty />;

  // Group by Cost Centre first, then by Category
  const groupedByCC = {};
  let overallTotal = 0;

  rows.forEach(r => {
    const ccKey = `${r.cost_center_code} - ${r.cost_center_name}`;
    if (!groupedByCC[ccKey]) groupedByCC[ccKey] = { items: [], total: 0 };
    
    let category = 'Other Assets / Expenses';
    const p = r.path || '';
    if (p.includes('/2000A')) category = 'Fixed Assets';
    else if (p.includes('/2000')) category = 'Inventory';
    else if (p.includes('/1000C') || r.type === 'asset') category = 'Other Assets';
    else if (r.type === 'expense') category = 'Pre-operative Expenses';
    
    r.category = category;
    groupedByCC[ccKey].items.push(r);
    groupedByCC[ccKey].total += Number(r.net || 0);
    overallTotal += Number(r.net || 0);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginTop: 12 }}>
      {Object.entries(groupedByCC).map(([ccName, data]) => {
        // Group items by category
        const catGroups = {};
        data.items.forEach(r => {
          if (!catGroups[r.category]) catGroups[r.category] = [];
          catGroups[r.category].push(r);
        });

        return (
          <div key={ccName}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--g800)', fontSize: 16 }}>{ccName}</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Account</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Addition (Net)</th>
              </tr></thead>
              <tbody>
                {Object.entries(catGroups).map(([category, items]) => (
                  <Fragment key={category}>
                    <tr>
                      <td colSpan={3} style={{ padding: '12px 10px 4px', fontSize: 14, fontWeight: 700, color: 'var(--brand)', borderBottom: '1px solid var(--g200)' }}>
                        {category}
                      </td>
                    </tr>
                    {items.map((r, i) => (
                      <tr key={i}>
                        <td style={td}>{r.account_code} {r.account_name}</td>
                        <td style={td}>{r.type}</td>
                        <td style={tdNum}>{money(r.net)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} style={{ ...td, fontWeight: 600, textAlign: 'right', color: 'var(--g600)' }}>{category} Total</td>
                      <td style={{ ...tdNum, fontWeight: 700 }}>{money(items.reduce((s, i) => s + Number(i.net || 0), 0))}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr>
                  <td colSpan={2} style={{ padding: '12px 10px', fontWeight: 800, fontSize: 14, textAlign: 'right' }}>Cost Centre Total</td>
                  <td style={{ padding: '12px 10px', fontWeight: 800, fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>
                    {money(data.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <div style={{ padding: '16px 10px', display: 'flex', justifyContent: 'flex-end', gap: 24, borderTop: '2px solid var(--g200)' }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>Overall Grand Total</span>
        <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(overallTotal)}</span>
      </div>
    </div>
  );
}

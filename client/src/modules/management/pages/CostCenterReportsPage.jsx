import { useState, useEffect, useCallback, Fragment } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import DatePicker from '../../../shared/components/DatePicker';

const money = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VIEWS = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'startup',       label: 'Startup Cost Report' },
  { key: 'project',       label: 'Project Cost Report' },
];

const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--g200)', fontSize: 12, color: 'var(--g600)' };
const td = { padding: '5px 10px', borderBottom: '1px solid var(--g100)', fontSize: 13 };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function CostCenterReportsPage() {
  const api = useApi();
  const [view, setView]   = useState('dashboard');
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set('date_from', from);
      if (to)   p.set('date_to', to);
      const r = await api.get(`/api/cost-center-reports/${view}?${p.toString()}`);
      setRows(r.data || []);
    } catch (err) { toast.error(err.message); setRows([]); }
    finally { setLoading(false); }
  }, [view, from, to, api]);

  useEffect(() => { load(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-page" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {VIEWS.map(v => (
          <button key={v.key}
            className={`btn ${view === v.key ? 'btn-primary' : ''}`}
            onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="filter-field" style={{ width: 150 }}>
            <label className="filter-label">From</label>
            <DatePicker value={from} onChange={v => setFrom(v || '')} />
          </div>
          <div className="filter-field" style={{ width: 150 }}>
            <label className="filter-label">To</label>
            <DatePicker value={to} onChange={v => setTo(v || '')} />
          </div>
          <button className="btn" onClick={load} style={{ marginTop: 18 }}>Apply</button>
        </div>
      </div>

      {loading ? <p style={{ padding: 24 }}>Loading…</p> : (
        view === 'dashboard'     ? <DashboardTable rows={rows} /> :
        view === 'trial-balance' ? <TrialBalanceTable rows={rows} /> :
        view === 'startup'       ? <StartupTable rows={rows} /> :
                                   <ProjectCostTable rows={rows} />
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
            <td style={td}>{r.code || '—'}</td>
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
            <td style={td}>{r.cost_center_code ? `${r.cost_center_code} — ${r.cost_center_name}` : r.cost_center_name}</td>
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

function StartupTable({ rows }) {
  if (!rows.length) return <Empty />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>
        <th style={th}>Cost Centre</th><th style={th}>Account</th><th style={th}>Type</th>
        <th style={{ ...th, textAlign: 'right' }}>Net Spend</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={td}>{r.cost_center_code} — {r.cost_center_name}</td>
            <td style={td}>{r.account_code} {r.account_name}</td>
            <td style={td}>{r.type}</td>
            <td style={tdNum}>{money(r.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty() {
  return <p style={{ padding: 24, color: 'var(--g500)' }}>No data for the selected period.</p>;
}

function ProjectCostTable({ rows }) {
  if (!rows.length) return <Empty />;

  // Group rows logically by hierarchical category.
  // The query returns `a.path` which corresponds to the account hierarchy (e.g. 1000/2000A/2007)
  const grouped = {};
  let totalNet = 0;

  rows.forEach(r => {
    let category = 'Other Assets / Expenses';
    const p = r.path || '';
    if (p.includes('/2000A')) category = 'Fixed Assets';
    else if (p.includes('/2000')) category = 'Inventory';
    else if (p.includes('/1000C') || r.type === 'asset') category = 'Other Assets';
    else if (r.type === 'expense') category = 'Pre-operative Expenses';
    
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(r);
    totalNet += Number(r.net || 0);
  });

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
      <thead><tr>
        <th style={th}>Account</th>
        <th style={th}>Type</th>
        <th style={th}>Cost Centre</th>
        <th style={{ ...th, textAlign: 'right' }}>Addition (Net)</th>
      </tr></thead>
      <tbody>
        {Object.entries(grouped).map(([category, items]) => (
          <Fragment key={category}>
            <tr>
              <td colSpan={4} style={{ padding: '12px 10px 4px', fontSize: 14, fontWeight: 700, color: 'var(--brand)', borderBottom: '1px solid var(--g200)' }}>
                {category}
              </td>
            </tr>
            {items.map((r, i) => (
              <tr key={i}>
                <td style={td}>{r.account_code} {r.account_name}</td>
                <td style={td}>{r.type}</td>
                <td style={td}>{r.cost_center_code} — {r.cost_center_name}</td>
                <td style={tdNum}>{money(r.net)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ ...td, fontWeight: 600, textAlign: 'right', color: 'var(--g600)' }}>{category} Total</td>
              <td style={{ ...tdNum, fontWeight: 700 }}>{money(items.reduce((s, i) => s + Number(i.net || 0), 0))}</td>
            </tr>
          </Fragment>
        ))}
        <tr>
          <td colSpan={3} style={{ padding: '16px 10px', fontWeight: 800, fontSize: 16, textAlign: 'right' }}>Grand Total Project Cost</td>
          <td style={{ padding: '16px 10px', fontWeight: 800, fontSize: 16, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>
            {money(totalNet)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

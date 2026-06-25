import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { Search, Landmark, BarChart2, BookOpen, List, TrendingDown } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';
const round2  = v => Math.round(Number(v || 0) * 100) / 100;

// ── Tab definitions ────────────────────────────────────────────────────────────
const TABS = [
  { key: 'dashboard',      label: 'Dashboard',      icon: BarChart2 },
  { key: 'trial-balance',  label: 'Trial Balance',  icon: BookOpen  },
  { key: 'asset-register', label: 'Asset Register', icon: List      },
];

// ── Asset detail popup ─────────────────────────────────────────────────────────
function AssetDetailsPopup({ assetId, onClose }) {
  const api = useApi();
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assetId) return;
    setLoading(true);
    api.get(`/api/fixed-assets/${assetId}`)
      .then(setAsset)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [assetId, api]);

  return (
    <Modal open={true} onClose={onClose} title={`Asset Details: ${asset?.asset_code || ''}`} large>
      {loading ? <div className="spinner" /> : !asset ? <div>Error loading asset</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, background: 'var(--g50)', padding: 16, borderRadius: 8 }}>
            {[
              { label: 'Asset Name', value: asset.asset_name },
              { label: 'Category',   value: asset.category_name },
              { label: 'Purchase Date', value: fmtDate(asset.purchase_date) },
              { label: 'In Service Date', value: fmtDate(asset.in_service_date) },
            ].map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>{f.label}</div>
                <div style={{ fontWeight: 600 }}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ background: '#E3F2FD', padding: 12, borderRadius: 6, border: '1px solid #90CAF9' }}>
              <div style={{ fontSize: 11, color: '#0D47A1', fontWeight: 700, textTransform: 'uppercase' }}>Purchase Cost</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0D47A1', fontFamily: 'var(--mono)' }}>{fmt(asset.purchase_cost)}</div>
            </div>
            <div style={{ background: '#FFEBEE', padding: 12, borderRadius: 6, border: '1px solid #EF9A9A' }}>
              <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase' }}>Accum. Depreciation</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--mono)' }}>{fmt(asset.accumulated_depreciation)}</div>
            </div>
            <div style={{ background: 'var(--brand-50)', padding: 12, borderRadius: 6, border: '1px solid var(--sidebar-border)' }}>
              <div style={{ fontSize: 11, color: 'var(--brand-dark)', fontWeight: 700, textTransform: 'uppercase' }}>WDV Today</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-dark)', fontFamily: 'var(--mono)' }}>{fmt(asset.wdv_today)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Depreciation Method', value: `${asset.depreciation_method} @ ${asset.depreciation_rate_pct}%` },
              { label: 'Useful Life', value: `${asset.useful_life_years} Years` },
              { label: 'Status', value: <span className={`badge b-${asset.status === 'active' ? 'active' : 'draft'}`}>{asset.status}</span> },
              { label: 'Location', value: asset.location_name || '—' },
            ].map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>{f.label}</div>
                <div>{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── DASHBOARD TAB ──────────────────────────────────────────────────────────────
function DashboardTab({ data }) {
  if (!data) return <div className="empty-state"><div className="spinner" /></div>;
  const { kpi, categories, depreciation_trend } = data;

  const maxTrend = Math.max(...(depreciation_trend || []).map(t => t.amount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Total Assets',    value: kpi.total_assets,    color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9', mono: false },
          { label: 'Active Assets',   value: kpi.active_assets,   color: '#2E7D32', bg: '#E8F5E9', bc: '#A5D6A7', mono: false },
          { label: 'Disposed Assets', value: kpi.disposed_assets,  color: '#757575', bg: '#F5F5F5', bc: '#E0E0E0', mono: false },
          { label: 'Total Cost',      value: fmt(kpi.total_cost),  color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9', mono: true },
          { label: 'Accum Depr',      value: fmt(kpi.total_accum_depr), color: '#C62828', bg: '#FFEBEE', bc: '#EF9A9A', mono: true },
          { label: 'Net Book Value',  value: fmt(kpi.total_wdv),   color: 'var(--brand-dark)', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)', mono: true },
        ].map((c, i) => (
          <div key={i} style={{ padding: '12px 16px', background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: c.color, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: c.mono ? 15 : 22, fontWeight: 700, color: c.color, fontFamily: c.mono ? 'var(--mono)' : 'inherit' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Overall depreciation progress */}
      <div style={{ padding: '12px 16px', background: 'var(--g50)', borderRadius: 8, border: '1px solid var(--g200)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase' }}>Overall Depreciation Progress</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: kpi.overall_depr_pct >= 75 ? 'var(--red)' : 'var(--brand-dark)' }}>
            {kpi.overall_depr_pct}%
          </span>
        </div>
        <div style={{ height: 10, background: 'var(--g200)', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 5, transition: 'width 0.5s',
            width: `${Math.min(kpi.overall_depr_pct, 100)}%`,
            background: kpi.overall_depr_pct >= 75 ? 'var(--red)' : 'var(--brand)',
          }} />
        </div>
      </div>

      {/* Per-category breakdown */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 10 }}>
          Category Breakdown
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {categories.map((cat, i) => (
            <div key={i} style={{ padding: '12px 14px', background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{cat.category_name}</span>
                  <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--g500)' }}>
                    {cat.asset_count} asset{cat.asset_count !== 1 ? 's' : ''}
                    {cat.disposed_count > 0 && ` · ${cat.disposed_count} disposed`}
                  </span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: cat.depr_pct >= 75 ? 'var(--red)' : 'var(--brand-dark)' }}>
                  {cat.depr_pct}% depreciated
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--g100)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${Math.min(cat.depr_pct, 100)}%`,
                  background: cat.depr_pct >= 75 ? 'var(--red)' : 'var(--brand)',
                }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
                <div><div style={{ color: 'var(--g500)' }}>Cost</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: '#0D47A1' }}>{fmt(cat.total_cost)}</div></div>
                <div><div style={{ color: 'var(--g500)' }}>Accum Depr</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</div></div>
                <div><div style={{ color: 'var(--g500)' }}>WDV</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--brand-dark)' }}>{fmt(cat.total_wdv)}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Depreciation Trend */}
      {depreciation_trend && depreciation_trend.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 10 }}>
            Depreciation Posted — Last 12 Months
          </div>
          <div style={{ padding: 14, background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
              {depreciation_trend.map((t, i) => {
                const h = Math.round((t.amount / maxTrend) * 80);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div title={fmt(t.amount)} style={{
                      width: '100%', height: h, minHeight: 2,
                      background: 'var(--brand)', borderRadius: '3px 3px 0 0', opacity: 0.85,
                      transition: 'height 0.3s',
                    }} />
                    <div style={{ fontSize: 9, color: 'var(--g500)', writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 40 }}>
                      {t.month}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TRIAL BALANCE TAB ──────────────────────────────────────────────────────────
function TrialBalanceTab({ data }) {
  if (!data) return <div className="empty-state"><div className="spinner" /></div>;
  const { accounts, category_mapping, grand_total_debit, grand_total_credit } = data;

  if (!accounts || accounts.length === 0) {
    return (
      <div className="empty-state">
        <BookOpen size={36} />
        <p>No GL accounts linked to fixed asset categories yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Category → Account mapping */}
      {category_mapping && category_mapping.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 8 }}>
            Category GL Account Mapping
          </div>
          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Asset Account</th>
                <th>Accum Depr Account</th>
                <th>Depr Expense Account</th>
              </tr>
            </thead>
            <tbody>
              {category_mapping.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{c.category_name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {c.asset_account_code ? `${c.asset_account_code} — ${c.asset_account_name}` : <span style={{ color: 'var(--g400)' }}>—</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {c.accum_depr_code ? `${c.accum_depr_code} — ${c.accum_depr_name}` : <span style={{ color: 'var(--g400)' }}>—</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {c.depr_exp_code ? `${c.depr_exp_code} — ${c.depr_exp_name}` : <span style={{ color: 'var(--g400)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GL Balances */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 8 }}>
          GL Account Balances
        </div>
        <table className="dgrid" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Code</th>
              <th>Account Name</th>
              <th style={{ width: 100 }}>Type</th>
              <th style={{ width: 130, textAlign: 'right' }}>Total Debit (₹)</th>
              <th style={{ width: 130, textAlign: 'right' }}>Total Credit (₹)</th>
              <th style={{ width: 130, textAlign: 'right' }}>Net Balance (₹)</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={i}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>{a.code}</td>
                <td style={{ fontWeight: 500 }}>{a.name}</td>
                <td>
                  <span className="badge b-draft" style={{ fontSize: 10 }}>
                    {a.sub_type || a.account_type}
                  </span>
                </td>
                <td className="num" style={{ color: '#0D47A1' }}>{fmt(a.total_debit)}</td>
                <td className="num" style={{ color: 'var(--red)' }}>{fmt(a.total_credit)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(a.net_balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
              <td colSpan={3} style={{ textAlign: 'right', color: 'var(--brand-dark)' }}>Grand Total</td>
              <td className="num" style={{ color: '#0D47A1' }}>{fmt(grand_total_debit)}</td>
              <td className="num" style={{ color: 'var(--red)' }}>{fmt(grand_total_credit)}</td>
              <td className="num" style={{ color: 'var(--brand-dark)', fontSize: 13 }}>{fmt(round2(grand_total_debit - grand_total_credit))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── ASSET REGISTER TAB ─────────────────────────────────────────────────────────
function AssetRegisterTab({ data, onSelectAsset }) {
  if (!data) return <div className="empty-state"><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { l: 'Total Cost',       v: data.grand_total_cost,       color: '#0D47A1',           bg: '#E3F2FD',        bc: '#90CAF9' },
          { l: 'Accumulated Depr', v: data.grand_total_accum_depr, color: 'var(--red)',         bg: '#FFEBEE',        bc: '#EF9A9A' },
          { l: 'Net Book Value',   v: data.grand_total_wdv,        color: 'var(--brand-dark)', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)' },
        ].map((c, i) => (
          <div key={i} style={{ padding: '10px 18px', background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: c.color }}>{c.l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color }}>{fmt(c.v)}</div>
          </div>
        ))}
      </div>

      {/* Per-category tables */}
      {data.categories.map(cat => (
        <div key={cat.category_name} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand-dark)',
                        background: 'var(--brand-50)', padding: '6px 12px',
                        borderRadius: '6px 6px 0 0', borderBottom: '2px solid var(--brand)' }}>
            {cat.category_name}
          </div>
          <table className="dgrid" style={{ fontSize: 12, borderRadius: '0 0 6px 6px', marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Asset Code</th><th>Asset Name</th>
                <th style={{ width: 100 }}>Purchase Date</th>
                <th style={{ width: 100 }}>In Service</th>
                <th style={{ width: 120, textAlign: 'right' }}>Cost (₹)</th>
                <th style={{ width: 130, textAlign: 'right' }}>Accum Depr (₹)</th>
                <th style={{ width: 120, textAlign: 'right' }}>WDV (₹)</th>
                <th style={{ width: 85 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {cat.assets.map((a, i) => (
                <tr key={i}
                  onDoubleClick={() => a.id && onSelectAsset(a.id)}
                  style={{ cursor: a.id ? 'pointer' : 'default' }}
                >
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>{a.asset_code}</td>
                  <td style={{ fontWeight: 500 }}>{a.asset_name}</td>
                  <td>{fmtDate(a.purchase_date)}</td>
                  <td>{fmtDate(a.in_service_date)}</td>
                  <td className="num">{fmt(a.purchase_cost)}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{fmt(a.accumulated_depreciation)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(a.wdv_as_of)}</td>
                  <td><span className={`badge b-${a.status === 'active' ? 'active' : 'draft'}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                <td colSpan={4} style={{ color: 'var(--brand-dark)', textAlign: 'right' }}>Category Total</td>
                <td className="num" style={{ color: '#0D47A1' }}>{fmt(cat.total_cost)}</td>
                <td className="num" style={{ color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</td>
                <td className="num" style={{ color: 'var(--brand-dark)', fontSize: 13 }}>{fmt(cat.total_wdv)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {/* Grand total */}
      <table className="dgrid" style={{ fontSize: 13, background: 'var(--brand-50)', border: '2px solid var(--brand)', borderRadius: 6 }}>
        <tbody>
          <tr>
            <td style={{ fontWeight: 800, color: 'var(--brand-dark)', width: '40%' }}>GRAND TOTAL</td>
            <td className="num" style={{ fontWeight: 700, color: '#0D47A1' }}>{fmt(data.grand_total_cost)}</td>
            <td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(data.grand_total_accum_depr)}</td>
            <td className="num" style={{ fontWeight: 800, color: 'var(--brand-dark)', fontSize: 15 }}>{fmt(data.grand_total_wdv)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function FixedAssetRegister() {
  const api      = useApi();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [asOfDate, setAsOfDate]   = useState(new Date().toISOString().split('T')[0]);
  const [loading,  setLoading]    = useState(false);

  const [dashboardData,   setDashboardData]   = useState(null);
  const [trialBalData,    setTrialBalData]     = useState(null);
  const [registerData,    setRegisterData]     = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);

  const loadTab = useCallback(async (tab, date) => {
    setLoading(true);
    const d = date || asOfDate;
    try {
      if (tab === 'dashboard') {
        const r = await api.get(`/api/reports/fixed-asset-dashboard?asOfDate=${d}`);
        setDashboardData(r);
      } else if (tab === 'trial-balance') {
        const r = await api.get(`/api/reports/fixed-asset-trial-balance?asOfDate=${d}`);
        setTrialBalData(r);
      } else {
        const r = await api.get(`/api/reports/fixed-asset-register?asOfDate=${d}`);
        setRegisterData(r);
      }
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [api, asOfDate]);

  // Load dashboard on mount
  useEffect(() => { loadTab('dashboard'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    // Load if not yet loaded
    if (tab === 'dashboard'      && !dashboardData) loadTab(tab);
    if (tab === 'trial-balance'  && !trialBalData)  loadTab(tab);
    if (tab === 'asset-register' && !registerData)  loadTab(tab);
  };

  const handleGenerate = () => {
    setDashboardData(null);
    setTrialBalData(null);
    setRegisterData(null);
    loadTab(activeTab, asOfDate);
  };

  return (
    <div style={{ padding: 20 }} className="animate-in">
      {selectedAssetId && (
        <AssetDetailsPopup assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} />
      )}

      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Landmark size={18} style={{ color: 'var(--brand)' }} /> Fixed Asset Register
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="fg">
            <label>As of Date</label>
            <DatePicker value={asOfDate} onChange={v => setAsOfDate(v)} />
          </div>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
            <Search size={14} /> {loading ? 'Loading…' : 'Generate'}
          </button>
          <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}>🖨 Print</button>
        </div>
      </div>

      {/* Print header */}
      <div className="print-only" style={{ display: 'none', textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>SILVERSTAR DIAM PVT. LTD.</div>
        <div style={{ fontWeight: 600 }}>Fixed Asset Register — As of {asOfDate}</div>
      </div>

      {/* Tabs */}
      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              style={{
                padding: '7px 18px',
                borderRadius: 6,
                border: isActive ? 'none' : '1px solid var(--g200)',
                background: isActive ? 'var(--brand)' : '#fff',
                color: isActive ? '#fff' : 'var(--g600)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {loading
        ? <div className="empty-state"><div className="spinner" /></div>
        : (
          <>
            {activeTab === 'dashboard'      && <DashboardTab     data={dashboardData} />}
            {activeTab === 'trial-balance'  && <TrialBalanceTab  data={trialBalData}  />}
            {activeTab === 'asset-register' && <AssetRegisterTab data={registerData}  onSelectAsset={setSelectedAssetId} />}
          </>
        )
      }
    </div>
  );
}

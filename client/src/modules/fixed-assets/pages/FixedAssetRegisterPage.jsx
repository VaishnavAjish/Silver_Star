import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { Search, BookOpen, BarChart2, List } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';
const round2  = v => Math.round(Number(v || 0) * 100) / 100;

const th    = { textAlign: 'left',  padding: '6px 10px', borderBottom: '2px solid var(--g200)', fontSize: 12, color: 'var(--g600)' };
const td    = { padding: '5px 10px', borderBottom: '1px solid var(--g100)', fontSize: 13 };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const VIEWS = [
  { key: 'dashboard',      label: 'Dashboard',       icon: BarChart2 },
  { key: 'trial-balance',  label: 'Trial Balance',   icon: BookOpen  },
  { key: 'asset-register', label: 'Asset Register',  icon: List      },
];

const MODES = [
  { key: 'category', label: 'Category View' },
  { key: 'summary',  label: 'Summary View' },
  { key: 'detailed', label: 'Detailed View' },
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
              { label: 'Asset Name',     value: asset.asset_name },
              { label: 'Category',       value: asset.category_name },
              { label: 'Purchase Date',  value: fmtDate(asset.purchase_date) },
              { label: 'In Service',     value: fmtDate(asset.in_service_date) },
            ].map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>{f.label}</div>
                <div style={{ fontWeight: 600 }}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {[
              { label: 'Purchase Cost',      value: fmt(asset.purchase_cost),             color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9' },
              { label: 'Accum. Depr',        value: fmt(asset.accumulated_depreciation),  color: 'var(--red)', bg: '#FFEBEE', bc: '#EF9A9A' },
              { label: 'WDV Today',          value: fmt(asset.wdv_today),                color: 'var(--brand-dark)', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)' },
            ].map((c, i) => (
              <div key={i} style={{ background: c.bg, padding: 12, borderRadius: 6, border: `1px solid ${c.bc}` }}>
                <div style={{ fontSize: 11, color: c.color, fontWeight: 700, textTransform: 'uppercase' }}>{c.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c.color, fontFamily: 'var(--mono)' }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Depr Method',  value: `${asset.depreciation_method} @ ${asset.depreciation_rate_pct}%` },
              { label: 'Useful Life',  value: `${asset.useful_life_years} Years` },
              { label: 'Status',       value: <span className={`badge b-${asset.status === 'active' ? 'active' : 'draft'}`}>{asset.status}</span> },
              { label: 'Location',     value: asset.location_name || '—' },
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
function DashboardTable({ data }) {
  if (!data) return <p style={{ padding: 24 }}>No data. Click Apply to load.</p>;
  const { kpi, categories, depreciation_trend } = data;
  const maxTrend = Math.max(...(depreciation_trend || []).map(t => t.amount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { label: 'Total Assets',   value: kpi.total_assets,    color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9', mono: false },
          { label: 'Active Assets',  value: kpi.active_assets,   color: '#2E7D32', bg: '#E8F5E9', bc: '#A5D6A7', mono: false },
          { label: 'Disposed',       value: kpi.disposed_assets, color: '#757575', bg: '#F5F5F5', bc: '#E0E0E0', mono: false },
          { label: 'Total Cost',     value: fmt(kpi.total_cost), color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9', mono: true },
          { label: 'Accum Depr',     value: fmt(kpi.total_accum_depr), color: '#C62828', bg: '#FFEBEE', bc: '#EF9A9A', mono: true },
          { label: 'Net Book Value', value: fmt(kpi.total_wdv),  color: 'var(--brand-dark)', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)', mono: true },
        ].map((c, i) => (
          <div key={i} style={{ padding: '10px 14px', background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: c.color, marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: c.mono ? 14 : 20, fontWeight: 700, color: c.color, fontFamily: c.mono ? 'var(--mono)' : 'inherit' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Overall progress */}
      <div style={{ padding: '10px 14px', background: 'var(--g50)', borderRadius: 8, border: '1px solid var(--g200)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase' }}>Overall Depreciation Progress</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: kpi.overall_depr_pct >= 75 ? 'var(--red)' : 'var(--brand-dark)' }}>{kpi.overall_depr_pct}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--g200)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(kpi.overall_depr_pct, 100)}%`,
            background: kpi.overall_depr_pct >= 75 ? 'var(--red)' : 'var(--brand)', transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Category breakdown */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Category</th>
            <th style={{ ...th, textAlign: 'right' }}>Assets</th>
            <th style={{ ...th, textAlign: 'right' }}>Cost (₹)</th>
            <th style={{ ...th, textAlign: 'right' }}>Accum Depr (₹)</th>
            <th style={{ ...th, textAlign: 'right' }}>Net Book Value (₹)</th>
            <th style={{ ...th, width: 160 }}>Depr Progress</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, i) => (
            <tr key={i}>
              <td style={td}><span style={{ fontWeight: 600 }}>{cat.category_name}</span></td>
              <td style={tdNum}>{cat.active_count} active{cat.disposed_count > 0 ? ` / ${cat.disposed_count} disposed` : ''}</td>
              <td style={{ ...tdNum, color: '#0D47A1' }}>{fmt(cat.total_cost)}</td>
              <td style={{ ...tdNum, color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</td>
              <td style={{ ...tdNum, fontWeight: 700, color: 'var(--brand-dark)' }}>{fmt(cat.total_wdv)}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--g100)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(cat.depr_pct, 100)}%`,
                      background: cat.depr_pct >= 75 ? 'var(--red)' : 'var(--brand)' }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--g500)', minWidth: 30 }}>{cat.depr_pct}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Trend chart */}
      {depreciation_trend && depreciation_trend.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 10 }}>Depreciation Posted — Last 12 Months</div>
          <div style={{ padding: 14, background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
              {depreciation_trend.map((t, i) => {
                const h = Math.round((t.amount / Math.max(...depreciation_trend.map(x => x.amount), 1)) * 80);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div title={fmt(t.amount)} style={{ width: '100%', height: h, minHeight: 2, background: 'var(--brand)', borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
                    <div style={{ fontSize: 9, color: 'var(--g500)', writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 40 }}>{t.month}</div>
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
function TrialBalanceTable({ data }) {
  if (!data) return <p style={{ padding: 24 }}>No data. Click Apply to load.</p>;
  const { accounts, category_mapping, grand_total_debit, grand_total_credit } = data;

  if (!accounts || accounts.length === 0)
    return <p style={{ padding: 24, color: 'var(--g500)' }}>No GL accounts linked to fixed asset categories.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Category mapping */}
      {category_mapping?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 8 }}>Category → GL Account Mapping</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Category</th>
                <th style={th}>Asset Account</th>
                <th style={th}>Accum Depr Account</th>
                <th style={th}>Depr Expense Account</th>
              </tr>
            </thead>
            <tbody>
              {category_mapping.map((c, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{c.category_name}</td>
                  <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {c.asset_account_code ? `${c.asset_account_code} — ${c.asset_account_name}` : <span style={{ color: 'var(--g400)' }}>—</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {c.accum_depr_code ? `${c.accum_depr_code} — ${c.accum_depr_name}` : <span style={{ color: 'var(--g400)' }}>—</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11 }}>
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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase', marginBottom: 8 }}>GL Account Balances</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 90 }}>Code</th>
              <th style={th}>Account Name</th>
              <th style={th}>Type</th>
              <th style={{ ...th, textAlign: 'right' }}>Total Debit (₹)</th>
              <th style={{ ...th, textAlign: 'right' }}>Total Credit (₹)</th>
              <th style={{ ...th, textAlign: 'right' }}>Net Balance (₹)</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={i}>
                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>{a.code}</td>
                <td style={{ ...td, fontWeight: 500 }}>{a.name}</td>
                <td style={td}><span className="badge b-draft" style={{ fontSize: 10 }}>{a.sub_type || a.account_type}</span></td>
                <td style={{ ...tdNum, color: '#0D47A1' }}>{fmt(a.total_debit)}</td>
                <td style={{ ...tdNum, color: 'var(--red)' }}>{fmt(a.total_credit)}</td>
                <td style={{ ...tdNum, fontWeight: 700 }}>{fmt(a.net_balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--g50)', fontWeight: 700 }}>
              <td colSpan={3} style={{ ...td, textAlign: 'right', color: 'var(--g700)' }}>Grand Total</td>
              <td style={{ ...tdNum, color: '#0D47A1', fontWeight: 700 }}>{fmt(grand_total_debit)}</td>
              <td style={{ ...tdNum, color: 'var(--red)', fontWeight: 700 }}>{fmt(grand_total_credit)}</td>
              <td style={{ ...tdNum, fontWeight: 800, color: 'var(--brand-dark)' }}>{fmt(round2(grand_total_debit - grand_total_credit))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── ASSET REGISTER TAB ─────────────────────────────────────────────────────────
function AssetRegisterTable({ data, mode, onSelectAsset }) {
  if (!data) return <p style={{ padding: 24 }}>No data. Click Apply to load.</p>;

  // Collect all assets into a single list for Detailed View
  const allAssets = data.categories.flatMap(c => 
    c.assets.map(a => ({ ...a, category_name: c.category_name }))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── SUMMARY VIEW ── */}
      {mode === 'summary' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr>
              <th style={th}>Category Name</th>
              <th style={{ ...th, textAlign: 'right', width: 130 }}>Total Cost (₹)</th>
              <th style={{ ...th, textAlign: 'right', width: 140 }}>Accum Depr (₹)</th>
              <th style={{ ...th, textAlign: 'right', width: 130 }}>Net Book Value (₹)</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((cat, i) => (
              <tr key={i}>
                <td style={{ ...td, fontWeight: 600 }}>{cat.category_name}</td>
                <td style={{ ...tdNum, color: '#0D47A1' }}>{fmt(cat.total_cost)}</td>
                <td style={{ ...tdNum, color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</td>
                <td style={{ ...tdNum, fontWeight: 700, color: 'var(--brand-dark)' }}>{fmt(cat.total_wdv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── DETAILED VIEW ── */}
      {mode === 'detailed' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 90 }}>Asset Code</th>
              <th style={th}>Asset Name</th>
              <th style={th}>Category</th>
              <th style={{ ...th, textAlign: 'right', width: 60 }}>Qty</th>
              <th style={{ ...th, width: 105 }}>Purchase Date</th>
              <th style={{ ...th, width: 105 }}>In Service</th>
              <th style={{ ...th, textAlign: 'right', width: 130 }}>Cost (₹)</th>
              <th style={{ ...th, textAlign: 'right', width: 140 }}>Accum Depr (₹)</th>
              <th style={{ ...th, textAlign: 'right', width: 130 }}>WDV (₹)</th>
              <th style={{ ...th, width: 70 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {allAssets.map((a, i) => (
              <tr key={i}
                onDoubleClick={() => a.id && onSelectAsset(a.id)}
                style={{ cursor: a.id ? 'pointer' : 'default' }}
              >
                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>{a.asset_code}</td>
                <td style={{ ...td, fontWeight: 500 }}>{a.asset_name}</td>
                <td style={td}>{a.category_name}</td>
                <td style={tdNum}>{a.qty}</td>
                <td style={td}>{fmtDate(a.purchase_date)}</td>
                <td style={td}>{fmtDate(a.in_service_date)}</td>
                <td style={{ ...tdNum, color: '#0D47A1' }}>{fmt(a.purchase_cost)}</td>
                <td style={{ ...tdNum, color: 'var(--red)' }}>{fmt(a.accumulated_depreciation)}</td>
                <td style={{ ...tdNum, fontWeight: 600 }}>{fmt(a.wdv_as_of)}</td>
                <td style={td}><span className={`badge b-${a.status === 'active' ? 'active' : 'draft'}`} style={{ fontSize: 10 }}>{a.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── CATEGORY VIEW ── */}
      {mode === 'category' && data.categories.map((cat, ci) => {
        // Group assets by asset_name
        const grouped = Object.values(cat.assets.reduce((acc, a) => {
          if (!acc[a.asset_name]) {
            acc[a.asset_name] = {
              asset_name: a.asset_name,
              count: 0,
              purchase_cost: 0,
              accumulated_depreciation: 0,
              wdv_as_of: 0
            };
          }
          acc[a.asset_name].count += Number(a.qty || 1);
          acc[a.asset_name].purchase_cost += Number(a.purchase_cost || 0);
          acc[a.asset_name].accumulated_depreciation += Number(a.accumulated_depreciation || 0);
          acc[a.asset_name].wdv_as_of += Number(a.wdv_as_of || 0);
          return acc;
        }, {}));

        return (
          <div key={ci} style={{ marginBottom: 24 }}>
            {/* Category heading — same style as CC reports "CC01 – Project Cost" */}
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--g800)', padding: '6px 0', marginBottom: 4, borderBottom: '2px solid var(--g200)' }}>
              {cat.category_name}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Asset Name</th>
                  <th style={{ ...th, textAlign: 'right', width: 100 }}>Quantity</th>
                  <th style={{ ...th, textAlign: 'right', width: 130 }}>Cost (₹)</th>
                  <th style={{ ...th, textAlign: 'right', width: 140 }}>Accum Depr (₹)</th>
                  <th style={{ ...th, textAlign: 'right', width: 130 }}>WDV (₹)</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((a, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 500 }}>{a.asset_name}</td>
                    <td style={tdNum}>{a.count}</td>
                    <td style={{ ...tdNum, color: '#0D47A1' }}>{fmt(a.purchase_cost)}</td>
                    <td style={{ ...tdNum, color: 'var(--red)' }}>{fmt(a.accumulated_depreciation)}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{fmt(a.wdv_as_of)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--g50)' }}>
                  <td colSpan={2} style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--g700)' }}>{cat.category_name} Total</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: '#0D47A1' }}>{fmt(cat.total_cost)}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: 'var(--brand-dark)' }}>{fmt(cat.total_wdv)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {/* Grand total — same style as CC reports "Overall Grand Total" */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 0', borderTop: '2px solid var(--g300)', marginTop: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--g700)', marginRight: 24 }}>Overall Grand Total</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, color: 'var(--brand-dark)' }}>
          {fmt(data.grand_total_wdv)}
        </span>
      </div>
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function FixedAssetRegister() {
  const api      = useApi();
  const [view, setView]         = useState('dashboard');
  const [mode, setMode]         = useState('category');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);

  const load = useCallback(async (v, d) => {
    const tab  = v || view;
    const date = d || asOfDate;
    setLoading(true);
    setData(null);
    try {
      const endpointMap = {
        'dashboard':      `/api/reports/fixed-asset-dashboard?asOfDate=${date}`,
        'trial-balance':  `/api/reports/fixed-asset-trial-balance?asOfDate=${date}`,
        'asset-register': `/api/reports/fixed-asset-register?asOfDate=${date}`,
      };
      const r = await api.get(endpointMap[tab]);
      setData(r);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [api, view, asOfDate]);

  // Load on mount
  useEffect(() => { load('dashboard', asOfDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (v) => {
    setView(v);
    load(v, asOfDate);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {selectedAssetId && (
        <AssetDetailsPopup assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} />
      )}

      {/* ── Tab bar + filter — fixed, never scrolls ── */}
      <div style={{ flexShrink: 0, padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            className={`btn ${view === v.key ? 'btn-primary' : ''}`}
            onClick={() => handleTabChange(v.key)}
          >
            {v.label}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          {view === 'asset-register' && (
            <div className="filter-field" style={{ width: 160 }}>
              <label className="filter-label">View Mode</label>
              <SearchableSelect
                dropdownSearch
                placeholder="Category View"
                value={MODES.find(m => m.key === mode) ? { id: mode, name: MODES.find(m => m.key === mode).label } : null}
                onChange={v => setMode(v ? v.id : 'category')}
                options={MODES.map(m => ({ id: m.key, name: m.label }))}
              />
            </div>
          )}
          <div className="filter-field" style={{ width: 160 }}>
            <label className="filter-label">As of Date</label>
            <DatePicker value={asOfDate} onChange={v => setAsOfDate(v || '')} />
          </div>
          <button className="btn" onClick={() => load(view, asOfDate)}>Apply</button>
          <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}>🖨 Print</button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 16px 24px' }}>
        {loading ? (
          <p style={{ padding: 24 }}>Loading...</p>
        ) : (
          <>
            {view === 'dashboard'      && <DashboardTable      data={data} />}
            {view === 'trial-balance'  && <TrialBalanceTable   data={data} />}
            {view === 'asset-register' && <AssetRegisterTable  data={data} mode={mode} onSelectAsset={setSelectedAssetId} />}
          </>
        )}
      </div>
    </div>
  );
}

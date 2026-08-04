import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { exportToCSV, printTable } from '../../../shared/utils/exportUtils';
import Modal from '../../../shared/components/Modal';
import { Search, X, RefreshCw, Download, Printer, AlertTriangle, Package, Info } from 'lucide-react';

/* Gas is quantity / cylinder control. Consumption is NOT recorded anywhere in
 * the current data model, so nothing on this page may be labelled as usage. */
const DASH = '—';
const CENTRAL = 'Unassigned / Central Stock';

const num   = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const day   = v => (v ? new Date(v).toLocaleDateString('en-IN') : DASH);

/* ── Drill-down ───────────────────────────────────────────────────────────── */
function GasLots({ open, onClose, target, api, canViewValue }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ total_lots: 0, total_qty: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoading(true);
    const p = new URLSearchParams({ item_id: target.item_id, unit: target.unit || '' });
    api.get(`/api/inventory/gas-stock/lots?${p}`)
      .then(res => {
        if (cancelled) return;
        setRows(res.data || []);
        setTotals({ total_lots: res.total_lots || 0, total_qty: res.total_qty || 0 });
      })
      .catch(err => { if (!cancelled) toast.error(err.message || 'Failed to load Gas lots'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, target, api]);

  if (!open || !target) return null;

  return (
    <Modal open={open} onClose={onClose} large
      title={`${target.gas_item} · ${target.unit || DASH}`}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--g200)', fontSize: 12,
                    display: 'flex', gap: 14 }}>
        <span><strong>{totals.total_lots}</strong> lots</span>
        <span><strong>{num(totals.total_qty)}</strong> {target.unit} on hand</span>
      </div>
      <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
        {loading ? <div className="empty-state" style={{ padding: 40 }}><div className="spinner" /></div>
          : rows.length === 0 ? <div className="empty-state" style={{ padding: 40 }}><Package size={26} /><p>No lots</p></div>
          : (
            <table className="dgrid">
              <thead><tr>
                <th>Lot</th><th className="num">ID</th><th className="num">Qty</th><th>Unit</th>
                <th>Status</th><th>Vendor</th><th>Department / Scope</th><th>Location</th>
                <th>Received</th><th>Source</th>
                {canViewValue && <th className="num">Value</th>}
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.lot_code || r.lot_number}</td>
                    <td className="num">{r.id}</td>
                    <td className="num">{num(r.qty)}</td>
                    <td>{r.unit || DASH}</td>
                    <td><span className="badge b-stock" style={{ fontSize: 9 }}>{r.status}</span></td>
                    <td style={{ fontSize: 11 }}>{r.vendor_name || DASH}</td>
                    <td style={{ fontSize: 11 }}>{r.department_name || CENTRAL}</td>
                    <td style={{ fontSize: 11 }}>{r.location_name || DASH}</td>
                    <td style={{ fontSize: 11 }}>{day(r.purchase_date)}</td>
                    <td style={{ fontSize: 11 }}>{r.source_module || DASH}</td>
                    {canViewValue && <td className="num">{money(r.total_value)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </Modal>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function GasStockPage() {
  const api = useApi();
  const { hasPermission } = useAuth();

  const canExport = hasPermission('inventory', 'export', 'gas_stock');
  const canPrint  = hasPermission('inventory', 'print',  'gas_stock');

  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [denied, setDenied]     = useState(false);
  const [target, setTarget]     = useState(null);

  const [filters, setFilters] = useState({
    search: '', unit: '', department_id: '', location_id: '', min_qty: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [depts, setDepts] = useState([]);
  const [locs, setLocs]   = useState([]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
    return p.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get(`/api/inventory/gas-stock?${query}`));
      setDenied(false);
    } catch (err) {
      if (err.status === 403 || err.response?.status === 403) { setDenied(true); setData(null); }
      else { toast.error(err.message || 'Failed to load Gas stock'); setData(null); }
    } finally { setLoading(false); }
  }, [api, query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.get('/api/departments?limit=500').catch(() => null),
      api.get('/api/locations?limit=500').catch(() => null),
    ]).then(([d, l]) => {
      setDepts(d?.data || d || []);
      setLocs(l?.data || l || []);
    });
  }, [api]);

  const refresh = async () => { setSpinning(true); try { await load(); } finally { setSpinning(false); } };
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const handleExport = async (format) => {
    setExporting(true);
    try {
      const p = await api.get(`/api/inventory/gas-stock/export?format=${format}&${query}`);
      const rows = [...p.rows, [], ['Notes'], ...p.notes.map(n => [n])];
      if (format === 'csv') exportToCSV(p.filename, p.headers, rows);
      else printTable(p.title, p.subtitle, p.headers, rows);
    } catch (err) {
      toast.error(err.status === 403 || err.response?.status === 403
        ? 'You do not have permission to export or print Gas stock.'
        : (err.message || 'Export failed'));
    } finally { setExporting(false); }
  };

  const rows       = data?.rows || [];
  const summary    = data?.summary;
  const mixed      = data?.data_quality?.mixed_unit_items || [];
  const centralOk  = data?.limitations?.central_stock_visible;
  const canValue   = !!(summary && 'total_value' in summary);
  const unitTotals = summary ? Object.entries(summary.totals_by_unit) : [];

  if (denied) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <AlertTriangle size={32} style={{ color: '#b45309' }} />
        <p style={{ fontWeight: 600, marginTop: 8 }}>Gas Stock access required</p>
        <p style={{ fontSize: 12, color: 'var(--g600)' }}>
          Ask an administrator for the Gas Stock view permission.
        </p>
      </div>
    );
  }

  return (
    <>
      <GasLots open={!!target} target={target} onClose={() => setTarget(null)}
               api={api} canViewValue={canValue} />

      <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Toolbar */}
        <div className="grid-toolbar" style={{ flexWrap: 'wrap', rowGap: 8 }}>
          <div className="filter-field" style={{ width: 190 }}>
            <label className="filter-label">Gas Item</label>
            <div className="grid-toolbar-search">
              <Search size={14} />
              <input placeholder="Search gas item…" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setF('search', searchInput)} />
              {searchInput && (
                <button className="icon-btn" style={{ flexShrink: 0 }}
                  onClick={() => { setSearchInput(''); setF('search', ''); }}><X size={12} /></button>
              )}
            </div>
          </div>

          <div className="filter-field" style={{ width: 110 }}>
            <label className="filter-label">Unit</label>
            <select value={filters.unit} onChange={e => setF('unit', e.target.value)}>
              <option value="">All</option>
              {unitTotals.map(([u]) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div className="filter-field" style={{ width: 150 }}>
            <label className="filter-label">Department / Scope</label>
            <select value={filters.department_id} onChange={e => setF('department_id', e.target.value)}>
              <option value="">All</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="filter-field" style={{ width: 140 }}>
            <label className="filter-label">Location</label>
            <select value={filters.location_id} onChange={e => setF('location_id', e.target.value)}>
              <option value="">All</option>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div className="filter-field" style={{ width: 100 }}>
            <label className="filter-label">Min Qty</label>
            <input type="number" value={filters.min_qty} onChange={e => setF('min_qty', e.target.value)} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Never one combined figure — one total per unit. */}
          <span className="grid-count">
            {unitTotals.length ? unitTotals.map(([u, q]) => `${u}: ${num(q)}`).join('  ·  ') : DASH}
          </span>

          <div className="grid-toolbar-right">
            {canExport && (
              <button className="btn btn-sm" disabled={exporting || loading} onClick={() => handleExport('csv')}>
                <Download size={13} /> CSV
              </button>
            )}
            {canPrint && (
              <button className="btn btn-sm" disabled={exporting || loading} onClick={() => handleExport('print')}>
                <Printer size={13} /> Print
              </button>
            )}
            <button className="icon-btn" title="Refresh" onClick={refresh} disabled={spinning}
              style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Notices */}
        {mixed.length > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e',
                        padding: '8px 16px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={14} />
            Mixed units detected — quantities are reported separately and must not be added:{' '}
            {mixed.map(m => `${m.gas_item} (${m.units.join(', ')})`).join(' · ')}
          </div>
        )}
        {data && !centralOk && (
          <div style={{ background: 'var(--g100)', borderBottom: '1px solid var(--g200)',
                        color: 'var(--g600)', padding: '8px 16px', fontSize: 12,
                        display: 'flex', gap: 8, alignItems: 'center' }}>
            <Info size={14} />
            Unassigned / Central Stock is hidden — it requires central Gas stock authority
            until Gas department ownership is configured.
          </div>
        )}

        {/* Table */}
        <div className="grid-wrap" style={{ overflow: 'auto' }}>
          {loading ? (
            <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
          ) : rows.length === 0 ? (
            <div className="empty-state" style={{ padding: 60 }}>
              <Package size={32} /><p>No Gas stock visible for these filters.</p>
            </div>
          ) : (
            <table className="dgrid" style={{ minWidth: 1040 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, zIndex: 3,
                               background: 'var(--table-header)', minWidth: 190 }}>Gas Item</th>
                  <th>Unit</th>
                  <th className="num">Lot / Cylinder Count</th>
                  <th className="num">Stock On Hand</th>
                  {canValue && <th className="num">Current Stock Value</th>}
                  <th>Department / Stock Scope</th>
                  <th>Location</th>
                  <th>Last Receipt</th>
                  <th>Last Movement</th>
                  <th>Data Quality</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isMixed = mixed.some(m => m.gas_item === r.gas_item);
                  return (
                    <tr key={`${r.item_id}-${r.unit}-${r.department_id}-${r.location_id}-${i}`}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 2, background: '#fff',
                                   fontWeight: 600 }}>
                        <span className="cell-link" style={{ cursor: 'pointer' }}
                          onClick={() => setTarget(r)}>{r.gas_item}</span>
                      </td>
                      <td><span className="badge b-stock" style={{ fontSize: 9 }}>{r.unit || DASH}</span></td>
                      <td className="num">{r.lot_count}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{num(r.current_qty)}</td>
                      {canValue && <td className="num">{money(r.current_value)}</td>}
                      <td style={{ fontSize: 11 }}>
                        {r.department_name || <em style={{ color: 'var(--g600)' }}>{CENTRAL}</em>}
                      </td>
                      <td style={{ fontSize: 11 }}>{r.location_name || DASH}</td>
                      <td style={{ fontSize: 11 }}>{day(r.last_receipt_date)}</td>
                      <td style={{ fontSize: 11 }}>{day(r.last_movement_date)}</td>
                      <td style={{ fontSize: 11 }}>
                        {isMixed
                          ? <span style={{ color: '#92400e', fontWeight: 600 }}>Mixed UOM</span>
                          : <span style={{ color: 'var(--g300)' }}>OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr style={{ position: 'sticky', bottom: 0, background: 'var(--table-header)',
                               fontWeight: 700, borderTop: '2px solid var(--g300)' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 2,
                                 background: 'var(--table-header)' }}>TOTAL (per unit)</td>
                    <td colSpan={2} style={{ fontSize: 11 }}>
                      {unitTotals.map(([u, q]) => `${u}: ${num(q)}`).join('  ·  ')}
                    </td>
                    <td className="num">{summary.total_lots} lots</td>
                    {canValue && <td className="num">{money(summary.total_value)}</td>}
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--g200)', background: 'var(--g100)',
                      fontSize: 11, color: 'var(--g600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>Stock On Hand only — measured gas consumption is not recorded</span>
          <span>Units are never combined</span>
          <span>Opening / purchase totals not derivable (Phase 2)</span>
        </div>
      </div>
    </>
  );
}

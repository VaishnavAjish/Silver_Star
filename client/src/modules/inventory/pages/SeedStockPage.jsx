import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { exportToCSV, printTable } from '../../../shared/utils/exportUtils';
import Modal from '../../../shared/components/Modal';
import { Search, X, RefreshCw, Download, Printer, AlertTriangle, Package } from 'lucide-react';

/* Column order mirrors the backend bucket contract. Hold / Polish / Actual /
 * Variance are Phase 2 — rendered as explicit placeholders, never as zero. */
const PHASE2 = '—';
const BUCKET_COLS = [
  { key: 'new',              label: 'New' },
  { key: 'used',             label: 'Used' },
  { key: 'growth_machine',   label: 'Growth Machine' },
  { key: 'cutting',          label: 'Cutting' },
  { key: 'seed_remove_wip',  label: 'Seed Remove WIP' },
  { key: 'attached_between', label: 'Attached / Between' },
];
const PLACEHOLDER_COLS = [
  { key: 'hold',   label: 'Hold',   tip: 'Not tracked yet — Phase 2' },
  { key: 'polish', label: 'Polish', tip: 'Not tracked yet — Phase 2' },
];
const COUNT_TIP = 'Physical count available in Phase 2';

const num = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });

const BUCKET_LABEL = {
  new: 'New', used: 'Used', growth_machine: 'Growth Machine', cutting: 'Cutting',
  seed_remove_wip: 'Seed Remove WIP', attached_between: 'Attached / Between Processes',
  crack_consumed: 'Crack / Consumed', unclassified: 'Unclassified',
};

/* ── Drill-down ───────────────────────────────────────────────────────────── */
function DrillDown({ open, onClose, cell, api }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ total_lots: 0, total_qty: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !cell) return;
    let cancelled = false;
    setLoading(true);
    const p = new URLSearchParams({ size_key: cell.size_key, bucket: cell.bucket });
    api.get(`/api/inventory/seed-stock/lots?${p}`)
      .then(res => {
        if (cancelled) return;
        setRows(res.data || []);
        setTotals({ total_lots: res.total_lots || 0, total_qty: res.total_qty || 0 });
      })
      .catch(err => { if (!cancelled) toast.error(err.message || 'Failed to load lots'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, cell, api]);

  if (!open || !cell) return null;
  const matches = totals.total_qty === cell.qty;

  return (
    <Modal open={open} onClose={onClose}
      title={`${cell.size_label} · ${BUCKET_LABEL[cell.bucket] || cell.bucket}`} large>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--g200)',
                    display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
        <span><strong>{totals.total_lots}</strong> lots</span>
        <span><strong>{num(totals.total_qty)}</strong> qty</span>
        {!loading && !matches && (
          <span style={{ color: '#b91c1c', fontWeight: 600 }}>
            ⚠ Drill-down ({num(totals.total_qty)}) does not match the matrix cell ({num(cell.qty)})
          </span>
        )}
      </div>
      <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
        {loading ? <div className="empty-state" style={{ padding: 40 }}><div className="spinner" /></div>
          : rows.length === 0 ? <div className="empty-state" style={{ padding: 40 }}><Package size={26} /><p>No lots</p></div>
          : (
            <table className="dgrid">
              <thead><tr>
                <th>Seed Lot</th><th className="num">ID</th><th>Size</th>
                <th className="num">Qty</th><th className="num">Weight</th>
                <th>Status</th><th>Mfg State</th><th>Bucket</th>
                <th>Process</th><th>Growth No.</th><th className="num">Run</th>
                <th>Department</th><th>Location</th><th>Last Movement</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.lot_code || r.lot_number}</td>
                    <td className="num">{r.id}</td>
                    <td>{r.size_label}</td>
                    <td className="num">{num(r.qty)}</td>
                    <td className="num">{r.weight != null ? num(r.weight) : PHASE2}</td>
                    <td><span className="badge b-stock" style={{ fontSize: 9 }}>{r.status}</span></td>
                    <td style={{ fontSize: 11 }}>{r.manufacturing_state}</td>
                    <td style={{ fontSize: 11, fontWeight: 600 }}>{BUCKET_LABEL[r.bucket] || r.bucket}</td>
                    <td style={{ fontSize: 11 }}>{r.resolved_process_type || PHASE2}</td>
                    <td style={{ fontSize: 11 }}>{r.resolved_growth_number || PHASE2}</td>
                    <td className="num">{r.run_no ?? PHASE2}</td>
                    <td style={{ fontSize: 11 }}>{r.department_name || 'Unassigned'}</td>
                    <td style={{ fontSize: 11 }}>{r.location_name || PHASE2}</td>
                    <td style={{ fontSize: 11 }}>
                      {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN') : PHASE2}
                    </td>
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
export default function SeedStockPage() {
  const api = useApi();
  const { hasPermission } = useAuth();

  /* Usability gating only — every endpoint re-checks server-side. */
  const canExport = hasPermission('inventory', 'export', 'seed_stock');
  const canPrint  = hasPermission('inventory', 'print',  'seed_stock');

  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cell, setCell]         = useState(null);

  const [filters, setFilters] = useState({
    search: '', department_id: '', location_id: '', bucket: '',
    min_qty: '', show_zero: 'false',
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
      setData(await api.get(`/api/inventory/seed-stock?${query}`));
    } catch (err) {
      toast.error(err.message || 'Failed to load Seed stock');
      setData(null);
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
      const p = await api.get(`/api/inventory/seed-stock/export?format=${format}&${query}`);
      const rows = [...p.rows, [], ['Limitations'], ...p.notes.map(n => [n])];
      if (format === 'csv') exportToCSV(p.filename, p.headers, rows);
      else printTable(p.title, p.subtitle, p.headers, rows);
    } catch (err) {
      toast.error(err.response?.status === 403 || err.status === 403
        ? 'You do not have permission to export or print Seed stock.'
        : (err.message || 'Export failed'));
    } finally { setExporting(false); }
  };

  const s = data?.summary;
  const rows = data?.rows || [];
  const broken = s && s.reconciliation_difference !== 0;

  return (
    <>
      <DrillDown open={!!cell} cell={cell} onClose={() => setCell(null)} api={api} />

      <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {broken && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b',
                        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
                        fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={16} />
            Reconciliation failed — bucket totals differ from Seed inventory by{' '}
            {num(s.reconciliation_difference)}. Figures below are not trustworthy; report this.
          </div>
        )}

        {/* Toolbar */}
        <div className="grid-toolbar" style={{ flexWrap: 'wrap', rowGap: 8 }}>
          <div className="filter-field" style={{ width: 170 }}>
            <label className="filter-label">Search Size</label>
            <div className="grid-toolbar-search">
              <Search size={14} />
              <input placeholder="e.g. 13 or 26 ×" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setF('search', searchInput)} />
              {searchInput && (
                <button className="icon-btn" style={{ flexShrink: 0 }}
                  onClick={() => { setSearchInput(''); setF('search', ''); }}><X size={12} /></button>
              )}
            </div>
          </div>

          <div className="filter-field" style={{ width: 140 }}>
            <label className="filter-label">Department</label>
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

          <div className="filter-field" style={{ width: 160 }}>
            <label className="filter-label">Bucket</label>
            <select value={filters.bucket} onChange={e => setF('bucket', e.target.value)}>
              <option value="">All</option>
              {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="filter-field" style={{ width: 100 }}>
            <label className="filter-label">Min Qty</label>
            <input type="number" value={filters.min_qty} onChange={e => setF('min_qty', e.target.value)} />
          </div>

          <div className="filter-field" style={{ width: 128 }}>
            <label className="filter-label">Zero Rows</label>
            <select value={filters.show_zero} onChange={e => setF('show_zero', e.target.value)}>
              <option value="false">Hide zero rows</option>
              <option value="true">Show zero rows</option>
            </select>
          </div>

          <div style={{ flex: 1 }} />

          <span className="grid-count">
            {s ? <>Filtered <strong>{num(s.filtered_qty)}</strong> of {num(s.total_qty)} PCS · {s.total_lots} lots</> : '—'}
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

        {/* Matrix */}
        <div className="grid-wrap" style={{ overflow: 'auto' }}>
          {loading ? (
            <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
          ) : rows.length === 0 ? (
            <div className="empty-state" style={{ padding: 60 }}>
              <Package size={32} /><p>No Seed stock matches these filters.</p>
            </div>
          ) : (
            <table className="dgrid" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, zIndex: 3,
                               background: 'var(--table-header)', minWidth: 130 }}>Size</th>
                  {BUCKET_COLS.map(c => <th key={c.key} className="num">{c.label}</th>)}
                  {PLACEHOLDER_COLS.map(c => (
                    <th key={c.key} className="num" title={c.tip} style={{ color: 'var(--g400)' }}>{c.label}</th>
                  ))}
                  <th className="num">Crack / Consumed</th>
                  <th className="num" style={{ fontWeight: 800 }}>System Total</th>
                  <th className="num" title={COUNT_TIP} style={{ color: 'var(--g400)' }}>Actual Stock</th>
                  <th className="num" title={COUNT_TIP} style={{ color: 'var(--g400)' }}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.size_key}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 2, background: '#fff',
                                 fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {r.size_label}
                    </td>
                    {BUCKET_COLS.map(c => {
                      const v = r[c.key];
                      return (
                        <td key={c.key} className="num">
                          {v.lots > 0 ? (
                            <span className="cell-link" style={{ cursor: 'pointer' }}
                              onClick={() => setCell({ size_key: r.size_key, size_label: r.size_label,
                                                       bucket: c.key, qty: v.qty })}>
                              {num(v.qty)}
                            </span>
                          ) : <span style={{ color: 'var(--g300)' }}>0</span>}
                        </td>
                      );
                    })}
                    {PLACEHOLDER_COLS.map(c => (
                      <td key={c.key} className="num" title={c.tip} style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                    ))}
                    <td className="num">
                      {r.crack_consumed.lots > 0 ? (
                        <span className="cell-link" style={{ cursor: 'pointer' }}
                          onClick={() => setCell({ size_key: r.size_key, size_label: r.size_label,
                                                   bucket: 'crack_consumed', qty: r.crack_consumed.qty })}>
                          {num(r.crack_consumed.qty)}
                        </span>
                      ) : <span style={{ color: 'var(--g300)' }}>0</span>}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{num(r.system_total.qty)}</td>
                    <td className="num" title={COUNT_TIP} style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                    <td className="num" title={COUNT_TIP} style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                  </tr>
                ))}
              </tbody>
              {s && (
                <tfoot>
                  <tr style={{ position: 'sticky', bottom: 0, background: 'var(--table-header)',
                               fontWeight: 700, borderTop: '2px solid var(--g300)' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 2,
                                 background: 'var(--table-header)' }}>TOTAL</td>
                    <td className="num">{num(s.new_qty)}</td>
                    <td className="num">{num(s.used_qty)}</td>
                    <td className="num">{num(s.growth_machine_qty)}</td>
                    <td className="num">{num(s.cutting_qty)}</td>
                    <td className="num">{num(s.seed_remove_qty)}</td>
                    <td className="num">{num(s.attached_between_qty)}</td>
                    <td className="num" style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                    <td className="num" style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                    <td className="num">{num(s.crack_consumed_qty)}</td>
                    <td className="num">{num(s.filtered_qty)}</td>
                    <td className="num" style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                    <td className="num" style={{ color: 'var(--g300)' }}>{PHASE2}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {/* Honest footer — what this report cannot yet tell you */}
        {s && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--g200)', background: 'var(--g100)',
                        fontSize: 11, color: 'var(--g600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ color: broken ? '#991b1b' : '#0D7C5F', fontWeight: 600 }}>
              Reconciliation difference: {num(s.reconciliation_difference)}
            </span>
            <span>Unclassified: {s.unclassified_lots} lot(s) / {num(s.unclassified_qty)} qty</span>
            <span>Hold &amp; Polish not tracked (Phase 2)</span>
            <span>Crack not separated from Consumed (Phase 2)</span>
            <span>Physical count &amp; variance in Phase 2</span>
          </div>
        )}
      </div>
    </>
  );
}

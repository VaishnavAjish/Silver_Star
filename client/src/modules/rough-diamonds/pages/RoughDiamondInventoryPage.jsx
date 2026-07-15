import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { Gem, Search, RefreshCw } from 'lucide-react';

/**
 * Rough Diamond Inventory — a THIN read-model preset over the existing
 * Inventory Engine (GET /api/inventory?category=rough). No separate store,
 * no posting actions, no duplicated inventory logic: every number on this
 * page comes from the same API the All Inventory page uses.
 *
 * Genealogy columns reuse the list API's relational fields:
 *   parent_lot_name — the Growth Run biscuit (its lot_number IS the Growth
 *                     Number) for rough lots descending from a Growth Run
 *   root_lot_name   — the original Seed root
 */

const LIST_FIELDS = [
  'id', 'lot_number', 'lot_code', 'qty', 'unit', 'weight', 'status',
  'dim_length', 'dim_depth', 'dim_height', 'dim_unit', 'run_no',
  'parent_lot_name', 'root_lot_name', 'location_name',
  'current_process_name', 'created_at', 'updated_at',
].join(',');

// Summary cards aggregate the SAME inventory data source (one wide fetch,
// capped — beta-scale rough stock is far below this bound).
const SUMMARY_LIMIT = 2000;

const STATUS_OPTIONS = ['', 'IN STOCK', 'IN PROCESS', 'DAMAGED', 'CONSUMED'];

const STATUS_COLORS = {
  'IN STOCK':   { color: '#2E7D32', bg: '#E8F5E9' },
  'LOW STOCK':  { color: '#2E7D32', bg: '#E8F5E9' },
  'IN PROCESS': { color: '#1565C0', bg: '#E3F2FD' },
  'DAMAGED':    { color: '#C62828', bg: '#FFEBEE' },
  'CONSUMED':   { color: '#757575', bg: '#F5F5F5' },
};

function SummaryCard({ label, value, unit, accent }) {
  return (
    <div style={{ flex: '1 1 130px', minWidth: 130, background: '#fff',
      border: '1px solid var(--g200)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.5px', color: 'var(--g500)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--mono)',
        color: accent || 'var(--g900)' }}>
        {value}
        {unit && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--g500)' }}> {unit}</span>}
      </div>
    </div>
  );
}

function stockAgeDays(createdAt) {
  if (!createdAt) return null;
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  return days >= 0 ? days : null;
}

function fmtDims(r) {
  if (r.dim_length == null && r.dim_depth == null && r.dim_height == null) return '—';
  const f = v => (v != null ? Number(v).toFixed(2) : '—');
  return `${f(r.dim_length)} × ${f(r.dim_depth)} × ${f(r.dim_height)} ${r.dim_unit || 'mm'}`;
}

export default function RoughDiamondInventoryPage() {
  const api = useApi();
  const navigate = useNavigate();

  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [summary, setSummary] = useState([]); // wide slice for the cards
  const [loading, setLoading] = useState(true);

  // Filters (all map 1:1 onto existing inventory API query params)
  const [search,     setSearch]     = useState('');
  const [status,     setStatus]     = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [weightMin,  setWeightMin]  = useState('');
  const [weightMax,  setWeightMax]  = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations,  setLocations]  = useState([]);

  const [page, setPage] = useState(0);
  const limit = 50;

  const buildQuery = (extra) => {
    const p = new URLSearchParams({ category: 'rough', ...extra });
    if (search)     p.set('search', search);
    if (status)     p.set('status', status);
    if (dateFrom)   p.set('date_from', dateFrom);
    if (dateTo)     p.set('date_to', dateTo);
    if (weightMin)  p.set('weight_min', weightMin);
    if (weightMax)  p.set('weight_max', weightMax);
    if (locationId) p.set('location_id', locationId);
    return p.toString();
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get(`/api/inventory?${buildQuery({ fields: LIST_FIELDS, limit, offset: page * limit })}`),
      // Cards always reflect the WHOLE rough category (unfiltered), from the
      // same data source — never a second inventory engine.
      api.get(`/api/inventory?category=rough&fields=id,qty,weight,status,created_at&limit=${SUMMARY_LIMIT}`),
    ])
      .then(([list, sum]) => {
        setRows(list.data || []);
        setTotal(list.total || 0);
        setSummary(sum.data || []);
      })
      .catch(() => { setRows([]); setSummary([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [page]);

  useEffect(() => {
    api.get('/api/inventory/filters/active')
      .then(res => setLocations(res.locations || []))
      .catch(() => setLocations([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const acc = {
      lots: 0, pieces: 0, carats: 0,
      available: 0, inProcess: 0, damaged: 0,
      monthLots: 0, monthCarats: 0,
    };
    for (const r of summary) {
      const w = parseFloat(r.weight) || 0;
      acc.lots += 1;
      acc.pieces += parseFloat(r.qty) || 0;
      acc.carats += w;
      if (r.status === 'IN STOCK' || r.status === 'LOW STOCK') acc.available += w;
      else if (r.status === 'IN PROCESS') acc.inProcess += w;
      else if (r.status === 'DAMAGED') acc.damaged += w;
      if (r.created_at && new Date(r.created_at) >= monthStart) {
        acc.monthLots += 1;
        acc.monthCarats += w;
      }
    }
    return acc;
  }, [summary]);

  const applyFilters = () => { setPage(0); load(); };
  const pages = Math.max(1, Math.ceil(total / limit));

  const inputStyle = { padding: '6px 9px', border: '1px solid var(--g300)',
    borderRadius: 6, fontSize: 12, outline: 'none' };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '12px 18px', background: 'var(--g50)',
        borderBottom: '1px solid var(--g200)', display: 'flex',
        alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Gem size={16} style={{ color: 'var(--brand)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--g900)' }}>
            Rough Diamond Inventory
          </div>
          <div style={{ fontSize: 11, color: 'var(--g500)' }}>
            Read model over All Inventory (category = rough) — single inventory source
          </div>
        </div>
        <button className="btn btn-sm" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

        {/* Summary cards — whole rough category, same data source */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <SummaryCard label="Total Lots"        value={cards.lots} />
          <SummaryCard label="Total Pieces"      value={cards.pieces.toFixed(0)} />
          <SummaryCard label="Total Carats"      value={cards.carats.toFixed(4)} unit="ct" />
          <SummaryCard label="Available"         value={cards.available.toFixed(4)} unit="ct" accent="#2E7D32" />
          <SummaryCard label="In Process"        value={cards.inProcess.toFixed(4)} unit="ct" accent="#1565C0" />
          <SummaryCard label="Damaged"           value={cards.damaged.toFixed(4)} unit="ct" accent="#C62828" />
          <SummaryCard label="This Month — Lots" value={cards.monthLots} />
          <SummaryCard label="This Month — Carats" value={cards.monthCarats.toFixed(4)} unit="ct" />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
          padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--g400)' }} />
            <input style={{ ...inputStyle, paddingLeft: 26, width: 190 }}
              placeholder="Lot / Growth Number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyFilters()} />
          </div>
          <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s || 'all'} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <input type="date" style={inputStyle} value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} title="From date" />
          <input type="date" style={inputStyle} value={dateTo}
            onChange={e => setDateTo(e.target.value)} title="To date" />
          <input type="number" step="0.0001" min="0" style={{ ...inputStyle, width: 90 }}
            placeholder="Min ct" value={weightMin} onChange={e => setWeightMin(e.target.value)} />
          <input type="number" step="0.0001" min="0" style={{ ...inputStyle, width: 90 }}
            placeholder="Max ct" value={weightMax} onChange={e => setWeightMax(e.target.value)} />
          <select style={inputStyle} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={applyFilters}>Apply</button>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid var(--g200)',
          borderRadius: 8, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr style={{ background: 'var(--g50)' }}>
                {['Rough Lot', 'Growth Number', 'Run', 'Qty', 'Weight (ct)', 'Dimensions',
                  'Status', 'Process', 'Seed Root', 'Location', 'Updated', 'Age (d)'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px',
                    color: 'var(--g500)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center',
                  fontSize: 12, color: 'var(--g400)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center',
                  fontSize: 12, color: 'var(--g400)' }}>
                  No rough diamond lots match the current filters.
                </td></tr>
              ) : rows.map(r => {
                const sc = STATUS_COLORS[r.status] || { color: 'var(--g600)', bg: 'var(--g100)' };
                const age = stockAgeDays(r.created_at);
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--g100)', cursor: 'pointer' }}
                    onClick={() => navigate(`/inventory/${r.id}`)}
                    title="Open in Lot Workspace">
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 12,
                      fontWeight: 700, color: 'var(--g900)', whiteSpace: 'nowrap' }}>
                      {r.lot_code || r.lot_number}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5,
                      color: 'var(--g700)', whiteSpace: 'nowrap' }}>
                      {r.parent_lot_name || '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                      {r.run_no != null ? `R${r.run_no}` : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                      {r.qty != null ? Number(r.qty).toFixed(0) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5,
                      fontWeight: 700 }}>
                      {r.weight != null ? Number(r.weight).toFixed(4) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11,
                      color: 'var(--g600)', whiteSpace: 'nowrap' }}>
                      {fmtDims(r)}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: sc.color,
                        background: sc.bg, padding: '2px 8px', borderRadius: 10,
                        whiteSpace: 'nowrap' }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--g600)' }}>
                      {r.current_process_name || '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5,
                      color: 'var(--g600)', whiteSpace: 'nowrap' }}>
                      {r.root_lot_name || '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--g600)' }}>
                      {r.location_name || '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--g600)',
                      whiteSpace: 'nowrap' }}>
                      {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                      {age != null ? age : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 10, marginTop: 10, fontSize: 12, color: 'var(--g600)' }}>
          <span>{total} lots · page {page + 1} / {pages}</span>
          <button className="btn btn-sm" disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</button>
          <button className="btn btn-sm" disabled={page + 1 >= pages}
            onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

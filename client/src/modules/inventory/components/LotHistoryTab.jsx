import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import Paginator from '../../../shared/components/Paginator';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import DatePicker from '../../../shared/components/DatePicker';
import { History, Download, User, X, Eye, Layers, XCircle } from 'lucide-react';
import ViewActionDrawer from './ViewActionDrawer';
import ViewUnionDrawer from './ViewUnionDrawer';
import CancellationModal from './CancellationModal';

// ── Unified Lot Transaction Register (P1 read-model) ──────────────────────────
// Dense register over GET /api/inventory/:id/history ({ data, total }).
// Balance After is reconstructed from creation + op_log deltas (see backend
// comment); authoritative stored balances arrive with the P2 ledger.
// txn_status is ACTIVE for every row until the P2 reversal engine lands —
// the Active/Reversed filter is wired now so the UI is forward-compatible.

const SOURCE_OPTIONS = [
  { value: '',             label: 'All Sources' },
  { value: 'creation',     label: 'Creation' },
  { value: 'op_log',       label: 'Operations' },
  { value: 'movement',     label: 'Movements' },
  { value: 'growth_cycle', label: 'Growth Cycles' },
];

const STATUS_OPTIONS = [
  { value: 'ALL',      label: 'All' },
  { value: 'ACTIVE',   label: 'Active' },
  { value: 'REVERSED', label: 'Reversed' },
];

const SOURCE_COLOR = {
  creation:     { color: '#2E7D32', bg: '#E8F5E9' },
  op_log:       { color: '#6A1B9A', bg: '#F3E5F5' },
  movement:     { color: '#E65100', bg: '#FFF3E0' },
  growth_cycle: { color: '#1565C0', bg: '#E3F2FD' },
};

const PER_PAGE = 50;

function fmtNum(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? '—' : n.toFixed(4);
}

export default function LotHistoryTab({ lotId }) {
  const api = useApi();
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const [status,   setStatus]   = useState('ALL');
  const [source,   setSource]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [page,     setPage]     = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  // New action register state
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [unionDrawerOpen, setUnionDrawerOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [reversing, setReversing] = useState(false);

  // Reversal eligibility
  const [eligibility, setEligibility] = useState({ loading: false, can_cancel: false, reason: null });

  const hasFilters = !!(source || dateFrom || dateTo || status !== 'ALL');

  // The full selected row object
  const selectedRow = rows.find(r => r.history_id === selectedRowId);

  const buildParams = useCallback((limit, offset) => {
    const p = new URLSearchParams({ limit, offset });
    if (source)   p.set('source', source);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo)   p.set('date_to', dateTo);
    return p;
  }, [source, dateFrom, dateTo]);

  // Clear selection when filters or lot change
  useEffect(() => {
    setSelectedRowId(null);
  }, [lotId, page, source, dateFrom, dateTo, status]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get(`/api/inventory/${lotId}/history?${buildParams(PER_PAGE, (page - 1) * PER_PAGE)}`)
      .then(res => {
        if (!mounted) return;
        setRows(res.data || []);
        setTotal(res.total ?? 0);
        setError(null);
      })
      .catch(err => { if (mounted) setError(err.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [lotId, page, buildParams, refreshKey]);

  useEffect(() => {
    let mounted = true;
    if (selectedRowId) {
      setEligibility({ loading: true, can_cancel: false, reason: null });
      api.get(`/api/inventory/history/eligibility?lot_id=${lotId}&canonical_transaction_key=${encodeURIComponent(selectedRowId)}`)
        .then(res => {
          if (mounted) setEligibility({ loading: false, can_cancel: res.can_cancel, reason: res.reason });
        })
        .catch(err => {
          if (mounted) setEligibility({ loading: false, can_cancel: false, reason: err.message });
        });
    } else {
      setEligibility({ loading: false, can_cancel: false, reason: null });
    }
    return () => { mounted = false; };
  }, [selectedRowId, lotId, api]);

  // Reversal orchestration triggered by CancellationModal
  const handleConfirmReversal = async (row, reason) => {
    if (!reason || !reason.trim()) return;
    setReversing(true);
    try {
      // Reversal Orchestrator endpoint
      await api.post(`/api/inventory/history/reverse`, {
        lot_id: lotId,
        canonical_transaction_key: row.history_id,
        reason: reason.trim()
      });
      toast.success(`Transaction reversed successfully`);
      setCancelModalOpen(false);
      setSelectedRowId(null);
      // P2: Refresh complete workspace by firing a custom event to LotWorkspacePage
      window.dispatchEvent(new CustomEvent('workspace:refresh', { detail: { lotId } }));
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReversing(false);
    }
  };

  const pages = Math.ceil(total / PER_PAGE);

  // Status filter is client-side until P2 (every row is ACTIVE today).
  const visible = status === 'ALL' ? rows : rows.filter(r => (r.txn_status || 'ACTIVE') === status);

  const exportCsv = async () => {
    try {
      const res = await api.get(`/api/inventory/${lotId}/history?${buildParams(10000, 0)}`);
      const all = (res.data || []).filter(r => status === 'ALL' || (r.txn_status || 'ACTIVE') === status);
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Date', 'Doc No', 'Type', 'Source', 'Status Change', 'Qty Delta', 'Balance After', 'Txn Status', 'Details', 'Remarks', 'Operator'];
      const lines = all.map(r => [
        r.ts, r.doc_no, r.event_type, r.source, r.status_change,
        r.qty_delta, r.qty_after, r.txn_status,
        [r.weight_change, r.dimension_change].filter(Boolean).join(' | '),
        r.remarks, r.user,
      ].map(esc).join(','));
      const blob = new Blob([[header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `lot-${lotId}-transactions.csv`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { /* surfaced by the grid error state on next load */ }
  };

  const clearFilters = () => { setStatus('ALL'); setSource(''); setDateFrom(''); setDateTo(''); setPage(1); };

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--brand-dark)' }}>
        Error loading history: {error}
      </div>
    );
  }


  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px',
        color: 'var(--brand-dark)', marginBottom: 10, paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
        <History size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Transaction Register
      </div>

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="filter-field" style={{ width: 130 }}>
          <label className="filter-label">Status</label>
          <SelectDropdown value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectDropdown>
        </div>
        <div className="filter-field" style={{ width: 150 }}>
          <label className="filter-label">Source</label>
          <SelectDropdown value={source} onChange={e => { setSource(e.target.value); setPage(1); }}>
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectDropdown>
        </div>
        <div className="filter-field" style={{ width: 150 }}>
          <label className="filter-label">From</label>
          <DatePicker value={dateFrom} onChange={v => { setDateFrom(v); setPage(1); }} className="dp-compact" placeholder="From date" />
        </div>
        <div className="filter-field" style={{ width: 150 }}>
          <label className="filter-label">To</label>
          <DatePicker value={dateTo} onChange={v => { setDateTo(v); setPage(1); }} className="dp-compact" placeholder="To date" />
        </div>
        {hasFilters && (
          <button className="btn btn-sm" onClick={clearFilters}><X size={11} /> Clear</button>
        )}
        <div style={{ flex: 1 }} />

        {/* Action Toolbar */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--g100)', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--g200)' }}>
          <button
            className="btn btn-sm"
            disabled={!selectedRow || !selectedRow.can_view_union}
            title={selectedRow ? (selectedRow.can_view_union ? '' : 'Cannot determine transaction union for this event.') : 'Select a row first'}
            onClick={() => setUnionDrawerOpen(true)}
          >
            <Layers size={11} /> View Union
          </button>
          <button
            className="btn btn-sm"
            disabled={!selectedRow || !selectedRow.can_view_action}
            title={!selectedRow ? 'Select a row first' : ''}
            onClick={() => setActionDrawerOpen(true)}
          >
            <Eye size={11} /> View Action
          </button>
          <button
            className="btn btn-sm"
            disabled={!selectedRow || !eligibility.can_cancel || eligibility.loading}
            title={selectedRow ? (eligibility.loading ? 'Checking eligibility...' : (eligibility.can_cancel ? '' : eligibility.reason || 'Reversal not supported')) : 'Select a row first'}
            onClick={() => setCancelModalOpen(true)}
            style={selectedRow && eligibility.can_cancel ? { color: '#C62828', borderColor: '#C62828' } : {}}
          >
            <XCircle size={11} /> Cancel Transaction
          </button>
        </div>

        <span style={{ fontSize: 11, color: 'var(--g500)', marginLeft: 8 }}>
          {total} transaction{total !== 1 ? 's' : ''}
        </span>
        <button className="btn btn-sm" onClick={exportCsv} disabled={loading || total === 0}>
          <Download size={11} /> Export CSV
        </button>
      </div>

      {/* ── Register grid ── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--g400)', fontStyle: 'italic',
          border: '1px dashed var(--g300)', borderRadius: 8 }}>
          {hasFilters ? 'No transactions match the current filters.' : 'No history recorded for this lot.'}
        </div>
      ) : (
        // Full-width register: tableLayout fixed lets the unspecified Details
        // column absorb ALL remaining width; minWidth keeps columns readable —
        // horizontal scroll appears ONLY below ~1100px viewports, never at 1920.
        <div style={{ overflowX: 'auto', border: '1px solid var(--g200)', borderRadius: 8, width: '100%' }}>
          <table className="dgrid" style={{ width: '100%', minWidth: 1100, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: 'center' }}></th>
                <th style={{ width: 128 }}>Date</th>
                <th style={{ width: 110 }}>Doc No</th>
                <th style={{ width: 130 }}>Type</th>
                <th style={{ width: 92 }}>Source</th>
                <th style={{ width: 88 }}>Status →</th>
                <th style={{ width: 78 }} className="num">Qty Δ</th>
                <th style={{ width: 90 }} className="num">Balance After</th>
                <th style={{ width: 96 }}>Txn</th>
                <th>Details / Remarks</th>
                <th style={{ width: 110 }}>Operator</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const sc = SOURCE_COLOR[r.source] || { color: 'var(--g600)', bg: 'var(--g100)' };
                const delta = r.qty_delta != null ? parseFloat(r.qty_delta) : null;
                const details = [r.weight_change, r.dimension_change, r.remarks].filter(Boolean).join(' · ');
                return (
                  <tr
                    key={r.history_id}
                    onClick={() => setSelectedRowId(r.history_id)}
                    style={{
                      cursor: 'pointer',
                      background: selectedRowId === r.history_id ? 'var(--blue-50)' : undefined
                    }}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedRowId === r.history_id}
                        onChange={() => setSelectedRowId(r.history_id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select transaction ${r.event_type} on ${r.ts}`}
                      />
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.doc_no || '—'}</td>
                    <td style={{ fontSize: 11, fontWeight: 600 }}>{r.event_type}</td>
                    <td>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        color: sc.color, background: sc.bg, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                        {r.source?.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>{r.status_change || '—'}</td>
                    <td className="num" style={{ fontSize: 11, fontFamily: 'var(--mono)',
                      color: (!r.affects_qty_balance || delta == null || delta === 0) ? 'var(--g400)' : delta < 0 ? '#C62828' : '#2E7D32' }}>
                      {(!r.affects_qty_balance || delta == null || delta === 0) ? '—' : (delta > 0 ? `+${fmtNum(delta)}` : fmtNum(delta))}
                    </td>
                    <td className="num" style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700 }}>
                      {fmtNum(r.qty_after)}
                    </td>
                    <td>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        color: r.txn_status === 'REVERSED' ? '#C62828' : '#2E7D32',
                        background: r.txn_status === 'REVERSED' ? '#FFEBEE' : '#E8F5E9' }}>
                        {r.txn_status || 'ACTIVE'}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--g600)', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={details || undefined}>
                      {details || '—'}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {r.user
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={10} /> {r.user}
                          </span>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <Paginator page={page} totalPages={pages} onPage={p => setPage(p)} />
        </div>
      )}

      {/* ── Drawers & Modals ── */}
      <ViewActionDrawer
        open={actionDrawerOpen}
        onClose={() => setActionDrawerOpen(false)}
        actionRow={selectedRow}
      />

      <ViewUnionDrawer
        open={unionDrawerOpen}
        onClose={() => setUnionDrawerOpen(false)}
        actionRow={selectedRow}
        lotId={lotId}
      />

      <CancellationModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        actionRow={selectedRow}
        onConfirm={handleConfirmReversal}
        isSubmitting={reversing}
      />
    </div>
  );
}

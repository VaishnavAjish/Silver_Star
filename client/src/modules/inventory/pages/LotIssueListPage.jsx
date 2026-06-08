import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Paginator from '../../../shared/components/Paginator';
import Modal from '../../../shared/components/Modal';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import DatePicker from '../../../shared/components/DatePicker';
import { Send, RefreshCw, Clock, RotateCcw, Search, X } from 'lucide-react';

// ── Display-status badge config ───────────────────────────────────────────────
const DS_BADGE = {
  OPEN:     { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80', label: 'Open' },
  PARTIAL:  { bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9', label: 'Partial' },
  RETURNED: { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7', label: 'Returned' },
  OVERDUE:  { bg: '#FFEBEE', color: '#C62828', border: '#EF9A9A', label: 'Overdue' },
};
const dsBadge = s => DS_BADGE[s] || { bg: 'var(--g100)', color: 'var(--g600)', border: 'var(--g300)', label: s };

// Backward-compat for modal: old DB status badge
const OLD_STATUS_BADGE = {
  OPEN:     { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
  RETURNED: { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
};
const oldStatusBadge = s => OLD_STATUS_BADGE[s] || { bg: 'var(--g100)', color: 'var(--g600)', border: 'var(--g300)' };

const RETURN_TYPE_COLOR = {
  usable: '#2E7D32', damaged: '#C62828', consumed: '#757575',
  reprocess: '#1565C0', qc_hold: '#E65100',
};

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ pct }) {
  const p = Math.min(parseFloat(pct) || 0, 100);
  const color = p >= 80 ? '#2E7D32' : p >= 31 ? '#E65100' : '#C62828';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--g200)', borderRadius: 3, minWidth: 36 }}>
        <div style={{
          width: `${p}%`, height: '100%', background: color,
          borderRadius: 3, transition: 'width .25s ease',
        }} />
      </div>
      <span style={{
        fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
        color, minWidth: 36, textAlign: 'right',
      }}>
        {p.toFixed(1)}%
      </span>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: '',         label: 'All Statuses' },
  { value: 'OPEN',     label: 'Open' },
  { value: 'PARTIAL',  label: 'Partial' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'OVERDUE',  label: 'Overdue' },
];

const SORT_OPTIONS = [
  { value: '',               label: 'Newest first' },
  { value: 'completion_asc', label: 'Completion ↑' },
  { value: 'completion_desc', label: 'Completion ↓' },
];

export default function LotIssueListPage() {
  const api      = useApi();
  const navigate = useNavigate();

  const [data,      setData]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [spinning,  setSpinning]  = useState(false);
  const [detail,    setDetail]    = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [search,        setSearch]        = useState('');
  const [displayStatus, setDisplayStatus] = useState('');
  const [machineId,     setMachineId]     = useState('');
  const [machines,      setMachines]      = useState([]);
  const [fromDate,      setFromDate]      = useState('');
  const [toDate,        setToDate]        = useState('');
  const [sortBy,        setSortBy]        = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const hasFilters = !!(search || displayStatus || machineId || fromDate || toDate);

  useEffect(() => {
    api.get('/api/machines?limit=500')
      .then(res => setMachines(res.data || res || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: page, pageSize: PER_PAGE });
      if (search)        p.set('search', search);
      if (displayStatus) p.set('display_status', displayStatus);
      if (machineId)     p.set('machine_id', machineId);
      if (fromDate)      p.set('date_from', fromDate);
      if (toDate)        p.set('date_to', toDate);
      if (sortBy)        p.set('sort_by', sortBy);
      const res = await api.get(`/api/lot-process-issues?${p}`);
      setData(res.data || []);
      setTotal(res.totalCount ?? res.total ?? 0);
    } catch (e) {}
    finally { setLoading(false); }
  }, [search, displayStatus, machineId, fromDate, toDate, sortBy, page]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(); } finally { setSpinning(false); }
  }, [load]);

  const openDetail = async row => {
    try {
      const d = await api.get(`/api/lot-process-issues/${row.id}`);
      setDetail(d);
      setShowModal(true);
    } catch (e) {}
  };

  const pages = Math.ceil(total / PER_PAGE);

  const clearAllFilters = () => {
    setSearch('');
    setDisplayStatus('');
    setMachineId('');
    setFromDate('');
    setToDate('');
    setSortBy('');
    setPage(1);
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ── */}

      {/* ── Toolbar ── */}
      <div className="grid-toolbar">

        {/* Search */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Search</label>
          <div className="grid-toolbar-search">
            <Search size={14} />
            <input
              placeholder=" Everything..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
            {search && (
              <button className="icon-btn" style={{ flexShrink: 0 }}
                onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Machine */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Machine</label>
          <SearchableSelect
            value={(() => {
              if (!machineId) return null;
              const m = (machines || []).find(m => String(m.id) === machineId);
              return m ? { id: String(m.id), name: `${m.code} — ${m.name}`, code: '' } : null;
            })()}
            onChange={opt => { setMachineId(opt?.id || ''); setPage(1); }}
            options={(machines || []).map(m => ({ id: String(m.id), name: `${m.code} — ${m.name}`, code: '' }))}
            placeholder="All Machines"
            style={{ minWidth: 200 }}
            dropdownSearch
          />
        </div>

        {/* Status */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Status</label>
          <SearchableSelect
            value={displayStatus ? { id: displayStatus, name: STATUS_OPTIONS.find(o => o.value === displayStatus)?.label || displayStatus, code: '' } : null}
            onChange={opt => { setDisplayStatus(opt?.id || ''); setPage(1); }}
            options={STATUS_OPTIONS.filter(o => o.value).map(o => ({ id: o.value, name: o.label, code: '' }))}
            placeholder="All Statuses"
            style={{ minWidth: 200 }}
            dropdownSearch
          />
        </div>

        {/* From Date */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">From</label>
          <DatePicker value={fromDate} onChange={v => { setFromDate(v); setPage(1); }}
            className="dp-compact" placeholder="From date" />
        </div>

        {/* To Date */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">To</label>
          <DatePicker value={toDate} onChange={v => { setToDate(v); setPage(1); }}
            className="dp-compact" placeholder="To date" />
        </div>

        {/* Sort */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Sort</label>
          <SelectDropdown
            value={sortBy}
            onChange={e => { setSortBy(e.target.value); setPage(1); }}
            style={{ minWidth: 200 }}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectDropdown>
        </div>

        {hasFilters && (
          <button className="filter-reset-btn" onClick={clearAllFilters}>
            Clear All
          </button>
        )}

        <div style={{ flex: 1 }} />
        <span className="grid-count">{total} issue{total !== 1 ? 's' : ''}</span>
        <div className="grid-toolbar-right">
          <button className="btn btn-sm btn-primary"
            onClick={() => navigate('/inventory/process-issues/new')}>
            <Send size={12} /> New Issue
          </button>
          <button className="icon-btn" onClick={handleRefresh} disabled={spinning}
            style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="grid-wrap">
        {loading
          ? <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
          : data.length === 0
            ? <div className="empty-state" style={{ padding: 60 }}>
                <Clock size={32} />
                <p>{hasFilters
                  ? 'No issues match the current filters.'
                  : 'No process issues yet. Issue a lot to process to get started.'}</p>
              </div>
            : (
              <table className="dgrid">
                <thead>
                  <tr>
                    <th style={{ width: 125 }}>Issue #</th>
                    <th style={{ width: 78 }}>Status</th>
                    <th style={{ width: 82 }}>Date</th>
                    <th>Item</th>
                    <th style={{ width: 88 }}>Process Lot</th>
                    <th style={{ width: 96 }}>Machine</th>
                    <th style={{ width: 82 }}>Process</th>
                    <th style={{ width: 100 }}>Operator</th>
                    <th style={{ width: 62 }} className="num">Issued</th>
                    <th style={{ width: 65 }} className="num">Returned</th>
                    <th style={{ width: 68 }} className="num">Remaining</th>
                    <th style={{ width: 124 }}>Completion</th>
                    <th style={{ width: 84 }}>Exp. Return</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(r => {
                    const ds  = r.display_status || r.status;
                    const dsb = dsBadge(ds);
                    const pct = parseFloat(r.completion_pct) || 0;
                    return (
                      <tr key={r.id} onDoubleClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                            {r.issue_number}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: dsb.bg, color: dsb.color, border: `1px solid ${dsb.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {dsb.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {new Date(r.issue_date).toLocaleDateString('en-IN')}
                        </td>
                        <td style={{ fontSize: 11 }}>{r.item_name}</td>
                        <td>
                          <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                            {r.process_lot_code || r.process_lot_number || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, color: r.machine_name ? 'var(--g800)' : 'var(--g400)' }}>
                            {r.machine_name || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11 }}>
                            {r.process_display_name || r.process_type || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11 }}>
                            {r.operator_full_name || r.operator || '—'}
                          </span>
                        </td>
                        <td className="num" style={{ fontSize: 11 }}>
                          {Number(r.issued_qty).toFixed(4)}
                        </td>
                        <td className="num" style={{ fontSize: 11, color: parseFloat(r.returned_qty) > 0 ? '#2E7D32' : 'var(--g500)' }}>
                          {Number(r.returned_qty || 0).toFixed(4)}
                        </td>
                        <td className="num" style={{ fontSize: 11, color: parseFloat(r.remaining_qty) > 0 ? '#1565C0' : 'var(--g500)' }}>
                          {Number(r.remaining_qty || 0).toFixed(4)}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <ProgressBar pct={pct} />
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {r.expected_return
                            ? <span style={{
                                color: ds === 'OVERDUE' ? '#C62828' : 'inherit',
                                fontWeight: ds === 'OVERDUE' ? 700 : 400,
                              }}>
                                {new Date(r.expected_return).toLocaleDateString('en-IN')}
                              </span>
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
      </div>

      {/* ── Pagination ── */}
      <div className="grid-footer">
        <div className="grid-footer-left">
          <span>Showing {total === 0 ? 0 : (page - 1) * PER_PAGE + 1} to {Math.min(page * PER_PAGE, total)} of {total} records</span>
        </div>
        <div className="grid-footer-center">
          <Paginator page={page} totalPages={pages} onPage={p => { setPage(p); document.querySelector('.grid-wrap').scrollTo(0, 0); }} />
        </div>
        <div className="grid-footer-right"></div>
      </div>

      {/* ── Detail modal ── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={detail ? `${detail.issue_number} — ${detail.status}` : ''}
        icon={<Clock size={14} style={{ marginRight: 6, color: 'var(--brand)' }} />}
        large
        footer={detail?.status === 'OPEN' ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowModal(false)}>Close</button>
            <button className="btn btn-primary"
              onClick={() => {
                setShowModal(false);
                // Correction 2,3,4: Growth Runs must use the new Control Tower Return dialog.
                if (detail.category === 'growth_run' && detail.process_type === 'growth') {
                  navigate('/manufacturing/control-tower');
                } else {
                  navigate(`/inventory/process-issues/${detail.id}/return`);
                }
              }}
            >
              <RotateCcw size={12} /> {(detail.category === 'growth_run' && detail.process_type === 'growth') ? 'Complete Growth Run' : 'Record Return'}
            </button>
          </div>
        ) : undefined}
      >
        {detail && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--g500)', marginBottom: 14 }}>
              {new Date(detail.issue_date).toLocaleDateString('en-IN')} &nbsp;·&nbsp;
              {detail.created_by_name} &nbsp;·&nbsp;
              {detail.remarks || 'No remarks'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { l: 'Item',         v: detail.item_name },
                { l: 'Source Lot',   v: detail.source_lot_code || detail.source_lot_number },
                { l: 'Process Lot',  v: detail.process_lot_code || detail.process_lot_number || '—' },
                { l: 'Issued Qty',   v: `${Number(detail.issued_qty).toFixed(4)} ${detail.unit || ''}` },
                { l: 'Department',   v: detail.department || '—' },
                { l: 'Operator',     v: detail.operator_full_name || detail.operator || '—' },
              ].map(({ l, v }) => (
                <div key={l} style={{ padding: '8px 10px', background: 'var(--g50)',
                  border: '1px solid var(--g200)', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: 'var(--g500)', textTransform: 'uppercase',
                    letterSpacing: '.4px', fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)',
                    color: 'var(--g900)', marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Remaining in process */}
            {detail.status === 'OPEN' && detail.remaining_in_process != null && (
              <div style={{ padding: '8px 12px', background: '#E3F2FD', borderRadius: 6,
                fontSize: 11, color: '#1565C0', fontWeight: 600, marginBottom: 10 }}>
                {Number(detail.remaining_in_process).toFixed(4)} {detail.unit} still in process
                {parseFloat(detail.remaining_in_process) < parseFloat(detail.issued_qty) &&
                  ' (partial returns recorded)'}
              </div>
            )}

            {/* Return history */}
            {Array.isArray(detail.returns) && detail.returns.length > 0 && (
              <div>
                {detail.returns.map(ret => (
                  <div key={ret.id} style={{ padding: '10px 12px', background: '#F1F8E9',
                    border: '1px solid #C5E1A5', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: '#2E7D32', fontFamily: 'var(--mono)' }}>
                        {ret.return_number}
                      </span>
                      <span style={{ fontSize: 10, color: '#558B2F' }}>
                        {new Date(ret.return_date).toLocaleDateString('en-IN')}
                        {ret.is_final === false && ' · Partial'}
                      </span>
                    </div>
                    {Array.isArray(ret.lines) && ret.lines.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ret.lines.map(l => (
                          <span key={l.id} style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            color: RETURN_TYPE_COLOR[l.return_type] || 'var(--g600)',
                            background: 'rgba(0,0,0,.06)',
                          }}>
                            {l.lot_code} ({Number(l.qty).toFixed(4)})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {[
                          { l: 'Usable',  v: ret.usable_qty },
                          { l: 'Damaged', v: ret.damaged_qty },
                          { l: 'Consumed', v: ret.consumed_qty },
                        ].map(({ l, v }) => (
                          <div key={l} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 9, color: '#558B2F', textTransform: 'uppercase' }}>{l}</div>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#1B5E20',
                              fontSize: 12 }}>{Number(v).toFixed(4)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

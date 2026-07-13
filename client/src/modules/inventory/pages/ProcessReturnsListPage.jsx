import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Paginator from '../../../shared/components/Paginator';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import DatePicker from '../../../shared/components/DatePicker';
import { RefreshCw, RotateCcw, Search, X, Clock } from 'lucide-react';

// ── Process Returns register ──────────────────────────────────────────────────
// LIST ONLY — every Return Action navigates to the EXISTING single Return Engine
// at /inventory/process-issues/:id/return. Default rows are raw status=OPEN
// (covers OPEN + PARTIAL + OVERDUE) with remaining qty > 0.

const DS_BADGE = {
  OPEN:     { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80', label: 'Open' },
  PARTIAL:  { bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9', label: 'Partial' },
  OVERDUE:  { bg: '#FFEBEE', color: '#C62828', border: '#EF9A9A', label: 'Overdue' },
};
const dsBadge = s => DS_BADGE[s] || { bg: 'var(--g100)', color: 'var(--g600)', border: 'var(--g300)', label: s };

// L × D × H from the Growth Run biscuit; '—' when unmeasured.
function fmtDim(r) {
  const l = parseFloat(r.growth_dim_length || 0);
  const d = parseFloat(r.growth_dim_depth  || 0);
  const h = parseFloat(r.growth_dim_height || 0);
  if (!l && !d && !h) return '—';
  const f = v => v ? v.toFixed(2) : '—';
  return `${f(l)} × ${f(d)} × ${f(h)}`;
}

export default function ProcessReturnsListPage() {
  const api      = useApi();
  const navigate = useNavigate();

  const [data,     setData]     = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [spinning, setSpinning] = useState(false);

  const [processes,   setProcesses]   = useState([]);
  const [departments, setDepartments] = useState([]);

  const [search,       setSearch]       = useState('');
  const [processType,  setProcessType]  = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [expectedFrom, setExpectedFrom] = useState('');
  const [expectedTo,   setExpectedTo]   = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const hasFilters = !!(search || processType || departmentId || expectedFrom || expectedTo);

  useEffect(() => {
    api.get('/api/process-master?active=true')
      .then(res => setProcesses(res.data || res || []))
      .catch(() => {});
    api.get('/api/departments?limit=500')
      .then(res => setDepartments(res.data || res || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Raw status=OPEN (not display_status) so PARTIAL and OVERDUE rows stay in.
      const p = new URLSearchParams({ status: 'OPEN', limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
      if (search)       p.set('search', search);
      if (processType)  p.set('process_type', processType);
      if (departmentId) p.set('department_id', departmentId);
      if (expectedFrom) p.set('expected_return_from', expectedFrom);
      if (expectedTo)   p.set('expected_return_to', expectedTo);
      const res = await api.get(`/api/lot-process-issues?${p}`);
      setData(res.data || []);
      setTotal(res.total ?? 0);
    } catch (e) {}
    finally { setLoading(false); }
  }, [search, processType, departmentId, expectedFrom, expectedTo, page]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(); } finally { setSpinning(false); }
  }, [load]);

  // Same routing rule as the Process Issues register: Growth Runs in the growth
  // process complete via the Control Tower; everything else uses the Return Engine.
  const openReturn = r => {
    if (r.category === 'growth_run' && r.process_type === 'growth') {
      navigate('/manufacturing/control-tower');
    } else {
      navigate(`/inventory/process-issues/${r.id}/return`);
    }
  };

  const clearAllFilters = () => {
    setSearch('');
    setProcessType('');
    setDepartmentId('');
    setExpectedFrom('');
    setExpectedTo('');
    setPage(1);
  };

  const rows  = data.filter(r => parseFloat(r.remaining_qty) > 0.0001);
  const pages = Math.ceil(total / PER_PAGE);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Toolbar ── */}
      <div className="grid-toolbar">

        {/* Search */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Search</label>
          <div className="grid-toolbar-search">
            <Search size={14} />
            <input
              placeholder=" Lot / growth no / barcode..."
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

        {/* Process */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Process</label>
          <SearchableSelect
            value={(() => {
              if (!processType) return null;
              const pr = (processes || []).find(p => p.process_code === processType);
              return pr ? { id: pr.process_code, name: pr.process_name || pr.process_code, code: '' } : null;
            })()}
            onChange={opt => { setProcessType(opt?.id || ''); setPage(1); }}
            options={(processes || []).map(p => ({ id: p.process_code, name: p.process_name || p.process_code, code: '' }))}
            placeholder="All Processes"
            style={{ minWidth: 200 }}
            dropdownSearch
          />
        </div>

        {/* Department */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Department</label>
          <SearchableSelect
            value={(() => {
              if (!departmentId) return null;
              const d = (departments || []).find(d => String(d.id) === departmentId);
              return d ? { id: String(d.id), name: d.name, code: '' } : null;
            })()}
            onChange={opt => { setDepartmentId(opt?.id || ''); setPage(1); }}
            options={(departments || []).map(d => ({ id: String(d.id), name: d.name, code: '' }))}
            placeholder="All Departments"
            style={{ minWidth: 200 }}
            dropdownSearch
          />
        </div>

        {/* Expected return range */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Expected From</label>
          <DatePicker value={expectedFrom} onChange={v => { setExpectedFrom(v); setPage(1); }}
            className="dp-compact" placeholder="From date" />
        </div>

        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Expected To</label>
          <DatePicker value={expectedTo} onChange={v => { setExpectedTo(v); setPage(1); }}
            className="dp-compact" placeholder="To date" />
        </div>

        {hasFilters && (
          <button className="filter-reset-btn" onClick={clearAllFilters}>
            Clear All
          </button>
        )}

        <div style={{ flex: 1 }} />
        <span className="grid-count">{total} pending return{total !== 1 ? 's' : ''}</span>
        <div className="grid-toolbar-right">
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
          : rows.length === 0
            ? <div className="empty-state" style={{ padding: 60 }}>
                <Clock size={32} />
                <p>{hasFilters
                  ? 'No pending returns match the current filters.'
                  : 'No pending process returns — every issued lot is back.'}</p>
              </div>
            : (
              <table className="dgrid">
                <thead>
                  <tr>
                    <th style={{ width: 118 }}>Issue No</th>
                    <th style={{ width: 96 }}>Process Lot</th>
                    <th style={{ width: 100 }}>Growth Number</th>
                    <th style={{ width: 46 }}>Run</th>
                    <th style={{ width: 96 }}>Root Lot</th>
                    <th>Item</th>
                    <th style={{ width: 110 }}>Dimension</th>
                    <th style={{ width: 88 }}>Process</th>
                    <th style={{ width: 96 }}>Machine</th>
                    <th style={{ width: 70 }} className="num">Issued Qty</th>
                    <th style={{ width: 74 }} className="num">Returned Qty</th>
                    <th style={{ width: 78 }} className="num">Remaining Qty</th>
                    <th style={{ width: 84 }}>Issue Date</th>
                    <th style={{ width: 96 }}>Expected Return</th>
                    <th style={{ width: 92 }}>Return Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const ds  = r.display_status || r.status;
                    const dsb = dsBadge(ds);
                    return (
                      <tr key={r.id} onDoubleClick={() => openReturn(r)} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                            {r.issue_number}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                          {r.process_lot_code || r.process_lot_number || '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                          {r.growth_number || '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                          {r.run_no != null && r.growth_number ? `R${r.run_no}` : '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                          {r.root_lot_code || r.root_lot_number || '—'}
                        </td>
                        {/* Phase A: the row is the Growth Assembly, not the seed */}
                        <td style={{ fontSize: 11 }}>{r.growth_item_name || r.item_name}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtDim(r)}</td>
                        <td style={{ fontSize: 11 }}>
                          {r.process_display_name || r.process_type || '—'}
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, color: r.machine_name ? 'var(--g800)' : 'var(--g400)' }}>
                            {r.machine_name || '—'}
                          </span>
                        </td>
                        <td className="num" style={{ fontSize: 11 }}>
                          {Number(r.issued_qty).toFixed(4)}
                        </td>
                        <td className="num" style={{ fontSize: 11, color: parseFloat(r.returned_qty) > 0 ? '#2E7D32' : 'var(--g500)' }}>
                          {Number(r.returned_qty || 0).toFixed(4)}
                        </td>
                        <td className="num" style={{ fontSize: 11, color: '#1565C0', fontWeight: 700 }}>
                          {Number(r.remaining_qty || 0).toFixed(4)}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {new Date(r.issue_date).toLocaleDateString('en-IN')}
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
                          <span style={{
                            display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 10,
                            fontSize: 9, fontWeight: 700, verticalAlign: 'middle',
                            background: dsb.bg, color: dsb.color, border: `1px solid ${dsb.border}`,
                          }}>
                            {dsb.label}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-primary" onClick={() => openReturn(r)}>
                            <RotateCcw size={12} /> Return
                          </button>
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
    </div>
  );
}

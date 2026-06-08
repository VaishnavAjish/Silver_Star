import { useState, useEffect, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import Paginator from '../../../shared/components/Paginator';
import Modal from '../../../shared/components/Modal';
import { GitBranch, GitMerge, RefreshCw, ArrowRight, Search, X } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';

const typeIcon = t =>
  t === 'split'
    ? <GitBranch size={12} style={{ color: '#F57F17' }} />
    : <GitMerge size={12} style={{ color: '#283593' }} />;

const typeBadge = t => t === 'split'
  ? { bg: '#FFF8E1', color: '#F57F17', border: '#FFD54F' }
  : { bg: '#E8EAF6', color: '#283593', border: '#9FA8DA' };

const statusBadge = s => {
  if (s === 'IN STOCK') return 'b-stock';
  if (s === 'IN PROCESS') return 'b-process';
  if (s === 'CONSUMED') return 'b-inactive';
  if (s === 'SOLD') return 'b-active';
  if (s === 'DAMAGED') return 'b-cancelled';
  if (s === 'ARCHIVED') return 'b-draft';
  return 'b-draft';
};

export default function LotMovementsList() {
  const api = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'lot_movements');
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  const [_lmf, _setLmf] = usePersistedFilters('lot_movements_filters', {
    search: '', typeFilter: '', fromDate: '', toDate: '',
  });
  const { search, typeFilter, fromDate, toDate } = _lmf;
  const setSearch     = v => _setLmf(f => ({ ...f, search:     v }));
  const setTypeFilter = v => _setLmf(f => ({ ...f, typeFilter: v }));
  const setFromDate   = v => _setLmf(f => ({ ...f, fromDate:   v }));
  const setToDate     = v => _setLmf(f => ({ ...f, toDate:     v }));
  const [page, setPage] = useState(1);
  const PER_PAGE = 500;
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: page, pageSize: PER_PAGE });
      if (search) p.set('search', search);
      if (typeFilter) p.set('type', typeFilter);
      if (fromDate) p.set('from', fromDate);
      if (toDate) p.set('to', toDate);
      const res = await api.get(`/api/lot-movements?${p}`);
      setData(res.data || []);
      setTotal(res.totalCount ?? res.total ?? 0);
    } catch (e) { } finally { setLoading(false); }
  }, [search, typeFilter, fromDate, toDate, page]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(); } finally { setSpinning(false); }
  }, [load]);

  const openDetail = async (row) => {
    try {
      const d = await api.get(`/api/lot-movements/${row.id}`);
      setDetail(d);
      setShowModal(true);
    } catch (e) { }
  };

  const handleSearch = v => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setPage(1), 300);
  };

  const hasFilters = !!(search || typeFilter || fromDate || toDate);

  const clearAllFilters = () => {
    setSearch('');
    setTypeFilter('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}

      {/* Toolbar */}
      <div className="grid-toolbar">

        {/* Search */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Search</label>
          <div className="grid-toolbar-search">
            <Search size={14} />
            <input
              placeholder="Search movement"
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
            {search && (
              <button className="icon-btn" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                onClick={() => handleSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Type */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">Type</label>
          <SearchableSelect
            value={typeFilter ? { id: typeFilter, name: typeFilter === 'split' ? 'Split' : 'Mix', code: '' } : null}
            onChange={opt => { setTypeFilter(opt?.id || ''); setPage(1); }}
            options={[
              { id: 'split', name: 'Split', code: '' },
              { id: 'mix', name: 'Mix', code: '' },
            ]}
            placeholder="All Types"
            style={{ minWidth: 110 }}
            dropdownSearch
          />
        </div>

        {/* From date */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">From</label>
          <DatePicker value={fromDate} onChange={v => { setFromDate(v); setPage(1); }}
            className="dp-compact" placeholder="From date" />
        </div>

        {/* To date */}
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">To</label>
          <DatePicker value={toDate} onChange={v => { setToDate(v); setPage(1); }}
            className="dp-compact" placeholder="To date" />
        </div>

        {hasFilters && (
          <button className="filter-reset-btn" onClick={clearAllFilters}>
            Clear All
          </button>
        )}

        <div style={{ flex: 1 }} />
        <span className="grid-count">{total} movements</span>
        <div className="grid-toolbar-right">
          <button className="btn btn-sm btn-primary" onClick={() => navigate('/inventory/mix')}>
            <GitMerge size={12} /> Mix Lots
          </button>
          <button className="icon-btn" onClick={handleRefresh} disabled={spinning}
            style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid-wrap" ref={tableWrapRef}>
        {loading
          ? <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
          : data.length === 0
            ? <div className="empty-state" style={{ padding: 60 }}>
              <GitBranch size={32} />
              <p>No lot movements yet. Split or mix a lot to get started.</p>
            </div>
            : (
              <table className="dgrid">
                <thead><tr>
                  <th style={{ width: 130 }}>Movement #</th>
                  <th style={{ width: 70 }}>Type</th>
                  <th style={{ width: 100 }}>Date</th>
                  <th style={{ width: 70 }}>Parents</th>
                  <th style={{ width: 70 }}>Children</th>
                  <th>Notes</th>
                  <th style={{ width: 120 }}>Created by</th>
                </tr></thead>
                <tbody>
                  {(() => {
                    const vItems = rowVirtualizer.getVirtualItems();
                    if (!vItems.length) return null;
                    const totalSize = rowVirtualizer.getTotalSize();
                    const paddingTop = vItems[0].start;
                    const paddingBottom = totalSize - vItems[vItems.length - 1].end;
                    return (
                      <>
                        {paddingTop > 0 && <tr><td colSpan={7} style={{ height: paddingTop, padding: 0 }} /></tr>}
                        {vItems.map(vRow => {
                          const r = data[vRow.index];
                          const tb = typeBadge(r?.movement_type);
                          return (
                            <tr key={r.id} onDoubleClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                              <td>
                                <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                                  {r.movement_number}
                                </span>
                              </td>
                              <td>
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                  background: tb.bg, color: tb.color, border: `1px solid ${tb.border}`
                                }}>
                                  {typeIcon(r?.movement_type)} {r?.movement_type}
                                </span>
                              </td>
                              <td style={{ fontSize: 11 }}>
                                {new Date(r.movement_date).toLocaleDateString('en-IN')}
                              </td>
                              <td className="num">{r.parent_count}</td>
                              <td className="num">{r.child_count}</td>
                              <td style={{ fontSize: 11, color: 'var(--g600)' }}>
                                {r.notes ? r.notes.substring(0, 60) : '—'}
                              </td>
                              <td style={{ fontSize: 11 }}>{r.created_by_name || '—'}</td>
                            </tr>
                          );
                        })}
                        {paddingBottom > 0 && <tr><td colSpan={7} style={{ height: paddingBottom, padding: 0 }} /></tr>}
                      </>
                    );
                  })()}
                </tbody>
                <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
                  {data.length > 0 && (
                    <div className="grid-footer">
                      <div className="grid-footer-left">
                        <span>Showing {(page - 1) * PER_PAGE + 1} to {Math.min(page * PER_PAGE, total)} of {total} records</span>
                      </div>
                      <div className="grid-footer-center">
                        <Paginator page={page} totalPages={pages} onPage={setPage} />
                      </div>
                      <div className="grid-footer-right"></div>
                    </div>
                  )}
                </td></tr></tfoot>
              </table>

            )}
      </div>

      {/* Detail modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={detail ? `${detail.movement_number} — ${detail.movement_type?.toUpperCase()}` : ''}
        icon={detail ? typeIcon(detail?.movement_type) : null}
        large
      >
        {detail && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--g500)', marginBottom: 14 }}>
              {new Date(detail.movement_date).toLocaleDateString('en-IN')} &nbsp;·&nbsp;
              {detail.created_by_name} &nbsp;·&nbsp;
              {detail.notes || 'No notes'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px 1fr', gap: 12, alignItems: 'start' }}>
              {/* Parents */}
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.6px', color: 'var(--g600)', marginBottom: 8
                }}>
                  Parents ({detail.parents?.length})
                </div>
                {detail.parents?.map((p, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', border: '1px solid var(--g200)',
                    borderRadius: 6, marginBottom: 6, background: '#FAFAFA'
                  }}>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--g900)' }}>
                      {p.lot_number}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 2 }}>
                      {p.item_name}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                        {Number(p.quantity_consumed).toFixed(4)} {p.unit}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--g600)' }}>
                        @ ₹{Number(p.cost_per_unit).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                      </span>
                    </div>
                    <span className={`badge ${statusBadge(p.status)}`} style={{ marginTop: 4, fontSize: 9 }}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Arrow */}
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 30 }}>
                <ArrowRight size={20} style={{ color: 'var(--g400)' }} />
              </div>

              {/* Children */}
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.6px', color: 'var(--g600)', marginBottom: 8
                }}>
                  Children ({detail.children?.length})
                </div>
                {detail.children?.map((c, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', border: '1px solid #C8E6C9',
                    borderRadius: 6, marginBottom: 6, background: '#F1F8E9'
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--g900)',
                      cursor: 'pointer'
                    }}
                      onClick={() => { setShowModal(false); navigate(`/inventory/${c.child_lot_id}/lineage`); }}>
                      {c.lot_number}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 2 }}>
                      {c.item_name}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                        {Number(c.quantity).toFixed(4)} {c.unit}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--g600)' }}>
                        @ ₹{Number(c.cost_per_unit).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                      </span>
                    </div>
                    <span className={`badge ${statusBadge(c.status)}`} style={{ marginTop: 4, fontSize: 9 }}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

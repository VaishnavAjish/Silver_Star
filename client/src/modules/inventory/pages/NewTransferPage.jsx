import { useState, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useInventorySync } from '../../../shared/hooks/useModuleSync';
import { 
  Search, Package, RefreshCw, X, ChevronLeft, CheckSquare, Square, Send 
} from 'lucide-react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import StockTransferModal from '../../../shared/components/Modals/StockTransferModal';

const PAGE_SIZE = 500;

const COLS = [
  { key: 'item_name', label: 'Item', width: 200 },
  { key: 'lot_op_id', label: 'Lot ID', width: 90, num: true },
  { key: 'lot_code', label: 'Lot Name', width: 140 },
  { key: 'qty', label: 'Qty', width: 80, num: true },
  { key: 'unit', label: 'Unit', width: 60 },
  { key: 'weight', label: 'Weight', width: 90, num: true },
  { key: 'total_value', label: 'Value (₹)', width: 110, num: true },
  { key: 'dept_location_name', label: 'Department', width: 140 },
];

export default function NewTransferPage() {
  const api = useApi();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  const [selectedLots, setSelectedLots] = useState(new Set());
  const [pendingLotIds, setPendingLotIds] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const gridWrapRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => gridWrapRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      p.set('status', 'IN STOCK');
      p.set('page', '1');
      p.set('pageSize', String(PAGE_SIZE));
      
      const res = await api.get(`/api/inventory?${p}`);
      setData(res.data || []);
      setTotal(res.total || 0);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [api, search]);

  useEffect(() => { load(); }, [load]);

  const loadPending = useCallback(async () => {
    try {
      const res = await api.get('/api/stock-transfer/pending');
      const all = res.data || res || [];
      const ids = new Set();
      all
        .filter(t => t.status?.toLowerCase() === 'pending')
        .forEach(t => (t.lots || []).forEach(l => ids.add(l.lot_id)));
      setPendingLotIds(ids);
    } catch (err) {
      console.error('[NewTransferPage] loadPending failed:', err);
    }
  }, [api]);

  useEffect(() => {
    loadPending();
    const handleTransferUpdated = () => { loadPending(); load(); };
    window.addEventListener('pending_transfers_updated', handleTransferUpdated);
    return () => window.removeEventListener('pending_transfers_updated', handleTransferUpdated);
  }, [loadPending, load]);

  useInventorySync(() => {
    load();
    loadPending();
  });

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(); } finally { setSpinning(false); }
  }, [load]);

  const toggleSelect = (id, e) => {
    e?.stopPropagation();
    setSelectedLots(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allVisibleSelected = data.length > 0 && data.every(r => selectedLots.has(r.id));
  const someVisibleSelected = data.some(r => selectedLots.has(r.id));

  const handleHeaderSelect = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedLots(prev => {
        const next = new Set(prev);
        data.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedLots(prev => {
        const next = new Set(prev);
        data.forEach(r => next.add(r.id));
        return next;
      });
    }
  }, [allVisibleSelected, data]);

  const selectedRows = data.filter(r => selectedLots.has(r.id));

  return (
    <>
      <StockTransferModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        selectedRows={selectedRows}
        onTransferComplete={() => {
          setModalOpen(false);
          setSelectedLots(new Set());
          load();
        }}
      />

      <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--g200)', background: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="icon-btn" onClick={() => navigate('/inventory/stock-transfer')} title="Back to Transfers">
              <ChevronLeft size={20} />
            </button>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--g900)' }}>New Stock Transfer</h2>
            <div style={{ flex: 1 }} />
            <button 
              className="btn btn-primary" 
              disabled={selectedLots.size === 0} 
              onClick={() => setModalOpen(true)}
            >
              <Send size={14} /> Next: Transfer Selected ({selectedLots.size})
            </button>
          </div>

          {/* Toolbar */}
          <div className="grid-toolbar">
            <div className="filter-field" style={{ width: 300 }}>
              <label className="filter-label">Search IN STOCK items</label>
              <div className="grid-toolbar-search">
                <Search size={14} />
                <input
                  placeholder="Search item, lot code..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
                />
                {searchInput && (
                  <button className="icon-btn" style={{ flexShrink: 0 }} onClick={() => { setSearchInput(''); setSearch(''); }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ flex: 1 }} />
            <span className="grid-count">{total} IN STOCK</span>
            <button className="icon-btn" title="Refresh" onClick={handleRefresh} disabled={spinning}
              style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Grid */}
          <div className="grid-wrap" ref={gridWrapRef} style={{ overflowAnchor: 'none' }}>
            {loading ? (
              <div className="empty-state" style={{ padding: 60 }}>
                <div className="spinner" />
              </div>
            ) : data.length === 0 ? (
              <div className="empty-state" style={{ padding: 60 }}>
                <Package size={32} />
                <p>No available inventory to transfer.</p>
              </div>
            ) : (
              <table className="dgrid">
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center' }}>
                      {data.length > 0 && (
                        <span onClick={handleHeaderSelect} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          {allVisibleSelected ? (
                            <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                          ) : someVisibleSelected ? (
                            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13 }}>
                              <Square size={13} style={{ color: 'var(--brand)', position: 'absolute' }} />
                              <span style={{ width: 7, height: 2, background: 'var(--brand)', borderRadius: 1, position: 'absolute' }} />
                            </span>
                          ) : (
                            <Square size={13} style={{ color: 'var(--g300)' }} />
                          )}
                        </span>
                      )}
                    </th>
                    {COLS.map(col => (
                      <th key={col.key} style={{ width: col.width }} className={col.num ? 'num' : ''}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const vItems = rowVirtualizer.getVirtualItems();
                    if (!vItems.length) return null;
                    const totalSize = rowVirtualizer.getTotalSize();
                    const paddingTop = vItems[0].start;
                    const paddingBottom = totalSize - vItems[vItems.length - 1].end;
                    const colCount = COLS.length + 1;
                    return (
                      <>
                        {paddingTop > 0 && <tr><td colSpan={colCount} style={{ height: paddingTop, padding: 0 }} /></tr>}
                        {vItems.map(vRow => {
                          const row = data[vRow.index];
                          const selected = selectedLots.has(row.id);
                          const hasPending = pendingLotIds.has(row.id);
                          return (
                            <tr key={row.id}
                              onClick={() => toggleSelect(row.id)}
                              style={{ background: selected ? '#F3E5F5' : hasPending ? '#FFFBEB' : undefined, cursor: 'pointer' }}>
                              
                              <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                <span onClick={e => toggleSelect(row.id, e)} style={{ cursor: 'pointer' }}>
                                  {selected
                                    ? <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                                    : <Square size={13} style={{ color: 'var(--g300)' }} />}
                                </span>
                              </td>
                              
                              <td><span style={{ fontWeight: 600, color: 'var(--g900)' }}>{row.item_name || '—'}</span></td>
                              <td className="num"><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)' }}>{row.lot_op_id != null ? row.lot_op_id : '—'}</span></td>
                              <td>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                                    {row.lot_code || row.lot_number}
                                  </span>
                                  {hasPending && (
                                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                      In Transfer
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="num"><span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{row.qty}</span></td>
                              <td>{row.unit}</td>
                              <td className="num">{row.weight && parseFloat(row.weight) > 0 ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{parseFloat(row.weight).toFixed(4)}</span> : '—'}</td>
                              <td className="num"><span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 }}>₹{Number(row.total_value || 0).toLocaleString('en-IN')}</span></td>
                              <td>{row.dept_location_name ? <span style={{ fontSize: 11, color: 'var(--g700)', fontWeight: 500 }}>{row.dept_location_name}</span> : '—'}</td>
                            </tr>
                          );
                        })}
                        {paddingBottom > 0 && <tr><td colSpan={colCount} style={{ height: paddingBottom, padding: 0 }} /></tr>}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

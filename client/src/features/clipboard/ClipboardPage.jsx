import { useState, useMemo } from 'react';
import SelectDropdown from '../../shared/components/SelectDropdown';
import { usePagination } from '../../shared/hooks/usePagination';
import Paginator from '../../shared/components/Paginator';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../shared/hooks/useApi';
import { Clipboard, SlidersHorizontal, Trash2, FileOutput, List, Upload, Search, Plus, Send, ChevronDown, History, Share2, Package, RotateCcw, GitBranch, GitMerge, CheckCircle, X, SplitSquareHorizontal, Play } from 'lucide-react';
import { useClipboard } from '../../core/context/ClipboardContext';
import toast from 'react-hot-toast';
import { SYSTEM_TEMPLATES, loadUserTemplates } from '../../shared/utils/templateUtils';
import { getAllowedActions } from '../../modules/inventory/utils/actionMatrix';
import SplitLotPage from '../../modules/inventory/pages/SplitLotPage';
import LotIssuePage from '../../modules/inventory/pages/LotIssuePage';
import MixLotsPage from '../../modules/inventory/pages/MixLotsPage';
import LotReturnPage from '../../modules/inventory/pages/LotReturnPage';

export default function ClipboardPage() {
  const { items, clear, remove, add, addMultiple, openStockTransferModal, loadClipboard } = useClipboard();
  const navigate = useNavigate();
  const api = useApi();
  const [search, setSearch] = useState('');
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);
  const [template, setTemplate] = useState('');

  const allTemplates = useMemo(
    () => [...Object.values(SYSTEM_TEMPLATES), ...loadUserTemplates()],
    []
  );

  const [activeModal, setActiveModal] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmDialog, setConfirmDialog] = useState(null);

  import('react').then(({ useEffect }) => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  });

  /* ── Filter ── */
  const filteredItems = useMemo(() => {
    if (!search) return items;
    const s = search.toLowerCase();
    return items.filter(r =>
      (r.lot_op_id && String(r.lot_op_id).toLowerCase().includes(s)) ||
      (r.lot_code && r.lot_code.toLowerCase().includes(s)) ||
      (r.category && r.category.toLowerCase().includes(s))
    );
  }, [items, search]);

  /* ── Sort (optional client side if needed) ── */
  const [sortKey, setSortKey] = useState('added_at');

  const displayRows = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const vA = a[sortKey] || '';
      const vB = b[sortKey] || '';
      return String(vA).localeCompare(String(vB));
    });
  }, [filteredItems, sortKey]);

  /* ── Manual Add ── */
  const handleManualAdd = async (overrideIdString = null) => {
    const inputStr = typeof overrideIdString === 'string' ? overrideIdString : manualId;
    if (!inputStr || !inputStr.trim()) return;
    
    const tokens = inputStr.split(/[\s,;\n\t]+/).map(s => s.trim()).filter(Boolean);
    if (tokens.length === 0) return;

    setLoading(true);
    try {
      let addedCount = 0;
      let alreadyCount = 0;
      let notFoundCount = 0;
      const newItems = [];

      for (const token of tokens) {
        const res = await api.get(`/api/inventory?search=${encodeURIComponent(token)}`);
        const list = res.data || [];
        const match = list.find(l =>
          String(l.lot_op_id) === token ||
          (l.lot_code && l.lot_code.toLowerCase() === token.toLowerCase()) ||
          (l.lot_number && l.lot_number.toLowerCase() === token.toLowerCase())
        );

        if (match) {
          const existsInClipboard = items.some(i => String(i.entity_id) === String(match.id) && i.entity_type === 'inventory');
          const existsInNew = newItems.some(i => String(i.entity_id) === String(match.id));
          if (existsInClipboard || existsInNew) {
            alreadyCount++;
          } else {
            newItems.push({
              entity_type: 'inventory',
              entity_id: match.id,
              label: match.lot_code || match.lot_number || `Lot ${match.lot_op_id}`,
              ...match
            });
            addedCount++;
          }
        } else {
          notFoundCount++;
        }
      }

      if (newItems.length > 0) {
        if (typeof addMultiple === 'function') {
          await addMultiple(newItems);
        } else {
          for (const item of newItems) {
            await add(item);
          }
        }
      }

      if (tokens.length === 1) {
        if (addedCount > 0) toast.success(`Added ${newItems[0].label}`);
        else if (alreadyCount > 0) toast('Lot is already in clipboard');
        else toast.error('Lot not found');
      } else {
        toast.success(`Processed ${tokens.length} lots: ${addedCount} added, ${alreadyCount} exist, ${notFoundCount} not found.`);
      }
      setManualId('');
    } catch (err) {
      toast.error('Failed to search lot(s)');
    } finally {
      setLoading(false);
    }
  };

  /* ── Clear All ── */
  const removeAllRows = () => {
    setConfirmDialog({
      message: 'Clear the entire clipboard?',
      onConfirm: async () => {
        await clear();
        setSelectedIds(new Set());
        toast('Clipboard cleared');
      }
    });
  };

  /* ── Remove Selected ── */
  const removeSelectedRows = () => {
    if (selectedIds.size === 0) {
      toast('Please select items to remove');
      return;
    }
    setConfirmDialog({
      message: `Remove ${selectedIds.size} item(s) from clipboard?`,
      onConfirm: async () => {
        for (const id of selectedIds) {
          await remove(id);
        }
        setSelectedIds(new Set());
        toast('Selected items removed');
      }
    });
  };

  /* ── Export ── */
  const exportData = () => {
    if (!displayRows.length) { toast('Nothing to export'); return; }
    const header = ['Lot ID', 'Lot Name', 'Category', 'Status', 'Qty', 'Weight', 'Length', 'Depth', 'Height'].join('\t');
    const lines = displayRows.map(r =>
      [r.lot_op_id, r.lot_code, r.category, r.status, r.qty, r.weight, r.dim_length, r.dim_depth, r.dim_height].join('\t')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clipboard-export.txt';
    a.click();
    toast('Exported');
  };

  /* ── Show IDs ── */
  const showSeedIds = () => {
    const ids = displayRows.map(r => r.lot_op_id).filter(Boolean);
    if (!ids.length) { toast('No IDs to show'); return; }
    toast(`${ids.length} ID(s): ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''}`);
  };

  /* ── Load & Close ── */
  const loadAndClose = () => {
    if (!items.length) {
      toast.error('Clipboard is empty');
      return;
    }
    if (!template) {
      toast.error('Warning: Template not selected');
      return;
    }
    navigate(`/inventory/clipboard-data?clipboard_mode=true&template=${template}`);
  };

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(displayRows, [search, items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#fff' }}>
      {/* ── Header ── */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #e0e0e0',
        background: '#fafafa', flexShrink: 0,
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            background: '#e8f5f0', color: '#095C47',
            borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 700,
          }}>{items.length} items</span>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 10,
        }}>
          {/* Input row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search lots..."
                style={{ ...inputSt, paddingLeft: 28 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 20 }}>
              <input
                value={manualId}
                onChange={e => setManualId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualAdd(); }}
                onPaste={async (e) => {
                  e.preventDefault();
                  const pastedText = e.clipboardData.getData('text');
                  if (pastedText) {
                    setManualId(pastedText);
                    await handleManualAdd(pastedText);
                  }
                }}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text && text.trim()) {
                      setManualId(text);
                      await handleManualAdd(text);
                    }
                  } catch (err) {
                    console.error('Auto-paste failed', err);
                  }
                }}
                onClick={async (e) => {
                  if (!manualId) {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text && text.trim()) {
                        setManualId(text);
                        await handleManualAdd(text);
                      }
                    } catch (err) {}
                  }
                }}
                placeholder="Add Lot ID / Barcode..."
                style={{ ...inputSt, minWidth: 160 }}
              />

              <SelectDropdown
                value={template}
                onChange={e => setTemplate(e.target.value)}
                placeholder="- Open With Template -"
                style={{ minWidth: 180 }}
                buttonStyle={{ borderRadius: 6, borderColor: '#d0d0d0', padding: '0 8px', fontSize: 12.5, height: 34 }}
              >
                <option value="">- Open With Template -</option>
                {allTemplates.map(tmpl => (
                  <option key={tmpl.id} value={tmpl.id}>{tmpl.label}</option>
                ))}
              </SelectDropdown>

              <button onClick={handleManualAdd} style={btnPrimary} disabled={loading}>
                {loading ? '...' : 'Load Data'}
              </button>
            </div>
          </div>

          {/* Right tools */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <button onClick={e => { e.stopPropagation(); setActionsOpen(v => !v); }} style={btnPrimary}>
                Actions <ChevronDown size={13} />
              </button>
              {actionsOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: '110%', zIndex: 200, minWidth: 160,
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                  boxShadow: '0 4px 20px rgba(0,0,0,.12)', padding: '4px 0',
                }}>
                  {(() => {
                    const inventoryItems = items.filter(r => r.entity_type === 'inventory').map(r => ({ ...r, id: r.entity_id }));
                    if (inventoryItems.length === 1) {
                      const lot = inventoryItems[0];
                      const perms = getAllowedActions(lot);
                      return [
                        perms.canViewHistory && { label: 'View History', icon: <History size={12} />, fn: () => navigate(`/inventory/lots/${lot.id}?tab=history`) },
                        perms.canViewLineage && { label: 'View Lineage', icon: <Share2 size={12} />, fn: () => navigate(`/inventory/${lot.id}/lineage`) },
                        perms.canIssueProcess && { label: 'Issue to Process', icon: <Play size={12} />, fn: () => setActiveModal({ type: 'issue', lotId: lot.id }), accent: true },
                        perms.canGrowthAgain && { label: 'Growth Again', icon: <RotateCcw size={12} />, fn: () => navigate('/manufacturing/control-tower'), accent: true },
                        perms.canGrowthOutput && { label: 'Process Issues', icon: <Package size={12} />, fn: () => navigate('/inventory/process-issues'), accent: true },
                        perms.canTransfer && { label: 'Stock Transfer', icon: <Send size={12} />, fn: () => openStockTransferModal([lot], () => clear()), accent: true },
                        perms.canReturn && { label: 'Return from Process', icon: <RotateCcw size={12} />, fn: () => setActiveModal({ type: 'return', lotId: lot.id }), accent: true },
                        perms.canSplit && { label: 'Split Lot', icon: <SplitSquareHorizontal size={12} />, fn: () => setActiveModal({ type: 'split', lotId: lot.id }), accent: true },
                        perms.canMix && { label: 'Mix Into…', icon: <GitMerge size={12} />, fn: () => setActiveModal({ type: 'mix', lotIds: lot.id }), accent: true },
                        perms.canCompleteGrowthRun && { label: 'Complete Growth Run', icon: <CheckCircle size={12} />, fn: () => toast('Please open lot workspace to complete Growth Run'), accent: true },
                      ].filter(Boolean);
                    } else {
                      return [
                        { label: 'Issue to Process', icon: <Send size={12} />, fn: () => {}, disabled: true },
                        { label: 'Split Lot', icon: <GitBranch size={12} />, fn: () => {}, disabled: true },
                        { label: 'Mix Lots', icon: <GitMerge size={12} />, fn: () => setActiveModal({ type: 'mix', lotIds: inventoryItems.map(r => r.id).join(',') }), disabled: inventoryItems.length < 1, accent: true },
                        { label: 'Stock Transfer', icon: <Send size={12} />, fn: () => openStockTransferModal(inventoryItems, () => clear()), disabled: inventoryItems.length < 1, accent: true },
                      ];
                    }
                  })().map(({ label, icon, fn, disabled, accent }) => (
                    <div key={label}
                      onClick={() => { if (!disabled) { setActionsOpen(false); fn(); } }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
                        color: disabled ? '#999' : accent ? '#0D7C5F' : '#424242',
                        opacity: disabled ? 0.6 : 1
                      }}
                      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#f5f5f5'; }}
                      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = ''; }}
                    >
                      {icon} {label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setSortKey(sortKey === 'lot_op_id' ? 'added_at' : 'lot_op_id')} style={btn}>
              <SlidersHorizontal size={13} /> Sort
            </button>
            <button onClick={removeAllRows} style={btn}><Trash2 size={13} /> Clear All</button>
            <button onClick={exportData} style={btnPrimary}><FileOutput size={13} /> Export</button>
          </div>
        </div>
      </div>

      {/* ── Table (read-only display) ── */}
      <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid #ddd', minHeight: 0 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{
                  border: '1px solid #e0e0e0', padding: '8px 10px',
                  background: '#f3f3f3', fontWeight: 700, textAlign: 'center',
                  position: 'sticky', top: 0, zIndex: 2, userSelect: 'none',
                }}>
                <input
                  type="checkbox"
                  checked={paginatedItems.length > 0 && selectedIds.size === paginatedItems.length}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(paginatedItems.map(r => r.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              {['Lot ID', 'Lot Name', 'Category', 'Status', 'Qty', 'Weight', 'Length', 'Depth', 'Height'].map(h => (
                <th key={h} style={{
                  border: '1px solid #e0e0e0', padding: '8px 10px',
                  background: '#f3f3f3', fontWeight: 700, textAlign: 'left',
                  position: 'sticky', top: 0, zIndex: 2, userSelect: 'none',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((row, ri) => (
              <tr key={`${row.id}-${row.entity_id || ''}-${ri}`} style={{ background: '#fff', height: 28 }}>
                <td style={{ ...cellSt, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={e => {
                      const s = new Set(selectedIds);
                      if (e.target.checked) s.add(row.id);
                      else s.delete(row.id);
                      setSelectedIds(s);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td style={{ ...cellSt, fontWeight: 600, color: '#095C47' }}>{row.lot_op_id || '—'}</td>
                <td style={cellSt}>{row.lot_code || '—'}</td>
                <td style={cellSt}>{row.category || '—'}</td>
                <td style={cellSt}>{row.status || '—'}</td>
                <td style={{ ...cellSt, textAlign: 'right' }}>{row.qty || '—'}</td>
                <td style={{ ...cellSt, textAlign: 'right' }}>{row.weight || '—'}</td>
                <td style={{ ...cellSt, textAlign: 'right' }}>{row.dim_length || '—'}</td>
                <td style={{ ...cellSt, textAlign: 'right' }}>{row.dim_depth || '—'}</td>
                <td style={{ ...cellSt, textAlign: 'right' }}>{row.dim_height || '—'}</td>
              </tr>
            ))}
            {paginatedItems.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  Clipboard is empty
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {displayRows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
          <span>Showing {displayRows.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, displayRows.length)} of {displayRows.length} records</span>
          <Paginator page={page} totalPages={totalPages} onPage={setPage} />
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 10,
        padding: '10px 20px', background: '#fafafa',
        borderTop: '1px solid #e0e0e0', flexWrap: 'wrap',
      }}>
        <button onClick={showSeedIds} style={btnPrimary}><List size={14} /> Show IDs</button>
        <button onClick={removeAllRows} style={btnPrimary}><Trash2 size={14} /> Remove All</button>
        <button onClick={removeSelectedRows} style={btnPrimary}><X size={14} /> Remove</button>

        <button onClick={loadAndClose} style={{ ...btnPrimary, marginLeft: 'auto' }}>
          <Upload size={14} /> Load &amp; Close
        </button>
      </div>

      {/* ── Modals ── */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)} style={{ zIndex: 1000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal" style={{ background: '#fff', borderRadius: 8, width: '90vw', height: '90vh', maxWidth: 1300, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '12px 16px', borderBottom: '1px solid #ddd', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {activeModal.type === 'split' ? 'Split Lot' : activeModal.type === 'return' ? 'Return from Process' : activeModal.type === 'issue' ? 'Issue to Process' : 'Mix Lots'}
              </h3>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }} onClick={() => setActiveModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden', position: 'relative' }}>
              {activeModal.type === 'split' && <SplitLotPage lotId={activeModal.lotId} isModal onComplete={() => { setActiveModal(null); loadClipboard(); }} onCancel={() => setActiveModal(null)} />}
              {activeModal.type === 'issue' && <LotIssuePage initialLotId={activeModal.lotId} isModal onComplete={() => { setActiveModal(null); loadClipboard(); }} onCancel={() => setActiveModal(null)} />}
              {activeModal.type === 'return' && <LotReturnPage initialLotId={activeModal.lotId} isModal onComplete={() => { setActiveModal(null); loadClipboard(); }} onCancel={() => setActiveModal(null)} />}
              {activeModal.type === 'mix' && <MixLotsPage initialLotIds={activeModal.lotIds} isModal onComplete={() => { setActiveModal(null); loadClipboard(); }} onCancel={() => setActiveModal(null)} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Confirm Dialog ── */}
      {confirmDialog && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)} style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal" style={{ background: '#fff', borderRadius: 8, width: 400, maxWidth: '90vw', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#333' }}>Confirm Action</h3>
            <p style={{ margin: 0, fontSize: 14, color: '#666' }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
              <button onClick={() => setConfirmDialog(null)} style={btn}>Cancel</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} style={{ ...btnPrimary, background: '#0D7C5F', borderColor: '#0D7C5F' }}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── shared micro-styles ── */
const inputSt = {
  minWidth: 120, flex: 1, padding: '0 8px', height: 34,
  border: '1px solid #d0d0d0', borderRadius: 6,
  outline: 'none', fontSize: 12.5, background: '#fff',
  boxSizing: 'border-box',
};
const btn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  height: 34, padding: '0 16px', borderRadius: 6,
  border: '1px solid #d0d0d0', background: '#fff',
  color: '#424242', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box',
};
const btnPrimary = {
  ...btn,
  background: '#0D7C5F', color: '#fff', border: '1px solid #0D7C5F',
};
const cellSt = {
  border: '1px solid #e0e0e0', padding: '4px 6px',
  height: 28, overflow: 'hidden', whiteSpace: 'nowrap',
  textOverflow: 'ellipsis', userSelect: 'text',
};

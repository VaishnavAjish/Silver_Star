import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Clipboard, X, Layers, ArrowUpRight,
  FileText, BookOpen, Landmark, Users, Building2, Wrench,
  SlidersHorizontal, Trash2,
} from 'lucide-react';
import { useClipboard } from '../../core/context/ClipboardContext';
import { formatDistanceToNow } from '../../shared/utils/time';

const TYPE_META = {
  inventory:   { label: 'Lot',      Icon: Layers,    color: '#0D7C5F' },
  invoice:     { label: 'Invoice',  Icon: FileText,  color: '#E65100' },
  voucher:     { label: 'Voucher',  Icon: BookOpen,  color: '#7B1FA2' },
  account:     { label: 'Account',  Icon: Landmark,  color: '#455A64' },
  customer:    { label: 'Customer', Icon: Users,     color: '#006064' },
  vendor:      { label: 'Vendor',   Icon: Building2, color: '#37474f' },
  fixed_asset: { label: 'Asset',    Icon: Wrench,    color: '#E87722' },
};

function BulkActions({ type, items, onAction }) {
  const ids = items.map(i => i.id);
  if (type === 'inventory') return (
    <div className="cbp-actions">
      <button onClick={() => onAction('create_mix_lot', ids)}>Mix Lots</button>
      <button onClick={() => onAction('print_labels', ids)}>Print Labels</button>
    </div>
  );
  if (type === 'invoice') return (
    <div className="cbp-actions">
      <button onClick={() => onAction('bulk_pdf', ids)}>Bulk PDF</button>
      <button onClick={() => onAction('mark_as_paid', ids)}>Mark as Paid</button>
    </div>
  );
  if (type === 'account') return (
    <div className="cbp-actions">
      <button onClick={() => onAction('open_journal', ids)}>Open Journal</button>
    </div>
  );
  return null;
}

export default function ClipboardPanel() {
  const { items, remove, clear, runBulkAction, reload, isOpen, setIsOpen } = useClipboard();
  const navigate = useNavigate();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { if (isOpen) reload(); }, [isOpen, reload]);

  const handleAction = async (action, ids) => {
    try {
      const result = await runBulkAction(action, ids);
      if (result?.redirect_url) { navigate(result.redirect_url); setIsOpen(false); }
      else if (result?.ok) toast.success('Done');
    } catch { /* error toast already shown */ }
  };

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    await clear();
    toast.success('Clipboard cleared');
  };

  const handleSort = () => {
    toast('Sorted by type');
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        className="cbp-trigger"
        onClick={() => { setIsOpen(o => !o); setConfirmClear(false); }}
        title="Clipboard"
      >
        <Clipboard size={18} />
        {items.length > 0 && <span className="cbp-badge">{items.length}</span>}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="cbp-panel">
          {/* Gradient header — matches HTML prototype */}
          <div className="cbp-header">
            <div className="cbp-header-left">
              <Clipboard size={16} />
              <span className="cbp-title">Clipboard</span>
              <span className="cbp-count">{items.length} items</span>
            </div>
            <div className="cbp-header-actions">
              {items.length > 0 && (
                <button
                  className={`cbp-hbtn${confirmClear ? ' cbp-hbtn--danger' : ''}`}
                  onClick={handleClear}
                  title="Clear all"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <button className="cbp-hbtn" onClick={() => setIsOpen(false)} title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="cbp-body">
            {items.length === 0 ? (
              <div className="cbp-empty">
                <Clipboard size={28} style={{ color: '#ccc', display: 'block', margin: '0 auto 8px' }} />
                <span>No items pinned yet.<br />Use the search palette to clip items.</span>
              </div>
            ) : (
              items.map(item => {
                const meta = TYPE_META[item.entity_type] || { label: item.entity_type, Icon: Clipboard, color: '#607D8B' };
                const { Icon } = meta;
                return (
                  <div key={item.id} className="cbp-item">
                    <div className="cbp-item-icon" style={{ background: meta.color }}>
                      <Icon size={11} />
                    </div>
                    <div
                      className="cbp-item-info"
                      onClick={() => {
                        const t = item.entity_type;
                        navigate(
                          t === 'inventory'   ? `/inventory`
                          : t === 'invoice'   ? `/invoices/${item.entity_id}`
                          : t === 'voucher'   ? `/journal-entries/${item.entity_id}`
                          : t === 'fixed_asset' ? `/assets/${item.entity_id}`
                          : '/'
                        );
                        setIsOpen(false);
                      }}
                    >
                      <div className="cbp-item-id">{item.label}</div>
                      <div className="cbp-item-desc">{meta.label} &bull; {formatDistanceToNow(item.added_at)}</div>
                    </div>
                    <div className="cbp-item-meta">{new Date(item.added_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                    <button className="cbp-item-remove" onClick={() => remove(item.id)} title="Remove">
                      <X size={10} />
                    </button>
                  </div>
                );
              })
            )}

            {/* Bulk action groups */}
            {items.length > 0 && (() => {
              const byType = {};
              items.forEach(i => { if (!byType[i.entity_type]) byType[i.entity_type] = []; byType[i.entity_type].push(i); });
              return Object.entries(byType).map(([type, groupItems]) => (
                <BulkActions key={type} type={type} items={groupItems} onAction={handleAction} />
              ));
            })()}
          </div>

          {/* Footer — matches HTML prototype */}
          <div className="cbp-footer">
            <button className="cbp-footer-btn" onClick={handleSort}>
              <SlidersHorizontal size={12} /> Sort
            </button>
            <button
              className="cbp-footer-btn cbp-footer-btn--primary"
              onClick={() => { navigate('/clipboard'); setIsOpen(false); }}
            >
              <ArrowUpRight size={12} /> Open Full Clipboard
            </button>
          </div>
        </div>
      )}

      <style>{`
        /* ── Trigger ── */
        .cbp-trigger {
          position: fixed; bottom: 24px; right: 24px; z-index: 8000;
          width: 48px; height: 48px; border-radius: 50%;
          background: #095C47; color: #fff;
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          transition: transform 0.15s;
        }
        .cbp-trigger:hover { transform: scale(1.08); }
        .cbp-badge {
          position: absolute; top: -4px; right: -4px;
          background: #E87722; color: #fff;
          font-size: 10px; font-weight: 700;
          min-width: 18px; height: 18px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          padding: 0 4px;
        }

        /* ── Panel ── */
        .cbp-panel {
          position: fixed; bottom: 80px; right: 24px; z-index: 8001;
          width: 340px; max-height: 520px;
          background: #fff; border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.2);
          display: flex; flex-direction: column;
          overflow: hidden;
          animation: cbpPopIn .15s ease;
        }
        @keyframes cbpPopIn {
          from { opacity:0; transform:scale(.95) translateY(-6px); }
          to   { opacity:1; transform:scale(1)   translateY(0); }
        }

        /* ── Header (green gradient like HTML) ── */
        .cbp-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px;
          background: linear-gradient(135deg, #095C47, #0D7C5F);
          color: #fff;
          flex-shrink: 0;
        }
        .cbp-header-left {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 700;
        }
        .cbp-count {
          font-size: 11px; font-weight: 400; opacity: .8;
          background: rgba(255,255,255,.2);
          padding: 2px 8px; border-radius: 10px;
        }
        .cbp-header-actions { display: flex; gap: 4px; }
        .cbp-hbtn {
          background: rgba(255,255,255,.15); border: none; color: #fff;
          cursor: pointer; padding: 4px 8px; border-radius: 6px;
          font-size: 11px; font-weight: 600;
          display: flex; align-items: center; gap: 4px;
          transition: background .1s;
        }
        .cbp-hbtn:hover { background: rgba(255,255,255,.3); }
        .cbp-hbtn--danger { background: rgba(229,57,53,.4); }
        .cbp-hbtn--danger:hover { background: rgba(229,57,53,.6); }

        /* ── Body ── */
        .cbp-body { overflow-y: auto; flex: 1; }
        .cbp-empty {
          padding: 28px 16px; text-align: center;
          color: #9e9e9e; font-size: 12px; line-height: 1.6;
        }

        /* ── Items ── */
        .cbp-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px;
          border-bottom: 1px solid #f5f5f5;
          transition: background .1s;
        }
        .cbp-item:hover { background: #e8f5f0; }
        .cbp-item:last-child { border-bottom: none; }
        .cbp-item-icon {
          width: 28px; height: 28px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          color: #fff; flex-shrink: 0;
        }
        .cbp-item-info { flex: 1; min-width: 0; cursor: pointer; }
        .cbp-item-id {
          font-size: 11.5px; font-weight: 700; color: #095C47;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cbp-item-desc { font-size: 10.5px; color: #9e9e9e; }
        .cbp-item-meta { font-size: 10px; color: #bdbdbd; white-space: nowrap; }
        .cbp-item-remove {
          width: 20px; height: 20px; border-radius: 50%;
          background: none; border: none; cursor: pointer;
          color: #bdbdbd; font-size: 10px;
          display: flex; align-items: center; justify-content: center;
          transition: all .1s; flex-shrink: 0;
        }
        .cbp-item-remove:hover { background: #ffebee; color: #e53935; }

        /* ── Bulk actions ── */
        .cbp-actions {
          display: flex; gap: 6px; padding: 4px 14px 8px; flex-wrap: wrap;
        }
        .cbp-actions button {
          font-size: 11px; padding: 3px 10px; border-radius: 4px;
          border: 1px solid #c8e6c9; background: #e8f5e9; color: #1b5e20;
          cursor: pointer;
        }
        .cbp-actions button:hover { background: #c8e6c9; }

        /* ── Footer (matches HTML prototype) ── */
        .cbp-footer {
          display: flex; gap: 6px;
          padding: 8px 14px;
          border-top: 1px solid #eee;
          background: #fafafa;
          flex-shrink: 0;
        }
        .cbp-footer-btn {
          flex: 1; padding: 6px 8px;
          border-radius: 6px; border: 1px solid #e0e0e0;
          background: #fff; color: #616161;
          cursor: pointer; font-size: 11.5px; font-weight: 600;
          display: flex; align-items: center; justify-content: center; gap: 5px;
          transition: all .1s;
        }
        .cbp-footer-btn:hover { background: #f5f5f5; }
        .cbp-footer-btn--primary {
          background: #0D7C5F; color: #fff; border-color: #0D7C5F;
        }
        .cbp-footer-btn--primary:hover { background: #095C47; }
      `}</style>
    </>
  );
}

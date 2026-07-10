import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import toast from 'react-hot-toast';
import {
  Search, X, RefreshCw, CheckCircle, XCircle, Trash2,
  Package, Clock, Download, Printer, ArrowRight,
} from 'lucide-react';
import { exportToCSV, printTable } from '../../../shared/utils/exportUtils';

/* ── Status badge ────────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const s = status?.toLowerCase();
  if (s === 'pending')  return <span className="badge b-draft">Pending</span>;
  if (s === 'approved') return <span className="badge b-active">Approved</span>;
  if (s === 'rejected') return <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Rejected</span>;
  return <span className="badge">{status || '—'}</span>;
}

/* ── Transfer Detail Modal ───────────────────────────────────────────────── */
function TransferDetailModal({ transfer, onClose }) {
  if (!transfer) return null;

  const lots     = transfer.lots || [];
  const totalQty = lots.reduce((s, l) => s + parseFloat(l.transfer_qty || 0), 0);
  const unit     = lots[0]?.unit || '';
  const isApproved = transfer.status?.toLowerCase() === 'approved';
  const isPending  = transfer.status?.toLowerCase() === 'pending';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#FFFFFF',
        borderRadius: 14,
        boxShadow: '0 24px 80px rgba(0,0,0,0.30)',
        width: '100%',
        maxWidth: 820,
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--g200)',
      }}>

        {/* Accent bar */}
        <div style={{
          height: 4,
          background: isApproved
            ? 'linear-gradient(90deg,#0D7C5F,#34d399)'
            : isPending
            ? 'linear-gradient(90deg,#f59e0b,#fcd34d)'
            : 'linear-gradient(90deg,#ef4444,#fca5a5)',
          flexShrink: 0,
        }} />

        {/* Header */}
        <div style={{
          padding: '18px 24px 16px',
          borderBottom: '1px solid var(--g200)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
                color: 'var(--g800)', letterSpacing: '0.02em',
              }}>
                {transfer.transfer_id}
              </span>
              <StatusBadge status={transfer.status} />
            </div>

            {/* Info chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {/* From → To */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--g100)', border: '1px solid var(--g200)',
                borderRadius: 8, padding: '5px 10px',
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From Dept</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--g800)' }}>
                  {transfer.source_location_name || '—'}
                </span>
                <ArrowRight size={12} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To Dept</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>
                  {transfer.destination_location_name || '—'}
                </span>
              </div>

              {/* Date */}
              {transfer.created_at && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'var(--g100)', border: '1px solid var(--g200)',
                  borderRadius: 8, padding: '5px 10px',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
                  <span style={{ fontSize: 12, color: 'var(--g800)' }}>
                    {new Date(transfer.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}

              {/* Approved by */}
              {transfer.approved_by_name && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: '#ecfdf5', border: '1px solid #a7f3d0',
                  borderRadius: 8, padding: '5px 10px',
                }}>
                  <CheckCircle size={11} style={{ color: '#059669', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Approved by</span>
                  <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600 }}>
                    {transfer.approved_by_name}
                  </span>
                  {transfer.approved_at && (
                    <span style={{ fontSize: 11, color: '#059669' }}>
                      · {new Date(transfer.approved_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            className="icon-btn"
            onClick={onClose}
            title="Close"
            style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: 'var(--g100)', border: '1px solid var(--g200)',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Materials table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {lots.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--g400)', fontSize: 13 }}>
              <Package size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>No materials in this transfer</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--table-header)', borderBottom: '2px solid var(--g200)' }}>
                  <th style={{ width: 42, padding: '10px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>#</th>
                  <th style={{ width: 150, padding: '10px 12px', textAlign: 'left',   fontSize: 11, fontWeight: 700, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Material Code</th>
                  <th style={{            padding: '10px 12px', textAlign: 'left',   fontSize: 11, fontWeight: 700, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Material Name</th>
                  <th style={{ width: 140, padding: '10px 16px', textAlign: 'right',  fontSize: 11, fontWeight: 700, color: 'var(--g400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Transfer Qty</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid var(--g200)',
                      background: i % 2 === 1 ? 'var(--table-alt)' : '#FFFFFF',
                    }}
                  >
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontSize: 11, color: 'var(--g400)', fontWeight: 500 }}>
                      {i + 1}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600,
                        color: 'var(--brand)', background: '#ecfdf5',
                        border: '1px solid #a7f3d0', borderRadius: 5,
                        padding: '2px 7px', display: 'inline-block',
                      }}>
                        {l.lot_code || l.lot_number || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 12px', fontSize: 13, color: 'var(--g800)', fontWeight: 500 }}>
                      {l.item_name || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--g800)', fontFamily: 'var(--mono)' }}>
                        {parseFloat(l.transfer_qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                      </span>
                      {l.unit && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--g400)', marginLeft: 5, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                          {l.unit}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '2px solid var(--g200)',
          background: 'var(--g100)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--g500)', fontWeight: 500 }}>
              {lots.length} material{lots.length !== 1 ? 's' : ''}
            </span>
            <div style={{ width: 1, height: 16, background: 'var(--g300)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--g800)', fontFamily: 'var(--mono)' }}>
              Total: {totalQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
              {unit && (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--g400)', marginLeft: 5, textTransform: 'uppercase' }}>
                  {unit}
                </span>
              )}
            </span>
          </div>
          <button className="btn btn-primary" style={{ minWidth: 80, fontWeight: 600 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function StockTransferPage() {
  const api      = useApi();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [transfers,      setTransfers]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState('');
  const [tab,            setTab]            = useState('pending');
  const [saving,         setSaving]         = useState(null);
  const [spinning,       setSpinning]       = useState(false);
  const [exporting,      setExporting]      = useState(false);
  const [detailTransfer, setDetailTransfer] = useState(null);

  /* ── Fetch ──────────────────────────────────────────────────────────── */
  const fetchTransfers = useCallback(async () => {
    try {
      const res = await api.get('/api/stock-transfer/pending');
      setTransfers(res.data || res || []);
    } catch (err) {
      console.error('[StockTransferPage] fetchTransfers failed:', err);
      toast.error('Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchTransfers();
    window.addEventListener('pending_transfers_updated', fetchTransfers);
    return () => window.removeEventListener('pending_transfers_updated', fetchTransfers);
  }, [fetchTransfers]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await fetchTransfers(); } finally { setSpinning(false); }
  }, [fetchTransfers]);

  /* ── Actions ────────────────────────────────────────────────────────── */
  const handleApprove = async (t) => {
    setSaving(t.id);
    try {
      await api.post(`/api/stock-transfer/pending/${t.id}/approve`);
      toast.success(`Transfer ${t.transfer_id} approved — stock moved to destination.`);
      window.dispatchEvent(new Event('pending_transfers_updated'));
      window.dispatchEvent(new Event('inventory_updated'));
      await fetchTransfers();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Approval failed';
      if (err.response?.status === 409) {
        toast.error(msg);
        window.dispatchEvent(new Event('pending_transfers_updated'));
        window.dispatchEvent(new Event('inventory_updated'));
        await fetchTransfers();
      } else {
        toast.error(msg);
      }
    } finally { setSaving(null); }
  };

  const handleReject = async (t) => {
    setSaving(t.id);
    try {
      await api.post(`/api/stock-transfer/pending/${t.id}/reject`);
      toast.success(`Transfer ${t.transfer_id} rejected.`);
      window.dispatchEvent(new Event('pending_transfers_updated'));
      await fetchTransfers();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Rejection failed';
      if (err.response?.status === 404) {
        window.dispatchEvent(new Event('pending_transfers_updated'));
        await fetchTransfers();
      }
      toast.error(msg);
    } finally { setSaving(null); }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete transfer ${t.transfer_id}?`)) return;
    setSaving(t.id);
    try {
      await api.delete(`/api/stock-transfer/pending/${t.id}`);
      toast.success('Transfer deleted.');
      setTransfers(prev => prev.filter(x => x.id !== t.id));
      window.dispatchEvent(new Event('pending_transfers_updated'));
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Delete failed');
    } finally { setSaving(null); }
  };

  /* ── Role checks ────────────────────────────────────────────────────── */
  const isSender   = (t) => user && (t.created_by === user.id || String(t.created_by) === String(user.id));
  const isReceiver = (t) => user && !isSender(t) && t.status?.toLowerCase() === 'pending';

  /* ── Derived data ───────────────────────────────────────────────────── */
  const pendingTransfers  = transfers.filter(t => t.status?.toLowerCase() === 'pending');
  const approvedTransfers = transfers.filter(t => t.status?.toLowerCase() === 'approved');
  const baseSet = tab === 'pending' ? pendingTransfers : approvedTransfers;

  const filtered = baseSet.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.transfer_id?.toLowerCase().includes(s)               ||
      t.source_location_name?.toLowerCase().includes(s)      ||
      t.destination_location_name?.toLowerCase().includes(s) ||
      t.lots?.some(l =>
        l.lot_code?.toLowerCase().includes(s)   ||
        l.lot_number?.toLowerCase().includes(s) ||
        l.item_name?.toLowerCase().includes(s)
      )
    );
  });

  /* ── Export ─────────────────────────────────────────────────────────── */
  const handleExport = async (format) => {
    setExporting(true);
    try {
      const headers = [
        'Transfer ID', 'Material Code', 'Material Name',
        'Transfer Qty', 'Unit', 'From Location', 'To Location',
        'Status', 'Transfer Date', 'Approved By', 'Approve Date',
      ];
      const rows = filtered.map(t => [
        t.transfer_id || '',
        t.lots?.length === 1 ? (t.lots[0].lot_code || t.lots[0].lot_number || '') : `${t.lots?.length || 0} lots`,
        t.lots?.map(l => l.item_name).filter(Boolean).join('; ') || '',
        t.lots ? String(t.lots.reduce((s, l) => s + parseFloat(l.transfer_qty || 0), 0)) : '',
        t.lots?.[0]?.unit || '',
        t.source_location_name || '',
        t.destination_location_name || '',
        t.status || '',
        t.created_at  ? new Date(t.created_at).toLocaleDateString('en-IN')  : '',
        t.approved_by_name || '',
        t.approved_at ? new Date(t.approved_at).toLocaleDateString('en-IN') : '',
      ]);
      const subtitle = `${filtered.length} records · ${new Date().toLocaleString('en-IN')}`;
      if (format === 'csv') {
        exportToCSV(`stock-transfers-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
      } else {
        printTable('Stock Transfers', subtitle, headers, rows);
      }
    } catch (err) {
      console.error('[StockTransferPage] export failed:', err);
    }
    finally { setExporting(false); }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <>
      <TransferDetailModal transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />

      <div className="grid-page animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Toolbar */}
          <div className="grid-toolbar">
            <div style={{ display: 'flex', gap: 6, marginRight: 14 }}>
              <button className={`btn ${tab === 'all' ? 'btn-primary' : ''}`} onClick={() => setTab('all')}>
                All Transfers {approvedTransfers.length > 0 && `(${approvedTransfers.length})`}
              </button>
              <button className={`btn ${tab === 'pending' ? 'btn-primary' : ''}`} onClick={() => setTab('pending')}>
                Pending {pendingTransfers.length > 0 && `(${pendingTransfers.length})`}
              </button>
            </div>

            <div className="filter-field" style={{ width: 220 }}>
              <label className="filter-label">Search</label>
              <div className="grid-toolbar-search">
                <Search size={14} />
                <input
                  placeholder="Search transfers…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="icon-btn" style={{ flexShrink: 0 }} onClick={() => setSearch('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ flex: 1 }} />
            <span className="grid-count">{filtered.length} records</span>

            <div className="grid-toolbar-right">
              <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('csv')}>
                <Download size={13} /> CSV
              </button>
              <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('print')}>
                <Printer size={13} /> Print
              </button>
              <button 
                className="btn btn-sm btn-primary" 
                onClick={() => navigate('/inventory/stock-transfer/new')}
                style={{ marginLeft: 8 }}
              >
                + New Transfer
              </button>
              <button
                className="icon-btn"
                title="Refresh"
                onClick={handleRefresh}
                disabled={spinning}
                style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="grid-wrap">
            {loading ? (
              <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
            ) : filtered.length === 0 ? (
              <div className="empty-state" style={{ padding: 60 }}>
                <Package size={32} />
                <p style={{ marginTop: 8, color: 'var(--g500)', fontSize: 13 }}>
                  {tab === 'pending' ? 'No pending transfers' : 'No transfers'}
                </p>
              </div>
            ) : (
              <table className="dgrid">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Transfer ID</th>
                    <th style={{ width: 110 }}>Material Code</th>
                    <th>Material Name</th>
                    <th className="num" style={{ width: 105 }}>Transfer Qty</th>
                    <th style={{ width: 130 }}>From Location</th>
                    <th style={{ width: 130 }}>To Location</th>
                    <th style={{ width: 88 }}>Status</th>
                    <th style={{ width: 95 }}>Date</th>
                    <th style={{ width: 120 }}>Approved By</th>
                    <th style={{ width: 200 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const isPending  = t.status?.toLowerCase() === 'pending';
                    const isApproved = t.status?.toLowerCase() === 'approved';
                    const isRejected = t.status?.toLowerCase() === 'rejected';
                    const isBusy     = saving === t.id;

                    return (
                      <tr
                        key={t.id}
                        onDoubleClick={() => setDetailTransfer(t)}
                        style={{ cursor: 'pointer' }}
                        title="Double-click to view all materials"
                      >
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 }}>
                          {t.transfer_id || '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                          {t.lots?.length === 1
                            ? (t.lots[0].lot_code || t.lots[0].lot_number || '—')
                            : t.lots?.length > 1
                              ? `${t.lots.length} lots`
                              : '—'}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {t.lots?.length === 1
                            ? (t.lots[0].item_name || '—')
                            : t.lots?.length > 1
                              ? t.lots.map(l => l.item_name).filter(Boolean).join(', ').slice(0, 60) || '—'
                              : '—'}
                        </td>
                        <td className="num" style={{ fontSize: 12 }}>
                          {t.lots?.length
                            ? <>
                                {t.lots.reduce((s, l) => s + parseFloat(l.transfer_qty || 0), 0)
                                  .toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                                {t.lots[0]?.unit && (
                                  <span style={{ color: 'var(--g400)', fontSize: 10, marginLeft: 3 }}>
                                    {t.lots[0].unit}
                                  </span>
                                )}
                              </>
                            : '—'}
                        </td>
                        <td style={{ fontSize: 11 }}>{t.source_location_name || '—'}</td>
                        <td style={{ fontSize: 11 }}>{t.destination_location_name || '—'}</td>
                        <td><StatusBadge status={t.status} /></td>
                        <td style={{ fontSize: 11, color: 'var(--g500)' }}>
                          {t.created_at
                            ? new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                            : '—'}
                        </td>
                        <td style={{ fontSize: 11 }}>{t.approved_by_name || '—'}</td>

                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>

                            {isPending && isReceiver(t) && (
                              <>
                                <button
                                  className="btn btn-sm btn-primary"
                                  style={{ fontSize: 10, padding: '2px 8px', gap: 3 }}
                                  onClick={() => handleApprove(t)}
                                  disabled={isBusy}
                                >
                                  <CheckCircle size={11} /> Approve
                                </button>
                                <button
                                  className="btn btn-sm"
                                  style={{ fontSize: 10, padding: '2px 8px', gap: 3, color: '#dc2626', borderColor: '#fca5a5' }}
                                  onClick={() => handleReject(t)}
                                  disabled={isBusy}
                                >
                                  <XCircle size={11} /> Reject
                                </button>
                              </>
                            )}

                            {isPending && isSender(t) && (
                              <>
                                <span style={{ fontSize: 10, color: 'var(--g500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <Clock size={10} /> Pending Approval
                                </span>
                                <button
                                  className="icon-btn"
                                  style={{ color: '#dc2626', marginLeft: 4 }}
                                  onClick={() => handleDelete(t)}
                                  disabled={isBusy}
                                  title="Delete transfer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}

                            {isApproved && (
                              <span style={{ fontSize: 10, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <CheckCircle size={10} /> Transferred
                              </span>
                            )}

                            {isRejected && (
                              <span style={{ fontSize: 10, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <XCircle size={10} /> Rejected
                              </span>
                            )}

                            {isBusy && <div className="spinner" style={{ width: 14, height: 14 }} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

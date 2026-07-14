import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import LotLineageTree from '../../inventory/components/LotLineageTree';
import LotMovementLedger from '../components/LotMovementLedger';
import LotHistoryTab from '../components/LotHistoryTab';
import {
  ArrowLeft, GitBranch, GitMerge, Share2,
  Package, MapPin, User, Calendar, Tag, Layers,
  ChevronRight, Send, RotateCcw, Clock, History,
  ChevronDown, RefreshCw, X, CheckCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

import SplitLotPage from './SplitLotPage';
import MixLotsPage from './MixLotsPage';
import LotIssuePage from './LotIssuePage';
import LotReturnPage from './LotReturnPage';
import { getAllowedActions } from '../utils/actionMatrix';
import { useClipboard } from '../../../core/context/ClipboardContext';

// ── Status + helpers ──────────────────────────────────────────────────────────
const statusColors = {
  'IN STOCK':   { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  'LOW STOCK':  { bg: '#FFF8E1', color: '#F57F17', border: '#FFE082' },
  'IN PROCESS': { bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  'REPROCESS':  { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
  'QC_HOLD':    { bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  'CONSUMED':   { bg: '#FAFAFA', color: '#757575', border: '#E0E0E0' },
  'DAMAGED':    { bg: '#FFEBEE', color: '#C62828', border: '#EF9A9A' },
  'SOLD':       { bg: '#E8EAF6', color: '#283593', border: '#9FA8DA' },
  'ARCHIVED':   { bg: '#F3E5F5', color: '#4A148C', border: '#CE93D8' },
};
const sc = s => statusColors[s] || { bg: '#F5F5F5', color: '#616161', border: '#E0E0E0' };
const fmt = v => v != null ? `₹${Number(v).toLocaleString('en-IN')}` : '—';
const fmtDate = d => d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

// ── Tabs ──────────────────────────────────────────────────────────────────────
const ALL_TABS = ['Overview', 'Genealogy', 'History', 'Operations', 'Process', 'Attachments'];

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, mono, accent }) {
  return (
    <div style={{
      padding: '10px 14px', background: '#fff',
      border: `1px solid ${accent ? 'var(--brand-50)' : 'var(--g200)'}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.5px', color: accent ? 'var(--brand-dark)' : 'var(--g500)' }}>
        {label}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700,
        color: accent ? 'var(--brand-dark)' : 'var(--g900)',
        fontFamily: mono ? 'var(--mono)' : undefined,
      }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--g500)' }}>{sub}</div>}
    </div>
  );
}

function RowDetail({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '7px 14px', borderBottom: '1px solid var(--g100)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--g500)', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: 'var(--g800)', fontFamily: 'var(--mono)',
        maxWidth: '60%', textAlign: 'right', wordBreak: 'break-word' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function LotRow({ lot, navigate }) {
  const { bg, color, border } = sc(lot.status);
  const eff = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
  return (
    <div
      onClick={() => navigate(`/inventory/lots/${lot.lot_id || lot.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
        borderRadius: 6, cursor: 'pointer', border: '1px solid var(--g200)',
        background: '#fafafa', marginBottom: 5,
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#EBF5F0'}
      onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
    >
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--g900)', flex: 1 }}>
        {lot.lot_code || lot.lot_number}
      </span>
      <span style={{ fontSize: 11, color: 'var(--g500)' }}>
        {eff.toFixed(4)} {lot.unit}
      </span>
      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700,
        textTransform: 'uppercase', background: bg, color, border: `1px solid ${border}` }}>
        {lot.status}
      </span>
      <ChevronRight size={12} style={{ color: 'var(--g400)' }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LotWorkspacePage() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const api          = useApi();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'overview';
  const setTab = tab => setSearchParams({ tab }, { replace: true });

  const [lot,          setLot]          = useState(null);
  const [lineage,      setLineage]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [actionsOpen,  setActionsOpen]  = useState(false);

  const { openStockTransferModal } = useClipboard();
  const [activeModal, setActiveModal] = useState(null);

  // Process tab state (lazy-loaded)
  const [processData,  setProcessData]  = useState(null);
  const [processLoaded,setProcessLoaded]= useState(false);

  const [showGrowthReturn, setShowGrowthReturn] = useState(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [meas, setMeas] = useState({ weight: '', length: '', width: '', height: '', remarks: '' });
  const setM = k => e => setMeas(m => ({ ...m, [k]: e.target.value }));

  const handleGrowthReturnSubmit = async () => {
    const w = parseFloat(meas.weight);
    const h = parseFloat(meas.height);
    if (!w || w <= 0 || !h || h <= 0) {
      toast.error("Weight and Height are required and must be greater than 0");
      return;
    }
    
    const activeProcessIssue = processData?.issues?.find(i => i.status === 'OPEN');
    const processId = activeProcessIssue?.machine_process_id;
    if (!processId) {
       toast.error("Could not find the active process ID.");
       return;
    }

    setSubmittingReturn(true);
    try {
      await api.patch(`/api/manufacturing/processes/${processId}/complete`, {
         remarks: meas.remarks,
         weight: meas.weight,
         height: meas.height,
         length: meas.length,
         width: meas.width,
      });
      toast.success("Growth Run completed successfully");
      setShowGrowthReturn(false);
      setMeas({ weight: '', length: '', width: '', height: '', remarks: '' });
      loadCore(); // Reload lot details
      if (processLoaded) {
          setProcessLoaded(false); // will re-trigger process tab fetch on switch
      }
    } catch (err) {
      toast.error(err.message || 'Failed to complete process');
    } finally {
      setSubmittingReturn(false);
    }
  };

  const loadCore = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/api/inventory/${id}`),
      api.get(`/api/lot-movements/lineage/${id}`).catch(() => null),
    ])
      .then(([lotData, lineageData]) => {
        setLot(lotData);
        setLineage(lineageData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadCore(); }, [loadCore]);

  // Load process issues when on the Process tab OR when the lot is IN PROCESS.
  // Eager loading for IN PROCESS lots ensures isCurrentlyInCvdGrowth resolves
  // before the Actions dropdown first renders, preventing the wrong default action.
  useEffect(() => {
    if (processLoaded || !lot) return;
    if (activeTab !== 'process' && lot.status !== 'IN PROCESS') return;
    Promise.all([
      api.get(`/api/lot-process-issues?lot_id=${id}`).catch(() => ({ data: [] })),
    ]).then(([issueData]) => {
      setProcessData({ issues: issueData.data || [] });
      setProcessLoaded(true);
    });
  }, [activeTab, processLoaded, lot, id]);

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [actionsOpen]);

  if (loading) {
    return (
      <div className="animate-in" style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'center', height: '100%' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!lot) {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <Package size={32} />
        <p>Lot not found.</p>
        <button className="btn btn-sm" onClick={() => navigate('/inventory')}>← Back to Inventory</button>
      </div>
    );
  }

  const isActive    = lot.status === 'IN STOCK';
  const isInProcess = lot.status === 'IN PROCESS';
  
  const isGrowthRun = lot.category === 'growth_run' || lot.item_category === 'growth_run';
  const runBadge = (isGrowthRun && lot.run_no && lot.run_no > 1) ? ` (R${lot.run_no})` : '';
  const displayCode = (lot.lot_code || lot.lot_number) + runBadge;
  const { bg, color, border } = sc(lot.status);
  const eff = lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);

  const breadcrumb = lineage
    ? [...(lineage.ancestors || [])].sort((a, b) => b.depth - a.depth).map(a => a.lot)
    : [];
  const descendants = lineage?.descendants || [];
  const ancestors   = lineage?.ancestors   || [];

  // Correction 2,3,4: Determine if this is a Growth Run (biscuit) that is IN PROCESS.
  // Growth Runs must complete via the Growth Run Return dialog on the Control Tower,
  // NOT through the legacy Seed Return path. We direct operators to Manufacturing.
  
  // Find the active process issue to determine the actual machine process type
  const activeProcessIssue = processData?.issues?.find(i => i.status === 'OPEN');
  // True only if it's currently in a CVD Growth process
  const isCurrentlyInCvdGrowth = isInProcess && activeProcessIssue?.process_type === 'growth';

  // Quick actions list — generated entirely from the Action Matrix
  // (client/src/modules/inventory/utils/actionMatrix.js). The matrix is the
  // single source of truth for which actions a lot permits, keyed by
  // (category × status). This dropdown only maps each allowed capability to its
  // existing handler; it defines NO gating rules of its own.
  const perms = getAllowedActions(lot);
  const actions = [
    perms.canViewHistory && { label: 'View History', icon: <History size={12} />, fn: () => setTab('history') },
    perms.canViewLineage && { label: 'View Lineage', icon: <Share2 size={12} />, fn: () => navigate(`/inventory/${id}/lineage`) },
    perms.canIssueProcess && { label: 'Issue to Process', icon: <Send size={12} />, fn: () => setActiveModal('issue'), accent: true },
    perms.canGrowthAgain && { label: 'Growth Again', icon: <RotateCcw size={12} />, fn: () => navigate('/manufacturing/control-tower'), accent: true },
    perms.canGrowthOutput && { label: 'Process Issues', icon: <Package size={12} />, fn: () => navigate('/inventory/process-issues'), accent: true },
    perms.canTransfer && { label: 'Stock Transfer', icon: <Send size={12} />, fn: () => openStockTransferModal([{ ...lot, id: lot.lot_id || lot.id, lot_code: displayCode }], () => loadCore()), accent: true },
    perms.canSplit && { label: 'Split Lot', icon: <GitBranch size={12} />, fn: () => setActiveModal('split'), accent: true },
    perms.canMix && { label: 'Mix Into…', icon: <GitMerge size={12} />, fn: () => setActiveModal('mix'), accent: true },
    // Complete Growth Run is only valid for a biscuit inside a CVD *growth* process.
    // The Action Matrix grants it for any growth_run IN PROCESS (it cannot see the
    // runtime process_type), so we AND it with the already-computed CVD-growth guard
    // here. A biscuit in a laser/cut process must complete via Process Issues, not this
    // dimension-measurement dialog.
    perms.canCompleteGrowthRun && isCurrentlyInCvdGrowth && { label: 'Complete Growth Run', icon: <CheckCircle size={12} />, fn: () => setShowGrowthReturn(true), accent: true },
    // TASK 5: Return from Process — navigates directly to LotReturnPage using the
    // open process issue id. Operator does not need to search Process Issues manually.
    // Only available for IN PROCESS lots via actionMatrix (seed / rough / gas / consumable).
    // growth_run IN PROCESS uses canCompleteGrowthRun (above) instead.
    perms.canReturn && { label: 'Return from Process', icon: <RotateCcw size={12} />, fn: () => setActiveModal('return'), accent: true },
  ].filter(Boolean);


  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Sticky Header ── */}
      <div style={{
        padding: '8px 16px', background: '#fff', flexShrink: 0,
        borderBottom: '1px solid var(--g200)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <button className="icon-btn" onClick={() => navigate('/inventory')} title="Back">
          <ArrowLeft size={15} />
        </button>

        {/* Identity: item name first, lot code below */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--g900)', lineHeight: 1.2 }}>
            {lot.item_name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--mono)',
              color: 'var(--brand-dark)' }}>
              {displayCode}
            </span>
            {lot.lot_op_id != null && (
              <span title="Lot Operational ID (barcode identity)"
                style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--g500)',
                  background: 'var(--g100)', border: '1px solid var(--g300)',
                  borderRadius: 4, padding: '1px 6px', letterSpacing: 1 }}>
                #{lot.lot_op_id}
              </span>
            )}
            <span style={{ fontSize: 10.5, padding: '1px 8px', borderRadius: 20,
              fontWeight: 700, textTransform: 'uppercase', background: bg, color,
              border: `1px solid ${border}` }}>
              {lot.status}
            </span>
            {lot.split_level != null && (
              <span style={{ fontSize: 10, color: 'var(--g400)', fontFamily: 'var(--mono)' }}>
                L{lot.split_level}
              </span>
            )}
          </div>
        </div>

        {/* Right: refresh + actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <button className="icon-btn" onClick={loadCore} title="Refresh">
            <RefreshCw size={13} />
          </button>
          {/* Quick actions dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={e => { e.stopPropagation(); setActionsOpen(v => !v); }}
            >
              Actions <ChevronDown size={11} />
            </button>
            {actionsOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 200, minWidth: 190,
                background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,.12)', padding: '4px 0',
              }}>
                {actions.map(({ label, icon, fn, accent }) => (
                  <div key={label}
                    onClick={() => { setActionsOpen(false); fn(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px', fontSize: 12, cursor: 'pointer',
                      color: accent ? 'var(--brand-dark)' : 'var(--g700)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    {icon} {label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--g200)', background: '#fff',
        padding: '0 24px', flexShrink: 0, overflowX: 'auto',
      }}>
        {ALL_TABS.filter(t => t !== 'History' || perms.canViewHistory).map(tab => {
          const key = tab.toLowerCase();
          const active = activeTab === key;
          return (
            <button
              key={tab}
              onClick={() => setTab(key)}
              style={{
                padding: '9px 18px', border: 'none', background: 'none',
                cursor: 'pointer', fontSize: 12.5, fontWeight: active ? 700 : 500,
                color: active ? 'var(--brand-dark)' : 'var(--g500)',
                borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom: -2, transition: 'all .1s', whiteSpace: 'nowrap',
              }}
            >
              {tab}
              {tab === 'Process' && isInProcess && (
                <span style={{ marginLeft: 5, width: 6, height: 6, borderRadius: '50%',
                  background: '#E65100', display: 'inline-block', verticalAlign: 'middle' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Scrollable Tab Content ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* The History register uses the FULL workspace width; every other
            tab keeps the original centered 960px reading layout. */}
        <div style={{ padding: '20px 24px',
          maxWidth: activeTab === 'history' ? 'none' : 960, margin: '0 auto' }}>

          {/* ════ OVERVIEW TAB ════ */}
          {activeTab === 'overview' && (
            <>
              {/* Correction 4: Growth Run IN PROCESS guidance banner */}
              {isCurrentlyInCvdGrowth && (
                <div style={{
                  background: '#FFF3E0', border: '1px solid #FFE0B2', borderRadius: 6,
                  padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start'
                }}>
                  <div style={{ background: '#F57F17', color: '#fff', padding: 6, borderRadius: '50%', marginTop: 2 }}>
                    <AlertCircle size={16} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: '#E65100', fontSize: 13, fontWeight: 600 }}>
                      Growth Run — Chamber Active
                    </h4>
                    <p style={{ margin: 0, fontSize: 12, color: '#E65100', lineHeight: 1.5 }}>
                      This Growth Run is currently <strong>IN PROCESS</strong> (inside the chamber).
                      To complete it, go to <strong>Manufacturing → Control Tower</strong>, find the machine,
                      and click <strong>Complete</strong> to open the Growth Run Return dialog (Weight, Height, Length, Width).
                      After saving, the Growth Run will become <strong>IN STOCK</strong> and available for laser ops, transfers, and output.
                    </p>
                    <button
                      className="btn btn-sm"
                      style={{ marginTop: 8, background: '#F57F17', color: '#fff', border: 'none', fontSize: 11 }}
                      onClick={() => navigate('/manufacturing/control-tower')}
                    >
                      → Go to Manufacturing
                    </button>
                  </div>
                </div>
              )}
              {/* Key metrics */}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                <MetricCard
                  label={`Qty (${lot.unit})`}
                  value={eff.toFixed(4)}
                  mono accent
                />
                <MetricCard
                  label="Total Value"
                  value={fmt(lot.total_value)}
                  mono
                />
                <MetricCard
                  label={`Rate / ${lot.unit}`}
                  value={fmt(lot.rate)}
                  mono
                />
                {parseFloat(lot.weight || 0) > 0 && lot.unit !== 'CT' && (
                  <MetricCard label="Weight (g)" value={parseFloat(lot.weight).toFixed(4)} mono />
                )}
                <MetricCard label="Location" value={lot.location_name || '—'} />
                <MetricCard label="Vendor" value={lot.vendor_name || '—'} />
                <MetricCard label="Purchase Date" value={fmtDate(lot.purchase_date)} />
                <MetricCard label="Batch / Cyl" value={lot.batch_no || '—'} />
                {lot.lot_op_id != null && (
                  <MetricCard label="Lot ID (Barcode)" value={lot.lot_op_id} mono />
                )}
                {(lot.dim_length != null || lot.dim_depth != null || lot.dim_height != null) && (() => {
                  const fv = v => v != null ? parseFloat(v) : '?';
                  const preview = `${fv(lot.dim_length)} × ${fv(lot.dim_depth)} × ${fv(lot.dim_height)}${lot.dim_unit ? ' ' + lot.dim_unit : ''}`;
                  return <MetricCard label="Dimensions" value={preview} mono />;
                })()}
              </div>

              {/* Lot detail rows */}
              <div style={{ background: '#fff', border: '1px solid var(--g200)',
                borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                <div style={{ padding: '8px 14px', background: 'var(--table-header)',
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.6px', color: 'var(--brand-dark)' }}>
                  Lot Details
                </div>
                {[
                  ['Item', lot.item_name],
                  ['Lot ID (Barcode)', lot.lot_op_id != null ? String(lot.lot_op_id) : '—'],
                  ['Lot Name', lot.lot_code || lot.lot_number],
                  ['Lot Number (Internal)', lot.lot_number],
                  ['Lot Label', lot.lot_name || '—'],
                  ['Parent Lot', lot.parent_lot_name || '—'],
                  ['Root Lot', lot.root_lot_name || '—'],
                  ['Item Category', lot.category],
                  ['Operation Type', lot.operation_type || 'purchase'],
                  ['Split Level', lot.split_level != null ? `Level ${lot.split_level}` : '—'],
                  ['Genealogy Path', lot.genealogy_path || '—'],
                  ['Source', lot.source_type || '—'],
                  ['Length', lot.dim_length != null ? `${parseFloat(lot.dim_length)} ${lot.dim_unit || ''}`.trim() : '—'],
                  ['Depth',  lot.dim_depth  != null ? `${parseFloat(lot.dim_depth)}  ${lot.dim_unit || ''}`.trim() : '—'],
                  ['Height', lot.dim_height != null ? `${parseFloat(lot.dim_height)} ${lot.dim_unit || ''}`.trim() : '—'],
                  ['Remarks', lot.remarks || '—'],
                ].map(([k, v], i) => (
                  <div key={k} style={{ background: i % 2 === 0 ? '#fff' : 'var(--table-alt)' }}>
                    <RowDetail label={k} value={v} />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ════ GENEALOGY TAB ════ */}
          {activeTab === 'genealogy' && (
            <>
              {/* Breadcrumb */}
              {(breadcrumb.length > 0 || lot.genealogy_path) && (
                <div style={{
                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
                  padding: '8px 12px', background: 'var(--brand-50)',
                  borderRadius: 6, marginBottom: 16, fontSize: 11, fontFamily: 'var(--mono)',
                }}>
                  {breadcrumb.length > 0
                    ? breadcrumb.map((anc, idx) => (
                      <span key={`anc-${idx}-${anc.id || ''}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          onClick={() => navigate(`/inventory/lots/${anc.id}`)}
                          style={{ cursor: 'pointer', color: 'var(--link)', fontWeight: 600 }}
                        >
                          {anc.lot_code || anc.lot_number}
                        </span>
                        <ChevronRight size={10} style={{ color: 'var(--g400)' }} />
                      </span>
                    ))
                    : lot.genealogy_path
                      ? lot.genealogy_path.split('/').slice(0, -1).map((seg, idx) => (
                        <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--g500)', fontWeight: 600 }}>{seg}</span>
                          <ChevronRight size={10} style={{ color: 'var(--g400)' }} />
                        </span>
                      ))
                      : null}
                  <span style={{ fontWeight: 800, color: 'var(--brand-dark)' }}>{displayCode}</span>
                </div>
              )}

              {/* Lineage tree */}
              {lineage
                ? <LotLineageTree lineage={lineage} />
                : <div style={{ color: 'var(--g400)', fontSize: 12, fontStyle: 'italic' }}>
                    Genealogy data not available.
                  </div>}

              {/* Direct descendants */}
              {descendants.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 10,
                    paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
                    Child Lots ({descendants.filter(d => d.depth === 1).length})
                  </div>
                  {descendants.filter(d => d.depth === 1).map((d, i) => (
                    <LotRow key={i} lot={{ ...d.lot, lot_id: d.lot.id }} navigate={navigate} />
                  ))}
                  {descendants.filter(d => d.depth > 1).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 4, fontStyle: 'italic' }}>
                      + {descendants.filter(d => d.depth > 1).length} deeper descendants — see Lineage view
                    </div>
                  )}
                </div>
              )}

              {/* Ancestor lots */}
              {ancestors.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 10,
                    paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
                    Ancestor Lots ({ancestors.length})
                  </div>
                  {ancestors.map((a, i) => (
                    <LotRow key={i} lot={{ ...a.lot, lot_id: a.lot.id }} navigate={navigate} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ════ OPERATIONS TAB ════ */}
          {activeTab === 'operations' && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 14,
                paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
                <History size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Movement Ledger — {displayCode}
              </div>
              <LotMovementLedger lotId={id} />
            </>
          )}

          {/* ════ HISTORY TAB ════ */}
          {activeTab === 'history' && (
            <LotHistoryTab lotId={id} />
          )}

          {/* ════ PROCESS TAB ════ */}
          {activeTab === 'process' && (
            <>
              {isInProcess && (
                <div style={{ padding: '12px 14px', background: '#FFF3E0',
                  border: '1px solid #FFCC80', borderRadius: 8, marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '.5px', color: '#E65100', marginBottom: 8, display: 'flex',
                    alignItems: 'center', gap: 5 }}>
                    <Clock size={11} /> Active — In Process
                  </div>
                  <div style={{ fontSize: 12, color: '#E65100' }}>
                    This lot is currently IN PROCESS. Record a return to close it.
                  </div>
                </div>
              )}

              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 12,
                paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
                Process Issue History
              </div>

              {!processLoaded ? (
                <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
              ) : processData?.issues?.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--g400)',
                  fontSize: 12, fontStyle: 'italic', border: '1px dashed var(--g300)', borderRadius: 8 }}>
                  No process issues recorded for this lot.
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid var(--g200)',
                  borderRadius: 8, overflow: 'hidden' }}>
                  {processData.issues.map((issue, i) => {
                    const isOpen = issue.status === 'OPEN';
                    return (
                      <div key={issue.id} style={{
                        padding: '12px 14px', borderBottom: '1px solid var(--g100)',
                        background: i % 2 === 0 ? '#fff' : 'var(--table-alt)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'flex-start', gap: 10 }}>
                          <div>
                            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12,
                              color: 'var(--g900)' }}>
                              {issue.issue_number}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--g600)', marginTop: 3 }}>
                              {new Date(issue.issue_date).toLocaleDateString('en-IN')}
                              {issue.department ? ` · ${issue.department}` : ''}
                              {issue.operator ? ` · ${issue.operator}` : ''}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--g600)', marginTop: 2 }}>
                              Issued: <strong style={{ fontFamily: 'var(--mono)' }}>
                                {Number(issue.issued_qty).toFixed(4)} {issue.unit}
                              </strong>
                            </div>
                            {issue.remarks && (
                              <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>
                                {issue.remarks}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                              background: isOpen ? '#FFF3E0' : '#E8F5E9',
                              color: isOpen ? '#E65100' : '#2E7D32',
                              border: `1px solid ${isOpen ? '#FFCC80' : '#A5D6A7'}`,
                            }}>
                              {issue.status}
                            </span>
                            {isOpen && (
                              <button className="btn btn-sm btn-primary"
                                onClick={() => {
                                  if (isGrowthRun && issue.process_type === 'growth') {
                                    setShowGrowthReturn(true);
                                  } else {
                                    navigate(`/inventory/process-issues/${issue.id}/return`);
                                  }
                                }}>
                                <RotateCcw size={11} /> Return
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isActive && (
                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-primary"
                    onClick={() => setActiveModal('issue')}>
                    <Send size={13} /> Issue to Process
                  </button>
                </div>
              )}
            </>
          )}

          {/* ════ ATTACHMENTS TAB ════ */}
          {activeTab === 'attachments' && (
            <div style={{
              padding: '40px 24px', background: 'var(--g50)', border: '2px dashed var(--g300)',
              borderRadius: 10, textAlign: 'center', color: 'var(--g400)',
            }}>
              <Package size={28} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--g600)', marginBottom: 4 }}>
                Attachments & Documents
              </div>
              <div style={{ fontSize: 12 }}>
                Image upload, certificates, and QC reports will be available in a future phase.
              </div>
            </div>
          )}

        </div>

        {/* ════ GROWTH RUN RETURN MODAL ════ */}
        {showGrowthReturn && (
          <div className="modal-overlay" onClick={() => setShowGrowthReturn(false)}>
            <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#1565C0' }}>
                  <CheckCircle size={16} /> Growth Run Return
                </div>
                <button className="icon-btn" onClick={() => setShowGrowthReturn(false)}><X size={14} /></button>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 13, color: '#424242', marginBottom: 14 }}>
                  Lot: <strong>{displayCode}</strong>
                  <br /><span style={{ fontSize: 11, color: '#757575' }}>
                    Enter the measured Growth Run (biscuit) dimensions to complete the process.
                  </span>
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Weight (ct) <span style={{ color: '#C62828' }}>*</span></label>
                    <input type="number" step="0.0001" min="0" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 12 }}
                      value={meas.weight} onChange={setM('weight')} placeholder="e.g. 15.80" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Height (mm) <span style={{ color: '#C62828' }}>*</span></label>
                    <input type="number" step="0.001" min="0" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 12 }}
                      value={meas.height} onChange={setM('height')} placeholder="e.g. 2.10" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Length (mm)</label>
                    <input type="number" step="0.001" min="0" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 12 }}
                      value={meas.length} onChange={setM('length')} placeholder="optional" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Width (mm)</label>
                    <input type="number" step="0.001" min="0" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 12 }}
                      value={meas.width} onChange={setM('width')} placeholder="optional" />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 }}>Remarks</label>
                  <textarea rows={2} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 12, resize: 'vertical' }}
                    value={meas.remarks} onChange={setM('remarks')} placeholder="Optional notes..." />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setShowGrowthReturn(false)} disabled={submittingReturn}>Cancel</button>
                <button className="btn btn-primary" onClick={handleGrowthReturnSubmit} disabled={submittingReturn}>
                  {submittingReturn ? 'Saving...' : 'Save & Complete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════ POPUP MODALS ════ */}
        {activeModal && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)} style={{ zIndex: 1000 }}>
            <div className="modal" style={{ width: '90vw', height: '90vh', maxWidth: 1300, padding: 0, display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--brand-dark)' }}>
                  {activeModal === 'split' ? 'Split Lot' : activeModal === 'mix' ? 'Mix Lots' : activeModal === 'return' ? 'Return from Process' : 'Issue to Process'}
                </div>
                <button className="icon-btn" onClick={() => setActiveModal(null)}><X size={14} /></button>
              </div>
              <div className="modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                {activeModal === 'split' && <SplitLotPage lotId={id} isModal onComplete={() => { setActiveModal(null); loadCore(); }} onCancel={() => setActiveModal(null)} />}
                {activeModal === 'mix' && <MixLotsPage initialLotIds={id} isModal onComplete={() => { setActiveModal(null); loadCore(); }} onCancel={() => setActiveModal(null)} />}
                {activeModal === 'issue' && <LotIssuePage initialLotId={id} isModal onComplete={() => { setActiveModal(null); loadCore(); }} onCancel={() => setActiveModal(null)} />}
                {activeModal === 'return' && <LotReturnPage initialLotId={id} isModal onComplete={() => { setActiveModal(null); loadCore(); }} onCancel={() => setActiveModal(null)} />}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

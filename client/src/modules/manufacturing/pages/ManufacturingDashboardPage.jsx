import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ChevronRight, ChevronLeft, Clock, Cpu,
  Play, Pause, CheckCircle, Wrench, RefreshCw, Search, Filter,
  X, Plus, Zap, Timer, Package, TrendingUp, AlertCircle, Bell,
  Layers, User, Calendar, LayoutGrid, List, ArrowUp, ArrowDown, MoreVertical,
  RotateCcw,
} from 'lucide-react';

// A RETURN_BASED process posts its physical output through the Return Engine —
// never the legacy Control Tower completion modal. For these machines the
// completion action becomes "Record Return", which launches the existing Return
// workspace. OUTPUT_BASED processes retain the legacy Complete Process modal.
const isReturnBasedProcess = (machine, processMap) =>
  String(processMap?.get(machine?.process_type)?.completion_mode || '').toUpperCase() === 'RETURN_BASED';
import { useApi } from '../../../shared/hooks/useApi';
import { useManufacturingSync } from '../../../shared/hooks/useModuleSync';
import toast from 'react-hot-toast';

// ── Status config ─────────────────────────────────────────────────────────────
const MACHINE_STATUS_CFG = {
  running: { label: 'Running', color: '#2E7D32', bg: '#E8F5E9', border: '#81C784', glow: '0 0 0 2px #81C784' },
  idle: { label: 'AVAILABLE', color: '#757575', bg: '#F5F5F5', border: '#E0E0E0', glow: 'none' },
  hold: { label: 'Hold', color: '#E65100', bg: '#FFF3E0', border: '#FFCC80', glow: '0 0 0 2px #FFCC80' },
  maintenance: { label: 'Maintenance', color: '#E65100', bg: '#FFF8E1', border: '#FFD54F', glow: '0 0 0 2px #FFD54F' },
  breakdown: { label: 'Breakdown', color: '#C62828', bg: '#FFEBEE', border: '#EF9A9A', glow: '0 0 0 2px #EF9A9A' },
  completed: { label: 'Completed', color: '#1565C0', bg: '#E3F2FD', border: '#90CAF9', glow: 'none' },
  cleaning: { label: 'Cleaning', color: '#6A1B9A', bg: '#F3E5F5', border: '#CE93D8', glow: '0 0 0 2px #CE93D8' },
  awaiting_output: { label: 'Awaiting Output', color: '#7B1FA2', bg: '#F3E5F5', border: '#CE93D8', glow: '0 0 0 2px #BA68C8' },
};

// Process type colors come from process_master.category (loaded via API)
const CATEGORY_COLORS = {
  PRIMARY: { color: '#7B1FA2', bg: '#F3E5F5' },
  SUPPORT: { color: '#1565C0', bg: '#E3F2FD' },
  QC: { color: '#00695C', bg: '#E0F2F1' },
  OTHER: { color: '#616161', bg: '#F5F5F5' },
};

// ── KPI cards config ──────────────────────────────────────────────────────────
const KPI_DEFS = [
  { key: 'total', label: 'Total Machines', icon: Cpu, color: '#1565C0', bg: '#E3F2FD' },
  { key: 'running', label: 'Running', icon: Activity, color: '#2E7D32', bg: '#E8F5E9' },
  { key: 'awaiting_output', label: 'Awaiting Output', icon: Package, color: '#7B1FA2', bg: '#F3E5F5' },
  { key: 'idle', label: 'AVAILABLE', icon: Timer, color: '#757575', bg: '#F5F5F5' },
  { key: 'hold', label: 'On Hold', icon: Pause, color: '#E65100', bg: '#FFF3E0' },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench, color: '#F57F17', bg: '#FFF8E1' },
  { key: 'breakdown', label: 'Breakdown', icon: AlertTriangle, color: '#C62828', bg: '#FFEBEE' },
  { key: 'completed_today', label: 'Done Today', icon: CheckCircle, color: '#00695C', bg: '#E0F2F1' },
  { key: 'expected_yield', label: 'Expected Yield', icon: TrendingUp, color: '#4527A0', bg: '#EDE7F6', unit: 'ct' },
];

// ── Shared style tokens for grid table ───────────────────────────────────────
const TH = {
  padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.4px', color: '#616161',
  borderBottom: '2px solid #E0E0E0', whiteSpace: 'nowrap', background: '#F5F5F5',
};
const TD = {
  padding: '5px 10px', verticalAlign: 'middle', fontSize: 12, color: '#212121',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRuntime(hrs) {
  if (hrs == null || isNaN(hrs)) return '—';
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
}

function fmtETA(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  const now = new Date();
  const diff = d - now;
  if (diff < 0) return { text: 'Overdue', overdue: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return { text: `${h}h ${m}m`, overdue: false };
}

function ETACell({ dt, style }) {
  const eta = fmtETA(dt);
  if (!eta) return <span style={{ color: '#BDBDBD' }}>—</span>;
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: eta.overdue ? '#C62828' : '#424242', ...style }}>
      {eta.text}
    </span>
  );
}

function ProgressBar({ value, max, status }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  const cfg = MACHINE_STATUS_CFG[status] || MACHINE_STATUS_CFG.idle;
  const barColor = pct >= 100 ? '#C62828' : cfg.color;
  return (
    <div style={{ background: '#E0E0E0', borderRadius: 4, height: 5, overflow: 'hidden', marginTop: 4 }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: barColor, borderRadius: 4,
        transition: 'width .4s',
      }} />
    </div>
  );
}

function MiniBar({ value, max, status }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  const cfg = MACHINE_STATUS_CFG[status] || MACHINE_STATUS_CFG.idle;
  return (
    <div style={{ background: '#E0E0E0', borderRadius: 2, height: 3, marginTop: 3, width: 72, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: pct >= 100 ? '#C62828' : cfg.color,
      }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// KPI Card
// ══════════════════════════════════════════════════════════════════════════════
function KpiCard({ def, value }) {
  const Icon = def.icon;
  return (
    <div style={{
      background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8,
      padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
      borderLeft: `3px solid ${def.color}`, flex: '1 0 auto', minWidth: 140,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, background: def.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={16} color={def.color} />
      </div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 700, color: '#212121', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
          {value != null ? (typeof value === 'number' && def.unit ? `${value.toFixed(2)} ${def.unit}` : value) : '—'}
        </div>
        <div style={{ fontSize: 10, color: '#757575', marginTop: 2, whiteSpace: 'nowrap' }}>{def.label}</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Chamber Card  (density-improved)
// ══════════════════════════════════════════════════════════════════════════════
const MachineCard = memo(function MachineCard({ machine, onAction, onNavigate, processMap }) {
  const cfg = MACHINE_STATUS_CFG[machine.machine_status] || MACHINE_STATUS_CFG.idle;
  const hasProcess = !!machine.process_id;
  const [showMenu, setShowMenu] = useState(false);

  let dimStr = '—';
  if (machine.dim_length != null && machine.dim_width != null && machine.dim_height != null) {
    dimStr = `${parseFloat(machine.dim_length).toFixed(2)} × ${parseFloat(machine.dim_width).toFixed(2)} × ${parseFloat(machine.dim_height).toFixed(2)}`;
  }

  const operatorDisplay = machine.operator_name 
    ? `${machine.operator_name} (${machine.location_name || 'No Location'})` 
    : (machine.location_name || 'No Location');

  return (
    <div style={{
      background: '#fff', border: `1px solid ${cfg.color}`, borderRadius: 8,
      boxShadow: `0 4px 12px ${cfg.color}33`,
      display: 'flex', flexDirection: 'column', position: 'relative',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 12px 4px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {machine.name}
          </div>
          <div style={{ fontSize: 11, color: '#757575', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
            {machine.code}
          </div>
        </div>
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
          background: '#fff', color: cfg.color, border: `1px solid ${cfg.color}`,
        }}>
          {cfg.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: machine.growth_run_number ? '#1565C0' : '#424242' }}>
              {machine.growth_run_number || 'No active process'}
            </span>
            {machine.process_type && (
              <>
                <span style={{ color: '#BDBDBD' }}>•</span>
                <span style={{ color: '#424242' }}>{processMap?.get(machine.process_type)?.process_name || machine.process_type}</span>
              </>
            )}
            {machine.run_no && (
              <>
                <span style={{ color: '#BDBDBD' }}>•</span>
                <span style={{ color: '#424242' }}>R{machine.run_no}</span>
              </>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#616161', marginTop: 6, fontWeight: 500 }}>
            {operatorDisplay}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
          <StatCell label="Qty" value={machine.seeds_issued > 0 ? `${Number(machine.seeds_issued).toLocaleString()} pcs` : '—'} />
          <StatCell label="Dimension (mm)" value={dimStr} />
        </div>

        {hasProcess && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 8 }}>
              <StatCell label="Elapsed" value={fmtRuntime(machine.runtime_hours)} />
              <StatCell label="Target" value={machine.target_runtime_hours ? `${machine.target_runtime_hours}h 00m` : '—'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: '#EEEEEE', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: cfg.color, width: `${Math.min(100, Math.round(((machine.runtime_hours || 0) / machine.target_runtime_hours) * 100) || 0)}%`, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#212121', width: 32, textAlign: 'right' }}>
                {Math.min(100, Math.round(((machine.runtime_hours || 0) / machine.target_runtime_hours) * 100) || 0)}%
              </span>
            </div>
          </div>
        )}

        {hasProcess && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
            <StatCell label="Yield" value={machine.expected_rough_qty ? `${machine.expected_rough_qty}%` : '—'} />
            <StatCell label="ETA" value={fmtETA(machine.expected_completion_at)?.text || '—'} />
          </div>
        )}
        <LastCompletedRunDisplay machine={machine} />
      </div>

      {/* Actions (Icon Only) */}
      <div style={{ padding: '4px 12px 12px 12px', display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
        {machine.machine_status === 'awaiting_output' && machine.process_id && (
          <button
            onClick={() => onNavigate(`/inventory/process-issues?machine_process_id=${machine.process_id}`)}
            style={{
              background: '#fff', border: '1px solid #E0E0E0', color: '#1565C0', borderRadius: 4, padding: '4px 12px',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto'
            }}
          >
            <Package size={12} /> Details
          </button>
        )}
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            background: 'transparent', border: '1px solid #E0E0E0', cursor: 'pointer', padding: 4, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F5F5F5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <MoreVertical size={16} color="#757575" />
        </button>

        {showMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
            <div style={{
              position: 'absolute', right: 8, bottom: 36, background: '#fff',
              border: '1px solid #E0E0E0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              padding: 4, width: 220, zIndex: 11, display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#9E9E9E', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                Machine Actions
              </div>
              {machine.machine_status === 'idle' && (
                <ActionMenuItem icon={Play} label="Start" desc="Begin a new process." color="#2E7D32" onClick={() => { setShowMenu(false); onAction('start', machine); }} />
              )}
              {machine.returnable_issue_count > 0 && machine.process_id && (
                  <ActionMenuItem icon={Package} label="Returns" desc="Process returns from this machine." color="#7B1FA2" onClick={() => { setShowMenu(false); onNavigate(`/inventory/process-issues?machine_process_id=${machine.process_id}`); }} />
                )}
              {machine.process_status === 'running' && machine.machine_status !== 'awaiting_output' && (
                <>
                  <ActionMenuItem icon={Pause} label="Put On Hold" desc="Pause the current process temporarily." color="#E65100" onClick={() => { setShowMenu(false); onAction('hold', machine); }} />
                  {isReturnBasedProcess(machine, processMap) ? (
                    <ActionMenuItem icon={RotateCcw} label="Record Return" desc="Record the physical output through Process Return." color="#7B1FA2" onClick={() => { setShowMenu(false); onAction('record_return', machine); }} />
                  ) : (
                    <ActionMenuItem icon={CheckCircle} label="Complete Process" desc="Finish the current run and continue." color="#1565C0" onClick={() => { setShowMenu(false); onAction('complete', machine); }} />
                  )}
                </>
              )}
              {machine.process_status === 'hold' && (
                <>
                  <ActionMenuItem icon={Play} label="Resume" desc="Resume the paused process." color="#2E7D32" onClick={() => { setShowMenu(false); onAction('resume', machine); }} />
                  {isReturnBasedProcess(machine, processMap) ? (
                    <ActionMenuItem icon={RotateCcw} label="Record Return" desc="Record the physical output through Process Return." color="#7B1FA2" onClick={() => { setShowMenu(false); onAction('record_return', machine); }} />
                  ) : (
                    <ActionMenuItem icon={CheckCircle} label="Complete Process" desc="Finish the current run and continue." color="#1565C0" onClick={() => { setShowMenu(false); onAction('complete', machine); }} />
                  )}
                </>
              )}
              {['idle', 'running', 'hold'].includes(machine.machine_status) && (
                <ActionMenuItem icon={Wrench} label="Maintenance" desc="Move this machine to maintenance mode." color="#F57F17" onClick={() => { setShowMenu(false); onAction('maintenance', machine); }} />
              )}
              {machine.machine_status !== 'breakdown' && (
                <ActionMenuItem icon={AlertTriangle} label="Report Breakdown" desc="Stop the machine and record a breakdown." color="#C62828" onClick={() => { setShowMenu(false); onAction('breakdown', machine); }} />
              )}
              {['maintenance', 'breakdown', 'cleaning'].includes(machine.machine_status) && (
                <ActionMenuItem icon={CheckCircle} label="Set Idle" desc="Mark machine as ready for production." color="#757575" onClick={() => { setShowMenu(false); onAction('idle', machine); }} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}); // end MachineCard memo

function LastCompletedRunDisplay({ machine }) {
  const status = machine.machine_status || 'idle';
  if (status !== 'idle') return null;
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E0E0E0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9E9E9E', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>
        Last Completed Run
      </div>
      {machine.last_completed_run ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#424242' }}>
            {machine.last_completed_run.growth_number || '—'} <span style={{ color: '#BDBDBD' }}>·</span> R{machine.last_completed_run.run_number || '?'}
          </div>
          <div style={{ fontSize: 10, color: '#757575', marginTop: 2 }}>
            Completed {new Date(machine.last_completed_run.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#9E9E9E', fontStyle: 'italic' }}>
          No previous run
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div>
      <div style={{ color: '#757575', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: '#212121', fontSize: 11 }}>{value}</div>
    </div>
  );
}

function ActionMenuItem({ icon: Icon, label, desc, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
        background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F5F5F5'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={14} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#212121', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 10, color: '#757575' }}>{desc}</div>
      </div>
    </button>
  );
}

function ActionBtn({ icon: Icon, label, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '3px 7px', borderRadius: 5, fontSize: 9, fontWeight: 600,
        border: `1px solid ${color}22`, background: `${color}11`, color,
        cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background = `${color}11`; }}
    >
      <Icon size={9} />{label}
    </button>
  );
}

// ── Grid row action button (slightly more compact label) ──────────────────────
function GActionBtn({ icon: Icon, label, color, onClick }) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
        border: `1px solid ${color}33`, background: `${color}11`, color,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background = `${color}11`; }}
    >
      <Icon size={9} />{label}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Grid View
// ══════════════════════════════════════════════════════════════════════════════
function GridView({ machines, sortConfig, onSort, onAction, onNavigate, processMap }) {
  const cols = [
    { key: 'code', label: 'Machine', w: 130 },
    { key: 'machine_status', label: 'Status', w: 104 },
    { key: 'operator_name', label: 'Operator / Location', w: 140 },
    { key: 'process_type', label: 'Type', w: 90 },
    { key: 'growth_run_number', label: 'Growth No.', w: 130 },
    { key: 'run_no', label: 'RUN', w: 70 },
    { key: 'seeds_issued', label: 'Qty (pcs)', w: 75 },
    { key: 'dim_length', label: 'Length', w: 60 },
    { key: 'dim_width', label: 'Width', w: 60 },
    { key: 'dim_height', label: 'Height', w: 60 },
    { key: 'runtime_hours', label: 'Elapsed', w: 80 },
    { key: 'target_runtime_hours', label: 'Target', w: 75 },
    { key: '_pct', label: 'Progress', w: 80 },
    { key: 'expected_rough_qty', label: 'Yield', w: 70 },
    { key: '_alerts', label: 'Alerts', w: 64 },
    { key: null, label: 'Actions', w: 240 },
  ];

  return (<>
    <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <tr>
            <th style={{ ...TH, width: 36, textAlign: 'center' }}>#</th>
            {cols.map(c => (
              <SortTh key={c.label} col={c.key} label={c.label} w={c.w} sortConfig={sortConfig} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {machines.map((m, idx) => (
            <GridRow key={m.id} machine={m} idx={idx} onAction={onAction} onNavigate={onNavigate} processMap={processMap} />
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function SortTh({ col, label, w, sortConfig, onSort }) {
  const active = sortConfig.col === col && col !== null && !col.startsWith('_');
  return (
    <th
      onClick={() => col && !col.startsWith('_') && onSort(col)}
      style={{
        ...TH, width: w, minWidth: w,
        cursor: col && !col.startsWith('_') ? 'pointer' : 'default',
        userSelect: 'none',
        background: active ? '#E8EAF6' : '#F5F5F5',
        color: active ? '#3949AB' : '#616161',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {active
          ? (sortConfig.dir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)
          : col && !col.startsWith('_')
            ? <span style={{ color: '#BDBDBD', fontSize: 9 }}>↕</span>
            : null
        }
      </span>
    </th>
  );
}

const GridRow = memo(function GridRow({ machine: m, idx, onAction, onNavigate, processMap }) {
  const cfg = MACHINE_STATUS_CFG[m.machine_status] || MACHINE_STATUS_CFG.idle;
  const runtimePct = m.target_runtime_hours && m.runtime_hours != null
    ? Math.min(100, Math.round((m.runtime_hours / m.target_runtime_hours) * 100))
    : null;
  const eta = fmtETA(m.expected_completion_at);
  const hasProcess = !!m.process_id;

  // Inline alert flags derived from row data
  const alertBreakdown = m.machine_status === 'breakdown';
  const alertOverdue = eta?.overdue && m.process_status === 'running';
  const alertLongHold = m.process_status === 'hold';
  const alertMaint = m.machine_status === 'maintenance';
  const anyAlert = alertBreakdown || alertOverdue || alertLongHold || alertMaint;

  return (
    <tr
      style={{ borderBottom: '1px solid #F0F0F0', background: '#fff' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F8F9FE'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
    >
      {/* # */}
      <td style={{ ...TD, textAlign: 'center', color: '#BDBDBD', fontSize: 11, width: 36 }}>{idx + 1}</td>

      {/* Machine */}
      <td style={{ ...TD, width: 130 }}>
        <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12 }}>{m.name}</div>
        <div style={{ fontSize: 10, color: '#9E9E9E', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.code}
        </div>
        <LastCompletedRunDisplay machine={m} />
      </td>

      {/* Status */}
      <td style={{ ...TD, width: 104 }}>
        <span style={{
          display: 'inline-block', padding: '2px 7px', borderRadius: 10,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
          whiteSpace: 'nowrap',
        }}>
          {cfg.label}
        </span>
      </td>

      {/* Operator */}
      <td style={{ ...TD, width: 140, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {m.operator_name ? `${m.operator_name} (${m.location_name || 'No Location'})` : (m.location_name || <span style={{ color: '#BDBDBD' }}>—</span>)}
      </td>

      {/* Process Type */}
      <td style={{ ...TD, width: 90 }}>
        {m.process_type ? (() => {
          const proc = processMap?.get(m.process_type);
          const clr = CATEGORY_COLORS[proc?.category] || CATEGORY_COLORS.PRIMARY;
          return (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', background: clr.bg, color: clr.color, borderRadius: 8 }}>
              {proc?.process_name || m.process_type}
            </span>
          );
        })() : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Growth No. */}
      <td style={{ ...TD, width: 130 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: m.growth_run_number ? '#1565C0' : '#424242' }}>
          {m.growth_run_number || <span style={{ color: '#BDBDBD' }}>—</span>}
        </span>
      </td>

      {/* Run No */}
      <td style={{ ...TD, width: 70 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#424242' }}>
          {m.run_no ? `R${m.run_no}` : <span style={{ color: '#BDBDBD' }}>—</span>}
        </span>
      </td>



      {/* Qty (pcs) */}
      <td style={{ ...TD, width: 75, fontFamily: 'var(--mono)', textAlign: 'right', paddingRight: 12 }}>
        {hasProcess && m.seeds_issued > 0
          ? <span style={{ color: '#424242' }}>{m.seeds_issued}</span>
          : <span style={{ color: '#BDBDBD' }}>—</span>
        }
      </td>

      {/* Length */}
      <td style={{ ...TD, width: 60, fontFamily: 'var(--mono)', textAlign: 'right', paddingRight: 12 }}>
        {m.dim_length != null ? parseFloat(m.dim_length).toFixed(2) : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Width */}
      <td style={{ ...TD, width: 60, fontFamily: 'var(--mono)', textAlign: 'right', paddingRight: 12 }}>
        {m.dim_width != null ? parseFloat(m.dim_width).toFixed(2) : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Height */}
      <td style={{ ...TD, width: 60, fontFamily: 'var(--mono)', textAlign: 'right', paddingRight: 12 }}>
        {m.dim_height != null ? parseFloat(m.dim_height).toFixed(2) : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Elapsed */}
      <td style={{ ...TD, width: 80 }}>
        {hasProcess ? (
          <>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 11 }}>
              {fmtRuntime(m.runtime_hours)}
            </div>
          </>
        ) : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Target */}
      <td style={{ ...TD, width: 75, fontFamily: 'var(--mono)', color: '#757575', textAlign: 'right', paddingRight: 12 }}>
        {m.target_runtime_hours ? `${m.target_runtime_hours}h` : <span style={{ color: '#BDBDBD' }}>—</span>}
      </td>

      {/* Progress % */}
      <td style={{ ...TD, width: 80, fontFamily: 'var(--mono)', textAlign: 'right', paddingRight: 14 }}>
        {runtimePct != null
          ? <span style={{ color: runtimePct >= 100 ? '#C62828' : runtimePct >= 80 ? '#E65100' : '#2E7D32', fontWeight: 600 }}>
            {runtimePct}%
          </span>
          : <span style={{ color: '#BDBDBD' }}>—</span>
        }
      </td>

      {/* Expected Yield */}
      <td style={{ ...TD, width: 70, fontFamily: 'var(--mono)', color: '#4527A0', textAlign: 'right', paddingRight: 12 }}>
        {m.expected_rough_qty
          ? `${parseFloat(m.expected_rough_qty).toFixed(2)}`
          : <span style={{ color: '#BDBDBD' }}>—</span>
        }
      </td>

      {/* Alerts */}
      <td style={{ ...TD, width: 64 }}>
        {anyAlert ? (
          <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {alertBreakdown && <AlertTriangle size={12} color="#C62828" title="Breakdown" />}
            {alertOverdue && <Clock size={12} color="#E65100" title="Overdue" />}
            {alertLongHold && <Pause size={12} color="#F57F17" title="On Hold" />}
            {alertMaint && <Wrench size={12} color="#F57F17" title="Maintenance" />}
          </span>
        ) : (
          <CheckCircle size={12} color="#A5D6A7" title="OK" />
        )}
      </td>

      {/* Actions */}
      <td style={{ ...TD, width: 240, padding: '4px 8px' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', alignItems: 'center' }}>
          {m.machine_status === 'idle' && (
            <GActionBtn icon={Play} label="Start" color="#2E7D32" onClick={() => onAction('start', m)} />
          )}
          {m.returnable_issue_count > 0 && m.process_id && (
            <GActionBtn icon={Package} label="Returns" color="#7B1FA2"
              onClick={() => onNavigate(`/inventory/process-issues?machine_process_id=${m.process_id}`)} />
          )}
          {m.process_status === 'running' && m.machine_status !== 'awaiting_output' && (
            <>
              <GActionBtn icon={Pause} label="Hold" color="#E65100" onClick={() => onAction('hold', m)} />
              {isReturnBasedProcess(m, processMap) ? (
                <GActionBtn icon={RotateCcw} label="Record Return" color="#7B1FA2" onClick={() => onAction('record_return', m)} />
              ) : (
                <GActionBtn icon={CheckCircle} label="Complete" color="#1565C0" onClick={() => onAction('complete', m)} />
              )}
            </>
          )}
          {m.process_status === 'hold' && (
            <>
              <GActionBtn icon={Play} label="Resume" color="#2E7D32" onClick={() => onAction('resume', m)} />
              {isReturnBasedProcess(m, processMap) ? (
                <GActionBtn icon={RotateCcw} label="Record Return" color="#7B1FA2" onClick={() => onAction('record_return', m)} />
              ) : (
                <GActionBtn icon={CheckCircle} label="Complete" color="#1565C0" onClick={() => onAction('complete', m)} />
              )}
            </>
          )}
          {['idle', 'running', 'hold'].includes(m.machine_status) && (
            <GActionBtn icon={Wrench} label="Maint." color="#F57F17" onClick={() => onAction('maintenance', m)} />
          )}
          {m.machine_status !== 'breakdown' && (
            <GActionBtn icon={AlertTriangle} label="Breakdown" color="#C62828" onClick={() => onAction('breakdown', m)} />
          )}
          {['maintenance', 'breakdown', 'cleaning'].includes(m.machine_status) && (
            <GActionBtn icon={CheckCircle} label="Set Idle" color="#757575" onClick={() => onAction('idle', m)} />
          )}
        </div>
      </td>
    </tr>
  );
}); // end GridRow memo

// ══════════════════════════════════════════════════════════════════════════════
// Alert Rail
// ══════════════════════════════════════════════════════════════════════════════
function AlertRail({ alerts, onClose, onClearAll, onSelectAlert }) {
  const sections = [
    { key: 'awaiting_output', label: 'Awaiting Output', icon: Package, color: '#7B1FA2' },
    { key: 'breakdown', label: 'Breakdown', icon: AlertTriangle, color: '#C62828' },
    { key: 'overdue', label: 'Overdue Runtime', icon: Clock, color: '#E65100' },
    { key: 'hold', label: 'On Hold', icon: Pause, color: '#F57F17' },
    { key: 'maintenance_due', label: 'Maintenance Due', icon: Wrench, color: '#7B1FA2' },
    { key: 'yield_risk', label: 'Yield Risk', icon: TrendingUp, color: '#C62828' },
  ];

  const total = sections.reduce((acc, s) => acc + (alerts?.[s.key]?.length || 0), 0);

  return (
    <div style={{
      width: 272, flexShrink: 0, background: '#FAFAFA',
      borderLeft: '1px solid #E0E0E0', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid #E0E0E0', background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12, color: '#212121' }}>
          <Bell size={13} color="#E65100" />
          Alerts
          {total > 0 && (
            <span style={{
              background: '#C62828', color: '#fff', borderRadius: 10,
              fontSize: 9, fontWeight: 700, padding: '1px 5px',
            }}>{total}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {total > 0 && (
            <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: 10 }} onClick={onClearAll}>Clear All</button>
          )}
          <button className="icon-btn" onClick={onClose} style={{ width: 22, height: 22 }}>
            <X size={12} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {sections.map(s => {
          const items = alerts?.[s.key] || [];
          if (!items.length) return null;
          const Icon = s.icon;
          return (
            <div key={s.key} style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.5px', color: s.color, marginBottom: 6,
              }}>
                <Icon size={10} /> {s.label} ({items.length})
              </div>
              {items.map((item, i) => (
                <div key={i} style={{
                  background: '#fff', border: `1px solid ${s.color}33`,
                  borderLeft: `3px solid ${s.color}`, borderRadius: 6,
                  padding: '6px 8px', marginBottom: 4, fontSize: 11,
                  cursor: 'pointer', transition: 'background 0.1s'
                }}
                  onClick={() => onSelectAlert(s, item)}
                  onMouseEnter={e => e.currentTarget.style.background = '#F5F5F5'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <div style={{ fontWeight: 600, color: '#212121' }}>{item.code} — {item.name}</div>
                  {item.process_number && (
                    <div style={{ color: '#757575', fontSize: 10 }}>{item.process_number}</div>
                  )}
                  {item.runtime_hours != null && item.target_runtime_hours != null && (
                    <div style={{ color: s.color, fontSize: 10, fontFamily: 'var(--mono)' }}>
                      {fmtRuntime(item.runtime_hours)} / {item.target_runtime_hours}h
                    </div>
                  )}
                  {item.paused_at && (
                    <div style={{ color: '#9E9E9E', fontSize: 10 }}>
                      Held: {new Date(item.paused_at).toLocaleTimeString()}
                    </div>
                  )}
                  {item.next_service && (
                    <div style={{ color: s.color, fontSize: 10 }}>
                      Service: {new Date(item.next_service).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {total === 0 && (
          <div style={{ textAlign: 'center', color: '#9E9E9E', fontSize: 12, padding: 24 }}>
            <CheckCircle size={28} color="#A5D6A7" style={{ display: 'block', margin: '0 auto 8px' }} />
            All clear — no alerts
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Start Process Modal
// ══════════════════════════════════════════════════════════════════════════════
function StartProcessModal({ machines, operators, seedLots, processes, onSubmit, onClose, preselectedMachine }) {
  const [form, setForm] = useState({
    machine_id: preselectedMachine?.id || '',
    operator_id: '',
    process_type: processes[0]?.process_code || 'growth',
    target_runtime_hours: '',
    expected_rough_qty: '',
    expected_height: '',
    remarks: '',
  });
  const [lots, setLots] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Show all machines; mark non-idle ones so user understands the risk
  const allMachines = useMemo(() => machines, [machines]);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const addLot = () => setLots(l => [...l, { inventory_lot_id: '', issued_qty: '', issued_weight: '' }]);
  const removeLot = i => setLots(l => l.filter((_, idx) => idx !== i));
  const setLot = (i, k, v) => setLots(l => l.map((row, idx) => idx === i ? { ...row, [k]: v } : row));

  const handleSubmit = async () => {
    if (!form.machine_id) { toast.error('Select a machine'); return; }
    if (!form.process_type) { toast.error('Select a process type'); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        machine_id: parseInt(form.machine_id),
        operator_id: form.operator_id ? parseInt(form.operator_id) : null,
        target_runtime_hours: form.target_runtime_hours ? parseFloat(form.target_runtime_hours) : null,
        expected_rough_qty: form.expected_rough_qty ? parseFloat(form.expected_rough_qty) : null,
        expected_height: form.expected_height ? parseFloat(form.expected_height) : null,
        lots: lots
          .filter(l => l.inventory_lot_id)
          .map(l => ({
            inventory_lot_id: parseInt(l.inventory_lot_id),
            issued_qty: parseFloat(l.issued_qty) || 0,
            issued_weight: parseFloat(l.issued_weight) || 0,
          })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inp = {
    width: '100%', padding: '6px 8px',
    borderRadius: 6, fontSize: 12, background: '#fff',
  };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
            <Play size={16} color="#2E7D32" /> Start New Process
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 120px)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Machine *</label>
              <SelectDropdown style={inp} value={form.machine_id} onChange={set('machine_id')}>
                <option value="">— select machine —</option>
                {allMachines.filter(m => m.machine_status === 'idle').length > 0 && (
                  <optgroup label="Idle (ready)">
                    {allMachines.filter(m => m.machine_status === 'idle').map(m =>
                      <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                    )}
                  </optgroup>
                )}
                {allMachines.filter(m => m.machine_status !== 'idle').length > 0 && (
                  <optgroup label="Other (has active process)">
                    {allMachines.filter(m => m.machine_status !== 'idle').map(m =>
                      <option key={m.id} value={m.id}>{m.code} — {m.name} [{m.machine_status}]</option>
                    )}
                  </optgroup>
                )}
              </SelectDropdown>
            </div>
            <div>
              <label style={lbl}>Operator</label>
              <SelectDropdown style={inp} value={form.operator_id} onChange={set('operator_id')}>
                <option value="">— unassigned —</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </SelectDropdown>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Process Type *</label>
              <SelectDropdown style={inp} value={form.process_type} onChange={set('process_type')}>
                <option value="">— select —</option>
                {processes.map(p => (
                  <option key={p.process_code} value={p.process_code}>{p.process_name}</option>
                ))}
              </SelectDropdown>
            </div>
            <div>
              <label style={lbl}>Target Runtime (hours)</label>
              <input type="number" min="0" step="0.5" style={inp}
                value={form.target_runtime_hours} onChange={set('target_runtime_hours')} placeholder="e.g. 24" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Expected Rough Qty (ct)</label>
              <input type="number" min="0" step="0.001" style={inp}
                value={form.expected_rough_qty} onChange={set('expected_rough_qty')} placeholder="0.000" />
            </div>
            <div>
              <label style={lbl}>Expected Height (mm)</label>
              <input type="number" min="0" step="0.01" style={inp}
                value={form.expected_height} onChange={set('expected_height')} placeholder="0.00" />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={lbl}>Seed Lots</label>
              <button className="btn btn-sm" onClick={addLot} style={{ fontSize: 10 }}>
                <Plus size={10} /> Add Lot
              </button>
            </div>
            {lots.map((lot, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <SelectDropdown style={{ ...inp, fontSize: 11 }}
                  value={lot.inventory_lot_id} onChange={e => setLot(i, 'inventory_lot_id', e.target.value)}>
                  <option value="">— lot —</option>
                  {seedLots.map(sl => <option key={sl.id} value={sl.id}>{sl.lot_number} ({sl.qty} pcs)</option>)}
                </SelectDropdown>
                <input type="number" min="0" style={{ ...inp, fontSize: 11 }}
                  value={lot.issued_qty} onChange={e => setLot(i, 'issued_qty', e.target.value)} placeholder="qty" />
                <input type="number" min="0" style={{ ...inp, fontSize: 11 }}
                  value={lot.issued_weight} onChange={e => setLot(i, 'issued_weight', e.target.value)} placeholder="wt (ct)" />
                <button className="icon-btn" onClick={() => removeLot(i)} style={{ width: 26, height: 26 }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div>
            <label style={lbl}>Remarks</label>
            <textarea rows={2} style={{ ...inp, resize: 'vertical' }}
              value={form.remarks} onChange={set('remarks')} placeholder="Optional notes..." />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Starting…' : 'Start Process'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Confirm Action Modal
// ══════════════════════════════════════════════════════════════════════════════
function ConfirmActionModal({ action, machine, isGrowth, onConfirm, onClose }) {
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Growth Run Return measurements (only used when completing a growth process)
  const [meas, setMeas] = useState({ weight: '', length: '', width: '', height: '' });
  const setM = k => e => setMeas(m => ({ ...m, [k]: e.target.value }));

  // A GROWTH process completes through the Growth Run Return dialog.
  const isGrowthReturn = action === 'complete' && isGrowth;

  const cfg = {
    hold: { label: 'Hold Process', color: '#E65100', icon: Pause },
    resume: { label: 'Resume Process', color: '#2E7D32', icon: Play },
    complete: { label: 'Complete Process', color: '#1565C0', icon: CheckCircle },
    maintenance: { label: 'Send to Maintenance', color: '#F57F17', icon: Wrench },
    breakdown: { label: 'Mark as Breakdown', color: '#C62828', icon: AlertTriangle },
    idle: { label: 'Reset to Idle', color: '#757575', icon: CheckCircle },
  }[action] || { label: action, color: '#333', icon: Activity };

  const Icon = cfg.icon;
  const title = isGrowthReturn ? 'Growth Run Return' : cfg.label;

  const w = meas.weight === '' ? null : parseFloat(meas.weight);
  const h = meas.height === '' ? null : parseFloat(meas.height);
  
  const weightInvalid = isGrowthReturn && (w === null || w <= 0);
  const heightInvalid = isGrowthReturn && (h === null || h <= 0);
  const growthValid = !isGrowthReturn || (!weightInvalid && !heightInvalid);

  const fieldStyle = {
    width: '100%', padding: '6px 8px', border: '1px solid #E0E0E0',
    borderRadius: 6, fontSize: 12,
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: '#616161', display: 'block', marginBottom: 4 };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const extra = isGrowthReturn ? {
        weight: meas.weight,
        length: meas.length,
        width:  meas.width,
        height: meas.height,
      } : {};
      await onConfirm(action, machine, remarks, extra);
    } catch {
      // onConfirm has its own catch; this is a safety net
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: isGrowthReturn ? 460 : 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: cfg.color }}>
            <Icon size={16} /> {title}
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: '#424242', marginBottom: 14 }}>
            Machine: <strong>{machine.code} — {machine.name}</strong>
            {machine.process_number && (
              <><br /><span style={{ fontSize: 11, color: '#757575' }}>Process: {machine.process_number}</span></>
            )}
            {isGrowthReturn && (
              <><br /><span style={{ fontSize: 11, color: '#757575' }}>
                Enter the measured Growth Run (biscuit) dimensions to release the machine.
              </span></>
            )}
          </p>

          {isGrowthReturn && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Weight (ct) <span style={{ color: '#C62828' }}>*</span></label>
                <input type="number" step="0.0001" min="0" 
                  style={{...fieldStyle, borderColor: (meas.weight !== '' && weightInvalid) ? '#C62828' : '#E0E0E0'}}
                  value={meas.weight} onChange={setM('weight')} placeholder="e.g. 15.80" />
                {meas.weight !== '' && weightInvalid && <div style={{color: '#C62828', fontSize: 10, marginTop: 4}}>Weight must be {'>'} 0</div>}
              </div>
              <div>
                <label style={labelStyle}>Height (mm) <span style={{ color: '#C62828' }}>*</span></label>
                <input type="number" step="0.001" min="0" 
                  style={{...fieldStyle, borderColor: (meas.height !== '' && heightInvalid) ? '#C62828' : '#E0E0E0'}}
                  value={meas.height} onChange={setM('height')} placeholder="e.g. 2.10" />
                {meas.height !== '' && heightInvalid && <div style={{color: '#C62828', fontSize: 10, marginTop: 4}}>Height must be {'>'} 0</div>}
              </div>
              <div>
                <label style={labelStyle}>Length (mm)</label>
                <input type="number" step="0.001" min="0" style={fieldStyle}
                  value={meas.length} onChange={setM('length')} placeholder="optional" />
              </div>
              <div>
                <label style={labelStyle}>Width (mm)</label>
                <input type="number" step="0.001" min="0" style={fieldStyle}
                  value={meas.width} onChange={setM('width')} placeholder="optional" />
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>Remarks</label>
            <textarea rows={2} style={{ ...fieldStyle, resize: 'vertical' }}
              value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional notes..." />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: cfg.color, borderColor: cfg.color }}
            onClick={handleConfirm}
            disabled={submitting || !growthValid}
          >
            {submitting ? 'Processing…' : (isGrowthReturn ? 'Save & Release' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Dashboard
// ══════════════════════════════════════════════════════════════════════════════
export default function ManufacturingDashboard() {
  const api = useApi();
  const navigate = useNavigate();

  // ── Shared data state ────────────────────────────────────────────────────────
  const [machines, setMachines] = useState([]);
  const [kpi, setKpi] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [operators, setOperators] = useState([]);
  const [seedLots, setSeedLots] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try {
      const stored = localStorage.getItem('mfg_dismissed_alerts');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem('mfg_dismissed_alerts', JSON.stringify([...dismissedAlerts]));
  }, [dismissedAlerts]);
  const [selectedAlert, setSelectedAlert] = useState(null);

  const visibleAlerts = useMemo(() => {
    if (!alerts) return null;
    const res = {};
    for (const [k, arr] of Object.entries(alerts)) {
      res[k] = arr.filter(item => !dismissedAlerts.has(`${k}-${item.process_id || item.id}`));
    }
    return res;
  }, [alerts, dismissedAlerts]);

  const alertCount = useMemo(() => {
    if (!visibleAlerts) return 0;
    return [
      visibleAlerts.awaiting_output?.length, visibleAlerts.breakdown?.length,
      visibleAlerts.overdue?.length, visibleAlerts.hold?.length,
      visibleAlerts.maintenance_due?.length, visibleAlerts.yield_risk?.length,
    ].reduce((a, b) => (a || 0) + (b || 0), 0);
  }, [visibleAlerts]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [showAlerts, setShowAlerts] = useState(false);
  const [startModal, setStartModal] = useState(false);
  const [preselected, setPreselected] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // ── Client-side sort (grid view) ─────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState({ col: null, dir: 'asc' });
  const toggleSort = useCallback((col) => {
    setSortConfig(prev =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' }
    );
  }, []);

  // ── View mode: persisted to localStorage ──
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('mfg_view_mode') || 'chamber'
  );
  const switchView = useCallback((mode) => {
    setViewMode(mode);
    localStorage.setItem('mfg_view_mode', mode);
  }, []);

  // ── Shared filters ───────────────────────────────────────────────────────────
  const [filters, setFilters] = usePersistedFilters('mfg_dashboard_filters', {
    dept: '', status: '', operator: '', process_type: '', overdue: '', search: '',
    length_min: '', length_max: '', height_min: '', height_max: '',
  });
  const setFilter = k => v => setFilters(f => ({ ...f, [k]: v }));

  // ── Sorted display list — shared by BOTH views ───────────────────────────────
  const sortedMachines = useMemo(() => {
    if (!sortConfig.col) return machines;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    return [...machines].sort((a, b) => {
      let av = a[sortConfig.col];
      let bv = b[sortConfig.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [machines, sortConfig]);

  // Map of process_code → process_master row — used by cards/rows for badge color/name
  const processMap = useMemo(
    () => new Map(processes.map(p => [p.process_code, p])),
    [processes]
  );

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 500 });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

      const [machineRes, kpiRes, alertRes] = await Promise.all([
        api.get(`/api/manufacturing/machines?${params}`),
        api.get('/api/manufacturing/kpi'),
        api.get('/api/manufacturing/alerts'),
      ]);

      setMachines([...new Map((machineRes.data || []).map(m => [m.id, m])).values()]);
      setKpi(kpiRes);
      setAlerts(alertRes);
    } catch {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [filters]);


  // Load lookup data once (operators, seed lots, departments, process master)
  // Each call is independent — one failure does not blank the others.
  useEffect(() => {
    (async () => {
      try {
        const arr = (await api.get('/api/manufacturing/lookup/operators') || []);
        setOperators([...new Map(arr.map(x => [x.id, x])).values()]);
      } catch { }
      try { setSeedLots(await api.get('/api/manufacturing/lookup/seed-lots') || []); } catch { }
      try {
        const d = await api.get('/api/departments?limit=100');
        setDepartments([...new Map((d?.data || []).map(x => [x.id, x])).values()]);
      } catch { }
      try {
        const r = await api.get('/api/process-master?active=true');
        const arr = Array.isArray(r) ? r : (r.data || []);
        setProcesses([...new Map(arr.map(x => [x.process_code, x])).values()]);
      } catch { }
    })();
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useManufacturingSync(() => {
    loadAll();
  });

  // ── Action handlers ──────────────────────────────────────────────────────────
  const handleStartProcess = async (formData) => {
    try {
      await api.post('/api/manufacturing/processes', formData);
      toast.success('Process started');
      setStartModal(false);
      setPreselected(null);
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleNavigate = useCallback((path) => navigate(path), [navigate]);

  const handleAction = useCallback((actionType, machine) => {
    if (actionType === 'start') {
      setPreselected(machine);
      setStartModal(true);
    } else if (actionType === 'record_return') {
      // RETURN_BASED completion is owned by the Return Engine. Deep-link to the
      // exact returnable Process Issue when there is exactly one; otherwise open
      // the Process Return queue scoped to this machine_process so the operator
      // picks. The Return workspace re-resolves and re-validates server-side.
      if (machine.returnable_issue_count === 1 && machine.returnable_issue_id) {
        navigate(`/inventory/process-issues/${machine.returnable_issue_id}/return`);
      } else {
        navigate(`/inventory/process-issues?machine_process_id=${machine.process_id}`);
      }
    } else {
      setConfirmModal({ action: actionType, machine });
    }
  }, [navigate]);

  const handleConfirmAction = async (action, machine, remarks, extra = {}) => {
    try {
      if (action === 'hold') {
        await api.patch(`/api/manufacturing/processes/${machine.process_id}/hold`, { remarks });
      } else if (action === 'resume') {
        await api.patch(`/api/manufacturing/processes/${machine.process_id}/resume`, { remarks });
      } else if (action === 'complete') {
        // Growth processes pass biscuit measurements (weight/length/width/height)
        // via `extra` (Growth Run Return). Non-growth send only remarks.
        await api.patch(`/api/manufacturing/processes/${machine.process_id}/complete`, { remarks, ...extra });
      } else if (action === 'maintenance') {
        await api.patch(`/api/manufacturing/machines/${machine.id}/status`, { new_status: 'maintenance', remarks });
      } else if (action === 'breakdown') {
        await api.patch(`/api/manufacturing/machines/${machine.id}/status`, { new_status: 'breakdown', remarks });
      } else if (action === 'idle') {
        await api.patch(`/api/manufacturing/machines/${machine.id}/status`, { new_status: 'idle', remarks });
      }
      toast.success('Updated successfully');
      setConfirmModal(null);
      loadAll();
    } catch (err) {
      toast.error(err?.message || 'Action failed — please try again');
    }
  };

  const clearFilters = useCallback(() => {
    setFilters({ dept: '', status: '', operator: '', process_type: '', overdue: '', search: '', length_min: '', length_max: '', height_min: '', height_max: '' });
  }, []);
  const [searchFocused, setSearchFocused] = useState(false);

  const activeFilters = Object.values(filters).some(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F5F5F5' }} className="animate-in">

      {/* ── Topbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
        background: '#fff', borderBottom: '1px solid #E0E0E0', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
            background: '#E8F5E9', color: '#2E7D32', padding: '1px 6px', borderRadius: 8,
          }}>LIVE</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>

          {/* View toggle */}
          <div style={{
            display: 'flex', border: '1px solid #E0E0E0', borderRadius: 6,
            overflow: 'hidden', flexShrink: 0,
          }}>
            {[
              { mode: 'chamber', Icon: LayoutGrid, label: 'Chamber' },
              { mode: 'grid', Icon: List, label: 'Grid' },
            ].map(({ mode, Icon, label }, i) => (
              <button
                key={mode}
                onClick={() => switchView(mode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 11px', fontSize: 11, fontWeight: 600,
                  background: viewMode === mode ? 'var(--brand, #2E7D32)' : '#fff',
                  color: viewMode === mode ? '#fff' : '#616161',
                  border: 'none',
                  borderLeft: i > 0 ? '1px solid #E0E0E0' : 'none',
                  cursor: 'pointer',
                  transition: 'background .15s, color .15s',
                }}
              >
                <Icon size={11} />{label}
              </button>
            ))}
          </div>

          <button
            className="btn btn-sm"
            style={{ position: 'relative' }}
            onClick={() => setShowAlerts(v => !v)}
          >
            <Bell size={12} /> Alerts
            {alertCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, background: '#C62828',
                color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700,
                padding: '0 4px', minWidth: 14, textAlign: 'center',
              }}>{alertCount}</span>
            )}
          </button>

          <button className="btn btn-sm btn-primary" onClick={() => { setPreselected(null); setStartModal(true); }}>
            <Plus size={12} /> Start Process
          </button>
          <button className="icon-btn" onClick={loadAll} title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="hide-scroll" style={{
        display: 'flex', gap: 8, padding: '8px 16px',
        overflowX: 'auto', flexWrap: 'nowrap',
        background: '#F5F5F5', borderBottom: '1px solid #E0E0E0', flexShrink: 0,
      }}>
        {KPI_DEFS.map(def => <KpiCard key={def.key} def={def} value={kpi?.[def.key]} />)}
      </div>

      {/* ── Filter bar ── */}
      <div className="page-section page-actions-bar no-print" style={{ background: '#fff', border: 'none', padding: '0 0 16px 0', display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            border: '1px solid var(--g300)', borderRadius: 'var(--radius)',
            height: 32, padding: '0 10px', background: '#fff',
            transition: 'border-color .1s',
            ...(searchFocused ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 2px rgba(13,124,95,.1)' } : {}),
          }}>
            <Search size={12} color="#9E9E9E" />
            <input
              style={{ border: 'none', outline: 'none', boxShadow: 'none', fontSize: 12, width: '100%', height: '100%', background: 'transparent', padding: 0, margin: 0 }}
              placeholder="Search machine, lot, growth no..."
              value={filters.search}
              onChange={e => setFilter('search')(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>
        </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Department</label>
            <SelectDropdown style={{ width: 140, height: 32 }} value={filters.dept} onChange={e => setFilter('dept')(e.target.value)}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectDropdown>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Status</label>
            <SelectDropdown style={{ width: 140, height: 32 }} value={filters.status} onChange={e => setFilter('status')(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(MACHINE_STATUS_CFG).map(([s, cfg]) => (
                <option key={s} value={s}>{cfg.label}</option>
              ))}
            </SelectDropdown>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Operator / Location</label>
            <SelectDropdown style={{ width: 160, height: 32 }} value={filters.operator} onChange={e => setFilter('operator')(e.target.value)}>
              <option value="">All Operators / Locations</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </SelectDropdown>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Process Type</label>
            <SelectDropdown style={{ width: 140, height: 32 }} value={filters.process_type} onChange={e => setFilter('process_type')(e.target.value)}>
              <option value="">All Processes</option>
              {processes.map(p => (
                <option key={p.process_code} value={p.process_code}>{p.process_name}</option>
              ))}
            </SelectDropdown>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Length (mm)</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="number" placeholder="Min" style={{ width: 60, height: 32, padding: '4px 8px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 11 }} value={filters.length_min} onChange={e => setFilter('length_min')(e.target.value)} />
              <span style={{ color: '#9E9E9E' }}>-</span>
              <input type="number" placeholder="Max" style={{ width: 60, height: 32, padding: '4px 8px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 11 }} value={filters.length_max} onChange={e => setFilter('length_max')(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#616161', textTransform: 'none' }}>Height (mm)</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="number" placeholder="Min" style={{ width: 60, height: 32, padding: '4px 8px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 11 }} value={filters.height_min} onChange={e => setFilter('height_min')(e.target.value)} />
              <span style={{ color: '#9E9E9E' }}>-</span>
              <input type="number" placeholder="Max" style={{ width: 60, height: 32, padding: '4px 8px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 11 }} value={filters.height_max} onChange={e => setFilter('height_max')(e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', paddingBottom: 8, whiteSpace: 'nowrap' }}>
            <input type="checkbox"
              checked={filters.overdue === 'true'}
              onChange={e => setFilter('overdue')(e.target.checked ? 'true' : '')}
            />
            Overdue Only
          </label>

        {activeFilters && (
          <button className="btn" style={{ background: 'var(--g100)', color: 'var(--g700)' }} onClick={clearFilters}>
            <X size={14} /> Clear
          </button>
        )}

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: '#9E9E9E', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {sortedMachines.length} machine{sortedMachines.length !== 1 ? 's' : ''}
          {sortConfig.col && (
            <span style={{ marginLeft: 6, color: '#9E9E9E' }}>
              · sorted by {sortConfig.col} {sortConfig.dir}
            </span>
          )}
        </span>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Chamber View */}
        {viewMode === 'chamber' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {loading ? (
              <div className="empty-state" style={{ padding: 80 }}><div className="spinner" /></div>
            ) : sortedMachines.length === 0 ? (
              <div className="empty-state" style={{ padding: 80 }}>
                <Cpu size={36} style={{ opacity: .25 }} />
                <p style={{ marginTop: 12, color: '#9E9E9E', fontSize: 13 }}>No machines found</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 10,
              }}>
                {sortedMachines.map(m => (
                  <MachineCard key={m.id} machine={m} onAction={handleAction} onNavigate={handleNavigate} processMap={processMap} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Process Overview (Grid / List View) */}
        {viewMode === 'grid' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div className="empty-state" style={{ padding: 80 }}><div className="spinner" /></div>
            ) : sortedMachines.length === 0 ? (
              <div className="empty-state" style={{ padding: 80 }}>
                <Cpu size={36} style={{ opacity: .25 }} />
                <p style={{ marginTop: 12, color: '#9E9E9E', fontSize: 13 }}>No machines found</p>
              </div>
            ) : (
              <GridView
                machines={sortedMachines}
                sortConfig={sortConfig}
                onSort={toggleSort}
                onAction={handleAction}
                onNavigate={handleNavigate}
                processMap={processMap}
              />
            )}
          </div>
        )}

        {/* Alert Rail */}
        {showAlerts && (
          <AlertRail
            alerts={visibleAlerts}
            onClose={() => setShowAlerts(false)}
            onSelectAlert={(section, item) => setSelectedAlert({ section, item })}
            onClearAll={() => {
              setDismissedAlerts(prev => {
                const next = new Set(prev);
                Object.entries(visibleAlerts || {}).forEach(([k, arr]) => {
                  arr.forEach(item => next.add(`${k}-${item.process_id || item.id}`));
                });
                return next;
              });
            }}
          />
        )}
      </div>

      {selectedAlert && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: '#fff', width: 400, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
            <div style={{
              background: selectedAlert.section.color, color: '#fff', padding: '12px 16px',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8
            }}>
              <selectedAlert.section.icon size={16} />
              {selectedAlert.section.label}
            </div>
            <div style={{ padding: 16 }}>
              <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#424242' }}>
                <strong>Machine:</strong> {selectedAlert.item.code} — {selectedAlert.item.name}
              </p>
              {selectedAlert.item.process_number && (
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#424242' }}>
                  <strong>Process:</strong> {selectedAlert.item.process_number}
                </p>
              )}
              {selectedAlert.item.runtime_hours != null && (
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#424242' }}>
                  <strong>Runtime:</strong> {fmtRuntime(selectedAlert.item.runtime_hours)}
                  {selectedAlert.item.target_runtime_hours ? ` / ${selectedAlert.item.target_runtime_hours}h` : ''}
                </p>
              )}
              {selectedAlert.item.paused_at && (
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#424242' }}>
                  <strong>Paused At:</strong> {new Date(selectedAlert.item.paused_at).toLocaleString()}
                </p>
              )}
              <p style={{ margin: '0 0 16px 0', fontSize: 12, color: '#757575', lineHeight: 1.4 }}>
                Please review the machine or process details to resolve this alert.
                You can clear this notification once you have acknowledged it.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn" onClick={() => setSelectedAlert(null)}>Close</button>
                <button className="btn" style={{ background: '#F5F5F5', border: '1px solid #E0E0E0', color: '#616161' }} onClick={() => {
                  setDismissedAlerts(prev => new Set(prev).add(`${selectedAlert.section.key}-${selectedAlert.item.process_id || selectedAlert.item.id}`));
                  setSelectedAlert(null);
                }}>
                  Dismiss
                </button>
                {selectedAlert.section.key === 'maintenance_due' && (
                  <button className="btn btn-primary" style={{ background: '#F57F17', borderColor: '#F57F17' }} onClick={() => { handleAction('maintenance', selectedAlert.item); setSelectedAlert(null); }}>
                    Start Maintenance
                  </button>
                )}
                {selectedAlert.section.key === 'overdue' && (
                  isReturnBasedProcess(selectedAlert.item, processMap) ? (
                    <button className="btn btn-primary" style={{ background: '#7B1FA2', borderColor: '#7B1FA2' }} onClick={() => { handleAction('record_return', selectedAlert.item); setSelectedAlert(null); }}>
                      Record Return
                    </button>
                  ) : (
                    <button className="btn btn-primary" style={{ background: '#1565C0', borderColor: '#1565C0' }} onClick={() => { handleAction('complete', selectedAlert.item); setSelectedAlert(null); }}>
                      Complete Process
                    </button>
                  )
                )}
                {selectedAlert.section.key === 'hold' && (
                  <button className="btn btn-primary" style={{ background: '#2E7D32', borderColor: '#2E7D32' }} onClick={() => { handleAction('resume', selectedAlert.item); setSelectedAlert(null); }}>
                    Resume Process
                  </button>
                )}
                {selectedAlert.section.key === 'breakdown' && (
                  <button className="btn btn-primary" style={{ background: '#757575', borderColor: '#757575' }} onClick={() => { handleAction('idle', selectedAlert.item); setSelectedAlert(null); }}>
                    Mark Fixed (Set Idle)
                  </button>
                )}
                {selectedAlert.section.key === 'yield_risk' && (
                  <button className="btn btn-primary" style={{ background: '#E65100', borderColor: '#E65100' }} onClick={() => { handleAction('hold', selectedAlert.item); setSelectedAlert(null); }}>
                    Hold Process
                  </button>
                )}
                {selectedAlert.section.key === 'awaiting_output' && (
                  <button className="btn btn-primary" style={{ background: '#7B1FA2', borderColor: '#7B1FA2' }} onClick={() => { handleNavigate(`/inventory/process-issues?machine_process_id=${selectedAlert.item.process_id}`); setSelectedAlert(null); }}>
                    Enter Output
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {startModal && (
        <StartProcessModal
          machines={machines}
          operators={operators}
          seedLots={seedLots}
          processes={processes}
          preselectedMachine={preselected}
          onSubmit={handleStartProcess}
          onClose={() => { setStartModal(false); setPreselected(null); }}
        />
      )}
      {confirmModal && (
        <ConfirmActionModal
          action={confirmModal.action}
          machine={confirmModal.machine}
          isGrowth={String(processMap?.get(confirmModal.machine?.process_type)?.process_group
            || (confirmModal.machine?.process_type === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase() === 'GROWTH'}
          onConfirm={handleConfirmAction}
          onClose={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}


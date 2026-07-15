import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import {
  ArrowLeft, RotateCcw, AlertCircle, Plus, Trash2, Info,
  CheckCircle2, Clock, Cpu, User, Package,
} from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';

// ── Return type catalogue (Fallback) ──────────────────────────────────────────
const FALLBACK_TYPES = [
  { type: 'usable',   label: 'Usable',    suffix: 'R', status: 'IN STOCK' },
  { type: 'damaged',  label: 'Damaged',   suffix: 'D', status: 'DAMAGED' },
  { type: 'consumed', label: 'Consumed',  suffix: 'C', status: 'CONSUMED' },
];

const STYLE_PALETTES = [
  { color: '#2E7D32', bg: '#E8F5E9', border: '#A5D6A7' },
  { color: '#C62828', bg: '#FFEBEE', border: '#EF9A9A' },
  { color: '#757575', bg: '#F5F5F5', border: '#E0E0E0' },
  { color: '#1565C0', bg: '#E3F2FD', border: '#90CAF9' },
  { color: '#E65100', bg: '#FFF3E0', border: '#FFCC80' },
  { color: '#6A1B9A', bg: '#F3E5F5', border: '#CE93D8' },
];

function newLine(n, defaultType) {
  return { _id: n, type: defaultType, qty: '', weight: '', length: '', width: '', height: '', remarks: '', item_id: '' };
}

// Return identities are NEVER predicted client-side. The backend preflight
// (POST /api/lot-process-issues/:id/return/validate — the same buildReturnPlan
// the posting transaction recomputes under lock) is the only identity source.
const PREFLIGHT_DEBOUNCE_MS = 400;

// ── Panel: left info card ─────────────────────────────────────────────────────
function InfoRow({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9.5, color: 'var(--g500)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g900)',
        fontFamily: mono ? 'var(--mono)' : undefined }}>
        {value || '—'}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div style={{ padding: '12px 14px', background: '#fff', border: '1px solid var(--g200)',
      borderRadius: 8, marginBottom: 10 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.6px', color: 'var(--g500)', marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 5 }}>
        {Icon && <Icon size={10} />}{title}
      </div>
      {children}
    </div>
  );
}

// ── Balance pill ──────────────────────────────────────────────────────────────
function BalanceRow({ label, value, unit, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0', borderBottom: '1px solid var(--g100)' }}>
      <span style={{ fontSize: 11, color: color || 'var(--g600)', fontWeight: bold ? 700 : 400 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: bold ? 800 : 600,
        color: color || 'var(--g800)' }}>
        {typeof value === 'number' ? value.toFixed(4) : value}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// Two entry modes share this single page:
//   route mode — /inventory/process-issues/:id/return (issue id from the URL)
//   modal mode — <LotReturnPage initialLotId isModal onComplete onCancel />
//                the issue is resolved from the lot's OPEN process issues by
//                stable id (raw status=OPEN so PARTIAL returns stay eligible)
export default function LotReturnPage({ initialLotId, isModal = false, onComplete, onCancel }) {
  const navigate    = useNavigate();
  const api         = useApi();
  const { id: routeId } = useParams();
  const lineIdRef   = useRef(2);

  const [issueId,    setIssueId]    = useState(routeId || null);
  const [resolveMsg, setResolveMsg] = useState(null); // diagnostic when no issue can be resolved
  const [candidates, setCandidates] = useState([]);   // >1 OPEN issues on the lot → picker
  const [issue,      setIssue]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [lines,      setLines]      = useState([]);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);

  // Authoritative backend Return Plan (preflight). planSeqRef guards against
  // stale out-of-order responses; the plan is invalidated synchronously on
  // every line change so an outdated identity can never enable submission.
  const [plan,        setPlan]        = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const planSeqRef = useRef(0);

  // Dynamic config
  const returnTypes = React.useMemo(() => {
    const arr = (issue?.allowed_outputs?.length ? issue.allowed_outputs : FALLBACK_TYPES);
    return arr.map((t, i) => ({
      ...t,
      value: t.type, // UI expects `value`
      ...STYLE_PALETTES[i % STYLE_PALETTES.length]
    }));
  }, [issue]);

  const typeMap = React.useMemo(() => {
    return Object.fromEntries(returnTypes.map(t => [t.value, t]));
  }, [returnTypes]);

  // Set initial line when returnTypes becomes available
  useEffect(() => {
    if (returnTypes.length > 0 && lines.length === 0) {
      setLines([newLine(1, returnTypes[0].value)]);
    }
  }, [returnTypes, lines]);

  // Resolve the issue id in modal mode: the lot's OPEN process issues, by stable id.
  useEffect(() => {
    if (routeId) return;                    // route mode — id already known
    if (!initialLotId) {
      setResolveMsg('No lot or issue specified.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Raw status=OPEN (not display_status) so PARTIAL returns stay eligible.
    api.get(`/api/lot-process-issues?lot_id=${initialLotId}&status=OPEN`)
      .then(res => {
        if (cancelled) return;
        const rows = Array.isArray(res) ? res : (res.data || []);
        if (rows.length === 0) {
          if (isModal && onCancel) {
            toast.error('No active process issue for this lot.');
            onCancel();
            return;
          }
          setResolveMsg('No active process issue for this lot.');
          setLoading(false);
        } else if (rows.length === 1) {
          setIssueId(rows[0].id);
        } else {
          setCandidates(rows);
          setLoading(false);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setResolveMsg(err.message || 'Failed to look up process issues for this lot.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [routeId, initialLotId]);

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/api/lot-process-issues/${issueId}`)
      .then(data => {
        if (cancelled) return;
        setIssue(data);
      })
      .catch(() => { if (!cancelled) setIssue(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issueId]);

  // ── Exit helpers — modal mode must never navigate the underlying page ───────
  const exitBack   = () => { if (isModal) { onCancel?.(); } else { navigate(-1); } };
  const exitToList = () => { if (isModal) { onCancel?.(); } else { navigate('/inventory/process-issues'); } };

  // ── Line management ─────────────────────────────────────────────────────────
  const addLine = () => {
    const _id = lineIdRef.current++;
    setLines(ls => [...ls, newLine(_id, returnTypes[0]?.value || 'usable')]);
  };

  const removeLine = _id => setLines(ls => ls.filter(l => l._id !== _id));

  const updateLine = (_id, field, val) =>
    setLines(ls => ls.map(l => l._id === _id ? { ...l, [field]: val } : l));

  const fillBalance = () => {
    const issuedQty       = issue ? parseFloat(issue.issued_qty) : 0;
    const currentRemaining = issue && issue.remaining_in_process != null
      ? parseFloat(issue.remaining_in_process) : issuedQty;
    const soFar = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const gap   = Math.max(0, currentRemaining - soFar);
    if (gap < 0.0001) return;
    const _id = lineIdRef.current++;
    const defType = returnTypes.find(t => t.type === 'consumed')?.value || returnTypes[returnTypes.length - 1]?.value || 'usable';
    setLines(ls => [...ls, { _id, type: defType, qty: gap.toFixed(4), weight: '', length: '', width: '', height: '', remarks: '', item_id: '' }]);
  };

  // ── Derived balance ─────────────────────────────────────────────────────────
  const issuedQty       = issue ? parseFloat(issue.issued_qty) : 0;
  const currentRemaining = issue && issue.remaining_in_process != null
    ? parseFloat(issue.remaining_in_process) : issuedQty;

  // COMPONENT mode mirrors the backend gate (lotProcessIssues POST /:id/return):
  // outputs are DIFFERENT components in DIFFERENT units (e.g. Growth Diamond CT +
  // Recovered Seed PCS), so per-component totals are validated separately and are
  // NEVER summed together. The input is fully consumed; weight is the only
  // conserved quantity (outputs may weigh less = process loss, never more).
  const isComponentMode = returnTypes.some(t => t.component);

  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
  const anyQty     = lines.some(l => (parseFloat(l.qty) || 0) > 0.0001);

  const componentTotals = {};
  if (isComponentMode) {
    for (const l of lines) {
      const comp = typeMap[l.type]?.component || 'primary';
      componentTotals[comp] = (componentTotals[comp] || 0) + (parseFloat(l.qty) || 0);
    }
  }
  const compOver = Object.values(componentTotals).some(q => q > currentRemaining + 0.0001);

  // Phase A: every component group declared in config must EQUAL the input on
  // its own (N Partial Growth Runs contain exactly N seeds AND N diamonds).
  const requiredComponents = isComponentMode
    ? [...new Set(returnTypes.filter(t => t.component).map(t => t.component))]
    : [];
  const compEqual = requiredComponents.every(
    c => Math.abs((componentTotals[c] || 0) - currentRemaining) <= 0.0001
  );

  // Phase C (Seed Remove): per-family output weight totals + process loss.
  // Explicit operator weight is MANDATORY on every qty>0 line — the backend
  // plan rejects otherwise, which keeps Record Return disabled.
  const familyWeights = {};
  let missingWeightCount = 0;
  if (isComponentMode) {
    for (const l of lines) {
      const comp = typeMap[l.type]?.component || 'other';
      const w = parseFloat(l.weight) || 0;
      familyWeights[comp] = (familyWeights[comp] || 0) + w;
      if ((parseFloat(l.qty) || 0) > 0 && !(parseFloat(l.weight) > 0)) missingWeightCount++;
    }
  }

  const inputWeight  = parseFloat(issue?.process_lot_weight || 0);
  const outputWeight = lines.reduce((s, l) => s + (parseFloat(l.weight) || 0), 0);
  const weightOver   = isComponentMode && inputWeight > 0 && outputWeight > inputWeight + 0.0001;

  const stillIn    = isComponentMode ? 0 : Math.max(0, currentRemaining - linesTotal);
  const difference = currentRemaining - linesTotal;

  // Phase 1 Engine: Strict Balance Requirement (QUANTITY mode);
  // COMPONENT mode: each group equals the input, weight conserved.
  const balanced   = isComponentMode
    ? (anyQty && compEqual && !weightOver)
    : (Math.abs(difference) <= 0.0001 && linesTotal > 0.0001);
  const overFill   = isComponentMode ? compOver : difference < -0.0001;

  // Totals per type for balance panel
  const totByType = {};
  for (const t of returnTypes) totByType[t.value] = 0;
  for (const l of lines) totByType[l.type] = (totByType[l.type] || 0) + (parseFloat(l.qty) || 0);

  const processLotCode = issue?.process_lot_code || issue?.process_lot_number || '';

  // Dimension string: prefer the Growth Run biscuit's L × D × H, fall back to
  // the process lot's own dimensions.
  const fmtDims = (l, d, h, u) => {
    if (l == null && d == null && h == null) return null;
    const f = v => v != null ? Number(v).toFixed(2) : '—';
    return `${f(l)} × ${f(d)} × ${f(h)} ${u || 'mm'}`;
  };
  const dimensionStr =
    fmtDims(issue?.growth_dim_length, issue?.growth_dim_depth, issue?.growth_dim_height, issue?.growth_dim_unit) ||
    fmtDims(issue?.process_lot_dim_length, issue?.process_lot_dim_depth, issue?.process_lot_dim_height, issue?.process_lot_dim_unit);

  // ── Shared payload — preflight and submit post the SAME body ────────────────
  const buildReturnPayload = () => {
    // Consolidate measurements from lines — first non-empty value per field wins.
    // Blank fields are omitted so the backend never overwrites existing values with null.
    const mFields = ['weight', 'length', 'width', 'height'];
    const measObj = {};
    for (const l of lines.filter(ln => parseFloat(ln.qty) > 0)) {
      for (const k of mFields) {
        if (!measObj[k] && l[k] !== '' && l[k] != null) measObj[k] = l[k];
      }
    }
    const hasMeas = mFields.some(k => measObj[k]);

    return {
      return_date: returnDate,
      notes:       notes || undefined,
      lines: lines
        .filter(l => parseFloat(l.qty) > 0)
        .map(l => ({
          type: l.type,
          qty: parseFloat(l.qty),
          // Per-line weight feeds the COMPONENT-mode mass-balance gate;
          // QUANTITY mode ignores it server-side.
          weight: l.weight !== '' && l.weight != null ? parseFloat(l.weight) : undefined,
          remarks: l.remarks || undefined,
          item_id: l.item_id ? parseInt(l.item_id) : undefined
        })),
      remaining_in_process: isComponentMode ? 0 : parseFloat(stillIn.toFixed(4)),
      ...(hasMeas ? { measurements: measObj } : {}),
    };
  };

  // ── Authoritative preflight ─────────────────────────────────────────────────
  // Debounced on every line change (type, qty, weight, rows). The sequence
  // counter drops stale/out-of-order responses; the plan is cleared
  // IMMEDIATELY so an outdated identity is never displayed and Record Return
  // stays disabled until the backend approves the current lines.
  useEffect(() => {
    if (!issueId || !issue) return;
    const seq = ++planSeqRef.current;
    setPlan(null);
    const hasActiveLine = lines.some(l => parseFloat(l.qty) > 0);
    if (!hasActiveLine) { setPlanLoading(false); return; }
    setPlanLoading(true);
    const t = setTimeout(() => {
      api.post(`/api/lot-process-issues/${issueId}/return/validate`, buildReturnPayload())
        .then(res => {
          if (seq !== planSeqRef.current) return; // stale response — discard
          setPlan(res);
          setPlanLoading(false);
        })
        .catch(err => {
          if (seq !== planSeqRef.current) return;
          setPlan({ valid: false, route: 'REJECT', error: err.message || 'Validation failed' });
          setPlanLoading(false);
        });
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [issueId, issue, lines]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!balanced || overFill || saving) return;
    // The backend plan must approve the CURRENT lines; the posting endpoint
    // re-validates everything under lock regardless of this client gate.
    if (planLoading || !plan || !plan.valid) return;
    setSaving(true);
    try {
      const res = await api.post(`/api/lot-process-issues/${issueId}/return`, buildReturnPayload());
      const isFinal = res.is_final;
      toast.success(
        isFinal
          ? `Return ${res.return_number} recorded — issue closed`
          : `Partial return ${res.return_number} recorded — ${res.remaining_after.toFixed(4)} still in process`
      );
      if (isModal) { onComplete?.(); } else { navigate('/inventory/process-issues'); }
    } catch (err) {
      toast.error(err.message || 'Failed to record return');
    } finally { setSaving(false); }
  };

  // ── States ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-in" style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'center', height: '100%' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (resolveMsg) {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <AlertCircle size={32} />
        <p>{resolveMsg}</p>
        <button className="btn btn-sm" onClick={exitToList}>← Back</button>
      </div>
    );
  }
  // Multiple OPEN issues on this lot — never auto-pick; the operator chooses.
  if (!issueId && candidates.length > 1) {
    return (
      <div className="animate-in" style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <RotateCcw size={16} style={{ color: 'var(--brand)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--g900)' }}>
            Select Process Issue
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 14 }}>
          This lot has {candidates.length} open process issues. Choose the one to return against.
        </p>
        {candidates.map(c => (
          <button
            key={c.id}
            onClick={() => setIssueId(c.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              textAlign: 'left', padding: '10px 14px', marginBottom: 8, cursor: 'pointer',
              background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--g900)' }}>
              {c.issue_number}
            </span>
            <span style={{ fontSize: 12, color: 'var(--g600)', flex: 1 }}>
              {c.item_name} · {c.process_display_name || c.process_type || '—'}
              {c.machine_name ? ` · ${c.machine_name}` : ''}
            </span>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--g500)' }}>
              {Number(c.remaining_qty ?? c.issued_qty).toFixed(4)} remaining
            </span>
          </button>
        ))}
        <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={exitBack}>Cancel</button>
      </div>
    );
  }
  if (!issue) {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <AlertCircle size={32} />
        <p>Issue not found.</p>
        <button className="btn btn-sm" onClick={exitToList}>← Back</button>
      </div>
    );
  }
  if (issue.status !== 'OPEN') {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <AlertCircle size={32} />
        <p>Issue {issue.issue_number} is {issue.status.toLowerCase()} — no further returns allowed.</p>
        <button className="btn btn-sm" onClick={exitToList}>← Back</button>
      </div>
    );
  }

  const unit = issue.unit || '';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ padding: '10px 16px', background: 'var(--g50)',
        borderBottom: '1px solid var(--g200)', display: 'flex', alignItems: 'center',
        gap: 10, flexShrink: 0 }}>
        <button className="icon-btn" onClick={exitBack}><ArrowLeft size={15} /></button>
        <RotateCcw size={16} style={{ color: 'var(--brand)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--g900)' }}>Return from Process</div>
          <div style={{ fontSize: 11, color: 'var(--g500)' }}>
            {issue.issue_number} &nbsp;·&nbsp; {issue.item_name} &nbsp;·&nbsp;
            {issue.process_lot_code || issue.process_lot_number || '—'}
          </div>
        </div>
        {issue.machine_name && (
          <div style={{ fontSize: 11, color: 'var(--g500)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Cpu size={12} />{issue.machine_name}
          </div>
        )}
      </div>

      {/* Three-panel body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT PANEL: Issue context ─────────────────────────────────────── */}
        <div style={{ width: 260, borderRight: '1px solid var(--g200)',
          overflow: 'auto', padding: 14, background: 'var(--g50)', flexShrink: 0 }}>

          <Section title="Issue" icon={Package}>
            <InfoRow label="Issue #"      value={issue.issue_number} mono />
            <InfoRow label="Issue Date"   value={new Date(issue.issue_date).toLocaleDateString('en-IN')} />
            {/* Phase A: the operator returns the Growth Assembly, not the seed */}
            <InfoRow label="Process Item" value={issue.growth_item_name || issue.item_name} />
            <InfoRow label="Source Item"  value={issue.item_name} />
            {/* Source Lot stays available in genealogy/History/admin views —
                hidden here to keep the operator card compact. */}
            {(issue.root_lot_code || issue.root_lot_number) && (
              <InfoRow label="Root Seed Lot" value={issue.root_lot_code || issue.root_lot_number} mono />
            )}
            {issue.growth_number && <InfoRow label="Growth Number" value={issue.growth_number} mono />}
            {issue.growth_number && issue.run_no != null && (
              <InfoRow label="Run Number" value={`R${issue.run_no}`} mono />
            )}
            {dimensionStr && <InfoRow label="Dimension" value={dimensionStr} mono />}
            <InfoRow label="Process Lot"  value={processLotCode} mono />
            {/* Human-readable Process Master name from the existing relation —
                the technical code (e.g. pr-01) lives only in the tooltip. */}
            <div title={issue.process_type ? `Code: ${issue.process_type}` : undefined}>
              <InfoRow label="Process Name"
                value={issue.process_display_name || issue.process_type} />
            </div>
          </Section>

          <Section title="Quantity Balance" icon={Info}>
            <InfoRow label="Issued Qty"
              value={`${issuedQty.toFixed(4)} ${unit}`} mono />

            {isComponentMode ? (
              /* COMPONENT mode: per-component totals — components are validated
                 separately against the input and are NEVER summed together. */
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--g200)' }}>
                {requiredComponents.map(comp => {
                  const qty = componentTotals[comp] || 0;
                  const ok  = Math.abs(qty - currentRemaining) <= 0.0001;
                  return (
                    <BalanceRow
                      key={comp}
                      label={comp.charAt(0).toUpperCase() + comp.slice(1)}
                      value={`${qty.toFixed(4)} / ${currentRemaining.toFixed(4)}`}
                      color={ok ? '#2E7D32' : '#C62828'}
                      bold
                    />
                  );
                })}
                {/* Phase C: family weight totals, assembly input and loss.
                    biscuit.weight IS the full assembly (seed embedded), so the
                    equation is growth-out + seed-out + loss = input. */}
                {requiredComponents.map(comp => (
                  <BalanceRow
                    key={`w-${comp}`}
                    label={`${comp.charAt(0).toUpperCase() + comp.slice(1)} weight out`}
                    value={(familyWeights[comp] || 0).toFixed(4)}
                    unit="ct"
                  />
                ))}
                {inputWeight > 0 && (
                  <>
                    <BalanceRow
                      label="Input assembly weight"
                      value={inputWeight.toFixed(4)}
                      unit="ct"
                      bold
                    />
                    <BalanceRow
                      label="Process loss"
                      value={(inputWeight - outputWeight).toFixed(4)}
                      unit="ct"
                      color={inputWeight - outputWeight < -0.0001 ? '#C62828' : 'var(--g600)'}
                    />
                    <BalanceRow
                      label="Weight out / in"
                      value={`${outputWeight.toFixed(4)} / ${inputWeight.toFixed(4)}`}
                      unit="ct"
                      color={weightOver ? '#C62828' : '#2E7D32'}
                      bold
                    />
                  </>
                )}
                {missingWeightCount > 0 && (
                  <div style={{ fontSize: 10, color: '#C62828', fontWeight: 600, marginTop: 4 }}>
                    Weight is required for every line with quantity ({missingWeightCount} missing).
                  </div>
                )}
                <div style={{ fontSize: 10, color: weightOver || !compEqual ? '#C62828' : 'var(--g500)',
                  fontWeight: 600, marginTop: 4 }}>
                  {weightOver
                    ? 'Output weight cannot exceed input weight — a component split cannot create mass.'
                    : !compEqual
                      ? 'Each group must equal the input quantity on its own — groups are never summed.'
                      : 'Each group fully accounts for the input. Groups are never summed. Input is fully consumed.'}
                </div>
              </div>
            ) : (
              <>
                <InfoRow label="Returned Qty"
                  value={`${linesTotal.toFixed(4)} ${unit}`} mono />

                {/* The server decides partial vs final from this balance —
                    the operator never forces finality manually. */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--g200)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: balanced ? '#2E7D32' : 'var(--g600)' }}>
                      Remaining Qty
                    </span>
                    <span style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 800, color: balanced ? '#2E7D32' : 'var(--g800)' }}>
                      {stillIn.toFixed(4)} {unit}
                    </span>
                  </div>
                  {overFill && (
                    <div style={{ fontSize: 10, color: '#C62828', fontWeight: 600, marginTop: 4 }}>
                      You cannot return more than what was issued.
                    </div>
                  )}
                </div>
              </>
            )}
          </Section>

          {issue.machine_name && (
            <Section title="Machine" icon={Cpu}>
              <InfoRow label="Machine" value={issue.machine_name} />
              {/* Runtime from AUTHORITATIVE machine_process timestamps only —
                  never Target Runtime, never fabricated. Machine Code and
                  Target Runtime remain internal/planning metadata. */}
              {(() => {
                const start = issue.process_started_at;
                if (!start) return <InfoRow label="Runtime" value="Runtime unavailable" />;
                const done = issue.process_completed_at;
                const ms = (done ? new Date(done) : new Date()) - new Date(start);
                if (!(ms >= 0)) return <InfoRow label="Runtime" value="Runtime unavailable" />;
                const h = Math.floor(ms / 3600000);
                const m = Math.floor((ms % 3600000) / 60000);
                return (
                  <InfoRow label={done ? 'Actual Runtime' : 'Elapsed Runtime'}
                    value={`${h}h ${m}m`} mono />
                );
              })()}
            </Section>
          )}

          {Array.isArray(issue.returns) && issue.returns.length > 0 && (
            <Section title="Prior Returns" icon={RotateCcw}>
              {issue.returns.map(r => (
                <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--g100)',
                  fontSize: 11 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--g700)' }}>
                    {r.return_number}
                  </div>
                  <div style={{ color: 'var(--g500)', marginTop: 2 }}>
                    {r.is_final ? 'Final' : `Partial — ${Number(r.remaining_after).toFixed(4)} left`}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>

        {/* ── CENTER PANEL: Return rows + submit ───────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, minWidth: 0 }}>

          {/* Current Inventory Measurements — read-only snapshot before this return */}
          {(issue.process_lot_weight != null || issue.process_lot_dim_length != null ||
            issue.process_lot_dim_depth != null || issue.process_lot_dim_height != null) && (
            <div style={{ background: '#F8F9FF', border: '1px solid #C5CAE9', borderRadius: 8,
              marginBottom: 14, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.5px', color: '#3949AB', marginBottom: 8 }}>
                Current Inventory Measurements
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {[
                  { label: 'Qty',    value: issue.process_lot_qty    != null ? `${Number(issue.process_lot_qty).toFixed(4)} ${issue.unit || ''}`.trim() : null },
                  { label: 'Weight', value: issue.process_lot_weight != null ? `${Number(issue.process_lot_weight).toFixed(4)} ct` : null },
                  { label: 'Length', value: issue.process_lot_dim_length != null ? `${Number(issue.process_lot_dim_length).toFixed(3)} ${issue.process_lot_dim_unit || 'mm'}` : null },
                  { label: 'Width',  value: issue.process_lot_dim_depth  != null ? `${Number(issue.process_lot_dim_depth).toFixed(3)}  ${issue.process_lot_dim_unit || 'mm'}` : null },
                  { label: 'Height', value: issue.process_lot_dim_height != null ? `${Number(issue.process_lot_dim_height).toFixed(3)} ${issue.process_lot_dim_unit || 'mm'}` : null },
                ].filter(f => f.value != null).map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9.5, color: '#5C6BC0', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1A237E',
                      fontFamily: 'var(--mono)' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Return lines table — single output family (all normal processes;
              multiple dispositions like Usable/Damaged stay ONE family). The
              detached dual-family layout below is Seed Remove COMPONENT mode
              only, keyed on the SERVER process configuration — never on how
              many rows a user adds. */}
          {!isComponentMode && (
          <div style={{ background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
            marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--g200)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.5px', color: 'var(--g600)' }}>
                Return Lines
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {!isComponentMode && (
                  <button className="btn btn-sm" onClick={fillBalance} title="Add a line to balance remaining as Consumed">
                    Auto-fill balance
                  </button>
                )}
                <button className="btn btn-sm btn-primary" onClick={addLine}>
                  <Plus size={12} /> Add Row
                </button>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--g50)' }}>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 130 }}>Type</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 150 }}>Item Category</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 100 }}>Qty ({unit})</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 88 }}>Weight (ct)</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 88 }}>Length (mm)</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 88 }}>Width (mm)</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 88 }}>Height (mm)</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px', width: 140 }}>Return Identity</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px' }}>Remarks</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const cfg = typeMap[line.type] || returnTypes[0];
                  // The backend Return Plan is the ONLY identity source. Rows
                  // without a qty are not part of the preflight payload, so
                  // they map to no plan line yet.
                  const hasQty  = parseFloat(line.qty) > 0;
                  const planIdx = lines.slice(0, idx).filter(l => parseFloat(l.qty) > 0).length;
                  const identity = hasQty && plan?.valid ? plan?.line_identities?.[planIdx] : null;
                  const code = !hasQty ? '—'
                    : planLoading ? '…'
                    : (identity ? (identity.lot_code || '—') : '—');
                  const qtyVal = parseFloat(line.qty) || 0;
                  const qtyErr = qtyVal > currentRemaining + 0.0001;

                  return (
                    <tr key={line._id} style={{ borderTop: '1px solid var(--g100)' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <SelectDropdown
                          value={line.type}
                          onChange={e => updateLine(line._id, 'type', e.target.value)}
                        >
                          {returnTypes.map(t => (
                            <option key={t.value} value={t.value}>{t.label} → {t.status}</option>
                          ))}
                        </SelectDropdown>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {/* Item Category is SERVER-controlled: the biscuit's
                            category on the BISCUIT route, the configured
                            Process Master output category on CHILD. No process
                            configuration currently proves a genuine user
                            choice, so no editable selector is offered. */}
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
                          {identity && identity.will_create_new_lot === false
                            ? (issue.growth_item_name || 'Growth Run')
                            : (cfg?.item_category_override
                                ? cfg.item_category_override.replace(/_/g, ' ')
                                : 'Inherit parent')}
                          <span style={{ color: 'var(--g400)', fontWeight: 400 }}> · server</span>
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number" step="0.0001" min="0"
                          value={line.qty}
                          onChange={e => updateLine(line._id, 'qty', e.target.value)}
                          style={{ width: '100%', padding: '5px 8px',
                            border: `2px solid ${qtyErr ? '#EF9A9A' : 'var(--g300)'}`,
                            borderRadius: 6, fontSize: 13, fontFamily: 'var(--mono)',
                            outline: 'none', boxSizing: 'border-box' }}
                          placeholder="0.0000"
                        />
                      </td>
                      {[
                        { field: 'weight', step: '0.0001', placeholder: 'ct' },
                        { field: 'length', step: '0.001',  placeholder: 'mm' },
                        { field: 'width',  step: '0.001',  placeholder: 'mm' },
                        { field: 'height', step: '0.001',  placeholder: 'mm' },
                      ].map(({ field, step, placeholder }) => (
                        <td key={field} style={{ padding: '6px 4px' }}>
                          <input
                            type="number" step={step} min="0"
                            value={line[field]}
                            onChange={e => updateLine(line._id, field, e.target.value)}
                            style={{ width: '100%', padding: '5px 6px',
                              // Phase C: weight is mandatory per qty>0 line in
                              // COMPONENT (Seed Remove) mode — highlight gaps.
                              border: `1px solid ${
                                field === 'weight' && isComponentMode && qtyVal > 0 &&
                                !(parseFloat(line.weight) > 0)
                                  ? '#EF9A9A' : 'var(--g300)'
                              }`, borderRadius: 6,
                              fontSize: 12, fontFamily: 'var(--mono)',
                              outline: 'none', boxSizing: 'border-box',
                              color: 'var(--g700)' }}
                            placeholder={placeholder}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11,
                          color: cfg.color, fontWeight: 700, background: cfg.bg,
                          padding: '3px 8px', borderRadius: 6, border: `1px solid ${cfg.border}`,
                          whiteSpace: 'nowrap' }}>
                          {code}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          value={line.remarks}
                          onChange={e => updateLine(line._id, 'remarks', e.target.value)}
                          placeholder="Optional…"
                          style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--g300)',
                            borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                        />
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                        <button
                          className="icon-btn"
                          onClick={() => removeLine(line._id)}
                          disabled={lines.length === 1}
                          style={{ color: lines.length === 1 ? 'var(--g300)' : '#C62828' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {/* ── Seed Remove ONLY: detached dual-family COMPONENT layout ──────
              Server-configured (component tags in allowed_outputs). Each
              family independently balances the input quantity — families are
              never summed together. Identities are generated on submit. */}
          {isComponentMode && [
            { fam: 'diamond', marker: 'A', title: 'Growth Diamond Outputs',
              color: '#1565C0', bg: '#E3F2FD',
              sub: 'Growth family identity: generated on submit' },
            { fam: 'seed', marker: 'B', title: 'Recovered Seed Outputs',
              color: '#6A1B9A', bg: '#F3E5F5',
              sub: 'Seed family identity: generated on submit' },
          ].map(({ fam, marker, title, color, bg, sub }) => {
            const famTypes = returnTypes.filter(t => t.component === fam);
            const famLines = lines.filter(l => typeMap[l.type]?.component === fam);
            const famQty = famLines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
            const famWeight = famLines.reduce((s, l) => s + (parseFloat(l.weight) || 0), 0);
            const addFamRow = () => {
              const _id = lineIdRef.current++;
              setLines(ls => [...ls, newLine(_id, famTypes[0]?.value)]);
            };
            // Non-posting helper: populates the family's remaining quantity
            // only — never submits, never mutates the backend.
            const fillFam = () => {
              const gap = Math.max(0, currentRemaining - famQty);
              if (gap < 0.0001 || !famTypes.length) return;
              const _id = lineIdRef.current++;
              setLines(ls => [...ls, { ...newLine(_id, famTypes[0].value), qty: gap.toFixed(4) }]);
            };
            return (
              <div key={fam} style={{ background: '#fff', border: '1px solid var(--g200)',
                borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--g200)',
                  display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: bg,
                    color, fontSize: 11, fontWeight: 800, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {marker}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g900)' }}>{title}</div>
                    <div style={{ fontSize: 10, color: 'var(--g500)' }}>
                      {sub} · This dual-output layout appears only for Seed Remove.
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={fillFam}
                    title="Populate this family's remaining quantity — never posts">
                    Auto-fill balance
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={addFamRow}>
                    <Plus size={12} /> Add Row
                  </button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--g50)' }}>
                      {['Type / Disposition', `Qty (${unit})`, 'Weight (ct)', 'Length (mm)',
                        'Width (mm)', 'Height (mm)', 'Remarks', ''].map((h, i) => (
                        <th key={h || `x${i}`} style={{ padding: '7px 8px', textAlign: 'left',
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          color: 'var(--g500)', letterSpacing: '.4px',
                          width: i === 0 ? 150 : i === 6 ? undefined : i === 7 ? 36 : 96 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {famLines.map(line => {
                      const qtyVal = parseFloat(line.qty) || 0;
                      return (
                        <tr key={line._id} style={{ borderTop: '1px solid var(--g100)' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <SelectDropdown value={line.type}
                              onChange={e => updateLine(line._id, 'type', e.target.value)}>
                              {famTypes.map(t => (
                                <option key={t.value} value={t.value}>{t.label} → {t.status}</option>
                              ))}
                            </SelectDropdown>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input type="number" step="0.0001" min="0" value={line.qty}
                              onChange={e => updateLine(line._id, 'qty', e.target.value)}
                              style={{ width: '100%', padding: '5px 8px',
                                border: `2px solid ${qtyVal > currentRemaining + 0.0001 ? '#EF9A9A' : 'var(--g300)'}`,
                                borderRadius: 6, fontSize: 13, fontFamily: 'var(--mono)',
                                outline: 'none', boxSizing: 'border-box' }}
                              placeholder="0.0000" />
                          </td>
                          {['weight', 'length', 'width', 'height'].map(field => (
                            <td key={field} style={{ padding: '6px 4px' }}>
                              <input type="number" step={field === 'weight' ? '0.0001' : '0.001'}
                                min="0" value={line[field]}
                                onChange={e => updateLine(line._id, field, e.target.value)}
                                style={{ width: '100%', padding: '5px 6px',
                                  // Weight is mandatory per qty>0 line — operator
                                  // entered, never derived or auto-averaged.
                                  border: `1px solid ${field === 'weight' && qtyVal > 0 &&
                                    !(parseFloat(line.weight) > 0) ? '#EF9A9A' : 'var(--g300)'}`,
                                  borderRadius: 6, fontSize: 12, fontFamily: 'var(--mono)',
                                  outline: 'none', boxSizing: 'border-box', color: 'var(--g700)' }}
                                placeholder={field === 'weight' ? 'ct' : 'mm'} />
                            </td>
                          ))}
                          <td style={{ padding: '6px 8px' }}>
                            <input value={line.remarks}
                              onChange={e => updateLine(line._id, 'remarks', e.target.value)}
                              placeholder="Optional remarks…"
                              style={{ width: '100%', padding: '5px 8px',
                                border: '1px solid var(--g300)', borderRadius: 6, fontSize: 12,
                                outline: 'none', boxSizing: 'border-box' }} />
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                            <button className="icon-btn" onClick={() => removeLine(line._id)}
                              disabled={lines.length === 1}
                              style={{ color: lines.length === 1 ? 'var(--g300)' : '#C62828' }}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ padding: '8px 14px', borderTop: '1px solid var(--g200)',
                  display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 11,
                  fontWeight: 700, color }}>
                  <span>{fam === 'diamond' ? 'Growth' : 'Seed'} total</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{famQty.toFixed(4)} {unit}</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{famWeight.toFixed(4)} ct</span>
                </div>
              </div>
            );
          })}

          {/* Date + Notes */}
          <div style={{ background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
            padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="fg">
                <label>Return Date *</label>
                <DatePicker value={returnDate} onChange={v => setReturnDate(v)} />
              </div>
              <div className="fg">
                <label>Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
              </div>
            </div>
          </div>

          {overFill && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFEBEE', borderRadius: 6,
              color: '#C62828', fontSize: 12, fontWeight: 600 }}>
              Over-filled by {(linesTotal - currentRemaining).toFixed(4)} {unit}. Reduce line quantities.
            </div>
          )}
        </div>


        {/* ── RIGHT PANEL: Live balance ─────────────────────────────────────── */}
        <div style={{ width: 240, borderLeft: '1px solid var(--g200)',
          overflow: 'auto', padding: 14, flexShrink: 0 }}>

          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '.6px', color: 'var(--g500)', marginBottom: 12 }}>
            Balance Check
          </div>

          {/* Summary numbers */}
          <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--g200)',
            borderRadius: 8, marginBottom: 12 }}>
            <BalanceRow label="Issued Qty"    value={issuedQty}        unit={unit} bold />
            {currentRemaining < issuedQty - 0.0001 && (
              <BalanceRow label="Available now" value={currentRemaining} unit={unit} color="#E65100" bold />
            )}
            {/* Seed Remove: each family independently balances the input. */}
            {isComponentMode && requiredComponents.map(c => (
              <BalanceRow key={c}
                label={`${c === 'diamond' ? 'Growth' : c === 'seed' ? 'Seed' : c} Total`}
                value={componentTotals[c] || 0} unit={unit}
                color={Math.abs((componentTotals[c] || 0) - currentRemaining) <= 0.0001 ? '#2E7D32' : '#C62828'}
                bold />
            ))}
            {isComponentMode && (
              <BalanceRow label="Status"
                value={balanced ? 'Balanced' : 'Unbalanced'}
                color={balanced ? '#2E7D32' : '#C62828'} bold />
            )}
          </div>

          {/* ── Backend Return Plan — the authoritative posting decision ── */}
          <div style={{ padding: '10px 12px', background: '#fff',
            border: `1px solid ${plan && !plan.valid ? '#EF9A9A' : 'var(--g200)'}`,
            borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 9.5, color: 'var(--g500)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
              Return Plan (server)
            </div>
            {planLoading ? (
              <div style={{ fontSize: 11, color: 'var(--g400)', fontStyle: 'italic' }}>Validating…</div>
            ) : !plan ? (
              <div style={{ fontSize: 11, color: 'var(--g400)', fontStyle: 'italic' }}>
                Enter return lines to validate
              </div>
            ) : !plan.valid ? (
              <div style={{ fontSize: 11, color: '#C62828', fontWeight: 600 }}>{plan.error}</div>
            ) : (
              <>
                {plan.component_mode && (
                  <div style={{ padding: '6px 8px', background: '#FFF8E1',
                    border: '1px solid #FFE082', borderRadius: 6, fontSize: 10.5,
                    fontWeight: 700, color: '#B26A00', marginBottom: 8 }}>
                    ★ Detached output mode — Seed Remove only
                  </div>
                )}
                <BalanceRow label="Route" value={plan.component_mode ? 'COMPONENT' : plan.route} bold />
                {plan.target_lot_code && <BalanceRow label="Target Lot" value={plan.target_lot_code} bold />}
                {plan.growth_number && <BalanceRow label="Growth Number" value={plan.growth_number} />}
                {plan.run_no != null && <BalanceRow label="Run" value={`R${plan.run_no}`} />}
                <BalanceRow label="New lot created" value={plan.will_create_new_lot ? 'YES' : 'NO'} />
                {plan.will_create_new_lot && plan.generated_child_code && (
                  <BalanceRow label="Child Code" value={plan.generated_child_code} />
                )}
                <BalanceRow label="Final" value={plan.is_final ? 'YES' : 'NO'} />
                <BalanceRow label="Issue →" value={plan.projected_issue_status} />
                {plan.projected_inventory_status && (
                  <BalanceRow label="Lot →" value={plan.projected_inventory_status} />
                )}
                {plan.component_mode && <BalanceRow label="Dual Family" value="YES" />}
                {plan.seed_released && <BalanceRow label="Seed Released" value="YES" />}
                {/* Seed Remove is non-reversible (snapshot has
                    reversal_supported:false) — never show misleading status. */}
                <BalanceRow label="Reversible" value={plan.reversal_supported ? 'YES' : 'NO'} />
                {plan.seed_retained != null && !plan.component_mode && (
                  <BalanceRow label="Seed stays attached" value={plan.seed_retained ? 'YES' : 'NO'} />
                )}
                {plan.component_mode && (
                  <div style={{ padding: '6px 8px', background: '#E3F2FD',
                    border: '1px solid #90CAF9', borderRadius: 6, fontSize: 10,
                    color: '#1565C0', marginTop: 8 }}>
                    Growth and Recovered Seed must each balance the input quantity.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Record Return (bottom action bar) is the ONLY posting action —
              the server decides partial vs final from the quantity balance.
              This block keeps the inline warnings only. */}
          {(((!isComponentMode) && ((!balanced && linesTotal > 0) || overFill)) ||
            (isComponentMode && (compOver || weightOver))) && (
            <div style={{ padding: '10px 12px', background: '#FFEBEE',
              border: '1px solid #EF9A9A', borderRadius: 8, marginBottom: 12 }}>
              {!isComponentMode && !balanced && linesTotal > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828' }}>
                  <AlertCircle size={12} /> Return quantities must balance before posting.
                </div>
              )}
              {!isComponentMode && overFill && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828' }}>
                  <AlertCircle size={12} /> You cannot return more than what was issued.
                </div>
              )}
              {isComponentMode && compOver && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828' }}>
                  <AlertCircle size={12} /> A component output exceeds the quantity in process — components are never summed.
                </div>
              )}
              {isComponentMode && weightOver && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828' }}>
                  <AlertCircle size={12} /> Output weight exceeds input weight — a split cannot create mass.
                </div>
              )}
            </div>
          )}

          <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--g200)',
            borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 9.5, color: 'var(--g500)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
              This Return
            </div>
            {returnTypes.map(t => totByType[t.value] > 0 && (
              <BalanceRow
                key={t.value}
                label={t.label}
                value={totByType[t.value]}
                unit={unit}
                color={t.color}
              />
            ))}
            {returnTypes.every(t => totByType[t.value] <= 0) && (
              <div style={{ fontSize: 11, color: 'var(--g400)', fontStyle: 'italic' }}>
                No lines yet
              </div>
            )}
          </div>

          {/* Still in process */}
          <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--g200)',
            borderRadius: 8, marginBottom: 12 }}>
            <BalanceRow
              label="Still In Process"
              value={stillIn}
              unit={unit}
              color={stillIn > 0.0001 ? '#1565C0' : 'var(--g500)'}
              bold={stillIn > 0.0001}
            />
            {stillIn > 0.0001 && (
              <div style={{ fontSize: 10, color: '#1565C0', marginTop: 4 }}>
                Issue stays OPEN — partial return
              </div>
            )}
          </div>

          {/* Balance result */}
          <div style={{
            padding: '12px 14px', borderRadius: 8,
            background: overFill ? '#FFEBEE' : balanced ? '#E8F5E9' : '#FFF8E1',
            border: `1px solid ${overFill ? '#EF9A9A' : balanced ? '#A5D6A7' : '#FFE082'}`,
          }}>
            {overFill || weightOver ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#C62828', marginBottom: 4 }}>
                  {isComponentMode ? (weightOver ? 'Mass created' : 'Component over-filled') : 'Over-filled'}
                </div>
                <div style={{ fontSize: 11, color: '#C62828' }}>
                  {isComponentMode
                    ? (weightOver
                        ? `Output weight ${outputWeight.toFixed(4)} > input ${inputWeight.toFixed(4)} ct`
                        : `Each component must stay within ${currentRemaining.toFixed(4)} ${unit}`)
                    : `Reduce by ${(linesTotal - currentRemaining).toFixed(4)} ${unit}`}
                </div>
              </>
            ) : balanced ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 700, color: '#2E7D32', marginBottom: 4 }}>
                  <CheckCircle2 size={14} />
                  {isComponentMode ? 'Component split — valid' : stillIn > 0.0001 ? 'Partial — balanced' : 'Final — balanced'}
                </div>
                <div style={{ fontSize: 11, color: '#388E3C' }}>
                  {isComponentMode
                    ? 'Input fully consumed — issue closes on submit'
                    : stillIn > 0.0001
                      ? `${stillIn.toFixed(4)} ${unit} stays in machine`
                      : 'Issue will be closed on submit'}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#F57F17', marginBottom: 4 }}>
                  {linesTotal === 0 ? 'Add return lines' : 'Unbalanced'}
                </div>
                <div style={{ fontSize: 11, color: '#795548' }}>
                  {linesTotal === 0
                    ? `${currentRemaining.toFixed(4)} ${unit} to account for`
                    : `${(currentRemaining - linesTotal).toFixed(4)} ${unit} unaccounted`}
                </div>
              </>
            )}
          </div>

          {/* Legend */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 9.5, color: 'var(--g500)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
              Lot Code Legend
            </div>
            {returnTypes.map(t => (
              <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 4 }}>
                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10,
                  fontFamily: 'var(--mono)', fontWeight: 700, color: t.color,
                  background: t.bg, border: `1px solid ${t.border}` }}>
                  -{t.suffix}N
                </span>
                <span style={{ fontSize: 11, color: t.color }}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>{/* end three-panel */}

      {/* Footer Actions */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--g200)', display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'var(--g50)', flexShrink: 0 }}>
        <button className="btn" onClick={exitBack} disabled={saving}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!balanced || overFill || saving || planLoading || !plan?.valid}
          onClick={handleSubmit}
        >
          {saving ? 'Saving...' : planLoading ? 'Validating…' : 'Record Return'}
        </button>
      </div>

    </div>
  );
}

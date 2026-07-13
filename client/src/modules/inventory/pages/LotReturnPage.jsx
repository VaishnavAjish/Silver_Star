import { useState, useEffect, useRef } from 'react';
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

// ── Return type catalogue ─────────────────────────────────────────────────────
const RETURN_TYPES = [
  { value: 'usable',   label: 'Usable',    suffix: 'R', status: 'IN STOCK',  color: '#2E7D32', bg: '#E8F5E9', border: '#A5D6A7' },
  { value: 'damaged',  label: 'Damaged',   suffix: 'D', status: 'DAMAGED',   color: '#C62828', bg: '#FFEBEE', border: '#EF9A9A' },
  { value: 'consumed', label: 'Consumed',  suffix: 'C', status: 'CONSUMED',  color: '#757575', bg: '#F5F5F5', border: '#E0E0E0' },
  { value: 'reprocess',label: 'Reprocess', suffix: 'P', status: 'REPROCESS', color: '#1565C0', bg: '#E3F2FD', border: '#90CAF9' },
  { value: 'qc_hold',  label: 'QC Hold',   suffix: 'Q', status: 'QC_HOLD',   color: '#E65100', bg: '#FFF3E0', border: '#FFCC80' },
];

const TYPE_MAP = Object.fromEntries(RETURN_TYPES.map(t => [t.value, t]));

function newLine(n) {
  return { _id: n, type: 'usable', qty: '', weight: '', length: '', width: '', height: '', remarks: '', item_id: '' };
}

// Compute the preview lot code for a line within the current form session.
// existingCounts: { R: 2, D: 0, ... } from prior returns already in DB.
// priorSameType: count of lines with same type that appear before this one in form.
// isGrowthRun: backend returns in-place — no child lot created, show code unchanged.
function previewCode(processLotCode, type, priorSameType, existingCounts, isGrowthRun) {
  if (!processLotCode || !type) return '—';
  if (isGrowthRun) return processLotCode;
  const cfg = TYPE_MAP[type];
  if (!cfg) return '—';
  const base = existingCounts[cfg.suffix] || 0;
  return `${processLotCode}-${cfg.suffix}${base + priorSameType + 1}`;
}

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
export default function LotReturnPage() {
  const navigate    = useNavigate();
  const api         = useApi();
  const { id }      = useParams();
  const lineIdRef   = useRef(2);

  const [issue,      setIssue]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [lines,      setLines]      = useState([newLine(1)]);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);

  const [items,      setItems]      = useState([]);

  // Count of each suffix char already in DB (from prior partial returns on this issue)
  const [existingCounts, setExistingCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get(`/api/lot-process-issues/${id}`),
      api.get('/api/items')
    ])
      .then(([data, itemsData]) => {
        if (cancelled) return;
        setIssue(data);
        setItems(itemsData);
        // Tally existing return lines by suffix char
        const counts = {};
        if (Array.isArray(data.returns)) {
          data.returns.forEach(ret => {
            (ret.lines || []).forEach(l => {
              const cfg = TYPE_MAP[l.return_type];
              if (cfg) counts[cfg.suffix] = (counts[cfg.suffix] || 0) + 1;
            });
          });
        }
        setExistingCounts(counts);
      })
      .catch(() => { if (!cancelled) setIssue(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // ── Line management ─────────────────────────────────────────────────────────
  const addLine = () => {
    const _id = lineIdRef.current++;
    setLines(ls => [...ls, newLine(_id)]);
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
    setLines(ls => [...ls, { _id, type: 'consumed', qty: gap.toFixed(4), weight: '', length: '', width: '', height: '', remarks: '' }]);
  };

  // ── Derived balance ─────────────────────────────────────────────────────────
  const issuedQty       = issue ? parseFloat(issue.issued_qty) : 0;
  const currentRemaining = issue && issue.remaining_in_process != null
    ? parseFloat(issue.remaining_in_process) : issuedQty;

  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
  const stillIn    = Math.max(0, currentRemaining - linesTotal);
  const difference = currentRemaining - linesTotal;
  
  // Phase 1 Engine: Strict Balance Requirement
  const balanced   = Math.abs(difference) <= 0.0001 && linesTotal > 0.0001;
  const overFill   = difference < -0.0001;

  // Totals per type for balance panel
  const totByType = {};
  for (const t of RETURN_TYPES) totByType[t.value] = 0;
  for (const l of lines) totByType[l.type] = (totByType[l.type] || 0) + (parseFloat(l.qty) || 0);

  const processLotCode = issue?.process_lot_code || issue?.process_lot_number || '';

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!balanced || overFill || saving) return;
    setSaving(true);
    try {
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

      const payload = {
        return_date: returnDate,
        notes:       notes || undefined,
        lines: lines
          .filter(l => parseFloat(l.qty) > 0)
          .map(l => ({ 
            type: l.type, 
            qty: parseFloat(l.qty), 
            remarks: l.remarks || undefined,
            item_id: l.item_id ? parseInt(l.item_id) : undefined
          })),
        remaining_in_process: parseFloat(stillIn.toFixed(4)),
        ...(hasMeas ? { measurements: measObj } : {}),
      };
      const res = await api.post(`/api/lot-process-issues/${id}/return`, payload);
      const isFinal = res.is_final;
      toast.success(
        isFinal
          ? `Return ${res.return_number} recorded — issue closed`
          : `Partial return ${res.return_number} recorded — ${res.remaining_after.toFixed(4)} still in process`
      );
      navigate('/inventory/process-issues');
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
  if (!issue) {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <AlertCircle size={32} />
        <p>Issue not found.</p>
        <button className="btn btn-sm" onClick={() => navigate('/inventory/process-issues')}>← Back</button>
      </div>
    );
  }
  if (issue.status !== 'OPEN') {
    return (
      <div className="animate-in empty-state" style={{ height: '100%' }}>
        <AlertCircle size={32} />
        <p>Issue {issue.issue_number} is {issue.status.toLowerCase()} — no further returns allowed.</p>
        <button className="btn btn-sm" onClick={() => navigate('/inventory/process-issues')}>← Back</button>
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
        <button className="icon-btn" onClick={() => navigate(-1)}><ArrowLeft size={15} /></button>
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
            <InfoRow label="Item"         value={issue.item_name} />
            <InfoRow label="Source Lot"   value={issue.source_lot_code || issue.source_lot_number} mono />
            <InfoRow label="Process Lot"  value={processLotCode} mono />
            <InfoRow label="Process Type" value={issue.process_type} />
          </Section>

          <Section title="Balance Validation" icon={Info}>
            <InfoRow label="Issued Qty"
              value={`${currentRemaining.toFixed(4)} ${unit}`} mono />
            <InfoRow label="Returned Qty"
              value={`${linesTotal.toFixed(4)} ${unit}`} mono />
            
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--g200)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: balanced ? '#2E7D32' : '#C62828' }}>
                  Difference
                </span>
                <span style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 800, color: balanced ? '#2E7D32' : '#C62828' }}>
                  {difference.toFixed(4)} {unit}
                </span>
              </div>
              {!balanced && linesTotal > 0 && (
                <div style={{ fontSize: 10, color: '#C62828', fontWeight: 600, marginTop: 4 }}>
                  Return quantities must exactly equal the Issued Quantity.
                </div>
              )}
            </div>
          </Section>

          {(issue.machine_name || issue.operator_full_name) && (
            <Section title="Machine" icon={Cpu}>
              {issue.machine_name && <InfoRow label="Machine" value={issue.machine_name} />}
              {issue.machine_code && <InfoRow label="Code" value={issue.machine_code} mono />}
              {issue.operator_full_name && <InfoRow label="Operator" value={issue.operator_full_name} />}
              {issue.target_runtime_hours && (
                <InfoRow label="Target Runtime" value={`${issue.target_runtime_hours}h`} />
              )}
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

          {/* Return lines table */}
          <div style={{ background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
            marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--g200)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.5px', color: 'var(--g600)' }}>
                Return Lines
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={fillBalance} title="Add a line to balance remaining as Consumed">
                  Auto-fill balance
                </button>
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
                    letterSpacing: '.4px', width: 140 }}>Generated Code</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10,
                    fontWeight: 700, textTransform: 'uppercase', color: 'var(--g500)',
                    letterSpacing: '.4px' }}>Remarks</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const cfg = TYPE_MAP[line.type] || RETURN_TYPES[0];
                  const priorSame = lines.slice(0, idx).filter(l => l.type === line.type).length;
                  const code = previewCode(processLotCode, line.type, priorSame, existingCounts, issue?.category === 'growth_run');
                  const qtyVal = parseFloat(line.qty) || 0;
                  const qtyErr = qtyVal > currentRemaining + 0.0001;

                  return (
                    <tr key={line._id} style={{ borderTop: '1px solid var(--g100)' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <SelectDropdown
                          value={line.type}
                          onChange={e => updateLine(line._id, 'type', e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {RETURN_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label} → {t.status}</option>
                          ))}
                        </SelectDropdown>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <SelectDropdown
                          value={line.item_id || ''}
                          onChange={e => updateLine(line._id, 'item_id', e.target.value)}
                          style={{ width: '100%' }}
                        >
                          <option value="">— Inherit Parent —</option>
                          {items.map(i => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))}
                        </SelectDropdown>
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
                              border: '1px solid var(--g300)', borderRadius: 6,
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
          </div>

          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--g200)',
            background: '#fff', flexShrink: 0,
          }}>
            {!balanced && linesTotal > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828', marginBottom: 8 }}>
                <AlertCircle size={12} /> The Return Difference must be 0 to save.
              </div>
            )}
            {overFill && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828', marginBottom: 8 }}>
                <AlertCircle size={12} /> You cannot return more than what was issued.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1, padding: '10px 16px', fontWeight: 700 }}
                disabled={!balanced || saving} onClick={handleSubmit}>
                {saving ? 'Saving…' : <><CheckCircle2 size={16} /> Complete Return</>}
              </button>
            </div>
          </div>
          
          <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--g200)',
            borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 9.5, color: 'var(--g500)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
              This Return
            </div>
            {RETURN_TYPES.map(t => totByType[t.value] > 0 && (
              <BalanceRow
                key={t.value}
                label={t.label}
                value={totByType[t.value]}
                unit={unit}
                color={t.color}
              />
            ))}
            {RETURN_TYPES.every(t => totByType[t.value] <= 0) && (
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
            {overFill ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#C62828', marginBottom: 4 }}>
                  Over-filled
                </div>
                <div style={{ fontSize: 11, color: '#C62828' }}>
                  Reduce by {(linesTotal - currentRemaining).toFixed(4)} {unit}
                </div>
              </>
            ) : balanced ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 700, color: '#2E7D32', marginBottom: 4 }}>
                  <CheckCircle2 size={14} />
                  {stillIn > 0.0001 ? 'Partial — balanced' : 'Final — balanced'}
                </div>
                <div style={{ fontSize: 11, color: '#388E3C' }}>
                  {stillIn > 0.0001
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
            {RETURN_TYPES.map(t => (
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
        <button className="btn" onClick={() => isModal ? onCancel?.() : navigate(-1)} disabled={saving}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!balanced || overFill || saving}
          onClick={handleSubmit}
        >
          {saving ? 'Saving...' : 'Record Return'}
        </button>
      </div>

    </div>
  );

  return content;
}

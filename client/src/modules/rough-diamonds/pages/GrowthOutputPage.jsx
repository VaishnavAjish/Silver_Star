import { useState, useEffect, useMemo, useCallback } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import DatePicker from '../../../shared/components/DatePicker';
import {
  Gem, Save, Plus, Trash2, Clock, Cpu, User, Calendar, TrendingUp,
  AlertCircle, CheckCircle, Package, Layers, ChevronRight,
} from 'lucide-react';

// ── Style tokens ──────────────────────────────────────────────────────────────
const PANEL = {
  display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
};
const SECTION_TITLE = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px',
  color: 'var(--g500)', marginBottom: 8,
};
const KPILL = (bg, color) => ({
  display: 'flex', flexDirection: 'column', padding: '8px 10px',
  background: bg, border: `1px solid ${color}44`, borderRadius: 8,
  flex: 1, minWidth: 80,
});

function fmt4(v) { return parseFloat(v || 0).toFixed(4); }
function fmtRuntime(hrs) {
  if (hrs == null || isNaN(hrs)) return '—';
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
}

// ── KPI metric cell ───────────────────────────────────────────────────────────
function Metric({ label, value, sub, color = '#424242', bg = '#F5F5F5' }) {
  return (
    <div style={KPILL(bg, color)}>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'var(--mono)', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 9, color, opacity: .7, marginTop: 1 }}>{sub}</div>}
      <div style={{ fontSize: 9, color: '#9E9E9E', marginTop: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>
        {label}
      </div>
    </div>
  );
}

// ── Yield indicator ───────────────────────────────────────────────────────────
function YieldRow({ label, value, unit = 'ct', expected, color }) {
  const pct = expected && expected > 0 ? Math.min(200, (value / expected) * 100) : null;
  const barColor = pct == null ? '#BDBDBD' : pct >= 90 ? '#2E7D32' : pct >= 70 ? '#E65100' : '#C62828';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: '#616161' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: color || barColor }}>
          {value != null && !isNaN(value) ? `${parseFloat(value).toFixed(2)} ${unit}` : '—'}
        </span>
      </div>
      {pct != null && (
        <div style={{ background: '#E0E0E0', borderRadius: 4, height: 5, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width .3s' }} />
        </div>
      )}
    </div>
  );
}

function PctIndicator({ label, pct }) {
  const color = pct >= 90 ? '#2E7D32' : pct >= 70 ? '#E65100' : '#C62828';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: '#616161' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color }}>
        {isNaN(pct) ? '—' : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}

// ── Process context card (left panel) ─────────────────────────────────────────
function ContextCard({ title, children, accent = 'var(--brand)' }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--g200)', borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: '10px 12px', marginBottom: 10,
    }}>
      <div style={SECTION_TITLE}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
      <span style={{ color: '#9E9E9E' }}>{label}</span>
      <span style={{ fontWeight: 600, color: '#212121', fontFamily: mono ? 'var(--mono)' : undefined }}>
        {value ?? <span style={{ color: '#BDBDBD' }}>—</span>}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GrowthOutputPage
// ══════════════════════════════════════════════════════════════════════════════
export default function GrowthOutputPage() {
  const api        = useApi();
  const navigate   = useNavigate();
  const [params]   = useSearchParams();
  const mpId       = params.get('machine_process_id');

  // ── Context (loaded from API) ─────────────────────────────────────────────
  const [ctx,       setCtx]       = useState(null);
  const [ctxLoading, setCtxLoading] = useState(!!mpId);

  // ── Form state ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    growth_date:        today,
    cycle_no:           1,
    department_id:      '',
    remark:             '',
    operator_remarks:   '',
    // Phase 33 (Decision 1): final Growth Run measurements captured at output
    gr_weight:          '',
    gr_length:          '',
    gr_width:           '',
    gr_height:          '',
    gr_dim_unit:        'mm',
  });
  const [lines, setLines] = useState([
    { weight: '', size_ref: '3-4 ct', shape: 'Rough', color_est: 'D-E', clarity_est: 'VS Est.', remark: '' },
  ]);
  const [costs, setCosts] = useState({
    cost_seed: 800, cost_gas: 12500, cost_power: 18400,
    cost_labour: 3500, cost_consumable: 1600, cost_maintenance: 500,
  });
  const [saving, setSaving] = useState(false);

  // ── Awaiting-output picker (shown when no process is in the URL) ───────────
  const [awaiting, setAwaiting]               = useState([]);
  const [awaitingLoading, setAwaitingLoading] = useState(!mpId);

  // Phase 34 (FIX 4): list Growth Runs directly by inventory status (IN STOCK),
  // not by machine.status='awaiting_output'. Laser ops run AFTER growth
  // completion, so a finished Growth Run is the unit the operator selects.
  useEffect(() => {
    if (mpId) return;
    setAwaitingLoading(true);
    api.get('/api/growth-runs?status=IN%20STOCK&limit=200')
      .then(res => {
        const list = (res?.data || []).filter(gr => gr.machine_process_id);
        setAwaiting(list);
      })
      .catch(() => {})
      .finally(() => setAwaitingLoading(false));
  }, [mpId]);

  // ── Load process context ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mpId) return;
    setCtxLoading(true);
    api.get(`/api/rough-growth/process-context/${mpId}`)
      .then(data => {
        setCtx(data);
        // Pre-fill form from process context + current Growth Run measurements
        const gr = data.growth_run || {};
        setForm(f => ({
          ...f,
          department_id: '',
          remark: `Output for process ${data.process?.process_number || ''}`,
          gr_weight:  gr.weight     != null ? String(gr.weight)     : '',
          gr_length:  gr.dim_length != null ? String(gr.dim_length) : '',
          gr_width:   gr.dim_depth  != null ? String(gr.dim_depth)  : '',
          gr_height:  gr.dim_height != null ? String(gr.dim_height) : '',
          gr_dim_unit: gr.dim_unit || 'mm',
        }));
      })
      .catch(() => toast.error('Could not load process context'))
      .finally(() => setCtxLoading(false));
  }, [mpId]);

  // ── Line management ───────────────────────────────────────────────────────
  const addLine    = () => setLines(l => [...l, { weight: '', size_ref: '3-4 ct', shape: 'Rough', color_est: 'D-E', clarity_est: 'VS Est.', remark: '' }]);
  const removeLine = i  => { if (lines.length > 1) setLines(l => l.filter((_, idx) => idx !== i)); };
  const setLine    = (i, k, v) => setLines(l => l.map((row, idx) => idx === i ? { ...row, [k]: v } : row));

  // ── Derived totals ────────────────────────────────────────────────────────
  const validLines   = lines.filter(l => parseFloat(l.weight) > 0);
  const totalWeight  = useMemo(() => validLines.reduce((s, l) => s + parseFloat(l.weight), 0), [lines]);
  const totalCost    = useMemo(() => Object.values(costs).reduce((s, v) => s + (parseFloat(v) || 0), 0), [costs]);
  const costPerCarat = totalWeight > 0 ? Math.round(totalCost / totalWeight) : 0;

  // ── Yield analytics ───────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (!ctx) return null;
    const { summary, return_totals, process } = ctx;
    const issued      = parseFloat(summary?.total_issued     || 0);
    const usableRet   = parseFloat(return_totals?.usable     || 0);
    const damagedRet  = parseFloat(return_totals?.damaged    || 0);
    const consumedRet = parseFloat(return_totals?.consumed   || 0);
    const expYield    = parseFloat(process?.expected_rough_qty || 0);

    const recoveryPct  = expYield  > 0 ? (totalWeight / expYield)   * 100 : null;
    const consumedPct  = issued    > 0 ? (consumedRet / issued)     * 100 : null;
    const damagePct    = issued    > 0 ? (damagedRet  / issued)     * 100 : null;
    const efficiencyPct = issued   > 0 ? ((usableRet + totalWeight) / issued) * 100 : null;

    return { issued, usableRet, damagedRet, consumedRet, expYield, recoveryPct, consumedPct, damagePct, efficiencyPct };
  }, [ctx, totalWeight]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (validLines.length === 0) return toast.error('Add at least one lot with weight');
    // Phase 33: Growth Run is MANDATORY — there is no process-less creation path.
    if (!mpId) return toast.error('A Growth Run / machine process is required. Start from the Control Tower.');

    setSaving(true);
    try {
      const payload = {
        ...form,
        ...costs,
        lines: validLines,
        machine_process_id: parseInt(mpId),
      };
      const result = await api.post('/api/rough-growth', payload);
      toast.success(`${validLines.length} rough lots created — Growth ${result.growth_number}`);
      navigate('/rough-growth');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }, [validLines, form, costs, mpId]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (ctxLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="spinner" />
      </div>
    );
  }

  // Phase 33: Rough Output REQUIRES an awaiting-output machine process (Growth Run).
  // There is no free-form rough creation path (closes LEAK 4). Instead of a dead-end,
  // list every Growth Run that is awaiting output so the operator can pick one.
  if (!mpId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F5F5F5' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
          background: '#fff', borderBottom: '1px solid var(--g200)', flexShrink: 0,
        }}>
          <Gem size={17} color="var(--brand)" />
          <div style={{ fontWeight: 700, fontSize: 14, color: '#212121' }}>Growth Output Entry</div>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/manufacturing/control-tower')}>
            <Cpu size={13} /> Control Tower
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 760 }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 4 }}>Growth Runs Available for Output</div>
            <div style={{ fontSize: 12, color: '#757575', marginBottom: 16 }}>
              Rough diamonds can only be created from a completed Growth Run. Pick an
              IN STOCK Growth Run (the biscuit) to post its rough output.
            </div>

            {awaitingLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : awaiting.length === 0 ? (
              <div style={{
                textAlign: 'center', background: '#fff', border: '1px solid var(--g200)',
                borderRadius: 12, padding: '32px 28px',
              }}>
                <AlertCircle size={32} color="#E65100" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#212121', marginBottom: 6 }}>
                  No Growth Runs Available
                </div>
                <div style={{ fontSize: 12.5, color: '#616161', lineHeight: 1.5 }}>
                  No Growth Run is currently IN STOCK. A Growth Run becomes available here
                  once its growth process completes (all seeds returned) in the Control Tower.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {awaiting.map(gr => (
                  <button
                    key={gr.id}
                    onClick={() => navigate(`/manufacturing/growth-output?machine_process_id=${gr.machine_process_id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                      background: '#fff', border: '1px solid var(--g200)', borderLeft: '3px solid #7B1FA2',
                      borderRadius: 10, padding: '14px 16px', cursor: 'pointer', width: '100%',
                    }}
                  >
                    <Gem size={22} color="#7B1FA2" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#212121' }}>
                        {gr.lot_number}
                        {gr.machine_code ? <span style={{ color: '#9E9E9E', fontWeight: 500 }}> · {gr.machine_name} ({gr.machine_code})</span> : null}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#757575', marginTop: 2 }}>
                        {gr.process_number || ''}
                        {gr.qty != null ? ` · Qty ${gr.qty}` : ''}
                        {gr.weight != null ? ` · ${gr.weight} ct` : ''}
                        {gr.operator_name ? ` · ${gr.operator_name}` : ''}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px',
                      color: '#7B1FA2', background: '#F3E5F5', border: '1px solid #CE93D8',
                      borderRadius: 5, padding: '3px 8px',
                    }}>In Stock</span>
                    <ChevronRight size={16} color="#BDBDBD" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const proc          = ctx?.process;
  const issues        = ctx?.issues        || [];
  const returns       = ctx?.returns       || [];
  const summary       = ctx?.summary       || {};
  const returnTotals  = ctx?.return_totals || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F5F5F5' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
        background: '#fff', borderBottom: '1px solid var(--g200)', flexShrink: 0,
      }}>
        <Gem size={17} color="var(--brand)" />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#212121' }}>
            Growth Output Entry
          </div>
          {proc && (
            <div style={{ fontSize: 11, color: '#757575', marginTop: 1 }}>
              {proc.process_number} · {proc.machine_name} ({proc.machine_code}) · {proc.operator_name || 'Unassigned'}
            </div>
          )}
        </div>
        {/* Breadcrumb pipeline */}
        {proc && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {['Seed Issued', 'Growth Runtime', 'Seeds Returned', '◆ Output Entry', 'Complete'].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                  background: i < 3 ? '#E8F5E9' : i === 3 ? 'var(--brand-50)' : '#F5F5F5',
                  color: i < 3 ? '#2E7D32' : i === 3 ? 'var(--brand-dark)' : '#9E9E9E',
                  border: `1px solid ${i < 3 ? '#A5D6A7' : i === 3 ? 'var(--brand)' : '#E0E0E0'}`,
                }}>{s}</div>
                {i < 4 && <ChevronRight size={11} color="#BDBDBD" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Three-panel body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 0 }}>

        {/* ══════════════════════════════════════════════════════════════════
            LEFT PANEL — Process Context (280px)
        ══════════════════════════════════════════════════════════════════ */}
        <div style={{
          ...PANEL, width: 280, flexShrink: 0,
          borderRight: '1px solid var(--g200)', background: '#FAFAFA',
          overflowY: 'auto', padding: 14,
        }}>

          {proc ? (
            <>
              <ContextCard title="Machine & Process" accent="#2E7D32">
                <InfoRow label="Process #"  value={proc.process_number} />
                <InfoRow label="Machine"    value={`${proc.machine_name} (${proc.machine_code})`} />
                <InfoRow label="Operator"   value={proc.operator_name || '—'} />
                <InfoRow label="Process"    value={proc.process_name || proc.process_type} />
                <InfoRow label="Runtime"    value={fmtRuntime(proc.runtime_hours)} mono />
                <InfoRow label="Started"    value={proc.started_at ? new Date(proc.started_at).toLocaleDateString('en-IN') : '—'} />
                {proc.expected_rough_qty && (
                  <InfoRow label="Exp. Yield" value={`${parseFloat(proc.expected_rough_qty).toFixed(3)} ct`} mono />
                )}
                {proc.target_runtime_hours && (
                  <InfoRow label="Target Runtime" value={`${proc.target_runtime_hours}h`} mono />
                )}
              </ContextCard>

              {ctx?.growth_run && (
                <ContextCard title="Growth Run (Biscuit)" accent="var(--brand)">
                  <InfoRow label="GR Number"   value={ctx.growth_run.lot_number} mono />
                  <InfoRow label="Status"      value={ctx.growth_run.status} />
                  {ctx.growth_run.seed_height_at_in != null && (
                    <InfoRow label="Seed Height" value={`${parseFloat(ctx.growth_run.seed_height_at_in).toFixed(2)} mm`} mono />
                  )}
                  {ctx.growth_run.weight_at_in != null && (
                    <InfoRow label="Seed Weight" value={`${parseFloat(ctx.growth_run.weight_at_in).toFixed(3)} ct`} mono />
                  )}
                  {ctx.growth_run.genealogy_path && (
                    <div style={{ fontSize: 10, color: '#757575', marginTop: 4, fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                      {ctx.growth_run.genealogy_path}
                    </div>
                  )}
                </ContextCard>
              )}

              <ContextCard title="Issued Seeds" accent="#4527A0">
                {issues.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#9E9E9E' }}>No seed issues linked</div>
                ) : issues.map((iss, i) => (
                  <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < issues.length - 1 ? '1px solid var(--g200)' : 'none' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#212121' }}>{iss.issue_number}</div>
                    <div style={{ fontSize: 10, color: '#616161' }}>{iss.item_name}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#9E9E9E' }}>Issued</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: '#212121' }}>{fmt4(iss.issued_qty)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#9E9E9E' }}>Returned</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: '#2E7D32' }}>{fmt4(iss.returned_qty)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#9E9E9E' }}>Remaining</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: parseFloat(iss.remaining_qty) > 0 ? '#E65100' : '#9E9E9E' }}>
                          {fmt4(iss.remaining_qty)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {issues.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <Metric label="Total Issued"    value={`${parseFloat(summary.total_issued    || 0).toFixed(4)}`} bg="#EDE7F6" color="#4527A0" />
                    <Metric label="Total Returned"  value={`${parseFloat(summary.total_returned  || 0).toFixed(4)}`} bg="#E8F5E9" color="#2E7D32" />
                  </div>
                )}
              </ContextCard>

              {returns.length > 0 && (
                <ContextCard title="Return Summary" accent="#1565C0">
                  {Object.entries(returnTotals).filter(([, v]) => v > 0).map(([type, qty]) => (
                    <InfoRow key={type} label={type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} value={`${parseFloat(qty).toFixed(4)}`} mono />
                  ))}
                  <div style={{ marginTop: 4, fontSize: 10, color: '#757575' }}>
                    {returns.length} return batch{returns.length !== 1 ? 'es' : ''}
                  </div>
                </ContextCard>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#9E9E9E', padding: 12, textAlign: 'center' }}>
              <Package size={28} style={{ display: 'block', margin: '0 auto 8px', opacity: .3 }} />
              Loading process context…
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            CENTER PANEL — Output Entry
        ══════════════════════════════════════════════════════════════════ */}
        <div style={{ ...PANEL, flex: 1, background: '#fff', overflowY: 'auto', padding: 16 }}>

          {/* Output Header */}
          <div style={{
            background: 'var(--brand-50)', border: '1px solid var(--sidebar-border)',
            borderRadius: 10, padding: 14, marginBottom: 14,
          }}>
            <div style={{ ...SECTION_TITLE, color: 'var(--brand-dark)', marginBottom: 10 }}>Output Header</div>
            <div className="form-row">
              <div className="fg">
                <label>Date *</label>
                <DatePicker value={form.growth_date} onChange={v => setForm(f => ({ ...f, growth_date: v }))} />
              </div>
              <div className="fg">
                <label>Cycle No.</label>
                <input type="number" min={1} value={form.cycle_no} onChange={e => setForm(f => ({ ...f, cycle_no: e.target.value }))} />
              </div>
            </div>

            {/* Phase 33 (Decision 1): final Growth Run measurements — written back to
                the biscuit so analytics (growth mm, weight gain, growth %) are accurate. */}
            <div style={{ ...SECTION_TITLE, color: 'var(--brand-dark)', margin: '4px 0 8px' }}>
              Growth Run Measurements
            </div>
            <div className="form-row">
              <div className="fg">
                <label>Final Weight (ct)</label>
                <input type="number" step="0.001" min="0" value={form.gr_weight}
                  onChange={e => setForm(f => ({ ...f, gr_weight: e.target.value }))} placeholder="0.000" />
              </div>
              <div className="fg">
                <label>Length</label>
                <input type="number" step="0.01" min="0" value={form.gr_length}
                  onChange={e => setForm(f => ({ ...f, gr_length: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="fg">
                <label>Width</label>
                <input type="number" step="0.01" min="0" value={form.gr_width}
                  onChange={e => setForm(f => ({ ...f, gr_width: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="fg">
                <label>Height</label>
                <input type="number" step="0.01" min="0" value={form.gr_height}
                  onChange={e => setForm(f => ({ ...f, gr_height: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="fg">
                <label>Unit</label>
                <SelectDropdown value={form.gr_dim_unit} onChange={e => setForm(f => ({ ...f, gr_dim_unit: e.target.value }))}>
                  {['mm', 'cm'].map(o => <option key={o}>{o}</option>)}
                </SelectDropdown>
              </div>
            </div>
            <div className="form-row">
              <div className="fg w">
                <label>Remark</label>
                <input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} placeholder="Growth observations, quality notes" />
              </div>
            </div>
          </div>

          {/* Rough Diamond Lots Table */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#424242' }}>
              <Gem size={13} style={{ color: 'var(--brand)', verticalAlign: 'middle', marginRight: 4 }} />
              Rough Diamond Output Lots
            </div>
            <button className="btn btn-sm" onClick={addLine}><Plus size={11} /> Add Lot</button>
          </div>

          <table className="je-lines-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th style={{ width: 82 }}>Weight (ct) *</th>
                <th>Size Ref</th>
                <th>Shape</th>
                <th>Color Est.</th>
                <th>Clarity Est.</th>
                <th>Remark</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center', color: '#9E9E9E' }}>{i + 1}</td>
                  <td>
                    <input type="number" step="0.001" min="0" value={l.weight}
                      onChange={e => setLine(i, 'weight', e.target.value)}
                      className="je-cell-input je-num-input"
                      placeholder="0.000" style={{ fontWeight: 600 }} />
                  </td>
                  <td>
                    <SelectDropdown className="je-cell-input" value={l.size_ref} onChange={e => setLine(i, 'size_ref', e.target.value)}>
                      {['0.5-1 ct','1-2 ct','2-3 ct','3-4 ct','4-5 ct','5+ ct'].map(o => <option key={o}>{o}</option>)}
                    </SelectDropdown>
                  </td>
                  <td>
                    <SelectDropdown className="je-cell-input" value={l.shape} onChange={e => setLine(i, 'shape', e.target.value)}>
                      {['Rough','Makeable','Sawable','Cleavage'].map(o => <option key={o}>{o}</option>)}
                    </SelectDropdown>
                  </td>
                  <td>
                    <SelectDropdown className="je-cell-input" value={l.color_est} onChange={e => setLine(i, 'color_est', e.target.value)}>
                      {['D-E','F-G','H-I','J-K','L-M','Fancy'].map(o => <option key={o}>{o}</option>)}
                    </SelectDropdown>
                  </td>
                  <td>
                    <SelectDropdown className="je-cell-input" value={l.clarity_est} onChange={e => setLine(i, 'clarity_est', e.target.value)}>
                      {['VVS Est.','VS Est.','SI Est.','I Est.'].map(o => <option key={o}>{o}</option>)}
                    </SelectDropdown>
                  </td>
                  <td>
                    <input className="je-cell-input" value={l.remark || ''} onChange={e => setLine(i, 'remark', e.target.value)} placeholder="Note" />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button className="icon-btn" onClick={() => removeLine(i)} style={{ color: 'var(--red)' }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          
</table>


          {/* Output Summary Cards */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {[
              { v: validLines.length,               l: 'Output Lots',  bg: 'var(--brand-50)', bc: 'var(--sidebar-border)', c: 'var(--brand-dark)' },
              { v: `${totalWeight.toFixed(3)} ct`,  l: 'Total Weight', bg: '#E3F2FD',         bc: '#90CAF9',              c: '#0D47A1' },
              { v: `₹${costPerCarat.toLocaleString('en-IN')}/ct`, l: 'Est. Cost/ct', bg: '#FFF3E0', bc: '#FFCC80', c: '#E65100' },
              { v: `₹${totalCost.toLocaleString('en-IN')}`, l: 'Total Cost', bg: '#E8F5E9', bc: '#A5D6A7', c: '#2E7D32' },
            ].map((c, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 130, padding: 12, textAlign: 'center',
                background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8,
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.c, fontFamily: 'var(--mono)' }}>{c.v}</div>
                <div style={{ fontSize: 10, color: c.c, fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>{c.l}</div>
              </div>
            ))}
          </div>

          {/* Cost Breakdown (compact) */}
          <div style={{ marginTop: 16, background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 8, padding: 12 }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 8 }}>Cost Breakdown</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { key: 'cost_seed',        label: 'Seed'        },
                { key: 'cost_gas',         label: 'Gas'         },
                { key: 'cost_power',       label: 'Power'       },
                { key: 'cost_labour',      label: 'Labour'      },
                { key: 'cost_consumable',  label: 'Consumable'  },
                { key: 'cost_maintenance', label: 'Maintenance' },
              ].map(c => (
                <div key={c.key}>
                  <label style={{ fontSize: 10, color: '#757575', display: 'block', marginBottom: 2 }}>{c.label} (₹)</label>
                  <input type="number" min="0" style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--g300)', borderRadius: 4, fontSize: 11 }}
                    value={costs[c.key]} onChange={e => setCosts(p => ({ ...p, [c.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Action Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || validLines.length === 0}
            >
              <Save size={13} />
              {saving
                ? 'Posting…'
                : proc
                  ? `Post Output & Complete ${proc.process_number}`
                  : `Save — ${validLines.length} Rough Lots`
              }
            </button>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            RIGHT PANEL — Yield Analytics (240px)
        ══════════════════════════════════════════════════════════════════ */}
        <div style={{
          ...PANEL, width: 240, flexShrink: 0,
          borderLeft: '1px solid var(--g200)', background: '#FAFAFA',
          overflowY: 'auto', padding: 14,
        }}>
          <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', gap: 5 }}>
            <TrendingUp size={11} /> Yield Analytics
          </div>

          {analytics ? (
            <>
              <YieldRow
                label="Expected Yield"
                value={analytics.expYield}
                color="#4527A0"
              />
              <YieldRow
                label="Actual Output"
                value={totalWeight}
                expected={analytics.expYield || undefined}
              />
              <div style={{ borderTop: '1px solid var(--g200)', margin: '10px 0' }} />

              <PctIndicator
                label="Recovery %"
                pct={analytics.recoveryPct ?? NaN}
              />
              <PctIndicator
                label="Consumed %"
                pct={analytics.consumedPct ?? NaN}
              />
              <PctIndicator
                label="Damage %"
                pct={analytics.damagePct ?? NaN}
              />
              <PctIndicator
                label="Efficiency %"
                pct={analytics.efficiencyPct ?? NaN}
              />

              <div style={{ borderTop: '1px solid var(--g200)', margin: '10px 0' }} />

              <div style={{ ...SECTION_TITLE }}>Seed Return Breakdown</div>
              {[
                { label: 'Usable Returned',   v: analytics.usableRet,   color: '#2E7D32' },
                { label: 'Damaged',           v: analytics.damagedRet,  color: '#C62828' },
                { label: 'Consumed',          v: analytics.consumedRet, color: '#E65100' },
              ].map(r => (
                <YieldRow key={r.label} label={r.label} value={r.v} expected={analytics.issued || undefined} color={r.color} />
              ))}

              {proc && (
                <>
                  <div style={{ borderTop: '1px solid var(--g200)', margin: '10px 0' }} />
                  <div style={{ ...SECTION_TITLE }}>Runtime</div>
                  <InfoRow label="Actual" value={fmtRuntime(proc.runtime_hours)} mono />
                  {proc.target_runtime_hours && (
                    <InfoRow label="Target" value={`${proc.target_runtime_hours}h`} mono />
                  )}
                  {proc.runtime_hours && proc.target_runtime_hours && (
                    <InfoRow
                      label="Variance"
                      value={`${(parseFloat(proc.runtime_hours) - parseFloat(proc.target_runtime_hours)).toFixed(1)}h`}
                      mono
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#9E9E9E', textAlign: 'center', paddingTop: 24 }}>
              <TrendingUp size={24} style={{ display: 'block', margin: '0 auto 8px', opacity: .25 }} />
              Link a machine process to see yield analytics.
            </div>
          )}

          {/* Cost summary */}
          {totalWeight > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--g200)', margin: '10px 0' }} />
              <div style={{ ...SECTION_TITLE }}>Cost Summary</div>
              <InfoRow label="Total Cost"    value={`₹${totalCost.toLocaleString('en-IN')}`} />
              <InfoRow label="Cost / Carat"  value={`₹${costPerCarat.toLocaleString('en-IN')}`} mono />
            </>
          )}

          {proc && (
            <div style={{
              marginTop: 14, padding: 10, borderRadius: 8,
              background: '#E8F5E9', border: '1px solid #A5D6A7', fontSize: 11,
            }}>
              <CheckCircle size={11} color="#2E7D32" style={{ verticalAlign: 'middle', marginRight: 5 }} />
              <strong style={{ color: '#2E7D32' }}>On submit:</strong>
              <ul style={{ margin: '6px 0 0 16px', padding: 0, color: '#2E7D32', fontSize: 10.5 }}>
                <li>Rough lots created in inventory</li>
                <li>Genealogy linked to process seeds</li>
                <li>Process {proc.process_number} marked COMPLETED</li>
                <li>Machine set to IDLE</li>
                <li>JE posted automatically</li>
              </ul>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

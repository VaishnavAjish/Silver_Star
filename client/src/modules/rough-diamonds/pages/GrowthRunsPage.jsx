// ============================================================
// Growth Runs (Biscuits) — Phase 32 frontend
// ------------------------------------------------------------
// List + measurement entry over inventory(category='growth_run').
// Biscuits are AUTO-CREATED server-side when a growth process
// transitions to 'awaiting_output' — this page never creates them.
// It surfaces the growth-run specific workflow that has no other UI:
//   * list with growth metrics (growth mm / % / weight gain)
//   * record final measurements (height + weight) for IN STOCK biscuits
//   * inspect lineage (seed → biscuit → rough lots) and op history
// ============================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import DataGrid from '../../../shared/components/DataGrid';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';
import { Gem, Ruler, Save, Layers, Clock, TrendingUp } from 'lucide-react';
import { useTabs } from '../../../core/tabs/TabContext';

const fmt = (v, d = 3) => (v == null || v === '' || isNaN(v)) ? '—' : parseFloat(v).toFixed(d);
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';
const statusBadge = s => {
  const cls = s === 'IN STOCK' ? 'b-stock' : s === 'CONSUMED' ? 'b-cancelled' : 'b-draft';
  return <span className={`badge ${cls}`}>{s}</span>;
};
const growthColor = pct => pct == null ? 'var(--g500)' : pct >= 90 ? '#2E7D32' : pct >= 50 ? '#E65100' : '#C62828';

// ════════════════════════════════════════════════════════════════════════════
// Measurement entry modal — PATCH /api/growth-runs/:id/measurements
// ════════════════════════════════════════════════════════════════════════════
function MeasureModal({ open, run, onClose, onSaved }) {
  const api = useApi();
  const [form, setForm] = useState({ weight: '', dim_height: '', dim_length: '', dim_depth: '', remarks: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!run) return;
    setForm({
      weight:     run.weight     ?? '',
      dim_height: run.dim_height ?? '',
      dim_length: run.dim_length ?? '',
      dim_depth:  run.dim_depth  ?? '',
      remarks:    '',
    });
  }, [run]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Live preview of generated metrics (mirrors the SQL generated columns)
  const preview = useMemo(() => {
    const h = parseFloat(form.dim_height);
    const w = parseFloat(form.weight);
    const seedH = parseFloat(run?.seed_height_at_in);
    const seedW = parseFloat(run?.weight_at_in);
    const growthMm  = !isNaN(h) && !isNaN(seedH) ? h - seedH : null;
    const weightGn  = !isNaN(w) && !isNaN(seedW) ? w - seedW : null;
    const growthPct = growthMm != null && !isNaN(seedH) && seedH > 0 ? (growthMm / seedH) * 100 : null;
    return { growthMm, weightGn, growthPct };
  }, [form, run]);

  const handleSave = useCallback(async () => {
    if (!form.dim_height && !form.weight) return toast.error('Enter at least height or weight');
    setSaving(true);
    try {
      const body = {
        weight:     form.weight     === '' ? undefined : parseFloat(form.weight),
        dim_height: form.dim_height === '' ? undefined : parseFloat(form.dim_height),
        dim_length: form.dim_length === '' ? undefined : parseFloat(form.dim_length),
        dim_depth:  form.dim_depth  === '' ? undefined : parseFloat(form.dim_depth),
        remarks:    form.remarks || undefined,
      };
      await api.patch(`/api/growth-runs/${run.id}/measurements`, body);
      toast.success(`Measurements saved for ${run.lot_number}`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }, [form, run]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run) return null;
  const unit = run.dim_unit || 'mm';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Measure Biscuit — ${run.lot_number}`}
      icon={<Ruler size={16} style={{ marginRight: 8, color: 'var(--brand)' }} />}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save Measurements'}
          </button>
        </div>
      }
    >
      {/* Seed snapshot reference */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { l: 'Seed Height (in)', v: `${fmt(run.seed_height_at_in)} ${unit}` },
          { l: 'Seed Weight (in)', v: `${fmt(run.weight_at_in, 4)} ct` },
          { l: 'Machine', v: run.machine_code || '—' },
          { l: 'Process', v: run.process_number || '—' },
        ].map((f, i) => (
          <div key={i} style={{ flex: 1, minWidth: 110, padding: '8px 10px', background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{f.l}</div>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{f.v}</div>
          </div>
        ))}
      </div>

      {/* Measurement inputs */}
      <div className="form-row">
        <div className="fg">
          <label>Final Weight (ct)</label>
          <input type="number" step="0.0001" min="0" value={form.weight}
            onChange={e => set('weight', e.target.value)} placeholder="0.0000" />
        </div>
        <div className="fg">
          <label>Height ({unit})</label>
          <input type="number" step="0.001" min="0" value={form.dim_height}
            onChange={e => set('dim_height', e.target.value)} placeholder="0.000" />
        </div>
      </div>
      <div className="form-row">
        <div className="fg">
          <label>Length ({unit})</label>
          <input type="number" step="0.001" min="0" value={form.dim_length}
            onChange={e => set('dim_length', e.target.value)} placeholder="0.000" />
        </div>
        <div className="fg">
          <label>Depth ({unit})</label>
          <input type="number" step="0.001" min="0" value={form.dim_depth}
            onChange={e => set('dim_depth', e.target.value)} placeholder="0.000" />
        </div>
      </div>
      <div className="form-row">
        <div className="fg w">
          <label>Remarks</label>
          <input value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Measurement notes" />
        </div>
      </div>

      {/* Live metric preview */}
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {[
          { l: 'Growth', v: `${fmt(preview.growthMm)} ${unit}`, c: '#0D47A1' },
          { l: 'Weight Gain', v: `${fmt(preview.weightGn, 4)} ct`, c: '#2E7D32' },
          { l: 'Growth %', v: preview.growthPct == null ? '—' : `${preview.growthPct.toFixed(2)}%`, c: growthColor(preview.growthPct) },
        ].map((f, i) => (
          <div key={i} style={{ flex: 1, minWidth: 100, padding: 10, textAlign: 'center', background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: f.c, fontFamily: 'var(--mono)' }}>{f.v}</div>
            <div style={{ fontSize: 9.5, color: 'var(--g500)', textTransform: 'uppercase', marginTop: 2 }}>{f.l}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Detail modal — GET /api/growth-runs/:id (children + history)
// ════════════════════════════════════════════════════════════════════════════
function DetailModal({ open, id, onClose }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !id) { setData(null); return; }
    setLoading(true);
    api.get(`/api/growth-runs/${id}`)
      .then(setData)
      .catch(() => toast.error('Failed to load Growth Run'))
      .finally(() => setLoading(false));
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = data?.dim_unit || 'mm';

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title={data ? `Growth Run — ${data.lot_number}` : 'Growth Run Details'}
      icon={<Gem size={16} style={{ marginRight: 8, color: 'var(--brand)' }} />}
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>}
    >
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--g500)' }}>Loading…</div>}
      {!loading && data && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { l: 'Growth Run', v: data.lot_number, bold: true, color: 'var(--brand)' },
              { l: 'Status', v: statusBadge(data.status) },
              { l: 'Machine', v: `${data.machine_name || '—'}${data.machine_code ? ` (${data.machine_code})` : ''}` },
              { l: 'Process', v: data.process_number || '—' },
              { l: 'Operator', v: data.operator_name || '—' },
              { l: 'Seed Parent', v: data.parent_lot_number || '—' },
              { l: 'Created', v: fmtDate(data.created_at) },
              { l: 'Seed Height (in)', v: `${fmt(data.seed_height_at_in)} ${unit}` },
              { l: 'Final Height', v: `${fmt(data.dim_height)} ${unit}` },
              { l: 'Growth', v: `${fmt(data.actual_growth_mm)} ${unit}` },
              { l: 'Growth %', v: data.growth_pct == null ? '—' : `${parseFloat(data.growth_pct).toFixed(2)}%`, color: growthColor(data.growth_pct), bold: true },
              { l: 'Weight Gain', v: `${fmt(data.weight_gain, 4)} ct` },
            ].map((f, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)' }}>
                <div style={{ fontSize: 10, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{f.l}</div>
                <div style={{ fontSize: 14, fontWeight: f.bold ? 700 : 500, color: f.color || 'var(--g900)' }}>{f.v}</div>
              </div>
            ))}
          </div>

          {/* Child rough lots */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--g600)', marginBottom: 8 }}>
              <Layers size={12} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--brand)' }} />
              Rough Lots Produced ({data.children?.length || 0})
            </div>
            {data.children?.length ? (
              <table className="dgrid" style={{ fontSize: '11.5px' }}>
                <thead><tr><th>Lot Number</th><th>Category</th><th>Weight</th><th>Qty</th><th>Status</th></tr></thead>
                <tbody>
                  {data.children.map((c, i) => (
                    <tr key={i}>
                      <td><span className="cell-link">{c.lot_number}</span></td>
                      <td>{c.category}</td>
                      <td className="num">{fmt(c.weight)}</td>
                      <td className="num">{c.qty} {c.unit}</td>
                      <td>{statusBadge(c.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ fontSize: 12, color: 'var(--g500)', padding: 12 }}>No rough lots produced yet — biscuit not split.</div>}
          </div>

          {/* Op history */}
          {data.history?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--g600)', marginBottom: 8 }}>
                <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--brand)' }} />
                History
              </div>
              <table className="dgrid" style={{ fontSize: '11px' }}>
                <thead><tr><th>When</th><th>Operation</th><th>Notes</th></tr></thead>
                <tbody>
                  {data.history.map((h, i) => (
                    <tr key={i}>
                      <td>{new Date(h.created_at).toLocaleString('en-IN')}</td>
                      <td>{h.operation}</td>
                      <td style={{ color: 'var(--g600)' }}>{h.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// List page — GET /api/growth-runs
// ════════════════════════════════════════════════════════════════════════════
export default function GrowthRunsPage() {
  const api = useApi();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', measured: '', machine: '' });
  const [measureRun, setMeasureRun] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const { openTab } = useTabs();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/growth-runs?limit=500');
      setData(r.data || []);
    } catch (err) { toast.error('Failed to load Growth Runs'); }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const machineOptions = useMemo(() => {
    const uniq = [...new Set(data.map(d => d.machine_name).filter(Boolean))].sort();
    return uniq.map(m => ({ id: m, name: m, code: '' }));
  }, [data]);

  const filteredData = useMemo(() => data.filter(d => {
    if (filters.status && d.status !== filters.status) return false;
    if (filters.machine && d.machine_name !== filters.machine) return false;
    if (filters.measured === 'measured'   && !(d.dim_height != null && d.weight != null)) return false;
    if (filters.measured === 'unmeasured' &&  (d.dim_height != null && d.weight != null)) return false;
    return true;
  }), [data, filters]);

  const isMeasured = r => r.dim_height != null && r.weight != null;

  const openLotWorkspace = (r) => {
    openTab({ id: `/inventory/lots/${r.id}`, name: r.lot_number, path: `/inventory/lots/${r.id}`, closable: true });
  };

  return (
    <div className="grid-page">
      <MeasureModal open={!!measureRun} run={measureRun} onClose={() => setMeasureRun(null)} onSaved={fetchData} />
      <DetailModal open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />

      <DataGrid
        exportTitle="Growth Runs"
        storageKey="growth_runs_cols"
        hideExportLabel
        onRefresh={fetchData}
        onRowDoubleClick={openLotWorkspace}
        filterFields={[
          { key: 'machine', label: 'Machine', type: 'searchable-select', options: machineOptions },
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'IN STOCK', label: 'In Stock' },
            { value: 'CONSUMED', label: 'Consumed' },
          ] },
          { key: 'measured', label: 'Measured', type: 'select', options: [
            { value: 'measured', label: 'Measured' },
            { value: 'unmeasured', label: 'Pending Measurement' },
          ] },
        ]}
        filters={filters}
        onFilterChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))}
        fetchExportData={async () => {
          const r = await api.get('/api/growth-runs?limit=10000');
          return r.data || [];
        }}
        columns={[
          { key: 'lot_number', label: 'Growth Run', width: 110, render: (v, r) => <span className="cell-link" onClick={() => openLotWorkspace(r)}>{v}</span> },
          { key: 'machine_code', label: 'Machine', width: 90, render: (v, r) => v || r.machine_name || '—' },
          { key: 'process_number', label: 'Process', width: 100, render: v => v || '—' },
          { key: 'parent_lot_number', label: 'Seed', width: 90, render: v => v || '—' },
          { key: 'seed_height_at_in', label: 'Seed Ht', width: 70, numeric: true, render: v => fmt(v) },
          { key: 'dim_height', label: 'Final Ht', width: 70, numeric: true, render: v => fmt(v) },
          { key: 'actual_growth_mm', label: 'Growth', width: 70, numeric: true, render: v => fmt(v) },
          { key: 'growth_pct', label: 'Growth %', width: 80, numeric: true,
            render: v => <span style={{ fontWeight: 700, color: growthColor(v) }}>{v == null ? '—' : `${parseFloat(v).toFixed(1)}%`}</span> },
          { key: 'qty', label: 'Qty', width: 70, numeric: true, render: (v, r) => v != null ? `${parseFloat(v).toFixed(0)} ${r.unit || 'pcs'}` : '—' },
          { key: 'weight', label: 'Weight (ct)', width: 85, numeric: true, render: v => fmt(v, 4) },
          { key: 'status', label: 'Status', width: 90, render: v => statusBadge(v) },
          { key: 'created_at', label: 'Created', width: 90, render: v => fmtDate(v) },
          { key: '_actions', label: 'Actions', width: 150, render: (_, r) => (
            <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setDetailId(r.id)}
                style={{ padding: '2px 8px', fontSize: 11, background: '#fff', border: '1px solid var(--g300)', color: 'var(--g700)', borderRadius: 4, cursor: 'pointer' }}
              >View</button>
              {r.status === 'IN STOCK' && (
                <button
                  onClick={() => setMeasureRun(r)}
                  style={{ padding: '2px 8px', fontSize: 11, background: isMeasured(r) ? '#fff' : 'var(--brand)', border: '1px solid var(--brand)', color: isMeasured(r) ? 'var(--brand-dark)' : '#fff', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                ><Ruler size={11} /> {isMeasured(r) ? 'Edit' : 'Measure'}</button>
              )}
            </div>
          ) },
        ]}
        data={filteredData}
        loading={loading}
      />
    </div>
  );
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import DataGrid from '../../../shared/components/DataGrid';
import DatePicker from '../../../shared/components/DatePicker';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import Modal from '../../../shared/components/Modal';
import { Save, Plus, Trash2, Gem, Leaf, Printer, Edit2 } from 'lucide-react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import toast from 'react-hot-toast';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
} from '../../../core/layout';

// ===== VIEW MODAL =====
function RoughGrowthViewModal({ open, onClose, id, onEdit }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !id) { setData(null); return; }
    setLoading(true);
    api.get(`/api/rough-growth/${id}`)
      .then(r => setData(r))
      .catch(() => toast.error('Failed to load details'))
      .finally(() => setLoading(false));
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtMoney = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data ? `Growth Entry — ${data.growth_number}` : 'Growth Entry Details'}
      icon={<Gem size={16} style={{ marginRight: 8, color: 'var(--brand)' }} />}
      large
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(id); }}>
            <Edit2 size={13} /> Edit
          </button>
        </div>
      }
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--g500)' }}>Loading…</div>
      )}
      {!loading && data && (
        <div>
          {/* Header summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { l: 'Growth ID', v: data.growth_number, bold: true, color: 'var(--brand)' },
              { l: 'Date', v: fmtDate(data.growth_date) },
              { l: 'Cycle No.', v: data.cycle_no },
              { l: 'Machine', v: data.machine_name || '—' },
              { l: 'Seed', v: data.seed_lot || '—' },
              { l: 'Status', v: <span className="badge b-stock">{data.status}</span> },
              { l: 'Total Lots', v: data.total_lots },
              { l: 'Total Weight', v: `${data.total_weight} ct` },
              { l: 'Cost / Carat', v: fmtMoney(data.cost_per_carat) },
              { l: 'Total Cost', v: fmtMoney(data.total_cost), bold: true },
            ].map((f, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)' }}>
                <div style={{ fontSize: 10, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{f.l}</div>
                <div style={{ fontSize: 14, fontWeight: f.bold ? 700 : 500, color: f.color || 'var(--g900)' }}>{f.v}</div>
              </div>
            ))}
          </div>

          {data.remark && (
            <div style={{ padding: '8px 12px', background: '#FFF9C4', border: '1px solid #F9E000', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
              <strong>Remark:</strong> {data.remark}
            </div>
          )}

          {/* Lots table */}
          {data.lines?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--g600)', marginBottom: 8 }}>
                <Gem size={12} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--brand)' }} />
                Rough Diamond Lots ({data.lines.length})
              </div>
              <table className="dgrid" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr><th>#</th><th>Lot Number</th><th>Weight (ct)</th><th>Size Ref</th><th>Shape</th><th>Color</th><th>Clarity</th><th>Remark</th></tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="num">{l.line_no}</td>
                      <td><span className="cell-link">{l.lot_number}</span></td>
                      <td className="num" style={{ fontWeight: 600 }}>{l.weight}</td>
                      <td>{l.size_ref}</td><td>{l.shape}</td><td>{l.color_est}</td><td>{l.clarity_est}</td>
                      <td style={{ color: 'var(--g500)', fontSize: 11 }}>{l.remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total:</td>
                    <td className="num" style={{ fontWeight: 700 }}>{data.lines.reduce((s, l) => s + parseFloat(l.weight || 0), 0).toFixed(2)}</td>
                    <td colSpan={5}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Cost breakdown */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--g600)', marginBottom: 8 }}>
              Cost Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {[
                { l: 'Seed', v: data.cost_seed },
                { l: 'Gas (CH₄+H₂)', v: data.cost_gas },
                { l: 'Electricity', v: data.cost_power },
                { l: 'Labour', v: data.cost_labour },
                { l: 'Consumables', v: data.cost_consumable },
                { l: 'Maintenance', v: data.cost_maintenance },
              ].map((c, i) => (
                <div key={i} style={{ padding: '6px 10px', background: '#fff', border: '1px solid var(--g200)', borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--g500)', marginBottom: 2 }}>{c.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{fmtMoney(c.v)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ===== ROUGH GROWTH LIST =====
export function RoughGrowthListPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', seed: '', machine: '', status: '' });
  const [viewId, setViewId] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/rough-growth');
      setData(r.data || []);
    } catch (err) { }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Unique option lists for Seed and Machine dropdowns
  const seedFilterOptions = useMemo(() => {
    const unique = [...new Set(data.map(d => d.seed_lot).filter(Boolean))].sort();
    return unique.map(s => ({ id: s, name: s, code: '' }));
  }, [data]);

  const machineFilterOptions = useMemo(() => {
    const unique = [...new Set(data.map(d => d.machine_name).filter(Boolean))].sort();
    return unique.map(m => ({ id: m, name: m, code: '' }));
  }, [data]);

  const toLocalYMD = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const filteredData = useMemo(() => {
    return data.filter(d => {
      const gd = toLocalYMD(d.growth_date);
      if (filters.date_from && gd < filters.date_from) return false;
      if (filters.date_to   && gd > filters.date_to)   return false;
      if (filters.seed    && d.seed_lot     !== filters.seed)    return false;
      if (filters.machine && d.machine_name !== filters.machine) return false;
      if (filters.status  && !(d.status || '').toLowerCase().includes(filters.status.toLowerCase())) return false;
      return true;
    });
  }, [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-page">

      <RoughGrowthViewModal
        open={!!viewId}
        id={viewId}
        onClose={() => setViewId(null)}
        onEdit={id => navigate(`/rough-growth/${id}`)}
      />

      <DataGrid
        exportTitle="Rough Growth"
        storageKey="rough_growth_cols"
        hideExportLabel
        onRefresh={fetchData}
        filterFields={[
          { key: 'seed', label: 'Seed', type: 'searchable-select', options: seedFilterOptions },
          { key: 'machine', label: 'Machine', type: 'searchable-select', options: machineFilterOptions },
          {
            key: 'status', label: 'Status', type: 'select', options: [
              { value: 'IN PROCESS', label: 'In Process' },
              { value: 'COMPLETED', label: 'Completed' },
            ]
          },
          { key: 'date_from', label: 'From Date', type: 'date' },
          { key: 'date_to', label: 'To Date', type: 'date' },
        ]}
        filters={filters}
        onFilterChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))}
        fetchExportData={async () => {
          const r = await api.get('/api/rough-growth?limit=10000');
          return r.data || [];
        }}
        columns={[
          { key: 'growth_number', label: 'Growth ID', width: 90, render: v => <span className="cell-link">{v}</span> },
          { key: 'growth_date', label: 'Date', width: 90, render: v => new Date(v).toLocaleDateString('en-IN') },
          { key: 'cycle_no', label: 'Cycle', width: 50, numeric: true },
          { key: 'seed_lot', label: 'Seed', width: 80 },
          { key: 'machine_name', label: 'Machine' },
          { key: 'total_lots', label: 'Lots', width: 50, numeric: true },
          { key: 'total_weight', label: 'Weight (ct)', width: 80, numeric: true },
          { key: 'cost_per_carat', label: 'Cost/ct', width: 90, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'total_cost', label: 'Total Cost', width: 100, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'status', label: 'Status', width: 90, render: v => <span className="badge b-stock">{v}</span> },
          {
            key: '_actions', label: 'Actions', width: 100, render: (_, r) => (
              <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setViewId(r.id)}
                  style={{ padding: '2px 8px', fontSize: '11px', background: '#fff', border: '1px solid var(--g300)', color: 'var(--g700)', borderRadius: '4px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >View</button>
                <button
                  onClick={() => navigate(`/rough-growth/${r.id}`)}
                  style={{ padding: '2px 8px', fontSize: '11px', background: '#fff', border: '1px solid var(--g300)', color: 'var(--g700)', borderRadius: '4px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >Edit</button>
              </div>
            )
          },
        ]}
        data={filteredData}
        loading={loading}
      />
    </div>
  );
}

// ===== ROUGH GROWTH FORM (Create + Edit) =====
export function RoughGrowthForm() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [machines, setMachines] = useState([]);
  const [depts, setDepts] = useState([]);
  const [seedsInProcess, setSeedsInProcess] = useState([]);
  const [seedHistory, setSeedHistory] = useState([]);
  const [selectedSeedFull, setSelectedSeedFull] = useState(null); // full inventory object for the info card
  const [saving, setSaving] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(isEdit);
  const [activeTab, setActiveTab] = useState('entry');

  // SearchableSelect value objects
  const [selMachine, setSelMachine] = useState(null);
  const [selSeed, setSelSeed] = useState(null);
  const [selDept, setSelDept] = useState(null);

  const [form, setForm] = useState({
    growth_date: new Date().toISOString().split('T')[0],
    cycle_no: 1, machine_id: '', seed_inventory_id: '', department_id: '', remark: '',
  });
  const [lines, setLines] = useState([
    { weight: '', size_ref: '3-4 ct', shape: 'Rough', color_est: 'D-E', clarity_est: 'VS Est.', remark: '' },
  ]);
  const [costs, setCosts] = useState({
    cost_seed: 800, cost_gas: 12500, cost_power: 18400,
    cost_labour: 3500, cost_consumable: 1600, cost_maintenance: 500,
  });

  // Derived option arrays for SearchableSelect
  const machineOptions = useMemo(() => machines.map(m => ({ id: m.id, name: m.name, code: m.code })), [machines]);
  const seedOptions = useMemo(() => seedsInProcess.map(s => ({
    id: s.id, name: s.item_name || s.lot_name || s.lot_number, code: s.lot_number,
  })), [seedsInProcess]);
  const deptOptions = useMemo(() => depts.map(d => ({ id: d.id, name: d.name, code: '' })), [depts]);

  // Load reference data
  useEffect(() => {
    api.get('/api/manufacturing/machines?limit=100')
      .then(r => setMachines((r.data || []).filter(m => m.machine_status === 'running')))
      .catch(() => { });
    api.get('/api/departments?limit=50').then(r => setDepts(r.data || [])).catch(() => { });
    api.get('/api/inventory?category=seed&status=IN PROCESS')
      .then(r => setSeedsInProcess(r.data || []))
      .catch(() => { });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing record for edit mode
  useEffect(() => {
    if (!isEdit) return;
    setLoadingRecord(true);
    api.get(`/api/rough-growth/${id}`)
      .then(r => {
        setForm({
          growth_date: r.growth_date?.split('T')[0] || '',
          cycle_no: r.cycle_no || 1,
          machine_id: r.machine_id || '',
          seed_inventory_id: r.seed_inventory_id || '',
          department_id: r.department_id || '',
          remark: r.remark || '',
        });
        setCosts({
          cost_seed: r.cost_seed || 0,
          cost_gas: r.cost_gas || 0,
          cost_power: r.cost_power || 0,
          cost_labour: r.cost_labour || 0,
          cost_consumable: r.cost_consumable || 0,
          cost_maintenance: r.cost_maintenance || 0,
        });
        if (r.lines?.length) {
          setLines(r.lines.map(l => ({
            line_no: l.line_no, lot_number: l.lot_number,
            weight: l.weight, size_ref: l.size_ref, shape: l.shape,
            color_est: l.color_est, clarity_est: l.clarity_est, remark: l.remark || '',
          })));
        }
        // Set locked SearchableSelect display values
        if (r.machine_id) setSelMachine({ id: r.machine_id, name: r.machine_name || '', code: '' });
        if (r.seed_inventory_id) {
          setSelSeed({ id: r.seed_inventory_id, name: r.seed_lot || '', code: r.seed_lot || '' });
          api.get(`/api/rough-growth/seed-history/${r.seed_inventory_id}`)
            .then(h => setSeedHistory(Array.isArray(h) ? h : []))
            .catch(() => { });
        }
        if (r.department_id) setSelDept({ id: r.department_id, name: r.department_name || '', code: '' });
      })
      .catch(() => toast.error('Failed to load growth record'))
      .finally(() => setLoadingRecord(false));
  }, [id, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMachineChange = useCallback((opt) => {
    setSelMachine(opt);
    setForm(p => ({ ...p, machine_id: opt?.id || '' }));
  }, []);

  const handleSeedChange = useCallback((opt) => {
    setSelSeed(opt);
    setForm(p => ({ ...p, seed_inventory_id: opt?.id || '' }));
    if (opt) {
      const full = seedsInProcess.find(s => s.id === opt.id);
      setSelectedSeedFull(full || null);
      api.get(`/api/rough-growth/seed-history/${opt.id}`)
        .then(h => setSeedHistory(Array.isArray(h) ? h : []))
        .catch(() => setSeedHistory([]));
    } else {
      setSelectedSeedFull(null);
      setSeedHistory([]);
    }
  }, [seedsInProcess]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeptChange = useCallback((opt) => {
    setSelDept(opt);
    setForm(p => ({ ...p, department_id: opt?.id || '' }));
  }, []);

  const addLine = () => setLines(p => [...p, { weight: '', size_ref: '1-2 ct', shape: 'Rough', color_est: 'D-E', clarity_est: 'VS Est.', remark: '' }]);
  const removeLine = (i) => { if (lines.length > 1) setLines(p => p.filter((_, j) => j !== i)); };
  const updateLine = (i, f, v) => setLines(p => p.map((l, j) => j === i ? { ...l, [f]: v } : l));

  const totalWeight = useMemo(() => lines.reduce((s, l) => s + (parseFloat(l.weight) || 0), 0), [lines]);
  const totalCost = useMemo(() => Object.values(costs).reduce((s, v) => s + (parseFloat(v) || 0), 0), [costs]);
  const costPerCarat = totalWeight > 0 ? Math.round(totalCost / totalWeight) : 0;

  const handleSave = async () => {
    if (isEdit) {
      setSaving(true);
      try {
        await api.put(`/api/rough-growth/${id}`, { ...form, ...costs, lines });
        toast.success('Growth entry updated');
        navigate('/rough-growth');
      } catch (err) { toast.error(err.message); }
      finally { setSaving(false); }
    } else {
      const validLines = lines.filter(l => parseFloat(l.weight) > 0);
      if (validLines.length === 0) return toast.error('Add at least one lot with weight');
      if (!form.seed_inventory_id) return toast.error('Select a seed');
      if (!form.machine_id) return toast.error('Select a machine');
      setSaving(true);
      try {
        const result = await api.post('/api/rough-growth', { ...form, ...costs, lines: validLines });
        toast.success(`${validLines.length} rough diamond lots created! Growth ${result.growth_number} saved.`);
        navigate('/rough-growth');
      } catch (err) { toast.error(err.message); }
      finally { setSaving(false); }
    }
  };

  const tabStyle = t => ({
    padding: '10px 18px', fontSize: '12.5px', fontWeight: activeTab === t ? 600 : 500,
    color: activeTab === t ? 'var(--tab-active)' : 'var(--g600)', cursor: 'pointer',
    borderBottom: activeTab === t ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -2,
  });

  // Phase 33: this form is now EDIT-ONLY (historical records). Direct rough
  // growth creation is disabled — Rough Output (Growth Run → Rough) is the single
  // rough creation path. Any attempt to open create mode redirects there.
  if (!isEdit) {
    return <Navigate to="/manufacturing/growth-output" replace />;
  }

  if (loadingRecord) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--g500)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={isEdit ? 'Edit Rough Growth Entry' : 'New Rough Growth Entry'}
          icon={<Gem size={18} />}
          breadcrumbs={[
            { label: 'Operations', href: '/rough-growth' },
            { label: 'Rough Growth', href: '/rough-growth' },
            { label: isEdit ? 'Edit Entry' : 'New Entry' },
          ]}
          backTo="/rough-growth"
          backLabel="Rough Growth"
        />
      }
      footer={
        <StickyActionFooter
          left={<button className="btn" onClick={() => navigate('/rough-growth')}>Close</button>}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              {!isEdit && <button className="btn btn-sm"><Printer size={13} /> Save &amp; Print</button>}
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                <Save size={13} />
                {saving
                  ? (isEdit ? 'Saving…' : 'Creating…')
                  : isEdit
                    ? 'Save Changes'
                    : `Save — Create ${lines.filter(l => parseFloat(l.weight) > 0).length} Rough Lots`}
              </button>
            </div>
          }
        />
      }
    >
      {/* TABS */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--g200)', background: 'var(--g50)', margin: '-14px -16px 10px', padding: '0 16px' }}>
        <div style={tabStyle('entry')} onClick={() => setActiveTab('entry')}>Growth Entry</div>
        <div style={tabStyle('cost')} onClick={() => setActiveTab('cost')}>Cost Calculation</div>
        <div style={tabStyle('history')} onClick={() => setActiveTab('history')}>Growth History</div>
      </div>

      <div>
        {/* ── ENTRY TAB ── */}
        {activeTab === 'entry' && (
          <div style={{ maxWidth: 1000 }}>
            {/* Pipeline tracker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'var(--brand-50)', borderRadius: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {['Seed In Process', 'CVD Growth', 'Rough Growth Entry', 'Rough In Stock', 'Ready for Sale'].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '2px solid',
                    borderColor: i <= 1 ? 'var(--green)' : i === 2 ? 'var(--brand)' : 'var(--g300)',
                    background: i <= 1 ? '#E8F5E9' : i === 2 ? '#fff' : 'transparent',
                    color: i <= 1 ? 'var(--green)' : i === 2 ? 'var(--brand-dark)' : 'var(--g500)',
                  }}>
                    {i <= 1 ? '✓ ' : i === 2 ? '◆ ' : ''}{s}
                  </div>
                  {i < 4 && <span style={{ color: 'var(--g400)', fontSize: 12 }}>→</span>}
                </div>
              ))}
            </div>

            {/* Growth header fields */}
            <div style={{ background: 'var(--brand-50)', border: '1px solid var(--sidebar-border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 10 }}>
                Growth Header
              </div>
              <div className="form-row">
                <div className="fg">
                  <label>Date *</label>
                  <DatePicker value={form.growth_date} onChange={v => setForm(p => ({ ...p, growth_date: v }))} />
                </div>
                <div className="fg">
                  <label>Cycle No.</label>
                  <input type="number" value={form.cycle_no} onChange={e => setForm(p => ({ ...p, cycle_no: e.target.value }))} min={1} />
                </div>
                <div className="fg w">
                  <label>Machine {!isEdit && '*'}</label>
                  {isEdit ? (
                    <div style={{ padding: '7px 10px', background: 'var(--g100)', border: '1px solid var(--g200)', borderRadius: 4, fontSize: 13, color: 'var(--g700)' }}>
                      {selMachine?.name || '—'}
                    </div>
                  ) : (
                    <SearchableSelect
                      value={selMachine}
                      onChange={handleMachineChange}
                      options={machineOptions}
                      placeholder={machineOptions.length === 0 ? 'No machines currently running' : 'Search running machine…'}
                      disabled={machineOptions.length === 0}
                    />
                  )}
                </div>
              </div>
              <div className="form-row">
                <div className="fg w">
                  <label>Seed (In Process Only) {!isEdit && '*'}</label>
                  {isEdit ? (
                    <div style={{ padding: '7px 10px', background: 'var(--g100)', border: '1px solid var(--g200)', borderRadius: 4, fontSize: 13, color: 'var(--g700)' }}>
                      {selSeed?.name || selSeed?.code || '—'}
                    </div>
                  ) : (
                    <SearchableSelect
                      value={selSeed}
                      onChange={handleSeedChange}
                      options={seedOptions}
                      placeholder="Search seed in process…"
                    />
                  )}
                </div>
                <div className="fg">
                  <label>Department</label>
                  <SearchableSelect
                    value={selDept}
                    onChange={handleDeptChange}
                    options={deptOptions}
                    placeholder="Search department…"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="fg w">
                  <label>Remark</label>
                  <input value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} placeholder="Growth observations, quality notes" />
                </div>
              </div>
            </div>

            {/* Seed info card (create mode only) */}
            {!isEdit && selectedSeedFull && (
              <div style={{ display: 'flex', gap: 16, padding: 12, background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 32, height: 32, background: '#2E7D32', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <Leaf size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedSeedFull.lot_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--g500)' }}>{selectedSeedFull.item_name}</div>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid var(--g200)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--g500)' }}>Weight</div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)' }}>{selectedSeedFull.qty} {selectedSeedFull.unit}</div>
                </div>
                <div style={{ borderLeft: '1px solid var(--g200)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--g500)' }}>Previous Cycles</div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)' }}>{seedHistory.length}</div>
                </div>
                <div style={{ borderLeft: '1px solid var(--g200)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--g500)' }}>Total Yielded</div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand)' }}>
                    {seedHistory.reduce((s, h) => s + parseFloat(h.total_weight || 0), 0).toFixed(2)} ct
                  </div>
                </div>
                <div style={{ marginLeft: 'auto' }}><span className="badge b-process">IN PROCESS</span></div>
              </div>
            )}

            {/* Line items */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--g600)', textTransform: 'uppercase' }}>
                <Gem size={14} style={{ color: 'var(--brand)', verticalAlign: 'middle', marginRight: 4 }} />
                Rough diamond lots ({lines.length})
              </label>
              {!isEdit && <button className="btn btn-sm" onClick={addLine}><Plus size={12} /> Add Lot</button>}
            </div>

            <table className="je-lines-table">
              <thead>
                <tr>
                  <th>#</th>
                  {isEdit && <th>Lot Number</th>}
                  <th style={{ width: 80 }}>Weight (ct)</th>
                  <th>Size Ref</th><th>Shape</th><th>Color Est.</th><th>Clarity Est.</th><th>Remark</th>
                  {!isEdit && <th style={{ width: 36 }}></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'center', color: 'var(--g500)' }}>{i + 1}</td>
                    {isEdit && <td><span className="cell-link" style={{ fontSize: 11 }}>{l.lot_number}</span></td>}
                    <td>
                      <input type="number" className="je-cell-input je-num-input" value={l.weight} onChange={e => updateLine(i, 'weight', e.target.value)} step="0.01" placeholder="0.00" style={{ fontWeight: 600 }} />
                    </td>
                    <td>
                      <SelectDropdown className="je-cell-input" value={l.size_ref} onChange={e => updateLine(i, 'size_ref', e.target.value)}>
                        <option>0.5-1 ct</option><option>1-2 ct</option><option>2-3 ct</option>
                        <option>3-4 ct</option><option>4-5 ct</option><option>5+ ct</option>
                      </SelectDropdown>
                    </td>
                    <td>
                      <SelectDropdown className="je-cell-input" value={l.shape} onChange={e => updateLine(i, 'shape', e.target.value)}>
                        <option>Rough</option><option>Makeable</option><option>Sawable</option><option>Cleavage</option>
                      </SelectDropdown>
                    </td>
                    <td>
                      <SelectDropdown className="je-cell-input" value={l.color_est} onChange={e => updateLine(i, 'color_est', e.target.value)}>
                        <option>D-E</option><option>F-G</option><option>H-I</option><option>J-K</option><option>L-M</option><option>Fancy</option>
                      </SelectDropdown>
                    </td>
                    <td>
                      <SelectDropdown className="je-cell-input" value={l.clarity_est} onChange={e => updateLine(i, 'clarity_est', e.target.value)}>
                        <option>VVS Est.</option><option>VS Est.</option><option>SI Est.</option><option>I Est.</option>
                      </SelectDropdown>
                    </td>
                    <td>
                      <input className="je-cell-input" value={l.remark || ''} onChange={e => updateLine(i, 'remark', e.target.value)} placeholder="Note" />
                    </td>
                    {!isEdit && (
                      <td>{lines.length > 1 && <button className="icon-btn" onClick={() => removeLine(i)} style={{ color: 'var(--red)' }}><Trash2 size={12} /></button>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              {[
                { v: lines.filter(l => parseFloat(l.weight) > 0).length, l: 'Total Lots', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)', c: 'var(--brand-dark)' },
                { v: `${totalWeight.toFixed(2)} ct`, l: 'Total Weight', bg: '#E3F2FD', bc: '#90CAF9', c: '#0D47A1' },
                { v: `₹${costPerCarat.toLocaleString('en-IN')}/ct`, l: 'Est. Cost/Carat', bg: '#FFF3E0', bc: '#FFCC80', c: '#E65100' },
                { v: `₹${totalCost.toLocaleString('en-IN')}`, l: 'Total Cost', bg: '#E8F5E9', bc: '#A5D6A7', c: '#2E7D32' },
              ].map((c, i) => (
                <div key={i} style={{ flex: 1, minWidth: 140, padding: 12, background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.c, fontFamily: 'var(--mono)' }}>{c.v}</div>
                  <div style={{ fontSize: 10, color: c.c, fontWeight: 600, textTransform: 'uppercase' }}>{c.l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── COST TAB ── */}
        {activeTab === 'cost' && (
          <div style={{ maxWidth: 700 }}>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginBottom: 14, padding: 10, background: 'var(--brand-50)', borderRadius: 8 }}>
              {isEdit ? 'Update cost breakdown if needed — totals and cost/carat will recalculate.' : 'Cost is auto-filled with estimates. Override any value with actual amounts.'}
            </div>
            <table className="dgrid" style={{ fontSize: '12.5px' }}>
              <thead>
                <tr><th style={{ width: '40%' }}>Cost Component</th><th style={{ width: '20%' }}>Amount (₹)</th><th style={{ width: '20%' }}>Per Carat</th><th style={{ width: '20%' }}>% of Total</th></tr>
              </thead>
              <tbody>
                {[
                  { key: 'cost_seed', label: 'Seed cost (proportional)' },
                  { key: 'cost_gas', label: 'Gas consumed (CH₄ + H₂)' },
                  { key: 'cost_power', label: 'Electricity / power' },
                  { key: 'cost_labour', label: 'Direct labour' },
                  { key: 'cost_consumable', label: 'Consumables' },
                  { key: 'cost_maintenance', label: 'Machine maintenance' },
                ].map(c => {
                  const amt = parseFloat(costs[c.key]) || 0;
                  const pc = totalWeight > 0 ? Math.round(amt / totalWeight) : 0;
                  const pct = totalCost > 0 ? ((amt / totalCost) * 100).toFixed(1) : '0';
                  return (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td><input type="number" value={costs[c.key]} onChange={e => setCosts(p => ({ ...p, [c.key]: e.target.value }))} style={{ width: 100, textAlign: 'right', padding: '4px 8px', border: '1px solid var(--g300)', borderRadius: 'var(--radius)' }} /></td>
                      <td className="num">₹{pc.toLocaleString('en-IN')}</td>
                      <td className="num">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--brand-50)' }}>
                  <td style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>Total</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--brand-dark)', fontSize: 14 }}>₹{totalCost.toLocaleString('en-IN')}</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--brand-dark)', fontSize: 14 }}>₹{costPerCarat.toLocaleString('en-IN')}/ct</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>100%</td>
                </tr>
              </tfoot>
            </table>
            <div style={{ marginTop: 14, padding: 12, background: '#E8F5E9', borderRadius: 8, fontSize: 12, color: 'var(--green)' }}>
              <strong>Auto JE:</strong> Dr. Rough Diamond Inventory (2004) ₹{totalCost.toLocaleString('en-IN')} → Cr. Work-in-Progress (2005)
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'history' && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginBottom: 10 }}>
              {selectedSeedFull
                ? `Growth history for seed ${selectedSeedFull.lot_number}`
                : selSeed
                  ? `Growth history for seed ${selSeed.code || selSeed.name}`
                  : 'Select a seed to view its growth history'}
            </div>
            {seedHistory.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}><Leaf size={32} /><p>No previous growth entries for this seed</p></div>
            ) : (
              <table className="dgrid" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr><th>Growth ID</th><th>Date</th><th>Cycle</th><th>Machine</th><th>Lots</th><th>Weight (ct)</th><th>Cost/ct</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {seedHistory.map((h, i) => (
                    <tr key={i}>
                      <td className="cell-link">{h.growth_number}</td>
                      <td>{new Date(h.growth_date).toLocaleDateString('en-IN')}</td>
                      <td className="num">{h.cycle_no}</td>
                      <td>{h.machine_name}</td>
                      <td className="num">{h.total_lots}</td>
                      <td className="num">{h.total_weight}</td>
                      <td className="num">₹{Number(h.cost_per_carat || 0).toLocaleString('en-IN')}</td>
                      <td><span className="badge b-stock">{h.status}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Totals:</td>
                    <td className="num" style={{ fontWeight: 700 }}>{seedHistory.reduce((s, h) => s + (h.total_lots || 0), 0)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{seedHistory.reduce((s, h) => s + parseFloat(h.total_weight || 0), 0).toFixed(2)} ct</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>
    </TransactionPageLayout>
  );
}

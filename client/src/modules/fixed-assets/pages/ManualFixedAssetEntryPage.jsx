import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import {
  Save, Landmark, Info, ShoppingCart,
  Building2, BookOpen, TrendingDown, Search, Plus, X, ChevronLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FormSectionCard } from '../../../core/layout';
import DatePicker from '../../../shared/components/DatePicker';
import SelectDropdown from '../../../shared/components/SelectDropdown';

const num   = v => Number(v || 0);
const round = v => Math.round((v || 0) * 100) / 100;
const fmt   = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];

// ── Template Typeahead ─────────────────────────────────────────────────────────
// Manages: search, dropdown, inline-add, instance-name override after selection.
// Props:
//   templates    – array of template objects
//   cats         – asset categories for inline-add form
//   selected     – currently selected template object (or null)
//   assetName    – current asset_name value
//   onSelect(tpl, name) – called when user picks a template
//   onClear()           – called when user clears selection
//   onNameChange(name)  – called when instance-name override changes
function TemplateTypeahead({ templates, cats, uoms, selected, assetName, onSelect, onClear, onNameChange }) {
  const [query,   setQuery]   = useState(selected ? selected.name : '');
  const [open,    setOpen]    = useState(false);
  const [adding,  setAdding]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [newTpl,  setNewTpl]  = useState({
    name: '', category_id: '', default_brand: '', default_manufacturer: '',
    default_model_no: '', default_uom_id: '', description: '', status: 'active'
  });
  const { post } = useApi();
  const wrapRef  = useRef(null);

  useEffect(() => { setQuery(selected ? selected.name : ''); }, [selected]);

  useEffect(() => {
    const handler = e => {
      if (adding) return; // don't close dropdown if modal is open
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        // restore query to selected name if user typed but didn't pick
        setQuery(selected ? selected.name : '');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected, adding]);

  const filtered = useMemo(() => {
    const active = templates.filter(t => t.status === 'active');
    if (!query.trim()) return active.slice(0, 12);
    const q = query.toLowerCase();
    return active.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      (t.default_brand || '').toLowerCase().includes(q) ||
      t.category_name.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [templates, query]);

  const pickTemplate = tpl => {
    onSelect(tpl, tpl.name);
    setQuery(tpl.name);
    setOpen(false);
    setAdding(false);
  };

  const clearSelection = () => {
    onClear();
    setQuery('');
    setOpen(false);
  };

  const handleInput = e => {
    setQuery(e.target.value);
    setOpen(true);
    if (selected) onClear();
  };

  const saveNewTemplate = async () => {
    if (!newTpl.name.trim())  return toast.error('Template name required');
    if (!newTpl.category_id)  return toast.error('Category required');
    setSaving(true);
    try {
      const created = await post('/api/asset-templates', {
        name:                 newTpl.name.trim(),
        category_id:          parseInt(newTpl.category_id),
        default_brand:        newTpl.default_brand        || undefined,
        default_manufacturer: newTpl.default_manufacturer || undefined,
        default_model_no:     newTpl.default_model_no     || undefined,
        default_uom_id:       newTpl.default_uom_id ? parseInt(newTpl.default_uom_id) : undefined,
        description:          newTpl.description          || undefined,
        status:               newTpl.status               || 'active',
      });
      const cat = cats.find(c => String(c.id) === String(created.category_id));
      templates.push({ ...created, category_name: cat?.name || '' });
      toast.success(`Template "${created.name}" created`);
      pickTemplate({ ...created, category_name: cat?.name || '' });
      setNewTpl({
        name: '', category_id: '', default_brand: '', default_manufacturer: '',
        default_model_no: '', default_uom_id: '', description: '', status: 'active'
      });
    } catch (err) {
      toast.error(err.message || 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  const hasTemplates = templates.filter(t => t.status === 'active').length > 0;
  const selCat = cats.find(c => String(c.id) === String(newTpl.category_id));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>

      {/* ── Search input ── */}
      <div style={{ position: 'relative' }}>
        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%',
          transform: 'translateY(-50%)', color: 'var(--g400)', pointerEvents: 'none' }} />
        <input
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder={hasTemplates ? 'Search template... (e.g. Hydrogen Diffusion Purifier)' : 'No templates yet — click to add one'}
          style={{
            paddingLeft: 26, paddingRight: selected ? 28 : 8,
            width: '100%', fontSize: 12,
            borderColor: selected ? 'var(--brand)' : undefined,
          }}
        />
        {selected && (
          <button onMouseDown={clearSelection}
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                     background: 'none', border: 'none', cursor: 'pointer',
                     color: 'var(--g400)', display: 'flex', padding: 2 }}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {open && !adding && (
        <div style={{
          position: 'absolute', zIndex: 300, top: 'calc(100% + 3px)', left: 0, right: 0,
          // Explicit white — avoids var(--surface) transparency issues
          backgroundColor: '#ffffff',
          border: '1px solid #d1d5db',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {/* Template list */}
          {filtered.length > 0 ? (
            filtered.map(tpl => (
              <div key={tpl.id} onMouseDown={() => pickTemplate(tpl)}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                         borderBottom: '1px solid #f3f4f6' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9fafb'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: 600, color: '#111827' }}>{tpl.name}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1, display: 'flex', gap: 8 }}>
                  <span>{tpl.category_name}</span>
                  {tpl.default_brand && <span>· {tpl.default_brand}</span>}
                  <span style={{ fontFamily: 'monospace' }}>{tpl.code}</span>
                </div>
              </div>
            ))
          ) : (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>
              {hasTemplates ? `No templates match "${query}"` : 'No templates created yet'}
            </div>
          )}

          {/* Add new template */}
          <div onMouseDown={() => { setAdding(true); setNewTpl(p => ({ ...p, name: query.trim() })); }}
            style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                     color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 5,
                     borderTop: '1px solid #e5e7eb' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9fafb'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Plus size={12} /> Add new template{query.trim() ? ` "${query.trim()}"` : ''}
          </div>
        </div>
      )}

      {/* ── Modal add-template form ── */}
      {adding && (
        <div className="modal-overlay" style={{ zIndex: 1000 }} onMouseDown={e => e.stopPropagation()}>
          <div className="modal animate-in" style={{ width: 420 }}>
            <div className="modal-header">
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--g900)' }}>New Template</h3>
              <button type="button" onClick={() => setAdding(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g400)' }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="fg">
                <label>Template Name *</label>
                <input value={newTpl.name} onChange={e => setNewTpl(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Hydrogen Diffusion Purifier" autoFocus />
              </div>
              <div className="fg">
                <label>Asset Category *</label>
                <SelectDropdown value={newTpl.category_id} onChange={e => setNewTpl(p => ({ ...p, category_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectDropdown>
              </div>
              <div className="form-row" style={{ gap: 10, marginBottom: 0 }}>
                <div className="fg" style={{ flex: 1 }}><label>Brand</label><input value={newTpl.default_brand} onChange={e => setNewTpl(p => ({ ...p, default_brand: e.target.value }))} placeholder="e.g. Siemens" /></div>
                <div className="fg" style={{ flex: 1 }}><label>Model No</label><input value={newTpl.default_model_no} onChange={e => setNewTpl(p => ({ ...p, default_model_no: e.target.value }))} placeholder="Default model" /></div>
              </div>
              <div className="fg">
                <label>Manufacturer</label>
                <input value={newTpl.default_manufacturer} onChange={e => setNewTpl(p => ({ ...p, default_manufacturer: e.target.value }))} placeholder="Company name" />
              </div>
              <div className="fg">
                <label>Default UOM</label>
                <SelectDropdown value={newTpl.default_uom_id} onChange={e => setNewTpl(p => ({ ...p, default_uom_id: e.target.value }))}>
                  <option value="">NOS (default)</option>
                  {uoms && uoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
                </SelectDropdown>
              </div>
              <div className="form-row" style={{ gap: 10, marginBottom: 0 }}>
                <div className="fg" style={{ flex: 1 }}><label>Useful Life (Years)</label><input value={selCat?.useful_life_years || ''} placeholder="From category" readOnly /></div>
                <div className="fg" style={{ flex: 1 }}><label>Depr Rate (%)</label><input value={selCat?.depreciation_rate_pct || ''} placeholder="From category" readOnly /></div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input value={newTpl.description} onChange={e => setNewTpl(p => ({ ...p, description: e.target.value }))} placeholder="Brief description of asset type" />
              </div>
              <div className="fg">
                <label>Status</label>
                <SelectDropdown value={newTpl.status} onChange={e => setNewTpl(p => ({ ...p, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </SelectDropdown>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)', fontSize: 10, color: 'var(--g500)', lineHeight: 1.4 }}>
                Useful life and depreciation rate on a template are reference defaults only. Actual accounting is always controlled by the Asset Category GL accounts.
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0, paddingBottom: 16 }}>
              <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveNewTemplate} disabled={saving}>
                {saving ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Selected state — chip + instance name override ── */}
      {selected && (
        <div style={{ marginTop: 6, padding: '7px 10px', background: '#EEF2FF',
                      borderRadius: 6, border: '1px solid #C7D2FE' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#312E81' }}>✓ {selected.name}</span>
            <span style={{ fontSize: 10, color: '#6366F1', background: '#E0E7FF',
                           padding: '1px 6px', borderRadius: 4 }}>{selected.category_name}</span>
            {selected.default_brand && (
              <span style={{ fontSize: 10, color: '#8B5CF6' }}>{selected.default_brand}</span>
            )}
            <span style={{ fontSize: 10, color: '#A5B4FC', fontFamily: 'monospace' }}>{selected.code}</span>
          </div>
          {/* Optional instance name override — only shown after template selection */}
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: '#6366F1', display: 'block', marginBottom: 2 }}>
              Instance name override <span style={{ fontWeight: 400 }}>(leave as-is unless this unit has a different name)</span>
            </label>
            <input
              value={assetName}
              onChange={e => onNameChange(e.target.value)}
              style={{ fontSize: 12, width: '100%', padding: '4px 8px',
                       background: 'rgba(255,255,255,0.7)', border: '1px solid #C7D2FE',
                       borderRadius: 5 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN FORM
// ══════════════════════════════════════════════════════════════════════════════
export default function ManualFixedAssetEntry() {
  const { get, post } = useApi();
  const navigate      = useNavigate();
  const { user }      = useAuth();

  const [cats,        setCats]        = useState([]);
  const [templates,   setTemplates]   = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [locs,        setLocs]        = useState([]);
  const [depts,       setDepts]       = useState([]);
  const [uoms,        setUoms]        = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [selectedTpl, setSelectedTpl] = useState(null);

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    template_id: '',
    asset_name: '', category_id: '',
    serial_no: '', model_no: '', brand: '', manufacturer: '',
    asset_tag: '', condition: 'new', qty: '1', uom_id: '',
    vendor_id: '', invoice_no: '',
    purchase_date: today, in_service_date: today, invoice_date: today,
    installation_date: '', warranty_expiry: '',
    taxable_value: '', gst_rate: '18', gst_type: 'intra',
    cgst_amount: '0', sgst_amount: '0', igst_amount: '0',
    gst_treatment: 'non_claimable', gst_claimable_amount: '0', gst_non_claimable_amount: '0',
    total_invoice_value: '', purchase_cost: '', salvage_value: '0',
    accumulated_depreciation: '0',
    location_id: '', department_id: '', custodian: '', remarks: '',
    cost_center_id: '',
  });

  useEffect(() => {
    Promise.all([
      get('/api/fixed-asset-categories?status=active'),
      get('/api/asset-templates?status=active&limit=500'),
      get('/api/vendors?limit=200'),
      get('/api/locations?limit=100'),
      get('/api/departments?limit=100'),
      get('/api/uom'),
      get('/api/cost-centers'),
    ]).then(([c, t, v, l, d, u, cc]) => {
      setCats(c.data || []);
      setTemplates(t.data || []);
      setVendors(v.data || []);
      setLocs(l.data || []);
      setDepts(d.data || []);
      setUoms(u.data || []);
      setCostCenters(cc.data || []);
    }).catch(() => toast.error('Failed to load form data'));
  }, []);

  if (!['admin', 'super_admin'].includes(user?.role)) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ padding: 12, background: '#FFEBEE', borderRadius: 8, color: 'var(--red)', fontSize: 13 }}>
          Admin access required.
        </div>
      </div>
    );
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleTemplateSelect = (tpl, name) => {
    setSelectedTpl(tpl);
    setForm(prev => ({
      ...prev,
      template_id:  String(tpl.id),
      asset_name:   name || tpl.name,
      category_id:  String(tpl.category_id),
      brand:        tpl.default_brand        || prev.brand,
      manufacturer: tpl.default_manufacturer || prev.manufacturer,
      model_no:     tpl.default_model_no     || prev.model_no,
      uom_id:       tpl.default_uom_id ? String(tpl.default_uom_id) : prev.uom_id,
    }));
  };

  const handleTemplateClear = () => {
    setSelectedTpl(null);
    setForm(prev => ({ ...prev, template_id: '', asset_name: '' }));
  };

  const recalcGst = (patch = {}) => {
    setForm(prev => {
      const next     = { ...prev, ...patch };
      const taxable  = num(next.taxable_value);
      const rate     = num(next.gst_rate);
      const totalGst = round(taxable * rate / 100);
      const cgst     = next.gst_type === 'intra' ? round(totalGst / 2) : 0;
      const sgst     = next.gst_type === 'intra' ? round(totalGst / 2) : 0;
      const igst     = next.gst_type === 'inter' ? totalGst : 0;
      const invoiceTotal = round(taxable + totalGst);
      let claimable    = next.gst_claimable_amount;
      let nonClaimable = next.gst_non_claimable_amount;
      if (next.gst_treatment === 'claimable')         { claimable = String(totalGst); nonClaimable = '0'; }
      else if (next.gst_treatment === 'non_claimable') { claimable = '0'; nonClaimable = String(totalGst); }
      return {
        ...next,
        cgst_amount: String(cgst), sgst_amount: String(sgst), igst_amount: String(igst),
        total_invoice_value: String(invoiceTotal),
        purchase_cost: String(invoiceTotal),
        gst_claimable_amount: claimable,
        gst_non_claimable_amount: nonClaimable,
      };
    });
  };

  const selectedCat = useMemo(
    () => cats.find(c => String(c.id) === String(form.category_id)),
    [cats, form.category_id]
  );

  const jePreviewLines = useMemo(() => {
    if (!selectedCat || !num(form.purchase_cost)) return null;
    const cost = round(num(form.purchase_cost));
    return [
      { side: 'Dr', account: `${selectedCat.gl_asset_code || '—'} ${selectedCat.gl_asset_name || selectedCat.name}`, amount: cost },
      { side: 'Cr', account: '3001 Accounts Payable', amount: cost },
    ];
  }, [selectedCat, form.purchase_cost]);

  const handleSave = async () => {
    if (!form.asset_name)    return toast.error('Asset name required — select a template or enter manually');
    if (!form.category_id)   return toast.error('Asset category required');
    if (!form.purchase_cost) return toast.error('Purchase cost required');
    if (num(form.salvage_value) > num(form.purchase_cost))
      return toast.error('Salvage value cannot exceed purchase cost');

    setSaving(true);
    try {
      const r = await post('/api/fixed-assets', form);
      toast.success(`Asset ${r.asset_code} created — JE ${r.je_number} posted`);
      navigate('/assets');
    } catch (err) {
      toast.error(err.message || 'Failed to create asset');
    } finally {
      setSaving(false);
    }
  };

  // ── Shared row style ──
  const row = { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' };
  const fg  = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 120 };

  return (
    <div className="grid-page animate-in">
      
      <div style={{ padding: 16 }}>
      {/* ── Two-column layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* ════════════════ LEFT COLUMN ════════════════ */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ASSET INFORMATION */}
          <FormSectionCard title="Asset Information" icon={<Info size={14} />}>

            {/* Template typeahead */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', margin: 0 }}>
                  Search Asset Template
                </label>
                <button type="button" onClick={() => navigate('/asset-templates')}
                  style={{ fontSize: 10, color: 'var(--brand)', background: 'none',
                           border: 'none', cursor: 'pointer', padding: 0 }}>
                  Manage Templates →
                </button>
              </div>
              <TemplateTypeahead
                templates={templates}
                cats={cats}
                uoms={uoms}
                selected={selectedTpl}
                assetName={form.asset_name}
                onSelect={handleTemplateSelect}
                onClear={handleTemplateClear}
                onNameChange={v => set('asset_name', v)}
              />
            </div>

            {/* Asset Name */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', display: 'block', marginBottom: 3 }}>
                Asset Name {!selectedTpl && <span style={{ fontWeight: 400, color: 'var(--g400)' }}>(e.g. CVD Laser Cutter LS-500)</span>}
              </label>
              <input
                value={form.asset_name}
                onChange={e => set('asset_name', e.target.value)}
                placeholder="e.g. CVD Laser Cutter Cutter LS-500"
                style={{ fontSize: 12, width: '100%' }}
              />
            </div>

            {/* Category + Condition */}
            <div style={row}>
              <div style={{ ...fg, flex: 2 }}>
                <label>Category</label>
                <SelectDropdown value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                  <option value="">— Select Category —</option>
                  {cats.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}) · {c.depreciation_rate_pct}% {c.depreciation_method}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
              <div style={fg}>
                <label>Condition</label>
                <SelectDropdown value={form.condition} onChange={e => set('condition', e.target.value)}>
                  {CONDITIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </SelectDropdown>
              </div>
            </div>

            {/* Serial No + Model No + Asset Tag */}
            <div style={row}>
              <div style={fg}>
                <label>Serial No</label>
                <input value={form.serial_no} onChange={e => set('serial_no', e.target.value)} placeholder="SN" />
              </div>
              <div style={fg}>
                <label>Model No</label>
                <input value={form.model_no} onChange={e => set('model_no', e.target.value)} placeholder="12-hp-456" />
              </div>
              <div style={fg}>
                <label>Asset Tag (Barcode / RFID)</label>
                <input value={form.asset_tag} onChange={e => set('asset_tag', e.target.value)} placeholder="Barcode / RFID" />
              </div>
            </div>

            {/* Brand + Manufacturer + Qty + UOM */}
            <div style={row}>
              <div style={fg}>
                <label>Brand</label>
                <input value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="e.g. hp" />
              </div>
              <div style={fg}>
                <label>Manufacturer</label>
                <input value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} placeholder="Company name" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 0.5, minWidth: 60 }}>
                <label>Qty</label>
                <input type="number" min="0.01" step="0.01" value={form.qty}
                  onChange={e => set('qty', e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 0.7, minWidth: 80 }}>
                <label>UOM</label>
                <SelectDropdown value={form.uom_id} onChange={e => set('uom_id', e.target.value)}>
                  <option value="">NOS</option>
                  {uoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
                </SelectDropdown>
              </div>
            </div>
          </FormSectionCard>

          {/* DEPRECIATION SETTINGS */}
          <FormSectionCard title="Depreciation Settings" icon={<TrendingDown size={14} />}>
            {/* Method + Rate + Life in a row of inputs */}
            <div style={row}>
              <div style={fg}>
                <label>Depreciation Method</label>
                <input
                  value={selectedCat ? (selectedCat.depreciation_method === 'SLM' ? 'Straight Line' : 'Written Down Value') : ''}
                  placeholder="Select category first"
                  readOnly
                  style={{ background: 'var(--g50)', color: selectedCat ? 'var(--g800)' : 'var(--g400)' }}
                />
              </div>
              <div style={fg}>
                <label>Depreciation Rate (% p.a.)</label>
                <input
                  value={selectedCat?.depreciation_rate_pct ?? ''}
                  placeholder="—"
                  readOnly
                  style={{ background: 'var(--g50)', color: selectedCat ? 'var(--g800)' : 'var(--g400)' }}
                />
              </div>
              <div style={fg}>
                <label>Estimated Life (Yrs)</label>
                <input
                  value={selectedCat?.useful_life_years ?? ''}
                  placeholder="—"
                  readOnly
                  style={{ background: 'var(--g50)', color: selectedCat ? 'var(--g800)' : 'var(--g400)' }}
                />
              </div>
            </div>

            {/* Opening Accumulated Depreciation */}
            <div>
              <label>Opening Accumulated Depreciation</label>
              <div style={{ position: 'relative', maxWidth: 200 }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                               fontSize: 12, color: 'var(--g500)', pointerEvents: 'none' }}>₹</span>
                <input
                  type="number"
                  value={form.accumulated_depreciation}
                  onChange={e => set('accumulated_depreciation', e.target.value)}
                  placeholder="0.00"
                  style={{ paddingLeft: 22 }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 4 }}>
                Leave 0 for new assets. Enter existing balance only for opening-balance migration.
              </div>
            </div>
          </FormSectionCard>

        </div>

        {/* ════════════════ RIGHT COLUMN ════════════════ */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* PURCHASE DETAILS */}
          <FormSectionCard title="Purchase Details" icon={<ShoppingCart size={14} />}>

            {/* Vendor + Invoice No */}
            <div style={row}>
              <div style={{ ...fg, flex: 2 }}>
                <label>Vendor</label>
                <SelectDropdown value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
                  <option value="">— Select Vendor —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
                </SelectDropdown>
              </div>
              <div style={fg}>
                <label>Invoice No</label>
                <input value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} placeholder="Invoice number" />
              </div>
            </div>

            {/* Cost Centre (analytical metadata only) */}
            <div style={row}>
              <div style={{ ...fg, flex: 2 }}>
                <label>Cost Centre</label>
                <SelectDropdown value={form.cost_center_id} onChange={e => set('cost_center_id', e.target.value)}>
                  <option value="">— None —</option>
                  {costCenters.map(cc => (
                    <option key={cc.id} value={cc.id}>{cc.code ? `${cc.code} — ${cc.name}` : cc.name}</option>
                  ))}
                </SelectDropdown>
              </div>
            </div>

            {/* Dates row */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 100 }}>
                <label>Purchase Date</label>
                <DatePicker value={form.purchase_date} onChange={v => set('purchase_date', v)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 100 }}>
                <label>In Service Date</label>
                <DatePicker value={form.in_service_date} onChange={v => set('in_service_date', v)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 100 }}>
                <label>Invoice Date</label>
                <DatePicker value={form.invoice_date} onChange={v => set('invoice_date', v)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 100 }}>
                <label>Installation Date</label>
                <DatePicker value={form.installation_date} onChange={v => set('installation_date', v)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 100 }}>
                <label>Warranty Expiry</label>
                <DatePicker value={form.warranty_expiry} onChange={v => set('warranty_expiry', v)} />
              </div>
            </div>
          </FormSectionCard>

          {/* FINANCIAL BREAKDOWN */}
          <FormSectionCard title="Financial Breakdown" icon={<BookOpen size={14} />}>

            {/* Taxable Value + GST% + GST Type + CGST + SGST */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1.4, minWidth: 110 }}>
                <label>Taxable Value (₹)</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                                 fontSize: 12, color: 'var(--g500)', pointerEvents: 'none' }}>₹</span>
                  <input type="number" value={form.taxable_value}
                    onChange={e => recalcGst({ taxable_value: e.target.value })}
                    placeholder="0.00" style={{ paddingLeft: 22 }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 0.6, minWidth: 60 }}>
                <label>GST (%)</label>
                <input type="number" value={form.gst_rate}
                  onChange={e => recalcGst({ gst_rate: e.target.value })} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1.4, minWidth: 130 }}>
                <label>GST Type</label>
                <SelectDropdown value={form.gst_type} onChange={e => recalcGst({ gst_type: e.target.value })}>
                  <option value="intra">Intra-State (CGST+SGST)</option>
                  <option value="inter">Inter-State (IGST)</option>
                </SelectDropdown>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 0.7, minWidth: 70 }}>
                <label>CGST</label>
                <input type="number" value={form.cgst_amount} onChange={e => set('cgst_amount', e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 0.7, minWidth: 70 }}>
                <label>SGST</label>
                <input type="number" value={form.sgst_amount} onChange={e => set('sgst_amount', e.target.value)} />
              </div>
            </div>

            {/* GST Treatment + Claimable + Non-Claimable */}
            <div style={row}>
              <div style={fg}>
                <label>GST Treatment</label>
                <SelectDropdown value={form.gst_treatment} onChange={e => recalcGst({ gst_treatment: e.target.value })}>
                  <option value="claimable">Claimable (ITC)</option>
                  <option value="non_claimable">Non-Claimable</option>
                  <option value="partial">Partial</option>
                </SelectDropdown>
              </div>
              <div style={fg}>
                <label>Claimable GST</label>
                <input type="number" value={form.gst_claimable_amount}
                  disabled={form.gst_treatment !== 'partial'}
                  onChange={e => set('gst_claimable_amount', e.target.value)} />
              </div>
              <div style={fg}>
                <label>Non-Claimable GST</label>
                <input type="number" value={form.gst_non_claimable_amount}
                  disabled={form.gst_treatment !== 'partial'}
                  onChange={e => set('gst_non_claimable_amount', e.target.value)} />
              </div>
            </div>

            {/* Total Invoice + Capitalized Cost + Salvage */}
            <div style={row}>
              <div style={fg}>
                <label>Total Invoice Value (₹)</label>
                <input type="number" value={form.total_invoice_value} readOnly
                  style={{ background: 'var(--g100)', fontFamily: 'var(--mono)' }} />
              </div>
              <div style={fg}>
                <label>Capitalized Cost (₹) *</label>
                <input type="number" value={form.purchase_cost}
                  onChange={e => set('purchase_cost', e.target.value)}
                  style={{ fontWeight: 700, background: 'var(--brand-50,#eff6ff)', fontFamily: 'var(--mono)' }} />
              </div>
              <div style={fg}>
                <label>Salvage Value (₹)</label>
                <input type="number" value={form.salvage_value}
                  onChange={e => set('salvage_value', e.target.value)} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--g500)', marginTop: 2 }}>
              Leave 0 for new assets. Enter only for balance only for opening-balance migration.
            </div>

            {/* Accounting Preview — shown inline when category + cost filled */}
            {form.category_id && num(form.purchase_cost) > 0 && jePreviewLines && (
              <div style={{ marginTop: 14, border: '1px solid var(--g200)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ padding: '5px 12px', background: 'var(--g100)',
                              fontSize: 10, fontWeight: 700, color: 'var(--g600)',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                              display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BookOpen size={11} /> Auto Journal Entry — Fixed Asset Purchase
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['', 'Account', 'Debit', 'Credit'].map(h => (
                        <th key={h} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 700,
                                            color: 'var(--g500)', textAlign: h === '' ? 'left' : 'right',
                                            borderBottom: '1px solid var(--g200)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jePreviewLines.map((line, i) => (
                      <tr key={i}>
                        <td style={{ padding: '7px 12px', width: 36 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                         background: line.side === 'Dr' ? '#E3F2FD' : '#E8F5E9',
                                         color:      line.side === 'Dr' ? '#1565C0' : '#2E7D32' }}>
                            {line.side}
                          </span>
                        </td>
                        <td style={{ padding: '7px 12px', fontSize: 12, fontWeight: 500 }}>{line.account}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                          {line.side === 'Dr' ? fmt(line.amount) : '—'}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                          {line.side === 'Cr' ? fmt(line.amount) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSectionCard>

        </div>
      </div>
      </div>

      {/* ── Sticky footer ── */}
      <div style={{
        position: 'sticky', bottom: 0, background: '#fff', 
        borderTop: '1px solid var(--g200)', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <button className="btn" onClick={() => navigate('/assets')}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

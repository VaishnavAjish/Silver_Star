import { useState, useEffect } from 'react';
import { Package, X } from 'lucide-react';
import toast from 'react-hot-toast';
import SelectDropdown from './SelectDropdown';

const EMPTY_ITEM = {
  code: '', name: '', category: 'seed', type: 'raw_material',
  default_uom: 'PCS', hsn_code: '', reorder_level: 0,
  description: '', is_capital_asset: false, fixed_asset_category_id: '', status: 'active',
};

const CATEGORIES = ['seed', 'gas', 'consumable', 'rough', 'growth_run'];
const TYPES = ['raw_material', 'finished_good'];
const UOMS = ['PCS', 'CT', 'KG', 'GM', 'CYL', 'LTR', 'HR'];

export default function QuickCreateItemModal({ onClose, onCreated, api }) {
  const [form, setForm] = useState(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [assetCategories, setAssetCategories] = useState([]);

  useEffect(() => {
    let ignore = false;
    api.get('/api/fixed-asset-categories?limit=500').then(r => {
      if (!ignore) setAssetCategories(r.data || []);
    }).catch(() => {});
    return () => { ignore = true; };
  }, [api]);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.code.trim()) { toast.error('Item code is required'); return; }
    if (!form.name.trim()) { toast.error('Item name is required'); return; }
    if (form.is_capital_asset && !form.fixed_asset_category_id) {
      toast.error('Asset Category is required for capital assets');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.code) delete payload.code;
      if (!payload.fixed_asset_category_id) delete payload.fixed_asset_category_id;
      
      const created = await api.post('/api/items', payload);
      toast.success('Item created');
      onCreated(created);
      if (onClose) onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to create item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Package size={16} /> New Item</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="fg">
              <label>Item Code *</label>
              <input value={form.code} onChange={e => f('code', e.target.value)} placeholder="e.g. SEED-01" />
            </div>
            <div className="fg w">
              <label>Item Name *</label>
              <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full item name" autoFocus />
            </div>
          </div>
          <div className="form-row">
            <div className="fg">
              <label>Category *</label>
              <SelectDropdown value={form.category} onChange={e => f('category', e.target.value)}>
                {CATEGORIES.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </SelectDropdown>
            </div>
            <div className="fg">
              <label>Type</label>
              <SelectDropdown value={form.type} onChange={e => f('type', e.target.value)}>
                {TYPES.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </SelectDropdown>
            </div>
            <div className="fg">
              <label>Default UOM</label>
              <SelectDropdown value={form.default_uom} onChange={e => f('default_uom', e.target.value)}>
                {UOMS.map(o => <option key={o} value={o}>{o}</option>)}
              </SelectDropdown>
            </div>
          </div>
          <div className="form-row">
            <div className="fg">
              <label>HSN Code</label>
              <input value={form.hsn_code} onChange={e => f('hsn_code', e.target.value)} placeholder="e.g. 71023100" />
            </div>
            <div className="fg">
              <label>Reorder Level</label>
              <input type="number" value={form.reorder_level} onChange={e => f('reorder_level', parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="form-row">
            <div className="fg w">
              <label>Description</label>
              <textarea value={form.description} onChange={e => f('description', e.target.value)} rows={2} />
            </div>
          </div>
          <div className="form-row" style={{ alignItems: 'center', marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={form.is_capital_asset} 
                onChange={e => {
                  f('is_capital_asset', e.target.checked);
                  if (!e.target.checked) f('fixed_asset_category_id', '');
                }} 
              />
              <strong>Capital Asset?</strong>
            </label>
            {form.is_capital_asset && (
              <div className="fg" style={{ marginLeft: 20, minWidth: 250 }}>
                <label>Asset Category *</label>
                <SelectDropdown value={form.fixed_asset_category_id} onChange={e => f('fixed_asset_category_id', e.target.value)}>
                  <option value="">— Select Category —</option>
                  {assetCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectDropdown>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Create Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

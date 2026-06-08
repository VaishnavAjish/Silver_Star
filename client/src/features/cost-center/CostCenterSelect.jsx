import { useState } from 'react';
import { useApi } from '../../shared/hooks/useApi';
import SelectDropdown from '../../shared/components/SelectDropdown';
import Modal from '../../shared/components/Modal';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CostCenterSelect({ value, onChange, costCenters, onRefresh, disabled, style, className }) {
  const api = useApi();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', code: '' });
  const [saving, setSaving] = useState(false);

  const handleChange = (v) => {
    if (v === '__new__') {
      setForm({ name: '', code: '' });
      setShowModal(true);
      return;
    }
    onChange(v);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Cost Center name is required');
      return;
    }
    setSaving(true);
    try {
      const cc = await api.post('/api/cost-centers', { name: form.name.trim(), code: form.code.trim() || null });
      onRefresh?.();
      onChange(String(cc.id));
      toast.success(`Cost Center "${cc.name}" created`);
      setShowModal(false);
    } catch (err) {
      toast.error(err.message || 'Failed to create cost center');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SelectDropdown value={value || ''} onChange={e => handleChange(e.target.value)} disabled={disabled} style={style} className={className}>
        <option value="">— No Cost Center —</option>
        <option value="__new__">+ Add New Cost Center</option>
        {costCenters.map(cc => (
          <option key={cc.id} value={String(cc.id)}>
            {cc.name}{cc.code ? ` (${cc.code})` : ''}
          </option>
        ))}
      </SelectDropdown>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Add New Cost Center"
        footer={
          <>
            <button className="btn" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="fg w">
            <label>Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Sales Department"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="fg w">
            <label>Short Code (optional)</label>
            <input
              value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
              placeholder="e.g. CC-01"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

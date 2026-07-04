import { useState } from 'react';
import { ShoppingCart, X } from 'lucide-react';
import toast from 'react-hot-toast';
import SelectDropdown from './SelectDropdown';

const EMPTY_VENDOR = {
  name: '', code: '', category: 'general', contact_person: '',
  phone: '', email: '', address: '', city: 'Surat', state: 'Gujarat',
  gstin: '', pan: '', payment_term: 'Immediate', bank_details: '', status: 'active',
};
const VENDOR_CATEGORIES = ['seed', 'gas', 'consumable', 'general'];
const VENDOR_PAYMENT_TERMS = ['Immediate', '7 Days', '15 Days', '30 Days', '60 Days'];

export default function QuickCreateVendorModal({ onClose, onCreated, api }) {
  const [form, setForm] = useState(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Vendor name is required'); return; }
    setSaving(true);
    try {
      const created = await api.post('/api/vendors', form);
      toast.success('Vendor created');
      onCreated(created);
    } catch (err) {
      toast.error(err.message || 'Failed to create vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><ShoppingCart size={16} /> New Vendor</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="fg">
              <label>Code</label>
              <input value={form.code} onChange={e => f('code', e.target.value)} placeholder="Auto-generated if blank" />
            </div>
            <div className="fg w">
              <label>Vendor Name *</label>
              <input value={form.name} onChange={e => f('name', e.target.value)} placeholder="Full vendor name" autoFocus />
            </div>
          </div>
          <div className="form-row">
            <div className="fg">
              <label>Category</label>
              <SelectDropdown value={form.category} onChange={e => f('category', e.target.value)}>
                {VENDOR_CATEGORIES.map(o => <option key={o} value={o}>{o}</option>)}
              </SelectDropdown>
            </div>
            <div className="fg">
              <label>Payment Term</label>
              <SelectDropdown value={form.payment_term} onChange={e => f('payment_term', e.target.value)}>
                {VENDOR_PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
              </SelectDropdown>
            </div>
          </div>
          <div className="form-row">
            <div className="fg"><label>Contact Person</label>
              <input value={form.contact_person} onChange={e => f('contact_person', e.target.value)} /></div>
            <div className="fg"><label>Phone</label>
              <input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+91 XXXXX XXXXX" /></div>
            <div className="fg"><label>Email</label>
              <input type="email" value={form.email} onChange={e => f('email', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="fg w"><label>Address</label>
              <input value={form.address} onChange={e => f('address', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="fg"><label>City</label>
              <input value={form.city} onChange={e => f('city', e.target.value)} /></div>
            <div className="fg"><label>State</label>
              <input value={form.state} onChange={e => f('state', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="fg"><label>GSTIN</label>
              <input value={form.gstin} onChange={e => f('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" /></div>
            <div className="fg"><label>PAN</label>
              <input value={form.pan} onChange={e => f('pan', e.target.value)} placeholder="AAAAA0000A" /></div>
          </div>
          <div className="form-row">
            <div className="fg w"><label>Bank Details</label>
              <textarea value={form.bank_details} onChange={e => f('bank_details', e.target.value)}
                rows={3} placeholder="Account No, IFSC, Bank Name..." /></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Create Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

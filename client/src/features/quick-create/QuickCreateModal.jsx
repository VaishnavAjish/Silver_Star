/**
 * QuickCreateModal — inline "+ Add New" creation modal.
 *
 * Props
 * ─────
 * type        'vendor' | 'customer' | 'account'
 * onClose     () => void
 * onCreated   (result) => void   — called after successful POST
 */
import { useState } from 'react';
import SelectDropdown from '../../shared/components/SelectDropdown';
import { X, Plus } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import toast from 'react-hot-toast';

const ACCOUNT_TYPES = [
  { value: 'asset',     label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity',    label: 'Equity' },
  { value: 'revenue',   label: 'Revenue / Income' },
  { value: 'expense',   label: 'Expense' },
];

const TITLES = {
  vendor:   'Add New Vendor',
  customer: 'Add New Customer',
  account:  'Add New Account (Ledger)',
};

const ENDPOINT = {
  vendor:   '/api/quick-create/vendors',
  customer: '/api/quick-create/customers',
  account:  '/api/quick-create/accounts',
};

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#fff', borderRadius: 10, width: 420,
    boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #e8e8e8',
  },
  title:  { fontSize: 15, fontWeight: 700, color: '#222', display: 'flex', alignItems: 'center', gap: 8 },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#999', padding: 4, display: 'flex', borderRadius: 4,
  },
  body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 18px', borderTop: '1px solid #e8e8e8',
  },
  fg: { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' },
  inp: {
    padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4,
    fontSize: 13, outline: 'none', fontFamily: 'inherit',
    transition: 'border-color .12s',
  },
  hint: { fontSize: 11, color: '#999', marginTop: 2 },
};

export default function QuickCreateModal({ type, onClose, onCreated }) {
  const api = useApi();

  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'revenue',
    sub_type: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(p => ({ ...p, [k]: null }));
  };

  const validate = () => {
    const e = {};
    // code is optional for vendor/customer — backend auto-generates if omitted
    if (type === 'account' && !form.code.trim()) e.code = 'Required';
    if (!form.name.trim()) e.name = 'Required';
    if (type === 'account' && !form.type) e.type = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // For vendor/customer: omit code entirely if blank so backend auto-generates.
      // For account: code is always required and must be sent.
      const trimmedCode = form.code.trim();
      const payload = type === 'account'
        ? { code: trimmedCode, name: form.name.trim(), type: form.type, sub_type: form.sub_type || undefined }
        : { ...(trimmedCode ? { code: trimmedCode } : {}), name: form.name.trim() };

      const result = await api.post(ENDPOINT[type], payload);
      toast.success(`${TITLES[type].replace('Add New ', '')} created successfully`);
      onCreated(result);
    } catch (err) {
      toast.error(err.message || 'Failed to create');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  const inpStyle = (field) => ({
    ...s.inp,
    ...(errors[field] ? { borderColor: '#e53935' } : {}),
  });

  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal} onKeyDown={handleKeyDown}>

        <div style={s.header}>
          <span style={s.title}>
            <Plus size={16} style={{ color: '#0d7c5f' }} />
            {TITLES[type]}
          </span>
          <button style={s.closeBtn} onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div style={s.body}>
          <div style={s.fg}>
            <label style={s.lbl}>Code{type === 'account' ? ' *' : ''}</label>
            <input
              style={inpStyle('code')}
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value)}
              placeholder={
                type === 'vendor'   ? 'Auto-generated if left blank' :
                type === 'customer' ? 'Auto-generated if left blank' :
                                      'e.g. 4100'
              }
              autoFocus
            />
            {errors.code && <span style={{ fontSize: 11, color: '#e53935' }}>{errors.code}</span>}
            {type !== 'account' && (
              <span style={s.hint}>Optional — a linked GL ledger is auto-created.</span>
            )}
          </div>

          <div style={s.fg}>
            <label style={s.lbl}>Name *</label>
            <input
              style={inpStyle('name')}
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Full name"
            />
            {errors.name && <span style={{ fontSize: 11, color: '#e53935' }}>{errors.name}</span>}
          </div>

          {type === 'account' && (
            <>
              <div style={s.fg}>
                <label style={s.lbl}>Account Type *</label>
                <SelectDropdown
                  style={{ ...inpStyle('type'), cursor: 'pointer' }}
                  value={form.type}
                  onChange={e => set('type', e.target.value)}
                >
                  {ACCOUNT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </SelectDropdown>
              </div>
              <div style={s.fg}>
                <label style={s.lbl}>Sub-Type <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
                <input
                  style={s.inp}
                  type="text"
                  value={form.sub_type}
                  onChange={e => set('sub_type', e.target.value)}
                  placeholder="e.g. income, other_income, bank, cash"
                />
              </div>
            </>
          )}
        </div>

        <div style={s.footer}>
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>

      </div>
    </div>
  );
}

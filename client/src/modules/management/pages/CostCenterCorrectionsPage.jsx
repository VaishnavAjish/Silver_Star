import { useState, useEffect } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { Wand2, Replace, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import DatePicker from '../../../shared/components/DatePicker';

// Known journal source types (transaction type filter). Blank = any.
const SOURCE_TYPES = [
  'purchase', 'expense', 'fixed_asset_purchase', 'depreciation', 'disposal',
  'invoice', 'payment', 'receipt', 'manual',
];

const fg = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 };
const row = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 };

export default function CostCenterCorrectionsPage() {
  const api = useApi();
  const { user } = useAuth();
  const [costCenters, setCostCenters] = useState([]);
  const [accounts, setAccounts]       = useState([]);

  useEffect(() => {
    api.get('/api/cost-centers?status=all').then(r => setCostCenters(r.data || [])).catch(() => {});
    api.get('/api/accounts?is_group=false&status=active').then(r => setAccounts(r.data || r || [])).catch(() => {});
  }, []);

  if (!['admin', 'super_admin'].includes(user?.role)) {
    return <div className="grid-page"><p style={{ padding: 24 }}>Admin access required.</p></div>;
  }

  const ccOptions = costCenters.map(cc => (
    <option key={cc.id} value={cc.id}>{cc.code ? `${cc.code} — ${cc.name}` : cc.name}</option>
  ));

  return (
    <div className="grid-page" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <BulkAssignCard api={api} ccOptions={ccOptions} accounts={accounts} />
      <BulkReplaceCard api={api} ccOptions={ccOptions} costCenters={costCenters} />
    </div>
  );
}

// ── Bulk Assign ────────────────────────────────────────────────────────────
function BulkAssignCard({ api, ccOptions, accounts }) {
  const [f, setF] = useState({
    cost_center_id: '', date_from: '', date_to: '', voucher_from: '', voucher_to: '',
    account_id: '', source_type: '', reference: '', remarks: '', reason: '',
  });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setPreview(null); };

  const call = async (dryRun) => {
    if (!f.cost_center_id) return toast.error('Select a cost centre to assign');
    setBusy(true);
    try {
      const body = { ...f, dryRun };
      const r = await api.post('/api/cost-center-bulk/assign', body);
      if (dryRun) { setPreview(r.affected); }
      else { toast.success(`Assigned to ${r.updated} JE line(s)`); setPreview(null); }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!window.confirm('Assign the selected cost centre to all matching JE lines? This is audited and reversible via Bulk Replace.')) return;
    call(false);
  };

  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
        <Wand2 size={16} /> Bulk Assign Cost Centre
      </h3>
      <p style={{ fontSize: 12, color: 'var(--g500)', marginTop: -4 }}>
        Assigns a cost centre to matching journal-entry lines. Accounting values are never changed.
      </p>
      <div style={row}>
        <div style={fg}>
          <label className="filter-label">Cost Centre to assign *</label>
          <SelectDropdown value={f.cost_center_id} onChange={e => set('cost_center_id', e.target.value)}>
            <option value="">— Select —</option>{ccOptions}
          </SelectDropdown>
        </div>
        <div style={fg}><label className="filter-label">Date From</label><DatePicker value={f.date_from} onChange={v => set('date_from', v || '')} /></div>
        <div style={fg}><label className="filter-label">Date To</label><DatePicker value={f.date_to} onChange={v => set('date_to', v || '')} /></div>
        <div style={fg}><label className="filter-label">Voucher From (#)</label><input type="number" value={f.voucher_from} onChange={e => set('voucher_from', e.target.value)} placeholder="e.g. 100" /></div>
        <div style={fg}><label className="filter-label">Voucher To (#)</label><input type="number" value={f.voucher_to} onChange={e => set('voucher_to', e.target.value)} placeholder="e.g. 200" /></div>
        <div style={fg}>
          <label className="filter-label">Account</label>
          <SelectDropdown value={f.account_id} onChange={e => set('account_id', e.target.value)}>
            <option value="">— Any —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </SelectDropdown>
        </div>
        <div style={fg}>
          <label className="filter-label">Transaction Type</label>
          <SelectDropdown value={f.source_type} onChange={e => set('source_type', e.target.value)}>
            <option value="">— Any —</option>
            {SOURCE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </SelectDropdown>
        </div>
        <div style={fg}><label>Reference</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="contains…" /></div>
        <div style={fg}><label>Remarks (narration)</label><input value={f.remarks} onChange={e => set('remarks', e.target.value)} placeholder="contains…" /></div>
        <div style={{ ...fg, flex: 1, minWidth: 220 }}><label>Reason (audit)</label><input value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Why this correction?" /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" disabled={busy} onClick={() => call(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Search size={13} /> Preview
        </button>
        <button className="btn btn-primary" disabled={busy || preview === null || preview === 0} onClick={apply}>
          Apply{preview != null ? ` to ${preview} line(s)` : ''}
        </button>
        {preview != null && <span style={{ fontSize: 13, color: preview ? 'var(--green)' : 'var(--g500)' }}>{preview} matching line(s)</span>}
      </div>
    </section>
  );
}

// ── Bulk Replace ───────────────────────────────────────────────────────────
function BulkReplaceCard({ api, ccOptions, costCenters }) {
  const [f, setF] = useState({
    existing_cost_center_id: '', new_cost_center_id: '',
    date_from: '', date_to: '', voucher_from: '', voucher_to: '', reason: '',
  });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setPreview(null); };

  const call = async (dryRun) => {
    if (!f.existing_cost_center_id || !f.new_cost_center_id) return toast.error('Select existing and new cost centre');
    if (f.existing_cost_center_id === f.new_cost_center_id) return toast.error('Existing and new must differ');
    setBusy(true);
    try {
      const r = await api.post('/api/cost-center-bulk/replace', { ...f, dryRun });
      if (dryRun) { setPreview(r.affected); }
      else { toast.success(`Replaced on ${r.updated} JE line(s)`); setPreview(null); }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!window.confirm('Replace the cost centre on all matching JE lines? This is audited.')) return;
    call(false);
  };

  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
        <Replace size={16} /> Bulk Replace Cost Centre
      </h3>
      <p style={{ fontSize: 12, color: 'var(--g500)', marginTop: -4 }}>
        Replaces one cost centre with another on matching JE lines. Accounting values are preserved.
      </p>
      <div style={row}>
        <div style={fg}>
          <label className="filter-label">Existing Cost Centre *</label>
          <SelectDropdown value={f.existing_cost_center_id} onChange={e => set('existing_cost_center_id', e.target.value)}>
            <option value="">— Select —</option>{ccOptions}
          </SelectDropdown>
        </div>
        <div style={fg}>
          <label className="filter-label">New Cost Centre *</label>
          <SelectDropdown value={f.new_cost_center_id} onChange={e => set('new_cost_center_id', e.target.value)}>
            <option value="">— Select —</option>{ccOptions}
          </SelectDropdown>
        </div>
        <div style={fg}><label className="filter-label">Date From</label><DatePicker value={f.date_from} onChange={v => set('date_from', v || '')} /></div>
        <div style={fg}><label className="filter-label">Date To</label><DatePicker value={f.date_to} onChange={v => set('date_to', v || '')} /></div>
        <div style={fg}><label className="filter-label">Voucher From (#)</label><input type="number" value={f.voucher_from} onChange={e => set('voucher_from', e.target.value)} /></div>
        <div style={fg}><label className="filter-label">Voucher To (#)</label><input type="number" value={f.voucher_to} onChange={e => set('voucher_to', e.target.value)} /></div>
        <div style={{ ...fg, flex: 1, minWidth: 220 }}><label className="filter-label">Reason (audit)</label><input value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Why this correction?" /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" disabled={busy} onClick={() => call(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Search size={13} /> Preview
        </button>
        <button className="btn btn-primary" disabled={busy || preview === null || preview === 0} onClick={apply}>
          Apply{preview != null ? ` to ${preview} line(s)` : ''}
        </button>
        {preview != null && <span style={{ fontSize: 13, color: preview ? 'var(--green)' : 'var(--g500)' }}>{preview} matching line(s)</span>}
      </div>
    </section>
  );
}

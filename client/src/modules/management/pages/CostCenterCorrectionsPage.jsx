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
      <BulkReplaceCard api={api} ccOptions={ccOptions} costCenters={costCenters} accounts={accounts} />
    </div>
  );
}

// ── Preview Table Component ────────────────────────────────────────────────
function PreviewTable({ preview, selected, setSelected }) {
  if (!preview || !preview.lines || preview.lines.length === 0) return null;

  const allSelected = preview.lines.length > 0 && selected.length === preview.lines.length;
  
  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(preview.lines.map(l => l.id));
  };

  const toggleOne = (id) => {
    if (selected.includes(id)) setSelected(selected.filter(x => x !== id));
    else setSelected([...selected, id]);
  };

  const th = { textAlign: 'left', padding: '8px', borderBottom: '2px solid var(--g200)', fontSize: 13, color: 'var(--g600)', background: 'var(--g50)' };
  const td = { padding: '8px', fontSize: 13, borderBottom: '1px solid var(--g100)', color: 'var(--g800)' };
  const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ marginTop: 16, marginBottom: 16, maxHeight: 400, overflowY: 'auto', border: '1px solid var(--g200)', borderRadius: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th style={{ ...th, width: 40, textAlign: 'center' }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
            <th style={th}>Date</th>
            <th style={th}>Voucher No</th>
            <th style={th}>Transaction Type</th>
            <th style={th}>Account</th>
            <th style={th}>Current Cost Centre</th>
            <th style={tdNum}>Debit</th>
            <th style={tdNum}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map(l => (
            <tr key={l.id} style={{ background: selected.includes(l.id) ? 'var(--brand-50)' : 'transparent' }}>
              <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggleOne(l.id)} /></td>
              <td style={td}>{new Date(l.date).toLocaleDateString('en-GB')}</td>
              <td style={{ ...td, fontWeight: 500 }}>{l.je_number}</td>
              <td style={td}>{l.source_type}</td>
              <td style={td}>{l.account_name} <span style={{ color: 'var(--g500)', fontSize: 11 }}>({l.account_code})</span></td>
              <td style={td}>{l.current_cc_name || '—'}</td>
              <td style={tdNum}>{Number(l.debit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td style={tdNum}>{Number(l.credit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [selectedLines, setSelectedLines] = useState([]);
  const [busy, setBusy] = useState(false);
  
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setPreview(null); setSelectedLines([]); };

  const call = async (dryRun) => {
    if (!f.cost_center_id) return toast.error('Select a cost centre to assign');
    setBusy(true);
    try {
      const body = { ...f, dryRun };
      const r = await api.post('/api/cost-center-bulk/assign', body);
      if (dryRun) { 
        setPreview(r); 
        setSelectedLines(r.lines ? r.lines.map(l => l.id) : []); 
      }
      else { 
        toast.success(`Assigned to ${r.updated} JE line(s)`); 
        setPreview(null); 
        setSelectedLines([]); 
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (preview && preview.lines && selectedLines.length === 0) return toast.error('Select at least one line to apply');
    if (!window.confirm('Assign the selected cost centre to the selected JE lines? This is audited and reversible via Bulk Replace.')) return;
    setBusy(true);
    try {
      const body = { ...f, dryRun: false, selected_line_ids: preview ? selectedLines : undefined };
      const r = await api.post('/api/cost-center-bulk/assign', body);
      toast.success(`Assigned to ${r.updated} JE line(s)`);
      setPreview(null);
      setSelectedLines([]);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
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
        <div style={fg}><label className="filter-label">Reference</label><input value={f.reference} onChange={e => set('reference', e.target.value)} placeholder="contains…" /></div>
        <div style={fg}><label className="filter-label">Remarks (narration)</label><input value={f.remarks} onChange={e => set('remarks', e.target.value)} placeholder="contains…" /></div>
        <div style={{ ...fg, flex: 1, minWidth: 220 }}><label className="filter-label">Reason (audit)</label><input value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Why this correction?" /></div>
      </div>
      
      <PreviewTable preview={preview} selected={selectedLines} setSelected={setSelectedLines} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" disabled={busy} onClick={() => call(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Search size={13} /> Preview
        </button>
        <button className="btn btn-primary" disabled={busy || preview === null || (preview.lines && selectedLines.length === 0)} onClick={apply}>
          Apply{preview != null ? ` to ${selectedLines.length} line(s)` : ''}
        </button>
        {preview != null && <span style={{ fontSize: 13, color: preview.affected ? 'var(--green)' : 'var(--g500)' }}>{preview.lines ? preview.lines.length : preview.affected} matching line(s)</span>}
      </div>
    </section>
  );
}

// ── Bulk Replace ───────────────────────────────────────────────────────────
function BulkReplaceCard({ api, ccOptions, costCenters, accounts }) {
  const [f, setF] = useState({
    existing_cost_center_id: '', new_cost_center_id: '',
    date_from: '', date_to: '', voucher_from: '', voucher_to: '', reason: '',
    account_id: '', source_type: ''
  });
  const [preview, setPreview] = useState(null);
  const [selectedLines, setSelectedLines] = useState([]);
  const [busy, setBusy] = useState(false);
  
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setPreview(null); setSelectedLines([]); };

  const call = async (dryRun) => {
    if (!f.existing_cost_center_id || !f.new_cost_center_id) return toast.error('Select existing and new cost centre');
    if (f.existing_cost_center_id === f.new_cost_center_id) return toast.error('Existing and new must differ');
    setBusy(true);
    try {
      const r = await api.post('/api/cost-center-bulk/replace', { ...f, dryRun });
      if (dryRun) { 
        setPreview(r); 
        setSelectedLines(r.lines ? r.lines.map(l => l.id) : []); 
      }
      else { 
        toast.success(`Replaced on ${r.updated} JE line(s)`); 
        setPreview(null); 
        setSelectedLines([]); 
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (preview && preview.lines && selectedLines.length === 0) return toast.error('Select at least one line to apply');
    if (!window.confirm('Replace the cost centre on the selected JE lines? This is audited.')) return;
    setBusy(true);
    try {
      const r = await api.post('/api/cost-center-bulk/replace', { ...f, dryRun: false, selected_line_ids: preview ? selectedLines : undefined });
      toast.success(`Replaced on ${r.updated} JE line(s)`);
      setPreview(null);
      setSelectedLines([]);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
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
        <div style={{ ...fg, flex: 1, minWidth: 220 }}><label className="filter-label">Reason (audit)</label><input value={f.reason} onChange={e => set('reason', e.target.value)} placeholder="Why this correction?" /></div>
      </div>
      
      <PreviewTable preview={preview} selected={selectedLines} setSelected={setSelectedLines} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" disabled={busy} onClick={() => call(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Search size={13} /> Preview
        </button>
        <button className="btn btn-primary" disabled={busy || preview === null || (preview.lines && selectedLines.length === 0)} onClick={apply}>
          Apply{preview != null ? ` to ${selectedLines.length} line(s)` : ''}
        </button>
        {preview != null && <span style={{ fontSize: 13, color: preview.affected ? 'var(--green)' : 'var(--g500)' }}>{preview.lines ? preview.lines.length : preview.affected} matching line(s)</span>}
      </div>
    </section>
  );
}

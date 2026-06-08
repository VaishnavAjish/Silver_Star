import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import Paginator from '../../../shared/components/Paginator';
import toast from 'react-hot-toast';
import { Save, RefreshCw, DoorOpen, DoorClosed, ChevronLeft, Warehouse } from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';
import { FormSectionCard } from '../../../core/layout';
import DatePicker from '../../../shared/components/DatePicker';

const today = () => new Date().toISOString().split('T')[0];
const fmt = v => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function EntryForm({ mode }) {
  const api = useApi();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [date, setDate] = useState(today());
  const [form, setForm] = useState({ item_id: '', quantity: '', rate: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;
  const value = useMemo(() => (Number(form.quantity) || 0) * (Number(form.rate) || 0), [form.quantity, form.rate]);
  const isOpening = mode === 'opening';

  const load = useCallback(async (pg = 1) => {
    try {
      const [itemData, entryData] = await Promise.all([
        api.get('/api/items?status=active&limit=500'),
        isOpening
          ? api.get(`/api/inventory/opening?page=${pg}&pageSize=${PAGE_SIZE}`)
          : api.get(`/api/inventory/closing?as_of_date=${date || today()}&page=${pg}&pageSize=${PAGE_SIZE}`),
      ]);
      setItems(itemData.data || itemData || []);
      setRows(entryData.data || []);
      setTotal(entryData.totalCount ?? entryData.total ?? 0);
    } catch (err) {
      toast.error(err.message);
    }
  }, [api, isOpening, date]);

  useEffect(() => { load(page); }, [load, page]);
  useEffect(() => { if (!isOpening && date) load(page); }, [load, date, page, isOpening]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(page); } finally { setSpinning(false); }
  }, [load, page]);

  const save = useCallback(async () => {
    if (!form.item_id) return toast.error('Select item');
    if ((Number(form.quantity) || 0) <= 0 && isOpening) return toast.error('Quantity must be greater than zero');
    if ((Number(form.rate) || 0) <= 0 && isOpening) return toast.error('Rate must be greater than zero');
    if ((Number(form.quantity) || 0) < 0 || (Number(form.rate) || 0) < 0) return toast.error('Numbers cannot be negative');

    setSaving(true);
    try {
      await api.post(`/api/inventory/${mode}`, {
        item_id: Number(form.item_id),
        quantity: Number(form.quantity),
        rate: Number(form.rate),
        ...(isOpening ? { as_of_date: date } : { date }),
      });
      toast.success(isOpening ? 'Opening stock saved' : 'Closing override saved');
      setForm({ item_id: '', quantity: '', rate: '' });
      await load(page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }, [form, isOpening, api, mode, date, load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="grid-page animate-in">
      
      <div style={{ padding: 16 }}>
      <FormSectionCard title="Entry" icon={<Warehouse size={13} />}>
        <div className="form-row">
          <div className="fg"><label>Date</label><DatePicker value={date} onChange={v => setDate(v)} /></div>
          <div className="fg w"><label>Item</label>
            <SelectDropdown value={form.item_id} onChange={e => setForm(p => ({ ...p, item_id: e.target.value }))}>
              <option value="">Select item</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
            </SelectDropdown>
          </div>
          <div className="fg"><label>Qty</label><input type="number" min="0" step="0.0001" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} /></div>
          <div className="fg"><label>Rate</label><input type="number" min="0" step="0.0001" value={form.rate} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} /></div>
          <div className="fg"><label>Value</label><input value={fmt(value)} readOnly /></div>
          <div className="fg" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 'auto' }}><Save size={14} /> {saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </FormSectionCard>

      <FormSectionCard title="Existing Entries" icon={<Warehouse size={13} />} noPad>
        <table className="je-lines-table">
          <thead><tr><th style={{ width: 120 }}>Date</th><th style={{ width: 120 }}>Code</th><th>Item</th><th style={{ width: 120 }}>Qty</th><th style={{ width: 120 }}>Rate</th><th style={{ width: 140 }}>Value</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id || 'idx'}-${i}`}>
                <td>{r.as_of_date || r.date ? new Date(r.as_of_date || r.date).toLocaleDateString('en-IN') : '—'}</td>
                <td>{r.item_code}</td>
                <td>{r.item_name}</td>
                <td className="num">{Number(r.quantity || 0).toLocaleString('en-IN')}</td>
                <td className="num">{fmt(r.rate)}</td>
                <td className="num">{fmt(r.value)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--g400)', padding: 24 }}>No entries</td></tr>}
          </tbody>
        </table>
      </FormSectionCard>
            <div className="grid-footer">
              <div className="grid-footer-left">
                <span>Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} records</span>
              </div>
              <div className="grid-footer-center">
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
              <div className="grid-footer-right"></div>
            </div>

    </div>
    </div>
  );
}

export function InventoryOpeningPage() {
  return <EntryForm mode="opening" />;
}

export function InventoryClosingPage() {
  return <EntryForm mode="closing" />;
}

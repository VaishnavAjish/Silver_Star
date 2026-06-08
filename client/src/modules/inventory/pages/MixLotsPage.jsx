import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';
import { GitMerge, Search, CheckSquare, Square, Eye, AlertCircle, X } from 'lucide-react';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';

const CONSUMED = ['CONSUMED', 'SOLD', 'DISPOSED', 'DAMAGED', 'ARCHIVED', 'IN PROCESS'];

function effQty(lot) {
  return lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
}

export default function MixLots({ initialLotIds, onComplete, onCancel, isModal }) {
  const navigate = useNavigate();
  const api      = useApi();
  const [searchParams] = useSearchParams();

  const [lots,      setLots]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [_mlf, _setMlf] = usePersistedFilters('mix_lots_filters', {
    search: '', itemFilter: '', catFilter: '',
  });
  const { search, itemFilter, catFilter } = _mlf;
  const setSearch     = v => _setMlf(f => ({ ...f, search:     v }));
  const setItemFilter = v => _setMlf(f => ({ ...f, itemFilter: v }));
  const setCatFilter  = v => _setMlf(f => ({ ...f, catFilter:  v }));
  const [selected,  setSelected]  = useState(new Set());   // Set of lot ids
  const [preview,   setPreview]   = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'mix_lots');

  // Accept pre-selected lot IDs from query string (e.g. ?ids=1,2,3) or props
  useEffect(() => {
    const ids = initialLotIds || searchParams.get('ids');
    if (ids) setSelected(new Set(ids.split(',').map(Number)));
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/api/inventory?limit=500')
      .then(res => setLots((res.data || []).filter(l => !CONSUMED.includes(l.status))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const items = useMemo(() => [...new Set(lots.map(x => x.item_name).filter(Boolean))].sort(), [lots]);

  const filtered = useMemo(() => {
    let l = lots;
    if (itemFilter) l = l.filter(x => x.item_name === itemFilter);
    if (catFilter) l = l.filter(x => x.category === catFilter);
    if (search) {
      const s = search.toLowerCase();
      l = l.filter(x =>
        x.lot_number?.toLowerCase().includes(s) ||
        x.item_name?.toLowerCase().includes(s) ||
        x.lot_name?.toLowerCase().includes(s)
      );
    }
    return l;
  }, [lots, search, itemFilter, catFilter]);

  const selectedLots = useMemo(
    () => lots.filter(l => selected.has(l.id)),
    [lots, selected]
  );

  // Validation: all selected must share the same item_id
  const uniqueItems = useMemo(
    () => [...new Set(selectedLots.map(l => l.item_id))],
    [selectedLots]
  );
  const mixValid = selectedLots.length >= 2 && uniqueItems.length === 1;

  const totalEffQty = selectedLots.reduce((s, l) => s + effQty(l), 0);
  const totalVal    = selectedLots.reduce((s, l) => s + parseFloat(l.total_value || 0), 0);
  const wAvgRate    = totalEffQty > 0
    ? Math.round((totalVal / totalEffQty) * 10000) / 10000
    : 0;

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handlePreview = async () => {
    try {
      const data = await api.post('/api/lot-movements/mix/preview', {
        parent_lot_ids: [...selected],
      });
      setPreview(data);
      setShowModal(true);
    } catch (err) { toast.error(err.message); }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await api.post('/api/lot-movements/mix', {
        parent_lot_ids: [...selected],
        notes,
      });
      toast.success(`Mix complete — new lot ${res.child_lot.lot_number} created (${res.movement_number})`);
      if (isModal && onComplete) {
        onComplete();
      } else {
        navigate('/lot-movements');
      }
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); setShowModal(false); }
  };

  const unit = selectedLots[0]?.unit || '';
  const qtyLabel = unit === 'CT' ? 'Weight (ct)' : `Qty (${unit || 'pcs'})`;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>


      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: lot picker */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderRight: '1px solid var(--g200)' }}>
          {/* Toolbar */}
          <div style={{
            display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
            padding: '12px 16px', background: '#fff', borderBottom: '1px solid var(--g200)'
          }}>
            {/* Search */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 200 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--g400)' }} />
                <input
                  style={{
                    width: '100%', height: 34, padding: '0 30px',
                    border: '1px solid var(--g300)', borderRadius: 'var(--radius)',
                    fontSize: 13, outline: 'none', transition: 'border-color 0.2s'
                  }}
                  placeholder="Search lots…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g400)', padding: 0 }}
                    onClick={() => setSearch('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Item */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 160 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item</label>
              <SelectDropdown placeholder="All Items" value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
                <option value="">All Items</option>
                {items.map(name => <option key={name} value={name}>{name}</option>)}
              </SelectDropdown>
            </div>

            {/* Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 140 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</label>
              <SelectDropdown placeholder="All Categories" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                <option value="">All Categories</option>
                <option value="seed">Seeds</option>
                <option value="gas">Gases</option>
                <option value="consumable">Consumables</option>
                <option value="rough">Rough Diamonds</option>
              </SelectDropdown>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 1, marginLeft: 'auto' }}>
              {(search || itemFilter || catFilter) && (
                <button onClick={() => { setSearch(''); setItemFilter(''); setCatFilter(''); }}
                  title="Clear all filters"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
                    padding: '6px 12px', border: '1px solid var(--g300)', borderRadius: 6,
                    fontSize: 11, cursor: 'pointer', background: '#fff', color: '#C62828' }}>
                  <X size={10} /> Clear
                </button>
              )}
              <span className="grid-count" style={{ padding: '6px 12px' }}>{filtered.length} lots</span>
            </div>
          </div>

          {/* Grid */}
          <div className="grid-wrap" ref={tableWrapRef}>
            {loading
              ? <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
              : (
                <table className="dgrid">
                  <thead><tr>
                    <th style={{ width: 36 }}></th>
                    <th>Lot</th><th>Item</th><th style={{ width: 70 }}>Cat</th>
                    <th style={{ width: 80 }}>Qty</th><th style={{ width: 60 }}>Unit</th>
                    <th style={{ width: 90 }}>Rate (₹)</th><th style={{ width: 90 }}>Value (₹)</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(l => {
                      const checked = selected.has(l.id);
                      const disabled = !checked && uniqueItems.length === 1 && !uniqueItems.includes(l.item_id);
                      return (
                        <tr key={l.id}
                          onClick={() => !disabled && toggle(l.id)}
                          style={{
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.4 : 1,
                            background: checked ? '#FFFDE0' : undefined,
                          }}>
                          <td style={{ textAlign: 'center' }}>
                            {checked
                              ? <CheckSquare size={14} style={{ color: 'var(--brand)' }} />
                              : <Square size={14} style={{ color: 'var(--g400)' }} />}
                          </td>
                          <td>
                            <span className="cell-link">{l.lot_code || l.lot_number}</span>
                            {l.lot_code && l.lot_code !== l.lot_number && (
                              <span style={{ fontSize: 9, color: 'var(--g400)', marginLeft: 4 }}>
                                {l.lot_number}
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: 11 }}>{l.item_name}</td>
                          <td><span className="badge b-stock" style={{ fontSize: 9 }}>{l.category}</span></td>
                          <td className="num">{effQty(l).toFixed(4)}</td>
                          <td>{l.unit}</td>
                          <td className="num">₹{Number(l.rate || 0).toLocaleString('en-IN')}</td>
                          <td className="num">₹{Number(l.total_value || 0).toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                
</table>

              )}
          </div>
        </div>

        {/* RIGHT: summary panel */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--g50)', overflow: 'auto' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--g200)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 10 }}>
              Selected Lots ({selected.size})
            </div>

            {selectedLots.length === 0 ? (
              <div style={{ color: 'var(--g400)', fontSize: 12, fontStyle: 'italic' }}>
                Select 2 or more lots from the left.
              </div>
            ) : (
              <>
                {uniqueItems.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, padding: '8px 10px',
                    background: '#FFEBEE', borderRadius: 6, marginBottom: 10,
                    fontSize: 11, color: '#C62828', alignItems: 'flex-start' }}>
                    <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    Different items selected — all lots must be the same item.
                  </div>
                )}

                {selectedLots.map(l => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '5px 0', borderBottom: '1px solid var(--g100)', fontSize: 11 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--g800)', fontWeight: 600 }}>
                      {l.lot_code || l.lot_number}
                    </span>
                    <span style={{ color: 'var(--g600)' }}>
                      {effQty(l).toFixed(4)} {l.unit}
                    </span>
                  </div>
                ))}

                <div style={{ marginTop: 12, padding: 10, background: '#fff',
                  border: '1px solid var(--g200)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--g500)', marginBottom: 4 }}>
                    Result — weighted average
                  </div>
                  {[
                    { l: `Combined ${qtyLabel}`, v: `${totalEffQty.toFixed(4)} ${unit}` },
                    { l: 'Weighted Rate', v: `₹${wAvgRate.toLocaleString('en-IN', { maximumFractionDigits: 4 })}` },
                    { l: 'Total Value', v: `₹${totalVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                  ].map(({ l, v }) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between',
                      fontSize: 12, padding: '3px 0' }}>
                      <span style={{ color: 'var(--g500)' }}>{l}</span>
                      <span style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--g900)' }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div className="form-row" style={{ marginTop: 12 }}>
                  <div className="fg w">
                    <label>Notes (optional)</label>
                    <input value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Reason for mix, batch reference…" />
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: '12px 14px', marginTop: 'auto' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {isModal && (
                <button className="btn" style={{ flex: 1 }} onClick={() => onCancel && onCancel()}>
                  Cancel
                </button>
              )}
              <button className="btn btn-primary" style={{ flex: isModal ? 2 : 1 }}
                disabled={!mixValid} onClick={handlePreview}>
                <Eye size={14} /> Preview Mix
              </button>
            </div>
            {selected.size >= 2 && !mixValid && (
              <div style={{ fontSize: 10, color: '#C62828', marginTop: 6, textAlign: 'center' }}>
                All selected lots must be the same item
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview / Confirm Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Confirm Mix"
        icon={<GitMerge size={16} style={{ marginRight: 6, color: 'var(--brand)' }} />}
        large
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowModal(false)}>Back</button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
              {saving ? 'Creating lot…' : 'Confirm Mix'}
            </button>
          </div>
        }
      >
        {preview && (
          <div>
            <div style={{ marginBottom: 14, fontSize: 12, fontWeight: 700, color: 'var(--g700)' }}>
              Parent lots to be consumed:
            </div>
            <table className="dgrid" style={{ fontSize: 12, marginBottom: 16 }}>
              <thead><tr>
                <th>Lot Number</th><th>{qtyLabel}</th>
                <th>Rate (₹)</th><th>Value (₹)</th>
              </tr></thead>
              <tbody>
                {preview.parents.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{p.lot_number}</td>
                    <td className="num">{p.effective_qty.toFixed(4)}</td>
                    <td className="num">₹{Number(p.rate).toLocaleString('en-IN')}</td>
                    <td className="num">₹{Number(p.total_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ padding: 12, background: '#E8F5E9', borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#2E7D32', marginBottom: 6 }}>
                ↓ Resulting lot ({preview.child_lot_code_preview})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { l: qtyLabel, v: `${preview.child_effective_qty.toFixed(4)} ${preview.unit}` },
                  { l: 'Rate (weighted avg)', v: `₹${Number(preview.child_cost_per_unit).toLocaleString('en-IN', { maximumFractionDigits: 4 })}` },
                  { l: 'Total Value', v: `₹${Number(preview.child_total_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                ].map(({ l, v }) => (
                  <div key={l} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#2E7D32', textTransform: 'uppercase', letterSpacing: '.5px' }}>{l}</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: '#1B5E20', fontSize: 13 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--g500)' }}>
              All parent lots will be marked <strong>CONSUMED</strong> — their qty and value transfer to the new lot.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

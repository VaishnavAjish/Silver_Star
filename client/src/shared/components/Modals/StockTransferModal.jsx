import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import toast from 'react-hot-toast';
import {
  Send, Eye, MapPin, AlertCircle, CheckSquare, Square, Package, Upload,
} from 'lucide-react';

function effQty(lot) {
  return lot.unit === 'CT' ? parseFloat(lot.weight || 0) : parseFloat(lot.qty || 0);
}

const TABLE_COLS = [
  { key: 'lot_code', label: 'Lot Name', width: 130 },
  { key: 'item_name', label: 'Material Name' },
  { key: 'category', label: 'Category', width: 80 },
  { key: 'current_loc', label: 'Current Warehouse', width: 120 },
  { key: 'qty', label: 'Available Qty', width: 80, num: true },
  { key: 'transfer_qty', label: 'Transfer Qty', width: 90, num: true },
  { key: 'unit', label: 'Unit', width: 60 },
  { key: 'total_value', label: 'Transfer Value (₹)', width: 105, num: true },
];

const BLOCK_SIZE = 6;

function createBlankRows(count, startIndex) {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${startIndex + i}`,
    lot_code: '',
    item_name: '',
    category: '',
    fromLocationId: '',
    qty: '',
    transfer_qty: '',
    unit: '',
    total_value: '',
  }));
}

function hasData(row) {
  return !!row.lot_code;
}

export default function StockTransferModal({ open, onClose, selectedRows = [], onTransferComplete }) {
  const api = useApi();

  const [locations, setLocations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [destDepartmentId, setDestDepartmentId] = useState('');
  const [lotSelected, setLotSelected] = useState(new Set());
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transferId, setTransferId] = useState('');
  const [transferQtys, setTransferQtys] = useState({});
  const [blankRows, setBlankRows] = useState([]);

  const selectedRowsRef = useRef(selectedRows);
  selectedRowsRef.current = selectedRows;

  const isBlankMode = selectedRows.length === 0;

  useEffect(() => {
    if (!open) return;

    const rows = selectedRowsRef.current;
    let cancelled = false;

    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    setTransferId(`${dd}${mm}${yy}${hh}${min}${ss}`);

    setLoading(rows.length > 0);

    if (rows.length === 0) {
      setBlankRows(createBlankRows(BLOCK_SIZE, 0));
    }

    Promise.all([
      api.get('/api/locations?limit=500'),
      api.get('/api/departments?limit=500'),
    ])
      .then(([locRes, deptRes]) => {
        if (cancelled) return;
        const locs = locRes.data || locRes || [];
        const depts = deptRes.data || deptRes || [];
        setLocations(locs);
        setDepartments(depts);
        if (rows.length > 0) {
          setLotSelected(new Set(rows.map(r => r.id)));
          const qtys = {};
          rows.forEach(r => qtys[r.id] = effQty(r));
          setTransferQtys(qtys);
        }
      })
      .catch((err) => { console.error('[StockTransferModal] failed to load locations/departments:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDestDepartmentId('');
      setLotSelected(new Set());
      setNotes('');
      setPreview(null);
      setShowPreview(false);
      setSaving(false);
      setTransferId('');
      setTransferQtys({});
      setLocations([]);
      setDepartments([]);
      setBlankRows([]);
    }
  }, [open]);

  const filteredRows = useMemo(() => {
    if (selectedRows.length > 0) return selectedRows;
    return blankRows;
  }, [selectedRows, blankRows]);

  const selectedLots = useMemo(
    () => selectedRows.filter(r => lotSelected.has(r.id)),
    [selectedRows, lotSelected]
  );

  const valid = lotSelected.size > 0 && destDepartmentId;

  const toggleLot = id => {
    setLotSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every(r => lotSelected.has(r.id));

  const toggleAllFiltered = () => {
    setLotSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRows.forEach(r => next.delete(r.id));
      } else {
        filteredRows.forEach(r => next.add(r.id));
      }
      return next;
    });
  };

  const deptOptions = useMemo(() => {
    return (departments || [])
      .filter(d => d.status === 'active' || d.status === 'Active')
      .map(d => ({
        label: `${d.code || ''} - ${d.name}`.replace(/^- /, ''),
        value: String(d.id),
      }));
  }, [departments]);

  const totalValue = selectedLots.reduce((s, l) => s + parseFloat(l.total_value || 0), 0);

  const getPayloadLots = () => [...lotSelected].map(id => ({
    lot_id: id,
    transfer_qty: transferQtys[id] || 0
  }));

  const handlePreview = async () => {
    if (!valid) return;
    try {
      const data = await api.post('/api/stock-transfer/preview', {
        lots: getPayloadLots(),
        destination_department_id: parseInt(destDepartmentId),
      });
      setPreview(data);
      setShowPreview(true);
    } catch (err) { toast.error(err.message); }
  };

  const handleConfirm = async () => {
    if (!valid || saving) return;

    const dstId = parseInt(destDepartmentId);
    if (!dstId) { toast.error('Please select a destination department.'); return; }

    // Build real lot IDs and qtys (handle blank-mode lookup)
    const selectedLotIds = [];
    const transferQtysPayload = {};

    for (const id of lotSelected) {
      let realId = id;
      let qty = parseFloat(transferQtys[id] || 0);

      if (isBlankMode) {
        const r = blankRows.find(br => br.id === id);
        if (!r?.actual_lot_id) continue;
        realId = r.actual_lot_id;
        qty = parseFloat(transferQtys[id] || 0);
      }

      if (!(qty > 0)) { toast.error('Transfer quantity must be greater than zero for all lots.'); return; }
      selectedLotIds.push(realId);
      transferQtysPayload[realId] = qty;
    }

    if (selectedLotIds.length === 0) { toast.error('No valid lots selected.'); return; }

    setSaving(true);
    try {
      await api.post('/api/stock-transfer/pending', {
        transferId,
        destination_department_id: dstId,
        selectedLotIds,
        transferQtys: transferQtysPayload,
      });

      localStorage.removeItem('pending_stock_transfers');
      window.dispatchEvent(new Event('pending_transfers_updated'));
      toast.success(`${selectedLotIds.length} lot(s) queued for approval.`);
      onTransferComplete();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to create transfer.');
    } finally {
      setSaving(false);
    }
  };



  const updateBlankRow = useCallback((index, field, value) => {
    setBlankRows(prev => {
      const next = prev.map((row, i) => i === index ? { ...row, [field]: value } : row);
      if (index >= next.length - 1 && hasData(next[index])) {
        return [...next, ...createBlankRows(BLOCK_SIZE, next.length)];
      }
      return next;
    });
  }, []);

  return (
    <>
      <Modal
        open={open && !showPreview}
        onClose={onClose}
        title={`Stock Transfer - ID: ${transferId}`}
        icon={<Send size={16} style={{ marginRight: 6, color: 'var(--brand)' }} />}
        style={{ width: 1000, maxWidth: '95vw', minHeight: 550 }}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: 11, color: 'var(--g500)', alignSelf: 'center' }}>
              {lotSelected.size} lot{lotSelected.size !== 1 ? 's' : ''} selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => {}}><Upload size={14} /> Load data</button>
              <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" disabled={!valid || saving} onClick={handleConfirm}>
                <Send size={14} /> {saving ? 'Submitting…' : 'Continue to Transfer'}
              </button>
            </div>
          </div>
        }
      >

        {/* ── Department Selection ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--g200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#f0fdf4', padding: '12px 16px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <div style={{ width: 140, fontWeight: 700, fontSize: 11, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transfer To Dept</div>
            <div style={{ flex: 1, maxWidth: 400 }}>
              <SelectDropdown 
                size="sm" 
                value={destDepartmentId} 
                onChange={e => setDestDepartmentId(e.target.value)} 
                style={{ width: '100%' }}
              >
                <option value="">-- Select Department --</option>
                {deptOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </SelectDropdown>
            </div>
          </div>
        </div>



        <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'auto', height: 400 }}>
          {loading && !isBlankMode ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="spinner" /></div>
          ) : (
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }} onClick={e => e.stopPropagation()}>
                    <span onClick={toggleAllFiltered} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                      {allFilteredSelected
                        ? <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                        : <Square size={13} style={{ color: 'var(--g300)' }} />}
                    </span>
                  </th>
                  {TABLE_COLS.map(col => (
                    <th key={col.key} style={{ width: col.width }} className={col.num ? 'num' : ''}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && !isBlankMode ? (
                  <tr>
                    <td colSpan={TABLE_COLS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--g400)', fontSize: 12 }}>
                      <Package size={24} style={{ marginBottom: 6 }} />
                      <div>Select items from inventory to transfer</div>
                    </td>
                  </tr>
                ) : isBlankMode ? (
                  filteredRows.map((r, idx) => {
                    const checked = lotSelected.has(r.id);
                    const locName = r.fromLocationId
                      ? (locations.find(l => String(l.id) === String(r.fromLocationId))?.name || '—')
                      : '—';
                    return (
                      <tr key={r.id}
                        onClick={(e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') toggleLot(r.id); }}
                        style={{ cursor: 'pointer', background: checked ? '#FFFDE0' : undefined }}>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <span onClick={() => toggleLot(r.id)} style={{ cursor: 'pointer' }}>
                            {checked
                              ? <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                              : <Square size={13} style={{ color: 'var(--g300)' }} />}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <SearchableSelect
                            value={r.lot_code ? { id: r.lot_code, name: r.lot_code, code: r.item_name } : null}
                            onChange={item => {
                              if (!item) {
                                setBlankRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], lot_code: '', item_name: '', category: '', fromLocationId: '', qty: '', transfer_qty: '', unit: '', total_value: '' };
                                  return next;
                                });
                                return;
                              }
                              const lot = item._lot;
                              if (!lot) return;
                              const qty = String(effQty(lot));
                              setBlankRows(prev => {
                                const next = prev.map((row, i) => i === idx ? {
                                  ...row,
                                  actual_lot_id: lot.id,
                                  lot_code: lot.lot_code || '',
                                  item_name: lot.item_name || '',
                                  category: lot.category || '',
                                  fromLocationId: String(lot.location_id || ''),
                                  qty,
                                  transfer_qty: qty,
                                  unit: lot.unit || '',
                                  total_value: String(parseFloat(lot.total_value || 0).toFixed(2)),
                                } : row);
                                if (idx >= next.length - 1 && hasData(next[idx])) {
                                  return [...next, ...createBlankRows(BLOCK_SIZE, next.length)];
                                }
                                return next;
                              });
                              setTransferQtys(prev => ({ ...prev, [r.id]: parseFloat(qty) || 0 }));
                            }}
                            onSearch={async q => {
                              if (!q.trim()) return [];
                              try {
                                const res = await api.get(`/api/inventory?search=${encodeURIComponent(q)}&limit=20`);
                                const data = res.data || res || [];
                                return data.map(lot => ({
                                  id: lot.lot_code || lot.lot_number || String(lot.id),
                                  name: lot.lot_code || lot.lot_number || lot.lot_name || '',
                                  code: lot.item_name || '',
                                  _lot: lot,
                                }));
                              } catch (err) { console.error('[StockTransferModal] lot search failed:', err); return []; }
                            }}
                            placeholder="Search lot…"
                            style={{ minWidth: 0, width: '100%' }}
                            inputStyle={{ fontSize: 11, padding: '2px 4px', height: 24 }}
                          />
                        </td>
                        <td style={{ fontSize: 11, color: r.lot_code ? 'var(--g800)' : 'var(--g400)' }}>{r.item_name || '—'}</td>
                        <td><span className="badge b-stock" style={{ fontSize: 9 }}>{r.category || '—'}</span></td>
                        <td style={{ fontSize: 11, color: r.lot_code ? 'var(--g800)' : 'var(--g400)' }}>{locName}</td>
                        <td className="num" style={{ fontSize: 11, color: r.lot_code ? 'var(--g800)' : 'var(--g400)' }}>{r.qty || '—'}</td>
                        <td className="num" onClick={e => e.stopPropagation()}>
                          <input type="number" value={r.transfer_qty}
                            onChange={e => {
                              const maxQty = parseFloat(r.qty) || 0;
                              let v = e.target.value;
                              if (v !== '') {
                                const parsed = parseFloat(v);
                                if (isNaN(parsed) || parsed < 0) v = '0';
                                else if (parsed > maxQty) v = String(maxQty);
                              }
                              updateBlankRow(idx, 'transfer_qty', v);
                              setTransferQtys(prev => ({ ...prev, [r.id]: parseFloat(v) || 0 }));
                            }}
                            placeholder="0" disabled={!r.lot_code}
                            style={{ width: 70, textAlign: 'right', fontSize: 11, padding: '2px 4px' }} />
                        </td>
                        <td style={{ fontSize: 11, color: r.lot_code ? 'var(--g800)' : 'var(--g400)' }}>{r.unit || '—'}</td>
                        <td className="num" style={{ fontSize: 11, color: r.lot_code ? 'var(--g800)' : 'var(--g400)' }}>{r.total_value ? `₹${parseFloat(r.total_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                      </tr>
                    );
                  })
                ) : (
                  filteredRows.map(r => {
                    const checked = lotSelected.has(r.id);
                    const maxQty = effQty(r);
                    const trQty = transferQtys[r.id] ?? maxQty;
                    const proportion = maxQty > 0 ? (trQty / maxQty) : 0;
                    const proratedValue = (parseFloat(r.total_value) || 0) * proportion;

                    return (
                      <tr key={r.id}
                        onClick={(e) => { if (e.target.tagName !== 'INPUT') toggleLot(r.id); }}
                        style={{ cursor: 'pointer', background: checked ? '#FFFDE0' : undefined }}>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <span onClick={() => toggleLot(r.id)} style={{ cursor: 'pointer' }}>
                            {checked
                              ? <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                              : <Square size={13} style={{ color: 'var(--g300)' }} />}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 11.5 }}>{r.lot_code || r.lot_number}</td>
                        <td>{r.item_name || '—'}</td>
                        <td><span className="badge b-stock" style={{ fontSize: 9 }}>{r.category || '—'}</span></td>
                        <td>{r.location_name || r.source_module || '—'}</td>
                        <td className="num">{maxQty.toFixed(4)}</td>
                        <td className="num" onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            value={trQty}
                            onChange={e => {
                              const val = e.target.value === '' ? '' : Math.max(0, Math.min(maxQty, parseFloat(e.target.value) || 0));
                              setTransferQtys(prev => ({...prev, [r.id]: val}));
                              if (!checked) toggleLot(r.id);
                            }}
                            style={{ width: 70, textAlign: 'right', fontSize: 11, padding: '2px 4px' }}
                          />
                        </td>
                        <td>{r.unit || '—'}</td>
                        <td className="num">₹{proratedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="fg" style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600 }}>Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Reason for transfer…" />
        </div>
      </Modal>

      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Confirm Stock Transfer"
        icon={<Send size={16} style={{ marginRight: 6, color: 'var(--brand)' }} />}
        large
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowPreview(false)}>Back</button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
              {saving ? 'Transferring…' : 'Confirm Transfer'}
            </button>
          </div>
        }
      >
        {preview && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1, padding: '10px 12px', background: '#E8F5E9', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#2E7D32', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>Source</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: '#1B5E20' }}>{preview.source_location_name}</div>
              </div>
              <div style={{ flex: 1, padding: '10px 12px', background: '#E3F2FD', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#1565C0', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>Destination</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: '#0D47A1' }}>{preview.destination_location_name}</div>
              </div>
            </div>

            <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 700, color: 'var(--g700)' }}>
              Lots to transfer ({preview.lots.length}):
            </div>

            <table className="dgrid" style={{ fontSize: 12, marginBottom: 14 }}>
              <thead><tr>
                <th>Lot Number</th><th>Item</th><th>Qty</th><th>Unit</th><th>Value (₹)</th>
              </tr></thead>
              <tbody>
                {preview.lots.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{l.lot_number}</td>
                    <td>{l.item_name}</td>
                    <td className="num">{l.qty.toFixed(4)}</td>
                    <td>{l.unit}</td>
                    <td className="num">₹{Number(l.total_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ padding: 10, background: '#F5F5F5', borderRadius: 8, fontSize: 11, color: 'var(--g600)' }}>
              All lots will keep their <strong>IN STOCK</strong> status — only the location changes.
              Movement history is recorded for traceability.
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

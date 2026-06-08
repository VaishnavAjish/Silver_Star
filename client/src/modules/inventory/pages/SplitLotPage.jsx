import { useState, useEffect, useMemo } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, GitBranch, CheckCircle, AlertCircle, Eye, Sliders } from 'lucide-react';

export default function SplitLot({ lotId: propLotId, onComplete, onCancel, isModal }) {
  const params = useParams();
  const lotId = propLotId || params.lotId;
  const navigate  = useNavigate();
  const api       = useApi();

  const [parent,    setParent]   = useState(null);
  const [children,  setChildren] = useState([{ quantity: '', weight: '', remark: '' }]);
  const [saving,    setSaving]   = useState(false);
  const [preview,   setPreview]  = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [notes,     setNotes]    = useState('');

  useEffect(() => {
    api.get(`/api/inventory/${lotId}`)
      .then(data => {
        setParent(data);
        const isSeedParent = data.category === 'seed';
        const eff = data.unit === 'CT'
          ? parseFloat(data.weight || 0)
          : parseFloat(data.qty || 0);
        // Seed: one empty extract row to start
        // Non-seed: pre-fill first row with parent qty (user typically redistributes)
        setChildren(isSeedParent
          ? [{ quantity: '', weight: '', remark: '' }]
          : [
            { quantity: String(eff), weight: '', remark: '' },
            { quantity: '',          weight: '', remark: '' },
          ]
        );
      })
      .catch(() => toast.error('Lot not found'));
  }, [lotId]);

  const isRough    = parent?.unit === 'CT';
  const showWeight = !isRough && parseFloat(parent?.weight || 0) > 0;

  const parentQty    = parent ? parseFloat(parent.qty    || 0) : 0;
  const parentWeight = parent ? parseFloat(parent.weight || 0) : 0;
  const effQty       = isRough ? parentWeight : parentQty;

  const isSeed = parent?.category === 'seed';

  // ── Row management ───────────────────────────────────────────────────────────
  const addRow    = () => setChildren(p => [...p, { quantity: '', weight: '', remark: '' }]);
  const removeRow = i  => { if (children.length > 1) setChildren(p => p.filter((_, j) => j !== i)); };
  const update    = (i, k, v) => setChildren(p => p.map((c, j) => j === i ? { ...c, [k]: v } : c));

  // ── Equal Split helper ───────────────────────────────────────────────────────
  const equalSplit = () => {
    const n = children.length;
    if (!n || effQty <= 0) return;

    // If unit is not CT (i.e. it's PCS), we want whole numbers.
    const useInt = !isRough;

    // Use Math.round to match user's example (30/4 -> 8, 8, 8, 6)
    const eachQty = useInt ? Math.round(effQty / n) : (Math.round(effQty / n * 10000) / 10000);
    
    // Ensure the last row absorbs any rounding differences so the sum exactly matches effQty
    const lastQty = useInt 
      ? Math.max(0, effQty - eachQty * (n - 1)) 
      : (Math.round((effQty - eachQty * (n - 1)) * 10000) / 10000);

    // Apply user's exact requested calculation: Total Weight / Row Qty
    const eachWt = eachQty > 0 ? parentWeight / eachQty : 0;
    const lastWt = lastQty > 0 ? parentWeight / lastQty : 0;

    setChildren(prev => prev.map((c, i) => ({
      ...c,
      quantity: String(i === n - 1 ? lastQty : eachQty),
      ...(showWeight ? { weight: (i === n - 1 ? lastWt : eachWt).toFixed(4) } : {})
    })));
  };

  // ── Computed totals ──────────────────────────────────────────────────────────
  const childQtySum = useMemo(
    () => children.reduce((s, c) => s + (parseFloat(c.quantity) || 0), 0),
    [children]
  );
  const childWtSum = useMemo(
    () => children.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0),
    [children]
  );

  // Seed: remaining stays with parent; non-seed: must fully distribute
  const remainingQty = isSeed ? Math.max(0, effQty - childQtySum) : 0;

  // ── Validation ───────────────────────────────────────────────────────────────
  // Seed: at least one non-empty row; sum must not exceed parent
  const filledSeedRows = isSeed ? children.filter(c => (parseFloat(c.quantity) || 0) > 0) : [];
  const seedValid      = isSeed
    && filledSeedRows.length > 0
    && childQtySum > 0
    && childQtySum <= effQty + 0.0001;

  // Non-seed: every row must be positive and sum must exactly equal parent
  const qtyDiff  = effQty - childQtySum;
  const wtDiff   = parentWeight - childWtSum;
  const qtyValid = !isSeed && Math.abs(qtyDiff) <= 0.0001 && children.every(c => (parseFloat(c.quantity) || 0) > 0);
  const wtValid  = !showWeight || Math.abs(wtDiff) <= 0.0001;

  const valid = isSeed ? seedValid : (qtyValid && wtValid);

  const qtyLabel = isRough ? 'Weight (ct)' : `Qty (${parent?.unit || 'pcs'})`;

  // ── Payload: seed filters empty rows; non-seed sends all ─────────────────────
  const childPayload = () => {
    const rows = isSeed
      ? children.filter(c => (parseFloat(c.quantity) || 0) > 0)
      : children;
    return rows.map(c => ({
      quantity: parseFloat(c.quantity),
      weight:   showWeight && c.weight !== '' ? parseFloat(c.weight) : undefined,
      remark:   c.remark || undefined,
    }));
  };

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!valid) return;
    try {
      const data = await api.post('/api/lot-movements/split/preview', {
        parent_lot_id: parseInt(lotId),
        children: childPayload(),
      });
      setPreview(data);
      setShowModal(true);
    } catch (err) { toast.error(err.message); }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await api.post('/api/lot-movements/split', {
        parent_lot_id: parseInt(lotId),
        children: childPayload(),
        notes,
      });
      const n = res.children.length;
      toast.success(isSeed
        ? `Extracted ${n} lot${n !== 1 ? 's' : ''} from ${parent.lot_code || parent.lot_number} (${res.movement_number})`
        : `Split complete — ${n} new lots created (${res.movement_number})`
      );
      if (isModal && onComplete) {
        onComplete();
      } else {
        navigate('/lot-movements');
      }
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); setShowModal(false); }
  };

  if (!parent) {
    return (
      <div className="animate-in" style={{ padding: 40, textAlign: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  const rate = parseFloat(parent.rate || 0);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>



      <div style={{ flex: 1, overflow: 'auto', padding: isModal ? '0 10px 10px' : 20 }}>
        <div style={{ maxWidth: 900 }}>

          {/* ── Parent card ── */}
          <div style={{
            background: 'var(--brand-50)', border: '1px solid var(--sidebar-border)',
            borderRadius: 10, padding: 14, marginBottom: 20,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 10,
            }}>Parent Lot</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {[
                { l: 'Lot Code',  v: parent.lot_code || parent.lot_number },
                ...(parent.lot_code && parent.lot_code !== parent.lot_number
                  ? [{ l: 'Lot Number', v: parent.lot_number }]
                  : []),
                ...(parent.split_level != null
                  ? [{ l: 'Genealogy Level', v: `Level ${parent.split_level}` }]
                  : []),
                { l: 'Item',        v: parent.item_name },
                { l: `Qty (${parent.unit})`, v: parentQty.toFixed(4) },
                ...(parentWeight > 0 ? [{ l: 'Weight (g/ct)', v: parentWeight.toFixed(4) }] : []),
                { l: 'Rate / Unit', v: `₹${Number(parent.rate || 0).toLocaleString('en-IN')}` },
                { l: 'Total Value', v: `₹${Number(parent.total_value || 0).toLocaleString('en-IN')}` },
                { l: 'Status',      v: parent.status },
              ].map(({ l, v }) => (
                <div key={l} style={{
                  padding: 8, background: '#fff',
                  border: '1px solid var(--g200)', borderRadius: 6,
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    color: 'var(--g500)', letterSpacing: '.5px', marginBottom: 2,
                  }}>{l}</div>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)',
                    fontFamily: 'var(--mono)',
                  }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="fg w">
              <label>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Reason for split, operator name, etc." />
            </div>
          </div>

          {/* ── Unified child-rows table (seed + non-seed) ── */}
          <div>
            {/* Table header row */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 8,
            }}>
              <label style={{
                fontSize: 12, fontWeight: 700, color: 'var(--g600)',
                textTransform: 'uppercase', letterSpacing: '.4px',
              }}>
                {isSeed
                  ? `Extraction Rows (${filledSeedRows.length} of ${children.length})`
                  : `Child Lots (${children.length})`
                }
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-sm"
                  onClick={equalSplit}
                  title="Distribute quantity equally across all rows"
                  disabled={effQty <= 0}
                >
                  <Sliders size={12} /> Equal Split
                </button>
                <button className="btn btn-sm" onClick={addRow}>
                  <Plus size={12} /> {isSeed ? 'Add Row' : 'Add Child'}
                </button>
              </div>
            </div>

            <table className="je-lines-table" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ width: 140 }}>{qtyLabel} *</th>
                  {showWeight && <th style={{ width: 130 }}>Weight (g/ct){isSeed ? '' : ' *'}</th>}
                  <th>Label / Remark (optional)</th>
                  <th style={{ width: 120 }}>Value (₹)</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>

              <tbody>
                {children.map((c, i) => {
                  const rowQty = parseFloat(c.quantity) || 0;
                  const v = rowQty * rate;
                  const isEmpty = rowQty === 0;
                  return (
                    <tr key={i} style={{ opacity: isSeed && isEmpty ? 0.55 : 1 }}>
                      <td style={{ textAlign: 'center', color: 'var(--g500)' }}>{i + 1}</td>
                      <td>
                        <input
                          type="number" step="0.0001" min="0.0001"
                          value={c.quantity}
                          onChange={e => update(i, 'quantity', e.target.value)}
                          style={{ textAlign: 'right', fontWeight: 600 }}
                          placeholder="0.0000"
                        />
                      </td>
                      {showWeight && (
                        <td>
                          <input
                            type="number" step="0.0001" min="0"
                            value={c.weight}
                            onChange={e => update(i, 'weight', e.target.value)}
                            style={{ textAlign: 'right' }}
                            placeholder="0.0000"
                          />
                        </td>
                      )}
                      <td>
                        <input
                          value={c.remark}
                          onChange={e => update(i, 'remark', e.target.value)}
                          placeholder={isSeed ? `Extraction ${i + 1}` : `Child ${String.fromCharCode(65 + i)}`}
                        />
                      </td>
                      <td style={{
                        textAlign: 'right', fontFamily: 'var(--mono)',
                        fontSize: 12, color: 'var(--g700)', paddingRight: 8,
                      }}>
                        {v > 0 ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td>
                        {children.length > 1 && (
                          <button
                            className="icon-btn"
                            onClick={() => removeRow(i)}
                            style={{ color: 'var(--red)' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                {isSeed ? (
                  /* ── Seed footer: extracted total + remaining parent qty ── */
                  <>
                    <tr style={{
                      background: childQtySum > effQty + 0.0001
                        ? '#FFEBEE'
                        : childQtySum > 0 ? '#E8F5E9' : 'var(--g50)',
                    }}>
                      <td colSpan={2} style={{
                        textAlign: 'right', fontWeight: 700,
                        paddingRight: 8, fontSize: 12,
                      }}>
                        Total extracted:
                      </td>
                      {showWeight && <td />}
                      <td style={{
                        fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 13,
                        color: childQtySum > effQty + 0.0001
                          ? '#C62828'
                          : childQtySum > 0 ? '#2E7D32' : 'var(--g500)',
                      }}>
                        {childQtySum.toFixed(4)} / {effQty.toFixed(4)} {parent.unit}
                      </td>
                      <td style={{ fontSize: 11, paddingLeft: 8 }}>
                        {childQtySum > effQty + 0.0001 ? (
                          <span style={{
                            color: '#C62828', display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <AlertCircle size={11} />
                            Over by {(childQtySum - effQty).toFixed(4)}
                          </span>
                        ) : childQtySum > 0 ? (
                          <span style={{ color: '#2E7D32', fontFamily: 'var(--mono)' }}>
                            ₹{(childQtySum * rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        ) : null}
                      </td>
                      <td />
                    </tr>
                    <tr style={{ background: 'var(--brand-50)' }}>
                      <td colSpan={2} style={{
                        textAlign: 'right', fontWeight: 700,
                        paddingRight: 8, fontSize: 12, color: 'var(--brand-dark)',
                      }}>
                        Remaining with parent:
                      </td>
                      {showWeight && <td />}
                      <td style={{
                        fontWeight: 800, fontFamily: 'var(--mono)',
                        fontSize: 13, color: 'var(--brand-dark)',
                      }}>
                        {remainingQty.toFixed(4)} {parent.unit}
                      </td>
                      <td style={{
                        fontSize: 11, paddingLeft: 8,
                        color: 'var(--g600)', fontFamily: 'var(--mono)',
                      }}>
                        {childQtySum > 0 && `₹${(remainingQty * rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                      </td>
                      <td />
                    </tr>
                  </>
                ) : (
                  /* ── Non-seed footer: must-match-exactly ── */
                  <>
                    <tr style={{
                      background: qtyValid ? '#E8F5E9' : qtyDiff < 0 ? '#FFEBEE' : '#FFF3E0',
                    }}>
                      <td colSpan={2} style={{
                        textAlign: 'right', fontWeight: 700, paddingRight: 8, fontSize: 12,
                      }}>
                        Total qty:
                      </td>
                      {showWeight && <td />}
                      <td style={{
                        fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 13,
                        color: qtyValid ? '#2E7D32' : '#C62828',
                      }}>
                        {childQtySum.toFixed(4)} / {parentQty.toFixed(4)} {parent.unit}
                      </td>
                      <td colSpan={2} style={{ fontSize: 11, paddingLeft: 8 }}>
                        {qtyValid ? (
                          <span style={{
                            color: '#2E7D32', display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <CheckCircle size={12} /> Match
                          </span>
                        ) : (
                          <span style={{
                            color: '#C62828', display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <AlertCircle size={12} />
                            {qtyDiff > 0
                              ? `Short by ${qtyDiff.toFixed(4)}`
                              : `Over by ${Math.abs(qtyDiff).toFixed(4)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                    {showWeight && (
                      <tr style={{
                        background: wtValid ? '#E8F5E9' : wtDiff < 0 ? '#FFEBEE' : '#FFF3E0',
                      }}>
                        <td colSpan={2} style={{
                          textAlign: 'right', fontWeight: 700, paddingRight: 8, fontSize: 12,
                        }}>
                          Total weight:
                        </td>
                        <td style={{
                          fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 13,
                          color: wtValid ? '#2E7D32' : '#C62828',
                        }}>
                          {childWtSum.toFixed(4)} / {parentWeight.toFixed(4)} g/ct
                        </td>
                        <td colSpan={3} style={{ fontSize: 11, paddingLeft: 8 }}>
                          {wtValid ? (
                            <span style={{
                              color: '#2E7D32', display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              <CheckCircle size={12} /> Match
                            </span>
                          ) : (
                            <span style={{
                              color: '#C62828', display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              <AlertCircle size={12} />
                              {wtDiff > 0
                                ? `Short by ${wtDiff.toFixed(4)}`
                                : `Over by ${Math.abs(wtDiff).toFixed(4)}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tfoot>
            
</table>


            {/* Seed hint */}
            {isSeed && (
              <div style={{
                fontSize: 11, color: 'var(--g500)', marginTop: 4,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <AlertCircle size={11} />
                Empty rows are ignored. Parent retains remaining qty after extraction.
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Action bar ── */}
      <div style={{
        padding: '10px 20px', background: 'var(--g50)',
        borderTop: '1px solid var(--g200)',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        <button className="btn btn-primary" disabled={!valid} onClick={handlePreview}>
          <Eye size={14} /> Preview Split
        </button>
        <button className="btn" onClick={() => isModal && onCancel ? onCancel() : navigate(-1)}>Cancel</button>

        {/* Inline validation hints */}
        {isSeed && !seedValid && childQtySum > 0 && childQtySum > effQty + 0.0001 && (
          <span style={{ fontSize: 11, color: '#C62828', marginLeft: 8 }}>
            Extract qty exceeds available by {(childQtySum - effQty).toFixed(4)} {parent.unit}
          </span>
        )}
        {isSeed && !seedValid && filledSeedRows.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--g500)', marginLeft: 8 }}>
            Enter at least one extraction qty to continue
          </span>
        )}
        {!isSeed && !qtyValid && childQtySum > 0 && (
          <span style={{ fontSize: 11, color: '#C62828', marginLeft: 8 }}>
            Qty must sum to exactly {parentQty.toFixed(4)} {parent.unit}
          </span>
        )}
        {!isSeed && qtyValid && !wtValid && (
          <span style={{ fontSize: 11, color: '#C62828', marginLeft: 8 }}>
            Weight must sum to exactly {parentWeight.toFixed(4)} g/ct
          </span>
        )}
      </div>

      {/* ── Preview / Confirm Modal ── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Confirm Split"
        icon={<GitBranch size={16} style={{ marginRight: 6, color: 'var(--brand)' }} />}
        large
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowModal(false)}>Back</button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
              {saving
                ? 'Saving…'
                : isSeed
                  ? `Confirm Extract — ${filledSeedRows.length} lot${filledSeedRows.length !== 1 ? 's' : ''}`
                  : `Confirm Split — Create ${children.length} Lots`}
            </button>
          </div>
        }
      >
        {preview && (
          <div>
            <div style={{
              marginBottom: 14, padding: 10, background: '#E8F5E9',
              borderRadius: 8, fontSize: 12, color: '#2E7D32',
            }}>
              <strong>✓</strong> {preview.message}
            </div>
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>New Lot Code</th>
                  <th>{qtyLabel}</th>
                  {showWeight && <th>Weight (g/ct)</th>}
                  <th>Rate (₹)</th>
                  <th>Value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {preview.children_preview.map((c, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>
                      {c.lot_code_preview}
                    </td>
                    <td className="num">{c.quantity.toFixed(4)}</td>
                    {showWeight && (
                      <td className="num">
                        {c.weight != null ? c.weight.toFixed(4) : '—'}
                      </td>
                    )}
                    <td className="num">
                      ₹{Number(c.cost_per_unit).toLocaleString('en-IN')}
                    </td>
                    <td className="num">
                      ₹{Number(c.total_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total:</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {preview.total_child_qty.toFixed(4)}
                  </td>
                  {showWeight && (
                    <td className="num" style={{ fontWeight: 700 }}>
                      {preview.children_preview
                        .reduce((s, c) => s + (c.weight || 0), 0)
                        .toFixed(4)}
                    </td>
                  )}
                  <td />
                  <td className="num" style={{ fontWeight: 700 }}>
                    ₹{preview.children_preview
                      .reduce((s, c) => s + c.total_value, 0)
                      .toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--g500)' }}>
              {isSeed && preview.remaining_parent_qty > 0.0001 ? (
                <>
                  Parent lot{' '}
                  <strong>{parent.lot_code || parent.lot_number}</strong>{' '}
                  will remain{' '}
                  <strong style={{ color: '#2E7D32' }}>IN STOCK</strong> with{' '}
                  <strong>
                    {preview.remaining_parent_qty.toFixed(4)} {parent.unit}
                  </strong>{' '}
                  remaining (₹
                  {(preview.remaining_parent_qty * rate)
                    .toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  ).
                </>
              ) : (
                <>
                  Parent lot{' '}
                  <strong>{parent.lot_number}</strong> will be marked{' '}
                  <strong>CONSUMED</strong> (qty → 0).
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

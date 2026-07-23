/**
 * AllocationModal — lets users allocate a JE line amount against
 * open vendor bills or customer invoices.
 *
 * Props:
 *   isOpen              boolean
 *   onClose             () => void
 *   onSave              (allocations: AllocRow[]) => void
 *   entityType          'vendor' | 'customer'
 *   entityId            number
 *   entityName          string
 *   maxAmount           number   — JE line debit/credit amount (allocation ceiling)
 *   existingAllocations AllocRow[]  — pre-filled when editing
 *
 * AllocRow: { target_type, target_id, doc_number, doc_date, grand_total, allocated_amount }
 */
import { useState, useEffect, useCallback } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { X, Check, AlertCircle, Link2 } from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';

const fmt  = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtD = d => {
  if (!d) return '—';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function AllocationModal({
  isOpen, onClose, onSave,
  entityType, entityId, entityName,
  maxAmount = 0,
  availableAmount = null,
  existingAllocations = [],
  excludeJeId = null,
  sourceLabel = 'JE Line Amount',
  sourceType = 'JE',
  paymentId = null,
}) {
  const api = useApi();
  const [docs,    setDocs]    = useState([]);
  const [amounts, setAmounts] = useState({});   // { [doc_id]: string }
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);

  const isVendor = entityType === 'vendor' || sourceType === 'PAYMENT_ADVANCE';
  const docLabel = isVendor ? 'bill' : 'invoice';
  const capAmount = availableAmount != null ? availableAmount : maxAmount;

  const getDocId = d => d.source_id || d.id;
  const getDocNum = d => d.voucher_no || d.doc_number;
  const getDocDate = d => d.voucher_date || d.doc_date;
  const getDocTotal = d => parseFloat(d.original_amount || d.grand_total || 0);
  const getDocOutstanding = d => parseFloat(d.outstanding_amount || d.outstanding || d.balance_due || 0);

  // ── Load open documents ───────────────────────────────────────────────────
  const loadDocs = useCallback(async () => {
    if (!entityId && !paymentId) return;
    setLoading(true);
    setError('');
    try {
      let endpoint = '';
      if (sourceType === 'PAYMENT_ADVANCE') {
        endpoint = `/api/payments/open?vendor_id=${entityId}`;
      } else {
        const base = isVendor
          ? `/api/payments/open?vendor_id=${entityId}`
          : `/api/receipts/open?customer_id=${entityId}`;
        endpoint = excludeJeId ? `${base}&exclude_je_id=${excludeJeId}` : base;
      }
      const res = await api.get(endpoint);
      const loaded = res.data || [];
      setDocs(loaded);

      // Auto-prefill if opening allocation for the first time
      if ((!existingAllocations || existingAllocations.length === 0) && loaded.length > 0) {
        let left = capAmount;
        const seed = {};
        for (const doc of loaded) {
          if (left <= 0.005) break;
          const docId = doc.source_id || doc.id;
          const outstanding = parseFloat(doc.outstanding_amount || doc.outstanding || doc.balance_due || 0);
          const take = Math.min(outstanding, left);
          if (take > 0) {
            seed[docId] = String(take);
            left -= take;
          }
        }
        setAmounts(seed);
      }
    } catch (err) {
      setError(err.message || 'Failed to load open documents');
    } finally {
      setLoading(false);
    }
  }, [api, entityId, isVendor, excludeJeId, capAmount, existingAllocations, sourceType, paymentId]);

  // Load on open; seed amounts from existingAllocations
  useEffect(() => {
    if (!isOpen) return;
    loadDocs();
    if (existingAllocations && existingAllocations.length > 0) {
      const seed = {};
      existingAllocations.forEach(a => {
        seed[a.target_id] = String(a.allocated_amount || '');
      });
      setAmounts(seed);
    }
  }, [isOpen, entityId]); // eslint-disable-line

  // ── Derived values ────────────────────────────────────────────────────────
  const totalAllocated = Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const remaining      = capAmount - totalAllocated;
  const isOverAllocated = totalAllocated > capAmount + 0.005;

  // ── Quick-fill helpers ────────────────────────────────────────────────────
  const allocateFull = (doc) => {
    const docId = getDocId(doc);
    const available = Math.min(getDocOutstanding(doc), remaining + (parseFloat(amounts[docId]) || 0));
    setAmounts(p => ({ ...p, [docId]: available > 0 ? String(available) : '' }));
  };

  const allocateAll = () => {
    let left = capAmount;
    const next = {};
    for (const doc of docs) {
      if (left <= 0.005) break;
      const take = Math.min(getDocOutstanding(doc), left);
      if (take > 0) next[getDocId(doc)] = String(take);
      left -= take;
    }
    setAmounts(next);
  };

  const clearAll = () => setAmounts({});

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (isOverAllocated) return;

    const result = docs
      .filter(d => parseFloat(amounts[getDocId(d)] || 0) > 0)
      .map(d => ({
        target_type:      docLabel,
        target_id:        getDocId(d),
        doc_number:       getDocNum(d),
        doc_date:         getDocDate(d),
        grand_total:      getDocTotal(d),
        allocated_amount: parseFloat(amounts[getDocId(d)]),
      }));

    if (sourceType === 'PAYMENT_ADVANCE') {
      setSaving(true);
      try {
        for (const item of result) {
          await api.post('/api/vendor-advances/apply', {
            purchase_note_id: item.target_id,
            vendor_id: entityId,
            mode: 'auto',
          });
        }
        if (onSave) onSave(result);
        onClose();
      } catch (err) {
        setError(err.message || 'Failed to apply advance');
      } finally {
        setSaving(false);
      }
    } else {
      if (onSave) onSave(result);
      onClose();
    }
  };

  if (!isOpen) return null;

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(docs, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-lg"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 700, width: '95vw' }}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link2 size={16} style={{ color: 'var(--brand)' }} />
            <h3 style={{ margin: 0, fontSize: 15 }}>
              Allocate Against Open {isVendor ? 'Bills' : 'Invoices'}
              <span style={{ fontWeight: 400, color: 'var(--g500)', marginLeft: 8, fontSize: 13 }}>
                — {entityName}
              </span>
            </h3>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Info bar */}
        <div style={{
          padding: '10px 20px', background: 'var(--g50)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--g500)', marginRight: 6 }}>{sourceLabel}:</span>
            <strong style={{ fontFamily: 'var(--mono)', color: 'var(--brand)' }}>{fmt(capAmount)}</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--g500)', marginRight: 6 }}>Allocated:</span>
            <strong style={{ fontFamily: 'var(--mono)', color: isOverAllocated ? '#C62828' : '#2E7D32' }}>
              {fmt(totalAllocated)}
            </strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--g500)', marginRight: 6 }}>Remaining:</span>
            <strong style={{ fontFamily: 'var(--mono)', color: remaining < -0.005 ? '#C62828' : 'var(--g700)' }}>
              {fmt(remaining)}
            </strong>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={allocateAll} style={{ fontSize: 11 }}>
              Auto-fill All
            </button>
            <button className="btn btn-sm" onClick={clearAll} style={{ fontSize: 11 }}>
              Clear
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: 0, maxHeight: '55vh', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : error ? (
            <div style={{ padding: 24, color: '#C62828', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} /> {error}
            </div>
          ) : docs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--g500)', fontSize: 13 }}>
              No open {isVendor ? 'bills' : 'invoices'} found for {entityName}.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--g50)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left',  fontWeight: 600 }}>
                    {isVendor ? 'Bill #' : 'Invoice #'}
                  </th>
                  <th style={{ padding: '8px 12px', textAlign: 'left',  fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Total</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Outstanding</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Allocate (₹)</th>
                  <th style={{ padding: '8px 6px',  textAlign: 'center', fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map(doc => {
                  const docId = getDocId(doc);
                  const allocated = parseFloat(amounts[docId] || 0);
                  const overDoc   = allocated > getDocOutstanding(doc) + 0.005;
                  return (
                    <tr key={docId} style={{ borderBottom: '1px solid var(--g100)' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
                        {getDocNum(doc)} {doc.source_type && <span style={{fontSize: 9, opacity: 0.6}}>({doc.source_type === 'expense' ? 'EXP' : 'PO'})</span>}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--g600)' }}>
                        {fmtD(getDocDate(doc))}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                        {fmt(getDocTotal(doc))}
                      </td>
                      <td style={{
                        padding: '8px 12px', textAlign: 'right',
                        fontFamily: 'var(--mono)', fontWeight: 600,
                        color: getDocOutstanding(doc) > 0 ? '#1565C0' : 'var(--g400)',
                      }}>
                        {fmt(getDocOutstanding(doc))}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amounts[docId] || ''}
                          onChange={e => setAmounts(p => ({ ...p, [docId]: e.target.value }))}
                          placeholder="0.00"
                          style={{
                            width: 110, textAlign: 'right',
                            height: 30, fontSize: 12, fontFamily: 'var(--mono)',
                            border: `1px solid ${overDoc ? '#C62828' : '#ccc'}`,
                            borderRadius: 4, padding: '0 8px',
                            outline: 'none', boxSizing: 'border-box',
                          }}
                        />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <button
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', whiteSpace: 'nowrap' }}
                          onClick={() => allocateFull(doc)}
                          title="Allocate full outstanding"
                        >
                          Full
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{docs.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {docs.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, docs.length)} of {docs.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
</td></tr></tfoot>
</table>

          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {isOverAllocated && (
            <span style={{ fontSize: 12, color: '#C62828', display: 'flex', alignItems: 'center', gap: 5, marginRight: 'auto' }}>
              <AlertCircle size={13} />
              Total allocation exceeds {sourceLabel} by {fmt(totalAllocated - capAmount)}
            </span>
          )}
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isOverAllocated || totalAllocated <= 0 || saving}
          >
            <Check size={13} />
            {saving ? 'Saving...' : `Save ${Object.values(amounts).filter(v => parseFloat(v) > 0).length} Allocation(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

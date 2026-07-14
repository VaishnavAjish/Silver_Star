import React, { useState, useEffect } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import Modal from '../../../shared/components/Modal';

export default function ViewUnionDrawer({ open, onClose, actionRow, lotId }) {
  const api = useApi();
  const [unionRows, setUnionRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !actionRow) {
      setUnionRows([]);
      return;
    }

    // View Union logic: fetch from the exact backend resolver
    const fetchUnion = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/api/inventory/history/union?lot_id=${lotId}&canonical_transaction_key=${encodeURIComponent(actionRow.history_id)}`);
        setUnionRows(res.data || []);
      } catch(err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUnion();
  }, [open, actionRow, api]);

  if (!open || !actionRow) return null;

  return (
    <Modal open={open} onClose={onClose} title="View Union" width={800}>
      <div style={{ padding: '0 20px 20px 20px' }}>

        {unionRows.length > 0 && unionRows.some(r => r.grouping_quality === 'INFERRED') && (
           <div style={{ padding: 12, background: '#FFF3E0', color: '#E65100', borderRadius: 8, marginBottom: 16 }}>
             <strong>Notice:</strong> Transaction grouping was inferred from source records, as this is a legacy operation.
           </div>
        )}

        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Transaction Summary</h4>
          <div><strong>Date:</strong> {new Date(actionRow.ts).toLocaleString('en-IN')}</div>
          <div><strong>Document:</strong> {actionRow.doc_no || '—'}</div>
          <div><strong>Operator:</strong> {actionRow.user || '—'}</div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        ) : error ? (
          <div style={{ color: 'red' }}>Error: {error}</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--g200)', borderRadius: 8 }}>
            <table className="dgrid" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Event Type</th>
                  <th>Source</th>
                  <th>Status Δ</th>
                  <th className="num">Qty Δ</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {unionRows.map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.event_type}</strong></td>
                    <td>{r.source}</td>
                    <td>{r.status_change || (r.new_status || '—')}</td>
                    <td className="num">{r.qty_delta || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--g600)' }}>{r.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

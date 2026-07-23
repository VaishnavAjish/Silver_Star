import React, { useState } from 'react';
import Modal from '../../../shared/components/Modal';

export default function CancellationModal({ open, onClose, actionRow, onConfirm, isSubmitting, eligibility }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);

  if (!open || !actionRow) return null;

  const canCancel = eligibility ? eligibility.can_cancel : true;
  const reasonText = eligibility?.reason;

  const handleConfirm = () => {
    if (!canCancel) return;
    if (!reason.trim() || reason.trim().length < 5) return;
    if (!ack) return;
    onConfirm(actionRow, reason.trim());
  };

  return (
    <Modal open={open} onClose={onClose} title="Cancel Transaction" width={600}>
      <div style={{ padding: '0 20px 20px 20px' }}>

        {canCancel ? (
          <div style={{ padding: 12, background: '#FFEBEE', color: '#C62828', borderRadius: 8, marginBottom: 16 }}>
            <strong>Warning:</strong> You are about to cancel this transaction. This will create a reversal record and restore the previous state. The original history is not deleted.
          </div>
        ) : (
          <div style={{ padding: 12, background: '#FFF3E0', color: '#E65100', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <strong>Notice:</strong> {reasonText || 'Safe reversal for this transaction type is not yet available.'}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
          <tbody>
            <tr><td style={tdStyle}>Transaction</td><td style={tdValStyle}><strong>{actionRow.event_type}</strong></td></tr>
            <tr><td style={tdStyle}>Document No</td><td style={tdValStyle}>{actionRow.doc_no || '—'}</td></tr>
            <tr><td style={tdStyle}>Date & Time</td><td style={tdValStyle}>{new Date(actionRow.ts).toLocaleString('en-IN')}</td></tr>
            <tr><td style={tdStyle}>Impact</td><td style={tdValStyle}>
              Qty: {actionRow.qty_delta || '—'}
              {actionRow.weight_change ? ` | Weight: ${actionRow.weight_change}` : ''}
            </td></tr>
          </tbody>
        </table>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--g700)', marginBottom: 6 }}>
            Mandatory Reversal Reason *
          </label>
          <textarea
            className="input"
            style={{ width: '100%', minHeight: 60 }}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain why this transaction is being reversed..."
            disabled={!canCancel}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--g800)', cursor: canCancel ? 'pointer' : 'not-allowed' }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={!canCancel} />
            I understand that this creates a reversal and does not delete history.
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn" onClick={onClose} disabled={isSubmitting}>Keep Transaction</button>
          <button
            className="btn btn-danger"
            onClick={handleConfirm}
            disabled={!canCancel || !ack || reason.trim().length < 5 || isSubmitting}
            style={{ background: canCancel ? '#C62828' : 'var(--g300)', color: '#fff', border: 'none' }}
          >
            {isSubmitting ? 'Reversing...' : 'Confirm Reversal'}
          </button>
        </div>

      </div>
    </Modal>
  );
}

const tdStyle = { padding: '6px 0', borderBottom: '1px solid var(--g200)', color: 'var(--g600)', width: '30%', verticalAlign: 'top' };
const tdValStyle = { padding: '6px 0', borderBottom: '1px solid var(--g200)', color: 'var(--g900)', verticalAlign: 'top' };

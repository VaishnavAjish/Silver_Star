import React from 'react';
import Modal from '../../../shared/components/Modal';

export default function ViewActionDrawer({ open, onClose, actionRow }) {
  if (!open || !actionRow) return null;

  return (
    <Modal open={open} onClose={onClose} title="View Action" width={600}>
      <div style={{ padding: '0 20px 20px 20px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            <tr><td style={tdStyle}>Date & Time</td><td style={tdValStyle}>{new Date(actionRow.ts).toLocaleString('en-IN')}</td></tr>
            <tr><td style={tdStyle}>Document No</td><td style={tdValStyle}>{actionRow.doc_no || '—'}</td></tr>
            <tr><td style={tdStyle}>Event Type</td><td style={tdValStyle}><strong>{actionRow.event_type}</strong></td></tr>
            <tr><td style={tdStyle}>Event Class</td><td style={tdValStyle}>
              {actionRow.event_class}
              {actionRow.event_class === 'INFORMATIONAL' && <span style={{ color: 'var(--g500)', fontStyle: 'italic', marginLeft: 8 }}>(no inventory balance impact)</span>}
            </td></tr>
            <tr><td style={tdStyle}>Source Module</td><td style={tdValStyle}>{actionRow.source}</td></tr>
            <tr><td style={tdStyle}>Source Record ID</td><td style={tdValStyle}>{actionRow.source_type} / {actionRow.source_id}</td></tr>
            <tr><td style={tdStyle}>Transaction Status</td><td style={tdValStyle}>{actionRow.txn_status}</td></tr>
            <tr><td style={tdStyle}>Operator</td><td style={tdValStyle}>{actionRow.user || '—'}</td></tr>
            <tr><td style={tdStyle}>Status Change</td><td style={tdValStyle}>{actionRow.status_change || '—'}</td></tr>
            <tr><td style={tdStyle}>Quantity Delta</td><td style={tdValStyle}>{actionRow.qty_delta != null ? actionRow.qty_delta : '—'}</td></tr>
            <tr><td style={tdStyle}>Weight Delta</td><td style={tdValStyle}>{actionRow.weight_change || '—'}</td></tr>
            <tr><td style={tdStyle}>Dimension Delta</td><td style={tdValStyle}>{actionRow.dimension_change || '—'}</td></tr>
            <tr><td style={tdStyle}>Balance After (Qty)</td><td style={tdValStyle}>{actionRow.qty_after}</td></tr>
            <tr><td style={tdStyle}>Remarks / Details</td><td style={tdValStyle}><div style={{ whiteSpace: 'pre-wrap' }}>{actionRow.remarks || '—'}</div></td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

const tdStyle = { padding: '8px 12px', borderBottom: '1px solid var(--g200)', color: 'var(--g600)', width: '35%', verticalAlign: 'top' };
const tdValStyle = { padding: '8px 12px', borderBottom: '1px solid var(--g200)', color: 'var(--g900)', verticalAlign: 'top' };

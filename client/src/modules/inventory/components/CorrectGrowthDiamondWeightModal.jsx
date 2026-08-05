import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import { X, Save, AlertCircle } from 'lucide-react';

export default function CorrectGrowthDiamondWeightModal({ lot, onClose, onComplete }) {
  const api = useApi();
  const [submitting, setSubmitting] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [reason, setReason] = useState('');

  const currentWeight = parseFloat(lot?.weight || 0);
  const nw = parseFloat(newWeight);
  const variance = !isNaN(nw) ? nw - currentWeight : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newWeight || isNaN(nw) || nw <= 0) {
      toast.error('New weight must be a valid positive number');
      return;
    }
    if (!reason.trim()) {
      toast.error('Reason is required');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/api/inventory/${lot.id}/corrections/weight`, {
        expected_old_weight: currentWeight,
        new_weight: nw,
        reason: reason.trim()
      });
      toast.success('Weight corrected successfully');
      onComplete();
    } catch (err) {
      toast.error(err.message || 'Failed to correct weight');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div className="modal" style={{ width: '90vw', maxWidth: 450 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: '#0369a1' }}>
            <AlertCircle size={16} /> Correct Growth Diamond Weight
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Lot</label>
                <div style={{ padding: '8px 12px', background: 'var(--g100)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--g800)' }}>
                  {lot?.lot_code || lot?.lot_number || 'Unknown'}
                </div>
              </div>
              <div className="form-group">
                <label>Current Weight (CT)</label>
                <div style={{ padding: '8px 12px', background: 'var(--g100)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--g800)' }}>
                  {currentWeight.toFixed(4)}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>New Weight (CT) <span style={{ color: '#ef4444' }}>*</span></label>
                <input 
                  type="number" 
                  step="0.0001"
                  min="0"
                  value={newWeight}
                  onChange={e => setNewWeight(e.target.value)}
                  className="input" 
                  style={{ fontFamily: 'var(--mono)' }}
                  placeholder="e.g. 12.3456"
                  required
                />
              </div>
              <div className="form-group">
                <label>Variance (CT)</label>
                <div style={{ padding: '8px 12px', background: variance === 0 ? 'var(--g100)' : (variance > 0 ? '#dcfce7' : '#fee2e2'), borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: variance === 0 ? 'var(--g800)' : (variance > 0 ? '#166534' : '#991b1b') }}>
                  {variance > 0 ? '+' : ''}{variance.toFixed(4)}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>Reason <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea 
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input" 
                rows={3}
                placeholder="Explain why this weight is being corrected..."
                required
              />
            </div>
            
            <div style={{ padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, fontSize: 11, color: '#0369a1', lineHeight: 1.4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <strong>Note:</strong> This updates the existing Growth Diamond and does not create a new lot or delete manufacturing history.
              </div>
            </div>
          </div>
          
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !newWeight || isNaN(nw)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Save size={14} /> {submitting ? 'Correcting...' : 'Correct Weight'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

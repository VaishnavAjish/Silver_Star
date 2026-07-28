import { useState, useEffect } from 'react';
import Modal from '../../../shared/components/Modal';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import { Edit, AlertCircle, RefreshCw, Lock } from 'lucide-react';

export default function CorrectLotNameModal({ open, onClose, lot, onUpdated }) {
  const api = useApi();
  const [newLotName, setNewLotName] = useState('');
  const [reason, setReason]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [reopening, setReopening]   = useState(false);
  const [batchStatus, setBatchStatus] = useState(lot?.batch_status || 'DRAFT');

  useEffect(() => {
    if (lot) {
      setNewLotName(lot.lot_name || '');
      setReason('');
      setBatchStatus(lot.batch_status || 'DRAFT');
    }
  }, [lot]);

  if (!lot) return null;

  const isReadyForImport = batchStatus === 'READY_FOR_FINAL_IMPORT';
  const isB5Confirmed = Boolean(lot.b5_confirmed);

  const handleReopenBatch = async () => {
    if (!lot.batch_id) return;
    setReopening(true);
    try {
      await api.post(`/api/nidhi-connect/batches/${lot.batch_id}/reopen`);
      toast.success('Batch reopened successfully');
      setBatchStatus('REOPENED');
    } catch (err) {
      toast.error(err.message || 'Failed to reopen batch');
    } finally {
      setReopening(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      return toast.error('A mandatory correction reason is required');
    }

    const trimmedNewName = newLotName.trim().toUpperCase();
    if (!trimmedNewName) {
      return toast.error('Please provide a valid new lot name');
    }

    if (trimmedNewName === lot.lot_name) {
      return toast.error('New lot name must be different from current lot name');
    }

    setLoading(true);
    try {
      const res = await api.post(`/api/nidhi-connect/lots/${lot.id}/correct-name`, {
        new_lot_name: trimmedNewName,
        reason: reason.trim(),
        expected_row_version: lot.row_version,
      });

      toast.success(`Lot name corrected to ${res.lot.lot_name}`);
      if (onUpdated) onUpdated(res.lot);
      if (onClose) onClose();
    } catch (err) {
      if (err.status === 409) {
        toast.error(err.message || 'Version mismatch or duplicate lot name');
      } else {
        toast.error(err.message || 'Failed to correct lot name');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Correct Lot Name (NidhiConnect)"
      icon={<Edit size={16} style={{ color: 'var(--brand)', marginRight: 6 }} />}
      large
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || isReadyForImport || isB5Confirmed}
          >
            {loading ? 'Correcting…' : 'Save Correction'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Guard Alert 1: B5 Confirmation Lock */}
        {isB5Confirmed && (
          <div style={{
            display: 'flex', gap: 8, padding: '10px 12px', background: '#FFEBEE',
            border: '1px solid #FFCDD2', borderRadius: 6, fontSize: 12, color: '#C62828'
          }}>
            <Lock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>B5 / External Reconciliation Lock:</strong>
              <p style={{ margin: '2px 0 0' }}>
                Direct correction is permanently blocked after B5/Fantasy confirmation. Please use the controlled external-reconciliation workflow.
              </p>
            </div>
          </div>
        )}

        {/* Guard Alert 2: Batch Ready for Import Lock */}
        {isReadyForImport && !isB5Confirmed && (
          <div style={{
            display: 'flex', gap: 10, padding: '10px 12px', background: '#FFF3E0',
            border: '1px solid #FFE0B2', borderRadius: 6, fontSize: 12, color: '#E65100',
            alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Batch Locked (READY_FOR_FINAL_IMPORT):</strong>
                <p style={{ margin: '2px 0 0' }}>
                  This batch is locked for import. Reopen the batch first to allow lot name corrections.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleReopenBatch}
              disabled={reopening}
              style={{ flexShrink: 0, background: '#E65100', color: '#fff', border: 'none' }}
            >
              <RefreshCw size={12} className={reopening ? 'spin' : ''} /> {reopening ? 'Reopening…' : 'Reopen Batch'}
            </button>
          </div>
        )}

        {/* Form Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg">
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>Current Lot Name</label>
            <input
              type="text"
              value={lot.lot_name || ''}
              readOnly
              style={{ background: 'var(--g100)', color: 'var(--g700)', fontFamily: 'var(--mono)', fontWeight: 600 }}
            />
          </div>

          <div className="fg">
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
              Sequence Number (Immutable)
            </label>
            <input
              type="text"
              value={lot.sequence_number || ''}
              readOnly
              style={{ background: 'var(--g100)', color: 'var(--g700)', fontFamily: 'var(--mono)' }}
            />
          </div>
        </div>

        <div className="fg">
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
            New Lot Name <span style={{ color: '#C62828' }}>*</span>
          </label>
          <input
            type="text"
            value={newLotName}
            onChange={(e) => setNewLotName(e.target.value)}
            placeholder="e.g. SSD013-JUL26-040"
            disabled={isReadyForImport || isB5Confirmed}
            style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}
          />
          <span style={{ fontSize: 10, color: 'var(--g500)', marginTop: 2 }}>
            Must be company-wide unique. Sequence number must match and series linkage will be updated automatically.
          </span>
        </div>

        <div className="fg">
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
            Mandatory Correction Reason <span style={{ color: '#C62828' }}>*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for name correction (e.g. month code registration error)..."
            disabled={isReadyForImport || isB5Confirmed}
          />
        </div>

        <div style={{ padding: 10, background: 'var(--g50)', borderRadius: 6, fontSize: 11, color: 'var(--g600)' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Rules & Integrity Contract:</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>ImportRowLot ID and sequence remain unchanged.</li>
            <li>Lot Series counter is <strong>not</strong> incremented or consumed.</li>
            <li>Old name is permanently retained in the append-only event ledger.</li>
          </ul>
        </div>
      </form>
    </Modal>
  );
}

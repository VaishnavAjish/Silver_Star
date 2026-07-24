import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import { X, Save } from 'lucide-react';

export default function EditLotModal({ lotId, onClose, onComplete }) {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    qty: '', weight: '', dim_length: '', dim_depth: '', dim_height: '', dim_unit: ''
  });

  useEffect(() => {
    if (!lotId) return;
    setLoading(true);
    api.get(`/api/inventory/${lotId}`)
      .then(res => {
        setFormData({
          qty: res.qty ?? '',
          weight: res.weight ?? '',
          dim_length: res.dim_length ?? '',
          dim_depth: res.dim_depth ?? '',
          dim_height: res.dim_height ?? '',
          dim_unit: res.dim_unit ?? ''
        });
      })
      .catch(err => {
        toast.error('Failed to load lot details');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [lotId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        qty: formData.qty === '' ? null : Number(formData.qty),
        weight: formData.weight === '' ? null : Number(formData.weight),
        dim_length: formData.dim_length === '' ? null : Number(formData.dim_length),
        dim_depth: formData.dim_depth === '' ? null : Number(formData.dim_depth),
        dim_height: formData.dim_height === '' ? null : Number(formData.dim_height),
        dim_unit: formData.dim_unit
      };
      
      await api.put(`/api/inventory/edit/${lotId}`, payload);
      toast.success('Lot updated successfully');
      onComplete();
    } catch (err) {
      toast.error(err.message || 'Failed to update lot');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div className="modal" style={{ width: '90vw', maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 600 }}>Edit Lot Details</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label>Quantity (PCS)</label>
                <input 
                  type="number" 
                  name="qty" 
                  value={formData.qty} 
                  onChange={handleChange} 
                  step="any"
                  className="input" 
                />
              </div>
              <div className="form-group">
                <label>Weight (CT)</label>
                <input 
                  type="number" 
                  name="weight" 
                  value={formData.weight} 
                  onChange={handleChange} 
                  step="any"
                  className="input" 
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Length</label>
                  <input 
                    type="number" 
                    name="dim_length" 
                    value={formData.dim_length} 
                    onChange={handleChange} 
                    step="any"
                    className="input" 
                  />
                </div>
                <div className="form-group">
                  <label>Depth</label>
                  <input 
                    type="number" 
                    name="dim_depth" 
                    value={formData.dim_depth} 
                    onChange={handleChange} 
                    step="any"
                    className="input" 
                  />
                </div>
                <div className="form-group">
                  <label>Height</label>
                  <input 
                    type="number" 
                    name="dim_height" 
                    value={formData.dim_height} 
                    onChange={handleChange} 
                    step="any"
                    className="input" 
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Dimension Unit</label>
                <input 
                  type="text" 
                  name="dim_unit" 
                  value={formData.dim_unit} 
                  onChange={handleChange} 
                  className="input" 
                  placeholder="e.g. mm"
                />
              </div>
            </div>
            
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Save size={14} /> {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

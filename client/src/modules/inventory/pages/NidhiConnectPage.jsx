import { useState, useEffect, useMemo } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import CorrectLotNameModal from '../components/CorrectLotNameModal';
import { Edit, Lock, CheckCircle, Search, RefreshCw, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NidhiConnectPage() {
  const api = useApi();
  const [lots, setLots]           = useState([]);
  const [batches, setBatches]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectedLot, setSelectedLot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const fetchLots = async () => {
    setLoading(true);
    try {
      // Get import row lots if endpoint exists or load from nidhiConnect / inventory
      const res = await api.get('/api/nidhi-connect/lots').catch(() => ({ data: [] }));
      setLots(res.data || []);
    } catch (err) {
      toast.error('Failed to load import lots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLots();
  }, []);

  const handleCorrectName = (lot) => {
    setSelectedLot(lot);
    setShowModal(true);
  };

  const handleUpdated = (updatedLot) => {
    setLots(prev => prev.map(l => l.id === updatedLot.id ? { ...l, ...updatedLot } : l));
    fetchLots();
  };

  const filteredLots = useMemo(() => {
    if (!search.trim()) return lots;
    const s = search.toLowerCase();
    return lots.filter(l =>
      l.lot_name?.toLowerCase().includes(s) ||
      l.sequence_number?.toLowerCase().includes(s)
    );
  }, [lots, search]);

  return (
    <div className="animate-in" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--brand-dark)' }}>
            NidhiConnect — Import Lot Management
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--g600)' }}>
            Controlled Lot Name Correction, Batch Reopening, and Lineage Audit Ledger.
          </p>
        </div>
        <button className="btn" onClick={fetchLots} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--g400)' }} />
          <input
            type="text"
            placeholder="Search lot name or sequence..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, height: 34, width: '100%', borderRadius: 6, border: '1px solid var(--g300)' }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--g600)' }}>{filteredLots.length} lots</span>
      </div>

      <div className="grid-wrap" style={{ flex: 1, overflow: 'auto', background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
        ) : filteredLots.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center', color: 'var(--g500)' }}>
            <AlertCircle size={32} style={{ marginBottom: 8, color: 'var(--g400)' }} />
            <div>No import row lots found.</div>
          </div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Lot Name</th>
                <th style={{ width: 100 }}>Sequence</th>
                <th style={{ width: 90 }}>Version</th>
                <th style={{ width: 140 }}>Batch Status</th>
                <th style={{ width: 120 }}>B5 Status</th>
                <th style={{ width: 110 }} className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLots.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>#{l.id}</td>
                  <td>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--g900)' }}>
                      {l.lot_name}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{l.sequence_number}</td>
                  <td style={{ fontSize: 11 }}>v{l.row_version}</td>
                  <td>
                    <span className={`badge ${l.batch_status === 'READY_FOR_FINAL_IMPORT' ? 'b-warn' : 'b-stock'}`} style={{ fontSize: 10 }}>
                      {l.batch_status || 'DRAFT'}
                    </span>
                  </td>
                  <td>
                    {l.b5_confirmed ? (
                      <span className="badge b-danger" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={10} /> Confirmed
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--g500)' }}>—</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="btn btn-sm" onClick={() => handleCorrectName(l)} style={{ fontSize: 11, padding: '3px 8px' }}>
                      <Edit size={12} /> Correct
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CorrectLotNameModal
        open={showModal}
        onClose={() => setShowModal(false)}
        lot={selectedLot}
        onUpdated={handleUpdated}
      />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import LotLineageTree from '../components/LotLineageTree';
import { ArrowLeft, GitBranch, GitMerge, Share2, Play } from 'lucide-react';

export default function LotLineagePage() {
  const { lotId }  = useParams();
  const navigate   = useNavigate();
  const api        = useApi();
  const [lineage,  setLineage]  = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/lot-movements/lineage/${lotId}`)
      .then(data => setLineage(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lotId]);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {lineage && (
        <div style={{ padding: '12px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderBottom: '1px solid var(--g200)' }}>
          <button className="btn btn-sm btn-primary"
            onClick={() => navigate(`/inventory/${lotId}/split`)}
            disabled={lineage.lot.status !== 'IN STOCK'}>
            <GitBranch size={12} /> Split This Lot
          </button>
          <button className="btn btn-sm"
            onClick={() => navigate(`/inventory/process-issues/new?lot_id=${lotId}`)}
            disabled={lineage.lot.status !== 'IN STOCK'}>
            <Play size={12} /> Issue to Process
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
        ) : !lineage ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <Share2 size={32} />
            <p>Lot not found</p>
          </div>
        ) : (
          <div style={{ maxWidth: 700 }}>
            <LotLineageTree lineage={lineage} />
          </div>
        )}
      </div>
    </div>
  );
}

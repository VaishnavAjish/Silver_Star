import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../core/context/AuthContext';
import LotLabel from '../../inventory/components/LotLabel';

function assetToLot(a) {
  return {
    id:            a.id,
    lot_number:    a.asset_code,
    lot_name:      a.asset_name,
    weight:        null,
    purchase_date: a.purchase_date,
    serial_no:     a.serial_no,
    location:      a.location_name,
  };
}

export default function LabelsPrintPage() {
  const [searchParams] = useSearchParams();
  const { token }      = useAuth();
  const navigate       = useNavigate();

  const [lots, setLots]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    const ids     = (searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
    const type    = searchParams.get('type') || 'inventory';
    const apiBase = type === 'fixed_asset' ? '/api/fixed-assets' : '/api/inventory';

    if (!ids.length) { setLoading(false); setError('No IDs provided'); return; }

    const fetchAll = async () => {
      try {
        const results = await Promise.all(
          ids.map(id =>
            fetch(`${apiBase}/${id}`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(r => r.ok ? r.json() : null)
          )
        );
        const found = results.filter(Boolean).map(r =>
          type === 'fixed_asset' ? assetToLot(r) : r
        );
        if (!found.length) setError('No items found for the given IDs');
        else setLots(found);
      } catch {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [searchParams, token]);

  useEffect(() => {
    if (!loading && lots.length > 0) {
      const t = setTimeout(() => window.print(), 1000);
      return () => clearTimeout(t);
    }
  }, [loading, lots.length]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading labels…</div>;
  if (error)   return <div style={{ padding: 40, color: '#c00' }}>{error}</div>;

  return (
    <>
      <div className="lp-toolbar no-print">
        <button onClick={() => navigate(-1)}>← Back</button>
        <button onClick={() => window.print()}>🖨 Print</button>
        <span className="lp-info">{lots.length} label{lots.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="lp-labels">
        {lots.map(lot => <LotLabel key={lot.id} lot={lot} />)}
      </div>

      <style>{`
        @page { margin: 5mm; }

        /* LotLabel styles — rendered once here, not inside each label instance */
        .lot-label {
          width: 50mm; height: 30mm; padding: 2mm 3mm; box-sizing: border-box;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border: 0.3mm solid #ccc;
          font-family: 'DM Sans', Arial, sans-serif;
          overflow: hidden; page-break-inside: avoid;
        }
        .lot-label__company {
          font-size: 6pt; font-weight: 700; letter-spacing: 0.05em;
          color: #095C47; margin-bottom: 1mm;
        }
        .lot-label__barcode svg { display: block; }
        .lot-label__id { font-size: 7pt; font-weight: 700; margin-top: 1mm; }
        .lot-label__name {
          font-size: 6pt; color: #555;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 44mm;
        }
        .lot-label__meta {
          display: flex; gap: 3mm; font-size: 5.5pt; color: #666; margin-top: 1mm;
        }

        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .lp-labels { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 0; gap: 0; }
          .lot-label { border: none; }
        }
        .lp-toolbar {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 20px; background: #f5f5f5;
          border-bottom: 1px solid #ddd; position: sticky; top: 0;
        }
        .lp-toolbar button {
          padding: 6px 16px; border-radius: 6px;
          border: 1px solid #bbb; background: #fff; cursor: pointer; font-size: 13px;
        }
        .lp-toolbar button:hover { background: #eee; }
        .lp-info { font-size: 12px; color: #888; }
        .lp-labels { display: flex; flex-wrap: wrap; gap: 4mm; padding: 6mm; }
      `}</style>
    </>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { inventoryService } from '../services/inventoryService';
import { lotService }       from '../services/lotService';

/**
 * useLot — manages a single lot's detail and lineage.
 *
 * Usage:
 *   const { lot, lineage, movements, loading } = useLot(lotId);
 */
export function useLot(lotId) {
  const api     = useApi();
  const invSvc  = useMemo(() => inventoryService(api), [api]);
  const lotSvc  = useMemo(() => lotService(api),       [api]);

  const [lot,       setLot]       = useState(null);
  const [lineage,   setLineage]   = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading,   setLoading]   = useState(false);

  const load = useCallback(async () => {
    if (!lotId) return;
    setLoading(true);
    try {
      const [lotData, lineageData, movData] = await Promise.all([
        invSvc.getLot(lotId),
        invSvc.getLineage(lotId),
        lotSvc.listMovements({ lot_id: lotId }),
      ]);
      setLot(lotData);
      setLineage(lineageData);
      setMovements(Array.isArray(movData) ? movData : (movData.movements || []));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [lotId, invSvc, lotSvc]);

  useEffect(() => { load(); }, [load]);

  return { lot, lineage, movements, loading, refresh: load };
}

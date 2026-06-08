import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { inventoryService } from '../services/inventoryService';

/**
 * useInventory — loads and manages the inventory lot grid.
 *
 * The component calls load(params) whenever filters/pagination change.
 *
 * Usage:
 *   const { lots, loading, total, load, mixLots, splitLot } = useInventory();
 *   useEffect(() => { load({ status: 'in-stock', page: 1 }); }, [filters]);
 */
export function useInventory() {
  const api = useApi();
  const svc = useMemo(() => inventoryService(api), [api]);

  const [lots, setLots]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await svc.getLots(params);
      const items = Array.isArray(data) ? data : (data.lots || []);
      setLots(items);
      setTotal(data.total ?? items.length);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [svc]);

  const mixLots = async (payload) => {
    try {
      const result = await svc.mixLots(payload);
      toast.success('Lots mixed successfully');
      return result;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const splitLot = async (payload) => {
    try {
      const result = await svc.splitLot(payload);
      toast.success('Lot split successfully');
      return result;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return { lots, total, loading, load, mixLots, splitLot };
}

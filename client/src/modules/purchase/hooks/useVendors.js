import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { vendorService } from '../services/vendorService';

/**
 * useVendors — manages vendor list state.
 *
 * Usage:
 *   const { vendors, loading, save, refresh } = useVendors();
 */
export function useVendors() {
  const api = useApi();
  const svc = useMemo(() => vendorService(api), [api]);

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await svc.list(params);
      setVendors(Array.isArray(data) ? data : (data.vendors || []));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [svc]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (formData, id = null) => {
    try {
      id ? await svc.update(id, formData) : await svc.create(formData);
      toast.success('Vendor saved');
      await refresh();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return { vendors, loading, save, refresh };
}

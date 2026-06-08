import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { salesService } from '../services/salesService';

/**
 * useInvoices — manages sales invoice list state.
 *
 * Usage:
 *   const { invoices, loading, total, load, save, voidInvoice } = useInvoices();
 *   useEffect(() => { load({ status: 'draft', page: 1 }); }, [filters]);
 */
export function useInvoices() {
  const api = useApi();
  const svc = useMemo(() => salesService(api), [api]);

  const [invoices, setInvoices] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await svc.list(params);
      const items = Array.isArray(data) ? data : (data.invoices || []);
      setInvoices(items);
      setTotal(data.total ?? items.length);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [svc]);

  const save = async (formData, id = null) => {
    try {
      const result = id
        ? await svc.update(id, formData)
        : await svc.create(formData);
      toast.success('Invoice saved');
      return result;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const voidInvoice = async (id) => {
    try {
      await svc.void(id);
      toast.success('Invoice voided');
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return { invoices, total, loading, load, save, voidInvoice };
}

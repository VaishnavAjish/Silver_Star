import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { accountService } from '../services/accountService';

/**
 * useAccounts — manages Chart of Accounts state.
 *
 * Usage:
 *   const { accounts, loading, save, remove, refresh } = useAccounts();
 */
export function useAccounts() {
  const api = useApi();
  const svc = useMemo(() => accountService(api), [api]);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await svc.getAll();
      setAccounts(data);
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
      toast.success('Account saved');
      await refresh();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const remove = async (id) => {
    try {
      await svc.remove(id);
      toast.success('Account deleted');
      await refresh();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return { accounts, loading, save, remove, refresh };
}

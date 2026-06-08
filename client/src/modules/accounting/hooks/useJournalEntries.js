import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApi } from '@shared/hooks';
import { journalService } from '../services/journalService';

/**
 * useJournalEntries — manages journal entry list state with server-side filters.
 *
 * Usage:
 *   const { entries, loading, load, save, voidEntry } = useJournalEntries();
 *   useEffect(() => { load({ from_date, to_date }); }, [from_date, to_date]);
 */
export function useJournalEntries() {
  const api = useApi();
  const svc = useMemo(() => journalService(api), [api]);

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await svc.list(params);
      setEntries(Array.isArray(data) ? data : (data.entries || []));
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
      toast.success('Journal entry saved');
      return result;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const voidEntry = async (id) => {
    try {
      await svc.voidEntry(id);
      toast.success('Entry voided');
      // Caller should reload the list after voiding
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return { entries, loading, load, save, voidEntry };
}

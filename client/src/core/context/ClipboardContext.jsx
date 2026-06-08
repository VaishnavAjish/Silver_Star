import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from './../../core/context/AuthContext';
import StockTransferModal from '../../shared/components/Modals/StockTransferModal';

const ClipboardContext = createContext(null);

const API = '/api/clipboard';
const CLIPBOARD_MAX = 100;

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export function ClipboardProvider({ children }) {
  const { token, user } = useAuth();
  const [items, setItems]   = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  // Stock Transfer Modal state
  const [isStockTransferModalOpen, setIsStockTransferModalOpen] = useState(false);
  const [selectedTransferRows, setSelectedTransferRows] = useState([]);
  const transferOnCompleteRef = useRef(null);

  // Keep a ref in sync so remove/clear callbacks don't close over stale items
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const reload = useCallback(() => {
    if (!token || !user) return;
    fetch(API, { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : Promise.reject('load failed'))
      .then(async (clipboardItems) => {
        const invIds = clipboardItems.filter(i => i.entity_type === 'inventory').map(i => i.entity_id);
        if (invIds.length > 0) {
          try {
            const res = await fetch(`/api/inventory?ids=${invIds.join(',')}&limit=1000`, { headers: authHeaders(token) });
            if (res.ok) {
              const resData = await res.json();
              const lots = resData.data || [];
              const lotMap = Object.fromEntries(lots.map(l => [l.id, l]));
              clipboardItems = clipboardItems.map(i => {
                if (i.entity_type === 'inventory' && lotMap[i.entity_id]) {
                  return { ...lotMap[i.entity_id], ...i };
                }
                return i;
              });
            }
          } catch (e) {
            console.error('Failed to hydrate inventory for clipboard', e);
          }
        }
        setItems(clipboardItems);
      })
      .catch(() => toast.error('Could not load clipboard'));
  }, [token, user]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (item) => {
    if (!token) return;
    if (itemsRef.current.length >= CLIPBOARD_MAX) {
      toast.error('Clipboard full — clear some items first');
      return;
    }
    const tmp = { ...item, id: `tmp-${Date.now()}`, added_at: new Date().toISOString() };
    setItems(prev => [tmp, ...prev.filter(
      x => !(x.entity_type === item.entity_type && x.entity_id === item.entity_id)
    )]);

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(item),
      });
      if (res.status === 422) {
        toast.error('Clipboard full — clear some items first');
        setItems(prev => prev.filter(x => x.id !== tmp.id));
        return;
      }
      if (!res.ok) throw new Error('add failed');
      const saved = await res.json();
      setItems(prev => prev.map(x => x.id === tmp.id ? { ...x, ...saved } : x));
    } catch {
      setItems(prev => prev.filter(x => x.id !== tmp.id));
      toast.error('Could not add to clipboard');
    }
  }, [token]);

  const remove = useCallback(async (id) => {
    if (!token) return;
    const snapshot = itemsRef.current;
    setItems(prev => prev.filter(x => x.id !== id));
    try {
      const res = await fetch(`${API}/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(snapshot);
      toast.error('Could not remove item');
    }
  }, [token]);

  const clear = useCallback(async () => {
    if (!token) return;
    const snapshot = itemsRef.current;
    setItems([]);
    try {
      const res = await fetch(API, { method: 'DELETE', headers: authHeaders(token) });
      if (!res.ok) throw new Error();
    } catch {
      setItems(snapshot);
      toast.error('Could not clear clipboard');
    }
  }, [token]);

  const runBulkAction = useCallback(async (action, ids) => {
    if (!token) return null;
    try {
      const res = await fetch(`${API}/bulk-action`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Action failed');
        throw new Error(data.error);
      }
      return data;
    } catch (err) {
      if (!err.message?.includes('Action failed')) toast.error('Bulk action failed');
      throw err;
    }
  }, [token]);

  const addMultiple = useCallback(async (itemsToAdd) => {
    if (!token) return;

    let addedCount = 0;
    for (const item of itemsToAdd) {
      if (itemsRef.current.length >= CLIPBOARD_MAX) {
        toast.error('Clipboard full — some items could not be added');
        break;
      }
      if (itemsRef.current.some(x => x.entity_type === item.entity_type && x.entity_id === item.entity_id)) {
        continue;
      }
      await add(item);
      addedCount++;
    }
    if (addedCount > 0) {
      toast.success(`${addedCount} items copied to clipboard`);
    }
  }, [token, add]);

  /* ── Stock Transfer Modal controls ── */
  const openStockTransferModal = useCallback((rows = [], onComplete) => {
    setSelectedTransferRows(rows);
    transferOnCompleteRef.current = onComplete || null;
    setIsStockTransferModalOpen(true);
  }, []);

  const closeStockTransferModal = useCallback(() => {
    setIsStockTransferModalOpen(false);
    setSelectedTransferRows([]);
    transferOnCompleteRef.current = null;
  }, []);

  const toggleStockTransferModal = useCallback(() => {
    setIsStockTransferModalOpen(prev => !prev);
  }, []);

  const handleStockTransferComplete = useCallback(() => {
    if (transferOnCompleteRef.current) {
      transferOnCompleteRef.current();
    }
    closeStockTransferModal();
  }, [closeStockTransferModal]);

  return (
    <ClipboardContext.Provider value={{
      items, add, addMultiple, remove, clear, runBulkAction, reload,
      isOpen, setIsOpen,
      isStockTransferModalOpen, selectedTransferRows,
      openStockTransferModal, closeStockTransferModal, toggleStockTransferModal,
    }}>
      {children}

      <StockTransferModal
        open={isStockTransferModalOpen}
        onClose={closeStockTransferModal}
        selectedRows={selectedTransferRows}
        onTransferComplete={handleStockTransferComplete}
      />
    </ClipboardContext.Provider>
  );
}

export const useClipboard = () => useContext(ClipboardContext);

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../../core/context/SocketContext';

export function useRealTimeSync(queryKeyOrCallback, room, events) {
  const { isConnected, subscribe, unsubscribe, on } = useSocket();
  const queryClient = useQueryClient();
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const callbackRef = useRef(typeof queryKeyOrCallback === 'function' ? queryKeyOrCallback : null);
  callbackRef.current = typeof queryKeyOrCallback === 'function' ? queryKeyOrCallback : null;

  useEffect(() => {
    if (!isConnected) return;

    subscribe(room);

    const cleanups = [];

    const eventList = Array.isArray(eventsRef.current)
      ? eventsRef.current
      : Object.keys(eventsRef.current);

    eventList.forEach(event => {
      const updater = !Array.isArray(eventsRef.current)
        ? eventsRef.current[event]
        : null;

      const handler = (payload) => {
        if (callbackRef.current) {
          callbackRef.current(payload);
          return;
        }

        const queryKey = queryKeyOrCallback;
        if (!queryKey) return;

        if (updater && typeof updater === 'function') {
          queryClient.setQueryData(queryKey, (old) => {
            if (!old) return old;
            return updater(old, payload);
          });
        } else {
          queryClient.invalidateQueries({ queryKey, exact: false });
        }
      };

      const off = on(event, handler);
      cleanups.push(off);
    });

    return () => {
      cleanups.forEach(fn => { try { fn(); } catch {} });
      unsubscribe(room);
    };
  }, [isConnected, room, queryKeyOrCallback, queryClient, subscribe, unsubscribe, on]);
}

export function useDashboardSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:dashboard', [
    'dashboard.refresh',
    'inventory.created', 'inventory.updated', 'inventory.deleted',
    'inventory.transferred', 'inventory.adjusted',
    'purchase.created', 'purchase.updated',
    'sale.created', 'sale.updated',
    'process.started', 'process.completed',
    'batch.created', 'batch.updated', 'batch.closed',
    'journal.created', 'journal.updated', 'journal.deleted',
    'journal.posted', 'journal.reversed',
    'expense.created', 'expense.updated', 'expense.deleted',
    'payment.created', 'payment.updated', 'payment.deleted',
    'receipt.created', 'receipt.updated', 'receipt.deleted',
  ]);
}

export function useInventorySync(queryKey) {
  return useRealTimeSync(queryKey, 'room:inventory', [
    'inventory.created', 'inventory.updated', 'inventory.deleted',
    'inventory.transferred', 'inventory.adjusted',
    'inventory.opening', 'inventory.closing',
    'purchase.created',
    'process.started', 'process.completed', 'process.returned',
    'lot.split', 'lot.merged',
  ]);
}

export function useProcessSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:process', [
    'process.started', 'process.completed', 'process.cancelled',
    'process.approved', 'process.rejected', 'process.returned',
    'batch.created', 'batch.updated', 'batch.closed',
  ]);
}

export function usePurchaseSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:purchase', [
    'purchase.created', 'purchase.updated', 'purchase.deleted', 'purchase.approved',
  ]);
}

export function useSalesSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:sales', [
    'sale.created', 'sale.updated', 'sale.deleted', 'sale.approved',
  ]);
}

export function useAdminSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:admin', [
    'user.created', 'user.updated', 'user.deactivated',
    'role.created', 'role.updated', 'role.deleted',
    'permission.changed',
  ]);
}

export function useAccountsSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:dashboard', [
    'account.created', 'account.updated', 'account.deleted',
  ]);
}

export function useVendorsSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:purchase', [
    'vendor.created', 'vendor.updated', 'vendor.deleted',
  ]);
}

export function useCustomersSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:sales', [
    'customer.created', 'customer.updated', 'customer.deleted',
  ]);
}

export function useAssetsSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:dashboard', [
    'asset.created', 'asset.updated', 'asset.deleted',
  ]);
}

export function useAuditSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:audit', [
    'audit.created', 'journal.created', 'journal.posted',
  ]);
}

export function useMasterSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:inventory', [
    'master.created', 'master.updated', 'master.deleted',
  ]);
}

/**
 * ─── Silverstar Grow ERP — useRealTimeSync ───────────────────────────────────
 *
 * Universal hook for subscribing to real-time socket events and synchronising
 * TanStack Query cache.
 *
 * USAGE
 * -----
 * // Simple — invalidate and refetch
 * useRealTimeSync(['inventory'], 'room:inventory', ['inventory.created', 'inventory.updated', 'inventory.deleted']);
 *
 * // Advanced — surgical row update
 * useRealTimeSync(['inventory'], 'room:inventory', {
 *   'inventory.updated': (oldData, payload) => ({
 *     ...oldData,
 *     data: oldData?.data?.map(row => row.id === payload.id ? { ...row, ...payload } : row)
 *   })
 * });
 *
 * // Classic React state — provide a callback function instead of queryKey
 * useRealTimeSync(() => load(), 'room:inventory', ['inventory.created', 'inventory.updated']);
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../../core/context/SocketContext';
import { useMultiTabSync } from './useMultiTabSync';

/**
 * @param {string|string[]|function} queryKeyOrCallback - TanStack Query key to invalidate OR callback function
 * @param {string}          room      - Socket room to subscribe to (e.g. 'room:inventory')
 * @param {string[]|object} events
 *   - Array of event names → trigger update on any of them
 *   - Object { eventName: (oldData, payload) => newData } → surgical setQueryData updates
 */
export function useRealTimeSync(queryKeyOrCallback, room, events) {
  const { socket, isConnected, subscribe, unsubscribe } = useSocket();
  const queryClient = useQueryClient();
  const { broadcastSync } = useMultiTabSync();
  // Stable ref to avoid re-registering handlers on every render
  const eventsRef = useRef(events);
  eventsRef.current = events;
  
  const callbackRef = useRef(typeof queryKeyOrCallback === 'function' ? queryKeyOrCallback : null);
  callbackRef.current = typeof queryKeyOrCallback === 'function' ? queryKeyOrCallback : null;

  useEffect(() => {
    if (!socket || !isConnected) return;

    // Subscribe to the room
    subscribe(room);

    const handlers = [];

    const eventList = Array.isArray(eventsRef.current)
      ? eventsRef.current
      : Object.keys(eventsRef.current);

    eventList.forEach(event => {
      const updater = !Array.isArray(eventsRef.current)
        ? eventsRef.current[event]
        : null;

      const handler = (payload) => {
        if (callbackRef.current) {
          // Classic callback mode
          callbackRef.current(payload);
          return;
        }

        const queryKey = queryKeyOrCallback;
        if (!queryKey) return;

        if (updater && typeof updater === 'function') {
          // Surgical row-level update — no network request needed
          queryClient.setQueryData(queryKey, (old) => {
            if (!old) return old;
            return updater(old, payload);
          });
          // Broadcast the surgical update to other tabs
          broadcastSync('UPDATE', queryKey, payload);
        } else {
          // Invalidate so the next access triggers a background refetch
          queryClient.invalidateQueries({ queryKey, exact: false });
          // Broadcast invalidation to other tabs
          broadcastSync('INVALIDATE', queryKey);
        }
      };

      socket.on(event, handler);
      handlers.push({ event, handler });
    });

    return () => {
      handlers.forEach(({ event, handler }) => socket.off(event, handler));
      unsubscribe(room);
    };
  }, [socket, isConnected, room, queryKeyOrCallback, queryClient, subscribe, unsubscribe, broadcastSync]);
}

/**
 * Convenience hook — subscribes to the dashboard room and invalidates a query
 * on any dashboard-relevant event.
 */
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

/**
 * Convenience hook — subscribes to the inventory room and invalidates a query.
 */
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

/**
 * Convenience hook — subscribes to the process/manufacturing room.
 */
export function useProcessSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:process', [
    'process.started', 'process.completed', 'process.cancelled',
    'process.approved', 'process.rejected', 'process.returned',
    'batch.created', 'batch.updated', 'batch.closed',
  ]);
}

/**
 * Convenience hook — subscribes to the purchase room.
 */
export function usePurchaseSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:purchase', [
    'purchase.created', 'purchase.updated', 'purchase.deleted', 'purchase.approved',
  ]);
}

/**
 * Convenience hook — subscribes to the sales room.
 */
export function useSalesSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:sales', [
    'sale.created', 'sale.updated', 'sale.deleted', 'sale.approved',
  ]);
}

/**
 * Convenience hook — subscribes to the admin room for user/role/permission changes.
 */
export function useAdminSync(queryKey) {
  return useRealTimeSync(queryKey, 'room:admin', [
    'user.created', 'user.updated', 'user.deactivated',
    'role.created', 'role.updated', 'role.deleted',
  ]);
}

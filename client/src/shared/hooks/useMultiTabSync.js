/**
 * ─── Silverstar Grow ERP — useMultiTabSync ───────────────────────────────────
 *
 * Synchronises TanStack Query cache across multiple browser tabs for the
 * same logged-in user using the native BroadcastChannel API.
 *
 * How it works:
 *  Tab 1 receives a socket event → updates its TanStack cache
 *    → broadcasts the update via BroadcastChannel
 *  Tab 2 and Tab 3 receive the BroadcastChannel message
 *    → update their own TanStack caches
 *  Result: all tabs stay in sync without each making a separate HTTP request
 */

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const CHANNEL_NAME = 'sg_erp_sync_v1';

// Singleton channel — shared across all hook instances in the same tab
let _channel = null;
function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return _channel;
}

/**
 * Mount this hook ONCE at the app root to set up the tab listener.
 * Use the returned broadcastSync() from any component to propagate changes.
 */
export function useMultiTabSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = getChannel();
    if (!channel) return; // SSR or old browser

    const handleMessage = (event) => {
      const { type, queryKey, payload } = event.data || {};
      if (!type || !queryKey) return;

      switch (type) {
        case 'INVALIDATE':
          // Quietly mark as stale — will refetch on next access
          queryClient.invalidateQueries({ queryKey, exact: false });
          break;

        case 'UPDATE':
          // Surgical patch — use only if payload is the full new data shape
          if (payload !== undefined) {
            queryClient.setQueryData(queryKey, payload);
          } else {
            queryClient.invalidateQueries({ queryKey, exact: false });
          }
          break;

        default:
          break;
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => channel.removeEventListener('message', handleMessage);
  }, [queryClient]);

  /**
   * Broadcast a cache operation to all other tabs.
   * @param {'INVALIDATE'|'UPDATE'} type
   * @param {string[]} queryKey
   * @param {*} [payload]  - Only used for UPDATE type
   */
  const broadcastSync = useCallback((type, queryKey, payload = undefined) => {
    const channel = getChannel();
    if (!channel) return;
    try {
      channel.postMessage({ type, queryKey, payload, _ts: Date.now() });
    } catch {
      // Structured clone error (e.g. non-cloneable payload) — fall back to invalidate
      try {
        channel.postMessage({ type: 'INVALIDATE', queryKey, _ts: Date.now() });
      } catch { /* ignore */ }
    }
  }, []);

  return { broadcastSync };
}

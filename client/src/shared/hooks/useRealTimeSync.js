import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../../core/context/SocketContext';

export function useRealTimeSync(options = {}) {
  const { room, eventPrefix, onEvent, queryKeysToInvalidate, enabled = true } = options;
  const { isConnected, subscribe, unsubscribe, on } = useSocket();
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !isConnected || !room) return;

    subscribe(room);
    
    let cleanupOn = null;
    if (eventPrefix) {
      cleanupOn = on(eventPrefix, (payload, eventName) => {
        // Invalidate specific queries
        if (queryKeysToInvalidate && queryKeysToInvalidate.length > 0) {
          queryKeysToInvalidate.forEach(key => {
            queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
          });
        }
        // Call custom callback
        if (onEventRef.current) {
          onEventRef.current(payload, eventName);
        }
      });
    }

    return () => {
      unsubscribe(room);
      if (cleanupOn) cleanupOn();
    };
  }, [enabled, isConnected, room, eventPrefix, subscribe, unsubscribe, on, queryClient, queryKeysToInvalidate]);
}

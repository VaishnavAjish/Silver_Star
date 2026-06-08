import { useEffect, useRef, useState, useCallback } from 'react';

const SSE_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export function useSSE(module, token, { onEvent, onError, onConnected } = {}) {
  const [status, setStatus] = useState('disconnected');
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(SSE_RECONNECT_DELAY);

  const connect = useCallback(() => {
    if (!token || !module) return;

    setStatus('connecting');

    const url = `/api/sse/stream/${module}?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus('connected');
      reconnectDelayRef.current = SSE_RECONNECT_DELAY;
      if (onConnected) onConnected();
    };

    es.onmessage = (event) => {
      if (event.data === 'ok' || event.data === ':heartbeat') return;
      try {
        const data = JSON.parse(event.data);
        if (onEvent) onEvent(event.type || 'message', data);
      } catch (e) {
        // ignore parse errors for heartbeats
      }
    };

    es.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        setStatus('connected');
        if (onConnected) onConnected(data);
      } catch (e) { /* ignore */ }
    });

    es.addEventListener('error', (event) => {
      const data = event.data ? JSON.parse(event.data) : { error: 'Unknown SSE error' };
      setStatus('error');
      if (onError) onError(data);
    });

    es.onerror = () => {
      setStatus('disconnected');
      es.close();
      eventSourceRef.current = null;
      scheduleReconnect();
    };
  }, [module, token, onEvent, onError, onConnected]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 1.5,
        MAX_RECONNECT_DELAY
      );
      connect();
    }, reconnectDelayRef.current);
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  return { status, disconnect, reconnect: connect };
}

export function useSSEStream(module, token) {
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);

  const { status, disconnect, reconnect } = useSSE(module, token, {
    onEvent: (type, payload) => {
      setData(payload);
      setEvents(prev => [...prev.slice(-99), { type, payload, ts: Date.now() }]);
    },
  });

  return { status, data, events, disconnect, reconnect };
}

export default useSSE;

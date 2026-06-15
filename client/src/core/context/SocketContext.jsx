import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function resolveWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const base = import.meta.env.VITE_API_URL || window.location.origin;
  const protocol = base.startsWith('https') ? 'ws' : 'ws';
  return `${protocol}://${base.replace(/^https?:\/\//, '')}`;
}

export function SocketProvider({ children }) {
  const { token, refreshUser } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const wsRef = useRef(null);
  const subscribedRoomsRef = useRef(new Set());
  const listenersRef = useRef(new Map());
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const pingIntervalRef = useRef(null);

  const MAX_RECONNECT_DELAY = 10000;
  const PING_INTERVAL = 25000;

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const wsUrl = resolveWsUrl();
    const url = `${wsUrl}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;

      const rooms = [...subscribedRoomsRef.current];
      if (rooms.length > 0) {
        sendMessage({ type: 'subscribe', rooms });
      }

      pingIntervalRef.current = setInterval(() => {
        sendMessage({ type: 'ping' });
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'connected':
          break;
        case 'event': {
          const eventName = msg.event;
          if (eventName === 'permission.changed') {
            refreshUser().catch(() => {});
          }
          if (eventName === 'user.deactivated') {
            console.warn('[WS] Account deactivated', msg.payload);
          }
          const cbs = listenersRef.current.get(eventName);
          if (cbs) cbs.forEach(cb => { try { cb(msg.payload); } catch {} });

          const dotIdx = msg.event.lastIndexOf('.');
          if (dotIdx !== -1) {
            const wildcard = msg.event.substring(0, dotIdx + 1) + '*';
            const wc = listenersRef.current.get(wildcard);
            if (wc) wc.forEach(cb => { try { cb(msg.payload); } catch {} });
          }
          break;
        }
        case 'subscribed':
          break;
        case 'unsubscribed':
          break;
        case 'pong':
          break;
        case 'error':
          console.warn('[WS] Server error:', msg.message);
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [token, sendMessage]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    clearReconnect();
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), MAX_RECONNECT_DELAY);
    reconnectAttemptsRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setReconnectCount(c => c + 1);
        connect();
      }
    }, delay);
  }, [clearReconnect, connect]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearReconnect();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [clearReconnect]);

  useEffect(() => {
    if (!token) {
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      return;
    }
    connect();
  }, [token, connect, clearReconnect]);

  const subscribe = useCallback((rooms) => {
    const roomArray = Array.isArray(rooms) ? rooms : [rooms];
    roomArray.forEach(r => subscribedRoomsRef.current.add(r));
    sendMessage({ type: 'subscribe', rooms: roomArray });
  }, [sendMessage]);

  const unsubscribe = useCallback((rooms) => {
    const roomArray = Array.isArray(rooms) ? rooms : [rooms];
    roomArray.forEach(r => subscribedRoomsRef.current.delete(r));
    sendMessage({ type: 'unsubscribe', rooms: roomArray });
  }, [sendMessage]);

  const on = useCallback((event, handler) => {
    const existing = listenersRef.current.get(event) || [];
    listenersRef.current.set(event, [...existing, handler]);
    return () => {
      const list = listenersRef.current.get(event) || [];
      const filtered = list.filter(h => h !== handler);
      if (filtered.length > 0) listenersRef.current.set(event, filtered);
      else listenersRef.current.delete(event);
    };
  }, []);

  return (
    <SocketContext.Provider value={{
      isConnected,
      reconnectCount,
      subscribe,
      unsubscribe,
      on,
      sendMessage,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within <SocketProvider>');
  return ctx;
}

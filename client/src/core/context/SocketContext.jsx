import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const { token, refreshUser } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const reconnectCountRef = useRef(0);

  const wsRef = useRef(null);
  const subscribedRoomsRef = useRef(new Set());
  const eventHandlersRef = useRef(new Map());
  const pingIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current && (
      wsRef.current.readyState === WebSocket.OPEN ||
      wsRef.current.readyState === WebSocket.CONNECTING
    )) return;
    if (!token) return;

    const wsBaseUrl = import.meta.env.VITE_WS_URL
      ? import.meta.env.VITE_WS_URL
      : (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host;

    // On the very first attempt give the page 600ms to settle fully —
    // this prevents the "WebSocket error" console message on initial page load.
    const initialDelay = reconnectCountRef.current === 0 ? 600 : 0;

    setTimeout(() => {
      // Re-check guard after the delay
      if (wsRef.current && (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      )) return;

      const ws = new WebSocket(`${wsBaseUrl}/ws?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectCountRef.current = 0;

        // Resubscribe to rooms that were active before disconnect
        const rooms = Array.from(subscribedRoomsRef.current);
        if (rooms.length > 0) {
          ws.send(JSON.stringify({ type: 'subscribe', rooms }));
        }

        // Keep-alive ping every 25s
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'event') {
            // Exact topic listeners
            const handlers = eventHandlersRef.current.get(msg.event) || new Set();
            handlers.forEach(cb => cb(msg.payload, msg.event));

            // Wildcard prefix listeners e.g. 'inventory.*'
            const prefix = msg.event.split('.')[0] + '.*';
            const prefixHandlers = eventHandlersRef.current.get(prefix) || new Set();
            prefixHandlers.forEach(cb => cb(msg.payload, msg.event));

            // Refresh user permissions when they change
            if (msg.event === 'permission.changed') {
              refreshUser();
            }
          }
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        clearInterval(pingIntervalRef.current);

        if (token) {
          // Exponential backoff: 1s → 2s → 4s … max 30s
          const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30000);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current += 1;
            connect();
          }, delay);
        }
      };

      // Errors always fire before onclose — onclose handles the retry silently
      ws.onerror = () => ws.close();

    }, initialDelay);
  }, [token, refreshUser]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      clearTimeout(reconnectTimeoutRef.current);
      clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  // Clear everything on logout
  useEffect(() => {
    if (!token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      subscribedRoomsRef.current.clear();
      setIsConnected(false);
    }
  }, [token]);

  const subscribe = useCallback((rooms) => {
    const arr = Array.isArray(rooms) ? rooms : [rooms];
    let needsSend = false;
    arr.forEach(r => {
      if (!subscribedRoomsRef.current.has(r)) {
        subscribedRoomsRef.current.add(r);
        needsSend = true;
      }
    });
    if (needsSend && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', rooms: arr }));
    }
  }, []);

  const unsubscribe = useCallback((rooms) => {
    const arr = Array.isArray(rooms) ? rooms : [rooms];
    let needsSend = false;
    arr.forEach(r => {
      if (subscribedRoomsRef.current.has(r)) {
        subscribedRoomsRef.current.delete(r);
        needsSend = true;
      }
    });
    if (needsSend && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', rooms: arr }));
    }
  }, []);

  const on = useCallback((event, handler) => {
    if (!eventHandlersRef.current.has(event)) {
      eventHandlersRef.current.set(event, new Set());
    }
    eventHandlersRef.current.get(event).add(handler);

    return () => {
      if (eventHandlersRef.current.has(event)) {
        eventHandlersRef.current.get(event).delete(handler);
      }
    };
  }, []);

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const value = { isConnected, subscribe, unsubscribe, on, sendMessage };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

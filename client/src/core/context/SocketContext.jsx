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
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
    if (!token) return;

    // Use VITE_WS_URL or derive from location
    const wsBaseUrl = import.meta.env.VITE_WS_URL 
      ? import.meta.env.VITE_WS_URL 
      : (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host;

    const ws = new WebSocket(`${wsBaseUrl}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectCountRef.current = 0;
      
      // Resubscribe to previous rooms
      const rooms = Array.from(subscribedRoomsRef.current);
      if (rooms.length > 0) {
        ws.send(JSON.stringify({ type: 'subscribe', rooms }));
      }

      // Start pinging every 25s
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
          // Trigger exact match listeners
          const handlers = eventHandlersRef.current.get(msg.event) || new Set();
          handlers.forEach(cb => cb(msg.payload, msg.event));

          // Trigger wildcard prefix listeners (e.g., 'inventory.*')
          const prefix = msg.event.split('.')[0] + '.*';
          const prefixHandlers = eventHandlersRef.current.get(prefix) || new Set();
          prefixHandlers.forEach(cb => cb(msg.payload, msg.event));

          // Special global cases
          if (msg.event === 'permission.changed') {
            refreshUser(); // Refresh user grabs new permissions
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
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 10000);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectCountRef.current += 1;
          connect();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };
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

  // Auth context changes (logout) clears everything
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

  const value = {
    isConnected,
    subscribe,
    unsubscribe,
    on,
    sendMessage
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

/**
 * ─── Silverstar Grow ERP — Socket.IO Client Context ─────────────────────────
 *
 * Provides a persistent, auto-reconnecting WebSocket connection to the backend.
 *
 * Features:
 *  - JWT authentication on connect
 *  - Auto-reconnect with exponential backoff
 *  - Room subscription helpers
 *  - Connection status indicator (isConnected)
 *  - Auto-resubscription after reconnect (resilient rooms)
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

// Resolve backend URL — works for both Vite dev proxy and direct connections
function resolveServerUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  // In dev, route through the Vite proxy (/socket.io is proxied to 127.0.0.1:5001)
  // so the browser never needs a direct connection to port 5001 from any IP.
  return window.location.origin;
}

export function SocketProvider({ children }) {
  const { token, refreshUser } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const socketRef = useRef(null);
  // Track rooms to resubscribe after reconnect
  const subscribedRoomsRef = useRef(new Set());

  useEffect(() => {
    if (!token) {
      // Logged out — disconnect cleanly
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    // Prevent duplicate connections (React StrictMode double-invoke)
    if (socketRef.current?.connected) return;

    const serverUrl = resolveServerUrl();

    const socket = io(serverUrl, {
      auth: { token },
      // Start with HTTP polling to reliably establish the session through any proxy,
      // then automatically upgrade to WebSocket once the connection is confirmed.
      // This avoids the noisy WebSocket upgrade failure that occurs when going
      // through Vite's dev proxy or nginx before the session is established.
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.info('[Socket.IO] ✅ Connected', socket.id);
      setIsConnected(true);

      // Resubscribe to all previously subscribed rooms after reconnect
      const rooms = [...subscribedRoomsRef.current];
      if (rooms.length > 0) {
        socket.emit('subscribe', rooms);
      }
    });

    socket.on('disconnect', (reason) => {
      console.info('[Socket.IO] ❌ Disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection error:', err.message);
    });

    socket.on('reconnect', (attempt) => {
      console.info('[Socket.IO] Reconnected after', attempt, 'attempts');
      setReconnectCount(c => c + 1);
    });

    // ── Permission-change handler ───────────────────────────────────────────
    // When the server sends this, silently refresh the user's session data
    // so new permissions take effect without logout
    socket.on('permission.changed', async (payload) => {
      console.info('[Socket.IO] Permission change detected — refreshing session', payload);
      try {
        await refreshUser();
      } catch { /* ignore */ }
    });

    // ── Deactivated user handler ────────────────────────────────────────────
    socket.on('user.deactivated', (payload) => {
      // If this event is for the current user, force logout on next API call
      // (the JWT will still be valid briefly but API will return 401)
      console.warn('[Socket.IO] Account deactivated', payload);
    });

    return () => {
      socket.off('permission.changed');
      socket.off('user.deactivated');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, refreshUser]);

  /**
   * Subscribe the socket to one or more module rooms.
   * Rooms are remembered and resubscribed on reconnect.
   */
  const subscribe = useCallback((rooms) => {
    const roomArray = Array.isArray(rooms) ? rooms : [rooms];
    roomArray.forEach(r => subscribedRoomsRef.current.add(r));

    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', roomArray);
    }
  }, []);

  /**
   * Unsubscribe from one or more rooms.
   */
  const unsubscribe = useCallback((rooms) => {
    const roomArray = Array.isArray(rooms) ? rooms : [rooms];
    roomArray.forEach(r => subscribedRoomsRef.current.delete(r));

    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', roomArray);
    }
  }, []);

  /**
   * Listen for a specific event on the socket.
   * Returns an off() function for cleanup.
   */
  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  return (
    <SocketContext.Provider value={{
      socket: socketRef.current,
      isConnected,
      reconnectCount,
      subscribe,
      unsubscribe,
      on,
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

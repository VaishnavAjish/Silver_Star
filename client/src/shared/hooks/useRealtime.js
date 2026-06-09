import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../../core/context/SocketContext';

const MAX_EVENTS = 50;

export function useRealtime() {
  const { isConnected, subscribe: roomSubscribe, unsubscribe: roomUnsubscribe, on } = useSocket();
  const [connected, setConnected] = useState(isConnected);
  const [lastEvent, setLastEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const cleanupsRef = useRef([]);

  const addEvent = useCallback((topic, payload) => {
    const entry = { topic, payload, ts: Date.now() };
    setLastEvent(entry);
    setEvents(prev => [...prev.slice(-(MAX_EVENTS - 1)), entry]);
  }, []);

  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected]);

  const subscribe = useCallback((topic, callback) => {
    if (!topic || !callback) return () => {};
    const handler = (payload) => {
      callback(payload);
      addEvent(topic, payload);
    };
    const off = on(topic, handler);
    return () => { try { off(); } catch {} };
  }, [on, addEvent]);

  const unsubscribe = useCallback((topic, callback) => {
  }, []);

  const joinRoom = useCallback((room) => {
    if (!room) return;
    roomSubscribe(room);
  }, [roomSubscribe]);

  const leaveRoom = useCallback((room) => {
    if (!room) return;
    roomUnsubscribe(room);
  }, [roomUnsubscribe]);

  useEffect(() => {
    return () => { cleanupsRef.current.forEach(fn => { try { fn(); } catch {} }); };
  }, []);

  return { connected, subscribe, unsubscribe, joinRoom, leaveRoom, lastEvent, events };
}

export function withRealtime(Component) {
  const displayName = Component.displayName || Component.name || 'Component';
  const Wrapped = (props) => <Component {...props} realtime={useRealtime()} />;
  Wrapped.displayName = `withRealtime(${displayName})`;
  return Wrapped;
}

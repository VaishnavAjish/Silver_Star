import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../../core/context/SocketContext';

const MAX_EVENTS = 50;
const SSE_FALLBACK_DELAY = 4000;

export function useRealtime() {
  const { socket, isConnected, subscribe: roomSubscribe, unsubscribe: roomUnsubscribe } = useSocket();
  const [connected, setConnected] = useState(isConnected);
  const [lastEvent, setLastEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const listenersRef = useRef(new Map());
  const sseRef = useRef(null);
  const sseTimerRef = useRef(null);
  const fallbackRef = useRef(false);

  const addEvent = useCallback((topic, payload) => {
    const entry = { topic, payload, ts: Date.now() };
    setLastEvent(entry);
    setEvents(prev => [...prev.slice(-(MAX_EVENTS - 1)), entry]);

    const cbs = listenersRef.current.get(topic);
    if (cbs) cbs.forEach(cb => { try { cb(payload); } catch {} });

    const dotIdx = topic.lastIndexOf('.');
    if (dotIdx !== -1) {
      const wildcard = topic.substring(0, dotIdx + 1) + '*';
      const wc = listenersRef.current.get(wildcard);
      if (wc) wc.forEach(cb => { try { cb(payload); } catch {} });
    }
  }, []);

  const connectSse = useCallback(() => {
    if (fallbackRef.current || sseRef.current) return;
    fallbackRef.current = true;
    const es = new EventSource('/api/sse/stream/all');
    sseRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      if (e.data === 'ok' || e.data === ':heartbeat') return;
      try {
        const data = JSON.parse(e.data);
        addEvent(e.type || data.event || 'message', data);
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      sseRef.current = null;
      sseTimerRef.current = setTimeout(connectSse, 3000);
    };
  }, [addEvent]);

  const disconnectSse = useCallback(() => {
    clearTimeout(sseTimerRef.current);
    sseTimerRef.current = null;
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    fallbackRef.current = false;
  }, []);

  useEffect(() => {
    setConnected(isConnected);
    if (isConnected) disconnectSse();
  }, [isConnected, disconnectSse]);

  useEffect(() => {
    if (isConnected || fallbackRef.current) return;
    sseTimerRef.current = setTimeout(() => {
      if (!isConnected && !sseRef.current) connectSse();
    }, SSE_FALLBACK_DELAY);
    return () => clearTimeout(sseTimerRef.current);
  }, [isConnected, connectSse]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => { setConnected(true); disconnectSse(); };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, [socket, disconnectSse]);

  useEffect(() => {
    if (!socket || !isConnected) return;
    const topics = [];
    for (const [topic] of listenersRef.current.entries()) {
      if (topic && !topic.includes('*')) {
        socket.on(topic, (p) => addEvent(topic, p));
        topics.push(topic);
      }
    }
    return () => { topics.forEach(t => { try { socket.off(t); } catch {} }); };
  }, [socket, isConnected, addEvent]);

  const subscribe = useCallback((topic, callback) => {
    if (!topic || !callback) return () => {};
    const existing = listenersRef.current.get(topic) || [];
    listenersRef.current.set(topic, [...existing, callback]);
    return () => {
      const list = listenersRef.current.get(topic) || [];
      const filtered = list.filter(cb => cb !== callback);
      if (filtered.length > 0) listenersRef.current.set(topic, filtered);
      else listenersRef.current.delete(topic);
    };
  }, []);

  const unsubscribe = useCallback((topic, callback) => {
    if (!topic) return;
    if (callback) {
      const list = listenersRef.current.get(topic) || [];
      const filtered = list.filter(cb => cb !== callback);
      if (filtered.length > 0) listenersRef.current.set(topic, filtered);
      else listenersRef.current.delete(topic);
    } else {
      listenersRef.current.delete(topic);
    }
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
    return () => { disconnectSse(); listenersRef.current.clear(); };
  }, [disconnectSse]);

  return { connected, subscribe, unsubscribe, joinRoom, leaveRoom, lastEvent, events };
}

export function withRealtime(Component) {
  const displayName = Component.displayName || Component.name || 'Component';
  const Wrapped = (props) => <Component {...props} realtime={useRealtime()} />;
  Wrapped.displayName = `withRealtime(${displayName})`;
  return Wrapped;
}

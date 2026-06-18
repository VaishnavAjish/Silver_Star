import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../../core/context/SocketContext';

export function useRealtime() {
  const { isConnected, subscribe, unsubscribe, on, sendMessage } = useSocket();
  const [lastEvent, setLastEvent] = useState(null);
  const [events, setEvents] = useState([]);

  const handleEvent = useCallback((payload, eventName) => {
    const eventObj = { event: eventName, payload, timestamp: Date.now() };
    setLastEvent(eventObj);
    setEvents(prev => [eventObj, ...prev].slice(0, 50));
  }, []);

  const subscribeToTopic = useCallback((topic, cb) => {
    return on(topic, (payload, eventName) => {
      handleEvent(payload, eventName);
      if (cb) cb(payload, eventName);
    });
  }, [on, handleEvent]);

  const joinRoom = useCallback((room) => {
    subscribe(room);
  }, [subscribe]);

  const leaveRoom = useCallback((room) => {
    unsubscribe(room);
  }, [unsubscribe]);

  return {
    connected: isConnected,
    subscribe: subscribeToTopic,
    unsubscribe: leaveRoom,
    joinRoom,
    leaveRoom,
    lastEvent,
    events
  };
}

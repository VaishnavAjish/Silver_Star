/**
 * ─── Silverstar Grow ERP — Live Notification Center ─────────────────────────
 *
 * Real-time notification bell that shows live ERP events.
 * Receives events from Socket.IO and displays them as toast + in-app feed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../../core/context/SocketContext';
import toast from 'react-hot-toast';

// ── Event → UI mapping ────────────────────────────────────────────────────────
const EVENT_CONFIG = {
  'inventory.created':     { icon: '📦', label: 'Inventory Created',     type: 'success' },
  'inventory.updated':     { icon: '📦', label: 'Inventory Updated',     type: 'info' },
  'inventory.deleted':     { icon: '📦', label: 'Inventory Removed',     type: 'warning' },
  'inventory.transferred': { icon: '🚚', label: 'Stock Transferred',     type: 'info' },
  'inventory.adjusted':    { icon: '⚖️', label: 'Stock Adjusted',        type: 'info' },
  'inventory.opening':     { icon: '📋', label: 'Opening Entry Added',   type: 'success' },
  'inventory.closing':     { icon: '📋', label: 'Closing Entry Added',   type: 'success' },
  'purchase.created':      { icon: '🛒', label: 'Purchase Created',      type: 'success' },
  'purchase.updated':      { icon: '🛒', label: 'Purchase Updated',      type: 'info' },
  'purchase.approved':     { icon: '✅', label: 'Purchase Approved',     type: 'success' },
  'sale.created':          { icon: '💰', label: 'Sale Created',          type: 'success' },
  'sale.approved':         { icon: '✅', label: 'Sale Approved',         type: 'success' },
  'process.started':       { icon: '⚙️', label: 'Process Started',       type: 'info' },
  'process.completed':     { icon: '✅', label: 'Process Completed',     type: 'success' },
  'process.cancelled':     { icon: '❌', label: 'Process Cancelled',     type: 'warning' },
  'process.approved':      { icon: '✅', label: 'Process Approved',      type: 'success' },
  'process.rejected':      { icon: '🚫', label: 'Process Rejected',      type: 'error' },
  'batch.created':         { icon: '📊', label: 'Batch Created',         type: 'success' },
  'batch.closed':          { icon: '📊', label: 'Batch Closed',          type: 'info' },
  'lot.split':             { icon: '✂️', label: 'Lot Split',             type: 'info' },
  'lot.merged':            { icon: '🔗', label: 'Lots Merged',           type: 'info' },
  'user.created':          { icon: '👤', label: 'User Created',          type: 'info' },
  'user.updated':          { icon: '👤', label: 'User Updated',          type: 'info' },
  'role.updated':          { icon: '🔑', label: 'Role Updated',          type: 'warning' },
  'permission.changed':    { icon: '🔒', label: 'Your permissions were updated', type: 'warning' },
};

const ALL_EVENTS = Object.keys(EVENT_CONFIG);
const MAX_NOTIFICATIONS = 50;

/**
 * Hook that accumulates real-time ERP notifications.
 * Returns { notifications, unreadCount, markAllRead, clearAll }
 */
export function useNotifications() {
  const { socket, isConnected } = useSocket();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const idRef = useRef(0);

  const addNotification = useCallback((event, payload) => {
    const config = EVENT_CONFIG[event] || { icon: '📢', label: event, type: 'info' };
    const notification = {
      id: ++idRef.current,
      event,
      icon: config.icon,
      label: config.label,
      type: config.type,
      payload,
      ts: Date.now(),
      read: false,
    };

    setNotifications(prev => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    setUnreadCount(c => c + 1);

    // Also show a react-hot-toast for immediate visual feedback
    const toastFn =
      config.type === 'error'   ? toast.error :
      config.type === 'warning' ? toast :
      config.type === 'success' ? toast.success :
      toast;

    toastFn(`${config.icon} ${config.label}`, {
      duration: 3500,
      style: {
        background: '#ffffff',
        color: '#334155',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        fontSize: '13px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      },
    });
  }, []);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlers = ALL_EVENTS.map(event => {
      const handler = (payload) => addNotification(event, payload);
      socket.on(event, handler);
      return { event, handler };
    });

    return () => {
      handlers.forEach(({ event, handler }) => socket.off(event, handler));
    };
  }, [socket, isConnected, addNotification]);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markAllRead, clearAll };
}

/**
 * Notification Bell + Dropdown component.
 * Drop this into your Layout header.
 */
export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const { isConnected } = useSocket();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleOpen = () => {
    setIsOpen(o => !o);
    if (!isOpen && unreadCount > 0) {
      setTimeout(markAllRead, 300);
    }
  };

  const formatTime = (ts) => {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell button */}
      <button
        id="notification-bell-btn"
        onClick={handleOpen}
        title={isConnected ? 'Live — Notifications' : 'Disconnected'}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '8px',
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: '20px',
          transition: 'background 0.2s',
        }}
      >
        🔔
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            background: '#ef4444', color: '#fff',
            borderRadius: '50%', fontSize: '10px',
            minWidth: '16px', height: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, padding: '0 3px',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {/* Connection indicator dot */}
        <span style={{
          position: 'absolute', bottom: 4, right: 4,
          width: 8, height: 8, borderRadius: '50%',
          background: isConnected ? '#22c55e' : '#ef4444',
          border: '1px solid rgba(0,0,0,0.3)',
        }} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 9999,
          width: 340, maxHeight: 480,
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #f1f5f9',
          }}>
            <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>
              Live Notifications
              <span style={{
                marginLeft: 8, fontSize: 11, padding: '2px 6px',
                borderRadius: 10, background: isConnected ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: isConnected ? '#22c55e' : '#ef4444',
              }}>
                {isConnected ? '● Live' : '○ Offline'}
              </span>
            </span>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12 }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                No notifications yet.<br />
                <span style={{ fontSize: 11 }}>Events will appear here in real time.</span>
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #f8fafc',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: n.read ? 'transparent' : '#f1f5f9',
                  transition: 'background 0.3s',
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{n.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#334155', fontWeight: n.read ? 400 : 600 }}>
                      {n.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {formatTime(n.ts)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

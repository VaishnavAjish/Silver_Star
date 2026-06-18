/**
 * ─── Silverstar Grow ERP — Notification Center ──────────────────────────────
 *
 * Notification bell + dropdown.
 *
 * NOTE: The real-time WebSocket event feed has been removed. This component
 * is kept as an inert placeholder (empty feed) so the header layout and any
 * future polling/REST-based notification source can plug in without a rewrite.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_NOTIFICATIONS = 50;

/**
 * Hook that holds notification state.
 * Returns { notifications, unreadCount, markAllRead, clearAll }
 *
 * With WebSocket removed there is currently no live event source, so the feed
 * stays empty. `addNotification` is exposed for a future REST/polling source.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const idRef = useRef(0);

  const addNotification = useCallback((event, payload, meta = {}) => {
    const notification = {
      id: ++idRef.current,
      event,
      icon: meta.icon || '📢',
      label: meta.label || event,
      type: meta.type || 'info',
      payload,
      ts: Date.now(),
      read: false,
    };
    setNotifications(prev => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    setUnreadCount(c => c + 1);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, addNotification, markAllRead, clearAll };
}

/**
 * Notification Bell + Dropdown component.
 * Drop this into your Layout header.
 */
export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
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
        title="Notifications"
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
              Notifications
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
                No notifications.
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

/**
 * ─── Silverstar Grow ERP — Notification Center ──────────────────────────────
 *
 * Real-time notifications via Server-Sent Events (SSE).
 * Shows a live/offline indicator and displays domain events as they happen.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtime } from '../hooks/useRealtime';

const MAX_NOTIFICATIONS = 50;

// Map domain event topics → human-readable labels + icons
const EVENT_META = {
  'inventory.created':      { icon: '📦', label: 'New inventory lot added' },
  'inventory.updated':      { icon: '📦', label: 'Inventory updated' },
  'inventory.transferred':  { icon: '🔄', label: 'Stock transferred' },
  'inventory.adjusted':     { icon: '⚖️',  label: 'Inventory adjusted' },
  'inventory.opening':      { icon: '📦', label: 'Opening entry created' },
  'inventory.closing':      { icon: '📦', label: 'Closing entry created' },
  'purchase.created':       { icon: '🛒', label: 'New purchase note created' },
  'purchase.updated':       { icon: '🛒', label: 'Purchase note updated' },
  'purchase.approved':      { icon: '✅', label: 'Purchase note approved' },
  'sale.created':           { icon: '💰', label: 'New sale / invoice created' },
  'sale.updated':           { icon: '💰', label: 'Invoice updated' },
  'sale.approved':          { icon: '✅', label: 'Invoice approved' },
  'payment.created':        { icon: '💳', label: 'New payment recorded' },
  'receipt.created':        { icon: '🧾', label: 'New receipt recorded' },
  'journal.created':        { icon: '📒', label: 'Journal entry created' },
  'journal.posted':         { icon: '📒', label: 'Journal entry posted' },
  'journal.reversed':       { icon: '↩️', label: 'Journal entry reversed' },
  'expense.created':        { icon: '💸', label: 'New expense recorded' },
  'bank_deposit.created':   { icon: '🏦', label: 'Bank deposit created' },
  'bank_deposit.reversed':  { icon: '↩️', label: 'Bank deposit reversed' },
  'process.started':        { icon: '⚙️',  label: 'Process started' },
  'process.completed':      { icon: '✅', label: 'Process completed' },
  'process.cancelled':      { icon: '❌', label: 'Process cancelled' },
  'asset.created':          { icon: '🏗️',  label: 'Fixed asset added' },
  'depreciation.created':   { icon: '📉', label: 'Depreciation run created' },
  'user.created':           { icon: '👤', label: 'New user created' },
  'user.updated':           { icon: '👤', label: 'User updated' },
  'user.login':             { icon: '🔐', label: 'User logged in' },
  'permission.changed':     { icon: '🔑', label: 'Permissions changed' },
  'master.created':         { icon: '🗂️',  label: 'Master record created' },
  'master.updated':         { icon: '🗂️',  label: 'Master record updated' },
  'vendor.created':         { icon: '🏪', label: 'New vendor added' },
  'customer.created':       { icon: '👥', label: 'New customer added' },
  'recon.created':          { icon: '🔍', label: 'Bank reconciliation created' },
};

function getEventMeta(topic) {
  if (EVENT_META[topic]) return EVENT_META[topic];
  // Fallback: derive from topic name
  const parts = topic.split('.');
  const action = parts[parts.length - 1];
  const entity = parts.slice(0, -1).join(' ');
  return {
    icon: '🔔',
    label: `${entity.replace(/_/g, ' ')} ${action}`,
  };
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);   // WebSocket connection status
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const dropdownRef = useRef(null);
  const idRef = useRef(0);
  const esRef = useRef(null);

  const addNotification = useCallback((topic, payload) => {
    const meta = getEventMeta(topic);
    const notification = {
      id: ++idRef.current,
      topic,
      icon: meta.icon,
      label: meta.label,
      payload,
      ts: Date.now(),
      read: false,
    };
    setNotifications(prev => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    setUnreadCount(c => c + 1);
  }, []);

  const { connected: isConnected, subscribe: subscribeToDomain } = useRealtime();

  // Sync isLive with isConnected
  useEffect(() => {
    setIsLive(isConnected);
    if (isConnected) setHasEverConnected(true);
  }, [isConnected]);

  // Connect to WebSocket stream
  useEffect(() => {
    // Listen for ALL domain events
    const unsubscribes = [];
    
    // Generic notification
    unsubscribes.push(subscribeToDomain('notification', (payload) => {
      addNotification('notification', payload);
    }));

    Object.keys(EVENT_META).forEach(topic => {
      unsubscribes.push(subscribeToDomain(topic, (payload) => {
        addNotification(topic, payload);
      }));
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [addNotification, subscribeToDomain]);

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
      setTimeout(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
      }, 300);
    }
  };

  const clearAll = () => {
    setNotifications([]);
    setUnreadCount(0);
  };

  const formatTime = (ts) => {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };



  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>


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
          padding: '6px',
          borderRadius: '8px',
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: '20px',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        🔔
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
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
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.08)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>Notifications</span>
            </div>
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
                {hasEverConnected || isLive
                  ? 'No notifications yet. Activity will appear here.'
                  : 'Connecting to live feed…'}
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #f8fafc',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  background: n.read ? 'transparent' : '#f0fdf4',
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
                  {!n.read && (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0, marginTop: 4 }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

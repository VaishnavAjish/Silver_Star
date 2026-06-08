'use strict';

/**
 * ─── Silverstar Grow ERP — Event Dispatcher ────────────────────────────────
 *
 * Central event bus that:
 *  1. Immediately dispatches events via Socket.IO (zero-latency push to clients)
 *  2. Persists events to sys_event_outbox for offline client recovery
 *
 * ROOM ROUTING MAP
 * ----------------
 *  inventory.*     → room:inventory  + room:dashboard
 *  purchase.*      → room:purchase   + room:dashboard
 *  sales.*         → room:sales      + room:dashboard
 *  process.*       → room:process    + room:inventory + room:dashboard
 *  manufacturing.* → room:manufacturing + room:process + room:dashboard
 *  permission.*    → user:<id>  (targeted — only the affected user)
 *  role.*          → room:admin
 *  user.*          → room:admin
 *  dashboard.*     → room:dashboard  (broadcast)
 */

const pool = require('../db/pool');
const { dispatchToRoom, dispatchToUser, broadcast, getIO } = require('./socketService');
const { logger } = require('../middleware/logger');

// ── Event → Room routing table ────────────────────────────────────────────────
const EVENT_ROUTES = {
  // Inventory events → notify inventory + dashboard rooms
  'inventory.created':     ['room:inventory', 'room:dashboard'],
  'inventory.updated':     ['room:inventory', 'room:dashboard'],
  'inventory.deleted':     ['room:inventory', 'room:dashboard'],
  'inventory.transferred': ['room:inventory', 'room:dashboard'],
  'inventory.adjusted':    ['room:inventory', 'room:dashboard'],
  'inventory.opening':     ['room:inventory', 'room:dashboard'],
  'inventory.closing':     ['room:inventory', 'room:dashboard'],

  // Purchase events
  'purchase.created':  ['room:purchase', 'room:inventory', 'room:dashboard'],
  'purchase.updated':  ['room:purchase', 'room:dashboard'],
  'purchase.deleted':  ['room:purchase', 'room:dashboard'],
  'purchase.approved': ['room:purchase', 'room:dashboard'],

  // Sales events
  'sale.created':  ['room:sales', 'room:inventory', 'room:dashboard'],
  'sale.updated':  ['room:sales', 'room:dashboard'],
  'sale.deleted':  ['room:sales', 'room:dashboard'],
  'sale.approved': ['room:sales', 'room:dashboard'],

  // Process / Manufacturing events
  'process.started':    ['room:process', 'room:manufacturing', 'room:inventory', 'room:dashboard'],
  'process.completed':  ['room:process', 'room:manufacturing', 'room:inventory', 'room:dashboard'],
  'process.cancelled':  ['room:process', 'room:manufacturing', 'room:dashboard'],
  'process.approved':   ['room:process', 'room:manufacturing', 'room:dashboard'],
  'process.rejected':   ['room:process', 'room:manufacturing', 'room:dashboard'],
  'process.returned':   ['room:process', 'room:inventory', 'room:dashboard'],
  'batch.created':      ['room:manufacturing', 'room:dashboard'],
  'batch.updated':      ['room:manufacturing', 'room:dashboard'],
  'batch.closed':       ['room:manufacturing', 'room:inventory', 'room:dashboard'],
  'lot.split':          ['room:inventory', 'room:manufacturing'],
  'lot.merged':         ['room:inventory', 'room:manufacturing'],

  // Admin events (user-targeted for permission changes)
  'role.created':       ['room:admin'],
  'role.updated':       ['room:admin'],
  'role.deleted':       ['room:admin'],
  'user.created':       ['room:admin'],
  'user.updated':       ['room:admin'],
  'user.deactivated':   ['room:admin'],

  // Journal entry events → P&L data changed, notify dashboard
  'journal.created':  ['room:dashboard', 'room:audit'],
  'journal.updated':  ['room:dashboard', 'room:audit'],
  'journal.deleted':  ['room:dashboard', 'room:audit'],
  'journal.posted':   ['room:dashboard', 'room:audit'],
  'journal.reversed': ['room:dashboard', 'room:audit'],

  // Expense events → P&L data changed, notify dashboard
  'expense.created':  ['room:dashboard', 'room:purchase'],
  'expense.updated':  ['room:dashboard'],
  'expense.deleted':  ['room:dashboard'],

  // Payment events → AP / P&L data changed
  'payment.created':  ['room:dashboard', 'room:purchase'],
  'payment.updated':  ['room:dashboard'],
  'payment.deleted':  ['room:dashboard'],

  // Receipt events → AR / P&L data changed
  'receipt.created':  ['room:dashboard', 'room:sales'],
  'receipt.updated':  ['room:dashboard'],
  'receipt.deleted':  ['room:dashboard'],

  // Dashboard-only refreshes
  'dashboard.refresh':  ['room:dashboard'],
};

/**
 * Dispatch a real-time event to all relevant rooms.
 *
 * @param {string} topic          - Event name (e.g. 'inventory.created')
 * @param {object} payload        - Data to send to clients
 * @param {object} [opts]
 * @param {string|number} [opts.targetUserId] - If set, also notifies this user's private room
 * @param {boolean} [opts.skipOutbox]         - Skip outbox persistence (for high-frequency events)
 * @param {boolean} [opts.broadcastAll]       - Override routing and broadcast to everyone
 */
async function dispatchEvent(topic, payload, opts = {}) {
  const { targetUserId, skipOutbox = false, broadcastAll = false } = opts;

  try {
    if (!getIO()) {
      // Socket not yet initialised (startup race) — still persist to outbox
      logger.warn(`[EventDispatcher] Socket not ready, skipping real-time dispatch for ${topic}`);
    } else if (broadcastAll) {
      broadcast(topic, payload);
    } else {
      // Route to rooms based on event type
      const rooms = EVENT_ROUTES[topic] || ['room:dashboard'];
      const uniqueRooms = [...new Set(rooms)];
      for (const room of uniqueRooms) {
        dispatchToRoom(room, topic, payload);
      }

      // Also notify the specific user who owns/affected the record
      if (targetUserId) {
        dispatchToUser(targetUserId, topic, payload);
      }
    }

    // ── Persist to outbox for offline recovery ─────────────────────────────
    if (!skipOutbox) {
      // Fire-and-forget — never block the calling route
      pool.query(
        'INSERT INTO sys_event_outbox (topic, payload) VALUES ($1, $2)',
        [topic, JSON.stringify({ ...payload, _routed: EVENT_ROUTES[topic] || [] })]
      ).catch(err => logger.error('[EventDispatcher] Outbox write failed', { topic, error: err.message }));
    }
  } catch (err) {
    // NEVER let event dispatching crash a business transaction
    logger.error(`[EventDispatcher] Failed to dispatch ${topic}`, { error: err.message });
  }
}

/**
 * Dispatch a permission change targeted at a specific user.
 * The client receives this and re-fetches their session (/api/auth/me).
 *
 * @param {string|number} userId
 * @param {object} [meta]  - { changedBy, roleName, etc }
 */
async function dispatchPermissionChange(userId, meta = {}) {
  return dispatchEvent('permission.changed', { userId, ...meta }, { targetUserId: userId });
}

module.exports = {
  dispatchEvent,
  dispatchPermissionChange,
};

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
const cache = require('../db/cache');
const { dispatchToRoom, dispatchToUser, broadcast, getIO } = require('./socketService');
const { logger } = require('../middleware/logger');

// ── Lazy-loaded bridge services (initialised on first dispatch) ──────────────
let redisPubSub = null;
let kafkaEventSink = null;
let mqttBroker = null;
let natsClient = null;
let firebaseSync = null;
let graphqlSubs = null;

function getRedisPubSub() {
  if (!redisPubSub) try { redisPubSub = require('./redisPubSub'); } catch {}
  return redisPubSub;
}
function getKafkaSink() {
  if (!kafkaEventSink) try { kafkaEventSink = require('./kafkaEventSink'); } catch {}
  return kafkaEventSink;
}
function getMqttBroker() {
  if (!mqttBroker) try { mqttBroker = require('./mqttBroker'); } catch {}
  return mqttBroker;
}
function getNatsClient() {
  if (!natsClient) try { natsClient = require('./natsClient'); } catch {}
  return natsClient;
}
function getFirebaseSync() {
  if (!firebaseSync) try { firebaseSync = require('./firebaseSync'); } catch {}
  return firebaseSync;
}
function getGraphQLSubs() {
  if (!graphqlSubs) try { graphqlSubs = require('../graphql/subscriptions'); } catch {}
  return graphqlSubs;
}

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
  'inventory.stock.changed': ['room:inventory', 'room:dashboard'],

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
  'user.login':         ['room:admin'],
  'user.logout':        ['room:admin'],
  'user.preferences.updated': ['room:dashboard'],  // user:<id> targeting set by app-level dispatchEvent targetUserId

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

  // Bank deposit events
  'bank_deposit.created':  ['room:dashboard', 'room:audit'],
  'bank_deposit.updated':  ['room:dashboard'],
  'bank_deposit.deleted':  ['room:dashboard'],
  'bank_deposit.reversed': ['room:dashboard', 'room:audit'],

  // Asset / Depreciation events
  'asset.created':   ['room:dashboard'],
  'asset.updated':   ['room:dashboard'],
  'asset.deleted':   ['room:dashboard'],
  'asset_template.created':  ['room:dashboard'],
  'asset_template.updated':  ['room:dashboard'],
  'asset_template.deleted':  ['room:dashboard'],
  'fa_category.created':     ['room:dashboard'],
  'fa_category.updated':     ['room:dashboard'],
  'fa_category.deleted':     ['room:dashboard'],
  'depreciation.created':    ['room:dashboard', 'room:audit'],
  'depreciation.cancelled':  ['room:dashboard', 'room:audit'],

  // Manufacturing events
  'manufacturing.process.started':    ['room:manufacturing', 'room:process', 'room:dashboard'],
  'manufacturing.process.completed':  ['room:manufacturing', 'room:process', 'room:dashboard'],
  'manufacturing.process.held':       ['room:manufacturing', 'room:dashboard'],
  'manufacturing.process.resumed':    ['room:manufacturing', 'room:dashboard'],
  'manufacturing.machine.status_changed': ['room:manufacturing', 'room:dashboard'],

  // Dashboard-only refreshes
  'dashboard.refresh':          ['room:dashboard'],
  'dashboard.widget.updated':   ['room:dashboard'],
  'dashboard.config.updated':   ['room:dashboard'],

  // Master data events
  'master.created':      ['room:dashboard'],
  'master.updated':      ['room:dashboard'],
  'master.deleted':      ['room:dashboard'],
  'master.bulk_created': ['room:dashboard'],

  // Process master events
  'process_master.created':  ['room:manufacturing', 'room:dashboard'],
  'process_master.updated':  ['room:manufacturing', 'room:dashboard'],
  'process_master.deleted':  ['room:manufacturing', 'room:dashboard'],

  // JE Allocation events
  'je_allocation.created':  ['room:dashboard', 'room:audit'],
  'je_allocation.deleted':  ['room:dashboard', 'room:audit'],

  // Account events
  'account.created':  ['room:dashboard', 'room:audit'],
  'account.updated':  ['room:dashboard', 'room:audit'],
  'account.deleted':  ['room:dashboard', 'room:audit'],

  // Vendor events
  'vendor.created':  ['room:purchase', 'room:dashboard'],
  'vendor.updated':  ['room:purchase', 'room:dashboard'],
  'vendor.deleted':  ['room:purchase', 'room:dashboard'],

  // Customer events
  'customer.created':  ['room:sales', 'room:dashboard'],
  'customer.updated':  ['room:sales', 'room:dashboard'],
  'customer.deleted':  ['room:sales', 'room:dashboard'],

  // Recon events
  'recon.created':  ['room:dashboard', 'room:audit'],
  'recon.updated':  ['room:dashboard'],
  'recon.deleted':  ['room:dashboard'],

  // Revenue / P&L aggregate events
  'revenue.updated':     ['room:dashboard'],
  'expenses.updated':    ['room:dashboard'],
  'netprofit.updated':   ['room:dashboard'],
  'payroll.updated':     ['room:dashboard'],
  'report.generated':    ['room:dashboard'],
  'notification.created': ['room:dashboard'],

  // Security events
  'permission.changed':  ['room:admin'],
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
    const { trackEvent } = require('./metricsService');
    trackEvent(topic);
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

    // ── Cross-bridge publishing (Redis, Kafka, MQTT, NATS, Firebase, GraphQL) ─
    const bridgePayload = { topic, payload, timestamp: new Date().toISOString() };
    // Fire-and-forget to avoid blocking the calling route
    const redis = getRedisPubSub();
    if (redis) redis.publish(topic, bridgePayload).catch(() => {});
    const kafka = getKafkaSink();
    if (kafka) kafka.produce(topic, bridgePayload).catch(() => {});
    const mqtt = getMqttBroker();
    if (mqtt) mqtt.publish(topic, bridgePayload).catch(() => {});
    const nats = getNatsClient();
    if (nats) nats.publish(topic, bridgePayload).catch(() => {});
    const fb = getFirebaseSync();
    if (fb) fb.syncEvent(topic, bridgePayload).catch(() => {});
    const gql = getGraphQLSubs();
    if (gql) gql.publish(topic, payload).catch(() => {});

    // ── Invalidate affected cache prefixes ────────────────────────────────────
    const cachePrefix = topic.split('.')[0];
    if (cachePrefix) {
      const prefixes = [
        cachePrefix,
        ...(EVENT_ROUTES[topic] || [])
          .filter(r => r.startsWith('room:'))
          .map(r => r.replace('room:', '')),
      ];
      const uniquePrefixes = [...new Set(prefixes)];
      for (const p of uniquePrefixes) {
        cache.invalidatePrefix(p).catch(() => {});
      }
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

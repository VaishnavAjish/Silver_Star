'use strict';

const crypto = require('crypto');
const cache = require('../db/cache');
const { dispatchToRoom, dispatchToUser, broadcast, getIO } = require('./socketService');
const { logger } = require('../middleware/logger');

const DEDUP_WINDOW_MS = 2000;
const dedupCache = new Map();

function dedupKey(topic, payload) {
  const entityId = payload && (payload.id || payload._entityId);
  if (entityId) return `${topic}:${entityId}`;
  const hash = crypto.createHash('md5').update(JSON.stringify(payload || '')).digest('hex');
  return `${topic}:${hash}`;
}

function isDuplicate(key) {
  const now = Date.now();
  const last = dedupCache.get(key);
  if (last && (now - last) < DEDUP_WINDOW_MS) return true;
  dedupCache.set(key, now);
  return false;
}

function pruneDedupCache() {
  const now = Date.now();
  for (const [key, ts] of dedupCache) {
    if ((now - ts) >= DEDUP_WINDOW_MS) dedupCache.delete(key);
  }
}
setInterval(pruneDedupCache, DEDUP_WINDOW_MS * 2);

const EVENT_ROUTES = {
  'inventory.created':     ['room:inventory', 'room:dashboard'],
  'inventory.updated':     ['room:inventory', 'room:dashboard'],
  'inventory.deleted':     ['room:inventory', 'room:dashboard'],
  'inventory.transferred': ['room:inventory', 'room:dashboard'],
  'inventory.adjusted':    ['room:inventory', 'room:dashboard'],
  'inventory.opening':     ['room:inventory', 'room:dashboard'],
  'inventory.closing':     ['room:inventory', 'room:dashboard'],
  'inventory.stock.changed': ['room:inventory', 'room:dashboard'],
  'purchase.created':  ['room:purchase', 'room:inventory', 'room:dashboard'],
  'purchase.updated':  ['room:purchase', 'room:dashboard'],
  'purchase.deleted':  ['room:purchase', 'room:dashboard'],
  'purchase.approved': ['room:purchase', 'room:dashboard'],
  'sale.created':  ['room:sales', 'room:inventory', 'room:dashboard'],
  'sale.updated':  ['room:sales', 'room:dashboard'],
  'sale.deleted':  ['room:sales', 'room:dashboard'],
  'sale.approved': ['room:sales', 'room:dashboard'],
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
  'role.created':       ['room:admin'],
  'role.updated':       ['room:admin'],
  'role.deleted':       ['room:admin'],
  'user.created':       ['room:admin'],
  'user.updated':       ['room:admin'],
  'user.deactivated':   ['room:admin'],
  'user.login':         ['room:admin'],
  'user.logout':        ['room:admin'],
  'user.preferences.updated': ['room:dashboard'],
  'journal.created':  ['room:dashboard', 'room:audit'],
  'journal.updated':  ['room:dashboard', 'room:audit'],
  'journal.deleted':  ['room:dashboard', 'room:audit'],
  'journal.posted':   ['room:dashboard', 'room:audit'],
  'journal.reversed': ['room:dashboard', 'room:audit'],
  'expense.created':  ['room:dashboard', 'room:purchase'],
  'expense.updated':  ['room:dashboard'],
  'expense.deleted':  ['room:dashboard'],
  'payment.created':  ['room:dashboard', 'room:purchase'],
  'payment.updated':  ['room:dashboard'],
  'payment.deleted':  ['room:dashboard'],
  'receipt.created':  ['room:dashboard', 'room:sales'],
  'receipt.updated':  ['room:dashboard'],
  'receipt.deleted':  ['room:dashboard'],
  'bank_deposit.created':  ['room:dashboard', 'room:audit'],
  'bank_deposit.updated':  ['room:dashboard'],
  'bank_deposit.deleted':  ['room:dashboard'],
  'bank_deposit.reversed': ['room:dashboard', 'room:audit'],
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
  'manufacturing.process.started':    ['room:manufacturing', 'room:process', 'room:dashboard'],
  'manufacturing.process.completed':  ['room:manufacturing', 'room:process', 'room:dashboard'],
  'manufacturing.process.held':       ['room:manufacturing', 'room:dashboard'],
  'manufacturing.process.resumed':    ['room:manufacturing', 'room:dashboard'],
  'manufacturing.machine.status_changed': ['room:manufacturing', 'room:dashboard'],
  'dashboard.refresh':          ['room:dashboard'],
  'dashboard.widget.updated':   ['room:dashboard'],
  'dashboard.config.updated':   ['room:dashboard'],
  'master.created':      ['room:dashboard'],
  'master.updated':      ['room:dashboard'],
  'master.deleted':      ['room:dashboard'],
  'master.bulk_created': ['room:dashboard'],
  'process_master.created':  ['room:manufacturing', 'room:dashboard'],
  'process_master.updated':  ['room:manufacturing', 'room:dashboard'],
  'process_master.deleted':  ['room:manufacturing', 'room:dashboard'],
  'je_allocation.created':  ['room:dashboard', 'room:audit'],
  'je_allocation.deleted':  ['room:dashboard', 'room:audit'],
  'account.created':  ['room:dashboard', 'room:audit'],
  'account.updated':  ['room:dashboard', 'room:audit'],
  'account.deleted':  ['room:dashboard', 'room:audit'],
  'vendor.created':  ['room:purchase', 'room:dashboard'],
  'vendor.updated':  ['room:purchase', 'room:dashboard'],
  'vendor.deleted':  ['room:purchase', 'room:dashboard'],
  'customer.created':  ['room:sales', 'room:dashboard'],
  'customer.updated':  ['room:sales', 'room:dashboard'],
  'customer.deleted':  ['room:sales', 'room:dashboard'],
  'recon.created':  ['room:dashboard', 'room:audit'],
  'recon.updated':  ['room:dashboard'],
  'recon.deleted':  ['room:dashboard'],
  'revenue.updated':     ['room:dashboard'],
  'expenses.updated':    ['room:dashboard'],
  'netprofit.updated':   ['room:dashboard'],
  'payroll.updated':     ['room:dashboard'],
  'report.generated':    ['room:dashboard'],
  'notification.created': ['room:dashboard'],
  'permission.changed':  ['room:admin'],
};

async function dispatchEvent(topic, payload, opts = {}) {
  const { targetUserId, broadcastAll = false } = opts;

  try {
    const { trackEvent } = require('./metricsService');
    trackEvent(topic);

    const key = dedupKey(topic, payload);
    if (isDuplicate(key)) {
      logger.debug(`[EventDispatcher] Dedup suppressed duplicate WebSocket broadcast for ${key}`);
      return;
    }

    if (!getIO()) {
      logger.warn(`[EventDispatcher] Socket not ready, skipping real-time dispatch for ${topic}`);
      return;
    }

    if (broadcastAll) {
      broadcast(topic, payload);
    } else {
      const rooms = EVENT_ROUTES[topic] || ['room:dashboard'];
      const uniqueRooms = [...new Set(rooms)];
      for (const room of uniqueRooms) {
        dispatchToRoom(room, topic, payload);
      }

      if (targetUserId) {
        dispatchToUser(targetUserId, topic, payload);
      }
    }

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
    logger.error(`[EventDispatcher] Failed to dispatch ${topic}`, { error: err.message });
  }
}

async function dispatchPermissionChange(userId, meta = {}) {
  return dispatchEvent('permission.changed', { userId, ...meta }, { targetUserId: userId });
}

module.exports = {
  dispatchEvent,
  dispatchPermissionChange,
};

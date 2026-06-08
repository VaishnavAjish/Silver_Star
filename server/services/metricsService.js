'use strict';

const { logger } = require('../middleware/logger');

const counters = {};

function increment(name, labels = {}) {
  const key = `${name}|${JSON.stringify(labels)}`;
  counters[key] = (counters[key] || 0) + 1;
}

function gauge(name, value, labels = {}) {
  const key = `${name}|${JSON.stringify(labels)}`;
  counters[key] = value;
}

function snapshot() {
  const lines = ['# HELP silverstar_erp_events_total Total ERP events dispatched'];
  lines.push('# TYPE silverstar_erp_events_total counter');
  for (const [key, value] of Object.entries(counters)) {
    const [name, labelsStr] = key.split('|');
    const labels = JSON.parse(labelsStr);
    const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
    if (labelStr) {
      lines.push(`silverstar_erp_events_total{${labelStr}} ${value}`);
    } else {
      lines.push(`silverstar_erp_events_total{name="${name}"} ${value}`);
    }
  }
  return lines.join('\n');
}

function getBridgeStatus() {
  const statuses = {};
  const bridges = ['redisPubSub', 'kafkaEventSink', 'mqttBroker', 'natsClient', 'firebaseSync', 'pgNotifyListener', 'presenceService'];
  for (const name of bridges) {
    try {
      const mod = require(`./${name}`);
      statuses[name] = mod.isConnected !== undefined ? { connected: mod.isConnected } : { available: true };
    } catch {
      statuses[name] = { available: false, error: 'not loaded' };
    }
  }
  // Socket.IO status
  try {
    const { getIO, getMetrics } = require('./socketService');
    const io = getIO();
    statuses.socketIO = io ? {
      connected: true,
      connections: io.engine?.clientsCount || 0,
      rooms: io.sockets?.adapter?.rooms?.size || 0,
    } : { connected: false };
  } catch {
    statuses.socketIO = { connected: false };
  }
  return statuses;
}

function reset() {
  Object.keys(counters).forEach(k => delete counters[k]);
}

// Track event dispatches
function trackEvent(topic) {
  increment('events', { topic });
  const module = topic.split('.')[0];
  increment('events_by_module', { module });
}

// Track connection events
function trackConnection(type, action) {
  increment('connections', { type, action });
}

// Track errors by source
function trackError(source, operation) {
  increment('errors', { source, operation });
}

module.exports = { increment, gauge, snapshot, getBridgeStatus, reset, trackEvent, trackConnection, trackError };

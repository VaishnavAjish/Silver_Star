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
  // Real-time bridges (WebSocket, pg-notify listener, presence) were removed.
  return {};
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

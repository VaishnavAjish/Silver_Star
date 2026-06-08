'use strict';

const { logger } = require('../middleware/logger');

let io = null;
let activeConnections = new Map();

const HUB_NAME = 'erpHub';

function mapEventToMethod(topic) {
  const map = {
    'inventory.created':     { method: 'inventoryCreated',     target: 'inventory' },
    'inventory.updated':     { method: 'inventoryUpdated',     target: 'inventory' },
    'inventory.deleted':     { method: 'inventoryDeleted',     target: 'inventory' },
    'purchase.created':      { method: 'purchaseCreated',      target: 'purchase' },
    'sale.created':          { method: 'saleCreated',          target: 'sales' },
    'dashboard.refresh':     { method: 'dashboardRefreshed',   target: 'dashboard' },
    'notification.created':  { method: 'notificationReceived', target: 'notifications' },
    'presence.update':       { method: 'presenceUpdated',      target: 'admin' },
  };
  return map[topic] || null;
}

function negotiateSignalR(req, res) {
  const connectionId = `${req.user.id}-${Date.now()}`;
  const connectionToken = Buffer.from(JSON.stringify({ userId: req.user.id, connectionId })).toString('base64');
  activeConnections.set(connectionId, { userId: req.user.id, role: req.user.role, connectedAt: new Date() });
  res.json({
    connectionId,
    availableTransports: [
      { transport: 'WebSocket', transferFormats: ['Text', 'Binary'] },
      { transport: 'ServerSentEvents', transferFormats: ['Text'] },
      { transport: 'LongPolling', transferFormats: ['Text'] },
    ],
    connectionToken,
  });
}

function handleSignalRMessage(req, res) {
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];
  for (const msg of messages) {
    if (msg.type === 1) {
      responses.push({
        type: 2,
        invocationId: msg.invocationId,
        target: msg.target,
      });
    }
  }
  res.json(responses.length ? responses : []);
}

function startSignalrBridge(socketIO) {
  io = socketIO;

  setInterval(() => {
    const now = Date.now();
    for (const [connId, conn] of activeConnections) {
      if (now - conn.connectedAt.getTime() > 86400000) {
        activeConnections.delete(connId);
      }
    }
  }, 3600000);

  logger.info('[SignalR] Bridge initialised with hub=%s', HUB_NAME);
}

function stopSignalrBridge() {
  activeConnections.clear();
  io = null;
  logger.info('[SignalR] Bridge stopped');
}

function broadcast(topic, payload) {
  const mapping = mapEventToMethod(topic);
  if (!mapping || !io) return;
  io.to(`room:${mapping.target}`).emit('signalr', {
    type: 1,
    target: mapping.method,
    arguments: [payload],
  });
}

module.exports = { startSignalrBridge, stopSignalrBridge, broadcast, negotiateSignalR, handleSignalRMessage };

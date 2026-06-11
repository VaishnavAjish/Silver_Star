'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const securityConfig = require('../config/security');
const { logger } = require('../middleware/logger');
const { hasPermission } = require('../utils/permissions');

let wss = null;

const rooms = new Map();
const socketRooms = new Map();
const processedEvents = new Map();
const DEDUP_TTL = 5 * 60 * 1000;

const MODULE_ROOMS = [
  'room:inventory', 'room:purchase', 'room:sales', 'room:process',
  'room:manufacturing', 'room:dashboard', 'room:admin', 'room:audit', 'room:reports',
];

const ROOM_TO_MODULE = {
  'room:inventory': 'inventory', 'room:purchase': 'purchase', 'room:sales': 'sales',
  'room:process': 'process', 'room:manufacturing': 'manufacturing',
  'room:dashboard': 'dashboard', 'room:admin': 'management',
  'room:audit': 'admin', 'room:reports': 'reports',
};

let redisPub = null;
let redisSub = null;
const REDIS_CHANNEL = 'silverstar:ws:events';
const REDIS_URL = process.env.REDIS_URL;

function sendToSocket(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function addToRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  if (!socketRooms.has(ws)) socketRooms.set(ws, new Set());
  socketRooms.get(ws).add(room);
}

function removeFromRoom(ws, room) {
  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  const sr = socketRooms.get(ws);
  if (sr) sr.delete(room);
}

function removeSocket(ws) {
  const sr = socketRooms.get(ws);
  if (sr) {
    for (const room of sr) {
      const set = rooms.get(room);
      if (set) {
        set.delete(ws);
        if (set.size === 0) rooms.delete(room);
      }
    }
    socketRooms.delete(ws);
  }
}

function markProcessed(eventId) {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, Date.now());
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL;
  for (const [id, ts] of processedEvents) {
    if (ts < cutoff) processedEvents.delete(id);
  }
}, 60_000).unref();

async function canJoinRoom(user, room) {
  if (user.role === 'super_admin') return true;
  if (room === `user:${user.id}`) return true;
  if (room === `role:${user.role}`) return true;
  const module = ROOM_TO_MODULE[room];
  if (module) return await hasPermission(user.id, module, 'view');
  return false;
}

function dispatchToRoomLocal(room, event, payload, eventId) {
  if (!wss) return;
  const members = rooms.get(room);
  if (!members) return;
  const msg = { type: 'event', event, payload, eventId, _ts: Date.now() };
  for (const ws of members) {
    sendToSocket(ws, msg);
  }
}

function dispatchToUserLocal(userId, event, payload, eventId) {
  dispatchToRoomLocal(`user:${userId}`, event, payload, eventId);
}

async function initSocket(httpServer) {
  const wsPath = process.env.WS_PATH || '/ws';

  wss = new WebSocketServer({ server: httpServer, path: wsPath });

  wss.on('connection', (ws, req) => {
    const queryParams = new URL(req.url, 'http://localhost').searchParams;
    const token = queryParams.get('token') || req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      sendToSocket(ws, { type: 'error', message: 'Authentication required' });
      ws.close(4001, 'Authentication required');
      return;
    }

    let user;
    try {
      user = jwt.verify(token, securityConfig.jwt.accessSecret);
    } catch (err) {
      sendToSocket(ws, { type: 'error', message: 'Invalid or expired token' });
      ws.close(4001, 'Invalid or expired token');
      return;
    }

    ws.user = user;
    const { id: userId, role, full_name } = user;

    addToRoom(ws, `user:${userId}`);
    addToRoom(ws, `role:${role}`);
    addToRoom(ws, 'room:dashboard');

    logger.info('[WS] Client connected', { userId, role, name: full_name });
    sendToSocket(ws, { type: 'connected', userId, role });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'subscribe': {
          if (!Array.isArray(msg.rooms)) return;
          const joined = [];
          for (const room of msg.rooms) {
            if (canJoinRoom(user, room)) {
              addToRoom(ws, room);
              joined.push(room);
            }
          }
          sendToSocket(ws, { type: 'subscribed', rooms: joined });
          break;
        }
        case 'unsubscribe': {
          if (!Array.isArray(msg.rooms)) return;
          for (const room of msg.rooms) {
            removeFromRoom(ws, room);
          }
          sendToSocket(ws, { type: 'unsubscribed', rooms: msg.rooms });
          break;
        }
        case 'ping': {
          sendToSocket(ws, { type: 'pong', ts: Date.now() });
          break;
        }
      }
    });

    ws.on('close', () => {
      removeSocket(ws);
      logger.info('[WS] Client disconnected', { userId, reason: 'connection closed' });
    });

    ws.on('error', (err) => {
      logger.error('[WS] Socket error', { userId, error: err.message });
      removeSocket(ws);
    });
  });

  if (REDIS_URL) {
    try {
      const Redis = require('ioredis');
      redisPub = new Redis(REDIS_URL, {
        retryStrategy: (t) => Math.min(t * 50, 2000),
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      redisSub = redisPub.duplicate();

      await Promise.all([redisPub.connect(), redisSub.connect()]);

      await redisSub.subscribe(REDIS_CHANNEL);

      redisSub.on('message', (channel, message) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed.eventId && markProcessed(parsed.eventId)) return;
          const { event, payload, rooms: targetRooms, targetUserId } = parsed;
          if (targetRooms) {
            for (const room of targetRooms) {
              dispatchToRoomLocal(room, event, payload, parsed.eventId);
            }
          }
          if (targetUserId) {
            dispatchToUserLocal(targetUserId, event, payload, parsed.eventId);
          }
        } catch (err) {
          logger.warn('[WS-Redis] Failed to process message', { error: err.message });
        }
      });

      logger.info('[WS] Redis Pub/Sub attached for multi-instance');
    } catch (err) {
      logger.warn('[WS] Redis unavailable — running in single-node mode', { error: err.message });
      redisPub = null;
      redisSub = null;
    }
  } else {
    logger.info('[WS] REDIS_URL not set — single-node mode');
  }

  logger.info('[WS] Gateway initialised');
  return wss;
}

function getIO() {
  return wss;
}

function dispatchToRoom(room, event, payload) {
  if (!wss) return;
  const eventId = uuidv4();
  markProcessed(eventId);
  dispatchToRoomLocal(room, event, payload, eventId);
  if (redisPub) {
    redisPub.publish(REDIS_CHANNEL, JSON.stringify({ event, payload, rooms: [room], eventId })).catch(() => {});
  }
}

function dispatchToUser(userId, event, payload) {
  if (!wss) return;
  const eventId = uuidv4();
  markProcessed(eventId);
  dispatchToUserLocal(userId, event, payload, eventId);
  if (redisPub) {
    redisPub.publish(REDIS_CHANNEL, JSON.stringify({ event, payload, targetUserId: userId, eventId })).catch(() => {});
  }
}

function broadcast(event, payload) {
  if (!wss) return;
  const eventId = uuidv4();
  markProcessed(eventId);
  const msg = { type: 'event', event, payload, eventId, _ts: Date.now() };
  wss.clients.forEach((ws) => {
    sendToSocket(ws, msg);
  });
}

async function getMetrics() {
  if (!wss) return { connected: 0, rooms: 0 };
  return { connected: wss.clients.size, rooms: rooms.size };
}

async function fetchSockets() {
  const result = [];
  if (!wss) return result;
  wss.clients.forEach((ws) => {
    if (ws.user) {
      const sr = socketRooms.get(ws);
      result.push({ user: ws.user, rooms: sr ? [...sr] : [] });
    }
  });
  return result;
}

module.exports = {
  initSocket,
  getIO,
  dispatchToRoom,
  dispatchToUser,
  broadcast,
  getMetrics,
  fetchSockets,
};

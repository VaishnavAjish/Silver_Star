'use strict';

/**
 * ─── Silverstar Grow ERP — Real-Time Socket.IO Gateway ─────────────────────
 *
 * Enterprise-grade WebSocket server with:
 *  - JWT authentication on handshake
 *  - Redis Pub/Sub adapter for horizontal scalability
 *  - Smart room-based routing (module rooms + user private rooms)
 *  - Graceful fallback when Redis is unavailable (dev mode)
 *  - Structured logging
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const securityConfig = require('../config/security');
const { logger } = require('../middleware/logger');
const { hasPermission } = require('../utils/permissions');

let io = null;

// ── Module → Room mapping ────────────────────────────────────────────────────
// Keep in sync with ERP_EVENTS on the client side
const MODULE_ROOMS = [
  'room:inventory',
  'room:purchase',
  'room:sales',
  'room:process',
  'room:manufacturing',
  'room:dashboard',
  'room:admin',
  'room:audit',
  'room:reports',
];

// Room to module mapping for permission checks
const ROOM_TO_MODULE = {
  'room:inventory': 'inventory',
  'room:purchase': 'purchase',
  'room:sales': 'sales',
  'room:process': 'process',
  'room:manufacturing': 'manufacturing',
  'room:dashboard': 'dashboard',
  'room:admin': 'management',
  'room:audit': 'admin',
  'room:reports': 'reports',
};

// ── Validate that a client is allowed to join a room ─────────────────────────
async function canJoinRoom(user, room) {
  // Super admin joins everything
  if (user.role === 'super_admin' || user.role === 'admin') return true;

  // Private user room — only the owner
  if (room === `user:${user.id}`) return true;

  // Role room — only matching role
  if (room === `role:${user.role}`) return true;

  // Module rooms — check view permission
  const module = ROOM_TO_MODULE[room];
  if (module) {
    return await hasPermission(user.id, module, 'view');
  }

  return false;
}

/**
 * Initialise the Socket.IO gateway bound to the HTTP server.
 * Falls back to in-process broadcast if Redis is unavailable.
 */
async function initSocket(httpServer) {
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Allow both polling fallback and native WebSocket
    transports: ['websocket', 'polling'],
    // Ping/pong to detect dead connections
    pingInterval: 25000,
    pingTimeout: 20000,
    // Max message size 1 MB — prevent amplification attacks
    maxHttpBufferSize: 1e6,
    // Connection state recovery — clients automatically get missed events
    // on reconnect without any extra code (Socket.IO v4.6+)
    connectionStateRecovery: {
      // Max duration (ms) a client can be disconnected and still recover
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  // ── Attach Redis adapter (optional — dev works without Redis) ──────────────
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const Redis = require('ioredis');

      const pubClient = new Redis(redisUrl, {
        retryStrategy: (times) => Math.min(times * 50, 2000),
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
      });
      const subClient = pubClient.duplicate();

      pubClient.on('error', (err) => logger.error('[SocketIO] Redis pub error', { error: err.message }));
      subClient.on('error', (err) => logger.error('[SocketIO] Redis sub error', { error: err.message }));

      await Promise.all([
        new Promise(r => pubClient.once('ready', r)),
        new Promise(r => subClient.once('ready', r)),
      ]);

      io.adapter(createAdapter(pubClient, subClient));
      logger.info('[SocketIO] Redis adapter attached — horizontal scaling enabled');
    } catch (err) {
      logger.warn('[SocketIO] Redis unavailable — running in single-node mode', { error: err.message });
    }
  } else {
    logger.warn('[SocketIO] REDIS_URL not set — running in single-node mode (suitable for dev only)');
  }

  // ── JWT Authentication Middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, securityConfig.jwt.accessSecret);
      socket.user = decoded;
      next();
    } catch (err) {
      logger.warn('[SocketIO] Rejected connection — invalid token', { error: err.message });
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection Handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, role, full_name } = socket.user;

    logger.info('[SocketIO] Client connected', {
      socketId: socket.id,
      userId,
      role,
      name: full_name,
    });

    // Auto-join private rooms
    socket.join(`user:${userId}`);
    socket.join(`role:${role}`);

    // Auto-join the dashboard room so every connected user gets live KPI updates
    socket.join('room:dashboard');

    // ── Client subscribes to module rooms ────────────────────────────────────
    socket.on('subscribe', async (rooms) => {
      if (!Array.isArray(rooms)) return;
      for (const room of rooms) {
        if (await canJoinRoom(socket.user, room)) {
          socket.join(room);
        } else {
          logger.warn('[SocketIO] Subscription denied', { userId, room });
        }
      }
    });

    // ── Client unsubscribes from rooms ───────────────────────────────────────
    socket.on('unsubscribe', (rooms) => {
      if (!Array.isArray(rooms)) return;
      rooms.forEach(room => socket.leave(room));
    });

    // ── Heartbeat acknowledgment ─────────────────────────────────────────────
    socket.on('ping_ack', () => {
      socket.emit('pong_ack', { ts: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      logger.info('[SocketIO] Client disconnected', { socketId: socket.id, userId, reason });
    });

    socket.on('error', (err) => {
      logger.error('[SocketIO] Socket error', { socketId: socket.id, userId, error: err.message });
    });
  });

  logger.info('[SocketIO] Gateway initialised');
  return io;
}

/**
 * Get the Socket.IO server instance.
 * Safe to call even if initSocket hasn't been called yet (returns null).
 */
function getIO() {
  return io;
}

/**
 * Dispatch an event to a specific room.
 * @param {string} room   - e.g. 'room:inventory'
 * @param {string} event  - e.g. 'inventory.created'
 * @param {object} payload
 */
function dispatchToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, { ...payload, _ts: Date.now() });
}

/**
 * Send an event to a single user's private room.
 * @param {string|number} userId
 * @param {string} event
 * @param {object} payload
 */
function dispatchToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, { ...payload, _ts: Date.now() });
}

/**
 * Broadcast an event to ALL connected clients (use sparingly).
 */
function broadcast(event, payload) {
  if (!io) return;
  io.emit(event, { ...payload, _ts: Date.now() });
}

/**
 * Get live metrics about connected clients.
 */
async function getMetrics() {
  if (!io) return { connected: 0, rooms: 0 };
  const sockets = await io.fetchSockets();
  return {
    connected: sockets.length,
    rooms: io.sockets.adapter.rooms?.size || 0,
  };
}

module.exports = {
  initSocket,
  getIO,
  dispatchToRoom,
  dispatchToUser,
  broadcast,
  getMetrics,
};

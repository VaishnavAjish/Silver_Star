'use strict';

const { getIO } = require('./socketService');
const { logger } = require('../middleware/logger');

const PRESENCE_PREFIX = 'presence:';
const PRESENCE_TTL = 120;

let presenceInterval = null;

function startPresenceTracking() {
  const io = getIO();
  if (!io) {
    logger.warn('[Presence] Socket.IO not ready, deferring presence tracking');
    setTimeout(startPresenceTracking, 2000);
    return;
  }

  if (presenceInterval) clearInterval(presenceInterval);

  presenceInterval = setInterval(async () => {
    try {
      const sockets = await io.fetchSockets();
      const users = new Map();

      for (const socket of sockets) {
        const user = socket.user;
        if (!user) continue;

        if (!users.has(user.id)) {
          users.set(user.id, {
            userId: user.id,
            username: user.username,
            fullName: user.full_name || user.username,
            role: user.role,
            joined: socket.handshake?.issued,
            rooms: [],
          });
        }

        const rooms = Array.from(socket.rooms || []);
        users.get(user.id).rooms.push(...rooms);
      }

      for (const [, userData] of users) {
        userData.rooms = [...new Set(userData.rooms)];
      }

      io?.emit('presence.update', {
        online: Array.from(users.values()),
        count: users.size,
        _ts: Date.now(),
      });
    } catch (err) {
      logger.error('[Presence] Error tracking presence', { error: err.message });
    }
  }, PRESENCE_TTL * 1000);
}

function stopPresenceTracking() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

module.exports = { startPresenceTracking, stopPresenceTracking };

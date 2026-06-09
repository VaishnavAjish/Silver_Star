'use strict';

const { getIO, fetchSockets, broadcast } = require('./socketService');
const { logger } = require('../middleware/logger');

const PRESENCE_INTERVAL = 120 * 1000;

let presenceInterval = null;

function startPresenceTracking() {
  const wss = getIO();
  if (!wss) {
    logger.warn('[Presence] WebSocket not ready, deferring presence tracking');
    setTimeout(startPresenceTracking, 2000);
    return;
  }

  if (presenceInterval) clearInterval(presenceInterval);

  presenceInterval = setInterval(async () => {
    try {
      const sockets = await fetchSockets();
      const users = new Map();

      for (const { user, rooms } of sockets) {
        if (!user) continue;
        if (!users.has(user.id)) {
          users.set(user.id, {
            userId: user.id,
            username: user.username,
            fullName: user.full_name || user.username,
            role: user.role,
            joined: user.iat ? user.iat * 1000 : undefined,
            rooms: [],
          });
        }
        users.get(user.id).rooms.push(...rooms);
      }

      for (const [, userData] of users) {
        userData.rooms = [...new Set(userData.rooms)];
      }

      broadcast('presence.update', {
        online: Array.from(users.values()),
        count: users.size,
        _ts: Date.now(),
      });
    } catch (err) {
      logger.error('[Presence] Error tracking presence', { error: err.message });
    }
  }, PRESENCE_INTERVAL);
}

function stopPresenceTracking() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

module.exports = { startPresenceTracking, stopPresenceTracking };

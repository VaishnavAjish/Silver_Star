const { fetchSockets, broadcast } = require('./socketService');

let interval = null;
const PRESENCE_INTERVAL = 15000; // 15 seconds

function startPresenceTracking() {
  if (interval) return;
  
  interval = setInterval(() => {
    try {
      const sockets = fetchSockets();
      // Extract unique connected users
      const usersMap = new Map();
      
      sockets.forEach(s => {
        if (s.userId) {
          usersMap.set(s.userId, {
            id: s.userId,
            role: s.role,
            lastSeen: new Date().toISOString()
          });
        }
      });
      
      const activeUsers = Array.from(usersMap.values());
      
      // Broadcast the presence update
      broadcast('presence.update', { users: activeUsers });
      
    } catch (err) {
      console.error('[presenceService] Error tracking presence:', err.message);
    }
  }, PRESENCE_INTERVAL);
  
  console.log('[presenceService] Started presence tracking');
}

function stopPresenceTracking() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    console.log('[presenceService] Stopped presence tracking');
  }
}

module.exports = {
  startPresenceTracking,
  stopPresenceTracking
};

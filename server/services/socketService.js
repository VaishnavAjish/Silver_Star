const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

let wss = null;
const roomSockets = new Map(); // roomName -> Set<socket>
let totalConnections = 0;
let totalMessages = 0;

// Optional scaling
let redisPub = null;
let redisSub = null;
if (process.env.REDIS_URL) {
  const Redis = require('ioredis');
  redisPub = new Redis(process.env.REDIS_URL);
  redisSub = new Redis(process.env.REDIS_URL);
  
  redisSub.subscribe('silverstar:events');
  redisSub.on('message', (channel, message) => {
    if (channel === 'silverstar:events') {
      try {
        const { room, event, payload, eventId, userId, broadcast: isBroadcast } = JSON.parse(message);
        // Dispatch locally
        if (isBroadcast) {
          broadcastLocal(event, payload, eventId);
        } else if (userId) {
          dispatchToUserLocal(userId, event, payload, eventId);
        } else if (room) {
          dispatchToRoomLocal(room, event, payload, eventId);
        }
      } catch (err) {
        console.error('[socketService] Redis message parse error:', err.message);
      }
    }
  });
}

function initSocket(server) {
  return new Promise((resolve, reject) => {
    try {
      wss = new WebSocketServer({ server, path: '/ws' });

      wss.on('connection', (ws, req) => {
        totalConnections++;
        ws.isAlive = true;
        ws.id = uuidv4();
        ws.rooms = new Set();
        
        // Parse token from query string
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (!token) {
          ws.close(1008, 'Token required');
          return;
        }

        try {
          const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'dev_secret');
          ws.userId = decoded.id || decoded.userId;
          ws.role = decoded.role;
          
          // Join personal user room
          joinRoom(ws, `user:${ws.userId}`);
          
          ws.send(JSON.stringify({ type: 'connected', id: ws.id }));
        } catch (err) {
          ws.close(1008, 'Invalid token');
          return;
        }

        ws.on('message', (data) => {
          totalMessages++;
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
            } else if (msg.type === 'subscribe' && Array.isArray(msg.rooms)) {
              msg.rooms.forEach(r => joinRoom(ws, r));
              ws.send(JSON.stringify({ type: 'subscribed', rooms: msg.rooms }));
            } else if (msg.type === 'unsubscribe' && Array.isArray(msg.rooms)) {
              msg.rooms.forEach(r => leaveRoom(ws, r));
              ws.send(JSON.stringify({ type: 'unsubscribed', rooms: msg.rooms }));
            }
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
          }
        });

        ws.on('pong', () => {
          ws.isAlive = true;
        });

        ws.on('close', () => {
          ws.rooms.forEach(r => leaveRoom(ws, r));
          totalConnections--;
        });
      });

      // Heartbeat
      const interval = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
          if (ws.isAlive === false) return ws.terminate();
          ws.isAlive = false;
          ws.ping();
        });
      }, 30000);

      wss.on('close', () => {
        clearInterval(interval);
      });

      console.log('[socketService] WebSocket server initialized on /ws');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function joinRoom(ws, room) {
  ws.rooms.add(room);
  if (!roomSockets.has(room)) {
    roomSockets.set(room, new Set());
  }
  roomSockets.get(room).add(ws);
}

function leaveRoom(ws, room) {
  ws.rooms.delete(room);
  if (roomSockets.has(room)) {
    roomSockets.get(room).delete(ws);
    if (roomSockets.get(room).size === 0) {
      roomSockets.delete(room);
    }
  }
}

// Local dispatch functions
function dispatchToRoomLocal(room, event, payload, eventId) {
  if (!roomSockets.has(room)) return;
  const msg = JSON.stringify({ type: 'event', event, payload, eventId });
  roomSockets.get(room).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function dispatchToUserLocal(userId, event, payload, eventId) {
  dispatchToRoomLocal(`user:${userId}`, event, payload, eventId);
}

function broadcastLocal(event, payload, eventId) {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'event', event, payload, eventId });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

// Public API (handles Redis if enabled)
function dispatchToRoom(room, event, payload) {
  const eventId = uuidv4();
  if (redisPub) {
    redisPub.publish('silverstar:events', JSON.stringify({ room, event, payload, eventId }));
  } else {
    dispatchToRoomLocal(room, event, payload, eventId);
  }
}

function dispatchToUser(userId, event, payload) {
  const eventId = uuidv4();
  if (redisPub) {
    redisPub.publish('silverstar:events', JSON.stringify({ userId, event, payload, eventId }));
  } else {
    dispatchToUserLocal(userId, event, payload, eventId);
  }
}

function broadcast(event, payload) {
  const eventId = uuidv4();
  if (redisPub) {
    redisPub.publish('silverstar:events', JSON.stringify({ broadcast: true, event, payload, eventId }));
  } else {
    broadcastLocal(event, payload, eventId);
  }
}

function getIO() {
  return wss !== null;
}

function fetchSockets() {
  if (!wss) return [];
  return Array.from(wss.clients).map(ws => ({
    id: ws.id,
    userId: ws.userId,
    role: ws.role,
    rooms: Array.from(ws.rooms)
  }));
}

async function getMetrics() {
  return {
    totalConnections,
    activeConnections: wss ? wss.clients.size : 0,
    rooms: roomSockets.size,
    totalMessages,
    redisEnabled: !!redisPub
  };
}

module.exports = {
  initSocket,
  dispatchToRoom,
  dispatchToUser,
  broadcast,
  getIO,
  getMetrics,
  fetchSockets
};

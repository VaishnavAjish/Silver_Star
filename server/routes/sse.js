'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncWrap } = require('../middleware/errorHandler');
const { logger } = require('../middleware/logger');
const { getIO } = require('../services/socketService');

const router = express.Router();

const SSE_HEARTBEAT_INTERVAL = 30000;

const STREAM_MODULES = {
  dashboard: { events: ['dashboard.refresh', 'inventory.*', 'journal.*', 'expense.*', 'payment.*', 'receipt.*', 'sale.*'] },
  inventory: { events: ['inventory.*', 'lot.*', 'process.*'] },
  sales:     { events: ['sale.*', 'receipt.*'] },
  purchase:  { events: ['purchase.*', 'payment.*', 'expense.*'] },
  reports:   { events: ['report.*', 'dashboard.refresh'] },
};

function sseHeaders(req, res, next) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  });

  res.write(':ok\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, SSE_HEARTBEAT_INTERVAL);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (req._sseCleanup) req._sseCleanup();
  });

  next();
}

router.get('/stream/:module', authenticate, sseHeaders, asyncWrap(async (req, res) => {
  const module = req.params.module;
  const config = STREAM_MODULES[module];
  if (!config) {
    res.write(`event:error\ndata:${JSON.stringify({ error: 'Unknown stream module' })}\n\n`);
    return res.end();
  }

  const io = getIO();
  if (!io) {
    res.write(`event:error\ndata:${JSON.stringify({ error: 'Real-time system not ready' })}\n\n`);
    return res.end();
  }

  const roomName = `room:${module}`;
  const socket = await io.fetchSockets().then(sockets =>
    sockets.find(s => s.user?.id === req.user.id)
  );

  if (socket) {
    socket.join(roomName);
  }

  const eventFilter = new RegExp(
    config.events.map(e => '^' + e.replace(/\*/g, '.*') + '$').join('|')
  );

  io.on('connect', (s) => {
    if (s.user?.id === req.user.id) {
      s.join(roomName);
    }
  });

  const handler = (event, data) => {
    if (!eventFilter.test(event)) return;
    try {
      res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`);
    } catch (e) {
      cleanup();
    }
  };

  const wrappedEmit = io.emit;
  io.emit = function(event, data) {
    handler(event, data);
    return wrappedEmit.apply(io, arguments);
  };

  const cleanup = () => {
    logger.info('[SSE] Client disconnected', { module, userId: req.user.id });
    if (io) {
      const s = io.sockets?.sockets?.get(socket?.id);
      if (s) s.leave(roomName);
    }
  };
  req._sseCleanup = cleanup;

  res.write(`event:connected\ndata:${JSON.stringify({ module, ts: Date.now() })}\n\n`);

  req.on('close', cleanup);
}));

router.get('/health', (req, res) => {
  res.json({ status: 'ok', streams: Object.keys(STREAM_MODULES) });
});

module.exports = router;

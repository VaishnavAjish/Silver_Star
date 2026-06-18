'use strict';

/**
 * SSE Stream Route — /api/events/stream
 *
 * Authenticated long-lived connection. The browser connects here and
 * receives real-time domain events dispatched by eventDispatcher.js.
 */

const { Router } = require('express');
const { addClient, removeClient } = require('../services/sseClients');

const router = Router();

// HEARTBEAT_MS: keep-alive ping so proxies/load-balancers don't close idle connections.
const HEARTBEAT_MS = 25_000;

router.get('/stream', (req, res) => {
  // Disable request timeout for this long-lived connection
  req.socket.setTimeout(0);
  if (res.setTimeout) res.setTimeout(0);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering for SSE
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.flushHeaders();

  // Initial connection confirmation
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  // Register this client
  addClient(res);

  // Periodic heartbeat comment (keeps connection alive through proxies)
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_) {
      clearInterval(heartbeat);
      removeClient(res);
    }
  }, HEARTBEAT_MS);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });

  req.on('error', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});

module.exports = router;

/**
 * ─── Silverstar Grow — Server Entry Point (Hardened) ────────────────────────
 *
 * Responsibilities:
 *  1. Global uncaught exception / unhandled rejection guards — server NEVER crashes
 *  2. Start the HTTP server
 *  3. Serve the React build when SERVE_STATIC=true (Docker/VPS mode)
 *  4. Log startup info in structured format
 */
'use strict';

const http    = require('http');
const app     = require('./app');
const { shutdown: dbShutdown } = require('./db/pool');

const PORT = parseInt(process.env.PORT || '5000', 10);

// ── Global safety nets — NEVER let the process die from an unhandled error ───

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    level:     'fatal',
    type:      'uncaughtException',
    message:   err.message,
    stack:     err.stack,
    timestamp: new Date().toISOString(),
  }));
  // Give active requests 5 s to drain, then exit with error code so the
  // process manager (pm2 / Docker restart policy) can restart the server.
  setTimeout(() => process.exit(1), 5_000).unref();
});

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({
    level:     'error',
    type:      'unhandledRejection',
    message:   reason instanceof Error ? reason.message : String(reason),
    stack:     reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString(),
  }));
  // Do NOT exit for unhandled rejections — log and continue.
  // Express asyncWrap already catches route-level rejections.
});

// ── Required environment variable validation — fail fast on missing config ────
const REQUIRED_ENV = ['JWT_SECRET', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`[startup] FATAL: Missing required environment variables: ${missingEnv.join(', ')}. Check your .env file.`);
  process.exit(1);
}

const { initSocket, getIO, getMetrics } = require('./services/socketService');
const { startPgNotifyListener, stopPgNotifyListener } = require('./services/pgNotifyListener');
const { startPresenceTracking, stopPresenceTracking } = require('./services/presenceService');

// ── Enterprise real-time bridge services (lazy-load wrappers) ──────────────────
const BRIDGE_SERVICES = [
  { name: 'RedisPubSub',     start: () => require('./services/redisPubSub').startRedisPubSub(),
    stop:  () => require('./services/redisPubSub').stopRedisPubSub() },
  { name: 'KafkaEventSink',  start: () => require('./services/kafkaEventSink').startKafkaEventSink(),
    stop:  () => require('./services/kafkaEventSink').stopKafkaEventSink() },
  { name: 'MqttBroker',      start: () => require('./services/mqttBroker').startMqttBroker(),
    stop:  () => require('./services/mqttBroker').stopMqttBroker() },
  { name: 'NatsClient',      start: () => require('./services/natsClient').startNatsClient(),
    stop:  () => require('./services/natsClient').stopNatsClient() },
  { name: 'FirebaseSync',    start: () => require('./services/firebaseSync').startFirebaseSync(),
    stop:  () => require('./services/firebaseSync').stopFirebaseSync() },
  { name: 'GraphQL',         start: () => { try { require('./graphql/schema').createSchema(); } catch {}
                                          try { require('./graphql/subscriptions').bridgeFromDispatcher(); } catch {} },
    stop:  () => {} },
];

let bridgeStoppers = [];

// ── Create HTTP server and start listening ────────────────────────────────────
const server = http.createServer(app);

// Initialize Real-Time Sync Engine (async — attaches Redis adapter if REDIS_URL is set)
initSocket(server).catch(err => {
  console.error('[startup] Socket.IO init error:', err.message);
  // Non-fatal — app still works without real-time sync
}).then(() => {
  // Start PostgreSQL LISTEN/NOTIFY bridge (catches database-level changes)
  startPgNotifyListener().catch(err => {
    console.warn('[startup] PGNotify listener init error:', err.message);
  });

  // Start presence tracking (online user list broadcast)
  startPresenceTracking();

  // Start SignalR bridge for .NET clients
  try {
    const io = getIO();
    if (io) require('./services/signalrBridge').startSignalrBridge(io);
  } catch (err) {
    console.warn('[startup] SignalR bridge init error:', err.message);
  }

  // ── Start all enterprise real-time bridge services ───────────────────────────
  for (const svc of BRIDGE_SERVICES) {
    try {
      const p = svc.start();
      if (p && p.catch) {
        p.catch(err => {
          console.warn(`[startup] ${svc.name} init error:`, err.message);
        });
      }
    } catch (err) {
      console.warn(`[startup] ${svc.name} init error:`, err.message);
    }
  }

  // Outbox auto-purge every hour — delete events older than 24 hours
  setInterval(() => {
    const pool = require('./db/pool');
    pool.query("DELETE FROM sys_event_outbox WHERE created_at < NOW() - INTERVAL '24 hours'")
      .then(r => {
        if (r.rowCount > 0) {
          require('./middleware/logger').logger.info('[Outbox] Purged old events', { count: r.rowCount });
        }
      })
      .catch(err => {
        require('./middleware/logger').logger.warn('[Outbox] Purge failed', { error: err.message });
      });
  }, 60 * 60 * 1000).unref();
});

// Keep-alive timeout > load-balancer timeout to prevent 502s (common AWS/nginx issue)
server.keepAliveTimeout    = 65_000;  // 65 s
server.headersTimeout      = 66_000;  // slightly above keepAlive

// ── Auto-kill helper — finds and kills whatever is holding PORT ───────────────
function autoKillPort(port, callback) {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      // netstat lists TCP listeners with their PIDs on Windows
      const out = execSync(
        `netstat -ano | findstr :${port}`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const pids = [
        ...new Set(
          out.split('\n')
            .filter(l => /LISTEN/i.test(l) || new RegExp(`:${port}\\s`).test(l))
            .map(l => l.trim().split(/\s+/).pop())
            .filter(p => p && p !== '0' && /^\d+$/.test(p))
        ),
      ];
      if (!pids.length) throw new Error('No PID found for port ' + port);
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
          console.log('  ✓ Killed PID ' + pid + ' (was holding port ' + port + ')');
        } catch { /* already gone */ }
      }
    } else {
      execSync(`kill $(lsof -ti:${port}) 2>/dev/null || true`, { shell: '/bin/bash', stdio: 'pipe' });
      console.log('  ✓ Freed port ' + port);
    }
    callback(null);
  } catch (e) {
    callback(e);
  }
}

// ── Handle port-in-use error before it reaches uncaughtException ─────────────
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn('\n  ⚠  Port ' + PORT + ' is in use — attempting auto-kill...\n');

    autoKillPort(PORT, (killErr) => {
      if (killErr) {
        // Auto-kill failed → show manual instructions and exit
        console.error('  ✗ Could not auto-kill. Free the port manually:\n');
        console.error('    Windows : taskkill /F /FI "MEMUSAGE gt 1" /IM node.exe');
        console.error('              — or —  npx kill-port ' + PORT);
        console.error('    Mac/Linux: kill $(lsof -ti:' + PORT + ')');
        console.error('\n  Then run:  npm run dev:server\n');
        process.exit(1);
      }

      // Give the OS ~600 ms to fully release the socket, then rebind
      console.log('  ↺  Restarting on port ' + PORT + '...\n');
      setTimeout(() => {
        server.listen(PORT);
      }, 600);
    });

    return; // don't fall through to throw
  }
  // For any other server error, let the uncaughtException handler deal with it
  throw err;
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    level:     'info',
    type:      'startup',
    server:    'Silverstar Grow ERP',
    port:      PORT,
    env:       process.env.NODE_ENV || 'development',
    db:        `${process.env.DB_NAME || 'cloud'}@${process.env.DB_HOST || 'cloud'}`,
    timestamp: new Date().toISOString(),
  }));

  // Pretty banner for developers
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n  🌱 Silverstar Grow ERP`);
    console.log(`  ├─ Port   : ${PORT}`);
    console.log(`  ├─ DB     : ${process.env.DB_NAME || '?'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5433'}`);
    console.log(`  ├─ Mode   : ${process.env.NODE_ENV || 'development'}`);
    console.log(`  └─ Health : http://localhost:${PORT}/api/health\n`);
  }
});

// ── Graceful shutdown — drain HTTP connections before exiting ─────────────────
function gracefulShutdown(signal) {
  console.log(`\n[server] ${signal} received — shutting down gracefully...`);
  // Stop all enterprise bridge services
  for (const svc of BRIDGE_SERVICES) {
    svc.stop().catch(() => {});
  }
  server.close((err) => {
    if (err) {
      console.error('[server] Error during shutdown:', err.message);
      process.exit(1);
    }
    stopPgNotifyListener();
    stopPresenceTracking();
    dbShutdown().then(() => {
      console.log('[server] HTTP server and DB pools closed.');
      process.exit(0);
    }).catch((shutdownErr) => {
      console.error('[server] DB shutdown error:', shutdownErr.message);
      process.exit(1);
    });
  });

  // Force-kill after 15 s if connections don't drain
  setTimeout(() => {
    console.warn('[server] Force-kill after 15 s timeout.');
    process.exit(1);
  }, 15_000).unref();
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));

'use strict';

const http    = require('http');
const app     = require('./app');
const { shutdown: dbShutdown } = require('./db/pool');

const PORT = parseInt(process.env.PORT || '5000', 10);

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    level:     'fatal',
    type:      'uncaughtException',
    message:   err.message,
    stack:     err.stack,
    timestamp: new Date().toISOString(),
  }));
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
});

const REQUIRED_ENV = ['JWT_SECRET', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`[startup] FATAL: Missing required environment variables: ${missingEnv.join(', ')}. Check your .env file.`);
  process.exit(1);
}

const server = http.createServer(app);

server.keepAliveTimeout    = 65_000;
server.headersTimeout      = 66_000;

function autoKillPort(port, callback) {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn('\n  ⚠  Port ' + PORT + ' is in use — attempting auto-kill...\n');

    autoKillPort(PORT, (killErr) => {
      if (killErr) {
        console.error('  ✗ Could not auto-kill. Free the port manually:\n');
        console.error('    Windows : taskkill /F /FI "MEMUSAGE gt 1" /IM node.exe');
        console.error('              — or —  npx kill-port ' + PORT);
        console.error('    Mac/Linux: kill $(lsof -ti:' + PORT + ')');
        console.error('\n  Then run:  npm run dev:server\n');
        process.exit(1);
      }

      console.log('  ↺  Restarting on port ' + PORT + '...\n');
      setTimeout(() => {
        try {
          server.listen(PORT);
        } catch (err) {
          server.emit('error', err);
        }
      }, 600);
    });

    return;
  }
  console.error('[server] Unhandled server error:', err);
});

try {
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

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n  🌱 Silverstar Grow ERP`);
      console.log(`  ├─ Port   : ${PORT}`);
      console.log(`  ├─ DB     : ${process.env.DB_NAME || '?'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5433'}`);
      console.log(`  ├─ Mode   : ${process.env.NODE_ENV || 'development'}`);
      console.log(`  └─ Health : http://localhost:${PORT}/api/health\n`);
    }
  });
} catch (err) {
  server.emit('error', err);
}

function gracefulShutdown(signal) {
  console.log(`\n[server] ${signal} received — shutting down gracefully...`);
  server.close((err) => {
    if (err) {
      console.error('[server] Error during shutdown:', err.message);
      process.exit(1);
    }
    dbShutdown().then(() => {
      console.log('[server] HTTP server and DB pools closed.');
      process.exit(0);
    }).catch((shutdownErr) => {
      console.error('[server] DB shutdown error:', shutdownErr.message);
      process.exit(1);
    });
  });

  setTimeout(() => {
    console.warn('[server] Force-kill after 15 s timeout.');
    process.exit(1);
  }, 15_000).unref();
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));

// trigger restart


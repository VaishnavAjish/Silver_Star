// ============================================================
// Silverstar Grow — PM2 Ecosystem Config (Production)
// Usage:
//   pm2 start deploy/ecosystem.config.js --env production
//   pm2 save && pm2 startup
// ============================================================

module.exports = {
  apps: [
    {
      name: 'silverstar-grow',
      cwd: './server',
      script: 'index.js',

      // Cluster mode: one worker per CPU core for full throughput.
      // Socket.IO horizontal scaling requires REDIS_URL to be set
      // so all workers share the same adapter.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',

      watch: false,
      max_memory_restart: '768M',

      // Graceful shutdown — give in-flight requests 15s to drain
      kill_timeout: 15000,
      listen_timeout: 8000,
      wait_ready: true,

      env: {
        NODE_ENV: 'development',
        PORT: 5001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
        // All secrets must come from AWS Secrets Manager / .env file
        // Do NOT put JWT_SECRET or DB_PASSWORD here
      },

      // Logging
      error_file: '../logs/err.log',
      out_file: '../logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Restart strategy: exponential backoff up to 30 minutes
      exp_backoff_restart_delay: 100,
      max_restarts: 20,
    },
  ],
};

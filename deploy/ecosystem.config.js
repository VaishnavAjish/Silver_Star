// ============================================
// Silverstar Grow — PM2 Ecosystem Config
// Usage:
//   pm2 start deploy/ecosystem.config.js --env production
//   pm2 save
//   pm2 startup    # enable on boot
// ============================================

module.exports = {
  apps: [
    {
      name: 'silverstar-grow',
      cwd: './server',
      script: 'index.js',
      instances: 1,                // set to 'max' for cluster mode
      exec_mode: 'fork',           // or 'cluster'
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};

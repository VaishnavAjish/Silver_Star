const dotenv = require('dotenv');

// Ensure environment variables are loaded
dotenv.config();

/**
 * Fail fast: crash the server at startup if a required secret is missing.
 * This prevents the server from running with an insecure known fallback value.
 */
function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    console.error(`\nFATAL ERROR: Required environment variable "${key}" is not set.`);
    console.error('Set it in server/.env and restart the server.\n');
    process.exit(1);
  }
  return val;
}

/**
 * Enterprise Security Configuration
 * Centralized settings for hashing, tokens, MFA, and headers
 */

module.exports = {
  // Argon2id Hashing Parameters (OWASP recommended defaults for 2026)
  argon2: {
    type: 2, // argon2.argon2id
    memoryCost: 65536, // 64 MB (2^16)
    timeCost: 3, // 3 iterations
    parallelism: 4, // 4 threads
    hashLength: 32 // 32 bytes (256 bits)
  },

  // JWT Configuration
  // SECURITY: Both secrets MUST be set via environment variables.
  // The server will refuse to start if either is missing.
  jwt: {
    accessSecret:    requireEnv('JWT_SECRET'),
    refreshSecret:   requireEnv('JWT_REFRESH_SECRET'),
    accessExpiresIn: '8h',  // 8-hour access token (ERP workday)
    refreshExpiresIn: '7d', // 7-day refresh token
    issuer: 'silverstar-grow-auth',
    audience: 'silverstar-grow-client'
  },

  // Cookie Settings for Refresh Tokens
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // true in production
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  },

  // Multi-Factor Authentication (TOTP)
  mfa: {
    issuer: process.env.MFA_ISSUER || 'Silverstar Grow ERP',
    algorithm: 'sha1',
    digits: 6,
    step: 30
  },

  // Helmet Content-Security-Policy (CSP) Directives
  // connectSrc must include ws:// and wss:// for Socket.IO WebSocket upgrades
  cspDirectives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'", "data:"],
    // Allow same-origin WebSocket + any origins declared in CORS_ORIGIN env var
    connectSrc: [
      "'self'",
      "ws://localhost:5000",
      "wss://localhost:5000",
      ...(process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim().replace(/^http/, 'ws'))
        : []),
    ],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
    reportUri: ['/api/csp-report'],
  }
};

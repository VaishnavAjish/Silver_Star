const express = require('express');
const bcrypt = require('bcryptjs');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const otplib = require('otplib');
const qrcode = require('qrcode');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncWrap } = require('../middleware/errorHandler');
const securityConfig = require('../config/security');
const { logger } = require('../middleware/logger');
const { encryptMFASecret, decryptMFASecret, isEncrypted } = require('../utils/mfaEncryption');
const { dispatchEvent } = require('../services/eventDispatcher');

const router = express.Router();

/**
 * Utility: Generate tokens, store refresh token hash, and set cookies
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const issueTokens = async (res, user) => {
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role, fullName: user.full_name },
    securityConfig.jwt.accessSecret,
    { expiresIn: securityConfig.jwt.accessExpiresIn, issuer: securityConfig.jwt.issuer }
  );

  const refreshToken = jwt.sign(
    { id: user.id, tokenVersion: 1 },
    securityConfig.jwt.refreshSecret,
    { expiresIn: securityConfig.jwt.refreshExpiresIn, issuer: securityConfig.jwt.issuer }
  );

  // Store refresh token hash in database for reuse detection
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO NOTHING',
    [user.id, tokenHash, expiresAt]
  );

  // Set HTTP-Only Cookie for Refresh Token
  res.cookie('refreshToken', refreshToken, securityConfig.cookie);

  return accessToken;
};

// POST /api/auth/login
router.post('/login', asyncWrap(async (req, res) => {
  const { username, password, mfaToken } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Check for account lockout due to failed attempts
  const lockoutCheck = await pool.query(
    `SELECT COUNT(*) as failed_count, MAX(created_at) as last_attempt
     FROM login_attempts
     WHERE username = $1 AND ip_address = $2 AND success = false
       AND created_at > NOW() - INTERVAL '5 minutes'`,
    [username.toLowerCase(), ip]
  );

  const failedCount = parseInt(lockoutCheck.rows[0]?.failed_count || '0');
  if (failedCount >= 5) {
    const lastAttempt = lockoutCheck.rows[0]?.last_attempt;
    const lockoutUntil = new Date(new Date(lastAttempt).getTime() + 5 * 60 * 1000);
    logger.warn('[Auth] Account locked due to failed attempts', { username, ip, failedCount });
    return res.status(429).json({ 
      error: 'Too many failed attempts. Account locked for 5 minutes.',
      lockoutUntil: lockoutUntil.toISOString()
    });
  }

  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active = true', [username]
  );

  if (result.rows.length === 0) {
    // Record failed attempt for non-existent user (but don't reveal user existence)
    await pool.query(
      'INSERT INTO login_attempts (username, ip_address, success) VALUES ($1, $2, false)',
      [username.toLowerCase(), ip]
    );
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = result.rows[0];
  let valid = false;
  let needsUpgrade = false;

  // 1. Verify Password — Argon2id (current), bcrypt (legacy upgrade path)
  if (user.password_hash.startsWith('$argon2')) {
    valid = await argon2.verify(user.password_hash, password);
  } else if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')) {
    // Legacy bcrypt — silently upgrade to Argon2id on next successful login
    valid = await bcrypt.compare(password, user.password_hash);
    if (valid) needsUpgrade = true;
  }
  // NOTE: No hardcoded fallback credentials. All accounts must have a proper hash.

  if (!valid) {
    // Record failed attempt
    await pool.query(
      'INSERT INTO login_attempts (username, ip_address, success) VALUES ($1, $2, false)',
      [username.toLowerCase(), ip]
    );
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 2. Perform Silent Upgrade to Argon2id
  if (needsUpgrade) {
    const newHash = await argon2.hash(password, securityConfig.argon2);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
  }

  // 3. Verify MFA if enabled
  if (user.mfa_enabled) {
    if (!mfaToken) {
      return res.status(403).json({ error: 'MFA token required', mfaRequired: true });
    }
    // Decrypt MFA secret if stored encrypted
    const mfaSecret = user.mfa_secret_encrypted && isEncrypted(user.mfa_secret_encrypted)
      ? decryptMFASecret(user.mfa_secret_encrypted)
      : user.mfa_secret;
    const isValidMFA = otplib.authenticator.check(mfaToken, mfaSecret);
    if (!isValidMFA) {
      // Record failed MFA attempt
      await pool.query(
        'INSERT INTO login_attempts (username, ip_address, success) VALUES ($1, $2, false)',
        [username.toLowerCase(), ip]
      );
      return res.status(401).json({ error: 'Invalid MFA token' });
    }
  }

  // 4. Update last login
  await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  // 5. Record successful login (clears failed attempts)
  await pool.query(
    'INSERT INTO login_attempts (username, ip_address, success) VALUES ($1, $2, true)',
    [username.toLowerCase(), ip]
  );

  // 6. Issue Tokens
  const token = await issueTokens(res, user);

  dispatchEvent('user.login', { id: user.id, username: user.username, role: user.role, module: 'auth' });

  res.json({
    token,
    user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role, email: user.email, mfaEnabled: user.mfa_enabled }
  });
}));

// POST /api/auth/mfa/setup
router.post('/mfa/setup', authenticate, asyncWrap(async (req, res) => {
  const user = req.user;
  
  // Check if MFA is already enabled
  const result = await pool.query('SELECT mfa_enabled FROM users WHERE id = $1', [user.id]);
  if (result.rows[0].mfa_enabled) {
    return res.status(400).json({ error: 'MFA is already enabled' });
  }

  const secret = otplib.authenticator.generateSecret();
  const otpauth = otplib.authenticator.keyuri(user.username, securityConfig.mfa.issuer, secret);
  const encryptedSecret = encryptMFASecret(secret);
  
  // Store encrypted secret
  await pool.query('UPDATE users SET mfa_secret = NULL, mfa_secret_encrypted = $1 WHERE id = $2', [encryptedSecret, user.id]);
  
  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  
  res.json({ secret, qrCodeUrl });
}));

// POST /api/auth/mfa/verify
router.post('/mfa/verify', authenticate, asyncWrap(async (req, res) => {
  const { token } = req.body;
  const user = req.user;
  
  const result = await pool.query('SELECT mfa_secret, mfa_secret_encrypted FROM users WHERE id = $1', [user.id]);
  const row = result.rows[0];
  // Use encrypted secret if available, otherwise fall back to plaintext
  const secret = row.mfa_secret_encrypted && isEncrypted(row.mfa_secret_encrypted)
    ? decryptMFASecret(row.mfa_secret_encrypted)
    : row.mfa_secret;

  if (!secret) return res.status(400).json({ error: 'MFA setup not initiated' });

  const isValid = otplib.authenticator.check(token, secret);
  
  if (isValid) {
    await pool.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [user.id]);
    res.json({ message: 'MFA enabled successfully' });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
}));

// POST /api/auth/refresh
router.post('/refresh', asyncWrap(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

  try {
    const decoded = jwt.verify(refreshToken, securityConfig.jwt.refreshSecret);
    const tokenHash = hashToken(refreshToken);
    
    // Check for token reuse - if token was already used, it's a potential attack
    const tokenCheck = await pool.query(
      'SELECT id, used_at FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    
    if (tokenCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }
    
    const storedToken = tokenCheck.rows[0];
    if (storedToken.used_at) {
      // Token reuse detected! Revoke all tokens for this user
      await pool.query('UPDATE refresh_tokens SET used_at = NOW() WHERE user_id = $1', [decoded.id]);
      logger.warn('[Auth] Refresh token reuse detected - all tokens revoked', { userId: decoded.id });
      return res.status(403).json({ error: 'Token reuse detected - please log in again' });
    }
    
    // Mark token as used
    await pool.query('UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1', [storedToken.id]);
    
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    if (result.rows.length === 0) throw new Error('User not found');
    
    const user = result.rows[0];
    const token = await issueTokens(res, user); // Rotate both tokens
    
    res.json({ token });
  } catch (err) {
    logger.error('[Auth] Refresh error:', { error: err.message, stack: err.stack });
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
}));

// POST /api/auth/logout
// NOTE: clearCookie must NOT receive maxAge/expires — those would override the
// "set expiry to epoch" that clearCookie uses internally, preventing deletion.
router.post('/logout', asyncWrap(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await pool.query('UPDATE refresh_tokens SET used_at = NOW() WHERE token_hash = $1', [tokenHash]);
  }
  const { maxAge: _maxAge, expires: _expires, ...clearOpts } = securityConfig.cookie;
  res.clearCookie('refreshToken', clearOpts);
  dispatchEvent('user.logout', { module: 'auth' });
  res.json({ message: 'Logged out successfully' });
}));

// GET /api/auth/me
router.get('/me', authenticate, asyncWrap(async (req, res) => {
  const [userR, permsR, prefsR, rolesR, rbacPermsR] = await Promise.all([
    pool.query(
      'SELECT id, username, email, full_name, role, last_login, mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    ).catch(err => { throw err; }),
    pool.query(
      'SELECT module, permission_key, allowed FROM user_permissions WHERE user_id=$1',
      [req.user.id]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT pref_key, pref_value FROM user_preferences WHERE user_id=$1',
      [req.user.id]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT r.id, r.name, r.slug FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND r.is_active = TRUE`,
      [req.user.id]
    ).catch(() => ({ rows: [] })),
    // Resolved RBAC bitmask per module+submodule (BIT_OR across all assigned roles)
    pool.query(
      `SELECT rp.module, rp.submodule, BIT_OR(rp.permissions)::int AS mask
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1
       GROUP BY rp.module, rp.submodule`,
      [req.user.id]
    ).catch(() => ({ rows: [] })),
  ]);

  if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const dbUser = userR.rows[0];

  // If the DB role differs from the JWT role (e.g. role was changed after login),
  // issue a fresh access token so subsequent API calls use the correct role.
  let freshToken;
  if (dbUser.role !== req.user.role) {
    freshToken = jwt.sign(
      { id: dbUser.id, username: dbUser.username, role: dbUser.role, fullName: dbUser.full_name },
      securityConfig.jwt.accessSecret,
      { expiresIn: securityConfig.jwt.accessExpiresIn, issuer: securityConfig.jwt.issuer }
    );
  }

  res.json({
    ...dbUser,
    permissions: permsR.rows,
    preferences: prefsR.rows,
    rbac_roles: rolesR.rows,
    rbac_permissions: rbacPermsR.rows,
    ...(freshToken ? { token: freshToken } : {}),
  });
}));

// POST /api/auth/register (admin only)
router.post('/register', authenticate, authorize('admin'), asyncWrap(async (req, res) => {
  const { username, email, password, fullName, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  // Use Argon2id for new registrations
  const hash = await argon2.hash(password, securityConfig.argon2);
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, full_name, role`,
    [username, email || null, hash, fullName || username, role || 'operator']
  );
  dispatchEvent('user.registered', { id: result.rows[0].id, username: result.rows[0].username, role: result.rows[0].role, module: 'auth' });
  res.status(201).json(result.rows[0]);
}));

// GET /api/auth/users (admin only)
router.get('/users', authenticate, authorize('admin'), asyncWrap(async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const pageSize = Math.min(parseInt(limit), 500);
  const pageOffset = parseInt(offset);
  const [dataR, countR] = await Promise.all([
    pool.query(
      'SELECT id, username, email, full_name, role, is_active, last_login, created_at, mfa_enabled FROM users ORDER BY id LIMIT $1 OFFSET $2',
      [pageSize, pageOffset]
    ),
    pool.query('SELECT COUNT(*) FROM users'),
  ]);
  res.json({ data: dataR.rows, total: parseInt(countR.rows[0].count) });
}));

module.exports = router;
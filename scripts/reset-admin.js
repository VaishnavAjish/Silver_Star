/* eslint-disable no-console */
// ============================================================
// Admin login repair / diagnostic (Phase: ops)
// ------------------------------------------------------------
// Usage (from project root):
//   node scripts/reset-admin.js              # diagnose + reset admin -> admin123
//   node scripts/reset-admin.js MyNewPass    # diagnose + reset admin -> MyNewPass
//
// Uses the SAME DB connection (server/.env) and the SAME Argon2id
// parameters the login route uses, so the resulting credential is
// guaranteed to verify against /api/auth/login.
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const argon2 = require('argon2');
const { Pool } = require('pg');
const security = require('../server/config/security');

const USERNAME = 'admin';
const NEW_PASSWORD = process.argv[2] || 'admin123';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    console.log(`\n[reset-admin] DB ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

    // 1. Diagnose current state
    const { rows } = await pool.query(
      `SELECT id, username, role, is_active, mfa_enabled,
              LEFT(password_hash, 7) AS hash_kind, last_login
         FROM users WHERE username = $1`,
      [USERNAME]
    );

    if (rows.length === 0) {
      console.log(`[diagnose] No '${USERNAME}' user exists. Creating one...`);
      const hash = await argon2.hash(NEW_PASSWORD, security.argon2);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active, mfa_enabled)
         VALUES ($1, $2, $3, $4, $5, true, false)`,
        [USERNAME, 'admin@silverstar.in', hash, 'System Administrator', 'super_admin']
      );
      console.log(`[fix] Created '${USERNAME}' (role=super_admin, active=true, mfa=off).`);
    } else {
      const u = rows[0];
      console.log('[diagnose] Found user:', {
        id: u.id, role: u.role, is_active: u.is_active,
        mfa_enabled: u.mfa_enabled, hash_kind: u.hash_kind,
        last_login: u.last_login,
      });

      const hash = await argon2.hash(NEW_PASSWORD, security.argon2);
      await pool.query(
        `UPDATE users
            SET password_hash = $1,
                is_active     = true,
                mfa_enabled   = false,
                mfa_secret    = NULL
          WHERE username = $2`,
        [hash, USERNAME]
      );
      console.log(`[fix] Reset password, set is_active=true, mfa_enabled=false for '${USERNAME}'.`);
    }

    // 2. Self-verify: re-read and confirm the new hash verifies
    const check = await pool.query(
      `SELECT password_hash, role, is_active, mfa_enabled FROM users WHERE username = $1`,
      [USERNAME]
    );
    const ok = await argon2.verify(check.rows[0].password_hash, NEW_PASSWORD);

    console.log('\n========================================');
    console.log(' LOGIN SHOULD NOW WORK');
    console.log('   Username:', USERNAME);
    console.log('   Password:', NEW_PASSWORD);
    console.log('   Role    :', check.rows[0].role);
    console.log('   Active  :', check.rows[0].is_active, '| MFA:', check.rows[0].mfa_enabled);
    console.log('   Verify  :', ok ? 'PASS ✔' : 'FAIL �’ (something is wrong)');
    console.log('========================================\n');

    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('\n[reset-admin] ERROR:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error('  → Postgres not reachable. Is the DB running on the host/port in server/.env?');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
})();

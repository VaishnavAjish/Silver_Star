-- Phase 38: Login Attempt Tracking for Brute-Force Protection
-- Run order: after phase37-refresh-token-reuse.sql

BEGIN;

-- Track failed login attempts
CREATE TABLE IF NOT EXISTS login_attempts (
  id              SERIAL       PRIMARY KEY,
  username        VARCHAR(50)  NOT NULL,
  ip_address      INET         NOT NULL,
  success         BOOLEAN      NOT NULL DEFAULT FALSE,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by username + IP
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_ip
  ON login_attempts (username, ip_address, created_at DESC);

-- Index for cleanup of old records
CREATE INDEX IF NOT EXISTS idx_login_attempts_created
  ON login_attempts (created_at);

COMMIT;
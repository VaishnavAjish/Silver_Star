-- Phase 37: Refresh Token Reuse Detection
-- Run order: after phase36-fk-and-reversal.sql

BEGIN;

-- Create refresh_tokens table for tracking token usage and detecting reuse
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              SERIAL       PRIMARY KEY,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      VARCHAR(255) NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (token_hash)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires
  ON refresh_tokens (user_id, expires_at) WHERE used_at IS NULL;

-- Function to hash refresh token for storage
-- Uses the same secret as JWT verification for consistency
COMMIT;
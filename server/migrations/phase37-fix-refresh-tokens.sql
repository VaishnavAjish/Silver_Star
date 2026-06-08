-- Fix refresh_tokens schema to match auth.js expectations
BEGIN;

-- Add columns needed by auth.js
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- Drop old incompatible columns
ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS token_family,
  DROP COLUMN IF EXISTS revoked;

-- Add unique constraint on token_hash
DROP INDEX IF EXISTS refresh_tokens_token_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_key
  ON refresh_tokens (token_hash);

-- Add index used by auth queries
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires
  ON refresh_tokens (user_id, expires_at) WHERE used_at IS NULL;

COMMIT;

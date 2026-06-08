-- Phase 40: Encrypt MFA Secrets
-- Run order: after phase39-stock-reservation.sql

BEGIN;

-- Add encryption key column (stored separately from data in production)
-- For now we'll use a deterministic encryption with a key from env
-- In production, use pgcrypto with a key management service

-- Add column to store encrypted MFA secret
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mfa_encryption_version SMALLINT DEFAULT 1;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_mfa_encrypted ON users (mfa_secret_encrypted) WHERE mfa_secret_encrypted IS NOT NULL;

COMMIT;
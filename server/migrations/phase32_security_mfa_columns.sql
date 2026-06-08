-- ============================================================
-- SILVERSTAR GROW — Security & MFA Migration
-- Adds MFA secret and enabled flags, and JWT token rotation tracking.
-- ============================================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64),
ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;

-- Optional: If we want to track issued refresh tokens for revocation
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_family UUID NOT NULL, -- For detecting reuse
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

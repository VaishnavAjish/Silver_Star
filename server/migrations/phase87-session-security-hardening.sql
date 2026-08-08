-- ============================================================================
-- SILVERSTAR GROW — RBAC Brick 7
-- Phase 87: Session security hardening (ADDITIVE ONLY)
--
-- WHY THIS MIGRATION EXISTS
--   `authenticate()` in server/middleware/auth.js verifies the access token with
--   `jwt.verify` and nothing else — no database read of any kind. Access tokens
--   live for 8 hours (server/config/security.js `accessExpiresIn: '8h'`).
--   Therefore revoking a REFRESH token cannot invalidate an already-issued
--   ACCESS token: the holder keeps their old authority for up to 8 hours no
--   matter what an administrator changes.
--
--   Adding `refresh_tokens.revoked_at` ALONE would not fix that. It is added
--   here because it is genuinely missing (logout and reuse-detection currently
--   overload `used_at` to mean "revoked"), but the column that actually closes
--   the hole is `users.auth_version`.
--
-- THE MECHANISM
--   Access tokens gain an `av` claim carrying the user's auth_version at mint
--   time. `authenticate()` compares it to the stored value on every request. Any
--   security-sensitive change increments the stored value, so every token minted
--   before the change stops verifying immediately — server-side, with no
--   cooperation required from the client.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   It writes no role, no permission, no override, no scope and no preference
--   row. It changes no user's effective access. Every existing session keeps
--   working across the deployment: see the NULL/legacy notes below.
--
-- ROLLBACK: phase87-session-security-hardening.rollback.sql
-- ============================================================================

BEGIN;

-- ── users.auth_version ──────────────────────────────────────────────────────
--
-- LOCK/REWRITE CHARACTERISTICS — deliberately version-agnostic.
--   Adding a NULLABLE column with NO default is a catalog-only change on every
--   PostgreSQL version ever shipped: ACCESS EXCLUSIVE is taken but held only for
--   the catalog update, and NO table rewrite occurs regardless of table size.
--
--   The obvious alternative, `ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1`,
--   is also rewrite-free — but only on PostgreSQL 11 and newer, where the default
--   is stored in pg_attribute.attmissingval. On PostgreSQL 10 and older that form
--   rewrites the entire users table under ACCESS EXCLUSIVE. We do not depend on
--   the deployed server version being >= 11, so we take the form that is safe
--   everywhere and let application code treat NULL as version 1.
--
-- WHY NULL IS SAFE
--   COALESCE(auth_version, 1) is used everywhere in application code
--   (services/security/securityVersionService.js). A user who has never had a
--   security change reads as version 1 whether the column is NULL or 1, so
--   existing rows need no backfill and no batched UPDATE is required.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version INTEGER;

-- Metadata-only: applies to rows INSERTed from now on, never rewrites existing
-- rows. Kept separate from the ADD COLUMN above for exactly that reason.
ALTER TABLE users
  ALTER COLUMN auth_version SET DEFAULT 1;

COMMENT ON COLUMN users.auth_version IS
  'RBAC Brick 7 — monotonic security revision. Access tokens carry it as the av claim; authenticate() rejects any token whose av differs. NULL is read as 1. Incremented only by services/security/sessionInvalidationService.js.';

-- ── refresh_tokens.revoked_at / revoked_reason ──────────────────────────────
--
-- Both nullable with no default: catalog-only, no rewrite, any version.
--
-- WHY A SEPARATE COLUMN FROM used_at
--   `used_at` means "this token was consumed by a rotation". The refresh route
--   relies on that meaning to detect token REUSE (a second presentation of an
--   already-rotated token is treated as theft). Overloading `used_at` to also
--   mean "an administrator revoked this" — which is what logout does today —
--   makes an administrative revocation indistinguishable from a rotation, so a
--   revoked token's later presentation is reported as a stolen-token incident.
--   `revoked_at` keeps the two facts separate without changing either behaviour.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(64);

COMMENT ON COLUMN refresh_tokens.revoked_at IS
  'RBAC Brick 7 — set when a session is invalidated administratively. Distinct from used_at, which means consumed-by-rotation and drives reuse detection.';

-- ── Index for the revocation write path ─────────────────────────────────────
--
-- The only new query shape is:
--   UPDATE refresh_tokens SET revoked_at = NOW()
--    WHERE user_id = $1 AND revoked_at IS NULL AND used_at IS NULL
--
-- phase37 already created `idx_refresh_tokens_user_expires (user_id, expires_at)
-- WHERE used_at IS NULL`, which serves that predicate's leading column. This
-- partial index narrows it to live-and-unrevoked rows, which is the set the
-- revocation actually touches and which stays small as revoked rows accumulate.
--
-- BUILD IMPACT: a plain CREATE INDEX takes a SHARE lock, blocking writes to
-- refresh_tokens for the duration. refresh_tokens holds at most one row per
-- login per 7 days, so this is expected to be a sub-second build on a table of
-- thousands of rows, not millions. If this environment's refresh_tokens has
-- grown unexpectedly large, run the CONCURRENTLY variant documented in the
-- rollback file INSTEAD of this statement — CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block and therefore cannot live in this file.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
  ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL AND used_at IS NULL;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION (read-only — safe to run on production)
-- ============================================================================
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE (table_name = 'users' AND column_name = 'auth_version')
--     OR (table_name = 'refresh_tokens' AND column_name IN ('revoked_at','revoked_reason'))
--  ORDER BY table_name, column_name;
--
-- Expect exactly three rows, all is_nullable = YES, and users.auth_version with
-- column_default = 1.
--
-- Freeze proof — all four counts MUST be unchanged by this migration:
-- SELECT (SELECT COUNT(*) FROM role_permissions)            AS role_permissions,
--        (SELECT COUNT(*) FROM user_permission_overrides)   AS overrides,
--        (SELECT COUNT(*) FROM user_roles)                  AS user_roles,
--        (SELECT COUNT(*) FROM user_preferences)            AS preferences;
--
-- Nobody is logged out by this migration:
-- SELECT COUNT(*) AS still_live FROM refresh_tokens
--  WHERE revoked_at IS NULL AND used_at IS NULL AND expires_at > NOW();
-- ============================================================================

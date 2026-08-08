-- ============================================================================
-- SILVERSTAR GROW — RBAC Brick 7
-- Phase 87 ROLLBACK
--
-- READ THIS BEFORE RUNNING
--   Rolling back is only correct while the phase-87 BACKEND is NOT deployed.
--   The deployment order is: migration -> backend -> frontend. Reverse it:
--
--     1. roll the backend back to the pre-Brick-7 build
--     2. only then run this file
--
--   Running this file while the phase-87 backend is live makes every
--   authenticated request fail: authenticate() reads users.auth_version, and
--   dropping the column turns that read into a 42703 undefined_column, which the
--   middleware surfaces as 503 SECURITY_CHECK_UNAVAILABLE (fail-closed by
--   design — it will not silently grant access).
--
-- WHAT ROLLING BACK COSTS
--   Dropping users.auth_version discards the record of which sessions were
--   invalidated. Tokens that the phase-87 backend was rejecting become
--   acceptable again to the pre-phase-87 backend, because that build never
--   looked at the claim in the first place. If any session was invalidated for a
--   SECURITY reason (compromise, dismissal), revoke it by other means before
--   rolling back — set users.is_active = false, or expire the refresh rows —
--   because this rollback restores those tokens' usability for the remainder of
--   their 8-hour access-token lifetime.
--
--   Dropping refresh_tokens.revoked_at discards administrative revocation marks.
--   Revoked-but-not-yet-expired refresh tokens become usable again. The
--   pre-phase-87 logout path used `used_at`, which this file does not touch, so
--   ordinary logouts survive the rollback.
--
-- SAFETY: this file writes no role, permission, override, scope or preference
-- row, and deletes no user and no refresh token.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_refresh_tokens_active;

ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS revoked_reason;

ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS revoked_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS auth_version;

COMMIT;

-- ============================================================================
-- APPENDIX A — LARGE-TABLE INDEX VARIANT
-- ============================================================================
-- If refresh_tokens is unexpectedly large, build the index without blocking
-- writes. CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so
-- run these OUTSIDE any BEGIN, and INSTEAD of the CREATE INDEX in the UP file:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_active
--     ON refresh_tokens (user_id)
--     WHERE revoked_at IS NULL AND used_at IS NULL;
--
-- CONCURRENTLY can leave an INVALID index behind if it fails. Check and retry:
--
--   SELECT c.relname, i.indisvalid
--     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE c.relname = 'idx_refresh_tokens_active';
--
--   -- if indisvalid = false:
--   DROP INDEX CONCURRENTLY idx_refresh_tokens_active;   -- then re-create
--
-- ============================================================================
-- APPENDIX B — PARTIAL ROLLBACK (preferred over a full rollback)
-- ============================================================================
-- To stop enforcing session invalidation WITHOUT losing the columns or the
-- record of what was revoked, leave the schema in place and change the backend
-- environment flags instead:
--
--   AUTH_ENFORCE_TOKEN_VERSION=false     (suspend enforcement entirely)
--   AUTH_REJECT_LEGACY_TOKENS=false      (accept tokens minted before phase 87)
--
-- That is reversible in seconds, requires no DDL, and keeps the audit trail. A
-- schema rollback should be the last resort, not the first.
-- ============================================================================

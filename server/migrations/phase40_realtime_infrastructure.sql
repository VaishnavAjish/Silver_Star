-- ══════════════════════════════════════════════════════════════════════════════
-- Silverstar Grow ERP — Phase 40: Real-Time Sync Infrastructure
-- ══════════════════════════════════════════════════════════════════════════════
-- Run this migration ONCE before starting the server with real-time enabled.
-- Safe to run multiple times (all statements are idempotent).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Event Outbox Table ────────────────────────────────────────────────────────
-- Persists all dispatched events so clients that were offline can fetch
-- missed events upon reconnection.
-- Entries are auto-purged after 24 hours to prevent unbounded growth.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_event_outbox (
  id          BIGSERIAL PRIMARY KEY,
  topic       TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  dispatched  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient polling by disconnected clients
CREATE INDEX IF NOT EXISTS idx_event_outbox_created
  ON sys_event_outbox (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_outbox_topic
  ON sys_event_outbox (topic, created_at DESC);

-- Auto-purge: delete events older than 24 hours
-- Run via pg_cron or background job: DELETE FROM sys_event_outbox WHERE created_at < NOW() - INTERVAL '24 hours';
-- (Function removed from migration due to semicolon splitting issue in migration runner)

-- ── Add version columns for Optimistic Concurrency Control ────────────────────
-- These prevent concurrent edits from silently overwriting each other.
-- The backend MUST increment version on every UPDATE and check that
-- rowcount = 1 to detect conflicts.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE process_transactions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  'sys_event_outbox' AS table_name,
  COUNT(*) AS row_count
FROM sys_event_outbox
UNION ALL
SELECT 'inventory.version', COUNT(*) FROM information_schema.columns
  WHERE table_name = 'inventory' AND column_name = 'version'
UNION ALL
SELECT 'purchase_notes.version', COUNT(*) FROM information_schema.columns
  WHERE table_name = 'purchase_notes' AND column_name = 'version'
UNION ALL
SELECT 'invoices.version', COUNT(*) FROM information_schema.columns
  WHERE table_name = 'invoices' AND column_name = 'version';

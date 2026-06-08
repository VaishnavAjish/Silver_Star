-- Phase 28: Central Code Engine
-- Creates code_sequences table for unified entity/document numbering.
-- Replaces scattered nextval() calls with one application-layer engine
-- that supports row-level locking, period scoping, and user-override policy.
--
-- Run order: after phase27-status-consolidation.sql

BEGIN;

-- ── 1. code_sequences table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_sequences (
  id              SERIAL       PRIMARY KEY,
  entity_type     VARCHAR(50)  NOT NULL UNIQUE,
  prefix          VARCHAR(20)  NOT NULL,
  separator       CHAR(1)      NOT NULL DEFAULT '-',
  period_scope    VARCHAR(10)  NOT NULL DEFAULT 'none'
                  CHECK (period_scope IN ('none','year','month')),
  padding         INT          NOT NULL DEFAULT 6   CHECK (padding BETWEEN 0 AND 10),
  next_value      BIGINT       NOT NULL DEFAULT 1   CHECK (next_value >= 1),
  format_pattern  VARCHAR(100) NOT NULL DEFAULT 'PREFIX-SEQ'
                  CHECK (format_pattern IN ('PREFIX-SEQ','PREFIX-YYYYMM-SEQ','PREFIX-YYYY-SEQ')),
  editable_policy VARCHAR(20)  NOT NULL DEFAULT 'auto'
                  CHECK (editable_policy IN ('auto','user_override')),
  description     VARCHAR(200),
  active          BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 2. Seed entity profiles ───────────────────────────────────────────────────
-- 'user_override' = code is auto-generated if omitted, but user may supply their own
-- 'auto'          = code is always system-generated (no user input)
INSERT INTO code_sequences
  (entity_type,   prefix, separator, period_scope, padding, format_pattern,      editable_policy, description)
VALUES
  ('vendor',      'VND',  '-',       'none',        6,      'PREFIX-SEQ',         'user_override', 'Vendor master code'),
  ('customer',    'CUS',  '-',       'none',        6,      'PREFIX-SEQ',         'user_override', 'Customer master code'),
  ('fixed_asset', 'FA',   '-',       'month',       4,      'PREFIX-YYYYMM-SEQ',  'auto',          'Fixed asset code'),
  ('bank_deposit','BD',   '-',       'none',        6,      'PREFIX-SEQ',         'auto',          'Bank deposit document number')
ON CONFLICT (entity_type) DO NOTHING;

-- ── 3. Initialize fixed_asset next_value to continue from current fa_seq ──────
-- Respects is_called: if the sequence was never called, next = last_value (=1);
-- if it has been called, next = last_value + 1 (the true next slot).
UPDATE code_sequences
SET    next_value = (
         SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM fa_seq
       ),
       updated_at = NOW()
WHERE  entity_type = 'fixed_asset';

-- ── 4. Add doc_number column to bank_deposits ─────────────────────────────────
ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS doc_number VARCHAR(20);

COMMIT;

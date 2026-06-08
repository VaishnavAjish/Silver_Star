-- ============================================================
-- Code Sequences Seed Data
-- Provides auto-increment code generation for all entity types
-- that use reserveCode() in the application.
-- Safe to re-run (ON CONFLICT DO NOTHING).
-- ============================================================

INSERT INTO code_sequences (entity_type, prefix, separator, padding, next_value, format_pattern, description, active)
VALUES
  -- Vendors: VND-0001, VND-0002, ...
  ('vendor',       'VND', '-', 4, 1, 'PREFIX-SEQ',       'Auto-generated vendor codes',          true),

  -- Customers: CST-0001, CST-0002, ...
  ('customer',     'CST', '-', 4, 1, 'PREFIX-SEQ',       'Auto-generated customer codes',         true),

  -- Fixed Assets: FA-2026-0001, FA-2026-0002, ...
  ('fixed_asset',  'FA',  '-', 4, 1, 'PREFIX-YYYY-SEQ',  'Auto-generated fixed asset codes',      true),

  -- Bank Deposits: BD-202606-0001, BD-202606-0002, ...
  ('bank_deposit', 'BD',  '-', 4, 1, 'PREFIX-YYYYMM-SEQ','Auto-generated bank deposit numbers',   true)

ON CONFLICT (entity_type) DO NOTHING;

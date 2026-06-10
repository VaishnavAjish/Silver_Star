-- Phase 28 Validation Queries
-- Run after applying phase28-code-engine.sql migration.

-- ── A. code_sequences table exists with all expected profiles ─────────────────
SELECT entity_type, prefix, format_pattern, editable_policy, next_value, active
FROM   code_sequences
ORDER  BY entity_type;
-- Expected rows: vendor, customer, fixed_asset, bank_deposit

-- ── B. bank_deposits.doc_number column added ──────────────────────────────────
SELECT column_name, data_type, character_maximum_length
FROM   information_schema.columns
WHERE  table_name = 'bank_deposits' AND column_name = 'doc_number';
-- Expected: 1 row

-- ── C. fixed_asset next_value is synced from fa_seq ───────────────────────────
SELECT cs.entity_type, cs.next_value AS code_seq_next, seq.last_value AS fa_seq_last
FROM   code_sequences cs, fa_seq seq
WHERE  cs.entity_type = 'fixed_asset';
-- Expected: code_seq_next = fa_seq_last + 1  (no gap, no overlap)

-- ── D. Vendor auto-code format preview ────────────────────────────────────────
SELECT prefix, padding, format_pattern, next_value,
       prefix || '-' || lpad(next_value::text, padding, '0') AS preview_code
FROM   code_sequences
WHERE  entity_type = 'vendor';
-- Expected: preview_code = 'VND-000001' (if no vendors created yet)

-- ── E. Customer auto-code format preview ─────────────────────────────────────
SELECT prefix, padding, format_pattern, next_value,
       prefix || '-' || lpad(next_value::text, padding, '0') AS preview_code
FROM   code_sequences
WHERE  entity_type = 'customer';
-- Expected: preview_code = 'CUS-000001' (if no customers created yet)

-- ── F. Bank deposit auto-code format preview ──────────────────────────────────
SELECT prefix, padding, format_pattern, next_value,
       prefix || '-' || lpad(next_value::text, padding, '0') AS preview_code
FROM   code_sequences
WHERE  entity_type = 'bank_deposit';
-- Expected: preview_code = 'BD-000001'

-- ── G. Confirm no duplicate FA codes exist in fixed_assets ───────────────────
SELECT asset_code, COUNT(*) AS cnt
FROM   fixed_assets
GROUP  BY asset_code
HAVING COUNT(*) > 1;
-- Expected: 0 rows

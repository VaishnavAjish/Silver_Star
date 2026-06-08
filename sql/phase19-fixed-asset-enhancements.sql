-- ============================================================
-- SILVERSTAR GROW — Phase 19: Fixed Asset Register Enhancements
-- Adds physical/operational tracking columns to fixed_assets
-- Adds Vehicles asset category + GL account
-- ALL statements are idempotent — safe to re-run.
-- Does NOT modify any existing columns, JEs, or depreciation data.
-- ============================================================

-- ── Physical / Operational columns on fixed_assets ───────────────────────────
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS serial_no          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model_no           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS brand              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS manufacturer       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS qty                NUMERIC(10,2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uom_id             INTEGER REFERENCES uom(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_tag          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS condition          VARCHAR(20) DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS warranty_expiry    DATE,
  ADD COLUMN IF NOT EXISTS installation_date  DATE,
  ADD COLUMN IF NOT EXISTS custodian          VARCHAR(150);

-- Unique index on asset_tag for barcode/tag lookups (sparse — only non-null rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_asset_tag
  ON fixed_assets(asset_tag) WHERE asset_tag IS NOT NULL;

-- ── Vehicles GL account ───────────────────────────────────────────────────────
INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2011', 'Vehicles', 'asset',
       (SELECT id FROM accounts WHERE code = '2000'),
       'Vehicles and transport assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '2011');

-- ── Vehicles asset category ───────────────────────────────────────────────────
-- Only insert if both accounts exist (guard for fresh installs)
INSERT INTO fixed_asset_categories
  (code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
   gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id)
SELECT
  'FAC-VEH', 'Vehicles', 20.00, 'WDV', 5,
  (SELECT id FROM accounts WHERE code = '2011'),
  (SELECT id FROM accounts WHERE code = '2099'),
  (SELECT id FROM accounts WHERE code = '5009')
WHERE NOT EXISTS (SELECT 1 FROM fixed_asset_categories WHERE code = 'FAC-VEH')
  AND EXISTS (SELECT 1 FROM accounts WHERE code = '2011')
  AND EXISTS (SELECT 1 FROM accounts WHERE code = '2099')
  AND EXISTS (SELECT 1 FROM accounts WHERE code = '5009');

-- ── Verification query ────────────────────────────────────────────────────────
SELECT 'fixed_asset_categories' AS tbl, COUNT(*) AS rows FROM fixed_asset_categories
UNION ALL
SELECT 'fixed_assets columns added', COUNT(*) FROM information_schema.columns
  WHERE table_name = 'fixed_assets' AND column_name IN
    ('serial_no','model_no','brand','manufacturer','qty','uom_id',
     'asset_tag','condition','warranty_expiry','installation_date','custodian');

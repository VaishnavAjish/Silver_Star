-- ============================================================
-- SILVERSTAR GROW — Phase 20: Asset Template Master
-- Introduces a standardization layer:
--   Category → Template → Fixed Asset Register
-- ALL statements are idempotent — safe to re-run.
-- Does NOT modify any existing columns, JEs, depreciation data,
-- or accounting posting behaviour.
-- ============================================================

-- ── Asset Template Master table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_templates (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(30)  NOT NULL,
  name                 VARCHAR(200) NOT NULL,
  category_id          INTEGER      NOT NULL
                         REFERENCES fixed_asset_categories(id) ON DELETE RESTRICT,
  default_model_no     VARCHAR(100),
  default_brand        VARCHAR(100),
  default_manufacturer VARCHAR(150),
  default_uom_id       INTEGER REFERENCES uom(id) ON DELETE SET NULL,
  default_useful_life  NUMERIC(5,2),
  default_depr_rate    NUMERIC(6,2),
  description          TEXT,
  status               VARCHAR(20)  NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'inactive')),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unique code index
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_templates_code
  ON asset_templates (code);

-- Case-insensitive unique name (prevents "Hydrogen Purifier" vs "hydrogen purifier" duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_templates_name_ci
  ON asset_templates (LOWER(name));

-- ── Add template_id to fixed_assets (nullable FK — fully backward compatible) ──
-- Existing assets retain NULL; only new assets created via template will have it.
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS template_id
    INTEGER REFERENCES asset_templates(id) ON DELETE SET NULL;

-- Index for filtering assets by template
CREATE INDEX IF NOT EXISTS idx_fa_template_id
  ON fixed_assets (template_id) WHERE template_id IS NOT NULL;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT 'asset_templates table' AS check_item, COUNT(*) AS rows FROM asset_templates
UNION ALL
SELECT 'fixed_assets.template_id column',
       COUNT(*) FROM information_schema.columns
       WHERE table_name = 'fixed_assets' AND column_name = 'template_id';

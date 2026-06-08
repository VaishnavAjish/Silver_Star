-- ============================================================
-- SILVERSTAR GROW — Phase 6: Clipboard, Quick-Find, Barcodes
-- Run AFTER phase5-lot-movements.sql
-- Apply: psql -U postgres -d silverstar_grow -f sql/phase6-clipboard.sql
-- Idempotent: safe to run multiple times
-- ============================================================

-- Trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- USER CLIPBOARD
-- ============================================================
CREATE TABLE IF NOT EXISTS user_clipboard (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT    NOT NULL CHECK (entity_type IN (
                'inventory','invoice','voucher','account',
                'customer','vendor','fixed_asset'
              )),
  entity_id   TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_user_clipboard_user
  ON user_clipboard (user_id, added_at DESC);

-- ============================================================
-- GIN TRIGRAM INDEXES FOR FAST FUZZY SEARCH
-- ============================================================

-- inventory (all lots: rough, cut, polished, etc.)
CREATE INDEX IF NOT EXISTS idx_inventory_lot_number_trgm
  ON inventory USING gin (lot_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_lot_name_trgm
  ON inventory USING gin (lot_name gin_trgm_ops);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_doc_number_trgm
  ON invoices USING gin (doc_number gin_trgm_ops);

-- journal_entries (vouchers)
CREATE INDEX IF NOT EXISTS idx_je_number_trgm
  ON journal_entries USING gin (je_number gin_trgm_ops);

-- accounts
CREATE INDEX IF NOT EXISTS idx_accounts_code_trgm
  ON accounts USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_accounts_name_trgm
  ON accounts USING gin (name gin_trgm_ops);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_code_trgm
  ON customers USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

-- vendors
CREATE INDEX IF NOT EXISTS idx_vendors_code_trgm
  ON vendors USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm
  ON vendors USING gin (name gin_trgm_ops);

-- fixed_assets
CREATE INDEX IF NOT EXISTS idx_fa_asset_code_trgm
  ON fixed_assets USING gin (asset_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_fa_asset_name_trgm
  ON fixed_assets USING gin (asset_name gin_trgm_ops);

-- Phase 39: Stock Reservation Table for Concurrency Control
-- Run order: after phase38-login-lockout.sql

BEGIN;

-- Stock reservation table for preventing negative stock race conditions
CREATE TABLE IF NOT EXISTS stock_reservations (
  id              SERIAL       PRIMARY KEY,
  item_id         INTEGER      NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reference_type  VARCHAR(50)  NOT NULL,  -- 'purchase_note', 'invoice', 'stock_transfer', 'split', 'mix', etc.
  reference_id    INTEGER      NOT NULL,
  quantity        NUMERIC(15,4) NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'released', 'cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  released_at     TIMESTAMPTZ
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_stock_reservations_item_status
  ON stock_reservations (item_id, status) WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_stock_reservations_reference
  ON stock_reservations (reference_type, reference_id);

COMMIT;
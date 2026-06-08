-- Cost Center Migration
-- Run once: psql -d silverstar_grow -f cost_center_migration.sql

CREATE TABLE IF NOT EXISTS cost_centers (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL,
  code       TEXT        UNIQUE,
  status     TEXT        DEFAULT 'active',
  created_at TIMESTAMP   DEFAULT NOW()
);

ALTER TABLE je_lines
  ADD COLUMN IF NOT EXISTS cost_center_id INTEGER REFERENCES cost_centers(id);

CREATE INDEX IF NOT EXISTS idx_je_lines_cost_center ON je_lines(cost_center_id);

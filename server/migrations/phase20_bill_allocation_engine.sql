-- ============================================================
-- PHASE 20 — JE BILL ALLOCATION ENGINE
-- Maps JE lines to specific vendor bills / customer invoices,
-- enabling proper document settlement when passing adjusting JEs.
--
-- SAFE: all IF NOT EXISTS, no destructive changes, no data loss.
-- ============================================================

-- ── je_allocations ────────────────────────────────────────────────────────────
-- Links a posted journal entry (specifically one AP/AR line) to one or more
-- open bills / invoices, recording how much of the JE settles each document.

CREATE TABLE IF NOT EXISTS je_allocations (
  id               SERIAL PRIMARY KEY,

  -- Party info (mirrors je_lines.entity_type / entity_id)
  entity_type      VARCHAR(20) NOT NULL
    CHECK (entity_type IN ('vendor','customer')),
  entity_id        INTEGER NOT NULL,

  -- Source JE
  je_id            INTEGER NOT NULL
    REFERENCES journal_entries(id) ON DELETE CASCADE,
  je_line_id       INTEGER
    REFERENCES je_lines(id) ON DELETE SET NULL,

  -- Target document
  target_type      VARCHAR(20) NOT NULL
    CHECK (target_type IN ('bill','invoice')),
  target_id        INTEGER NOT NULL,

  -- Allocation amount (always positive, represents settlement)
  allocated_amount NUMERIC(15,2) NOT NULL CHECK (allocated_amount > 0),

  allocation_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,

  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_je_alloc_entity  ON je_allocations (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_je_alloc_je      ON je_allocations (je_id);
CREATE INDEX IF NOT EXISTS idx_je_alloc_target  ON je_allocations (target_type, target_id);

-- ============================================================
-- SILVERSTAR GROW — Phase 22: Enhanced Expense Entry
-- Adds multi-line support, vendor payee, bill settlement
-- Safe to run multiple times (idempotent).
-- ============================================================

-- 1. Extend expenses table
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS vendor_id      INTEGER REFERENCES vendors(id),
  ADD COLUMN IF NOT EXISTS payment_mode   VARCHAR(50)  DEFAULT 'Bank Transfer',
  ADD COLUMN IF NOT EXISTS memo           TEXT;

-- 2. Expense lines — one-to-many per expense
CREATE TABLE IF NOT EXISTS expense_lines (
  id              SERIAL PRIMARY KEY,
  expense_id      INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL DEFAULT 1,
  category_id     INTEGER REFERENCES expense_categories(id),
  description     TEXT,
  department_id   INTEGER REFERENCES departments(id),
  cost_center_id  INTEGER REFERENCES cost_centers(id),
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  gl_account_id   INTEGER REFERENCES accounts(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_explines_expense ON expense_lines(expense_id);

-- 3. Expense allocations — bill settlement from an expense (parallel to payment_allocations)
CREATE TABLE IF NOT EXISTS expense_allocations (
  id               SERIAL PRIMARY KEY,
  expense_id       INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  allocated_date   DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expalloc_expense ON expense_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_expalloc_pn      ON expense_allocations(purchase_note_id);

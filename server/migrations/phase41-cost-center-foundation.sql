-- ============================================================================
-- Phase 41: Cost Centre Foundation
-- ----------------------------------------------------------------------------
-- Adds analytical Cost Centre metadata plus an audit trail.
--
-- SAFETY (per architecture rules):
--   - Does NOT touch je_lines.debit / je_lines.credit or any balance.
--   - cost_center_id is nullable analytical metadata only, fully backward compatible.
--   - No hard deletes anywhere. Deactivation is via cost_centers.status.
--   - Idempotent. Safe to run multiple times.
--
-- NOTE: applied by server/migrate.js, which splits on the semicolon and records
-- the file in migrations_history automatically. Therefore this file uses ONLY
-- single statements with no DO blocks, no function bodies, no BEGIN/COMMIT, and
-- no semicolons inside comments.
-- ============================================================================

-- 1. Extend cost_centers master with analytical attributes plus an audit timestamp
ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at  timestamp without time zone DEFAULT now();

-- 2. Backfill updated_at for rows that predate the column
UPDATE public.cost_centers
   SET updated_at = COALESCE(updated_at, created_at, now())
 WHERE updated_at IS NULL;

-- 3. Cost Centre audit trail (Phase 1.D) - append only, one row per change
CREATE TABLE IF NOT EXISTS public.cost_center_audit (
  id                  bigserial    PRIMARY KEY,
  user_id             integer      REFERENCES public.users(id),
  changed_at          timestamptz  NOT NULL DEFAULT now(),
  entity_type         text         NOT NULL,
  entity_id           integer,
  old_cost_center_id  integer      REFERENCES public.cost_centers(id),
  new_cost_center_id  integer      REFERENCES public.cost_centers(id),
  reason              text
);

-- 4. Audit indexes
CREATE INDEX IF NOT EXISTS idx_cc_audit_entity ON public.cost_center_audit (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_cc_audit_changed_at ON public.cost_center_audit (changed_at);

CREATE INDEX IF NOT EXISTS idx_cc_audit_new_cc ON public.cost_center_audit (new_cost_center_id);

-- 5. Ensure cost_center_id exists on fixed_assets (Phase 1.B) - nullable, backward compatible
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS cost_center_id integer REFERENCES public.cost_centers(id);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_cost_center ON public.fixed_assets (cost_center_id);

-- 6. Index the LIVE je_lines cost_center_id for reporting and bulk operations
CREATE INDEX IF NOT EXISTS idx_je_lines_cost_center_live ON public.je_lines (cost_center_id);

-- 7. Seed the startup cost centres (idempotent on unique code)
INSERT INTO public.cost_centers (code, name, description, status)
VALUES
  ('CC001', 'STARTUP PROJECT', 'Startup project costs', 'active'),
  ('CC002', 'ERP DEVELOPMENT', 'ERP development costs',  'active'),
  ('CC003', 'FACTORY SETUP',   'Factory setup costs',    'active')
ON CONFLICT (code) DO NOTHING;

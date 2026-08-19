-- ============================================================
-- Phase 89 — Legacy Seed Reconstruction business identity
-- ============================================================
-- DO NOT AUTO-RUN. Apply manually on EC2 BEFORE (or together with) the code
-- deploy that ships services/legacySeedReconstruction.js:
--   psql "$DATABASE_URL" -f phase89-legacy-seed-reconstruction-identity.sql
--
-- WHY (database-level integrity genuinely requires this):
--   The exceptional Seed Remove repair reconstructs the missing intermediate
--   attached Seed for a historical Process Issue. The business rule is:
--     at most ONE reconstructed attached Seed per Process Issue.
--   The issue-row FOR UPDATE lock serializes concurrent submissions, but no
--   existing column records WHICH issue a reconstruction belongs to, so the
--   rule could not be expressed — or verified — at the database level.
--   Reusing source_movement_id / machine_process_id would attach misleading
--   semantics to unrelated fields; a dedicated nullable FK is honest.
--
-- ADDITIVE ONLY:
--   · no historical inventory UPDATE;
--   · no automatic reconstruction;
--   · every existing row keeps reconstructed_for_issue_id = NULL;
--   · the partial unique index covers ONLY future reconstruction rows.
--
-- FAIL-CLOSED COUPLING: if this migration is NOT applied, the reconstruction
-- INSERT (which names the column) errors and the whole return transaction
-- rolls back — the feature fails closed, it can never corrupt data.

BEGIN;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS reconstructed_for_issue_id integer
  REFERENCES lot_process_issues(id);

COMMENT ON COLUMN inventory.reconstructed_for_issue_id IS
  'Legacy Seed Reconstruction ONLY: the Seed Remove Process Issue this row was reconstructed for (services/legacySeedReconstruction.js). NULL for every normal inventory row. At most one row per issue (partial unique index).';

-- The canonical reconstruction identity: one reconstructed Seed per issue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_legacy_reconstruction_issue
  ON inventory (reconstructed_for_issue_id)
  WHERE reconstructed_for_issue_id IS NOT NULL;

COMMIT;

-- Verification (read-only):
--   SELECT count(*) FROM inventory WHERE reconstructed_for_issue_id IS NOT NULL;  -- expect 0 on first apply
--   \d inventory  -- column + uq_inventory_legacy_reconstruction_issue present

-- ============================================================
-- SILVERSTAR GROW — Phase 27: Safe Inventory Operational Reset
-- UAT reset — clears ONLY inventory + process operational rows.
--
-- PRESERVES (untouched):
--   journal_entries, je_lines, accounts, vendors, customers,
--   purchase_notes, purchase_note_lines (inventory_id nulled),
--   invoices, payments, receipts, fixed_assets, depreciation_runs,
--   all master data (items, locations, departments, machines, etc.)
--
-- DO NOT RUN in production without a full pg_dump backup first.
-- ============================================================

-- ── STEP 0: BACKUP COMMAND (run before this file) ────────────
-- pg_dump -U postgres -d silverstar_grow \
--   -F c -f backup_pre_phase27_reset_$(date +%Y%m%d_%H%M).dump
--
-- Or plain SQL:
-- pg_dump -U postgres silverstar_grow > backup_pre_phase27_reset.sql
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- STEP 1: Process lifecycle tables — bottom-up by FK dependency
-- ─────────────────────────────────────────────────────────────

-- lot_op_log.lot_id → inventory(id) — no CASCADE, must go first
DELETE FROM lot_op_log;

-- lot_process_returns.issue_id → lot_process_issues(id) UNIQUE
DELETE FROM lot_process_returns;

-- lot_process_issues.source_lot_id / process_lot_id → inventory(id)
DELETE FROM lot_process_issues;

-- ─────────────────────────────────────────────────────────────
-- STEP 2: Movement genealogy — all use ON DELETE RESTRICT to inventory
-- ─────────────────────────────────────────────────────────────

-- lot_mix_components.mixed_lot_id / source_lot_id → inventory ON DELETE RESTRICT
DELETE FROM lot_mix_components;

-- lot_movement_children.child_lot_id → inventory ON DELETE RESTRICT
DELETE FROM lot_movement_children;

-- lot_movement_parents.parent_lot_id → inventory ON DELETE RESTRICT
DELETE FROM lot_movement_parents;

-- inventory.source_movement_id → lot_movements(id): null before deleting movements
UPDATE inventory
   SET source_movement_id = NULL
 WHERE source_movement_id IS NOT NULL;

-- lot_movements — now safe (no children remain)
DELETE FROM lot_movements;

-- ─────────────────────────────────────────────────────────────
-- STEP 3: Rough growth
-- rough_growth_lines.growth_id ON DELETE CASCADE from rough_growth
-- rough_growth.seed_inventory_id → inventory (no CASCADE) — deleting
-- the rough_growth ROW is safe; it does NOT delete the inventory rows.
-- ─────────────────────────────────────────────────────────────
DELETE FROM rough_growth;   -- rough_growth_lines auto-cascade deleted

-- ─────────────────────────────────────────────────────────────
-- STEP 4: Process transactions (deprecated engine)
-- process_transaction_lines.process_trs_id ON DELETE CASCADE
-- process_transactions.je_id → journal_entries: we are deleting the
-- REFERENCING row, not the journal entry. JEs remain intact.
-- ─────────────────────────────────────────────────────────────
DELETE FROM process_transactions;   -- process_transaction_lines auto-cascade deleted

-- ─────────────────────────────────────────────────────────────
-- STEP 5: Preserve purchase_notes — null the inventory cross-ref only
-- purchase_notes have je_id (accounting) — DO NOT DELETE them.
-- purchase_note_lines.inventory_id is nullable — safe to null.
-- ─────────────────────────────────────────────────────────────
UPDATE purchase_note_lines
   SET inventory_id = NULL
 WHERE inventory_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- STEP 6: Clear self-referential FKs on inventory, then delete all rows
-- inventory.parent_lot_id REFERENCES inventory(id) — no CASCADE
-- inventory.root_lot_id   REFERENCES inventory(id) — no CASCADE
-- Must be nulled within the same table before delete.
-- ─────────────────────────────────────────────────────────────
UPDATE inventory
   SET parent_lot_id = NULL,
       root_lot_id   = NULL
 WHERE parent_lot_id IS NOT NULL
    OR root_lot_id   IS NOT NULL;

DELETE FROM inventory;

-- ─────────────────────────────────────────────────────────────
-- STEP 7: Reset operational sequences
-- DO NOT reset: je_seq, pn_seq, pay_seq, rct_seq, inv_seq
--   (those belong to accounting / purchase docs being preserved)
-- ─────────────────────────────────────────────────────────────
ALTER SEQUENCE lm_seq           RESTART WITH 1;
ALTER SEQUENCE lot_issue_seq    RESTART WITH 1;
ALTER SEQUENCE lot_return_seq   RESTART WITH 1;
ALTER SEQUENCE lot_op_id_seq    RESTART WITH 100001;
ALTER SEQUENCE seed_lot_seq     RESTART WITH 1001;
ALTER SEQUENCE seed_mix_seq     RESTART WITH 1;
ALTER SEQUENCE gr_seq           RESTART WITH 100;
ALTER SEQUENCE rd_seq           RESTART WITH 5030;
ALTER SEQUENCE ps_seq           RESTART WITH 1100;
ALTER SEQUENCE pr_seq           RESTART WITH 1100;

COMMIT;

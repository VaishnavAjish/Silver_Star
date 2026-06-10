-- ============================================================================
-- Phase 33 Validation & Orphan Report  (READ-ONLY — no data is modified)
-- ----------------------------------------------------------------------------
-- Genealogy chain enforced this phase:
--   Seed → Seed Issue → Machine Process → Growth Run (biscuit) → Rough → Sale
--
-- Decision 1 = YES : Rough Output writes final measurements back to the Growth Run.
-- Decision 2 = NO  : Historical orphan roughs are NOT backfilled — this script only
--                    REPORTS them (section M1). No UPDATE/INSERT/DELETE anywhere.
--
-- Run with:  psql <db> -f sql/phase33-validate.sql
-- ============================================================================

-- ── M1. ORPHAN ROUGH REPORT (read-only) ──────────────────────────────────────
-- Roughs created before Phase 33 may have no Growth Run parent. We only count /
-- list them; we do NOT change them (Decision 2).
SELECT 'orphan_rough_count' AS metric, COUNT(*) AS value
FROM   inventory
WHERE  source_module = 'Rough Growth'
  AND  parent_lot_id IS NULL;
-- Expected going forward: this number never INCREASES (no NEW orphans created).

-- Detailed list of any orphan roughs (for the record, not for mutation)
SELECT id, lot_number, lot_code, qty, weight, status,
       created_at, machine_process_id
FROM   inventory
WHERE  source_module = 'Rough Growth'
  AND  parent_lot_id IS NULL
ORDER  BY created_at DESC
LIMIT  200;

-- ── 1. Seed Issue → Growth Run auto-created ──────────────────────────────────
-- Every growth machine_process that has reached awaiting_output / completed
-- should have exactly one biscuit row.
SELECT mp.id           AS machine_process_id,
       mp.process_number,
       mp.status        AS process_status,
       COUNT(b.id)      AS biscuit_count
FROM   machine_processes mp
LEFT   JOIN inventory b
       ON b.machine_process_id = mp.id
      AND b.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
WHERE  mp.process_type = 'growth'
GROUP  BY mp.id, mp.process_number, mp.status
ORDER  BY mp.id DESC
LIMIT  50;
-- Expected: biscuit_count = 1 for every process at/after awaiting_output.

-- ── 2. Growth Run visible in inventory ───────────────────────────────────────
SELECT b.id, b.lot_number, b.status, b.weight,
       b.seed_height_at_in, b.dim_height,
       b.actual_growth_mm, b.weight_gain, b.growth_pct,
       b.parent_lot_id, b.genealogy_path
FROM   inventory b
WHERE  b.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
ORDER  BY b.id DESC
LIMIT  50;

-- ── 3. Rough Inventory descends from a Growth Run ────────────────────────────
-- Every rough's parent_lot_id must point at a growth_run (biscuit) row.
SELECT r.id          AS rough_id,
       r.lot_number  AS rough_lot,
       r.parent_lot_id,
       p.lot_number  AS parent_lot,
       (p.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)) AS parent_is_growth_run
FROM   inventory r
LEFT   JOIN inventory p ON p.id = r.parent_lot_id
WHERE  r.source_module = 'Rough Growth'
ORDER  BY r.id DESC
LIMIT  50;
-- Expected (post Phase 33): parent_is_growth_run = TRUE for all NEW roughs.

-- ── 4. Growth Run marked CONSUMED after output ───────────────────────────────
SELECT status, COUNT(*) AS biscuits
FROM   inventory
WHERE  item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
GROUP  BY status
ORDER  BY status;
-- Expected: biscuits with roughs posted are 'CONSUMED'; awaiting ones 'IN STOCK'.

-- ── 5. Full genealogy chain Seed → Growth Run → Rough ────────────────────────
SELECT r.lot_number    AS rough_lot,
       b.lot_number    AS growth_run_lot,
       s.lot_number    AS seed_lot,
       r.genealogy_path
FROM   inventory r
JOIN   inventory b ON b.id = r.parent_lot_id
                  AND b.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
LEFT   JOIN inventory s ON s.id = b.parent_lot_id
WHERE  r.source_module = 'Rough Growth'
ORDER  BY r.id DESC
LIMIT  50;
-- Expected: genealogy_path looks like SEED-xxx/GR-000001/RD-xxxx (3 levels).

-- ── 6. No remaining direct Seed → Rough path (anti-pattern detector) ─────────
-- A rough whose parent is a SEED (not a biscuit) means the legacy direct path
-- was used. Post Phase 33 this set should ONLY ever contain pre-existing rows.
SELECT r.id, r.lot_number, r.created_at,
       p.lot_number AS parent_lot, p.source_module AS parent_module
FROM   inventory r
JOIN   inventory p ON p.id = r.parent_lot_id
WHERE  r.source_module = 'Rough Growth'
  AND  p.item_id <> (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
ORDER  BY r.created_at DESC
LIMIT  50;
-- Expected: 0 NEW rows after the Phase 33 deploy date.

-- ── 7. Item master sanity — growth_run category exists ───────────────────────
SELECT id, code, name, category, status
FROM   items
WHERE  category = 'growth_run';
-- Expected: at least 1 active row (code = BISCUIT).

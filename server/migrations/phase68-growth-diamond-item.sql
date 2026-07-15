-- Phase 68: Update Growth Diamond Item Master
-- Must run AFTER Phase 67 is committed

DO $$
DECLARE
    v_count integer;
    v_item_id integer;
    v_collision_count integer;
BEGIN
    -- Verify growth_diamond exists in the enum
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' 
          AND t.typname = 'item_category' 
          AND e.enumlabel = 'growth_diamond'
    ) THEN
        RAISE EXCEPTION 'Enum public.item_category does not contain growth_diamond';
    END IF;

    -- Find Growth Diamond Item Master candidates
    -- Guarded case-insensitive matching
    SELECT COUNT(*), MAX(id) INTO v_count, v_item_id
    FROM items
    WHERE lower(code) IN ('growth_diamond', 'growth diamond')
       OR lower(name) = 'growth diamond';

    -- Check candidate outcomes
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Growth Diamond item missing. Cannot correct missing item.';
    ELSIF v_count > 1 THEN
        RAISE EXCEPTION 'BLOCKED — DUPLICATE GROWTH DIAMOND ITEMS REQUIRE OWNER REVIEW. Multiple candidates found.';
    END IF;

    -- Guard against canonical code collision with ANOTHER unrelated item
    SELECT COUNT(*) INTO v_collision_count
    FROM items
    WHERE id != v_item_id
      AND lower(code) = 'growth_diamond';
      
    IF v_collision_count > 0 THEN
        RAISE EXCEPTION 'BLOCKED — CANONICAL CODE COLLISION. GROWTH_DIAMOND code already in use by another item.';
    END IF;

    -- Update exactly the one candidate to canonical state
    UPDATE items
    SET code = 'GROWTH_DIAMOND',
        name = 'Growth Diamond',
        category = 'growth_diamond',
        status = 'active',
        updated_at = NOW()
    WHERE id = v_item_id;

    -- Assert exactly one row was updated
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update candidate item ID %', v_item_id;
    END IF;

    -- Assert the canonical post-state
    IF NOT EXISTS (
        SELECT 1 FROM items
        WHERE id = v_item_id
          AND code = 'GROWTH_DIAMOND'
          AND name = 'Growth Diamond'
          AND category = 'growth_diamond'
    ) THEN
        RAISE EXCEPTION 'Post-state assertion failed for canonical Growth Diamond item ID %', v_item_id;
    END IF;

END $$;

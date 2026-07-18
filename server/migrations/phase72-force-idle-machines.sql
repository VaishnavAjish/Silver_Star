BEGIN;

DO $$ 
DECLARE
    target_machine_ids INT[];
BEGIN
    -- Select all machines EXCEPT LS-03, LS-01, SSD-083
    SELECT array_agg(id) INTO target_machine_ids
    FROM machines
    WHERE code NOT IN ('LS-03', 'LS-01', 'SSD-083');

    -- 1. Complete all active processes on these machines
    UPDATE machine_processes
    SET status = 'completed',
        completed_at = NOW(),
        remarks = COALESCE(remarks || ' | ', '') || 'Auto-completed by manual machine state reset (Phase 72)'
    WHERE machine_id = ANY(target_machine_ids)
      AND status IN ('running', 'hold');

    -- 2. Force all these machines to idle
    UPDATE machines
    SET status = 'idle'
    WHERE id = ANY(target_machine_ids)
      AND status != 'idle';

    RAISE NOTICE 'phase72: Force-idled % machines and auto-completed their active processes.', array_length(target_machine_ids, 1);
END $$;

COMMIT;

BEGIN;

DO $$ 
DECLARE
    rec record;
BEGIN
    -- We want to revert the force-completion for LS-03, LS-01, SSD-083
    FOR rec IN 
        SELECT m.id AS machine_id, m.name, mp.id AS process_id
        FROM machines m
        JOIN machine_processes mp ON mp.machine_id = m.id
        WHERE m.name IN ('LS-03', 'LS-01', 'SSD-083')
          AND mp.status = 'completed'
          AND mp.remarks LIKE '%Auto-completed by manual machine state reset (Phase 72)%'
    LOOP
        -- Revert the process to running
        UPDATE machine_processes
        SET status = 'running',
            completed_at = NULL,
            -- Remove the remark we added
            remarks = REPLACE(remarks, ' | Auto-completed by manual machine state reset (Phase 72)', '')
        WHERE id = rec.process_id;
        
        -- And if the remark was JUST that string (no pipe), clean it up fully
        UPDATE machine_processes
        SET remarks = NULL
        WHERE id = rec.process_id AND remarks = 'Auto-completed by manual machine state reset (Phase 72)';

        -- Set the machine back to running
        UPDATE machines
        SET status = 'running'
        WHERE id = rec.machine_id;

        RAISE NOTICE 'Reverted machine % (ID %) and its process (ID %)', rec.name, rec.machine_id, rec.process_id;
    END LOOP;
END $$;

COMMIT;

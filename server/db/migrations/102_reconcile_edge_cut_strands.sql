BEGIN;

-- 1. Correct the Process Master completion mode for Edge Cut
UPDATE process_master
SET completion_mode = 'RETURN_BASED',
    updated_at = NOW()
WHERE process_code = 'edge_cut';

-- 2. Reconcile the exact stranded Edge Cut machine process
UPDATE machine_processes
SET status = 'completed',
    completed_at = NOW()
WHERE id = 77 
  AND process_type = 'edge_cut'
  AND status = 'running';

-- 3. Record the machine status transition for audit trailing
INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_at, changed_by, remarks)
SELECT id, 'awaiting_output', 'idle', NOW(), NULL, 'System reconciliation: Edge Cut return-based completion fix (PR-000183)'
FROM machines
WHERE code = 'FB-M-02';

-- 4. Release the machine from awaiting_output to idle
UPDATE machines
SET status = 'idle',
    updated_at = NOW()
WHERE code = 'FB-M-02'
  AND status = 'awaiting_output';

COMMIT;

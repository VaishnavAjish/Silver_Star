-- Phase 66: Resolve Stranded Machine Processes and Free Machine
BEGIN;

-- 1. Complete the stranded machine process
UPDATE machine_processes
SET status = 'completed',
    completed_at = NOW()
WHERE status IN ('running', 'hold')
  AND machine_id = (SELECT id FROM machines WHERE code = 'CVD-M-86' LIMIT 1);

-- 2. Free up the machine itself
UPDATE machines
SET status = 'idle',
    updated_at = NOW()
WHERE code = 'CVD-M-86' AND status IN ('running', 'hold', 'awaiting_output');

-- 3. Log the status change
INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_at, remarks)
VALUES (
  (SELECT id FROM machines WHERE code = 'CVD-M-86' LIMIT 1),
  'awaiting_output',
  'idle',
  NOW(),
  'Manual resolution of stranded process (Phase 66)'
);

COMMIT;

-- Phase 65: Correct Process Master Configuration
BEGIN;
UPDATE process_master
SET completion_mode = 'RETURN_BASED',
    updated_at = NOW()
WHERE process_code = 'pr-01' AND completion_mode = 'OUTPUT_BASED';
COMMIT;

-- SILVERSTAR GROW — Phase 22: Cost Center Report Types

ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS report_type VARCHAR(20) DEFAULT 'GENERAL';

-- Set legacy Startup Codes
UPDATE cost_centers 
SET report_type = 'STARTUP' 
WHERE code IN ('CC001', 'CC002', 'CC003');

-- Set Project Code (assuming CC01 is the project one per requirements)
UPDATE cost_centers 
SET report_type = 'PROJECT' 
WHERE code = 'CC01';

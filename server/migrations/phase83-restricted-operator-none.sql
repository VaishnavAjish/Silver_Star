-- Phase 83: Enforce NONE as default scope for operator_restricted users
-- This migration is idempotent and only affects unconfigured restricted operators.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'operator_restricted';

INSERT INTO user_inventory_scopes (user_id, scope_mode)
SELECT id, 'NONE'
FROM users
WHERE role = 'operator_restricted'
  AND id NOT IN (SELECT user_id FROM user_inventory_scopes)
ON CONFLICT (user_id) DO NOTHING;

-- --------------------------------------------------------------------------
-- PHASE 39: REAL-TIME SYNC ENGINE
-- 1. Optimistic Concurrency Control (OCC) versioning for core tables
-- 2. System Event Outbox for offline synchronization
-- --------------------------------------------------------------------------

BEGIN;

-- 1. Add version tracking to Inventory
ALTER TABLE inventory 
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;

-- 2. Add version tracking to Process Transactions
ALTER TABLE process_transactions
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;

-- 3. Add version tracking to Purchase Notes
ALTER TABLE purchase_notes
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;

-- 4. Add version tracking to Invoices (Sales)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;

-- 5. Create System Event Outbox
CREATE TABLE IF NOT EXISTS sys_event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index for querying recent events for offline reconnect
CREATE INDEX IF NOT EXISTS idx_sys_event_outbox_created_at ON sys_event_outbox(created_at DESC);

-- No migrations table insert needed


COMMIT;

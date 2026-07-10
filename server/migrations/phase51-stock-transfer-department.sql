ALTER TABLE pending_transfers ADD COLUMN IF NOT EXISTS destination_department_id INTEGER REFERENCES departments(id);

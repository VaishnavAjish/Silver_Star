ALTER TABLE purchase_note_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE purchase_note_lines ADD COLUMN IF NOT EXISTS expense_account_id INTEGER REFERENCES accounts(id);

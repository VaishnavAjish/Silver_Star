-- Cross-table indexes for performance
CREATE INDEX IF NOT EXISTS idx_po_items_received ON po_items(po_id, received_qty)
  WHERE received_qty < quantity;

CREATE INDEX IF NOT EXISTS idx_inv_trans_location ON inventory_transactions(location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_je_lines_je_account ON je_lines(je_id, account_id);
CREATE INDEX IF NOT EXISTS idx_stock_batch_location ON stock_batches(location_id, item_id);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_items_name_fts ON items USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_vendors_name_fts ON vendors USING gin(to_tsvector('english', name));

-- Composite lookup indexes
CREATE INDEX IF NOT EXISTS idx_prod_batch_items_lookup ON production_batch_items(batch_id, item_id, type);
CREATE INDEX IF NOT EXISTS idx_growth_act_cycle_type ON growth_activities(cycle_id, activity_type);

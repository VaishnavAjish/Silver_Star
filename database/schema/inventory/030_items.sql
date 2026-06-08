CREATE TYPE item_category AS ENUM ('seed', 'gas', 'consumable', 'rough');
CREATE TYPE item_type AS ENUM ('raw_material', 'finished_good');
CREATE TYPE master_status AS ENUM ('active', 'inactive');

CREATE TABLE items (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(30) UNIQUE NOT NULL,
  name          VARCHAR(150) NOT NULL,
  category      item_category NOT NULL,
  type          item_type NOT NULL DEFAULT 'raw_material',
  default_uom   VARCHAR(10) DEFAULT 'Pcs',
  hsn_code      VARCHAR(20),
  reorder_level INTEGER DEFAULT 0,
  description   TEXT,
  status        master_status DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_items_category ON items(category);
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_timestamp();

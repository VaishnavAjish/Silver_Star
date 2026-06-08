CREATE TABLE locations (
  id        SERIAL PRIMARY KEY,
  code      VARCHAR(20) UNIQUE NOT NULL,
  name      VARCHAR(100) NOT NULL,
  type      VARCHAR(30) DEFAULT 'factory',
  address   TEXT,
  city      VARCHAR(50),
  state     VARCHAR(50),
  manager   VARCHAR(100),
  status    master_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  head        VARCHAR(100),
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  staff_count INTEGER DEFAULT 0,
  status      master_status DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_timestamp();

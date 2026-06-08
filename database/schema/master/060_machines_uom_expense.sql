CREATE TYPE machine_status AS ENUM ('running', 'maintenance', 'idle');

CREATE TABLE machines (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(50),
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  capacity        VARCHAR(50),
  last_service    DATE,
  next_service    DATE,
  status          machine_status DEFAULT 'running',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_machines_updated BEFORE UPDATE ON machines FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE uom (
  id      SERIAL PRIMARY KEY,
  code    VARCHAR(10) UNIQUE NOT NULL,
  name    VARCHAR(50) NOT NULL,
  symbol  VARCHAR(10),
  type    VARCHAR(20) DEFAULT 'count',
  status  master_status DEFAULT 'active'
);

CREATE TABLE expense_categories (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  gl_account_id INTEGER REFERENCES accounts(id),
  monthly_budget NUMERIC(12,2) DEFAULT 0,
  status        master_status DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

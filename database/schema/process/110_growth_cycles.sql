CREATE TYPE growth_phase AS ENUM ('nursery', 'veg', 'flower', 'fruiting', 'harvest');
CREATE TYPE growth_status AS ENUM ('active', 'completed', 'cancelled');

CREATE TABLE growth_cycles (
  id            SERIAL PRIMARY KEY,
  cycle_no      VARCHAR(30) UNIQUE NOT NULL,
  crop_name     VARCHAR(100) NOT NULL,
  location_id   INTEGER REFERENCES locations(id),
  start_date    DATE NOT NULL,
  expected_end  DATE,
  actual_end    DATE,
  phase         growth_phase DEFAULT 'nursery',
  status        growth_status DEFAULT 'active',
  total_area    NUMERIC(10,2),
  yield_expected NUMERIC(12,2),
  yield_actual  NUMERIC(12,2),
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_growth_cycle_phase ON growth_cycles(phase);
CREATE INDEX idx_growth_cycle_status ON growth_cycles(status);

CREATE TABLE growth_activities (
  id            SERIAL PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES growth_cycles(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  description   TEXT,
  item_id       INTEGER REFERENCES items(id),
  quantity_used NUMERIC(12,2),
  cost          NUMERIC(12,2),
  performed_by  INTEGER REFERENCES users(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_growth_act_cycle ON growth_activities(cycle_id);
CREATE INDEX idx_growth_act_date  ON growth_activities(activity_date);

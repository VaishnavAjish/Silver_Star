CREATE TABLE vendors (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  name            VARCHAR(150) NOT NULL,
  category        VARCHAR(30) DEFAULT 'general',
  contact_person  VARCHAR(100),
  phone           VARCHAR(20),
  email           VARCHAR(150),
  address         TEXT,
  city            VARCHAR(50),
  state           VARCHAR(50),
  gstin           VARCHAR(22),
  pan             VARCHAR(12),
  payment_term    VARCHAR(30) DEFAULT 'Immediate',
  bank_details    TEXT,
  status          master_status DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     VARCHAR(20) NOT NULL UNIQUE,
  filename    VARCHAR(255) NOT NULL,
  description VARCHAR(500),
  md5_hash    VARCHAR(64),
  applied_by  VARCHAR(50),
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  duration_ms INTEGER DEFAULT 0,
  status      VARCHAR(20) DEFAULT 'success'
);

CREATE INDEX idx_migrations_version ON schema_migrations(version);
CREATE INDEX idx_migrations_applied ON schema_migrations(applied_at);

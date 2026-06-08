CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  table_name  VARCHAR(50) NOT NULL,
  record_id   INTEGER NOT NULL,
  action      VARCHAR(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    JSONB,
  new_data    JSONB,
  changed_by  INTEGER REFERENCES users(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_table  ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_time   ON audit_log(changed_at);

CREATE TABLE api_logs (
  id              SERIAL PRIMARY KEY,
  method          VARCHAR(10) NOT NULL,
  endpoint        VARCHAR(255) NOT NULL,
  status_code     INTEGER,
  response_time_ms INTEGER,
  ip_address      VARCHAR(45),
  user_id         INTEGER REFERENCES users(id),
  request_body    TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX idx_api_logs_time     ON api_logs(created_at);
CREATE INDEX idx_api_logs_status   ON api_logs(status_code);

CREATE TABLE session_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  login_at    TIMESTAMPTZ DEFAULT NOW(),
  logout_at   TIMESTAMPTZ,
  ip_address  VARCHAR(45),
  user_agent  TEXT
);
CREATE INDEX idx_session_user ON session_log(user_id);

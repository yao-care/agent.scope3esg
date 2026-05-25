CREATE TABLE tenants (
  installation_id INTEGER PRIMARY KEY,
  org             TEXT NOT NULL,
  repo_node_id    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE supplier_tokens (
  token       TEXT PRIMARY KEY,
  org         TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE pull_jobs (
  job_id      TEXT PRIMARY KEY,
  org         TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  api_url     TEXT NOT NULL,
  schedule    TEXT NOT NULL,
  last_run_at TEXT
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  org        TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

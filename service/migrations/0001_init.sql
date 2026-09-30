CREATE TABLE codes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash          TEXT NOT NULL UNIQUE,          -- sha256 hex of normalised 20-char code
  last5              TEXT NOT NULL,
  customer           TEXT NOT NULL,
  notes              TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  locked_reason      TEXT,
  valid_days         INTEGER,                        -- days from first activation (NULL if fixed_end)
  ends_at            INTEGER,                        -- epoch seconds; set at creation (fixed) or first activation
  max_devices        INTEGER NOT NULL DEFAULT 1,
  lease_hours        INTEGER NOT NULL DEFAULT 72,
  page_quota_month   INTEGER,                        -- NULL = unlimited
  created_at         INTEGER NOT NULL,
  first_activated_at INTEGER,
  last_seen_at       INTEGER
);

CREATE TABLE devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id     INTEGER NOT NULL,
  device_hash TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  app_version TEXT,
  UNIQUE (code_id, device_hash)
);

CREATE TABLE quota_counters (
  code_id INTEGER NOT NULL,
  month   TEXT NOT NULL,                             -- 'YYYY-MM' (UTC)
  pages   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id, month)
);

CREATE TABLE usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id     INTEGER NOT NULL,
  device_id   INTEGER,
  ts          INTEGER NOT NULL,
  pages       INTEGER NOT NULL DEFAULT 1,
  model       TEXT,
  ok          INTEGER NOT NULL,
  error       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER
);
CREATE INDEX usage_code_ts ON usage (code_id, ts DESC);

CREATE TABLE audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  actor     TEXT NOT NULL,                           -- admin | cli | client | system
  action    TEXT NOT NULL,
  code_id   INTEGER,
  ip        TEXT,
  detail    TEXT
);
CREATE INDEX audit_ts ON audit (ts DESC);
CREATE INDEX audit_code ON audit (code_id, ts DESC);

CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE admin_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  last_totp_step  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO admin_state (id) VALUES (1);

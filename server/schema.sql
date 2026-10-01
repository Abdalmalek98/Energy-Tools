-- Licensing server schema (SQLite). Applied automatically at start-up (idempotent).
-- Privacy: only the licence id, app version and HASHED hardware components are stored. No names beyond what the owner typed into the licence.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  license_id      TEXT PRIMARY KEY,
  product         TEXT NOT NULL,
  customer        TEXT NOT NULL,
  company         TEXT NOT NULL,
  kid             TEXT NOT NULL,
  offline         INTEGER NOT NULL DEFAULT 0,
  max_activations INTEGER NOT NULL DEFAULT 1,
  issued_at       TEXT NOT NULL,
  not_before      TEXT NOT NULL,
  expires_at      TEXT,                          -- from the signed code
  expires_override TEXT,                         -- renew/extend: the server's value wins when set
  expires_overridden INTEGER NOT NULL DEFAULT 0, -- 1 = expires_override is authoritative (may be NULL = perpetual)
  binding_mode    TEXT NOT NULL DEFAULT 'first', -- none | first | specific
  binding_comps   TEXT,                          -- JSON {name: hash} for 'specific'
  features        TEXT NOT NULL DEFAULT '{}',    -- JSON
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  status_reason   TEXT,
  grace_hours     INTEGER NOT NULL DEFAULT 168,  -- offline grace period handed to the client in each receipt
  replacement_ok  INTEGER NOT NULL DEFAULT 0,    -- next new machine replaces the old one(s) even at the activation limit
  code_sha256     TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  last_seen       TEXT
);

CREATE TABLE IF NOT EXISTS activations (
  activation_id TEXT PRIMARY KEY,
  license_id    TEXT NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  comps         TEXT NOT NULL,                   -- JSON of hashed components (latest seen)
  machine_hash  TEXT NOT NULL,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  app_version   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  ended_at      TEXT,
  ended_reason  TEXT                             -- deactivated | replaced | reset
);
CREATE INDEX IF NOT EXISTS activations_license ON activations (license_id, active);

CREATE TABLE IF NOT EXISTS authorized_machines (   -- admin pre-authorised a machine: allowed even beyond the activation limit
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  comps      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (                 -- page reads through the proxy (tokens let you compute cost)
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  pages      INTEGER NOT NULL,
  model      TEXT,
  ok         INTEGER NOT NULL,
  error      TEXT,
  tokens_in  INTEGER,
  tokens_out INTEGER
);
CREATE INDEX IF NOT EXISTS usage_license_ts ON usage (license_id, ts);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  actor      TEXT NOT NULL,                      -- admin | client | system
  action     TEXT NOT NULL,
  license_id TEXT,
  ip         TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit (ts DESC);
CREATE INDEX IF NOT EXISTS audit_license ON audit (license_id, ts DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Chiller Plant Analyzer licensing database (SQLite; portable to PostgreSQL).
-- Contains licensing data ONLY. Engineering / BMS / logger data is never stored or transmitted.

CREATE TABLE IF NOT EXISTS licenses (
  license_id          TEXT PRIMARY KEY,               -- CPA-2026-000123
  customer_name       TEXT NOT NULL,
  company_name        TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  product             TEXT NOT NULL,
  created_at          TEXT NOT NULL,                   -- ISO-8601 UTC
  start_date          TEXT NOT NULL,
  expiry_date         TEXT,                            -- NULL = perpetual
  status              TEXT NOT NULL CHECK (status IN ('active','suspended','revoked')),
  max_activations     INTEGER NOT NULL DEFAULT 1 CHECK (max_activations >= 1),
  current_activations INTEGER NOT NULL DEFAULT 0,
  machine_binding     TEXT NOT NULL DEFAULT 'none' CHECK (machine_binding IN ('none','first','specific')),
  bound_fp            TEXT,                            -- hashed fingerprint the license is bound to
  bound_parts         TEXT,                            -- JSON array of hashed fingerprint components
  features            TEXT NOT NULL DEFAULT '{}',      -- JSON feature flags
  key_id              TEXT NOT NULL,                   -- signing key used for the activation code
  last_validation     TEXT,
  replaced_by         TEXT,
  notes               TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activations (
  activation_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id          TEXT NOT NULL REFERENCES licenses(license_id),
  machine_fingerprint TEXT NOT NULL,                   -- SHA-256 based, never raw hardware identifiers
  machine_parts       TEXT NOT NULL,                   -- JSON array of hashed components (drift tolerance)
  activated_at        TEXT NOT NULL,
  last_seen           TEXT NOT NULL,
  deactivated_at      TEXT,
  ip_address          TEXT,
  application_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_license ON activations(license_id, deactivated_at);

CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  license_id  TEXT,
  detail      TEXT
);

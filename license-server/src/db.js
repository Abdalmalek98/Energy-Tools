import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // migration for databases created before offline licenses existed
  const cols = db.prepare('PRAGMA table_info(licenses)').all().map((c) => c.name);
  if (!cols.includes('offline')) db.exec('ALTER TABLE licenses ADD COLUMN offline INTEGER NOT NULL DEFAULT 0');
  return db;
}
export const _dirname = dirname(fileURLToPath(import.meta.url));

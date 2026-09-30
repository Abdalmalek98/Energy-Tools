import type { RawTable } from '../types';

type SqlJsStatic = import('sql.js').SqlJsStatic;
let cfg: { locateFile?: (f: string) => string } = {};
let cached: Promise<SqlJsStatic> | null = null;

/** Browser builds call this with the bundled wasm URL; Node uses the default lookup. */
export function configureSqlJs(c: { locateFile?: (f: string) => string }) {
  cfg = c;
  cached = null;
}

async function load(): Promise<SqlJsStatic> {
  if (!cached) {
    cached = import('sql.js').then((m) => {
      const init = (m as any).default ?? m;
      return init(cfg) as Promise<SqlJsStatic>;
    });
  }
  return cached;
}

const TIME_COL = /(trend_period|date.?time|time.?stamp|^time$|^date$|period|start)/i;
const POWER_COL = /(powerp|active.?power|^p_|kw|watt)/i;

/**
 * FCA2 files that are SQLite databases: pick the table that looks most like a trend (time column +
 * power columns, most rows) and return it as text cells so the normal pipeline can process it.
 */
export async function sqliteToTable(bytes: Uint8Array, fileName?: string): Promise<{ table: RawTable; tables: string[] }> {
  const SQL = await load();
  const db = new SQL.Database(bytes);
  try {
    const names = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")[0]?.values.map((v) => String(v[0])) ?? [];
    let best: { name: string; score: number; cols: string[] } | null = null;
    for (const t of names) {
      const cols = db.exec(`PRAGMA table_info("${t.replace(/"/g, '""')}")`)[0]?.values.map((v) => String(v[1])) ?? [];
      const cnt = Number(db.exec(`SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}"`)[0]?.values[0][0] ?? 0);
      const score = (cols.some((c) => TIME_COL.test(c)) ? 1e6 : 0) + cols.filter((c) => POWER_COL.test(c)).length * 1e4 + cnt;
      if (!best || score > best.score) best = { name: t, score, cols };
    }
    if (!best) return { table: { delimiter: ',', headers: [], rows: [], fileName }, tables: names };
    const res = db.exec(`SELECT * FROM "${best.name.replace(/"/g, '""')}"`)[0];
    const rows = (res?.values ?? []).map((r) => r.map((c) => (c === null ? '' : String(c))));
    return { table: { delimiter: ',', headers: best.cols, rows, fileName }, tables: names };
  } finally {
    db.close();
  }
}

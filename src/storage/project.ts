import JSZip from 'jszip';
import type { CddData, ColumnMapping, LoggerData, RawTable, Settings, WeatherHourlyData } from '../types';
import { mergeSettings, APP_VERSION } from '../settings/defaults';

/**
 * .cpa project = ZIP container:
 *   manifest.json   metadata, version, kind ('project' | 'backup'), SHA-256 of every other entry
 *   settings.json   engineering settings
 *   mapping.json    column mapping + BMS file name
 *   bms.json        raw BMS table (headers + rows)         [optional]
 *   loggers.json    parsed logger data + chiller assignment [optional]
 *   results.json    summary of the last analysis (informational; recomputed on open)
 * Everything stays on the user's machine.
 */
export const PROJECT_FORMAT = 1;

export interface ProjectState {
  name: string;
  settings: Settings;
  mapping: ColumnMapping;
  bmsFileName?: string;
  bmsTable: RawTable | null;
  loggers: { data: LoggerData; chiller: string }[];
  cdd?: CddData | null;
  weather?: WeatherHourlyData | null;
  typicalWeather?: WeatherHourlyData | null;
  results?: unknown;
}

export interface Manifest {
  format: number;
  kind: 'project' | 'backup';
  app: string;
  appVersion: string;
  name: string;
  savedAt: string;
  hashes: Record<string, string>;
}

export class ProjectError extends Error {}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? '__NaN__' : v > 0 ? '__Inf__' : '__-Inf__') : v)));
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b), (_k, v) => (v === '__NaN__' ? NaN : v === '__Inf__' ? Infinity : v === '__-Inf__' ? -Infinity : v));

export async function saveProject(p: ProjectState, kind: 'project' | 'backup' = 'project'): Promise<Uint8Array> {
  const zip = new JSZip();
  const files: Record<string, Uint8Array> = {
    'settings.json': enc(p.settings),
    'mapping.json': enc({ mapping: p.mapping, bmsFileName: p.bmsFileName }),
    'results.json': enc(p.results ?? null),
  };
  if (p.bmsTable) files['bms.json'] = enc(p.bmsTable);
  if (p.loggers.length) files['loggers.json'] = enc(p.loggers);
  if (p.cdd) files['cdd.json'] = enc(p.cdd);
  if (p.weather) files['weather.json'] = enc(p.weather);
  if (p.typicalWeather) files['typical-weather.json'] = enc(p.typicalWeather);
  const hashes: Record<string, string> = {};
  for (const [n, d] of Object.entries(files)) {
    zip.file(n, d);
    hashes[n] = await sha256Hex(d);
  }
  const manifest: Manifest = { format: PROJECT_FORMAT, kind, app: 'Chiller Plant Analyzer', appVersion: APP_VERSION, name: p.name, savedAt: new Date().toISOString(), hashes };
  zip.file('manifest.json', enc(manifest));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function openProject(bytes: Uint8Array): Promise<{ project: ProjectState; manifest: Manifest }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ProjectError('This file is not a valid Chiller Plant Analyzer project (.cpa).');
  }
  const mf = zip.file('manifest.json');
  if (!mf) throw new ProjectError('This file is not a Chiller Plant Analyzer project: manifest.json is missing.');
  const manifest = dec(await mf.async('uint8array')) as Manifest;
  if (manifest.app !== 'Chiller Plant Analyzer') throw new ProjectError('This file was not created by Chiller Plant Analyzer.');
  if (manifest.format > PROJECT_FORMAT) throw new ProjectError(`This project was saved by a newer version (${manifest.appVersion}). Please update the application.`);
  const read = async (n: string) => {
    const f = zip.file(n);
    if (!f) return null;
    const d = await f.async('uint8array');
    if (manifest.hashes[n] && manifest.hashes[n] !== (await sha256Hex(d))) throw new ProjectError(`Integrity check failed for ${n} – the file is corrupted or was modified.`);
    return dec(d);
  };
  const settings = mergeSettings((await read('settings.json')) ?? undefined);
  const mp = (await read('mapping.json')) ?? { mapping: {} };
  const bmsTable = ((await read('bms.json')) ?? null) as RawTable | null;
  const loggers = ((await read('loggers.json')) ?? []) as ProjectState['loggers'];
  const cdd = ((await read('cdd.json')) ?? null) as CddData | null;
  const weather = ((await read('weather.json')) ?? null) as WeatherHourlyData | null;
  const typicalWeather = ((await read('typical-weather.json')) ?? null) as WeatherHourlyData | null;
  const results = await read('results.json');
  return { manifest, project: { name: manifest.name, settings, mapping: mp.mapping ?? {}, bmsFileName: mp.bmsFileName, bmsTable, loggers, cdd, weather, typicalWeather, results } };
}

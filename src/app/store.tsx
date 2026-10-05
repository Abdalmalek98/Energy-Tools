import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnalysisResult, WeatherHourlyData, CddData, ColumnMapping, LoggerAnalysis, LoggerData, ParsedBms, RawTable, Settings } from '../types';
import { DEFAULT_SETTINGS, mergeSettings } from '../settings/defaults';
import { autoMapTable, detectUnitSettings } from '../analysis/bms';
import { runPipeline, suggestChiller } from '../analysis/pipeline';
import { analyzeLogger } from '../fluke/logger';
import { parseFlukeFile, SUPPORTED_EXTENSIONS } from '../fluke/parse';
import { FlukeError } from '../fluke/errors';
import { decodeText, parseTable } from '../utils/csv';
import { parseCddBytes } from '../analysis/cdd';
import { parseWeatherBytes } from '../analysis/weather';
import { openProject, saveProject, ProjectError, type ProjectState } from '../storage/project';
import { pickFiles, saveFile, isTauri, readFromPath, writeToPath, type PickedFile } from '../storage/files';
import { loadRecent, loadTheme, pushRecent, saveTheme, type RecentProject } from '../storage/local';
import { licensing } from '../licensing/client';
import type { AppInfo, LicenseStatus } from '../licensing/types';
import { buildWorkbook } from '../excel/workbook';

export type PageId =
  | 'dashboard' | 'import' | 'mapping' | 'plant' | 'logger' | 'analysis' | 'regression' | 'performance'
  | 'chillers' | 'findings' | 'export' | 'settings' | 'license' | 'about';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface LoggerEntry { data: LoggerData; chiller: string; }
export interface Toast { id: number; text: string; }
export interface UiError { title: string; message: string; }

interface Store {
  page: PageId; setPage: (p: PageId) => void;
  theme: ThemeMode; setTheme: (t: ThemeMode) => void;
  settings: Settings; updateSettings: (p: Partial<Settings>) => void; resetSettings: () => void;
  table: RawTable | null; bmsFileName?: string; mapping: ColumnMapping; setMapping: (m: ColumnMapping) => void; autoMapNow: () => void;
  loggers: LoggerEntry[]; loggerAnalyses: { entry: LoggerEntry; analysis: LoggerAnalysis }[];
  parsed: ParsedBms | null; analysis: AnalysisResult | null; analysisError: string | null;
  importBms: () => Promise<void>; importBmsFile: (f: PickedFile) => Promise<void>; clearBms: () => void;
  importLoggers: () => Promise<void>; importLoggerFiles: (f: PickedFile[]) => Promise<void>; removeLogger: (i: number) => void; setLoggerChiller: (i: number, c: string) => void;
  loggerError: UiError | null; dismissLoggerError: () => void;
  weather: WeatherHourlyData | null; importWeather: () => Promise<void>; importWeatherFile: (f: PickedFile) => Promise<void>; clearWeather: () => void; weatherError: string | null;
  typicalWeather: WeatherHourlyData | null; importTypicalWeather: () => Promise<void>; importTypicalWeatherFile: (f: PickedFile) => Promise<void>; clearTypicalWeather: () => void; typicalWeatherError: string | null;
  cdd: CddData | null; importCdd: () => Promise<void>; importCddFile: (f: PickedFile) => Promise<void>; clearCdd: () => void; cddError: string | null;
  exportExcel: () => Promise<void>; exporting: boolean;
  project: { name: string; path?: string; dirty: boolean }; recent: RecentProject[];
  newProject: () => void; openProjectDialog: () => Promise<void>; openRecent: (r: RecentProject) => Promise<void>; saveCurrent: () => Promise<void>; saveAs: () => Promise<void>;
  exportBackup: () => Promise<void>; importBackup: () => Promise<void>;
  license: LicenseStatus | null; appInfo: AppInfo | null; licenseBusy: boolean;
  activate: (code: string) => Promise<LicenseStatus>; checkLicense: () => Promise<void>; deactivate: (force?: boolean) => Promise<void>; refreshLicense: () => Promise<void>;
  toasts: Toast[]; toast: (t: string) => void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

const FLUKE_EXT = SUPPORTED_EXTENSIONS;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageId>('dashboard');
  const [theme, setThemeState] = useState<ThemeMode>(loadTheme());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [table, setTable] = useState<RawTable | null>(null);
  const [bmsFileName, setBmsFileName] = useState<string | undefined>();
  const [mapping, setMappingState] = useState<ColumnMapping>({});
  const [loggers, setLoggers] = useState<LoggerEntry[]>([]);
  const [loggerError, setLoggerError] = useState<UiError | null>(null);
  const [cdd, setCdd] = useState<CddData | null>(null);
  const [cddError, setCddError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherHourlyData | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [typicalWeather, setTypicalWeather] = useState<WeatherHourlyData | null>(null);
  const [typicalWeatherError, setTypicalWeatherError] = useState<string | null>(null);
  const [project, setProject] = useState<{ name: string; path?: string; dirty: boolean }>({ name: 'Untitled project', dirty: false });
  const [recent, setRecent] = useState<RecentProject[]>(loadRecent());
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exporting, setExporting] = useState(false);
  const tid = useRef(0);

  const toast = useCallback((text: string) => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dirty = useCallback(() => setProject((p) => ({ ...p, dirty: true })), []);

  // ---- theme
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const setTheme = (t: ThemeMode) => { setThemeState(t); saveTheme(t); };

  // ---- derived analysis (a pure function of the inputs → independent of upload order)
  const pipeline = useMemo(() => runPipeline({ table, mapping, settings, bmsFileName, loggers, cdd, weather, typicalWeather }), [table, mapping, settings, bmsFileName, loggers, cdd, weather, typicalWeather]);
  const loggerAnalyses = useMemo(() => loggers.map((entry) => ({ entry, analysis: analyzeLogger(entry.data) })), [loggers]);

  // ---- BMS
  const importBmsFile = useCallback(async (f: PickedFile) => {
    try {
      const text = decodeText(f.bytes);
      const t = parseTable(text, f.name);
      if (!t.headers.length || !t.rows.length) throw new Error('The file contains no data rows.');
      setTable(t);
      setBmsFileName(f.name);
      const m = autoMapTable(t);
      setMappingState(m);
      const units = detectUnitSettings(t, m);
      if (Object.keys(units).length) setSettings((st) => ({ ...st, ...units }));
      // re-suggest chiller assignments for loggers that were loaded first
      setLoggers((ls) => ls);
      dirty();
      toast(`Loaded ${t.rows.length.toLocaleString('en-US')} rows from ${f.name}`);
      setPage('mapping');
    } catch (e) {
      toast(`Could not read ${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  }, [dirty, toast]);
  const importBms = useCallback(async () => {
    const files = await pickFiles({ extensions: ['csv', 'txt', 'tsv'], title: 'Import BMS / trend data' });
    if (files[0]) await importBmsFile(files[0]);
  }, [importBmsFile]);
  const clearBms = () => { setTable(null); setBmsFileName(undefined); setMappingState({}); dirty(); };
  const setMapping = (m: ColumnMapping) => { setMappingState(m); dirty(); };
  const autoMapNow = () => {
    if (!table) return;
    const m = autoMapTable(table);
    setMappingState(m);
    const units = detectUnitSettings(table, m);
    if (Object.keys(units).length) setSettings((st) => ({ ...st, ...units }));
    dirty();
  };

  // ---- loggers
  const bmsChillers = pipeline.parsed?.chillers ?? [];
  // a logger loaded before the BMS file (or whose name matched nothing) follows a single-chiller BMS file automatically
  useEffect(() => {
    if (bmsChillers.length !== 1) return;
    setLoggers((ls) => (ls.some((l) => !bmsChillers.includes(l.chiller)) ? ls.map((l) => (bmsChillers.includes(l.chiller) ? l : { ...l, chiller: bmsChillers[0] })) : ls));
  }, [bmsChillers.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const importLoggerFiles = useCallback(async (files: PickedFile[]) => {
    for (const f of files) {
      try {
        await licensing.require('flukeAnalysis');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        if (!FLUKE_EXT.includes(ext)) throw new FlukeError(`Unsupported file type ".${ext}". Supported: ${FLUKE_EXT.map((e) => '.' + e).join(', ')}.`);
        const data = await parseFlukeFile(f.name, f.bytes);
        setLoggers((ls) => [...ls.filter((l) => l.data.fileName !== data.fileName), { data, chiller: suggestChiller(data, bmsChillers) }]);
        setLoggerError(null);
        dirty();
        toast(`Loaded logger ${data.chiller} (${data.rowCount.toLocaleString('en-US')} rows)`);
      } catch (e) {
        setLoggerError({ title: f.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [bmsChillers, dirty, toast]);
  const importLoggers = useCallback(async () => {
    const files = await pickFiles({ extensions: FLUKE_EXT, multiple: true, title: 'Import Fluke logger file(s)' });
    if (files.length) await importLoggerFiles(files);
  }, [importLoggerFiles]);
  const removeLogger = (i: number) => { setLoggers((ls) => ls.filter((_, j) => j !== i)); dirty(); };
  const setLoggerChiller = (i: number, c: string) => { setLoggers((ls) => ls.map((l, j) => (j === i ? { ...l, chiller: c } : l))); dirty(); };

  // ---- cooling degree days (customer weather data)
  const importCddFile = useCallback(async (f: PickedFile) => {
    try {
      const d = parseCddBytes(f.name, f.bytes, settings);
      setCdd(d);
      setCddError(null);
      dirty();
      toast(`Loaded ${d.days.length} day(s) of ${d.source === 'cdd' ? 'CDD' : 'temperature'} data from ${f.name}`);
    } catch (e) {
      setCddError(e instanceof Error ? e.message : String(e));
    }
  }, [settings, dirty, toast]);
  const importCdd = useCallback(async () => {
    const f = (await pickFiles({ extensions: ['csv', 'txt', 'tsv'], title: 'Import cooling degree days (weather)' }))[0];
    if (f) await importCddFile(f);
  }, [importCddFile]);
  const clearCdd = () => { setCdd(null); setCddError(null); dirty(); };

  // ---- hourly weather (temperature, optional humidity / enthalpy)
  const importWeatherFile = useCallback(async (f: PickedFile) => {
    try {
      const d = parseWeatherBytes(f.name, f.bytes, settings);
      setWeather(d);
      setWeatherError(null);
      dirty();
      toast(`Loaded ${d.hours.length.toLocaleString('en-US')} hour(s) of weather from ${f.name}`);
    } catch (e) {
      setWeatherError(e instanceof Error ? e.message : String(e));
    }
  }, [settings, dirty, toast]);
  const importWeather = useCallback(async () => {
    const f = (await pickFiles({ extensions: ['csv', 'txt', 'tsv'], title: 'Import hourly weather data' }))[0];
    if (f) await importWeatherFile(f);
  }, [importWeatherFile]);
  const clearWeather = () => { setWeather(null); setWeatherError(null); dirty(); };

  // ---- typical-year hourly weather (annual projection)
  const importTypicalWeatherFile = useCallback(async (f: PickedFile) => {
    try {
      const d = parseWeatherBytes(f.name, f.bytes, settings);
      setTypicalWeather(d);
      setTypicalWeatherError(null);
      dirty();
      toast(`Loaded ${d.hours.length.toLocaleString('en-US')} typical-year hour(s) from ${f.name}`);
    } catch (e) {
      setTypicalWeatherError(e instanceof Error ? e.message : String(e));
    }
  }, [settings]);
  const importTypicalWeather = useCallback(async () => {
    const f = (await pickFiles({ extensions: ['csv', 'txt', 'tsv'], title: 'Import typical-year hourly weather' }))[0];
    if (f) await importTypicalWeatherFile(f);
  }, [importTypicalWeatherFile]);
  const clearTypicalWeather = () => { setTypicalWeather(null); setTypicalWeatherError(null); dirty(); };

  // ---- settings
  const updateSettings = (p: Partial<Settings>) => { setSettings((s) => ({ ...s, ...p })); dirty(); };
  const resetSettings = () => { setSettings(DEFAULT_SETTINGS); dirty(); };

  // ---- Excel
  const exportExcel = useCallback(async () => {
    setExporting(true);
    try {
      await licensing.require('excelExport');
      const out = await buildWorkbook({ analysis: pipeline.analysis, loggers: loggers.map((l) => l.data) });
      const saved = await saveFile(out.fileName, out.bytes, 'xlsx', 'Save Excel workbook');
      if (saved) toast(`Saved ${out.fileName}`);
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
    }
  }, [pipeline.analysis, loggers, toast]);

  // ---- projects
  const snapshot = useCallback((): ProjectState => ({
    name: project.name, settings, mapping, bmsFileName, bmsTable: table, loggers, cdd, weather, typicalWeather,
    results: pipeline.analysis ? { kpis: pipeline.analysis.kpis, exclusions: pipeline.analysis.exclusions, chillers: pipeline.analysis.chillers.map((c) => ({ id: c.id, kwPerTR: c.kwPerTR, status: c.status })), findings: pipeline.analysis.findings.map((f) => ({ id: f.id, status: f.status, title: f.title })) } : null,
  }), [project.name, settings, mapping, bmsFileName, table, loggers, cdd, weather, typicalWeather, pipeline.analysis]);

  const applyProject = (p: ProjectState, path?: string) => {
    setSettings(p.settings); setTable(p.bmsTable); setBmsFileName(p.bmsFileName); setMappingState(p.mapping); setLoggers(p.loggers); setCdd(p.cdd ?? null); setCddError(null); setWeather(p.weather ?? null); setWeatherError(null); setTypicalWeather(p.typicalWeather ?? null); setTypicalWeatherError(null);
    setProject({ name: p.name, path, dirty: false });
    if (path) setRecent(pushRecent({ name: p.name, path, openedAt: new Date().toISOString() }));
  };
  const newProject = () => {
    setSettings(DEFAULT_SETTINGS); setTable(null); setBmsFileName(undefined); setMappingState({}); setLoggers([]); setLoggerError(null); setCdd(null); setCddError(null); setWeather(null); setWeatherError(null); setTypicalWeather(null); setTypicalWeatherError(null);
    setProject({ name: 'Untitled project', dirty: false }); setPage('dashboard');
  };
  const loadBytes = async (bytes: Uint8Array, path?: string) => {
    try {
      const { project: p } = await openProject(bytes);
      applyProject(p, path);
      toast(`Opened ${p.name}`);
      setPage('dashboard');
    } catch (e) {
      toast(e instanceof ProjectError ? e.message : `Could not open project: ${e instanceof Error ? e.message : e}`);
    }
  };
  const openProjectDialog = async () => {
    const f = (await pickFiles({ extensions: ['cpa'], title: 'Open project' }))[0];
    if (f) await loadBytes(f.bytes, f.path);
  };
  const openRecent = async (r: RecentProject) => {
    try { await loadBytes(await readFromPath(r.path), r.path); } catch { toast(`Cannot open ${r.path}`); }
  };
  const nameFromFile = (file: string) => file.replace(/\.[^.]+$/, '');
  const saveAs = async () => {
    const name = project.name === 'Untitled project' && bmsFileName ? nameFromFile(bmsFileName) : project.name;
    const bytes = await saveProject({ ...snapshot(), name });
    const path = await saveFile(`${name}.cpa`, bytes, 'cpa', 'Save project');
    if (path) {
      setProject({ name, path: isTauri() ? path : undefined, dirty: false });
      if (isTauri()) setRecent(pushRecent({ name, path, openedAt: new Date().toISOString() }));
      toast('Project saved');
    }
  };
  const saveCurrent = async () => {
    if (project.path && isTauri()) {
      await writeToPath(project.path, await saveProject(snapshot()));
      setProject((p) => ({ ...p, dirty: false }));
      toast('Project saved');
    } else await saveAs();
  };
  const exportBackup = async () => {
    const bytes = await saveProject(snapshot(), 'backup');
    const stamp = new Date().toISOString().slice(0, 10);
    const p = await saveFile(`${project.name}_backup_${stamp}.cpa`, bytes, 'cpa', 'Export project backup');
    if (p) toast('Backup exported (stays on this computer)');
  };
  const importBackup = async () => {
    const f = (await pickFiles({ extensions: ['cpa'], title: 'Import project backup' }))[0];
    if (f) await loadBytes(f.bytes);
  };

  // ---- license
  const refreshLicense = useCallback(async () => {
    try { setLicense(await licensing.status()); } catch (e) { toast(String(e)); }
  }, [toast]);
  useEffect(() => {
    (async () => {
      setAppInfo(await licensing.appInfo());
      await refreshLicense();
    })();
  }, [refreshLicense]);
  const checkLicense = useCallback(async () => {
    setLicenseBusy(true);
    try { setLicense(await licensing.check()); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setLicenseBusy(false); }
  }, [toast]);
  // background validation: on start when due, then every 6 hours
  useEffect(() => {
    if (!license || license.state === 'unlicensed') return;
    const due = license.nextValidationDue ? Date.parse(license.nextValidationDue) : 0;
    if (due && Date.now() > due - 24 * 3600e3) void licensing.check().then(setLicense).catch(() => undefined);
    const id = setInterval(() => void licensing.check().then(setLicense).catch(() => undefined), 6 * 3600e3);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license?.licenseId]);
  const activate = useCallback(async (code: string) => {
    setLicenseBusy(true);
    try {
      const s = await licensing.activate(code);
      setLicense(s);
      return s;
    } finally { setLicenseBusy(false); }
  }, []);
  const deactivate = useCallback(async (force = false) => {
    setLicenseBusy(true);
    try { setLicense(await licensing.deactivate(force)); } finally { setLicenseBusy(false); }
  }, []);

  // Any failure inside a user action (file dialog, disk access, …) is shown instead of being swallowed.
  const guard = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => {
    try { await fn(...a); } catch (e) { toast(`Error: ${e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)}`); }
  };
  const value: Store = {
    page, setPage, theme, setTheme, settings, updateSettings, resetSettings,
    table, bmsFileName, mapping, setMapping, autoMapNow, loggers, loggerAnalyses, parsed: pipeline.parsed, analysis: pipeline.analysis, analysisError: pipeline.error,
    importBms: guard(importBms), importBmsFile, clearBms, importLoggers: guard(importLoggers), importLoggerFiles, removeLogger, setLoggerChiller, loggerError, dismissLoggerError: () => setLoggerError(null),
    weather, importWeather: guard(importWeather), importWeatherFile, clearWeather, weatherError,
    typicalWeather, importTypicalWeather: guard(importTypicalWeather), importTypicalWeatherFile, clearTypicalWeather, typicalWeatherError,
    cdd, importCdd: guard(importCdd), importCddFile, clearCdd, cddError,
    exportExcel, exporting, project, recent, newProject, openProjectDialog: guard(openProjectDialog), openRecent, saveCurrent: guard(saveCurrent), saveAs: guard(saveAs), exportBackup: guard(exportBackup), importBackup: guard(importBackup),
    license, appInfo, licenseBusy, activate, checkLicense, deactivate, refreshLicense, toasts, toast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { mergeSettings };

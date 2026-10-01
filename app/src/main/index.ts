import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_SPACE_RULES, exportWorkbook, type ResolvedRow } from "@lsr/shared";
import { collectComps, fetchHttp, LicenseClient, PRODUCT, realCollectEnv, type ClientStatus } from "@lsr/licensing";
import { buildKeyring, RELEASE_BUILD } from "./licensing/keyring";
import { createLicenseStore } from "./licensing/store";
import { readLsr, writeLsr } from "./projectFile";
import { settingsStore } from "./store";
import { checkForUpdates, scheduleUpdateChecks } from "./updates";

// settings live in %APPDATA%\LightingSurveyReader
app.setPath("userData", join(app.getPath("appData"), "LightingSurveyReader"));
if (process.env.LSR_USER_DATA) app.setPath("userData", process.env.LSR_USER_DATA);   // tests only
if (!app.requestSingleInstanceLock() && !__E2E__) app.quit();

const isDev = !app.isPackaged;
const e2e = __E2E__ && isDev;                       // dialogs are scripted only in E2E builds
let win: BrowserWindow | null = null;
let license: LicenseClient;
let lastStatusJson = "";

// ---- dialogs (scripted in E2E builds): LSR_E2E_OPEN = JSON list, one entry (path or list of paths) per dialog ----
const e2eOpenQueue: (string | string[])[] = JSON.parse(process.env.LSR_E2E_OPEN ?? "[]");
async function askOpen(title: string, filters: Electron.FileFilter[], multi: boolean): Promise<string[]> {
  if (e2e) { const next = e2eOpenQueue.shift(); return next == null ? [] : Array.isArray(next) ? next : [next]; }   // one queue entry per dialog
  const r = await dialog.showOpenDialog(win!, { title, filters, properties: multi ? ["openFile", "multiSelections"] : ["openFile"] });
  return r.canceled ? [] : r.filePaths;
}
async function askSave(defaultName: string, filters: Electron.FileFilter[]): Promise<string | null> {
  if (e2e) return join(process.env.LSR_E2E_OUT ?? app.getPath("temp"), defaultName);
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters });
  return r.canceled || !r.filePath ? null : r.filePath;
}
const templatePath = () => (app.isPackaged ? join(process.resourcesPath, "template.xlsx") : join(app.getAppPath(), "resources", "template.xlsx"));

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640, title: "Lighting Survey Reader", show: false,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.once("ready-to-show", () => win!.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL && isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  // strict CSP for the renderer: no network at all (all HTTP happens in the main process)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const dev = isDev && !!process.env.ELECTRON_RENDERER_URL;
    const csp = dev ? "" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    cb({ responseHeaders: csp ? { ...details.responseHeaders, "Content-Security-Policy": [csp] } : details.responseHeaders });
  });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));

  const userData = app.getPath("userData");
  const env = realCollectEnv(userData);
  if (e2e && process.env.LSR_TEST_MACHINE_SEED) { const seed = process.env.LSR_TEST_MACHINE_SEED; env.readFile = () => seed; env.hostname = () => seed; env.devId = () => seed; env.cpuModel = () => "test-cpu"; env.macs = () => []; }   // E2E: pretend to be another PC
  let memo: { at: number; v: ReturnType<typeof collectComps> } | null = null;
  const collect = () => { if (!memo || Date.now() - memo.at > 5 * 60_000) memo = { at: Date.now(), v: collectComps(env, __DEVICE_SALT__) }; return memo.v; };
  license = new LicenseClient({
    keys: buildKeyring(), product: PRODUCT, releaseBuild: RELEASE_BUILD, appVersion: app.getVersion(), collect, http: fetchHttp(__SERVICE_URL__),
    store: createLicenseStore(Object.values(collect()).join("|")),
  });
  startLicenseTimer();
  registerIpc();
  createWindow();
  void license.tick().then(pushStatus);
  scheduleUpdateChecks();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const statusPayload = () => { const st: ClientStatus = license.status(); return { ...st, contact: __CONTACT__, supportUrl: __SUPPORT_URL__, version: app.getVersion(), now: Math.floor(Date.now() / 1000) }; };
/** Tell the window when the licence state changes (also lets a lock apply to a running app). */
function pushStatus() {
  const p = statusPayload(); const j = JSON.stringify([p.evaluation.status, p.evaluation.warning, p.evaluation.info?.expiresAt, p.evaluation.info?.lastValidatedAt, p.notice]);
  if (j !== lastStatusJson) { lastStatusJson = j; win?.webContents.send("license:status", p); }
}
function startLicenseTimer() { setInterval(() => void license.tick().then(pushStatus), 30 * 60 * 1000).unref(); }
/** Every handler returns errors to the window (never swallowed): disk, dialog and licence failures are shown to the user. */
const safe = <A extends unknown[], R>(fn: (...a: A) => Promise<R> | R) => async (...a: A): Promise<R | { error: string }> => { try { return await fn(...a); } catch (e) { return { error: (e as Error).message || String(e) }; } };

function registerIpc() {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), contact: __CONTACT__, e2e }));
  ipcMain.handle("license:status", () => statusPayload());
  ipcMain.handle("license:activate", async (_e, code: unknown) => {
    if (typeof code !== "string" || !code.trim()) return { ok: false, error: "format", message: "Paste or type your activation code." };
    if (code.length > 4000) return { ok: false, error: "format", message: "That is not a valid activation code." };
    try { const r = await license.activate(code); pushStatus(); return r; } catch (e) { return { ok: false, error: "storage", message: `The licence could not be saved on this PC: ${(e as Error).message}` }; }
  });
  ipcMain.handle("license:check", async () => { await license.validateNow("validate"); pushStatus(); return statusPayload(); });
  ipcMain.handle("license:deactivate", safe(async () => { const r = await license.deactivate(); pushStatus(); return { ...r, status: statusPayload() }; }));
  ipcMain.handle("clipboard:write", (_e, text: unknown) => { if (typeof text === "string" && text.length < 20_000) { clipboard.writeText(text); return true; } return false; });
  ipcMain.handle("support:open", () => { if (/^(https:\/\/|mailto:)/.test(__SUPPORT_URL__)) void shell.openExternal(__SUPPORT_URL__); return !!__SUPPORT_URL__; });

  ipcMain.handle("settings:get", safe(() => ({ ...settingsStore.get(), defaultSpaceRules: DEFAULT_SPACE_RULES })));
  ipcMain.handle("settings:set", safe((_e: unknown, patch: Parameters<typeof settingsStore.set>[0]) => settingsStore.set(patch)));

  ipcMain.handle("files:pick", safe(async () => {
    const paths = await askOpen("Add survey files", [{ name: "PDF and photos", extensions: ["pdf", "jpg", "jpeg", "png"] }], true);
    return paths.map((p) => { const b = readFileSync(p); return { name: basename(p), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; });
  }));

  ipcMain.handle("read:page", async (_e, images: ArrayBuffer[], quality: "best" | "fast", hint?: string) => {
    if (!Array.isArray(images) || images.length < 1 || images.length > 3) return { ok: false, error: "bad_request", message: "Bad request." };
    const r = await license.readPage(images.map((b) => new Uint8Array(b)), quality === "fast" ? "fast" : "best", typeof hint === "string" ? hint : undefined);
    pushStatus();                                                  // a refusal (revoked/suspended/expired) locks the running app at once
    return r;
  });

  ipcMain.handle("project:save", safe(async (_e: unknown, project: { name: string }, images: Record<string, ArrayBuffer>, path?: string) => {
    const target = path ?? (await askSave(`${project.name || "Survey"}.lsr`, [{ name: "Survey project", extensions: ["lsr"] }]));
    if (!target) return null;
    await writeLsr(target, project, Object.fromEntries(Object.entries(images).map(([k, v]) => [k, new Uint8Array(v)])));
    settingsStore.addRecent(target); return target;
  }));
  ipcMain.handle("project:open", async (_e, path?: string) => {
    const p = path ?? (await askOpen("Open project", [{ name: "Survey project", extensions: ["lsr"] }], false))[0];
    if (!p) return null;
    try {
      const r = await readLsr(p); settingsStore.addRecent(p);
      return { path: p, project: r.project, images: Object.fromEntries(Object.entries(r.images).map(([k, v]) => [k, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)])) };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle("project:recent", safe(() => settingsStore.get().recent.filter((p) => existsSync(p))));

  ipcMain.handle("export:run", safe(async (_e: unknown, opts: { mode: "new" | "append"; rows: ResolvedRow[]; name: string }) => {
    const template = readFileSync(templatePath());
    const safe = (opts.name || "Lighting survey").replace(/[\\/:*?"<>|]/g, "-");
    let existing: Buffer | undefined; let outName = `${safe} - lighting survey.xlsx`;
    if (opts.mode === "append") {
      const p = (await askOpen("Choose the master workbook", [{ name: "Excel workbook", extensions: ["xlsx"] }], false))[0];
      if (!p) return null;
      existing = readFileSync(p); outName = basename(p).replace(/\.xlsx$/i, "") + " (updated).xlsx";
    }
    let res;
    try { res = await exportWorkbook({ template, rows: opts.rows, mode: opts.mode, existing }); }
    catch (e) { return { error: `Couldn’t build the workbook: ${(e as Error).message}` }; }
    const target = await askSave(outName, [{ name: "Excel workbook", extensions: ["xlsx"] }]);
    if (!target) return null;
    writeFileSync(target, res.data);
    return { path: target, firstRow: res.firstRow, lastRow: res.lastRow, appendedAfter: res.appendedAfter };
  }));
  ipcMain.handle("shell:reveal", (_e, p: string) => { if (typeof p === "string") shell.showItemInFolder(p); });

  ipcMain.handle("updates:check", () => checkForUpdates());
}

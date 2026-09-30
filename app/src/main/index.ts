import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_SPACE_RULES, exportWorkbook, type ResolvedRow } from "@lsr/shared";
import { deviceIdFor, machineGuid } from "./deviceId";
import { LicenseManager } from "./license";
import { readLsr, writeLsr } from "./projectFile";
import { createService } from "./service";
import { licenseStore, settingsStore } from "./store";

// settings live in %APPDATA%\LightingSurveyReader
app.setPath("userData", join(app.getPath("appData"), "LightingSurveyReader"));
if (process.env.LSR_USER_DATA) app.setPath("userData", process.env.LSR_USER_DATA);   // tests only
if (!app.requestSingleInstanceLock() && !__E2E__) app.quit();

const isDev = !app.isPackaged;
const e2e = __E2E__ && isDev;                       // dialogs are scripted only in E2E builds
let win: BrowserWindow | null = null;
let license: LicenseManager;

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

  const service = createService(__SERVICE_URL__);
  const deviceId = deviceIdFor(machineGuid(app.getPath("userData")), __DEVICE_SALT__);
  license = new LicenseManager({ service, publicKey: __PUBLIC_KEY__, deviceId, appVersion: app.getVersion(), load: () => licenseStore.load(), save: (s) => licenseStore.save(s) });
  license.on("status", (s) => win?.webContents.send("license:status", s));
  registerIpc();
  createWindow();
  void license.init();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { license?.stop(); if (process.platform !== "darwin") app.quit(); });

const statusPayload = () => ({ state: license.state, contact: __CONTACT__, version: app.getVersion(), now: Math.floor(Date.now() / 1000) });

function registerIpc() {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), contact: __CONTACT__, e2e }));
  ipcMain.handle("license:status", () => statusPayload());
  ipcMain.handle("license:activate", async (_e, code: string) => (typeof code === "string" ? license.activate(code.slice(0, 64)) : { ok: false, error: "invalid", message: "Enter a code." }));
  ipcMain.handle("license:refresh", async () => { await license.refresh(); return statusPayload(); });
  ipcMain.handle("license:deactivate", async () => { await license.deactivate(); return statusPayload(); });

  ipcMain.handle("settings:get", () => ({ ...settingsStore.get(), defaultSpaceRules: DEFAULT_SPACE_RULES }));
  ipcMain.handle("settings:set", (_e, patch) => settingsStore.set(patch));

  ipcMain.handle("files:pick", async () => {
    const paths = await askOpen("Add survey files", [{ name: "PDF and photos", extensions: ["pdf", "jpg", "jpeg", "png"] }], true);
    return paths.map((p) => { const b = readFileSync(p); return { name: basename(p), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; });
  });

  ipcMain.handle("read:page", async (_e, images: ArrayBuffer[], quality: "best" | "fast", hint?: string) => {
    if (!Array.isArray(images) || images.length < 1 || images.length > 3) return { ok: false, error: "bad_request", message: "Bad request." };
    return license.readPage(images.map((b) => new Uint8Array(b)), quality === "fast" ? "fast" : "best", typeof hint === "string" ? hint : undefined);
  });

  ipcMain.handle("project:save", async (_e, project: { name: string }, images: Record<string, ArrayBuffer>, path?: string) => {
    const target = path ?? (await askSave(`${project.name || "Survey"}.lsr`, [{ name: "Survey project", extensions: ["lsr"] }]));
    if (!target) return null;
    await writeLsr(target, project, Object.fromEntries(Object.entries(images).map(([k, v]) => [k, new Uint8Array(v)])));
    settingsStore.addRecent(target); return target;
  });
  ipcMain.handle("project:open", async (_e, path?: string) => {
    const p = path ?? (await askOpen("Open project", [{ name: "Survey project", extensions: ["lsr"] }], false))[0];
    if (!p) return null;
    try {
      const r = await readLsr(p); settingsStore.addRecent(p);
      return { path: p, project: r.project, images: Object.fromEntries(Object.entries(r.images).map(([k, v]) => [k, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)])) };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle("project:recent", () => settingsStore.get().recent.filter((p) => existsSync(p)));

  ipcMain.handle("export:run", async (_e, opts: { mode: "new" | "append"; rows: ResolvedRow[]; name: string }) => {
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
  });
  ipcMain.handle("shell:reveal", (_e, p: string) => { if (typeof p === "string") shell.showItemInFolder(p); });

  ipcMain.handle("updates:check", async () => {
    if (!app.isPackaged) return { message: "Updates are checked in the installed app." };
    try {
      const { autoUpdater } = await import("electron-updater");
      autoUpdater.autoDownload = true;
      const r = await autoUpdater.checkForUpdates();
      return { message: r?.updateInfo && r.updateInfo.version !== app.getVersion() ? `Version ${r.updateInfo.version} is downloading. It will install when you close the app.` : "You have the latest version." };
    } catch { return { message: "Couldn’t check for updates. Try again later." }; }
  });
}

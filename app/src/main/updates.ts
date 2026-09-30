import { app } from "electron";

/** Auto-update from GitHub Releases (electron-updater). Only the installed (NSIS) build updates itself; the portable zip is replaced by hand. */
export async function checkForUpdates(): Promise<{ message: string; version?: string }> {
  if (!app.isPackaged) return { message: "Updates are checked in the installed app." };
  try {
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;      // installs when the user closes the app: never interrupts a running job
    const r = await autoUpdater.checkForUpdates();
    const v = r?.updateInfo?.version;
    return v && v !== app.getVersion() ? { message: `Version ${v} is downloading. It will install when you close the app.`, version: v } : { message: "You have the latest version." };
  } catch { return { message: "Couldn’t check for updates. Try again later." }; }
}
/** Quietly look for an update shortly after launch, then every 6 hours. */
export function scheduleUpdateChecks() {
  if (!app.isPackaged) return;
  setTimeout(() => void checkForUpdates(), 45_000).unref();
  setInterval(() => void checkForUpdates(), 6 * 3600_000).unref();
}

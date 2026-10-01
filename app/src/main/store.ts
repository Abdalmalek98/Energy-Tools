import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = () => app.getPath("userData");
function atomicWrite(file: string, data: Buffer | string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, file);
}

export interface Settings { dateFormat: "DMY" | "MDY"; quality: "best" | "fast"; spaceRules: { keywords: string[]; type: string }[] | null; recent: string[] }
const DEFAULTS: Settings = { dateFormat: "DMY", quality: "best", spaceRules: null, recent: [] };
export const settingsStore = {
  file: () => join(dir(), "settings.json"),
  get(): Settings {
    try { return { ...DEFAULTS, ...JSON.parse(readFileSync(this.file(), "utf8")) }; } catch { return { ...DEFAULTS }; }
  },
  set(patch: Partial<Settings>): Settings {
    const s = { ...this.get(), ...patch }; atomicWrite(this.file(), JSON.stringify(s, null, 2)); return s;
  },
  addRecent(path: string) { const r = [path, ...this.get().recent.filter((p) => p !== path)].slice(0, 12); this.set({ recent: r }); },
};

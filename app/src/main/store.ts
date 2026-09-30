import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StoredLicense } from "./licenseCore";

const dir = () => app.getPath("userData");
function atomicWrite(file: string, data: Buffer | string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, file);
}

/** Licence store: encrypted with Windows DPAPI via safeStorage (lease, last server time seen, lock flag). */
export const licenseStore = {
  file: () => join(dir(), "license.bin"),
  load(): StoredLicense | null {
    try {
      const f = this.file(); if (!existsSync(f)) return null;
      const raw = readFileSync(f);
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
      return JSON.parse(json) as StoredLicense;
    } catch { return null; }
  },
  save(s: StoredLicense | null) {
    const f = this.file();
    if (!s) { try { atomicWrite(f, Buffer.alloc(0)); } catch { /* ignore */ } return; }
    const json = JSON.stringify(s);
    if (safeStorage.isEncryptionAvailable()) atomicWrite(f, safeStorage.encryptString(json));
    else if (!app.isPackaged) atomicWrite(f, json);          // dev/CI without a keyring only
    else throw new Error("Secure storage is not available on this PC.");
  },
};

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

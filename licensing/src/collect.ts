import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, hostname, networkInterfaces, platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hashComponent } from "./fingerprint";
import type { Comps } from "./types";

export interface CollectEnv {
  platform: string;
  /** Windows: `reg query <key> /v <value>` → value text, or null */
  regQuery(key: string, value: string): string | null;
  /** Windows: volume serial of the system drive, or null */
  volumeSerial(): string | null;
  readFile(path: string): string | null;
  hostname(): string;
  cpuModel(): string;
  macs(): string[];
  /** dev/CI fallback id, stable per install */
  devId(): string;
}

export function realCollectEnv(userDataDir: string): CollectEnv {
  const reg = (key: string, value: string) => {
    try {
      const out = execFileSync("reg.exe", ["query", key, "/v", value], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const m = out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, "i"));
      return m ? m[1].trim() : null;
    } catch { return null; }
  };
  return {
    platform: platform(),
    regQuery: reg,
    volumeSerial: () => {
      try { const out = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/c", "vol", (process.env.SystemDrive ?? "C:")], { encoding: "utf8", windowsHide: true, timeout: 8000 }); const m = out.match(/\b([0-9A-F]{4}-[0-9A-F]{4})\b/i); return m ? m[1] : null; } catch { return null; }
    },
    readFile: (p) => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } },
    hostname,
    cpuModel: () => cpus()[0]?.model ?? "",
    macs: () => Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => !!i && !i.internal && !!i.mac && i.mac !== "00:00:00:00:00:00")
      .map((i) => i.mac.toLowerCase()).filter((m) => !(parseInt(m.slice(0, 2), 16) & 2)),   // skip locally-administered (virtual) adapters
    devId: () => { const f = join(userDataDir, "dev-machine-id"); if (existsSync(f)) return readFileSync(f, "utf8").trim(); const id = randomUUID(); try { writeFileSync(f, id); } catch { /* read-only: fall back to a fresh id each run */ } return id; },
  };
}

const HK = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const BIOS = "HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS";
const CPU0 = "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0";

/**
 * Several independently hashed components (so one replaced part does not invalidate the licence; ≥ 60 % must still match).
 * Raw values never leave this function.
 */
export function collectComps(env: CollectEnv, salt: string): Comps {
  const raw: Record<string, string | null> = {};
  if (env.platform === "win32") {
    raw.guid = env.regQuery(HK, "MachineGuid");
    raw.cpu = [env.regQuery(CPU0, "ProcessorNameString"), env.regQuery(CPU0, "Identifier")].filter(Boolean).join("|") || env.cpuModel();
    raw.bios = ["SystemManufacturer", "SystemProductName", "BIOSVendor"].map((v) => env.regQuery(BIOS, v)).filter(Boolean).join("|");
    raw.board = ["BaseBoardManufacturer", "BaseBoardProduct"].map((v) => env.regQuery(BIOS, v)).filter(Boolean).join("|");
    raw.disk = env.volumeSerial();
  } else {
    raw.guid = env.readFile("/etc/machine-id") ?? env.devId();
    raw.cpu = env.cpuModel();
    raw.bios = ["product_name", "sys_vendor", "bios_vendor"].map((f) => env.readFile(`/sys/class/dmi/id/${f}`)).filter(Boolean).join("|");
    raw.board = ["board_name", "board_vendor"].map((f) => env.readFile(`/sys/class/dmi/id/${f}`)).filter(Boolean).join("|");
  }
  const macs = env.macs().sort(); raw.mac = macs.length ? macs.join(",") : null;
  raw.host = env.hostname();
  const out: Comps = {};
  for (const [k, v] of Object.entries(raw)) if (v) out[k] = hashComponent(k, v, salt);
  return out;
}

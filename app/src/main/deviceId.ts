import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** SHA-256(MachineGuid + app salt). MachineGuid from HKLM\SOFTWARE\Microsoft\Cryptography (no native module needed). */
export function machineGuid(userDataDir: string): string {
  if (process.platform === "win32") {
    const out = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true });
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    if (m) return m[1].toLowerCase();
    throw new Error("Could not read the Windows MachineGuid.");
  }
  // dev / CI on Linux & macOS: stable per-install id
  try { if (existsSync("/etc/machine-id")) return readFileSync("/etc/machine-id", "utf8").trim(); } catch { /* fall through */ }
  const f = join(userDataDir, "dev-machine-id");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  const id = randomUUID(); writeFileSync(f, id); return id;
}
export const deviceIdFor = (guid: string, salt: string) => createHash("sha256").update(guid + salt).digest("hex");

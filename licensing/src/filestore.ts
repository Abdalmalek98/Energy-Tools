import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AesBox } from "./aesbox";
import type { StoredLicense } from "./evaluate";
import type { Store } from "./client";

/** Encrypted licence file for non-Windows development builds and tests (Windows uses DPAPI via the Electron main process). */
export class AesFileStore implements Store {
  private box: AesBox;
  constructor(private path: string, secret: string) { this.box = new AesBox(secret); }
  load(): StoredLicense | null {
    if (!existsSync(this.path)) return null;
    const raw = readFileSync(this.path, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(this.box.open(raw)) as StoredLicense;          // throws if tampered or copied from another machine
  }
  save(s: StoredLicense | null) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp"; writeFileSync(tmp, s ? this.box.seal(JSON.stringify(s)) : ""); renameSync(tmp, this.path);
  }
}

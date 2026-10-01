import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AesFileStore, type Store, type StoredLicense } from "@lsr/licensing";

/**
 * Licence storage. Windows: encrypted with DPAPI (Electron safeStorage), bound to the Windows user account.
 * Non-Windows development builds: AES-256-GCM (AesFileStore). A file that cannot be decrypted (tampered, or copied to another PC/user)
 * makes load() throw; the client then discards it and asks for the code again.
 */
class DpapiStore implements Store {
  constructor(private file: string) {}
  load(): StoredLicense | null {
    if (!existsSync(this.file)) return null;
    const raw = readFileSync(this.file);
    if (!raw.length) return null;
    return JSON.parse(safeStorage.decryptString(raw)) as StoredLicense;
  }
  save(s: StoredLicense | null) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, s ? safeStorage.encryptString(JSON.stringify(s)) : Buffer.alloc(0));
    renameSync(tmp, this.file);
  }
}

export function createLicenseStore(secretForFallback: string): Store {
  const file = join(app.getPath("userData"), "license.dat");
  if (process.platform === "win32") {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows data protection (DPAPI) is not available, so the licence cannot be stored securely on this PC.");
    return new DpapiStore(file);
  }
  return new AesFileStore(file, secretForFallback);       // development only (non-Windows)
}

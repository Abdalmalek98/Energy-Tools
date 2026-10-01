import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * AES-256-GCM box for NON-Windows development builds only (Windows uses DPAPI through Electron safeStorage).
 * The key is derived from a machine secret, so a copied file does not decrypt elsewhere. Any change to the file fails authentication.
 */
export class AesBox {
  private key: Buffer;
  constructor(secret: string, salt = "lsr-store-v1") { this.key = scryptSync(secret, salt, 32); }
  seal(plain: string): string {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
  }
  /** Throws if the data was altered or belongs to another machine. */
  open(sealed: string): string {
    const b = Buffer.from(sealed, "base64");
    if (b.length < 29) throw new Error("damaged");
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  }
}

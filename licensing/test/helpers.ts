import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { signCode, signReceipt } from "../src/codec";
import { hashComponent } from "../src/fingerprint";
import { PRODUCT, type Comps, type KeyEntry, type Keyring, type LicensePayload, type ReceiptPayload } from "../src/types";

export interface TestKey { kid: string; priv: KeyObject; entry: KeyEntry }
export function makeKey(kid: string, extra: Partial<KeyEntry> = {}): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, priv: privateKey, entry: { kid, publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"), ...extra } };
}
export const SALT = "test-salt";
export const machine = (over: Comps = {}): Comps => ({
  guid: hashComponent("guid", "G-1", SALT), cpu: hashComponent("cpu", "Ryzen", SALT), bios: hashComponent("bios", "B-1", SALT),
  disk: hashComponent("disk", "D-1", SALT), mac: hashComponent("mac", "aa:bb", SALT), host: hashComponent("host", "PC1", SALT), ...over,
});
export const T0 = Date.parse("2026-06-01T00:00:00Z");
export const iso = (ms: number) => new Date(ms).toISOString();
export const DAY = 86_400_000;

export const licKey = makeKey("lic-1"), rcpKey = makeKey("srv-1");
export const keyring = (): Keyring => ({ license: [licKey.entry], receipt: [rcpKey.entry] });

export function payload(over: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1, licenseId: "L-TEST-0001", product: PRODUCT, customer: "Jane Doe", company: "Acme Energy", issuedAt: iso(T0 - DAY), notBefore: iso(T0 - DAY),
    expiresAt: iso(T0 + 365 * DAY), maxActivations: 1, offline: false, machine: { mode: "first" }, features: {}, kid: "lic-1", ...over,
  };
}
export const code = (over: Partial<LicensePayload> = {}, key = licKey) => signCode(payload({ kid: key.kid, ...over }), key.priv);
export function receipt(over: Partial<ReceiptPayload> = {}, key = rcpKey) {
  const p: ReceiptPayload = {
    v: 1, kid: key.kid, licenseId: "L-TEST-0001", activationId: "A-1", product: PRODUCT, status: "active", nonce: "n-1", issuedAt: iso(T0),
    validUntil: iso(T0 + 7 * DAY), expiresAt: iso(T0 + 365 * DAY), features: {}, ...over,
  };
  return signReceipt(p, key.priv);
}

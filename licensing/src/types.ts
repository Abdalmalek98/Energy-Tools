export const PRODUCT = "lighting-survey-reader";
export const CODE_PREFIX = "LSR1";
export const RECEIPT_PREFIX = "RCP1";
export const MACHINE_ID_PREFIX = "MID1";

/** Hashed hardware components, e.g. { guid: "ab12…", cpu: "…", bios: "…" }. Never raw values. */
export type Comps = Record<string, string>;

export type BindingMode = "none" | "first" | "specific";

/** The signed content of an activation code ("LSR1.<payload>.<signature>"). */
export interface LicensePayload {
  v: 1;
  licenseId: string;
  product: string;
  customer: string;
  company: string;
  issuedAt: string;                 // ISO 8601 UTC
  notBefore: string;                // ISO 8601 UTC
  expiresAt: string | null;         // null = perpetual
  maxActivations: number;
  offline: boolean;                 // true = signed offline licence, machine-bound, activates with no server contact
  machine: { mode: BindingMode; comps?: Comps };
  features: Record<string, unknown>;
  kid: string;
}

/** A public key in a keyring (base64 DER SPKI). */
export interface KeyEntry {
  kid: string;
  publicKey: string;
  notBefore?: string;
  notAfter?: string;
  revoked?: boolean;
  /** development key: refused by release builds even if it is somehow present */
  dev?: boolean;
}
export interface Keyring { license: KeyEntry[]; receipt: KeyEntry[] }

export type ReceiptStatus = "active" | "suspended" | "revoked" | "expired" | "deactivated";

/** Signed by the licensing server ("RCP1.<payload>.<signature>"). */
export interface ReceiptPayload {
  v: 1;
  kid: string;
  licenseId: string;
  activationId: string;
  product: string;
  status: ReceiptStatus;
  nonce: string;                    // echoes the client's request nonce (replay protection)
  issuedAt: string;                 // server time
  validUntil: string;               // offline grace: after this the client must validate again
  expiresAt: string | null;         // effective licence expiry as the server sees it (renewals/extensions)
  features: Record<string, unknown>;
  message?: string;
}

export type Failure =
  | "format" | "unknown_key" | "key_revoked" | "key_expired" | "dev_key_in_release" | "bad_signature" | "wrong_product" | "bad_payload";
export type Verified<T> = { ok: true; payload: T; kid: string } | { ok: false; reason: Failure; message: string };

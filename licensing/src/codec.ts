import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { CODE_PREFIX, RECEIPT_PREFIX, type Failure, type KeyEntry, type LicensePayload, type ReceiptPayload, type Verified } from "./types";

export const b64u = (b: Uint8Array | Buffer | string) => Buffer.from(b as never).toString("base64url");
export const unb64u = (s: string) => Buffer.from(s, "base64url");
const MESSAGES: Record<Failure, string> = {
  format: "That is not a valid activation code.",
  unknown_key: "This code was signed with a key this version of the app does not know. Please update the app or contact support.",
  key_revoked: "The key that signed this code has been withdrawn. Please contact support for a new code.",
  key_expired: "The key that signed this code is no longer valid. Please contact support for a new code.",
  dev_key_in_release: "This is a development code and cannot be used in this build.",
  bad_signature: "The activation code is damaged or has been altered.",
  wrong_product: "This code is for a different product.",
  bad_payload: "The activation code is incomplete.",
};
const fail = (reason: Failure): { ok: false; reason: Failure; message: string } => ({ ok: false, reason, message: MESSAGES[reason] });

/** Users paste codes with line breaks and spaces: remove all whitespace and zero-width characters. */
export const cleanCode = (t: string) => t.replace(/[\s​-‍﻿]+/g, "");

function splitSigned(text: string, prefix: string): { signed: string; payloadB64: string; sig: Buffer } | null {
  const parts = cleanCode(text).split(".");
  if (parts.length !== 3 || parts[0] !== prefix || !parts[1] || !parts[2]) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
  const sig = unb64u(parts[2]);
  if (sig.length !== 64) return null;
  return { signed: `${parts[0]}.${parts[1]}`, payloadB64: parts[1], sig };
}

function checkKey(entry: KeyEntry | undefined, nowMs: number, releaseBuild: boolean): Failure | null {
  if (!entry) return "unknown_key";
  if (entry.dev && releaseBuild) return "dev_key_in_release";
  if (entry.revoked) return "key_revoked";
  if (entry.notBefore && nowMs < Date.parse(entry.notBefore)) return "key_expired";
  if (entry.notAfter && nowMs > Date.parse(entry.notAfter)) return "key_expired";
  return null;
}
const pubKey = (e: KeyEntry): KeyObject => createPublicKey({ key: Buffer.from(e.publicKey, "base64"), format: "der", type: "spki" });

export interface VerifyOpts { keys: KeyEntry[]; nowMs?: number; releaseBuild?: boolean }

/** Signs "<prefix>.<payload>" with Ed25519. Used by tests and by the optional server-side issuer, never by the customer app. */
export function signCode(payload: LicensePayload, privateKey: KeyObject): string {
  const signed = `${CODE_PREFIX}.${b64u(JSON.stringify(payload))}`;
  return `${signed}.${b64u(sign(null, Buffer.from(signed), privateKey))}`;
}
export function signReceipt(payload: ReceiptPayload, privateKey: KeyObject): string {
  const signed = `${RECEIPT_PREFIX}.${b64u(JSON.stringify(payload))}`;
  return `${signed}.${b64u(sign(null, Buffer.from(signed), privateKey))}`;
}

function verifyGeneric<T extends { kid: string }>(text: string, prefix: string, o: VerifyOpts): Verified<T> {
  const s = splitSigned(text, prefix);
  if (!s) return fail("format");
  let payload: T;
  try { payload = JSON.parse(unb64u(s.payloadB64).toString("utf8")) as T; } catch { return fail("format"); }
  if (!payload || typeof payload !== "object" || typeof payload.kid !== "string") return fail("bad_payload");
  const entry = o.keys.find((k) => k.kid === payload.kid);
  const bad = checkKey(entry, o.nowMs ?? Date.now(), !!o.releaseBuild);
  if (bad) return fail(bad);
  let ok = false;
  try { ok = verify(null, Buffer.from(s.signed), pubKey(entry!), s.sig); } catch { ok = false; }
  return ok ? { ok: true, payload, kid: payload.kid } : fail("bad_signature");
}

const isIso = (x: unknown) => typeof x === "string" && !Number.isNaN(Date.parse(x));
export function verifyCode(text: string, o: VerifyOpts & { product: string }): Verified<LicensePayload> {
  const r = verifyGeneric<LicensePayload>(text, CODE_PREFIX, o);
  if (!r.ok) return r;
  const p = r.payload;
  const shapeOk = p.v === 1 && typeof p.licenseId === "string" && p.licenseId && typeof p.product === "string" && isIso(p.issuedAt) && isIso(p.notBefore) &&
    (p.expiresAt === null || isIso(p.expiresAt)) && Number.isInteger(p.maxActivations) && p.maxActivations >= 1 && typeof p.offline === "boolean" &&
    !!p.machine && ["none", "first", "specific"].includes(p.machine.mode) && (p.machine.mode !== "specific" || (!!p.machine.comps && Object.keys(p.machine.comps).length > 0)) &&
    typeof p.customer === "string" && typeof p.company === "string" && !!p.features && typeof p.features === "object";
  if (!shapeOk) return fail("bad_payload");
  if (p.product !== o.product) return fail("wrong_product");
  return r;
}
export function verifyReceipt(text: string, o: VerifyOpts & { product: string; nonce?: string; licenseId?: string }): Verified<ReceiptPayload> {
  const r = verifyGeneric<ReceiptPayload>(text, RECEIPT_PREFIX, o);
  if (!r.ok) return r;
  const p = r.payload;
  if (p.v !== 1 || !isIso(p.issuedAt) || !isIso(p.validUntil) || typeof p.licenseId !== "string" || typeof p.activationId !== "string" || typeof p.nonce !== "string") return fail("bad_payload");
  if (p.product !== o.product) return fail("wrong_product");
  if (o.nonce !== undefined && p.nonce !== o.nonce) return { ok: false, reason: "bad_payload", message: "The server response does not match this request (possible replay)." };
  if (o.licenseId !== undefined && p.licenseId !== o.licenseId) return { ok: false, reason: "bad_payload", message: "The server response is for a different licence." };
  return r;
}

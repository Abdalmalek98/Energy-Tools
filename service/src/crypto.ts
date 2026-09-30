// WebCrypto only: runs in Workers, Node 20+ and browsers.
const enc = new TextEncoder();

export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

/** 20 Crockford chars from a CSPRNG (32 symbols => byte & 31 is unbiased), grouped XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let raw = "";
  for (const b of bytes) raw += CROCKFORD[b & 31];
  return raw.match(/.{5}/g)!.join("-");
}
/** Normalise user input: upper-case, strip separators, Crockford aliases (I,L→1, O→0). Returns null if not 20 valid chars. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== 20) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}
export const hashCode = (normalized: string) => sha256Hex("lsr-code:" + normalized);

// ---- Ed25519 lease tokens (compact JWS, alg EdDSA) ----
export interface LeasePayload {
  v: 1;
  cid: number;          // code id
  did: number;          // device row id
  end: number | null;   // licence end (epoch s) or null = no end
  iat: number;
  exp: number;          // lease expiry (epoch s)
  ql: number | null;    // pages left this month, null = unlimited
}
const ed = { name: "Ed25519" } as const;

export async function signLease(payload: LeasePayload, privateKeyB64Pkcs8: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", unb64(privateKeyB64Pkcs8), ed, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ alg: "EdDSA", typ: "lease" })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign(ed, key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}
/** Verifies signature only (NOT expiry: server truth is the DB; exp is the client's offline grace). */
export async function verifyLease(token: string, publicKeyB64Spki: string): Promise<LeasePayload | null> {
  try {
    const [h, b, s] = token.split(".");
    if (!h || !b || !s) return null;
    const key = await crypto.subtle.importKey("spki", unb64(publicKeyB64Spki), ed, false, ["verify"]);
    const ok = await crypto.subtle.verify(ed, key, unb64u(s), enc.encode(`${h}.${b}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(b))) as LeasePayload;
    return p.v === 1 ? p : null;
  } catch {
    return null;
  }
}

// ---- HMAC (admin session cookie) ----
export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

// ---- PBKDF2 password hash: pbkdf2$iters$salt$hash (workerd caps iterations at 100000) ----
export async function pbkdf2(password: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, k, 256));
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2" || !it || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64u(salt), parseInt(it, 10));
  return timingSafeEqual(b64u(got), hash);
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("bad base32");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
export async function totpAt(secretB32: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, step >>> 0);
  new DataView(msg.buffer).setUint32(0, Math.floor(step / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
/** Returns the matching time step (±1 window) or null. */
export async function verifyTotp(secretB32: string, code: string, nowSec: number): Promise<number | null> {
  const step = Math.floor(nowSec / 30);
  for (const s of [step, step - 1, step + 1]) {
    if (timingSafeEqual(await totpAt(secretB32, s), code.trim())) return s;
  }
  return null;
}

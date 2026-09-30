// Signing-key handling. Private keys come from the environment / secure storage – NEVER from source code.
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const b64u = (b) => Buffer.from(b).toString('base64url');

export class KeyRing {
  /** @param {Record<string,string>} pemByKid PKCS8 PEM per key id */
  constructor(pemByKid, activeKid) {
    this.priv = new Map();
    this.pub = new Map();
    for (const [kid, pem] of Object.entries(pemByKid)) {
      const k = createPrivateKey(pem);
      this.priv.set(kid, k);
      this.pub.set(kid, createPublicKey(k));
    }
    this.activeKid = activeKid ?? Object.keys(pemByKid)[0];
    if (!this.priv.has(this.activeKid)) throw new Error(`Active signing key "${this.activeKid}" is not loaded`);
  }

  /** CPA_SIGNING_KEY_<kid> = PEM (or base64 of PEM);  CPA_SIGNING_KEY_FILE_<kid> = path to PEM file. */
  static fromEnv(env = process.env) {
    const pems = {};
    for (const [name, val] of Object.entries(env)) {
      let m;
      if ((m = name.match(/^CPA_SIGNING_KEY_FILE_(.+)$/)) && val) pems[m[1]] = readFileSync(val, 'utf8');
      else if ((m = name.match(/^CPA_SIGNING_KEY_(?!FILE_)(.+)$/)) && val) pems[m[1]] = val.includes('BEGIN') ? val : Buffer.from(val, 'base64').toString('utf8');
    }
    if (!Object.keys(pems).length) throw new Error('No signing key configured. Set CPA_SIGNING_KEY_<keyId> or CPA_SIGNING_KEY_FILE_<keyId> (see .env.example).');
    return new KeyRing(pems, env.CPA_ACTIVE_KEY_ID);
  }

  /** Envelope: `<prefix>.<base64url(JSON payload)>.<base64url(Ed25519 signature over "<prefix>.<payload>")>` */
  seal(prefix, payload) {
    const body = { ...payload, kid: this.activeKid };
    const p = b64u(JSON.stringify(body));
    const sig = edSign(null, Buffer.from(`${prefix}.${p}`), this.priv.get(this.activeKid));
    return `${prefix}.${p}.${b64u(sig)}`;
  }

  /** Verify an envelope with any loaded key. Returns the payload or throws. */
  open(prefix, token) {
    const parts = String(token).replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== prefix) throw new Error('malformed');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const pub = this.pub.get(payload.kid);
    if (!pub) throw new Error('unknown_key');
    if (!edVerify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2], 'base64url'))) throw new Error('bad_signature');
    return payload;
  }

  /** Public keyring entries (raw 32-byte keys, base64) for embedding in the desktop app. */
  publicEntries() {
    return [...this.pub.entries()].map(([kid, k]) => ({ kid, alg: 'ed25519', public: k.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') }));
  }
}

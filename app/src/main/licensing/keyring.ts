import type { KeyEntry, Keyring } from "@lsr/licensing";
import { DEBUG_KEYRING } from "./keyring.debug";

/**
 * The keys this build trusts (public keys only; no private key, admin credential or issuing code exists in the app).
 *  - production keys come from licensing/keys/production.json at build time (a release build fails without them);
 *  - development keys exist only when __DEBUG_KEYS__ is true, and are additionally refused at run time by release builds.
 * Several keys can be present at once (identified by kid), which is how keys are rotated.
 */
export function buildKeyring(): Keyring {
  const prod = JSON.parse(__PROD_KEYS__) as Partial<Keyring>;
  const keyring: Keyring = { license: [...(prod.license ?? [])], receipt: [...(prod.receipt ?? [])] };
  if (__DEBUG_KEYS__) {
    const add = (list: KeyEntry[], more: KeyEntry[]) => list.push(...more.filter((m) => !list.some((x) => x.kid === m.kid)));
    add(keyring.license, DEBUG_KEYRING.license); add(keyring.receipt, DEBUG_KEYRING.receipt);
    const extra = JSON.parse(__EXTRA_KEYS__) as Partial<Keyring>;                    // E2E / developer keys injected at build time (debug builds only)
    add(keyring.license, (extra.license ?? []).map((k) => ({ ...k, dev: true })));
    add(keyring.receipt, (extra.receipt ?? []).map((k) => ({ ...k, dev: true })));
  }
  return keyring;
}
/** true in release builds: development keys are then refused even if one were present. */
export const RELEASE_BUILD = !__DEBUG_KEYS__;

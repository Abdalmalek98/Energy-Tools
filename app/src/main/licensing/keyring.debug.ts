// DEBUG-ONLY keyring. This file is imported behind `if (__DEBUG_KEYS__)`, so release builds (LSR_RELEASE=1) compile it out;
// scripts/release-gate.sh also fails the release if the bundle still contains this key id.
// It holds a development PUBLIC key (kid "dev-1", marked dev:true). Its private half was never kept: tests and E2E generate their own throw-away keys.
// To sign development codes yourself, run scripts/gen-license-key.sh --dev and add your public key to a local, untracked file.
import type { Keyring } from "@lsr/licensing";

export const DEBUG_KEYRING: Keyring = {
  license: [{ kid: "dev-1", publicKey: "MCowBQYDK2VwAyEAWv8hZJedNoEKWlPwYZ7oZ4wZBfnykiMV2k6gxowyNaY=", dev: true }],
  receipt: [{ kid: "dev-srv-1", publicKey: "MCowBQYDK2VwAyEAWv8hZJedNoEKWlPwYZ7oZ4wZBfnykiMV2k6gxowyNaY=", dev: true }],
};

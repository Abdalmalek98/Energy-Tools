# DEV-ONLY signing key

`dev-private-key.pem` is a throw-away Ed25519 key (`kid = dev-1`) that is committed **on purpose** so that
automated tests and local development can issue licenses. It is NOT a secret and has no value in production:

* the desktop app only trusts `dev-1` in **debug** builds (`cfg!(debug_assertions)`); release builds reject it;
* `scripts/check-release-keys.mjs` fails the release build if the embedded keyring still contains a `dev` key.

The production private key is generated with `npm run keygen -- <keyId>` and must never enter the repository.

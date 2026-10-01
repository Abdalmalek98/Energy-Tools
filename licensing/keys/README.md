# Production public keys (the only keys a release build trusts)

`production.json` lists PUBLIC keys only. It is compiled into the app and read by the licensing server and by `scripts/offline-license.sh`.

* `license`: keys that sign activation codes (yours; generate with `scripts/gen-license-key.sh`).
* `receipt`: keys the licensing server signs its receipts with (generate on the server with `scripts/gen-license-key.sh --role receipt`).

One entry per line is the easiest to edit and is what the scripts parse:

```json
{
  "license": [
    {"kid":"lic-1","publicKey":"MCowBQYDK2VwAyEA…"}
  ],
  "receipt": [
    {"kid":"srv-1","publicKey":"MCowBQYDK2VwAyEA…"}
  ]
}
```

It is empty on purpose until you send the public keys. `scripts/release-gate.sh` refuses to build a release while either list is empty, contains a development key, or is malformed.
To rotate a key see docs/LICENSING.md.

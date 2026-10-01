#!/usr/bin/env bash
# Release gate. Fails (exit 1) unless a RELEASE build is safe to ship. Needs only bash + OpenSSL.
#   scripts/release-gate.sh            before building: production keys, service URL, env
#   scripts/release-gate.sh --post     after building:  the bundle must not contain development keys / E2E mode / a local URL
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS="${LSR_KEYS_FILE:-$HERE/../licensing/keys/production.json}"
BUNDLE="${LSR_BUNDLE:-$HERE/../app/out/main/index.js}"
ERR=0
bad() { echo "RELEASE GATE FAILED: $*" >&2; ERR=1; }

keys_in() { # $1 = license|receipt -> one compact object per line
  tr -d '\n\r' < "$KEYS" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' | grep -o '{[^{}]*}' || true
}
check_key() { # $1 label, $2 object
  local kid pub n
  kid="$(printf '%s' "$2" | sed -n 's/.*"kid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  pub="$(printf '%s' "$2" | sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$kid" ] && [ -n "$pub" ] || { bad "$1 key without kid/publicKey: $2"; return; }
  case "$kid" in dev*|*-dev*|*test*) bad "$1 key \"$kid\" looks like a development key"; return ;; esac
  printf '%s' "$2" | grep -q '"dev"[[:space:]]*:[[:space:]]*true' && { bad "$1 key \"$kid\" is flagged dev"; return; }
  n="$(printf '%s' "$pub" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ')"
  [ "$n" = 44 ] || { bad "$1 key \"$kid\" is not a base64 Ed25519 SPKI key (44 bytes expected, got $n)"; return; }
  { echo "-----BEGIN PUBLIC KEY-----"; printf '%s' "$pub" | fold -w 64; echo; echo "-----END PUBLIC KEY-----"; } | openssl pkey -pubin -noout -text 2>/dev/null | head -n1 | grep -qi ED25519 \
    || bad "$1 key \"$kid\" is not an Ed25519 public key"
}

if [ "${1:-}" != "--post" ]; then
  command -v openssl >/dev/null || bad "openssl not found"
  [ -f "$KEYS" ] || bad "$KEYS is missing"
  if [ -f "$KEYS" ]; then
    for role in license receipt; do
      list="$(keys_in "$role")"
      [ -n "$list" ] || { bad "no production $role key in $KEYS (generate one with scripts/gen-license-key.sh$([ $role = receipt ] && echo ' --role receipt') and add its public key)"; continue; }
      while IFS= read -r obj; do check_key "$role" "$obj"; done <<< "$list"
    done
  fi
  case "${LSR_SERVICE_URL:-}" in https://*) : ;; *) bad "LSR_SERVICE_URL must be your real https:// server address" ;; esac
  case "${LSR_SERVICE_URL:-}" in *localhost*|*127.0.0.1*|*REPLACE-ME*|*example.com*) bad "LSR_SERVICE_URL points at a local/placeholder address" ;; esac
  [ "${LSR_E2E:-}" != 1 ] || bad "LSR_E2E must not be set in a release build"
  [ "${LSR_RELEASE:-}" = 1 ] || bad "LSR_RELEASE=1 is not set: development keys would be compiled in"
else
  [ -f "$BUNDLE" ] || bad "$BUNDLE not found: build first"
  if [ -f "$BUNDLE" ]; then
    grep -q "dev-1\|dev-srv-1\|keyring\.debug\|DEBUG_KEYRING" "$BUNDLE" && bad "the bundle still contains the development keyring"
    grep -Eq "e2e = (true|isDev)" "$BUNDLE" && bad "the bundle was built in E2E mode (scripted file dialogs)"
    grep -Eo 'https?://[^"'"'"'` )]+' "$BUNDLE" | grep -Eq '127\.0\.0\.1|localhost|REPLACE-ME' && bad "the bundle points at a local/placeholder server URL"
    for role in license receipt; do
      while IFS= read -r obj; do
        kid="$(printf '%s' "$obj" | sed -n 's/.*"kid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
        [ -n "$kid" ] && ! grep -q "\"$kid\"\|$kid" "$BUNDLE" && bad "production $role key \"$kid\" is not in the bundle"
      done <<< "$(keys_in "$role")"
    done
  fi
fi
[ "$ERR" = 0 ] && { echo "Release gate passed."; exit 0; }
exit 1

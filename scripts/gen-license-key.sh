#!/usr/bin/env bash
# Generates an Ed25519 signing key with OpenSSL (needs only bash + OpenSSL 3; works in Git Bash on Windows).
#
#   scripts/gen-license-key.sh                       -> your LICENCE signing key  (private-keys/license-key.pem, kid lic-1)
#   scripts/gen-license-key.sh --role receipt        -> the SERVER's receipt key  (run it on the server; kid srv-1)
#   scripts/gen-license-key.sh --kid lic-2 --out private-keys/license-key-2.pem     (rotation: a second key)
#
# The PRIVATE key never leaves the machine that generated it. Only the public key (printed at the end) is shared.
set -euo pipefail
ROLE=license; KID=""; OUT=""; DEV=0
die() { echo "ERROR: $*" >&2; exit "${2:-2}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="${2:?}"; shift 2 ;;
    --kid) KID="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --dev) DEV=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[ "$ROLE" = license ] || [ "$ROLE" = receipt ] || die "--role must be license or receipt"
[ -n "$KID" ] || { if [ "$ROLE" = license ]; then KID=lic-1; else KID=srv-1; fi; [ "$DEV" = 1 ] && KID="dev-$KID"; }
[ -n "$OUT" ] || { if [ "$ROLE" = license ]; then OUT=private-keys/license-key.pem; else OUT=private-keys/receipt-key.pem; fi; [ "$DEV" = 1 ] && OUT="${OUT%.pem}-dev.pem"; }
[[ "$KID" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || die "kid may contain letters, digits . _ - only (max 32)"
command -v openssl >/dev/null || die "openssl not found"
openssl version | grep -q "OpenSSL 3" || die "OpenSSL 3.x is required (Git Bash for Windows ships it). Found: $(openssl version)"
[ ! -e "$OUT" ] || die "$OUT already exists. Refusing to overwrite a private key. Pick another --out."

mkdir -p "$(dirname "$OUT")"
( umask 077; openssl genpkey -algorithm ED25519 -out "$OUT" ) || die "key generation failed" 5
chmod 600 "$OUT" 2>/dev/null || true
PUB=$(openssl pkey -in "$OUT" -pubout -outform DER | openssl base64 -A)
DEVJSON=""; [ "$DEV" = 1 ] && DEVJSON=',"dev":true'

{
  echo
  echo "Created PRIVATE key : $OUT   (kid: $KID)"
  echo "  - Keep it secret. Back it up somewhere safe (a password manager or an encrypted USB stick)."
  echo "  - NEVER paste it into a chat, e-mail or issue, and never commit it (private-keys/ and *.pem are git-ignored)."
  echo
  echo "Send ONLY this public key line (it is safe to share):"
  echo
} >&2
printf '{"kid":"%s","publicKey":"%s"%s}\n' "$KID" "$PUB" "$DEVJSON"
echo >&2
echo "Role: $ROLE. Add that line to licensing/keys/production.json under \"$ROLE\"." >&2

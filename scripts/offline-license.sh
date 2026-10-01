#!/usr/bin/env bash
# Create an OFFLINE activation code signed with your production key – needs only bash + OpenSSL 3 (Git Bash is fine).
# No Node.js and no licensing server required. The customer's PC never contacts any server for this code.
#
#   scripts/offline-license.sh --key ~/cpa-keys/k2.private.pem --kid k2 \
#       --machine MID1.xxxxx  --customer "Abdalmalek" [--days 365 | --perpetual] [--company "ACME"] [--id CPA-OFF-0001]
#
# --machine  the Machine ID shown on the application's activation / License screen (required: an offline code is
#            valid on that computer only). Output: the activation code (paste into the app).
# Offline codes cannot be revoked remotely – give short expiries to anyone but yourself.
set -euo pipefail

KEY=""; KID="k2"; MACHINE=""; CUSTOMER=""; COMPANY=""; DAYS=""; PERPETUAL=0; LID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2;; --kid) KID="$2"; shift 2;; --machine) MACHINE="$2"; shift 2;;
    --customer) CUSTOMER="$2"; shift 2;; --company) COMPANY="$2"; shift 2;; --days) DAYS="$2"; shift 2;;
    --perpetual) PERPETUAL=1; shift;; --id) LID="$2"; shift 2;;
    -h|--help) sed -n '2,11p' "$0"; exit 0;; *) echo "unknown option $1" >&2; exit 2;;
  esac
done
[ -f "$KEY" ] || { echo "Private key file not found: --key $KEY" >&2; exit 2; }
[ -n "$CUSTOMER" ] || { echo "--customer is required" >&2; exit 2; }
case "$MACHINE" in MID1.*) ;; *) echo "--machine must be the Machine ID (starts with MID1.) shown in the application" >&2; exit 2;; esac
if [ "$PERPETUAL" = 0 ] && ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then echo "Give --days N or --perpetual" >&2; exit 2; fi
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 2; }
[[ "$CUSTOMER$COMPANY$KID$LID" =~ ^[A-Za-z0-9\ ._@-]*$ ]] || { echo "Use only letters, digits, space . _ @ - in names/ids" >&2; exit 2; }

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
b64url_decode() { local s="$1"; s="${s//-/+}"; s="${s//_//}"; while [ $(( ${#s} % 4 )) -ne 0 ]; do s="$s="; done; printf %s "$s" | base64 -d; }

MID_JSON="$(b64url_decode "${MACHINE#MID1.}")"                 # {"fp":"…","parts":["…",…]}
case "$MID_JSON" in '{"fp":"'*'"parts":['*']}') ;; *) echo "Machine ID is not valid" >&2; exit 2;; esac
BIND="{\"mode\":\"specific\",${MID_JSON#\{}"                    # splice fp/parts into the binding

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$PERPETUAL" = 1 ]; then EXP="null"; else EXP="\"$(date -u -d "+${DAYS} days" +%Y-%m-%dT%H:%M:%SZ)\""; fi
[ -n "$LID" ] || LID="CPA-OFF-$(date -u +%Y%m%d)-$(openssl rand -hex 3 | tr a-f A-F)"

PAYLOAD="{\"v\":1,\"lid\":\"$LID\",\"product\":\"Chiller Plant Analyzer\",\"customer\":\"$CUSTOMER\",\"company\":\"$COMPANY\",\"iat\":\"$NOW\",\"nbf\":\"$NOW\",\"exp\":$EXP,\"maxAct\":1,\"bind\":$BIND,\"features\":{\"bmsAnalysis\":true,\"flukeAnalysis\":true,\"excelExport\":true,\"plantAnalysis\":true,\"advancedRegression\":true},\"off\":1,\"kid\":\"$KID\"}"
P64="$(printf %s "$PAYLOAD" | b64url)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
printf %s "CPA1.$P64" > "$TMP"
SIG="$(openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$TMP" | b64url)"
[ -n "$SIG" ] || { echo "signing failed (needs OpenSSL 3 and an Ed25519 key)" >&2; exit 1; }

# ---- self-check 1: does this private key match the public key built into the application?
RAW_PUB="$(openssl pkey -in "$KEY" -pubout -outform DER | tail -c 32 | base64 -w0)"
KEYFILE="$(dirname "$0")/../src-tauri/licensing-core/keys/public-keys.json"
if [ -f "$KEYFILE" ]; then
  EMBEDDED="$(tr -d '\n\r ' < "$KEYFILE" | grep -o "\"kid\":\"$KID\"[^}]*" | grep -o '"public":"[^"]*"' | cut -d'"' -f4 || true)"
  if [ -z "$EMBEDDED" ]; then
    echo "WARNING: key id '$KID' is not in $KEYFILE – the application will reject this code." >&2
  elif [ "$EMBEDDED" != "$RAW_PUB" ]; then
    echo "ERROR: this private key does NOT match the public key '$KID' built into the application." >&2
    echo "  public key of --key file : $RAW_PUB" >&2
    echo "  public key in the app    : $EMBEDDED" >&2
    echo "  The app will say 'invalid signature'. Use the original private key file, or send the new public key so it can be installed." >&2
    exit 3
  fi
fi
# ---- self-check 2: verify the signature we just made
PUBPEM="$(mktemp)"; SIGFILE="$(mktemp)"; trap 'rm -f "$TMP" "$PUBPEM" "$SIGFILE"' EXIT
openssl pkey -in "$KEY" -pubout -out "$PUBPEM"
printf %s "$SIG" | tr '_-' '/+' | { cat; printf '=='; } | base64 -d 2>/dev/null > "$SIGFILE" || true
openssl pkeyutl -verify -pubin -inkey "$PUBPEM" -rawin -in "$TMP" -sigfile "$SIGFILE" >/dev/null 2>&1 || { echo "ERROR: local signature check failed – your OpenSSL cannot create Ed25519 signatures correctly (need OpenSSL 3)." >&2; exit 4; }
echo "Self-check OK: key matches the application and the signature verifies." >&2
echo "License ID : $LID" >&2
echo "Customer   : $CUSTOMER" >&2
echo "Expires    : $( [ "$PERPETUAL" = 1 ] && echo never || echo "${EXP//\"/}" )" >&2
echo "Activation code (paste into the application):" >&2
echo "CPA1.$P64.$SIG"

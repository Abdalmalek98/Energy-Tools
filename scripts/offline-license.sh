#!/usr/bin/env bash
# Creates a signed activation code ("LSR1.<payload>.<signature>") with ONLY bash + OpenSSL 3 (works in Git Bash for Windows).
#
# Usage:
#   bash scripts/offline-license.sh --key ~/lsr-private-keys/license-key.pem --kid lic-1 \
#       --customer "Jane Doe" --company "Acme Energy" --machine-id MID1.xxxxx \
#       [--days 365 | --expires 2027-12-31 | --perpetual] [--not-before 2026-10-01] \
#       [--max-activations 1] [--pages-per-month 500] [--features '{"key":"value"}'] \
#       [--online] [--binding first|none] [--license-id L-...] [--keys-file licensing/keys/production.json]
#
#   Default = OFFLINE licence: tied to one computer (needs the customer's --machine-id), activates with no server contact.
#   --online  = online licence: activates and validates against the licensing server; --machine-id is optional (binds to that PC).
#
# stdout: the activation code (last line).  stderr: everything else (details, warnings, errors).
# Exit codes: 2 usage · 3 private key does not match the public key embedded in the app · 4 invalid input · 5 OpenSSL/verification failure.
set -euo pipefail

PRODUCT="lighting-survey-reader"; PREFIX="LSR1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY=""; KID=""; CUSTOMER=""; COMPANY=""; MID=""; DAYS=""; EXPIRES=""; PERPETUAL=0; NOTBEFORE=""; MAXACT=1; ONLINE=0; BINDING=""
FEATURES=""; PPM=""; LID=""; KEYS_FILE="${LSR_KEYS_FILE:-$HERE/../licensing/keys/production.json}"

die() { echo "ERROR: $1" >&2; exit "${2:-4}"; }
usage() { sed -n '2,17p' "$0" >&2; exit 2; }
[ $# -gt 0 ] || usage
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="${2:?--key needs a file}"; shift 2 ;;
    --kid) KID="${2:?--kid needs a value}"; shift 2 ;;
    --customer) CUSTOMER="${2:?}"; shift 2 ;;
    --company) COMPANY="${2:-}"; shift 2 ;;
    --machine-id) MID="${2:?}"; shift 2 ;;
    --days) DAYS="${2:?}"; shift 2 ;;
    --expires) EXPIRES="${2:?}"; shift 2 ;;
    --perpetual) PERPETUAL=1; shift ;;
    --not-before) NOTBEFORE="${2:?}"; shift 2 ;;
    --max-activations) MAXACT="${2:?}"; shift 2 ;;
    --pages-per-month) PPM="${2:?}"; shift 2 ;;
    --features) FEATURES="${2:?}"; shift 2 ;;
    --online) ONLINE=1; shift ;;
    --binding) BINDING="${2:?}"; shift 2 ;;
    --license-id) LID="${2:?}"; shift 2 ;;
    --keys-file) KEYS_FILE="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" 2 ;;
  esac
done

# ---------- tools ----------
command -v openssl >/dev/null || die "openssl not found" 5
openssl version | grep -q "OpenSSL 3" || die "OpenSSL 3.x is required. Found: $(openssl version)" 5
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ---------- helpers ----------
b64u_enc() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
b64u_dec() { local s; s="$(printf '%s' "$1" | tr '_-' '/+')"; while [ $(( ${#s} % 4 )) -ne 0 ]; do s="$s="; done; printf '%s' "$s" | openssl base64 -d -A; }
json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\t'/ }"; s="${s//$'\r'/}"; s="${s//$'\n'/ }"; printf '%s' "$s"; }
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ---------- inputs ----------
[ -n "$KEY" ] || die "--key (your private key file) is required" 2
[ -f "$KEY" ] || die "Private key file not found: $KEY"
[ -n "$KID" ] || die "--kid (the key id, e.g. lic-1) is required" 2
[[ "$KID" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || die "Bad --kid"
[ -n "$CUSTOMER" ] || die "--customer is required" 2
[[ "$MAXACT" =~ ^[1-9][0-9]{0,3}$ ]] || die "--max-activations must be a whole number 1-9999"
[ -z "$PPM" ] || [[ "$PPM" =~ ^[1-9][0-9]{0,6}$ ]] || die "--pages-per-month must be a whole number"
[ -z "$BINDING" ] || [ "$BINDING" = first ] || [ "$BINDING" = none ] || die "--binding must be first or none"
[ -z "$LID" ] || [[ "$LID" =~ ^[A-Za-z0-9._-]{4,64}$ ]] || die "Bad --license-id"
[ -f "$KEYS_FILE" ] || die "Keys file not found: $KEYS_FILE (the file that lists the public keys built into the app)"

# validity
NOW="$(iso_now)"
if [ -n "$NOTBEFORE" ]; then
  [[ "$NOTBEFORE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--not-before must be YYYY-MM-DD"
  NB="$(date -u -d "$NOTBEFORE 00:00:00" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || die "Invalid --not-before date"
else
  NB="$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"     # tolerate a customer clock that is a little behind
fi
EXP_JSON="null"; EXP_TXT="never (perpetual)"
n=0; [ -n "$DAYS" ] && n=$((n+1)); [ -n "$EXPIRES" ] && n=$((n+1)); [ "$PERPETUAL" = 1 ] && n=$((n+1))
[ "$n" -eq 1 ] || die "Give exactly one of --days N, --expires YYYY-MM-DD, --perpetual" 2
if [ -n "$DAYS" ]; then
  [[ "$DAYS" =~ ^[1-9][0-9]{0,4}$ ]] || die "--days must be a whole number"
  EXP="$(date -u -d "+$DAYS days" +%Y-%m-%dT%H:%M:%SZ)"; EXP_JSON="\"$EXP\""; EXP_TXT="$EXP"
elif [ -n "$EXPIRES" ]; then
  [[ "$EXPIRES" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--expires must be YYYY-MM-DD"
  EXP="$(date -u -d "$EXPIRES 23:59:59" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || die "Invalid --expires date"
  EXP_JSON="\"$EXP\""; EXP_TXT="$EXP"
fi

# machine binding
COMPS_JSON=""
if [ -n "$MID" ]; then
  MIDC="$(printf '%s' "$MID" | tr -d '[:space:]')"
  [[ "$MIDC" =~ ^MID1\.[A-Za-z0-9_-]+$ ]] || die "That is not a Machine ID (it must look like MID1.xxxx — copy it from the activation screen)"
  DECODED="$(b64u_dec "${MIDC#MID1.}")" || die "The Machine ID could not be decoded"
  COMPS_JSON="$(printf '%s' "$DECODED" | tr -d '\n\r ' | sed -n 's/.*"comps":\({[^{}]*}\).*/\1/p')"
  [[ "$COMPS_JSON" =~ ^\{(\"[a-z0-9_]{1,24}\":\"[0-9a-f]{16,64}\",?)+\}$ ]] || die "The Machine ID content is not valid"
fi
if [ "$ONLINE" = 0 ]; then
  [ -n "$COMPS_JSON" ] || die "An OFFLINE licence must be tied to one computer: add --machine-id MID1.… (or use --online)" 2
  [ -z "$BINDING" ] || die "--binding only applies to --online licences" 2
  OFFLINE_JSON=true
else
  OFFLINE_JSON=false
fi
if [ -n "$COMPS_JSON" ]; then MACHINE_JSON="{\"mode\":\"specific\",\"comps\":$COMPS_JSON}"; else MACHINE_JSON="{\"mode\":\"${BINDING:-first}\"}"; fi

# features
if [ -n "$FEATURES" ]; then
  [[ "$FEATURES" =~ ^\{.*\}$ ]] || die "--features must be a JSON object, e.g. '{\"pagesPerMonth\":500}'"
  [ -z "$PPM" ] || die "Use either --pages-per-month or --features, not both" 2
  FEAT_JSON="$(printf '%s' "$FEATURES" | tr -d '\n\r')"
elif [ -n "$PPM" ]; then FEAT_JSON="{\"pagesPerMonth\":$PPM}"; else FEAT_JSON="{}"; fi

# ---------- (a) the private key must match the public key embedded in the app ----------
openssl pkey -in "$KEY" -noout -text 2>/dev/null | head -n1 | grep -qi "ED25519" || die "$KEY is not an Ed25519 private key" 3
FLAT="$(tr -d '\n\r' < "$KEYS_FILE")"
LIC_ARR="$(printf '%s' "$FLAT" | sed -n 's/.*"license"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p')"
ENTRY="$(printf '%s' "$LIC_ARR" | grep -o '{[^{}]*"kid"[[:space:]]*:[[:space:]]*"'"$KID"'"[^{}]*}' | head -n1 || true)"
[ -n "$ENTRY" ] || die "The key id \"$KID\" is not in $KEYS_FILE. The app would not trust codes signed with it. Add its public key there first." 3
printf '%s' "$ENTRY" | grep -q '"dev"[[:space:]]*:[[:space:]]*true' && die "\"$KID\" is a DEVELOPMENT key; release builds refuse it. Use your production key." 3
EMBEDDED="$(printf '%s' "$ENTRY" | sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
DERIVED="$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | openssl base64 -A)" || die "Could not read the private key (is it password protected or damaged?)" 5
if [ "$EMBEDDED" != "$DERIVED" ]; then
  echo "ERROR: The private key $KEY does NOT match the public key for kid \"$KID\" that is built into the app ($KEYS_FILE)." >&2
  echo "       A code signed with it would be rejected by every customer. Nothing was created." >&2
  echo "       Use the key you generated for \"$KID\", or add this key's public key to the app and rebuild." >&2
  exit 3
fi
{ echo "-----BEGIN PUBLIC KEY-----"; printf '%s' "$DERIVED" | fold -w 64; echo; echo "-----END PUBLIC KEY-----"; } > "$TMP/pub.pem"

# ---------- payload ----------
[ -n "$LID" ] || LID="L-$(date -u +%Y%m%d)-$(openssl rand -hex 4 | tr 'a-f' 'A-F')"
PAYLOAD="{\"v\":1,\"licenseId\":\"$LID\",\"product\":\"$PRODUCT\",\"customer\":\"$(json_escape "$CUSTOMER")\",\"company\":\"$(json_escape "$COMPANY")\",\"issuedAt\":\"$NOW\",\"notBefore\":\"$NB\",\"expiresAt\":$EXP_JSON,\"maxActivations\":$MAXACT,\"offline\":$OFFLINE_JSON,\"machine\":$MACHINE_JSON,\"features\":$FEAT_JSON,\"kid\":\"$KID\"}"
PAYLOAD_B64="$(printf '%s' "$PAYLOAD" | b64u_enc)"
SIGNED="$PREFIX.$PAYLOAD_B64"

# ---------- sign, then (b) verify our own signature before printing ----------
printf '%s' "$SIGNED" > "$TMP/in.txt"
openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$TMP/in.txt" -out "$TMP/sig.bin" 2>/dev/null || die "Signing failed" 5
[ "$(wc -c < "$TMP/sig.bin" | tr -d ' ')" = 64 ] || die "Unexpected signature size" 5
openssl pkeyutl -verify -rawin -pubin -inkey "$TMP/pub.pem" -in "$TMP/in.txt" -sigfile "$TMP/sig.bin" >/dev/null 2>&1 || die "The signature did not verify against the public key. Nothing was printed." 5
[ "$(b64u_dec "$PAYLOAD_B64")" = "$PAYLOAD" ] || die "Internal encoding check failed" 5
CODE="$SIGNED.$(b64u_enc < "$TMP/sig.bin")"

# ---------- (c) details on stderr, the code LAST on stdout ----------
{
  echo "Licence created and signature verified."
  echo "  License ID   : $LID"
  echo "  Customer     : $CUSTOMER${COMPANY:+ ($COMPANY)}"
  echo "  Type         : $([ "$ONLINE" = 1 ] && echo online || echo "offline (machine-bound, no server contact)")"
  echo "  Valid from   : $NB"
  echo "  Expires      : $EXP_TXT"
  echo "  Computers    : $MAXACT"
  echo "  Machine      : $([ -n "$COMPS_JSON" ] && echo "bound to the Machine ID you gave" || echo "binds to the first computer ($([ -n "$BINDING" ] && echo "$BINDING" || echo first))")"
  echo "  Features     : $FEAT_JSON"
  echo "  Signed with  : $KID"
  echo "Send the code below to the customer. To be able to revoke/renew it later, import it into the licence server (Manager → Import)."
} >&2
printf '%s\n' "$CODE"

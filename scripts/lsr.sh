#!/usr/bin/env bash
# Lighting Survey Reader owner tool: pulls the latest scripts + public keys DIRECTLY FROM GITHUB every time, then runs them.
# Needs only Git Bash (bash + curl + OpenSSL 3). No git, no zip, no Node.
#
#   curl -fsSL https://raw.githubusercontent.com/Abdalmalek98/Energy-Tools/claude/gracious-cray-j6dz3v/scripts/lsr.sh | bash -s -- code
#
#   lsr.sh keygen                       create your signing key (once)  -> ~/lsr-private-keys/license-key.pem
#   lsr.sh code [--customer N] [--company C] [--machine-id MID1.…] [--days 365] [--online]
#                                       create an activation code (asks for anything you leave out)
#   lsr.sh admin <command…>             server admin (see scripts/license-admin.sh)
#   lsr.sh update                       just refresh the downloaded tools
set -euo pipefail

REPO="${LSR_REPO:-Abdalmalek98/Energy-Tools}"
BRANCH="${LSR_BRANCH:-claude/gracious-cray-j6dz3v}"
BASE="${LSR_RAW_BASE:-https://raw.githubusercontent.com/$REPO/$BRANCH}"
TOOLS="${LSR_TOOLS_DIR:-$HOME/lsr-tools}"
KEYDIR="${LSR_KEY_DIR:-$HOME/lsr-private-keys}"
KID="${LSR_KID:-lic-1}"
die() { echo "ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl not found (it comes with Git Bash)."
command -v openssl >/dev/null || die "openssl not found (it comes with Git Bash)."

fetch() { # relative path -> $TOOLS/<path>
  mkdir -p "$TOOLS/$(dirname "$1")"
  curl -fsSL --retry 2 "$BASE/$1" -o "$TOOLS/$1.tmp" || die "Could not download $1 from $BASE (check your internet connection and that the branch exists)."
  mv "$TOOLS/$1.tmp" "$TOOLS/$1"
}
update() {
  for f in scripts/gen-license-key.sh scripts/offline-license.sh scripts/license-admin.sh licensing/keys/production.json; do fetch "$f"; done
  chmod +x "$TOOLS"/scripts/*.sh 2>/dev/null || true
  echo "Tools downloaded from $BASE" >&2
}

ask() { # prompt, default -> value (reads from the keyboard even when this script is piped from curl)
  local v=""; local d="${2:-}"
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then read -r -p "$1${d:+ [$d]}: " v < /dev/tty > /dev/tty; else die "$1 is required (pass it as an option; no keyboard available)."; fi
  printf '%s' "${v:-$d}"
}

cmd="${1:-}"; [ $# -gt 0 ] && shift || true
case "$cmd" in
  update) update ;;
  keygen) update; bash "$TOOLS/scripts/gen-license-key.sh" "$@" ;;
  admin) update; bash "$TOOLS/scripts/license-admin.sh" "$@" ;;
  code)
    update
    CUSTOMER=""; COMPANY=""; MID=""; DAYS=""; ONLINE=0; EXTRA=()
    while [ $# -gt 0 ]; do case "$1" in
      --customer) CUSTOMER="${2:?}"; shift 2 ;; --company) COMPANY="${2:-}"; shift 2 ;; --machine-id) MID="${2:?}"; shift 2 ;;
      --days) DAYS="${2:?}"; shift 2 ;; --online) ONLINE=1; shift ;; *) EXTRA+=("$1"); shift ;; esac; done
    KEY="$KEYDIR/license-key.pem"
    [ -f "$KEY" ] || die "Your private key was not found at $KEY. Create it once with:  lsr.sh keygen   (or set LSR_KEY_DIR)."
    [ -n "$CUSTOMER" ] || CUSTOMER="$(ask "Customer name")"
    [ -n "$COMPANY" ] || COMPANY="$(ask "Company (optional)" "")"
    if [ "$ONLINE" = 0 ] && [ -z "$MID" ]; then echo "Paste the customer's Machine ID (MID1.…) from the app's activation screen." >&2; MID="$(ask "Machine ID")"; fi
    [ -n "$DAYS" ] || DAYS="$(ask "Valid for how many days" "365")"
    ARGS=(--key "$KEY" --kid "$KID" --keys-file "$TOOLS/licensing/keys/production.json" --customer "$CUSTOMER" --company "$COMPANY" --days "$DAYS")
    if [ "$ONLINE" = 1 ]; then ARGS+=(--online); [ -z "$MID" ] || ARGS+=(--machine-id "$MID"); else ARGS+=(--machine-id "$MID"); fi
    CODE="$(bash "$TOOLS/scripts/offline-license.sh" "${ARGS[@]}" "${EXTRA[@]}")" || exit $?
    OUTDIR="$HOME/lsr-codes"; mkdir -p "$OUTDIR"
    SAFE="$(printf '%s' "$CUSTOMER" | tr -c 'A-Za-z0-9._-' '_')"; FILE="$OUTDIR/$SAFE-$(date +%Y%m%d-%H%M%S).txt"
    printf '%s\n' "$CODE" > "$FILE"
    command -v clip >/dev/null 2>&1 && printf '%s' "$CODE" | clip && echo "(code copied to the clipboard)" >&2
    echo >&2; echo "Saved to: $FILE" >&2; echo >&2; echo "ACTIVATION CODE:" >&2; printf '%s\n' "$CODE"
    ;;
  *) sed -n '2,15p' "$0" 2>/dev/null >&2 || echo "Usage: lsr.sh keygen | code | admin | update" >&2; exit 2 ;;
esac

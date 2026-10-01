#!/usr/bin/env bash
# Admin commands for the licensing server using only bash + curl (Git Bash is enough). No Node needed.
#   export LSR_SERVER_URL=https://licensing.example.com
#   export LSR_ADMIN_TOKEN=...            # the ADMIN_TOKEN configured on the server (never commit it)
#
#   license-admin.sh list
#   license-admin.sh show <licenseId>
#   license-admin.sh import <activation-code>
#   license-admin.sh revoke|suspend <licenseId> ["reason shown to the customer"]
#   license-admin.sh reinstate|replacement|reset <licenseId>
#   license-admin.sh renew <licenseId> <YYYY-MM-DD|never>       license-admin.sh extend <licenseId> <days>
#   license-admin.sh authorize-machine <licenseId> <MID1.…>      license-admin.sh set-grace <licenseId> <hours>
#   license-admin.sh usage <licenseId>                           license-admin.sh audit [licenseId]
set -euo pipefail
URL="${LSR_SERVER_URL:?Set LSR_SERVER_URL}"; TOKEN="${LSR_ADMIN_TOKEN:?Set LSR_ADMIN_TOKEN}"
esc() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; printf '%s' "$s"; }
call() { # method path [json]
  local out code; out="$(mktemp)"
  code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"} "$URL/admin/v1$2") || { rm -f "$out"; echo "Could not reach $URL" >&2; exit 1; }
  if command -v python3 >/dev/null 2>&1; then python3 -m json.tool < "$out" 2>/dev/null || cat "$out"; else cat "$out"; fi; echo
  rm -f "$out"; [ "$code" -lt 300 ] || { echo "Server answered HTTP $code" >&2; exit 1; }
}
cmd="${1:-}"; shift || true
case "$cmd" in
  list) call GET /licenses ;;
  show) call GET "/licenses/${1:?licenseId}" ;;
  import) call POST /licenses "{\"code\":\"$(esc "${1:?code}")\"}" ;;
  revoke|suspend) call POST "/licenses/${1:?licenseId}/$cmd" "{\"reason\":\"$(esc "${2:-}")\"}" ;;
  reinstate|replacement|reset) call POST "/licenses/${1:?licenseId}/$cmd" '{}' ;;
  renew) d="${2:?YYYY-MM-DD or never}"; if [ "$d" = never ]; then call POST "/licenses/${1:?}/renew" '{"expiresAt":null}'; else call POST "/licenses/${1:?}/renew" "{\"expiresAt\":\"${d}T23:59:59Z\"}"; fi ;;
  extend) call POST "/licenses/${1:?licenseId}/extend" "{\"days\":${2:?days}}" ;;
  authorize-machine) call POST "/licenses/${1:?licenseId}/authorize-machine" "{\"machineId\":\"$(esc "${2:?MID1.…}")\"}" ;;
  set-grace) call POST "/licenses/${1:?licenseId}/set-grace" "{\"hours\":${2:?hours}}" ;;
  usage) call GET "/usage/${1:?licenseId}" ;;
  audit) call GET "/audit${1:+?license=$1}" ;;
  *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac

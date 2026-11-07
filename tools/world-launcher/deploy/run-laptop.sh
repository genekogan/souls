#!/usr/bin/env bash
# The laptop's /worlds launchers, with the exact production and staging commands in one place so the lead (or the
# supervisor, deploy/supervise-laptop.sh) restarts them identically.
#
#   tools/world-launcher/deploy/run-laptop.sh production|staging [<release dir>]
#   tools/world-launcher/deploy/run-laptop.sh --print production|staging [<release dir>]   # print the command only
#
# <release dir>: an assembled launcher release (release.sh --local <dir>, then pnpm install --offline --frozen-lockfile
# --filter @souls/server... inside it). Default: the dir named in $RUNTIME/<stage>.release (one line; the lead writes it
# when releasing, so a restart never silently picks up another release).
#
# The Soul CLI 1.9 + body look (sha 40cc21a6…) and its guides come from the release's own tools/world-launcher/soul/ (pinned copies;
# SOURCES.json), so no --soul-* flags are needed. The process runs in the foreground (exec), cwd = the release.
# production = :5340 (sim.eden.art/worlds via proxy :4970), staging = :5300 (localhost only).
set -euo pipefail
PRINT=0; [ "${1:-}" = --print ] && { PRINT=1; shift; }
STAGE="${1:-}"; REL="${2:-}"
RUNTIME="${SIM_WORLDS_RUNTIME:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/.local/runtime/world-launcher}"
NODE="${SIM_WORLDS_NODE:-/opt/homebrew/bin/node}"
case "$STAGE" in
  production) PORT=5340; RANGE=5341-5369; DATA="$RUNTIME/data"; MAXW=60; MAXR=16
    EXTRA=(--public-origin https://sim.eden.art --auth-env "$RUNTIME/CLERK-PUBLIC-SETTINGS.env");;
  staging) PORT=5300; RANGE=5301-5329; DATA="$RUNTIME/staging-data"; MAXW=20; MAXR=8; EXTRA=();;
  *) echo "usage: $0 [--print] production|staging [<release dir>]" >&2; exit 2;;
esac
if [ -z "$REL" ] && [ -f "$RUNTIME/$STAGE.release" ]; then REL="$(head -1 "$RUNTIME/$STAGE.release")"; fi
[ -n "$REL" ] && [ -f "$REL/tools/world-launcher/launcher.mjs" ] || { echo "no launcher release at '${REL}'" >&2; exit 1; }
[ -d "$REL/node_modules" ] || { echo "$REL has no node_modules: run pnpm install --offline --frozen-lockfile --filter @souls/server... there" >&2; exit 1; }
CMD=("$NODE" tools/world-launcher/launcher.mjs --base /worlds --port "$PORT" --range "$RANGE" --data "$DATA" ${EXTRA[@]+"${EXTRA[@]}"}
  --max-worlds "$MAXW" --max-running "$MAXR" --world-heap-mb 768 --create-limit 6 --mars-web "$REL/mars-web")
if [ "$PRINT" = 1 ]; then printf 'cd %q && ' "$REL"; printf '%q ' "${CMD[@]}"; echo; exit 0; fi
cd "$REL"
exec "${CMD[@]}"

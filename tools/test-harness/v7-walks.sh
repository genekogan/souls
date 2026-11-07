#!/bin/bash
# V7 gate step: real-input walks in real Chrome (Metal GPU, shared lease) of THIS checkout, on safe ports 5870-5879.
#   tools/test-harness/v7-walks.sh <outDir>      (run from the candidate checkout; builds web into <outDir>, ~10 min)
# Old worlds (eden/mars/littlemartians, root path) 5870-5872; launcher + new-world walk 5873 (children 5874-5876);
# the God modal e2e (tools/god-skill/e2e/launcher.mjs: Connect, pairing, a command acked, undo/redo, weather, Forsake) runs
# its own launcher on 5877 (children 5878-5879); then the approval-link walk (tools/god-skill/e2e/approve-on-top.mjs, Clerk mode)
# reuses 5873-5876, and so does the in-window approval walk (tools/god-skill/e2e/approve-in-window.mjs, lane PUX).
# Writes <outDir>/v7-receipt.json (status pass|fail, per-check results, source sha) and prints one RELEASE_GATE_V7 line.
# Only processes this script starts are ever stopped. Never touches 4930-4970 / 4986 / 4987.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "${1:?usage: v7-walks.sh <outDir>}" && cd "$1" && pwd)"
# CHROME_LEASE_MODULE (optional, inherited): a machine-wide Chrome lease; the walks default to the repo's lease lib.
export WALK_BUILDS='{"head":5870}' OLD_WORLDS_OUT="$OUT/old-worlds"
MARS_WEB_SRC="$ROOT/.lane/mars-web"; MARS_WEB="$OUT/mars-web"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
cd "$ROOT" || exit 1
for p in $(seq 5870 5879); do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy: stop"; exit 1; }; done
[ -d "$MARS_WEB_SRC" ] || { echo "missing $MARS_WEB_SRC overlay"; exit 1; }
# The walks' mars-web is the lane overlay with /modular (the humanoid kit, the environment GLBs and the character wire
# files *.mesh.glb + clips-*.glb) taken from THIS checkout, as release.sh builds a release; a lane overlay's /modular can
# predate them (the 404s of /worlds/modular/environment/*.mesh.glb in V7 walk-new, 2026-10-20).
mkdir -p "$MARS_WEB" || exit 1
SRC_REAL="$(cd "$MARS_WEB_SRC" && pwd -P)"; for e in "$SRC_REAL"/*; do ln -sfn "$e" "$MARS_WEB/${e##*/}"; done
ln -sfn "$ROOT/mars/viewer/public/modular" "$MARS_WEB/modular"
[ -f "$MARS_WEB/modular/humanoid/kit.json" ] && [ -f "$MARS_WEB/modular/environment/clips-ual.glb" ] || { echo "no humanoid kit / character wire files in $MARS_WEB/modular"; exit 1; }
# SIM_HEAVY_SLOT (optional): a machine-wide heavy-work lock wrapper; unset runs each step directly.
heavy() { if [ -n "${SIM_HEAVY_SLOT:-}" ]; then python3 "$SIM_HEAVY_SLOT" --owner gate --purpose "$1" --timeout 1800 -- "${@:2}"; else "${@:2}"; fi; }
if [ -n "${SIM_PREBUILT_WEB_ROOT:-}" ]; then
  SHA="$(git rev-parse HEAD)"; BUILD="we-${SHA:0:12}"
  # Validate the exact release source/flags and every file hash before browser qualification.
  for suffix in -root ''; do
    base=/worlds/; target="$OUT/web-worlds"
    if [ "$suffix" = -root ]; then base=/; target="$ROOT/apps/web/dist"; fi
    node tools/world-launcher/deploy/prebuilt-web.mjs install "$SIM_PREBUILT_WEB_ROOT/$BUILD$suffix" "$target" "$SHA" "$BUILD$suffix" "$base" \
      "${SIM_ASSETS_CDN_ENABLED-1}" "${SIM_ASSETS_CDN_ORIGIN:-https://assets.eden.art}" "${VITE_EDEN_EXPERIENCE_WORLD_IDS-pm-preview-eden-20261005}" \
      "${SIM_ARRIVAL_UI_ENABLED:-0}" "${SIM_GOATCOUNTER-simeden}" "${SIM_GOD_UPLOADS_CDN:-1}" > "$OUT/prebuilt$([ -n "$suffix" ] && echo -root || echo -worlds).log" 2>&1 || { echo prebuilt install failed; exit 1; }
  done
else
  heavy v7-build-root pnpm --filter @souls/web build > "$OUT/build-root.log" 2>&1 || { echo build-root failed; exit 1; }
  heavy v7-build-worlds bash -c "cd apps/web && npx vite build --base /worlds/ --outDir $OUT/web-worlds --emptyOutDir" > "$OUT/build-worlds.log" 2>&1 || { echo build-worlds failed; exit 1; }
fi
node tools/test-harness/old-worlds.mjs "$ROOT" 5870 head > "$OUT/servers-head.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 90); do curl -s -m 2 http://127.0.0.1:5872/w/littlemartians/v1/config >/dev/null && break; sleep 2; done
perl -e 'alarm 1800; exec @ARGV' node tools/test-harness/walk-old.mjs "$OUT/old" > "$OUT/walk-old.log" 2>&1; RC_OLD=$?
kill "${PIDS[0]}" 2>/dev/null; PIDS=(); sleep 3
perl -e 'alarm 1800; exec @ARGV' node tools/test-harness/walk-new.mjs http://127.0.0.1:5873 "$OUT/new" --web "$OUT/web-worlds" --mars-web "$MARS_WEB" > "$OUT/walk-new.log" 2>&1; RC_NEW=$?
cleanup; PIDS=()
perl -e 'alarm 1200; exec @ARGV' node tools/god-skill/e2e/launcher.mjs --port 5877 --range 5878-5879 --web "$OUT/web-worlds" --mars-web "$MARS_WEB" --out "$OUT/god" > "$OUT/god-modal.log" 2>&1; RC_GOD=$?
# lane HF: the god opens an agent's approval link (#approve/<id>) in Clerk mode; it must stay on top through the whole
# load (own launcher on 5873, children 5874-5876, free again after walk-new)
perl -e 'alarm 900; exec @ARGV' node tools/god-skill/e2e/approve-on-top.mjs --port 5873 --range 5874-5876 --web "$OUT/web-worlds" --mars-web "$MARS_WEB" --out "$OUT/approve" > "$OUT/approve-on-top.log" 2>&1; RC_APPROVE=$?
# lane PUX: the agent's request (create-soul --for <window code>) comes up top right in the open window; same ports again
perl -e 'alarm 900; exec @ARGV' node tools/god-skill/e2e/approve-in-window.mjs --port 5873 --range 5874-5876 --web "$OUT/web-worlds" --out "$OUT/window" > "$OUT/approve-in-window.log" 2>&1; RC_WINDOW=$?
node tools/test-harness/v7-receipt.mjs "$OUT" "$ROOT" "$RC_OLD" "$RC_NEW" "$RC_GOD" "$RC_APPROVE" "$RC_WINDOW"

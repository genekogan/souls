#!/bin/bash
# run.sh — start one playtest scenario (playtest.mjs run) in the background; same state file, gate and status.sh as
# direct.sh, no console (a scenario is persona- or script-driven).
#
# usage: run.sh [--dry-run] [--force] [--checkout DIR] <scenario.json> [playtest.mjs run args…]
#   passthrough args: --server-root DIR (default: the checkout) --seed n --out DIR --keep-world --from step
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

DRY=0 FORCE=0 SCEN="" PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    --checkout) SIM_CHECKOUT="$2"; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) if [ -z "$SCEN" ] && [[ "$1" != --* ]]; then SCEN="$1"; else PASS+=("$1"); fi ;;
  esac
  shift
done
[ -n "$SCEN" ] || die "usage: run.sh [--dry-run] [--force] <scenario.json> [args]"
[ -f "$SCEN" ] || { [ -f "$SIM_CHECKOUT/$SCEN" ] && SCEN="$SIM_CHECKOUT/$SCEN"; }
[ -f "$SCEN" ] || die "no scenario file $SCEN"
SCEN="$(cd "$(dirname "$SCEN")" && pwd)/$(basename "$SCEN")"
argval() { local k="$1" i; for ((i=0; i<${#PASS[@]}; i++)); do [ "${PASS[$i]}" = "$k" ] && { echo "${PASS[$((i+1))]:-}"; return 0; }; done; return 0; }
hasarg() { local a; for a in "${PASS[@]+"${PASS[@]}"}"; do [ "$a" = "$1" ] && return 0; done; return 1; }
SERVER_ROOT="$(argval --server-root)"; SERVER_ROOT="${SERVER_ROOT:-${SIM_SERVER_ROOT:-$SIM_CHECKOUT}}"

echo "== scenario"
INFO=$(node -e "
  const s = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); const e = (x) => console.error(x);
  if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) throw new Error('name: lowercase letters, digits and -');
  if (s.kind === 'cast') throw new Error('this is a cast: use direct.sh');
  const d = s.director ?? {};
  e(s.name + ' (seed ' + s.seed + ', ' + s.durationSec + ' s) world ' + (s.world?.genesis ?? JSON.stringify(s.world)) + ' · director ' + d.mode + (d.mode === 'scripted' ? ' (' + (d.script?.length ?? 0) + ' lines, ' + (d.script ?? []).filter((x) => x.expect).length + ' with expect)' : ''));
  for (const x of s.seats ?? []) e('  ' + x.id.padEnd(10) + String(x.soulName).padEnd(12) + x.adapter + '/' + x.model + ' persona ' + x.persona + ' channels ' + JSON.stringify(x.channelMix ?? {}));
  if (s.god) e('  god: ' + s.god.adapter + '/' + s.god.model + ' persona ' + s.god.persona);
  e('review: ' + JSON.stringify(s.review ?? {}));
  console.log('NAME=' + s.name + ' SEED=' + Number(s.seed ?? 1));
" "$SCEN") || die "scenario does not parse (see above)"
eval "$INFO"
SEED_ARG="$(argval --seed)"; [ -n "$SEED_ARG" ] && SEED="$SEED_ARG"
if [ -f "$SIM_CHECKOUT/tools/playtest/scenarios/lib/validate.mjs" ]; then
  echo "== validate.mjs"; (cd "$SIM_CHECKOUT" && node tools/playtest/scenarios/lib/validate.mjs "$SCEN") || die "validate.mjs failed"
else echo "(no scenarios/lib/validate.mjs in $SIM_CHECKOUT: JSON-level check only)"; fi

echo "== server root: $SERVER_ROOT"
check_server_root "$SERVER_ROOT" || { [ "$DRY" = 1 ] && echo "(dry run: would refuse)" || die "pick a built checkout at live main (--server-root DIR); see SKILL.md"; }
echo "== machine gate"
GATE_OK=1; FORCE=$FORCE machine_gate || GATE_OK=0

OUT="$(argval --out)"
if [ -z "$OUT" ]; then RUN_DIR="$RUNS_ROOT/$(stamp)-$NAME-$SEED"; PASS+=(--out "$RUN_DIR"); else RUN_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")"; fi
hasarg --server-root || PASS+=(--server-root "$SERVER_ROOT")
LOG="$RUN_DIR/console.log"
CMD=(node tools/playtest/playtest.mjs run "$SCEN" "${PASS[@]}")
echo "== command (cwd $SIM_CHECKOUT)"; printf '%q ' "${CMD[@]}"; echo
echo "log: $LOG"; echo "run dir: $RUN_DIR"
if [ "$DRY" = 1 ]; then echo "== dry run: nothing started (gate $([ $GATE_OK = 1 ] && echo clear || echo BLOCKED))"; exit 0; fi
[ "$GATE_OK" = 1 ] || die "machine gate blocked; tell the user what is running and ask (or --force on their explicit say-so)"

mkdir -p "$RUN_DIR"
cd "$SIM_CHECKOUT"
detach /dev/null "$LOG" "${CMD[@]}"
NODE_PID=$DETACHED_PID
KIND=run; TARGET="$SCEN"; STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; CHECKOUT="$SIM_CHECKOUT"; FIFO=""; HOLDER_PID=""; WORLD=""; HEADLESS=1
save_state KIND TARGET RUN_DIR LOG FIFO NODE_PID HOLDER_PID STARTED CHECKOUT SERVER_ROOT WORLD HEADLESS
sleep 3
alive "$NODE_PID" || { echo "playtest exited at once; log:"; tail -20 "$LOG"; exit 1; }
echo "started: playtest pid $NODE_PID; state $STATE"
echo "next: status.sh (every 5-10 minutes) · end.sh --kill only as a last resort"

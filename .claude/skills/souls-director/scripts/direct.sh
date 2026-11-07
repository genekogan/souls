#!/bin/bash
# direct.sh — start one swarm-director session (playtest.mjs direct) in the background, with its live console on a
# named pipe so later chat instructions can be forwarded with say.sh.
#
# usage: direct.sh [--dry-run] [--force] [--with-cast-script] [--checkout DIR] <cast.json> [playtest.mjs direct args…]
#   passthrough args: --server-root DIR (default: the checkout) --world <url> (ONLY when the user says) --only a,b
#                     --no-planner --script FILE --out DIR --keep-world --force-machine --headless
#   --with-cast-script  keep the cast's console.script (scripted redirects); live mode otherwise ignores it
#   --force             start despite a machine-gate block (only on the user's explicit say-so)
#   --dry-run           validate and print everything, start nothing
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

DRY=0 FORCE=0 WITH_SCRIPT=0 CAST="" PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    --with-cast-script) WITH_SCRIPT=1 ;;
    --checkout) SIM_CHECKOUT="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) if [ -z "$CAST" ] && [[ "$1" != --* ]]; then CAST="$1"; else PASS+=("$1"); fi ;;
  esac
  shift
done
[ -n "$CAST" ] || die "usage: direct.sh [--dry-run] [--force] [--with-cast-script] <cast.json> [args]"
[ -f "$CAST" ] || { [ -f "$SIM_CHECKOUT/$CAST" ] && CAST="$SIM_CHECKOUT/$CAST"; }
[ -f "$CAST" ] || die "no cast file $CAST"
CAST="$(cd "$(dirname "$CAST")" && pwd)/$(basename "$CAST")"
[ -f "$SIM_CHECKOUT/tools/playtest/director/swarm/run.mjs" ] || die "$SIM_CHECKOUT has no swarm director (tools/playtest/director/swarm/run.mjs)"

# Pull a value out of the passthrough args.
argval() { local k="$1" i; for ((i=0; i<${#PASS[@]}; i++)); do [ "${PASS[$i]}" = "$k" ] && { echo "${PASS[$((i+1))]:-}"; return 0; }; done; return 0; }
hasarg() { local a; for a in "${PASS[@]+"${PASS[@]}"}"; do [ "$a" = "$1" ] && return 0; done; return 1; }

SERVER_ROOT="$(argval --server-root)"; SERVER_ROOT="${SERVER_ROOT:-${SIM_SERVER_ROOT:-$SIM_CHECKOUT}}"
WORLD="$(argval --world)"
hasarg --headless && HEADLESS=1 || HEADLESS=0

echo "== cast"
INFO=$(cd "$SIM_CHECKOUT" && node --input-type=module -e "
  import { loadCast } from './tools/playtest/director/swarm/cast.mjs';
  const c = loadCast(process.argv[1]); const e = (s) => console.error(s);
  e('cast ' + c.name + ' (seed ' + c.seed + ', ' + c.durationSec + ' s cap) world ' + (c.world.kind === 'dev' ? 'dev ' + c.world.genesis + ' port ' + (c.world.port ?? '?') : c.world.base));
  e('room: ' + c.room.label + ' (match ' + c.room.match.join(', ') + ')' + (c.podium ? ' · podium: ' + c.podium.label : ''));
  e('order: ' + c.order.join(' -> ') + ' · planner: ' + (c.orchestrator.planner ?? 'off (templates)'));
  for (const s of c.seats) e('  ' + s.id.padEnd(10) + s.soulName.padEnd(12) + s.adapter + '/' + s.model + ' effort ' + s.effort + ' economy ' + s.economy);
  e('scripted console lines in the cast: ' + (c.console.script?.length ?? 0));
  console.log('NAME=' + c.name + ' SEED=' + c.seed + ' NSCRIPT=' + (c.console.script?.length ?? 0));
" "$CAST") || die "cast does not validate (see above)"
eval "$INFO"

echo "== server root: $SERVER_ROOT"
check_server_root "$SERVER_ROOT" || { [ "$DRY" = 1 ] && echo "(dry run: would refuse)" || die "pick a built checkout at live main (--server-root DIR); see SKILL.md"; }
[ -n "$WORLD" ] && echo "!! --world $WORLD: a live/forked world. Only when the user said so; seats onboard with the dev text."

echo "== machine gate"
GATE_OK=1; FORCE=$FORCE machine_gate || GATE_OK=0

OUT="$(argval --out)"
if [ -z "$OUT" ]; then RUN_DIR="$RUNS_ROOT/$(stamp)-$NAME-$SEED"; PASS+=(--out "$RUN_DIR"); else RUN_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")"; fi
hasarg --server-root || PASS+=(--server-root "$SERVER_ROOT")
SCRIPT_NOTE=""
if [ "${NSCRIPT:-0}" -gt 0 ] && [ "$WITH_SCRIPT" = 0 ] && [ "$HEADLESS" = 0 ] && ! hasarg --script; then
  echo "note: live mode ignores the cast's $NSCRIPT scripted console line(s); add --with-cast-script to keep them"; fi
if [ "$WITH_SCRIPT" = 1 ] && ! hasarg --script && [ "$HEADLESS" = 0 ]; then
  PASS+=(--script "$RUN_DIR/console-script.json"); SCRIPT_NOTE="cast console.script → $RUN_DIR/console-script.json"
fi
LOG="$RUN_DIR/console.log"
FIFO="$STATE_DIR/console.fifo"
CMD=(node tools/playtest/playtest.mjs direct "$CAST" "${PASS[@]}")

echo "== command (cwd $SIM_CHECKOUT)"
printf '%q ' "${CMD[@]}"; echo
if [ "$HEADLESS" = 1 ]; then echo "stdin: /dev/null (headless: console lines come from the cast or --script; say.sh will not work)"; else echo "stdin: $FIFO (say.sh writes here)"; fi
echo "log: $LOG"; echo "run dir: $RUN_DIR"; [ -n "$SCRIPT_NOTE" ] && echo "$SCRIPT_NOTE"
if [ "$DRY" = 1 ]; then echo "== dry run: nothing started (gate $([ $GATE_OK = 1 ] && echo clear || echo BLOCKED))"; exit 0; fi
[ "$GATE_OK" = 1 ] || die "machine gate blocked; tell the user what is running and ask (or --force on their explicit say-so)"

mkdir -p "$RUN_DIR" "$STATE_DIR"
if [ -n "$SCRIPT_NOTE" ]; then
  node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); require('fs').writeFileSync(process.argv[2], JSON.stringify(c.console?.script ?? [], null, 1))" "$CAST" "$RUN_DIR/console-script.json"
fi
cd "$SIM_CHECKOUT"
if [ "$HEADLESS" = 1 ]; then
  detach /dev/null "$LOG" "${CMD[@]}"
  NODE_PID=$DETACHED_PID; HOLDER_PID=""; FIFO=""
else
  rm -f "$FIFO"; mkfifo -m 600 "$FIFO"
  # The director opens the pipe for reading (blocks until a writer appears); the holder keeps a writer open for the
  # whole run so say.sh's short writes never deliver EOF, and exits on its own once the director is gone (end.sh removes the pipe).
  detach "$FIFO" "$LOG" "${CMD[@]}"
  NODE_PID=$DETACHED_PID
  detach /dev/null /dev/null "$HERE/holder.sh" "$FIFO" "$NODE_PID"
  HOLDER_PID=$DETACHED_PID
fi
KIND=direct; TARGET="$CAST"; STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; CHECKOUT="$SIM_CHECKOUT"
save_state KIND TARGET RUN_DIR LOG FIFO NODE_PID HOLDER_PID STARTED CHECKOUT SERVER_ROOT WORLD HEADLESS
sleep 3
alive "$NODE_PID" || { echo "director exited at once; log:"; tail -20 "$LOG"; exit 1; }
echo "started: director pid $NODE_PID${HOLDER_PID:+, pipe holder pid $HOLDER_PID}; state $STATE"
echo "next: status.sh (every few minutes) · say.sh \"<console line>\" · end.sh"

#!/bin/bash
# end.sh — end the live run cleanly and wait for its close (seats stopped, world stopped, verdict and story written).
#
# usage: end.sh [--wait SEC] [--no-wait] [--kill]
#   default   direct: sends "end" on the console, then waits up to --wait seconds (default 540) for the process to exit.
#             run: a scenario has no console; it ends at its durationSec. end.sh only waits (use --kill to stop it).
#   --kill    last resort: SIGTERM to the harness. Its close step does NOT run: seat CLIs and the dev world may be left
#             running (listed below for cleanup) and no verdict is written (`verify.mjs <run>` can write it later).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

WAIT=540 KILL=0 NOWAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT="$2"; shift ;;
    --no-wait) NOWAIT=1 ;;
    --kill) KILL=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown arg $1" ;;
  esac
  shift
done
load_state || die "no live run recorded ($STATE)"

if alive "${NODE_PID:-}"; then
  if [ "$KILL" = 1 ]; then
    echo "SIGTERM to $KIND pid $NODE_PID (close step skipped)"; kill -TERM "$NODE_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do alive "$NODE_PID" || break; sleep 0.5; done
    alive "$NODE_PID" && { echo "still alive; SIGKILL"; kill -KILL "$NODE_PID" 2>/dev/null || true; }
    alive "${HOLDER_PID:-}" && kill "$HOLDER_PID" 2>/dev/null || true
    [ -n "${FIFO:-}" ] && rm -f "$FIFO"
    echo "== possible leftovers (check, then stop them):"
    ps ax -o pid=,command= | grep -F "$RUN_DIR" | grep -v grep | cut -c1-200 || echo "  none mention the run folder"
    PORT=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1]+"/scenario.json","utf8"));console.log(c.world?.port??"")}catch{}' "$RUN_DIR")
    if [ -n "$PORT" ]; then
      if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sed 's/^/  /' || echo "  nothing listening on dev-world port $PORT"
      elif command -v ss >/dev/null 2>&1; then ss -ltnp "sport = :$PORT" 2>/dev/null | sed 's/^/  /'
      else echo "  check dev-world port $PORT by hand"; fi
    fi
    [ "$KIND" = direct ] && echo "verdict later: (cd $CHECKOUT && node tools/playtest/director/swarm/verify.mjs $RUN_DIR)"
    exit 0
  fi
  if [ "$KIND" = direct ] && [ -n "${FIFO:-}" ]; then "$HERE/say.sh" end; else echo "$KIND has no console; waiting for it to finish on its own"; fi
  [ "$NOWAIT" = 1 ] && { echo "not waiting; check with status.sh"; exit 0; }
  echo "waiting up to ${WAIT}s for the close (seats stop, world stops, verdict + story)…"
  T0=$(date +%s)
  while alive "$NODE_PID"; do
    if [ $(( $(date +%s) - T0 )) -ge "$WAIT" ]; then echo "still closing after ${WAIT}s; run end.sh again (it only waits) or status.sh"; exit 3; fi
    sleep 10
  done
fi
echo "== $KIND finished"
grep -E '^\{"ok":' "$LOG" 2>/dev/null | tail -1 || true
for f in director/VERDICT.md REPORT.md story.html journal.md; do [ -f "$RUN_DIR/$f" ] && echo "  $RUN_DIR/$f"; done
alive "${HOLDER_PID:-}" && kill "$HOLDER_PID" 2>/dev/null || true
[ -n "${FIFO:-}" ] && rm -f "$FIFO"
mv "$STATE" "$STATE_DIR/last.env"
echo "state moved to $STATE_DIR/last.env"

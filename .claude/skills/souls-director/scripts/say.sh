#!/bin/bash
# say.sh — forward one console line to the live director (writes it to the console pipe direct.sh made).
#
# usage: say.sh [--broadcast] [--fifo PATH] [--cast PATH] "<console line>"
#   <text> (to every seat) · <seat>: <text> · redirect <seat>: <text> · economy <seat|all> lean|normal|rich
#   pause · resume · status · end
#   The line is parsed first with the harness's own parser and the reading is printed. A line that looks addressed
#   ("word: …") to a seat that does not exist would go to EVERY seat; it is refused unless --broadcast.
#   --fifo/--cast are for testing against a pipe you made yourself.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

BCAST=0 PIPE="" CASTF="" LINE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --broadcast) BCAST=1 ;;
    --fifo) PIPE="$2"; shift ;;
    --cast) CASTF="$2"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) LINE="${LINE:+$LINE }$1" ;;
  esac
  shift
done
LINE="$(printf '%s' "$LINE" | tr '\r\n' '  ' | sed 's/  */ /g; s/^ //; s/ $//')"   # the console reads one line
[ -n "$LINE" ] || die "nothing to say"

if [ -z "$PIPE" ]; then
  load_state || die "no live run (no $STATE); start one with direct.sh"
  [ "${KIND:-}" = direct ] || die "the live run is a playtest scenario ($KIND), it has no console"
  [ -n "${FIFO:-}" ] || die "the live run is headless: its console lines come from its script; say.sh cannot reach it"
  alive "${NODE_PID:-}" || die "the director (pid ${NODE_PID:-?}) is not running any more; see status.sh"
  PIPE="$FIFO"; CASTF="${CASTF:-$TARGET}"; CHECK="$CHECKOUT"
else CHECK="$SIM_CHECKOUT"; fi
[ -p "$PIPE" ] || die "$PIPE is not a pipe"

if [ -n "$CASTF" ] && [ -f "$CHECK/tools/playtest/director/swarm/console.mjs" ]; then
  READING=$(cd "$CHECK" && node --input-type=module -e "
    import { parseLine } from './tools/playtest/director/swarm/console.mjs';
    import { loadCast } from './tools/playtest/director/swarm/cast.mjs';
    const c = loadCast(process.argv[1]); const line = process.argv[2]; const p = parseLine(line, { seats: c.seats });
    const name = (id) => id + ' (' + (c.seats.find((s) => s.id === id)?.soulName ?? '?') + ')';
    const r = { broadcast: () => 'BROADCAST to every paired seat', say: () => 'card message to ' + name(p.seat), redirect: () => 'REDIRECT ' + name(p.seat) + ': folded into its turn if before it, applied now if during it',
      economy: () => 'economy ' + (p.seat ? name(p.seat) : 'all seats') + ' -> ' + p.level + (c.economy[p.level] ? '' : ' (UNKNOWN level: the director will refuse it)'),
      pause: () => 'pause the plan (no new directions; world keeps running)', resume: () => 'resume the plan', status: () => 'status line into the log',
      end: () => 'END the session (closes seats, writes VERDICT)', error: () => 'ERROR: ' + p.error, noop: () => 'nothing (blank or # comment)' }[p.cmd]();
    const addressed = p.cmd === 'broadcast' && /^\s*[A-Za-z][\w-]*\s*:/.test(line);
    console.log((addressed ? 'ADDRESSED_UNKNOWN ' : '') + r + ' · seats: ' + c.seats.map((s) => s.id + '/' + s.soulName).join(' '));
  " "$CASTF" "$LINE") || die "could not parse the line with the harness parser"
  echo "reading: ${READING#ADDRESSED_UNKNOWN }"
  if [[ "$READING" == ADDRESSED_UNKNOWN* ]] && [ "$BCAST" = 0 ]; then die "\"${LINE%%:*}\" is not a seat id or Soul name, so this would go to EVERY seat. Fix the name, or pass --broadcast."; fi
  [[ "$READING" == ERROR:* ]] && die "the director would reject this line"
  [[ "$READING" == *"UNKNOWN level"* ]] && die "unknown economy level: the cast's levels are lean, normal, rich (plus any the cast defines)"
fi

# Write with a guard: if no reader holds the pipe the open would block forever.
( printf '%s\n' "$LINE" > "$PIPE" ) & W=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do alive "$W" || break; sleep 0.5; done
if alive "$W"; then kill "$W" 2>/dev/null || true; die "nobody is reading $PIPE (director gone?)"; fi
wait "$W" || die "write to $PIPE failed"
echo "sent: $LINE"

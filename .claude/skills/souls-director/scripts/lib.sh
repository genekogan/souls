#!/bin/bash
# lib.sh — shared helpers for the souls-director scripts (sourced, not run).
# State for the one live run lives in $STATE_DIR/current.env (shell-quoted vars written by direct.sh / run.sh).
# Everything defaults to paths inside the repo checkout (gitignored .e2e/); override with the env vars below.

_LIB_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIM_CHECKOUT="${SIM_CHECKOUT:-$(cd "$_LIB_HERE/../../../.." && pwd)}"   # repo root: where tools/playtest lives
STATE_DIR="${SIM_DIRECTOR_STATE:-$SIM_CHECKOUT/.e2e/playtest/live}"
STATE="$STATE_DIR/current.env"
RUNS_ROOT="${SIM_RUNS_ROOT:-$SIM_CHECKOUT/.e2e/playtest/runs}"
LOAD_MAX="${SIM_LOAD_MAX:-10}"

die() { echo "souls-director: $*" >&2; exit 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
load_state() { [ -f "$STATE" ] || return 1; # shellcheck disable=SC1090
  source "$STATE"; }

# Write the state file: save_state VAR...
save_state() {
  mkdir -p "$STATE_DIR"
  local tmp="$STATE.tmp.$$" v
  : > "$tmp"
  for v in "$@"; do printf '%s=%q\n' "$v" "${!v-}" >> "$tmp"; done
  mv "$tmp" "$STATE"
}

# 1-minute load average (Linux /proc, macOS sysctl, else uptime).
load1() {
  if [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg
  else sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || uptime | sed 's/.*averages*: *//; s/,.*//; s/ .*//'; fi
}

# Start a command detached from this shell (survives the tool call): nohup + setsid where available.
# usage: detach <stdin-file> <log> cmd args...   → sets DETACHED_PID
detach() {
  local in="$1" log="$2"; shift 2
  if command -v setsid >/dev/null 2>&1; then nohup setsid "$@" < "$in" > "$log" 2>&1 &
  else nohup "$@" < "$in" > "$log" 2>&1 & fi
  DETACHED_PID=$!; disown 2>/dev/null || true
}

# Node playtest processes (not the shells that wrap them).
playtest_procs() { ps ax -o pid=,command= | grep -E '^ *[0-9]+ node [^ ]*playtest\.mjs (run|direct|replay|replay-set)( |$)' | cut -c1-220; }

# The machine gate. Prints what it found; returns 1 if a rule blocks the start (high load, another playtest or
# replay on this machine, or a live run of ours). FORCE=1 turns blocks into warnings: only on the user's explicit say-so.
machine_gate() {
  local bad=0 l procs
  if load_state && alive "${NODE_PID:-}"; then echo "BLOCK: a run of ours is live: ${KIND:-?} ${RUN_DIR:-?} (pid $NODE_PID). End it first (end.sh)."; bad=1; fi
  l=$(load1); echo "load (1 min): ${l:-?}  (limit $LOAD_MAX)"
  if [ -n "$l" ] && awk -v l="$l" -v m="$LOAD_MAX" 'BEGIN{exit !(l>=m)}'; then echo "BLOCK: load ${l} >= ${LOAD_MAX}: the machine is busy (build, test run or measurement)."; bad=1; fi
  procs=$(playtest_procs)
  if [ -n "$procs" ]; then echo "BLOCK: another playtest/replay is running on this machine:"; echo "$procs" | sed 's/^/  /'; bad=1; fi
  if [ "$bad" = 1 ] && [ "${FORCE:-0}" = 1 ]; then echo "WARNING: --force given: starting despite the block above (explicit say-so only)."; return 0; fi
  return "$bad"
}

# The server root must be a built checkout: dev-world launcher, built web client, Soul controller CLI.
check_server_root() {
  local r="$1" miss=0 f
  for f in tools/god-skill/dev-world.mjs apps/web/dist/index.html tools/world-launcher/soul/eden.mjs; do
    [ -e "$r/$f" ] || { echo "server root $r is missing $f"; miss=1; }
  done
  return "$miss"
}

stamp() { date -u +%Y%m%d-%H%M%S; }

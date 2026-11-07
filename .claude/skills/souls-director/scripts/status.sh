#!/bin/bash
# status.sh — one-screen picture of the live run (or of any run folder): process state, seat pairing, phase and
# current speaker, nudges, last director lines, last world speech, tokens and USD per seat, and the verdict if written.
#
# usage: status.sh [RUN_DIR] [--lines N] [--log FILE]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

N=8 DIR="" LOGF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lines) N="$2"; shift ;;
    --log) LOGF="$2"; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) DIR="$1" ;;
  esac
  shift
done

if [ -z "$DIR" ]; then
  if ! load_state; then [ -f "$STATE_DIR/last.env" ] || die "no run recorded in $STATE_DIR; pass a run folder"; source "$STATE_DIR/last.env"; echo "(no live run; showing the last one)"; fi
  DIR="$RUN_DIR"; LOGF="${LOGF:-$LOG}"
  if alive "${NODE_PID:-}"; then RUNNING="running (pid $NODE_PID)"; else RUNNING="FINISHED (pid ${NODE_PID:-?} gone)"; fi
  echo "== $KIND $(basename "$TARGET") · $RUNNING · started $STARTED · now $(date -u +%H:%M:%SZ)"
  [ "$KIND" = direct ] && { if [ -n "${FIFO:-}" ]; then echo "console pipe: $FIFO $([ -p "$FIFO" ] && echo open || echo GONE) · holder ${HOLDER_PID:-?} $(alive "${HOLDER_PID:-}" && echo alive || echo gone)"; else echo "headless (no live console)"; fi; }
  echo "load (1 min): $(load1)"
fi
[ -d "$DIR" ] || die "no run folder $DIR"
LOGF="${LOGF:-$DIR/console.log}"
echo "run dir: $DIR"

if [ -f "$LOGF" ]; then
  echo "== seats (log)"
  grep -E '\] seat [a-z0-9-]+: (paired|NOT PAIRED)|onboarding error|codex not installed|preflight failed|direct failed|machine gate' "$LOGF" | sed -E 's/^\[[a-z]+ [0-9:]+\] //' | tail -20 || echo "  (none yet: seats onboard for up to 10 minutes)"
  echo "== director, last $N lines"
  grep -E '^\[[0-9]{2}:[0-9]{2}\] |^console: |^status: ' "$LOGF" | tail -"$N" | cut -c1-240 || echo "  (none yet)"
  FINAL=$(grep -E '^\{"ok":' "$LOGF" | tail -1 || true); [ -n "$FINAL" ] && echo "== final: $FINAL"
fi

node -e '
const fs = require("fs"), path = require("path"); const dir = process.argv[1], N = +process.argv[2];
const J = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
const L = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const st = J("director/state.json"), cast = J("cast.json");
if (st) {
  const order = cast?.order ?? Object.keys(st.seats ?? {});
  console.log(`== phase ${st.phase}${st.paused ? " (PAUSED)" : ""} · speaker ${order[st.speakerIdx] ?? "-"} · ${st.elapsedSec ?? "?"} s · directions ${st.directions}${st.stopped ? " · stopped: " + st.stopped : ""}${st.gateReason ? " · gate " + st.gateReason : ""}`);
  console.log("  seat       pairing      room  done         speech dirs economy nudges(gather/left/speak/onboard) override");
  for (const id of order) { const s = st.seats?.[id]; if (!s) continue; const n = s.nudges ?? {};
    console.log(`  ${id.padEnd(10)} ${String(s.pairing).padEnd(12)} ${(s.present ? "in" : "out").padEnd(5)} ${String(s.done ?? "-").padEnd(12)} ${String(s.speeches).padStart(6)} ${String(s.directions).padStart(4)} ${String(s.economy).padEnd(7)} ${n.gather ?? 0}/${n.left ?? 0}/${n.speak ?? 0}/${n.onboard ?? 0}${s.override ? "  " + clip(s.override, 50) : ""}`); }
  for (const r of st.redirects ?? []) console.log(`  redirect ${r.seat} at ${r.t?.slice(11, 19)}Z${r.beforeTurn ? " (before its turn: held)" : ""}: ${clip(r.text, 90)}`);
}
const sp = L("director/speech.jsonl");
if (sp.length) { console.log(`== world speech, last ${Math.min(N, sp.length)} of ${sp.length}`); for (const s of sp.slice(-N)) console.log(`  ${String(s.at ?? s.t ?? "").slice(11, 19)} ${s.seat.padEnd(9)}${s.present ? "" : "(outside) "}${s.speaker && s.speaker !== s.seat ? "[not its turn] " : ""}"${clip(s.text, 150)}"`); }
const seatsDir = path.join(dir, "seats"); let rows = [];
try { for (const id of fs.readdirSync(seatsDir)) { const c = L(`seats/${id}/cost.jsonl`); if (!c.length) continue;
  const t = c.reduce((a, x) => ({ usd: a.usd + (x.costUsd ?? 0), out: a.out + (x.outputTokens ?? 0), inp: a.inp + (x.inputTokens ?? 0) + (x.cacheCreationTokens ?? 0), cached: a.cached + (x.cachedTokens ?? 0), turns: a.turns + 1 }), { usd: 0, out: 0, inp: 0, cached: 0, turns: 0 });
  rows.push([id, t]); } } catch {}
if (rows.length) { const tot = rows.reduce((a, [, t]) => a + t.usd, 0); const plan = J("director/plan.json");
  console.log(`== cost: seats $${tot.toFixed(3)}${plan?.costUsd ? ` + planner $${plan.costUsd.toFixed(3)}` : ""}`);
  for (const [id, t] of rows) console.log(`  ${id.padEnd(10)} ${String(t.turns).padStart(3)} turns  out ${t.out}  in ${t.inp}  cache-read ${t.cached}  $${t.usd.toFixed(3)}`); }
const rc = (() => { try { return fs.readdirSync(path.join(dir, "receipts")).sort((a, b) => parseInt(a) - parseInt(b)); } catch { return []; } })();
if (rc.length) { const last = J(`receipts/${rc.at(-1)}`); console.log(`== receipts: ${rc.map((f) => f.replace(".json", "")).join(" ")} · last ok ${last?.ok}${last?.error ? " · " + clip(last.error, 160) : ""}`); }
' "$DIR" "$N"

V="$DIR/director/VERDICT.md"
if [ -f "$V" ]; then echo "== VERDICT ($V)"; sed -n '1,12p' "$V"; else echo "== no director/VERDICT.md yet"; fi
for f in REPORT.md story.html journal.md issues.md; do [ -f "$DIR/$f" ] && echo "   $DIR/$f"; done
exit 0

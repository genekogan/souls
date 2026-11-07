#!/bin/bash
# The ONE major bug-hunting validation (Gene, 2026-10-11): run once, near the end, on the merged integration base
# before it goes to main and production. The plan, durations and how to read the results are at the top of
# team/lanes/rec.md and in docs/god/MERGE-GUIDE.md §8.
#
#   tools/test-harness/one-validation.sh <outDir> [--baseline <tree at the previous production source>] [--skip V5,V8,…]
#
# Optional defaults: SUITE_BASELINE and SUITE_DESCRIPTORS; --baseline overrides SUITE_BASELINE.
# Ports: 5400–5449 only (port-remap moves Codex-era 4930–4969 test ports to 5400–5439, one step at a time).
# Never touches 4930–4970/4986/4987. Production data is only ever copied read-only (V8). Chrome steps take the lease.
# Steps run strictly one after another, so at most one heavy job is ever running.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:?usage: one-validation.sh <outDir> [--baseline <tree>] [--skip V1,V2]}"; shift
# Local paths are caller configuration; quoted placeholders are literal, never shell redirections.
BASELINE="${SUITE_BASELINE:-<worktrees>/reconcile-main-e8}"; SKIP=""
while [ $# -gt 0 ]; do case "$1" in --baseline) BASELINE="$2"; shift;; --skip) SKIP="$2"; shift;; esac; shift; done
mkdir -p "$OUT"; SUM="$OUT/SUMMARY.tsv"; echo -e "step\texit\tseconds\tlog" > "$SUM"
export SUITE_COVERAGE_DIR="$OUT"
REMAP="--import=$ROOT/tools/test-harness/port-remap.mjs"
DESCRIPTORS="${SUITE_DESCRIPTORS:-<team>/pm-integration/auth-account-20261009/runtime-modern-context-prep-001}"
cd "$ROOT" || exit 1
# Fan-out (modal_suite.py runs step groups in separate containers, then merges SUMMARY rows and logs):
#   SUITE_ONLY=V1-types,V3-packages,…  run only these steps (rows for nothing else); the cheap V2 builds still run
#                                       first, unrecorded, so later steps see the same tree as in the serial order.
#   V5_SHARD=<i>/<n>                    V5 runs contiguous slice i of n of the sorted server test files, balanced by
#                                       v5-durations.json; concatenating the n logs in order reproduces the serial TAP.
want() { [ -z "${SUITE_ONLY:-}" ] && return 0; case ",$SUITE_ONLY," in *",$1,"*) return 0;; esac; return 1; }
step() {  # step <id> <seconds> <command…>
  local id="$1" t="$2"; shift 2
  if ! want "$id"; then
    case "$id" in V2-build-*) perl -e 'alarm shift; exec @ARGV' "$t" "$@" > "$OUT/prep-$id.log" 2>&1;; esac
    return
  fi
  case ",$SKIP," in *",${id%%-*},"*|*",$id,"*) echo -e "$id\tSKIP\t0\t-" >> "$SUM"; return;; esac
  local s=$(date +%s); echo "== $id: $*"
  perl -e 'alarm shift; exec @ARGV' "$t" "$@" > "$OUT/$id.log" 2>&1; local rc=$?
  if [[ "$id" == V6-* ]]; then
    node "$ROOT/tools/test-harness/e2e-receipt.mjs" "$id" "$ROOT" "$OUT" "$s" >> "$OUT/$id.log" 2>&1
    local report_rc=$?; [ "$rc" -ne 0 ] || rc=$report_rc
  fi
  echo -e "$id\t$rc\t$(( $(date +%s) - s ))\t$OUT/$id.log" >> "$SUM"; tail -n 3 "$OUT/$id.log" | cut -c1-240
}
skipped() { case ",$SKIP," in *",$1,"*) return 0;; esac; return 1; }
busy() { lsof -nP -iTCP:5400-5449 -sTCP:LISTEN 2>/dev/null | tail -n +2; }

# V0 preflight: exact commit, clean tree, our range free, the production listeners present (read-only lsof).
{ echo "HEAD $(git rev-parse HEAD)"; git status --porcelain --untracked-files=no; echo "main $(git rev-parse main) ancestor-of-HEAD:$(git merge-base --is-ancestor main HEAD && echo yes || echo NO)";
  echo "range 5400-5449 listeners:"; busy; echo "production listeners (must be present, never touched):"; lsof -nP -iTCP:4950 -iTCP:4963 -iTCP:4964 -iTCP:4970 -sTCP:LISTEN | tail -n +2; } > "$OUT/V0-preflight.log" 2>&1
cat "$OUT/V0-preflight.log"; [ -z "$(busy)" ] || { echo "ports 5400-5449 busy: stop and investigate"; exit 1; }
# V0 media: every file of tools/assets/manifest.json in place (the Modal containers pull before the suite; locally: pnpm assets:pull)
if [ -f tools/assets/manifest.json ]; then
  node tools/assets/pull.mjs --check --quiet > "$OUT/V0-assets.log" 2>&1 || { cat "$OUT/V0-assets.log"; echo "media missing or wrong: pnpm assets:pull"; exit 1; }
fi

# V1 types (all packages); known main-only errors: apps/server/src/edge-comms-manual-replay.test.ts (MERGE-GUIDE F5)
step V1-types 1200 pnpm -r exec tsc --noEmit -p .
# V2 builds: root (old worlds) and /worlds (launcher prefix)
step V2-build-root 900 pnpm --filter @souls/web build
step V2-build-worlds 900 bash -c "cd apps/web && npx vite build --base /worlds/ --outDir $ROOT/.lane/web-worlds --emptyOutDir"
# V3 package and engine suites (no ports)
# Preserve actual executed-file proof for harness tests, including baseline loader repairs.
step V3-harness 1200 node --test --test-reporter=tap --test-reporter="$ROOT/tools/test-harness/file-reporter.mjs" --test-reporter-destination=stdout --test-reporter-destination="$OUT/V3-harness-files.jsonl" --test-concurrency=1 tools/test-harness/*.test.mjs
# lane WALK: no place of the fixed world fixtures / a fresh Eden 2026 genesis less walkable than tools/test-harness/walk/baseline
step V3-walk 900 node --test --test-reporter=tap --test-concurrency=1 tools/test-harness/walk/walk-gate.test.mjs
# lane BUDGET: no web chunk (or the total) of the build V2-build-root just made >= 10% over tools/test-harness/bundle-budget/baseline.json
step V3-bundle 600 node --test --test-reporter=tap --test-concurrency=1 tools/test-harness/bundle-budget/budget.test.mjs tools/test-harness/bundle-budget/bundle-gate.test.mjs
step V3-packages 2400 bash tools/test-harness/package-suite.sh
# Z3: with the pinned campus inputs staged (remote-suite.sh -> /in/campus), the full campus re-extraction runs too.
CAMPUS_FULL=0; CAMPUS_IN="${CAMPUS_ASSETS_DIR:-/in/campus}"
if want V3-mars-engine && [ -f "$CAMPUS_IN/campus-assets.json" ]; then
  node --input-type=module - "$CAMPUS_IN" "$ROOT" <<'JS' && CAMPUS_FULL=1 || echo "campus assets: staging failed; the full re-extraction stays skipped"
import { createHash } from 'node:crypto'; import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'; import { dirname, join } from 'node:path';
const [dir, root] = process.argv.slice(2), pins = JSON.parse(readFileSync(join(dir, 'campus-assets.json'), 'utf8'));
for (const [name, f] of Object.entries(pins.files)) {
  const to = join(root, f.to); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(dir, name), to);
  if (createHash('sha256').update(readFileSync(to)).digest('hex') !== f.sha256) throw Error(`${name}: not the pinned bytes`);
}
JS
fi
step V3-mars-engine 2400 env CAMPUS_FULL=$CAMPUS_FULL bash -c 'cd mars/viewer && node --test --test-reporter=tap --test-concurrency=4 engine/test/*.test.ts'
step V3-client-cli 1800 node --test --test-reporter=tap --test-concurrency=1 tools/edge-skill/*.test.mjs tools/client-eval/*.test.mjs
step V3-launcher-unit 1200 node --test --test-reporter=tap --test-concurrency=1 tools/world-launcher/*.test.mjs   # includes keeper.test (lane ports 5210-5259, keeper 6017-6019)
# V4 web tests: node runner (compare the failure set with the baseline's, F6) and bundled .tsx tests
step V4-web 900 bash tools/test-harness/web-suite.sh
if [ "$BASELINE" != none ]; then
  step V4-web-baseline 900 bash "$BASELINE/tools/test-harness/web-suite.sh"
fi
# V5 the FULL server suite, safely: every Codex-era port remapped, overrides set, serial.
# Step cap 9000 s (main had 3600 s; the serial suite takes ~3100-3300 s on Modal CPU and a slower box hit 3600 at 1089/1094).
server_tests() {
  local tree="$1"; shift
  cd "$tree/apps/server" || return 1
  local files=()
  if [ -n "${SERVER_TEST_FILES:-}" ]; then read -r -a files <<< "$SERVER_TEST_FILES";
  else shopt -s globstar nullglob; files=(src/**/*.test.ts); fi
  [ "${#files[@]}" -gt 0 ] || return 1
  local reporters=(--test-reporter=tap)
  if [ -n "${V5_SHARD:-}" ]; then
    printf '%s\n' "${files[@]}" > "$SUITE_COVERAGE_DIR/V5-all-files.txt"
    local picked; picked=$(node "$HARNESS_DIR/v5-shard.mjs" "$V5_SHARD" "$HARNESS_DIR/v5-durations.json" < "$SUITE_COVERAGE_DIR/V5-all-files.txt") || return 1
    mapfile -t files <<< "$picked"
    printf '%s\n' "${files[@]}" > "$SUITE_COVERAGE_DIR/V5-shard-files.txt"
    [ "${#files[@]}" -gt 0 ] || return 1
    reporters+=(--test-reporter="$HARNESS_DIR/file-reporter.mjs" --test-reporter-destination=stdout --test-reporter-destination="$SUITE_COVERAGE_DIR/V5-server-full-files.jsonl")
  fi
  env NODE_OPTIONS="$REMAP" PORT_REMAP_BASE=5400 TEST_MARS_PORT=5445 TEST_BODY_CLI_PORT=5446 node --test "${reporters[@]}" --test-concurrency=1 "${files[@]}"
}
export -f server_tests
export REMAP HARNESS_DIR="$ROOT/tools/test-harness"
step V5-server-full 9000 bash -c 'server_tests "$1"' _ "$ROOT"
if [ -n "${SERVER_TEST_FILES:-}" ] && [ "$BASELINE" != none ] && [ "$BASELINE" != "$ROOT" ]; then
  step V5-server-baseline 9000 bash -c 'server_tests "$1"' _ "$BASELINE"
fi
! want V5-server-full || [ -z "$(busy)" ] || echo "WARNING: listeners left in 5400-5449 after V5" | tee -a "$OUT/V5-server-full.log"
# V6 new worlds: god + Soul e2es (real servers, fake minds, $0), Clerk via synthetic issuer, under /worlds
step V6-scenarios 1500 node tools/god-skill/e2e/scenarios.mjs --port 5420
step V6-party 1500 node tools/god-skill/e2e/party.mjs --no-shots --port 5421
step V6-souls-r2 1500 node tools/god-skill/e2e/souls-r2.mjs --no-shots --port 5422
step V6-join-clerk 900 node tools/god-skill/e2e/join.mjs --mode clerk --base /worlds --port 5425 --range 5426-5429
step V6-join-dev 900 node tools/god-skill/e2e/join.mjs --mode dev --no-shots --port 5430 --range 5431-5434
for e in souls-ux mars-two lm-two; do [ -f tools/god-skill/e2e/$e.mjs ] && step V6-$e 1500 node tools/god-skill/e2e/$e.mjs --no-shots --port 5423; done
# V7 real input in real Chrome (lease, GPU), dpr 1 and 2
#   old worlds: local root-path eden/mars/LM from this tree (5401-5403) beside the baseline tree (5411-5413)
#   new world:  launcher under /worlds (5441, children 5442-5444): home → New world → arrival, camera, Join line
#   God modal:  its own launcher under /worlds (5445, children 5446-5447): tools/god-skill/e2e/launcher.mjs
if ! skipped V7 && want V7; then
OLD_WORLDS_OUT="$OUT/old-worlds" node tools/test-harness/old-worlds.mjs "$ROOT" 5401 head > "$OUT/V7-servers-head.log" 2>&1 & P1=$!
OLD_WORLDS_OUT="$OUT/old-worlds" node tools/test-harness/old-worlds.mjs "$BASELINE" 5411 base > "$OUT/V7-servers-base.log" 2>&1 & P2=$!
for p in 5403 5413; do for i in $(seq 1 90); do curl -s -m 2 "http://127.0.0.1:$p/w/littlemartians/v1/config" >/dev/null && break; sleep 2; done; done
export WALK_BUILDS='{"base":5411,"head":5401}'; step V7-old-worlds 1800 node tools/test-harness/walk-old.mjs "$OUT/V7-old-worlds"
kill $P1 $P2 2>/dev/null; sleep 3
node tools/world-launcher/launcher.mjs --port 5441 --range 5442-5444 --data "$OUT/launcher-data" --base /worlds --web "$ROOT/.lane/web-worlds" --mars-web "$ROOT/.lane/mars-web" --dev-auth > "$OUT/V7-launcher.log" 2>&1 & P3=$!
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:5441/worlds/__sim/worlds.json >/dev/null && break; sleep 1; done
step V7-new-world 1800 node tools/test-harness/walk-new.mjs http://127.0.0.1:5441 "$OUT/V7-new-world"
step V7-camera-dpr2 900 node tools/god-skill/e2e/camera-probe.mjs "$(node -e "const r=require('$OUT/V7-new-world/report.json');console.log((r.runs[0].created||'').split('?')[0])")" --dpr 2 --out "$OUT/V7-camera-dpr2"
kill $P3 2>/dev/null; sleep 3
# the God modal (B8, the rewritten launcher e2e): Connect, pairing, a command acked, undo/redo, weather, Forsake; own launcher
step V7-god-modal 900 node tools/god-skill/e2e/launcher.mjs --port 5445 --range 5446-5447 --web "$ROOT/.lane/web-worlds" --mars-web "$ROOT/.lane/mars-web" --out "$OUT/V7-god-modal"
fi
# V8 old-world data safety: production histories copied READ-ONLY, booted check-only on the baseline and on HEAD
step V8-history-boot 3600 node tools/test-harness/history-boot-compare.mjs --descriptors "$DESCRIPTORS" --baseline "$BASELINE" --candidate "$ROOT" --out "$OUT/V8-history" --worlds mars,littlemartians,eden

echo; echo "== SUMMARY ($SUM)"; column -t -s $'\t' "$SUM"; echo "leftover listeners in 5400-5449:"; busy

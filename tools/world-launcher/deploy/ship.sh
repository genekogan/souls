#!/usr/bin/env bash
# One root-only Soul release, start to finish, for every release. No prompts; it stops at the first failure before the
# release is live and says what is live, and after it is live it keeps collecting evidence and reports every failure.
#
#   tools/world-launcher/deploy/ship.sh --label <version> --sha <full sha> [--dry-run] [--from <step>] [--out <dir>]
#     --label    the release, such as 4.16. Backups are pre-r416-production-*, the outputs <out>
#     --sha      the commit to ship: must be HEAD, clean and on origin/main
#     --dry-run  prints every step and its commands; touches nothing remote and writes nothing. Exit 1 if a guard would stop
#     --from     resume at snapshot, stage, backup, probe-start, healthz, walks, poster, stall or cdn-walk (same --out)
#     --out      outputs (default $SHIP_OUT_ROOT/<label>)
#
# The host and every operator path come from the environment or an untracked deploy.env (docs/release.md has the table).
# Steps: preflight snapshot stage backup probe-start activate probe-check healthz walks poster stall cdn-walk
# Rollback changes code only. ROLLBACK.txt is written before the first change. Data is never restored or pruned.
# Tests (tools/world-launcher/ship-root.test.mjs) run all of this against a fake host through the SHIP_* seams.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SHIPD="$HERE/ship"; ROOT="${SHIP_ROOT:-$(cd "$HERE/../../.." && pwd)}"; TOOLS="$(cd "$HERE/../../.." && pwd)"
. "$HERE/deploy-env.sh"
ORIGIN="${SHIP_ORIGIN:-https://soul.game}"
HOST_ROOT="${SHIP_HOST_ROOT:-/srv/sim-worlds}"; HOST_DATA="${SHIP_HOST_DATA:-/srv/sim-worlds-data/production}"
HOST_CONF="${SHIP_HOST_CONF:-/etc/sim-worlds/production.conf}"; HOST_UNIT="${SHIP_HOST_UNIT:-sim-worlds@production}"; HOST_TMP="${SHIP_HOST_TMP:-/tmp}"
WALK_SLUGS="${SHIP_WALK_SLUGS:-eden mars-college-2026 mars-college-2027}"; PROBE_PAGE="${SHIP_PROBE_PAGE:-/w/eden/}"; POSTER_PAGE="${SHIP_POSTER_PAGE:-/w/eden/}"
RECEIPTS="${SHIP_RECEIPTS:-}"; PROBE_CLI="${SHIP_PROBE_CLI:-}"; BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-}"
OUT_ROOT="${SHIP_OUT_ROOT:-$ROOT/.local/ship}"; RELEASE_DIR="${SHIP_RELEASE_DIR:-$ROOT/.lane/release}"; PROBE_READY_S="${SHIP_PROBE_READY_S:-600}"
SSH="${SHIP_SSH:-ssh}"; SCP="${SHIP_SCP:-scp}"; NODE="${SHIP_NODE:-node}"; PY="${SHIP_PYTHON:-python3}"; RELEASE="${SHIP_RELEASE_SH:-$HERE/release.sh}"; CURL="${SHIP_CURL:-curl}"
VERDICT="$SHIPD/root-release.mjs"
STEPS="snapshot stage backup probe-start healthz walks poster stall cdn-walk"

usage() { sed -n '5,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
LABEL=""; SHA=""; DRY=0; FROM=""; OUT=""
while [ $# -gt 0 ]; do case "$1" in
  --label) LABEL="${2:-}"; shift;; --sha) SHA="${2:-}"; shift;; --dry-run) DRY=1;; --from) FROM="${2:-}"; shift;; --out) OUT="${2:-}"; shift;;
  *) usage;; esac; shift; done
[ -n "$LABEL" ] && [ -n "$SHA" ] || usage
case "$LABEL" in *[!A-Za-z0-9._-]*) echo "--label: letters, digits, ., - and _ only"; exit 2;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--sha: the full 40-character commit"; exit 2; }
if [ -n "$FROM" ]; then case " $STEPS " in *" $FROM "*) ;; *) echo "--from: one of $STEPS (activation always runs with a fresh probe, from probe-start)"; exit 2;; esac; fi
TAG="${LABEL//./}"; BUILD="we-${SHA:0:12}"; OUT="${OUT:-$OUT_ROOT/$LABEL}"; PDIR="$OUT/probe"; REL="$HOST_ROOT/releases/$BUILD"; MANIFEST="$RELEASE_DIR/$BUILD/RELEASE-MANIFEST.json"
HOST="$(deploy_target 2>/dev/null)" || HOST=""

# ---- plumbing -------------------------------------------------------------------------------------------------------
N=0; NSTEPS=12; CUR=""; STARTED=0; [ -z "$FROM" ] && STARTED=1; PROBLEMS=0; FAILED=""; PROBE_PID=""; PROBE_RC=""
LIVE="nothing on the host has changed yet"
say() { printf '%s\n' "$*"; }
quote() { local a s=""; for a in "$@"; do s="$s $(printf '%q' "$a")"; done; printf '%s' "${s# }"; }
# Both name the host only through deploy_target, so it never reaches a log or a dry-run plan. BatchMode: never a prompt.
rsh() { "$SSH" -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$@"; }
rcp() { "$SCP" -q -o BatchMode=yes "$1" "$HOST:$2"; }
step() {
  CUR="$1"; N=$((N + 1)); [ "$CUR" = "$FROM" ] && STARTED=1
  if [ "$STARTED" = 0 ]; then say "== [$N/$NSTEPS] $CUR: skipped (--from $FROM)"; return 1; fi
  say ""; say "== [$N/$NSTEPS] $CUR: $2"; T0=$(date +%s); return 0
}
done_step() { [ "$DRY" = 1 ] || { say "   $CUR done in $(( $(date +%s) - T0 )) s"; printf '%s ok %s\n' "$CUR" "$(date -u +%H:%M:%SZ)" >> "$OUT/STEPS.txt"; }; }
x() { say "   + $(quote "$@")"; [ "$DRY" = 1 ] || "$@"; }
x_in() { local f="$1"; shift; if [ "$1" = x_to ]; then shift; local o="$1"; shift; say "   + $(quote "$@") < $(basename "$f") > $o"; [ "$DRY" = 1 ] || "$@" < "$f" > "$o"; else say "   + $(quote "$@") < $(basename "$f")"; [ "$DRY" = 1 ] || "$@" < "$f"; fi; }
x_to() { local f="$1"; shift; say "   + $(quote "$@") > $f"; [ "$DRY" = 1 ] || "$@" > "$f"; }
result() { [ "$DRY" = 1 ] || printf '{"at":"%s","label":"%s","sha":"%s","build":"%s","status":"%s","detail":"%s"}\n' "$(date -u +%FT%TZ)" "$LABEL" "$SHA" "$BUILD" "$1" "$2" > "$OUT/ship-result.json"; }
stop_probe() { [ -n "$PROBE_PID" ] && kill -0 "$PROBE_PID" 2>/dev/null || return 0; say "   stopping the release probe"; touch "$PDIR/stop"; wait "$PROBE_PID" 2>/dev/null; PROBE_PID=""; }
die() {
  say ""; say "STOPPED at step $CUR: $*"; say "   live now: $LIVE"; stop_probe
  [ -f "$OUT/ROLLBACK.txt" ] && { say "   rollback, only if you decide to:"; sed 's/^/     /' "$OUT/ROLLBACK.txt"; }
  [ "$DRY" = 1 ] || { printf '%s STOPPED %s\n' "$CUR" "$(date -u +%H:%M:%SZ)" >> "$OUT/STEPS.txt"; result stopped "$CUR"; }
  exit 1
}
trap 'die "interrupted"' INT TERM
# live <name> <log> <cmd...>: a post-live check. Its failure is recorded and the later evidence still runs.
live() {
  local name="$1" log="$2" rc=0; shift 2; say "   + $(quote "$@") > $log"; [ "$DRY" = 1 ] && return 0
  "$@" > "$log" 2>&1 || rc=$?
  printf '%s %s\n' "$name" "$rc" >> "$OUT/POSTLIVE.txt"
  if [ "$rc" != 0 ]; then say "   FAILED $name (exit $rc), recorded in $log; continuing"; FAILED="$FAILED $name"; fi
}
# collect <prefix>: public healthz and read-only host metadata into <prefix>-health.json and <prefix>-remote.json
collect() {
  x_to "$1-health.json" "$CURL" -fsS --max-time 30 "$ORIGIN/__sim/healthz" || die "public healthz did not answer"
  x_in "$SHIPD/host-snapshot.py" x_to "$1-remote.json" rsh "python3 - $(quote "$HOST_ROOT/production" "$HOST_DATA" "$HOST_CONF" "$HOST_UNIT")" || die "cannot read the host metadata"
}
drift() { collect "$OUT/check"; [ "$DRY" = 1 ] || node "$VERDICT" drift "$OUT/snapshot.json" "$OUT/check-health.json" "$OUT/check-remote.json" || die "the host changed since the snapshot"; }

say "ship $BUILD (label $LABEL)$([ "$DRY" = 1 ] && echo ' -- DRY RUN: nothing remote is touched, nothing is written')"
say "   outputs $OUT${FROM:+; resuming at $FROM}"

# ---- 1 preflight: every guard, on every run, resumed or not ---------------------------------------------------------
N=1; CUR=preflight; say ""; say "== [1/$NSTEPS] preflight: guards (local only)"
pf() { if [ "$DRY" = 1 ]; then say "   PREFLIGHT WOULD STOP: $*"; PROBLEMS=$((PROBLEMS + 1)); else say ""; say "REFUSED: $*"; say "   nothing on the host has changed"; exit 1; fi; }
[ -n "$HOST" ] || pf "SIM_DEPLOY_HOST is not set (environment or deploy.env; there is no host option)"
case "$(node --version)" in v22.*|v23.*|v24.*) ;; *) pf "need Node 22 or later, have $(node --version)";; esac
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || pf "uncommitted changes: the release is exactly $SHA"
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$SHA" ] || pf "HEAD is $(git -C "$ROOT" rev-parse HEAD), not --sha"
[ "$DRY" = 1 ] || git -C "$ROOT" fetch -q origin main || pf "cannot fetch origin main"
git -C "$ROOT" merge-base --is-ancestor "$SHA" origin/main 2>/dev/null || pf "$SHA is not an ancestor of origin/main"
if [ -z "$RECEIPTS" ]; then pf "SHIP_RECEIPTS is not set: the folder with receipt.json and ship-receipt.json"
elif ! node "$VERDICT" receipts "$RECEIPTS/receipt.json" "$RECEIPTS/ship-receipt.json" "$SHA" | sed 's/^/   /'; then pf "the gate and ship receipts are not clean for this commit"; fi
[ -n "$PROBE_CLI" ] && [ -d "$PROBE_CLI" ] || pf "SHIP_PROBE_CLI is not the release-probe god folder"
[ -n "$BROWSERS" ] && [ -n "$(find "$BROWSERS" -maxdepth 6 -path '*/chromium*' -type f \( -name chrome -o -name Chromium -o -name 'Google Chrome for Testing' -o -name headless_shell -o -name chrome-headless-shell \) -perm -u+x 2>/dev/null | head -1)" ] \
  || pf "PLAYWRIGHT_BROWSERS_PATH holds no Chromium (the probe and the walks need one)"
[ -d "$TOOLS/mars/viewer" ] || pf "no mars/viewer for Playwright"
for f in "$RELEASE" "$HERE/release-manifest.mjs" "$HERE/release-probe.mjs" "$TOOLS/tools/cdn/cdn-walk.mjs" "$SHIPD/compact-backup.sh" "$SHIPD/compact-copy.py" "$SHIPD/quick-check.mjs" "$SHIPD/host-snapshot.py" "$SHIPD/host-activate.sh" "$SHIPD/walk.mjs" "$SHIPD/poster.mjs" "$SHIPD/poster-count.py" "$SHIPD/stall.mjs" "$SHIPD/checks.mjs"; do
  [ -e "$f" ] || pf "missing $f"; done
if [ -e "$OUT/STEPS.txt" ] && [ -z "$FROM" ]; then pf "$OUT already holds a run: resume it with --from <step>, or pass another --out"; fi
if [ "$DRY" = 0 ]; then mkdir -p "$OUT" || exit 1; exec > >(tee -a "$OUT/ship.log") 2>&1; echo "$BUILD label $LABEL started $(date -u +%FT%TZ)" >> "$OUT/STEPS.txt"; rsh true || die "ssh to the host failed"; fi
# Each browser tool takes its own Chrome lease; none of these may be inherited from another run.
unset SIM_HEAVY_SLOT EDEN_GOD_NO_LEASE PHONE WIN CPU DESK
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" SHIP_PLAYWRIGHT_FROM="$TOOLS/mars/viewer" EDEN_GOD_PLAYWRIGHT_FROM="$TOOLS/mars/viewer" EDEN_GOD_NO_NPX=1 SIM_CHROME_LEASE="$TOOLS/tools/god-skill/lib/chrome-lease.mjs" CHROME_LEASE_SLOTS="${CHROME_LEASE_SLOTS:-3}"

# ---- 2 snapshot -----------------------------------------------------------------------------------------------------
if step snapshot "read-only host metadata (every database by name, body-collections.sqlite too), ROLLBACK.txt"; then
  collect "$OUT/before"
  if [ "$DRY" = 0 ]; then
    node "$VERDICT" snapshot "$OUT/before-health.json" "$OUT/before-remote.json" "$SHA" "$OUT/snapshot.json" | sed 's/^/   /'; [ "${PIPESTATUS[0]}" = 0 ] || die "the host is not ready for a release"
    PREV="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).previousBuild" "$OUT/snapshot.json")"
    cat > "$OUT/ROLLBACK.txt" <<ROLLBACK
Root-only rollback for $LABEL. The host comes from SIM_DEPLOY_HOST; never write it into a public record.
Previous: $PREV. Candidate: $BUILD.
Look at the current target first. If it is the candidate, roll code back through the approved script:

ssh "\$SIM_DEPLOY_USER@\$SIM_DEPLOY_HOST" bash $HOST_ROOT/releases/$PREV/tools/world-launcher/deploy/activate.sh production $HOST_ROOT/releases/$PREV --reload

Then require public healthz at $PREV with every registered world healthy, and record why. If the target is already the
previous build, verify without changing anything. Refuse to overwrite an unrelated target. Never restore or delete a world
or account database, edit registry identities, change auth or host settings, or prune artifacts.
ROLLBACK
    say "   previous $PREV; rollback in $OUT/ROLLBACK.txt"
  fi
  done_step
fi

# ---- 3 stage --------------------------------------------------------------------------------------------------------
if step stage "build and upload at base / with --no-activate; verify the manifest locally and on the host"; then
  if [ -f "$OUT/upload-receipt.json" ]; then say "   already uploaded"
  else
    x env SIM_WORLDS_BASE=/ SIM_ASSETS_CDN_ENABLED=1 SIM_DEPLOY_USER="${SIM_DEPLOY_USER:-root}" bash "$RELEASE" production --no-activate || die "stage failed: inspect, don't rerun blindly"
    x "$NODE" "$HERE/release-manifest.mjs" verify "$RELEASE_DIR/$BUILD" "$MANIFEST" || die "the local manifest does not verify"
    x_in "$HERE/release-manifest.mjs" rsh "node --input-type=module - verify $REL $REL/RELEASE-MANIFEST.json" || die "the host manifest does not verify"
    [ "$DRY" = 1 ] || node -e 'const fs=require("fs"),c=require("crypto");fs.writeFileSync(process.argv[1],JSON.stringify({at:new Date().toISOString(),sha:process.argv[2],build:process.argv[3],rootBase:"/",localManifestVerified:true,remoteManifestVerified:true,manifestSha256:c.createHash("sha256").update(fs.readFileSync(process.argv[4])).digest("hex")},null,2)+"\n")' "$OUT/upload-receipt.json" "$SHA" "$BUILD" "$MANIFEST" || die "cannot write the upload receipt"
  fi
  drift; done_step
fi

# ---- 4 backup -------------------------------------------------------------------------------------------------------
if step backup "row-verified compact copy of every database; quick_check each; the same filenames as the snapshot"; then
  if [ -f "$OUT/backup-receipt.json" ]; then rm -f "$OUT/backup-receipt.json"; say "   replacing an earlier backup receipt with a fresh backup"; fi
  drift
  x rcp "$SHIPD/compact-backup.sh" "$HOST_TMP/compact-backup.sh" || die "cannot copy compact-backup.sh"
  x rcp "$SHIPD/compact-copy.py" "$HOST_TMP/compact-copy.py" || die "cannot copy compact-copy.py"
  x rcp "$SHIPD/quick-check.mjs" "$HOST_TMP/sim-quick-check.mjs" || die "cannot copy quick-check.mjs"
  x_to "$OUT/backup.log" rsh "set -e; test \"\$(readlink $HOST_ROOT/production)\" != $REL; bash $HOST_TMP/compact-backup.sh pre-r$TAG production" || die "the backup failed (backup.log)"
  if [ "$DRY" = 0 ]; then
    B="$(tail -1 "$OUT/backup.log")"
    x_to "$OUT/backup-quick-check.log" rsh "set -e; node $HOST_TMP/sim-quick-check.mjs \$(find $(quote "$B") -type f \\( -name '*.db' -o -name '*.sqlite' \\))" || die "quick_check failed (backup-quick-check.log)"
    node "$VERDICT" backup "$OUT/backup.log" "$OUT/backup-quick-check.log" "$OUT/snapshot.json" "$TAG" "$OUT/backup-receipt.json" | sed 's/^/   /'; [ "${PIPESTATUS[0]}" = 0 ] || die "the backup does not cover every database"
  else say "   + quick_check every copy; compare with the snapshot's filenames"; fi
  done_step
fi

# ---- 5 probe start --------------------------------------------------------------------------------------------------
if step probe-start "the release probe watches the visitor bar across the handover"; then
  [ -e "$PDIR" ] && [ "$DRY" = 0 ] && mv "$PDIR" "$PDIR.$(date +%s)"
  say "   + $(quote "$NODE" "$HERE/release-probe.mjs" --origin "$ORIGIN" --pages "$PROBE_PAGE" --phone-pages "$PROBE_PAGE" --expect-build "$BUILD" --out "$PDIR" --after-s 60 --settle-s 20 --arrive-every 6 --cli-every 1 --cli '$SHIP_PROBE_CLI') &"
  if [ "$DRY" = 0 ]; then
    "$NODE" "$HERE/release-probe.mjs" --origin "$ORIGIN" --pages "$PROBE_PAGE" --phone-pages "$PROBE_PAGE" --expect-build "$BUILD" --out "$PDIR" --after-s 60 --settle-s 20 --arrive-every 6 --cli-every 1 --cli "$PROBE_CLI" > "$OUT/probe.log" 2>&1 &
    PROBE_PID=$!
    waited=0; until [ -f "$PDIR/ready" ]; do
      kill -0 "$PROBE_PID" 2>/dev/null || { PROBE_PID=""; die "the probe exited before it was ready (probe.log)"; }
      [ "$waited" -lt "$PROBE_READY_S" ] || die "the probe was not ready in $PROBE_READY_S s (probe.log)"
      sleep 1; waited=$((waited + 1)); done
    say "   ready after $waited s"
  fi
  done_step
fi

# ---- 6 activate -----------------------------------------------------------------------------------------------------
if step activate "one guarded --reload; a failed handover or health check rolls code back on the host"; then
  if [ "$DRY" = 0 ]; then
    [ -n "$PROBE_PID" ] || die "no probe is running: resume with --from probe-start"
    node "$VERDICT" activation "$OUT/snapshot.json" "$OUT/backup-receipt.json" "$OUT/upload-receipt.json" "$MANIFEST" | sed 's/^/   /'; [ "${PIPESTATUS[0]}" = 0 ] || die "activation preconditions failed"
    drift
    A="$(node -p 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1])),u=JSON.parse(fs.readFileSync(process.argv[2]));[s.previousBuild,u.manifestSha256,s.remote.worlds,s.remote.configurationSha256].join(" ")' "$OUT/snapshot.json" "$OUT/upload-receipt.json")"
  else A='<previous> <manifest sha256> <worlds> <config sha256>'; fi
  LIVE="the activation started: check healthz; the host rolls back by itself on failure"
  x_in "$SHIPD/host-activate.sh" rsh "bash -s -- $(quote "$HOST_ROOT" "$HOST_DATA" "$HOST_CONF" "$HOST_UNIT" "$ORIGIN" "$BUILD") $A" || die "the activation failed; the host rolled code back"
  LIVE="$BUILD is live"; x touch "$PDIR/released"; done_step
fi

# ---- 7 probe check --------------------------------------------------------------------------------------------------
if step probe-check "the probe's verdict: 0 pass, 1 visitor bar missed (the release is live), 3 rolled back"; then
  if [ "$DRY" = 0 ]; then
    if [ -n "$PROBE_PID" ]; then wait "$PROBE_PID"; PROBE_RC=$?; PROBE_PID=""; echo "$PROBE_RC" > "$PDIR/exit-code"; else PROBE_RC="not run"; fi
    case "$PROBE_RC" in
      0) say "   probe PASS";;
      1) say "   probe: the visitor bar was missed; the release is live; recorded in probe/report.json"; printf 'probe 1\n' >> "$OUT/POSTLIVE.txt"; FAILED="$FAILED probe";;
      3) LIVE="the release rolled back"; die "probe exit 3: the release rolled back (probe/report.json)";;
      "not run") say "   no probe in this run (resumed past probe-start)";;
      *) printf 'probe %s\n' "$PROBE_RC" >> "$OUT/POSTLIVE.txt"; FAILED="$FAILED probe"; say "   the probe ended with exit $PROBE_RC; recorded (probe.log)";;
    esac
  fi
  done_step
fi

# ---- 8 healthz ------------------------------------------------------------------------------------------------------
if step healthz "public healthz reports this build, every world and hostOk"; then
  x_to "$OUT/live-health.json" "$CURL" -fsS --max-time 30 "$ORIGIN/__sim/healthz" || die "public healthz did not answer after activation"
  if [ "$DRY" = 0 ]; then
    W="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).remote.worlds" "$OUT/snapshot.json")"
    node "$VERDICT" health "$OUT/live-health.json" "$BUILD" "$W" | sed 's/^/   /'; [ "${PIPESTATUS[0]}" = 0 ] || die "healthz is wrong after activation"
  fi
  done_step
fi

# ---- 9-12 post-live evidence: a failed check is recorded and the rest still run --------------------------------------
URLS=(); for s in $WALK_SLUGS; do URLS+=("$ORIGIN/w/$s/"); done; WALK_EXPECT=$(( ${#URLS[@]} * 4 ))
if step walks "stranger walks, desktop and phone at dpr 1 and 2: $WALK_EXPECT arrivals, 0 errors, 0 resync"; then
  live walk-desktop "$OUT/walk-desktop.log" env DPRS=1,2 "$NODE" "$SHIPD/walk.mjs" "$OUT/walk-desktop" "${URLS[@]}"
  live walk-phone "$OUT/walk-phone.log" env PHONE=1 DPRS=1,2 "$NODE" "$SHIPD/walk.mjs" "$OUT/walk-phone" "${URLS[@]}"
  live walks-verdict "$OUT/walks-check.txt" "$NODE" "$SHIPD/checks.mjs" walks "$WALK_EXPECT" "$OUT/walk-desktop/walk.json" "$OUT/walk-phone/walk.json"
  done_step
fi
if step poster "phone poster x3: a world frame every run, never blank after it"; then
  [ "$DRY" = 1 ] || mkdir -p "$OUT/poster"
  live poster-capture "$OUT/poster.log" "$NODE" "$SHIPD/poster.mjs" "$OUT/poster" "$ORIGIN$POSTER_PAGE" 3
  live poster-classify "$OUT/poster-count.txt" "$PY" "$SHIPD/poster-count.py" "$OUT/poster"
  live poster-verdict "$OUT/poster-check.txt" "$NODE" "$SHIPD/checks.mjs" poster "$OUT/poster.log" "$OUT/poster-count.txt" 3
  done_step
fi
if step stall "phone stall x4: no frame gap over 1 s"; then
  [ "$DRY" = 1 ] || mkdir -p "$OUT/stall"
  live stall-capture "$OUT/stall.log" "$NODE" "$SHIPD/stall.mjs" "$ORIGIN$POSTER_PAGE" 4 "$OUT/stall"
  live stall-verdict "$OUT/stall-check.txt" "$NODE" "$SHIPD/checks.mjs" stall "$OUT/stall.log" 4
  done_step
fi
if step cdn-walk "every manifest asset from the CDN, desktop and phone"; then
  live cdn-walk "$OUT/cdn-walk.log" "$NODE" "$TOOLS/tools/cdn/cdn-walk.mjs" "$OUT/cdn-walk" "${URLS[@]}" --devices desktop1,phone2
  done_step
fi

say ""
if [ "$DRY" = 1 ]; then
  say "DRY RUN complete: $NSTEPS steps printed, nothing ran.$([ "$PROBLEMS" = 0 ] || echo " PREFLIGHT: $PROBLEMS problem(s) above would stop a real run.")"
  [ "$PROBLEMS" = 0 ] || exit 1
elif [ -n "$FAILED" ]; then
  result live-with-failures "${FAILED# }"; say "$BUILD is LIVE, with failed checks:$FAILED. See $OUT/POSTLIVE.txt, then decide; $OUT/ROLLBACK.txt has the rollback."; exit 1
else result live "every step passed"; say "SHIPPED $BUILD: every step passed ($OUT/STEPS.txt)."; fi

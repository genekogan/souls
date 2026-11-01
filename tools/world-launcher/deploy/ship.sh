#!/usr/bin/env bash
# One Sim release, start to finish, in the proven order (lane RR, 2026-10-20). It replaces the release owner's recipe
# spread over team/scratch (r7/backup.sh, r8/walks.sh, r6/poster.mjs, r5/stall.mjs, the legacy refresh from the ship log
# "18:32Z R2->R3" entry, the 3.49 probe order and the cdn-walk); those scripts now live in deploy/ship/.
#
#   tools/world-launcher/deploy/ship.sh --label <n> --topology <root-only|dual-prefix> [--dry-run] [--from <step>] [--no-probe] [--out <dir>]
#     --label    the release number without dots (353 for 3.53): backups are pre-r<n>-*, the outputs <out>
#     --topology root-only for souls.game, dual-prefix for the original two-stage host; required
#     --dry-run  prints every step and its exact commands; nothing runs, nothing is written, eden2 is not contacted
#     --from     resume at <step> after a stop (same --label, so the same <out>); earlier steps are skipped
#     --no-probe skip the live release probe (probe-start, released, probe-check)
#     --exclude-world <slug>  omit an explicitly excluded /worlds/w/<slug>/ from arrival walks; repeatable
#     --out      outputs (default .local/ship/<label>)
#
# Run it from the release worktree, clean, at the exact gated head (release.sh ships HEAD). Steps, in order:
#   preflight        local only: clean tree, Mars web assets, media (tools/assets), tools, probe god folder, outputs folder
#   backup           row-verified compact copies of every production + legacy world db on eden2; quick_check each = ok
#   legacy-upload    release.sh legacy: build + upload the root build we-<sha12>-root (never activates)
#   probe-start      release-probe.mjs in the background (desktop + phone /worlds/w/eden-2026/ and /w/eden/, CLI edits in
#                    the release-probe world (its own required god folder: RELEASES.md "Release-probe world"),
#                    --expect-build we-<sha12>); waits for <out>/probe/ready
#   release          release.sh production --reload (activate.sh hands over and rolls back by itself on a failed handover)
#   legacy-activate  sha256sum -c FILES.sha256, activate.sh legacy --reload, then LEGACY-RELEASE = we-<sha12>-root
#   released         touch <out>/probe/released (the probe watches 60 s more, then exits)
#   probe-check      the probe's exit: 0 pass, 1 visitor bar failed, 3 the release rolled back
#   walks            walk.mjs desktop 7 worlds at dpr 1+2 (Nemo Owen picked on /w/eden) + phone 3 worlds: 17 arrivals,
#                    0 errors, 0 resync, picks ok
#   poster           poster.mjs Eden 2026 phone x3 + poster-count.py: a world frame every run, never blank after it
#   stall            stall.mjs Eden 2026 phone x4: no frame gap over 1 s
#   cdn-walk         tools/cdn/cdn-walk.mjs Eden 2026, /w/mars, /w/eden at desktop + phone dpr 1+2: must PASS
# Any failure stops the run: it says what is live at that moment, prints the rollback commands, and the --from to resume.
# Not done here (the release owner's hands): lane-specific live checks, ff main + push, the SHIP-LOG entry, RESUME.
#
# Test seams (tools/world-launcher/ship.test.mjs): SHIP_SSH, SHIP_SCP, SHIP_NODE, SHIP_PYTHON, SHIP_RELEASE_SH replace the
# commands; SHIP_TEST=1 (only with all five set) takes the build id from SHIP_BUILD instead of git.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SHIPD="$HERE/ship"; ROOT="$(cd "$HERE/../../.." && pwd)"
# The box ([SIM_DEPLOY_USER@]SIM_DEPLOY_HOST) and the operator paths below come from the environment or the untracked
# deploy.env (template: deploy.env.example).
. "$HERE/deploy-env.sh"
HOST="$(deploy_target)" || exit 2
ORIGIN="${SHIP_ORIGIN:-}"
# lane OPS2: the probe's CLI edits go to the dedicated release-probe world (an unlisted scratch test world, RELEASES.md
# "Release-probe world"). Missing setup fails preflight; never fall back to a person's world.
PROBE_CLI_DEFAULT="$ROOT/.local/release-probe"
PROBE_CLI="${SHIP_PROBE_CLI:-$PROBE_CLI_DEFAULT}"
LEGACY_FILE="${SHIP_LEGACY_RELEASE_FILE:-$ROOT/.local/ship/LEGACY-RELEASE}"
LOCK_FILE="${SHIP_DEPLOY_LOCK:-$ROOT/.local/ship/DEPLOY.lock}"
OUT_ROOT="${SHIP_OUT_ROOT:-$ROOT/.local/ship}"
PROBE_READY_S="${SHIP_PROBE_READY_S:-600}"
SSH="${SHIP_SSH:-ssh}"; SCP="${SHIP_SCP:-scp}"; NODE="${SHIP_NODE:-node}"; PY="${SHIP_PYTHON:-python3}"; RELEASE="${SHIP_RELEASE_SH:-$HERE/release.sh}"
# the walks (as r8/walks.sh): desktop worlds (=<Explore pick>), phone worlds; the probe and CDN pages
WALK_DESKTOP="/w/eden/=Nemo Owen|/w/mars/|/w/littlemartians/|/worlds/w/eden-2026/|/worlds/w/godmode-lab/|/worlds/w/my-mars-college-2026-3/|/worlds/w/little-martians-arium/"
WALK_PHONE="/w/eden/|/worlds/w/eden-2026/|/worlds/w/little-martians-arium/"
WALK_EXPECT=17   # 7 desktop worlds x dpr 1,2 + 3 phone worlds x dpr 3
PROBE_PAGES="/worlds/w/eden-2026/,/w/eden/"
CDN_PAGES="/worlds/w/eden-2026/ /w/mars /w/eden"
STEPS="preflight backup legacy-upload probe-start release legacy-activate released probe-check walks poster stall cdn-walk"
NSTEPS=12
TOPOLOGY="${SHIP_TOPOLOGY:-}"; WORLD_BASE=/worlds; EDEN_PAGE=/worlds/w/eden-2026/

usage() { sed -n '6,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
LABEL=""; DRY=0; FROM=""; PROBE=1; OUT=""; EXCLUDED_WORLDS=""
while [ $# -gt 0 ]; do case "$1" in
  --exclude-world) EXCLUDED_WORLDS="$EXCLUDED_WORLDS ${2:-}"; [ -n "${2:-}" ] || usage; shift;;
  --topology) TOPOLOGY="${2:-}"; shift;;
  --label) LABEL="${2:-}"; shift;; --dry-run) DRY=1;; --from) FROM="${2:-}"; shift;; --no-probe) PROBE=0;; --out) OUT="${2:-}"; shift;;
  *) usage;; esac; shift; done
[ -n "$LABEL" ] || usage
case "$LABEL" in *[!A-Za-z0-9_-]*) echo "--label: letters, digits, - and _ only (353 for 3.53)"; exit 2;; esac
case "$TOPOLOGY" in
  root-only)
    [ "${SIM_WORLDS_BASE-/}" = / ] || { echo "root-only requires SIM_WORLDS_BASE=/"; exit 2; }
    export SIM_WORLDS_BASE=/
    ORIGIN="${ORIGIN:-https://souls.game}"; WORLD_BASE=""; EDEN_PAGE=/w/eden/
    WALK_DESKTOP="/w/eden/|/w/mars-college-2026/|/w/mars-college-2027/"
    WALK_PHONE="$WALK_DESKTOP"
    PROBE_PAGES="/w/eden/,/w/mars-college-2026/,/w/mars-college-2027/"
    CDN_PAGES="/w/eden/ /w/mars-college-2026/ /w/mars-college-2027/"
    STEPS="preflight backup probe-start release released probe-check health walks poster stall cdn-walk"; NSTEPS=11;;
  dual-prefix)
    [ "${SIM_WORLDS_BASE-/worlds}" = /worlds ] || { echo "dual-prefix requires SIM_WORLDS_BASE=/worlds"; exit 2; }
    export SIM_WORLDS_BASE=/worlds
    ORIGIN="${ORIGIN:-https://sim.eden.art}";;
  *) echo "--topology root-only|dual-prefix is required (no implicit legacy deployment)"; exit 2;;
esac
if [ -n "$FROM" ]; then case " $STEPS " in *" $FROM "*) ;; *) echo "--from: one of $STEPS"; exit 2;; esac; fi
# A human scope exclusion changes only arrival coverage, never backup, probe or activation.
[ "$TOPOLOGY" != root-only ] || [ -z "$EXCLUDED_WORLDS" ] || { echo "root-only canonical world coverage cannot be excluded"; exit 2; }
for slug in $EXCLUDED_WORLDS; do
  case "$slug" in *[!a-z0-9-]*|'') echo "--exclude-world: invalid slug"; exit 2;; esac
  found=0; filtered=""; IFS='|' read -r -a paths <<< "$WALK_DESKTOP"
  for path in "${paths[@]}"; do
    if [ "$path" = "$WORLD_BASE/w/$slug/" ]; then found=1; else filtered="$filtered|$path"; fi
  done
  [ "$found" = 1 ] || { echo "--exclude-world: unknown or duplicate world $slug"; exit 2; }
  WALK_DESKTOP="${filtered#|}"; filtered=""; IFS='|' read -r -a paths <<< "$WALK_PHONE"
  for path in "${paths[@]}"; do [ "$path" = "$WORLD_BASE/w/$slug/" ] || filtered="$filtered|$path"; done
  WALK_PHONE="${filtered#|}"
  echo "Explicit arrival-walk exclusion: $slug"
done
IFS='|' read -r -a paths <<< "$WALK_DESKTOP"; WALK_DESKTOP_COUNT=${#paths[@]}
IFS='|' read -r -a paths <<< "$WALK_PHONE"; WALK_PHONE_COUNT=${#paths[@]}
WALK_EXPECT=$((WALK_DESKTOP_COUNT * 2 + WALK_PHONE_COUNT))
OUT="${OUT:-$OUT_ROOT/$LABEL}"; PDIR="$OUT/probe"
if [ "${SHIP_TEST:-}" = 1 ]; then
  [ -n "${SHIP_SSH:-}" ] && [ -n "${SHIP_SCP:-}" ] && [ -n "${SHIP_NODE:-}" ] && [ -n "${SHIP_PYTHON:-}" ] && [ -n "${SHIP_RELEASE_SH:-}" ] || { echo "SHIP_TEST=1 needs every SHIP_ command stubbed"; exit 2; }
  BUILD="${SHIP_BUILD:?SHIP_TEST needs SHIP_BUILD}"; SOURCE="$BUILD"
else
  SOURCE="$(git -C "$ROOT" rev-parse HEAD)" || exit 1
  BUILD="we-${SOURCE:0:12}"
fi
LBUILD="$BUILD-root"; PREL="/srv/sim-worlds/releases/$BUILD"; LREL="/srv/sim-old/releases/$LBUILD"

# ---- plumbing -------------------------------------------------------------------------------------------------------
N=0; CUR=""; STARTED=0; [ -z "$FROM" ] && STARTED=1
LIVE="nothing on eden2 has changed yet"; PROBE_PID=""; PREV_PROD=""; PREV_LEGACY=""; PROBLEMS=0
say() { printf '%s\n' "$*"; }
quote() { local a s=""; for a in "$@"; do s="$s $(printf '%q' "$a")"; done; printf '%s' "${s# }"; }
# step <name> <what>: announce it; returns 1 when --from skips it
step() {
  CUR="$1"; N=$((N + 1)); [ "$CUR" = "$FROM" ] && STARTED=1
  if [ "$STARTED" = 0 ]; then say "== [$N/$NSTEPS] $CUR: skipped (--from $FROM)"; return 1; fi
  say ""; say "== [$N/$NSTEPS] $CUR: $2"; T0=$(date +%s); return 0
}
done_step() { [ "$DRY" = 1 ] || { say "   $CUR ok in $(( $(date +%s) - T0 )) s"; printf '%s ok %ss %s\n' "$CUR" "$(( $(date +%s) - T0 ))" "$(date -u +%H:%M:%SZ)" >> "$OUT/STEPS.txt"; }; }
# x <cmd...>: print the exact command, run it (not in a dry run); x_to <file> <cmd...>: same, stdout to <file>
x() { say "   + $(quote "$@")"; [ "$DRY" = 1 ] || "$@"; }
x_to() { local f="$1"; shift; say "   + $(quote "$@") > $f"; [ "$DRY" = 1 ] || "$@" > "$f"; }
x_env_to() { local f="$1"; shift; say "   + $(quote "$@") > $f 2>&1"; [ "$DRY" = 1 ] || env "$@" > "$f" 2>&1; }
stop_probe() {
  [ -n "$PROBE_PID" ] && kill -0 "$PROBE_PID" 2>/dev/null || return 0
  say "   stopping the release probe (touch $PDIR/stop)"; touch "$PDIR/stop"; wait "$PROBE_PID" 2>/dev/null; PROBE_PID=""
}
rollback_help() {
  [ -f "$OUT/ROLLBACK.txt" ] || return 0
  say "   rollback (only if you decide to; see $OUT/ROLLBACK.txt):"; sed 's/^/     /' "$OUT/ROLLBACK.txt" 2>/dev/null
}
die() {
  say ""; say "STOPPED at step $CUR: $*"; say "   live now: $LIVE"
  stop_probe; rollback_help
  [ "$DRY" = 1 ] || printf '%s STOPPED %s %s\n' "$CUR" "$(date -u +%H:%M:%SZ)" "$*" >> "$OUT/STEPS.txt"
  say "   after fixing: $0 --label $LABEL --topology $TOPOLOGY --out $(quote "$OUT") --from $CUR$([ "$PROBE" = 1 ] || echo ' --no-probe')"
  exit 1
}
trap 'die "interrupted"' INT TERM
# the releases a rollback goes back to (read once, before the first eden2 change)
remember_prev() {
  [ "$DRY" = 0 ] && [ -z "$PREV_PROD" ] || return 0
  local p l
  local links="readlink /srv/sim-worlds/production; readlink /srv/sim-worlds/production.previous || true"
  [ "$TOPOLOGY" = root-only ] || links="$links; readlink /srv/sim-worlds/legacy; readlink /srv/sim-worlds/legacy.previous || true"
  p="$("$SSH" "$HOST" "$links")" || die "cannot read the stage links on $HOST"
  PREV_PROD="$(echo "$p" | sed -n 1p)"; [ "$PREV_PROD" != "$PREL" ] || PREV_PROD="$(echo "$p" | sed -n 2p)"
  [ -n "$PREV_PROD" ] || die "no production rollback stage link on $HOST"
  if [ "$TOPOLOGY" = dual-prefix ]; then
    PREV_LEGACY="$(echo "$p" | sed -n 3p)"; [ "$PREV_LEGACY" != "$LREL" ] || PREV_LEGACY="$(echo "$p" | sed -n 4p)"
    [ -n "$PREV_LEGACY" ] || die "no legacy rollback stage link on $HOST"
  fi
  { echo "production: $SSH $HOST bash $PREV_PROD/tools/world-launcher/deploy/activate.sh production $PREV_PROD --reload"
    if [ "$TOPOLOGY" = dual-prefix ]; then
      echo "legacy:     $SSH $HOST bash $PREV_LEGACY/tools/world-launcher/deploy/activate.sh legacy $PREV_LEGACY --reload && echo $(basename "$PREV_LEGACY") > $LEGACY_FILE"
    fi; } > "$OUT/ROLLBACK.txt"
  say "   previous: production $(basename "$PREV_PROD") (rollback commands in $OUT/ROLLBACK.txt)"
}

say "ship $BUILD (label $LABEL) from $ROOT$([ "$DRY" = 1 ] && echo ' -- DRY RUN: nothing runs, eden2 is not contacted')"
say "   topology $TOPOLOGY; web base $SIM_WORLDS_BASE; health $ORIGIN$WORLD_BASE/__sim/healthz"
say "   outputs $OUT; probe $([ "$PROBE" = 1 ] && echo on || echo 'off (--no-probe)')${FROM:+; resuming at $FROM}"

# A root-only resume is tied to the exact build, target, URLs and coverage of the original run.
# Do not source this file: it is data, never executable shell. No credentials are recorded.
IDENTITY="source=$SOURCE build=$BUILD topology=$TOPOLOGY host=$HOST origin=$ORIGIN base=$SIM_WORLDS_BASE label=$LABEL exclusions=$EXCLUDED_WORLDS"
if [ "$TOPOLOGY" = root-only ] && [ -n "$FROM" ] && [ "$DRY" = 0 ]; then
  CUR=resume
  [ -f "$OUT/RUN.identity" ] && [ "$(cat "$OUT/RUN.identity")" = "$IDENTITY" ] || { say "resume refused: missing or mismatched RUN.identity (build, topology, target or coverage)"; exit 2; }
  for previous in $STEPS; do
    [ "$previous" != "$FROM" ] || break
    if [ "$PROBE" = 0 ]; then case "$previous" in probe-start|released|probe-check) continue;; esac; fi
    awk -v step="$previous" '$1 == step { status=$2 } END { exit(status != "ok") }' "$OUT/STEPS.txt" || { say "resume refused: prerequisite $previous has not passed"; exit 2; }
  done
  if [ "${SHIP_TEST:-}" != 1 ]; then
    [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || { say "resume refused: uncommitted tracked changes"; exit 2; }
  fi
  LIVE="resuming recorded $BUILD run; confirm current health before relying on its live state"
fi

# ---- 1 preflight (local, read-only) ---------------------------------------------------------------------------------
if step preflight "local checks (nothing on eden2)"; then
  pf() { if [ "$DRY" = 1 ]; then say "   PREFLIGHT WOULD STOP: $*"; PROBLEMS=$((PROBLEMS + 1)); else die "$*"; fi; }
  if [ "${SHIP_TEST:-}" = 1 ]; then say "   SHIP_TEST: build $BUILD from SHIP_BUILD, git checks skipped"
  else
    [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || pf "uncommitted changes: the release is exactly HEAD ($BUILD)"
    say "   HEAD $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$ROOT" rev-parse --short=9 HEAD)"
    [ -d "$ROOT/node_modules" ] || pf "no node_modules in $ROOT (pnpm install --frozen-lockfile)"
    # release.sh pulls the web + runtime media; fetch them now (shared cache) so a missing object stops before eden2 is touched
    if [ "$DRY" = 1 ]; then (cd "$ROOT" && "$NODE" tools/assets/pull.mjs --check --quiet --set web,runtime) || pf "media not in place (pnpm assets:pull)"
    else (cd "$ROOT" && "$NODE" tools/assets/pull.mjs --quiet --set web,runtime) || pf "media could not be pulled (tools/assets/pull.mjs): release.sh needs it"; fi
  fi
  [ -d "${MARS_WEB_SRC:-$ROOT/.lane/mars-web}" ] || pf "no Mars web assets at ${MARS_WEB_SRC:-$ROOT/.lane/mars-web} (release.sh needs them)"
  for f in "$RELEASE" "$HERE/release-probe.mjs" "$ROOT/tools/cdn/cdn-walk.mjs" "$SHIPD/compact-backup.sh" "$SHIPD/quick-check.mjs" "$SHIPD/walk.mjs" "$SHIPD/poster.mjs" "$SHIPD/poster-count.py" "$SHIPD/stall.mjs" "$SHIPD/checks.mjs" "$SHIPD/health.mjs"; do
    [ -e "$f" ] || pf "missing $f"; done
  [ "$PROBE" = 0 ] || [ -d "$PROBE_CLI" ] || pf "no probe god folder $PROBE_CLI (or --no-probe)"
  [ "$PROBE" = 0 ] || say "   probe god folder $PROBE_CLI"
  [ "$TOPOLOGY" = root-only ] || [ -d "$(dirname "$LEGACY_FILE")" ] || pf "no folder for $LEGACY_FILE"
  if [ -e "$OUT/STEPS.txt" ] && [ -z "$FROM" ]; then pf "$OUT already holds a run: resume it with --from <step>, or pass another --out"; fi
  if [ -f "$LOCK_FILE" ]; then say "   lease: $(grep -m1 '^HELD\|^FREE\|^RELEASED' "$LOCK_FILE" | cut -c1-140)"; say "   lease, latest entry: $(grep -v '^[[:space:]]*$' "$LOCK_FILE" | tail -1 | cut -c1-140)"
  else say "   lease: no $LOCK_FILE"; fi
  [ "$DRY" = 1 ] || { mkdir -p "$OUT" && echo "$BUILD label $LABEL from $ROOT started $(date -u +%FT%TZ)" >> "$OUT/STEPS.txt"; }
  [ "$DRY" = 1 ] || printf '%s\n' "$IDENTITY" > "$OUT/RUN.identity"
  done_step
fi
[ "$DRY" = 1 ] || mkdir -p "$OUT" || exit 1
[ "$DRY" = 1 ] || exec > >(tee -a "$OUT/ship.log") 2>&1

# ---- 2 backup -------------------------------------------------------------------------------------------------------
if step backup "compact backups ($TOPOLOGY), quick_check every db"; then
  remember_prev
  x "$SCP" -q "$SHIPD/compact-backup.sh" "$HOST:/tmp/compact-backup.sh" || die "scp compact-backup.sh failed"
  x "$SCP" -q "$HERE/ship/compact-copy.py" "$HOST:/tmp/compact-copy.py" || die "scp compact-copy.py failed"
  x "$SCP" -q "$SHIPD/quick-check.mjs" "$HOST:/tmp/sim-quick-check.mjs" || die "scp quick-check.mjs failed"
  x_to "$OUT/backup-production.txt" "$SSH" "$HOST" "bash /tmp/compact-backup.sh pre-r$LABEL production" || die "production backup failed"
  BL=""
  if [ "$TOPOLOGY" = dual-prefix ]; then
    x_to "$OUT/backup-legacy.txt" "$SSH" "$HOST" "bash /tmp/compact-backup.sh pre-r$LABEL legacy" || die "legacy backup failed"
    if [ "$DRY" = 1 ]; then BL="<legacy backup dir>"; else
      BL="$(tail -1 "$OUT/backup-legacy.txt")"
      case "$BL" in /srv/sim-worlds-data/release-backups/pre-r$LABEL-legacy-*) ;; *) die "legacy backup did not report its folder";; esac
    fi
  fi
  if [ "$DRY" = 1 ]; then BP="<production backup dir>"; else
    BP="$(tail -1 "$OUT/backup-production.txt")"
    case "$BP" in /srv/sim-worlds-data/release-backups/pre-r$LABEL-production-*) ;; *) die "production backup did not report its folder";; esac
    say "   production=$BP"; [ -z "$BL" ] || say "   legacy=$BL"
  fi
  x_to "$OUT/quick-check.txt" "$SSH" "$HOST" "node /tmp/sim-quick-check.mjs \$(find $BP $BL -name '*.db' -o -name '*.sqlite')" || die "quick_check could not run"
  x "$NODE" "$SHIPD/checks.mjs" quick-check "$OUT/quick-check.txt" || die "a backup db is not ok (quick-check.txt)"
  LIVE="backups taken; nothing live has changed"
  done_step
fi

# ---- 3 legacy upload ------------------------------------------------------------------------------------------------
if [ "$TOPOLOGY" = dual-prefix ] && step legacy-upload "release.sh legacy: build + upload $LBUILD (not activated)"; then
  remember_prev
  (cd "$ROOT" && x "$RELEASE" legacy) || die "release.sh legacy failed (nothing activated)"
  LIVE="$LBUILD uploaded, not active; production and legacy unchanged"
  done_step
fi

# ---- 4 probe start --------------------------------------------------------------------------------------------------
if [ "$PROBE" = 1 ] && step probe-start "release probe in the background; wait for $PDIR/ready"; then
  set -- "$NODE" "$HERE/release-probe.mjs" --origin "$ORIGIN" --pages "$PROBE_PAGES" --phone-pages "$PROBE_PAGES" --cli "$PROBE_CLI" --expect-build "$BUILD" --out "$PDIR"
  say "   + $(quote "$@") > $OUT/probe.log 2>&1 &"
  if [ "$DRY" = 0 ]; then
    [ ! -e "$PDIR/ready" ] || mv "$PDIR" "$PDIR.$(date +%s)"   # a probe from an earlier attempt
    "$@" > "$OUT/probe.log" 2>&1 & PROBE_PID=$!
    say "   probe pid $PROBE_PID"; i=0
    until [ -e "$PDIR/ready" ]; do
      kill -0 "$PROBE_PID" 2>/dev/null || { tail -15 "$OUT/probe.log"; PROBE_PID=""; die "the probe exited before it was ready (probe.log)"; }
      i=$((i + 1)); [ "$i" -le "$PROBE_READY_S" ] || die "the probe was not ready after $PROBE_READY_S s"; sleep 1
    done
    say "   probe ready after ${i} s"
  fi
  done_step
elif [ "$PROBE" = 0 ]; then N=$((N + 1)); say "== [$N/$NSTEPS] probe-start: off (--no-probe)"; fi

# ---- 5 production release -------------------------------------------------------------------------------------------
if step release "release.sh production --reload"; then
  remember_prev
  (cd "$ROOT" && x "$RELEASE" production --reload) || { LIVE="release.sh production failed: activate.sh hands back to $(basename "${PREV_PROD:-?}") on a failed handover, confirm healthz; confirm the recorded topology in RUN.identity"; die "release.sh production failed"; }
  LIVE="production LIVE on $BUILD"
  [ "$TOPOLOGY" = root-only ] || LIVE="$LIVE; legacy still $(basename "${PREV_LEGACY:-<previous>}") ($LBUILD uploaded only)"
  done_step
fi

# ---- 6 legacy activate ----------------------------------------------------------------------------------------------
if [ "$TOPOLOGY" = dual-prefix ] && step legacy-activate "check FILES.sha256, activate.sh legacy --reload, LEGACY-RELEASE"; then
  remember_prev
  x "$SSH" "$HOST" "cd $LREL && sha256sum -c FILES.sha256 --quiet" || die "$LREL differs from its FILES.sha256 (legacy not activated)"
  x "$SSH" "$HOST" "bash $LREL/tools/world-launcher/deploy/activate.sh legacy $LREL --reload" || { LIVE="production LIVE on $BUILD; legacy activation failed (activate.sh rolls legacy back to $(basename "${PREV_LEGACY:-?}"))"; die "activate.sh legacy failed"; }
  say "   + echo $LBUILD > $LEGACY_FILE"; [ "$DRY" = 1 ] || echo "$LBUILD" > "$LEGACY_FILE" || die "could not write $LEGACY_FILE"
  LIVE="production + legacy LIVE on $BUILD"
  done_step
fi

# ---- 7 released -----------------------------------------------------------------------------------------------------
if [ "$PROBE" = 1 ] && step released "tell the probe the release is done (it watches 60 s more)"; then
  if [ "$DRY" = 1 ] || [ -n "$PROBE_PID" ]; then x touch "$PDIR/released"; else say "   no probe running in this run (resumed past probe-start): nothing to tell"; fi
  done_step
elif [ "$PROBE" = 0 ]; then N=$((N + 1)); say "== [$N/$NSTEPS] released: off (--no-probe)"; fi

# ---- 8 probe check --------------------------------------------------------------------------------------------------
if [ "$PROBE" = 1 ] && step probe-check "wait for the probe: 0 pass, 1 visitor bar failed, 3 rolled back"; then
  say "   + wait <probe pid>; read $PDIR/report.json"
  if [ "$DRY" = 0 ]; then
    if [ -n "$PROBE_PID" ]; then wait "$PROBE_PID"; rc=$?; PROBE_PID=""
    elif [ -f "$PDIR/exit-code" ]; then rc="$(cat "$PDIR/exit-code")"
    else die "no probe ran in this run and no earlier verdict: resume with --from walks (or rerun from probe-start)"; fi
    echo "$rc" > "$PDIR/exit-code"; tail -12 "$OUT/probe.log" | sed 's/^/   probe| /'
    case "$rc" in
      0) say "   probe PASS";;
      1) die "probe FAIL (exit 1): the visitor bar was missed during the release ($PDIR/report.json); the release IS live. Decide: roll back, or accept and continue with --from walks";;
      3) LIVE="the release ROLLED BACK (activate.sh put the previous build back)"; die "probe exit 3: the release rolled back ($PDIR/report.json)";;
      *) die "the probe ended with exit $rc (crashed or usage): read $OUT/probe.log; the release itself may be fine";;
    esac
  fi
  done_step
elif [ "$PROBE" = 0 ]; then N=$((N + 1)); say "== [$N/$NSTEPS] probe-check: off (--no-probe)"; fi

# Root-only health validates exact BUILD, canonical identities and read-only old URL aliases.
if [ "$TOPOLOGY" = root-only ] && step health "exact build, canonical worlds and preserved aliases"; then
  if [ "$DRY" = 0 ] && [ -f "$OUT/health.json" ]; then mv "$OUT/health.json" "$OUT/health.previous.$(date +%s).$RANDOM.json" || die "cannot preserve previous health receipt"; fi
  x_to "$OUT/health.json" "$NODE" "$SHIPD/health.mjs" "$ORIGIN" "$BUILD" || die "root-only health/URL verification failed (health.json)"
  done_step
fi

if [ "$TOPOLOGY" = root-only ] && [ "$DRY" = 0 ]; then
  case "$FROM" in walks|poster|stall|cdn-walk)
    CUR=health
    x_to "$OUT/resume-health.$(date +%s).$RANDOM.json" "$NODE" "$SHIPD/health.mjs" "$ORIGIN" "$BUILD" || die "resume health does not qualify the current live build";;
  esac
fi

# ---- 9 walks --------------------------------------------------------------------------------------------------------
if step walks "stranger walks: desktop $WALK_DESKTOP_COUNT worlds dpr 1+2, phone $WALK_PHONE_COUNT worlds; $WALK_EXPECT arrivals, 0 errors, 0 resync"; then
  IFS='|'; set -- $WALK_DESKTOP; unset IFS; d=""; for w in "$@"; do d="$d|$ORIGIN$w"; done
  IFS='|'; set -- $WALK_PHONE; unset IFS; ph=""; for w in "$@"; do ph="$ph|$ORIGIN$w"; done
  IFS='|'; set -- ${d#|}; unset IFS
  x_env_to "$OUT/walk.log" PICK2=1 "$NODE" "$SHIPD/walk.mjs" "$OUT/walk" "$@" || die "desktop walk failed (walk.log)"
  IFS='|'; set -- ${ph#|}; unset IFS
  x_env_to "$OUT/walk-phone.log" PHONE=1 DPRS=3 "$NODE" "$SHIPD/walk.mjs" "$OUT/walk-phone" "$@" || die "phone walk failed (walk-phone.log)"
  x_to "$OUT/walks-check.txt" "$NODE" "$SHIPD/checks.mjs" walks "$WALK_EXPECT" "$OUT/walk/walk.json" "$OUT/walk-phone/walk.json" || { cat "$OUT/walks-check.txt"; die "the walks missed their bar (walks-check.txt; shots in $OUT/walk*)"; }
  [ "$DRY" = 1 ] || sed 's/^/   /' "$OUT/walks-check.txt" | cut -c1-200
  done_step
fi

# ---- 10 poster ------------------------------------------------------------------------------------------------------
if step poster "phone poster x3 on Eden 2026: a world frame every run, never blank after it"; then
  x_env_to "$OUT/poster.log" "$NODE" "$SHIPD/poster.mjs" "$OUT/poster" "$ORIGIN$EDEN_PAGE" 3 || die "poster.mjs failed (poster.log)"
  x_to "$OUT/poster-count.txt" "$PY" "$SHIPD/poster-count.py" "$OUT/poster" || die "poster-count.py failed"
  x_to "$OUT/poster-check.txt" "$NODE" "$SHIPD/checks.mjs" poster "$OUT/poster.log" "$OUT/poster-count.txt" 3 || { cat "$OUT/poster-check.txt"; die "the poster missed its bar (poster-check.txt)"; }
  [ "$DRY" = 1 ] || sed 's/^/   /' "$OUT/poster-check.txt" | cut -c1-200
  done_step
fi

# ---- 11 stall -------------------------------------------------------------------------------------------------------
if step stall "phone stall x4 on Eden 2026: no frame gap over 1 s"; then
  x_env_to "$OUT/stall.log" "$NODE" "$SHIPD/stall.mjs" "$ORIGIN$EDEN_PAGE" 4 "$OUT" || die "stall.mjs failed (stall.log)"
  x_to "$OUT/stall-check.txt" "$NODE" "$SHIPD/checks.mjs" stall "$OUT/stall.log" 4 || { cat "$OUT/stall-check.txt"; die "the stall check missed its bar (stall-check.txt)"; }
  [ "$DRY" = 1 ] || sed 's/^/   /' "$OUT/stall-check.txt" | cut -c1-200
  done_step
fi

# ---- 12 cdn walk ----------------------------------------------------------------------------------------------------
if step cdn-walk "every manifest asset from assets.eden.art ($CDN_PAGES; desktop + phone, dpr 1+2)"; then
  set --; for pg in $CDN_PAGES; do set -- "$@" "$ORIGIN$pg"; done
  x_env_to "$OUT/cdn-walk.log" "$NODE" "$ROOT/tools/cdn/cdn-walk.mjs" "$OUT/cdn-walk" "$@" || { tail -20 "$OUT/cdn-walk.log"; die "cdn-walk FAILED (cdn-walk.log)"; }
  [ "$DRY" = 1 ] || tail -3 "$OUT/cdn-walk.log" | sed 's/^/   /' | cut -c1-200
  done_step
fi

say ""
if [ "$DRY" = 1 ]; then
  say "DRY RUN complete: $NSTEPS steps printed, nothing ran.$([ "$PROBLEMS" = 0 ] || echo " PREFLIGHT: $PROBLEMS problem(s) above would stop a real run.")"
  [ "$PROBLEMS" = 0 ] || exit 1
else
  say "SHIPPED $BUILD$([ "$TOPOLOGY" = root-only ] || echo " + $LBUILD"): every $TOPOLOGY step passed ($OUT/STEPS.txt)."
  say "Left for the release owner: lane live checks, ff main + push, SHIP-LOG entry (numbers in $OUT/*-check.txt, probe/report.json, cdn-walk.log), RESUME."
fi

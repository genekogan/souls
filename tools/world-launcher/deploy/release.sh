#!/usr/bin/env bash
# Option B (production on eden2; NOT run unless Codex chooses it): ship this worktree's HEAD to eden2 as a
# world-launcher release and (by default) switch a stage to it.
#   tools/world-launcher/deploy/release.sh [staging|production] [--no-activate] [--restart|--reload]   (--restart: no handover;
#   --reload: hand over even when this release changes keeper.mjs; the running keeper stays until the next restart)
#   tools/world-launcher/deploy/release.sh --local <dir>     assemble only (Option A: run it on the laptop)
#   tools/world-launcher/deploy/release.sh legacy [--no-activate|--local <dir>]   the original worlds at the site root:
#        web built for / (no prefix), build we-<sha12>-root, uploaded to /srv/sim-old/releases/ (never pruned by
#        a /worlds release); activation is the kit's (cutover.sh), so legacy is never activated from here
# Run from a clean worktree. The release: `git archive HEAD` (committed files only, so no .env, data or keys) plus the
# media git does not carry (tools/assets/pull.mjs: the web and runtime sets from the asset CDN, sha256-checked),
# the web app built with --base /worlds/ (every URL under the launcher's prefix), the Mars web assets the worlds
# read (.lane/mars-web, dereferenced) and BUILD. Dependencies are installed on the box for Linux.
# Activation is deploy/activate.sh on the box: `systemctl reload` hands the worlds over without closing the port (keeper.mjs).
# Rollback of code: ln -sfn "$(readlink -f /srv/sim-worlds/<stage>.previous)" /srv/sim-worlds/<stage> && systemctl reload sim-worlds@<stage>
# (restart instead of reload if the keeper is not running; settings in /etc/sim-worlds/<stage>.conf change only on restart).
# Take it away entirely: remove the Caddy routes, then systemctl disable --now sim-worlds@<stage> (data stays in /srv/sim-worlds-data/<stage>).
set -euo pipefail
# The box: [SIM_DEPLOY_USER@]SIM_DEPLOY_HOST from the environment or deploy.env (deploy.env.example); only needed to upload.
. "$(dirname "$0")/deploy-env.sh"
STAGE=staging; ACTIVATE=1; LOCAL=""; RESTART=""; HOW=""; BASE="${SIM_WORLDS_BASE-/worlds}"
while [[ "$BASE" == */ ]]; do BASE="${BASE%/}"; done
[[ -z "$BASE" || "$BASE" =~ ^/[a-z][a-z0-9-]{0,31}$ ]] || { echo "SIM_WORLDS_BASE must be / or one path segment"; exit 2; }
while [ $# -gt 0 ]; do case "$1" in staging|production|legacy) STAGE="$1";; --no-activate) ACTIVATE=0;; --restart) RESTART=1; HOW=--restart;; --reload) HOW=--reload;; --local) LOCAL="$2"; shift;; *) echo "usage: $0 [staging|production|legacy] [--no-activate] [--restart|--reload] | --local <dir>"; exit 2;; esac; shift; done
# CDN1: the asset CDN switch (default on; SIM_ASSETS_CDN_ENABLED=0 turns it off for one release), see the web build below.
CDN="${SIM_ASSETS_CDN_ENABLED-1}"
case "$CDN" in 0|1) ;; *) echo "SIM_ASSETS_CDN_ENABLED must be 0 or 1 (got '$CDN')"; exit 2;; esac
CDN_ORIGIN="${SIM_ASSETS_CDN_ORIGIN:-https://assets.eden.art}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first: the release is exactly HEAD"; exit 1; }
BUILD="we-$(git rev-parse --short=12 HEAD)"
RELROOT=/srv/sim-worlds/releases
if [ "$STAGE" = legacy ]; then BASE=""; BUILD="$BUILD-root"; RELROOT=/srv/sim-old/releases; ACTIVATE=0; fi
OUT="$ROOT/.lane/release/$BUILD"
MARS_WEB_SRC="${MARS_WEB_SRC:-$ROOT/.lane/mars-web}"
[ -d "$MARS_WEB_SRC" ] || { echo "no Mars web assets at $MARS_WEB_SRC (build them with tools/playtest/arena/assets-overlay.mjs, or set MARS_WEB_SRC)"; exit 1; }
[ -f apps/web/src/base-path.ts ] || { echo "this commit's web app cannot run under a prefix (apps/web/src/base-path.ts missing)"; exit 1; }
if [ -n "$LOCAL" ]; then
  case "$LOCAL" in /*) ;; *) echo "--local needs an absolute path"; exit 2;; esac
  if [ -e "$LOCAL" ] && ! grep -qs "^we-" "$LOCAL/BUILD"; then echo "$LOCAL exists and is not an earlier launcher release: refusing to replace it"; exit 1; fi
  OUT="$LOCAL"
fi

# Rebuilding a local artifact preserves its previous contents in a unique Trash directory.
trash_existing() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  mkdir -p "$HOME/.Trash"
  local destination
  destination="$(mktemp -d "$HOME/.Trash/sim-release.XXXXXX")"
  mv "$1" "$destination/"
  echo "   retained previous local artifact in $destination"
}
echo "== assemble $BUILD"
trash_existing "$OUT"; mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
# Media: the web build below reads apps/web from this worktree (the web set), and the release serves the runtime set
# (worlds, /modular, the Mars viewer's models and takes) from $OUT. Both come from the shared asset cache or the CDN.
node tools/assets/pull.mjs --quiet --set web
node tools/assets/pull.mjs --quiet --set web,runtime --dest "$OUT"
echo "$BUILD" > "$OUT/BUILD"
# The Eden experience (connected growing world, atmosphere, presets) is pinned to the qualified Eden world id, exactly as
# the laptop's old-world build pins it (hotfix-integration-00x WEB-MANIFEST.json flags); the /worlds/w/eden fork runs that
# world id. Without it the fork drew only the bare commons (lane FORKFIX). New worlds have other ids: unaffected.
EDEN_WORLDS="${VITE_EDEN_EXPERIENCE_WORLD_IDS-pm-preview-eden-20261005}"
# CDN1 (2026-10-20): reviewed CC0 models come from assets.eden.art (apps/web/src/cdn-manifest.json; tools/cdn/README.md).
# The switch is build-time and off when absent in vite, so every live build from 3.20 (we-f62375187ae5) to 3.49 shipped
# without it: the release defaults it ON. Turn it off for one release with SIM_ASSETS_CDN_ENABLED=0 release.sh ...
[ "$CDN" = 1 ] || echo "   CDN OFF for this build (SIM_ASSETS_CDN_ENABLED=0): every model is served from origin"
if [ -n "${SIM_PREBUILT_WEB_ROOT:-}" ]; then
  node tools/world-launcher/deploy/prebuilt-web.mjs install "$SIM_PREBUILT_WEB_ROOT/$BUILD" "$OUT/apps/web/dist" "$(git rev-parse HEAD)" "$BUILD" "$BASE/" "$CDN" "$CDN_ORIGIN" "$EDEN_WORLDS" "${SIM_ARRIVAL_UI_ENABLED:-0}" "${SIM_GOATCOUNTER-simeden}" "${SIM_GOD_UPLOADS_CDN:-1}"
else
  BUILD_ID="$BUILD" VITE_EDEN_EXPERIENCE_WORLD_IDS="$EDEN_WORLDS" SIM_ASSETS_CDN_ENABLED="$CDN" SIM_ASSETS_CDN_ORIGIN="$CDN_ORIGIN" pnpm --filter @souls/web exec vite build --logLevel warn --outDir "$OUT/apps/web/dist" --emptyOutDir --base "$BASE/"
fi
grep -qE "(src=|\")$BASE/assets/" "$OUT/apps/web/dist/index.html" || { echo "web build is not under $BASE/"; exit 1; }
# With the switch on, the bundle must carry the CDN origin (the flag-off build tree-shakes it away) and the manifest.
if [ "$CDN" = 1 ]; then
  grep -qsF "$CDN_ORIGIN" "$OUT"/apps/web/dist/assets/*.js || { echo "web build lacks the CDN origin $CDN_ORIGIN although SIM_ASSETS_CDN_ENABLED=1"; exit 1; }
  ls "$OUT"/apps/web/dist/assets/cdn-manifest-*.json >/dev/null 2>&1 || { echo "web build lacks cdn-manifest-*.json"; exit 1; }
fi
# The pin is inlined as the argument of Shell's edenReleaseWorlds call (minified f(`id,...`)); the id also appears hard-coded
# elsewhere (classroom, old Eden), so match the call, in whatever chunk the bundler put Shell (P7d merged it into main).
[ -z "$EDEN_WORLDS" ] || grep -qsE "[A-Za-z_\$][A-Za-z0-9_\$]*\(\`${EDEN_WORLDS%%,*}" "$OUT"/apps/web/dist/assets/*.js || { echo "web build lacks the Eden experience pin ($EDEN_WORLDS)"; exit 1; }
# P1 phones: .br/.gz beside each hashed asset (the launcher serves them; nothing is compressed on the request path)
[ -n "${SIM_PREBUILT_WEB_ROOT:-}" ] || node tools/world-launcher/deploy/precompress.mjs "$OUT/apps/web/dist/assets"
rsync -aL --exclude /modular "$MARS_WEB_SRC/" "$OUT/mars-web/"
# /modular (the humanoid kit and the environment GLBs) is this commit's own copy, never whatever a lane overlay's
# symlink pointed at when the release was assembled: a relative link into the archived tree (no second copy).
trash_existing "$OUT/mars-web/modular"; ln -s ../mars/viewer/public/modular "$OUT/mars-web/modular"
[ -f "$OUT/mars-web/modular/humanoid/kit.json" ] || { echo "no humanoid kit in the release"; exit 1; }
# legacy: every file's sha256 (FILES.sha256), so the kit's preflight proves eden2 runs exactly this tree (sha256sum -c)
# .DS_Store: Finder writes it into any folder it looks at (R395, 2026-10-26: one appeared in the staging root mid-upload and failed sha256sum -c on eden2); never hashed, never uploaded
find "$OUT" -name .DS_Store -type f -delete 2>/dev/null || true
[ "$STAGE" != legacy ] || (cd "$OUT" && find . -type f ! -name FILES.sha256 ! -name .DS_Store -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 > FILES.sha256)
du -sh "$OUT" | sed 's/^/   size /'
# Retention is a separate explicit operation, never an automatic side effect of shipping.
echo "   retained all local releases (no automatic pruning)"
node "$ROOT/tools/world-launcher/deploy/release-manifest.mjs" snapshot "$OUT" > "$OUT/RELEASE-MANIFEST.json"
if [ -n "$LOCAL" ]; then
  echo "assembled $BUILD in $OUT (run pnpm install --offline --frozen-lockfile --filter @souls/server... there)"; exit 0
fi

REL="$RELROOT/$BUILD"
HOST="$(deploy_target)"
echo "== upload to $HOST:$REL"
PREV="$(ssh "$HOST" "readlink /srv/sim-worlds/$STAGE 2>/dev/null || true")"
# A repeated exact build may be reused only after inventory/content verification. Never delete stale remote files.
MANIFEST_SHA="$(shasum -a 256 "$OUT/RELEASE-MANIFEST.json" | cut -d ' ' -f 1)"
REMOTE_STATE="$(ssh "$HOST" "if [ -L '$REL' ]; then echo occupied; elif [ ! -e '$REL' ]; then echo fresh; elif [ -d '$REL' ] && [ -z \"\$(find '$REL' -mindepth 1 -maxdepth 1 -print -quit)\" ]; then echo fresh; elif [ -f '$REL/RELEASE-MANIFEST.json' ]; then sha256sum '$REL/RELEASE-MANIFEST.json' | cut -d ' ' -f 1; else echo occupied; fi")"
if [ "$REMOTE_STATE" = "$MANIFEST_SHA" ]; then
  ssh "$HOST" "node --input-type=module - verify '$REL' '$REL/RELEASE-MANIFEST.json'" < "$ROOT/tools/world-launcher/deploy/release-manifest.mjs"
elif [ "$REMOTE_STATE" = fresh ]; then
  # never re-mode an existing releases root; legacy releases must stay traversable
  ssh "$HOST" "[ -d $RELROOT ] || install -d -m 750 $RELROOT; install -d -m 750 $REL"
  rsync -az ${PREV:+--link-dest="$PREV/"} --exclude node_modules --exclude .DS_Store "$OUT/" "$HOST:$REL/"
else
  echo "refusing to overwrite nonempty $REL: manifest missing or different; retained without deleting anything. Use a new build."
  exit 1
fi

echo "== install (user, dirs, unit; idempotent) and Linux dependencies"
# legacy: never install.sh (it rewrites the shared unit file and daemon-reloads beside the live /worlds unit); the kit's
# legacy-setup.sh writes the legacy stage's own settings.
INSTALL="bash $REL/tools/world-launcher/deploy/install.sh"; [ "$STAGE" != legacy ] || INSTALL="id simworlds >/dev/null"
ssh "$HOST" "set -e; $INSTALL; chown -R simworlds:simworlds $REL; touch $RELROOT/$BUILD.deps.log; chown simworlds:simworlds $RELROOT/$BUILD.deps.log;
  sudo -u simworlds -H bash -c 'set -euo pipefail; cd $REL; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 corepack pnpm install --frozen-lockfile --filter @souls/server... > $RELROOT/$BUILD.deps.log 2>&1 && mkdir -p apps/web/node_modules/@souls && ln -sfn ../../../../packages/world-compiler apps/web/node_modules/@souls/world-compiler' || { tail -20 $RELROOT/$BUILD.deps.log; exit 1; }"
# The server imports apps/web/src/humanoid/look.ts (shared look rules), which imports @souls/world-compiler; the server-only
# install doesn't link web's workspace deps, so link that one package (2026-10-11: we-39cb14d848af worlds failed to boot).

if [ "$ACTIVATE" = 0 ]; then echo "uploaded $BUILD (not activated)"; exit 0; fi
echo "== activate $STAGE -> $BUILD"
# activate.sh (in the release): switch the stage link, then `systemctl reload` (the keeper hands the worlds over one at a
# time; no port closes, viewers reconnect) or, for a first keeper install / a changed keeper / --restart, a restart; then
# health + every world's boot smoke, with automatic rollback to <stage>.previous by the same route (lane C4, G9).
ssh "$HOST" "set -e
  [ '$STAGE' != production ] || test -f /etc/sim-worlds/production-auth.env || { echo 'production needs /etc/sim-worlds/production-auth.env (the account provider settings) first'; exit 1; }
  systemctl enable sim-worlds@$STAGE >/dev/null 2>&1
  bash $REL/tools/world-launcher/deploy/activate.sh $STAGE $REL $HOW
  echo 'retained all remote releases (no automatic pruning; destructive retention needs Gene approval)'"
echo "released $BUILD to $STAGE"

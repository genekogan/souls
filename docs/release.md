# Releasing Soul

## Current production topology

The canonical site is `https://soul.game`, with production built and launched at base `/`; `souls.game` redirects
to it. Internal service/data names stay `sim-*`. There is no second public legacy stage on this host.
A release is one command, [`ship.sh`](#shipsh), run from a clean checkout of the exact commit. It sets
`SIM_WORLDS_BASE=/`, so the sealed build and launcher base match. The release workflow is not qualified for this
topology yet (draft [#523](https://github.com/genekogan/souls/pull/523), tracked by
[#519](https://github.com/genekogan/souls/issues/519)): it still runs the historical dual-stage command, so **do not
dispatch it on the root-only host**. Do not start a new gate to compensate for a missing receipt without authorization.

## Historical dual-stage deployment

This section and [`ship-dual-stage.sh`](#ship-dual-stagesh-historical) describe the old host. Current production does not use them.

A release puts one exact commit on its target host. The historical deployment uses two launcher **stages**, each a
`sim-worlds@<stage>` systemd unit running the world launcher under its keeper (`tools/world-launcher/keeper.mjs`):

| Stage | Serves | Build id | Release directory on the host |
|---|---|---|---|
| `production` | `https://sim.eden.art/worlds/` (every world people create) | `we-<sha12>` | `/srv/sim-worlds/releases/we-<sha12>` |
| `legacy` | `https://sim.eden.art/` and `/w/<key>` (the original worlds) | `we-<sha12>-root` | `/srv/sim-old/releases/we-<sha12>-root` |

Both stages ship from the same commit in the same release. A `staging` stage (loopback only, dev auth) also exists
in `release.sh`; ship.sh does not use it. See [operations](operations.md) for the services themselves and
[the runbook](operations/runbook.md) for day-to-day commands.

## Release order

1. **Gate receipt.** The candidate commit has a clean full-scope receipt from the
   [remote gate](testing/remote-gate.md) (`tools/test-harness/release-gate.sh`), combined with the V7 browser walk
   into a ship receipt (`tools/test-harness/ship-receipt.mjs`). Clean means no new failures, no blockers and no
   unexpected skips. A scoped candidate gate (`--scope auto`) is useful during development but never makes a ship
   receipt.
2. **Build exactly HEAD of a clean tree.** `release.sh` refuses uncommitted tracked changes and ships `git archive
   HEAD`, so the build id names exactly what runs.
3. **CDN first.** Any new immutable asset the web build's CDN manifest references is uploaded to `assets.eden.art`
   and verified before the release ([CDN](operations/cdn.md)). The client falls back to the origin on a CDN miss,
   but a release must not depend on that.
4. **Staged ship.** `tools/world-launcher/deploy/ship.sh` takes a read-only snapshot, stages without activating, makes
   row-verified backups, starts the live probe and does one guarded reload, in that order (below).
5. **healthz.** Each activation checks the stage's `/__sim/healthz` reports the new build and every registered world
   answers; afterwards `https://soul.game/__sim/healthz` shows `build`, `worlds`/`running` and `hostOk`.
6. **Walks.** Real-Chrome arrivals on desktop and phone, the poster and stall checks.
7. **cdn-walk.** `tools/cdn/cdn-walk.mjs` proves the live pages load mapped assets from the CDN.
8. **Rollback on failure.** A failed handover or health check rolls back on its own; any later failure stops the run
   and prints the exact rollback commands. Code is rolled back; data never is.

## The release workflow

This workflow runs the historical dual-stage command and is not qualified for the root-only host. Releases that use it run from [`.github/workflows/release.yml`](../.github/workflows/release.yml), started by manual dispatch with
a `version` (for the changelog and tag) and optional `label`, `baseline` (default: the newest `v*` tag) and
`no_probe`. A `release` concurrency group lets only one run at a time. Its jobs:

1. **preflight**: the required secrets and variables exist (it names any that are missing), the head is `main`, and
   the inputs are sane.
2. **gate**: the full remote gate against the baseline release.
3. **ship**: waits for the protected `production` environment's required reviewer, then runs `ship-dual-stage.sh` over SSH
   and checks healthz.
4. **publish**: compiles `changes/` into [`CHANGELOG.md`](../CHANGELOG.md), tags `v<version>` on the shipped commit
   and creates the GitHub Release.

The site's public changelog page (`<base>/changelog`, currently `https://soul.game/changelog`) is `CHANGELOG.md`
rendered into the web build (`apps/web/changelog.html`, `apps/web/src/changelog-page.ts`). So that the page shows the
release being shipped, the ship job first compiles the shipped fragments into a copy outside the tree
(`tools/changelog/compile.mjs --out`) and the build renders that copy (`SIM_CHANGELOG_FILE`); the tree stays exactly
HEAD. Publish then writes the same section, with the same date from preflight, into the committed `CHANGELOG.md`. A
laptop `ship-dual-stage.sh` run renders the committed `CHANGELOG.md` unless you set `SIM_CHANGELOG_FILE` the same way.

Configuration lives in GitHub, never in the repository; preflight names whatever is missing:

| Name | Kind | Purpose |
|---|---|---|
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | repository secrets | the remote gate |
| `SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER` | variables (or secrets) | SSH target of the production host |
| `DEPLOY_SSH_KEY`, `SIM_DEPLOY_KNOWN_HOSTS` | `production` environment secrets | SSH key and the host's known-hosts entry |
| `SIM_PROBE_GOD_JSON` | optional secret | god file of the release-probe world; without it the probe is skipped |
| `SIM_ORIGIN` | optional variable | public origin, default `https://sim.eden.art` |
| `MODAL_CLIENT_VERSION` | optional variable | pip pin for the Modal client |

Outside the workflow, the scripts read the same variables from the environment or from an untracked `deploy.env` at
the repository root (copy [`deploy.env.example`](../deploy.env.example); the environment wins). Loaders:
`tools/world-launcher/deploy/deploy-env.{sh,mjs}`.

## ship.sh

```sh
tools/world-launcher/deploy/ship.sh --label <version> --sha <full sha> [--dry-run] [--from <step>] [--out <dir>]
```

It asks nothing: ssh runs in batch mode, and it never prompts. Before the release is live, any failure stops the run.
Afterwards, a failed check is recorded and the later checks still run, so the owner decides with all the evidence.

| Option | Meaning |
|---|---|
| `--label <version>` | The release, such as `4.16`. Names the output folder and the backups (`pre-r416-production-<time>`). |
| `--sha <full sha>` | The commit to ship. It must be HEAD of a clean tree and an ancestor of `origin/main`. |
| `--dry-run` | Prints every step and its commands. Nothing remote is touched and nothing is written. Exits 1 when a guard would stop a real run. |
| `--from <step>` | Resumes at `snapshot`, `stage`, `backup`, `probe-start`, `healthz`, `walks`, `poster`, `stall` or `cdn-walk`, with the same `--out`. Activation always follows a fresh probe, so resume it `--from probe-start`. The guards run on every resume. |
| `--out <dir>` | Output folder (default `$SHIP_OUT_ROOT/<label>`). A folder that already holds a run is refused without `--from`. |

There is no host option. The host and operator paths come from the environment or the untracked `deploy.env`:

| Variable | Default | Used for |
|---|---|---|
| `SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER` | none / `root` | SSH target of the production host. It is never printed or written to the outputs |
| `SHIP_RECEIPTS` | none; required | Folder holding the gate's `receipt.json` and `ship-receipt.json` for this commit |
| `SHIP_PROBE_CLI` | none; required | God folder of the [release-probe world](#the-release-probe-world) |
| `PLAYWRIGHT_BROWSERS_PATH` | none; required | Browsers folder. Preflight checks that it actually holds a Chromium executable |
| `SHIP_ORIGIN` | `https://soul.game` | Public origin |
| `SHIP_WALK_SLUGS` | `eden mars-college-2026 mars-college-2027` | Worlds for the walks and the cdn-walk |
| `SHIP_PROBE_PAGE`, `SHIP_POSTER_PAGE` | `/w/eden/` | Pages for the probe, and for the poster and stall |
| `SHIP_OUT_ROOT` | `.local/ship` | Parent of the output folder |
| `SHIP_PROBE_READY_S` | `600` | How long to wait for the probe to be ready |
| `SHIP_HOST_ROOT`, `SHIP_HOST_DATA`, `SHIP_HOST_CONF`, `SHIP_HOST_UNIT`, `SHIP_HOST_TMP` | `/srv/sim-worlds`, `/srv/sim-worlds-data/production`, `/etc/sim-worlds/production.conf`, `sim-worlds@production`, `/tmp` | Paths on the host, passed to its scripts as arguments |
| `SIM_PREBUILT_WEB_ROOT`, `MARS_WEB_SRC` | see [release.sh](#releasesh) | Read by `release.sh` |

| Step | What it does | On failure |
|---|---|---|
| preflight | Local guards: the host is set, the tree is clean, HEAD is `--sha`, the commit is on `origin/main`, the gate and ship receipts are clean for it, the probe folder and Chromium exist, every tool is present | Refused; nothing remote ran |
| snapshot | Public healthz and read-only host metadata: stage link, config hash, registry identity, every database by name (`body-collections.sqlite` too), keeper. Writes `ROLLBACK.txt` | Stops |
| stage | `release.sh production --no-activate` at base `/`; verifies the manifest locally and on the host; compares the host with the snapshot | Stops |
| backup | Row-verified compact copy of every database, `quick_check` on each, the same filenames as the snapshot | Stops |
| probe-start | Starts `release-probe.mjs` and waits for `<out>/probe/ready` | Stops |
| activate | Checks that the snapshot and backup are under an hour old and that nothing drifted, then runs `ship/host-activate.sh` on the host: one `activate.sh --reload` and a health check | The host rolls code back to the previous build; stops |
| probe-check | Reads the probe's exit | 3 stops (the release rolled back). Anything else is recorded and the run continues |
| healthz | Public healthz reports this build, every world and `hostOk` | Stops |
| walks | `ship/walk.mjs` on desktop and phone at dpr 1 and 2, then `checks.mjs walks` | Recorded |
| poster | `ship/poster.mjs` three times, `poster-count.py`, `checks.mjs poster` | Recorded |
| stall | `ship/stall.mjs` four times, `checks.mjs stall` | Recorded |
| cdn-walk | `tools/cdn/cdn-walk.mjs` on the same worlds | Recorded |

The output folder holds `STEPS.txt`, `ship.log`, `POSTLIVE.txt` (each post-live check and its exit), each step's logs and
`ship-result.json`: `live`, `live-with-failures` or `stopped`. The exit is 0 only when every step passed. `ROLLBACK.txt`
has the manual rollback, with the host as `$SIM_DEPLOY_HOST`.

Not done here: publishing new CDN assets first, the uncut live clip, the changelog PR, the tag and the GitHub Release.

Tests run the whole command against a fake host, with the remote block under an empty environment:
`node --test tools/world-launcher/ship-root.test.mjs`.

## ship-dual-stage.sh (historical)

The old dual-stage command, kept for the workflow above. Do not run it on the root-only host.

```sh
tools/world-launcher/deploy/ship-dual-stage.sh --label <n> [--dry-run] [--from <step>] [--no-probe] [--exclude-world <slug>] [--out <dir>]
```

| Option | Meaning |
|---|---|
| `--label <n>` | Release label: letters, digits, `-` and `_`. Names the backups (`pre-r<n>-<stage>-<time>`) and the output folder. |
| `--dry-run` | Prints every step with its exact commands. Nothing runs and the host is not contacted. Exits 1 when preflight would stop a real run. |
| `--from <step>` | Resumes at `<step>` after a fix, with the same label and outputs; earlier steps are skipped. |
| `--no-probe` | Skips the three live-probe steps. |
| `--exclude-world <slug>` | Leaves one `/worlds/w/<slug>/` world out of the arrival walks (repeatable). Unknown slugs fail. Backups, probe and activation are unchanged. |
| `--out <dir>` | Output folder (default `$SHIP_OUT_ROOT/<label>`). |

Environment:

| Variable | Default | Used for |
|---|---|---|
| `SIM_DEPLOY_HOST` | none; required | SSH target of the production host (an SSH config alias works); `SIM_DEPLOY_USER` (default `root`) is prepended. Also read by `release.sh` |
| `SHIP_ORIGIN` | `https://sim.eden.art` | Public origin the probe and walks load |
| `SHIP_PROBE_CLI` | `.local/release-probe` | God folder of the release-probe world (below) |
| `SHIP_LEGACY_RELEASE_FILE` | `.local/ship/LEGACY-RELEASE` | File that records the active legacy build after activation |
| `SHIP_OUT_ROOT` | `.local/ship` | Parent of the output folder |
| `SHIP_PROBE_READY_S` | `600` | How long to wait for the probe to be ready |
| `MARS_WEB_SRC` | `.lane/mars-web` | Mars web asset overlay (see `release.sh`) |

Steps, each checked by `ship/checks.mjs`:

| Step | What it does | Pass when |
|---|---|---|
| preflight | Local only: clean tree, `node_modules`, Mars web assets, every ship tool present, the probe god folder, an unused output folder | nothing is missing |
| backup | Copies `ship/compact-backup.sh`, `ship/compact-copy.py` and `ship/quick-check.mjs` to the host; makes a row-verified compact copy of every production and legacy database (`/srv/sim-worlds-data/release-backups/pre-r<n>-<stage>-<time>`); runs `PRAGMA quick_check` on each | every copied row matches its source; every database `ok` |
| legacy-upload | `release.sh legacy`: builds and uploads `we-<sha12>-root` without activating it | exit 0 |
| probe-start | Starts `release-probe.mjs` in the background (desktop and phone pages, god CLI edits in the probe world, `--expect-build we-<sha12>`); waits for `<out>/probe/ready` | ready in time |
| release | `release.sh production --reload` | exit 0 |
| legacy-activate | `sha256sum -c FILES.sha256` in the legacy release, `activate.sh legacy <release> --reload`, then writes the build to `SHIP_LEGACY_RELEASE_FILE` | exit 0 |
| released | Touches `<out>/probe/released`; the probe watches 60 s more | — |
| probe-check | Reads the probe's exit | 0 = pass; 1 = visitor bar missed (the release is live); 3 = the release rolled back |
| walks | `ship/walk.mjs`: a fixed set of worlds on desktop at dpr 1 and 2, a smaller set on a phone | every arrival, 0 errors, 0 resyncs, picks ok |
| poster | `ship/poster.mjs` three times on a phone, then `ship/poster-count.py` | a world frame every run, never blank after it |
| stall | `ship/stall.mjs` four times on a phone | no frame gap over 1 s |
| cdn-walk | `tools/cdn/cdn-walk.mjs` on three live pages, desktop and phone | PASS |

Before the first change on the host, ship-dual-stage.sh reads the current and previous stage links and writes the rollback
commands to `<out>/ROLLBACK.txt`. The output folder also holds `STEPS.txt` (one line per step), `ship.log`, and each
step's logs, JSON and screenshots. Any failure stops the run: it prints what is live at that moment, the
rollback commands and the `--from` that resumes. It never rolls back by itself; `activate.sh` already does that for a
failed handover, and probe exit 3 reports it.

Its tests stub every external command: `node --test tools/world-launcher/ship.test.mjs` (`SHIP_TEST=1` with `SHIP_SSH`,
`SHIP_SCP`, `SHIP_NODE`, `SHIP_PYTHON`, `SHIP_RELEASE_SH` and `SHIP_BUILD`).

## release.sh

```sh
tools/world-launcher/deploy/release.sh [staging|production|legacy] [--no-activate] [--restart|--reload]
tools/world-launcher/deploy/release.sh [staging|production|legacy] --local <absolute dir>   # assemble only
```

It runs from a clean checkout (`git status --porcelain --untracked-files=no` empty) and:

1. **Assembles** `we-<sha12>` (or `we-<sha12>-root` for `legacy`) in `.lane/release/<build>`: `git archive HEAD`
   (committed files only, so no `.env`, data or keys), `BUILD`, and the web app built with `--base /worlds/` (`/` for
   legacy). An earlier local copy is moved aside, never deleted.
2. **Checks the build**: every asset URL is under the base; with the CDN on, the bundle carries the CDN origin and a
   `cdn-manifest-*.json`; the Eden experience pin (`VITE_EDEN_EXPERIENCE_WORLD_IDS`) is compiled in. Hashed assets get
   `.br`/`.gz` siblings (`precompress.mjs`).
3. **Adds the Mars web assets** from `MARS_WEB_SRC` (default `.lane/mars-web`; `tools/playtest/arena/assets-overlay.mjs
   <dir>` builds one from the public site). `/modular` is linked to the commit's own `mars/viewer/public/modular`.
   For `legacy` it writes `FILES.sha256` over every file.
4. **Writes `RELEASE-MANIFEST.json`** (`release-manifest.mjs snapshot`): every file, symlink and mode.
5. **Uploads** to the host with `rsync --link-dest` against the stage's current release. A directory that already
   holds the same build is reused only when its manifest matches and `release-manifest.mjs verify` passes; a partial
   or different upload is refused, never overwritten. Use a new commit instead.
6. **Installs** (`install.sh`, idempotent; not for legacy) and the server's Linux dependencies
   (`pnpm install --frozen-lockfile --filter @sim/server...`) as the `simworlds` user.
7. **Activates** with `activate.sh` unless `--no-activate` (legacy is never activated by release.sh; ship-dual-stage.sh does it).
   Production refuses to activate without `/etc/sim-worlds/production-auth.env` ([auth](operations/auth.md)).

release.sh never prunes local or remote releases. Focused check: `node --test tools/test-harness/release-no-delete.test.mjs`.

| Variable | Default | Effect |
|---|---|---|
| `SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER` | none / `root` | SSH target of the production host |
| `SIM_WORLDS_BASE` | `/worlds` | Production path prefix |
| `SIM_ASSETS_CDN_ENABLED` | `1` | `0` builds without the asset CDN for one release; other values are refused |
| `SIM_ASSETS_CDN_ORIGIN` | `https://assets.eden.art` | CDN origin compiled into the build |
| `VITE_EDEN_EXPERIENCE_WORLD_IDS` | the qualified Eden world id | Worlds that get the Eden experience; empty disables the check |
| `SIM_GOATCOUNTER` | site default | Visitor counter code or URL; `off` disables ([analytics](operations/analytics.md)) |
| `SIM_GOD_UPLOADS_CDN` | `1` | Route god uploads through the CDN Worker |
| `SIM_PREBUILT_WEB_ROOT` | unset | Use web builds made elsewhere (below) |
| `MARS_WEB_SRC` | `.lane/mars-web` | Mars web asset overlay |

**Prebuilt web.** With `SIM_PREBUILT_WEB_ROOT` set to a directory holding `<build>/dist` and `<build>/WEB-BUILD.json`
for both builds, release.sh installs those instead of running Vite (`prebuilt-web.mjs install`). The receipt must
match the full source SHA, build id, base path, CDN flag and origin and the Eden pin; every artifact hash is checked
before and after copying. `modal-web-build.py` produces such builds on Modal.

## Activation and handover

`activate.sh <stage> <release dir> [--restart|--reload]` runs on the host as root (release.sh calls it over SSH). It
moves the stage link `/srv/sim-worlds/<stage>` to the new release, keeping the old one as `<stage>.previous`, then
either reloads or restarts the unit:

- **Reload** (the running unit is the keeper and the release carries the same `keeper.mjs`, or `--reload`):
  `systemctl reload` sends SIGHUP and the keeper hands the worlds over to the new launcher without closing the port.
- **Restart** (first install, a changed `keeper.mjs` without `--reload`, or `--restart`): every world restarts.

The handover:

1. **prepare**: the running launcher finishes any world creation, holds new boots and registry writes, and lists its
   running worlds.
2. **start**: the new launcher starts and adopts those worlds; it proxies to them and boots nothing yet.
3. **switch**: new connections go to the new launcher. The old one answers what still reaches it with
   `Connection: close`, so each connection ends cleanly after its next response. The launcher keeps idle connections
   130 s, longer than the reverse proxy's idle timeout, so the proxy closes them, never the launcher mid-request.
4. **take over**: one world at a time, the old launcher stops the world (it saves a snapshot and exits), then the new
   launcher boots it on the same data. Requests and viewer sockets for that world wait; they do not fail. A world
   never has two writers.
   - **pre-warm**: before the stop, the new launcher starts the world's next process in standby (`SIM_STANDBY=1`,
     `apps/server/src/standby.ts`): it loads its code and waits for SIGUSR2 without opening its database or port. The
     pause is then the stop plus opening the data. A world is pre-warmed only when the unit's cgroup and the host both
     have room (768 MB by default, `SIM_PREWARM_NEED_MB`); otherwise it boots cold. `SIM_PREWARM=0` turns it off.
   - **canary**: the first world (not an old-world fork) moves first and must answer `/v1/config`. If it cannot,
     nothing else moves: the old launcher serves again, the new one exits and `keeper.json` says `rolled-back`.
     `SIM_HANDOVER_CANARY=0` turns it off.
5. **exit**: the old launcher finishes its last responses and exits.

After the handover activate.sh waits up to 60 s for `http://127.0.0.1:<port><base>/__sim/healthz` to report the new
build, then requires every world in `<data>/worlds.json` to answer `<base>/w/<slug>/v1/config` within 90 s. On a
canary roll-back it moves the link back and exits 1. On any other failure it moves the link back to
`<stage>.previous` and reloads (or restarts) again, which runs the same handover in reverse; a failed reverse reload
falls back to a restart. The keeper records its pid, sha, the active build and the last handover per world in
`<data>/keeper.json`.

**Reload with a changed keeper.** `--reload` hands over even when the release carries a new `keeper.mjs`: the
running keeper stays and runs the new launcher (no canary until the new keeper is installed). `keeper.json` then
still names the old keeper, so keep passing `--reload` until a planned `--restart` at a quiet time. A change to the
unit file or to `/etc/sim-worlds/<stage>.conf` (port, data, caps) also needs `--restart`.

**Restarts without refused connections.** The optional `deploy/sim-worlds@.socket` lets systemd hold the port, so
during a restart new connections wait in the socket backlog instead of being refused. Its header has the commands to
switch it on (one last restart).

**What a viewer sees.** The page and API never get a refused connection. Each world's viewer socket drops once while
that world moves and reconnects by itself; "Reconnecting…" appears only after 3 s (`apps/web/src/viewer-arrival.ts`).
A page running the previous bundle reloads at once only if the protocol changed; otherwise it swaps bundles after
the tab has been hidden for a minute (`useSim.ts`).

## Rollback

- **Automatic:** activate.sh puts `<stage>.previous` back on a failed handover, health check or world boot.
- **By hand:** run the command ship.sh wrote to `ROLLBACK.txt`, which is of the form

  ```sh
  ssh "$SIM_DEPLOY_USER@$SIM_DEPLOY_HOST" bash <previous>/tools/world-launcher/deploy/activate.sh production <previous> --reload
  ```

  Do not move the stage link yourself first: activate.sh records `<stage>.previous` only when the link still points
  at the old release.
- Rollback changes code only. World databases keep every accepted event; never restore an older database to make old
  code run. Restoring data is a separate, deliberate operation ([disaster recovery](operations/disaster-recovery.md)).

## The release-probe world

The probe's god CLI edits go to a dedicated world: unlisted, flagged test, owned by an operator account, with no
Soul a person owns. Releases never edit a person's world, and preflight stops when `SHIP_PROBE_CLI` is missing. One-time
setup on the production host (`op.mjs` accepts only direct loopback requests; `<port>` and `<base>` are the
production stage's):

```sh
node tools/world-launcher/op.mjs create-world --port <port> --base /worlds --name "Release probe (scratch)" \
  --template hello-hamlet --owner <account id> --slug release-probe --unlisted
node tools/world-launcher/op.mjs set-test --port <port> --base /worlds --slug release-probe --test true
```

Then, in an empty folder on the machine that will run the release, register and pair a god for it:

```sh
node tools/god-skill/eden-god.mjs register https://sim.eden.art/worlds/w/release-probe/
node tools/god-skill/eden-god.mjs pair          # prints a pairing code and waits
# on the host:
node tools/world-launcher/op.mjs god-pending --port <port> --base /worlds --slug release-probe
node tools/world-launcher/op.mjs god-approve --port <port> --base /worlds --slug release-probe --code <code>
```

Keep that folder as a secret of the release environment and point `SHIP_PROBE_CLI` at it; never print its session
file. Operator Soul and god commands work only on loopback and on worlds flagged test (`apps/server/src/op-souls.ts`,
`tools/world-launcher/op-souls.mjs`); they approve only TEST names for a synthetic operator account, and `god-approve`
is refused while any live Soul in the world belongs to anyone else.

## Retention

Nothing is pruned automatically. `tools/world-launcher/deploy/retention.sh --host "$SIM_DEPLOY_USER@$SIM_DEPLOY_HOST"` lists what
keep-N would delete on the host: routine compact backups beyond the newest 10 per stage (other backup names are never
touched) and legacy releases beyond the newest 5, always keeping every release a link points at or a process uses.
Dry run is the default; `--apply` deletes and should be run only after reading the dry-run list. `--keep-backups` and
`--keep-releases` change the numbers (at least 3 and 2). Test: `tools/world-launcher/deploy/retention.test.sh`.

## Measuring a handover

`deploy/swap-probe.mjs --origin http://127.0.0.1:<port> --base /worlds --slugs a,b --out probe.json [--posts]` GETs the
homepage and each world every 100 ms, holds one viewer socket per world, and reports refused connections, 5xx, the
longest error run, the slowest request and each socket's downtime. `--posts` adds a POST per world, which catches a
connection closed under a request. Run it through a reverse proxy with production-like transport settings to see
what a visitor would.

## Root-only world deployments

[`ship.sh`](#shipsh) sets `SIM_WORLDS_BASE=/` for a root web build; run the launcher with `--base /`. Existing `/worlds`
releases remain supported. Follow [world URL migration](operations/world-urls.md) to preserve world identities and paired
agents when changing public slugs.

# Releasing Soul

The canonical site is `https://soul.game`, with production built and launched at base `/`; `souls.game` redirects
to it. Internal service/data names stay `sim-*`. Root-only releases use one `production` launcher at `/`, build
`we-<sha12>`, stored in `/srv/sim-worlds/releases/we-<sha12>`, under the production keeper unit (`sim-worlds@<stage>` with the stage `production`).

The root-only workflow remains draft [#523](https://github.com/genekogan/souls/pull/523), tracked by
[#519](https://github.com/genekogan/souls/issues/519). Shared gate accounting/cache, restricted deployment
configuration, a nonproduction activation rehearsal and the first workflow receipt remain qualification work.
Until those are accepted, the release owner uses the approved root-only runsheet and retained receipts.
Do not dispatch the workflow or start a new gate to compensate for a missing receipt without authorization.

The explicit `dual-prefix` topology preserves the historical two-stage host:


| Stage | Serves | Build id | Release directory on the host |
|---|---|---|---|
| `production` | `https://sim.eden.art/worlds/` | `we-<sha12>` | `/srv/sim-worlds/releases/we-<sha12>` |
| `legacy` | `https://sim.eden.art/` and `/w/<key>` | `we-<sha12>-root` | `/srv/sim-old/releases/we-<sha12>-root` |

Only dual-prefix ships both stages from the same commit. A `staging` stage (loopback only, dev auth) also exists
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
4. **Staged ship.** `tools/world-launcher/deploy/ship.sh --topology root-only` backs up and releases only production.
   The explicit `dual-prefix` mode retains the original two-stage ceremony (below).
5. **healthz.** Each activation checks the stage's `/__sim/healthz` reports the new build and every registered world
   answers; afterwards `https://soul.game/__sim/healthz` shows `build`, `worlds`/`running` and `hostOk`.
6. **Walks.** Real-Chrome arrivals on desktop and phone, the poster and stall checks.
7. **cdn-walk.** `tools/cdn/cdn-walk.mjs` proves the live pages load mapped assets from the CDN.
8. **Rollback on failure.** A failed handover or health check rolls back on its own; any later failure stops the run
   and prints the exact rollback commands. Code is rolled back; data never is.

## The release workflow

Releases run from [`.github/workflows/release.yml`](../.github/workflows/release.yml), started by manual dispatch with
a `version` (for the changelog and tag) and optional `label`, `baseline` (default: the newest `v*` tag) and
`no_probe`. The operator must explicitly configure the topology and public origin. A `release` concurrency group lets only one run at a time. Its jobs:

1. **preflight**: automation has been reviewed and explicitly enabled, the required secrets and variables exist (it names any that are missing), the head is `main`, and
   the inputs are sane.
2. **gate**: the full remote gate against the baseline release.
3. **ship**: waits for the protected `production` environment's required reviewer, then runs `ship.sh` over SSH
   and checks healthz.
4. **publish**: compiles `changes/` into [`CHANGELOG.md`](../CHANGELOG.md), tags `v<version>` on the shipped commit
   and creates the GitHub Release.

The site's public changelog page (`<base>/changelog`, `https://soul.game/changelog`) is `CHANGELOG.md`
rendered into the web build (`apps/web/changelog.html`, `apps/web/src/changelog-page.ts`). So that the page shows the
release being shipped, the ship job first compiles the shipped fragments into a copy outside the tree
(`tools/changelog/compile.mjs --out`) and the build renders that copy (`SIM_CHANGELOG_FILE`); the tree stays exactly
HEAD. Publish then writes the same section, with the same date from preflight, into the committed `CHANGELOG.md`. A
laptop `ship.sh` run renders the committed `CHANGELOG.md` unless you set `SIM_CHANGELOG_FILE` the same way.

Configuration lives in GitHub, never in the repository; preflight names whatever is missing:

| Name | Kind | Purpose |
|---|---|---|
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | repository secrets | the remote gate |
| `SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER` | variables (or secrets) | SSH target of the production host |
| `DEPLOY_SSH_KEY`, `SIM_DEPLOY_KNOWN_HOSTS` | `production` environment secrets | SSH key and the host's known-hosts entry |
| `SIM_PROBE_GOD_JSON` | optional secret | god file of the release-probe world; without it the probe is skipped |
| `SIM_ORIGIN` | required variable | public origin (`https://soul.game` for root-only production) |
| `SIM_DEPLOY_TOPOLOGY` | required variable | `root-only` or `dual-prefix`; no implicit topology |
| `SIM_RELEASE_AUTOMATION_ENABLED` | required variable | `reviewed` only after the operational checklist below; otherwise preflight refuses before Modal or SSH |
| `MODAL_CLIENT_VERSION` | optional variable | pip pin for the Modal client |

### Before enabling automation

The workflow is **disabled by default**. Adding `SIM_RELEASE_AUTOMATION_ENABLED=reviewed` is an operator attestation;
it does not create protections or prove a deployment. Before setting it, the release owner must:

- Rehearse the root-only runner on a nonproduction mirror. The loopback HTTP/stub tests are contract checks, not an
  activation rehearsal. Record the tested workflow SHA and the mirror receipt.
- Configure a restricted deploy identity for the intended host and verify its known-hosts entry independently. Never
  copy a personal SSH key into Actions. Keep deploy credentials in the `production` environment and preserve its
  required-reviewer policy. These scripts do not create credentials, grant access or alter environment protection.
- Arrange reviewed, durable gate cache transfer and the shared release-owner budget/lease ledger. GitHub concurrency
  only serializes this workflow; it does **not** account for laptop gates or enforce the three-full-gates/day cap.
  A fresh runner's empty cache must not rerun an already qualified baseline or release head. This PR does not supply
  that cross-machine ledger/cache integration. Until it exists, coordinate the authorized manual release instead.
- Resolve the baseline to the **actual shipped source** and preserve the validated cached execution under that
  identity. An author-only history rewrite can change a public tag/source SHA without changing the running BUILD:
  tree equivalence does not make the rewritten SHA the executed baseline. Supply the actual baseline explicitly,
  ensure the source commit and cache are available, and retain the old-to-new SHA mapping with the release receipt.
- After the first authorized automated release, record the workflow run, exact source/build mapping, full gate and
  live verification receipts. Until that run succeeds, automated production deployment remains unverified.

The gate job allows 270 minutes: provider functions are bounded at four hours, the driver at four hours ten minutes,
and setup/artifact collection need additional time. This raises no Modal allowance and does not authorize retries.
One full gate per release head and at most three per day still apply across every execution host.

Outside the workflow, the scripts read the same variables from the environment or from an untracked `deploy.env` at
the repository root (copy [`deploy.env.example`](../deploy.env.example); the environment wins). Loaders:
`tools/world-launcher/deploy/deploy-env.{sh,mjs}`.

The scripts can run from an authorized clean checkout with SSH access. The workflow remains disabled
until the qualification checklist above is satisfied.

### Qualification sequence for the release owner

The manual root-only release path remains available with retained evidence and explicit authorization. Preparing a
cloud checkout or reviewing this PR does not authorize a new full gate, mirror activation or production activation.
Use the existing approved runsheet for the actual host; never substitute the production host for a missing mirror.

1. Resolve the actual live source from the retained release receipt and exact BUILD, then record the candidate,
   original gate harness, baseline and any author-rewrite mapping. Reuse the full raw CPU results with
   [`--no-remote`](testing/remote-gate.md#revalidate-retained-results-without-a-new-gate); import validated runs with
   `cache-add` where needed. Preserve failed attempts. New source requires separate qualification and any new gate
   requires its own budget authorization. Do not use current `main` or a rewritten tag as an inferred live baseline.
2. Provision an isolated nonproduction mirror with fake/test worlds, the production-shaped root launcher and
   independent data paths. Configure `SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER`, `SHIP_ORIGIN` and `SIM_WORLDS_BASE=/` for
   that mirror. The deploy identity needs only the intended release directories, backup tools and activation of its
   own production unit (`sim-worlds@<stage>`) on the mirror; no unrelated services, accounts, DNS or proxies. Verify its
   known-hosts pin independently. The existing loopback `staging` stage alone does not rehearse this topology.
3. From a clean exact-source checkout with dependencies, existing assets and the dedicated probe world configured,
   inspect the root-only plan. This example bypasses any local deploy.env and contacts no host:

   ```sh
   SIM_DEPLOY_ENV=/dev/null SIM_DEPLOY_HOST=mirror.example.invalid SIM_DEPLOY_USER=sim-release \
     SHIP_ORIGIN=https://mirror.example.invalid SIM_WORLDS_BASE=/ \
     tools/world-launcher/deploy/ship.sh --topology root-only --label mirror-check --dry-run
   ```

   A missing dependency, asset or probe is an unmet preflight, not a passed rehearsal. After explicit mirror
   authorization, run the same command with the approved mirror target and without `--dry-run`. Retain RUN.identity,
   STEPS.txt, backup/integrity evidence, exact manifests, health, probe, desktop/phone, poster, stall, CDN and rollback
   results. A failed step retains its failure and uses the guarded `--from` path only after its cause is corrected.
4. Before enabling Actions, configure the required variable/secret **names** in the table above, restricted deploy
   access and the existing protected `production` environment. Review durable full-evidence cache transfer and the
   shared once-per-head/daily budget ledger across laptop and cloud callers. A fresh Actions cache, concurrency
   group or reviewed switch is insufficient. This PR supplies no accounting authority or automatic cache transfer.
5. Only after A3/A4 are evidenced and the owner authorizes the release, dispatch the tested workflow on the exact
   approved `main` head. Verify the gate candidate, sealed BUILD and live health identify that same full source SHA;
   retain the workflow run URL and all live receipts before publication acceptance. A6 remains unmet until this
   first automated release actually succeeds. A manual release receipt does not satisfy automated-release proof.

## ship.sh

```sh
tools/world-launcher/deploy/ship.sh --label <n> --topology <root-only|dual-prefix> [--dry-run] [--from <step>] [--no-probe] [--exclude-world <slug>] [--out <dir>]
```

| Option | Meaning |
|---|---|
| `--topology <mode>` | Required (or `SHIP_TOPOLOGY`). `root-only` runs only production; `dual-prefix` explicitly retains both stages. A conflicting `SIM_WORLDS_BASE` is refused. |
| `--label <n>` | Release label: letters, digits, `-` and `_`. Names the backups (`pre-r<n>-<stage>-<time>`) and the output folder. |
| `--dry-run` | Prints every step with its exact commands. Nothing runs and the host is not contacted. Exits 1 when preflight would stop a real run. |
| `--from <step>` | Resumes at `<step>` after a fix. Root-only requires the original `RUN.identity`, matching full source/build/target/origin/coverage, and every preceding prerequisite to have passed. Verification-only resumes also refresh public health before continuing. Earlier deployment steps are skipped. |
| `--no-probe` | Skips the three live-probe steps. |
| `--exclude-world <slug>` | Leaves one `/worlds/w/<slug>/` world out of the arrival walks (repeatable). Unknown slugs fail. Backups, probe and activation are unchanged. Root-only refuses exclusions: all three canonical worlds are mandatory. |
| `--out <dir>` | Output folder (default `$SHIP_OUT_ROOT/<label>`). |

Environment:

| Variable | Default | Used for |
|---|---|---|
| `SIM_DEPLOY_HOST` | none; required | SSH target of the production host (an SSH config alias works); `SIM_DEPLOY_USER` (default `root`) is prepended. Also read by `release.sh` |
| `SHIP_ORIGIN` | `https://soul.game` (root-only), `https://sim.eden.art` (dual-prefix) | Public origin the probe and walks load |
| `SHIP_PROBE_CLI` | `.local/release-probe` | God folder of the release-probe world (below) |
| `SHIP_LEGACY_RELEASE_FILE` | `.local/ship/LEGACY-RELEASE` | File that records the active legacy build after activation |
| `SHIP_OUT_ROOT` | `.local/ship` | Parent of the output folder |
| `SHIP_PROBE_READY_S` | `600` | How long to wait for the probe to be ready |
| `MARS_WEB_SRC` | `.lane/mars-web` | Mars web asset overlay (see `release.sh`) |

Root-only builds with `SIM_WORLDS_BASE=/` and assumes the already provisioned launcher's `--base /` matches. It does
not change launcher configuration, proxy aliases, DNS, permissions or credentials. It skips both legacy steps, never
reads legacy stage links, never backs up legacy data, and writes only a production rollback command. After activation
and the probe, `ship/health.mjs` checks exact BUILD, all three canonical config identities, nonredirecting old API
aliases and same-origin permanent page redirects. Arrival walks cover all three worlds on desktop (DPR 1 and 2) and
phone (DPR 3), nine arrivals. CDN walks use the same three canonical worlds; poster and stall checks use `/w/eden/`.

Root-only local plan (no remote action):

```sh
tools/world-launcher/deploy/ship.sh --topology root-only --label <n> --dry-run
```

Steps, each checked by `ship/checks.mjs` (legacy steps apply only to `dual-prefix`):

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
| health | Root-only: `ship/health.mjs` checks exact BUILD, canonical config identities and old URL aliases | all HTTP contracts pass |
| walks | `ship/walk.mjs`: a fixed set of worlds on desktop at dpr 1 and 2, a smaller set on a phone | every arrival, 0 errors, 0 resyncs, picks ok |
| poster | `ship/poster.mjs` three times on a phone, then `ship/poster-count.py` | a world frame every run, never blank after it |
| stall | `ship/stall.mjs` four times on a phone | no frame gap over 1 s |
| cdn-walk | `tools/cdn/cdn-walk.mjs` on three live pages, desktop and phone | PASS |

Before the first change on the host, ship.sh reads the current and previous stage links and writes the rollback
commands to `<out>/ROLLBACK.txt`. The output folder also holds `STEPS.txt` (one line per step), `ship.log`, and each
step's logs, JSON and screenshots. Any failure stops the run: ship.sh prints what is live at that moment, the
rollback commands and the `--from` that resumes. It never rolls back by itself; `activate.sh` already does that for a
failed handover, and probe exit 3 reports it.

Tests stub every external command: `node --test tools/world-launcher/ship.test.mjs tools/world-launcher/root-release-health.test.mjs` (`SHIP_TEST=1` with `SHIP_SSH`,
`SHIP_SCP`, `SHIP_NODE`, `SHIP_PYTHON`, `SHIP_RELEASE_SH` and `SHIP_BUILD`).

## release.sh

```sh
tools/world-launcher/deploy/release.sh [staging|production|legacy] [--no-activate] [--restart|--reload]
tools/world-launcher/deploy/release.sh [staging|production|legacy] --local <absolute dir>   # assemble only
```

It runs from a clean checkout (`git status --porcelain --untracked-files=no` empty) and:

1. **Assembles** `we-<sha12>` (or `we-<sha12>-root` for `legacy`) in `.lane/release/<build>`: `git archive HEAD`
   (committed files only, so no `.env`, data or keys), `BUILD`, and the web app built with the selected `SIM_WORLDS_BASE` (`/` for root-only production or
   legacy, `/worlds/` for the prefixed production topology). An earlier local copy is moved aside, never deleted.
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
7. **Activates** with `activate.sh` unless `--no-activate` (legacy is never activated by release.sh; ship.sh does it).
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
for each selected build (only production for root-only), release.sh installs those instead of running Vite (`prebuilt-web.mjs install`). The receipt must
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

After the handover activate.sh waits up to 60 s for `http://<loopback>:<port><base>/__sim/healthz` to report the new
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
- **By hand:** run the commands ship.sh wrote to `ROLLBACK.txt`, which are of the form

  ```sh
  ssh "$SIM_DEPLOY_USER@$SIM_DEPLOY_HOST" bash <previous>/tools/world-launcher/deploy/activate.sh production <previous> --reload
  # dual-prefix only:
  ssh "$SIM_DEPLOY_USER@$SIM_DEPLOY_HOST" bash <previous-root>/tools/world-launcher/deploy/activate.sh legacy <previous-root> --reload
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

Then, in an empty folder on the machine that will run ship.sh, register and pair a god for it:

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

`deploy/swap-probe.mjs --origin http://<loopback>:<port> --base /worlds --slugs a,b --out probe.json [--posts]` GETs the
homepage and each world every 100 ms, holds one viewer socket per world, and reports refused connections, 5xx, the
longest error run, the slowest request and each socket's downtime. `--posts` adds a POST per world, which catches a
connection closed under a request. Run it through a reverse proxy with production-like transport settings to see
what a visitor would.

## Root-only world deployments

Set `SIM_WORLDS_BASE=/` for a root web build and run the launcher with `--base /`. Existing `/worlds` releases remain
supported. Follow [world URL migration](operations/world-urls.md) to preserve world identities and paired agents when
changing public slugs. Use explicit `ship.sh --topology root-only`; there is no implicit legacy deployment. The workflow remains disabled
until the review and rehearsal requirements above are met.

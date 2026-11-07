# Operations

How the public site runs: `https://soul.game` on the root-only production host, with immutable assets on
`https://assets.eden.art`. Hosts, SSH users, keys and credentials live in deployment secrets and host settings, never
in the repository.

| Page | For |
|---|---|
| [release](release.md) | Shipping a commit: gate receipt, `ship.sh`, `release.sh`, handover, rollback |
| [runbook](operations/runbook.md) | Day-to-day commands: health, logs, backups, worlds, the legacy stage |
| [disaster recovery](operations/disaster-recovery.md) | A blank host to a serving site |
| [CDN](operations/cdn.md) | `assets.eden.art`: publishing, verification, the uploads Worker |
| [auth](operations/auth.md) | Clerk sign-in and the shared account registry |
| [analytics](operations/analytics.md) | Cookieless visitor counts |

## Services and stages

Each stage is one systemd unit, `sim-worlds@<stage>`, running as the unprivileged `simworlds` user. The unit runs the
keeper (`tools/world-launcher/keeper.mjs`), which holds the stage's port and runs the world launcher from the release
the stage link `/srv/sim-worlds/<stage>` points at. The launcher runs one Souls server process per world on a private
loopback port and proxies HTTP, SSE and WebSocket traffic to it, starting worlds on demand and letting idle ones sleep.

| Stage | Public paths | Settings | Data |
|---|---|---|---|
| `production` | `/`, `/w/<slug>/` | `/etc/sim-worlds/production.conf` | `/srv/sim-worlds-data/production` |
| `legacy` (historical topology) | Not a second stage on the current public host | `/etc/sim-worlds/legacy.conf` | `/srv/sim-worlds-data/legacy` |
| `staging` | none (loopback, dev auth) | `/etc/sim-worlds/staging.conf` | `/srv/sim-worlds-data/staging` |

Each settings file holds one line, `SIM_WORLDS_ARGS=...`: the port, the world port range, data directory, public
origin, auth env file and caps (`--max-worlds`, `--max-running`, `--min-free-mb`, `--world-heap-mb`, `--create-limit`).
`tools/world-launcher/deploy/install.sh` writes the production and staging files once and never edits an existing
one. Memory limits are per-stage systemd drop-ins (`sim-worlds@<stage>.service.d/10-memory.conf`).

Caddy terminates TLS and sends the canonical root site to production; `souls.game` redirects to `soul.game`.
The canonical worlds are `/w/eden/`, `/w/mars-college-2026/` and `/w/mars-college-2027/`.
Keep the configured asset-serving rules and old world URL aliases intact. The Clerk primary remains on the
eden.art instance: old identity-provider URLs are intentional, not blanket rename targets. After a host reboot,
check that Caddy is active (`systemctl is-active caddy`).

The former `/worlds` production plus `/` legacy topology remains supported by some tools, but is not the current
public deployment. [Release](release.md) identifies the root-only automation gap; do not apply legacy activation
or proxy examples to this host. Internal `sim-*` service and data names remain unchanged.

## Health

- `GET https://soul.game/__sim/healthz`:
  `{ok, service, build, auth, worlds, running, maxWorlds, maxRunning, hostOk, hostCodes?, clientErrorsNew}`. `hostOk`
  and short `hostCodes` are public; the numbers behind them are for loopback requests only.
- `GET /__sim/health`: a health page for site owners (accounts listed in `SIM_SITE_OWNERS`) or loopback; build,
  host, every world, backups, arrivals, new client errors and alerts (`tools/world-launcher/health-dash.mjs`).
- `GET /w/<slug>/healthz` carries `halted` and `glitches`: `{total, byRule: {rule: {rung: n}}}`, every refusal, recovery and halt
  the world has had. It is public, so rule names and counts only. Each glitch also writes one `[world] glitch` line to
  the world's log and one row to its store, with the bodies, the tick and the evidence: `op.mjs glitches --port <port>
  --base / [--world <slug>]` reads those, for sleeping worlds too. The health page shows the counts. A halted world is the
  `halted` problem code, so `hostOk` goes false and `host-health.log` gets its ALERT line; a refusal or recovery raises no alert
  until real numbers set a rate threshold ([#1150](https://github.com/soulsimulation/souls/issues/1150)). A rewind (rung 3) is the
  `rewound` problem code, held for two checks so one always sees it: several in a window show as one line with the latest
  count, and it clears on its own. A world with half its ticks faulted over 10 s of world time counts as `halted` too, though
  its clock runs: it refuses acts with `world.step-failing` until the faults fall away, and the glitch rule is `engine.step-failing`.
- `SIM_SOULS_REPAIR=1` is read per process and isn't a live switch: on a running server it stops every existing world
  booting, because a world without `souls-repair/` refuses that build until the boot repair lands
  ([#1150](https://github.com/soulsimulation/souls/issues/1150)). Keep it off outside a test world.
- `sim-worlds-health@<stage>.timer` runs `deploy/host-health.mjs` every 10 minutes: disk, memory, the unit's working
  set against its `MemoryMax`, OOM kills and the last backup. It writes `<data>/host-health.json` and appends an
  ALERT/RECOVERED line to `<data>/host-health.log`; the launcher folds the result into healthz. An external monitor
  can alert on `hostOk`.

## Backups

`sim-worlds-backup@<stage>.timer` runs nightly (`deploy/backup-restic.mjs backup <stage>`). It copies every SQLite
database of the stage with SQLite's online backup API, checks each copy with `PRAGMA quick_check`, adds the registry,
audit log, uploaded assets, old-world fork inputs and the stage's non-secret host settings, and takes one deduplicated
restic snapshot. Retention keeps 7 daily, 4 weekly and 6 monthly snapshots (`SIM_BACKUP_KEEP`). An off-host copy to an
S3-compatible bucket runs when `SIM_BACKUP_OFFSITE` is set. Every release also takes its own compact pre-release copy.
Commands are in the [runbook](operations/runbook.md#backups). Local backup verification does not prove offsite
recovery; [offsite setup #557](https://github.com/soulsimulation/souls/issues/557) is explicitly deferred and must be
qualified separately.

## Logs

- Unit and keeper: `journalctl -u sim-worlds@<stage>`.
- Each world: `<data>/logs/<slug>.log` (rotated by the launcher).
- Handover state: `<data>/keeper.json`.
- Host checks: `<data>/host-health.log`.
- Visitors' page errors: pages post to `/__sim/client-errors`; `node tools/world-launcher/op.mjs client-errors --port
  <port> --base /` summarises them on the current root-only host. Use the actual configured base for other deployments.
- Operator actions: `<data>/audit.jsonl` (`op.mjs audit`).

## CDN

Reviewed immutable assets (models, textures, the Mars campus, the humanoid kit) are content-addressed objects on
`assets.eden.art`. The web build carries a manifest that maps origin URLs to CDN keys; the client checks length and
SHA-256 and falls back to the origin on any failure. God uploads go through a pull-through Cloudflare Worker on
`assets.eden.art/w/*`. See [CDN](operations/cdn.md).

## Auth

Signed-in actions use Clerk. The launcher reads only the public Clerk settings from the stage's auth env file and all
worlds of a stage share one account registry. See [auth](operations/auth.md).

## Analytics

Page views and three events are counted without cookies and without any query string, hash, Soul id or token.
Automated browsers are not counted. See [analytics](operations/analytics.md).

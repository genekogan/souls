# Runbook

Current production is root-only `https://soul.game`; internal service/data names are unchanged. Legacy-stage
sections describe the former deployment and do not apply to the current public host. Check the release owner’s
approved runsheet before any mutation; see [release topology](../release.md#current-production-topology).

Commands for the running site. They run on the production host as root unless noted; from elsewhere, prefix them
with `ssh "$SIM_DEPLOY_USER@$SIM_DEPLOY_HOST"` (the same target the release scripts read from `deploy.env`). Stage names, paths and units are
described in [operations](../operations.md); releases are in [release](../release.md).

Paths below use the stage's release link, so they always run the live code:

```sh
R=/srv/sim-worlds/production
P=$(sed -n 's/.*--port \([0-9]*\).*/\1/p' /etc/sim-worlds/production.conf)
```

## Health

```sh
curl -fsS https://soul.game/__sim/healthz           # public: build, worlds, running, hostOk
curl -fsS http://127.0.0.1:$P/__sim/healthz            # loopback: also the host numbers
curl -fsS http://127.0.0.1:$P/w/<slug>/healthz         # one world
systemctl is-active sim-worlds@production caddy
systemctl list-timers 'sim-worlds-*'
```

A single response proves reachability only; repeat a world's healthz after a short interval to see its clock advance.
`hostOk: false` comes with short `hostCodes`; the details are in `<data>/host-health.json` and `host-health.log`.
The site owners' page is `https://soul.game/__sim/health`.

## Logs

```sh
journalctl -u sim-worlds@production -n 200 --no-pager          # keeper and launcher
tail -n 100 /srv/sim-worlds-data/production/logs/<slug>.log    # one world
cat /srv/sim-worlds-data/production/keeper.json                # active build, last handover per world
node $R/tools/world-launcher/op.mjs client-errors --port $P --base / [--world <slug>]
node $R/tools/world-launcher/op.mjs audit --port $P --base / [--slug <slug>]
```

## Restarting

- `systemctl reload sim-worlds@<stage>` hands every running world over to a fresh launcher from the current release
  without closing the port (see [release](../release.md#activation-and-handover)).
- `systemctl restart sim-worlds@<stage>` restarts everything; needed after changing the unit or the stage's settings
  file. Each world saves a snapshot on SIGTERM and resumes from it.
- Pairing codes and pending approvals are held in memory; after a restart an agent may need to retry them.

## World operations

`tools/world-launcher/op.mjs` talks to the launcher on loopback only (anything arriving through the reverse proxy is
refused). Every call is an audit row.

| Command | Effect |
|---|---|
| `create-world --name <n> --template <t> (--owner <account> \| --owner-of <slug>) [--slug] [--unlisted]` | A world born owned by an existing account |
| `set-unlisted --slug <s> --unlisted true\|false` | Hide from or show in the public list (still served at its URL) |
| `set-claimable --slug <s> --claimable false` | A world without a god that nobody may claim |
| `archive-world --slug <s> [--reason]` / `list-archive` / `restore-world --id <id>` | Stop and move a world to `<data>/archive/`, or put it back; nothing is deleted |
| `register-fork` / `remove-fork` | Serve or stop an old-world fork (legacy stage) |
| `set-test`, `soul-*`, `god-pending`, `god-approve` | TEST Souls and the probe god on worlds flagged test only |

All take `--port <port>` and `--base /` for production (no `--base` on legacy).

## Continuous worlds

`--continuous` in `SIM_WORLDS_ARGS` (or `SIM_CONTINUOUS_WORLDS=1` in the unit's environment) keeps every current-engine
world running at its full clock without visitors ([worlds](../architecture/worlds.md)). It is off by default. Do not
turn it on in production until the capacity verdict for the running worlds says the host can carry all of them at once
(#736, #740 A5). Every registered world then costs its full-clock CPU and memory all the time.

1. Check capacity: registered current-engine worlds ≤ `--max-running`, and their resident memory fits under the unit's
   memory limit with the qualified headroom.
2. Add `--continuous` and restart the unit. The launcher log says `continuous worlds: on`, then names each world it starts.
3. Watch `/__sim/healthz` and `world-problems.json`. `continuousDown` means a world that should run is not (the reason is
   in the text), and `continuousUnsupported` names old-engine forks, which keep the idle policy.
4. Rollback: remove the flag and restart the unit. The idle pace, sleep and exit policy apply again from that start.

## Backups

Nightly at 03:30 UTC `sim-worlds-backup@<stage>.service` runs `deploy/backup-restic.mjs backup <stage>` as
`simworlds`:

1. Copies `accounts.sqlite`, `forks/accounts.sqlite` and every `worlds/<slug>/sim.db` with SQLite's online backup API
   (consistent while worlds write) and runs `PRAGMA quick_check` on each copy.
2. Adds `worlds.json`, `audit.jsonl`, the uploaded assets in `worlds/assets`, the fork inputs (`forks/descriptors`,
   `forks/artifacts`) and an allowlist of the stage's non-secret host settings under `host-config/` (its
   `<stage>.conf`, memory drop-in, Caddy site and blobs snippet). Only new or changed files are copied into the
   staging mirror.
3. Takes one restic snapshot of the mirror, tagged with the stage.
4. Applies retention with `forget --prune` (`SIM_BACKUP_KEEP`, default 7 daily, 4 weekly, 6 monthly; `off` deletes
   nothing), then `check` reads a seventh of the data, so all of it is read once a week.
5. Copies the new snapshots to `SIM_BACKUP_OFFSITE` and applies the same retention there, when that is set.

The run exits 1 if any database fails its check (the others are still snapshotted); host-health then reports it.
Until restic is set up (no binary, password file or repository) it falls back to dated full copies
(`deploy/backup.mjs`) and says so. The script never creates a repository: create it once with `restic init`.

Settings are in `/etc/sim-worlds/backup.env` (template: `deploy/backup.env.example`; every key has a default). The
repository password file (`RESTIC_PASSWORD_FILE`) is root:simworlds 0640 and must also be kept off the host: without it
the backups cannot be read.

```sh
set -a; . /etc/sim-worlds/backup.env; set +a
node $R/tools/world-launcher/deploy/backup-restic.mjs list [<stage>]
node $R/tools/world-launcher/deploy/backup-restic.mjs restore <stage> <latest|YYYY-MM-DD|id> <empty dir>
```

Restore refuses a non-empty directory, lays it out like `/srv/sim-worlds-data/<stage>` and quick-checks every
database (exit 1 if any is bad). To boot one restored world on any machine:

```sh
ENABLE_WORLD_ENGINE=1 SOUL_LIFECYCLE=1 node tools/god-skill/dev-world.mjs <slug> <port> --data <dir>/worlds/<slug>
```

`SOUL_LIFECYCLE=1` is what the launcher sets; without it a production world's history refuses the engine.

To put a world's data back live: stop the stage, move the world's `sim.db` aside (keep it), copy the restored one in,
`chown simworlds:simworlds`, start the stage. Restoring data discards events accepted since the snapshot, so do it only
for real data loss. Tests: `node --test tools/world-launcher/backup-restic.test.mjs` (skips without restic).

Release backups (`ship.sh` step `backup`) are separate: row-verified compact copies in
`/srv/sim-worlds-data/release-backups/pre-r<label>-<stage>-<time>`. `deploy/retention.sh` lists and prunes old ones
([release](../release.md#retention)).

## Legacy stage

The legacy stage serves the three original worlds (`eden`, `mars`, `littlemartians`) at `/w/<key>` and the root web
build's world list at `/`, on the current release. Its launcher runs with `--old-worlds-root`: only old-world forks
(`tools/world-launcher/fork-world.mjs`), root paths routed as the original site had them, and no world creation
(`--create-limit 0`). Unit `sim-worlds@legacy`, settings `/etc/sim-worlds/legacy.conf`, data
`/srv/sim-worlds-data/legacy` (`worlds/<key>/sim.db`, `forks/{descriptors,artifacts,accounts.sqlite}`).

- **Releases:** `release.sh legacy` uploads `we-<sha12>-root` with `FILES.sha256` and never activates it; `ship.sh`
  activates it after production. By hand:

  ```sh
  L=/srv/sim-old/releases/we-<sha12>-root
  (cd $L && sha256sum -c --quiet FILES.sha256) && bash $L/tools/world-launcher/deploy/activate.sh legacy $L --reload
  ```

  Do not move the stage link yourself; activate.sh records `legacy.previous` for its rollback.
- **Stage settings:** `/etc/sim-worlds/legacy.conf` and the legacy memory drop-in come back with every snapshot in
  `host-config/` ([disaster recovery](disaster-recovery.md#3-secrets-and-settings)). The stage's world forks are
  registered once and are not claimable; releases never re-register them.
- **Redirect switch** (off by default): `<data>/redirects.json`, re-read when it changes
  (`tools/world-launcher/redirects.mjs` documents the format): `enabled`, an optional `home` for `/`, and a target path
  per original world. Only page loads of `/`, `/w/<key>` and `/w/<key>/` get a 302; agents, the API and live viewers
  keep the original world, and `?stay=1` always opens it. Check that each target answers 200 before turning it on.

## After a reboot

Check `systemctl is-active caddy sim-worlds@production sim-worlds@legacy` and the timers. Caddy can start before the
network it binds to is ready on a host that also runs Docker; restart it if it is not active.

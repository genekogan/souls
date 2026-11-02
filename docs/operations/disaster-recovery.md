# Disaster recovery: legacy dual-stage reference

**Topology warning:** this procedure describes the former prefixed production plus legacy deployment. The current
public site is root-only `https://soul.game`; do not copy the dual-stage uploads, memory settings or Caddy routing
below onto its host. Recovery must use the current release owner's approved host/bootstrap record, base `/`,
actual backup inventory and isolated restore verification. A fully rehearsed root-only recovery procedure remains
unverified; local backups alone do not prove recovery from losing the server. Offsite provisioning is deferred.
See [operations](../operations.md) and [release](../release.md#current-production-topology).


"Serving" means `https://sim.eden.art/worlds/` (stage `production`) and `https://sim.eden.art/` with `/w/<key>`
(stage `legacy`), both with Clerk sign-in, on the last released commit, with every world's history as of the last
nightly backup. Stages and paths are described in [operations](../operations.md).

## 0. What you need

| Item | Where it comes from |
|---|---|
| The restic repository | The off-host copy (`SIM_BACKUP_OFFSITE`), or the old host's disk if it is still readable |
| The restic password | Kept outside the host; without it the backups cannot be opened |
| A clean checkout of the commit to restore, with the Mars web asset overlay | The repository (`MARS_WEB_SRC`, see [release](../release.md#releasesh)) |
| Root SSH access to the new host | Deployment secrets (`SIM_DEPLOY_HOST`, `SIM_DEPLOY_USER`) |
| Clerk public settings | The Clerk dashboard ([auth](auth.md)) |
| DNS for the site name | The DNS provider (Cloudflare, proxied) |

If the repository exists only on the lost host, the backups are lost with it. Configure `SIM_BACKUP_OFFSITE` and keep
the password off the host before you need this page.

## 1. The host

Ubuntu 24.04 on x86 with 16 GB of RAM or more (production's memory drop-in is 8G/9G, legacy's 2G/2560M). Firewall:
inbound 22, 80 and 443 only. As root:

```sh
apt-get update && apt-get -y upgrade
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https rsync sqlite3 python3 restic
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs    # Node 22
corepack enable                          # pnpm comes from the repo's packageManager field
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
restic version                           # 0.14 or later reads the repository format
```

## 2. Releases

From the clean checkout, upload both stages without activating them (activating now would start production on an
empty data directory):

```sh
SIM_DEPLOY_HOST=<new host> tools/world-launcher/deploy/release.sh production --no-activate
SIM_DEPLOY_HOST=<new host> tools/world-launcher/deploy/release.sh legacy        # never activates
```

`release.sh production` runs `install.sh` on the host: the `simworlds` user, `/srv/sim-worlds{,-data,-backups}`,
`/etc/sim-worlds/` with `production.conf` and `staging.conf`, the `sim-worlds@.service` unit, the backup and health
timers and the production memory drop-in.

## 3. Secrets and settings

Provision these by name; each is root:simworlds 0640 and never committed:

- `/etc/sim-worlds/production-auth.env`: `CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER_URL`, `CLERK_AUTHORIZED_PARTIES`
  (public settings only, no Clerk secret key). The legacy stage reads the same file.
- The restic password file (`RESTIC_PASSWORD_FILE`, default `/etc/sim-worlds/restic.pass`): the same password the
  repository was made with.
- `/etc/sim-worlds/backup.env` from `deploy/backup.env.example`, with the retention line and, for the off-host copy,
  `SIM_BACKUP_OFFSITE` and its key pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

The non-secret host settings come back with the data: every snapshot carries `host-config/` with the stage's
`/etc/sim-worlds/<stage>.conf`, its memory drop-in, `/etc/caddy/sites/sim.caddy` and `/etc/caddy/sim-blobs.snippet`.
Install `legacy.conf` and the legacy memory drop-in from there (step 4), or write them by hand; the legacy line is:

```sh
SIM_WORLDS_ARGS=--old-worlds-root --port <port> --range <first>-<last> --data /srv/sim-worlds-data/legacy --public-origin https://sim.eden.art --auth-env /etc/sim-worlds/production-auth.env --max-worlds 3 --max-running 3 --min-free-mb 1500 --create-limit 0 --mars-web /srv/sim-worlds/legacy/mars-web --eager 3
```

Then `systemctl daemon-reload`.

## 4. Data

Point restic at the repository (the defaults in `backup.env`, or `RESTIC_REPOSITORY` for the off-host copy with its
key pair in the environment). Restore refuses a non-empty directory; `install.sh` leaves the production data
directory empty.

```sh
R=/srv/sim-worlds/releases/we-<sha12>          # the release just uploaded
cd $R && set -a && . /etc/sim-worlds/backup.env && set +a
node tools/world-launcher/deploy/backup-restic.mjs list
node tools/world-launcher/deploy/backup-restic.mjs restore production latest /srv/sim-worlds-data/production
node tools/world-launcher/deploy/backup-restic.mjs restore legacy latest /srv/sim-worlds-data/legacy
for s in production legacy; do d=/srv/sim-worlds-data/$s; [ -d $d/host-config ] && mv $d/host-config /root/host-config-$s; done
chown -R simworlds:simworlds /srv/sim-worlds-data
```

Move `host-config/` out of each data directory before booting, then compare its files with `/etc` and install them.

Each stage's snapshot holds `accounts.sqlite`, `forks/accounts.sqlite`, every `worlds/<slug>/sim.db` (quick-checked
online-backup copies), `worlds.json`, `audit.jsonl`, `worlds/assets` (uploads) and `forks/descriptors` plus
`forks/artifacts`, which the legacy forks need to boot. `worlds.json` names descriptor paths under
`/srv/sim-worlds-data/legacy/forks/`, the same on the new host; world ports are reassigned by the launcher.

A restore brings back each world's event log, Souls, accounts and uploads as of the snapshot. It does not bring back
activity since then (the recovery point is up to a day), sign-in sessions (people sign in again) or pairing tokens.

## 5. Start

```sh
systemctl enable sim-worlds@production sim-worlds@legacy
P=/srv/sim-worlds/releases/we-<sha12>
bash $P/tools/world-launcher/deploy/activate.sh production $P --restart
L=/srv/sim-old/releases/we-<sha12>-root
(cd $L && sha256sum -c --quiet FILES.sha256) && bash $L/tools/world-launcher/deploy/activate.sh legacy $L --restart
systemctl enable --now sim-worlds-backup@production.timer sim-worlds-backup@legacy.timer \
  sim-worlds-health@production.timer sim-worlds-health@legacy.timer
```

`activate.sh` checks the stage's healthz and boots every registered world, else exits 1 (a first install has no
`.previous` to roll back to). Each legacy world checks its recorded engine and kernel hashes at boot, so a world that
boots has replayed its history to the same state. Boot-time checks that log events can add a few events a
continuously running world would not have; they replay deterministically.

## 6. Caddy

Install `sim.caddy` and `sim-blobs.snippet` from `host-config/` (the snippet is also in the repository at
`tools/world-launcher/deploy/blobs/sim-blobs.snippet`). The site file:

- imports `/etc/caddy/sim-blobs.snippet`;
- defines a client-IP snippet that trusts `CF-Connecting-IP` only from Cloudflare's published ranges (else the peer
  address) and passes it as `X-Forwarded-For`;
- serves `https://sim.eden.art` with `encode zstd gzip` and `X-Robots-Tag noindex`, sends `/worlds*` to the
  production port, imports the blobs handler, and sends everything else to the legacy port.

`/etc/caddy/Caddyfile` needs only `{ admin 127.0.0.1:2019 }` and `import sites/*.caddy`. Then
`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.

Static blobs under `/srv/sim-blobs` are not in the backups. Those the web build references are on the CDN and load
from there; others answer 404 until re-staged from a copy.

## 7. DNS

Point the site's record at the new host, proxied through Cloudflare, keeping the zone's SSL mode. Caddy obtains its
certificate on the first request; watch `journalctl -u caddy`.

## 8. Check as a visitor

Open `https://sim.eden.art/worlds/`: the list loads, a world renders and its clock moves, Clerk sign-in works. Open
`/w/eden`, `/w/mars` and `/w/littlemartians`. Then run `systemctl start sim-worlds-backup@production.service` once and
confirm `backup-restic.mjs list` shows a new snapshot from this host.

## Not covered by the backups

- Archived worlds (`<data>/archive`) and older dated backup sets.
- Static blobs (`/srv/sim-blobs`), as above.
- Secrets: they are provisioned by name, never backed up.

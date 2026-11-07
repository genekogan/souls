# Bounded Linux renderer and Eyes preflight

Checks, on the production host, that a candidate's context renderer and an Eyes worker can run beside production
without starving it. Run it only after reviewing the exact candidate and this protocol. The runner changes no
production unit, live Soul, public route configuration or existing data; staging and any production
Environment/ReadWritePaths changes are separate operator steps. A daemon-reload does not update running keepers.

## Stage once, before the measurement

1. Create a fresh candidate directory under `/srv/sim-preflight/releases/` from the exact committed candidate archive
   and the verified local web build. Keep its source/build manifest and run the release-manifest verifier. Never use a
   live data directory or copy a world database.
2. Find the existing `simworlds` pnpm store; don't guess a path. `release.sh` runs pnpm as `sudo -u simworlds -H`
   without `--store-dir`, and `/srv/sim-worlds/production/node_modules/.modules.yaml` records `storeDir` (or run
   `COREPACK_ENABLE_NETWORK=0 corepack pnpm store path --silent` as that user). Read only the store setting; never
   print environment or auth files.
3. Check the candidate lockfile hash matches production's, then in the candidate directory run
   `COREPACK_ENABLE_NETWORK=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 corepack pnpm install --offline --frozen-lockfile
   --store-dir <store> --filter @souls/server... --filter mars-campus-viewer`. A failure means missing prerequisites: keep
   the log and stop; never retry online or download browsers. As in `release.sh`, link only web's `@souls/world-compiler`
   to the candidate package if the server-filtered install omitted it. Never symlink production `node_modules`:
   workspace links can silently select old production source.
4. Point both candidate units at the Chromium already installed under `/srv/sim-eyes/ms-playwright` (browser cache and
   executable) and at the candidate viewer `package.json` for its Playwright module. The Playwright-selected Chromium
   revision must be that executable; a mismatch means unavailable, not permission to download.
5. As root, create or validate `/srv/sim-render-locks` writable by `simworlds` without clearing another process's lock.
   Candidate code and web stay read-only to the units; `/srv/sim-preflight` must be traversable by `simworlds`.
6. Save a staging receipt: candidate SHA, archive/build hashes, Node version, lockfile hash, install result, package
   links, store path and browser path/revision. Its SHA goes into the runner config.

## Invocation

Write a JSON config with `runId`, `root`, `out` (a new path under `/srv/sim-preflight/`), `sourceSha`, `sourceReceipt`,
`sourceReceiptSha256`, `lockSha256`, `node` (Node 22), `webDir`, `chrome`, `browserPath`, `eyesPackage`, `lockDir`,
`productionUnits` (the verified production systemd unit names) and `productionEyesStatus` (loopback URL of Eden's
public `/v1/edge/view/status`). These are provenance and configuration only; never include credentials.

Run `node tools/context-views/linux-host-preflight.mjs <config.json>` as root from the staged candidate. No flag bypasses
the source, budget or host guards. Work is limited to 180 s plus 10 s cleanup (staging excluded). Each transient unit
has `RuntimeMaxSec=180` and a 5 s control-group stop timeout; an operator watchdog may stop only those two unit names if
the shell disconnects. There is no automatic retry.

## Evidence and limits

- Two main processes on fresh small fixture data, ports 5986/5987, as `simworlds`, with separate PrivateTmp, the
  production security properties and one shared architectural lock. Each cgroup is capped at 2560 MiB. Admission needs
  6 GiB available; dropping below 3 GiB during work aborts only these two units.
- One enclosed-room target and one outdoor fountain target: at most four architectural starts including retries, exactly
  two successful PNGs. Cross-unit serialization is established by admission overlap, Chrome spawn/stop intervals and
  lock holder identities, not by one-second process sampling.
- One EyesWorker against fixture A renders one fixed-camera JPEG, with no Soul or inference; its render interval must
  overlap a context capture, otherwise coexistence is unqualified.
- Production Eden Eyes is observed only through its public status: ready/since/failure counters must not change, and
  production cgroup OOM counters must not increase. Natural production renders may advance but are never induced.
- Recorded: cgroup current/peak memory, CPU, OOM/events, PID/start/executable and live query/tick progress. Query
  latency is descriptive; this does not replace the full-Eden latency test.
- Each context image is fetched twice; identical key, URL and byte hash with an unchanged render count establish reuse.
  All logs, images and failures are kept.
- Cleanup stops only the newly admitted units, checks ports and owned lock holders, keeps all directories and never
  unlinks a shared lock.

If either process fails, the result is unavailable/fail with its evidence. To retry, diagnose the failure and use a new
run directory; never widen limits, restart production Eyes or substitute another fixture.

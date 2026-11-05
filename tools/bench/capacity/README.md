# Capacity bench (`tools/bench/capacity/`)

Measures one world under N scripted Souls (fake minds, $0 model spend) on a fixed 2-core cgroup slice. Metrics and arms
are frozen in [`METRICS.md`](METRICS.md) (v1); the pass table is tranche §2. Tools-only: never gated, never on Modal.

- `bench.mjs`: the runner (boots one fresh world per arm and repeat, drives it, writes `result.json` per run, then `receipt.json` + `REPORT.md`).
- `report.mjs`: rebuilds `REPORT.md` from a run directory (`node report.mjs <out>`).
- `busy-scenario.mjs`: 15 s demo of the polite CLI against a fake `503 world.busy` world (no server needed).

## eden2 (R runs it; the numbers that gate)

Quiet window; record `uptime` before and after (the receipt does too). Everything lives under `/srv/sim-bench/` and
uses ports 5151–5152; it never touches eden3, the `mars` user, production worlds or their data dirs (the fixture is a
compact copy, made once, read-only to the bench).

1. **Source**: a checkout of the commit under test at `/srv/sim-bench/src` (`git -C /srv/sim-bench/src checkout <sha>`
   then `pnpm install --frozen-lockfile`). The baseline is main `cdd3eece3`. The bench files are read from this
   lane's branch; copy `tools/bench/capacity/` into `/srv/sim-bench/bench/` if the commit under test predates them.
2. **Fixture** (compact copy only, never a whole DB copy):
   `python3 /srv/sim-bench/compact-copy.py <eden-2026 live sim.db> /srv/sim-bench/fixtures/eden-2026.db`
   (`compact-copy.py` = a private ops script, copied over once; it opens the source read-only in one transaction).
   Note the world key and world id of the live Eden 2026 world (the bench reads the id from the fixture if not given).
3. **Run** (as root, so `systemd-run --scope --uid` can place only the world in the slice; the driver runs outside it):

```bash
cd /srv/sim-bench/src && node /srv/sim-bench/bench/bench.mjs --root /srv/sim-bench/src --fixture /srv/sim-bench/fixtures/eden-2026.db --world-key eden-2026 --out /srv/sim-bench/runs/baseline-cdd3eece3 --host-label eden2-slice --world-user simworlds --slice "systemd-run --quiet --scope -p AllowedCPUs=6-7 -p MemoryMax=4G --uid=simworlds --gid=simworlds" --heap-mb 768 --repeats 2 > /srv/sim-bench/runs/baseline-cdd3eece3.log 2>&1
```

   The world's command and env come from the checkout's own `tools/world-launcher/children.mjs` `defaultCommand` +
   `production.mjs` `decorateCommand` (ENGINE, ENABLE_WORLD_ENGINE, SOUL_LIFECYCLE, fading, unwatched pace, malloc env,
   heap), Eyes off; each run writes `world-command.json` (no secrets). A 10 s **preflight** boot of the fixture runs first
   and stops the bench in seconds with the `world.log` tail if the world does not come up (`--arms none --repeats 0`
   runs the preflight alone).
   About 2 h for six arms × two repeats (boot + join + 60 s warm-up + 30 s idle + 2 × 120 s per run). Background it
   (`nohup … &`); judge by `receipt.json`, never by the shell's exit code.
4. **After**: copy `REPORT.md` + `receipt.json` (not `commands.jsonl`, not `souls/`) back to
   `.local/bench/clients/eden2-<sha>/`; delete the fixture (`/srv/sim-bench/fixtures/eden-2026.db`) — that delete
   is on the bench's own scratch file, not a production artefact. The per-run data copies are moved to
   `~/.Trash/eden-cleanup-20261020/` by the bench itself.

The driver holds about two Node processes per Soul (its `listen` and the command in flight): at N = 24 that is ~50
processes, ~2 GB RSS, outside the slice.

## Laptop (smoke; INDICATIVE, never passes or fails)

```bash
node tools/bench/capacity/bench.mjs --root "$PWD" --fixture genesis:eden-2026 --out .local/bench/clients/local-<sha> [--short]
```

`genesis:<template>` boots a fresh world from `worlds/templates/<template>.json` (no history, no real Souls), so it is
lighter than a compact copy of the live world.

## Through the launcher (`--via-launcher`)

The default boots `apps/server` directly, so the launcher's proxy, its coarse flood guard and (from R1) the Soul API
ceilings (`flood.mjs soulCeilings`) are not in the path. `--via-launcher` runs the root's own
`tools/world-launcher/launcher.mjs` on `--port` (children on `--child-range`, default the next two ports) with its data
dir at `<run>/launcher`: one `worlds.json` row for the fixture (slug = `--world-key`, `worldHeapMb` = `--heap-mb`,
template of the same key), the fixture copied to `<run>/launcher/worlds/<slug>/sim.db`, `--public-origin
http://localhost:<port>` so the launcher applies its behind-a-proxy rules as on eden2. Hostile Souls each send their own
`X-Forwarded-For` (one address per Soul); the CLI Souls send none. The world serves the root's own `eden.mjs` (no
`--cli`), and the launcher builds the child command, so there is no `--inspect`: heap comes from the world's
`live.json` when it writes one, else the report shows — (RSS stays). The report adds the launcher's view per run
(world status, restarts, refusals by code from `/__sim/health?json=1`) and the launcher's own CPU. Not yet combined
with `--slice`.

```bash
node tools/bench/capacity/bench.mjs --root <checkout> --fixture <compact copy> --world-key eden-2026 --via-launcher --port 5153 --heap-mb 2048 --arms hostile,incident --out <dir>
```

## Stage B: read worker off vs on (`--load stageb`, METRICS.md v2)

Through the launcher only. Each arm runs once per read-worker mode, back to back; `on` writes the registry fields
`op.mjs set-read-workers` / `set-limits` write (`readWorkers`, `limits.worldBudgetRps` 200) and the launcher passes
`SIM_READ_MODE=2` to the world. 3 CLI Souls + raw-HTTP Souls (the CLI's requests and etiquette) so N = 100 fits beside
production. The report adds a side-by-side table (tick, healthz, read p99 per kind, worker-served share, fallbacks,
main vs worker CPU, oracle sample), the Stage B target table and M8 per mode.

```bash
# laptop (INDICATIVE)
node tools/bench/capacity/bench.mjs --root "$PWD" --fixture <compact copy> --world-key eden-2026 --via-launcher --port 5271 --child-range 5272-5279 --heap-mb 2048 --load stageb --read-worker off,on --arms n6,n24 --repeats 1 --out <dir>
# eden2 (as root; the launcher and world run as simworlds; world + its threads pinned to CPUs 6-7)
node bench.mjs --root /srv/sim-bench/src-<sha> --fixture /srv/sim-bench/fixtures/eden-2026.db --world-key eden-2026 --via-launcher --port 5151 --child-range 5152-5159 --heap-mb 2048 --host-label eden2-slice --world-user simworlds --cpus 6-7 --load stageb --read-worker off,on --arms n6,n12,n24,n50,n100 --repeats 2 --out <dir>
```

The exact eden2 recipe for a run is `eden2/run-stageb.sh` (`run-stageb-f.sh` for part F).

## Meetup workload (CW1, #735: 50 Souls across 10 worlds)

`meetup/` is the near-term product as a workload: ten substantial worlds from `worlds/templates/` behind the
checkout's own launcher, fifty fake-mind Souls, quiet periods and coordinated meetups. It reuses this bench's
approach (the launcher in the path, the Soul CLI to join, raw HTTP with the CLI's requests and retry etiquette
afterwards) without changing `bench.mjs`.

- `meetup/workload.mjs`: the workload as data, pure and seeded: fixtures, the two profiles (`even` = 5 per world;
  `meetup` = 20 in world 0 and 30 across the other nine), account and address grouping (a three-Soul account in the
  meetup world, a three-world account, five Souls behind one network address; documentation addresses only), the
  declared demand (a rich read per Soul every 4 s; an act every 20 s cycling movement, attention, speech, a gesture, an
  interrupting act and an invitation to a shared action that the partner's driver accepts from its own stream; three
  meetups where all fifty act within 1 s and read twice within the next 2 s), the schedule, all-attempt accounting and the clock check. `workload.test.mjs` pins it.
- `meetup/meetup.mjs`: the runner. `meetup/report.mjs`: `REPORT.md` against #443's initial objectives.

```bash
pnpm --filter @sim/web build && pnpm build:viewer      # once per checkout: the worlds refuse genesis without them
node tools/bench/capacity/meetup/meetup.mjs --profile even,meetup [--repeats 2] [--browser] [--short] [--quiet-host] \
  [--host-class <neutral label>] [--port 4400] [--out .local/bench/meetup/<name>]
```

Per run (about 35 min; `--short` about 6 min): boot and join (timed, not measured), warm-up, 5 min quiet-but-living
(streams and viewers held, no commands), 20 min activity. The schedule is fixed before the run from the seed; a Soul
sends one call at a time in schedule order; a call sent more than 1 s late is **overdue** and a call still queued when
the window closes is **unissued**; neither is dropped from the totals. End-to-end latency runs from the scheduled time
(queueing, Retry-After waits and backoff included); answered-only time is diagnostic. Action start and receipt delivery
come from each Soul's own event stream (`/v1/edge/wait`, `receipt.*` events with server tick and time); travel and
activity duration is its own column. The clock check samples every world's `/healthz` tick each second against
monotonic time at the admin rate in the world's own database; nothing is clipped or reset.

Full clock comes from existing switches only, set on the launcher: `SIM_UNWATCHED_PACE=1`,
`SIM_WORLD_IDLE_EXIT_MIN=0`, `--sleep-ms 0`. The production defaults (quarter pace unwatched, sleep, idle exit) are
#740's subject. Eyes rendering is off: image delivery is not covered here. The run is loopback through the launcher's
proxy with dev auth: TLS, the public proxy, Clerk and the real network are not exercised.

Outputs under `--out`: `receipt.json` (source, seed, schedule sha256, fixture sha256s, configuration, coverage; no
host names, users, home paths or tokens), `ops.jsonl` (one line per issued call), `samples.jsonl`, `result.json`,
`REPORT.md`; `souls/` holds Soul tokens and stays local. Every owned process is stopped at the end (also on Ctrl-C)
and the result records the cleanup. A run without `--quiet-host` is labelled `not-quiet`; no laptop run qualifies.

### Hardware qualification (CW2, #736)

Each run also reads the allocation the worlds live in (`meetup/host.mjs`: the launcher's cgroup v2 `cpu.max`,
cpuset, `cpu.stat` throttling, `memory.max`/`current`/`peak`, swap, PSI, `/proc/stat` steal; Linux only, `unknown`
elsewhere) and each world's main and hottest thread. `meetup/verdict.mjs` turns the runs into `VERDICT.md`:
`passes`, `insufficient resources`, `software bottleneck` or `inconclusive`. Only a complete matrix (both profiles,
two repeats each, distinct repeats, full length) declared `--qualifying-executor --quiet-host`, with a known
allocation, recorded objectives and readable swap, steal and throttling, can pass: evidence that is absent is
unknown, never a pass. `--quiet-host` is the operator's assertion; the bench records load and other Soul processes
but does not check them. The manual `capacity-qualify` workflow (#840) checks them before it passes the flag. A
missed objective with spare allocation, or a hot world thread at ≥ 0.9 core, is a software bottleneck whatever the
host. On the executor (the operator's private record holds the host binding; nothing here names it):

```bash
# quiet window; the launcher and its worlds inside the slice, the driver outside it
node tools/bench/capacity/meetup/meetup.mjs --profile even,meetup --repeats 2 --browser \
  --slice "systemd-run --quiet --scope -p AllowedCPUs=<cpus> -p MemoryMax=<limit> --uid=<bench user> --gid=<bench group>" \
  --qualifying-executor --quiet-host --host-class production-class --out <scratch>/meetup-<sha>
```

The report states whether the driver shares the worlds' cgroup (it should not when `--slice` is used). With `--uid`, run the driver as
root (so `systemd-run` may drop to the bench user) and give that user write access to `--out`.

### Comparing a run with the baseline (CW8, #947)

`meetup/compare.mjs` puts two downloaded `capacity-qualify` artifacts side by side, for example a confirmation run against
the CW2 baseline:

```bash
gh run download <run> --repo genekogan/souls -D .local/qualify/<run>
node tools/bench/capacity/meetup/compare.mjs .local/qualify/<baseline>/capacity-qualify-<baseline> .local/qualify/<run>/capacity-qualify-<run> [--out <file>]
```

- **What it shows:** both verdicts, then per profile:
  - the headline cells as repeat ranges;
  - each objective per repeat: `fixed`, `meets`, `still failing`, `regressed`, `new, meets`, `new, misses` or `missing`;
  - per world: met, the hottest core, the loop p99 and the queue.
- **When it calls a direction:** only when the two repeat ranges do not overlap.
- **Missing values:** a cell, repeat or world missing on either side is shown as missing, never as better. A value that only some repeats have is `partial`, and gets no direction.
- **Both verdicts:** they are printed with their reasons.
- **Changed conditions:** a change in host class, quiet, short, slice or limits is listed as not like for like. A condition that neither side recorded is listed as not compared, not as a match.

## Recorded baseline (2026-10-31, before the server-reliability fixes)

Fixture: the compact Eden 2026 copy, sha256 `d0921000a7ef…`, heap cap 768 MB unless noted; two repeats per arm, shown
as ranges. The per-run reports were kept outside the repo.

**eden2 slice (gates; main cdd3eece3, Soul CLI 2.4.0, CPUs 6–7, 4 GB):** every arm FAILS and every arm wedges.

| arm | tick service (bar) | healthz p99 ms (bar) | act / read p99 s (bar) | heap % cap (bar) | longest healthz gap s | other |
|---|---|---|---|---|---|---|
| n1 | 0.84–0.96 (≥ 0.95) | 1172–5000 (≤ 200) | 1.5 / 19.2 (≤ 1) | 72 | 3.5–72.7 | |
| n6 | 0.05–0.06 (≥ 0.8) | 5000 (≤ 1000) | 42.3 / 43.8 (≤ 3) | 80 (≤ 60) | 45–46 | |
| n12 | 0.04–0.08 (≥ 0.5) | 5000 (≤ 1000) | 89.9 / 57.5 (≤ 5) | 85 (≤ 70) | 95–102 | timeouts 18–19 |
| n24 | 0.07–0.11 | 5000 | 78.9 / 59.8 | 95 | 90–113 | timeouts 25–46 (bar 0) |
| incident | 0.07–0.12 | 5000 | 42.9 / 59.5 | 81 | 44–55 | 4 listeners per Soul (bar 1) |
| hostile | 0.02 | 5000 | — | 77 | 49 | 0 designed refusals; 185–193 of ~640 requests failed, p99 30 s |

Marginal cost (M8): 0.021 CPU-s/s idle and 0.024 active per added Soul over an intercept of ~1.0 CPU-s/s with no Souls
(the world alone takes a core); RSS +9.4 MB per Soul over 862 MB.

**Laptop, direct (indicative; M3 Max, whole host):** same shape, later: n1/n6 do not wedge (gaps ≤ 27 s), n12 and up
wedge (25–34 s), hostile 114–122 s; healthz p99 5000 ms in every arm; tick service 0.72–0.78 at n1, 0.07–0.16 at n12.

**Laptop, through the launcher (indicative; heap 2048 MB; main cdd3eece3 + CLI 2.4.0 against R1 07892deaf + CLI 2.5.0,
paired, two repeats each):**

| arm | quantity | main | R1 |
|---|---|---|---|
| incident | tick service | 0.36 / 0.51 | 0.99 / 0.99 |
| incident | healthz p99 ms | 5000 / 5000 | 897 / 482 |
| incident | act / read p99 s | 14.6 / 19.2 · 10.7 / 12.4 | 1.7 / 1.4 · 0.7 / 2.6 |
| incident | longest gap s | 17.4 / 25.2 | 3.3 / 2.8 |
| incident | listeners per Soul | 2 / 3 (superseded 96 / 92) | 1 / 1 (second listen exits "already" 48 / 48) |
| hostile | requests (ok) | 1471 (1356) / 824 (523) | 55983 (1763) / 152740 (2446) |
| hostile | launcher refusals | none (no ceilings) | world.busy 302 / 428, account.rate 1150 / 1804, client.rate 52645 / 148034 |
| hostile | 5xx · failed · p99 | 50 · 65 · 30 s / 182 · 119 · 30 s | 63 · 63 · 3.2 s / 1 · 27 · 2.0 s |
| hostile | tick service · longest gap s | 0.015 · 91 / — · 260 | 0.021 · 57 / 0.021 · 62 |

Reading: R1's polite client and Soul API ceilings fix the incident arm outright (one listener, tick ≈ 1, no wedge) and
turn the hostile flood into fast, designed refusals, but four instant-retry loops per Soul still wedge the world
(57–62 s gaps): the tick-thread cost is the server lanes' work, and only an eden2 slice run of a fixed head gates.

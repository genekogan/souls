# Telemetry history and the operator report

`tools/world-launcher/telemetry.mjs` (CW4, #738) keeps a bounded local history of the launcher's own metrics and
prints a report for a time range. It is a separate process that reads the launcher's loopback `/__sim/metrics`. That
text is built from each world's `live.json` (see [load contract §4–§5](../architecture/load.md)), so a scrape never
wakes a world, never counts as attention and never makes an agent read. There is no server, query language, exporter
or outside account.

The metrics source mentions an Alloy scraper on the host. Nothing in this repository configures one, so that scraper
is not assumed. If one is configured with adequate retention, use it; this tool is the minimal local alternative.

## Run it

```bash
# beside the launcher, as the launcher's user; the store lives next to the launcher data (telemetry only)
node tools/world-launcher/telemetry.mjs collect --url http://127.0.0.1:<launcher port>/__sim/metrics \
  --dir <launcher data>/telemetry [--every 15] [--fine-days 7] [--rollup-days 90] [--max-bytes 2147483648]

node tools/world-launcher/telemetry.mjs report --dir <launcher data>/telemetry --range 24h        # text
node tools/world-launcher/telemetry.mjs report --dir <launcher data>/telemetry --range 7d --json  # sim-telemetry-report/1
node tools/world-launcher/telemetry.mjs close  --dir <launcher data>/telemetry                    # roll up and prune now
```

`--url` must be a loopback address. The launcher answers `/__sim/metrics` to direct loopback requests only. The
collector stops cleanly on SIGINT/SIGTERM, and on restart it continues the current hour, recording the restart as a
boundary.

`collect` saves its options (cadence, retention, cap) in `state.json`, and `report` and `close` use them. Do not run
`close` while a collector is writing to the same directory.

## What is kept

| | |
|---|---|
| `fine/<YYYY-MM-DDTHH>.jsonl[.gz]` | every scrape (default every 15 s), kept 7 days. Sparse: each line holds only the series that changed; a series that disappears is marked absent, never 0. Each closed hour is gzipped. |
| `rollup/<YYYY-MM-DD>.jsonl[.gz]` | one line per closed hour: every series reduced, kept 90 days. Each closed day is gzipped. |
| `state.json` | format version, series types, loss counters (`prunedByAge`, `prunedBySize`, `failedWrites`, `skippedLines`), the collector's own RSS |

- A failed scrape is a **gap** with its reason (timeout, refused, HTTP status), never a row of zeros.
- `skewMs` is the collector's clock minus the launcher's `sim_metrics_scrape_timestamp_seconds`.
- Counters are reduced as increases. A value that goes down counts as a restart: the increase restarts from 0 and a
  reset is recorded.
- Quantile gauges (`*_p99_*`) are reduced by their maximum and are never averaged.
- Gauges get min, mean, max, first, last and rise (rise is the sum of upward steps, which gives tick progress).
- Means are taken over answered samples only.
- The hard cap (`--max-bytes`, default 2 GiB) removes the oldest fine hours first, then the oldest rollups, and counts
  each removal.
- Only files inside `--dir` are ever removed. A failed write is counted and the collector carries on; the game never
  waits on telemetry.

Size, measured with a synthetic scrape of 400 registered worlds (20 running): about 7 KB per scrape before gzip. At
15 s that is about 43 MB per day before gzip, well inside the cap.

## The report

The report covers the selected range, coverage and 1h/24h/7d comparisons.

- **Per world:**
  - status share and level shares
  - active and connected Souls
  - sampled tick progress and `ratioAtFullClock` (ticks per second ÷ 20)
  - tick-service range, loop and tick p99 maxima, queue
  - heap, ELU, GC share, `live.json` age
  - restarts, shed and refusal increases
- **Fleet:** worlds running, host memory, client errors, Soul totals.
- **Store:** size and bytes per day.

Ranges up to 2 h are exact from fine samples. Longer ranges are hour-aligned from rollups, so they start at the first
hour's beginning.

Rates (ticks per second, GC share) count only the time between adjacent answered samples. A gap adds neither time nor
steps, while totals such as progress and increases keep every step. A fleet mean weights each world by its share of
the range.

A file that cannot be read, such as a gzip truncated by a crash, is skipped and counted (`unreadableFilesThisReport`).

`ratioAtFullClock` is an indication from 15 s samples. The meetup bench's clock check
(`tools/bench/capacity/meetup`) is the oracle. A world at the unwatched quarter pace shows about 0.25 here.

Fields the launcher does not export yet are listed under `unknown` instead of being shown as 0: actions and reads by
outcome, viewer and connection counts, DB/WAL growth, process CPU and RSS (#737).

## Alerts

`telemetry.mjs alerts` (CW5 S1, #739) evaluates fixed rules over the stored scrapes. The evaluation is
deterministic: the same rows always give the same transitions. There are two ways to run it:

```bash
node tools/world-launcher/telemetry.mjs collect --url ... --dir <d> --alerts [--rules rules.json]   # after every scrape
node tools/world-launcher/telemetry.mjs alerts --dir <d> [--rules rules.json] [--json]              # catch up, e.g. from cron
```

### What it writes

| | |
|---|---|
| `alerts.jsonl` | one line per **transition**, `{t, rule, world?, from, to, value, threshold, what}`. `to` is `firing`, `resolved`, `unknown` or `known`. `value` is `null` when the series is missing, and `"never"` for a telemetry gap with no answered scrape at all. An unchanged state, healthy or not, writes nothing. |
| `alerts-state.json` | the evaluator's windows and last row. A restart neither repeats a transition nor loses one, and healthy rules keep no state. |

Each rule has three windows, which give it hysteresis:

- **Hold window:** the condition must hold for this long before the rule fires. The default is 30 s, which is 3 samples at the 15 s cadence. A condition that holds therefore fires within 60 s.
- **Clear window:** the condition must stay clear for this long before the rule resolves. The default is 60 s.
- **Clear threshold** (optional): a firing rule only counts as clear once its value is back past this threshold.

A running world without a rule's series becomes `unknown` after the hold window, never healthy. A world that is not running is not judged, except for crash loops. Nothing is sent anywhere: delivery and dead-man alerting belong to #461, and a monitor on the same host cannot detect that host failing.

### Rules

| Rule | Scope | Fires when | Clears below |
|---|---|---|---|
| `loop-stall` | world | event-loop delay p99 > 0.25 s | 0.15 s |
| `tick-slow` | world | tick p99 > 0.1 s | 0.075 s |
| `gc-pressure` | world | GC share > 10 % | 5 % |
| `main-thread-busy` | world | ELU > 0.9 | 0.8 |
| `heap-pressure` | world | heap used / limit > 0.85 | 0.8 |
| `queue-stall` | world | oldest queued request > 2 s | 1 s |
| `clock-lag` | world | late ticks > 1 per second (`sim_world_ticks_late_total`, the independent measurement, not the pace-normalized service ratio) | 0.2 per second |
| `refusals` | world | any increase of `sim_world_refused_total` or `sim_world_shed_total` (fires at once; clears after 5 quiet minutes) | — |
| `stale-live` | world | `live.json` older than 30 s (fires at once) | — |
| `crash-loop` | any world | at least 3 non-planned restarts within 10 min (fires at once; clears after 10 min) | — |
| `host-memory` | fleet | host memory available < 1 GiB | 1.5 GiB |
| `telemetry-gap` | collector | no answered scrape for more than 2.5 × the cadence. This covers failed scrapes, a silent collector seen by a later `alerts` run, and an empty store. | — |

### Changing the rules

`rules.json` overrides rules by id: `{"rules": {"loop-stall": {"threshold": 0.5, "holdMs": 60000}, "host-memory": {"off": true}}}`. The keys an override can set are `threshold`, `clearAt`, `holdMs`, `clearMs` and `off`. An unknown id is refused.

### Not covered yet

The launcher does not export process CPU, process RSS, cgroup CPU or memory pressure, or disk and WAL growth. These are listed as not exported (unknown) in every `alerts` output, and none of them are assumed healthy.

### Cost

With 400 registered worlds (20 running), evaluation after each scrape takes 40 ms at the median and at most 80 ms at the end of an hour. That is under 0.6 % of one core at the 15 s cadence. The state file is about 40 KB.

## Cost and the context packet

Two commands, `cost` and `packet` (CW5 S2, #739), answer what is active, what it costs, where capacity is tight and
what to do next. They read the store, the saved alert state and an optional cost file, and they write nothing.

```bash
node tools/world-launcher/telemetry.mjs cost   --dir <d> --cost <private>/cost.json [--range 24h]   # JSON
node tools/world-launcher/telemetry.mjs packet --dir <d> [--cost <private>/cost.json] [--bench <capacity-qualify dir>] [--range 24h] [--json]
```

### The cost file

The cost file (`sim-cost/1`) is the operator's **private** record. Keep it next to the launcher data, never in the
repository. Rates, invoices and account mappings do not belong in public artifacts. The format is in
`tools/world-launcher/telemetry/cost.example.json`, which holds placeholder numbers only. The file has a currency, a
billing period and a list of items. Each item has:

- a `kind`: compute, storage, backups, bandwidth, cdn, auth, model, render or other;
- a `payer`: `platform` (the default) or `owner`;
- a `basis`, with its numbers:
  - `fixed` takes an `amount` per billing period;
  - `metered` takes a `rate` per `unit` and the period's `usage`;
- the rate's `source`, and optionally its `sourceDate`;
- optionally, `billed` entries: actual invoice amounts, each for a named period.

An unknown amount, rate or usage is written as `null`. A malformed file is refused, and the error names the field.

### What `cost` reports

`cost` gives three numbers and never adds them together:

- **billed:** the invoice amounts whose periods overlap the window, listed with those periods, plus how many items
  have any invoice recorded at all. With no invoice recorded, the amount is null, not 0.
- **estimated:** the configured rates prorated over the part of the window inside the billing period, and projected
  over the whole period. Each is given as `{low, high}`. While any rate or usage is unknown, `high` is `null` (open)
  and the unknown items are listed.
- **allocated:** the window's known estimate, split by a stated rule:
  - covered time is split across worlds by their running world-hours (status share × covered time);
  - covered time with no world running is shared fixed overhead;
  - time without telemetry stays unallocated.

Fixed rent stays fixed when activity drops. An allocated saving is not an invoice saving.

Owner-paid costs, in particular agents' inference at the edge, are listed under `external`. They are never part of
platform spend, and their amount is `unknown` unless one is given.

### The context packet

`packet` prints ten lines (or JSON, `sim-context-packet/1`):

- **source:** the launcher build label and the tools commit;
- **window and coverage**;
- **what is active:** worlds and Souls;
- **the top bottleneck:** firing alerts first, in rule order; otherwise the world with the worst loop and tick p99;
- **the alert counts**;
- **cost provenance:** billed, the estimate ranges, unknowns, rate sources and dates, and external costs;
- **headroom:** host memory minimum; CPU is unknown, because it is not exported; and the capacity qualification. That is
  the #736 bench verdict when `--bench` names a capacity-qualify artifact directory. Only a qualifying `passes` reads
  as qualified, and without `--bench` it says "unqualified (no capacity verdict given)";
- **the next practical decision**, by a fixed rule, taking the first that applies:
  1. evaluate the alerts first;
  2. restore telemetry coverage (below 90 %, or a telemetry gap);
  3. investigate the firing rule before any hardware change;
  4. export the missing series;
  5. review memory if the host went below 1.5 GiB;
  6. otherwise, no capacity action.

The packet holds world slugs and numbers only: no Soul names, messages or user content. It involves no model, UI or
vendor account.

## Unit costs and scenarios

Two more commands (CW5 S3, #739) turn the cost file and measured activity into unit costs and world-count projections.

```bash
node tools/world-launcher/telemetry.mjs units     --dir <d> --cost <private>/cost.json [--range 24h]          # JSON
node tools/world-launcher/telemetry.mjs scenarios --cost <private>/cost.json --bench <capacity-qualify dir> \
  [--worlds 10,50,100,200,400] [--json]
```

`units` divides one numerator by three denominators and prints each of them:

- **the numerator:** the window estimate from `cost`, over the covered part of the window. It includes every platform
  item. Shared fixed overhead is not dropped: its share is printed. An open high end stays open.
- **per world-hour:** running world-hours (status share × covered time).
- **per active-Soul-hour:** for each world, mean `sim_world_active_souls` × that world's covered hours. Souls are not
  humans.
- **per accepted act:** the increase of `sim_world_requests_total{class="act",outcome="completed"}`, which counts act
  requests answered below 400, not finished activities. Without that series (#737 S2) the result is unknown, never 0.

A denominator that is not exported is unknown, with the reason. One that is zero has no unit cost. Fixed rent does not
fall when activity does, so a lower unit cost at higher activity is not an invoice saving.

`scenarios` projects resources and a monthly platform total for each world count:

- **The per-world footprint** is measured. It comes from the capacity-qualify artifact's runs (`*/result.json`): the
  mean over runs of the fleet's mean active and quiet CPU cores and RSS per world, with the largest single world
  alongside. RSS is each world's maximum, so the sums are upper bounds. Quiet is the cost of a world that ticks with
  nobody acting, which is the continuous-world baseline.
- **The host count** keeps 30 % headroom. It uses the optional `host: {cores, memGiB}` on the fixed compute item of
  the cost file. Each host's usable share is 70 % of its shape, less one launcher. Without a host shape, hosts and
  compute cost are unknown.
- **The monthly total** is hosts × the compute amount, plus the other platform items unchanged. Metered items are
  listed as not scaled, because nothing ties their usage to the number of worlds. Owner-paid items stay external.
- **Every row carries the bench verdict.** Only a qualifying `passes` lifts the "unqualified" label. A scenario is a
  cost projection, not a capacity. More hosts pack independent worlds, but they do not fix a world whose main thread
  is the bottleneck. The #736 verdict on run 41915686991 is exactly that case.

Real rates stay in the operator's private cost file. `cost.example.json` shows the host shape with placeholder
numbers.

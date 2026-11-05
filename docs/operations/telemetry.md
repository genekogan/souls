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
| `clock-behind` | world | ticks run ÷ ticks due < 0.98 over a trailing 60 s window (see below) | 0.99 |
| `clock-paused` | world | the clock is `paused` or `unavailable` for 60 s (`sim_world_clock_state`) | the clock runs |
| `clock-lag` | world | late ticks > 1 per second (`sim_world_ticks_late_total`: ticks whose own run exceeded 50 ms) | 0.2 per second |
| `refusals` | world | any increase of `sim_world_refused_total` or `sim_world_shed_total` (fires at once; clears after 5 quiet minutes) | — |
| `stale-live` | world | `live.json` older than 30 s (fires at once) | — |
| `crash-loop` | any world | at least 3 non-planned restarts within 10 min (fires at once; clears after 10 min) | — |
| `host-memory` | fleet | host memory available < 1 GiB | 1.5 GiB |
| `telemetry-gap` | collector | no answered scrape for more than 2.5 × the cadence. This covers failed scrapes, a silent collector seen by a later `alerts` run, and an empty store. | — |

### The clock rules

`clock-behind` measures the full clock independently of attention and load. It does not use the pace-normalized `sim_world_tick_service_ratio`, and it does not use the late-tick count: a world whose clock stops runs no ticks, so it never counts a late one.

- **The ratio.** Over the trailing 60 s, actual ÷ due = Δ`sim_world_tick` ÷ (Δ`sim_world_tick_sampled_seconds` × 20 × `sim_world_clock_admin_rate` × `sim_world_attention_pace`). It takes the window's lowest target rate, so a rate change never fabricates lag.
- **Uncertainty.** The tick and its sample time are read together, so the sampling uncertainty is ±1 tick per endpoint: ±0.17 % over 60 s, and ±0.67 % over the first 15 s.
- **A stuck main thread.** When the main thread has not turned for more than 2 s, `sim_world_loop_last_turn_age_seconds` beyond those 2 s is added to the elapsed time. A frozen sample therefore counts as deficit, never as a healthy clock.
- **Resets.** A scrape gap, a tick that goes backwards, a world that is not running (restarts are judged by `crash-loop`) or a paused clock resets the window. A missing tick, sample time or admin rate gives `unknown`.
- **Pace.** On a continuous world (#740) or a watched one, the attention pace is 1, so this is exactly the full clock. An unwatched world that runs at its attention pace is following policy, not lagging. The report's full-clock ratio shows that dilation.

`clock-lag` keeps the id and meaning it had in S1 (late ticks), so an existing `rules.json` override for it still applies to that rule. It cannot see a stopped clock, because a stopped world runs no late ticks; that is why `clock-behind` exists.

`clock-paused` covers the time a running world's clock does not run, which `clock-behind` does not count. The series cannot tell an admin pause from an engine-fault pause (#447), so both fire.

### Changing the rules

`rules.json` overrides rules by id: `{"rules": {"loop-stall": {"threshold": 0.5, "holdMs": 60000}, "host-memory": {"off": true}}}`. The keys an override can set are `threshold`, `clearAt`, `holdMs`, `clearMs` and `off`. An unknown id is refused.

### Not covered yet

Every `alerts` output lists two kinds of input, judged from the rows it read. Neither is assumed healthy.

- **Not exported (unknown):** inputs with no series in those rows. Nothing exports cgroup CPU or memory pressure. Process CPU, process RSS and DB/WAL size are exported from #737 S2 on; before that they are listed here too.
- **Exported, no rule yet:** inputs that are present but that no rule judges: process CPU, process RSS, and DB/WAL growth.

### Cost

With 400 registered worlds (20 running), evaluation after each scrape takes 40 ms at the median and at most 80 ms at the end of an hour. That is under 0.6 % of one core at the 15 s cadence. The state file is about 40 KB.

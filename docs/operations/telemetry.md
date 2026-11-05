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

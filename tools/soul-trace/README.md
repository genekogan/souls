# soul-trace: opt-in local control-episode evidence (#733)

A passive trace of the thin Soul CLI (`tools/world-launcher/soul/eden.mjs`), the default control path the world
serves: the owner's own chat runs one CLI process per command and a background `listen`. The trace shows where a
short command or an interrupted activity waited. It is a diagnostic, not a speed claim, and a reconstruction, not a
replay. Path selection and the inventory behind it: #732. Correlation and clock meaning: #592. Inspector: #624.

## Use

```bash
SOUL_TRACE_FILE=/abs/path/trace.jsonl node --import <repo>/tools/soul-trace/tap.mjs eden.mjs <command> …
node tools/soul-trace/readout.mjs trace.jsonl          # text timeline
node tools/soul-trace/readout.mjs trace.jsonl --json   # same reconstruction as JSON
```

Off by default: without `--import` nothing is loaded; with it but no `SOUL_TRACE_FILE`, nothing is installed. The
served CLI bytes are unchanged. `SOUL_TRACE_RUN` / `SOUL_TRACE_SEAT` (opaque `[A-Za-z0-9._:-]{1,100}` ids) are
copied onto each process-start record for Soul Runs (#749); the tap never invents or interprets them.

## Contract `soul-trace/1`

One JSON object per line. Every record: `v`, `kind`, `proc` (random per CLI process), `seq` (per process,
from 1), `at` (local wall ms), `mono` (process-monotonic ms since start).

| kind | fields |
|---|---|
| `proc.start` | `cli`, `cliSha256` (the running CLI's bytes), `command`, `argBytes`, `node`, `timeOrigin`, `run?`, `seat?`, `clocks`, `omitted` |
| `http` | `method`, `route` (path only; no origin, world prefix or query values), `op` (the CLI's idempotency key = logical operation), `attempt`, `startMono`, `status` (0 = transport error), `headMs`, `durationMs`, `bytes`, `facts` |
| `proc.end` | `exitCode`, `durationMs`, `stats` {records, dropped, truncated, sinkFailures, inFlightAtExit, bodiesPendingAtExit, bodyOmitted} |

`facts` is a whitelist: `accepted`, `code`, `receipt` {id, soulId, capability, phase, code, acceptedTick,
startedTick, endedTick}, `for`, `channel`, `cursor`, `queued`, `messages` [{id, sentAt, state}], `events` (receipt
facts only). Never recorded: owner or speech text, observation content, reasons, authorization, hosts, query values.

Clock domains: `sentAt` server wall; receipt ticks world tick (authoritative for accepted/started/ended); `at` local
wall (display); `mono` exact only inside one process. The readout labels cross-domain intervals approximate and
never subtracts them as exact latency. The chat host's own work is opaque: the time between a delivery and the next
command is shown as unattributed host time.

## Readout

Episodes are derived, not stored: anchored on an owner message id, with acts linked only by the world's `for` link;
an act without one has origin `unknown` (nothing is joined by nearby time). Reported anomalies: unparsed lines,
duplicate and reordered records, missing records or start, unclosed processes (killed, restarted, still running or
a lost last batch), listener restarts, capture loss, a receipt phase seen after its terminal phase, and receipts with
no terminal phase in the trace.

## Bounds and failure

Records queue in memory (≤2000 records, ≤512 KiB, ≤8 KiB each) and are appended asynchronously, one batch in flight;
the remainder (≤64 KiB) is written synchronously at process exit. A slow, full or failing sink never delays a
request or changes stdout, stderr, exit code or request order; it disables itself and counts what it dropped. A
batch still in flight when the process exits may be lost and shows as `inFlightAtExit` and missing records.
Response bodies are read from a clone for JSON responses ≤1 MiB; others record headers only.

Not covered yet: the managed runtime (`tools/soul-runtime`, which has its own `--evidence` recorder) and the legacy
live CLI; host turn/tool internals; server-side joins; any upload.

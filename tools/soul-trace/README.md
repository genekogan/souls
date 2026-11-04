# soul-trace: opt-in local control-episode evidence (#733)

A passive trace of the thin Soul CLI (`tools/world-launcher/soul/eden.mjs`), the default control path the world
serves: the owner's own chat runs one CLI process per command and a background `listen`. The trace shows where a
short command or an interrupted activity waited. It is a diagnostic, not a speed claim, and a reconstruction, not a
replay. Path selection and the inventory behind it: #732. Correlation and clock meaning: #592. Inspector: #624 (below).

## Use

```bash
SOUL_TRACE_FILE=/abs/path/trace.jsonl node --import <repo>/tools/soul-trace/tap.mjs eden.mjs <command> …
node tools/soul-trace/readout.mjs trace.jsonl          # text timeline
node tools/soul-trace/readout.mjs trace.jsonl --json   # same reconstruction as JSON
```

Off by default: without `--import` nothing is loaded; with it but no `SOUL_TRACE_FILE`, nothing is installed. The
served CLI bytes are unchanged. `SOUL_TRACE_RUN` / `SOUL_TRACE_SEAT` (opaque `[A-Za-z0-9._:-]{1,100}` ids) are
copied onto each process-start record for Soul Runs (#749); the tap never invents or interprets them.

## Host boundaries (#733 S2)

The CLI only sees its own process. The chat host that runs it can opt in to recording its side of the gap
between a delivery and the next command, in the same file:

```js
import {hostRecorder} from '<repo>/tools/soul-trace/host.mjs';
const h = hostRecorder({file: trace});
h.turn('start', {turn: 't1', for: messageId});        // the turn that answers this owner message
h.tool('start', {turn: 't1', tool: 'c1'});            // the tool call that will run a CLI command
h.spawn({tool: 'c1'});                                // just before spawning it, with h.env({turn: 't1', tool: 'c1'})
h.tool('end', {tool: 'c1', exitCode}); h.turn('end', {turn: 't1'});
```

or, from a hook that runs as its own process, `SOUL_TRACE_FILE=… node tools/soul-trace/host.mjs tool start --turn t1
--tool c1` (always exits 0). The spawned CLI copies `SOUL_TRACE_TURN` / `SOUL_TRACE_TOOL` onto its `proc.start`.
Ids are opaque refs chosen by the host; no prompt, command text, paths or output are recorded. Without a recorder
nothing changes.

The readout links turn → message by `for`, tool → turn and process → tool by those ids only, and splits the gap
into: delivery → turn start (host picks it up), turn start → tool call (host reasoning), tool call → spawn (tool
runner), spawn → process origin (exec; Node's `performance.timeOrigin`), origin → tap start (Node boot), tap start →
first request (CLI). Each interval names its clock: process-monotonic when both ends are in one process, else local
wall (≈). A missing boundary leaves an `unattributed` interval; a turn already running before the delivery is
reported, not subtracted. When no tool call links a command, the rest of the gap up to the first command (found
by time, as without host records) is shown as one unattributed interval. Only the earliest turn naming a message
and the tool calls naming that turn are attached; a later turn or a tool call without a turn is ignored. Intervals
that come out negative across clocks are flagged `host-clock-skew`.

The recorder creates the trace file if it is missing (the tap only appends to a regular file or a new one too) and
refuses symlinks, FIFOs and devices. By default its appends are synchronous in the host's process, so a hung disk
would block the host's call; it disables itself on the first error but cannot interrupt a write that never returns.
`hostRecorder({file, queued: true})` (for a long-lived host) uses the tap's bounded asynchronous queue
(`sink.mjs`) instead; call `close()` or `await drain()` before exit. Its own
cost was not measured separately in A5. Not yet: an adapter for a particular host's hooks (Claude Code hooks cannot pass a tool id
into the spawned command without rewriting it).

## Managed runtime (#733 S2)

`tools/soul-runtime/run.mjs` writes the same host records when `SOUL_TRACE_FILE` is set
(`tools/soul-runtime/trace.mjs`); load the tap on it too (`node --import tools/soul-trace/tap.mjs
tools/soul-runtime/run.mjs …`). A turn starts at the runtime's `begin` request and names, with `for`, the first
owner message delivered with it; it ends at `turn/completed`. Tool items (`item/started` / `item/completed` of tool
types) are `host.tool` records of their turn. The runtime runs no CLI process, so a managed episode reads delivery →
turn start → turn end ("host turn to its decision"); tool items are counted, not placed on the gap. Limits: an owner
message delivered by `steer` into a running turn is not linked to it (one `for` per turn); a managed act carries no
`for`, so the readout shows it with unknown origin; the tap's 2000-record cap per process bounds a long run.

## Inspector (#624)

```bash
node tools/soul-trace/inspect.mjs trace.jsonl [--port N]   # prints http://127.0.0.1:N/?token=…
```

A read-only page over the same reconstruction `readout.mjs --json` prints: episodes with send/delivery times, the
unattributed host gap before the first command, each act's attempts and receipt ticks, acts with unknown origin,
anomalies and processes. Filter by any text; each episode expands to its bounded JSON. It polls every 1.5 s and
re-reads the file only when its size or mtime changed; traces over 16 MiB are refused.

It only reads the trace file: no world calls, no runner or listener ownership, no write or control endpoint.
Access: bound to 127.0.0.1; exact `Host` (refuses DNS rebinding), cross-site or foreign `Origin` refused; the printed
per-run token is exchanged for an `HttpOnly; SameSite=Strict` cookie and dropped from the address bar; nonce CSP,
`no-store`, `nosniff`, `frame-ancestors 'none'`. Every trace string is placed with text nodes, never as markup.
Stop it with Ctrl-C; the trace and the world are unaffected.
Limit: the session cookie is the bearer token, and cookies ignore ports, so another server on 127.0.0.1 that the same
browser visits would receive it (any local process could read the trace file anyway).

## Contract `soul-trace/1`

One JSON object per line. Every record: `v`, `kind`, `proc` (random per CLI process), `seq` (per process,
from 1), `at` (local wall ms), `mono` (process-monotonic ms since start).

| kind | fields |
|---|---|
| `proc.start` | `cli`, `cliSha256` (the running CLI's bytes), `command`, `argBytes`, `node`, `timeOrigin`, `run?`, `seat?`, `turn?`, `tool?`, `clocks`, `omitted` |
| `http` | `method`, `route` (path only; no origin, world prefix or query values), `op` (the CLI's idempotency key = logical operation), `attempt`, `startMono`, `status` (0 = transport error), `headMs`, `durationMs`, `bytes`, `facts` |
| `host.turn` / `host.tool` / `host.spawn` | written by `host.mjs`, not the CLI: `phase` (start/end), `turn`, `tool`, `for`, `exitCode`; `proc` is the recorder (`host-…`) |
| `proc.end` | `exitCode`, `durationMs`, `stats` {records, dropped, truncated, sinkFailures, inFlightAtExit, bodiesPendingAtExit, bodyOmitted} |

`facts` is a whitelist: `accepted`, `code`, `receipt` {id, soulId, capability, phase, code, acceptedTick,
startedTick, endedTick}, `for`, `channel`, `cursor`, `queued`, `messages` [{id, sentAt, state}], `events` (receipt
facts only). Never recorded: owner or speech text, observation content, reasons, authorization, hosts, query values.

Clock domains: `sentAt` server wall; receipt ticks world tick (authoritative for accepted/started/ended); `at` local
wall (display); `mono` exact only inside one process. The readout labels cross-domain intervals approximate and
never subtracts them as exact latency. Without host records the chat host's work is opaque: the time between a delivery
and the next command is shown as unattributed host time (see Host boundaries).

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

The queue is `sink.mjs`, shared by the tap, the queued host recorder and the managed runtime's `--evidence`
recorder.

Not covered yet: the legacy live CLI; a host-specific hooks adapter; server-side joins; any upload.

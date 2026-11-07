# Soul Runs

One owned lifecycle around an existing playtest scenario: validate, preflight, run through the scenario runner
(`playtest.mjs` `cmdRun`), release what the run created, apply retention and write a terminal receipt. Tranche #749;
SR1 (#750) is the lifecycle; SR2 (#751) adds world sources, setup and composed casts; SR3 (#752) attaches opt-in
control diagnostics; SR4 (#753) evaluates completed runs offline and compares repeats; SR5 (#754) records cameras and
packages a run's evidence (see Recording).

```bash
node tools/playtest/runs/run.mjs validate tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    --scenario tools/playtest/scenarios/unified-codex-smoke.json --cast none --port 4311 --duration 30
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio.json   # three scripted-owner Souls, one redirection
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/garden-setup.json  # another world, a setup batch, another cast
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio-direct.json  # a directed cast: swarm director, scripted-owner seats
node tools/playtest/runs/run.mjs cleanup  .local/soul-runs/<run> --world-data --controller-state
node tools/playtest/runs/run.mjs evaluate .local/soul-runs/<run> --question tools/playtest/runs/questions/redirect-honoured.mjs
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio-recorded.json   # the trio, recorded: wide, free and follow cameras
node tools/playtest/runs/run.mjs preview  .local/soul-runs/<run> --camera bo --from 10 --to 40   # a labelled excerpt, never full proof
node tools/playtest/runs/run.mjs preview  .local/soul-runs/<run> --camera bo --auto              # the same, starting at the run's first act
node tools/playtest/runs/run.mjs package  .local/soul-runs/<run> --select wide --select bo      # local index + selected projection
node tools/playtest/runs/run.mjs compare  .local/soul-runs/<run-a> .local/soul-runs/<run-b> [--out dir] [--md]
```

Exit codes: 0 completed (or valid), 1 failed, 2 refused, 124 stopped at `limits.maxWallSec`, 130 cancelled.
`Ctrl-C` (SIGINT) or SIGTERM cancels: owned resources are released with bounded waits, then the receipt is written.
A second signal exits at once without waiting.

## Specification (version 1)

A spec references a scenario; it does not copy it. Only the fields below exist. An ad hoc run passes the same fields as
flags (`--scenario`, `--cast`, `--port`, `--duration`, `--name`).

| Field | Default | Meaning |
|---|---|---|
| `soulRun` | required, `1` | Spec version. Anything else is refused. |
| `scenario` | required | Path to an existing scenario JSON, relative to the spec file, the working directory or the repo. |
| `name` | scenario name | Run name in the run directory. |
| `cast` | `scenario` | `scenario` runs its seats; `none` removes seats, god and their script events (world, director, observer and review only); an object `{seats, script}` replaces the scenario's seats and/or scripted direction, each in the scenario's own format (see Composed casts). |
| `world.port`, `world.slug` | scenario's | Use a free port; a busy port is refused, never taken over. |
| `world.timeOfDay`, `world.timeScale` | `12`, `0` | The world's time of day (hours 0-24, `"HH:MM"`, `"7pm"`) and clock speed (world hours per real hour; `0` pauses it), set through the god env route (`POST /v1/god/env` as the dev owner) right after provision, before any seat or camera, so every clip of the run is by day. `"keep"` leaves the world's own clock (06:00 at boot, one world day per real hour). The receipt's `worldTime` has what was asked and the clock the world reported; a clock that could not be set is recorded there and the run goes on. |
| `world.genesis` or `world.snapshot` | scenario's | World source: a genesis template or a frozen compiler snapshot (`arena/snapshot-seed.mjs`), a path under the server root. Its sha256 is in the receipt (`spec.effective.world.source`). |
| `setup` | none | `{batches: [file or {id, ops, note}], maxWallSec: 120}`: god-edit batches applied after provision and before any seat (see Setup). |
| `durationSec` | scenario's | Play duration override. |
| `observer` | `{check: true, required: false, cameras: null, timeoutMs: 60000, mode: "cameras", record: null, recordSize: "compact", recordStart: "arrival", freeComposition: null}` | `mode`: `cameras` (browser cameras, the default), `passive` (world-truth evidence packs, no browser) or `off`. Bounded observer check (import plus one browser launch and close) in `cameras` mode; failure is recorded and cameras are disabled; `required: true` fails the start instead. `cameras`: `wide` and/or `free` beside the per-seat follow cameras. `record`: `true` or camera names (`wide`, `free`, `follow` for every seat, or a seat id). `recordSize`: `compact`, `viewport` or `{width, height}` (needs `record`). `recordStart`: `arrival` or `load`. See Recording. |
| `limits` | `{maxWallSec: 1800, maxControllers: 4, cleanupWaitMs: 15000}` | Hard wall limit for the whole run, controller count, per-resource release wait. |
| `controllers.allowLiveModels` | `false` | A scenario whose seats, persona director or model review need claude/codex is refused unless this is `true`. Set it only with explicit authorization for live models. |
| `diagnostics` | none (off) | `{trace: true | [seat ids]}`: passive soul-trace capture for those seats (see Diagnostics). |
| `evaluation` | none | `{questions: [file]}`: question scorers predeclared before the run (see Evaluation); each is hashed into the effective spec. |
| `retention` | `{worldData: "keep", controllerState: "keep"}` | `delete` applies only after a completed run with clean cleanup. Failed and cancelled runs keep everything. |

Refusals (`status: "refused"`) happen before any directory or process exists: unknown version or field, unsupported
cast, non-dev world, draft measurement fixture, live controllers without opt-in, too many controllers, missing server
files or web build, busy port, and the scenario runner's own preflight (providers, quota, machine gate). `validate`
applies the same preflight as `start`; `start` runs it once and hands the result to the scenario runner.

## What a run writes

`.local/soul-runs/<stamp>-<name>/` (or `--out`; `SIM_SCRATCH` moves `.local`):

- `run-receipt.json`: the terminal receipt. `status` is `running` until the end, so a crash never reads as success.
  It records the effective spec and its hash, the scenario path and hash, the source (`source.serverRoot` and
  `source.tools`, each a commit and uncommitted tracked-file count; the tools checkout is the one whose runner,
  adapters and director ran, often not the server root; top-level `source.commit` stays the server root's),
  Node version, controllers (adapter, model, effort), preflight checks, observer check, every resource with its owner
  and release state, retention, cost (`wallMs`, `executeMs`, `lifecycleOverheadMs`, runner CPU and max RSS, run
  directory bytes) and the scenario runner's evidence (receipts, report, build, CLI and skill versions, tick validity).
- `ledger.jsonl`: one line per `own`, `borrow` and `release`.
- `spec.effective.json`, `scenario.effective.json`: exactly what ran.
- `playtest/`: the scenario runner's own run directory, unchanged in layout (receipts, world.json, evidence, REPORT.md).

## Composed casts and the scripted-owner adapter

`cast.seats` uses the scenario seat format: `id` (unique; one controller per Soul), `soulName`, `adapter`, `model`,
`effort`, `persona`, `wake`, and for `adapter: "scripted-owner"` a `script`. `limits.maxControllers` bounds the count;
live adapters still need `controllers.allowLiveModels`. `cast.script` uses the scripted director's entries (`seat`,
`atSec`, `channel` card|chat, `text`, `budgetSec`); `seat: "*"` is a broadcast the director delivers to every seat, each
on its own record. Use `director.sequential: false` (in the scenario) when a later entry must reach a seat while an
earlier request is still open, as a mid-activity redirection does. An entry with `after: "result"` waits for that
seat's own open requests to close and goes as soon as they have (`atSec` is then the earliest it can go), so direction
follows results instead of a fixed clock (#888: the hamlet trio's "Say hello" follows each Soul's arrival, and the run
ends when the last request closes). The scripted director has no pause or resume: an
entry with `command` is refused at validation; end a run by cancelling it.

`scripted-owner` (`arena/adapters/scripted-owner.mjs`) is a model-free seat adapter: it plays a Soul only through the
world's served `eden.mjs` in the seat folder. Onboarding fetches the CLI from the world and runs `register`, `create` and
`status`; owner cards reach it through the harness wake loop's `listen`; it answers each with `ack`, the matching rule's
`eden.mjs` steps and `result done|failed` from those steps' real outcome. A `--wait` step counts as done only when its
receipt completed or the world shows that receipt's activity under way; output without a readable receipt (the brief
form drops it past 600 characters) is a failure, never a claimed success. Rules are matched in order by a
case-insensitive regular expression on the card text; `close: "open"` leaves a request open while its activity
continues, and `supersede` closes requests still open as failed when a later rule fires (an owner redirection). It has
no provider and no cost, and its transcript renders like a model seat's. Each CLI output is kept whole in the
transcript up to 1 MiB; past that the tool result ends with a `[scripted-owner: output truncated: …]` line and carries
`truncated: true`, which the scorer's `seatActs` passes on. Live casts stay on `playtest.mjs direct` and
the souls-director skill.

## Directed casts

A spec can name a swarm cast (`tools/playtest/scenarios/casts/`, the format `playtest.mjs direct` and the
souls-director skill use) instead of a scenario: `{"soulRun": 1, "cast": {"file": "<cast.json>"}}`. The run executes
`cmdDirect` headless through the lifecycle hooks: the cast's world, seats and browser are owned and released, the
cast's `console.script` supplies the direction (broadcasts, per-seat lines, `redirect`, `pause`, `resume`, `end`), and a
cancel ends play the way the console's `end` does. A session that ran to its end is `completed` whatever its verdict;
the verdict is in `evidence.verdict`, and the direction journal (`playtest/director/commands.jsonl`, referenced as
`references.journal`) feeds the `directions` measure. The effective cast is written to `cast.effective.json`
(`references.cast`).

A directed spec takes `name`, `world` (`port`, `slug` only), `durationSec`, `observer` (`check`, `required`,
`timeoutMs`, `cameras` as a subset of `follow` and `wide`), `limits`, `controllers`, `retention` and `evaluation`.
Validation refuses before anything starts: a spec that names both a cast and a scenario, unknown `cast` fields, a
missing or invalid cast file, an invalid scripted-owner script, `setup` (not supported with a cast yet),
`diagnostics`, `observer.record`, `recordSize`, `freeComposition` or an `observer.mode` other than `cameras` (scenario
specs only for now), and
(`controllers.live-model`) any seat that is not `scripted-owner` or a `planner`, unless `controllers.allowLiveModels`
is true. `cmdDirect` refuses the same live minds again inside the runner. `specs/hamlet-trio-direct.json` runs three
scripted-owner Souls in the hamlet pond hall, with one redirection of Bo delivered while Ada speaks.

## Setup

Setup batches are existing god-edit batches (`{ops: [...]}` as `eden-god.mjs act` takes them), applied through the world
owner's own route: `POST /v1/god/mint` as the dev owner, then `POST /v1/god/act` per batch, the same validated
`commitBatch` the god CLI uses. It runs after provision and before any seat exists, so it is never part of measured
play. `setup.json` and the receipt record each batch's id, path, sha256 and outcome (edit seq, or the refusal code and
failures) and the physical fixture hash before and after setup. An accepted batch also lists its `entities`: each
created root entity id with the op that created it (`place` or `clone`, op index, tmp, name and def where given; just
`created` when the ids cannot be matched to ops one to one, for example after a build-safe repair), and each entity an
op changed by id, with that op's name. Parts inside a created entity are not listed. A refused batch fails the run at stage `setup`; play
never starts. The minted god token is never written down.

## Ownership and retention

The ledger separates **owned** resources (created by this run: the world process, controllers, browsers) from
**borrowed** ones (the checkout used as server root, other services on the host). Only owned resources are released,
newest first; a failed or timed-out release is recorded and makes a completed run `failed`. A resource the runner
registers after cleanup started is released at once and marked `late`.

Retention classes: **evidence** (receipts, logs, transcripts, report) is always kept; **world data**
(`playtest/server/data`) is disposable; **controller state** (`playtest/seats/*`, which holds owner identities and
controller credentials, and also the seat transcripts) is sensitive and never a publication input; `controllerState: "delete"` removes those transcripts too. Stopping processes does not erase retained data.
`cleanup` deletes only paths the receipt lists inside the run directory, and refuses while an owned world is alive.

Not covered: resuming a crashed run, distributed recovery, killing a controller turn that is still running when its
release wait expires (recorded as `timed-out`).

## Evaluation and comparison

`evaluate` reads a finished run folder (a Soul Run, a plain `playtest.mjs run` folder, or a failed run) and writes a
new `evaluations/<NNN>-v<evaluator version>/` with `evaluation.json` and a short `EVALUATION.md`. It starts no world,
controller or model and makes no network call; earlier evaluations and every source file are left as they are
(`sources.unchanged` checks the hashes before and after). Evidence is referenced by run-relative path, line and
sha256, never copied; seat working folders (owner identity, credentials) and world data are not indexed.

- **Standard measures** keep their own family, unit, n, denominator and basis: `request-latency` (owner card to the
  seat's ack and result calls, and the director's own open time), `physical-completion` (receipt phases the world
  returned to the seat's act calls: completed, ongoing such as seated, or started and not observed to end),
  `seat-claims` (result calls, which are claims), `observed-walking-speed` and the review oracles (only from the
  observer's evidence packs, through `review/metrics.mjs`), `tick-timing`, `token-cost`, `lifecycle` and, for directed
  casts, `direction` (the `directions` measure: the journal's commands by command and outcome, and each redirection
  with its target, run-relative time, outcome and whether the target spoke afterwards). Emergence
  numbers are labelled `social-heuristic`. A measure without its source is `unavailable` with the reason, never 0
  (for example no seat transcript after `controllerState: "delete"`, or no evidence packs while the observer failed).
- **Owner requests** come from the persona director's `personas/<seat>/decisions.jsonl`. A directed cast has none: its
  cards are the lines of `director/directions.jsonl` that carry a `requestId` and `messageId` (gather, prepare, go and
  console redirects alike), and each request's reference points at its line there. Either way they are joined with
  the seat's transcript and its `personas/<seat>/requests.jsonl` cutoffs. With no requests to join, the
  physical-completion measures are unavailable, not 0.
- **Questions** are small named scorer modules (`questions/*.mjs`, default export `{id, version, question,
  assumptions, score(ctx)}`) answering `pass`, `fail` or `unknown` with evidence references and stated uncertainty.
  `ctx` holds the joined requests (director record plus the seat's ack, act, say and result calls), each seat's CLI
  steps, the setup record, the observer's packs (if any) and `ref`/`stepRef` helpers. A pass or fail with no cited
  evidence, a thrown error or an unknown verdict is recorded as `unknown`. Questions named in the spec's
  `evaluation.questions` are `predeclared` (and `unknown` if the file changed since the run); questions passed with
  `--question` afterwards are `exploratory`. The scenario's own `expect` oracles are reported as scenario acceptance.
- **Conflicts** are kept, not resolved: a director that closed a request by budget although the seat reported a
  result, a result after the director's cutoff, a done claim over acts that all failed.
- **Model review** is not run by `evaluate`; `review/cli.mjs review` is the explicit, separately budgeted path, and its
  outputs are indexed when present.

`compare` evaluates each run in memory (writing nothing into the runs) and returns a run index (`--out` writes
`run-index.json` and `COMPARE.md`). It accepts run folders and `replay-set.json` folders. Attempts are grouped into
arms by exact identity: the scenario without its port and paths, the world source hash, setup batch hashes, the seats
(adapter, model, effort, persona, script hash), the director script, seed and duration. Every attempt is listed,
including cancelled, failed and missing ones; only completed attempts are repeats. Server root and tools commits,
uncommitted tracked files in each, CLI/skill/Node versions, machine load and observer state are listed per attempt and flagged where they differ.
Arms are never pooled together; each pair of arms lists the identity parts that differ. A plain playtest folder has no
hashed world source, so it forms its own arm.

Answers are retrospective: they describe what the records show and do not establish motivation, causality or that a
replay would repeat it.

## Controllability scorecard

`evaluate` also writes `scorecard.json` beside `evaluation.json` (#1097), and `compare` lists the same numbers per repeat as
`controllability` measures. It works on any finished run, whichever director ran it, because it reads the seat's side:
`transcript.jsonl`, `turns.jsonl` and `listen.jsonl`, the world's answers in them, and evidence packs when present. Every
metric has its denominator and a `missing` count; a metric with no source has `value: null` and a reason, never 0.

| id | meaning | how it is read |
|---|---|---|
| M1 | first-try act success | `act` and `object` calls and each step of a `plan` after onboarding (not `travel`): 1 - offer refusals / classified acts |
| M2 | model turns per intention | median assistant messages attributed to an owner message with a body act that the seat closed with `result done` |
| M3 | turns with no act or say | decisions that only read, wait or ran a non-CLI tool; `ack`, `result` and a closing line are not counted |
| M4 | owner message to start, upper bound | first reached the seat (listen, or the output carrying it) to the receipt's started event, else the act call returning; from when the owner sent it if the seat has no record of it arriving, or it arrived after the start. `m4Basis` names each |
| M5 | owner corrections per intention | script entries marked `correction: true`, else messages opening with correcting words |
| M6 | context bytes per turn | wake text and tool results after onboarding, per decision; `onboardingBytes` is the skill and boot reads |
| M7 | intent retention | intentions another owner message reached while under way: chat keeps them, a cancel starts nothing new (the predeclared questions check the body stopped), a newer body request replaces them |
| G1 | truthful receipts | `result done` claims whose last accepted act the world records as failed or cut short |
| G2 | unrelated Souls' progress | seats with an accepted act and no receipt completed or held (needs two or more seats) |
| G3 | tick health | tick-validity from the run receipt |

An **intention** is an owner message with at least one body act. A message closed by `result` with no act is a **spoken
request** and is reported apart. Each model decision is attributed to one message (the id it names, else the rest of its
wake, else the latest open intention), so nothing counts twice.

**Refusal classes** (M1) come from the code alone (`classifyRefusal`). `offer` (the world could not read the command, or
named a place it has no way to) counts against M1, with `route` listed separately inside it. `state` (a seat taken, a ride
departed, hands full; listed one code at a time) and `admission` (`soul.busy` and the like) do not. A code in no list is
`unclassified`, including a new code in a family the table knows: out of the denominator, counted and named, so add it to the
table rather than guess. `act.not-an-id` (words sent to the strict `act`) is `offer`, like `capability.unknown` on the words
contract, so the same mistake scores the same on both. An intention whose first act is unclassified or unreadable has an
unknown first-act result (`firstActOfIntention.unknown`), not a success.

**Plans** (#1100): a `plan` call is one act decision for M2 and M3, and each of its steps is a row for M1, including a step and its
replacement. The client closes the owner's message, so a plan's outcome comes from the reports the seat read (`pending`, `plan --status`, and the `listen`
that woke it, logged in `listen.jsonl`). A step no report covers is unreadable, and a plan nobody read the end of stays an open intention.

Three limits are stated in the card. Turns come from the seat log even with the trace tap on: `soul-trace/1` can carry
`host.turn` (`tools/soul-trace/host.mjs`), but nothing in `tools/playtest` writes it yet and this scorer does not read it (#1097 A3 stays open for that). Receipts carry no first-motion tick, so M4 ends at the world's `started`, which is not observed
displacement (`observedFirstBodyChangeSec` is, with an observer). Under a scripted director M5 is the script's own number and
cannot move between arms; a `scripted-owner` seat's "turns" are scripted steps at no model cost, so M2 and M3 describe the
script there.

**Predeclared:** `controllability.mjs` holds the definitions and the refusal table. Its sha256 goes into every run's effective
spec (`scorer`). The card says `predeclared: true` only when that hash still matches at evaluation; otherwise it scores
anyway and says why not.

## Diagnostics (opt-in trace capture)

`diagnostics.trace` turns on the passive control-episode trace owned by #733 (`tools/soul-trace/tap.mjs`, contract
`soul-trace/1`) for the named seats. Off is the default and adds no argument, environment variable, file or receipt
field. Supported controller: the `scripted-owner` seat, which runs every `node eden.mjs …` itself; its commands and its
harness `listen` get `--import <tap>` with `SOUL_TRACE_FILE=<run>/diagnostics/<seat>.trace.jsonl`,
`SOUL_TRACE_RUN=<run id>` and `SOUL_TRACE_SEAT=<seat id>` (the boundary agreed on #623). Live agent seats are refused:
their own shell would need `NODE_OPTIONS`, which the capture has not qualified.

Validation records the capability (contract and the tap, readout and inspector hashes) and refuses a request when the
tap is not in the checkout (`diagnostics.unavailable`); preflight refuses a tap that does not load with capture off
(`diagnostics.tap`). The receipt's `diagnostics` section links each seat's trace file and, after the run, its bytes,
hash, record and process counts, capture losses and the run/seat ids the trace carries. Traces are private evidence
(kept like receipts, outside controller state) and never a publication input. The capture's bounds and failure
behaviour (asynchronous, bounded, counted drops, a failing sink disables itself) are #733's.

Viewing and analysis are separate, explicit commands that start nothing else:

```bash
node tools/playtest/runs/run.mjs inspect   <run> --seat bo     # the local read-only inspector (#624) over that trace
node tools/playtest/runs/run.mjs correlate <run>               # trace ↔ director request ↔ seat transcript ↔ receipt
```

`correlate` keeps every original id and clock domain, never equates the seat's ack, the world's admission, the start
tick and the terminal phase, and lists missing links (for example a delivery the trace did not see).

## Recording (SR5)

Cameras are the stock observer's (`observer/browser.mjs`): one browser context and page per camera, on the served web
client, with real input only. They observe; none of them sends a Soul command.

| camera | how | requested → actual |
|---|---|---|
| follow (one per seat, always in `cameras` mode) | the owner's page at `#soul/<id>`, then a real click on the card's Follow button | `follow` of that Soul, or `ok: false` with the reason |
| `wide` | the public page on the viewer's broadcast camera | `broadcast` |
| `free` | the public page, a real click on the viewer's own broadcast/free toggle, then its camera controls' "Reset view" (a fixed start pose instead of wherever broadcast had cut), then an optional fixed mouse drag and wheel (`observer.freeComposition`, default `{drag: [0, 0], wheel: 0}`: the reset pose, the whole settlement): the same composition every run | `manual` with `reset: true`, or `ok: false` with the reason |

`observer.record` records the named cameras: one uncut, real-speed take each, under `playtest/recordings/<camera>.webm`.
A take starts at arrival (`observer.recordStart: "arrival"`, the default, #888): once the world is on screen and the
arrival card is gone, the page's own recording starts (Playwright `page.screencast`), so the file opens on the world and
holds no loading. `"load"` records the context from page creation to close (Playwright's context video), for a run whose
subject is loading or arrival. A Playwright without `page.screencast` falls back to `load`, and the sidecar says so in
`startFallback`. The sidecar's `start`, `startRequested`, `startedAt` (an arrival take: when its recording started; a
load take: when the context opened, just before its first painted frame), `durationSec` (from `startedAt`) and
`marks` (`arrived`: 0 for an arrival start, its offset for a load start) say which, and `worldTime` holds the world clock
read from `GET /v1/world/env` when the recording started (`worldTimeRequested` is the spec's). A camera that never
arrives under the arrival start has no video; its sidecar names a still of the page it stuck on (`openFailedShot`).
Each recording has a `<camera>.webm.json` sidecar:
requested versus actual camera state (mode, selection, follow/free result), readiness and arrival time, wall-clock and
monotonic open/close, duration, page errors, bytes and sha256, plus the run's provenance (run id, attempt, spec and
effective-spec hashes, source commit, world slug and port). `playtest/cameras.json` lists every camera that was asked
for, including those that failed to open. A camera that fails is recorded and the run goes on without it.

Recording size (`observer.recordSize`, #802). Playwright's recorder encodes VP9 at a fixed 25 fps with a target bitrate
of 1000 kbps × max(1, w·h / (800·450)); frame rate and bitrate are not exposed, the recorded frame size is. `compact`
(the default) scales the recording to fit 800×450 pixels' worth of area with the viewport's aspect (758×474 for a
1280×800 camera), where the target is its 1000 kbps floor. `viewport` records at the viewport size, the earlier quality
(about 2840 kbps at 1280×800). `{width, height}` sets the size outright. The page keeps its viewport; only the video is
scaled. Measured on the hamlet trio, five cameras: `compact` 7.3–7.9 MB per camera-minute; `viewport` 18.8–22.3 MB. Each
sidecar records `encoding` (setting, size, fps, target kbps) and `mbPerMin`; the package index shows both.

Every close path finalizes the recordings: the normal close, a failed run and a cancelled run's ledger release. A
recording closed before play ended is labelled `partial`; a camera that never arrived keeps its partial video with
`closedBy: "open-failed"`. The receipt's `recordings` summarizes them. Recordings are private run evidence like the rest
of the run folder: they show dev owner pages and are never published by the runner.

Offline, after the run (reads the run folder, writes only under `<run>/derived/`, which evaluation ignores):

- `preview <run> --camera <c> --from <s> --to <s>` cuts one excerpt to `derived/previews/<c>-<from>-<to>.mp4` with a
  burned-in label ("PREVIEW, not full proof", the source file, its hash and the range). Its sidecar has `derived: true`,
  `fullProof: false` and the source's file, sha256 and range. The source is hashed before and after; a recording that no
  longer matches its sidecar is refused. A preview is a pointer for reviewers, never the proof itself.
- `preview <run> --camera <c> --auto [--seconds 20]` picks the range from the run's own events (#888): the first act
  (the earliest seat turn that ran `eden.mjs act`, `say` or another action, at an estimated call time: the turn's start
  plus the execution time of the calls before it; a model's thinking between calls is not in `turns.jsonl`, so for a
  model seat this is a lower bound, while for `scripted-owner` seats it is within a few hundred ms), else the first request the director delivered. A seat's follow camera uses that seat's events.
  The event is mapped onto the recording by wall clock, `from = max(0, event − recording startedAt − 1 s)` (`openedAt`
  for recordings from page creation made before #888), and `to = from + seconds`. The preview sidecar's `auto` records
  the event (kind, seat, time, source file, the call), the recording's start basis, the offset and the rule.
- `package <run> [--select <camera|preview file>]…` writes `derived/package/index.json` and `index.md` (private: outcome,
  cost, measurements and questions from the latest evaluation, recordings and previews with hashes, limits) and
  `selected.json`, a projection with only the selected items, run-relative. Every field of it (evidence items,
  measured values, question bases, limits, run id, spec name, commit) is screened for absolute, home-relative (`~/`),
  parent-relative (`../`) and user-directory paths, file URLs and hosts (IPv4, `localhost`, `*.local`, `*.lan`, `*.internal`, mesh-VPN host names); a
  hit is withheld and listed under `refused`. The screen does not recognise tokens or Soul ids: none of the projected
  fields carries them, and the selected items should still be inspected before publishing. Nothing is selected by default. The package never uploads or posts: watch a recording before
  selecting it, then publish it with `tools/proof/upload.mjs` (the PR's proof path).

Observer cost: `observer.mode` `off` / `passive` / `cameras` separates passive evidence capture from browser cameras;
within `cameras`, video encoding runs in Playwright's own ffmpeg processes. A recorded camera takes about 7.5–8 MB per
camera-minute (median 7.7) at the default `compact` size and about 21 MB at `viewport` size (1280x800). Compare arms with two repeats each on a quiet machine (`docs/testing/playtests.md`).

Four saved arms of the same hamlet trio compare observer cost (#803): `specs/hamlet-trio-off.json`,
`hamlet-trio-passive.json`, `hamlet-trio-cameras.json` (the recorded arm's five cameras, recipes and viewports, with
recording off) and `hamlet-trio-recorded.json`. The recording share is the difference between the last two. Every run's
receipt has `cost.processes`: CPU seconds and peak RSS of the runner's descendant processes by class (`browser`,
`encoder` for Playwright's ffmpeg, `world`, `other`), sampled with `ps` every 2 s. Only the class is kept, never a
command line. Basis: only descendants of the runner's process are counted, so a process that is reparented or detached
out of that tree is missed. A process that exits between samples loses up to one interval. Peak RSS is the largest
sampled sum of RSS over the processes in each class, so memory they share can make it overstate actual use. If `ps`
fails, the field is `unavailable` with the reason, and the run is unaffected.

## Scenario runner hooks

`cmdRun(args, hooks)` in `playtest.mjs` takes optional hooks: `own(kind, id, release, meta)` is called for the world
(at spawn, before boot finishes), each controller and the observer browser; `signal` is checked between steps;
`preflight` reuses a result (`start` passes its own); `modules` replaces module loading; `afterProvision({world, runDir})`
runs after provision and before seats (Soul Runs setup), and refuses by throwing. Without hooks `playtest.mjs run` behaves as before.

`cmdDirect(args, hooks)` in `director/swarm/run.mjs` (the directed cast path, `playtest.mjs direct`) takes the same hooks.
It owns the dev world (a `--world <url>` world is only used), each seat controller and the observer browser. An abort
before provision, seats or play stops with `RUN_CANCELLED`; an abort during play ends the session as the console's `end`
does (`stoppedBy: lifecycle-cancel`), so close, verdict and report still run. With hooks, a cast whose seats or planner
need a live model is refused (exit 2) before the run folder or any process exists unless `hooks.allowLiveModels` is
true; scripted-owner seats with no planner need no provider, and the Claude quota check is skipped. Without hooks
`playtest.mjs direct` behaves as before.

Tests: `node --test tools/playtest/director/swarm/test/hooks.test.mjs tools/playtest/runs/runs.test.mjs tools/playtest/runs/compose.test.mjs tools/playtest/runs/evaluate.test.mjs tools/playtest/runs/diagnostics.test.mjs tools/playtest/arena/adapters/scripted-owner.test.mjs`.

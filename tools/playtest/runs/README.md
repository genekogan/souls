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
node tools/playtest/runs/run.mjs cleanup  .local/soul-runs/<run> --world-data --controller-state
node tools/playtest/runs/run.mjs evaluate .local/soul-runs/<run> --question tools/playtest/runs/questions/redirect-honoured.mjs
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio-recorded.json   # the trio, recorded: wide, free and follow cameras
node tools/playtest/runs/run.mjs preview  .local/soul-runs/<run> --camera bo --from 10 --to 40   # a labelled excerpt, never full proof
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
| `world.genesis` or `world.snapshot` | scenario's | World source: a genesis template or a frozen compiler snapshot (`arena/snapshot-seed.mjs`), a path under the server root. Its sha256 is in the receipt (`spec.effective.world.source`). |
| `setup` | none | `{batches: [file or {id, ops, note}], maxWallSec: 120}`: god-edit batches applied after provision and before any seat (see Setup). |
| `durationSec` | scenario's | Play duration override. |
| `observer` | `{check: true, required: false, cameras: null, timeoutMs: 60000, mode: "cameras", record: null, recordSize: "compact", freeComposition: null}` | `mode`: `cameras` (browser cameras, the default), `passive` (world-truth evidence packs, no browser) or `off`. Bounded observer check (import plus one browser launch and close) in `cameras` mode; failure is recorded and cameras are disabled; `required: true` fails the start instead. `cameras`: `wide` and/or `free` beside the per-seat follow cameras. `record`: `true` or camera names (`wide`, `free`, `follow` for every seat, or a seat id). `recordSize`: `compact`, `viewport` or `{width, height}` (needs `record`). See Recording. |
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
  It records the effective spec and its hash, the scenario path and hash, source commit and dirty tracked-file count,
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
earlier request is still open, as a mid-activity redirection does. The scripted director has no pause or resume: an
entry with `command` is refused at validation; end a run by cancelling it.

`scripted-owner` (`arena/adapters/scripted-owner.mjs`) is a model-free seat adapter: it plays a Soul only through the
world's served `eden.mjs` in the seat folder. Onboarding fetches the CLI from the world and runs `register`, `create` and
`status`; owner cards reach it through the harness wake loop's `listen`; it answers each with `ack`, the matching rule's
`eden.mjs` steps and `result done|failed` from those steps' real outcome. A `--wait` step counts as done only when its
receipt completed or the world shows that receipt's activity under way; output without a readable receipt (the brief
form drops it past 600 characters) is a failure, never a claimed success. Rules are matched in order by a
case-insensitive regular expression on the card text; `close: "open"` leaves a request open while its activity
continues, and `supersede` closes requests still open as failed when a later rule fires (an owner redirection). It has
no provider and no cost, and its transcript renders like a model seat's. Live casts stay on `playtest.mjs direct` and
the sim-director skill.

## Setup

Setup batches are existing god-edit batches (`{ops: [...]}` as `eden-god.mjs act` takes them), applied through the world
owner's own route: `POST /v1/god/mint` as the dev owner, then `POST /v1/god/act` per batch, the same validated
`commitBatch` the god CLI uses. It runs after provision and before any seat exists, so it is never part of measured
play. `setup.json` and the receipt record each batch's id, path, sha256 and outcome (edit seq, or the refusal code and
failures) and the physical fixture hash before and after setup. A refused batch fails the run at stage `setup`; play
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
  observer's evidence packs, through `review/metrics.mjs`), `tick-timing`, `token-cost` and `lifecycle`. Emergence
  numbers are labelled `social-heuristic`. A measure without its source is `unavailable` with the reason, never 0
  (for example no seat transcript after `controllerState: "delete"`, or no evidence packs while the observer failed).
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
including cancelled, failed and missing ones; only completed attempts are repeats. Code commit, uncommitted tracked
files, CLI/skill/Node versions, machine load and observer state are listed per attempt and flagged where they differ.
Arms are never pooled together; each pair of arms lists the identity parts that differ. A plain playtest folder has no
hashed world source, so it forms its own arm.

Answers are retrospective: they describe what the records show and do not establish motivation, causality or that a
replay would repeat it.

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

`observer.record` records the named cameras with Playwright's context video: one uncut, real-speed take from page
creation to context close, under `playtest/recordings/<camera>.webm`. Each recording has a `<camera>.webm.json` sidecar:
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
- `package <run> [--select <camera|preview file>]…` writes `derived/package/index.json` and `index.md` (private: outcome,
  cost, measurements and questions from the latest evaluation, recordings and previews with hashes, limits) and
  `selected.json`, a projection with only the selected items, run-relative. Every field of it (evidence items,
  measured values, question bases, limits, run id, spec name, commit) is screened for absolute, home-relative (`~/`),
  parent-relative (`../`) and user-directory paths, file URLs and hosts (IPv4, `localhost`, `*.local`, `*.lan`, `*.internal`, mesh-VPN host names); a
  hit is withheld and listed under `refused`. The screen does not recognise tokens or Soul ids: none of the projected
  fields carries them, and the selected items should still be inspected before publishing. Nothing is selected by default. The package never uploads or posts: watch a recording before
  selecting it, then publish it with `tools/proof/upload.mjs` (the PR's proof path).

Observer cost: `observer.mode` `off` / `passive` / `cameras` separates passive evidence capture from browser cameras;
within `cameras`, video encoding runs in Playwright's own ffmpeg processes. A recorded camera takes under 8 MB per
camera-minute at the default `compact` size and about 21 MB at `viewport` size (1280x800). Compare arms with two repeats each on a quiet machine (`docs/testing/playtests.md`).

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

Tests: `node --test tools/playtest/runs/runs.test.mjs tools/playtest/runs/compose.test.mjs tools/playtest/runs/evaluate.test.mjs tools/playtest/runs/diagnostics.test.mjs tools/playtest/arena/adapters/scripted-owner.test.mjs`.

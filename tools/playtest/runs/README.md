# Soul Runs

One owned lifecycle around an existing playtest scenario: validate, preflight, run through the scenario runner
(`playtest.mjs` `cmdRun`), release what the run created, apply retention and write a terminal receipt. Tranche #749;
SR1 (#750) is the lifecycle; SR2 (#751) adds world sources, setup and composed casts; SR4 (#753) evaluates completed
runs offline and compares repeats. Diagnostics (SR3) and recording (SR5) build on the same receipt.

```bash
node tools/playtest/runs/run.mjs validate tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    --scenario tools/playtest/scenarios/unified-codex-smoke.json --cast none --port 4311 --duration 30
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio.json   # three scripted-owner Souls, one redirection
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/garden-setup.json  # another world, a setup batch, another cast
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/hamlet-trio-direct.json  # a directed cast: swarm director, scripted-owner seats
node tools/playtest/runs/run.mjs cleanup  .local/soul-runs/<run> --world-data --controller-state
node tools/playtest/runs/run.mjs evaluate .local/soul-runs/<run> --question tools/playtest/runs/questions/redirect-honoured.mjs
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
| `observer` | `{check: true, required: false, cameras: null, timeoutMs: 60000}` | Bounded observer check (import plus one browser launch and close). Failure is recorded and cameras are disabled; `required: true` fails the start instead. `cameras: ["wide"]` adds a wide camera. |
| `limits` | `{maxWallSec: 1800, maxControllers: 4, cleanupWaitMs: 15000}` | Hard wall limit for the whole run, controller count, per-resource release wait. |
| `controllers.allowLiveModels` | `false` | A scenario whose seats, persona director or model review need claude/codex is refused unless this is `true`. Set it only with explicit authorization for live models. |
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
receipt completed or the world shows that receipt's activity under way; output without a readable receipt (CLI 2.8.0
and earlier drop it from the brief form past 600 characters) is a failure, never a claimed success. When an owner card
ends the wait while the receipt is still open, the step keeps waiting on that receipt (`wait <s> <receiptId>`) for the
rest of its window (at most 60 s, as the CLI applies `--wait`) and is judged on that; the card is handled next turn. Rules are matched in order by a
case-insensitive regular expression on the card text; `close: "open"` leaves a request open while its activity
continues, and `supersede` closes requests still open as failed when a later rule fires (an owner redirection).
A refused or failed step stops its rule and fails the request, unless the step ends with `{"onRefused": "continue"}`
(default `"fail"`): then the refusal is said in the transcript and the next step runs (#828). An argument
`{{prev.<path>}}` (dots and `[n]`, e.g. `{{prev.did_you_mean[0].id}}`) takes a value from the previous step's JSON
output, a refusal's included, so a script can act on the world's own suggestion:
`[["act", "fly up to the field", {"onRefused": "continue"}], ["act", "{{prev.did_you_mean[0].id}}", "--wait", "60"]]`.
The transcript shows the resolved command. A placeholder that does not resolve fails its step without running it. It has
no provider and no cost, and its transcript renders like a model seat's. Live casts stay on `playtest.mjs direct` and
the sim-director skill.

## Directed casts

A spec can name a swarm cast (`tools/playtest/scenarios/casts/`, the format `playtest.mjs direct` and the
sim-director skill use) instead of a scenario: `{"soulRun": 1, "cast": {"file": "<cast.json>"}}`. The run executes
`cmdDirect` headless through the lifecycle hooks: the cast's world, seats and browser are owned and released, the
cast's `console.script` supplies the direction (broadcasts, per-seat lines, `redirect`, `pause`, `resume`, `end`), and a
cancel ends play the way the console's `end` does. A session that ran to its end is `completed` whatever its verdict;
the verdict is in `evidence.verdict`, and the direction journal (`playtest/director/commands.jsonl`, referenced as
`references.journal`) feeds the `directions` measure. The effective cast is written to `cast.effective.json`
(`references.cast`).

A directed spec takes `name`, `world` (`port`, `slug` only), `durationSec`, `observer` (`check`, `required`,
`timeoutMs`, `cameras` as a subset of `follow` and `wide`), `limits`, `controllers`, `retention` and `evaluation`.
Validation refuses before anything starts: a spec that names both a cast and a scenario, unknown `cast` fields, a
missing or invalid cast file, an invalid scripted-owner script, `setup` (not supported with a cast yet), and
(`controllers.live-model`) any seat that is not `scripted-owner` or a `planner`, unless `controllers.allowLiveModels`
is true. `cmdDirect` refuses the same live minds again inside the runner. `specs/hamlet-trio-direct.json` runs three
scripted-owner Souls in the hamlet pond hall, with one redirection of Bo delivered while Ada speaks.

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
  observer's evidence packs, through `review/metrics.mjs`), `tick-timing`, `token-cost`, `lifecycle` and, for directed
  casts, `direction` (the `directions` measure: the journal's commands by command and outcome, and each redirection
  with its target, run-relative time, outcome and whether the target spoke afterwards). Emergence
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

Tests: `node --test tools/playtest/director/swarm/test/hooks.test.mjs tools/playtest/runs/runs.test.mjs tools/playtest/runs/compose.test.mjs tools/playtest/runs/evaluate.test.mjs tools/playtest/arena/adapters/scripted-owner.test.mjs`.

# Soul Runs

One owned lifecycle around an existing playtest scenario: validate, preflight, run through the scenario runner
(`playtest.mjs` `cmdRun`), release what the run created, apply retention and write a terminal receipt. Tranche #749;
this is SR1 (#750). Composed worlds and casts (SR2), diagnostics (SR3), evaluation (SR4) and recording (SR5) build on
the same receipt.

```bash
node tools/playtest/runs/run.mjs validate tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    tools/playtest/runs/specs/smoke-world.json
node tools/playtest/runs/run.mjs start    --scenario tools/playtest/scenarios/unified-codex-smoke.json --cast none --port 4311 --duration 30
node tools/playtest/runs/run.mjs cleanup  .local/soul-runs/<run> --world-data --controller-state
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
| `cast` | `scenario` | `scenario` runs its seats; `none` removes seats, god and their script events (world, director, observer and review only). |
| `world.port`, `world.slug` | scenario's | The only world overrides. Use a free port; a busy port is refused, never taken over. |
| `durationSec` | scenario's | Play duration override. |
| `observer` | `{check: true, required: false, cameras: null, timeoutMs: 60000}` | Bounded observer check (import plus one browser launch and close). Failure is recorded and cameras are disabled; `required: true` fails the start instead. `cameras: ["wide"]` adds a wide camera. |
| `limits` | `{maxWallSec: 1800, maxControllers: 4, cleanupWaitMs: 15000}` | Hard wall limit for the whole run, controller count, per-resource release wait. |
| `controllers.allowLiveModels` | `false` | A scenario whose seats, persona director or model review need claude/codex is refused unless this is `true`. Set it only with explicit authorization for live models. |
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

## Ownership and retention

The ledger separates **owned** resources (created by this run: the world process, controllers, browsers) from
**borrowed** ones (the checkout used as server root, other services on the host). Only owned resources are released,
newest first; a failed or timed-out release is recorded and makes a completed run `failed`. A resource the runner
registers after cleanup started is released at once and marked `late`.

Retention classes: **evidence** (receipts, logs, transcripts, report) is always kept; **world data**
(`playtest/server/data`) is disposable; **controller state** (`playtest/seats/*`, which holds owner identities and
controller credentials) is sensitive and never a publication input. Stopping processes does not erase retained data.
`cleanup` deletes only paths the receipt lists inside the run directory, and refuses while an owned world is alive.

Not covered: resuming a crashed run, distributed recovery, killing a controller turn that is still running when its
release wait expires (recorded as `timed-out`).

## Scenario runner hooks

`cmdRun(args, hooks)` in `playtest.mjs` takes optional hooks: `own(kind, id, release, meta)` is called for the world
(at spawn, before boot finishes), each controller and the observer browser; `signal` is checked between steps;
`preflight` reuses a result; `modules` replaces module loading. Without hooks `playtest.mjs run` behaves as before.

Tests: `node --test tools/playtest/runs/runs.test.mjs`.

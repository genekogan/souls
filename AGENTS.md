# AGENTS.md

Rules for anyone changing this repository, human or agent (Claude Code, Codex, Cursor, …). `CLAUDE.md` imports this
file. Keep it short: every rule here binds; detail lives in the linked docs.

## What this is

Soul, the server and web app behind soul.game: persistent worlds, Souls driven by their owners' own agents at the
edge, god mode for world creators, and a vendored deterministic engine under `mars/` (its invariants:
[mars/AGENTS.md](mars/AGENTS.md)). **Code wins over docs**; fix a doc you find wrong. Start at
[docs/README.md](docs/README.md). Checkout placement and recovery:
[workspace relocation](docs/process/workspace-relocation.md).

## Setup and everyday commands

- Node ≥ 22.18 runs TypeScript by type stripping: no `enum`, no parameter properties, no other non-erasable syntax.
  pnpm 10: `pnpm install --frozen-lockfile`, then `pnpm assets:pull` (media is not in git).
- Local server: `BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=.local/dev node --env-file=.env apps/server/src/main.ts`.
  See [docs/development.md](docs/development.md).
- Before a PR: `pnpm typecheck` (or `tsc -p` for the packages you touched), `node --test` on the affected test files,
  and the walk and bundle checks below when your change can affect them. What to run when:
  [docs/testing.md](docs/testing.md).

## Minds, money and data

- Local and test minds are **fake** (`BRAIN_MODE=fake`; anything else means live). Never run a live model unless the
  task is testing the models.
- The model budget is at most $1 per world per rolling 24 h, default $0.50, reserved before each provider call. Never
  raise it in code or tests.
- New worlds need a verified human owner. One god per world.
- Tests never use production data, production databases or ports of running services. Use an isolated `DATA_DIR`
  under an ignored path (`.local/`).
- Never commit secrets, `.env`, `deploy.env`, databases, run outputs or media. Never bypass the secret scanner or
  commit hooks (`--no-verify`).

## Engine invariants

- The engine core is deterministic: fixed tick, no `Date.now` or `Math.random` (randomness comes from the world RNG),
  zod as its only dependency, named diagnostics. Kernel changes apply or are refused with a reason.
- Never bypass support, ownership or admission; never move through forbidden geometry, teleport or silently respawn.
  Renderers, pose adapters and cameras observe state and never own a second movement path.
- A local failure never stops the clock, the UI or unrelated actors; invariant corruption stays visible and contained.
- Skipped, `FIXME` and `TODO` checks count as unproved. Golden baselines change only with proof of an intended change.
- Contract: [docs/architecture/engine-contract.md](docs/architecture/engine-contract.md).

## Gates every change keeps green

- **Walk (V3-walk):** `node tools/test-harness/walk/walk.mjs`. A deliberate change updates the baseline with
  `--write`, in its own reviewed commit. [docs/testing.md](docs/testing.md#walk-gate)
- **Bundle (V3-bundle):** `node tools/test-harness/bundle-budget/budget.mjs --build --check`. The baseline changes only
  in its own commit (`--write`); the gate never writes it. [docs/testing.md](docs/testing.md#bundle-gate)
- **Conformance pins:** a changed library def revision needs a new supplement in
  `packages/conformance/conformance/`, in the same change, with its reason. Never edit older supplements.
- **Full gate:** the [remote gate](docs/testing/remote-gate.md) runs the complete suite for a release head: 0 new
  failures, 0 blockers, 0 unexpected skips. Don't re-run passing checks without a source change.

## God mode build safety and seats

- **BUILDSAFE:** god `commitBatch` repairs what an edit newly cuts off, in the same batch
  (`apps/server/src/god/buildsafe-rule.ts`). Never add a separate after-the-fact walk fix.
- **SEATDEF:** seat heights come from the def's model geometry. A change is a new def revision; old revisions keep
  their bytes. Sitting refuses only `seat.too-high`.

## Playtests and the swarm director

- Batteries, personas and casts live in `tools/playtest/`. Measure on a quiet machine only, two repeats per arm.
  Seats use one relative command per call. [docs/testing/playtests.md](docs/testing/playtests.md)
- Directed live casts: `node tools/playtest/playtest.mjs direct <cast>`, or the `sim-director` skill from a chat
  session. [docs/testing/swarm-director.md](docs/testing/swarm-director.md)

## Cloud spend

- The remote gate runs once per release head against a cached baseline; candidates use scoped gates. Never gate perf
  experiments or docs/tools-only changes. Respect the shared concurrency cap.
  [docs/process/modal-policy.md](docs/process/modal-policy.md)

## Agent lifecycle

[Planning and intake](docs/process/planning.md) separates direction, backlog, ready work and portable handoffs.
For an agenda with multiple workers, follow the [development coordinator](docs/process/development-coordinator.md)
contract; fresh sessions recover its dated agenda and assignments before dispatch.

- Stay within the requested outcome. Prefer independently reviewable, single-digit-hour slices; finish one active
  implementation before starting another. Get Gene's approval before substantial scope expansion or an out-of-scope
  prerequisite; explain the smallest necessary addition. Routine in-scope repairs need no new permission.
- Continue to the authorized endpoint, including checks, proof and review fixes; do not stop at routine milestones
  unless Gene requested review stops. Use an available goal mechanism for sustained work, otherwise a durable issue
  checkpoint. Goals never override budgets, genuine blockers or merge/release approvals. See [bounded execution](docs/process/planning.md#bounded-execution).
- Prefer isolated work on independent features in the development/release coordinator's chosen order. Check overlaps
  at dispatch, shared-contract changes and integration; avoid continuous cross-worker synchronization. If no coordinator
  is assigned, finish the bounded issue to its authorized endpoint and leave an integration handoff; do not assume release authority.
- Work starts from an issue you claim (assign + `agent:claimed`); one branch `agent/<issue>-<slug>` and worktree per
  issue; small PRs; unfinished work behind a flag. Proof goes in the PR, not the tree: no status, brief, prompt or
  report files. No scheduled agents: the maintainer or authorized development owner starts bounded work within
  the agreed agenda.
- Never edit shared append-only files: changelog fragments go in `changes/`, conformance changes in a new supplement,
  generated output is built in CI, baselines are regenerated in their own commit.
- Ready PRs get `merge:ready`; the merge train rebases, re-tests and merges (T0–T2 on green, T3–T4 after the
  maintainer, who may delegate that sign-off to the appointed development coordinator by a dated decision:
  [delegated sign-off](docs/process/agent-workflow.md#delegated-sign-off)).
  [docs/process/agent-workflow.md](docs/process/agent-workflow.md)
- Each PR names its proof tier ([PROOF-POLICY.yml](docs/process/PROOF-POLICY.yml); `node tools/proof/tier.mjs`) and
  adds a changelog fragment in [`changes/`](changes/README.md) unless it is labelled `no-changelog`.
- "Done" means walked on the real URL with real input; a scripted e2e alone doesn't count. Visual evidence is uncut,
  real-speed video. [docs/process/](docs/process/agent-lifecycle.md)
- Bug fixes need no approval. Destructive production deletes need the maintainer's explicit yes.
- Issues state the problem and acceptance criteria before work starts. The PR is the journal entry: acceptance with
  evidence, proof, self-audit. [docs/process/agent-lifecycle.md](docs/process/agent-lifecycle.md#5-pull-request)
- Repo skills in `.claude/skills/` (plain Markdown, readable by any agent): `journal`, `epic`, `triage`, `finish`,
  `proof`, `e2e`, `sim-director`. Agent definitions in `.claude/agents/`: `coordinator`, `lane`, `reviewer`.

## Release and operations

- The authorized release owner follows the current topology and automation limits in the release doc: gate receipt,
  build of exactly HEAD of a clean tree, CDN-first assets,
  staged ship, healthz, walks, cdn-walk, rollback on failure. [docs/release.md](docs/release.md)
- Never touch services, users, DNS or proxies on the host that aren't Soul's. [docs/operations.md](docs/operations.md)

## Visitor analytics

- `apps/web/src/visitor-counts.ts` is cookieless and never sends a query string, hash, Soul id or token. Automation
  is excluded (`navigator.webdriver`, `?shot`, `skipgc`). A CSP fetch directive must allow the counter origin.
  [docs/operations/analytics.md](docs/operations/analytics.md)

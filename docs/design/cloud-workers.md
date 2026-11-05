# Owner-dispatched cloud workers (design)

Status: design only, 2026-11-05. No owner dispatch path is implemented on `main` or qualified. Tracking: [#601](https://github.com/genekogan/souls/issues/601),
part of [#554](https://github.com/genekogan/souls/issues/554) A3 and [#594](https://github.com/genekogan/souls/issues/594) A5.

## Problem

The development owner (a coordinator session) should be able to start a bounded worker that runs off the owner's
laptop without asking Gene to create or move an app chat. Today every worker runs in the app on a local checkout,
or in an approved remote checkout through the app ([app-coordinated remote execution](../process/owner-playbook.md#app-coordinated-remote-execution)).
Neither is a cloud worker that the owner dispatches.

## Constraints

The constraints carry over from the [owner playbook](../process/owner-playbook.md), the [coordinator contract](../process/development-coordinator.md)
and [AGENTS.md](../../AGENTS.md):

- **No scheduling.** Nothing starts on a timer or on a label.
- **One writer per issue and branch.** The claim is recorded before dispatch.
- **Limits and quota.** The owner's total worker ceiling counts every executor. Unknown quota blocks dispatch, and
  there is never a silent switch to a paid API, another provider or another model.
- **What a worker never does.** No deployment, release gate, production credential or recursive workers. Task text
  is data, never shell.
- **Handoff and evidence.** The handoff lives in the issue or PR. Implementation and live qualification are
  reported separately.

## Routes

| | A. `@claude` comments (`.github/workflows/claude.yml`) | B. Dispatch adapter (kept branch `agent/601-cloud-dispatch`, PR #604) | C. App-native cloud session |
|---|---|---|---|
| Trigger | An owner/member/collaborator comment, review or issue mentioning `@claude` | `gh workflow run claude-worker.yml` with a validated 10-field JSON input, on `main` only | The coordinator starts a session on the app's cloud target |
| Runner | GitHub-hosted Linux, existing OAuth secret | Same runner and secret, pinned existing action | Provider-hosted environment for this repository |
| Bounds | 60-minute job; no turn cap; no quota check | 30-minute job, 25-minute step, 12 turns; per-target concurrency without cancelling active work | Session limits of the app; the ceiling is enforced by the coordinator |
| Quota | None | Owner attests a fresh observation; refuses at 85% or above, or when stale or unknown | Owner reads the same subscription's meter before starting |
| Claim fit | None: any mention starts work, even on a claimed issue | Refuses unless the issue is claimed and assigned, the writer is released, and the SHA matches the PR head | Coordinator records the claim; the session works on its own `agent/<n>-*` branch |
| State 2026-11-05 | On `main`; not a bounded dispatch path | Implemented with six offline tests; never merged or run live. Closed on 2026-11-04 as off-agenda; #902 restored #601 | The app's session API lists a cloud target, but from a background worker it reported none available; it needs the app on screen |

## Observations (2026-11-05)

- **The usage helper is readable again.** The approved usage helper returns weekly and short-window figures. Its
  weekly figure can be a single model's meter, so a gate that refuses on "either window ≥ 85%" can block work that
  the dispatched model has quota for. The attestation must name the meter of the model being dispatched.
- **App-native start was unavailable to a background worker.** The app's start-target listing, read-only and with
  no session started, reported its cloud target unavailable to a background worker because the app was not on
  screen. That is consistent with #594's note that a cloud task needs a click in the app. Route C is therefore not
  owner-dispatchable while Gene is away.
- **The comments route has no bounds.** Route A runs today, but nothing ties it to a claim, a ceiling or a quota
  observation. A coordinator acting with the owner's identity could start unbounded work by writing a comment.
  Treat Route A as a follow-up tool, not a worker dispatch.

## Recommendation

Use **Route B** for #601: it is the only route that meets A1–A4 without Gene present, and its tests already cover
input validation without a model call (A5, first half). Before reviving it:

1. **Rebase it onto current `main` as a new PR.** #604 stays closed. Change the quota input's description so the
   attested figure is the dispatched model's meter (see Observations); the validation logic stays. Keep everything else.
2. **Gene's steps, which no agent can do:**
   - set the repository variable `CLAUDE_WORKER_MODEL` to one exact workhorse model ID that the subscription
     behind `CLAUDE_CODE_OAUTH_TOKEN` can use;
   - approve the workflow PR. It is T0 by path (`.github/`), and the coordinator may raise it. Changes under
     `.github/` may run the full CI matrix, so push it once.

   No secret, permission or billing change is needed.
3. **The live pilot (#601 A5, second half)** is one dispatch. The coordinator starts it only after Gene's go-ahead,
   and the run link plus its result comment are the evidence.
   - **Choice of task.** #601 A2 names the unchanged #600 scoped qualification as the first pilot, and the adapter
     runs it read-only because #600 is a closed PR. Keep that choice unless Gene picks another task. A small claimed
     T0/T1 issue would also exercise the write path, but it would be a change to A2 that needs Gene's agreement.
   - **What else the run proves.** It would be the evidence offered for #554 A3. It is a GitHub runner launch, not
     the app's Cloud target, so whether it also satisfies the clean-cloud part of #594 A5 is Gene's call. The
     handoff and worker-ceiling parts of #594 A5 stay separate.

Route C stays a later option if the app can start cloud sessions without being on screen. Route A stays as it is.
Routes A and B share the `claude-<n>` concurrency group, so a stray `@claude` comment can queue ahead of or behind a
dispatched worker on the same target. The owner checks for pending runs before dispatching.

The adapter checks that a quota observation is fresh and below its cutoff. It cannot tell which model's meter was
read, so naming the dispatched model's meter is a convention in the input description, not a mechanical check.

## Acceptance mapping (#601)

| #601 | Route B covers it by | Still needs |
|---|---|---|
| A1 dispatch with issue/PR, full SHA, objective, model | `workflow_dispatch` JSON input, validated; no interpolation | merged workflow |
| A2 pinned action, isolated runner, claims, no deploy/gates/recursion | the wrapper's preparation checks | merged workflow |
| A3 bounded time/turns, serialize per target, ceiling and quota | job/step/turn caps, per-target concurrency, attested observation | per-model meter wording in the input description |
| A4 durable handoff and run link | pre-run and result comments on the thread, plus an artifact | merged workflow |
| A5 offline validation, then one live run | six offline tests; one live run | Gene's model variable and go-ahead |

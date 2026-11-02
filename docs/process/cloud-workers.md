# Owner-dispatched cloud workers

The manual `claude-worker.yml` adapter starts a bounded Claude task on an isolated GitHub Linux runner. It reuses
the existing Claude action and issue/PR lifecycle. It is not a scheduler or a new task database. Codex Cloud remains
a separate, unqualified adapter; this workflow does not require Gene to create or move an app chat.

Implementation and live qualification are separate in [#601](https://github.com/genekogan/souls/issues/601).
**No live pilot has run.** The approved usage helper cannot currently obtain a weekly observation on either laptop;
local Claude also reports logged out. Existing successful OAuth-backed GitHub reviews prove that review path, not
readable quota or this new dispatch path. Unknown quota blocks execution. Do not retry through a paid API.

## One-time prerequisites and dispatch

1. Restore the owner's approved Claude account/usage observation through the existing interactive sign-in route.
   Gene performs sign-in; never copy local credentials or ask for a token in chat. A successful GitHub review does
   not require rotating its existing `CLAUDE_CODE_OAUTH_TOKEN` secret merely because the local usage reader failed.
2. Confirm an actual model identifier available to that subscription, then configure the single repository variable
   `CLAUDE_WORKER_MODEL` to that exact approved workhorse model. This adapter guesses no model ID, defaults to no
   model, and supplies no fallback-model/API/billing option. Model changes require owner review of this variable.
3. Merge the reviewed workflow through normal checks. Dispatch/rerun must be by the repository owner on `main`.
   The authorized development owner uses that existing CLI/API identity; no new account permission is created.
4. Before **each** dispatch, use the approved usage helper and record its UTC observation time, actual weekly and
   short-window percentages, resets and relevant model-specific constraints in the task journal. The workflow rejects
   missing/unknown/exhausted percentages and observations older than 30 minutes or in the future. These inputs are
   an owner attestation, not an independent remote quota query or a reservation. Existing stricter quota/spend caps
   remain binding; enough apparent remaining quota does not authorize work above them.
5. Count active workers across this adapter, the comments-based Claude action, local/other-provider tasks and the
   separately owned performance lane. Compare against the requested total ceiling and actual executor capacity;
   dispatch only when a slot and independent scope exist. Queued jobs reserve an owner-managed slot too. If a queue
   wait makes the observation stale, preparation refuses it. No automatic fan-out or alternate pool is created.
6. Confirm the outgoing writer stopped and source/WIP/proof are durable before `writer_released=true`. An open task
   needs `agent:claimed` and assignment to the dispatch owner. For a PR, the requested SHA must equal its same-repo
   head and its lifecycle branch is retained. An issue uses `agent/<number>-cloud`; a different existing branch head
   is refused rather than reset. Never use this adapter concurrently with an issue's other PR/branch writer.

Prepare `dispatch.json` with these ten fields, using **actual** current values:

```json
{
  "task": "600",
  "source_sha": "<full unchanged PR head SHA>",
  "objective": "<the existing bounded qualification scope and selected checks>",
  "model": "<exact reviewed CLAUDE_WORKER_MODEL>",
  "quota_observed_at": "<actual UTC ISO timestamp>",
  "weekly_used_percent": "<observed percent>",
  "short_window_used_percent": "<observed percent>",
  "worker_ceiling": "<authorized total ceiling>",
  "active_workers": "<actual active total before dispatch>",
  "writer_released": true
}
```

```sh
gh workflow run claude-worker.yml --repo genekogan/souls --ref main --json < dispatch.json
gh run list --repo genekogan/souls --workflow claude-worker.yml --event workflow_dispatch --branch main
```

Do not put secrets in the objective or inputs: task/run journals are public repository records. The initial live
pilot remains the unchanged [PR #600](https://github.com/genekogan/souls/pull/600) qualification; its original blocked
handoff and passing local/CI evidence remain intact. Because it is a closed PR, this adapter permits only read-only
qualification, with no source updates. Do not rerun already passing unchanged checks to manufacture a cloud receipt;
use the previously selected bounded capability objective and retain any unverified setup step explicitly.

## Bounds, durable handoff and recovery

The job has 30 minutes, the action step 25 minutes and the agent 12 turns. Explicit-prompt agent mode does not
supply the comments-mode tracking/branch ceremony, so the wrapper records the exact source/objective, model,
quota/capacity observation and run URL on the existing thread before model execution. Task text is JSON data;
it is never interpolated into a shell script or CLI flags. The task descriptor and trusted finalizer are hash-checked
before posting an outcome. The structured result is posted back to that thread and retained as an artifact.
Raw model transcripts and credentials are not uploaded.

Same-target runs share `claude-<number>` with the existing comments-based action; active work is not cancelled.
GitHub's default concurrency queue can replace an older **pending** run. This is not a FIFO work queue or an atomic
claim across different issue/PR aliases. The owner dispatches one pending task per target, accounts for reservations
and uses existing claims to avoid two aliases of the same work. A replaced pending run never means work completed.

The action uses the existing OAuth secret and GitHub app integration. Only reviewed GitHub/job permissions are
requested; no production environment, deployment credentials, API key fallback or Modal token is supplied. Built-in
agent/task tools and MCP tools are removed; source edits are unavailable for read-only qualification. Focused node
checks and ordinary lifecycle git/PR commands are allowed. Tool permissions and task instructions are not a sandbox
for hostile executable source: the owner must authorize the exact repository source and scope. No broad asset pull,
installation or suite runs by default; no recursive worker, release gate or deployment is permitted.

```sh
gh run view <run-id> --repo genekogan/souls
gh run watch <run-id> --repo genekogan/souls
gh run cancel <run-id> --repo genekogan/souls
gh run download <run-id> --repo genekogan/souls --name cloud-worker-<run-id>-<attempt>
```

Ask the running worker to checkpoint before an orderly stop. Cancellation/timeout can prevent final steps; the
initial run/source journal survives, but an interrupted process and uncommitted runner files may not. Check actual
run status, the latest durable commit/PR, failed checks and the claim before resuming. The finalizer explicitly flags
uncommitted source and read-only source changes; it does not auto-commit, merge, mark acceptance passed or rescue
volatile WIP. Resume by dispatching the preserved exact source with a new bounded objective and fresh quota/capacity
observation. Do not overwrite the original failed run or assume automatic cross-provider transcript transfer.

Use the [owner playbook](owner-playbook.md), [portable handoff](planning.md#portable-execution-and-handoff),
[lifecycle](agent-lifecycle.md) and [proof policy](PROOF-POLICY.yml). The underlying contract is the
[pinned action inputs](https://github.com/anthropics/claude-code-action/blob/d535f5172dec02b204866b393d6b20b9b2aaf98d/action.yml),
[agent-mode behavior](https://github.com/anthropics/claude-code-action/blob/d535f5172dec02b204866b393d6b20b9b2aaf98d/src/modes/agent/index.ts)
and [Claude CLI flags](https://code.claude.com/docs/en/cli-reference). These supported controls are source-reviewed;
a successful owner-dispatched model run, authentication/model availability and live handoff remain unverified.

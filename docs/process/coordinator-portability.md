# Coordinator portability

The coordinator is a role in the main conversation of the chosen harness, not a service owned by an LLM provider.
Use its native workers, questions and job controls. The portable contract is AGENTS.md, the
[coordinator guide](development-coordinator.md), [planning/handoffs](planning.md) and GitHub acceptance/proof records.
The private bootstrap locates the manifest, state and decision log. Native chat history, auto-memory, task IDs and
agent configuration are conveniences, never the only record of unfinished work or authority.

First launch remains orientation-only: inspect/report the current project, process and existing activity, then wait
for Gene's agenda/capacity and instruction to begin. Do not activate an old agenda or take over its writer merely
because state files exist. An explicit migration instruction may authorize resuming a named agenda after recovery.

## Native entry paths

| Harness | How to enter and delegate |
|---|---|
| Codex | Read AGENTS.md and the shared coordinator guide in the main session. Use the exposed subagent/session controls and explicitly select the authorized workhorse model. Read the lane/reviewer Markdown as instructions; do not assume Claude's agent files are automatically registered Codex roles. |
| Claude Code | The repository's CLAUDE.md imports AGENTS.md. Read the same coordinator guide in the main session. Use native subagents or approved separate sessions, including the lane/reviewer definitions under `.claude/agents/` when supported. Explicitly select the authorized workhorse model rather than inheriting a frontier supervisor accidentally. |
| Another harness | Explicitly read the same files if automatic discovery differs. Map the capabilities below to its native tools. Do not pretend a native launcher, browser, durable goal or credential exists because another harness had one. |

`.claude/skills/` and `.claude/agents/` contain readable project procedures. Other harnesses can read and follow
them without installing Claude or emulating its tool names. Thin native role definitions may point to these sources;
do not maintain separate competing workflow copies. Keep the coordinator in the main session rather than spawning
a second permanent supervisor under it. Role selection is not an implementation or release authorization.

Both Codex and Claude support model selection for delegates, but inheritance, allowed model names and controls
depend on the installed client. Verify actual selection at dispatch. Use the policy's model class with a locally
available model; disclose any fallback. Current official references:
[Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Claude subagents](https://code.claude.com/docs/en/sub-agents) and
[Claude instruction imports](https://code.claude.com/docs/en/memory#import-additional-files).

## Capability contract

At onboarding, record only the relevant available/unavailable/unknown capabilities privately. Do not build a new
dispatcher or launch a test worker just to fill a checklist. At first authorized dispatch, use a small real issue to
qualify the selected route; preserve its result rather than repeating qualification on every task.

| Logical operation | Native mapping and fallback |
|---|---|
| Read/change source and run checks | Native filesystem/shell tools in an assigned checkout; explicitly approved remote executor if needed. Share read-only assets, isolate writers/data/ports. |
| Spawn/steer/collect a worker | Native subagent or independent session with a bounded assignment packet and result destination. Record its returned handle and actual model. No recursive pools; reviewers consume capacity too. |
| Sustain work | Use a native goal/task facility when available and authorized. Otherwise use the agreed agenda, active execution loop and durable checkpoint; no tool named `create_goal` is required. Never simulate persistence with a scheduled agent or claim execution continues after the harness stops. |
| Wait and inspect jobs | Native notifications/waits or bounded status queries. Store job ownership and output location independently of the chat handle. Missing process visibility is unknown liveness, not permission to launch a replacement. |
| Ask Gene without stopping other lanes | Native async question if available; otherwise a concise chat question plus a durable decision ID. Pause dependent work, safely park its writer, and continue other authorized work when the harness permits. If asking ends the turn, record that limitation; silence never approves. |
| GitHub and review | Configured connector or authenticated CLI; use the same issues, PRs, required checks and independent review contract. A provider switch does not bypass CI or maintainer approval. |
| Browser, video, audio, performance proof | Whatever qualified tools/executors can produce the required evidence. A shell-only executor hands off the missing proof, without replacing it with weaker claims. |
| Usage and budgets | Each provider's supported meter and current session limits. Unknown is not zero; one subscription cannot measure the other. No credential copying or silent paid API fallback. |

If a required capability is missing, name it and the smallest permitted alternative. If three lanes are requested
but capacity is smaller, retain three ordered queues and report the active limit. Reserve or rotate a worker slot
for independent review rather than adding a hidden fourth implementation lane. Do not weaken isolation or proof
to claim all lanes are active. Cross-provider calls are optional: a Claude coordinator can use all-Claude workers,
and Codex all-Codex. Neither must call the other. Mixed delegation requires an available authenticated route and
the same scope, privacy and spend controls; do not build a provider bridge as a prerequisite to feature work.

## Provider-neutral handoff

Keep portable facts separate from optional `native_bindings` in private state. The portable part contains agenda,
lane identity/status, acceptance/exclusions, PR/source/base/head, preserved WIP, evidence and failed checks, resource
claims, pending decisions, authority, observations and exact next action. Native bindings may contain provider,
harness, model, session/job handles, executor and observation time. Unknown handles stay null. Their presence does
not prove liveness, and another provider need not understand them to recover the task.

On a switch:

1. The outgoing coordinator stops new dispatch, checkpoints each lane and records which writers/jobs are still
   running, stopped or unknown. Preserve useful work and identify the latest accepted decisions and approval scope.
2. Gene or the authorized outgoing owner explicitly hands off the named agenda. The incoming owner reads the same
   manifest/state and revalidates live writers, PR heads, resources and release lock before taking ownership.
3. Existing provider-specific workers may finish under their original owner and return a durable result, or stop
   at an agreed checkpoint before replacement. Missing access to their chat does not prove they stopped. Never run
   two writers against one workspace or cancel an active gate merely to change provider.
4. Give a replacement worker the compact assignment packet and existing artifacts. Create a new native handle;
   retain the logical lane identity and provenance. Do not replay finished side effects or rerun valid gates/proof.
5. Keep one state writer. Other sessions submit a handoff packet for adoption rather than overwriting the active
   coordinator's manifest/state concurrently. A different machine needs an approved private transfer or access;
   public GitHub is not transport for private bindings or raw conversations.

No provider login, API secret, cookies or private account data belongs in a handoff. Each harness authenticates
through its own supported mechanism. A successful Codex worker is evidence for that route only, not proof that
Claude or another harness is signed in and qualified. Report static contract review separately from an actual
end-to-end execution in each harness. The same orientation/agenda prompt works once the receiver can read the
project and private handoff; continuous execution still depends on that harness remaining runnable.

## Operating the merge pipeline

These rules bind in every harness and add to the sustaining-lanes rules (#766, #769); where they differ, these win.
Merge-train mechanics live in [agent workflow](agent-workflow.md#the-merge-train).

- **Repo steward.** One workhorse worker owns review dispatch, `merge:ready` on reviewed T0–T2 PRs, CI and
  merge-train triage, cancelling superseded runs and release-candidate summaries. It never deploys, runs a paid gate
  or adds `approved:maintainer`.
- **Steward wake-up.** In Claude Code a subagent steward cannot idle on a `Monitor`, so the coordinator owns the PR
  watcher and forwards each event, and a periodic queue check, to the same steward agent, which acts and hands back
  with its context kept. A sidebar-session steward can idle on its own watcher but starts only on a user-driven turn.
- **Review economy.** No CI theater: one independent review per PR head, then delta re-reviews only. Use Sonnet for
  tools-only and docs-only diffs and Opus where `apps/`, `packages/` or `mars/` change or the change alters the merge
  pipeline itself; proof is exactly the policy tier, and passing checks are never re-run.
- **Queue head.** The train has no rebase token, so the steward merge-forwards only the queue head when it falls
  behind main. A labelled PR whose required checks have not started within 15 minutes yields the head: the steward
  removes `merge:ready` and relabels it when green.
- **Landing mode.** The train lands reviewed T0–T2 PRs non-strict when green on their own head and mergeable, and
  strict (rebase and re-test) for T3/T4, engine paths, the lockfile, baselines, conformance and workflows. Everything
  is strict while main's full-scope CI is red or unproven, and every push to main runs full-scope CI (#813).
- **Stacked PRs.** When a base squash-merges, GitHub retargets the dependent PR to main, and if it is mergeable it
  lands as is. Only on a conflict does the lane re-cut it from main as a replacement PR, reviewed as a delta against
  the old head; force-push is never used, and stacks stay shallow.
- **CI capacity.** At onboarding, record the account's concurrent-job cap and per-PR CI duration; with several lanes
  the Actions queue, not the train, bounds throughput. Workers push once per bounded step, and per-PR workflows
  cancel superseded runs (#777).
- **Congestion.** The steward may cancel queued runs of non-required workflows, and queued `ci`, proof and changelog
  runs of drafts and of PRs stacked on unlabelled bases. It never cancels runs on main, of labelled PRs, of PRs based
  on main or of the queue head.
- **Heavy runner.** The repository variable `CI_HEAVY_RUNNER` selects the self-hosted runner (#816). The steward
  turns it on when more than 8 `ci` runs are queued, or the queue head's checks have not started in 20 minutes, and
  the runner is online; off when the queue drains, the runner is offline or a quiet measurement window is needed.
  Watch the first flip for environment failures.
- **Harness limits.** Claude Code's auto-mode classifier refuses agents editing permission or hook settings,
  applying approval labels or asking another session to, force-pushing, cancelling runs in a loop and some CI-config
  changes. The maintainer adds narrow allow rules to the gitignored project settings (`Agent`, `SendMessage`,
  `Monitor`, `CronCreate`, `gh`, the state-writing interpreter, `merge:ready`, `gh run cancel`); until a permission
  dialog in the coordinator session is answered, every lane stalls.
- **Sessions and scratch.** A superseded worker session receives only stop-and-hand-over messages, since new work
  would make it a second writer. Workers use per-PR file names in shared scratch, and briefs require sliced reads of
  long issues.
- **Private state.** The manifest, `STATE.json` and decision log under the private bootstrap record each lane's
  identity, budget, hours, branches and handles, a parked lane's resume trigger, and the generator and location of
  the private progress dashboard.

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

## Sustaining lanes

These rules bind in every harness. A lane is either running or has a handoff the coordinator will be woken for. On
every wake, the coordinator reconciles every lane before ending its turn. An idle lane is a coordinator failure,
not a worker failure.

- **Whole queue.** A worker brief gives the lane's whole ordered queue, not one task. After posting a task's
  checkpoint, the worker continues to the next bounded task. It ends its turn only on a blocker that needs a
  decision or capability it lacks, on nearing its context limit (after a checkpoint and a handover brief), on a
  budget gate, or on an empty queue.
- **No blocking dialogs.** Workers never open a question dialog that waits for an answer. They decide routine
  questions and record the choice. Scope or ordering questions go to the coordinator as a message while the worker
  continues. The coordinator takes product questions to Gene with a recommendation, parks only the dependent item
  and keeps the lane on its next independent task.
- **Review through the PR.** Review findings reach workers as PR comments. Workers read their PR comments at every
  safe boundary; the coordinator routes only what is blocking.
- **Immediate refresh.** When a worker hands over, the coordinator relaunches the lane in the same turn. Lane
  identity, budget, hours and branch persist in the coordinator's private state, whichever executor runs the worker.
- **Slice long issues.** Workers read long parent issues in slices (for example `gh api … --jq` on the fields or
  comments they need) or through a read-only helper, never whole. Workers that loaded whole parent issues have
  exhausted their context in under an hour.
- **Repo steward.** Mechanical repository work belongs to a standing workhorse worker, the repo steward, that wakes
  on PR changes, not to the frontier coordinator: review dispatch, merge-queue labelling of reviewed T0–T2 PRs, CI
  and merge-train triage, and release-candidate summaries. The steward never deploys or runs a paid gate.

### Claude Code

- Lanes are separate sessions started with `start_session`: fresh context, the workhorse model, and their own
  worktree, or the shared checkout with one worktree per lane.
- A session can be started only on a turn the user began; under Remote Control, event-triggered turns refuse it.
  The fallback is a `lane` subagent inside the coordinator session. It can be steered and resumed through messages,
  but it is invisible in the sidebar and ends with the coordinator session.
- The app continues the coordinator only when every child session is idle. The coordinator therefore subscribes to
  each lane's idle notice with `notify_when_idle` on every message it sends.
- The coordinator and the steward each keep a `Monitor` armed on PR-change events as the heartbeat, with a 30-minute
  expiry re-armed each time. No cron, no scheduled agents.
- Cross-session messages are addressed by session title with a ref; workers address the coordinator by its session
  name.
- The auto-mode permission classifier can refuse routine commands in event-triggered turns. The fix is a narrow
  allow rule in `.claude/settings.local.json` (ignored by git), never a broad one. A worker must not ask another
  session to run a command it was refused.

### Codex

The Codex equivalents are to be verified at first use: sub-agent or session controls, an idle notification and a
bounded wait primitive. Until they are verified, treat the harness as able to run only the whole-queue and
no-dialog rules above, and record what it actually offers in the private manifest.

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

---
name: coordinator-handoff
description: Pause the Souls development coordinator and hand the running agenda to a fresh coordinator in any harness (Claude, Codex, other), or take one over. Use when Gene says to hand off, migrate, switch provider, or that usage is about to run out, or when a takeover prompt names this skill. Not for a first-time orientation; that is the fresh-session starter in docs/process/development-coordinator.md.
---

# Coordinator handoff

The Souls-specific layer over a generic session handoff. The rules it applies live in
[development-coordinator.md](../../../docs/process/development-coordinator.md) (handoff, start or resume),
[coordinator-portability.md](../../../docs/process/coordinator-portability.md#provider-neutral-handoff) and
[coordinator-memory.md](../../../docs/process/coordinator-memory.md). Read those for the why; this file is the
checklist. Two halves: **Pause** (outgoing) and **Resume** (incoming).

Private folder (ignored, never published): `.local/project/coordinator/` with `STATE.json`, `DECISIONS.md`,
`MANIFEST.md`, `gene-morning.md`, `briefs/` and `handoffs/`. Public coordination issue: the agenda issue named in
`STATE.json` (currently #755). Public text never carries local paths, usernames, host names or session handles
([publication privacy](../../../docs/process/publication-privacy.md)).

## Keep it cheap: always-current records

A handoff is fast only if these are kept current during normal work, not written at the end:

- `briefs/<lane>.md`: the full brief that would relaunch each lane, steward and release owner right now: queue in
  order, handover facts (PRs, heads, worktrees, staged proof), protocol, rules. Rewrite it whenever you relaunch.
- `STATE.json`: lanes, executors, PR states, release state, pending Gene decisions.
- `DECISIONS.md`: every consequential direction from Gene, dated, with what it supersedes.

## Pause (outgoing coordinator)

Trigger: Gene says so (for a usage limit, around 98%, stopping by 99%). Start no new items from this point.
Workers run on the same quota and stop when the session does, so they must reach checkpoints first.

1. **Announce** to Gene in one line, with EST deadlines: workers checkpointed by T+25 min, packet written by T+40.
2. **Inventory now** into `handoffs/<YYYYMMDD-HHMM>/INVENTORY.md`: every worker (lane, steward, release, reviewers),
   background shell, watcher and heartbeat; every worktree, branch and head you know; anything running elsewhere
   (a gate on Modal in Gene's terminal, CI runs, merge-train runs). It is the fallback if the session dies.
3. **Wind down workers.** Send each one:
   > Handoff in progress. Finish the step you are on and reach the nearest checkpoint within ~20 min; start nothing
   > new. If your PR can be marked ready in that time, do it. Otherwise push your branch (a WIP commit if needed,
   > never git stash) and post a checkpoint comment on your issue: done (with evidence links), the exact next step,
   > staged proof and its local location, open findings. Don't cut a Soul Run between arms; finish or abandon the
   > whole 2×2 and say which. Then hand back with the PR table (number, head, tier, state) and stop.

   The steward posts its checkpoint on the coordination issue and hands back with its owed list. The release owner
   records the exact release state (candidate SHA, receipts, gate in flight, next command) in its handoff notes.
   Never cancel CI, a gate or a merge-train run to make the switch tidy; record it and let it finish.
4. **Refresh the records** from the hand-backs: `briefs/<lane>.md` (with each lane's new handover), `STATE.json`,
   `DECISIONS.md` (today's directions), `gene-morning.md` (what waits on Gene), `MANIFEST.md` (new lessons).
5. **Write the packet** `handoffs/<ts>/HANDOFF.md`, one page where possible:
   1. Gene's standing directives that a fresh agent would get wrong (quote; point to DECISIONS.md for the rest).
   2. Agenda and authority: lanes and their priority, delegated sign-offs, what still needs Gene.
   3. Lanes table: lane | brief file | PRs and heads | state | next step.
   4. Merge train: order, what is merge:ready, known bounces.
   5. Release: owner, candidate, receipts, what is running, the next command and who runs it.
   6. Open decisions for Gene, and any classifier refusals not worked around.
   7. Gotchas from today (environment, tooling, CI capacity).
   8. Reading order; the raw transcript path for lookups only.
   Also `INVENTORY.md` (final) and `PROMPT.md` (the takeover prompt below). Cold-read it as a stranger: every path
   absolute, nothing that depends on this conversation.
6. **Publish the sanitized checkpoint** on the coordination issue: Now / Next / Needs Gene, PR numbers and states,
   no local paths or handles.
7. **Terminate**: stop watchers and the heartbeat, confirm no worker is still writing (a worker that hasn't handed
   back by the deadline is recorded as "cut off" with its worktree state), then give Gene a 3-line summary and
   exactly one fenced block with the takeover prompt. Nothing after it.

Takeover prompt template (fill every `<>`):

```
You are now the Souls development coordinator, taking over a running agenda from a previous coordinator session
that paused at <EST time> for a provider switch. Gene authorizes you to resume this agenda immediately: this is a
migration, not the orientation-only first launch. Working root: <abs path to repo>.
Read, in order: AGENTS.md, .claude/skills/coordinator-handoff/SKILL.md (Resume), then
<abs path>/HANDOFF.md and INVENTORY.md in the same folder.
Verify before acting: main at <sha>; open lane PRs and heads as listed; the release state (<one line>).
Reply first with a 5-line read-back and any mismatch, then resume: relaunch the lanes from their brief files, re-arm
the PR watch and your heartbeat, and continue with next step #1: <one line>.
Standing directives: <the 3-4 that matter most, verbatim>.
The previous workers are gone; their branches, worktrees and issue checkpoints are the record.
```

## Resume (incoming coordinator)

1. Read the packet in the order the prompt gives. Treat it as a report: confirm against live state with
   `node tools/coordinator/status.mjs --since <pause time>`, the PR heads, the release receipts and `git worktree
   list`. Note any mismatch in your read-back.
2. Confirm the previous coordinator and its workers stopped (INVENTORY.md; no new pushes to their branches since the
   pause). Never run two writers on one worktree.
3. Relaunch each lane, the steward and the release owner from `briefs/<lane>.md`, updated with the handover from its
   issue checkpoint. Use your harness's native worker mechanism ([sustaining lanes](../../../docs/process/coordinator-portability.md#sustaining-lanes));
   record the new handles under `native_bindings` in STATE.json. Don't redo finished side effects or valid proof.
4. Re-arm the PR watch and a heartbeat for this harness. The previous heartbeat died with its session.
5. Tell Gene in a few lines: what you resumed, what is running, what waits on him. Then continue the agenda.

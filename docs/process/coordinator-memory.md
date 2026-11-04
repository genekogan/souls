# Coordinator memory and recovery

The [coordinator](development-coordinator.md) must be replaceable without replaying a chat. Keep three small private
records, discovered through the local bootstrap (SOULS-LOCAL.md where provided). They are ignored local files,
never tracked source or public attachments. Repository instructions describe the format, not real executor bindings.

| Record | Purpose |
|---|---|
| MANIFEST.md | Stable operating preferences, authority boundaries, record locations, recovery order and start prompt. |
| STATE.json | Current agenda and assignments, pending decisions, running jobs, release ownership and next actions. |
| DECISIONS.md | Dated consequential directions, source, what they supersede and why; link old entries from current state. |

GitHub remains the source of task acceptance, PR review/proof and release records. Private state stores orchestration
and pointers, not copies of every ticket or a competing completion ledger. Personal preferences and operational
bindings stay private; share only relevant sanitized decisions. Do not copy the full manifest to each worker.

## State contract

Use a versioned JSON object with `schema_version`, monotonically increasing `revision` and `updated_at`. Use null
for unknown facts, never a fabricated success, quota, timestamp or worker. Include:

- `owner`: session handle if available, active/handoff-ready/stopped status and observation time. An owner record
  is not a distributed lock or proof that its session is still alive.
- `agenda`: coordination issue, ordered authorized outcomes, exclusions, endpoint, review stops and next dispatch.
- `policy`: decision-log references, worker ceiling, model routing, spending/merge/release authority and quota sources.
- `lanes`: task/PR refs, neutral lane ID, actual worker handle/model/executor, state, last observation, branch/base/head,
  private workspace, evidence/checkpoint refs, jobs/resources held and exact next action. Mark unknown liveness unknown.
- `pending_decisions`: ID, question/recommendation, source/head, blocked scope, asked-at, options, reply and resume condition.
- `release`: appointed owner, candidate/head, freeze/lock/receipt pointers and approval scope/consumption. Revalidate
  these authoritative records before any release action; a cached snapshot grants no authority.
- `handoff`: outgoing owner status, preserved WIP/jobs, next actions, missing capabilities and decisions needed.

Keep observation time separate from file update time: updating another field must not make an old job look live.
Use consistent lane states such as running, waiting-job, waiting-decision, parked, review-ready, done and unknown.
Preserve branch/head and outstanding checks when parking; never call parked work finished. Record provisional
dispatch intent before spawning, then the returned handle immediately, so interrupted dispatch can be reconciled.

## Write and recover

Only the current coordinator writes these records; workers return checkpoints to it. Before saving, verify the
expected owner/revision. Write a temporary file in the same directory, parse it, then atomically rename it over
the snapshot, retaining one previous valid snapshot. This guards against partial writes, not competing owners:
resolve an ownership mismatch instead of racing it. Keep secrets out of these records too; credential tools read
their own credentials.

Update on material events: accepted direction, dispatch, changed blocker/estimate, decision/reply, PR handoff,
merge/release or coordinator transfer. Long jobs need occasional evidence-based observations, not constant model
polling or meaningless heartbeat writes. Maintain the compact current state and link history; do not append a
transcript indefinitely. On a normal stop, mark handoff-ready only after documenting surviving workers and jobs.

A fresh coordinator:

1. Reads repository rules, local bootstrap, manifest and state; reads only the referenced recent decisions.
2. Confirms the outgoing coordinator stopped or handed off. Age alone is not permission to take over. If uncertain,
   inspect liveness through available tools; keep contested resources untouched while resolving ownership.
3. Checks referenced PR heads, worktree changes and active jobs/claims. Reconciles provisional dispatches before
   launching replacements. A missing chat handle does not mean a shell job stopped.
4. Preserves artifacts and existing receipts; resumes with a new owner/revision and a compact Now / Next / Needs Gene
   checkpoint. Do not rerun proof solely because the provider changed.

If JSON is invalid, retain it, recover the previous snapshot and reconcile against actual jobs/GitHub before acting.
If private context is unavailable (for example in a fresh cloud environment), do not infer that no work is running.
Request a minimal handoff through an approved private channel, or recover public scope and perform only work that
does not contend with uncertain ownership. Never upload device bindings to an issue to solve a transfer problem.
Portable recovery requires access to these records or that handoff; a local file is not automatically synced to cloud.

## Recovery checks

Before declaring the handoff usable, verify that another session can locate the manifest from bootstrap, parse state,
identify the next action and distinguish reported facts from observed facts. Exercise: a pending Gene decision with
another lane available; a changed PR head after approval; an interrupted spawn; and an old owner with a surviving job.
These are checks of the handoff, not authorization to launch a new gate or feature worker.

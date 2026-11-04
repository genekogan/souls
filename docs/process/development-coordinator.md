# Development coordinator

One coordinator is Gene's interface for an authorized development agenda. It owns intake, ordering, worker
assignments, integration and release handoffs. Workers own bounded issues through their assigned endpoint.
This is a role followed by an active session, not a scheduler or a new service. Follow [planning](planning.md),
[the lifecycle](agent-lifecycle.md) and [the owner playbook](owner-playbook.md).

## Start or resume

Read AGENTS.md and these process documents; inspect current main, open claims/PRs and the existing coordinator
checkpoint. Confirm whether another coordinator or release owner is active before assuming their responsibilities.
Recover existing branches, jobs, evidence and approvals before dispatching anything. Do not repeat a broad audit
or search an exhausted history just because the session changed.

Keep one coordination issue for the current agenda, linking existing issues and PRs. Its latest dated checkpoint
records priorities in order, authorized outcomes, exclusions, worker ceiling, resource/model budget, review stops,
merge/release authority, active assignments, next dispatch and concrete decisions needed. Link completed records;
do not copy their logs. Put private executor bindings and handles in approved private records, never public issues.
A checkpoint must distinguish running, waiting, blocked, ready for review, merged and released.

Persist consequential user directions as a dated decision in that issue before relying on them across sessions.
The latest explicit direction wins; identify what it supersedes. Put enduring project conventions in reviewed repo
docs, not a growing worker prompt. Do not publish private conversation or operational details. New sessions read
this small agenda plus relevant issue evidence, not the entire conversation history.

## Intake and dispatch

1. Translate new requests into outcomes and acceptance; search related issues, actual code and existing PRs first.
   Create or refine a ticket. A feature idea alone does not authorize implementation outside the agreed agenda.
2. Select a small ready queue in priority/dependency order. Prefer useful single-digit-hour deliverables, including
   proof. Split larger outcomes without silently discarding scope. Sequence shared-contract changes before consumers.
3. Compare likely touched code, assumptions and scarce resources with active work. Prefer orthogonal lanes. If work
   is coupled, serialize it or agree a small interface and explicit parent revision; do not invent permanent departments.
4. Assign one writer per isolated worktree and test-data/port set. Reuse read-only assets and caches. A GitHub claim
   is a record, not a lock: confirm the actual writer before reusing an assignment or workspace.
5. Dispatch through capabilities actually present. Child agents, independent provider sessions and remote shell
   executors are different capabilities. Verify authentication, isolation, browser/proof access and capacity; report
   a missing capability precisely. Never claim a worker is running merely because its ticket is assigned.

An explicitly authorized agenda permits rolling dispatch within its scope and worker ceiling, without asking Gene
about each issue. Opening an issue, adding a label or restarting a session does not authorize a new agenda. No
scheduled launches or background polling agents. Use an available goal for a bounded agenda, not “finish the project.”
If the executor cannot continue unattended, checkpoint that limitation honestly.

## Assignment packet

Send each worker only this compact contract, plus relevant source/evidence links:

- Issue and acceptance; authorized endpoint (normally reviewed PR), exclusions and requested review stops.
- Repository revision, isolated branch/worktree, dependencies or parent PR, and existing work to reuse.
- Likely touched contracts and other owners to consult only if those contracts change.
- Read AGENTS.md, the lane role and relevant lifecycle/proof rules; follow the agenda's dated policy decision.
- Required focused checks/proof, approved executor/resources, budget and stop conditions.
- Merge/deployment authority (none unless explicitly delegated), and where to return the PR/checkpoint.

Private bindings travel through an approved private channel. A worker reads the actual issue and current code,
records acceptance before edits, and continues through tests, proof and review corrections. It asks Gene through
the coordinator before substantial scope expansion or out-of-scope prerequisites. Routine in-scope fixes proceed.
Required independent diagnosis/review uses the same capacity budget; workers must not recursively grow a pool.

## Operate with little coordination

Reconcile at dispatch, completion/blockage, changed shared contracts and integration. Do not repeatedly rebase or
interrupt independent workers as main advances. Workers fix ordinary rebase conflicts; the coordinator resolves
semantic dependencies with the affected owners. Integrate foundations before dependent PRs and run checks affected
by the actual combined change. Preserve valid evidence and failed results; shared-file overlap is a signal, not
proof that work must stop.

The worker ceiling is a maximum, not a utilization target. Count review workers and other known active owners
when assessing actual resource contention. Reserve review capacity or finish an implementation before launching
review. Honor actual executor limits even if Gene requests more lanes. Workhorse models are the default; use cheap
models for mechanical checks and frontier models only for a bounded hard question. Unknown quota is unknown, not
permission for unlimited use; follow the agreed fallback/budget policy without silently buying API capacity.

When priorities change, reorder unstarted work first. Tell affected workers the changed requirement at a safe
boundary; preserve useful WIP. Reducing capacity drains excess lanes; pause means no new dispatch. A stop request
requires recoverable checkpoints and safe handling of any activation. Do not restart unaffected workers.

## Integrate, ship and hand off

Review qualified PRs and queue merges only within existing authority. T3/T4 maintainer approvals, proof requirements
and release limits remain binding. The coordinator either serves as explicitly appointed release owner or hands
ready changes to that owner; there is only one owner of an active release head. A worker cannot launch a paid gate
or deploy merely because it finished its issue. Follow [release](../release.md), including freeze/lock checks,
exact-head receipts, staged deployment, live verification and truthful publication.

Report meaningful changes in a compact Now / Next / Needs Gene checkpoint, with actual worker count and ETA ranges
when evidence supports them. Separate the next PR/release from the whole agenda. Do not refresh unchanged status or
infer liveness from an old heartbeat. Completion means the agreed endpoint, not a draft PR or a closed issue alone.

Before replacing the coordinator, leave the agenda checkpoint, PR/head refs, evidence, failures, active jobs,
remaining authority and exact next action. Confirm the old owner stopped before takeover. Preserve ongoing gates
and builds; a provider switch is not a reason to restart them. If every remaining item requires a missing decision
or capability, report that specific blocker and stop dispatch instead of manufacturing more work.

## Fresh-session starter

Paste this from the repository root, adding your current priorities:

> Act as Souls development coordinator. Read AGENTS.md, docs/process/development-coordinator.md and
> docs/process/owner-playbook.md. Recover the current agenda, active assignments, PRs and release ownership;
> do not duplicate workers or restart existing jobs. Treat my priorities below as the authorized agenda.
> Create or resume a bounded goal for that agenda if supported. Start with up to two concurrent workers,
> within actual capacity and existing budget rules; use workhorse models by default. Choose independent
> lanes, give each the documented assignment packet and carry issues through reviewed PRs. Queue qualified
> merges within repository rules; preserve maintainer approvals and existing release authority/gate limits.
> Intake my new requests and persist changed priorities and preferences. Ask only for missing decisions,
> access or material scope expansion; keep independent authorized work moving. Give me a compact initial
> Now / Next / Needs Gene report, then execute. No scheduled agents or paid API fallback.
>
> Priorities: [name the issues or outcomes and exclusions here].

The priority placeholder must be filled or recovered from an existing authorized agenda before dispatch. A fresh
session with no agenda should inventory and propose the next bounded batch, not consume the entire backlog.

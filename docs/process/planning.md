# Planning and intake

For requests, review and changing worker capacity in plain language, use the [owner playbook](owner-playbook.md).

The issue is the unit of responsibility; the PR is the unit of integration. A maintainer gives an outcome,
bug report or priority in ordinary language. The development owner finds existing work, records the request
and takes care of task selection and integration within that authorization.

## Where information belongs

| Information | Home |
|---|---|
| Product principles and long-term possibilities | [Vision](../design/vision.md), design documents and [decisions](../decisions/README.md) |
| Direction and unresolved product questions | [Roadmap](../design/roadmap.md), linking to relevant parent issues |
| A concrete investigation, decision, bug or feature | GitHub issue: outcome, acceptance, exclusions, dependencies and proof tier |
| A larger outcome | Parent issue with independently reviewable children, created as they become concrete |
| Implementation, checks and proof | PR and its linked artifacts |
| What is live | Release/tag and deployment receipt, not the issue's open/closed state |

An aspiration does not need an issue for every imagined feature. Promote it when there is a useful next decision,
investigation or implementation to assign. Keep speculative alternatives and non-goals in the design doc.
Roadmap themes are not delivery dates or authorization. Do not maintain a second task-status table in the repo.

## A small ready queue

An issue is ready when its desired outcome and acceptance are clear, the required evidence is known, dependencies
permit work and the necessary resources and authority exist. `agent:ready` means these conditions hold;
`agent:claimed` records that someone is working on it. Imported or old issues need a current-main check before
they become ready. An old failure is a finding to verify, not proof that a rewrite is needed.

The owner selects a few issues by user impact, urgency, cost and what they unblock. Check open PRs and claimed
issues for overlapping contracts, assumptions and resources before dispatch. Prefer fewer workers with independent
outcomes over filling every available slot. Keep coupled changes sequential or agree their interface first.
The [workflow](agent-workflow.md) describes isolation and integration; the [lifecycle](agent-lifecycle.md)
defines required proof. These checks remain the same for a five-minute fix and a multi-day investigation.

Tranches are useful groupings for product intent, review and changelogs. A temporary owner can coordinate genuinely
coupled work; permanent agent departments and a custom orchestration service are not required. Architecture
contracts are durable; the agents assigned to them need not be.

## Bounded execution

An issue worker owns the requested outcome, not an open-ended engineering domain. Record the authorized endpoint
(for example, a reviewed PR or a released change), acceptance and exclusions before editing. Prefer slices that
normally take a single-digit number of hours including relevant checks and proof. This is a sizing guide, not a
deadline or permission to omit evidence. Split larger outcomes into useful, independently reviewable slices; do not
silently narrow the requested result or open every speculative child up front.

Finish one active implementation before pulling another. A completed PR waiting for Gene's batch review does not
prevent the next independent authorized item. Keep necessary stacks shallow and explicit; do not build on an
unresolved product assumption. Review findings and routine compatibility repairs within the acceptance belong to
the current task. Optional cleanup, general frameworks and substantial out-of-scope prerequisites need Gene's
approval before implementation. Explain the exact blocker, smallest addition and cost; continue independent
authorized work while that decision is pending. Record unrelated findings without starting them.

For sustained work, use the executor's available goal mechanism with this same bounded endpoint. Resume an existing
goal and jobs rather than creating duplicates. If no goal mechanism is available, use the issue checkpoint; do not
claim unattended continuation has been enabled. Continue through routine milestones, focused checks, proof and
review corrections without asking whether to continue. Stop at the endpoint, a requested review stop, an actual
blocker needing access/decision, or the agreed budget. Record whether a time limit means active work or elapsed time;
never substitute one for the other. A goal is complete only when its endpoint is met, and conveys no extra merge,
release, spending or approval authority. A prepared T3 PR may await maintainer approval while independent batch work
continues; the approval requirement itself is unchanged.

The development/release coordinator selects independent work, dependency order and release contents. Workers own
their issue, checks, review fixes and routine rebase repairs. Check coordination at dispatch, changed shared contracts
and integration; do not continuously synchronize independent branches or repeatedly rebase just because main moved.
Escalate semantic conflicts to the coordinator and relevant owner; text-only merge success is insufficient. If no
coordinator is assigned, a worker finishes its bounded assignment and records an integration handoff without
self-appointing as release owner. Only the appointed release owner freezes and qualifies a release head.

## Portable execution and handoff

Claude Code and Codex follow the same AGENTS.md, lifecycle and Markdown skills. Provider memory and local chat
history must not be the only record of a decision or unfinished work. Before stopping or switching owners, leave
a short issue/PR checkpoint with:

- Branch and base/current SHA; durable WIP ref or recoverable patch.
- Acceptance already met, unresolved assumptions, failed/unverified checks and evidence links with environment identity.
- Active jobs, output locations and resources in use; put private operational details in approved private records.
- Next action, blockers, approvals and stop conditions.

For long work, include an ETA range with its scope, confidence and observation time, or state what prevents an
estimate. Update when new evidence changes the result, blocker or estimate; do not spend model turns refreshing
unchanged status. The proposed [private project overview](../design/project-visibility.md) renders these checkpoints
and links existing proof. It is not a second task database or a scheduled agent. Keep execution, review and approval
distinct using [contribution attribution](contribution-attribution.md).

Confirm the outgoing writer has stopped before reusing its workspace. Resume existing jobs and valid evidence;
switching provider is not a reason to repeat a gate, rebuild unchanged artifacts or discard work. A claim label
is not an atomic filesystem lock: the owner confirms the assignment before starting competing writers.

Use cloud execution for ordinary implementation/tests when its actual setup and access have been demonstrated.
Use laptops for required native/browser/audio proof and quiet measurements; use Modal for the authorized release
gate. Share read-only assets/caches, isolate mutable data and ports, and serialize scarce measurement resources.
Clean up a workspace only after its source and evidence are durable and its owner has finished.

Use a workhorse model by default, a cheaper model for narrow mechanical work with objective checks, and a frontier
model for a specific ambiguous or unusually hard question. Honor the maintainer's model/quota policy; verify actual
availability and authentication. Unknown usage is not zero. Cross-provider delegation is optional, bounded and
recorded; never silently fall back to separately billed API access or start recursive worker pools.

## Close the loop

Report merged and released separately. Close an issue only when its acceptance is evidenced, or explicitly record
why it is superseded/not planned. Split partial outcomes or link remaining criteria instead of marking them done.
Keep historical findings intact with a prominent superseding note where necessary. A failed or missing proof
remains failed or unverified after the paperwork changes.

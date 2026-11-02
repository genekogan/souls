# Running development

Give the development owner the outcome and priority in chat, or open a GitHub issue. You do not need to set up an
agent or choose a branch. The owner finds related work, records acceptance, selects independent tasks and reviews
their integration. [Planning and intake](planning.md) describes the underlying records.

## Requests and priorities

| Say this | What happens |
|---|---|
| “A standing Soul refuses dance here; fix it.” | Find or create a bug issue, reproduce it, define acceptance and claim a bounded fix. |
| “I want reusable custom bodies; plan it first.” | Record the design and unresolved decisions; create concrete next issues without authorizing implementation. |
| “Prioritize the navbar over construction.” | Reorder unclaimed ready work; checkpoint affected active work before moving its owner. Preserve branches and proof. |
| “Take this larger outcome through release.” | Split independently reviewable issues, identify dependencies and carry qualified changes through the release process. |

An issue is a proposal until its outcome, acceptance, dependencies and authority permit work. `agent:ready` is the
dispatch queue; `agent:claimed` means an owner is working on it. Before dispatch, check existing claims and PRs for
shared files, contracts, assumptions, ports and measurement resources. Coupled changes need an agreed interface or
sequential integration. A claim is not a filesystem lock: each writer gets its own branch/worktree.

## Follow progress and review

The [private overview design](../design/project-visibility.md) groups **Now**, **Next**, **Needs you** and **Recently
shipped**. Until its implementation is deployed and access-verified, use the linked GitHub issues, PRs and releases.
An overview is a view of those records, not another place to maintain task state.

A useful checkpoint says what changed, what happens next, its blocker, and an ETA range with an observation time
and assumptions. Unknown is better than an invented date. An unchanged checkpoint does not become fresh when a
collector fetches it again. Ask for the next release ETA separately from completion of the broader roadmap.

Open a PR's acceptance and proof before approving it. Visual journeys need uncut, real-speed footage; still images
do not prove motion. Ask for a correction against a particular criterion or moment in the clip. Failed and missing
checks stay visible. A merge means the code is on main; a release receipt and live verification establish that it
is running. See the [lifecycle](agent-lifecycle.md), [proof policy](PROOF-POLICY.yml) and [review rules](review.md).

## Change the pace

“Use up to four workers on the ready queue” sets a ceiling, not a requirement to fill it. The owner reports actual
active workers and available executor capacity, starts independent work, and keeps shared release/measurement
resources serialized. Count separately owned work, including performance investigations, when judging contention.
Do not silently interrupt another owner to free capacity.

“Reduce to two” stops new dispatch and checkpoints/drains excess workers at safe boundaries. “Pause new work” lets
existing work reach a recoverable checkpoint. “Stop now” interrupts execution, then checks active processes and
leaves exact resume instructions; a production activation still needs a safe recovery decision. None of these
instructions authorizes deleting unfinished work, skipping checks or abandoning an active deployment unsafely.

Use a workhorse model for ordinary implementation, a cheaper model for mechanical work with objective checks,
and a frontier model for a bounded hard question. Report provider usage independently: source, observation time,
quota/reset if available, and unknown fields. Unknown usage is not zero; one provider's meter cannot measure another.
Do not silently switch to paid APIs. Preserve the agreed gate/spend limits and start no scheduled agents.

## Execute and switch tools

Cloud is the default once a clean task's setup, access and checks have actually worked. Use laptops for needed
native/browser/audio proof or quiet measurements, and Modal for authorized release gates. Follow
[development setup](../development.md) and [focused testing](../testing.md); reuse assets and passing evidence.

Claude and Codex use the same repository instructions and issue/PR records. Before switching, checkpoint the branch,
base/head SHA, durable WIP, met acceptance, failed/unverified checks, proof, active jobs and next command. Keep private
operational details in approved private records. Confirm the outgoing writer stopped; resume existing jobs rather
than rebuilding or restarting a gate because the model changed. See [portable handoffs](planning.md#portable-execution-and-handoff).

## Ship and recover

The release owner follows [release and rollback](../release.md), preserving exact-head gate evidence, required
approvals, staged activation and live verification. A ready PR is not deployment permission. Automated release
qualification and the established manual path are distinct: use the documented qualified path while automation
still lacks configuration or receipts. [Operations](../operations.md) and [disaster recovery](../operations/disaster-recovery.md)
cover service recovery; do not expose credentials in issues or ask the owner to paste them into chat.

V1 acceptance is recorded in [#554](https://github.com/genekogan/souls/issues/554) and
[#594](https://github.com/genekogan/souls/issues/594): usable intake/claims/proof, a real cloud task, a recoverable
executor handoff, concurrent independent tasks, overview access verification, and the actual release path. Mark each
completed, explicitly deferred or blocked with the missing capability. This page alone does not pass those checks.
Full engine extraction, new body features and experience-report collection remain separately tracked outcomes.

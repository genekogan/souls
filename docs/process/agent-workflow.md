# Agent workflow

Several coding agents (and people) can work on Soul concurrently. A development owner selects independent work
and handles dependencies; repository conventions isolate changes, and the merge train serializes integration.
[Agent lifecycle](agent-lifecycle.md) is the path one piece of work takes; this page is how many of them share the
repository. The [coordinator contract](development-coordinator.md) defines intake, rolling dispatch and recovery.

## Working in parallel

- **An issue records a claim.** Before starting, an agent assigns the issue to itself (or to the person running it) and adds
  the `agent:claimed` label. Record the active worker/session and scope in a comment. Nobody else starts on a claimed issue;
  confirm the outgoing writer has stopped before takeover. A label is not an atomic filesystem lock. Pick from
  issues labelled `agent:ready`. Unclaim (remove the label, unassign) when you stop without a PR.
- **One branch per issue:** `agent/<issue>-<slug>`, for example `agent/412-reading-seat`, cut from the current
  `origin/main`. One worktree per branch when several agents share a machine. Never commit to `main`, never
  force-push a branch someone else is reviewing.
- **Small PRs.** A PR does one thing and can be reviewed in one sitting. A large issue is split into issues that each
  merge on their own; link them from a `type:epic` issue.
- **Feature flags for unfinished work.** Work that is not ready for visitors merges behind a flag that defaults to off,
  rather than living on a long branch. Remove the flag in a follow-up once the feature ships.
- **Plans live in issues.** Briefs, status and findings go in the issue and its comments, never in files in the tree.

Before dispatch, inspect open PRs and claims for shared contracts and assumptions. Sequence coupled changes or
agree the interface first; a text merge can succeed while semantics conflict. Use separate mutable data and ports,
share read-only assets, and reserve quiet measurement slots. Reuse a clean workspace after preserving its prior
work. Record source, evidence, active jobs and the next action at handoff: [planning](planning.md).

## Conventions that avoid conflicts

Two PRs that both append to one shared file conflict every time. So nothing a PR routinely adds goes in a shared file:

| Instead of | Do |
|---|---|
| editing `CHANGELOG.md` | add one fragment, `changes/<pr-or-slug>.md` ([format](../../changes/README.md)); the `release` workflow compiles the fragments into `CHANGELOG.md` |
| editing an existing conformance record | add a new supplement for your change in `packages/conformance/conformance/` ([conformance](../../packages/conformance/conformance/README.md)); older supplements are never edited |
| committing generated output | let CI build it: the changelog, the web build and gate receipts are produced by workflows, not committed by PRs |
| re-pinning a baseline inside a feature commit | regenerate the walk or bundle baseline (`--write`) in its own commit, with the reason in the message, after rebasing |

## The merge train

When a PR is ready, label it `merge:ready`. From there the train takes over, one PR at a time:

1. **Rebase** the branch onto the current `main`.
2. **Re-test**: the required checks (`ci-ok` from the `ci` workflow, `gitleaks`, `path-guard`, `scrub-guard`,
   `proof-ok` and `fragment`) run on the rebased head, and the train waits for them there (a personal-account repo
   has no GitHub merge queue; `merge-train.yml` is the queue), so `main` never gets a commit tested only against an
   older base.
3. **Merge**, by tier ([PROOF-POLICY.yml](PROOF-POLICY.yml), `node tools/proof/tier.mjs`):
   - **T0–T2** merge automatically once every required check is green.
   - **T3–T4** wait for the maintainer's approval, then merge.

   The maintainer gate lives in the required `proof-ok` check, not only in the train: for a T3 or T4 PR, `proof-ok`
   fails until the maintainer's latest decisive review is an approval or, on a PR the maintainer authored (GitHub
   forbids self-approval), until they add `approved:maintainer` themselves (the label's actor is read from the PR's
   events; a label someone else added does not count). Approvals and labels re-run the check. The `main` ruleset
   requires no approving review, so that T0–T2 merge on green; without the gate in `proof-ok`, `gh pr merge --auto`
   would land a T3/T4 PR around the train. The rule is `tools/proof/gate.mjs`; the train reads the same rule only to
   leave unapproved PRs queued. The check trusts GitHub identity, so agents never approve a PR or add
   `approved:maintainer` or `proof:waived`, and never act with the maintainer's account to do so.

   <a id="delegated-sign-off"></a>**Delegated sign-off.** The maintainer may delegate T3/T4 sign-off to the
   appointed development coordinator, recorded as a dated decision on the coordination issue. The gate accepts the
   `approved:maintainer` label only from the maintainer's own account, and a harness may refuse agents applying it
   unless the maintainer has explicitly permitted that command; until then the maintainer adds the label on PRs the
   coordinator presents pre-verified. Independent review, proof at tier, gate caps and spend limits are unchanged;
   destructive production deletes always need the maintainer in person.
4. **On a conflict**, a Claude step tries to resolve it on the branch and re-runs the checks. If it can't produce a
   clean, green rebase, it labels the PR `needs:rebase` and comments with what conflicted; the author rebases by hand
   and relabels `merge:ready`.

A PR that fails a check leaves the train with its result in the PR; fix it and relabel.

## Review

- **A qualified agent reviews every PR.** The current default `claude-review` workflow reviews each non-draft PR against [AGENTS.md](../../AGENTS.md)
  and [PROOF-POLICY.yml](PROOF-POLICY.yml), states the PR's proof tier, and keeps one review comment up to date on
  later pushes. Answer each finding with a fix or a reason.
- **Provider-neutral review.** If the default provider cannot run, an independent Claude or Codex reviewer may
  apply the same [review contract](review.md). Record the exact source SHA, reviewer/model, findings and their
  disposition in the PR. The change's author cannot supply its only review. Preserve the failed provider run;
  a separate review does not turn it into a pass. Do not require duplicate provider reviews. All required status
  checks and T3–T4 maintainer approvals still apply; a required failed status cannot be bypassed by a comment.
- **`@claude` for follow-ups.** Mention `@claude` in an issue, PR comment or review (the `claude` workflow) to ask a
  question, iterate on review feedback or have it push a fix to the PR branch. Only the owner, members and
  collaborators can trigger it.
- **Proof tiers.** The PR states its tier and links its proof: lint (T0); focused tests and typecheck (T1); an uncut,
  real-speed clip of the changed journey (T2, the `proof` skill records it); a scenario playtest, a reviewer-agent
  pass and maintainer sign-off (T3). T4 is the release head. What a reviewer checks: [review](review.md).

## Who starts agents

There are no scheduled agents. Nothing wakes up on a timer to pick issues, open PRs or ship releases. A coordinator's
bounded, expiring in-session watch is a wait, not a scheduled agent
([development coordinator](development-coordinator.md#intake-and-dispatch)). The maintainer
sets priorities and may authorize a development owner to select and start bounded workers within that agenda.
The maintainer still gives the required go-ahead for anything above T2 and for every release. Delegation does not
waive proof, budget or production safeguards. The only automation
that runs on its own is CI (`ci`, `security`, `changelog`, `claude-review`, label sync), which checks work and never
starts it.

## Repository skills and agents

`.claude/skills/` holds the repo's skills as plain Markdown that any agent can read: `triage` (label and reproduce new
issues), `finish` (turn a working change into a finished PR), `proof` (record the tier clip), `e2e` (browser
scenarios) and `sim-director` (direct live Souls). `.claude/agents/` defines the `lane` implementer (one issue, end
to end, to a draft PR) and the `reviewer`.

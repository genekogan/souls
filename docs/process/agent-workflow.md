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

When a PR is ready, label it `merge:ready`. Its heavy CI jobs run only inside the [CI window](../testing.md#ci-window)
(a ready PR labelled `ci:run` or `merge:ready`), so open the window with `ci:run` and add `merge:ready` once `ci-ok`
is green. From there the train takes over, one PR at a time, and first picks how
the PR lands (`landingMode` in `.github/scripts/merge-train.mjs`):

- **Non-strict**: a T0–T2 PR that touches no strict path, whose required checks are green on its current head, which
  GitHub reports mergeable without conflict, and while `main`'s CI is green, is squash-merged as is, even when it is
  behind `main`: steps 1 and 2 are skipped. `main`'s own CI is the safety net for the combination. Adding
  `merge:ready` re-runs label-triggered required checks (`proof-ok`, `fragment`), so while the head's checks are
  pending and could still land it non-strict, the train waits up to 15 minutes before choosing; still pending, it is
  strict.
- **Strict**: everything else goes through the steps below: T3–T4, a head that is not green yet, a conflict or
  unknown mergeability, and the strict paths (`STRICT_PATHS`): the engine (`mars/`, `packages/engine-*`,
  `packages/kernel`, `packages/world-compiler`), `packages/conformance`, `pnpm-lock.yaml`, the walk and bundle
  baselines and `.github/workflows/`.
- **Main red**: every push to `main` and every manual run runs every CI job (`FULL_EVENTS` in
  `.github/scripts/ci-scope.mjs`; pull request runs stay path-scoped). The train merges with `GITHUB_TOKEN`, whose
  pushes start no workflows, so after each merge it dispatches `ci.yml` on `main` (the `ci` concurrency group keeps
  at most one pending `main` run), and merges leave a full-scope run. A narrower green run does not clear a failure: `main`
  stays red from a failed run until a later full-scope run (a manual `ci` run, or one in which
  every qualify job ran) is green, or the failed run is re-run green. With no green full-scope run among the last 50
  runs, `main` is unproven, which counts as red. While it is red every PR is strict, and the train
  says so once per red streak on the coordination issue (repository variable `MERGE_TRAIN_NOTIFY_ISSUE`); a failed
  notice is logged and does not stop the train.

The strict steps:

1. **Rebase** the branch onto the current `main`.
2. **Re-test**: the required checks (`ci-ok` from the `ci` workflow, `gitleaks`, `path-guard`, `scrub-guard`,
   `proof-ok` and `fragment`) run on the rebased head, and the train waits for them there (a personal-account repo
   has no GitHub merge queue; `merge-train.yml` is the queue), so a strict PR never lands tested only against an
   older base. The newest workflow run at the head decides each check. A result from a run that was cancelled, that
   a newer run of the same workflow replaced, or that predates a re-run in progress is ignored, and a `cancelled`
   conclusion counts as pending, never as a failure. Until the replacing run reports, the check is pending within the
   train's bounded waits.
3. **Merge**, by tier ([PROOF-POLICY.yml](PROOF-POLICY.yml), `node tools/proof/tier.mjs`):
   - **T0–T2** merge automatically once every required check is green.
   - **T3** requires coordinator sign-off after the repo steward posts the bar at the current head, except for
     the maintainer-reserved decisions below.
   - **T4 and maintainer-reserved decisions** require Gene's approval.

   The maintainer gate lives in the required `proof-ok` check, not only in the train: for a T3 or T4 PR, `proof-ok`
   fails until the maintainer's latest decisive review is an approval or, on a PR the maintainer authored (GitHub
   forbids self-approval), until they add `approved:maintainer` themselves (the label's actor is read from the PR's
   events; a label someone else added does not count). Approvals and labels re-run the check. The `main` ruleset
   requires no approving review, so that T0–T2 merge on green; without the gate in `proof-ok`, `gh pr merge --auto`
   would land a T3/T4 PR around the train. The rule is `tools/proof/gate.mjs`; the train reads the same rule only to
   leave unapproved PRs queued.

   **Approval matrix (maintainer decision, 2026-11-06).** The development coordinator may sign T3 PRs once the
   repo steward posts the bar at the current head: independent approval, required proof and green required checks.
   This delegation covers all T3 work outside the reserved decisions, not only flag-gated, test-only or low-risk
   changes. The coordinator records the head SHA and the steward's bar in a PR comment when adding
   `approved:maintainer`. Other agents do not grant sign-off; approving reviews and `proof:waived` are not
   delegated by this rule.

   Gene signs T4 and retains these six decision categories:
   1. Production data deletes or restores.
   2. Money: raising model budgets, Modal caps or paid plans, or adding a paid service.
   3. Policy: `AGENTS.md`, `docs/process/PROOF-POLICY.yml`, `docs/process/agent-workflow.md`,
      `.claude/settings.json` and `.claude/agents/*`. Agents may draft these PRs; Gene merges them.
   4. Hosts and accounts: DNS, services that are not Soul's, SSH keys, GitHub organization/plan/settings and bot identities.
   5. Irreversible third-party publishing, such as registry submissions, outreach or posts.
   6. Product decisions Gene has not already made, including design-note signatures, family order and hardware purchases.

   The coordinator owns routine gates, ships, tags, GitHub Releases, changelog PRs, runner variables, worktree pruning,
   label hygiene, stale issue/PR closure and CI triage within the authorized agenda and existing budgets; Gene is
   notified rather than asked. Release execution follows [release owner](../release.md#release-owner).
   T4 approval remains reserved to Gene; it is distinct from executing an approved release.

   **Enforcement limitation:** the current `tools/proof/gate.mjs` still recognizes only the maintainer's GitHub
   identity. This policy does not implement separate coordinator identity support or steward-bar validation.
   A coordinator label from a separate identity will not satisfy that check until the gate and identity setup
   support it; do not bypass a failing required check. Policy PRs remain for Gene to merge.
4. **On a conflict**, a Claude step tries to resolve it on the branch and re-runs the checks. If it can't produce a
   clean, green rebase, it labels the PR `needs:rebase` and comments with what conflicted; the author rebases by hand
   and relabels `merge:ready`.

A PR that fails a check leaves the train with its result in the PR; fix it and relabel.

**Stacked PRs.** When a PR squash-merges, the `restack` workflow (`.github/workflows/restack.yml`,
`.github/scripts/restack.mjs`) handles the PRs stacked on it. It retargets each one to the merged PR's base (GitHub
already does this when it deletes the merged branch) and merges that base forward. A child still carries the old
branch's commits, so a plain `git merge main` diffs from the old `main` fork point and conflicts on files the child
never changed. The restack merge is 3-way against the child's fork point from the old base instead: files the child's
own diff doesn't touch take the squashed content. The result is an ordinary merge commit, pushed as a fast-forward with
`MERGE_TRAIN_TOKEN` (never forced), so CI runs on it. A real conflict pushes nothing; the child gets `needs:rebase`
and a comment naming the files. To redo one by hand, run `gh workflow run restack.yml -f pr=<merged PR>`.

## Review

- **A qualified agent reviews every PR.** The current default `claude-review` workflow reviews each non-draft PR against [AGENTS.md](../../AGENTS.md)
  and [PROOF-POLICY.yml](PROOF-POLICY.yml), states the PR's proof tier, and keeps one review comment up to date on
  later pushes. Answer each finding with a fix or a reason.
- **Provider-neutral review.** If the default provider cannot run, an independent Claude or Codex reviewer may
  apply the same [review contract](review.md). Record the exact source SHA, reviewer/model, findings and their
  disposition in the PR. The change's author cannot supply its only review. Preserve the failed provider run;
  a separate review does not turn it into a pass. Do not require duplicate provider reviews. All required status
  checks and sign-offs under the approval matrix still apply; a required failed status cannot be bypassed by a comment.
- **`@claude` for follow-ups.** Mention `@claude` in an issue, PR comment or review (the `claude` workflow) to ask a
  question, iterate on review feedback or have it push a fix to the PR branch. Only the owner, members and
  collaborators can trigger it.
- **Proof tiers.** The PR states its tier and links its proof: lint (T0); focused tests and typecheck (T1); an uncut,
  real-speed clip of the changed journey (T2, the `proof` skill records it); a scenario playtest, a reviewer-agent
  pass and sign-off under the approval matrix (T3). T4 is the release head. What a reviewer checks: [review](review.md).

## Who starts agents

There are no scheduled agents. Nothing wakes up on a timer to pick issues, open PRs or ship releases. A coordinator's
bounded, expiring in-session watch is a wait, not a scheduled agent
([development coordinator](development-coordinator.md#intake-and-dispatch)). The maintainer
sets priorities and may authorize a development owner to select and start bounded workers within that agenda.
Sign-off follows the [approval matrix](#the-merge-train): the coordinator signs eligible T3 work; Gene retains
T4, policy and the six reserved decision categories. The development coordinator runs releases end to end as
release owner ([release owner](../release.md#release-owner)); production deletes still need the maintainer's explicit yes. Delegation does not
waive proof, budget or production safeguards. The only automation
that runs on its own is CI (`ci`, `security`, `changelog`, `claude-review`, label sync), which checks work and never
starts it.

## Repository skills and agents

`.claude/skills/` holds the repo's skills as plain Markdown that any agent can read: `triage` (label and reproduce new
issues), `finish` (turn a working change into a finished PR), `proof` (record the tier clip), `e2e` (browser
scenarios) and `souls-director` (direct live Souls). `.claude/agents/` defines the `lane` implementer (one issue, end
to end, to a draft PR) and the `reviewer`.

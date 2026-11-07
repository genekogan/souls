# Contributing to Soul

Thanks for helping. Soul is developed mostly by coding agents working with the maintainer, and agents are welcome
contributors here: the same rules apply to everyone, and they are written down in [AGENTS.md](AGENTS.md).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm assets:pull
cp .env.example .env
```

Details, environment variables and running other worlds: [docs/development.md](docs/development.md).

## The flow

1. **Start from an issue.** Use the bug or feature template. For anything large, agree the approach in the issue
   before writing code. Claim it before you start: assign it and add the `agent:claimed` label.
2. **Branch** from `main` as `agent/<issue>-<slug>` (people may use any name). One branch per issue; keep the change
   small and focused, and put unfinished work behind a flag that defaults to off.
3. **Change and test.** Add or update tests with the code. Update the doc that describes any behaviour you change.
4. **Prove it at your tier.** `node tools/proof/tier.mjs` prints your change's proof tier from
   [docs/process/PROOF-POLICY.yml](docs/process/PROOF-POLICY.yml). Visible changes need an uncut, real-speed clip of
   the changed journey on a fake-mind world; Soul, navigation and engine changes need a scenario playtest. See
   [docs/process/agent-lifecycle.md](docs/process/agent-lifecycle.md).
5. **Add a changelog fragment** in `changes/` if people using Soul will notice the change: one line, written for them.
   The format is in [changes/README.md](changes/README.md). Otherwise ask for the `no-changelog` label. Never edit
   `CHANGELOG.md`; the release compiles it.
6. **Open a pull request** from the template. Put proof (clips, logs) in the PR, never in the tree.
7. **Checks and review.** On every push these workflows run:
   - `ci`: the checks your paths need; its `ci-ok` job is the one required check;
   - `security`: gitleaks, the path guard (no databases, `.env`, agent or god files, or unlisted binaries) and the
     scrub guard (no home paths, private hosts, IPs or personal emails in added lines);
   - `changelog`: a valid fragment in `changes/` or the `no-changelog` label;
   - `claude-review`: an automated review against [AGENTS.md](AGENTS.md) and the proof policy.

   Answer each review comment with a fix or a reason. Mention `@claude` in a comment to ask follow-ups or have it push
   a fix (the `claude` workflow).
8. **Merge.** Label the PR `merge:ready`. The merge train merges it: T0–T2 automatically once green (as is
   when it merges cleanly and touches no engine or other strict path, otherwise rebased onto `main` and re-tested
   first), T3 and above rebased, re-tested and after the maintainer approves. If it can't rebase cleanly it labels the
   PR `needs:rebase`. Details: [docs/process/agent-workflow.md](docs/process/agent-workflow.md).

The authorized release owner handles releases under the maintainer’s approvals and existing gates.
See [docs/release.md](docs/release.md) for the current root-only topology and automation limits.

## Checks to run

```sh
pnpm typecheck                                              # or tsc -p for the packages you touched
node --test <the test files you touched>                    # focused tests
node tools/test-harness/walk/walk.mjs                       # if geometry, navigation or god builds can change
node tools/test-harness/bundle-budget/budget.mjs --build --check   # if the web app changed
pnpm --filter @souls/conformance test                         # if library defs, generators or the compiler changed
node tools/changelog/compile.mjs --check                    # if you added a fragment
```

What each check means and when to run it: [docs/testing.md](docs/testing.md). Don't run a live model locally
(`BRAIN_MODE=fake`), and don't point tests at production data.

## Baselines and pins

A walk or bundle baseline update, or a conformance supplement, goes in its own commit with the reason in the message,
regenerated after rebasing onto `main`. Add a new conformance supplement for your change; never edit an older one.
Don't commit generated output that CI builds. Reviewers read the numbers.

## Commits

- Imperative, scoped subject lines: `fix(nav): keep basement rooms out of default mesh entry`.
- Explain why in the body when it isn't obvious.
- Agents add their co-author trailer.

## Never commit

Secrets, `.env` or `deploy.env`, databases, run outputs, screenshots, media (it lives on the asset CDN; see
[ASSETS.md](ASSETS.md)), or status, brief and report files. A secret scanner runs on every PR; never bypass hooks.

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE). Media is handled
separately; see [ASSETS.md](ASSETS.md). Security issues: [SECURITY.md](SECURITY.md), not public issues.

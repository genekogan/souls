# Workspace placement and recovery

The GitHub repository is the source of code, issues, PRs and shared process. Its checkout may live at any chosen
location; it does not inherit a strategy workspace's release authority or depend on that workspace's directory name.
Run commands from the Git root (`git rev-parse --show-toplevel`). Keep personal executor bindings private.

## Local layout

- The repository root contains AGENTS.md, the application, tools and durable process docs.
- `.worktrees/` may hold isolated issue worktrees; it is ignored. Other worktree locations are also supported.
- `.local/` holds private run data, operational mappings and retained records. A local installation may keep migrated
  records under `.local/project/` and a private `SOULS-LOCAL.md` front door, excluded locally from Git.
- Existing media, caches and valid evidence are reused. Mutable data and ports belong to one writer at a time.

Actual machine paths, SSH targets, credentials and private resource identifiers do not belong in shared docs,
issues, proof or screenshots. Use relative paths or neutral configuration variables. Keep credential files opaque;
let their configured tools load them. A directory move is not a repository transfer or a production deployment.

## Relocating an existing installation

Pause writers and reach a safe checkpoint for active release operations. Snapshot each worktree's branch, HEAD,
tracked diff, untracked files, evidence and jobs; retain source refs and a private old-to-new path map. Preserve
unfinished work and accepted or failed receipts. Do not clean, reset, prune or rewrite shared history to make a move.

Prefer same-filesystem renames. Move archive-backed local resources deliberately before placing retained archives
inside their destination; avoid a local-data symlink resolving through itself. Move the main checkout and linked
worktrees, then run `git worktree repair` from the new main checkout with the actual worktree paths. Git must repair
both the common registration and each worktree's `.git` pointer. Confirm refs, diffs and untracked files survived.

Repair relative and absolute symlinks, generated dependency launchers and private operational mappings. Preserve
read-only source/evidence snapshots; their original source identity is not the new main. Update their navigation or
record a resolver in the private relocation map. Do not blindly replace historical source SHAs, public domains,
world names or evidence hashes. Review current docs/helpers for old paths; keep frozen provenance distinct.

Verify hooks remain enabled, dependencies execute, assets resolve and an isolated fake-mind development smoke works.
Use an existing compatible build or evidence where valid; report exactly which source/artifact was exercised. A
relocation does not justify repeating a paid gate, rebuilding unchanged assets or declaring old failures passed.
A subsequent fast-forward of main is a separate source update and must be recorded separately.

## A fresh owner or provider

Read AGENTS.md, the [coordinator contract](development-coordinator.md), the [owner playbook](owner-playbook.md) and
the current issue/PR checkpoints. If present, read the private local front door for operational bindings and the
relocation map. Recover branch/head refs, WIP, proof, failures, active jobs and authority before creating workers.
Check actual launcher, GitHub, browser and quota capabilities; a saved environment name is not qualification.

Resume existing implementations. The [planning guide](planning.md#portable-execution-and-handoff) defines the handoff;
the [release owner](../release.md) retains exclusive authority over an active release. Configure the supported app
project or cloud checkout to use the current repository; do not patch provider databases or copy credentials.
No worker, goal, label or folder move adds approval, spending, scheduling or deployment authority.

# Changelog fragments

Every PR that changes what people using Souls see or get adds one file here. The `release` workflow folds them into
`CHANGELOG.md` and the GitHub Release (`tools/changelog/compile.mjs`), then deletes them.

Name the file after the PR number once you have it (`changes/412.md`), or a short slug before that
(`changes/reading-seat-fix.md`, with `pr: 412` in the front matter later if you like). The format:

```markdown
---
type: fix
---
Souls keep their reading seat when another visitor sits down nearby.
```

- `type` is one of `feature`, `fix`, `perf`, `docs` or `internal`. `internal` entries are checked but don't
  appear in the public changelog.
- The body is exactly one line, written for people who use Souls: what changed for them, not how.
- A PR with nothing user-facing to say (CI, refactors, typo fixes) can carry the `no-changelog` label instead.

Check fragments locally with `node tools/changelog/compile.mjs --check`.

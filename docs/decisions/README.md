# Decisions

Architecture decision records (ADRs): one short file per decision that shapes how Souls is built or run, and is
hard to reverse or easy to forget. They record why, so a later contributor (or agent) does not undo a choice
without knowing what it was protecting.

Write one when a change picks between real alternatives that others would reasonably question. Examples: a
protocol or storage format, a dependency or engine choice, a process rule such as a proof tier or the merge
train. Bug fixes, refactors and ordinary features don't need one; their issue and PR are the record.

## How

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, with the next free number.
2. Fill it in and open it in the PR that makes the decision, or in a PR of its own before the work. Status:
   `proposed`.
3. When the PR merges, the status becomes `accepted`. Decisions are not edited afterwards. A new ADR supersedes
   an old one, and the old one's status becomes `superseded by NNNN`.

Keep each record to a page. Link the issue or PR with the discussion; don't copy it.

## Index

| # | Decision | Status |
|---|---|---|
| | | |

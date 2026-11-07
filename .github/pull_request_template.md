<!--
This PR is the journal entry for its milestone. The `proof` check (.github/workflows/proof-check.yml) reads the
sections below by their headings, so keep them. What each tier needs: docs/process/PROOF-POLICY.yml (`pr_checks`).
How to fill it: .claude/skills/journal/SKILL.md. T0 needs only the Problem. Clips and images are links
(tools/proof/upload.mjs), never files in the tree.
-->

## Problem

<!-- Who is affected and what is wrong or missing, in one to three sentences. Link the issue: Closes #123 -->

## Acceptance

<!-- Copied from the issue, where it was written before the work. Keep the ids. For each criterion:
       - [x] **A1** <criterion> — evidence: <clip or image link at 0:07 | proof.json | `command` -> result>
       - [ ] **A2** <criterion> — unmet: <what happened>          (honest; keeps proof-ok red)
       - [ ] **A3** <criterion> — deferred: #<follow-up issue>    (moved out of this PR, never silently dropped) -->
- [ ] **A1**

## Proof

Tier: T?
<!-- `node tools/proof/tier.mjs` prints the computed tier; a tier:Tn label can raise it. One line per clip or image:
     the journey, world template, viewport, duration, commit, and the moment the change is visible. -->
- proof.json:
- clips: <!-- explicit Full-resolution uncut video links + dimensions/duration; reduced GIF previews are pointers only -->
- images:

## Self-audit

<!-- What you checked, what failed on the way, and what this costs elsewhere. "none" is an answer; blank is not. -->
- **Checks run**: <!-- `command` -> result, one per line; checks you could not run are listed as unverified.
  A library def added or revised: the budget tests (core-kit/library.test.ts, conformance catalogue-checks) and conformance. -->
- **Failed attempts**: <!-- kept with their evidence, never deleted -->
- **Long tail / externalities**: <!-- cost to everything else: payload or context bytes with the feature absent,
  distant and in use; idle work; extra wakeups or events; unrelated journeys still working -->
- **Known limits**:
- **Docs**: <!-- the docs that describe changed behaviour, updated here, or "none needed" and why -->

## Changelog

<!-- A changes/<pr-or-slug>.md fragment (changes/README.md), or the no-changelog label. -->

## Risk

<!-- What could break, who would notice, how to roll back. T3+: why the playtest covers it. -->

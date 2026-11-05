# Review

## What a reviewer checks

1. **Correctness.** Does the change do what the issue asks, and nothing it shouldn't? Read the diff against the code
   around it, not just the description.
2. **Proof matches the tier.** The PR's tier comes from [PROOF-POLICY.yml](PROOF-POLICY.yml). A T2 change without a
   clip, or a T3 change without repeats, is not ready.
3. **Invariants.** Engine determinism, no second movement path, BUILDSAFE repairs in the same batch, seat heights from
   geometry, the model budget, fake minds in tests ([AGENTS.md](../../AGENTS.md)).
4. **Baselines and pins.** A walk or bundle baseline change, or a conformance supplement, is its own commit with a
   stated reason. The reviewer reads the numbers: a worse line needs an explanation, not just a re-pin.
5. **Docs and changelog.** Changed behaviour updates its doc; a user-visible change has a fragment in `changes/`.
6. **Public safety.** No secrets, device details, personal data or spend figures in source, docs, commits, GitHub
   discussions or proof attachments. Check exact outgoing text/JSON with `tools/proof/publication.mjs`; inspect
   media separately. [Publication privacy](publication-privacy.md) also covers private repositories.

## Evidence

- **Video, not stills.** Visual evidence is an uncut clip at normal speed with a scrub bar, so the reviewer can see
  timing, hitches and what happens between frames. Contact sheets and single screenshots hide exactly the problems
  that matter.
- **Real input.** For a visible journey, the clip shows a real browser on the real page with real clicks or touches.
- **Environment noted.** A timing result says the neutral environment label, hardware class and measured load,
  without machine names, addresses or operational identifiers. A timing bar that cannot be
  measured on a busy machine is recorded as unverifiable there, not as passing or failing.
- **Links, not files.** Clips, logs and reports are linked from the PR. They are never committed.

## Reviewer agents

A reviewer agent runs on every push. It gets the diff and the code, not the author's conclusions, so its read is
independent. Its findings are suggestions with a confidence; the author fixes or answers each one. A second independent
review is worth asking for when a change touches shared or brittle code.

## Answering review

Fix in a new commit (don't rewrite history under review), reply with what changed, and re-run only the checks the fix
affects.

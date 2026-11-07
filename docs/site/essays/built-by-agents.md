---
title: Built by agents
description: How Souls itself is built: agents write the code, prove each change on camera, and people decide.
audience: both
updated: 2026-11-06
sources:
  - docs/process/agent-lifecycle.md
  - docs/process/PROOF-POLICY.yml
generated: false
---

# Built by agents

## Who builds it

Souls is built mostly by AI agents. Agents write the code, tests and docs, including this page. People set the direction, decide what matters and sign off on the riskiest changes.

Work starts from a public issue that states the problem and how we'll know it's solved. An agent claims it, works in isolation on its own branch, and opens a pull request that serves as the record of what it did.

## Proof before merge

An agent saying a change works isn't enough, so the process asks for evidence:

- **Acceptance first.** The criteria are written into the issue before any edit.
- **Real input on the real thing.** A scripted test alone doesn't count as done. A change people can see is walked through in a real world.
- **Uncut video.** Visual evidence is an uncut recording at real speed, so nothing can be edited out.
- **Independent review.** Larger changes get a read by a reviewer that wasn't involved in the work. The riskiest also need a person's sign-off.
- **Named checks.** Automated gates protect walking and download size, and a change to those baselines goes in its own reviewed commit.

The record stays public. When something failed along the way, the pull request says so.

## What it means for you

Changes arrive often and in small steps. Each release says what changed in the [changelog](/changelog), and the issues and pull requests behind them are public on GitHub.

If something's wrong, a clear report with what you expected and what you saw is the most useful thing you can send. It's how a change gets started here.

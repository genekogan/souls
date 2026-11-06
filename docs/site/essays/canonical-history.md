---
title: Canonical history
description: A world is its log: why history is append-only and replayable, and why rules change only from a moment onward.
audience: both
updated: 2026-11-06
sources:
  - docs/design/vision.md
  - docs/architecture/data.md
generated: false
---

# Canonical history

## The log is the world

A world in Souls is an append-only log, folded over its rules.

What you see at any moment is a result: take every recorded event, apply the rules tick by tick, and the state follows. The engine is deterministic. It runs on a fixed tick and draws its randomness from the world's own seeded source, so replaying the log gives the same world.

So the log comes first, and the running world is a calculation from it. Nothing can happen in a world without being written down, and nothing written down can be quietly taken back.

## Changing rules without rewriting the past

Worlds change, and new abilities and fixes arrive. In most systems an upgrade silently changes what the past meant.

Here, a change of rule is itself an event. It's adopted from a moment onward, and everything before that moment replays under the rules it happened under. The past keeps its meaning, and the moment of the change is on the record.

## What this makes possible

- **Checking.** A world's state can be recomputed from its history and compared. A disagreement is a finding, not a matter of opinion.
- **Receipts you can trust.** When a world tells your agent an action completed, that's a fact from this history, not a guess about the screen.
- **Being away.** When an agent returns, it reads what happened from a cursor, and doesn't have to guess what it missed.
- **Trust between strangers.** Souls belong to different people with different agents. They can rely on the same account of what happened, because none of them keeps it.

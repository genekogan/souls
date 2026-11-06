---
title: Few rules
description: Why Souls prefers one rule that yields a continuum over many special cases, with examples from bodies, things and terrain.
audience: both
updated: 2026-11-06
sources:
  - docs/design/vision.md
generated: false
---

# Few rules

## The principle

Prefer one rule that yields a continuum over several special cases.

A world for many kinds of bodies, things and places could become a long list of exceptions. Each one looks cheap when it's added. Souls tries to find the single rule that the cases are examples of.

## Examples

**Bodies.** Activities aren't written for each kind of body. They are written once against general abilities, such as moving, settling, holding and keeping rhythm, and each body family provides the ones it has. A new family gets every activity its abilities support, and a body lacking one refuses with a named reason.

**Things.** The world has no list saying that chairs can be sat on. A thing declares its uses, such as a seat, a surface or a room behind a door. A god's new object works the moment it declares them, and an object that declares nothing is scenery. There's nothing else to learn.

**Terrain.** Landforms are things in the world, such as a hill, a lake or a valley. The ground's height is derived from them. A flat world simply has none. Walkers read the slope, and floaters keep their height above it.

**Worlds.** A world is configuration and content on one shared engine, not a fork. When a world needs something new, it's added to the engine for every world.

## The cost of exceptions

For an agent, every special case is something it has to be told. Instructions grow, context fills up, and what's learned in one world stops applying in the next.

A small set of rules means the world can explain itself: here's what you can do, here's why not. An agent can act well somewhere it has never been, because the world's answers take the same form everywhere.

The exceptions that remain should be visible and have reasons. Few rules doesn't mean no rules.

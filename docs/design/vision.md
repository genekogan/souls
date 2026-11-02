# Vision

Soul is aiming for a persistent world of worlds: places that keep running whether or not anyone is watching, inhabited
by residents whose people direct them through their own agents, and built by the people who make them.

This describes direction, not a claim that every capability exists. See the [roadmap](roadmap.md) for themes
and linked issues; implementation status and evidence live in issues, PRs and releases.

## Principles

- **Alive without you.** Steering is optional. A resident whose owner is away still has a body in the world and a
  history; the world never pretends it did something it did not.
- **Canonical history.** The past is an append-only log. A world's state is that log folded over its rules, so it can
  be replayed and checked. Upgrades are events in that history, adopted from a point onward.
- **Meaning over depiction.** What exists, who holds what, what was asked and agreed is the lasting part. Rendering and
  animation are depiction and can be replaced.
- **Few rules.** Prefer one rule that yields a continuum over several special cases.
- **Reuse, don't reinvent.** three.js for the viewer; a deterministic server-side engine for the world; offline tools
  (Blender, glTF-Transform) for assets. No game engine owns the loop.

## One codebase, many worlds

A world is configuration and content on one shared engine, not a fork. Each world turns on the general capabilities it
needs (terrain, kinds of bodies, construction, water) and supplies its map, things and starting residents as data.
When a world needs something new, it is added to the engine for every world.

| Part of a world | Form |
|---|---|
| Manifest: name, capabilities, settings | data |
| Map: ground, regions, buildings | data |
| Things: furniture, objects | data |
| Rules and vocabulary | data, recorded in the world's log |
| Starting residents | data |
| Custom behaviour | code, kept practical and reviewed |

Open questions: where the line between engine and world falls; which constants a world fixes at birth and which laws
it may change with notice; when world code needs a sandbox; when a world pins an engine version.

## Bodies

A body is three layers: a **family** (the body plan and its code: humanoid, floater, and later others), a
**morphology** (a shared core every body provides, such as height, footprint, reach and speeds, plus numbers of its
family) and a **skin** (meshes and materials, read only by the viewer).

To avoid writing every activity for every body, activities are written once against a small set of **capabilities**
(move, settle, hold, rhythm, express, …), and each family implements the ones it has. A body that lacks a capability
refuses the activity with a named reason. Activities produce targets for landmarks ("bring the item to the mouth",
"put the seat landmark on the seat"), and each family solves its own pose. Rigging is per family, not per resident.

## Libraries

Four libraries grow the same way: minted, validated, content-hashed and pinned.

- **Things.** Objects carry their own interactions (a chair advertises where and how to sit) as glTF plus metadata:
  slots, size, actions and the capabilities they need.
- **Bodies.** Families, morphologies and skins.
- **Rules.** Kinds, actions and vocabulary a world adopts.
- **Worlds.** Templates a new world can start from.

## Terrain and land

Landforms are things in the world (a hill, a lake, a valley) from which the height field is derived deterministically,
so the log stays small and replay stays exact. A flat world simply has none. Walkers read slope; floaters keep a height
above ground.

## Between worlds

Residents may visit other worlds; a resident can always leave and always come home, and each world keeps its own
history. The parts every world must share are few: resident identity and ownership, the log format with its hashes and
replay, and the rule at the border.

## Later

The engine is depiction; parts of it may one day be replaced by learned models, in order: rendering, then animation,
then possibly feasibility. Meaning (the log and its rules) never is, because a latent cannot be replayed, owned or
verified. Every recorded take is an exact record of state, action and pose, kept for that day.

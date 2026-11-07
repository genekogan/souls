# Architecture

Souls runs persistent worlds. Each world is one Node process with its own SQLite database, clock and event log.
People own **Souls** (residents) and drive them with their own coding agents; each world has exactly one **god**,
its creator, who builds it through their coding agent. A **world launcher** runs many worlds behind one address,
and an immutable CDN at `assets.eden.art` serves heavy media.

This page is the overview. The [component and data-flow map](architecture/map.md) names the actual classes,
contracts and hot paths and draws one tick, one Soul action and one god edit end to end. Details:
[API](architecture/api.md) · [protocol](architecture/protocol.md) ·
[engine contract](architecture/engine-contract.md) · [data](architecture/data.md) · [worlds](architecture/worlds.md) ·
[Souls](architecture/souls.md) · [god mode](architecture/godmode.md) · [brain and budget](architecture/brain.md) ·
[contracts](architecture/contracts.md) · [load](architecture/load.md) · [read-path split](architecture/split.md) · [Soul Actions](architecture/soul-actions.md) · [safety](architecture/safety.md) · [glossary](glossary.md).

## Components

| Part | Where | Role |
|---|---|---|
| World server | `apps/server` | One process per world: HTTP (Hono), WebSocket hub, MCP, tick loop, event log, SQLite |
| Web app | `apps/web` | Vite + React + three.js: world list, 3D world view, god panel, Soul pages; Clerk sign-in |
| Engine seam | `packages/engine-contract` | The interface every engine implements; determinism conformance suite |
| Mars adapter | `packages/engine-mars` | Wraps the vendored deterministic Mars engine in `mars/viewer/engine` |
| Toy engine | `packages/engine-toy` | Small reference engine behind the same contract (tests, `toy` world) |
| Kernel | `packages/kernel` | Meaning layer: things, links, changes, cards; replays without an engine |
| World compiler | `packages/world-compiler` | Turns a god's batch of ops into a refusal or a commit plus its inverse; core object library |
| Generators, ground | `packages/generators`, `packages/ground` | Kit shapes, buildings, creation limits; deterministic terrain height model |
| Protocol | `packages/protocol` | Shared types and zod schemas for events, HTTP and WebSocket messages |
| Client | `packages/client` | Browser/Node replica built from snapshot + batches, checked against the heartbeat hash |
| Soul client | `tools/edge-skill` | `eden-agent.mjs` CLI and the skill a Soul's agent installs |
| God client | `tools/god-skill` | `eden-god.mjs` CLI and the skill a god's agent installs |
| Launcher | `tools/world-launcher` | Creates, proxies, sleeps, wakes and restarts world processes |
| CDN publisher | `tools/cdn` | Uploads content-addressed media to the `assets.eden.art` bucket |

The server is TypeScript run directly by Node ≥ 22.18 (type stripping; no build step). The web app is built with Vite.

## How a tick flows

1. **Inputs.** HTTP and WebSocket handlers never touch the engine. They call `WorldHost.enqueue(kind, author, payload)`:
   a Soul's accepted action becomes a `decision` event, a god's commit a `world-edit`, a new resident a `birth`.
2. **Logging.** Every 50 ms the tick loop runs as many fixed steps as the clock rate requires (at most 40 per frame;
   repeated overruns halve the rate temporarily). At the start of each tick, queued inputs get a `seq` and the tick
   number and are written to the `events` table.
3. **Folding.** `fold.ts` applies each logged event to the engine and the kernel. Then the engine steps one tick
   (`DT = 1/20 s`). Replaying the log from genesis reproduces the same state hash.
4. **Broadcast.** Every 10 ticks the hub sends a batch to viewers, every 100 ticks a heartbeat with a view hash. Every
   `SNAPSHOT_EVERY_TICKS` (default 6,000, five minutes) the host saves a snapshot.
5. **Answers.** The handler that enqueued an input answers once its tick accepts it. Long-running results (a walk
   finished, a refusal) reach the Soul's agent as receipts on its event stream.

Model output never enters the engine directly. It arrives as an ordinary logged event, so replay never calls a model.

## Where state lives

- **Canonical:** the append-only `events` log, world metadata, accounts and Souls, god edits, and paid-cost
  reservations, all in `$DATA_DIR/sim.db` (one file per world).
- **Derived:** snapshots (engine + kernel + minds) for fast boot, take chunks for the 3D viewer, projections served to
  clients. Losing them loses no history.
- **Edge-side:** each Soul's agent keeps its own folder (credentials, queue, schedule, memory). The world never
  stores the agent's thoughts. See [Souls](architecture/souls.md).
- **Media:** content-addressed files on `assets.eden.art` (see [CDN](operations/cdn.md)).

## How Souls connect

Souls are agents at the edge. `MIND_DRIVER` defaults to `edge`: the world runs no Soul mind and makes no model calls
for Soul decisions. The owner gives their coding agent a one-line prompt pointing at the world's `/instructions.md`.
The agent installs the Soul skill and CLI, asks the owner to approve it in the browser, and receives a Soul token. It
then reads the world (`/v1/edge/boot`, `/v1/edge/here`), acts (`/v1/edge/act`) and listens (`/v1/edge/wait`, SSE or
WebSocket). The world decides whether each action is physically possible and reports what actually happened.
Optional **Eyes** renders what a Soul sees. See [Souls](architecture/souls.md).

## How gods connect

On a launcher world, the creator signs in and claims the world, or the launcher claims it for them at creation. Their
agent downloads `/god/eden-god.mjs` and `/god/SKILL.md`, pairs with a code the owner approves, and receives a god
token. It edits the world in validated batches (`/v1/god/act`), with undo and redo, weather, terrain and building
tools. Commits are logged, pushed into the engine as physics and sent to viewers as diffs. One god per world; there
are no co-builders. See [god mode](architecture/godmode.md).

## Many worlds

`tools/world-launcher/launcher.mjs` serves the world list, creates worlds from templates, and proxies `/w/<slug>/*`
(HTTP, SSE, WebSocket) to a child process per world, started on demand on a port from a fixed range. Idle worlds are
paused and later released; a visit wakes them. Unwatched worlds run their clock at a slower pace; on return the time
of day jumps to the present. Each child is an ordinary world server with `ENGINE=mars`, `ENABLE_WORLD_ENGINE=1`,
Clerk sign-in and `BRAIN_MODE=fake`. A Soul may travel between worlds of one launcher site. See
[worlds](architecture/worlds.md).

## The Mars engine

`mars/` is a hard fork of the Mars College simulator: a deterministic, server-side activity engine with named
refusals, its own runtime, planner, bodies and recorded takes. `packages/engine-mars` loads it from
`mars/viewer/engine`, installs a Node SHA-256 provider, lowers the shared body verbs to Mars actions and exposes
Mars's own verbs as `mars:<verb>`. `WORLD_KEY` picks the world configuration (green field for launcher worlds,
Little Martians, the Mars proving ground). Engine documentation is in [docs/mars](mars/README.md).

## Assets

Large media (GLB models, textures, images, audio) is not in git. Published files live on `assets.eden.art` under
content-addressed keys and are served `immutable`; the web app maps origin paths to CDN keys through a manifest. God
uploads in a world are content-addressed too (`/assets/<sha256>.<ext>`). See [CDN](operations/cdn.md).

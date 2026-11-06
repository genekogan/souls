# Glossary

Terms as used in this repository.

| Term | Meaning |
|---|---|
| **Souls** | This repository and the app behind soul.game: persistent worlds with residents and builders. The old name, Sim, survives in some code names and paths until the staged rename reaches them |
| **World** | One world-server process with its own database, clock and event log, at `/worlds/w/<slug>` (launcher worlds) or `/w/<key>` (the original worlds) |
| **Launcher** | `tools/world-launcher`: runs many worlds behind one address, creates, proxies, sleeps and wakes them |
| **Template** | A starting world a launcher world is built from (`GENESIS_FILE`) |
| **Fork (old-world fork)** | One of the original worlds served as a launcher child with its own account registry |
| **Soul** | A resident of one world, owned by a signed-in person: a body in the engine plus a mind in the owner's agent |
| **Owner** | The signed-in person a Soul (or a world) belongs to |
| **Agent** | The owner's own coding agent (Claude Code, Codex, …) that runs a Soul's mind or a god's building |
| **Edge** | Where minds run: in owners' agents, outside the world. `MIND_DRIVER=edge` is the default |
| **Edge API** | `/v1/edge/*`, contract `eden-edge/1` (+ `/1.1` boot): boot, here, act, receipts, wait and streams |
| **Capability / offer** | An action the world offers a Soul now (`doHere`), with exact parameters |
| **Receipt** | The world's record of an action: accepted, started, completed, failed or replaced, with the reason |
| **Soul token** | `sim_<soulId>_<secret>`: lets one agent act for one Soul in one world |
| **Approval** | How an agent gets a Soul token: it asks, the owner approves in the browser |
| **Queue** | The Soul client's durable local list of planned steps, executed in order against receipts |
| **Memory folder** | The client's `memory/` folder: an append-only fact log and readable projections |
| **Reminder** | A private, advisory, durable Soul reminder on the world or real clock |
| **Eyes** | Optional rendering of what a Soul sees (`/v1/edge/view`); always returns a caption |
| **Travel** | A Soul visiting another world of the same launcher site; its home world stays the authority |
| **God** | A world's one owner-builder, acting through their agent. No co-builders |
| **God token** | `god_<worldId>_<secret>`: lets one agent edit one world |
| **God mode** | `/v1/god/*` plus the God panel: validated edit batches, undo/redo, weather, terrain, builds |
| **Batch / op** | A god edit: a list of ops (`place`, `move`, `set`, `remove`, …) compiled to a commit or a refusal |
| **Def** | A kind of object a god can place: from the core library or defined in the world |
| **Core library** | The built-in object definitions in `@sim/world-compiler` (`CORE_KIT`) |
| **Build** | A multi-step god construction with checkpoints (`build start`, `check`, `continue`) |
| **Prayer** | A Soul's message to the world's god (`/v1/god/pray`), answered by the god |
| **Mars engine** | The deterministic activity engine hard-forked under `mars/`, run through `packages/engine-mars` |
| **Toy engine** | `packages/engine-toy`: a small reference engine behind the same contract |
| **Engine contract** | `packages/engine-contract`: what the server needs from any engine, plus its conformance suite |
| **Entity** | A thing in the engine's `WorldState` (`human`, `fixture`, …). A Soul's entity is its body |
| **Verb / body language** | An engine action; the shared body verbs (`walk_to`, `sit`, `stand`, `rest`, `wave`, `converse`, `gather`, `perform`, `ambient_wander`). Raw Mars verbs are `mars:<verb>` |
| **Program** | The verb steps one body is running. One actor runs one program |
| **Event, log** | An input recorded with `seq` and `tick`; the append-only `events` log is canonical |
| **Fold** | Applying logged events to the engine and the kernel tick by tick; replaying reproduces the world |
| **Tick** | One engine step, 1/20 s of world time |
| **Snapshot** | Saved engine + kernel + mind state at a tick, for fast boot |
| **Take** | A recorded chunk of poses and changes, drawn by the 3D viewer |
| **Batch / heartbeat** | WebSocket messages every 500 ms / 5 s; the heartbeat carries the view hash |
| **View hash** | Hash of every human's activity, seat and position; how a client checks its replica |
| **Rules fact / policy** | A logged `rules` event that changes behaviour from its tick onward, so earlier history replays unchanged |
| **Kernel** | `packages/kernel`, the meaning layer: things, links, changes and the coherence rule; replays without an engine |
| **Card** | A reusable action stored as data in the kernel; used by the central mind driver |
| **Central driver** | The world's own brain choosing for Souls (`MIND_DRIVER=central`); tests and future world-owned characters |
| **Jev** | TypeSafe's System One model: typed Choice / Score / Noul judgments, used by the central driver |
| **Fake brain** | `BRAIN_MODE=fake`: deterministic stand-ins, no model calls, no cost |
| **Model budget** | Per world, rolling 24 h: default $0.50, ceiling $1, reserved before each provider call |
| **CDN** | `assets.eden.art`: immutable, content-addressed media |

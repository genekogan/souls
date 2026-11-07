# The Mars engine

`mars/` is a vendored, hard-forked world engine: a deterministic world and activity runtime in pure TypeScript
(`mars/viewer/engine/`), a three.js viewer and Lab (`mars/viewer/app/`), and a Cloudflare Worker host
(`mars/viewer/simulation/`). It was built to model the Mars College desert campus and its buildings
([campus](campus.md)); in Souls it runs behind the engine contract through `packages/engine-mars` (`ENGINE=mars`). See
[the engine contract](../architecture/engine-contract.md) for the mapping.

The long-term plan is to deprecate `mars/` and generalize its useful parts into Souls. These docs describe the
engine as it is, briefly; read the code for detail.

## Engine overview

- **Determinism.** Fixed tick `DT = 1/20 s` (`runtime/runtime.ts`); seeded sfc32 RNG whose state lives in
  `world.rng`; deterministic transcendentals in `core/math.ts` (`dsin`, `datan2`, …; host `Math.sin` and friends
  are banned by `engine/test/source-scan.test.ts`); no wall clock. `zod` is the only runtime dependency.
- **World state** is plain JSON (`world/types.ts`, schema `mars-world/1`): entities, regions, environment,
  inventory and RNG. `hashOf = sha256(stableStringify(x))`. `physicalView` drops labels, provenance, tick and
  environment, so plans bind to a `physicalHash` that camera or lighting edits cannot invalidate.
- **Runtime.** `submit(verb, params, { parent?, preempt? })` moves an action through
  requested → validated → reserved → executing → completed / failed / cancelled. Reservations (`actor:<id>`,
  `slot:<id>`, `entity:<id>`, …) are exclusive. Invariants run at the end of every tick and record named
  violations. `snapshot()` / `Runtime.restore()` resume a verified subset of verbs tick-exactly.
- **Verbs.** `ActionDef { verb, schema (zod), reservations, plan, start, step, cancel, … }`. One registry
  (`api/registry.ts`) generates the REST ops, MCP tools (`engine_<op>`) and browser schemas. `plan` is pure and is
  the feasibility check; refusals are `Diagnostic { code, message, subjects }` naming concrete objects.
- **Space.** `spatial/` rasterizes a `SpatialScene` (levels, surfaces, obstacles, links) into 0.1 m grids with exact
  EDT clearance; multi-level A* with stair links and corridor string-pulling. Construction bumps a navigation
  epoch and walkers replan.
- **History, plans and takes.** `WorldHistory` stores content-addressed checkpoints, protected canonical workspaces
  and forks (no merge). Sequence templates bind to a checkpoint as `BoundPlan`s; stale plans are refused with a
  diff. A take records quantized pose tracks and change events; renderers and cameras consume takes, never a live
  runtime.
- **Execution model of the original host.** "Submit a plan → simulate faster than real time in one request → store
  a take → viewers poll." Souls' shell supplies the 24/7 loop, event log, accounts and agents around it.

## Module map (`mars/viewer/engine/`)

| Module | Role |
| --- | --- |
| `core/` | hash, RNG, deterministic math |
| `world/` | types, catalog (asset defs, grips, slots, handling), factory |
| `runtime/` | Runtime, invariants, snapshot/codec, waits, profiler |
| `actions/`, `api/` | action types; registry, controller ops, schemas |
| `spatial/`, `locomotion/` | grids, routes, `walk_to` |
| `body/`, `bodies/` | the body model (reach), body kinds |
| `carry/`, `items/`, `social/`, `vehicles/` | coordinated carrying, hand-held items, seats and groups, riders and forklift |
| `construction/`, `work/` | frames, beams, decks, stairs, hand-up, framing, solar, paint |
| `objects/`, `activities/`, `games/` | object capabilities and multi-actor activity coordinators |
| `sequence/`, `rehearsal/`, `take/`, `history/` | templates and runner, rehearse/execute, takes and replay, checkpoints |
| `camera/`, `env/` | shot planning and direction; sun and environment |
| `campus/`, `scenes/`, `scenarios/` | campus scene extraction, synthetic scenes, authored scenarios |

## Docs

| File | Subject |
| --- | --- |
| [engine-guide.md](engine-guide.md) | Contributor rules, authoring activities and scenarios, the failure model |
| [spec.md](spec.md) | The original specification: architecture targets and proof obligations |
| [design-decisions.md](design-decisions.md) | Patterns adopted and libraries evaluated |
| [movement.md](movement.md) | Walking: splined turns, blocking, encounters, speed limits |
| [carry.md](carry.md), [vehicles.md](vehicles.md) | Coordinated carrying; EUC, bicycle and forklift |
| [body-model.md](body-model.md), [poses.md](poses.md) | Engine reach model; renderer pose layers |
| [items.md](items.md), [social.md](social.md) | Hand-held items and eating; seats, groups, pre-emption |
| [construction.md](construction.md) | Frames, decks, stairs, hand-up, framing, solar, paint, generated builds |
| [takes-and-plans.md](takes-and-plans.md) | Sequences, bound plans, takes, replay, rehearsal, snapshots |
| [camera.md](camera.md), [camera-direction.md](camera-direction.md) | Shot planning; typed direction, self-correction, render verification |
| [campus.md](campus.md) | The campus buildings and places, what each is for, and its recurring rhythms |
| [campus-scene.md](campus-scene.md), [history.md](history.md) | Campus scene extraction; year scenes and component ids |
| [studio-replay.md](studio-replay.md) | Take replay and camera direction in the studio |
| [lab.md](lab.md) | The `/lab` sandbox |
| [planning-budget.md](planning-budget.md) | Performance work and the rules for moving pinned hashes |

Other references: `mars/viewer/public/simulation-agent-guide.md` (the guide the Worker serves to MCP agents),
[`mars/viewer/simulation/README.md`](../../mars/viewer/simulation/README.md),
[`mars/viewer/e2e/README.md`](../../mars/viewer/e2e/README.md),
[`worlds/mars/camp/README.md`](../../worlds/mars/camp/README.md) (the camp Souls runs on this engine).

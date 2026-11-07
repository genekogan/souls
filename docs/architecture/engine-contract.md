# The engine contract

`packages/engine-contract` is the seam between the world server and any engine. Two engines implement it: the Mars
adapter (`packages/engine-mars`, `ENGINE=mars`, used by every launcher world) and the toy engine
(`packages/engine-toy`, the default when `ENGINE` is unset). Names mirror the Mars engine
([Mars engine overview](../mars/README.md)).

## Shared types

| Here | Mars source |
|---|---|
| `WorldState`, `Entity`, `Region`, `Pose`, `Environment`, `physicalView` (`world.ts`) | `world/types.ts` |
| `hashOf`, `stableStringify`, `sha256` (`hash.ts`) | `core/hash.ts` |
| `RngState`, `seedRng` (`rng.ts`) | `core/rng.ts` |
| `Runtime`, `DT = 1/20`, `RuntimeEvent`, `Invariant` (`runtime.ts`) | `runtime/runtime.ts` |
| `ActionDef`, `ActionRecord`, `Diagnostic`, `Reservation` (`actions.ts`) | `actions/types.ts` |
| `createRegistry`, `describeVerbs`, `jsonSchemaOf` (`registry.ts`) | `api/registry.ts` |
| `PoseSample = [tick, x mm, y mm, z mm, yaw mrad]` | `take/types.ts` |

## What the server needs from an engine (`engine.ts`)

```ts
interface Engine {
  rulesVersion: string; dt: number; schema: string;
  runtime: RuntimeView; world: WorldState;
  describeVerbs(): VerbInfo[];                         // { verb, description, inputSchema, scope? }
  stateHash(): string; physicalHash(): string;
  step(): { paths; changes; events; programs; refusals? };  // what changed this tick, for broadcast and the host
  perform(program): { id; ok; diagnostic? };           // start a program, replacing what the actor was doing
  stop(programId, opts?): void;                        // request a stop; committed physical work may finish safely;
                                                       // {untilSafe} keeps the programme until its native cleanup lands,
                                                       // retrying a refused cancel while the action moves
  canPerform(program): { code; message } | null;       // is the first step feasible now? no side effects
  programOf(actor): string | null;
  submit(verb, params, opts?); cancel(id, reason?);
  snapshot(): EngineSnapshot;                          // opaque to the server except { format, tick, stateHash }
  spawnHuman({ id, label, soul }): string; removeEntity(id): void;
  anchors(): Anchor[];                                 // regions and named places; stable ids
  describeSurroundings(actorId); regionAt(p); poseSampleOf(id); currentPath(id);
  enumerateActivities(actorId, intent);                // toy tests only
}
interface EngineFactory { rulesVersion; genesis(seed); create(world); restore(snap); canRestoreSnapshot?; canReplayHistory? }
```

Optional hooks cover recorded takes and scenes (`takeChunks`, `renderScene`, `takeScene`), snapshots and checkpoints
(`canSnapshot`, `captureSnapshot`, `captureCheckpoint`, `compact`), clocks and policies (`configureClock`,
`configureRuntimePolicy`, `beginQuiet`, `isQuiet`), body assignment (`assignBodyV1`), admission previews
(`previewAdmission`) and a set of paired `preview*V1` / `adopt*V1` transitions that add authored content to an existing
world as logged, replayable facts. The declarations are the reference.

- **Program** `{ actor, label, steps: {verb, params}[] }`: the verb steps one body runs. A `decision` event starts one.
  One actor runs one program.
- **ProgramEvent** `{ tick, id, actor, kind: 'step'|'completed'|'failed'|'cancelled', step, code?, message? }`: how the
  host learns that an action progressed, finished or was refused. Receipts are built from these.
- **Anchor** `{ id, kind: 'region'|'place', name, in?, entity?, point?, tags? }`: mirrored as kernel Things at genesis;
  the place tagged `arrival` is where new Souls appear.
- **VerbInfo.scope** `'world'` marks a verb that belongs to one engine, not the shared body language.
- An unknown verb fails with `action.unknown-verb`.

## Body language

Both engines describe the same shared verbs for one actor's body; the actor is implied by the program:
`walk_to {to, standoff?}` · `sit {on, seconds?}` · `stand` · `rest {seconds?}` · `wave {at?, seconds?}` ·
`converse {with, seconds?}` · `gather {at, seconds?}` · `perform {what?, seconds?}` · `ambient_wander {seconds?, radius?}`.
Edge capabilities offered to Souls are built on top of these and the engine's own verbs.

A Mars `walk_to` step may carry `stand: 'clear/1'` (#374). Its standoff point must have standing room for the walker's
body, the same radius the route's own goal check uses. Each turn around the target is read for that room before it is
planned. When no turn has both room and a route, the step takes a point with room on a wider ring around the target, at most
0.9 m beyond the standoff, so a ride still boards within its 3.2 m reach. It makes at most 8 more route plans for this. When there is none, it is refused `route.goal-blocked`, naming the blocker. A balloon, ferris wheel or carousel join marks its walk to the carrier this way; a punt walks to its bank's door as before.
This matters on paged ground, where a long walk's plan checks only its first fine hop, so a standoff point inside a
ride's own collider used to pass the plan. A step without the marker keeps the goal it always chose, so recorded
programmes replay unchanged.

`dance:here` uses the body's current standing footprint and never inserts a walk to a larger clearing or another
venue. A seated Soul still stands first; active movement and occupied support keep their native admission rules.
Direct `pose_v1` admission reads clearance at the actor's position, independently of the last paged ground window
queried. Lying poses retain their larger clearance requirement.

A reach's lean into a container and a stroke's step to a board go through `runtime/static-step.ts`, the walker's rule:
a step that would put the body below the `collision.human-static` limit, and worse than where it stands, is not taken,
and the hand works from where the body is. A stroke stays held for the rest of the stroke; a lean follows its path back
out. Invariants run at the end of every tick, so a held step would have been a violation on that same tick (unless something
later in that tick moved the obstacle), and every earlier step moves as it did.
An opening or a slide can't stop short, because its body follows the handle: where the next step would trip the same rule, the
rest of its path shifts aside by the smallest step with room, at most 0.15 m in all, and with no such step it fails `step-blocked`. Other body steps owned by actions do not go through it yet.

## Refusal

With the `souls-repair/1` rules (`soulsRepairV1`, off unless `SIM_SOULS_REPAIR=1`; new worlds only for now: a world whose history lacks it
refuses to boot under the flag), a move that
would break a rule is not applied ([#1150](https://github.com/soulsimulation/souls/issues/1150)).

- `Engine.step` leaves no refusable violation standing. The bodies that moved go back to their pose before the tick, and
  their programmes end `failed` with `world.refused:<rule>` and a plain reason, in that tick.
- **Refusable:** `collision.human-static`, `collision.human-human`, `collision.human-load`, `motion.overspeed`,
  `motion.teleport`, `carry.load-static`, `lift.hands-out-of-reach`. A body that holds a load refuses with its load and
  everyone holding it. Cleanup is the action's own, and a stop never drops a load. An action that keeps its own position
  rewinds it in its `refused` hook: a carry backs up to 1 m along the route it came by and sets down there, further back if
  it can't lay the load there. A person or a solid behind it, or a refusal while backing, ends the backing where it stands.
- **Not refusable, left in `violations` for the host's repair:** any other rule in the same tick (a tick is refused whole
  or not at all), a violation naming only bodies that did not move, a build programme, a body ridden, carried, on a
  structure or on a flight, an action with no programme whose cancel is refused, and a third refusal of one programme within 5 s.
- Refusal is a function of world state and the rules version, never of input. A replay or restart recomputes it, so a
  restored runtime remembers the poses it restored (`rememberPosesAfterRestore`): the step check keeps its previous poses
  outside the snapshot, and would otherwise miss a jump on its first tick.
- A body that only turned did not move. Observers run in the end-of-tick pass, before the undo, so a take can show the
  refused pose for that one tick.
- `step().refusals` reports each one. The host logs it as a `rules` event from `world:refusal`. Replay reads those only to
  compare the count, and a difference is reported, not fatal.

## Conformance

`@souls/engine-contract/conformance` exports `conformance(name, factory, drive)`: same seed and inputs give the same hash,
different seeds diverge, snapshot/restore mid-action continues identically, `physicalHash` ignores labels, verbs
describe with JSON Schema, an unknown verb fails cleanly. Both engines run it (`packages/engine-mars/src/mars.test.ts`,
`packages/engine-toy/src/toy.test.ts`). An engine that declares rules also runs `refusalConformance(name, factory, force)`; the toy engine
has none. (`packages/conformance` is a different gate: every core-library object bakes,
places and furnishes within budget.)

## The Mars adapter (`packages/engine-mars`)

The Mars engine is hard-forked under `mars/viewer/engine`. `load.ts` imports that in-repo tree (it fails if
`runtime/runtime.ts` is missing) and installs a Node SHA-256 provider with the same digests as the browser.

- **World configurations** (`engine.ts`): `GREEN_FIELD_WORLD` (launcher worlds and `eden`), `LITTLE_MARTIANS_WORLD`,
  Eden commons variants, the default proving ground (`mars`), and `MEAL_WORLD` for a test. `main.ts` picks one from
  `WORLD_KEY`. Rules version is `sim-mars/1+<Mars rules version>`, extended with the policies a world has adopted.
- **Lowering.** Each body-language step becomes Mars actions when it begins: `walk_to` plans a reachable point near the
  target and faces it; `sit` and `gather` take a fixture or region; `converse` joins two bodies when both are free;
  `rest` and `perform` wait; `ambient_wander` draws short legs from the world RNG.
- **Raw verbs.** Every Mars verb is also described as `mars:<verb>` with `scope: 'world'`.
- **One program per actor.** A program that moves the body first asks whatever holds it (a seat, a circle, a
  conversation) to release it, and fails with `actor.busy` if that takes too long. Feasibility is checked first
  (`canPerform`) because in Mars a refused instruction still disturbs the actor.
- **Broadcast.** Moving bodies send two-point keyframe paths every 5 ticks; activity and seat changes are field changes.
- **Snapshot** format `sim-mars-snapshot/1`: Mars's own snapshot plus the adapter's programs and world configuration.
  A program whose actions cannot be serialized defers the checkpoint; replay of the logged suffix continues it.
- **God-built worlds.** On launcher worlds the god's committed objects and terrain enter the engine as `world-edit`
  physics through `apps/server/src/god/engine-bridge.ts`; Souls then sit on, walk around and use them.

## The toy engine (`packages/engine-toy`)

A 100 × 100 m plane with a campfire, benches, a kiosk and a gate, two regions, straight timed walking at 1.35 m/s in
integer millimetres, and the shared verbs plus `do_activity`. It is a small reference for the contract and the
`toy` world's tests.

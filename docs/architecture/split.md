# Stage B spike — can the Soul read path leave the tick thread? (lane L9, 2026-10-31)

Branch `lane/srv-split-20261031` off main `cdd3eece3`. Prototype only (`apps/server/src/split/**`); no production path
changes. The scalability plan and design notes it answers were kept outside the repo. Line numbers are anchors at
`cdd3eece3` unless a lane branch is named.

## 1. The read path's engine dependencies

### 1.1 Shape of the read path

All five reads funnel into one function. `here`, `around`, `observe`, `capabilities` and `resolve` each call
`EdgeLedger.binds()` (`edge/ledger/ledger.ts` 612–755, the whole menu) at least once:

| Read | Route (`edge/routes.ts`) | Calls `binds()` via | Other engine reach |
|---|---|---|---|
| `capabilities` | 57 | `capabilities()` 760 | — |
| `here` | 65 → `hereFrame` (`edge/perception/here.ts` 211) | `seats()` 69 (`coreA.binds`), `exits` 252 (`ledger.capabilities`), `doHere` 279 | `routeProblem()` per exit (`ledger.ts` 588 → `engine.canPerform`), `engine.programOf/programAction` + `runtime.records` (here.ts 217–220, 61, 138), `takenSeats` over `runtime.records` (61) |
| `around` | 67 → `aroundFrame` (`perception/around.ts` 17) | `walks` 32 | **writes**: `K.find()` persists found secret places and calls `invalidateBodies()` (around.ts 24–25) |
| `observe` | 56 → `ledger.observe` 1695 | `doHere` 1720, `include=capabilities` 1737 | `programOf/programAction` 1697 |
| `resolve` | 68 → `intents.dryRun` (`edge/intents/intents.ts` 346) | vocabulary over `binds()` caps; `resolveOnDemand` 1761 re-runs the activity listing under `readPassV1` (1805–1811) | — |

So "the read path" is, in cost and in dependencies, **`binds()` plus a thin perception layer around it**. Whatever answers
`binds()` off-thread answers all five reads; nothing smaller does (here's seats, exits and doHere are cuts of the menu).

### 1.2 Every dependency, classified

(a) pure function of replicable state · (b) spatial query a replicated nav grid / per-cell table can answer ·
(c) needs the live engine's private state (programs, runtime, planner).

| # | Dependency | Where (file:line) | Class | Why / what a worker would need |
|---|---|---|---|---|
| 1 | Body pose, yaw, `human.activity/baseActivity/level/gaze/attention/together.group`, `body.family` | here.ts 32, 225, 234; ledger.ts 627, 1565, 1609–1620 | a | per-tick body deltas |
| 2 | `host.minds` (soulId↔entity, name), `faded` set, `publicNameMetadata`, `profileFact` | ledger.ts 1611; here.ts 235, 263 | a | mind table + changes (rare) |
| 3 | Places registry `places.containing/byId/ref`, `enclosureAtPoint`, `spots.interiors`, `placeLevel` (`engine.placeLevelV1`) | ledger.ts 1577–1608; places.ts | a | static per epoch; `placeLevelV1` is a static table |
| 4 | `perceivedBodies` (enclosure rule, radius) | ledger.ts 1609 | a | bodies + places; per-cell index makes it O(neighbourhood) |
| 5 | Sightline `clearSight` over `world.navV1.solids` | here.ts 37–41, geometry.ts | a | static solids per epoch (per-cell bucket) |
| 6 | Campfires (scan of **all** entities, 150 m), regions within 60 m | ledger.ts 676–690; here.ts 83–86 | a | static/entity layer; per-cell index removes the O(world) scan |
| 7 | Comms objects (`comms.objects.all()`), placed items (`together.publicItems()`), conversations (`coreA.conversations()`), fading status | here.ts 91–108, 230, 239; ledger.ts 1702 | a | object table snapshot + deltas (L8's in-memory table), items/conversations from sqlite (read-only WAL connection works from a worker) |
| 8 | Receipts `openReceipts()` (sqlite), receipt-claimed seats/spots, bikes out | ledger.ts 399, 1421, 718; here.ts 62, 216 | a | sqlite WAL reader in the worker, or receipt deltas |
| 9 | Live sit holds: `runtime.liveIds()` + `runtime.records` (sit params) | here.ts 61, 137; human-capabilities.ts 111 (`seatOccupancyIssue`) | a | runtime record deltas (verb, actor, fixture/slot, live) — engine state but plain data |
| 10 | `programOf(entity)` + `programAction` + its runtime record (`endsIn`) | here.ts 217–220; ledger.ts 1697 | a | program/action deltas (plain data) |
| 11 | Kernel: `host.engine.anchors()`, `kernel.things`, `describeVerbs()`, `rulesVersion`, `engineRef` | human-capabilities.ts 15–40; deck.ts | a | static per epoch/rules; anchors change only on god edits |
| 12 | Births query (`events` table) for meals | human-capabilities.ts 44 | a | sqlite read |
| 13 | Knowledge `knows/marked/scales/memory` (sqlite) and `secretOffer` filter | knowledge.ts; ledger.ts 753 | a | sqlite read |
| 14 | Clock (`clockAt`), weather (`weatherNow`, `env.weather`), lightning, floors (`floorsNear`) | here.ts 213–214, 268, 270 | a | tick + env deltas; floors static per epoch |
| 15 | Carrier state: `aboard`, `stepOutRefusal`, `rideStandRefusal`, `carriersNative` | ledger.ts 1279–1305, 735–741 | a | carrier entity deltas |
| 16 | `nativeSeatLevelsV1(fixture)` | here.ts 71 → engine.ts 685 | b | static fixture/level table |
| 17 | `clearSpotsV1(polygon, 5)` — stroll loops, nav spots | ledger.ts 767; god/nav.ts 728 | b | static nav grid per epoch (results already memoised per epoch) |
| 18 | `clearanceUpToV1/clearanceAtV1` — bank loops, activity spots, together placement | ledger.ts 776–779, 1428; together.ts 154, 174, 187 | b | nav clearance grid per epoch + **dynamic bodies** (clearance counts bodies) |
| 19 | `nearestStandableV1` — activity `open()`, together, nav | ledger.ts 1429; together.ts 252; engine.ts 2050 | b | same grid + bodies |
| 20 | `readPassV1(fn)` wrapper (planner sync once per listing) | ledger.ts 688–691, 790, 1810 | b | the worker's own grid is already synced: a no-op there |
| 21 | `navEpochV1()` (syncs the planner to read the epoch) | god/nav.ts 719; ledger.ts 592 | b | the static epoch carried in the delta |
| 22 | `navCheckV1/navWarmV1` — "a raised room no stair reaches" cut | god/nav.ts 674 | b | connectivity table per epoch |
| 23 | **`engine.canPerform(program)`** in the listing: `rest`, `eat`, swim, non-deferred goals; registered activity cards | human-capabilities.ts 23, 48; deck.ts 101–161 | **c** | engine.ts 801–: reads `this.programs` (readiness, construction crews, safe-stop, physical replacement of the running action), carriers, gait/body rules, then the planner (`plan()`) incl. routes. Plain data in the engine snapshot, but the logic is ~1,000 lines of engine; only the engine code computes it |
| 24 | **`routeProblem(soul, cap)` → `engine.canPerform`** for each `here` exit | ledger.ts 588–599 (memo per nav epoch × 0.5 m × cap) | **c** | the planner's route search over the live nav (paged windows). Memo means a worker needs it only on a miss |
| 25 | God-world reach checks `offerWalk` (`blocked` set, nav cut) | god/nav.ts 668–730 | b/c | blocked set is computed on the tick thread by perception; replicable as data |
| 26 | `activityCapabilities(spots, aw)` | activities.ts (0 engine calls) via the `activityWorld` adapter ledger.ts 1414–1445 | a+b | **already the right pattern**: pure over an interface of closures (clearance, open, taken, seat, enterable, clock) |
| 27 | `around`'s `K.find()` + `invalidateBodies()` | around.ts 24–25 | **write** | not a read: must become an intent (or a worker-side "found" set merged into the ledger at a tick boundary) |
| 28 | Every route returns `tick: host.engine.world.tick` | routes.ts 57–68 | a | the read model's tick (lag ≤ 1 batch) |

**Counts.** `ledger.ts` reaches `host.engine.*` 133 times (world 39, programOf 17, canPerform 15, clearanceUpToV1 10,
nearestStandableV1 10, clearanceAtV1 8, runtime 7, readPassV1 6, …); `human-capabilities.ts` 20, `deck.ts` 13,
`god/nav.ts` 9, `here.ts` 7, `together.ts` 4; `activities.ts`, `places.ts`, `vocabulary.ts`, `around.ts` 0.
Most of the 133 are in the act path (`act`/`actOnce`/`decide`, 837–1220); the read path's are rows 1–28.

### 1.3 What this means (early signal, sent to main after this step)

- The assumption "every Soul read is answerable from a replicated read model with no engine access" is **true only if
  the read model contains the engine's own code**. Rows 1–15 (a) are plain data and replicate cleanly. Rows 16–22 (b)
  are the engine's spatial service over the static nav grid **plus bodies**; that code (`mars/viewer/engine/spatial`) is
  shared TS that already runs in the browser, so a worker can run it, but it must be fed the same static scene and body
  positions. Rows 23–24 (c) are `canPerform`: the engine's admission and planner over its private programs/runtime. A
  hand-written read model cannot answer them without re-implementing the engine.
- So the replicated read model must be **an engine replica in the worker** (the viewer protocol already does exactly
  this for browsers: snapshot + input batches → a lockstep engine), with the ledger's read code running unchanged
  against a read-only `host` facade. Per-32 m-cell indexes are an optimisation *inside* that worker (rows 4, 6, 7),
  not a replacement for the engine.
- One read is not a read: `around` persists finds (row 27).
</content>
</invoke>

## 2. The delta stream (`apps/server/src/split/delta.ts`)

**What already exists.** Each tick, `engine.step()` returns `{paths, changes, programs}` (`world.ts` 487–494). The
hub accumulates them into the viewer `Batch` every 500 ms (`world.ts` 1617–1627; `@souls/protocol` `Batch`), so
browsers keep a state-fed replica. That covers entity motion (paths) and entity field changes. It does **not** carry
what the edge reads also need: who the minds are, `faded`, receipts, comms objects, placed items, live sit holds and
program actions, or the static layer (places, enclosure shells, spots, fires, regions, sight solids). So `WorldDelta`
is the engine's per-tick `paths`/`changes` (used here only to learn which entities moved), **plus** a ledger section.

```ts
type WorldDelta = {
  tick: number;
  static?: StaticLayer;          // only when the static epoch moves (god edit, nav change): places, shells, solids, fires, regions, spots
  bodies?: BodyRow[];            // [id, x, y, z, yaw, activity, level] for bodies whose row changed this tick
  gone?: string[];
  minds?: MindRow[]; mindsGone?: string[]; faded?: string[];   // faded = the whole set, only when it changed
  objects?: ObjectRow[]; items?: ItemRow[];                   // changed object rows; the placed-items list when it changed
};
```

**Measured** (live fixture copy `eden-2026.db`, real `main.ts`, `SOUL_LIFECYCLE=1`, all 7 of the fixture's Souls,
6 of them scripted to keep walking; laptop, CPU = `threadCpuUsage` of the tick thread; run
receipt `run1`, kept outside the repo):

| Part | CPU on tick thread | Bytes |
|---|---|---|
| WorldInit (4,543 entities, 7 minds, 11,584 comms objects) | 34 ms once | 1.65 MB once |
| Static layer when the epoch moves (1,514 places, 1,042 spots, 2 fires) | in the init/scan | ~1.1 MB per send (twice at boot, as the god bridge installs places, then 0 in 60 s) |
| **Steady per-tick body stream** (1,127 ticks) | **p50 0.022 ms, p99 0.046 ms** | **p50 320 B, p99 342 B** (≈ 5.8 body rows/tick) |
| Comms object + items diff (every 20 ticks) | **26 ms per scan** (60 scans: 1,571 ms in 60 s) | 240 B in 60 s |
| Worker ingest per delta | 0.022 ms (max 2.4 ms) | — |
| For scale: one tick of the world (incl. the tap) | ~20 ms mean, 273 ms max | — |

The body stream costs about 0.1 % of a tick. All of the measured cost is the object diff, and that is because
`comms.objects.all()` on main re-reads the whole table (11,584 rows, ~26 ms). With L8's in-memory table
(`lane/srv-objects-20261031` 8c694923e) and a change feed from its writes, this term goes to ~0. **The object table
must emit deltas.** Scanning it to diff is the one thing that does not scale.

## 3. Read-model worker (`split/read-model.ts`, `split/read-worker.ts`)

A `worker_threads` worker holds a `ReadModel`: per-32 m-cell indexes of bodies, fires, spots and objects; sight solids
by cell (with a short list for solids wider than half a cell); the place index rebuilt from the replicated places (the
ledger's own pure `PlaceIndex`, `inPoly`, `clearSight`); and the minds and faded sets. It ingests WorldInit/WorldDelta
from its `parentPort` and answers on its **own HTTP listener**, so it needs nothing from the tick thread.

**The subset it serves** (the same rules as `Perception`/`binds()`, compared field by field to the main-thread
answer by the oracle):
- `here`: `me.pos`; `near` (ids and distances: `perceivedBodies` + enclosure + sightline, top 6); things of kinds
  fire, spot, item, and objects that have a point (`Perception.things()` minus seats). Seats, exits and doHere are not
  in it, because they are cuts of `binds()` (§1.1).
- `capabilities`: the ids of `go-near:*` (60 m), `wave:*`/`face:*` (20 m), `warm-by-fire:*` (150 m) and `gather:*`
  (60 m). These are the menu rows that are pure (a).

**Measured** (oracle = the main thread computes `hereFrame` and `capabilities` for every Soul, then asks the worker
at the same tick and compares JSON; busy = a small harness script kept outside the repo: the tick thread is busy-looped for
2 s while a client asks the worker directly):

| | Result |
|---|---|
| Oracle, scattered Souls, 3 passes × 7 Souls (run1) | **21/21 identical** (here subset and caps subset) |
| Oracle, 6 Souls converged on one place (`field`, run2) | **7/7 identical**, with 3–5 Souls in `near`, 16–30 things and 7–15 subset offers each (two passes: 14/14) |
| Worker answer CPU, `here` subset | 1.7–9 ms warm (13.5 ms max on the first pass) |
| Worker answer CPU, `capabilities` subset | 0.4–2.2 ms |
| Main thread, the full `hereFrame` for the same Souls (for scale; it includes the whole `binds()` menu of 8,961–9,609 offers) | 214–745 ms, and **11–22 s** for one Soul standing among many objects (`kindOf` calls `objects.all()` once per nearby object, here.ts 241; L3's c987693eb fixes this on its branch) |
| **Busy-loop 2 s** on the tick thread, run1 (twice) | the worker gave 692 and 548 answers; wall **p50 1.8 ms, p99 8.6–9.6 ms, max 11.0–13.3 ms** (bar ≤ 20 ms); the tick stood still (1–2 distinct ticks seen); the world's own `/healthz` took 1.9–2.1 s |
| Busy-loop 2 s, run2 (converged) | 878 answers, wall **p50 1.2 ms, p99 5.3 ms, max 7.3 ms**; `/healthz` 2.1 s |

So the transport, the indexes and the "answer while the engine thread is wedged" property all work, at a cost that
fits easily. What the spike does **not** show is the rest of `binds()`: the (b)/(c) rows of §1.2 are exactly the part
a hand-written read model cannot reproduce.

## 4. Intent path (sketch, not prototyped)

1. **Routing.** A busy main thread cannot even accept a socket, so the read worker must own a listener (as in the
   spike). The launcher already proxies per world (`launcher.mjs` `toWorld`). In Stage B it sends C2 routes
   (`here/around/observe/capabilities/resolve`, L2's `classify()`) to the world's read port and everything else to
   main. One read port per world is enough: a small pool behind it uses a `MessagePort` per read worker.
2. **Acts from the worker.** The worker resolves the capability against its own menu and posts
   `{t:'intent', soul, route, capability, plan:{label, steps}, readTick, deadline, clientRef}` to main. Main wraps it
   in L2's `Admission` job (`lane/srv-load-20261031` `load/admission.ts`: `classify` → C1, the deadline, a
   `closed()` callback that asks the worker whether its client is still there). The dispatcher runs it between ticks
   as it does today.
3. **Revalidation, not a rebuild.** Today `actOnce` calls `binds()` again on the tick thread (`ledger.ts` 877), so
   every act costs a whole menu. In Stage B main receives the bound plan and checks only that plan:
   `engine.canPerform(plan)` (the engine's admission already route-checks at act time, `deferRouteChecks`), the
   receipt and idempotency rules (`clientRef`), and owner control. If the read model was stale and the plan is now
   wrong, the refusal is the same `{code, reason, did_you_mean}` an act gets today.
4. **Receipts back.** `ledger.emit()` (`ledger.ts` 430) runs after the commit. Its receipts go into the next
   WorldDelta (`receipts?: EdgeReceipt[]`) and to the inbox streams as today. The worker answers the act's HTTP
   request when main's job resolves (a MessagePort reply), and later reads see the receipt in their own replica.
5. **One outstanding per Soul** (`soul.busy`) is enforced by the worker, which owns the Soul's sockets. Main's
   Admission keeps the cost buckets.
6. **`around` finds** (around.ts 24) go to main the same way: `{t:'intent', kind:'knowledge.find', places}`.

## 5. Verdict: GO, with one change of shape

**Go.** On the live fixture, replicated per-tick state is small (≈ 320 B and ≈ 0.02 ms of tick-thread CPU per tick
for the body stream). A worker answers Soul reads in single-digit ms while the tick thread is wedged for 2 s, and its
answers equal the main thread's, field for field, on the subset it serves.

**The change of shape.** The read model cannot be a hand-written index that replaces the menu code. `binds()` needs
the engine's spatial service (clearance, standable, clear spots, connectivity: §1.2 rows 16–22) and, for a few
offers, the engine's admission (`canPerform`: rows 23–24). Stage B's read worker should therefore be **the existing
read code (ledger/perception/together/god-nav) running against a read-only `MenuWorld` facade**. That facade is backed
by (a) the replicated plain state of §2, (b) **an instance of the engine's own spatial service** built in the worker
from the static scene of the current static epoch plus replicated bodies, and (c) a handful of per-Soul admission
verdicts that main computes and ships in the delta when that Soul's program changes. The rest is checked again at act
time (§4.3). The per-cell indexes stay as the fast path inside the facade (bodies, fires, objects, sight solids).

**Fallback, if (c) grows:** a lockstep engine replica in the worker (design §2.6 W3: restore from main's checkpoint,
feed `drainInputs()` batches, check `stateHash()` every N ticks; `test/boot-replay-bench.ts` on `lane/srv-boot`
already proves replay equals live). It answers everything exactly, but costs an extra full tick per tick on another
core (≈ 20 ms CPU/tick here) and twice the heap. Not needed first.

**Agent-visible trade-off (FOR GENE):** with (c) moved out of the listing, a `here` exit that the planner would refuse
from this exact spot shows an ETA until main's verdict for that spot reaches the worker (one delta). Acting on it then
gets the same `route.unreachable` refusal as today. The walk/hang-out offers already work this way
(`deferRouteChecks`).

### What Stage A lanes should do differently now

| Lane | Do now | Why |
|---|---|---|
| **L3 menus** (`lane/srv-menus`) | Keep the versioned menu cache (172c1040a) and the static-version keys (775bcec88). **Add no new `host.engine.*` reach in read code.** New reads go through one narrow interface, the way `activities.ts` reads only `activityWorld()` (ledger.ts 1414). Keep the static per-cell layer separate from the per-Soul overlay. Let `act` take a bound plan (cap id + steps) without calling `binds()` again (ledger.ts 877). | That interface *is* Stage B's `MenuWorld`. Every new reach-through is a row to port. |
| **L4 spatial** (`lane/srv-spatial`) | Make `staticEpochV1()` (fa1521510) the one replication key. Keep clearance/standable/clear-spots/connectivity pure functions of (static scene at an epoch, body positions), constructible outside the engine runtime. Keep nav-trust (12678f8b0) per walker on main. | The worker builds its own spatial service from the same scene. Hidden runtime state in those queries would force the lockstep fallback. |
| **L8 objects** (`lane/srv-objects`) | Have the in-memory object table (8c694923e) **emit row deltas from its write path**, versioned by the canonical state sig (e2f919677). | Diffing 11,584 rows costs 26 ms a scan on main. It is the only measured term that does not scale. |
| **L5 boot** (`lane/srv-boot`) | Keep the snapshot view cache (1dd4f5c4e: one entity copy per world state) and expose it as the worker's WorldInit source. Keep `stateHash()` replay equality a tested property. | Worker (re)init must not be a second whole-world clone. Lockstep is the fallback. |
| **L2 load** (`lane/srv-load`) | Keep `Admission` jobs independent of the HTTP socket (key, route, deadline, `closed()` callback), so a job can arrive over a MessagePort. Keep `classify()` as the routing table for "C2 to the read port". | §4.1–4.2. |
| knowledge (`around`) | `K.find()` + `invalidateBodies()` in a GET (around.ts 24–25) must become an intent. | A read worker cannot write. |

### Stage B estimate (lane-days)

| Piece | Days |
|---|---|
| `MenuWorld` facade: port `binds()`, Perception, together, god-nav reads (≈ 40 read-path reach sites) | 3–4 |
| WorldDelta complete (receipts, sit holds, programs, carriers, static epoch) + oracle tests (seed: `split/`) | 2 |
| Spatial service in the worker from the static scene + bodies; oracle vs engine answers | 2–3 |
| (c) per-Soul admission verdicts + route-problem memo replication; act with a bound plan | 2 |
| Read port + worker pool + launcher routing for C2 | 2 |
| Intents over MessagePort into Admission; receipts back | 1–2 |
| Oracle soak (all five reads, field for field) + N=100 bench, two repeats | 3 |
| **Total** | **15–18** (the plan's 3–4 weeks including the bench) |

## Files
- `apps/server/src/split/read-model.ts`: WorldInit/WorldDelta types, the 32 m-cell `ReadModel`, the subset queries.
- `apps/server/src/split/delta.ts`: `DeltaTap` (init, per-tick delta, cost counters).
- `apps/server/src/split/read-worker.ts`: the worker (port + own HTTP).
- `apps/server/src/split/preload.ts`: harness only (`--import`), oracle, busy-loop, walkers.
- Harness and receipts (`run-world.sh`, `busy.mjs`, `oracle-run.sh`, `run1/`, `run2/`) were kept outside the repo.

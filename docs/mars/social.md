# Social vocabulary: seats, groups, pre-emption

People living in a place, on the same action runtime as walking and construction ([spec.md](spec.md) §17).
Code: `engine/social/` (`slots.ts`, `actions.ts`, `ambient.ts`); tests:
`engine/test/social.test.ts`; verbs are in the one registry (`api/registry.ts`).

## Interaction slots (smart-object claims)
A `Slot { id, owner, kind: seat|stand|audience|fire-circle, p, yaw, level, claimedBy? }` is a
place a body occupies, facing `yaw`. Slots are **derived, never stored**:
- **Fixtures** whose catalog def lists `slots` (`world/catalog.ts` `SlotDef`, local x/z + yaw):
  `bench-6ft` (3 seats, 2 ft apart), `camp-chair` (1 seat), `campfire` (8 fire-circle places on a
  1.6 m circle facing the fire). Seats face local +z. Ids are `<entity>#<slot>` (`chair#seat`,
  `fire#ring3`). Fire-circle rule (`catalog.ts` `FIRE_RING_GAP`, `fireRingRadius`): a place stands
  ≥ a body radius + 0.3 m beyond the fire ring's farthest corner and never closer than 1.6 m — for
  the 1 m ring that is 1.6 m, ≥ 0.8 m grid clearance, so all 8 places are standable.
- **Place regions** with an audience `layout: { focus, spacing?=0.9, rowGap?=1.0, kind? }`
  (`SocialRegion`, an extra JSON field on the region): rows perpendicular to centroid→focus,
  nearest row first, points kept only inside the polygon with body clearance; ids `r<i>c<j>` of
  the full grid so they stay stable when a point drops out.

A claim is a runtime reservation on `slot:<id>` (exclusive), so two actions can never own one
seat ([spec.md](spec.md) §28 "Reservation conflict"); `claimedBy` is read back from `rt.holder`. A slot is
*free* when unclaimed **and** nobody's body is on it (`occupantOf`). Assignment for groups is
deterministic nearest-first (all actor×slot pairs sorted by distance, ties by list order).

## Seat fixtures are obstacles; approach points
All three social fixtures carry `obstacle: true` in the catalog, so `spatial/service.ts` makes them
static obstacles at their catalog box **even without a construction `phase`** (a phase still wins:
`carried` lifts one out). Every box is taller than the 0.22 m step (chair 0.85 m with its back,
bench 0.45 m, fire ring 0.35 m), so their cells are blocked at ground level and walkers route round
them.

A fixture seat (`kind: 'seat'` owned by an entity) is therefore never walked onto. At claim time
(`sit` / `take_slot` plan) `seatApproach` picks its **approach point** deterministically against the
current grid: `APPROACH_GAPS` = 0.35 / 0.40 / 0.45 / 0.50 m beyond the fixture's edge along the
seat's facing (front), the first with ≥ `APPROACH_CLEARANCE` (0.30 m) clearance; if all four are
blocked, the same distances behind the fixture (mirrored). If both sides are blocked the verb is
refused `slot.unreachable`, naming the seat, its fixture and the blocker of each side (e.g.
`passage-e (passage east wall)`), before anything is reserved. The plan-time route check goes to the
approach point.

Execution: `walk_to` the approach point (arriving facing the seat yaw) → `turn` → **`sit-down`**
(activity `sit-down`, `SIT_TRANSITION` = 0.6 s, smoothstep from the approach point onto the seat
point) → `occupied` (activity `sit`; a fixture seat is always held sitting, whatever `activity`
was asked). Cancelling (`stand`, gather cancel, pre-emption by a directed task, `releaseForDirective`) a seated / sitting-down person
is a **deferred** stop: **`stand-up`** (activity `stand-up`, 0.6 s, or the remaining share of it)
back to the approach point, then idle; the action ends `cancelled` and the seat claim is held until
the body is off the seat. `stand` completes when that stand-up has finished.

**Any seat height ([#1083](https://github.com/genekogan/souls/issues/1083)).** A body sits on every seat a def declares, however high or low; nothing refuses a seat by its height (`seat.too-high`, `pose.seat-too-low` and the use-check's `use.seat-fit` are gone). The transition is the same horizontal smoothstep as any seat, so no tick's step exceeds a human's.

Invariant exemption (`runtime/invariants.ts` `SEATED_ACTIVITIES`): like `climb-*`, a person whose
activity is `sit`, `sit-down` or `stand-up` (or the item overlays `eat` / `serve`, [items.md](items.md)) is exempt from `collision.human-static` — the seated
body is inside its own chair's footprint by design. The exemption is by activity, so it relies on
the social verbs only setting those activities on a seat or its approach line.

**Renderer activity names**: `sit`, `sit-down`, `stand-up` (seat), `talk`, `warm`, `watch`,
`listen`, `idle` (+ `walk` from `walk_to`). `sit-down` / `stand-up` last 0.6 s while the body
point moves between the approach point and the seat.

## Verbs
Every verb moves people with child `walk_to` actions (arriving with `face`) and then holds them
in an activity until cancelled. No loads are involved, so every cancel is immediate — people stop
where they are, `activity = 'idle'`, `task` cleared, all actor/slot claims released — except a
seated person, who first stands up to the approach point (0.6 s deferred stop, above).

| Verb | Params | Behaviour |
| --- | --- | --- |
| `sit` | `actor, slot \| fixture` | walk to the seat's approach point, turn to its yaw, `sit-down`, `sit` until `stand`/cancel; `slot.unreachable` if no approach point. Explicit `slot` taken → `reservation.conflict` naming the slot + holding action; `fixture` with no free seat → `slot.none-free` naming the fixture and who holds / stands on each seat |
| `take_slot` | `actor, slot \| owner, activity?` | same for any slot kind; activity defaults by kind (seat→sit, audience→watch, fire-circle→warm) |
| `stand` | `actor` | cancels the actor's `sit`/`take_slot` (seated: `stand-up` 0.6 s to the approach point, then idle; `stand` completes after it); `social.in-group` for a converse member |
| `face` | `actor, target: {entity} \| {point}` | turn in place (turn rate 4 rad/s), idle |
| `converse` | `actors[2..6], at?, duration?` | circle of radius clamp(0.4/sin(π/n), 0.6, 1.0) m around `at`, else the nearest fitting centre to the centroid (rings to 3 m); actors keep their angular order (no crossing paths); all face the centre, `talk`. Refuses `actor.holding`, `converse.levels`, `converse.clearance` (names the wall/person) |
| `gather` | `actors, region \| fixture, activity?` | one child `take_slot` per assigned person; people left over get a child that fails `slot.none-free` naming the owner. Ends when all children end |
| `campfire_circle` | `actors, fire` | gather on the fire's fire-circle slots, activity `warm`; `campfire.not-a-fire` otherwise |
| `ambient_wander` | `actors, region, seed?, duration?` | background strolls (below) |
| `eat` ([items.md](items.md)) | `actor, bowl, spoon, cycles?` | overlay — no `actor:` claim, so it runs inside `sit` / `take_slot` / `gather` / `converse`: activity `eat`, `human.baseActivity` = the group's activity (`sit`, `talk`, …), 2.4 s spoon cycles with per-tick `human.hands` until the bowl is empty; `eat.not-still` while walking / transitioning. `take_item` / `put_item` / `serve`: [items.md](items.md) |

## Ambient autonomy
`ambient_wander` **reserves nothing**. Each tick, in list order, an idle unclaimed person whose
pause is over gets a child `walk_to` (0.9 m/s) to a random point of the region: inside the
polygon, ≥ 0.53 m clearance, ≥ 1.2 m from other people and other wanderers' targets. Draws come
only from `world.rng` (`seed` offsets them), so runs are reproducible and fork-safe. Pauses are
2–8 s (first walks staggered 0–2 s). An explicit directed task records a return intent
before pre-empting an ambient walk (or while the person is paused). After the outer
directive completes successfully, the still-live ambient action can adopt an eligible
person through a normal walk to its original region. Failed/cancelled/newer commands,
held loads or hand items, another group/task, or a missing/changed region refuse return.
Manual cancellation of an ambient walk and unrecorded foreign ownership still release
that person permanently; `walk.ts` make-way nudges are transient and do not count. Cancel stops new walks; in-flight walks
are cancelled by the runtime (people stop in place).

## Pre-emption: directed tasks release social holds
Explicit director commands outrank social life. A social action owns its people's `actor:<id>`
reservations; every social verb declares a `yieldTo` hook (`actions/types.ts` `ActionDef.yieldTo`),
and `Runtime.submit` uses it:

- **Who pre-empts.** A *directed* submission — its verb and every ancestor lack `yieldTo` (walk_to from a
  director / MCP / sequence step, carry, construction steps, `take_item`, `paint`, …) — whose `actor:`
  claims are held under a social action. Its reservations are read **before** its plan (a seated person's
  walk_to plan would otherwise fail `route.start-blocked` inside the chair), so a verb whose reservations
  depend on its plan contributes only the ones its params name. If any of its conflicts is not an `actor:`
  claim under a social action (a carry, a slot, an item), nothing is pre-empted and the ordinary
  `reservation.conflict` stands — critical tasks are never abandoned for autonomy.
- **What is released: the smallest social unit** — this person's own `sit` / `take_slot` (a `gather` /
  `campfire_circle` keeps its other members), their current ambient walk (eligible members may later be re-adopted), or a member of a fully formed `converse` when at least two remain. Those
  remaining members keep their positions and talk; a two-person or gathering converse
  still ends as a unit, as does `face`. Cancelled units have diagnostic `social.pre-empted`, message
  **`pre-empted by <id> (<verb>)`** (`details.reason` = `pre-empted by <id>`), on the record and on its
  `cancelling` / `cancelled` take events.
- **Timing.** A converse / face / standing slot / ambient walk releases at once, and the directive is
  planned and started in the same `submit`. A seated person first stands up (0.6 s `stand-up` to the
  approach point, the seat claimed until they are off it): the directive **waits** — status `requested`,
  phase `pre-empting`, `rt.isActive` true, `runUntilIdle` waits for it — and is planned, reserved and
  started at the end of the tick the hold ends (a plan failure then fails it with that diagnostic).
  Cancelling a waiting directive ends it `cancelled` without starting it (the stand-up still finishes); a
  waiting child whose parent has ended fails `action.parent-ended`. Snapshots preserve
  waiting directives as unstarted intent; planning and reservation still wait for stand-up.
- **Never social vs social.** A social verb (or a child of one) never pre-empts: `sit`, `take_slot`,
  `face`, `converse`, `gather` for a held person still fail `reservation.conflict` naming the holder (a
  converse that includes a seated person is refused even earlier, `route.start-blocked` from the chair).
  Autonomous nudges are not directives either: a `walk.ts` make-way walk (`<who>:make-way:<tick>`) is
  refused as before.
- **Opt out:** `preempt: false` restores the plain refusal — as a boolean key in the directive's params
  (stripped before validation, so it works for any verb, from MCP or a sequence step) or as
  `rt.submit(verb, params, { preempt: false })`.

`releaseForDirective(rt, actor, reason?)` does the same release by hand; `socialHolder(rt, actor)` reports
which social action owns someone. **Hash safety:** nothing new runs unless a live action has `yieldTo` (fast path).

## Tests (`engine/test/social.test.ts`)
Registry wiring; catalog slot geometry; two sitters on one camp-chair (conflict / none-free /
stand-up to the approach point); seat fixtures + campfire block their grid cells without a phase and
all 8 fire places are standable; 3 sitters round a row of 5 chairs and a bench (never inside another
fixture's footprint on any tick, seated exactly on the slot, stand-up back off it, 0 violations); a
chair walled in front and behind → `slot.unreachable` naming both walls; converse circle (spacing, facing < 0.2 rad, cancel → idle + no claims); converse
refusals (holder, wall); campfire_circle with 10 → 8 warm on their claimed ring places, 2
`slot.none-free`, cancel → no claims; audience-region gather; ambient 6 people × 60 s (targets in
region, 0 violations, directed task takes one and ambient lets go); determinism hash. Pre-emption:
seated person + directed carry (stand-up 0.6 s, carry starts the tick the seat is released, sit
`pre-empted by <carry>` in the events, carry completes, 0 violations, waiting snapshot resumes exactly);
cancelling a waiting directive; converse pair + one directed walk (both idle, reason on the converse);
campfire gather of 4 + one directed (3 keep warming, gather runs on); social vs social stays
`reservation.conflict`; `preempt: false` in params and as a submit option → refused; make-way nudge
refused; determinism (hash + event log).

## Missing / approximate
- **Sit pose / animation is a renderer concern**: the engine sets `activity` (`sit-down` → `sit` →
  `stand-up`), yaw, and moves the body point between the approach point and the seat point.
- Fixture obstacles are their full catalog box (the chair's includes its back); a mirrored approach
  (behind the fixture) means a chair's sitter steps over the back — only used when the front is
  walled off. Approach points are not reserved: another person standing on one makes the sitter's
  walk yield/replan, not fail at plan time.
- The seated exemption is by activity (`SEATED_ACTIVITIES`), not per fixture.
- No conversation turn-taking, gaze or gestures. A formed group can now retain two members and rejoin a returning member (below).
- Resumption after a directive is covered below; group-owned fixture seats do not resume. An `eat` / `serve` overlay
  on a pre-empted sitter is not released by pre-emption (it holds hands, not the actor): it fails
  `eat.not-still` as soon as the stand-up moves them, and a directive that needs free hands is then
  refused at its plan (`actor.holding`) while they still hold the bowl.
- Regions are single-level; audience layouts do not use seats/benches inside the region.
- The engine view (`app/engine-view/humans.ts`) layers procedural poses on the Idle clip: `sit` /
  `sit-down` / `stand-up` lower the body onto the seat (leg IK, hands on thighs, 0.4 s blend) and
  `warm` holds the hands out toward the fire; `talk` / `watch` / `listen` are still the plain
  standing Idle pose (no gestures or gaze).


## Resumption after a directive

Pending return intents are plain data (`services.socialReturns`, conversation and ambient execs), captured by the
snapshot graph and absent when unused. One return attempt is made per release, marked `social.resume-started`,
`social.resume-refused` or `social.resume-skipped`.

- **Seats.** An occupied standalone `sit` or seated `take_slot` records its slot and activity before yielding. After the
  directive completes successfully, the runtime submits a new non-preempting social action for that exact slot; the
  actor walks back through ordinary planning and reservations. A failed or cancelled directive, or any newer explicit
  command for the actor, skips the return. Occupied, deleted or unreachable seats and held actors are refused by normal
  admission; the runtime never steals a seat or releases a load to sit. Group-owned fixture seats do not resume.
- **Conversations.** A directive may release members of a formed conversation while at least two remain; the others keep
  talking in place. The group records each departing member's station; after the directive succeeds, an ordinary
  non-preempting `walk_to` returns them, and only then does the group reclaim the actor. Refusals:
  `converse.return-refused`.
- **Ambient.** After a successful directive, a still-live `ambient_wander` may re-adopt an eligible person through a
  normal walk to its region (`ambient.readopted`), or skip with `ambient.return-skipped`.
- **Snapshots.** Waiting directives are stored as unstarted intent in the graph's `waiting` array. Restore validates
  provenance, parameters and reservations and refuses corrupt return data (`snapshot.waiting-dependency`,
  `snapshot.return-invalid`, `snapshot.converse-return-invalid`, `snapshot.ambient-invalid`). Before-departure and
  during-return snapshots continue with identical world hashes.
- Returned seats are ordinary indefinite holds: `runUntilIdle` over all actions does not treat an occupied seat as idle;
  wait on the directive id instead.

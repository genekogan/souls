# Movement: `walk_to`

Code: `engine/locomotion/walk.ts`, `engine/locomotion/spline.ts`, `engine/spatial/path.ts`, `engine/runtime/waits.ts`,
`engine/take/metrics.ts`. Tests: `engine/test/movement.test.ts`, `navigation.test.ts`, `review.test.ts`.

## Route and spline

The planner string-pulls a corridor polyline on the level grids (`spatial/path.ts`). On entering a leg, `walk_to` turns
it into straight runs joined by circular fillets (`smoothPolyline`):

- Per interior vertex, radii `RADII` = 1.2, 0.9, 0.6, 0.45, 0.3, 0.2 m are tried largest first, with the vertex pushed
  outward by 0–0.3 m. A fillet must fit its legs and keep grid clearance ≥ min(r + 0.06 m, the raw corridor's own
  clearance), sampled every 2 cm. If nothing fits the vertex stays sharp.
- Every vertex carries a speed cap: on a fillet `min(speed, √(1.5·R), 0.8·turnRate·R)`; a sharp vertex 0.35 m/s, or a
  stop and turn in place above 2.5 rad. The follower brakes at 1.2 m/s² for every cap ahead.
- A route planned around people (`routeAround`) is smoothed on the same people-overlaid grids, so a fillet never cuts
  into someone it avoids.

**Heading.** The walker aims at the path point 0.3 m ahead and turns at most 0.2 rad per tick, always the shorter way.
Heading error caps speed: full up to 20°, falling to 0 at `TURN_IN_PLACE` (2.1 rad, 120°). It turns in place only past
120° and walks off while finishing the turn. A new corridor caps speed by its heading error at once, so nobody slides
sideways at walking speed.

## Reacting to blockers

**Anticipation**, every tick, over the next `LOOK_TIME` = 1.5 s of corridor (sampled every 0.1 m at the offset the
walker will actually have): standing people, momentarily blocked walkers (next 0.1 m only), carried loads, and geometry
when the corridor predates the current navigation epoch. The walker brakes to stop `STOP_GAP` = 2 cm short of the first
hit, so the hard separation layer rarely fires.

| State | Activity | Status |
| --- | --- | --- |
| walking (speed ≥ `WALK_MIN` 0.08 m/s) | `walk` | running |
| turning in place | `idle` | running `turn` |
| emergency stop, stopped short, holding | `wait` | blocked: `traffic.person` / `traffic.load` / `walk.obstacle` naming it |
| give way / yield | `wait` | blocked: `traffic.person`, `traffic.yield`, `traffic.stepped-aside` |
| decision after `DECIDE_TICKS` (10 ticks) with no blocker movement | — | `routeAround` standing people and loads |

- A **standing** blocker is routed around within `DECIDE_TICKS`. A **walking** blocker is waited for, followed or given
  way to; the walker routes round it only after `STUCK_TICKS` (4 s).
- One blocked stretch has one decision clock; it ends only when the walker is under way again (faster than 0.15 m/s or
  0.2 m further along).
- Failed people-replans back off 1, 2, 4, 8, 16 s, at most `MAX_PEOPLE_REPLANS` = 6 attempts.
- **Squeeze.** `routeAround` names the people behind a failure (crowding start or goal, walling in the search, blocking a
  stair approach). The walker then re-plans with those people as smaller octagons (`SQUEEZE_HALF` 0.22 m), still outside
  the 0.54 m separation. A structural failure names nobody and is not retried.
- A crowded start may snap up to 1 m to the nearest standable spot. Idle people in the way are asked to make way
  (`makeWay`). A `walk.obstacle` block forces a construction replan next tick.
- A walk that is blocked, or settling onto its goal, counts as a standing obstacle for others.
- **Sidesteps** round standing people choose the lateral offset (±0.8 m) with the most room and latch it until the person
  is behind; the side never flips while the latched person is alongside.
- **Walker–walker encounters** (follow, head-on, crossing, pass with room) are measured against the smoothed path over the
  next `LOOK` = 2.5 m and the other walker's ~1 s path chord.
- Within 1.5 m of a driven vehicle a walker slows to 0.5 m/s (never stops; the vehicle stops for people).
- A mutual single-file wait is released once both sides have waited `RELEASE_AFTER` (3 s).

## Speed limits and invariants

A `walk_to` body moves at most `min(speed, WALK_SPEED_CAP) × DT` per tick (`WALK_SPEED_CAP` = 1.4 m/s). Forward
progress, sidestep offset and any pull back into line share that budget: if the full step does not fit, the walker
takes the largest fitting fraction and slows; if an offset must narrow ahead, it pulls in first.

End-of-tick invariants (`runtime/invariants.ts`):

- `motion.teleport`: a person on foot moves ≤ `MAX_HUMAN_STEP_PER_TICK` = 0.15 m per tick. Riders and carried components
  use `MAX_STEP_PER_TICK` = 0.6 m.
- `motion.overspeed`: published `human.speed` ≤ its activity's cap in `SPEED_CAPS` + 5 % (walk 1.4, climb 0.45, idle /
  wait / climb-wait 0.08 m/s, plus jog, run and cycle). An activity that publishes a speed without a cap is a violation.

## Renderer contract

- `human.speed`: horizontal ground speed over the last tick, published while `walk_to` owns the person and cleared when
  the walk ends.
- `human.activity === 'walk'` only while speed ≥ 0.08 m/s; a blocked walker is `wait` at speed 0; turning in place is
  `idle`.
- Play the Walk clip iff speed ≥ 0.08 m/s (in a take, derive it from consecutive track samples).
- `walkStallsOfTake(take)` / `walkStallMeter(rt)` (`take/metrics.ts`) count person-ticks labelled `walk` below
  0.05 m/s; the movement tests assert zero on the pinned runs.

## Persistent waits and bounded recovery

`runtime/waits.ts` builds a dependency graph by mover: carry walkers stay separate nodes, moving carries alias their crew
to the load, rides alias the rider to the vehicle. A cycle with unchanged dependencies and poses for `DEADLOCK_TICKS`
(200 ticks, 10 s) reports `deadlock.cycle`; a persistent acyclic wait reports `deadlock.stalled`. Each episode may request
one extra validated planner attempt within existing budgets; unsupported phases report
`deadlock.recovery-unavailable`. The detector never forces a release. `SequenceRunner` returns `blocked` early only when
every live action certifies its movers exhausted and no future cue or timeout could change that; it does not settle the
blocked actions, and `execute` refuses to commit the unsettled result.

## Stall releases on upper levels

The edge stall guard (`apps/server/src/edge/ledger/stall-guard.ts`) releases a body whose hold stopped making progress
(engine `stallReleaseV1`, folded from the logged `edge-stop`). On the ground it stands the body at the nearest free
standing spot. On an upper level it used to stand it where it was, which for a walk stuck cancelling mid-flight is
off the level's floor: the next tick faulted `collision.human-static`, and every recovery plan replayed the same
release (#447). With `stallReleaseSupportV1` (prospective runtime policy, hashed; every edge world
turns it on at startup) an upper-level release stands the body where it is only when its level has a clear standing
disc there. Otherwise it goes to the nearer free landing of the stair link its walk is on: a clear disc on that
landing's level and nobody within two body radii in plan and 1.5 m in height. With neither, nothing is released: the
probe reports `exempt: 'release.unsupported'`, the guard leaves the body in its native hold, and nothing faults.
Histories before the policy replay the old placement.

## Live stair-link changes

Routes copy planned link geometry, and every link step re-checks the current scene link. A closed, missing or changed
link returns `route.link-unusable`: before entry the action fails; between levels it stays blocked at its pose with
ownership retained, and resumes once the link is restored. A missing landing blocks as `route.landing-unavailable`.

## Occupied landings

A climber waits on the flight (`climb-wait`, blocked `traffic.person` naming the body) instead of stepping into anyone
it would come within 2r − 0.02 m of and closer to (`stairBlocker`). Walk avoidance and the `collision.human-human`
invariant compare bodies on the same level only, so a walker on the destination floor does not see a climber still on
the flight. Under the runtime policy `stair-landing-clearance/1` (`stairLandingClearanceV1`, #509), the final step of a
climb, or of a cancelled climb, also refuses a landing that a body on the destination level occupies: within 1.0 m in
height and closer than the two radii less 0.02 m in plan, whatever the direction of that step. Once a second it asks
an idle body there to make way (`makeWay`, clear of the landing); a body with a task of its own is waited for. The
climber resumes when the landing clears. A body on the destination level can still stand over the top of a flight
whose last stretch runs under that floor (the commons deck's front flight): neither walk avoidance nor the invariant
sees the climber there until it changes level. Carry climbs keep the direction-only check. The policy is prospective. Edge worlds log it at startup (`operator:stair-landing-clearance`)
after the other stair-traffic rules, except the Little Martians worlds. History before that event replays the old rule.

## Approximations

- The look-ahead predicts the sidestep offset at 0.9 m/s lateral; the hard layer catches the rest (counted in
  `outputs.pushes`).
- No time-to-collision model between walkers; head-on round a tight corner is decided by the single-file traffic rule.
- Emergency stops are abrupt (velocity to 0 in one tick; position stays continuous).
- With 0.1 m cells, a 1.08–1.5 m gap between two people cannot always be planned through, although the look-ahead and
  sidestep can walk it.
- Other movers (carry formations, frame climbs, sit transitions) publish no speed; only the 0.15 m teleport bound applies.

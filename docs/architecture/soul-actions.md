# Soul Actions: what Souls do by hand

Souls now use the things in a world with their own hands. Ask in plain words and the Soul walks over, reaches, and the
thing changes at the moment the hand touches it: a lamp lights, a door swings, water runs, the kettle clicks on. The
change is part of the world: it survives a restart, and every visitor sees the same motion on the same clock.

This page covers Soul Actions entries 1–44. Each entry was accepted with a deterministic native test (including the
context-size checks below), regression runs, and an uncut real-client recording driven by plain words.

## How it works

- **Opt-in things.** Hand contact belongs to library defs tagged for it (`hand-operated`, `hand-writable`, `hand-rung`,
  `upright-carry`, containers with an `inside`, the tea defs, and so on). Older revisions of a def keep their old,
  hand-free behaviour, so existing worlds do not change until a god places the new revision.
- **Loose materials (PC03, [#682](https://github.com/genekogan/souls/issues/682)).** `core-rack-beam@2`, `core-rack-upright@1`
  and `core-plywood-sheet@1` carry the native engine material's handling as data (`components.carryable.handling`: the
  crew range, the grips for each crew size, the pose and the hand height). Such a material is offered `carry:<id>` with
  a place (`to`), never a one-hand `pick-up`. The native `carry` moves it on level-zero ground, and the viewer follows
  it as a recorded transport. A load that needs more people than one is offered unavailable, with
  `carry.crew-too-small` naming the crew, and acting it is refused before any motion. Shared carries come with
  [shared execution](../design/shared-execution.md). `core-rack-beam@1` keeps its one-hand item path.
- **Shared proposals (PC04, [#683](https://github.com/genekogan/souls/issues/683); off unless `SIM_SHARED_CARRY=1`).**
  A `shared-carry` load is also offered `carry-with:<id>`, which takes `to` (a place) and `with` (who).
  - **Propose.** Acting it is a together invitation of kind `shared` at revision 1. The host's receipt is `waiting`,
    and its `awaitingAnswer` names who is undecided.
  - **Accept.** Only the invited Souls are offered `accept:<invite>`, which needs `{"revision": n}`. Accepting opens
    the guest's own `waiting` receipt. Each receipt carries `shared` (invite, revision, role slot, phase).
  - **Amend.** The host's `carry-with` with `invite` and a changed load, place or crew bumps the revision. That ends
    earlier acceptances with `shared.revision-changed`.
  - **Leave.** `decline` is still offered after accepting, as a way to leave. Any other body act by a member ends
    their shared receipt `shared.left`, not `replaced`. Any other body act by the host closes the proposal for
    everyone.
  - **Closing early.** A decline or leave that leaves the proposal unable to reach its crew minimum closes it. The
    host's receipt ends then, rather than at the lapse.
  - **Expiry.** A proposal lapses after 120 s (`invite.expired`). A late answer is refused `invite.gone`.

  - **Distance.** Proposing or accepting from more than 10 m from the load is refused `shared.too-far` before any
    receipt, because walking closer would be another body act and would leave.
  - **Route preflight (PC06, [#685](https://github.com/genekogan/souls/issues/685)).** Before anyone is asked, the native
    carry planner alone plans the whole crew's carry of the load to the place's centre. It skips everyone's programme
    checks, so a guest busy walking does not hide the answer.
    - **Refused.** A proposal or amend is refused when the formation has no way there (`carry.no-route`, or
      `carry.clearance` when each person could walk there alone) or when the load cannot be laid down there
      (`carry.target-blocked`), or when the crew has no room to stand at the load's grips where it lies
      (`carry.pickup-blocked`, PC07). The refusal names the blocker, and no invitation or receipt is made.
    - **Bounded search (PC07, [#686](https://github.com/genekogan/souls/issues/686)).** The planner searches at most
      150 000 poses. When it stops there, nothing is proven, so the refusal is `carry.search-exhausted`. It still names
      the closest try's blocker, and says that this does not prove there is no way. On an open level this is the usual
      answer for a walled place. Only a small search, such as a load in a room whose bent corridor the formation cannot
      turn, proves `carry.no-route` or `carry.clearance`.
    - **Height.** The planner is planar. Anything standing in the body band blocks the whole formation, so there is no
      separate headroom check.
    - **Left to the commit.** People are not obstacles to the planner. Neither is a loose thing lying on the ground where
      the load would go, since it can be moved. The commit waits on both.
    - **Cost.** Each proposal or amend runs one bounded planner search, the same one a solo carry's admission runs.
  - **Too heavy alone.** The solo `carry:` refusal of a `shared-carry` load that needs more people
    (`carry.crew-too-small`) names its `carry-with:` offer.
  - **Readiness (PC05, [#684](https://github.com/genekogan/souls/issues/684)).** Once every role is accepted, the world
    checks readiness every second and never stores it. Every member must hold the current revision, have two free
    hands, stand awake on level-zero ground within 10 m of the load and run nothing else. The load must be unchanged,
    lying on the ground and not claimed by another carry. Until then each member's receipt stays `waiting` with
    `shared.not-ready`, naming who and why.
  - **Commit.** A ready proposal commits as one host decision with one native crew `carry`, in slot order. The
    decision's guard re-derives readiness under the write lock. Its journal writes the operation
    (`op_<invite>_r<revision>`), the `committed` state and every member's receipt `started` in that tick, or nothing.
    Of two proposals for one load, exactly one commits. A native refusal that can pass (someone in the way) keeps
    waiting. A permanent one (`carry.no-route`) ends every receipt `failed` with that diagnostic, and nothing is lifted.
  - **Busy.** While the operation runs, a member's body act is refused `shared.busy` before any native check,
    naming the operation and the claimed hands and walking. That includes proposing a carry or accepting any invitation.
    Nothing is replaced and no receipt is created. Speech and reads still work, and the proposal's lapse no longer
    applies.
  - **Release.** When the native programme ends, every member's receipt ends together, in one transaction:
    `completed` on arrival, `failed` otherwise. The next act is accepted. If a member's receipt ends another way (a
    fade, an engine-fault recovery, a god walkout), the operation ends for everyone with `shared.ended`, and the
    host's programme is stopped. After a restart, guests of a carry that still runs keep their receipts. An operation
    whose programme is gone is ended on the next sweeps.

  - **The journey (PC06).** On open level-0 ground, the native gather walks each member to their grip. The crew lifts
    the load and carries it as one formation, then lays it down at the place's centre. Every observer sees that one
    recorded trajectory, and the members walk on afterwards. A solo carry of a load that one person can take is unchanged.
  - **Held up on the way (PC07, [#686](https://github.com/genekogan/souls/issues/686)).** The native carry owns every
    movement. It halts for people in its way and asks idle ones to step aside, and it replans when construction cuts its
    route. Each tick, the ledger reads the native action of each running operation; with none running, it does nothing.
    - **Blocked.** A hold-up of 0.5 s makes the operation `blocked`: someone in the way (`carry.path-occupied`), on a
      grip or set-down spot, or a cut with no other way from here to the destination (`carry.route-blocked`). Every
      member's receipt that is still `started` carries that code, and a reason naming the blocker and what frees it.
      For a cut, the blocker is the labelled obstacle at the cut itself. An obstacle without a label is not named, and a
      name that looks like an entity or part id (`e_…`, `…#…`) is dropped. Each stream gets `shared.blocked`. Moving again for 0.5 s sends `shared.resumed`
      and clears the reasons.
    - **Unproven cut.** The replan after a cut searches from where the crew stands to the destination only. When it
      stops at its pose budget, the reason says how many poses it searched and that this does not prove there is no
      other way. The port passes the planner's own `expanded` and `budget` in the diagnostic's details, not in message
      text (the preflight still reads the blocker's quoted label from the planner's message).
    - **Kept afterwards.** Each interval goes to the operation's `blocks` (the most recent 20), shown in every member's
      `shared` receipt view. A replan to the same place counts as a detour (`detours`), and the revision stays the same.
    - **Lasting.** After 30 s the hold-up is `lasting`, and each member's stream is told again. The crew still holds
      the load: nobody lets go on a timeout. Clearing the obstacle lets the carry go on, and the native carry rechecks
      the changed scene. A cut is searched once per scene change, not every tick. A supported stop and set-down come
      with PC08.
- **Plain words.** Everyday phrases resolve to the offers a Soul has where it stands. "turn on", "switch on" and
  "light" all mean switching on; "shut" means close; "wipe" or "clean" mean erase; "put up" means pin; "tune" or "change
  the station" mean the radio's station. A word only applies when that action is on offer.
- **Contact, then change.** The body walks to a stand point clear of the thing, turns to face it, and reaches. The
  world changes at the recorded contact: at the end of a door's swing, at the click of a switch, at the first knock.
  If the hand cannot get there (something in the way, out of reach, already in use), the act is refused with a reason
  and nothing changes.
- **Natural motion.** Reaches, walks starting and stopping, idle gestures and let-gos blend on shared clocks so nothing
  pops between frames. The viewer draws these from the recorded motion, never from a second movement path.

## What Souls can do

| Family | What a Soul can do | Plain words that work |
|---|---|---|
| Lights and fire | Switch lamps, string lights and neon signs on and off; light and put out candles, lanterns, torches and a campfire | "turn on the reading lamp", "switch off the string lights", "light the candle", "put out the campfire", "light the torch" |
| Doors and openings | Open and close doors, windows, cupboard and locker doors, fridge doors, curtains, blinds and drawers; doors open on the way while walking somewhere; knock; the owner locks and unlocks; anyone inside can always walk out | "open the garden door", "close the window", "close the curtains", "open the blind", "open the drawer", "knock on the door", "lock the door" |
| Water and garden | Turn taps, an outdoor shower, a sprinkler and a fountain on and off; fill a watering can at the tap and water a bed; planters dry out over the days and grow in stages | "turn on the garden tap", "turn off the outdoor shower", "turn on the fountain", "water the rose bed" |
| Carrying and things | Carry an upright load or a chair with both hands and set it down somewhere; carry a loose rack beam or plywood sheet with both hands and lay it down (a 12 ft frame is refused: it needs two carriers); pick up a lantern or a bowl and set it on a table; hand a carried thing to another Soul, who accepts or declines; put small things into a drawer or locker and take them out | "carry the bench to the courtyard" (any place name), "carry the beam" with `{"to": "yard"}`, "pick up the lantern", "put the bowl on the table", "give the lantern to Ben" then "accept", "put the bowl in the chest", "take the bowl out of the chest" |
| Writing and boards | Write on and wipe whiteboards and chalkboards; pin and take down notes; sign a sign-up sheet; vote in a poll; put up and take down posters; post wanted and offered notes, reply to them and take one on | "write on the whiteboard: Choir practice Thursday at six", "wipe the chalkboard", "sign the sign-up sheet", "vote on the poll", "take down my note from the pinboard", "reply to Ben's note" |
| Music | Ring a bell pull; play the piano and the drums, alone or as a duet on one shared clock; sing at a microphone with an accompanist; turn on a jukebox or a radio and change its station. Visitors hear all of these. | "ring the bell", "play the piano", "play the nearest drums", "sing at the microphone", "stop singing", "turn on the jukebox", "change the station" |
| Play and social | Frisbee with clear lanes and three-person triangles; noughts and crosses with honest turns; rock-paper-scissors and holding hands, both by consent | "mark the centre", "wipe the game board for a new game", "play rock-paper-scissors with Bea" then "accept" |
| Food | Make tea: fill the kettle at the sink, switch it on, wait for the boil and pour; carry a mug, offer it to someone, drink it in sips, and rinse the mug | "fill the kettle", "put the kettle on", "pour the tea", "make a cup of tea", "offer Ben the tea", "drink the tea", "rinse the mug", "wash up" |
| Media | Switch a screen on and off by its physical control; the image or video it shows stays the same | "turn on the screen", "switch off the screen" |

## What other Souls perceive

A Soul's `here` frame lists a few nearby things with compact facts, and only for things in the same enclosed place,
within about 4 m and in plain sight:

- switches and fire: `on`; doors, windows, curtains and drawers: `open` (and `locked` for lockable doors);
- a radio that is on: its `station`; an open drawer or locker: what it `holds` (names only; nothing while shut);
- a planter: `dry` only when dry, and its growth `stage`; a kettle: its phase (cold, heating, boiling, hot);
  a mug: how much `tea` is left, `empty` once drunk, `clean` once washed;
- a neon sign's words, attributed to whoever wrote them and marked untrusted;
- who is holding hands, who is offering a hand-over, and who is holding what.

Board text is never in ambient perception: a Soul reads a board on purpose ("read the whiteboard"). Knocks are heard
by the Souls the door shuts in, on the other side.

**Distant things cost nothing.** Every entry's native test measures the `here` frame with the thing absent, with 100 of
them far away, and nearby. Far-away things add 0 bytes and no offers, and no per-tick work, so a world full of lamps,
taps and mugs never distracts a Soul who is not using them. The `doHere` offer list in a frame stays inside its byte
budget: in a crowded spot it lists fewer offers rather than growing.

## Limits and known follow-ups

Fixes found in review and deferred to after the repository migration:

- **Ankles on every humanoid.** Many bodies show a gap between trousers and shoes. The fix belongs in the body, outfit
  or shoe meshes for every humanoid (the parked mixed-outfit seams work is likely the same family).
- **Garden revival.** Watered plants jump to full size at once but sag gradually; revival should be as gradual as drying.
  Watering and drying should become opt-in per planter or world, so a world without a watering routine does not wilt.
- **Noughts and crosses facing.** After a turn a player turns their back to the board; both should keep facing the board
  or each other between turns.
- **Rock-paper-scissors hand path.** Readying the hand can pass through the body; it needs a path clear of the torso.
- **Holding hands.** The clasp curls the fingers back and the right hand reads as a left (thumb on the wrong side).
- **Piano hands.** The pianist's hands sit below the keys; they should rest on and strike the keys at keyboard height
  (also for the piano duet).
- **Social facing in general.** Groups and conversations should face each other, and a Soul using an object should face
  it; today Souls often keep the heading they arrived with.

Other known limits:

- The idle look-around gesture moves a hand quickly on its own (about 0.17 m per 50 ms).
- Picking up something at the back of a counter bends the body deeply.
- At a hand-over the model's record of who holds the item lags the engine by a few samples.
- The `here` frame lists at most two things of a kind (three seats); more appear only as a count under `more`.
- Some new defs are over the library's geometry budgets: triangles for the fountain, jukebox, curtained window, drum kit,
  drawer chests, watering can, mic stand, kettle, mug and bell pull, and draw calls for the newest door and locker
  revisions. They need lighter meshes, or recorded budget holds with reasons, before release.
- Portable lights were rebuilt as carry-and-set-down (entry 29); the earlier version is retired. Mixed-outfit seams
  (entry 11) remain parked.

## Tests

Each family has a deterministic native test that runs a real server and engine in-process, with no ports and no models:

```sh
node --test --test-concurrency=1 tools/soul-actions/<name>.test.mjs
```

Set `SOUL_ACTIONS_OUT=<dir>` to keep each test's `summary.json` with its `here` byte counts. The tests live in
`tools/soul-actions/`; the viewer's motion units are under `apps/web/test/`, `apps/web/src/*.test.ts`,
`mars/viewer/engine/test/` and `mars/viewer/app/engine-view/`.

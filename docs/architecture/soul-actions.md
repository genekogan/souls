# Soul Actions: what Souls do by hand

Souls now use the things in a world with their own hands. Ask in plain words and the Soul walks over, reaches, and the
thing changes at the moment the hand touches it: a lamp lights, a door swings, water runs, the kettle clicks on. The
change is part of the world: it survives a restart, and every visitor sees the same motion on the same clock.

This page covers Soul Actions entries 1–44 and the everyday-life families that follow them (openings: a tent flap and a field gate; public writing: a guestbook). Each entry was accepted with a deterministic native test (including the
context-size checks below), regression runs, and an uncut real-client recording driven by plain words.

## How it works

- **Opt-in things.** Hand contact belongs to library defs tagged for it (`hand-operated`, `hand-writable`, `hand-rung`,
  `upright-carry`, containers with an `inside`, the tea defs, and so on). Older revisions of a def keep their old,
  hand-free behaviour, so existing worlds do not change until a god places the new revision.
- **Storage with and without a door ([#435](https://github.com/soulsimulation/souls/issues/435)).** A container with an
  `inside` (entry 42) is open only while its door or drawer is, if its def declares an `open` state. One that declares
  none has no door: `core-swap-shelf@1` is always open, so what is on it is seen nearby and taken without an open step,
  and the viewer draws it as an ordinary thing. A container whose def declares a `leftBy` state field records who left
  each thing in it (item id = Soul id, set when the thing comes to rest from a Soul's hand, pruned to what is still
  inside). Nearby perception and the take offer name the leaver; god-placed things have none.
- **Litter and bins ([#1088](https://github.com/soulsimulation/souls/issues/1088), W065).** `core-bin@2` and `core-wheelie-bin@2`
  are the street bins, open at the top, on the same container faculty with data only: three places down inside at the
  level of the rubbish already in them, reached over the rim. `core-wrapper@1` is a small thing to pick up. "put the
  wrapper in the bin", "throw it away", "throw away the wrapper", "bin it" and "throw it in the bin" put a held thing in
  the nearest bin with room; a full bin named by its id is refused `container.full`, and a book is too big for one.
- **Lost-and-found ([#435](https://github.com/soulsimulation/souls/issues/435)).** A container whose def declares
  `components.container.claim: "owner"` gives a thing that has an owner of its own (the layers `owner` on the thing, a
  Soul or a group) back only to that owner or a member of that group. Anyone else, the finder included, is offered the
  take as blocked `item.not-yours`, with a reason that names the owner, and every other action on it (a wash at the tap)
  is refused the same way. Things nobody owns are anyone's to take, and anyone may hand a thing in; a thing the god owns
  stays until the god moves it. An owner ref by name (`soul:Ana`) follows whoever has that name, so a god that sets owners
  for a lost-and-found should prefer Soul ids. `core-lost-and-found@1` is the swap shelf's form with this claim; its `leftBy` record
  reads as who found each thing, and nearby Souls are told "bowl (Ana's, found by Ben)" ("yours, …" to the owner).
- **Hiding places ([#435](https://github.com/soulsimulation/souls/issues/435)).** A doorless container whose def declares
  `components.container.hidden: true` keeps what is in it out of everyone's sight, the hider's included: it has no `holds`
  fact, no offers of its own, no name nearby and no walk target, and the viewer does not draw it. The only way to it is a
  search: `search:<id>` is offered within 8 m and reads the same whether or not anything is there. The hand reaches in and
  takes what it finds, or comes away with nothing, and the receipt's outcome says which. Searching with full hands is
  refused `carry.hands-full`. `core-hollow-stump@1` is reached down over its rim, `core-wall-niche@1` in at its front; no
  code names either. A clue for a hunt is an ordinary pinned note. A Soul trying to hide a thing in an occupied place is
  refused `container.full`, which tells her something is there, as her hand would. A thing a Soul may not take (private,
  for sale) is as if it were not there. The search's course is decided when it starts, so a thing hidden while the seeker
  walks over is missed by that search. This hides things from Souls' perception, not from the data: the snapshot the
  viewer draws from carries where a thing is, as it does for a shut drawer.
- **A pantry holds real things ([#435](https://github.com/soulsimulation/souls/issues/435)).** `core-pantry@1` is the same doorless
  storage with data only: four places, each for one small thing, so the stock is what you can see and count. Drawing from it
  is by hand, through the entry that already handles the thing. Words go ahead rather than refuse: "make a cup of tea" or "pour
  the tea" with a fresh mug kept in an open pantry takes it out and stands it on a free place on the kettle's counter first, and
  "eat the apple" takes the apple from wherever it is, then eats it. `core-apple@1` and `core-bun@1` are tagged `edible`,
  with `left` and `bites` in their state, and are eaten from the hand on entry 44's cup motion; `left` falls at each bite's own
  moment and what is left stays in the hand. A bare "eat it" or "have a bite" means the food in the hand. Another thing already in her
  hand is set down on the nearest free table place (or at her feet) first, and a kept mug comes out in her left hand when the
  kettle is in her right. A mug that is not hers to take (private, for sale, or claimed in a lost-and-found) is never fetched.
  Refused only when the act truly can't happen: `food.eaten` and `food.in-use` (in someone else's hand). The ledger's `food` and a kitchen's portions are separate systems and are untouched.
- **Loose materials (PC03, [#682](https://github.com/soulsimulation/souls/issues/682)).** `core-rack-beam@2`, `core-rack-upright@1`
  and `core-plywood-sheet@1` carry the native engine material's handling as data (`components.carryable.handling`: the
  crew range, the grips for each crew size, the pose and the hand height). Such a material is offered `carry:<id>` with
  a place (`to`), never a one-hand `pick-up`. The native `carry` moves it on level-zero ground, and the viewer follows
  it as a recorded transport. A load that needs more people than one is offered unavailable, with
  `carry.crew-too-small` naming the crew, and acting it is refused before any motion. Shared carries come with
  [shared execution](../design/shared-execution.md). `core-rack-beam@1` keeps its one-hand item path.
- **A table and larger crews (PC11, [#690](https://github.com/soulsimulation/souls/issues/690)).** `core-work-table@1` is a
  table-shaped load: 75 kg, a 2.44 × 0.91 m top, 0.76 m tall. Its handling is crew [3, 4] (three by mass at 30 kg
  each), with grips for three and four at its legs, and it is carried level on its legs. Nothing in the shared code
  names a def, load or Soul: a crew of three or four goes through the same invitation, op and receipts as two.
  - **Checked on define.** A def's handling must fit together, or `define` refuses it with a named code:
    - `handling.crew`: an inverted crew range;
    - `handling.grips`: a crew size in range without a grip layout, or a layout of the wrong count or outside the range
      (stricter than the native carry, which ignores a layout outside the range);
    - `handling.mass`: a mass the largest crew cannot lift at 30 kg each;
    - `handling.reach`: a grip outside the load's own box (`packages/world-compiler/src/handling.ts`).
  - **Set down along its axis.** A shared carry lays the load down along its own axis, either way round, whichever is
    nearer the way it travels, so the crew never turns it while setting it down.
  - **Known limit ([#1031](https://github.com/soulsimulation/souls/issues/1031)).** The native planner may lift facing
    either way along the load. When it lifts facing the other way, the load turns half a turn in the crew's hands
    during the lift, because the native lift interpolates its yaw. This happens for any load.
- **Joined into an assembly (PC12, [#691](https://github.com/soulsimulation/souls/issues/691)).** `core-rack-upright@2` and
  `core-rack-beam@3` are the same loose upright and beam, plus typed structural connectors. The world's god joins them
  into a bay with `connect` (see [god mode](godmode.md#joints)).
  - **One graph.** The entity world holds each joint as two halves (`joins`), one on each part. With
    `SIM_SHARED_CARRY=1` the engine mirrors it for parts adapted as items (anything `carryable`, so both rack parts)
    as its own `connections`: a joined part is `installed`, and a beam is supported (`connected`) by the uprights its
    ends join. A joined part that isn't carryable (a god's fixed rail) reaches the engine as a fixture on the ground,
    with no connections. With the flag off, `world-edit/1` is exactly as before PC12: no `roll`, `connections`,
    `connected` support or asset `sockets`. The native rack rules (`construction/rules.ts`, `campus/assembly.ts`) read
    `beam-seat` sockets only on catalog `rack-upright` defs and campus frames, never on these adapted items. An upright stood on end (`r = [yaw, 0, π/2]`) reaches the engine with that roll, so its box stands. Its
    connectors are the adapted asset's sockets. The beams stay at the world root, because their support is their
    joints, not a parent. The client draws each part once, from the entity world.
  - **Not carried while joined.** `carry:<id>`, and `pick-up:<id>` of a small part, of a joined part is offered unavailable, `carry.joined`, naming what it
    is joined to and at which connectors, and acting it is refused before any motion. The engine refuses it on its
    own too when it mirrors the joints (`carry.item-unavailable`: an installed part is not a load lying on the ground). The entity world's refusal holds with the flag off. A free beam of the same
    revision is carried as before.
  - **Restart.** Nothing new is snapshotted: the joints ride the entity rows and the logged `world-edit` events, so a
    clean or crash restart brings back the same graph in both.
  - **Souls and beams (PC14).** Souls seat beams between raised, held uprights (below). The native rack stability rule
    (`construction/rules.ts`) is read for these parts from their connectors, by `packages/engine-mars/src/beam-connect.ts`:
    the engine treats them as items, and a god's joins still depend only on a part's own bearing connectors.
- **Raising and holding (PC13, [#692](https://github.com/soulsimulation/souls/issues/692); off unless `SIM_SHARED_CARRY=1`).**
  A loose upright lying free is also offered `raise-with:<id>`, which takes `with`. It goes through the same invitation,
  revision, acceptance and receipts as `carry-with` below, with no destination.
  - **Commit.** One programme, `mars:raise_hold_v1` (`packages/engine-mars/src/raise-hold.ts`): the crew walks to its
    stations, takes hold, walks it up about its base edge and holds it. It ends in the pose a joined upright has
    (`r = [yaw, 0, ±π/2]`, PC12). The geometry and choreography are the native raise's (`construction/raise.ts`); the base
    is the end nearer the host, or the other if only that one has room.
  - **Held.** Holding isn't an end: the receipts stay `started`, with `shared.holding`, `shared.holding: true` and a
    `shared.holding` stream event once. A member's body act is `shared.busy`; speech and looking work.
  - **Stop.** `stop-carry:<op>` from any member, or a member going away. Before the grip they let go. After it they lower it
    along the same arc, to its exact starting pose. If something or someone is in the way (`raise.cancel-unsafe`) they
    keep holding, the receipts name it, and it retries with no timeout.
  - **Refused before anyone is asked:** `raise.arc-blocked`, `raise.station-blocked`, `raise.station-unreachable`,
    `raise.not-lying`, `raise.joined`, `raise.crew-too-small`, `raise.crew-too-large`.
  - **Invariant.** `looseFramesHeld` (a part it turned is held by its crew, hands on it) is checked at every tick end.
  - **Joined (PC14).** Once a beam joins a raised frame, a stop never lowers it. The crew lets go only once the frame
    stands on its own (below). `stop-carry` keeps its name.
- **Seating beams (PC14, [#693](https://github.com/soulsimulation/souls/issues/693); off unless `SIM_SHARED_CARRY=1`).** A loose
  beam lying under a bay between two standing, supported uprights is offered `connect-beam-with:<id>`. It takes `column`
  (`l` or `r`, each upright's own side), `height` (a seat height in metres) and `with` (one other Soul).
  - **Which seats.** Only the seat pairs both uprights have free are offered. Each pair is level, a beam's span apart,
    square to both frames, on the faces toward each other, and within standing reach (`beamBays`). Supported means held
    by its raise crew, or standing in a frame that stands on its own.
  - **Session.** It goes through the same invitation, revision, acceptance and receipts as `carry-with`, with exactly two
    members.
  - **Commit.** One programme, `mars:connect_beam_v1`. It brings the native `connect_beam`'s checks, choreography and lift
    (`construction/beam.ts`) to PC12's connectors (`beam-seat`, `beam-end`). The two walk to the beam's ends, grip it, lift
    it along its swept path, and its ends join both seats as reciprocal engine connections.
    - Both ends are checked again at the lift.
    - The write-back then puts the joints into the entity world, with the uprights' standing poses, in one edit
      (`connect` ops after `move`s).
    - The receipts end `completed` with `shared.seated`.
  - **Stop.** Before the lift they let go where it lies. During the lift they lower it back along its path to exactly where
    it lay; a beam is never left half seated.
  - **Release.** A stop on a raise whose upright beams join lets go only if its frame stands on its own, by the native
    Mars v1 rule:
    - at least two standing uprights;
    - each upright has beams on both columns at N or more heights, with N = 2 for a 12 ft frame;
    - another upright still held by its own crew is carried by them and not counted.

    Until then the native cancel refuses `support.release-premature`. The crew keeps holding, the receipts name the
    missing beams, and the stop is asked again each tick, so they let go as soon as the frame stands. The released upright
    stays standing and installed, held up by its beams (support `connected`, as the native `release_support`). A god's
    joined upright stands on the ground by the god's say (PC12) and is not judged by this rule.
  - **Refused before anyone is asked:** `beam.misaligned`, `beam.seat-taken`, `beam.not-staged`, `beam.upright-unsupported`,
    `reach.too-high`, `lift.path-blocked`, `beam.station-unreachable`, `beam.crew`. A Soul holding an upright has no hand
    free (`carry.hands-full`).
  - **Invariant.** `framesStand` is checked at every tick end. An installed beam has both ends joined in standing uprights,
    and a joined upright nobody holds is in a frame that stands on its own.
  - **Rules version.** The flag adds `+shared-raise/1+shared-beam/1` (and `+shared-deck/1` and `+shared-stairs/1`, below), so a journal that
    names these verbs is never replayed without them.
  - **Not yet.** Where the uprights stand comes from where they were laid; Souls can't move a raised frame into line.
    No disconnecting.
- **Joists and a deck (PC15, [#694](https://github.com/soulsimulation/souls/issues/694); off unless `SIM_SHARED_CARRY=1`).**
  Three appended revisions carry it: `core-rack-beam@4` (`@3` plus `joist-seat` connectors on a step ledge along both
  faces every 24 in), `core-deck-joist@1` (a loose 2x4 on edge: a bearing `joist-end` under each end, a `sheet-seat` on
  top) and `core-plywood-sheet@2` (`@1` plus five bearing `sheet-bearing` connectors every 24 in and a walkable top).
  - **Offers.** A loose joist lying by a bay whose two beams (one per column, the same height, seated in supported frames)
    have a free `joist-seat` pair is offered `install-joist-with:<id>`, with `at` (metres along the bay from its middle,
    snapped to the nearest free pair within 10 cm; the free positions are listed) and `with`. A loose sheet lying beside a
    bay whose five installed joists are 24 in apart and free on top is offered `lay-sheet-with:<id>`, with `with`. Crew
    exactly two, through the same invitation, revision and receipts as `connect-beam-with`.
  - **Commit.** One programme each, `mars:install_joist_v1` and `mars:lay_sheet_v1`
    (`packages/engine-mars/src/deck-install.ts`). They bring the native `install_joist` and `install_plywood`
    (`construction/deck.ts`) to connectors matched by kind. A joist's crew stands at its ends; a sheet's holds the two
    corners of its long edge toward where it lies and lifts it over from the side. Every bearing connector joins its seat
    as reciprocal connections, checked again at the lift, and the write-back puts the bearing joints and the pose into the
    entity world in one edit. The receipts end `completed` with `shared.seated`.
  - **Walkable.** A laid sheet's top is a floor only while every bearing connector is joined to an installed joist that
    rests on two supported beams. On a rack's lowest beams its top is at 0.42 m: a floor of its own level, entered by a
    climb link (a step up of at most 0.5 m) at the middle of each long side. A loose or carried sheet has no floor, and a
    higher deck gets no step.
  - **Stop.** Before the lift they let go where it lies. During it they lower it back along its path to exactly where it
    lay; a part is never left half seated.
  - **Refused before anyone is asked:** `joist.no-beams`, `joist.beam-unsupported`, `joist.occupied`, `joist.not-staged`,
    `plywood.too-few-supports`, `plywood.span`, `plywood.overlap`, `plywood.support-unsupported`, `plywood.not-staged`,
    `reach.too-high`, `lift.path-blocked`, `joist.station-unreachable`, `plywood.station-unreachable`, `joist.crew`,
    `plywood.crew`. A god's edit that would move or remove a sheet someone stands on is refused `deck.occupied`; under a
    joist or sheet, PC12's `support.none` holds.
  - **Invariant.** `decksBear` is checked at every tick end: an installed joist or sheet has every bearing connector
    joined to an installed support (`deck.unsupported`).
  - **Rules version.** `+shared-deck/1`, after PC14's suffix.
- **Stairs up to a deck (PC16, [#695](https://github.com/soulsimulation/souls/issues/695); off unless `SIM_SHARED_CARRY=1`).**
  Three appended revisions carry it: `core-deck-stair@1` (a loose 5-tread flight, two 2x12 stringers and a header,
  1.03 m rise over 1.35 m, 0.91 m wide: a bearing `stair-hook` on its header and `tread-seat`s `tread-1` to `tread-5`
  from the bottom), `core-deck-stair-tread@1` (a loose 2x10 with one bearing `tread-bearing`) and `core-rack-beam@5` (`@4`
  whose ledge `joist-seat`s also take a `stair-hook`). The flight fits a deck on step beams at seat 4 (36 in), whose top
  at 1.03 m no step reaches.
  - **Offers.** A loose flight standing by a bay whose beam carries a deck (a joist on its other face), seated in
    supported frames, with a free ledge seat on its outer face at the height that puts the flight's foot on the ground, is
    offered `install-flight-with:<id>`, with `at` (metres along the beam from its middle, snapped within 10 cm; the free
    positions are listed) and `with`; crew exactly two, through the same invitation as `install-joist-with`. A loose tread
    lying within 3 m of an installed, supported flight with a tread missing is offered `install-tread:<id>` to one Soul: it
    goes into the flight's lowest missing tread.
  - **Commit.** `mars:install_flight_v1` and `mars:install_tread_v1` (`packages/engine-mars/src/stair-install.ts`) bring
    the native `install_stair_flight` and `install_tread` (`construction/stairs.ts`) to connectors matched by kind, through
    PC15's seat programme: walk to it, take hold, lift along the swept path, set it on its seat. The flight goes square to
    the beam, ascending toward it from the side of the seat's face; its crew stands either side of it. A tread's worker
    stands beside the flight. The receipts end `completed` (the flight's with `shared.seated`).
  - **Walkable only when finished.** A hanging flight is a `stairs` link (`<id>#stairs`) from the ground at its foot to
    the floor level at its top. It is usable only when every tread is in and a laid floor lies at its top. Otherwise it is
    there and unusable with its reason (`treads 3–5 missing`, `no landing at top`), so a walk that needs it is refused
    `route.link-unusable` and the refusal says why ("The way there needs stairs that are not finished: …"). A loose or
    carried flight is no link.
  - **Stop.** As PC15: let go before the lift, lowered back along its path during it.
  - **Refused before anyone is asked:** `stair.beam-unsupported`, `stair.occupied`, `stair.no-seat`, `stair.rise`,
    `stair.site-blocked`, `stair.site-occupied`, `stair.not-staged`, `stair.crew`, `stair.station-unreachable`,
    `tread.no-stair`, `tread.index`, `tread.already-installed`, `tread.not-staged`, `tread.crew`, `reach.too-high`,
    `lift.path-blocked`. A god's edit that would move, remove or disconnect a flight, one of its treads, or what holds it
    up while someone is on it is refused `stair.occupied`; under a hanging flight, PC12's `support.none` holds.
  - **Invariant.** `stairsBear` is checked at every tick end: an installed flight's hook is joined to an installed beam
    and an installed tread to an installed flight, both ways (`stair.unsupported`).
  - **Rules version.** `+shared-stairs/1`, after PC15's suffix.
- **Shared proposals (PC04, [#683](https://github.com/soulsimulation/souls/issues/683); off unless `SIM_SHARED_CARRY=1`).**
  A `shared-carry` load is also offered `carry-with:<id>`, which takes `to` (a place) and `with` (who: names or ids,
  comma-separated or in words, "Bo and Cy" or "Bo, Cy and Dee"; a Soul whose whole name is the phrase, nearby, stays one
  Soul). A refused crew too small for the load's mass says
  the arithmetic.
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
  - **One of a larger crew out (PC11).** When a guest of a crew of three or four declines or leaves, and the rest still
    meet the minimum, that revision can never start, because a role is never filled without asking. Each member's
    waiting receipt is noted `shared.not-ready`, saying who declined or left. The host's note also gives the exact
    amend (`carry-with` with `invite` and the rest named), and a guest's says the host can ask again. The amend's new
    revision clears the note, and the rest accept it again.
  - **Expiry.** A proposal lapses after 120 s (`invite.expired`). A late answer is refused `invite.gone`.

  - **Distance.** Proposing or accepting from more than 10 m from the load is refused `shared.too-far` before any
    receipt, because walking closer would be another body act and would leave.
  - **Route preflight (PC06, [#685](https://github.com/soulsimulation/souls/issues/685)).** Before anyone is asked, the native
    carry planner alone plans the whole crew's carry of the load to the place's centre. It skips everyone's programme
    checks, so a guest busy walking does not hide the answer.
    - **Refused.** A proposal or amend is refused when the formation has no way there (`carry.no-route`, or
      `carry.clearance` when each person could walk there alone) or when the load cannot be laid down there
      (`carry.target-blocked`), or when the crew has no room to stand at the load's grips where it lies
      (`carry.pickup-blocked`, PC07). The refusal names the blocker, and no invitation or receipt is made.
    - **Bounded search (PC07, [#686](https://github.com/soulsimulation/souls/issues/686)).** The planner searches at most
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
  - **Readiness (PC05, [#684](https://github.com/soulsimulation/souls/issues/684)).** Once every role is accepted, the world
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
    applies. The refusal offers the safe stop, `stop-carry:<op>`, in `alternatives` (PC08).
  - **Release.** When the native programme ends, every member's receipt ends together, in one transaction:
    `completed` on arrival, `failed` otherwise. The next act is accepted. If a member's receipt ends another way (an
    engine-fault recovery, a god walkout), the operation ends for everyone with `shared.ended`, and the host's
    programme is stopped. A fade is not that: it is the member's stop (PC09, below). A restart is covered under "Restart" below.

  - **The journey (PC06).** On open level-0 ground, the native gather walks each member to their grip. The crew lifts
    the load and carries it as one formation, then lays it down at the place's centre. Every observer sees that one
    recorded trajectory, and the members walk on afterwards. A solo carry of a load that one person can take is unchanged.
  - **Held up on the way (PC07, [#686](https://github.com/soulsimulation/souls/issues/686)).** The native carry owns every
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
      the changed scene. A cut is searched once per scene change, not every tick (the shared carry's opt-in `holdCutV1`;
      every other carry is unchanged).
  - **Stopping (PC08, [#687](https://github.com/soulsimulation/souls/issues/687)).** Any member, host or guest, can act
    `stop-carry:<op>`; members of a running operation are offered it. The native carry's own cancel is the only cleanup.
    - **Acknowledged at once.** The stop's own receipt completes in that tick (`shared.stop-requested`). It never touches
      the member's shared receipt. The operation becomes `stopping`, and every member's started receipt
      (`shared.stopping`) says what the crew does now. Each stream gets `shared.stopping`.
    - **Logged by programme.** The stop is an `edge-stop` event carrying the op's `programId`. Its fold stops that
      programme with `untilSafe`, so the programme, and with it the crew's borrowed bodies, stays until the native
      cleanup has landed. Older `edge-stop` events without `programId` replay through the body's own programme, as before.
    - **Cleanup by phase.** During the gather or the grasp, the crew lets go where the load lies, and nothing was lifted.
      During the lift, the load is lowered back where it lay. During the move, it is set down where it is if that ground
      is clear. During the final lowering, that set-down finishes.
    - **Ground not clear.** When the native cancel refuses (`carry.cancel-unsafe`), the receipts say so once (the
      stream gets `shared.stopping` with `deferred`). The crew carries on along its validated route and sets the load
      down at the first clear spot, or at the destination.
    - **Held up while stopping.** That is `blocked`, as above, with the claims kept. The reason says a stop was asked,
      and moving again returns the operation to `stopping`, never `started`.
    - **Claims.** The claims stay until the load is set down. Until then, a member's body act is refused `shared.busy`,
      and the refusal still offers `stop-carry:<op>` (asking again changes nothing).
    - **Release.** Once the programme has ended and the load lies on the ground, held by nobody, every member's receipt
      ends together, `completed` with code `shared.stopped`, the same `op` and
      `stop`, and `shared.result` either `stopped` (set down short of the destination, or never lifted) or
      `stopped-at-destination`. It is never `arrived`. Each stream gets `shared.stopped`, and each Soul then acts on its
      own; nothing is resumed for them.
    - **Repeats.** The same member asking again gets the first stop's receipt. Another member's stop completes with
      `shared.stop-asked` and changes nothing. One stop event is logged.
    - **Words and verbs.** The offer reached through words or `{verb: 'stop-carry'}` is the same stop. So is a
      member's `stand:here` ("stand up / stop what I am doing"): it never releases the crew's programme as a stall (PC10).
    - **One transaction.** The stop's `edge-stop` and its journal (the op `stopping`, the stop's own receipt) are
      written together at the sequencer, or not at all. A second stop in the same drain logs nothing and is answered as
      already asked; a member's fade (below) is written the same way.
    - **Refusals.** A stop after the end is refused `shared.not-running`, one from a non-member `shared.not-member`,
      and an unknown op `shared.unknown-op`.
  - **A member's mind goes away (PC09, [#688](https://github.com/soulsimulation/souls/issues/688)).** A disconnected mind's
    body keeps its accepted carry to its end and joins nothing new.
    - **Not listening.** When an agent stops listening, the body rule makes its body `zombie` and later `asleep`. A
      member's open shared receipt makes the agent busy, so the rule never moves or stops a member's body while the
      operation runs; the carry ends as accepted.
    - **Held.** A started shared receipt holds the fading clock for every member, the borrowed guest as well as the host
      (`postureHold`), so an accepted carry is not abandonment.
    - **Fade.** If a member fades anyway (`SIM_BEAM`, past the 12 h hold), the fade is that member's stop. It is the same
      `edge-stop` naming the op's programme, and the same `stopping` journal with `stop.away`, but no stop receipt is
      made in their name. Their shared receipt stays open and ends with everyone else's, as `stopped` or
      `stopped-at-destination`; it is never `soul.faded`. The words say who went away, and the streams'
      `shared.stopping` carries `away`. The fade line on the member's stream says the body stays in the carry, not
      that it reclines.
    - **Back while it runs.** A faded member who acts again while their operation still runs or stops is not relocated
      to a starting place, since the crew still moves their body. A body act gets the ordinary `shared.busy` answer,
      and the stream's return line says they are back where their body is.
    - **Reconnect.** The same receipt id answers with the operation's current phase or its final result, and the
      stream keeps what was delivered meanwhile. A replayed `clientRef` returns the original receipt. A stale
      `accept:<invite>` from a member while the operation runs gets its `shared.busy` refusal. After the end it is
      refused `invite.gone` with how the operation ended, and `stop-carry:<op>` is refused `shared.not-running`;
      neither moves anybody or makes a receipt.
    - **Not enlisted.** A faded Soul cannot be asked to carry: it is not perceived, so it is not near. A disconnected
      Soul can be asked, but it is never committed without its own `accept` of that revision: the proposal waits,
      names who has not answered, and lapses.
  - **Restart (PC10, [#689](https://github.com/soulsimulation/souls/issues/689)).** Nothing new is serialized: the native
    carry rides the engine's history and the operation rides its invitation row.
    - **Exact resume.** A running carry has no exact engine snapshot, so a clean shutdown logs its checkpoint
      (`unsnappable-head`) and the boot replays to it; a durable-clock world also replays a crash to its last persisted
      tick. In every phase (gather, lift, move, set-down, a stop's cleanup) the op, its revision, claims and load, both
      receipts and the engine state are what they were, and the carry ends as it would have. There is one carry
      decision and at most one stop event; a stop is never asked again after a boot.
    - **Retries.** The same receipt ids read the same state; a `clientRef` replay returns the original receipt; a stale
      `accept` is `shared.busy` while it runs. A member's started receipt is left to the shared sweep at boot, never
      lost alone.
    - **Restored to an earlier moment.** An op whose programme the restored world no longer runs ends `shared.ended`
      for every member, saying so when the world is from before it started. If a world without the durable clock is
      restored to before an op ended, the engine would replay its programme: that programme is stopped safely with a
      logged `edge-stop` (`shared.restored`) at the first tick after the boot, the members' streams get
      `shared.restored`, and an operator line is logged. The ended receipts keep how it ended. A world restored to
      before a stop the journal already has (an older backup) is asked to stop again. A programme is taken for the
      op's only when it has the op's id, is a native carry, and the world is not older than the commit.
    - **LINK migration.** A Soul the old beam took that is still in a running carry's crew stays where the crew has its
      body; it is never relocated to a starting place.
- **Plain words.** Everyday phrases resolve to the offers a Soul has where it stands. "turn on", "switch on" and
  "light" all mean switching on; "shut" means close; "wipe" or "clean" mean erase; "put up" means pin; "tune" or "change
  the station" mean the radio's station; "put on a record" or "play a record" mean the record player, with the
  sleeve the Soul picks as the `record` param. A word only applies when that action is on offer.
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
| Doors and openings | Open and close doors, gates (a picket gate and a five-bar field gate), windows, cupboard and locker doors, fridge doors, curtains, blinds, drawers and a tent flap; doors and gates open on the way while walking somewhere; knock; the owner locks and unlocks; anyone inside can always walk out | "open the garden door", "close the window", "close the curtains", "open the blind", "open the drawer", "open the tent flap", "close the field gate", "knock on the door", "lock the door" |
| Water and garden | Turn taps, an outdoor shower, a sprinkler and a fountain on and off; fill a watering can at the tap and water a bed; planters dry out over the days and grow in stages | "turn on the garden tap", "turn off the outdoor shower", "turn on the fountain", "water the rose bed" |
| Carrying and things | Carry an upright load or a chair with both hands and set it down somewhere; carry a loose rack beam or plywood sheet with both hands and lay it down (a 12 ft frame is refused: it needs two carriers); pick up a lantern or a bowl and set it on a table; hand a carried thing to another Soul, who accepts or declines; put small things into a drawer or locker and take them out; leave a small thing on a swap shelf and take what someone else left; hand a found thing in at a lost-and-found, where only its owner can claim it; hide a small thing in a hollow stump or a wall niche, and search one to find what is there; stock a pantry and take things out of it; eat an apple or a bun from the hand, bite by bite | "carry the bench to the courtyard" (any place name), "carry the beam" with `{"to": "yard"}`, "pick up the lantern", "put the bowl on the table", "give the lantern to Ben" then "accept", "put the bowl in the chest", "take the bowl out of the chest", "leave the book on the swap shelf", "take the book from the swap shelf", "put the bowl in the lost and found", "take my bowl from the lost and found", "hide the book in the stump", "search the stump", "look in the niche", "search around here" |
| Writing and boards | Write on and wipe whiteboards and chalkboards; pin and take down notes; sign a sign-up sheet; sign a guestbook with a few words; vote in a poll; put up and take down posters; post wanted and offered notes, reply to them and take one on | "write on the whiteboard: Choir practice Thursday at six", "wipe the chalkboard", "sign the sign-up sheet", "sign the guestbook" with `{"text": "Lovely garden"}`, "vote on the poll", "take down my note from the pinboard", "reply to Ben's note" |
| Music | Ring a bell pull; play the piano and the drums, alone or as a duet on one shared clock; sing at a microphone with an accompanist; turn on a jukebox or a radio and change its station; put on the record you pick at a record player (an unknown sleeve is refused with the list of sleeves). Visitors hear all of these. | "ring the bell", "play the piano", "play the nearest drums", "sing at the microphone", "stop singing", "turn on the jukebox", "change the station", "put on a record" with `{"record": "Low Tide"}` |
| Play and social | Frisbee with clear lanes and three-person triangles; noughts and crosses and checkers with honest turns; rock-paper-scissors and holding hands, both by consent | "mark the centre", "wipe the game board for a new game", "move c3 to d4", "jump d4 to f6", "play rock-paper-scissors with Bea" then "accept" |
| Food | Make tea: fill the kettle at the sink, switch it on, wait for the boil and pour; carry a mug, offer it to someone, drink it in sips, and rinse the mug | "fill the kettle", "put the kettle on", "pour the tea", "make a cup of tea", "offer Ben the tea", "drink the tea", "rinse the mug", "wash up" |
| Media | Switch a screen on and off by its physical control; the image or video it shows stays the same | "turn on the screen", "switch off the screen" |
| Making | Paint a picture at an easel and leave it there with a title and credit; draw a picture in chalk on a chalk square, which fades over four world days and washes away | "paint at the easel", "draw in chalk" |

## Making: paintings and chalk

- **Painting at an easel.** `core-easel@2` is a painting workstation. The `paint:` offer at its spot takes an optional
  drawing (`painting`: a title, a background and at most 64 rectangles, ellipses and lines in 0..1 coordinates). When
  the activity completes, the server draws it to a 512×512 PNG, hangs it on the easel with the Soul's credit, and keeps
  the previous picture in the edit's note. Nothing changes before completion.
- **Chalk on the ground ([#430](https://github.com/soulsimulation/souls/issues/430)).** The painting faculty reads two pieces
  of def data. A painting workstation whose canvas face lies flat (pitch -90°) is drawn in chalk: its offer is "Draw in
  chalk", the body stoops over it (the `chalk` pose), and the reach rule is the ground the Soul stands on. A canvas face
  with `fadeDays` fades: completion records the world `day` it was drawn on, and the viewer and perception read its age
  from the world day. The drawing is fainter each day and reads as washed away (a blank square, no perception line)
  from `fadeDays` on. Nothing ticks and nothing is written while it fades: on a world-day change (a jump forward or the
  clock set back included) the bridge re-derives only the perceived lines of drawings still fading, and the viewer
  redraws things tagged `fades` (a fading def carries that tag). `core-chalk-square@1` is the first such def: a 1 m
  paving square that fades over 4 world days.
- **Only drawn by hand.** The public hang route refuses an image on a fading canvas (`art.drawn-only`); the world's
  creator may still clear one. A washed-away drawing stays in the square's state until it is drawn over, so the art
  listing (`GET /v1/art`) still names it.

### Checkers (#439)

A checkers board (`core-checkers-board@1`) is a standing chalk board on noughts and crosses' faculty: the hand works the
move on the face in one level chalk stroke between the two squares (across their files, at the height midway between
them; for a jump, across the jumped piece), and the piece moves only when the stroke ends. The world keeps
turns: the first Soul to move plays X, from the bottom, and the second plays O; a third Soul waits for the next game.
The player steps back afterwards, a reader reads it, and a wipe sets the board up again. The rules are English draughts
(`packages/world-compiler/src/core-kit/checkers.ts`):

- a man moves one square diagonally forward, and a jump over an opponent's piece captures it;
- a jump that is open must be taken, and a piece that can jump again keeps the turn until it cannot;
- a man that reaches the far row is crowned, which ends the turn, and a king moves both ways;
- a side with no pieces or no legal move loses; there is no draw rule, so two players end a drawn game by wiping the board.

Squares are named a1–h8, with a1 at the bottom left seen from the front. "move c3 to d4", "c3 to d4", "jump d4 to f6"
or "c3-d4" is the move with those squares on the board where it can be played. A Soul with a game in progress plays that game:
her own board's move reads "…, in your game", her words go to it (to the game where it is her turn, if she has two), and out
of turn they are refused with whose turn it is, never a new game on another board. With no game of hers, the nearest open
board takes the move. A second game is hers to start, by acting on that board's own move. The read offer names only the state ("a game of checkers, X
to play"). Reading gives the players, whose move it is or who won, the pieces left and the board as eight rows.
"jump c3 to e5, then e5 to g7" makes the first jump now and says to act again for the rest. "read the checkers board"
is still a walk to it, as with the other boards; `read:<board>` (or its offered read) reads it.

### Openings: a tent flap and a field gate (#427)

Both are data on contacts that already exist; neither has code of its own.

- `core-tent@2` is `core-tent@1` with a doorway pole on the flap's free side and a toggle on it, tinted `valve`. It uses
  the drawn covering's contact (the curtains' pull cord): the Soul stands in front of the tent, reaches the toggle, and the
  flap swings open or shut at the contact. It has no hinge component, so the tent adds no door solid to the walk graph.
  A tent is a place in `here` (an exit), not an object row, so its flap is perceived through its offers: open while
  shut, close while open. A stretched tent (`sx`, `sz`) is worked at its stretched toggle, and the Soul stands clear of
  the flap's sweep (a step further out when she must). Standing at the flap she is within the tent's own place, as anyone
  near a thing-place is, so while she works it her nearby perception is the tent's.
- `core-field-gate@1` is a five-bar wooden gate (a 1.3 m leaf) on `core-gate@2`'s hinge contact: the `opening`
  component, the leaf's pivot and a latch tinted `chrome` where the hand goes. Shut, it closes its gap; a walk it walls
  off opens it by hand on the way and shuts it behind (entry 31). Nearby it says `open`. It is a local fixture, never a
  far landmark.

### Public writing: a guestbook (#429)

`core-guestbook@1` is a visitors' book propped open on a tall book stand. It is the sign-up sheet's faculty with data
only; nothing in the code names it:

- Its capacity is its `text` field's declared `lines` (16). A sign-up def that declares none keeps 8, so
  `core-signup-sheet@1` keeps its capacity and behaviour. Its read changes as described below, as every sign-up
  list's does.
- Its first synonym ("guestbook") names it in refusals ("You have already signed the guestbook.") and in the read offer
  ("a guestbook, 3 names"). A def with none keeps the sheet's words.
- Its `sign` action declares an optional `text` param: a few words (up to 40 characters, one line) written after the
  name, "Ben — Lovely garden".
- It is tagged `keeps-newest`: when the book is full, the next visitor signs on a fresh page and the oldest page (8
  entries) gives way, instead of the sheet's refusal. The face shows the current page, on the sheet's line geometry, and
  the hand writes on that page's next line.
- It declares no `unsign`: an entry stays. Each Soul signs once while her entry is kept.

The read of any sign-up list (a sheet or a guestbook) returns the title and the kept entries, numbered. The entries are
Souls' own words: each is attributed to its signer by Soul id, the read is marked untrusted (`soul-text`), the summary
ends "(their words, not world facts)", and the Soul learns one fact per signer, as for a pinboard's notes. Plain words
name it by its entity name ("sign the guestbook"); the def's other synonyms ("visitors' book") help catalogue search but
not plain words at a thing.

## What other Souls perceive

A Soul's `here` frame lists a few nearby things with compact facts, and only for things in the same enclosed place,
within about 4 m and in plain sight:

- switches and fire: `on`; doors, windows, curtains and drawers: `open` (and `locked` for lockable doors);
- a radio that is on: its `station`; a record player that is on: its `record`; an open drawer or locker: what it `holds` (names only; nothing while shut); a
  swap shelf (no door, so always open): what it `holds` and who left each thing ("book (left by Ana)"); a
  lost-and-found: whose each thing is and who found it ("bowl (Ana's, found by Ben)");
- a pantry: what it `holds` (names only); a food in the hand or bitten: its `bites` left, then `eaten`;
- a planter: `dry` only when dry, and its growth `stage`; a kettle: its phase (cold, heating, boiling, hot);
  a mug: how much `tea` is left, `empty` once drunk, `clean` once washed;
- a neon sign's words, attributed to whoever wrote them and marked untrusted;
- a finished painting or chalk drawing: its maker and title ("an easel with Ana’s painting “Quiet sky”", "Ana’s chalk drawing “Sun” on the pavement, fading"), never the drawing itself;
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
  The #417 candidate assembles cached bind-space calf skin for detected mixed-part holes, preserving source part
  buffers and the original shoes. Catalogue bind sections pass for 882 pairs at ten sampled heights; a 24-look
  skinned diagnostic and actual-client verification are recorded separately. This remains incomplete: up to 224
  vertices / 384 triangles add GPU skin/shadow work, so original A5 is not satisfied. Cold donor download is at
  most 53,208 bytes per frame (106,416 both); catalogue files are unchanged. Entry 11 stays open pending the wider
  seam review.
- **Garden revival.** Watered plants jump to full size at once but sag gradually; revival should be as gradual as drying.
  Watering and drying should become opt-in per planter or world, so a world without a watering routine does not wilt.
- **Noughts and crosses facing.** After a turn a player turns their back to the board; both should keep facing the board
  or each other between turns.
- **Rock-paper-scissors hand path.** Readying the hand can pass through the body; it needs a path clear of the torso.
- **Holding hands.** The clasp curls the fingers back and the right hand reads as a left (thumb on the wrong side).
- **Piano hands (#422).** The seated piano overlay fits the actual hand skin to the immutable `core/piano@1` white
  and black key surfaces after a 0.8 s entry blend, with each hand lifting on the shared audible score. Key changes
  ease toward the next pitch before its onset; entry, interruption and return use recorded activity history. The existing arm IK owns reach; roots,
  seats, native actions and score timing stay unchanged. Active rendering adds one bounded hand-skin pass per hand
  with one reusable projection scratch vector. Existing instrument history is indexed only for piano-relevant transitions;
  unrelated actors have no new instrument arrays or reverse scan. Server work and perception are unchanged; overall
  client cost equivalence is unverified.
  The sound follows the hands: a note sounds only from the moment the entry blend has put the hands on the keys
  (depicted activity start + 0.8 s, from the same recorded activity age the pose uses; an unknown age counts as
  settled for both). No note after the run's recorded end sounds (the release pose freezes the score there, holding a note struck at that
  instant, which sounds),
  and a note silenced once is never revived. A singer accompanying the piano follows the same window. The absolute
  score clock is not shifted. When a pianist stops before the end is known, notes scheduled ahead that have not begun
  are cancelled, and notes already ringing decay naturally.
- **Social facing in general.** Groups and conversations should face each other, and a Soul using an object should face
  it; today Souls often keep the heading they arrived with.

Other known limits:

- The idle look-around gesture moves a hand quickly on its own (about 0.17 m per 50 ms).
- Picking up something at the back of a counter bends the body deeply.
- At a hand-over the model's record of who holds the item lags the engine by a few samples.
- The `here` frame lists at most two things of a kind (three seats); more appear only as a count under `more`.
- Some defs are over the library's geometry budgets: triangles for the fountain, curtained window, drawer chests,
  watering can, kettle, mug and bell pull, and draw calls for the newest door and locker revisions. They are getting
  lighter revisions family by family (#494). The drum kit, mic stand and jukebox already have one (`@2`, in budget);
  their `@1` keeps its bytes and its recorded hold, because published revisions are immutable.
- Portable lights were rebuilt as carry-and-set-down (entry 29); the earlier version is retired. Mixed-outfit seams
  (entry 11) remain parked.

## Tests

Each family has a deterministic native test that runs a real server and engine in-process, with no ports and no models:

```sh
node --test --test-concurrency=1 tools/soul-actions/<name>.test.mjs
```

Set `SOUL_ACTIONS_OUT=<dir>` to keep each test's `summary.json` with its `here` byte counts. An entry that adds or
revises a library def also runs the library budget tests, so a def over its triangle or draw budget is caught by its
own entry: `node --test packages/world-compiler/src/core-kit/library.test.ts packages/conformance/src/catalogue-checks.test.ts`
and `pnpm --filter @souls/conformance test`. A new revision carries no budget hold; fix the mesh instead. The tests live in
`tools/soul-actions/`; the viewer's motion units are under `apps/web/test/`, `apps/web/src/*.test.ts`,
`mars/viewer/engine/test/` and `mars/viewer/app/engine-view/`.

### M05 wave transition (#635)

The existing shared Wave clip uses its authored raised-hand band (normalized phase .36–.72), traversed smoothly on
recorded world time. The full authored cycle lowered the palm by about .337 m in 50 ms before its loop endpoint;
merely easing its weight did not fix that internal motion. A two-second entry and attained-weight release retain the
native wave target and action duration. Release freezes the authored pose at the native stop. The procedural fallback
receives the same envelope. No source animation, movement path or native authority changes.

Recorded wave tails overlap when another wave begins during the return: the strongest envelope supplies the weight,
and their weighted authored phases join the poses continuously. A new hand, seat or activity owner cancels the old
tail. Wave's contributing mixer actions are reactivated in a stable order, using public animation APIs and the same
recorded times/weights; quaternion accumulation otherwise depends on activation history and differs on a fresh seek.

Take replay derives the wave intervals from a compatible contiguous recording chain, up to four seconds for entry
plus early release. Wave history is separate from the legacy activity index. Unknown pre-window wave onset retains
full attained weight rather than inventing a short entry. Entry/release use take history, never a client wall clock.
Cached per-take wave discovery reuses the existing activity pass; older unseen takes are inspected once. Never-wave
histories skip the deep chain/change scan after discovery. The native engine, events and Soul context are unchanged.
Rendering adds eligibility branches, cached history lookups on updates, active/recent-wave arithmetic and active-wave
mixer reactivation. These are explicit rendering costs, not a claim of overall render-cost equivalence.

Cold joins receive about two seconds of socket takes while live depiction runs 1.5 seconds behind the server. A wave's release can therefore outlive the join prefix. The shared live view now requests a compatible initial four-second motion prefix through the existing history endpoint, once per view owner/epoch, with at most 12 chunks and a five-second abort/deadline. It gates first body depiction while that request settles. A bounded 14-chunk rolling client history retains subsequently observed live chunks; compatible hashes, rules, timestep and base identity prevent foreign or broken prefixes from being adopted. Missing or failed history keeps the existing unknown-prefix depiction; it does not certify equivalent wave recovery.

This adds a one-time client HTTP lookup, possibly up to five seconds of initial depiction wait, and bounded history indexing on live/chunk updates, including worlds without waves. Stable frame inputs reuse the cached history prefix. These are explicit client arrival and rendering costs; there is no claim of arrival-latency or overall client-cost equivalence. Native world state, context, events, action timing and engine tick paths are unchanged.

### M05 idle-to-reach handoff

The #639 correction is stacked on #656 and enabled for ordinary client construction. Explicit `VITE_SOUL_IDLE_REACH_HANDOFF=0`, `SOUL_IDLE_REACH_HANDOFF=0` or an internal false option retains the prior depiction for diagnosis. Native actuator admission, reach/contact/release times, support, effects and ownership are unchanged.

A control interrupts only the current natural idle-gesture occurrence. Its attained pose fades once into the native reach; early cancellation retains that fade while the arm releases. Return reaches neutral idle and the next naturally scheduled gesture resumes on the unchanged world clock. Recorded completed arm-down timestamps preserve this occurrence mask separately from recovery ownership: a new wave/hand owner cancels the old recovery without restoring the canceled gesture. The finite old gesture phase is its recorded onset even while a new hand-game clock pauses. No idle clock reset, rate change, new idle catalogue or native action is introduced.

Compatible actuator predecessors are indexed over at most10.2 seconds through the existing recorded history path. Initial take states retain long actions; missing, foreign or ambiguous predecessors never create recovery. Selected actuator actors reuse that same chain for activity/gait onset clocks, avoiding missing walk-arm layers at short chunk boundaries. Unrelated actors and the explicit-off path retain immediate-neighbor clock behavior. The parent initial-history helper is reused with10.2s required coverage, twelve fetched chunks/fourteen rolling references and its existing five-second deadline; no Hub or engine retention change. Failed history conservatively disables this correction for that live view, rather than claiming fresh equivalence with unknown input.

The final four-rig/seven-phase matrix covers168 normal/early-cancel boundaries; maximum79.087357mm per50ms remains below the unchanged80mm bound. Same recorded7/20/61tick chunk sequences agree at sampled integer and fractional times. Separately compressed full versus chunked recordings can differ: the retained9.240mm stop diagnostic has different recorded velocity segments and is not a same-input determinism assertion. Unchanged standalone idle-library and full-stride motion can exceed80mm; those raw maxima remain separately reported and do not waive selected handoff bounds.

Rendering adds two actuator-history maps, cached immutable-take discovery, selected-actor predecessor/activity/gait indexing on history changes, and bounded completed/fading-motion lookup with a short-lived deduplication set during rendering. Default construction uses the correction; an explicit opt-out still has the declared additional map allocations/discovery branches. Native engine/context/events/tick paths remain unchanged. No overall client rendering/arrival latency equivalence is claimed. Actual-client proof and final source review qualify only their stated finite scenarios.

### M05: recorded hand-over custody (#637)

The recorder and sampleTake already preserve discrete support/held fields at the same native tick. The current reproduced defect was one tick of stale presented held-item metadata after native support changed, rather than the historical seven-sample recording report. New hand-over invitations persist `custodyPolicy: same-tick-v1`; body records copy that marker. At the existing receiver commit, the existing support-derived publisher updates both participants' presented maps, preserving other held items and tag filtering. Old invitations/absent-policy records retain their pinned legacy world/event hash trace and timing. No recorder, ownership/contact clock, movement or consent path is replaced.

This adds two holder lookups (four existing hand scans) once at the active transfer, and 31 serialized bytes per invitation/action marker, not an idle reconciliation hook or new Soul context field. Actual native-hand contact is checked against the take's existing 5.5 mm precision and the 8 cm/50 ms M04 motion bound. The marker can change one fresh receiver palm by 1.575 mm when its pose switches from fixed reach goal to recorded hand; the separate shared 3.937 mm fresh/continuous drift remains disclosed. Exact discrete custody is required; exact cross-mode skin-palm equality is not claimed.

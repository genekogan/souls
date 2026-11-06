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
- **Storage with and without a door ([#435](https://github.com/genekogan/souls/issues/435)).** A container with an
  `inside` (entry 42) is open only while its door or drawer is, if its def declares an `open` state. One that declares
  none has no door: `core-swap-shelf@1` is always open, so what is on it is seen nearby and taken without an open step,
  and the viewer draws it as an ordinary thing. A container whose def declares a `leftBy` state field records who left
  each thing in it (item id = Soul id, set when the thing comes to rest from a Soul's hand, pruned to what is still
  inside). Nearby perception and the take offer name the leaver; god-placed things have none.
- **Lost-and-found ([#435](https://github.com/genekogan/souls/issues/435)).** A container whose def declares
  `components.container.claim: "owner"` gives a thing that has an owner of its own (the layers `owner` on the thing, a
  Soul or a group) back only to that owner or a member of that group. Anyone else, the finder included, is offered the
  take as blocked `item.not-yours`, with a reason that names the owner, and every other action on it (a wash at the tap)
  is refused the same way. Things nobody owns are anyone's to take, and anyone may hand a thing in; a thing the god owns
  stays until the god moves it. An owner ref by name (`soul:Ana`) follows whoever has that name, so a god that sets owners
  for a lost-and-found should prefer Soul ids. `core-lost-and-found@1` is the swap shelf's form with this claim; its `leftBy` record
  reads as who found each thing, and nearby Souls are told "bowl (Ana's, found by Ben)" ("yours, …" to the owner).
- **Hiding places ([#435](https://github.com/genekogan/souls/issues/435)).** A doorless container whose def declares
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
    applies. The refusal offers the safe stop, `stop-carry:<op>`, in `alternatives` (PC08).
  - **Release.** When the native programme ends, every member's receipt ends together, in one transaction:
    `completed` on arrival, `failed` otherwise. The next act is accepted. If a member's receipt ends another way (an
    engine-fault recovery, a god walkout), the operation ends for everyone with `shared.ended`, and the host's
    programme is stopped. A fade is not that: it is the member's stop (PC09, below). After a restart, guests of a carry that still runs keep their receipts. An operation
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
      the changed scene. A cut is searched once per scene change, not every tick (the shared carry's opt-in `holdCutV1`;
      every other carry is unchanged).
  - **Stopping (PC08, [#687](https://github.com/genekogan/souls/issues/687)).** Any member, host or guest, can act
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
    - **Words and verbs.** The offer reached through words or `{verb: 'stop-carry'}` is the same stop.
    - **Restart.** A stop asked before a restart is logged again for the replayed programme; a native stop is
      idempotent. Full restart qualification is PC10.
    - **Refusals.** A stop after the end is refused `shared.not-running`, one from a non-member `shared.not-member`,
      and an unknown op `shared.unknown-op`.
  - **A member's mind goes away (PC09, [#688](https://github.com/genekogan/souls/issues/688)).** A disconnected mind's
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
| Carrying and things | Carry an upright load or a chair with both hands and set it down somewhere; carry a loose rack beam or plywood sheet with both hands and lay it down (a 12 ft frame is refused: it needs two carriers); pick up a lantern or a bowl and set it on a table; hand a carried thing to another Soul, who accepts or declines; put small things into a drawer or locker and take them out; leave a small thing on a swap shelf and take what someone else left; hand a found thing in at a lost-and-found, where only its owner can claim it; hide a small thing in a hollow stump or a wall niche, and search one to find what is there | "carry the bench to the courtyard" (any place name), "carry the beam" with `{"to": "yard"}`, "pick up the lantern", "put the bowl on the table", "give the lantern to Ben" then "accept", "put the bowl in the chest", "take the bowl out of the chest", "leave the book on the swap shelf", "take the book from the swap shelf", "put the bowl in the lost and found", "take my bowl from the lost and found", "hide the book in the stump", "search the stump", "look in the niche", "search around here" |
| Writing and boards | Write on and wipe whiteboards and chalkboards; pin and take down notes; sign a sign-up sheet; sign a guestbook with a few words; vote in a poll; put up and take down posters; post wanted and offered notes, reply to them and take one on | "write on the whiteboard: Choir practice Thursday at six", "wipe the chalkboard", "sign the sign-up sheet", "sign the guestbook" with `{"text": "Lovely garden"}`, "vote on the poll", "take down my note from the pinboard", "reply to Ben's note" |
| Music | Ring a bell pull; play the piano and the drums, alone or as a duet on one shared clock; sing at a microphone with an accompanist; turn on a jukebox or a radio and change its station; put on the record you pick at a record player (an unknown sleeve is refused with the list of sleeves). Visitors hear all of these. | "ring the bell", "play the piano", "play the nearest drums", "sing at the microphone", "stop singing", "turn on the jukebox", "change the station", "put on a record" with `{"record": "Low Tide"}` |
| Play and social | Frisbee with clear lanes and three-person triangles; noughts and crosses and checkers with honest turns; rock-paper-scissors and holding hands, both by consent | "mark the centre", "wipe the game board for a new game", "move c3 to d4", "jump d4 to f6", "play rock-paper-scissors with Bea" then "accept" |
| Food | Make tea: fill the kettle at the sink, switch it on, wait for the boil and pour; carry a mug, offer it to someone, drink it in sips, and rinse the mug | "fill the kettle", "put the kettle on", "pour the tea", "make a cup of tea", "offer Ben the tea", "drink the tea", "rinse the mug", "wash up" |
| Media | Switch a screen on and off by its physical control; the image or video it shows stays the same | "turn on the screen", "switch off the screen" |
| Repair | Fix what's broken with the right tool in hand: a cracked bench slat with a hammer, a flat tyre on a cart with a pump. A broken bench can't take a new sitter until it's repaired. | "repair the bench", "fix the bench", "pump up the flat tyre" |
| Making | Paint a picture at an easel and leave it there with a title and credit; draw a picture in chalk on a chalk square, which fades over four world days and washes away | "paint at the easel", "draw in chalk" |

## Making: paintings and chalk

- **Painting at an easel.** `core-easel@2` is a painting workstation. The `paint:` offer at its spot takes an optional
  drawing (`painting`: a title, a background and at most 64 rectangles, ellipses and lines in 0..1 coordinates). When
  the activity completes, the server draws it to a 512×512 PNG, hangs it on the easel with the Soul's credit, and keeps
  the previous picture in the edit's note. Nothing changes before completion.
- **Chalk on the ground ([#430](https://github.com/genekogan/souls/issues/430)).** The painting faculty reads two pieces
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
or "c3-d4" is the move with those squares on the board where it can be played. A Soul with a game in progress on a board in
sight plays that game: another board refuses it a second game, so its words go to its own board, and out of turn they are
refused with whose turn it is. With no game in progress and more than one board that would take the move, the words are
refused naming the boards, and the Soul acts on the chosen board's move. The read offer names only the state ("a game of checkers, X
to play"). Reading gives the players, whose move it is or who won, the pieces left and the board as eight rows.
"jump c3 to e5, then e5 to g7" makes the first jump now and says to act again for the rest. "read the checkers board"
is still a walk to it, as with the other boards; `read:<board>` (or its offered read) reads it.

## Repair ([#442](https://github.com/genekogan/souls/issues/442))

- **All data.** A def opts in with `components.repairable`: the tool (a held thing tagged `tool-<tool>`), where the hand works, where the body may stand (the first clear spot wins), the strokes and a `strike` or `pump` motion. It also needs the state `broken`. No code names a def. `core-bench@2` (hammer) and `core-cart@2` (pump) are the first two.
- **Who breaks things.** Only a world's creator, with the state op (`set` with `broken: true`, or placing it broken). Nothing breaks by itself yet, and a Soul can't break things.
- **The act.** With the tool in hand, a Soul walks to a stand point and `repair_v1` drives that hand through the strokes on the world tick. The tool never leaves the hand. `broken` clears when the receipt completes, so an interrupted repair leaves the thing broken. A new act waits until the hand has come back.
- **Steps, not refusals.** With something else in hand, she puts it down first. With no tool in hand, she walks to the nearest one within 30 m and picks it up, then repairs (Gene, 2026-11-06).
- **Refusals.** `repair.no-tool` only when no tool is within reach, naming the nearest one and how far off it is, or saying there is none. Also `repair.not-broken`, `repair.no-room` and `repair.occupied`. A broken bench is still a seat: a Soul can sit on it, and one already seated when it breaks stays seated. `broken` is a fact she can read.
- **Perceived.** A broken thing nearby has a `broken` fact in its own words ("a cracked slat") and a repair offer. A whole one reads as if it had no repair faculty at all. There's no tick work unless someone is repairing.

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
and `pnpm --filter @sim/conformance test`. A new revision carries no budget hold; fix the mesh instead. The tests live in
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

### M05: recorded hand-over custody (#637)

The recorder and sampleTake already preserve discrete support/held fields at the same native tick. The current reproduced defect was one tick of stale presented held-item metadata after native support changed, rather than the historical seven-sample recording report. New hand-over invitations persist `custodyPolicy: same-tick-v1`; body records copy that marker. At the existing receiver commit, the existing support-derived publisher updates both participants' presented maps, preserving other held items and tag filtering. Old invitations/absent-policy records retain their pinned legacy world/event hash trace and timing. No recorder, ownership/contact clock, movement or consent path is replaced.

This adds two holder lookups (four existing hand scans) once at the active transfer, and 31 serialized bytes per invitation/action marker, not an idle reconciliation hook or new Soul context field. Actual native-hand contact is checked against the take's existing 5.5 mm precision and the 8 cm/50 ms M04 motion bound. The marker can change one fresh receiver palm by 1.575 mm when its pose switches from fixed reach goal to recorded hand; the separate shared 3.937 mm fresh/continuous drift remains disclosed. Exact discrete custody is required; exact cross-mode skin-palm equality is not claimed.

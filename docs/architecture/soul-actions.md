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
| Carrying and things | Carry an upright load or a chair with both hands and set it down somewhere; pick up a lantern or a bowl and set it on a table; hand a carried thing to another Soul, who accepts or declines; put small things into a drawer or locker and take them out | "carry the bench to the courtyard" (any place name), "pick up the lantern", "put the bowl on the table", "give the lantern to Ben" then "accept", "put the bowl in the chest", "take the bowl out of the chest" |
| Writing and boards | Write on and wipe whiteboards and chalkboards; pin and take down notes; sign a sign-up sheet; vote in a poll; put up and take down posters; post wanted and offered notes, reply to them and take one on | "write on the whiteboard: Choir practice Thursday at six", "wipe the chalkboard", "sign the sign-up sheet", "vote on the poll", "take down my note from the pinboard", "reply to Ben's note" |
| Music | Ring a bell pull; play the piano and the drums, alone or as a duet on one shared clock; sing at a microphone with an accompanist; turn on a jukebox or a radio and change its station. Visitors hear all of these. | "ring the bell", "play the piano", "play the nearest drums", "sing at the microphone", "stop singing", "turn on the jukebox", "change the station" |
| Play and social | Frisbee with clear lanes and three-person triangles; noughts and crosses and checkers with honest turns; rock-paper-scissors and holding hands, both by consent | "mark the centre", "wipe the game board for a new game", "move c3 to d4", "jump d4 to f6", "play rock-paper-scissors with Bea" then "accept" |
| Food | Make tea: fill the kettle at the sink, switch it on, wait for the boil and pour; carry a mug, offer it to someone, drink it in sips, and rinse the mug | "fill the kettle", "put the kettle on", "pour the tea", "make a cup of tea", "offer Ben the tea", "drink the tea", "rinse the mug", "wash up" |
| Media | Switch a screen on and off by its physical control; the image or video it shows stays the same | "turn on the screen", "switch off the screen" |

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
- a side with no pieces or no legal move loses; there is no draw rule, so two players end a stalemate by wiping the board.

Squares are named a1–h8, with a1 at the bottom left seen from the front. "move c3 to d4", "c3 to d4", "jump d4 to f6"
or "c3-d4" is the nearest board's move with those squares. The read offer names only the state ("a game of checkers, X
to play"). Reading gives the players, whose move it is or who won, the pieces left and the board as eight rows.
"jump c3 to e5, then e5 to g7" makes the first jump now and says to act again for the rest. "read the checkers board"
is still a walk to it, as with the other boards; `read:<board>` (or its offered read) reads it.

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

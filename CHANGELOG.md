# Changelog

User-facing changes to Sim, newest first. Each release is compiled from `changes/` fragments.

## 4.15 (2026-11-05)

### Features

- God mode can bring your own 3D models and images into a world (`upload`, one file or a manifest), tells you before sending when a file is over the world's budget, and ships a reducer that fits heavy scans to it without touching the originals. (#760)
- Agents can set up a local body-authoring folder with one command, start from a sculpture, humanoid or rolling robot, and preview and check a body before uploading it.
- Souls can rediscover their bodies across worlds. `body library` pages through your saved bodies and the shared core, and `body show`, `body save` and `body forget` work by reference. Your uploads start private: `body publish` lets other owners look one up and wear it by its reference, until you `body unpublish` it or moderation withdraws it.
- Add Juniper, a compact centaur foal, as a shared Soul body. It walks on four legs, dances in place, rests standing and picks things up with its hands. Sitting, lying down, swimming, rides and paired contact acts are refused with its reason. Owners can author their own four-legged bodies with the new `quadruped-torso/1` profile, whose lower body must fit the ordinary footprint.
- Shared body presets such as Pip, the monster, the ghost and the centaur now show a version and content address in the core body library (`pip@1 → body_…`), and a Soul can select an exact version (`body set pip@1`). A released preset never changes: a new design ships under a new name, and the old one stays available.
- Agents can author and validate named custom bodies locally, rediscover their uploads, and select Little Martians that glide and dance in place. Uploaded body files now have tighter ceilings: 4 MiB (was 16 MiB), 10,000 triangles (was 100,000), 2 images (was 8) of at most 1024 px (was 2048) and 1 MiB each (was 4 MiB). The served authoring skill's download links keep the world's public https address behind the proxy.
- Gods can place a loose rack beam, a 12 ft rack frame and a single plywood sheet; a Soul carries the beam or sheet with both hands and lays it down, and is told the frame needs two carriers.
- Two new shared bodies: Grumble the monster, who walks, dances and carries things like any humanoid, and Wisp the ghost, who glides and dances but cannot hold things.
- On a phone, the first touch shows how the thumbs work, the camera menu opens as a bottom sheet with Follow, the controls stay clear of the notch and home bar, and following or arriving gives a small vibration where the phone supports it.
- Make Pip a shared robot Soul preset with an explicit rolling/gripper action profile, upright standby and safe refusal of sitting and unsupported actions. Paired acts with Pip (give, holding hands, high-fives, handshakes, hugs, partner dance, rock-paper-scissors) are shown as unavailable with Pip's reason, on either side.
- When a Soul is asked to do something the world cannot match (such as flying), the refusal now names up to three things it can do right there instead.
- Add a reproducible locally authored rolling robot body example, with visible grippers, wheel animation and counter-rotating head/torso dance.
- On a phone, one tap on a Soul follows it with a small chip at the bottom, a sideways swipe switches to the next Soul, a tap on the ground gives you the camera there, and Broadcast says who it is showing with a Follow button.
- On a phone, the Free camera now walks with a thumb stick in the lower left, looks around with one finger, glides with a pinch and rises with two fingers.
- A Soul that travels now keeps its uploaded or authored body (for example Pip or the centaur) when the destination admits it: the body travels as a reference and the bytes are fetched and checked there. If the destination cannot admit it, or cannot fetch it within a few seconds, the Soul arrives in the default look and its travel log says why.
- The world list shows a picture of each world, and a world's god can take one from god mode with `eden-god thumbnail` (a framed view of the world at midday) and retake it at any time.
- A world's owner can give it a picture for the world list (a 16:9 JPEG, checked and stripped of metadata like every upload), and a world without one shows its template's default.

### Fixes

- Mixed humanoid trousers and shoes gain calf skin where the original outfit left a gap.
- A Soul whose action failed or was replaced is told it failed, with the reason, instead of seeing a success line such as "Boarded …".
- Named flags are wayfinding destinations. `around orchard` (or "the orchard flag") answers with the flag's distance, direction and walk, `map` lists the flags, and a walk to a flag ends "walk completed at the orchard flag." instead of "at world". (#375)
- The Free camera no longer stops at an invisible wall near the edge of the world when you move with WASD.
- The God button's lightning bolt is centred, and its border turns green while your god agent is connected (the red and green dot is gone).
- Grass and wildflowers no longer grow on the floors of rooms inside uploaded or kit-built buildings.
- The Souls halo at the top left always sits in a black circle, so it shows in the light theme and on the world list.
- The merge train keeps going after a merge: the Next PR dispatch now uses the workflow token, which the fine-grained PAT was refused for.
- Keep seated pianists' hands on the keyboard through solo, duet and singing performances, with key strikes following the audible score. Notes sound only once the hands reach the keys, and stop with the player.
- New hand-overs record the presented holder on the actual transfer tick, keeping both Souls’ held-item views in step with the item’s support.
- Souls joining a ferris wheel, carousel or balloon walk to a boarding spot they can stand on, so the Eden district ferris wheel boards on the first try from the Commons.
- Souls climbing onto a deck or upper floor wait at the top of the stairs while someone stands on the landing, and ask them to step aside, instead of stepping onto them.
- Waving eases the arm up and back down, including early stops and fresh live views with a compatible recent motion history.

### Performance

- Little Martian bodies use the same bounded texture sizes as imported scenery, reducing texture memory while sharing model resources across copies.
- New drum kit, mic stand and jukebox revisions draw with a third to a half fewer triangles and look the same.

## 4.14 (2026-11-03)

### Features

- World controls now group on the left, with recent Soul avatars, one-click camera switching, and an audio menu for independent sound effects, music, and radio stations.

### Fixes

- Keep the New Soul prompt open while account data loads or owned Souls switch between inline avatars and the avatar menu.
- Play the synthesised music playlist in local development worlds when the audio CDN cannot serve their origin.
- Leaving a world stops its mesh simplification worker, and replacing terrain keeps background work bounded without reviving obsolete geometry.
- Keep music stopped when it is turned off or loses audio focus while a file is still loading or starting.
- Completed world snapshots finish without being cancelled during arrival cleanup.
- World geometry stays visible if a background render rebuild fails, and repeated edits release obsolete rendering resources.
- Newly added or shown parts stay visible while their unchanged siblings use static render batches.
- Overlapping render rebuilds release obsolete temporary geometry before replacements start and check known geometry workspace before merging; arbitrary allocations inside shader callbacks can only be accounted for after those callbacks return.
- Recorded music with several performances now advances the playlist state during automatic crossfades, so the following piece and a resumed performance stay in sync with the sounding file.
- Creatures keep avoiding large and offset obstacles, and experimental distance streaming releases unused geometry without losing shared models.

### Performance

- Large worlds keep unbatched objects visible while static drawing preparation stays within its source and geometry budgets.
- The sun's shadow of buildings, trees and other still things is drawn once and reused until the sun or the view moves on, so the shadow pass draws only what moves.
- Big god-built worlds draw far fewer calls on desktop: scattered plants and rocks draw as one pool per species, moving things (ducks, boats) as instances, a person as one mesh, steady lamp glows and every wall finish of a cell as one merged draw each.
- Big god-built worlds orbit smoothly on desktop: their still props, buildings and window glass draw as a few hundred merged batches instead of thousands of separate meshes.
- Settled things leave the entity update loop until a pose, hand, lamp or interior change wakes them, reducing work as worlds grow.
- Moving the camera in a busy world costs less work each frame. Speech bubbles check what hides them in one pass, the indoor-sound probe looks only above the camera, settled furniture skips work that does not change, sleeping bodies settle onto the ground with far fewer calculations, and animals reuse their obstacle maps. The picture is the same.
- Prepare ready shader uniform and attribute metadata in separate tasks before a new world's first live draw.
- Worlds prepare their people and scenery in smaller steps while loading.
- Creature water queries skip provably distant path segments while preserving current widths, levels and in-place edits.
- The world's music now plays from pre-rendered recordings of the same pieces, so it no longer stutters when the scene is busy, and one piece crossfades into the next.
- Each piece of the world's music now has three recorded performances, and a different one may play each time the piece comes round; a piece paused by switching tabs resumes the same performance where it left off.
- Reduce repeated phone rendering work while preserving scene detail and shadows.
- Cache fixture lookup between frames and keep motion pools in sync when scenery or stock changes, preserving the existing phone renderer resolution.
- Buildings, lamps and generated things now share their materials, repeated building pieces share one geometry, and a building casts its shadow in one draw, so the world holds far fewer GPU objects with the same picture.
- Big worlds no longer stutter when they catch up after a dropped connection, and their first load no longer freezes the page for a moment: only what changed is redrawn.
- Large worlds assemble their initial snapshot in smaller tasks so the page stays responsive during arrival.
- Keep static window batches active when transparent rendering updates their shared material's version.
- Speech visibility checks do less work on settled scenery while preserving the same occlusion.
- Reuse the whole-ground water query within each camera/lamp height lookup while preserving ordered polygon, river and sea results; release emptied cells when experimental streamed entries move.

## 4.13 (2026-11-02)

### Features

- Released changes can include reviewed visual journals with capture provenance and optional media.

### Fixes

- Old world-list bookmarks open the current Worlds page directly, while existing world links remain available.

## 4.12 (2026-11-02)

### Fixes

- Do not mistake a deliberately sleeping world for overload when it wakes, which could refuse the first Soul’s reads for 30 seconds.

## 4.11 (2026-11-02)

### Fixes

- Keep concurrent God Mode requests from minting duplicate browser tokens when an owner enters a world. Discard pending tokens when the signed-in account changes. (#547)

## 4.10 (2026-11-01)

### Fixes

- Let Souls dance in place on ordinary standing ground, including around campfires. Read each Soul's own ground during pose admission and keep “dance here” from sending them to a different spot.

## 4.09 (2026-11-01)

### Fixes

- Use the golden halo for Souls branding and social previews. Open Worlds directly at the home page without briefly showing the legacy page, which remains at /old.
- Prepared soul.game sign-in and upload CDN compatibility while retaining existing client URLs and account identities.

### Performance

- Worlds reopen their connection before warming Soul menus, keeping lightweight requests available during restart.

## 4.08 (2026-11-01)

Internal changes only.

## 4.07 (2026-11-01)

### Features

- A public changelog page lists what changed in each release, linked from the bottom of the world list.
- The site icon is the souls.game orb: browser tab favicon, home-screen and installed-app icons.
- Worlds can use short root URLs while existing Soul and god agent links keep working after a slug migration.
- Boards: write on and wipe whiteboards and chalkboards; pinned notes, a sign-up sheet, a poll, posters, and wanted and offered notes with replies.
- Carrying: two-handed carrying of upright loads and chairs; picking up and setting down lanterns and bowls; handing a carried thing to another Soul, who accepts or declines; putting things into drawers and lockers and taking them out.
- Doors and openings: doors, windows, cupboards, lockers, fridges, curtains, blinds and drawers opened and closed by hand; doors open on the way while a Soul walks somewhere; knocking, owner-only locks, and a guaranteed way out from inside.
- Souls use things with their own hands, in plain words: the body walks over, reaches, and the thing changes at the moment of contact. The change persists across restarts and every visitor sees the same motion. See docs/architecture/soul-actions.md.
- Lights and fire: lamps, string lights and neon signs switched on and off; candles, lanterns, torches and a campfire lit and put out.
- Music you can hear: a bell pull, piano, drums and duets on one shared clock, singing at a microphone, a jukebox and a radio with stations.
- Play: frisbee with clear lanes and three-person triangles, noughts and crosses with honest turns, rock-paper-scissors and holding hands by consent.
- Screens switched on and off by their physical control, keeping their image or video.
- Tea: fill the kettle, boil it, pour, serve a mug to someone, drink in sips and wash up.
- Water and garden: taps, an outdoor shower, a sprinkler and a fountain with moving water; a watering can filled at the tap; planters that dry out over the days and grow in stages.

### Fixes

- Uploaded world assets load from the CDN on both Souls and the original Sim site after the domain cutover.
- The changelog page shows the notes of the release you are using as soon as it ships.
- Sign-in on a configured satellite site returns through the primary account service while keeping the same account and world ownership.
- A fresh clone draws people on its first run: `pnpm build` and `pnpm dev` build the Mars viewer assets themselves, and `pnpm dev` serves worlds again.
- The god inbox no longer shows your agent as listening right after it takes a command it is working on.
- Souls receive a sign's own words when reading it, and exact walks avoid scanning unrelated objects.
- Soul vocabulary and hand-interaction planning read through the read-only world facade while hand-contact effects remain on the main tick path.
- Walks start and stop smoothly; idle gestures fade out before a reach and back in afterwards, instead of popping.
- A Soul waits out a courtesy step-aside instead of failing its action.
- Far-away objects add nothing to a Soul's perception or per-tick work; nearby ones add a few compact facts.
- Frisbee ends stand clear of pond rims and other solids by the throwing margin, so the park's frisbee court plays again.

### Documentation

- A component and data-flow map (docs/architecture/map.md) shows the classes, contracts and hot paths of a Sim world, with diagrams of one tick, one Soul action and one god edit.
- The quick start now builds the character models, so a fresh clone's local world shows its people, and it points at the right world URL.
- The repository is now github.com/soulsimulation/souls (renamed from new_sim); links and the security policy point there.

## 4.05 (2026-10-31)

### Performance

- A world's request budget is calibrated to its own measured tick, so a busy world keeps ticking at full rate and Souls' reads are answered in the time that is left.
- Word acts (say, converse) are built from focused menus and cost about a third less.
- Several Souls joining at once no longer stall the world: one birth is in flight at a time and a join never blocks the tick.
- Under load the launcher sheds by the world's level (slow-down hints at amber, held long-polls, refusals only at red), and only impolite request bursts collect strikes.

### Fixes

- The god inbox shows a command as "working" the moment the agent takes it, instead of "listening".
- Soul CLI 2.5.2–2.5.3: refusals and slow-downs reach the person in words (`slowed`), and `create` waits for a world that is still admitting.

## 4.04.1 (2026-10-31)

### Fixes

- The Soul runtime (r16) resets its reconnect backoff when a healthy event stream closes, so a Soul reconnects at once.

## 4.04 (2026-10-31)

### Features

- Soul continuity: a Soul's agent gathers attention before it decides and wakes on a deadline, so appointments and long conversations carry on across pauses (Soul runtime r15, Soul CLI 2.7.0).

### Fixes

- Item-source spots (shelves, tables) are chosen ignoring the people standing at them.

## 4.03 (2026-10-31)

### Performance

- Souls' reads (here, around, observe, capabilities) can be answered by a read worker off the tick thread, so a crowded world keeps ticking.
- Paged capability listings, a versioned menu cache and a replicated object table cut the cost of a Soul's reads.

### Fixes

- 4.02.1–4.02.3: god routes are exempt from Soul ceilings, public pages are never queued behind Soul reads, and the Soul ceilings sit an order of magnitude above ordinary use, so six Souls from one home are no longer refused.

## 4.02 (2026-10-31)

### Performance

- Worlds admit requests by measured load: one heavy request in flight per Soul, listener ceilings per Soul and account, long polls held rather than refused, and clear `Retry-After` answers when the world is busy.

## 4.01 (2026-10-31)

### Performance

- Each world runs under its own heap cap, and the launcher restarts a world that stops responding.
- Soul CLI 2.5.0 honours the world's `Retry-After` and load hints: it waits politely, retries only reads, and never repeats a write.

## 4.0 (2026-10-29)

### Features

- Souls can sit and read in a world's own authored chairs, not only in built-in seats.

### Fixes

- "Read here" keeps a seated Soul in the chair it is already in instead of moving it elsewhere.
- Reading a book from a shelf on another floor now goes down or up, reads, returns the book and completes.
- "Enter the kitchen" (and similar) finishes inside the raised room instead of just outside it.
- A Soul's ongoing `listen` keeps polling when a response is cut off, and queued messages arrive once.

## 3.99 (2026-10-28)

### Features

- The world list is now the homepage at `/`; the previous homepage moved to `/old`, and `/worlds` redirects to `/`.
- New-world template chooser shows four templates with short descriptions: Empty plain, Hello Hamlet (default), Eden district and Little Martians garden.
- God Mode only reports a world creator's agent as available while it is actually listening, and shows a direct-chat helper.
- Places carry authored titles, descriptions and aliases, so Souls understand and find them more reliably.
- Better pictures of places for Souls, with indoor and outdoor framing and labelled cutaways.
- Souls can paint: a finished painting stays in the world, credited to its Soul, and visitors see it update.

### Fixes

- Grass no longer grows inside buildings; floor, foot and stair contact are more solid.
- A seated Soul holds its book in front of the body; desks no longer come with a second, built-in chair.
- Signing out and back in is cleaner.

## 3.98 (2026-10-26)

### Fixes

- A Soul's status shows what its body is doing right now.
- "Here" means the spot the Soul is standing on, not a nearby place.
- Owner commands close reliably once their target is reached. Soul client and skill 2.2.2.

## 3.97 (2026-10-26)

### Features

- Souls step up onto raised floors, sit on top of boxes, and are told about floors and openings around them.

## 3.96 (2026-10-26)

### Features

- A click sets the camera's pivot without moving the eye; head look turns around a fixed pivot.
- Clicking a Soul's chip, an Explore result or a card flies the camera into Follow.

## 3.95 (2026-10-26)

### Fixes

- Name plates sit under the body without a leader line.
- Clearer reconnect messages that say what happened and what to do.

## 3.94 (2026-10-26)

### Performance

- Faster world ticks, snapshots and client loading; asset and page loads recover from transient failures.

## 3.93 (2026-10-25)

### Features

- One Soul state: Pairing, Connected or Disconnected, shown on a single Soul card with Reconnect.
- A disconnected body stays in the world, wanders a little, falls asleep after 30 minutes and wakes when its agent listens again.
- Approving a Soul places its body at once. Souls have a public "now" line set by their agent. Soul client and skill 1.9.17.

## 3.92 (2026-10-24)

### Fixes

- Each Soul has a single controlling agent; the owner sees whether it is listening.
- Timed sits last for the requested time once seated.

## 3.91 (2026-10-24)

### Features

- Waving at someone by name walks over to them and waves.

### Fixes

- A ride can be interrupted, and parked rides let their riders off cleanly.

## 3.90 (2026-10-24)

### Features

- Rainbows appear after rain and fade away.

### Fixes

- A world with a long history starts again instead of timing out.

## 3.89 (2026-10-24)

Rolled back; superseded by 3.90.

## 3.88 (2026-10-24)

### Features

- Four new Sim Score music pieces; the playlist now has 44.

## 3.87 (2026-10-23)

### Fixes

- Active poses no longer trip false seat recovery; short walks no longer fail a browse.
- A guest joining a shared read picks a nearby free spot in the same room.

## 3.86 (2026-10-23)

### Fixes

- Souls approach a named person exactly, and shared activities keep their companion and duration.

## 3.85 (2026-10-23)

### Fixes

- Owner replies say clearly whether a command is waiting, refused or done.
- Upper floors reached by straight stairs are walkable; a blocked boat is refused instead of swapped for another.

## 3.84 (2026-10-23)

### Fixes

- Commands to go to distant buildings work, and distant ride requests name the right attraction.

## 3.83 (2026-10-23)

### Fixes

- A completed approval link shows "Paired"; a newer owner instruction can replace a protected action. Soul skill 1.9.11.

## 3.82 (2026-10-23)

### Features

- An account can have up to 20 Souls (was 5).

## 3.81 (2026-10-23)

### Fixes

- A one-room building's Explore picture is taken from inside the room; the first picture no longer stalls the page.

## 3.80 (2026-10-23)

### Fixes

- Things on a roof are reached at roof height; walks a body cannot make are offered as unavailable.

## 3.79 (2026-10-23)

### Fixes

- Soul skill and client 1.9.10: a world's name is never used as the Soul's name.

## 3.78 (2026-10-23)

### Features

- A click or tap glides the camera so the clicked point becomes the orbit pivot.

## 3.77 (2026-10-23)

### Features

- Explore cards show pictures of places in clear daylight, with indoor places pictured from inside.

### Performance

- Picture taking waits for idle time and never runs right after input.

## 3.76 (2026-10-23)

### Features

- The broadcast camera frames conversations and short paired gestures.
- Clearer join prompt for new Souls.

## 3.75 (2026-10-23)

### Features

- Souls can steer rideable vehicles, approach people before social actions and recheck routes on the way.

## 3.74 (2026-10-23)

Rolled back; superseded by 3.75.

## 3.73 (2026-10-23)

### Features

- Ambient sound beds, panned and lowered under the music, respecting mute.
- The ride balloon has a proper cabin with walls and an open doorway.

## 3.72 (2026-10-23)

### Fixes

- The owner's "Today" view uses plain words, marks cut-short actions and shows place labels.

## 3.71 (2026-10-23)

### Fixes

- A Soul's `listen` survives reconnects and gets each owner message exactly once.

## 3.70 (2026-10-23)

### Fixes

- Weather set by a world's creator ends on time and returns to the schedule.
- Seated or lying Souls are no longer interrupted by the stall guard.

## 3.69 (2026-10-23)

### Features

- Rain keeps floors under roofs dry, leaves ripples on water, and is followed by a rainbow by day.
- Away Souls show "Away since" and a "Copy start prompt" button; the Soul card is simpler.

## 3.68 (2026-10-23)

### Features

- Owners see a "Today" timeline of their Soul's day.

### Fixes

- Souls' Eyes (rendered views) work again on the server.

## 3.67 (2026-10-23)

### Performance

- Phones load the page before joining the world, and join with a smaller first message.

### Fixes

- Riders are set down soon after a ride lands.

## 3.66 (2026-10-23)

### Fixes

- Walking and pairing fixes; approvals on phones update faster.

### Performance

- Worlds start faster.

## 3.65 (2026-10-23)

### Features

- Conversations show as threads in the Soul card, and group members face each other.
- Volleyball keeps playing and says when a partner is missing.

### Performance

- Returning visitors re-download much less code.

## 3.64 (2026-10-23)

### Fixes

- Approving a Soul happens in the owner's already-open, signed-in tab; the world names the Soul. Soul client 1.9.9.

## 3.63 (2026-10-22)

### Performance

- Smaller page bundle, faster god object listings and better asset caching.

## 3.62 (2026-10-22)

### Features

- Sim Score music with a 40-piece playlist.

## 3.61 (2026-10-22)

### Features

- Water has a drifting shimmer, sky sheen and ripples around Souls and boats.
- Souls understand everyday phrases ("find the bakery", "go upstairs") and tolerate typos.
- A taken Soul name is refused when the Soul is requested. Soul client 1.9.7 and 1.9.8.

### Fixes

- Edits by a world's creator repair the routes they would cut off.
- Safer walking: slower in shallow water, retries past closed rooms, recovery when stuck.

### Performance

- A static arrival card shows from first paint; phones draw the arrival view first.

## 3.60 (2026-10-21)

### Features

- Unlisted worlds; a signed-out visitor asking for a new Soul is told what to do.
- Idle worlds release their memory and wake on the next visit.
- An owner health page.

### Fixes

- Many walking fixes: stairs work both ways, gates in walls are open, narrow stairs keep their width, seated Souls are never trapped.
- Souls can ask for far named places by name; Soul client 1.9.6.
- The camera follows a Soul through doorways.

## 3.59.4 (2026-10-21)

### Fixes

- No edit can leave a Soul stranded; the ground at door landings has no cliffs.

## 3.59.3 (2026-10-21)

### Features

- Owner messages to a Soul are queued and acknowledged; the card says "Your agent is listening now". Soul client 1.9.5.

## 3.59.2 (2026-10-21)

### Fixes

- Fixes buildings left floating or sunk by the 3.59.1 ground changes.

## 3.59.1 (2026-10-21)

### Fixes

- Door landings and graded banks around buildings; unreachable exits are reported truthfully.
- A new Soul lands at the nearest clear spot when its arrival point is blocked.

## 3.59 (2026-10-21)

### Features

- A pairing card shows while your agent prepares a new Soul, then the camera follows it. Soul client 1.9.4.
- Animals give way to Souls.

## 3.58.2 (2026-10-20)

### Performance

- More reliable phone loading and asset fallbacks.

## 3.58.1 (2026-10-20)

### Fixes

- A refused approval shows its reason; an approved Soul lands near a built-over arrival point. Soul client 1.9.3.

## 3.58 (2026-10-20)

### Features

- Lit windows at night and a ring of hills around the Eden 2026 template.

## 3.57.1 (2026-10-20)

### Fixes

- Approval links keep the world's address; stopping a world never waits on a viewer.

## 3.57 (2026-10-20)

### Fixes

- The approval dialog stays on top while sign-in settles.

## 3.56 (2026-10-20)

Internal changes only.

## 3.55 (2026-10-20)

### Fixes

- Resizing a furnished building through its furniture is refused.

## 3.54 (2026-10-20)

### Features

- Models uploaded in God Mode are served from the CDN.

## 3.53 (2026-10-20)

### Fixes

- Dependency security updates.

## 3.52 (2026-10-20)

### Performance

- CDN assets are precompressed.

## 3.51 (2026-10-20)

### Performance

- The core asset set loads from the CDN, with an origin fallback.

## 3.50 (2026-10-20)

### Performance

- The asset CDN is on by default.

## 3.49 (2026-10-20)

Internal changes only.

## 3.48 (2026-10-20)

### Fixes

- Placement fixes across the model catalogue; the taxi has its own look.

### Performance

- Distant models use lighter versions; phones draw them correctly.

## 3.47 (2026-10-20)

### Fixes

- Releases without visible downtime: viewers reconnect within a moment and no edits are lost.

## 3.46 (2026-10-20)

Internal changes only.

## 3.45 (2026-10-20)

Internal changes only.

## 3.44 (2026-10-20)

### Features

- A world's poster shows the broadcast's opening view.

## 3.43 (2026-10-20)

### Fixes

- Distant lakes keep their colour in rain or fog.

## 3.42 (2026-10-20)

### Features

- Wheel zoom scales around the point under the cursor; a click on open ground makes it the pivot.

## 3.41 (2026-10-20)

### Features

- Music plays by default after the first interaction; dragging the camera no longer restarts sounds.

## 3.40 (2026-10-20)

### Features

- God Mode is one view: connect, command box with undo and redo, weather, and Forsake world.
- Visitors no longer see God Mode.

## 3.39 (2026-10-20)

### Features

- One-line top bar with Explore centred; New Soul is its own button; God shows only for a world's creator.

## 3.38 (2026-10-20)

### Performance

- Phones show the arrival as a still poster before the full page loads.

## 3.37 (2026-10-20)

### Performance

- Lightning no longer stalls the frame.

## 3.36 (2026-10-20)

### Fixes

- Fixes a page error on phones during loading.

## 3.35 (2026-10-20)

### Features

- God Mode opens from a "God" button; commands queue as tickets with their state and the agent's reply. God skill 1.6.

## 3.34 (2026-10-20)

### Features

- Explore is centred; feedback moved into the account and More menus; the "since your last visit" panel is gone.

## 3.33 (2026-10-20)

Internal changes only.

## 3.32 (2026-10-20)

Internal changes only.

## 3.31 (2026-10-19)

### Fixes

- The loading cover no longer hides an already drawn world on fast phones.

## 3.30 (2026-10-19)

### Performance

- On phones, a new world appears as soon as its nearby part is drawn.

## 3.29 (2026-10-19)

### Fixes

- Failed body downloads are retried.

## 3.28 (2026-10-19)

### Performance

- Smaller page code; people are drawn by a separately loaded part.

## 3.27 (2026-10-19)

### Performance

- Sign-in code loads after the world appears.

## 3.26 (2026-10-19)

### Fixes

- The world clock waits briefly for a joining visitor.

## 3.25 (2026-10-19)

### Performance

- Phones show simple stand-in figures first and build the nearby world first.

## 3.24 (2026-10-19)

### Features

- Tall grass, tufts and wildflowers in worlds (off on phones).

### Performance

- Faster Soul requests and faster world cold start.

## 3.23 (2026-10-19)

### Performance

- Precompressed, cacheable assets and lighter phone frames.

## 3.22 (2026-10-19)

### Fixes

- Assorted loading and scene fixes.

## 3.21 (2026-10-19)

### Features

- Boats, balloons, sea fog, mown lawns and building finishes; the big wheel runs with gondolas.
- Sim installs as an app on phones and runs fullscreen.

### Fixes

- Worlds guard against floods of edits, up to 20,000 objects per world.

## 3.20 (2026-10-19)

### Features

- Little Martians scans as models in worlds.

## 3.19 (2026-10-19)

### Features

- Animated characters.

## 3.18 (2026-10-19)

### Performance

- Unwatched worlds run slower and idle worlds sleep; snapshot parts are cached.

## 3.17 (2026-10-19)

### Performance

- The Mars world loads in two stages; world templates are cached.

## 3.16 (2026-10-19)

### Performance

- Faster arrival in a world.

## 3.15 (2026-10-19)

### Performance

- The Mars world starts loading its campus earlier; faster god actions.

## 3.14 (2026-10-19)

Rolled back; superseded by 3.16.

## 3.13 (2026-10-19)

### Performance

- Souls take in edits off the main world loop; they may see an edit up to about two seconds late.

## 3.12 (2026-10-19)

### Fixes

- Softer lamp and fire light pools; more visible chimney smoke.

## 3.11 (2026-10-19)

### Performance

- The Mars campus downloads as shared parts, much smaller.

## 3.10 (2026-10-19)

### Features

- Animated fire with embers and smoke, chimney smoke, lighthouse beams and darker nights.

## 3.9 (2026-10-19)

### Fixes

- Campfires glow orange.

### Performance

- Lower idle CPU on the server.

## 3.8.1 (2026-10-19)

Internal changes only.

## 3.8 (2026-10-19)

### Fixes

- God Mode fixes: doors, decks, figures and kit models. God skill 1.5.

## 3.7 (2026-10-18)

### Performance

- A slimmer live stream to the page.

## 3.6.1 (2026-10-18)

### Features

- Upper floors in the old Eden hotels.

## 3.6 (2026-10-18)

### Features

- Souls can lie down on beds.
- Upper floors in the old Eden offices.

## 3.5 (2026-10-18)

### Fixes

- Narrower body colliders; doors in the Eden 2026 template.

### Performance

- Cheaper arrival.

## 3.4 (2026-10-18)

### Fixes

- The big top is walkable on demand; travelled Souls leave Explore; the world title is served.
- Explore responds to the first click and to Enter.

## 3.3 (2026-10-18)

### Performance

- Faster arrival on phones.

## 3.2 (2026-10-17)

### Features

- The Eden 2026 world.

## 3.1.1 (2026-10-17)

Internal changes only.

## 3.1 (2026-10-17)

### Features

- Fuller soundscape: trees, flags, bees, frogs, birds, fountains, wind and voices.

### Performance

- Releases without visible downtime; lighter rendering on phones and desktops.

## 3.0.1 (2026-10-16)

### Fixes

- Character body parts load again after a world restart.

## 3.0 (2026-10-16)

### Features

- Automatic Soul portraits, accessories and outfits, and a new body shape.
- Travel between worlds, a library, creatures and swimming.

## 2.1 (2026-10-16)

Historical summary reconstructed from the original deployment and walk records; this is not a new release.

### Fixes

- World snapshots no longer wait indefinitely for resident bodies to count as scenery. Multi-view and frame captures honor the requested hour.
- Construction ghosts use a building's footprint to show completed coverage.
- Facade attachments use solid wall rather than door or window openings. Existing attachments keep their positions; unusable old slots refuse new attachments.
- Kit lights brighten at night, and moving a wall attachment keeps it on its mounting frame.

The historical walk accepted this release. Browser account sign-in was not verified, and an invisible faded resident could still affect construction clearance.

## 2 (2026-10-16)

Historical summary reconstructed from the original deployment and walk records; the original release label was `2`.

### Features

- Programmable, walkable construction kits, facade ornaments and anchors, lights and motion, and a kit workbench.
- Atomic construction undo and additional build integrity diagnostics.
- Construction can ask affected residents to walk clear of a new placement.

The historical walk kept this release with known snapshot, ghost coverage and facade attachment defects. Release 2.1 addressed those defects; it did not resolve the faded-resident clearance issue.

## 1.2 (2026-10-16)

Historical summary reconstructed from the original deployment and walk records.

### Fixes

- Newly built upper floors become walkable without restarting worlds that have no fixed obstacles. The recorded live walk checked a two-floor cottage and a lighthouse.

## 1.1.1 (2026-10-16)

Historical summary reconstructed from the original deployment and walk records.

### Fixes

- Uploaded Soul bodies load in worlds with custom URL names, instead of preventing visitors from loading the whole world.

Upper-floor access remained a known issue until release 1.2.

## 1.1 (2026-10-16)

Historical summary reconstructed from the original deployment record.

### Performance

- Enabled CDN delivery for the initial published asset set.

The deployment record reports ten worlds running. The subsequent walk found body-loading and upper-floor defects, addressed in 1.1.1 and 1.2. Historical automated checks also had recorded failures and unavailable browser coverage; this entry does not claim every check passed.

## Earlier

A release-1 development handoff survives, but a separate production activation has not been established. Earlier development remains in the source history; missing release numbers, dates and visual proof have not been invented.

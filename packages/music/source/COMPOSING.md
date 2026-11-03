# Composing for sim-score

A Tone.js showcase of **code-driven music** in several genres. The brief from Gene:
*musically compelling, sophisticated, subtle, and well-crafted as though by a brilliant composer;
the kind of thing that would be nice background music to a simulation in the SimCity / Spore days*
(think SimCity 2000/3000/4, Spore, The Sims build mode, Brian Eno's generative work).

It is background music for a game you play for hours: it should reward attention but never demand it.
Restraint, space, good voice leading and a sense of slow development beat busyness every time.

## How a piece works

Read these first:

- `site/engine/theory.js`: note helpers, chord-symbol parser (`T.chord("Abmaj9#11")` gives pcs, guide tones, colors and chord scale), `T.voice()` voice-leading voicing chooser, `T.progression("| Fm9 | Bb13 |")`, seeded `rng` (`r.pick`, `r.chance`, `r.weighted`, `r.gauss`, `r.fork`).
- `site/engine/compose.js`: `C.line()`, a melodic line generator (chord-tone anchors on strong beats, scale/chromatic fills, motif reuse) and `C.at(absBeat, beatsPerBar)`.
- `site/engine/instruments.js`: the synth orchestra (rhodes, softPiano, organ, vibes, marimba, kalimba, glock, bell, nylon, harp, pizz, upright, ebass, sub, analog, pad, glassPad, strings, synthBrass, flute, clarinet, oboe, mutedTrumpet, whistle, kit with many voices) and routing helpers (`I.reverb`, `I.delay`, `I.send`, `I.place`). **Levels are calibrated**: `volume: 0` is the same loudness for every instrument, so volumes are a real mix.
- `site/engine/more-instruments.js`: the second half of the orchestra (see "Round 3" below for the list).
- `site/engine/conductor.js`: the `Sim.register({...})` contract (documented at the top) and how events are scheduled: swing, humanization and layer muting are handled for you.
- `site/pieces/zoning-board.js`: the reference piece (lounge jazz). Match its level of care.

The conductor calls `compose({ cycle, rng, state, T })` once per cycle (`cycleBars` bars), one bar before
that cycle plays, forever. Use `state` to carry form position, motifs, the last voicing, loop phases, and
so on across cycles, so the music develops over minutes: sections, returns, variations and an arc. Don't
just loop. A listener who stays ten minutes should notice it breathing and changing; one who glances in
should hear something coherent.

Events: `{ track, bar, beat, dur, note, vel, ...extra }`. `bar` is within the cycle (it may be -1 for a pickup),
`beat` is within the bar and `dur` is in beats. `note` is a midi number, an array of them (a chord), or for drums whatever your
track's `play` expects (e.g. a kit voice name). Return `harmony: [{bar, beat, dur, chord}]` so the UI can
show the current chord and the linter can check your notes against it. Return a short `section` label
(e.g. "Chorus 2 · bridge", "Phase 3 · strings enter"), which the UI displays.

## Rules

- Write **only** `site/pieces/<id>.js` (the filename must be the piece id). Don't edit the engine or other
  pieces. If you need an instrument the library lacks, build it inside your file with `Tone` and register every
  node with `ctx.keep(node)`. If you find an engine bug, work around it and **report it** in your final message.
- `compose()` must be deterministic from the given `rng` (never `Math.random`) and fast (a few ms).
- Original music only: evoke the style, never quote real tunes or game themes.
- Layers are `melody`, `harmony`, `bass`, `drums`, `texture`. Every track belongs to one (the UI has mute toggles).
- Time signatures: set `beatsPerBar` (3 for 3/4; for 6/8 or 12/8 use quarter-note beats, e.g. 3 or 6, and think in
  eighths of 0.5). `swing` is the offbeat position (0.5 straight, about 0.6 for a relaxed swing); `swingUnit: 0.25` swings 16ths.

## Craft checklist (what "brilliant composer" means here)

- **Harmony:** idiomatic to the genre, with real color (extensions, modal mixture, pedal points, secondary dominants,
  planing, deceptive cadences) used with intent. Voice-lead every chord change (`T.voice` with `prev`). No muddy
  close intervals below E3.
- **Melody:** singable shapes, motifs that return and develop (sequence, inversion, rhythmic displacement),
  phrases that breathe, cadences that land. Chord tones on strong beats unless it's a deliberate appoggiatura.
- **Orchestration:** idiomatic ranges (flute C4–C7, clarinet D3–Bb6, vibes F3–F6, marimba A2–C7, upright E1–G3,
  cello-ish strings C2–A5, kalimba C4–E6), register separation between parts, at most one busy part at a time.
- **Rhythm and feel:** a groove with a pocket, and humanize where it helps (`humanize: {timing, vel}` per track). Velocity
  shaping and accents. Ghost notes. Fills that mark form, used sparingly.
- **Form and arc:** sections, entrances and exits, a longer arc (e.g. a 4–6 minute cycle of density) and variation on return.
- **Mix:** a balanced, spacious mix. Use reverb and delay as sends (`I.reverb` plus `I.send`), place parts in stereo with
  `I.place`, give the melody about 0 dB, harmony about -4 to -8, bass about -3 to -6, drums to taste. Use filters to keep parts
  out of each other's way. Gene will normalize overall loudness later, so balance within the piece is what matters.

## Self-check (you cannot listen, so read)

- `node tools/lint.mjs <id> --verbose --cycles 32` loads your piece against a strict Tone mock (it catches typos and
  runtime errors) and reports per-track range, % of notes in the chord scale, % chord tones on strong beats, max leap,
  density and MUDDY low voicings. Fix all `!` problems and every MUDDY flag.
- `node tools/score.mjs <id> --cycles 2 [--from N] [--tracks a,b]` prints the music bar by bar. **Read it like a score**
  and critique it as a composer: clashing simultaneities, awkward leaps, parallel octaves between outer voices where they
  matter, dull repetition, unidiomatic ranges, a bass that fights the chord, phrases that never land. Iterate until you'd sign it.

## Lessons from the first eight pieces (read these)

- **You are one of several composers working in this folder at the same time.** Touch only your own file. Don't run
  git commands that change anything (no add, commit, checkout or stash). A broken file from someone else does
  not affect `node tools/lint.mjs <your-id>`, which loads only your piece.
- **Custom monophonic sources** (your own NoiseSynth, MonoSynth, MembraneSynth, PluckSynth…) must never get a
  trigger time that is earlier than, or equal to, their previous one, or one in the past (Tone clamps past
  times to "now", so two triggers can collide and throw). Wrap them: `const safe = I.monotonic(node);` then
  `synth.triggerAttackRelease(f, d, safe(t), v)`. The library instruments already do this.
- **Never let NaN reach an audio parameter** (e.g. `e.note - 12` when `note` is an array). One NaN into a
  reverb or delay silences the piece permanently.
- `T.voice(sym, {omitBass: true})` leaves a slash chord's bass to the bass player; `n` is capped at the
  chord's distinct notes (no unisons); sus chords keep their root. Inner semitones are penalised; still
  check your voicings in the score printout.
- Humanize timing is symmetric (notes can land a little early or late); `delay` on an event pushes it later.
- For compound meters, set `strongBeats: [0, 1.5, 3, 4.5]` (positions within the bar) so the linter's
  strong-beat statistics measure the real pulse.
- `node tools/lint.mjs <id> --seed N` and `node tools/score.mjs <id> --seed N` check other performances.
  Lint at least three seeds and `--cycles 96`.
- Levels: aim for the balance described above; Gene's session normalizes overall loudness afterwards, so
  leave `gainDb: 0`.
- **A second piece in a genre** must be clearly its own thing: read the existing piece in that genre first,
  then choose a contrasting tempo, key/mode, form, lead instrument and technique.

## Round 3 brief: the houseband (read this if you are writing a new piece now)

Gene's feedback on the first 24: good, but **too polite**. He wants music that is **more adventurous** and
has **a lot more percussion** (most pieces had little or none). His touchstones: SimCity, Tetris, Brian Eno,
F-Zero, the Karate Kid soundtrack, Knight Rider, disco and its subgenres, vaporwave.

The showcase is becoming a **houseband for a Second Life / Sims-style world**: when people in the world are
hanging out, partying, fighting, sitting at a campfire, sleeping or giving a presentation, the band plays
something that fits. So every new piece declares what it is for:

```js
situations: ["party", "hangout"],   // 1-3 from the list below, best fit first
energy: 0.8,                        // 0 = asleep ... 1 = boss fight / peak-time dancefloor
```

| situation | what is happening |
|---|---|
| `hangout` | chatting, lounging, a café or a backyard |
| `party` | dancing, club, house party |
| `fight` | combat, battle, a boss |
| `chase` | racing, pursuit, driving fast, action |
| `campfire` | outdoors at night, cozy, storytelling |
| `sleep` | resting, night, winding down |
| `presentation` | keynotes, meetings, a waiting room, the lobby |
| `work` | building, crafting, studying, focus |
| `explore` | travel, wandering, discovery |
| `shopping` | mall, market, browsing |
| `romance` | a date, dinner, slow dance |
| `mystery` | sneaking, investigation, suspense |
| `training` | workout, sports, a training montage |
| `celebrate` | ceremony, festival, awards, a win |

What that means for the writing:

- **Get to the point.** A houseband piece is cued in the middle of a scene: establish the groove and the
  identity of the piece within the first 4-8 bars (a short intro or a drum pickup is fine; a 30-second
  ambient fade-in is not, except for `sleep` pieces). Then develop over minutes as before: sections,
  breakdowns, builds, drops, key changes, solos, returns. Avoid a single loop.
- **Percussion is a first-class part** wherever the genre has it: real drum programming with a pocket,
  ghost notes, open hats, fills at section ends, crashes on arrivals, and an auxiliary percussion layer
  (shaker, tambourine, congas, cowbell, claps…) that comes and goes with the form. Program like a session
  drummer or a drum-machine programmer of the genre would (909 four-on-the-floor with offbeat open hats for
  house; 808 cowbell and claps for Italo; gated snare and Simmons fills for 1984; one-drop for reggae; a
  bell timeline for Afrobeat; batucada for samba). Build drum parts across the form: drop them for a
  breakdown, bring them back with a fill.
- **Adventurous** means harmonic and formal surprise in the genre's own language: modulations up a step
  for the last chorus, chromatic mediants, a breakdown to just drums and bass, a filter build, a
  half-time section, call-and-response between sections, a solo that develops. Taste still rules:
  background music for hours, but with an edge.
- **Original music only.** Evoke the touchstones; never quote a real tune (no Korobeiniki, no Knight Rider
  theme, no Mute City).

### New in the engine

- `compose()` may return `tempo: { bpm, rampBeats }` to change tempo at the start of that cycle (a puzzle
  game that speeds up level by level, a final lap, a ritardando into a breakdown).
- Kit voices (all in `I.kit`; `hit(voice, time, vel, { pitch, dur })`): the originals (kick, softKick, snare,
  rim, brushTap, brushSweep, hatClosed, hatOpen, hatPedal, ride, shaker, conga, congaLow, bongo, clave,
  woodblock, tom, cajon, snap) plus **drum machines** kick808 (pitch = settling note, ~29), kick909, snare808,
  clap, gatedSnare (`dur` = gate length), rockSnare, simmons (pitch), cowbell (808), hat808, hat808Open,
  tambourine, crash, triangle; **Latin/Brazilian** timbale (pitch 74 high / 67 low), agogo (86 / 81), surdo
  (`dur` < 0.15 = muted), tamborim, caixa, guiro (`dur` = scrape length); **Japanese** taiko (pitch ~36),
  shime, kachi; **Middle Eastern / West African** dum, tek (darbuka), djembe (pitch < 50 bass, 50-64 tone,
  > 64 slap), shekere, gankogui (bell, 84 / 77); **chip** chipNoise (`dur` short = hat, long = snare).
- Instruments: `I.slapBass` (play extra `art`: "thumb" | "pop" | "ghost" | "finger"), `I.acid` (303; play
  extra `{slide, accent}`, `.sweep(time, cutoff, secs)`), `I.fmBass`, `I.pluck`, `I.supersaw`, `I.pulse`
  (chiptune: `width` 0 / 0.5 / 0.75 duty, `wave: "triangle"`, `bits`), `I.stringMachine`, `I.choir`
  (`vowel`), `I.orchHit`, `I.brassStab`, `I.lead` (mono lead with glide and delayed vibrato), `I.distGuitar`,
  `I.guitar` (`kind`: "steel" | "clean" | "muted", play extra `strum` seconds, `chorus`), `I.koto`,
  `I.steelDrum`, `I.sax`, `I.shakuhachi`, `I.harmonica`, `I.pedalSteel`, `I.accordion` (`melodica: true`).
- Effects: `I.pump(ctx, dest, {depth, release})` → `{ input, duck(time) }` sidechain (call `duck` from your
  kick track's play), `I.tape(ctx, dest, {wow, flutter, cutoff, drive})` → input node, `I.gatedReverb(ctx,
  dest)`, `I.vinyl(ctx, dest, {level, crackle})` crackle bed. Tone's own `Tone.AutoFilter`, `Tone.Phaser`,
  `Tone.BitCrusher`, `Tone.Distortion`, `Tone.FrequencyShifter`, `Tone.PitchShift` are fine too.
- All new instruments are level-calibrated like the old ones.

## Round 4 method (October 2026): read this before writing a new piece

Gene's verdict on rounds 1–3: competent, diverse, but bland, "lacking a je ne sais quoi", and later "all a bit of a
formula: melody, harmony, texture, drums, bass". The 32 pieces in the catalog's **New pieces** family answer that.
The method:

- **Write the hook by hand.** Fixed midi notes and rhythms, in a comment at the top of the file, that you would defend.
  Never generate the tune with `C.line()`; the classics are built on one specific idea, and a generator gives you
  the average of all plausible tunes.
- **Build your own palette.** Two or three characterful patches in your file (registered with `ctx.keep`), not just
  the shared orchestra.
- **A finite composed lap** (1:00–2:30) where the generator varies arrangement, fills, density and ornament, never
  the melody.
- **Revise from the printout.** Lint three seeds at `--cycles 96`, read `tools/score.mjs` like a score, revise at
  least three times.
- **Game music sits in the room.** Gene: "orbital survey has the right ambience for a game while terraform is trying
  to be listened to too much (maybe because its pace is a bit higher)". Pace, density and how often the hook insists
  are the levers. Allowed to demand attention, but not obviously; smart, not loud; never avant-garde.

### Engine modules (optional; a piece that doesn't call one is unaffected)

Loaded after `conductor.js` by every page and by `tools/load.mjs`. Read each file's header for the full API.

| Module | Namespace | What it adds | Demo piece |
|---|---|---|---|
| `engine/phrasing.js` | `Sim.phrasing` | A note notation with articulation marks (glide, staccato, accent, scoop, fall, bend, late vibrato, breath) and an instrument wrapper that realizes them | `night-approach` |
| `engine/spc.js` | `Sim.spc` | A SNES-style chip: a voice budget with priority and note stealing, a lo-fi output stage, the SPC echo with per-voice sends, chip voices | `headland` |
| `engine/dialogue.js` | `Sim.dialogue` | One tune distributed across instruments (phrase, hocket, handoff, interval), call-and-response, register sharing | `evening-rounds` |
| `engine/groove.js` | `Sim.groove` | Per-track groove templates, rubato for a lead over a band in time, tempo gestures (ritardando, fermata, lift), accent and ghost rules | `velour` |

The conductor also gained `play(piece, {seed, cycle})`: starting at a later cycle composes the skipped cycles
silently first, so the piece's memory is what it would have been. The browser's seek slider uses it.

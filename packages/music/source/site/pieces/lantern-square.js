// Lantern Square: a festival evening in the town square. G major, 100 bpm, a lilting 4/4.
//
// The lanterns are up, people mill about with paper cups, and a small band plays in the corner: a
// clarinet, an accordion, a mandolin, a plucked bass, a hand drummer with a djembe, a tambourine and a
// bass drum on the big beats. The tune is a dance (a swung two-step lilt, long-short) that the band
// passes around (Sim.dialogue): a phrase each, mid-phrase handoffs on the long notes, fragments answered
// in the rests on the quieter laps. The harmony is bright and plain with one borrowed chord that keeps
// coming back (Cm6, the iv) and a secondary dominant that pulls the tune up to G#. Then a trio in the
// relative minor where the dancing slows (Sim.groove tempo script: a ritardando to 92), the clarinet
// sings over mandolin-less guitar arpeggios and a held accordion, and the band comes back for one
// full statement at 103 with the mandolin tremolo, claps, a crash and a bVI-bVII lift (Eb F G), before
// dropping straight back to the corner band and the vamp. Sim.phrasing gives the clarinet its grace
// notes, scoops and slurs (and the accordion and mandolin their crushed graces).
//
// THE TUNE (fixed by hand; the generator never changes a note, only who plays it and how)
//   A (8 bars): | G6 | G/B | Cadd9 | D7 | G | E7 | Am7 D7 | G |
//     pickup D5
//     bar 1  B4 D5 G5 F#5 E5        a rising lilt up the chord, a turn at the top (the head)
//     bar 2  D5 . . B4 C5 D5        settles on the 5th, walks back up
//     bar 3  E5 D5 C5 E5 G5         the head's shape on IV
//     bar 4  F#5 E5 D5 .  (D5)      on V, a breath, the pickup again
//     bar 5  B4 D5 G5 A5 B5         the head, climbing higher
//     bar 6  G#5 E5 D5 B4           the surprise: V/ii, G# in the tune
//     bar 7  C5 E5 D5 C5 B4 A4      ii-V, stepping down
//     bar 8  G4 B4 A4 G4            home, the head's turn in miniature
//   B (8 bars, the answer strain): | Cadd9 | Cm6 | G/D | Em7 | Am7 | Bm7 | Cmaj7 Cm6 | D7sus4 D7 |
//     E5 G5 A5 G5 | Eb5 G5 A5 G5 (the same shape, the third flattened: the borrowed iv) | D5 B4 D5 G5 |
//     E5 D5 B4 A4 | C5 E5 A5 G5 | F#5 D5 B4 D5 | E5 G5 Eb5 C5 (the sigh) | D5 C5 A4 .
//   Trio in E minor (16 bars): | Em9 | Em/D | Cmaj7 | B7 | Em | Am7 | Cmaj7 B7 | Em |
//                              | Em9 | Em/D | Cmaj7 | B7 | Am7 | Em/G | F#m7b5 B7 | Em D7 |
//     B4 . E5 F#5 | G5 . . F#5 | E5 D5 C5 . | D#5 . F#5 B4 | B4 E5 G5 . | A5 G5 E5 C5 | B4 D5 D#5 F#5 | E5 . . .
//     (second half the same to bar 12, then) C5 E5 A5 . | G5 F#5 E5 B4 | A4 C5 D#5 F#5 | E5 . . (D5)
//   Full band A: bars 1-6 as A, then | Eb F | G |: Eb5 G5 Bb5 F5 A5 C6 | G5 . . .
//   One lap: vamp 4 · A 8 · A 8 (or fragments) · B 8 · trio 16 · full A 8 · drop-back 4 = 56 bars ≈ 2:15.
//   Laps rotate who takes which phrase, the join style, the answers and the fills.
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue, P = Sim.phrasing, G = Sim.groove;
  const { mod12 } = T;
  const BPB = 4, CB = 4, BPM = 100;
  const N = T.midi;

  // ---------- notation: phrases of "Note at dur [art], ..." (at in beats from the section start) ----------
  function line(phraseTexts, k = 0) {
    const out = [];
    phraseTexts.forEach((txt, pi) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => {
        const [n, b, d, art] = tok.trim().split(/\s+/);
        const o = { at: +b, dur: +d, note: N(n) + k, phrase: pi };
        if (art) o.art = art;
        out.push(o);
      });
    });
    return out;
  }

  // ---------- the score ----------
  const INTRO_CH = "| G | G | Cadd9 | D7sus4 |";
  const A_CH = "| G6 | G/B | Cadd9 | D7 | G | E7 | Am7 D7 | G |";
  const A2_CH = "| G6 | G/B | Cadd9 | D7 | G | E7 | Am7 D7 | G D7 |";
  const B_CH = "| Cadd9 | Cm6 | G/D | Em7 | Am7 | Bm7 | Cmaj7 Cm6 | D7sus4 D7 |";
  const T1_CH = "| Em9 | Em/D | Cmaj7 | B7 | Em | Am7 | Cmaj7 B7 | Em |";
  const T2_CH = "| Em9 | Em/D | Cmaj7 | B7 | Am7 | Em/G | F#m7b5 B7 | Em D7 |";
  const FA_CH = "| G6 | G/B | Cadd9 | D7 | G | E7 | Eb F | G |";
  const TAG_CH = "| G | Cm6 | G/D D7 | G |";

  const A_P = [
    "D5 -0.5 .5, B4 0 1.5, D5 1.5 .5, G5 2 1 g, F#5 3 .5, E5 3.5 .5 ~, D5 4 2, B4 6 .5, C5 6.5 .5, D5 7 1",
    "E5 8 1.5, D5 9.5 .5, C5 10 1, E5 11 .5, G5 11.5 .5 ~, F#5 12 1.5, E5 13.5 .5, D5 14 1",
    "D5 15.5 .5, B4 16 1.5, D5 17.5 .5, G5 18 1 g, A5 19 .5, B5 19.5 .5 ~, G#5 20 1.5 ^1, E5 21.5 .5, D5 22 1, B4 23 1",
    "C5 24 1, E5 25 .5, D5 25.5 .5 ~, C5 26 .5, B4 26.5 .5, A4 27 1, G4 28 1, B4 29 .5, A4 29.5 .5 ~, G4 30 1",
  ];
  const A_TUNE = line(A_P);
  const HEAD = A_TUNE.filter((n) => n.phrase === 0);
  const CLIMB = A_TUNE.filter((n) => n.phrase === 2);
  const FA_TUNE = line(A_P.slice(0, 3).concat(["Eb5 24 .5, G5 24.5 .5, Bb5 25 1 >, F5 26 .5, A5 26.5 .5, C6 27 1 >, G5 28 3 f2"]));

  const B_TUNE = line([
    "E5 0 1.5, G5 1.5 .5, A5 2 1, G5 3 1, Eb5 4 1.5 g, G5 5.5 .5, A5 6 1, G5 7 1",
    "D5 8 1, B4 9 .5, D5 9.5 .5, G5 10 2, E5 12 1.5, D5 13.5 .5, B4 14 1, A4 15 1",
    "C5 16 1.5, E5 17.5 .5, A5 18 1, G5 19 1, F#5 20 1.5, D5 21.5 .5, B4 22 1, D5 23 1",
    "E5 24 1, G5 25 1, Eb5 26 1 g, C5 27 1, D5 28 1.5, C5 29.5 .5, A4 30 1",
  ]);
  const T1_TUNE = line([
    "B4 0 2, E5 2 1, F#5 3 1 ~, G5 4 3, F#5 7 1 ~",
    "E5 8 1.5, D5 9.5 .5 ~, C5 10 2, D#5 12 2 ^1, F#5 14 1, B4 15 1",
    "B4 16 1, E5 17 1, G5 18 2, A5 20 1.5, G5 21.5 .5 ~, E5 22 1, C5 23 1",
    "B4 24 1, D5 25 1, D#5 26 1, F#5 27 1, E5 28 3",
  ]);
  const T2_TUNE = line([
    "B4 0 2, E5 2 1, F#5 3 1 ~, G5 4 3, F#5 7 1 ~",
    "E5 8 1.5, D5 9.5 .5 ~, C5 10 2, D#5 12 2 ^1, F#5 14 1, B4 15 1",
    "C5 16 1, E5 17 1, A5 18 2, G5 20 1.5, F#5 21.5 .5 ~, E5 22 1, B4 23 1",
    "A4 24 1, C5 25 1, D#5 26 1, F#5 27 1, E5 28 2",
  ]);

  const LAP = [
    { id: "intro", bars: 4, ch: INTRO_CH },
    { id: "A1", bars: 8, ch: A_CH },
    { id: "A2", bars: 8, ch: A2_CH },
    { id: "B", bars: 8, ch: B_CH },
    { id: "T1", bars: 8, ch: T1_CH },
    { id: "T2", bars: 8, ch: T2_CH },
    { id: "FA", bars: 8, ch: FA_CH },
    { id: "tag", bars: 4, ch: TAG_CH },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i];
    return { lap, i, f, off: bar, first: bar === 0, last: bar + CB >= f.bars, cl: cycle % LAP_CYCLES };
  }
  // the dancing slows for the trio, the band comes back a touch brighter, the drop-back settles
  const tempoAt = G.tempoScript(BPM, [
    { at: 7, bpm: 92, rampBeats: 8, hold: true },
    { at: 11, bpm: 103, rampBeats: 4, hold: true },
    { at: 13, bpm: BPM, rampBeats: 6, hold: true },
  ]);

  // ---------- voices ----------
  const RANGE = { clar: [55, 86], accMel: [57, 88], mand: [55, 88] };
  const VOICE = {
    clar: { track: "clar", range: RANGE.clar, gain: 1 },
    accMel: { track: "accMel", range: RANGE.accMel, gain: 0.92 },
    mand: { track: "mand", range: RANGE.mand, gain: 0.88 },
  };
  const V = (...names) => names.map((n) => VOICE[n]);
  /** Velocity contour: a little louder up high, a lean on downbeats. */
  function shape(notes, base) {
    const lo = Math.min(...notes.map((n) => n.note)), span = Math.max(1, Math.max(...notes.map((n) => n.note)) - lo);
    return notes.map((n) => ({ ...n, vel: base + 0.07 * (n.note - lo) / span + (((n.at % BPB) + BPB) % BPB === 0 ? 0.03 : 0) }));
  }
  const withBar = (n) => { const bar = Math.floor(n.at / BPB + 1e-9); return { ...n, bar, beat: +(n.at - bar * BPB).toFixed(4) }; };

  /** Articulate one track's notes of a section as a monophonic line (phrase marks from the `phrase` ids). */
  function articulateTrack(notes, track, o) {
    const mine = notes.filter((n) => n.track === track), rest = notes.filter((n) => n.track !== track);
    if (!mine.length) return rest;
    const evs = mine.map((n) => withBar({ ...n, dur0: n.dur }));
    const spans = new Map();
    for (const e of evs) {
      const k = e.phrase ?? 0;
      const m = spans.get(k) || { from: e.at, to: e.at + e.dur };
      m.from = Math.min(m.from, e.at); m.to = Math.max(m.to, e.at + e.dur);
      spans.set(k, m);
    }
    const marks = [...spans.values()].map((m) => ({ from: m.from, to: m.to + 1e-6, dyn: "arch", legato: !!o.legato, breath: true }));
    const out = P.articulate(evs, marks, { beatsPerBar: BPB, scale: (pos) => o.scaleAt(pos), lengthen: o.lengthen ?? 1.08, breathLate: 0.03, breathGap: 0.12, breathFirst: true, glide: o.glide ?? 0.04 });
    // a note that hands the line to another player is not the end of a phrase: no agogic lengthening
    return rest.concat(out.map((e) => { const { dur0, ...x } = e; return { ...x, at: e.bar * BPB + e.beat, dur: e.handoff ? Math.min(e.dur, dur0) : e.dur }; }));
  }

  /** A diatonic third below the tune (a fourth when the third is not a chord tone). */
  function thirdBelow(n, chordAt) {
    const c = T.chord(chordAt(Math.max(0, n.at)).chord);
    const a = T.step(n.note, -2, c.scale);
    if (c.pcs.includes(mod12(a))) return a;
    const b = T.step(n.note, -3, c.scale);
    return c.pcs.includes(mod12(b)) ? b : a;
  }

  /** Everything hand-written for one section of one lap, routed to tracks (at = beats from the section start). */
  function planSection(f, lap, r) {
    const prog = T.progression(f.ch, BPB);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.max(0, Math.min(b, f.bars * BPB - 0.01))).chord).scale;
    const L = lap % 3;
    let notes = [];
    let label = "";
    const orn = Math.min(0.5, 0.15 + 0.12 * lap); // graces get more frequent as the night goes on
    const ans = (call, o) => D.answer(call, { scaleAt, bpb: BPB, ...o });
    if (f.id === "intro") {
      label = lap === 0 ? "the square · hand drum, then the band settles in" : "vamp · the band in the corner";
    } else if (f.id === "A1") {
      const tune = shape(A_TUNE, 0.66);
      if (L === 0) {
        notes.push(...D.distribute(tune, { voices: V("clar", "accMel"), mode: "handoff", join: "extend", overlap: 0.25, handoffDur: 1.5, minNotes: 3, stay: 0.35, rng: r, bpb: BPB }));
        label = "the tune · clarinet and accordion trade it on the long notes";
      } else if (L === 1) {
        const order = ["clar", "mand", "accMel", "clar"];
        notes.push(...D.distribute(tune, { voices: V("clar", "mand", "accMel"), mode: "phrase", order, rng: r, bpb: BPB }));
        label = "the tune · a phrase each: clarinet, mandolin, accordion, clarinet";
      } else {
        notes.push(...D.distribute(tune, { voices: V("accMel", "mand", "clar"), mode: "handoff", join: "double", overlap: 0.3, handoffDur: 1.5, minNotes: 3, stay: 0.3, rng: r, bpb: BPB }));
        label = "the tune · accordion leads, handed off and doubled at the joins";
      }
    } else if (f.id === "A2") {
      if (L === 0) {
        const tune = shape(A_TUNE, 0.64);
        const order = ["accMel", "clar", "mand", "accMel"];
        notes.push(...D.distribute(tune, { voices: V("accMel", "clar", "mand"), mode: "phrase", order, rng: r, bpb: BPB }));
        label = "the tune again · accordion, clarinet, mandolin, accordion";
      } else {
        // fragments: the mandolin plays the head, the clarinet answers; the accordion plays the climb, the mandolin answers
        const head = shape(HEAD, 0.56), climb = shape(CLIMB, 0.6);
        notes.push(...head.map((n) => ({ ...n, track: "mand" })));
        notes.push(...ans(head, { track: "clar", transform: L === 1 ? { steps: 2 } : { invert: true, truncate: 6 }, at: 7.5, before: 15.5, range: RANGE.clar, vel: 0.58, breath: 0.3 }).map((n) => ({ ...n, phrase: 11 })));
        notes.push(...climb.map((n) => ({ ...n, track: "accMel" })));
        notes.push(...ans(climb, { track: "mand", transform: L === 1 ? { retrograde: true, truncate: 7 } : { steps: -2, truncate: 7 }, at: 23.5, before: 31.5, range: RANGE.mand, vel: 0.52, breath: 0.3 }).map((n) => ({ ...n, phrase: 13 })));
        label = "fragments · the mandolin's head answered by the clarinet, the accordion's climb answered by the mandolin";
      }
    } else if (f.id === "B") {
      const tune = shape(B_TUNE, 0.62);
      const who = L === 2 ? "clar" : "accMel";
      notes.push(...tune.map((n) => ({ ...n, track: who })));
      // the mandolin shadows the borrowed-iv bars (a soft tremolo on the flattened third)
      notes.push(...tune.filter((n) => (n.at >= 4 && n.at < 8) || (n.at >= 26 && n.at < 28)).map((n) => ({ ...n, track: "mand", vel: n.vel - 0.18, art: undefined, phrase: 20 + Math.floor(n.at / 8) })));
      label = `the answer strain · ${who === "clar" ? "clarinet" : "accordion"} · the borrowed iv, twice`;
    } else if (f.id === "T1") {
      const tune = shape(T1_TUNE, 0.6);
      if (L === 1) {
        notes.push(...D.distribute(tune, { voices: V("clar", "accMel"), mode: "handoff", join: "extend", overlap: 0.3, handoffDur: 2, minNotes: 3, stay: 0.4, rng: r, bpb: BPB }));
        label = "trio in E minor · the dancing slows · clarinet and accordion share the song";
      } else {
        notes.push(...tune.map((n) => ({ ...n, track: "clar" })));
        label = "trio in E minor · the dancing slows · the clarinet sings";
      }
    } else if (f.id === "T2") {
      const tune = shape(T2_TUNE, 0.6);
      if (L === 0) {
        notes.push(...D.distribute(tune, { voices: V("clar", "accMel"), mode: "handoff", join: "extend", overlap: 0.3, handoffDur: 2, minNotes: 3, stay: 0.4, rng: r, bpb: BPB }));
        label = "trio · handed between clarinet and accordion";
      } else if (L === 1) {
        notes.push(...D.distribute(tune, { voices: V("accMel", "mand"), mode: "handoff", join: "double", overlap: 0.3, handoffDur: 2, minNotes: 3, stay: 0.4, rng: r, bpb: BPB }));
        label = "trio · accordion and mandolin tremolo";
      } else {
        notes.push(...D.distribute(tune, { voices: V("clar", "accMel", "mand"), mode: "phrase", order: ["clar", "accMel", "mand", "clar"], rng: r, bpb: BPB }));
        label = "trio · a phrase each, the clarinet closes it";
      }
    } else if (f.id === "FA") {
      const tune = shape(FA_TUNE, 0.76);
      notes.push(...tune.map((n) => ({ ...n, track: "clar" })));
      notes.push(...tune.map((n) => ({ ...n, track: "accMel", note: thirdBelow(n, chordAt), vel: n.vel - 0.1, art: n.art === "f2" ? undefined : n.art })));
      notes.push(...tune.map((n) => ({ ...n, track: "mand", vel: n.vel - 0.14, art: undefined, trem: true })));
      label = "the whole band · the tune in thirds, mandolin tremolo, claps · the Eb-F-G lift";
    } else { // tag: the drop-back
      if (L === 0) {
        notes.push(...shape(HEAD, 0.48).map((n) => ({ ...n, track: "mand" })));
        label = "drop back · the mandolin remembers the head";
      } else if (L === 1) {
        notes.push(...ans(HEAD, { track: "clar", transform: { augment: 2 }, at: 0, before: 16.4, range: RANGE.clar, vel: 0.5, breath: 0.3 }).map((n) => ({ ...n, phrase: 30 })));
        label = "drop back · the clarinet plays the head at half speed";
      } else label = "drop back · hand drum and the bass, people talking";
    }
    // ornaments: a crushed grace on some entrances (the clarinet's scale step below; the others' too)
    notes = notes.map((n) => {
      if (n.art || n.answer || n.dur < 1 || n.at < 0) return n;
      const entrance = n.entrance || (((n.at % BPB) + BPB) % BPB === 0 && n.dur >= 1.5);
      return entrance && r.chance(orn) ? { ...n, art: "g" } : n;
    });
    const lyrical = f.id === "T1" || f.id === "T2";
    notes = articulateTrack(notes, "clar", { scaleAt, legato: lyrical, lengthen: lyrical ? 1.12 : 1.06, glide: lyrical ? 0.06 : 0.035 });
    notes = articulateTrack(notes, "accMel", { scaleAt, legato: false, lengthen: 1.04 });
    notes = articulateTrack(notes, "mand", { scaleAt, legato: false, lengthen: 1 });
    return { prog, notes, label };
  }

  // ---------- percussion vocabulary ----------
  const DJ = { bass: 45, tone: 58, slap: 70 };
  const FILLS = [
    [[3, "slap", 0.4], [3.25, "tone", 0.34], [3.5, "slap", 0.46], [3.75, "tone", 0.4]],
    [[2.5, "tone", 0.34], [3, "slap", 0.42], [3.5, "slap", 0.48], [3.75, "tone", 0.38]],
    [[3, "tone", 0.34], [3.25, "tone", 0.36], [3.5, "slap", 0.44], [3.75, "slap", 0.5]],
  ];

  Sim.register({
    id: "lantern-square",
    title: "Lantern Square",
    genre: "Festival band",
    about: "A festival evening in the town square: a corner band (clarinet, accordion, mandolin, plucked bass, djembe, tambourine and a bass drum on the big beats) passes a lilting G-major dance tune around, with a borrowed iv that keeps returning and a V/ii surprise; a trio in E minor where the dancing slows, one joyful full-band statement with mandolin tremolo, claps and an Eb-F-G lift, then straight back to the small band. Celebration you can still talk over.",
    situations: ["celebrate", "hangout"],
    energy: 0.55,
    bpm: BPM, beatsPerBar: BPB, swing: 0.58, swingUnit: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const square = I.reverb(ctx, out, { decay: 2.1, preDelay: 0.018, lowcut: 300, highcut: 6500 }); // open air, the buildings around
      const hall = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.03, lowcut: 350, highcut: 5500 });
      const slap = I.delay(ctx, out, { time: "8n", feedback: 0.12, highcut: 2800 });

      // clarinet: a hollow-square spectrum with a soft lowpass, breath, a late slight vibrato, through the phrasing wrapper
      const clLp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12, Q: 0.6 }));
      const clS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.04, 0.55, 0.03, 0.3, 0.02, 0.14, 0.01, 0.06] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.82, release: 0.2 },
        filterEnvelope: { attack: 0.06, decay: 0.3, sustain: 0.7, release: 0.3, baseFrequency: 600, octaves: 2.2 },
      })).connect(clLp);
      const clar = P.wrap(ctx, { synth: clS, out: clLp }, {
        volume: -9, glide: 0.035, scoopTime: 0.08, fallTime: 0.22, release: 0.2, staccatoRelease: 0.06,
        vibrato: { rate: 5.0, depth: 0.045, delay: 0.45, rise: 0.4, deepen: 1.2 },
        breath: P.breath(ctx, square, { level: -30, freq: 2500, length: 0.16 }),
      });
      // accordion (musette), one box for the right hand and the chords
      const acc = I.accordion(ctx, { volume: -5, cutoff: 3000 });
      // mandolin: a bright steel pluck, double-coursed (two strings a few cents apart, 3 ms apart)
      const mandG = I.guitar(ctx, { kind: "steel", volume: -5, dampening: 6800, resonance: 0.965, attackNoise: 1.6, voices: 12 });
      const mand = { out: mandG.out, play(t, notes, d, v) { mandG.play(t, arr(notes).flatMap((m) => [m, m + 0.07]), d, v, 0.003); } };
      // rhythm guitar: a nylon-ish steel strum, darker, for the chop
      const gtr = I.guitar(ctx, { kind: "steel", volume: -12, dampening: 4200, voices: 12 });
      const bass = I.upright(ctx, { volume: -5 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 36, preload: ["kick", "djembe", "conga", "congaLow", "tambourine", "shaker", "clap", "triangle", "crash"] });

      const clP = I.place(ctx, clar, -0.18, out), acP = I.place(ctx, acc, 0.22, out), mnP = I.place(ctx, mand, 0.38, out);
      const gtP = I.place(ctx, gtr, -0.3, out), bsP = I.place(ctx, bass, 0.02, out), ktP = I.place(ctx, kit, 0.08, out);
      I.send(ctx, clP, square, -10); I.send(ctx, clP, hall, -16); I.send(ctx, clP, slap, -22);
      I.send(ctx, acP, square, -11); I.send(ctx, acP, hall, -18);
      I.send(ctx, mnP, square, -9); I.send(ctx, mnP, slap, -16);
      I.send(ctx, gtP, square, -14);
      I.send(ctx, bsP, square, -24);
      I.send(ctx, ktP, square, -12);

      return {
        clar: { layer: "melody", play: (t, e, d) => clar.play(t, e, d), humanize: { timing: 0.007, vel: 0.04 } },
        accMel: { layer: "melody", play: (t, e, d) => acc.play(t, e.note, d, e.vel), humanize: { timing: 0.009, vel: 0.05 } },
        mand: { layer: "melody", play: (t, e, d) => mand.play(t, e.note, d, e.vel), humanize: { timing: 0.007, vel: 0.06 } },
        accCh: { layer: "harmony", play: (t, e, d) => acc.play(t, e.note, d, e.vel), humanize: { timing: 0.014, vel: 0.04 } },
        gtr: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.008, vel: 0.07 } },
        gtrArp: { layer: "texture", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.07 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, off, cl } = W;
      const L = lap % 3;
      const key = `${lap}:${W.i}`;
      // a section is planned once, in the cycle before it starts (so its pickup is routed by the same plan)
      if (!state.plan || state.plan.key !== key) state.plan = state.next && state.next.key === key ? state.next : { key, ...planSection(f, lap, r.fork(11)) };
      const { prog, notes } = state.plan;
      // the next section's pickup belongs to this cycle's last half-beat
      const nextI = (W.i + 1) % LAP.length, nextLap = nextI === 0 ? lap + 1 : lap;
      const nextKey = `${nextLap}:${nextI}`;
      if (W.last && (!state.next || state.next.key !== nextKey)) state.next = { key: nextKey, ...planSection(LAP[nextI], nextLap, r.fork(11)) };
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beats from this cycle's start (may be negative: a pickup)
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const chordAt = T.chordAtFactory(prog, BPB);
      const harmony = prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));

      // ---------- the band's lines (hand-written, routed, articulated) ----------
      const emit = (n, abs) => {
        const { at, bar, beat, idx, phrase, voice, shift, entrance, handoff, answer, trem, ...rest } = n;
        if (n.track === "mand" && ((trem && n.dur >= 1) || n.dur >= 1.5) && f.id !== "A1" && f.id !== "A2") {
          // mandolin tremolo: a long note becomes 16ths, swelling through the middle
          const k = Math.max(2, Math.round(n.dur / 0.25));
          for (let i = 0; i < k; i++) push("mand", abs + i * 0.25, 0.22, n.note, n.vel * (0.78 + 0.22 * Math.sin((Math.PI * (i + 0.5)) / k)) - (trem ? 0 : 0.06), { straight: true, nogroove: true });
          return;
        }
        push(n.track, abs, n.dur, n.note, n.vel, rest);
      };
      for (const n of notes) if (n.at >= s0 - 1e-6 && n.at < s1 - 1e-6) emit(n, n.at - s0);
      if (W.last && state.next) for (const n of state.next.notes) if (n.at < -1e-6) emit(n, CB * BPB + n.at);
      const melBusy = (bar) => notes.some((n) => n.at < (bar + 1) * BPB && n.at + n.dur > bar * BPB + 0.1 && n.track !== "mand");

      // ---------- styles ----------
      const style = f.id === "intro" ? (lap === 0 && off === 0 ? "hands" : "small") : f.id === "A1" || f.id === "A2" || f.id === "B" ? "small"
        : f.id === "T1" || f.id === "T2" ? "slow" : f.id === "FA" ? "full" : "thin";
      const chords = prog.filter((h) => h.bar >= off && h.bar < off + CB);
      const handsOnly = (bar) => style === "hands" && bar < 2; // the first lap opens with the hand drum alone

      // ---------- rhythm guitar ----------
      let gv = state.gtrV;
      chords.forEach((h) => {
        const s = h.bar * BPB + h.beat - s0, c = T.chord(h.chord);
        const v = T.voice(c, { lo: 55, hi: 72, n: 4, prev: gv, top: [64, 72], rng: r, omitBass: false, rootless: false });
        gv = v;
        if (handsOnly(h.bar)) return;
        if (style === "slow") { // arpeggio, 8ths, up the chord tones from the bass note and back
          const root = T.nearest(52, [c.bass], 48, 59);
          const core = c.pcs.filter((pc) => !c.colors.includes(pc)); // root, 3rd, 5th, 7th: the colours stay in the accordion
          const lad = [root, ...T.notesIn(core.length >= 3 ? core : c.pcs, root + 1, root + 19)].slice(0, 5);
          const pat = [0, 1, 2, 3, 4, 3, 2, 1];
          for (let i = 0; i * 0.5 < h.dur; i++) {
            const m = lad[pat[i % 8] % lad.length];
            push("gtrArp", s + i * 0.5, 0.9, m, 0.3 + (i % 4 === 0 ? 0.05 : 0) + r.range(-0.02, 0.02));
          }
          return;
        }
        const hits = style === "full"
          ? [[0, 0.018, 0.5], [1, 0.018, 0.46], [1.5, -0.014, 0.3], [2, 0.018, 0.48], [2.5, -0.014, 0.3], [3, 0.018, 0.5], [3.5, -0.014, 0.34]]
          : style === "thin" ? [[1, 0.018, 0.32], [3, 0.018, 0.34]]
            : [[1, 0.018, 0.42], [2.5, -0.014, 0.26], [3, 0.018, 0.44]].concat(r.chance(0.35) ? [[r.pick([0.5, 3.5]), -0.014, 0.22]] : []);
        for (const [b, strum, vel] of hits) {
          if (b >= h.dur) continue;
          if (f.id === "FA" && off + h.bar === 7 && b > 0) continue; // the last chord of the full band rings
          push("gtr", s + b, strum > 0 ? 0.7 : 0.45, v, vel + r.range(-0.02, 0.02), { strum });
        }
        if (f.id === "FA" && off + h.bar === 7) push("gtr", s, 3, v, 0.5, { strum: 0.03 });
      });
      state.gtrV = gv;

      // ---------- accordion chords: held under the answer strain and the trio ----------
      if (f.id === "B" || style === "slow") {
        let av = state.accV;
        chords.forEach((h) => {
          const s = h.bar * BPB + h.beat - s0;
          const busy = notes.some((n) => n.track === "accMel" && n.at < (h.bar + 1) * BPB && n.at + n.dur > h.bar * BPB + 0.1);
          if (busy) return;
          const v = T.voice(h.chord, { lo: 57, hi: 71, n: 3, prev: av, top: [64, 71], rng: r, omitBass: true, rootless: false });
          av = v;
          push("accCh", s + 0.02, h.dur - 0.2, v, style === "slow" ? 0.25 : 0.28);
        });
        state.accV = av;
      }

      // ---------- bass ----------
      let last = state.bassLast ?? 43;
      chords.forEach((h, i) => {
        const s = h.bar * BPB + h.beat - s0, d = h.dur, c = T.chord(h.chord);
        const R = T.nearest(last, [c.bass], 33, 50);
        // the other note of the two-feel: the chord's fifth, or its root when the bass note is not the root
        const fifth = c.bass !== c.root ? T.nearest(R, [c.root], 33, 50) : R + 7 <= 50 ? R + 7 : R - 5;
        const next = chords[i + 1];
        const nextBass = next ? T.chord(next.chord).bass : null;
        if (handsOnly(h.bar)) return;
        if (style === "slow") push("bass", s, d - 0.3, R, 0.62);
        else if (style === "thin") { push("bass", s, Math.min(d, 2.4), R, 0.6); if (d >= 4 && r.chance(0.4)) push("bass", s + 2.5, 1.2, fifth, 0.5); }
        else if (style === "full") {
          push("bass", s, 1.4, R, 0.74);
          if (d >= 4) { push("bass", s + 2, 1.1, fifth, 0.66); push("bass", s + 3.5, 0.45, R + 12 <= 50 ? R + 12 : R, 0.56); }
          else if (d >= 2) push("bass", s + 1, 0.8, fifth, 0.62);
        } else { // the two-feel with walk-ups
          push("bass", s, Math.min(d, 2) - 0.3, R, 0.68);
          if (d >= 4) {
            push("bass", s + 2, 1.5, r.chance(0.7) ? fifth : R, 0.6);
            if (nextBass != null && nextBass !== c.bass && r.chance(0.55)) {
              const target = T.nearest(R, [nextBass], 33, 50);
              push("bass", s + 3.5, 0.45, target + (target > R ? -1 : 1), 0.52);
            }
          } else if (d >= 2 && r.chance(0.4)) push("bass", s + 1, 0.8, fifth, 0.55);
        }
        last = R;
      });
      state.bassLast = last;

      // ---------- percussion ----------
      const dj = (abs, kind, vel, extra) => push("drums", abs, 0.3, "djembe", vel, { pitch: DJ[kind], ...extra });
      const hit = (abs, voice, vel, extra) => push("drums", abs, 0.3, voice, vel, extra);
      for (let b = 0; b < CB; b++) {
        const B0 = b * BPB, secBar = off + b;
        const lastBar = secBar === f.bars - 1;
        const st = style === "hands" && b >= 2 ? "small" : style;
        if (st === "hands" || st === "small" || st === "thin" || st === "full") {
          const soft = st === "thin" ? 0.75 : st === "hands" ? 0.9 : 1;
          dj(B0, "bass", 0.6 * soft); dj(B0 + 1, "slap", 0.52 * soft); dj(B0 + 1.5, "tone", 0.3, { ghost: true });
          dj(B0 + 2, "bass", 0.5 * soft); dj(B0 + 2.5, "tone", 0.36 * soft); dj(B0 + 3, "slap", 0.54 * soft); dj(B0 + 3.5, "tone", 0.3, { ghost: true });
          if (r.chance(st === "thin" ? 0.15 : 0.3)) dj(B0 + r.pick([1.75, 3.75, 0.75]), "tone", 0.3, { ghost: true });
          if (st === "full" && r.chance(0.5)) dj(B0 + 2.75, "slap", 0.4);
        }
        if (st === "small" || st === "full") {
          hit(B0, "kick", st === "full" ? 0.7 : 0.62); hit(B0 + 2, "kick", st === "full" ? 0.6 : 0.52);
          if (st === "full") hit(B0 + 3.5, "kick", 0.46);
          hit(B0 + 1, "tambourine", st === "full" ? 0.56 : 0.46); hit(B0 + 3, "tambourine", st === "full" ? 0.58 : 0.48);
          const shakerOn = st === "small" && f.id !== "A1" && !(f.id === "intro" && lap === 0);
          if (shakerOn) for (let i = 0; i < 8; i++) hit(B0 + i * 0.5, "shaker", i % 2 === 0 ? 0.2 : 0.28);
          if (st === "full") {
            for (let i = 0; i < 8; i++) if (i % 4 !== 2) hit(B0 + i * 0.5, "tambourine", 0.18 + (i % 2 ? 0.04 : 0), { ghost: true });
            hit(B0 + 1, "clap", lap === 0 ? 0.42 : 0.5); hit(B0 + 3, "clap", lap === 0 ? 0.44 : 0.52);
            hit(B0 + 1.5, "conga", 0.4, { pitch: 64 }); hit(B0 + 3, "congaLow", 0.42); hit(B0 + 3.5, "conga", 0.38, { pitch: 62 });
          }
        }
        if (st === "slow") {
          dj(B0, "bass", 0.42); dj(B0 + 2, "tone", 0.28); if (r.chance(0.5)) dj(B0 + 3.5, "tone", 0.24, { ghost: true });
          hit(B0, "kick", 0.46); hit(B0 + 3, "triangle", 0.3);
        }
        // marks of form
        if (lastBar && (f.id === "A1" || f.id === "A2" || f.id === "B") && r.chance(f.id === "B" ? 1 : 0.7)) {
          const fill = r.pick(FILLS);
          fill.forEach(([x, k, v]) => dj(B0 + x, k, v));
          if (f.id === "B") { hit(B0 + 3.5, "triangle", 0.36); }
        }
        if (lastBar && f.id === "T2") { // the build into the full band
          [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75].forEach((x, i) => dj(B0 + x, i % 2 ? "tone" : "slap", 0.34 + i * 0.04));
          hit(B0 + 2, "kick", 0.5); hit(B0 + 3, "kick", 0.56); hit(B0 + 3.5, "kick", 0.6);
          hit(B0 + 3, "tambourine", 0.5); hit(B0 + 3.5, "tambourine", 0.54);
        }
        if (f.id === "FA" && secBar === 0 && b === 0) hit(0, "crash", 0.5);
        if (f.id === "FA" && lastBar) { // the band stops on the held chord; the hand drum alone ends the bar
          ev = ev.filter((e) => !(e.track === "drums" && e.bar === b && e.beat >= 1.5 && e.note !== "djembe"));
          ev = ev.filter((e) => !(e.track === "drums" && e.bar === b && e.beat >= 2 && e.note === "djembe" && !e.ghost));
          hit(B0 + 2, "clap", 0.46); hit(B0 + 3, "clap", 0.48);
        }
        if (f.id === "T1" && secBar === 0 && b === 0) hit(0, "triangle", 0.4);
      }

      // ---------- feel ----------
      ev = G.ghosts(ev, { track: "drums", vel: 0.22, dur: 0.1 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: {
            djembe: { template: "mpc58", amount: 0.9 }, conga: { template: "mpc58", late: 3 }, congaLow: { template: "mpc58", late: 3 },
            tambourine: { template: "laidback", amount: 0.9 }, shaker: "pushed", kick: "straight", crash: "straight",
            clap: { template: "laidback", amount: 1.3 }, triangle: { template: "straight", late: 10 },
          } },
          bass: { template: "boogie", late: 4 },
          gtr: { template: "mpc54", late: 6, vels: false },
          gtrArp: { template: "mpc54", late: 4, vels: false },
          accCh: { template: "straight", late: 18, vels: false },
          accMel: { template: "straight", late: 8, vels: false },
          mand: { template: "mpc54", late: 2, vels: false },
        },
      });
      const lyrical = style === "slow";
      ev = G.rubato(ev, { track: "clar", bpm: BPM, bpb: BPB, amount: lyrical ? 0.7 : 0.3, linger: "high", lingerMs: lyrical ? 60 : 35, rng: r });

      const keyName = f.id === "T1" || f.id === "T2" ? "E minor" : "G major";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${keyName} · ${state.plan.label}`, state, tempo: tempoAt(cl) };
    },
  });
})();

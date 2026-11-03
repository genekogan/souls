// Cloud Street: light jazz-fusion at altitude. A major, 96 BPM, a hair of 16th swing.
// (A "cloud street" is the line of cumulus a glider pilot follows across the sky.)
//
// THE TUNE (written by hand, fixed for the life of the piece; the generator never regenerates it)
//
// Hook: an offbeat pickup that leaps up a major sixth and lands on a colour tone held across the
// downbeat (maj7, then #11, then 9), followed by a stepwise fall that ends on a 16th-note turn.
// The identity of the piece is that landing note: it is never the root.
//
//   A (8 bars)   | Amaj9     | Dmaj9#11  | C#m9      | Fmaj9#11  | Bm11      | E13sus4   | Cmaj9     | Dm9  G13   |
//   melody   B4 | G#5. F#5 E5 C#5 D5 | G#5 - A5 G#5F#5 E5 | D#5. C#5 B4 G#4 A4 | E5. F5 G5 A5 B5 | A5. F#5 E5 D5 C#5 | D5 - E5 D5C#5 B4 | E5. G5 D5 B4 | C5 - B4 A4 G4 |
//   counter  E4 ....... F#4 | F#4 .. E4 .. | G#4 .. E4 .. | A4 .. G4 .. | F#4 ....... | A4 .. F#4 .. | G4 ....... | F4 ....... |
//   The Fmaj9#11 is a chromatic mediant; the melody climbs its lydian scale into Bm11 like a gust.
//   The last bar's ii–V points at C but the tune goes home to A (G13 → Amaj9, the backdoor). The
//   second time round (A′: bar 7 is F#m9) the same ii–V is honest and we land in C: the modulation.
//
//   B (8 bars, in C) | Cmaj9 | Ebmaj9#11 | Dm9 | G13sus4 | Am9 | Fmaj9#11 | Bbmaj9#11 | Bm11  E7b9 |
//   melody  B5. A5 G5 D5 | A5 - G5 F5 D5 | E5. F5 A5 C5 | F5 - E5 D5 C5 | B5. A5 G5 E5 | B5 - A5 G5F5 E5 | E5. D5 C5 A5 | A5 - G#5 F5 D5 |
//   The hook inverted: it starts high and falls; the #11 colour returns on Eb, F and Bb; the last
//   bar leaps the sixth up (C5 → A5) into a ii–V that takes us back to A.
//
//   Float (8 bars over an E pedal) | Amaj9/E | Gmaj9#11/E | Fmaj9#11/E | Gmaj9#11/E | (again) ... | F#13sus4 |
//   melody: the hook's sixth alone, planing down with the chords: B4→G#5, A4→F#5, G4→E5, A4→F#5 …
//
//   Lift (8 bars, A up a whole step in B major; the melody's first 6 bars transposed, then)
//   | Dmaj9#11 | E13sus4 |  G#5 - A5 F#5 E5 | D5 - C#5 B4 A4   (a lydian bIII of B that is IV of A: the way home)
//   Turn (4 bars) | Amaj9 | F#m9 | Dmaj9#11 | Dm9 G13 |  E5. C#5 B4 | A4. G#4 C#5 | G#5 .. F#5 | F5 - E5 D5  → the backdoor again, into the intro
//
// Form: one lap is 48 bars (two minutes): intro 4 · A 8 · A′ 8 · B 8 · float 8 · lift 8 · turn 4.
// Across laps only the arrangement changes (who sings, who answers, drums, ornament, pad); three
// plans rotate, then the first returns. Palette built here: a detuned chorused electric piano, a
// glassy breath-synth with late vibrato, and a lo-fi dotted echo (bit-reduced, through tape wow).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const db = (x) => Math.pow(10, x / 20);
  const N = (s) => T.midi(s);

  // ---------- harmony ----------
  const PROG = {
    intro: "| Amaj9/E | Gmaj9#11/E | Fmaj9#11/E | E13sus4 |",
    A: "| Amaj9 | Dmaj9#11 | C#m9 | Fmaj9#11 | Bm11 | E13sus4 | Cmaj9 | Dm9 G13 |",
    A2: "| Amaj9 | Dmaj9#11 | C#m9 | Fmaj9#11 | Bm11 | E13sus4 | F#m9 | Dm9 G13 |",
    B: "| Cmaj9 | Ebmaj9#11 | Dm9 | G13sus4 | Am9 | Fmaj9#11 | Bbmaj9#11 | Bm11 E7b9 |",
    float: "| Amaj9/E | Gmaj9#11/E | Fmaj9#11/E | Gmaj9#11/E | Amaj9/E | Gmaj9#11/E | Fmaj9#11/E | F#13sus4 |",
    lift: "| Bmaj9 | Emaj9#11 | D#m9 | Gmaj9#11 | C#m11 | F#13sus4 | Dmaj9#11 | E13sus4 |",
    turn: "| Amaj9 | F#m9 | Dmaj9#11 | Dm9 G13 |",
  };
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v)]));

  // ---------- the tune: [beat from section start, dur, note] ----------
  const n = (b, d, s) => [b, d, N(s)];
  const MEL_A_HEAD = [ // bars 1-6, shared by A, A′ and (transposed) the lift
    n(-0.5, 0.5, "B4"),
    n(0, 1.5, "G#5"), n(1.5, 0.5, "F#5"), n(2, 1, "E5"), n(3, 0.5, "C#5"), n(3.5, 0.5, "D5"),
    n(4, 2, "G#5"), n(6, 0.5, "A5"), n(6.5, 0.25, "G#5"), n(6.75, 0.25, "F#5"), n(7, 1, "E5"),
    n(8, 1.5, "D#5"), n(9.5, 0.5, "C#5"), n(10, 1, "B4"), n(11, 0.5, "G#4"), n(11.5, 0.5, "A4"),
    n(12, 1.5, "E5"), n(13.5, 0.5, "F5"), n(14, 0.5, "G5"), n(14.5, 0.5, "A5"), n(15, 1, "B5"),
    n(16, 1.5, "A5"), n(17.5, 0.5, "F#5"), n(18, 1, "E5"), n(19, 0.5, "D5"), n(19.5, 0.5, "C#5"),
    n(20, 2, "D5"), n(22, 0.5, "E5"), n(22.5, 0.25, "D5"), n(22.75, 0.25, "C#5"), n(23, 1, "B4"),
  ];
  const MEL_A_TAIL = [ // bars 7-8: Cmaj9 | Dm9 G13 → home (deceptively)
    n(24, 1.5, "E5"), n(25.5, 0.5, "G5"), n(26, 1, "D5"), n(27, 1, "B4"),
    n(28, 2, "C5"), n(30, 0.5, "B4"), n(30.5, 0.5, "A4"), n(31, 0.75, "G4"),
  ];
  const MEL_A2_TAIL = [ // bars 7-8: F#m9 | Dm9 G13 → C
    n(24, 1.5, "A5"), n(25.5, 0.5, "G#5"), n(26, 1, "F#5"), n(27, 1, "E5"),
    n(28, 2, "F5"), n(30, 0.5, "E5"), n(30.5, 0.5, "D5"), n(31, 1, "B4"),
  ];
  const MEL_LIFT_TAIL = [ // bars 7-8 of the lift, written in B: Dmaj9#11 | E13sus4 (not transposed)
    n(24, 2, "G#5"), n(26, 0.5, "A5"), n(26.5, 0.5, "F#5"), n(27, 1, "E5"),
    n(28, 2, "D5"), n(30, 0.5, "C#5"), n(30.5, 0.5, "B4"), n(31, 1, "A4"),
  ];
  const MEL_B = [
    n(0, 1.5, "B5"), n(1.5, 0.5, "A5"), n(2, 1, "G5"), n(3, 1, "D5"),
    n(4, 2, "A5"), n(6, 0.5, "G5"), n(6.5, 0.5, "F5"), n(7, 1, "D5"),
    n(8, 1.5, "E5"), n(9.5, 0.5, "F5"), n(10, 1, "A5"), n(11, 1, "C5"),
    n(12, 2, "F5"), n(14, 1, "E5"), n(15, 0.5, "D5"), n(15.5, 0.5, "C5"),
    n(16, 1.5, "B5"), n(17.5, 0.5, "A5"), n(18, 1, "G5"), n(19, 1, "E5"),
    n(20, 2, "B5"), n(22, 0.5, "A5"), n(22.5, 0.25, "G5"), n(22.75, 0.25, "F5"), n(23, 1, "E5"),
    n(24, 1.5, "E5"), n(25.5, 0.5, "D5"), n(26, 1, "C5"), n(27, 1, "A5"),
    n(28, 2, "A5"), n(30, 0.5, "G#5"), n(30.5, 0.5, "F5"), n(31, 1, "D5"),
  ];
  const MEL_FLOAT = [ // the sixth, planing
    n(1.5, 0.5, "B4"), n(2, 2, "G#5"), n(5.5, 0.5, "A4"), n(6, 2, "F#5"), n(9.5, 0.5, "G4"), n(10, 2, "E5"), n(13.5, 0.5, "A4"), n(14, 2, "F#5"),
    n(17.5, 0.5, "B4"), n(18, 2, "G#5"), n(21.5, 0.5, "A4"), n(22, 2, "F#5"), n(25.5, 0.5, "G4"), n(26, 2, "E5"), n(29.5, 0.5, "C#5"), n(30, 1.5, "E5"),
  ];
  const MEL_INTRO = [n(1.5, 0.5, "B4"), n(2, 2, "G#5"), n(5.5, 0.5, "A4"), n(6, 2, "F#5"), n(9.5, 0.5, "G4"), n(10, 2, "E5"), n(13.5, 0.5, "A4"), n(14, 1.25, "F#5")];
  const MEL_TURN = [
    n(0, 1.5, "E5"), n(1.5, 0.5, "C#5"), n(2, 2, "B4"),
    n(4, 1.5, "A4"), n(5.5, 0.5, "G#4"), n(6, 2, "C#5"),
    n(8, 3, "G#5"), n(11, 1, "F#5"),
    n(12, 2, "F5"), n(14, 1, "E5"), n(15, 0.75, "D5"),
  ];
  const CTR_A = [n(0, 3, "E4"), n(3, 1, "F#4"), n(4, 2, "F#4"), n(6, 2, "E4"), n(8, 2, "G#4"), n(10, 2, "E4"), n(12, 2, "A4"), n(14, 2, "G4"), n(16, 4, "F#4"), n(20, 2, "A4"), n(22, 2, "F#4")];
  const CTR_A_TAIL = [n(24, 4, "G4"), n(28, 4, "F4")];
  const CTR_A2_TAIL = [n(24, 4, "A4"), n(28, 4, "F4")];
  const CTR_LIFT_TAIL = [n(24, 4, "A4"), n(28, 4, "G4")]; // in B: 5 of D, 9 of E
  const CTR_B = [n(0, 4, "G4"), n(4, 4, "G4"), n(8, 4, "F4"), n(12, 2, "F4"), n(14, 2, "E4"), n(16, 4, "E4"), n(20, 2, "E4"), n(22, 2, "C4"), n(24, 4, "D4"), n(28, 4, "D4")];
  const CTR_TURN = [n(0, 4, "E4"), n(4, 4, "E4"), n(8, 4, "E4"), n(12, 2, "F4"), n(14, 2, "F4")];

  const tr = (notes, semis) => notes.map(([b, d, m]) => [b, d, m + semis]);
  const MATERIAL = {
    intro: { mel: MEL_INTRO, ctr: null },
    A: { mel: MEL_A_HEAD.concat(MEL_A_TAIL), ctr: CTR_A.concat(CTR_A_TAIL) },
    A2: { mel: MEL_A_HEAD.concat(MEL_A2_TAIL), ctr: CTR_A.concat(CTR_A2_TAIL) },
    B: { mel: MEL_B, ctr: CTR_B },
    float: { mel: MEL_FLOAT, ctr: null },
    lift: { mel: tr(MEL_A_HEAD, 2).concat(MEL_LIFT_TAIL), ctr: tr(CTR_A, 2).concat(CTR_LIFT_TAIL) },
    turn: { mel: MEL_TURN, ctr: CTR_TURN },
  };

  // ---------- form: 12 cycles of 4 bars ----------
  const LAP = [
    { sec: "intro", half: 0, bars: 4 },
    { sec: "A", half: 0 }, { sec: "A", half: 1 },
    { sec: "A2", half: 0 }, { sec: "A2", half: 1 },
    { sec: "B", half: 0 }, { sec: "B", half: 1 },
    { sec: "float", half: 0 }, { sec: "float", half: 1 },
    { sec: "lift", half: 0 }, { sec: "lift", half: 1 },
    { sec: "turn", half: 0, bars: 4 },
  ];
  // Arrangement plans, one per lap, rotating. sing: who has the tune; ctr: who has the counter-line
  // (bass = the counter-line two octaves down, replacing the bass part); drums: a pattern family.
  const PLANS = [
    {
      intro: { sing: "ep", ctr: null, comp: "none", drums: "float", pad: 1, bass: "pedal" },
      A: { sing: "ep", ctr: null, comp: "full", drums: "head", pad: 0, bass: "walk" },
      A2: { sing: "ep", ctr: "glass", comp: "full", drums: "head", pad: 0, bass: "walk" },
      B: { sing: "glass", ctr: null, comp: "full", drums: "b", pad: 1, bass: "walk" },
      float: { sing: "ep", ctr: null, comp: "none", drums: "float", pad: 1, bass: "pedal" },
      lift: { sing: "ep", ctr: "glass", comp: "full", drums: "lift", pad: 1, bass: "walk", crash: 1 },
      turn: { sing: "ep", ctr: null, comp: "sparse", drums: "turn", pad: 1, bass: "walk" },
    },
    {
      intro: { sing: "glass", ctr: null, comp: "sparse", drums: "float", pad: 1, bass: "pedal" },
      A: { sing: "glass", ctr: null, comp: "full", drums: "head", pad: 0, bass: "walk" },
      A2: { sing: "ep", ctr: "glass", comp: "full", drums: "head", pad: 0, bass: "walk" },
      B: { sing: "ep", up: 12, ctr: "glass", comp: "full", drums: "b", pad: 1, bass: "walk", crash: 1 },
      float: { sing: "glass", ctr: null, comp: "sparse", drums: "float", pad: 1, bass: "line" },
      lift: { sing: "glass", ctr: "ep", comp: "full", drums: "lift", pad: 1, bass: "walk", crash: 1 },
      turn: { sing: "glass", ctr: null, comp: "sparse", drums: "turn", pad: 1, bass: "walk" },
    },
    {
      intro: { sing: "ep", ctr: null, comp: "none", drums: "float", pad: 1, bass: "pedal" },
      A: { sing: "ep", ctr: "glass", comp: "full", drums: "head", pad: 0, bass: "walk" },
      A2: { sing: "glass", double: 12, ctr: null, comp: "full", drums: "head", pad: 0, bass: "walk" },
      B: { sing: "glass", ctr: null, comp: "full", drums: "b", pad: 1, bass: "counter", crash: 1 },
      float: { sing: "ep", ctr: null, comp: "sparse", drums: "float", pad: 1, bass: "line" },
      lift: { sing: "glass", double: 12, ctr: null, comp: "full", drums: "lift", pad: 1, bass: "walk", crash: 1 },
      turn: { sing: "ep", ctr: "glass", comp: "sparse", drums: "turn", pad: 1, bass: "walk" },
    },
  ];

  // ---------- the palette ----------
  /** Electric piano: two FM bodies a few cents apart through a slow chorus, with a quiet tine. */
  function epiano(ctx, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) + 6)));
    const chorus = ctx.keep(new Tone.Chorus({ frequency: 0.5, delayTime: 3.4, depth: 0.42, spread: 140, wet: 0.38 }).start()).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 4200, type: "lowpass", rolloff: -12 })).connect(chorus);
    const body = (detune, bark) => ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 14, options: {
      detune, harmonicity: 1, modulationIndex: bark,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.003, decay: 2.6, sustain: 0.12, release: 0.9 },
      modulationEnvelope: { attack: 0.002, decay: 0.55, sustain: 0.1, release: 0.5 },
    } })).connect(lp);
    const a = body(-5, o.bark ?? 2.3), b = body(6, (o.bark ?? 2.3) * 0.8);
    b.volume.value = -4;
    const tine = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 10, options: {
      harmonicity: 14, modulationIndex: 0.5, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
      modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
    } })).connect(lp);
    tine.volume.value = o.tine ?? -16;
    const arr = (x) => (Array.isArray(x) ? x : [x]);
    return {
      out,
      play(time, notes, dur, vel = 0.7) {
        const f = arr(notes).filter((m) => typeof m === "number").map(T.hz);
        if (!f.length) return;
        a.triggerAttackRelease(f, dur, time, vel * 0.85);
        b.triggerAttackRelease(f, dur, time + 0.004, vel * 0.7);
        tine.triggerAttackRelease(f, Math.min(dur, 0.4), time, vel * vel * 0.8);
      },
    };
  }
  /** Glass: a near-sine lead with a breath of pink noise, delayed vibrato, chorus; scoops and falls. */
  function glassLead(ctx, I, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 9)));
    const chorus = ctx.keep(new Tone.Chorus({ frequency: 1.2, delayTime: 2.6, depth: 0.5, spread: 90, wet: 0.4 }).start()).connect(out);
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 5.3, depth: 0 })).connect(chorus);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 3400, type: "lowpass", rolloff: -12 })).connect(vib);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: 0.018,
      oscillator: { type: "custom", partials: [1, 0.02, 0.28, 0.01, 0.09, 0, 0.03] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.5 },
      envelope: { attack: 0.045, decay: 0.25, sustain: 0.8, release: 0.32 },
      filterEnvelope: { attack: 0.05, decay: 0.4, sustain: 0.6, release: 0.3, baseFrequency: 900, octaves: 1.8 },
    })).connect(lp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 0.8 })).connect(lp);
    const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.03, decay: 0.18, sustain: 0.05, release: 0.2 } })).connect(bp);
    breath.volume.value = -33;
    const mono = I.monotonic(out), monoB = I.monotonic(out);
    return {
      out,
      play(time, e, dur) {
        const m = typeof e.note === "number" ? e.note : Array.isArray(e.note) ? e.note[0] : 76;
        if (typeof m !== "number") return;
        const t = mono(time), f = T.hz(m);
        s.triggerAttackRelease(f, dur, t, e.vel);
        if (e.scoop) { s.frequency.setValueAtTime(T.hz(m - e.scoop), t + 0.001); s.frequency.exponentialRampToValueAtTime(f, t + 0.09); }
        if (e.fall && dur > 0.5) { const a = t + dur - 0.12; s.frequency.setValueAtTime(f, a); s.frequency.exponentialRampToValueAtTime(T.hz(m - e.fall), a + 0.3); }
        vib.depth.cancelScheduledValues(t);
        vib.depth.setValueAtTime(0.003, t);
        if (dur > 0.5) vib.depth.linearRampToValueAtTime(0.035 * (e.vib ?? 1), t + Math.min(1.1, dur * 0.6));
        breath.triggerAttackRelease(Math.min(0.2, dur), monoB(time), e.vel * 0.7);
      },
    };
  }
  /** A lo-fi echo: dotted-8th feedback delay, bit-reduced, band-limited, through tape wow. Returns the input. */
  function lofiEcho(ctx, I, dest) {
    const tape = I.tape(ctx, dest, { wow: 0.3, flutter: 0.05, cutoff: 5200, drive: 0.08 });
    const lp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "lowpass", rolloff: -12 }));
    const hp = ctx.keep(new Tone.Filter({ frequency: 320, type: "highpass" }));
    const crush = ctx.keep(new Tone.BitCrusher({ bits: 8, wet: 0.45 }));
    const d = ctx.keep(new Tone.FeedbackDelay({ delayTime: "8n.", maxDelay: 2, feedback: 0.36, wet: 1 }));
    d.chain(crush, hp, lp, tape);
    return d;
  }

  // ---------- comping rhythms: [beat, dur] within a chord span (negative = anticipation) ----------
  const COMP4 = [
    [[[-0.25, 1.5], [1.5, 0.75], [2.5, 1.25]], 3], [[[0, 1.25], [1.5, 1.75]], 2.5], [[[-0.25, 2.75], [3.5, 0.4]], 2],
    [[[0.5, 0.75], [1.5, 0.5], [2.5, 1.25]], 1.5], [[[0, 0.75], [1.5, 2.25]], 1.5], [[[-0.25, 1.75], [2.5, 0.5], [3.5, 0.4]], 1],
  ];
  const COMP2 = [[[[0, 1.75]], 2], [[[-0.25, 1.75]], 2], [[[0.5, 1.25]], 1], [[[0, 0.75], [1.5, 0.5]], 1]];
  const SPARSE4 = [[[[-0.25, 3.75]], 2], [[[0, 3.75]], 2], [[[1.5, 2.25]], 1]];

  // Comping shapes per chord quality: intervals above the root, bottom to top (no inner semitones low down).
  const SHAPES = {
    maj9: [[4, 7, 11, 14], [11, 14, 16, 19], [4, 9, 11, 14], [7, 11, 14, 16]],
    "maj9#11": [[4, 11, 14, 18], [11, 14, 18, 21], [4, 7, 11, 18], [7, 11, 14, 18]],
    "maj7#11": [[4, 11, 14, 18], [11, 14, 18, 21], [4, 7, 11, 18]],
    m9: [[3, 7, 10, 14], [10, 15, 19, 26], [3, 10, 14, 19], [7, 10, 14, 15 + 12]],
    m11: [[3, 10, 14, 17], [5, 10, 15, 19], [3, 7, 10, 17], [10, 14, 17, 22]],
    "13sus4": [[10, 14, 17, 21], [5, 10, 14, 21], [10, 17, 21, 26], [5, 10, 17, 21]],
    13: [[10, 14, 16, 21], [4, 10, 14, 21], [10, 16, 21, 26], [4, 10, 16, 21]],
    "7b9": [[4, 10, 13, 19], [10, 13, 16, 21], [4, 10, 13, 16]],
  };
  /** Place a shape for `sym` so its top voice leads from prevTop; floaty = three voices, higher. */
  function voiceShape(sym, { prevTop, prevShape, lo, hi, top, r, floaty, thin }) {
    const c = T.chord(sym);
    const q = sym.replace(/^[A-G][#b]?/, "").replace(/\/.*$/, "");
    const shapes = SHAPES[q];
    if (!shapes) return T.voice(sym, { lo, hi, n: floaty ? 3 : 4, top, rng: r, omitBass: true });
    let best = null, bs = Infinity;
    shapes.forEach((sh0, si) => {
      const sh = floaty ? sh0.slice(1) : thin ? sh0.slice(0, 3) : sh0;
      for (let o = 2; o <= 6; o++) {
        const v = sh.map((i) => c.root + i + 12 * o);
        if (v[0] < lo || v[v.length - 1] > hi) continue;
        const t = v[v.length - 1];
        let sc = Math.abs(t - (prevTop ?? (top[0] + top[1]) / 2)) * 1.1 + r() * 2.5;
        if (t < top[0]) sc += (top[0] - t) * 1.5; if (t > top[1]) sc += (t - top[1]) * 1.5;
        if (v[0] < 55 && v[1] - v[0] < 4) sc += 6;
        if (prevShape && prevShape.q === q && prevShape.i === si) sc += 2; // a pianist varies the shape
        if (sc < bs) { bs = sc; best = v; best.shape = { q, i: si }; }
      }
    });
    return best || T.voice(sym, { lo, hi, n: floaty ? 3 : 4, top, rng: r, omitBass: true });
  }

  Sim.register({
    id: "cloud-street",
    title: "Cloud Street",
    genre: "Light fusion",
    about: "Airy jazz-fusion in A at 96: a hand-written tune whose hook leaps a sixth onto a colour tone, over maj9#11 chromatic mediants and a ii–V that goes home the wrong way, then the right way. Detuned electric piano, a glassy breath-synth, fretless bass, light 16th drums and a lo-fi echo; a two-minute lap whose arrangement rotates.",
    bpm: 96, beatsPerBar: 4, swing: 0.55, swingUnit: 0.25, cycleBars: 4, gainDb: 0,
    situations: ["explore", "hangout", "presentation"],
    energy: 0.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 3.8, preDelay: 0.03, lowcut: 350, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 300, highcut: 7500 });
      const echo = lofiEcho(ctx, I, out);
      const ep = epiano(ctx, { volume: 0, cutoff: 4400 });
      const comp = epiano(ctx, { volume: -7, cutoff: 3200, bark: 1.9, tine: -20 });
      const glass = glassLead(ctx, I, { volume: -1 });
      const pad = I.pad(ctx, { volume: -19, cutoff: 900, attack: 2.2, release: 3 });
      const bass = I.ebass(ctx, { volume: -4, fretless: true, base: 150 });
      const kit = I.kit(ctx, { volume: 1, kickNote: 34, preload: ["kick", "snare", "rim", "hatClosed", "hatOpen", "hatPedal", "shaker", "tom", "tambourine", "crash", "ride"] });
      const epP = I.place(ctx, ep, 0.1, out), cpP = I.place(ctx, comp, -0.3, out), glP = I.place(ctx, glass, -0.12, out);
      const pdP = I.place(ctx, pad, 0.25, out);
      I.place(ctx, bass, 0, out); const kP = I.place(ctx, kit, 0.04, out);
      I.send(ctx, epP, hall, -14); I.send(ctx, epP, echo, -15); I.send(ctx, epP, room, -16);
      I.send(ctx, cpP, room, -13); I.send(ctx, cpP, hall, -20);
      I.send(ctx, glP, hall, -10); I.send(ctx, glP, echo, -11);
      I.send(ctx, pdP, hall, -8); I.send(ctx, kP, room, -16); I.send(ctx, bass.out, room, -26);
      return {
        ep: { layer: "melody", play: (t, e, d) => ep.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.05 } },
        glass: { layer: "melody", play: (t, e, d) => glass.play(t, e, d), humanize: { timing: 0.007, vel: 0.04 } },
        comp: { layer: "harmony", play: (t, e, d) => comp.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        pad: { layer: "texture", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const pos = cycle % LAP.length, lap = Math.floor(cycle / LAP.length);
      const { sec, half } = LAP[pos];
      const plan = PLANS[lap % PLANS.length][sec];
      const secStart = half * 16; // beat within the section where this cycle starts
      const prog = TL[sec];
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(Math.max(0, Math.min(b, prog.length * 8)) ).chord; // b: beat within the section
      const nextPos = (pos + 1) % LAP.length, nextLap = nextPos === 0 ? lap + 1 : lap;
      const nextSec = LAP[nextPos].sec, nextPlan = PLANS[nextLap % PLANS.length][nextSec];
      const lastHalf = pos === LAP.length - 1 || LAP[nextPos].sec !== sec;
      const ev = [];
      // push by beat within the SECTION; converted to this cycle's bar/beat. Pickups land in bar -1.
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -4 || abs >= 16 + 1e-6) return;
        if (cycle === 0 && abs < 0) return;
        const p = C.at(abs, 4);
        ev.push({ track, bar: p.bar, beat: p.beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const inWindow = (b) => b >= secStart && b < secStart + 16; // pickups (b < 0) are emitted by the previous cycle
      const mat = MATERIAL[sec];
      const orn = [0.05, 0.28, 0.42][lap % 3] + Math.min(0.2, lap * 0.03);

      // ---------- the tune ----------
      const singTrack = plan.sing;
      const lead = mat.mel.filter(([b]) => inWindow(b));
      sing(lead, { track: singTrack, r: r.fork(1), orn, up: plan.up || 0, base: singTrack === "glass" ? 0.72 : 0.78, sym, push, horn: singTrack === "glass" });
      if (plan.double) sing(lead, { track: singTrack === "ep" ? "glass" : "ep", r: r.fork(2), orn: 0, up: plan.double, base: 0.5, sym, push, horn: singTrack !== "glass", plain: true });
      // the next section's pickup belongs to the end of this cycle (its sound is what carries us over)
      if (lastHalf) {
        const nmat = MATERIAL[nextSec];
        const pick = nmat.mel.filter(([b]) => b < 0).map(([b, d, m]) => [b + 16 + secStart, d, m]);
        if (pick.length) sing(pick, { track: nextPlan.sing, r: r.fork(3), orn: 0, up: nextPlan.up || 0, base: nextPlan.sing === "glass" ? 0.66 : 0.72, sym: () => sym(secStart + 15.9), push, horn: nextPlan.sing === "glass", plain: true });
      }

      // ---------- counter-line ----------
      if (plan.ctr && mat.ctr) {
        const ctr = mat.ctr.filter(([b]) => inWindow(b));
        const track = plan.ctr;
        for (const [b, d, m] of ctr) push(track, b, d - 0.15, m, (track === "ep" ? 0.42 : 0.4) + r.range(-0.03, 0.03), track === "glass" ? { vib: 0.6 } : {});
      }

      // ---------- comping ----------
      if (plan.comp !== "none") {
        const spans = prog.map((c) => ({ ...c, s: c.bar * 4 + c.beat })).filter((c) => c.s >= secStart - 4 && c.s < secStart + 16);
        const hits = spans.map((c) => {
          const floaty = sec === "float" || sec === "intro";
          // the right hand stays under the tune: lower in the turn (whose line dips to G#4) and under a counter-line
          const topR = sec === "turn" ? [60, 66] : sec === "B" ? [66, 72] : [64, 71];
          if (plan.ctr) { topR[0] -= 3; topR[1] -= 3; }
          const v = voiceShape(c.chord, floaty
            ? { prevTop: state.compTop, prevShape: state.compShape, lo: 57, hi: 79, top: [68, 76], r, floaty: true }
            : { prevTop: state.compTop, prevShape: state.compShape, lo: 52, hi: topR[1] + 3, top: topR, r, thin: sec === "turn" });
          state.compTop = v[v.length - 1]; state.compShape = v.shape;
          let pats = plan.comp === "sparse" ? SPARSE4 : c.dur >= 4 ? COMP4 : COMP2;
          if (c.dur < 4 && plan.comp === "sparse") pats = COMP2;
          const pat = r.weighted(pats);
          return pat.map(([b, d]) => ({ at: c.s + b, d, v }));
        });
        hits.forEach((hs, i) => {
          const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : secStart + 16 + 4;
          hs.filter((h) => h.at < nextStart - 0.45 && h.at >= secStart - 0.5).forEach((h) => {
            push("comp", h.at, Math.min(h.d, nextStart - h.at - 0.05), h.v, (plan.comp === "sparse" ? 0.36 : 0.44) + r.range(-0.04, 0.06));
          });
        });
      }

      // ---------- pad ----------
      if (plan.pad) {
        for (const c of prog) {
          const s = c.bar * 4 + c.beat;
          if (s < secStart || s >= secStart + 16) continue;
          const v = voiceShape(c.chord, { prevTop: state.padTop, lo: 58, hi: 74, top: [66, 72], r, floaty: true });
          state.padTop = v[v.length - 1];
          push("pad", s, c.dur - 0.1, v, 0.32 + (sec === "lift" ? 0.08 : 0));
        }
      }

      // ---------- bass ----------
      bassPart({ sec, plan, prog, secStart, r: r.fork(5), state, push, sym, lastHalf, nextSec, mat });

      // ---------- drums ----------
      drumPart({ sec, plan, half, secStart, r: r.fork(6), push, lastHalf, nextPlan, lap, cycle });

      const harmony = prog.filter((c) => c.bar >= half * 4 && c.bar < half * 4 + 4).map((c) => ({ ...c, bar: c.bar - half * 4 }));
      const NAMES = { intro: "Intro · over the E pedal", A: "A · the hook", A2: "A′ · and this time the ii–V is honest", B: "B · in C, the hook upside down", float: "Float · the sixth alone", lift: "Lift · up a step, in B", turn: "Turn · the backdoor home" };
      const who = plan.sing === "ep" ? "electric piano" : "glass";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${NAMES[sec]} · ${who}${plan.double ? " + octave" : plan.ctr ? ", " + plan.ctr + " answers" : ""}`, state };
    },
  });

  // ---------- performing the tune: velocity contour, lay-back, ornament; never new notes on strong beats ----------
  function sing(notes, { track, r, orn, up, base, sym, push, horn, plain }) {
    const sorted = notes.slice().sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < sorted.length; i++) {
      const [b, d, m0] = sorted[i];
      const m = m0 + up;
      const prev = i > 0 ? sorted[i - 1][2] + up : null;
      const next = i + 1 < sorted.length ? sorted[i + 1] : null;
      const leap = prev != null ? m - prev : 0;
      // contour: higher and longer a little louder; a note after an upward leap gets the weight
      let vel = base + (m - 76) / 60 + (d >= 1.5 ? 0.05 : 0) + (leap >= 7 ? 0.08 : 0) + (b % 4 === 0 ? 0.02 : -0.02) + r.gauss(0.015);
      const extra = {};
      if (horn) {
        if (leap >= 7 && d >= 1 && r.chance(0.5 + orn)) extra.scoop = r.pick([1, 2]);
        if (d >= 2 && (next == null || next[0] - (b + d) >= 0.4) && r.chance(orn * 0.8)) extra.fall = 3;
        extra.vib = d >= 2 ? 1 : 0.6;
      } else extra.delay = 0.01 + (d >= 1.5 ? 0.008 : 0); // the pianist lays back a hair
      let dur = d;
      let turned = false;
      // a 16th upper-neighbour turn at the end of a long note (only where the next note is not that neighbour)
      if (!plain && d >= 1.5 && next && next[0] === b + d && r.chance(orn)) {
        const scale = T.chord(sym(b + d - 0.5)).scale;
        const upN = T.step(m, 1, scale);
        if (upN - m <= 2 && next[2] + up !== upN) {
          dur = d - 0.5;
          push(track, b + d - 0.5, 0.25, upN, vel * 0.8, { ...extra, scoop: undefined, fall: undefined });
          push(track, b + d - 0.25, 0.25, m, vel * 0.85, { ...extra, scoop: undefined, fall: undefined });
          turned = true;
        }
      }
      // a grace note from below on a note that arrives by leap
      if (!plain && !horn && leap >= 5 && r.chance(orn * 0.7)) {
        push(track, b - 0.125, 0.12, T.step(m, -1, T.chord(sym(b)).scale), vel * 0.5, { delay: 0 });
      }
      push(track, b, Math.max(0.2, dur * (horn ? 0.95 : 0.92)), m, vel, turned ? { ...extra, fall: undefined } : extra);
    }
  }

  // ---------- bass ----------
  function bassPart({ sec, plan, prog, secStart, r, state, push, sym, lastHalf, nextSec, mat }) {
    const lo = 33, hi = 52;
    const chords = prog.map((c) => ({ ...c, s: c.bar * 4 + c.beat }));
    const nextRootOf = (i) => {
      if (i + 1 < chords.length) return T.chord(chords[i + 1].chord).bass;
      return T.chord(TL[nextSec][0].chord).bass;
    };
    if (plan.bass === "counter" && mat.ctr) { // the bass sings the counter-line two octaves down
      for (const [b, d, m] of mat.ctr) {
        if (b < secStart || b >= secStart + 16) continue;
        const note = Math.max(31, m - 24);
        push("bass", b, d - 0.2, note, 0.8);
        if (d >= 4 && r.chance(0.6)) push("bass", b + 2.5, 0.5, note + (r.chance(0.5) ? 12 : 7), 0.5); // an octave or fifth flick
        state.bassLast = note;
      }
      return;
    }
    if (plan.bass === "line" && sec === "float") { // the bass plays the planing sixths, three octaves down
      for (const [b, d, m] of MEL_FLOAT) {
        if (b < secStart || b >= secStart + 16) continue;
        push("bass", b, d - 0.1, Math.max(31, m - 36), d > 1 ? 0.82 : 0.62);
      }
      for (let bar = 0; bar < 4; bar++) { // the pedal still marks each bar
        const s = secStart + bar * 4;
        const root = T.chord(sym(s)).bass;
        push("bass", s, 1.2, T.nearest(40, [root], 33, 46), 0.7);
      }
      state.bassLast = 40;
      return;
    }
    let last = state.bassLast ?? 40;
    chords.forEach((c, i) => {
      if (c.s < secStart || c.s >= secStart + 16) return;
      const ch = T.chord(c.chord);
      const root = T.nearest(last, [ch.bass], lo, 46);
      const nextRoot = T.nearest(root, [nextRootOf(i)], lo, 46);
      const fifth = T.nearest(root + 7, [mod12(ch.root + (ch.intervals.find((x) => x >= 6 && x <= 8) ?? 7))], lo, hi);
      const third = ch.intervals.includes(3) || ch.intervals.includes(4) ? T.nearest(root + 4, [mod12(ch.root + (ch.intervals.includes(3) ? 3 : 4))], lo, hi) : fifth;
      const colour = T.nearest(root + 9, [ch.colors[0] ?? mod12(ch.root + 7)], root + 2, hi); // colors are pitch classes
      const skip = state.bassAntic; // the root already arrived a 16th early
      state.bassAntic = false;
      if (plan.bass === "pedal" || ch.bass !== ch.root) { // slash chords and the float: sit on the pedal
        const p = T.nearest(40, [ch.bass], 33, 46);
        if (!skip) push("bass", c.s, Math.min(c.dur, 2.4), p, 0.8);
        if (c.dur >= 4) {
          const cell = r.weighted([[0, 3], [1, 2], [2, 1.5]]);
          if (cell === 0) { push("bass", c.s + 2.5, 0.5, p + 12, 0.45); push("bass", c.s + 3.5, 0.5, p, 0.55); }
          else if (cell === 1) { push("bass", c.s + 3, 0.5, fifth, 0.5); push("bass", c.s + 3.5, 0.5, p, 0.55); }
          else { push("bass", c.s + 2.5, 1.5, p, 0.5); }
        }
        last = p;
        return;
      }
      // approach note into the next root
      const chrom = plan.pad ? 1.2 : 3; // chromatic approaches rub against a held pad, so lean diatonic there
      const approach = () => r.weighted([[nextRoot - 1, chrom], [nextRoot + 1, chrom * 0.6], [nextRoot + 2, 2], [T.nearest(nextRoot + 7, [mod12(nextRootOf(i) + 7)], lo, hi), 2], [fifth, 1]]);
      if (c.dur < 4) { // two-beat chord
        if (!skip) push("bass", c.s, 1.4, root, 0.82);
        push("bass", c.s + 1.5, 0.45, approach(), 0.6);
        last = root;
        return;
      }
      const busy = sec === "lift" || plan.drums === "b";
      const cell = r.weighted([["a", 3], ["b", 2.5], ["c", 2], ["d", skip ? 0 : busy ? 2.5 : 1.2], ["e", busy ? 2 : 0.8], ["f", busy ? 2.5 : 1.2]]);
      const vr = 0.84, vs = 0.62;
      if (!skip) push("bass", c.s, cell === "c" ? 2.4 : 1.4, root, vr);
      if (cell === "a") { push("bass", c.s + 1.5, 0.45, fifth, vs); push("bass", c.s + 2, 1.4, root, vr - 0.06); push("bass", c.s + 3.5, 0.45, approach(), vs); }
      else if (cell === "b") { push("bass", c.s + 1.5, 0.45, third, vs); push("bass", c.s + 2, 0.9, root, vr - 0.08); push("bass", c.s + 3, 0.45, colour, vs); push("bass", c.s + 3.5, 0.45, approach(), vs); }
      else if (cell === "c") { push("bass", c.s + 2.5, 0.9, fifth, vs + 0.05); push("bass", c.s + 3.5, 0.45, approach(), vs); }
      else if (cell === "d") { // the next root arrives a 16th early
        push("bass", c.s + 1.5, 0.45, fifth, vs); push("bass", c.s + 2, 1.2, root, vr - 0.06); push("bass", c.s + 3.25, 0.4, root + 12 <= hi ? root + 12 : fifth, vs - 0.1);
        push("bass", c.s + 3.75, 1.5, nextRoot, vr - 0.04); state.bassAntic = true;
      } else if (cell === "f") { // a rising arpeggio to the ninth, the fretless singing
        push("bass", c.s + 1.5, 0.45, third, vs); push("bass", c.s + 2, 0.45, fifth, vs + 0.04); push("bass", c.s + 2.5, 0.9, colour < root + 7 && colour + 12 <= hi ? colour + 12 : colour, vs + 0.08); push("bass", c.s + 3.5, 0.45, approach(), vs);
      } else { // e: ghosted 16ths
        push("bass", c.s + 0.75, 0.2, root, 0.3); push("bass", c.s + 1.5, 0.45, fifth, vs); push("bass", c.s + 2, 0.45, root, vr - 0.1); push("bass", c.s + 2.75, 0.2, root, 0.3); push("bass", c.s + 3, 0.45, colour, vs); push("bass", c.s + 3.5, 0.45, approach(), vs);
      }
      last = root;
    });
    state.bassLast = last; // bassAntic carries into the next section's first chord
  }

  // ---------- drums ----------
  function drumPart({ sec, plan, half, secStart, r, push, lastHalf, nextPlan, lap, cycle }) {
    const style = plan.drums;
    const hat = (b, v) => push("drums", b, 0.1, "hatClosed", v);
    for (let bar = 0; bar < 4; bar++) {
      const s = secStart + bar * 4;
      const secBar = half * 4 + bar;
      const finalBar = lastHalf && bar === 3;
      const fill = finalBar && (sec !== "intro" || lap > 0) && r.chance(sec === "float" || sec === "turn" ? 0.5 : 0.85);
      if (style === "float") {
        for (let e = 0; e < 8; e++) hat(s + e * 0.5, e % 2 ? 0.2 : 0.3);
        push("drums", s + 1, 0.1, "hatPedal", 0.35); push("drums", s + 3, 0.1, "hatPedal", 0.35);
        if (lap > 0 || sec === "float") push("drums", s, 0.1, "kick", 0.45);
        if (lap > 0 && r.chance(0.5)) push("drums", s + 2, 0.1, "rim", 0.4);
        if (sec === "float" && r.chance(0.35)) push("drums", s + 2.5 + r.pick([0, 0.5, 1]), 0.1, "ride", 0.3);
      } else {
        // hats: 8ths, a 16th ghost here and there, open hat at the "and of 4" on even bars
        for (let e = 0; e < 8; e++) {
          const b = s + e * 0.5;
          if (e === 7 && secBar % 2 === 1 && (style !== "head" || r.chance(0.5)) && !fill) push("drums", b, 0.25, "hatOpen", 0.42);
          else if (!(fill && e >= 5)) hat(b, e % 2 ? 0.24 : 0.36);
          if (!fill && (e === 1 || e === 5) && r.chance(style === "head" ? 0.3 : 0.5)) hat(b + 0.25, 0.16);
        }
        // backbeat
        const back = style === "head" || style === "turn" ? "rim" : "snare";
        const bv = style === "head" ? 0.62 : style === "lift" ? 0.68 : 0.55;
        push("drums", s + 1, 0.1, back, bv);
        if (!fill) push("drums", s + 3, 0.1, back, bv);
        if (style !== "head" && r.chance(0.25)) push("drums", s + 1.75, 0.1, "rim", 0.22); // ghost
        if (style === "lift" && r.chance(0.3)) push("drums", s + 3.75, 0.1, "snare", 0.25);
        // kick: one of a few cells per bar, the downbeat always
        const kc = r.weighted([[[0, 1.5, 2.5], 3], [[0, 2.5], 2], [[0, 1.5, 3], 1.5], [[0, 1.75, 2.5], style === "head" ? 0.6 : 1.5], [[0, 1.5], 1]]);
        kc.forEach((k, i) => push("drums", s + k, 0.1, "kick", i === 0 ? 0.85 : 0.62));
        if (r.chance(style === "lift" ? 0.5 : 0.2)) push("drums", s + 3.75, 0.1, "kick", 0.42);
        // aux
        if (style === "b") for (let q = 0; q < 16; q++) push("drums", s + q * 0.25, 0.08, "shaker", q % 4 === 0 ? 0.36 : q % 2 ? 0.17 : 0.25);
        if (style === "lift") { push("drums", s + 1, 0.1, "tambourine", 0.32); push("drums", s + 3, 0.1, "tambourine", 0.32); }
        if (style === "turn" && bar >= 2) for (let q = 0; q < 16; q += 2) push("drums", s + q * 0.25, 0.08, "shaker", q % 4 === 0 ? 0.3 : 0.2);
      }
      if (fill) {
        const kind = r.weighted([["toms", 2], ["snare", 2], ["mixed", 1.5]]);
        const pos = r.pick([[2.5, 2.75, 3, 3.25, 3.5, 3.75], [3, 3.25, 3.5, 3.75], [2, 2.5, 3, 3.5, 3.75]]);
        pos.forEach((p, i) => {
          const last = i === pos.length - 1;
          const voice = kind === "toms" ? "tom" : kind === "snare" ? "snare" : i % 2 ? "tom" : "snare";
          push("drums", s + p, 0.1, voice, 0.4 + i * 0.07, voice === "tom" ? { pitch: last ? 41 : r.pick([45, 48, 52]) } : {});
        });
      }
      if (cycle > 0 && half === 0 && bar === 0 && plan.crash) push("drums", s, 0.3, "crash", 0.55); // arrival
    }
  }
})();

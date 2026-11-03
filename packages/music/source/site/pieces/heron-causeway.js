// Heron Causeway: the overworld theme. A raised road across a tidal marsh at first light, the hill town ahead,
// herons standing in the shallows; the tune the player hears most and should never tire of. G major, 112 bpm,
// 4/4. Stately, hopeful, a little bittersweet (the borrowed iv at the end of every A, the Eb detour in B).
//
// THE CONSOLE (Sim.spc): one 8-voice chip with its lo-fi output stage and the short dark echo. Brass, pad (3),
// pluck (2), bass, kick, snare, hat and tom are chip voices and fight for the eight slots (the budget is applied
// at compose time too, so the score shows what the chip plays). The flute lead is a phrased mono synth
// (Sim.phrasing.wrap: scoops, slurs, late vibrato, breaths) mixed into the chip's bus and echo, so it shares the
// chip's sound without its allocator. Sim.dialogue hands the tune to the brass (answers in the rests, phrase
// sharing on the return, a counter-line kept below in B). Sim.groove sets the feel (laid-back snare, pushed
// hats, the bass a hair late), gives the flute rubato, and plays the ritardando and fermata into the loop.
//
// THE HOOK (A, 8 bars, written by hand; the generator never changes a pitch or a rhythm, only who plays it,
// the ornaments and the dynamics). Phrasing marks: ^ scoop  ~ slur  v vibrato  > accent  f fall.
//   | Gmaj7          | Cmaj9              | Em7            | Am7      D7      | Bm7            | E7                 | Am7     Cm6     | Gmaj7/D   D7       |
//   | G5 A5 B5 D6--  | C6 B5 A5 G5 .     | B5 A5 G5 E5-- | E5 F#5 G5 A5 .  | B5 A5 B5 D6-- | E6 D6 B5 G#5 .    | A5 G5 F#5 Eb5--| D5 E5 F#5 A5 (D5) |
//   bar 1  the motif: two steps up and a leap to the fifth, held (1 . .5 .5 2).
//   bar 2  the motif's tail turned over: stepwise down to G, a breath.
//   bar 3  the motif INVERTED: two steps down and a leap down to E, the relative minor.
//   bar 4  a rising answer to the half cadence, open.
//   bar 5  the motif DISPLACED: the same rhythm with a neighbour note instead of the climb, up on the mediant.
//   bar 6  the peak E6 falls to G#, the third of E7 (V/ii): the one sharp in the tune.
//   bar 7  the motif rhythm once more, falling onto Eb over the borrowed iv (Cm6): the bittersweet bar.
//   bar 8  up through D E F# to the fifth, and the pickup D5 into the repeat. A3 ends on G#5 over E7 (the pivot
//          to A); the last return (A4) is the whole tune a step up in A major, closed on the tonic.
//
// B (8 bars): long notes, the motif inverted and augmented; the second half goes to Eb (bVI) and comes home
// through Fm9 and the borrowed iv (Cm7) to D7:
//   | Em9 | Bm7 | Cmaj9 | D7sus4 D7 | Ebmaj7 | Fm9 | Cm7 | D7sus4 D7 |
//   | E5 F#5 G5 B5 | A5 G5 F#5-- | E5 F#5 G5 C6 | A5 B5 A5 F#5 . | G5 F5 Eb5 Bb5-- | Ab5 G5 F5 C6-- | Bb5 G5 Eb5 D5 | D5 E5 F#5 A5 (D5) |
//   brass counter-line (half notes): G4 F#4 | D4 B3 | E4 G4 | A4 C5 | Bb4 G4 | F4 Ab4 | G4 Eb4 | D4 C5
// TAG (4 bars, in A, turning back to G for the loop): | Amaj9 | Dmaj7/A | Bm7 Cmaj7 | D7sus4 D7 (fermata) |
//   | C#6 B5 A5 E5-- | F#5 E5 D5 A5-- | D5 E5 F#5 G5-- | A5 G5 F#5---- |
//
// FORM (one lap, 12 cycles of 4 bars, about 1:45): intro 4 (arpeggio over a D pedal) · A 8 · A 8 (the brass
// echoes the last two notes of every phrase in the rests) · B 8 · A′ 8 (flute and brass take phrases in turn,
// pivot to A) · A″ 8 in A major (tutti, brass doubling the second half an octave down, closed) · tag 4
// (ritardando, fermata on D7, then a tempo into the intro). Laps rotate who shares what, the drum weight and
// the ornaments; the tune itself never changes.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove, S = Sim.spc;
  const BPB = 4, CB = 4, CYC = BPB * CB, BPM = 112;
  const VOICES = 8;
  // the hat outranks the pluck: when the chip is full the hat clips a pluck tail (already decayed) instead of vanishing
  const PRI = { lead: 7, bass: 6, kick: 5, snare: 5, brass: 4, pad: 4, tom: 4, hat: 2, pluck: 1 };
  // the pad is three voices and hears 7ths, not 9ths: a 9th a semitone from the 3rd is harsh in a three-note chip chord
  const padSym = (sym) => sym.replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/69/, "6");

  // ---------- harmony ----------
  const CH = {
    intro: "| Gmaj7/D | Cmaj9/D | Gmaj7/D | D7sus4 |",
    A: "| Gmaj7 | Cmaj9 | Em7 | Am7 D7 | Bm7 | E7 | Am7 Cm6 | Gmaj7/D D7 |",
    A3: "| Gmaj7 | Cmaj9 | Em7 | Am7 D7 | Bm7 | E7 | Am7 Cm6 | Gmaj7/D E7 |",
    A4: "| Amaj7 | Dmaj9 | F#m7 | Bm7 E7 | C#m7 | F#7 | Bm7 Dm6 | E7 A69 |",
    B: "| Em9 | Bm7 | Cmaj9 | D7sus4 D7 | Ebmaj7 | Fm9 | Cm7 | D7sus4:1 D7:3 |",
    tag: "| Amaj9 | Dmaj7/A | Bm7 Cmaj7 | D7sus4 D7 |",
  };
  CH.A2 = CH.A;
  const TL = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- the tunes (Sim.phrasing notation, one string per bar) ----------
  const A7 = [
    "G5/1^ A5/0.5~ B5/0.5~ D6/2~v",
    "C6/0.5 B5/0.5~ A5/1~ G5/1~ r/1",
    "B5/1 A5/0.5~ G5/0.5~ E5/2~v",
    "E5/0.5 F#5/0.5~ G5/1~ A5/1~ r/1",
    "B5/1^ A5/0.5~ B5/0.5~ D6/2~v",
    "E6/0.5> D6/0.5~ B5/1~ G#5/1~ r/1",
    "A5/1 G5/0.5~ F#5/0.5~ Eb5/2~v",
  ];
  const A_END = {
    open: "D5/0.5 E5/0.5~ F#5/1~ A5/1.5~v D5/0.5",
    toA: "D5/0.5 E5/0.5~ F#5/1~ G#5/1.5~v E5/0.5",
    closed: "D5/0.5 E5/0.5~ F#5/1~ G5/2~v",
  };
  const TUNE = {
    intro: ["r/4", "r/4", "r/4", "r/3.5 D5/0.5"],
    A: A7.concat([A_END.open]),
    A2: A7.concat([A_END.open]),
    A3: A7.concat([A_END.toA]),
    A4: A7.concat([A_END.closed]), // transposed up a step in code
    B: [
      "E5/1.5^ F#5/0.5~ G5/1~ B5/1~v",
      "A5/1.5 G5/0.5~ F#5/2~v",
      "E5/1.5 F#5/0.5~ G5/1~ C6/1~v",
      "A5/1.5 B5/0.5~ A5/0.5~ F#5/1~ r/0.5",
      "G5/1^ F5/0.5~ Eb5/0.5~ Bb5/2~v",
      "Ab5/1 G5/0.5~ F5/0.5~ C6/2~v",
      "Bb5/1.5 G5/0.5~ Eb5/1~ D5/1~",
      "D5/0.5 E5/0.5~ F#5/1~ A5/1.5~v D5/0.5",
    ],
    tag: [
      "C#6/1 B5/0.5~ A5/0.5~ E5/2~v",
      "F#5/1 E5/0.5~ D5/0.5~ A5/2~v",
      "D5/1 E5/0.5~ F#5/0.5~ G5/2~v",
      "A5/1.5 G5/0.5~ F#5/2~vf",
    ],
  };
  const KEY = { A4: 2 }; // semitones up
  // phrase marks, beats from the section start. A pickup into the next section is its own tiny phrase (a breath before it).
  const PHR_A = [
    { from: 0, to: 8, dyn: "arch", legato: true, breath: false },
    { from: 8, to: 16, dyn: "arch", legato: true },
    { from: 16, to: 24, dyn: "<", legato: true },
    { from: 24, to: 31.5, dyn: ">", legato: true },
    { from: 31.5, to: 32.1, breath: true },
  ];
  const PHR = {
    intro: [{ from: 15.5, to: 16.1, breath: true }],
    A: PHR_A, A2: PHR_A, A3: PHR_A,
    A4: PHR_A.slice(0, 3).concat([{ from: 24, to: 32.1, dyn: ">", legato: true }]),
    B: [
      { from: 0, to: 8, dyn: "<", legato: true, breath: false },
      { from: 8, to: 16, dyn: ">", legato: true },
      { from: 16, to: 24, dyn: "arch", legato: true },
      { from: 24, to: 31.5, dyn: ">", legato: true },
      { from: 31.5, to: 32.1, breath: true },
    ],
    tag: [
      { from: 0, to: 4, dyn: "arch", legato: true },
      { from: 4, to: 8, dyn: "arch", legato: true },
      { from: 8, to: 16, dyn: ">", legato: true },
    ],
  };
  const SHARE = [[0, 8], [8, 16], [16, 24], [24, 31.5], [31.5, 32.1]];
  // the B counter-line for the brass: "Note at dur"
  const B_CNT = "G4 0 2, F#4 2 2, D4 4 2, B3 6 2, E4 8 2, G4 10 2, A4 12 2, C5 14 2, Bb4 16 2, G4 18 2, F4 20 2, Ab4 22 2, G4 24 2, Eb4 26 2, D4 28 2, C5 30 2"
    .split(",").map((tok) => { const [n, b, d] = tok.trim().split(/\s+/); return { at: +b, dur: +d, note: T.midi(n), vel: 0.5 }; });

  // ---------- form ----------
  const FORM = [["intro", 4], ["A", 8], ["A2", 8], ["B", 8], ["A3", 8], ["A4", 8], ["tag", 4]];
  const LAP = [];
  FORM.forEach(([sec, bars]) => { for (let h = 0; h < bars / CB; h++) LAP.push({ sec, half: h, last: h === bars / CB - 1 }); });
  const LAP_CYCLES = LAP.length; // 12
  const LEADV = { track: "lead", range: [72, 92] };
  const BRASSV = { track: "brass", range: [55, 79], gain: 0.9 };
  // arrangement plans, rotating per lap. share: flute and brass take phrases in turn (order per phrase);
  // answers: the brass echoes phrase tails in the rests; dbl: brass doubles bars 5-8 an octave down; counter: the B line.
  const PLAN = [
    {
      intro: { drums: "light", pluck: 1, pad: 1 },
      A: { drums: "march", pluck: 1, pad: 1 },
      A2: { drums: "march", pluck: 1, pad: 1, answers: 1, hats16: 1 },
      B: { drums: "full", pluck: 1, pad: 1, counter: 1 },
      A3: { drums: "full", pluck: 1, pad: 1, share: 1, order: ["lead", "brass", "lead", "brass", "lead"], arrive: 1 },
      A4: { drums: "big", pluck: 1, pad: 1, dbl: 1, arrive: 1 },
      tag: { drums: "light", pluck: 1, pad: 1 },
    },
    {
      intro: { drums: "march", pluck: 1, pad: 1 },
      A: { drums: "full", pluck: 1, pad: 1, answers: 1 },
      A2: { drums: "march", pluck: 0, pad: 1, share: 1, order: ["brass", "lead", "brass", "lead", "lead"] },
      B: { drums: "full", pluck: 1, pad: 1, counter: 1 },
      A3: { drums: "full", pluck: 1, pad: 1, dbl: 1, arrive: 1 },
      A4: { drums: "big", pluck: 1, pad: 1, dbl: 1, answers: 1, arrive: 1 },
      tag: { drums: "light", pluck: 1, pad: 1 },
    },
    {
      intro: { drums: "light", pluck: 1, pad: 1 },
      A: { drums: "march", pluck: 1, pad: 1, share: 1, order: ["lead", "lead", "brass", "lead", "lead"] },
      A2: { drums: "full", pluck: 1, pad: 1, answers: 1, hats16: 1 },
      B: { drums: "full", pluck: 1, pad: 1, counter: 1 },
      A3: { drums: "full", pluck: 1, pad: 1, share: 1, order: ["brass", "lead", "lead", "brass", "lead"], arrive: 1 },
      A4: { drums: "big", pluck: 1, pad: 1, dbl: 1, arrive: 1 },
      tag: { drums: "light", pluck: 1, pad: 1 },
    },
  ];
  const NAME = {
    intro: "Intro · the arpeggio over the D pedal", A: "A · the causeway tune", A2: "A · the brass echoes the rests",
    B: "B · long notes, then the Eb detour", A3: "A′ · flute and brass in turn, pivot to A", A4: "A″ · in A major, tutti",
    tag: "Tag · ritardando, fermata on D7",
  };
  const ARPS = [[0, 1, 2, 3, 2, 1, 0, 2], [0, 2, 1, 3, 2, 0, 1, 3], [0, 1, 2, 1, 3, 2, 1, 2], [0, 1, 3, 2, 1, 3, 2, 1]];
  // the lead's phrasing fields, copied onto cycle events
  const ART_FIELDS = ["legato", "glide", "staccato", "tenuto", "accent", "scoop", "fall", "bend", "bendTime", "vib", "trem", "swell", "breath", "phraseStart", "phraseEnd", "delay", "grace", "mordent"];

  // ---------- tempo: a ritardando through the tag, a tempo for the intro ----------
  const tempoAt = G.tempoScript(BPM, [G.ritardando(LAP_CYCLES - 1, 96, 14), G.aTempo(0, BPM)]);

  // ---------- the lead line of one section, phrased ----------
  function buildLine(sec, lap, scaleAt, rr) {
    const k = KEY[sec] || 0;
    const line = P.line(TUNE[sec], { beatsPerBar: BPB, track: "lead" });
    const orn = [0.1, 0.3, 0.45][lap % 3] * (sec === "intro" ? 0 : 1);
    line.forEach((e, i) => {
      e.note += k;
      const prev = line[i - 1];
      const leap = prev && prev.bar === e.bar ? e.note - prev.note : 0;
      const a = P.parseArt(e.art || "");
      e.vel = 0.72 + (e.note - 80) / 120 + (e.dur >= 2 ? 0.04 : 0) + (a.accent ? 0.03 : 0) + rr.gauss(0.012);
      if (!a.scoop && !a.accent && !a.staccato && sec !== "tag") {
        if (leap >= 4 && e.dur >= 1 && rr.chance(orn * 0.6)) e.grace = "step";
        else if (e.dur >= 2 && rr.chance(orn * 0.35)) e.mordent = true;
        else if (e.dur >= 1.5 && leap >= 3 && rr.chance(orn * 0.4)) e.scoop = 1;
      }
    });
    const raw = line.map((e) => ({ bar: e.bar, beat: e.beat, dur: e.dur, note: e.note, vel: e.vel, at: e.bar * BPB + e.beat }));
    const art = P.articulate(line, PHR[sec], { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.08, breathLate: 0.03, breathGap: 0.12 });
    return { art, raw };
  }
  const ANSWER_PHRASES = [[0, 8], [8, 16], [16, 24], [24, 32.1]];

  /** Everything hand-written for one section of one lap, routed to tracks; `at` in beats from the section start. */
  function planSection(sec, lap, r) {
    const prog = TL[sec];
    const bars = FORM.find((f) => f[0] === sec)[1];
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.max(0, Math.min(b, bars * BPB - 0.01))).chord).scale;
    const plan = PLAN[lap % PLAN.length][sec];
    const { art, raw } = buildLine(sec, lap, scaleAt, r.fork(3));
    const tune = art.map((e) => ({ ...e, at: e.bar * BPB + e.beat }));
    const notes = [];
    if (plan.share) notes.push(...D.distribute(tune, { voices: [LEADV, BRASSV], mode: "phrase", order: plan.order, phrases: SHARE, rng: r, bpb: BPB }));
    else notes.push(...tune.map((n) => ({ ...n, track: "lead" })));
    if (plan.answers) {
      // the brass echoes the last two notes of each phrase, as 8ths an octave down, in the one-beat rest before the next
      // (from the tune as written: the phrased copy lengthens its last notes and closes the rests)
      notes.push(...D.respond(raw, {
        track: "brass", transform: [{ tail: 2 }, { even: 0.5 }, { transpose: -12 }], phrases: ANSWER_PHRASES, minGap: 1, gap: 0, scaleAt,
        range: [52, 76], vel: 0.56, breath: 0, end: bars * BPB, bpb: BPB,
      }));
    }
    if (plan.counter) notes.push(...D.separate(tune, B_CNT, { range: [50, 76], prefer: "below", min: 3, bpb: BPB }).map((n) => ({ ...n, track: "brass" })));
    if (plan.dbl) {
      notes.push(...tune.filter((n) => n.at >= 16 && n.at < 31.5 && !n.grace).map((n) => ({ ...n, track: "brass", note: n.note - 12, vel: (n.vel ?? 0.7) * 0.82, breath: undefined, mordent: undefined, grace: undefined })));
    }
    return { prog, notes, arp: r.pick(ARPS), plan };
  }

  Sim.register({
    id: "heron-causeway",
    title: "Heron Causeway",
    genre: "Overworld theme",
    about: "The overworld theme: a raised road across a tidal marsh at first light, the hill town ahead. A hand-written G-major tune (a motif that returns inverted and displaced, a secondary dominant, the borrowed iv at the end of every A, a B section that detours through Eb and comes home, the last return a step up in A major) on a phrased flute over an eight-voice SNES chip: brass, glass pad, plucked arpeggio, bass and drums fight for the slots and share the dark short echo. The brass echoes the flute's rests, takes phrases in turn and doubles the finale; the feel is laid back, the flute floats, and the tag slows to a fermata before the loop.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["explore", "hangout", "presentation"],
    energy: 0.5,

    instruments(ctx) {
      const chip = S.chip(ctx, { voices: VOICES, bits: 8, rate: 32000, tone: 7600, echo: { time: 0.16, feedback: 0.42, tone: 2600, level: -8 } });
      const brass = chip.voice("brass", { priority: PRI.brass, echo: 0.35, pan: -0.25, volume: -4, cutoff: 3200 });
      const pad = chip.voice("pad", { poly: 3, priority: PRI.pad, echo: 0.3, pan: 0.15, volume: -9, cutoff: 2800 });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRI.pluck, echo: 0.5, pan: 0.3, volume: -7 });
      const bass = chip.voice("bass", { priority: PRI.bass, echo: 0.1, pan: 0, volume: -3 });
      const kick = chip.voice("kick", { priority: PRI.kick, volume: 1, note: 40 });
      const snare = chip.voice("snare", { priority: PRI.snare, echo: 0.22, pan: 0.05, volume: -1 });
      const hat = chip.voice("hat", { priority: PRI.hat, pan: -0.2, volume: -6 });
      const tom = chip.voice("tom", { priority: PRI.tom, echo: 0.25, pan: 0.2, volume: 0 });
      const drumV = { kick, snare, hat, tom };
      // the flute: a soft-partial mono synth, phrased by the wrapper, mixed into the chip's bus and echo
      const fl = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.22, 0.08, 0.03, 0.01] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
        envelope: { attack: 0.04, decay: 0.15, sustain: 0.85, release: 0.18 },
        filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.2, baseFrequency: 1200, octaves: 1.6 },
      }));
      const lead = P.wrap(ctx, fl, {
        volume: -6, glide: 0.05, scoopTime: 0.08, fallTime: 0.22, release: 0.18,
        vibrato: { rate: 5.3, depth: 0.1, delay: 0.3, rise: 0.4, deepen: 1.3 },
        breath: P.breath(ctx, chip.bus, { level: -27, freq: 2600, length: 0.16 }),
      });
      const leadPan = ctx.keep(new Tone.Panner(0.08)).connect(chip.bus);
      lead.out.connect(leadPan);
      const leadEcho = ctx.keep(new Tone.Gain(0.4)).connect(chip.echo);
      leadPan.connect(leadEcho);
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.005, vel: 0.04 } },
        brass: { layer: "melody", play: (t, e, d) => brass.play(t, e, d), humanize: { timing: 0.008, vel: 0.05 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e, d), humanize: { timing: 0.015, vel: 0.03 } },
        pluck: { layer: "texture", play: (t, e, d) => pluck.play(t, e, d), humanize: { timing: 0.006, vel: 0.08 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e, d), humanize: { timing: 0.004, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e, d) => { const v = drumV[e.note]; if (v) v.play(t, { ...e, note: null }, d); }, humanize: { timing: 0.004, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const cl = cycle % LAP_CYCLES, lap = Math.floor(cycle / LAP_CYCLES);
      const { sec, half, last: lastHalf } = LAP[cl];
      const key = `${sec}:${lap}`;
      if (!state.sec || state.sec.key !== key) state.sec = { key, ...planSection(sec, lap, r.fork(1 + lap)) };
      const { notes, prog, arp, plan } = state.sec;
      const secStart = half * CYC;
      const nextCl = (cl + 1) % LAP_CYCLES, nextSec = LAP[nextCl].sec, nextLap = nextCl === 0 ? lap + 1 : lap;
      const nextPlan = PLAN[nextLap % PLAN.length][nextSec];
      let ev = [];
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const rel = secBeat - secStart;
        if (rel < -1e-6 || rel >= CYC - 1e-6) return;
        const bar = Math.floor(rel / BPB + 1e-9), beat = +(rel - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---------- the hand-written lines (flute and brass) ----------
      for (const n of notes) {
        if (n.at < secStart - 1e-6 || n.at >= secStart + CYC - 1e-6) continue;
        const extra = {};
        for (const f of ART_FIELDS) if (n[f] !== undefined) extra[f] = n[f];
        if (n.track === "brass") { // the chip voice reads a pitch envelope, not phrasing marks
          delete extra.bend;
          if (extra.scoop) extra.bend = { cents: -100 * extra.scoop, time: 0.07 };
        }
        push(n.track, n.at, n.dur, n.note, n.vel ?? 0.7, extra);
      }

      // ---------- harmony: pad and pluck ----------
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= secStart - 1e-6 && c.s < secStart + CYC - 1e-6);
      const quiet = sec === "intro" || sec === "tag";
      for (const c of spans) {
        const secBar = c.bar;
        if (plan.pad) {
          // two voices (the guide tones) when the brass is busy too, so the chip has room; the slash chords keep
          // their bass note in the pad (B D F# over the D pedal rather than B F# G)
          const n = plan.dbl || plan.counter ? 2 : 3;
          const v = T.voice(padSym(c.chord), { lo: 55, hi: 74, n, prev: state.padV, rng: r, omitBass: false, top: [64, 72] });
          state.padV = v;
          push("pad", c.s, c.dur - 0.1, v, quiet ? 0.46 : sec === "A4" ? 0.56 : 0.52);
        }
        const dropArp = sec === "B" && (secBar === 4 || secBar === 5);
        if (plan.pluck && !dropArp) {
          const v = T.voice(c.chord, { lo: 55, hi: 79, n: 4, prev: state.arpV, rng: r, omitBass: true, spread: "close" }).slice().sort((a, b) => a - b);
          state.arpV = v;
          const n8 = Math.round(c.dur * 2);
          for (let i = 0; i < n8; i++) {
            const m = v[arp[i % arp.length] % v.length];
            push("pluck", c.s + i * 0.5, 0.4, m, (i % 2 ? 0.34 : 0.44) + (i === 0 ? 0.06 : 0) + (quiet ? -0.04 : 0));
          }
        }
      }

      // ---------- bass ----------
      const after = prog.find((x) => x.bar * BPB + x.beat >= secStart + CYC - 1e-6);
      const nextFirst = after ? after.chord : TL[nextSec][0].chord;
      bassPart({ spans, plan, nextFirst, r: r.fork(5), push, sec });

      // ---------- drums ----------
      drumPart({ sec, plan, half, secStart, r: r.fork(6), push, lastHalf, nextPlan, lap, cycle });

      // ---------- feel: groove templates, ghosts, rubato, the fermata ----------
      ev = G.ghosts(ev, { track: "drums", vel: 0.22, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { snare: { template: "laidback", amount: 0.7 }, hat: "pushed", kick: "straight", tom: "straight" } },
          bass: { template: "boogie", late: 3, vels: false },
          pluck: { template: "mpc54", late: 5 },
          brass: { template: "straight", late: 10, vels: false },
          pad: { template: "straight", late: 6, vels: false },
        },
      });
      ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: sec === "tag" ? 0.8 : sec === "B" ? 0.55 : 0.4, linger: sec === "B" ? "both" : "high", rng: r });
      if (sec === "tag") ev = G.hold(ev, { bar: 3, beat: 2, extra: 2, tracks: ["pad", "lead", "bass", "brass"] });

      // ---------- the chip's voice budget, applied to the score (the flute is outside the allocator) ----------
      const bud = S.budget(ev.filter((e) => e.track !== "lead"), { voices: VOICES, bpb: BPB, priority: PRI });
      state.stolen = (state.stolen || 0) + bud.stolen; state.dropped = (state.dropped || 0) + bud.dropped;
      const events = bud.events.concat(ev.filter((e) => e.track === "lead"));

      const harmony = prog.filter((c) => c.bar >= half * CB && c.bar < half * CB + CB).map((c) => ({ ...c, bar: c.bar - half * CB }));
      const extras = [plan.share ? "shared" : "", plan.answers ? "brass answers" : "", plan.dbl ? "brass doubles" : "", plan.counter ? "counter-line" : ""].filter(Boolean).join(", ");
      return { events, harmony, section: `Lap ${lap + 1} · ${NAME[sec]}${extras ? " · " + extras : ""}`, state, tempo: tempoAt(cl) };
    },
  });

  // ---------- bass: roots on the downbeats, the fifth on 3, an approach into the next root ----------
  function bassPart({ spans, plan, nextFirst, r, push, sec }) {
    const style = plan.drums;
    const LO = 36, HI = 52;
    spans.forEach((c, i) => {
      const ch = T.chord(c.chord);
      const root = T.nearest(42, [ch.bass], 36, 47);
      const fifth = T.nearest(root + 7, [T.mod12(ch.root + 7)], LO, HI);
      const nextSym = i + 1 < spans.length ? spans[i + 1].chord : nextFirst;
      const nextRoot = T.nearest(42, [T.chord(nextSym).bass], 36, 47);
      const scale = new Set(ch.scale.map(T.mod12));
      const approach = () => {
        if (nextRoot === root) return r.chance(0.5) ? fifth : root + 12 <= HI ? root + 12 : fifth;
        // diatonic steps mostly (the pad is always sounding); a chromatic approach now and then
        const w = (m, base) => [m, base * (scale.has(T.mod12(m)) ? 1 : 0.12)];
        return r.weighted([w(nextRoot - 2, 2), w(nextRoot + 2, 1.4), w(nextRoot - 1, 1), w(nextRoot + 1, 0.5), [T.nearest(nextRoot + 7, [T.mod12(nextRoot + 7)], LO, HI), 1.2]]);
      };
      const pedal = ch.bass !== ch.root;
      const d = c.dur;
      const vr = 0.82;
      if (style === "light" || pedal) {
        push("bass", c.s, d - 0.3, root, vr);
        if (d >= 4 && !pedal && r.chance(0.5)) push("bass", c.s + 3.5, 0.45, approach(), 0.58);
        else if (d >= 4 && pedal && sec === "intro" && r.chance(0.5)) push("bass", c.s + 2.5, 0.4, root + 12 <= HI ? root + 12 : fifth, 0.46);
      } else if (d >= 4) {
        push("bass", c.s, 1.8, root, vr);
        if (style === "march") push("bass", c.s + 2, 1.3, r.chance(0.6) ? fifth : root, 0.68);
        else {
          push("bass", c.s + 2, 0.9, fifth, 0.68);
          if (r.chance(style === "big" ? 0.7 : 0.4)) push("bass", c.s + 3, 0.4, root, 0.6);
        }
        push("bass", c.s + 3.5, 0.45, approach(), 0.62);
      } else {
        push("bass", c.s, style === "march" ? 1.8 : 1.3, root, vr);
        if (style !== "march") push("bass", c.s + 1.5, 0.45, approach(), 0.6);
      }
    });
  }

  // ---------- drums on the chip: kick, snare, hat (open flag), tom (pitch) ----------
  function drumPart({ sec, plan, half, secStart, r, push, lastHalf, nextPlan, lap, cycle }) {
    const hit = (b, voice, vel, extra = {}) => push("drums", b, extra.dur ?? 0.1, voice, vel, { priority: PRI[voice], ...extra });
    for (let bar = 0; bar < CB; bar++) {
      const s = secStart + bar * BPB, secBar = half * CB + bar;
      let st = plan.drums;
      if (sec === "B" && (secBar === 4 || secBar === 5)) st = "half";
      const finalBar = lastHalf && bar === CB - 1;
      const fill = (finalBar && st !== "light" && nextPlan.drums !== "light" && r.chance(0.8)) || (sec === "B" && secBar === 5) || (finalBar && st === "light" && nextPlan.drums !== "light" && lap > 0 && r.chance(0.5));
      const hats16 = st === "big" || (st === "full" && plan.hats16);
      if (st === "light") {
        for (let e = 0; e < 8; e++) hit(s + e * 0.5, "hat", e % 2 ? 0.14 : e % 4 === 2 ? 0.3 : 0.24);
        hit(s, "kick", 0.6);
        if (lap > 0 || sec === "tag") hit(s + 2, "kick", 0.5);
      } else if (st === "half") {
        for (let e = 0; e < 8; e++) hit(s + e * 0.5, "hat", e % 2 ? 0.16 : 0.28);
        hit(s, "kick", 0.84); if (r.chance(0.5)) hit(s + 2.75, "kick", 0.5);
        if (!fill) hit(s + 2, "snare", 0.74);
        if (secBar % 2 === 1 && !fill) hit(s + 3.5, "hat", 0.36, { open: true, dur: 0.3 });
      } else {
        const n = hats16 ? 16 : 8, step = hats16 ? 0.25 : 0.5;
        for (let q = 0; q < n; q++) {
          const b = s + q * step, pos = q * step;
          if (fill && pos >= 2.5) continue;
          if (pos === 3.5 && secBar % 2 === 1 && !fill) { hit(b, "hat", 0.38, { open: true, dur: 0.3 }); continue; }
          const v = pos % 1 === 0 ? 0.32 : pos % 0.5 === 0 ? 0.21 : 0.13;
          if (!hats16 || pos % 0.5 === 0 || r.chance(0.8)) hit(b, "hat", v);
        }
        const sv = st === "big" ? 0.82 : st === "full" ? 0.72 : 0.62;
        hit(s + 1, "snare", sv);
        if (!fill) hit(s + 3, "snare", sv + 0.05);
        if (r.chance(st === "march" ? 0.25 : 0.4)) hit(s + 3.75, "snare", 0.3, { ghost: true });
        if (st !== "march" && r.chance(0.3)) hit(s + 1.75, "snare", 0.3, { ghost: true });
        hit(s, "kick", 0.88); hit(s + 2.5, "kick", 0.62);
        if (st === "big") hit(s + 3.5, "kick", 0.56);
        else if (st === "full" && r.chance(0.35)) hit(s + 3.75, "kick", 0.5);
        if (st === "big" && secBar % 4 === 3 && !fill) hit(s + 3.75, "tom", 0.5, { pitch: 48 });
      }
      if (fill) {
        const kind = r.weighted([["snare", 2], ["toms", 2], ["mixed", 1.5]]);
        const grid = r.pick([[2.5, 2.75, 3, 3.25, 3.5, 3.75], [3, 3.25, 3.5, 3.75], [2.5, 3, 3.5, 3.75], [2.5, 3, 3.25, 3.5, 3.75]]);
        grid.forEach((p, i) => {
          const isLast = i === grid.length - 1;
          const voice = kind === "toms" ? "tom" : kind === "snare" ? "snare" : i % 2 ? "tom" : "snare";
          hit(s + p, voice, 0.42 + i * 0.07, voice === "tom" ? { pitch: isLast ? 43 : r.pick([48, 52, 55]) } : {});
        });
      }
      if (bar === 0 && half === 0 && plan.arrive && cycle > 0) { hit(s, "hat", 0.6, { open: true, dur: 0.6 }); hit(s, "snare", 0.7); }
    }
  }
})();

// Aerial Causeway: crossing the whole map by airship. F major, 3/4 at 126, wide where the other flight pieces
// are intimate. Brass and strings through an eight-voice sound chip (Sim.spc), a march-waltz of snare and
// timpani under them, and a melody that lives in long phrases: scoops into the high notes, swells inside them,
// a breath between them (Sim.phrasing). The harmony climbs by sequence and, when the clouds break, turns to
// A major: a chromatic mediant, the same hook a major third higher in the sun. A quiet interlude lets the engine
// hum while a flute states the theme and a clarinet answers it (Sim.dialogue). The last return lifts the tempo
// (Sim.groove).
//
// ---- the music, fixed by hand before any code; the generator never changes a pitch or a rhythm ----
//
// THE HOOK (A, 8 bars of 3/4). The cell is 5 1 3 up an octave-and-a-bit (C5 F5 A5): the ship lifting. It
// lands on the high root with a scoop and a swell, falls through the ninth of Bb, and breathes on the fifth of C.
// The second phrase is the cell as a rising sequence (Gm7, Am7), up to the third of Bb and a breath on C7.
//   | F        | F        | Bbmaj7       | C7sus    | Gm7       | Am7       | Bbmaj7     | C7sus C7     |
//   | C5 F5 A5 | C6 ^ s - | D6 . C6~ A5~ | G5 _ - r | D5 G5 Bb5 | E5 A5 C6  | D6 ^ - Bb5~ | A5 _ G5~ r  |
//
// THE CLIMB (B, 8 bars): the cell on Bb, then on C (the sequence rises a step), to the summit F6 over Dm7 and a
// fall; the second time the sequence keeps going, through E7 to the break.
//   | Bbmaj7    | C         | Dm7         | Dm7        | Bbmaj7    | C         | Dm7            | E7sus E7      |
//   | F5 Bb5 D6 | G5 C6 E6  | F6 ^ - D6~  | C6 _ A5~ r | F5 Bb5 D6 | G5 C6 E6  | F6 ^ . E6~ D6~ | D6 _ B5~ G#5~ |
//
// THE BREAK (C, 8 bars, A major: the chromatic mediant of F). The hook's first two bars a major third higher,
// the world small below; then it comes down through F#m7 and the minor iv (Dm7, the slide F#->F) to C7, home.
//   | Amaj7     | Amaj7    | Dmaj7          | E7sus    | Amaj7      | F#m7        | Dm7       | C7sus C7   |
//   | E5 A5 C#6 | E6 ^ s - | F#6 . E6~ C#6~ | B5 _ - r | E6 - C#6~  | A5 ^ - F#5~ | F5 _ - D5~ | G5 _ - E5~ |
//
// THE INTERLUDE (8 bars over an F pedal): the engine hums (a low drone and a soft pulse), the flute states the
// cell and its landing, and the clarinet answers in the rests with the inversion (Sim.dialogue.respond).
//   | F        | F      | Bbmaj7/F | Bbmaj7/F | Gm7/F     | Gm7/F  | C7sus/F | C7sus/F |
//   | C5 F5 A5 | C6 - r | (answer) | (answer) | D5 G5 Bb5 | D6 - r | (answer)| (answer)|
//
// THE CODA (4 bars): | Bbmaj7 | C7sus | F | F |   D6 C6 A5 | G5 _ - - | F5 _ s - - | r
//
// FORM (one lap, 14 cycles of 4 bars, about 1:25): intro 4 · A 8 · A2 8 (the tune passed between brass and
// flute by phrase) · B 8 · C 8 · interlude 8 (slower) · A3 8 (lifted tempo, horns in thirds, full strings) · coda 4.
// Per lap the generator chooses only: drum figures and fills, strings density, bass shapes, the horn harmony, the
// chip voice budget, and which seed of feel; across laps three arrangement plans rotate.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const BPB = 3, BPM = 126, CB = 4, VOICES = 8;
  const mod12 = T.mod12;

  // ---------- harmony ----------
  const PROG = {
    intro: "| F | Bbmaj7/F | F | C7sus/F |",
    A: "| F | F | Bbmaj7 | C7sus | Gm7 | Am7 | Bbmaj7 | C7sus:2 C7:1 |",
    B: "| Bbmaj7 | C | Dm7 | Dm7 | Bbmaj7 | C | Dm7 | E7sus:2 E7:1 |",
    C: "| Amaj7 | Amaj7 | Dmaj7 | E7sus | Amaj7 | F#m7 | Dm7 | C7sus:2 C7:1 |",
    inter: "| F | F | Bbmaj7#11/F | Bbmaj7#11/F | Gm7/F | Gm7/F | C7sus/F | C7sus/F |",
    coda: "| Bbmaj7 | C7sus | F | F |",
  };
  PROG.A2 = PROG.A; PROG.A3 = PROG.A;
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- the tunes (Sim.phrasing notation: Note/beats + marks; ^ scoop, s swell, _ tenuto, ~ slur, . staccato) ----------
  const LEAD_A = [
    "C5/1 F5/1 A5/1",
    "C6/3^s",
    "D6/1.5 C6/0.5~ A5/1~",
    "G5/2_ r/1",
    "D5/1 G5/1 Bb5/1",
    "E5/1 A5/1 C6/1",
    "D6/2^ Bb5/1~",
    "A5/1_ G5/1~ r/1",
  ];
  const LEAD_B = [
    "F5/1 Bb5/1 D6/1",
    "G5/1 C6/1 E6/1",
    "F6/2^s D6/1~",
    "C6/1_ A5/1~ r/1",
    "F5/1 Bb5/1 D6/1",
    "G5/1 C6/1 E6/1",
    "F6/1.5^ E6/0.5~ D6/1~",
    "D6/1_ B5/1~ G#5/1~",
  ];
  const LEAD_C = [
    "E5/1 A5/1 C#6/1",
    "E6/3^s",
    "F#6/1.5 E6/0.5~ C#6/1~",
    "B5/2_ r/1",
    "E6/2 C#6/1~",
    "A5/2^ F#5/1~",
    "F5/2_ D5/1~",
    "G5/2_ E5/1~",
  ];
  const LEAD_CODA = ["D6/1 C6/1 A5/1", "G5/3_", "F5/3_s", "r/3"];
  const FLUTE_INTER = ["C5/1 F5/1 A5/1", "C6/2 r/1", "r/3", "r/3", "D5/1 G5/1 Bb5/1", "D6/2 r/1", "r/3", "r/3"];
  // phrase marks in beats from the section start: four-bar phrases, each a crescendo, slurred where adjacent
  const PHR_A = [{ from: 0, to: 12, dyn: [0.84, 1], legato: true }, { from: 12, to: 24, dyn: [0.86, 1.02], legato: true }];
  const PHR_B = [{ from: 0, to: 12, dyn: [0.86, 1.04], legato: true }, { from: 12, to: 24, dyn: [0.88, 1.06], legato: true }];
  const PHR_C = [{ from: 0, to: 12, dyn: [0.9, 1.04], legato: true }, { from: 12, to: 24, dyn: [1, 0.86], legato: true }];
  const PHR_CODA = [{ from: 0, to: 12, dyn: [0.92, 0.78], legato: true }];
  const PHR_FL = [{ from: 0, to: 6, dyn: "<", legato: true }, { from: 12, to: 18, dyn: "<", legato: true }];
  const MATERIAL = {
    intro: { bars: 4 },
    A: { lead: LEAD_A, phr: PHR_A, bars: 8 }, A2: { lead: LEAD_A, phr: PHR_A, bars: 8 }, A3: { lead: LEAD_A, phr: PHR_A, bars: 8 },
    B: { lead: LEAD_B, phr: PHR_B, bars: 8 },
    C: { lead: LEAD_C, phr: PHR_C, bars: 8 },
    inter: { flute: FLUTE_INTER, phr: PHR_FL, bars: 8 },
    coda: { lead: LEAD_CODA, phr: PHR_CODA, bars: 4 },
  };

  // ---------- form: 14 cycles of 4 bars ----------
  const LAP = [
    { sec: "intro", half: 0 },
    { sec: "A", half: 0 }, { sec: "A", half: 1 },
    { sec: "A2", half: 0 }, { sec: "A2", half: 1 },
    { sec: "B", half: 0 }, { sec: "B", half: 1 },
    { sec: "C", half: 0 }, { sec: "C", half: 1 },
    { sec: "inter", half: 0 }, { sec: "inter", half: 1 },
    { sec: "A3", half: 0 }, { sec: "A3", half: 1 },
    { sec: "coda", half: 0 },
  ];
  // tempo gestures per cycle in the lap: the band eases into the interlude, lifts for the return, settles for the coda
  const tempoAt = G.tempoScript(BPM, [
    { at: 9, bpm: 116, rampBeats: 6, hold: true },
    { at: 11, bpm: 134, rampBeats: 3, hold: true },
    { at: 13, bpm: 124, rampBeats: 9, hold: true },
    { at: 0, bpm: BPM, rampBeats: 0, hold: true },
  ]);
  // arrangement plans, rotating per lap
  const PLANS = [
    {
      intro: { drums: "pocket", strings: 2, timp: 1 },
      A: { drums: "march", strings: 2, bass: 1 },
      A2: { drums: "march", strings: 3, bass: 1, share: "phrase", bell: 1 },
      B: { drums: "full", strings: 3, bass: 1, horns: "fifth", timp: 1 },
      C: { drums: "wide", strings: 3, bass: 1, bell: 1, timp: 1, crash: 1 },
      inter: { drums: "hum", strings: 2, hum: 1 },
      A3: { drums: "full", strings: 3, bass: 1, horns: "third", timp: 1, crash: 1 },
      coda: { drums: "coda", strings: 3, bass: 1, timp: 1 },
    },
    {
      intro: { drums: "pocket", strings: 2, timp: 1, bell: 1 },
      A: { drums: "march", strings: 3, bass: 1, bell: 1 },
      A2: { drums: "full", strings: 2, bass: 1, share: "handoff" },
      B: { drums: "full", strings: 3, bass: 1, horns: "third", timp: 1 },
      C: { drums: "wide", strings: 3, bass: 1, timp: 1, crash: 1, horns: "fifth" },
      inter: { drums: "hum", strings: 0, hum: 1, bell: 1 },
      A3: { drums: "full", strings: 3, bass: 1, horns: "fifth", timp: 1, crash: 1 },
      coda: { drums: "coda", strings: 3, bass: 1, timp: 1, bell: 1 },
    },
    {
      intro: { drums: "pocket", strings: 3, timp: 1 },
      A: { drums: "march", strings: 2, bass: 1, horns: "third" },
      A2: { drums: "march", strings: 3, bass: 1, share: "phrase", bell: 1 },
      B: { drums: "full", strings: 2, bass: 1, timp: 1, bell: 1 },
      C: { drums: "wide", strings: 3, bass: 1, bell: 1, timp: 1, crash: 1 },
      inter: { drums: "hum", strings: 2, hum: 1 },
      A3: { drums: "full", strings: 3, bass: 1, horns: "third", timp: 1, crash: 1 },
      coda: { drums: "coda", strings: 2, bass: 1, timp: 1 },
    },
  ];
  const NAMES = {
    intro: "Intro · casting off", A: "A · the ship lifts", A2: "A · the tune changes hands", B: "B · the climb, by sequence",
    C: "C · the clouds break (A major)", inter: "Interlude · the engine hums, flute and clarinet", A3: "A′ · the return, lifted", coda: "Coda · the far shore",
  };
  // who keeps a hardware voice when eight are busy (the lead is a wrapped synth through the chip's output stage and
  // is counted in the compose-side budget at the top priority, so at most seven chip voices sound beside it)
  const PRIORITY = { lead: 7, flute: 6, clarinet: 5, timp: 5, snare: 5, kick: 5, strings: 4, bass: 3, hum: 3, horn: 2, hat: 1, bell: 1 };

  // ---------- the palette ----------
  /** The brass lead: a clipped reed loop through a resonant lowpass whose envelope gives the attack its "wah". */
  function brassSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.35, 0.65, 0.2, 0.42, 0.12, 0.22, 0.06, 0.1] },
      filter: { type: "lowpass", rolloff: -24, Q: 1.6 },
      envelope: { attack: 0.035, decay: 0.25, sustain: 0.8, release: 0.22 },
      filterEnvelope: { attack: 0.06, decay: 0.35, sustain: 0.5, release: 0.25, baseFrequency: 520, octaves: 2.4 },
    }));
  }
  /** Translate phrasing marks the chip voices can realize: a scoop becomes the voice's pitch envelope. */
  const chipPlay = (voice) => (t, e, d) => {
    if (e.scoop) e = { ...e, bend: { cents: -Math.min(4, e.scoop) * 100, time: 0.09 } };
    voice.play(t, e, d);
  };

  Sim.register({
    id: "aerial-causeway",
    title: "Aerial Causeway",
    genre: "Airship theme, 16-bit",
    about: "Crossing the map by airship. A march-waltz in F at 126 for an eight-voice sound chip: brass and strings through the SPC's echo and lo-fi stage, snare pocket and timpani under them, and a hand-written hook in long phrases with scoops into the high notes and swells inside them. The harmony climbs by sequence and breaks into A major, a chromatic mediant, for the view; a slower interlude lets the engine hum while a flute states the theme and a clarinet answers; the last return lifts the tempo with horns in thirds.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["explore", "celebrate"],
    energy: 0.6,

    instruments(ctx) {
      const { I } = ctx;
      const chip = Sim.spc.chip(ctx, {
        voices: VOICES, volume: -7, rate: 32000, bits: 8, crush: 0.4, tone: 7400,
        echo: { time: 0.144, feedback: 0.4, tone: 2600, level: -8 },
      });
      // the lead: a Tone synth with the phrasing wrapper (glides, scoops, swells, late vibrato, breath) sent into the
      // chip's bus and echo, so it shares the DAC and the room with the chip voices
      const lead = P.wrap(ctx, brassSynth(ctx), {
        volume: -4, glide: 0.05, scoopTime: 0.1, fallTime: 0.25, release: 0.22, accentBright: 0.5,
        vibrato: { rate: 5.2, depth: 0.07, delay: 0.42, rise: 0.5, deepen: 1.25 },
        breath: P.breath(ctx, chip.bus, { level: -30, freq: 1800, length: 0.16 }),
      });
      const leadPan = ctx.keep(new Tone.Panner(0.06)).connect(chip.bus);
      lead.out.connect(leadPan);
      const leadEcho = ctx.keep(new Tone.Gain(0.42)).connect(chip.echo);
      leadPan.connect(leadEcho);
      const horn = chip.voice("brass", { priority: PRIORITY.horn, echo: 0.35, pan: -0.28, volume: -5, cutoff: 3000 });
      const flute = chip.voice("flute", { priority: PRIORITY.flute, echo: 0.55, pan: 0.12, volume: 0 });
      const clarinet = chip.voice("clarinet", { priority: PRIORITY.clarinet, echo: 0.5, pan: -0.3, volume: -3 });
      // the string section: three voices of a saw loop with a slow attack, darker than the leads
      const strings = chip.voice("pad", { poly: 3, priority: PRIORITY.strings, echo: 0.4, pan: 0.2, volume: -4, wave: "saw", cutoff: 2400, attack: 0.14, decay: 0.5, sustain: 0.85, release: 0.25, vibrato: { rate: 4.6, depth: 0.03, delay: 0.3 } });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.15, pan: 0, volume: -1, cutoff: 150, octaves: 2.4 });
      const hum = chip.voice("organ", { poly: 2, priority: PRIORITY.hum, echo: 0.3, pan: -0.1, volume: -9, cutoff: 900, attack: 0.3, release: 0.4 });
      const bell = chip.voice("bell", { poly: 2, priority: PRIORITY.bell, echo: 0.6, pan: 0.4, volume: -6 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: 1, note: 40, decay: 0.22, pitchDecay: 0.03 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.22, pan: 0.05, volume: 1, decay: 0.14, tone: 2400 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.25, volume: -3, cutoff: 7500 });
      // timpani: a long tuned membrane on the chip's tom voice, pitched by the bass note
      const timp = chip.voice("tom", { priority: PRIORITY.timp, echo: 0.35, pan: -0.15, volume: 2, note: 41, pitchDecay: 0.08, octaves: 1.1, decay: 0.75 });
      const chipHum = { timing: 0.002, vel: 0.04 };
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        horn: { layer: "melody", play: chipPlay(horn), humanize: chipHum },
        flute: { layer: "melody", play: chipPlay(flute), humanize: chipHum },
        clarinet: { layer: "melody", play: chipPlay(clarinet), humanize: chipHum },
        strings: { layer: "harmony", play: chipPlay(strings), humanize: chipHum },
        hum: { layer: "harmony", play: chipPlay(hum), humanize: chipHum },
        bell: { layer: "texture", play: chipPlay(bell), humanize: chipHum },
        bass: { layer: "bass", play: chipPlay(bass), humanize: chipHum },
        kick: { layer: "drums", play: kick.play, humanize: chipHum },
        snare: { layer: "drums", play: snare.play, humanize: chipHum },
        hat: { layer: "drums", play: hat.play, humanize: chipHum },
        timp: { layer: "drums", play: timp.play, humanize: chipHum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const pos = cycle % LAP.length, lap = Math.floor(cycle / LAP.length);
      const { sec, half } = LAP[pos];
      const plan = PLANS[lap % PLANS.length][sec];
      const mat = MATERIAL[sec];
      const prog = TL[sec];
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(Math.max(0, Math.min(b, mat.bars * BPB - 0.001))).chord;
      const ch = (b) => T.chord(sym(b));
      const scaleAt = (b) => ch(b).scale;
      const secStart = half * CB * BPB, secEnd = secStart + CB * BPB;
      const nextPos = (pos + 1) % LAP.length, nextSec = LAP[nextPos].sec;
      const lastHalf = nextPos === 0 || LAP[nextPos].sec !== sec;
      const firstHalf = half === 0;
      let ev = [];
      // push by beat within the SECTION; events outside this cycle's window are dropped
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -1e-6 || abs >= CB * BPB - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const emit = (notes, { track = null, up = 0, gain = 1 } = {}) => {
        for (const e of notes) {
          const { bar, beat, dur, note, vel, track: t0, at, idx, ...extra } = e;
          push(track || t0, bar * BPB + beat, dur, Array.isArray(note) ? note.map((m) => m + up) : note + up, (vel ?? 0.75) * gain, extra);
        }
      };

      // ---------- the lines: built once per section (both halves share them) ----------
      const key = `${sec}:${lap}`;
      if (!state.lines || state.lines.key !== key) {
        const rr = r.fork(11 + lap);
        const lines = { key };
        if (mat.lead) {
          const line = P.line(mat.lead, { beatsPerBar: BPB, track: "lead" });
          line.forEach((e) => {
            const a = P.parseArt(e.art || "");
            // contour: the high notes carry a little more; the long notes a little more; a hair of life
            e.vel = 0.72 + (e.note - 79) / 110 + (e.dur >= 2 ? 0.05 : 0) + (a.scoop ? 0.03 : 0) + rr.gauss(0.01);
          });
          lines.lead = P.articulate(line, mat.phr, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.08, breathLate: 0.04, breathGap: 0.2, breathFirst: true, overlap: 0.04 });
          // A2: the tune passed between the brass lead and the chip flute (dialogue.distribute); the flute keeps
          // the phrasing fields it can realize (scoop, breath delay, dynamics)
          if (plan.share) {
            const voices = [{ track: "lead", range: [60, 90] }, { track: "flute", range: [67, 96], gain: 0.92 }];
            const shared = plan.share === "handoff"
              ? D.distribute(lines.lead, { voices, mode: "handoff", bpb: BPB, rng: rr, handoffDur: 2, minNotes: 3, stay: 0.2, join: "extend", overlap: 0.25 })
              : D.distribute(lines.lead, { voices, mode: "phrase", bpb: BPB, order: lap % 2 ? ["flute", "lead"] : ["lead", "flute"], rng: rr });
            lines.lead = shared;
          }
        }
        if (mat.flute) {
          const raw = P.line(mat.flute, { beatsPerBar: BPB, track: "flute", vel: 0.62 });
          // the clarinet answers each phrase in the rest that follows (from the un-articulated line, so the answer
          // starts on the grid): it takes the flute's last note and inverts the climb, snapped to the chord scale
          const ans = D.respond(raw, {
            track: "clarinet", bpb: BPB, minGap: 1, end: 24, gap: 1, breath: 0.5,
            transform: (i) => (i === 0 || lap % 3 === 0 ? [{ invert: true }] : [{ invert: true }, { steps: lap % 3 === 1 ? -1 : 1 }]),
            scaleAt, range: [64, 86], vel: 0.56,
          });
          const fl = P.articulate(raw, mat.phr, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.1, breathLate: 0.03, breathGap: 0.2 });
          lines.flute = fl.concat(ans);
        }
        state.lines = lines;
      }
      const L = state.lines;
      if (L.lead) emit(L.lead);
      if (L.flute) emit(L.flute);

      // ---------- horns: a chord tone a third (or a fifth) below the lead where the budget allows ----------
      if (plan.horns && L.lead) {
        const [target, lo, hi] = plan.horns === "fifth" ? [-7, -9, -6] : [-4, -5, -3]; // semitones below the lead
        for (const e of L.lead) {
          if (e.track !== "lead" || typeof e.note !== "number") continue;
          const b = e.bar * BPB + e.beat;
          if (e.dur < 1 && !(sec === "A3")) continue;
          const c = ch(b);
          const m = T.nearest(e.note + target, c.pcs, e.note + lo, e.note + hi);
          if (!Number.isFinite(m) || m > e.note + hi || m < e.note + lo) continue;
          push("horn", b, Math.max(0.3, e.dur * 0.9), m, (e.vel ?? 0.75) * 0.72, { delay: e.delay, scoop: e.scoop });
        }
      }

      // ---------- strings ----------
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= secStart && c.s < secEnd);
      // three-part strings play the plain triad (the sevenths and colours belong to the lead and the bells); two-part
      // strings play the guide tones of the full chord
      const plain = (s) => s.replace(/maj7#11/, "").replace(/maj7/, "").replace(/7sus/, "sus4").replace(/m7/, "m");
      if (plan.strings) {
        for (const c of spans) {
          const n = plan.strings;
          const v = T.voice(n === 3 && sec !== "inter" ? plain(c.chord) : c.chord, { lo: 60, hi: 81, n, prev: state.strV, rng: r, omitBass: true, rootless: n < 3, top: [69, 79], spread: "close" });
          state.strV = v;
          const quiet = sec === "inter" || sec === "intro";
          // long bows: held through the chord; in the march sections the strings re-bow on beat 3 of long chords
          if (c.dur >= 3 && !quiet && (sec === "A" || sec === "A3") && r.chance(0.5)) {
            push("strings", c.s, 1.9, v, 0.52); push("strings", c.s + 2, c.dur - 2.2, v, 0.44);
          } else push("strings", c.s, c.dur - 0.2, v, quiet ? 0.4 : sec === "C" ? 0.56 : 0.5);
        }
      }
      // the engine: a low drone with a slow pulse on the pedal, two voices
      if (plan.hum) {
        for (let bar = 0; bar < CB; bar++) {
          const s = secStart + bar * BPB;
          push("hum", s, BPB - 0.1, [41, 48], 0.5);
          push("hum", s + 1.5, 1.3, [53], 0.3);
        }
      }
      // bells: the ninth and the third of the chord on beat 3, every other bar, high and soft
      if (plan.bell) {
        for (const c of spans) {
          if (c.bar % 2 !== (sec === "C" ? 0 : 1) || c.dur < 3) continue; // whole-bar chords only (a split bar changes under the bell)
          // the bell takes the chord's colour: its written extension, else the 11th over a minor chord (the ninth would
          // rub the strings' third), else the ninth
          const cc = T.chord(c.chord);
          const ninth = mod12(cc.root + 2), eleventh = mod12(cc.root + 5);
          const pc = cc.colors.length ? cc.colors[0] : cc.intervals.includes(3) ? eleventh : cc.scale.includes(ninth) ? ninth : cc.guide[0];
          const m = T.nearest(88, [pc], 84, 95);
          push("bell", c.s + 2, 1, m, 0.42);
          if (sec === "C" || sec === "coda") push("bell", c.s + 2.5, 0.5, T.nearest(m - 5, cc.pcs, m - 8, m - 3), 0.34);
        }
      }

      // ---------- bass ----------
      if (plan.bass) bassPart({ sec, spans, secStart, r: r.fork(5), state, push, nextSec, lastHalf, plan });

      // ---------- drums ----------
      drumPart({ sec, plan, half, secStart, r: r.fork(6), push, lastHalf, firstHalf, lap, cycle, spans, state });

      // ---------- feel (Sim.groove): the march-waltz lean, the lead floating over it ----------
      const WALTZ_MARCH = { unit: 0.5, offsets: [0, 0.01, -0.02, 0.005, 0.015, 0.02], vels: [1, 0.7, 0.82, 0.64, 0.76, 0.6] };
      ev = G.ghosts(ev, { tracks: ["snare"], vel: 0.22, dur: 0.1 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          snare: { template: WALTZ_MARCH, late: 10 },
          kick: { template: WALTZ_MARCH, vels: false },
          hat: { template: WALTZ_MARCH, late: -4 },
          timp: { template: "straight", late: 6, vels: false },
          bass: { template: WALTZ_MARCH, late: 4, amount: 0.7 },
          strings: { template: "straight", late: 14, vels: false },
          horn: { template: "straight", late: 8, vels: false },
          bell: { template: "straight", late: 12, vels: false },
        },
      });
      if (L.lead && sec !== "A2") ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: sec === "C" ? 0.9 : 0.6, linger: "high", lingerMs: 50, leapMs: 14, rng: r, legato: true });
      if (sec === "inter" && !firstHalf) ev = G.crescendo(ev, { tracks: ["timp", "snare"], from: 9, to: 12, v0: 0.55, v1: 1.15, curve: 1.2, bpb: BPB });

      // ---------- the chip: eight voices, by priority; the score and the linter see what survives ----------
      // the lead is not a chip voice: it is budgeted at top priority (never stolen) with its slur overlaps trimmed, so
      // a glide into a downbeat does not cost the band a voice there; its own events pass through untouched
      const forBudget = ev.map((e) => (e.track === "lead" ? { ...e, dur: Math.max(0.05, e.dur - 0.06) } : e));
      const bud = Sim.spc.budget(forBudget, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen = (state.stolen || 0) + bud.stolen; state.dropped = (state.dropped || 0) + bud.dropped;
      const leadEvents = ev.filter((e) => e.track === "lead");
      bud.events = bud.events.filter((e) => e.track !== "lead").concat(leadEvents);

      const harmony = prog.filter((c) => c.bar >= half * CB && c.bar < half * CB + CB).map((c) => ({ ...c, bar: c.bar - half * CB }));
      const extras = [plan.horns ? `horns in ${plan.horns}s` : "", plan.strings === 3 ? "full strings" : "", plan.share ? plan.share : ""].filter(Boolean).join(", ");
      return { events: bud.events, harmony, section: `Lap ${lap + 1} · ${NAMES[sec]}${extras ? " · " + extras : ""}`, state, tempo: tempoAt(pos) };
    },
  });

  // ---------- bass: the march-waltz bass, root on one, fifth or octave on three, a step into the next root ----------
  function bassPart({ sec, spans, secStart, r, state, push, nextSec, lastHalf, plan }) {
    const lo = 29, hi = 50;
    const pickRoot = (from, pc) => T.nearest(Math.round((from + 41) / 2), [pc], 33, 45); // F1..A2 region
    spans.forEach((c, i) => {
      const cc = T.chord(c.chord);
      const last = state.bassLast ?? 41;
      const root = pickRoot(last, cc.bass);
      const fifth = T.nearest(root + 7, [mod12(cc.root + 7)], lo, hi);
      const octave = root + 12 <= hi ? root + 12 : fifth;
      let nextSym;
      if (i + 1 < spans.length) nextSym = spans[i + 1].chord;
      else {
        const own = TL[sec].find((x) => x.bar * BPB + x.beat === c.bar * BPB + c.beat + c.dur);
        nextSym = own ? own.chord : TL[nextSec][0].chord;
      }
      const nextRoot = pickRoot(root, T.chord(nextSym).bass);
      const scale = new Set(cc.scale.concat(cc.pcs).map(mod12));
      const approach = () => {
        if (nextRoot === root) return r.chance(0.5) ? fifth : octave;
        const w = (m, base) => [m, base * (scale.has(mod12(m)) ? 3 : 0.6) * (m < 33 ? 0.25 : 1)];
        return r.weighted([w(nextRoot - 1, 1.2), w(nextRoot + 1, 0.7), w(nextRoot - 2, 1.4), w(nextRoot + 2, 0.9), [T.nearest(nextRoot + 7, [mod12(nextRoot + 7)], lo, hi), 1.2]]);
      };
      const pedal = cc.bass !== cc.root;
      const v = 0.82;
      if (sec === "inter") { // the pedal: one long note a bar, the engine under it
        push("bass", c.s, c.dur - 0.3, root, 0.7);
      } else if (c.dur < 3) { // a split bar (C7sus:2 C7:1): just the roots
        push("bass", c.s, c.dur - 0.2, root, v);
      } else {
        const cell = sec === "C" ? r.weighted([["hold", 3], ["oct", 1.5], ["fifth", 1]])
          : r.weighted([["fifth", 3], ["oct", 2], ["hold", 1.2], ["walk", sec === "B" || sec === "A3" ? 2 : 0.8]]);
        if (cell === "hold") { push("bass", c.s, 2.7, root, v); }
        else if (cell === "fifth") { push("bass", c.s, 1.4, root, v); push("bass", c.s + 2, 0.5, pedal ? root : fifth, 0.62); if (r.chance(0.5)) push("bass", c.s + 2.5, 0.45, approach(), 0.6); }
        else if (cell === "oct") { push("bass", c.s, 1.4, root, v); push("bass", c.s + 1.5, 0.45, octave, 0.52); push("bass", c.s + 2, 0.9, pedal ? root : fifth, 0.62); }
        else { // walk: root, third (or fifth), approach
          const third = cc.intervals.includes(4) || cc.intervals.includes(3) ? T.nearest(root + 4, [mod12(cc.root + (cc.intervals.includes(3) ? 3 : 4))], root + 1, hi) : fifth;
          push("bass", c.s, 0.9, root, v); push("bass", c.s + 1, 0.9, third, 0.62); push("bass", c.s + 2, 0.9, approach(), 0.64);
        }
      }
      state.bassLast = root;
    });
  }

  // ---------- drums: the march-waltz. Snare on 2 (and the "and" of 3), kick on 1, timpani on the chord roots ----------
  function drumPart({ sec, plan, half, secStart, r, push, lastHalf, firstHalf, lap, cycle, spans, state }) {
    const style = plan.drums;
    const hit = (track, b, vel, extra) => push(track, b, 0.25, track, vel, extra);
    const timpPitch = (b) => {
      const c = spans.find((x) => x.s <= b + 1e-6 && x.s + x.dur > b + 1e-6) || spans[0];
      return T.nearest(41, [T.chord(c.chord).bass], 36, 47);
    };
    for (let bar = 0; bar < CB; bar++) {
      const s = secStart + bar * BPB;
      const secBar = half * CB + bar;
      const finalBar = lastHalf && bar === CB - 1;
      const fill = finalBar && style !== "hum" && style !== "coda" && r.chance(sec === "C" ? 0.9 : 0.7);
      if (style === "hum") {
        // the engine's pulse: a soft kick on one, a brushed hat on the offbeats, nothing else; the last bar is
        // the timpani roll into the lifted return (its crescendo is written by Sim.groove in compose)
        hit("kick", s, 0.45);
        if (bar % 2 === 1) hit("hat", s + 1.5, 0.22);
        if (lastHalf && bar === CB - 1) {
          for (let q = 0; q < 12; q++) hit("timp", s + q * 0.25, 0.5, { pitch: 41 });
          hit("snare", s + 2, 0.5); hit("snare", s + 2.5, 0.65);
        }
        continue;
      }
      if (style === "coda") {
        hit("kick", s, 0.7);
        if (bar < 2) { hit("snare", s + 1, 0.5); if (plan.timp) hit("timp", s, 0.7, { pitch: timpPitch(s) }); }
        if (bar === 3 && plan.timp) hit("timp", s, 0.55, { pitch: 41 });
        continue;
      }
      const big = style === "full" || style === "wide";
      // kick on 1; in the full styles also the "and" of 2
      hit("kick", s, big ? 0.9 : 0.78);
      if (big && style !== "wide" && r.chance(0.6)) hit("kick", s + 1.5, 0.55);
      // snare: beat 2 is the pocket; the march figure adds the and-of-3 pickup, ghost 16ths in the full style
      hit("snare", s + 1, style === "pocket" ? 0.6 : big ? 0.84 : 0.76);
      if (style !== "wide" && (style !== "pocket" || bar % 2 === 1)) hit("snare", s + 2.5, style === "pocket" ? 0.4 : 0.56);
      if (style === "march" || style === "full") { if (r.chance(0.45)) hit("snare", s + 1.75, 0.3, { ghost: true }); if (r.chance(0.3)) hit("snare", s + 0.75, 0.3, { ghost: true }); }
      if (style === "wide") { if (bar % 2 === 1) hit("snare", s + 2, 0.5); }
      // hats: 8ths, light; the wide style keeps only the offbeats
      for (let e = 0; e < 6; e++) {
        if (fill && e >= 3) break;
        if (style === "wide" && e % 2 === 0) continue;
        if (style === "pocket" && e % 2 === 1 && r.chance(0.4)) continue;
        hit("hat", s + e * 0.5, e === 0 ? 0.34 : e % 2 ? 0.2 : 0.28);
      }
      // timpani: the chord root on the downbeat of each chord change (every bar in C), a soft answer on 3 now and then
      const crash = cycle > 0 && firstHalf && bar === 0 && plan.crash;
      if (plan.timp && !crash) {
        const change = spans.find((x) => Math.abs(x.s - s) < 1e-6);
        if (change && (sec === "C" || sec === "A3" || secBar % 2 === 0 || sec === "intro")) hit("timp", s, big ? 0.8 : 0.68, { pitch: timpPitch(s) });
        if (big && bar % 2 === 1 && r.chance(0.4)) hit("timp", s + 2, 0.45, { pitch: timpPitch(s + 2) });
      }
      // the roll into the return: the last bar before A3 (the interlude's end is handled above); here, a snare roll
      if (fill) {
        const kind = r.weighted([["snare", 2], ["timp", plan.timp ? 2 : 0], ["mixed", 1.5]]);
        const grid = [1.5, 1.75, 2, 2.25, 2.5, 2.75];
        grid.forEach((p, i) => {
          const isLast = i === grid.length - 1;
          const voice = kind === "snare" ? "snare" : kind === "timp" ? "timp" : i % 2 ? "timp" : "snare";
          hit(voice, s + p, 0.4 + i * 0.08, voice === "timp" ? { pitch: isLast ? 41 : r.pick([43, 45, 48]) } : {});
        });
      }
      if (crash) { hit("snare", s, 0.9); hit("timp", s, 0.95, { pitch: timpPitch(s) }); }
    }
  }
})();

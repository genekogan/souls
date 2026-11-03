// Night Approach: a small aircraft descending over a lit coastline at night, late-80s flying-game ballad.
// E major, 84 BPM, 16th hats. Built on Sim.phrasing: the lead is one expressive line whose scoops, glides,
// bends, falls and breaths ARE the tune. Played straight it would be a pleasant melody; played like this it is a
// voice. Lead: a CS-80-ish two-saw mono synth, late deepening vibrato, breath noise on every phrase start.
//
// ARTICULATION MARKS (Sim.phrasing notation; after Note/beats):
//   ~ glide in from the previous note (slur)   ^ scoop in from 2 semitones below   f fall off 3 semitones at the end
//   b2 bend up a whole tone over the note      v vibrato (long notes get it anyway)   . staccato   > accent   _ tenuto
//   g grace note a scale step below            m mordent    s swell inside the note
//
// THE HOOK (A, 8 bars, written by hand; the generator never changes a pitch or a rhythm, only ornament and dynamics)
//   | Emaj9       | Amaj9#11            | G#m7         | C#m9                 | F#m9             | B13sus4        | Cmaj9#11     | B7b9          |
//   | . G#5^v F#5~ E5~ | . E5 G#5~ B5~v f | . D#5^v C#5~ B4~ | . G#4 B4~ D#5~ E5~v | A5^ G#5~ F#5~ E5~ | A5 b2 v . G#5 f | G5^s F#5~ E5~ | D#5_ C5~ B4 f . |
//   bar 1: the sigh: a scoop up into the third, held with vibrato, then two slurred steps down.
//   bar 2: the answer: a slurred arpeggio up E G# B that lands on the ninth of A and falls away.
//   bar 3: the sigh a fourth lower, from the fifth of G#m7.      bar 4: the arpeggio again, landing on the third of C#m.
//   bar 5: the climb: a scoop into A5 and four slurred steps down the F# minor scale, no rest.
//   bar 6: THE bend: A5, the seventh of B13sus4, bent up a whole tone into the root over two beats, then G#5 (the 13)
//          falling off. bar 7: the sigh once more but on G natural, the fifth of Cmaj9#11, the borrowed note, swelling.
//   bar 8: D#5 held, slurred through the flat nine (C5) to B4, which falls off into the breath before the repeat.
//   Phrases are two bars each; every phrase starts a hair late with a breath and ends with a lengthened note.
//
// THE B THEME (8 bars): staccato repeated notes against the legato A: a stuttering lift, climbing an octave.
//   | Amaj9 | B13sus4 | G#m7 | C#m9 | Amaj9 | B13sus4 | Cmaj9#11 | B7b9 |
//   | C#5. C#5. E5> . F#5. G#5~v | A5. A5. B5> . A5. G#5~f | . F#5^ D#5~ B4~ C#5~v | . E5 g G#5~ B5~v |
//   | C#6. C#6. E6> . D#6. B5~v | . F#5 b2 v (three and a half beats: the long bend, fifth to thirteenth) |
//   | G5^s A5~ B5~> G5~f | F#5_ D#5~ C5~ B4 f . |
//
// A′ (the last A of a lap) swaps bars 7-8 for | Amaj9#11 | B13sus4 | with the sigh rising: G#5^v A5~ B5~v | F#5_ G#5~ E5 f .
// COAST (4 bars over a B pedal, drums thinned): the lead rests and the fretless bass sings its own slurred line:
//   | Emaj9/B: B2^ D#3~ E3~ F#3~ | Amaj9#11/B: G#3^ F#3~ E3~v | Cmaj9#11: G3^ B3~ A3~ G3~ E3~ | B13sus4: F#3 f E3~ B2 v |
//
// FORM (one lap, 10 cycles of 4 bars, 1:54): intro 4 · A 8 · A (ornamented, doubled an octave down) 8 · B 8 · A′ 8 · coast 4.
// Across laps only the arrangement changes (doubling, strings, keys, drum weight, aux percussion, ornament density).
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing;
  const db = (x) => Math.pow(10, x / 20);
  const BPB = 4;

  // ---------- harmony ----------
  const PROG = {
    intro: "| Emaj9/B | Amaj9#11/B | Emaj9/B | B13sus4 |",
    A: "| Emaj9 | Amaj9#11 | G#m7 | C#m9 | F#m9 | B13sus4 | Cmaj9#11 | B7b9 |",
    A3: "| Emaj9 | Amaj9#11 | G#m7 | C#m9 | F#m9 | B13sus4 | Amaj9#11 | B13sus4 |",
    B: "| Amaj9 | B13sus4 | G#m7 | C#m9 | Amaj9 | B13sus4 | Cmaj9#11 | B7b9 |",
    coast: "| Emaj9/B | Amaj9#11/B | Cmaj9#11 | B13sus4 |",
  };
  PROG.A2 = PROG.A;
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- the tunes ----------
  const LEAD_A = [
    "r/0.5 G#5/2^v F#5/0.5~ E5/1~",
    "r/0.5 E5/0.5 G#5/0.5~ B5/2.5~vf",
    "r/0.5 D#5/2^v C#5/0.5~ B4/1~",
    "r/0.5 G#4/0.5 B4/0.5~ D#5/0.5~ E5/2~v",
    "A5/1.5^ G#5/0.5~ F#5/1~ E5/1~",
    "A5/2b2v r/0.5 G#5/1.5f",
    "G5/2.5^s F#5/0.5~ E5/1~",
    "D#5/1.5_ C5/0.5~ B4/1f r/1",
  ];
  const LEAD_A3 = LEAD_A.slice(0, 6).concat(["G#5/2^v A5/0.5~ B5/1.5~v", "F#5/1_ G#5/1~ E5/1.5f r/0.5"]);
  const LEAD_B = [
    "C#5/0.5. C#5/0.5. E5/0.5> r/1 F#5/0.5. G#5/1~v",
    "A5/0.5. A5/0.5. B5/0.5> r/1 A5/0.5. G#5/1~f",
    "r/0.5 F#5/1^ D#5/0.5~ B4/0.5~ C#5/1.5~v",
    "r/0.5 E5/0.5g G#5/1~ B5/2~v",
    "C#6/0.5. C#6/0.5. E6/0.5> r/1 D#6/0.5. B5/1~v",
    "r/0.5 F#5/3.5b2v",
    "G5/1.5^s A5/0.5~ B5/1~> G5/1~f",
    "F#5/1_ D#5/1~ C5/1~ B4/0.5f r/0.5",
  ];
  const LEAD_INTRO = ["r/4", "r/4", "r/0.5 G#5/2^v F#5/0.5~ E5/1~", "r/4"];
  const BASS_COAST = ["B2/1^1 D#3/1~ E3/1~ F#3/1~", "G#3/1.5^1 F#3/0.5~ E3/2~v", "G3/1^1 B3/0.5~ A3/0.5~ G3/1~ E3/1~", "F#3/1.5f2 E3/0.5~ B2/2v"];
  // phrase marks (beats from the section start): two-bar phrases, slurred where adjacent
  const PHR8 = [
    { from: 0, to: 8, dyn: "arch", legato: true },
    { from: 8, to: 16, dyn: "arch", legato: true },
    { from: 16, to: 24, dyn: "<", legato: true },
    { from: 24, to: 32, dyn: ">", legato: true },
  ];
  const PHR_B = [
    { from: 0, to: 8, dyn: [0.9, 1], legato: true },
    { from: 8, to: 16, dyn: "arch", legato: true },
    { from: 16, to: 24, dyn: [0.95, 1], legato: true },
    { from: 24, to: 32, dyn: ">", legato: true },
  ];
  const PHR_INTRO = [{ from: 8, to: 12, dyn: "arch", legato: true, breath: true }];
  const PHR_COAST = [{ from: 0, to: 4, dyn: "<", legato: true }, { from: 4, to: 8, dyn: "arch", legato: true }, { from: 8, to: 12, dyn: "<", legato: true }, { from: 12, to: 16, dyn: ">", legato: true }];
  const MATERIAL = {
    intro: { lead: LEAD_INTRO, phr: PHR_INTRO, bars: 4 },
    A: { lead: LEAD_A, phr: PHR8, bars: 8 },
    A2: { lead: LEAD_A, phr: PHR8, bars: 8 },
    B: { lead: LEAD_B, phr: PHR_B, bars: 8 },
    A3: { lead: LEAD_A3, phr: PHR8, bars: 8 },
    coast: { lead: null, bass: BASS_COAST, phr: PHR_COAST, bars: 4 },
  };

  // ---------- form ----------
  const LAP = [
    { sec: "intro", half: 0 },
    { sec: "A", half: 0 }, { sec: "A", half: 1 },
    { sec: "A2", half: 0 }, { sec: "A2", half: 1 },
    { sec: "B", half: 0 }, { sec: "B", half: 1 },
    { sec: "A3", half: 0 }, { sec: "A3", half: 1 },
    { sec: "coast", half: 0 },
  ];
  // arrangement plans, rotating per lap. dbl: the mellow voice doubles the lead an octave down; orn: ornament density
  const PLANS = [
    {
      intro: { drums: "intro", pad: 1, beacon: 1, orn: 0 },
      A: { drums: "soft", pad: 1, beacon: 1, orn: 0.1 },
      A2: { drums: "full", pad: 1, keys: 1, dbl: 1, aux: "shaker", orn: 0.45 },
      B: { drums: "big", pad: 1, keys: 1, strings: 1, aux: "tamb", glint: 1, crash: 1, orn: 0.2 },
      A3: { drums: "full", pad: 1, strings: 1, glint: 1, aux: "tamb", crash: 1, orn: 0.35 },
      coast: { drums: "coast", pad: 1, beacon: 1 },
    },
    {
      intro: { drums: "soft", pad: 1, keys: 1, beacon: 1, orn: 0.2 },
      A: { drums: "full", pad: 1, keys: 1, orn: 0.3 },
      A2: { drums: "full", pad: 1, strings: 1, dbl: 1, aux: "tamb", orn: 0.5 },
      B: { drums: "big", pad: 1, keys: 1, aux: "shaker", glint: 1, crash: 1, orn: 0.25, dblB: 1 },
      A3: { drums: "big", pad: 1, strings: 1, keys: 1, dbl: 1, aux: "tamb", crash: 1, orn: 0.4 },
      coast: { drums: "coast", pad: 1, beacon: 1, strings: 1 },
    },
    {
      intro: { drums: "coast", pad: 1, beacon: 1, orn: 0 },
      A: { drums: "soft", pad: 1, strings: 1, orn: 0.2 },
      A2: { drums: "full", pad: 1, keys: 1, aux: "shaker", glint: 1, orn: 0.55 },
      B: { drums: "big", pad: 1, strings: 1, keys: 1, aux: "tamb", crash: 1, orn: 0.3, dblB: 1 },
      A3: { drums: "full", pad: 1, keys: 1, dbl: 1, glint: 1, crash: 1, orn: 0.45 },
      coast: { drums: "coast", pad: 1, beacon: 1 },
    },
  ];
  const NAMES = {
    intro: "Intro · over the B pedal", A: "A · the sigh and the bend", A2: "A · again, ornamented", B: "B · the stutter, up an octave",
    A3: "A′ · the sigh rises", coast: "Coast · the fretless sings",
  };

  // ---------- the palette ----------
  /** CS-80-ish lead: two saws a few cents apart, resonant lowpass with a slow-ish filter attack. */
  function leadSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "fatsawtooth", count: 2, spread: 7 },
      filter: { type: "lowpass", rolloff: -24, Q: 1.3 },
      envelope: { attack: 0.03, decay: 0.3, sustain: 0.85, release: 0.3 },
      filterEnvelope: { attack: 0.07, decay: 0.5, sustain: 0.55, release: 0.3, baseFrequency: 480, octaves: 2.6 },
    }));
  }
  /** Mellow FM voice for the octave-down doubling. */
  function mellowSynth(ctx) {
    return ctx.keep(new Tone.FMSynth({
      harmonicity: 1, modulationIndex: 1.3, oscillator: { type: "sine" }, modulation: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.4, sustain: 0.8, release: 0.35 },
      modulationEnvelope: { attack: 0.03, decay: 0.6, sustain: 0.4, release: 0.3 },
    }));
  }
  /** Fretless bass: round saw-ish partials, resonant lowpass; glides come from the wrapper. */
  function fretlessSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.7, 0.35, 0.25, 0.12, 0.08] },
      filter: { type: "lowpass", rolloff: -24, Q: 2.2 },
      envelope: { attack: 0.008, decay: 0.6, sustain: 0.6, release: 0.14 },
      filterEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.4, release: 0.2, baseFrequency: 140, octaves: 2.6 },
    }));
  }
  /** The beacon: a sine ping into a long ping-pong echo. */
  function beacon(ctx, I, dest, o = {}) {
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? -20)));
    const s = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.6, sustain: 0, release: 0.8 } })).connect(out);
    const mono = I.monotonic(out);
    return { out, play(time, note, vel) { s.triggerAttackRelease(T.hz(note), 0.5, mono(time), vel); } };
  }

  Sim.register({
    id: "night-approach",
    title: "Night Approach",
    genre: "Flying-game ballad",
    about: "A small aircraft descending over a lit coastline at night. E major at 84 with 16th hats and a gated snare; a CS-80-ish lead sings one hand-written line whose scoops, slurs, whole-tone bend, fall-offs and breaths are the tune, built on the phrasing engine. A stuttering staccato B theme climbs an octave; a four-bar coast lets the fretless bass slide through its own slurred phrase. Pad, string machine, electric piano, a sine beacon echoing in the dark.",
    bpm: 84, beatsPerBar: BPB, swing: 0.5, cycleBars: 4, gainDb: 0,
    situations: ["explore", "romance", "hangout"],
    energy: 0.45,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.03, lowcut: 300, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.012, lowcut: 250, highcut: 7000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.34, highcut: 3000, pingPong: true });
      // lead chain: synth → phrasing wrapper (vibrato, tremolo, swell) → light chorus → pan
      const chorus = ctx.keep(new Tone.Chorus({ frequency: 0.6, delayTime: 3.2, depth: 0.35, spread: 60, wet: 0.3 }).start());
      const lead = P.wrap(ctx, leadSynth(ctx), {
        volume: -5, glide: 0.07, scoopTime: 0.1, fallTime: 0.28, bendTime: 0.55, release: 0.3,
        vibrato: { rate: 5.2, depth: 0.09, delay: 0.38, rise: 0.45, deepen: 1.3 },
        breath: P.breath(ctx, hall, { level: -22, freq: 2300, length: 0.2 }),
      });
      lead.out.connect(chorus);
      const leadP = ctx.keep(new Tone.Panner(-0.08)).connect(out); chorus.connect(leadP);
      const mellow = P.wrap(ctx, mellowSynth(ctx), { volume: -13, glide: 0.08, release: 0.35, vibrato: { rate: 4.6, depth: 0.05, delay: 0.5 } });
      const bass = P.wrap(ctx, fretlessSynth(ctx), { volume: -11, glide: 0.11, scoopTime: 0.12, fallTime: 0.3, release: 0.14, vibrato: { rate: 4.6, depth: 0.03, delay: 0.5, rise: 0.5 } });
      const pad = I.pad(ctx, { volume: -17, cutoff: 950, attack: 1.4, release: 2.6 });
      const strings = I.stringMachine(ctx, { volume: -19, cutoff: 2600, attack: 0.5 });
      const keys = I.rhodes(ctx, { volume: -11, cutoff: 3200 });
      const glint = I.glock(ctx, { volume: -19, celesta: true, decay: 1.6 });
      const ping = beacon(ctx, I, out, { volume: -13 });
      const kit = I.kit(ctx, { volume: -1, preload: ["kick", "gatedSnare", "snare", "rim", "hatClosed", "hatOpen", "hatPedal", "tom", "crash", "tambourine", "shaker", "clap"] });
      const mlP = I.place(ctx, mellow, 0.2, out), bsP = I.place(ctx, bass, 0, out), pdP = I.place(ctx, pad, -0.2, out);
      const stP = I.place(ctx, strings, 0.3, out), kyP = I.place(ctx, keys, -0.3, out), glP = I.place(ctx, glint, 0.35, out);
      const pgP = I.place(ctx, ping, -0.4, out), ktP = I.place(ctx, kit, 0.03, out);
      I.send(ctx, leadP, hall, -12); I.send(ctx, leadP, echo, -14); I.send(ctx, leadP, room, -18);
      I.send(ctx, mlP, hall, -14); I.send(ctx, mlP, echo, -18);
      I.send(ctx, bsP, room, -28);
      I.send(ctx, pdP, hall, -10); I.send(ctx, stP, hall, -9);
      I.send(ctx, kyP, room, -14); I.send(ctx, kyP, hall, -18);
      I.send(ctx, glP, hall, -8); I.send(ctx, glP, echo, -12);
      I.send(ctx, pgP, echo, -4); I.send(ctx, pgP, hall, -10);
      I.send(ctx, ktP, room, -17);
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        mellow: { layer: "melody", play: (t, e, d) => mellow.play(t, e, d), humanize: { timing: 0.009, vel: 0.05 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e, d), humanize: { timing: 0.005, vel: 0.05 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.015, vel: 0.04 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        glint: { layer: "texture", play: (t, e, d) => glint.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.08 } },
        beacon: { layer: "texture", play: (t, e) => ping.play(t, e.note, e.vel), humanize: { timing: 0.01, vel: 0.08 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
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
      const scaleAt = (b) => T.chord(sym(b)).scale;
      const secStart = half * 16;
      const nextPos = (pos + 1) % LAP.length, nextSec = LAP[nextPos].sec, nextLap = nextPos === 0 ? lap + 1 : lap;
      const nextPlan = PLANS[nextLap % PLANS.length][nextSec];
      const lastHalf = pos === LAP.length - 1 || LAP[nextPos].sec !== sec;
      const ev = [];
      // push by beat within the SECTION (bar/beat computed for this cycle); events before the window are dropped
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -1e-6 || abs >= 16 - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const emitLine = (track, line, { up = 0, gain = 1 } = {}) => {
        for (const e of line) {
          const { bar, beat, dur, note, vel, track: _t, ...extra } = e;
          push(track, bar * BPB + beat, dur, note + up, vel * gain, extra);
        }
      };

      // ---------- the lead line: built once per section (both halves share it), ornamented by the plan ----------
      const key = `${sec}:${lap}`;
      if (!state.lines || state.lines.key !== key) {
        const rr = r.fork(11 + lap);
        const lines = { key };
        if (mat.lead) {
          const line = P.line(mat.lead, { beatsPerBar: BPB, track: "lead" });
          const orn = plan.orn ?? 0;
          line.forEach((e, i) => {
            const prev = line[i - 1];
            const leap = prev && prev.bar === e.bar ? e.note - prev.note : 0;
            const a = P.parseArt(e.art || "");
            // contour: higher and longer a touch louder; the bend and the swell carry the weight of their bars
            e.vel = 0.74 + (e.note - 76) / 90 + (e.dur >= 2 ? 0.04 : 0) + (a.bend ? 0.05 : 0) + rr.gauss(0.012);
            // ornament, never on a note that already scoops or bends: a grace from below on a leap, a mordent on a long held note
            if (!a.scoop && !a.bend && !a.staccato && !a.grace && !a.mordent) {
              if (leap >= 4 && e.dur >= 1 && rr.chance(orn * 0.7)) e.grace = "step";
              else if (e.dur >= 1.5 && !a.legato && rr.chance(orn * 0.5)) e.mordent = true;
              else if (e.dur >= 1 && leap >= 3 && rr.chance(orn * 0.4)) e.scoop = 1;
            }
            if (a.bend && e.dur >= 3) e.bendTime = 1.1; // the long B-theme bend takes its time
            if (sec === "A2" && e.dur >= 2 && !a.fall && rr.chance(orn * 0.4)) e.fall = 2;
          });
          lines.lead = P.articulate(line, mat.phr, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.1, breathLate: 0.04, breathGap: 0.15, breathFirst: true });
        }
        if (mat.bass) lines.bass = P.articulate(P.line(mat.bass, { beatsPerBar: BPB, track: "bass", vel: 0.8 }), mat.phr, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.05, breathLate: 0.02, breathGap: 0.1, overlap: 0.06 });
        state.lines = lines;
      }
      const L = state.lines;
      if (L.lead) {
        emitLine("lead", L.lead);
        if (plan.dbl || (plan.dblB && half === 1)) emitLine("mellow", L.lead.map((e) => ({ ...e, grace: undefined, mordent: undefined, breath: undefined })), { up: -12, gain: 0.8 });
      }

      // ---------- harmony: pad, strings, keys ----------
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= secStart && c.s < secStart + 16);
      for (const c of spans) {
        const isSlash = /\//.test(c.chord);
        if (plan.pad) {
          const v = T.voice(c.chord, { lo: 57, hi: 74, n: 4, prev: state.padV, rng: r, omitBass: true, top: [66, 73] });
          state.padV = v;
          push("pad", c.s, c.dur - 0.15, v, sec === "coast" || sec === "intro" ? 0.42 : 0.5);
        }
        if (plan.strings) {
          const v = T.voice(c.chord, { lo: 60, hi: 79, n: 3, prev: state.strV, rng: r, omitBass: true, top: [71, 78] });
          state.strV = v;
          push("strings", c.s, c.dur - 0.2, v, sec === "B" ? 0.46 : 0.38);
        }
        if (plan.keys) {
          const v = T.voice(c.chord, { lo: 58, hi: 76, n: isSlash ? 3 : 4, prev: state.keyV, rng: r, omitBass: true, top: [67, 74] });
          state.keyV = v;
          // electric piano: an anticipated chord and a lighter answer, or a held chord; sparser under the sigh bars
          const cell = r.weighted([["ant", sec === "B" ? 3 : 2], ["hold", 2], ["two", sec === "B" ? 2 : 1]]);
          if (cell === "ant" && c.s > secStart) push("keys", c.s - 0.25, 1.6, v, 0.42);
          else if (cell === "ant") push("keys", c.s, 1.6, v, 0.4);
          else if (cell === "hold") push("keys", c.s, c.dur - 0.5, v, 0.38);
          else { push("keys", c.s, 1.2, v, 0.4); push("keys", c.s + 2.5, 1.2, v, 0.34); }
        }
        if (plan.glint && (sec !== "B" || half === 1 || r.chance(0.4))) {
          // glints: an arpeggio up the pad voicing on the 8ths of beats 3-4, every other bar
          if (c.bar % 2 === 1) {
            const v = (state.padV || T.voice(c.chord, { lo: 60, hi: 79, n: 4, rng: r })).slice().sort((a, b) => a - b).map((m) => m + 12);
            v.forEach((m, i) => push("glint", c.s + 2 + i * 0.5, 0.5, m, 0.28 + i * 0.03));
          }
        }
      }
      // beacon: a sine ping on the ninth of the chord, every other bar, drifting in position
      if (plan.beacon) {
        for (const c of spans) {
          if (c.bar % 2 === 0 || sec === "coast") {
            const ch = T.chord(c.chord);
            const pc = ch.colors && ch.colors.length ? ch.colors[0] : T.mod12(ch.root + 7);
            const m = T.nearest(88, [pc], 84, 95);
            push("beacon", c.s + r.pick([0, 1.5, 2, 3.5]), 0.5, m, 0.5 + r.range(-0.08, 0.08));
          }
        }
      }

      // ---------- bass ----------
      if (L.bass) emitLine("bass", L.bass);
      else bassPart({ sec, plan, spans, secStart, r: r.fork(5), state, push, nextSec, lastHalf });

      // ---------- drums ----------
      drumPart({ sec, plan, half, secStart, r: r.fork(6), push, lastHalf, nextPlan, lap, cycle, bars: Math.min(4, mat.bars - half * 4) });

      const harmony = prog.filter((c) => c.bar >= half * 4 && c.bar < half * 4 + 4).map((c) => ({ ...c, bar: c.bar - half * 4 }));
      const extras = [plan.dbl ? "doubled an octave down" : "", plan.strings ? "strings" : "", plan.keys ? "e-piano" : ""].filter(Boolean).join(", ");
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${NAMES[sec]}${extras ? " · " + extras : ""}`, state };
    },
  });

  // ---------- bass: roots with fretless slides into the downbeats ----------
  function bassPart({ sec, plan, spans, secStart, r, state, push, nextSec, lastHalf }) {
    const lo = 31, hi = 52; // G1..E3
    const chords = spans;
    const nextChordSym = (i) => (i + 1 < chords.length ? chords[i + 1].chord : null);
    chords.forEach((c, i) => {
      const ch = T.chord(c.chord);
      const last = state.bassLast ?? 40;
      // roots live around E2: pulled toward the last root, but never drifting to the bottom of the neck
      const pickRoot = (from, pc) => T.nearest(Math.round((from + 43) / 2), [pc], 36, 47); // one octave, C2..B2
      const root = pickRoot(last, ch.bass);
      const fifth = T.nearest(root + 7, [T.mod12(ch.root + 7)], lo, hi);
      const hasThird = ch.intervals.includes(3) || ch.intervals.includes(4);
      const third = hasThird ? T.nearest(root + 4, [T.mod12(ch.root + (ch.intervals.includes(3) ? 3 : 4))], root + 1, hi)
        : ch.intervals.includes(5) ? T.nearest(root + 5, [T.mod12(ch.root + 5)], root + 1, hi) : fifth;
      const seventh = T.nearest(root - 2, [T.mod12(ch.root + (ch.intervals.includes(11) ? 11 : 10))], lo, hi); // the seventh below the root
      const scale = new Set(ch.scale.concat(ch.pcs).map(T.mod12));
      const nsym = nextChordSym(i);
      let nextRoot = null;
      if (nsym) nextRoot = pickRoot(root, T.chord(nsym).bass);
      else { // the next cycle's first chord: within the section, or the next section's first
        const own = TL[sec].find((x) => x.bar * 4 + x.beat === c.bar * 4 + c.beat + c.dur);
        const first = own ? own.chord : TL[nextSec][0].chord;
        nextRoot = pickRoot(root, T.chord(first).bass);
      }
      // the root arrives on the downbeat; if the previous bar ended with an approach, slide into it
      const slide = state.bassSlide; state.bassSlide = false;
      const rootExtra = slide ? { legato: true, glide: 0.12 } : r.chance(0.25) ? { scoop: 1 } : {};
      const vr = 0.84;
      const soft = sec === "intro" || plan.drums === "intro";
      const pedal = ch.bass !== ch.root;
      const cell = soft ? r.weighted([["hold", 3], ["oct", 1]]) : r.weighted([["hold", 2], ["fifth", 3], ["oct", 2], ["walk", sec === "B" ? 2.5 : 1.2], ["ghost", sec === "B" ? 1.5 : 0.6]]);
      const approach = () => { // into the next root: diatonic steps preferred (the pad is always sounding), chromatic for colour
        if (nextRoot === root) return r.weighted([[fifth, 2], [root + 12 <= hi ? root + 12 : fifth, 1]]);
        const w = (m, base) => [m, base * (scale.has(T.mod12(m)) ? 3 : 0.5)];
        return r.weighted([w(nextRoot - 1, 1.2), w(nextRoot + 1, 0.8), w(nextRoot - 2, 1.2), w(nextRoot + 2, 0.8), [T.nearest(nextRoot + 7, [T.mod12(nextRoot + 7)], lo, hi), 1.5], [T.nearest(nextRoot - 5, [T.mod12(nextRoot + 7)], lo, hi), 1]]);
      };
      const withApproach = !pedal || r.chance(0.5);
      if (cell === "hold") {
        push("bass", c.s, withApproach ? 3.2 : c.dur - 0.2, root, vr, rootExtra);
        if (withApproach) { push("bass", c.s + 3.5, 0.45, approach(), 0.6); state.bassSlide = true; }
      } else if (cell === "fifth") {
        push("bass", c.s, 1.4, root, vr, rootExtra); push("bass", c.s + 1.5, 0.45, fifth, 0.58);
        push("bass", c.s + 2, 1.4, root, vr - 0.08);
        if (withApproach) { push("bass", c.s + 3.5, 0.45, approach(), 0.6); state.bassSlide = true; }
      } else if (cell === "oct") {
        push("bass", c.s, 2.3, root, vr, rootExtra); push("bass", c.s + 2.5, 0.45, root + 12 <= hi ? root + 12 : fifth, 0.5);
        push("bass", c.s + 3, 0.9, pedal ? root : T.nearest(root + 10, [T.mod12(ch.root + (ch.intervals.includes(11) ? 11 : 10))], lo, hi), 0.56, pedal ? {} : { legato: true, glide: 0.06 });
      } else if (cell === "walk") {
        push("bass", c.s, 0.9, root, vr, rootExtra); push("bass", c.s + 1, 0.9, third, 0.6); push("bass", c.s + 2, 0.9, fifth, 0.62);
        push("bass", c.s + 3, 0.5, seventh, 0.58); push("bass", c.s + 3.5, 0.45, approach(), 0.6); state.bassSlide = true;
      } else { // ghost: the root with 16th ghost pushes
        push("bass", c.s, 1.2, root, vr, rootExtra); push("bass", c.s + 1.75, 0.2, root, 0.3); push("bass", c.s + 2, 1.2, root, vr - 0.1);
        push("bass", c.s + 2.75, 0.2, fifth, 0.3); push("bass", c.s + 3, 0.45, fifth, 0.55);
        if (withApproach) { push("bass", c.s + 3.5, 0.45, approach(), 0.6); state.bassSlide = true; }
      }
      state.bassLast = root;
    });
  }

  // ---------- drums: 16th hats, gated snare on 2 and 4, kick cells, fills at section ends ----------
  function drumPart({ sec, plan, half, secStart, r, push, lastHalf, nextPlan, lap, cycle, bars }) {
    const style = plan.drums;
    const hit = (b, voice, vel, extra) => push("drums", b, 0.1, voice, vel, extra);
    for (let bar = 0; bar < bars; bar++) {
      const s = secStart + bar * 4;
      const secBar = half * 4 + bar;
      const finalBar = lastHalf && bar === bars - 1;
      const fill = finalBar && style !== "intro" && r.chance(sec === "coast" ? 0.9 : 0.75);
      if (style === "intro" || style === "coast") {
        // hats on 8ths, pedal on 2 and 4, the kick on 1 (and the and-of-2 in the coast), a rim click now and then
        for (let e = 0; e < 8; e++) hit(s + e * 0.5, "hatClosed", e % 2 ? 0.18 : 0.28);
        hit(s + 1, "hatPedal", 0.3); hit(s + 3, "hatPedal", 0.3);
        if (style === "coast" || lap > 0) hit(s, "kick", 0.7);
        if (style === "coast") { hit(s + 2.5, "kick", 0.5); if (bar % 2 === 1) hit(s + 3, "rim", 0.4); }
        if (sec === "coast" && bar >= 2) hit(s + 1, "rim", 0.45), hit(s + 3, "rim", 0.45);
      } else {
        // hats: 16ths with 8th accents; open hat on the and-of-4 every second bar
        for (let q = 0; q < 16; q++) {
          const b = s + q * 0.25;
          if (q === 14 && secBar % 2 === 1 && !fill) { hit(b, "hatOpen", 0.4); continue; }
          if (fill && q >= 10) continue;
          const v = q % 4 === 0 ? 0.36 : q % 2 === 0 ? 0.26 : style === "big" ? 0.17 : 0.13;
          if (q % 2 === 0 || style !== "soft" || r.chance(0.35)) hit(b, "hatClosed", v);
        }
        // backbeat: gated snare on 2 and 4 (soft: rim on 2, snare on 4)
        const gate = { len: style === "big" ? 0.3 : 0.22 };
        if (style === "soft") hit(s + 1, "rim", 0.55); else hit(s + 1, "gatedSnare", style === "big" ? 0.82 : 0.72, gate);
        if (!fill) hit(s + 3, "gatedSnare", style === "big" ? 0.85 : style === "soft" ? 0.62 : 0.74, gate);
        if (style === "big") { hit(s + 1, "clap", 0.4); if (!fill) hit(s + 3, "clap", 0.42); }
        if (r.chance(style === "soft" ? 0.2 : 0.35)) hit(s + 1.75, "rim", 0.2); // ghost
        if (style !== "soft" && r.chance(0.25)) hit(s + 3.75, "snare", 0.22);
        // kick cells, the downbeat always
        const kc = r.weighted([[[0, 2.5], 3], [[0, 1.5, 2.5], 2], [[0, 2.75], 1.5], [[0, 1.75, 2.5], style === "big" ? 2 : 1], [[0, 2.5, 3.5], style === "soft" ? 0.3 : 1.2]]);
        kc.forEach((k, i) => hit(s + k, "kick", i === 0 ? 0.88 : 0.64));
        // aux percussion
        if (plan.aux === "shaker") for (let q = 0; q < 16; q++) hit(s + q * 0.25, "shaker", q % 4 === 0 ? 0.34 : q % 2 ? 0.16 : 0.24);
        if (plan.aux === "tamb") { hit(s + 1, "tambourine", 0.3); hit(s + 3, "tambourine", 0.3); if (r.chance(0.4)) hit(s + 2.5, "tambourine", 0.18); }
      }
      if (fill) {
        const kind = r.weighted([["toms", 2.5], ["snare", 1.5], ["mixed", 2]]);
        const grid = r.pick([[2.5, 2.75, 3, 3.25, 3.5, 3.75], [3, 3.25, 3.5, 3.75], [2.5, 3, 3.5, 3.75]]);
        grid.forEach((p, i) => {
          const isLast = i === grid.length - 1;
          const voice = kind === "toms" ? "tom" : kind === "snare" ? "snare" : i % 2 ? "tom" : "snare";
          hit(s + p, voice, 0.42 + i * 0.07, voice === "tom" ? { pitch: isLast ? 41 : r.pick([45, 48, 52]) } : {});
        });
      }
      if (cycle > 0 && half === 0 && bar === 0 && plan.crash) hit(s, "crash", 0.5);
    }
  }
})();

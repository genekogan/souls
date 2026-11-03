// Hydroponics Deck: space synth of the station-interior kind, 76 bpm, D major with a visit to B♭.
//
// Not the view from the window but the room behind it: grow lights, a ventilation hum, someone asleep two
// decks down. A soft FM electric piano says a short hand-written theme and then leaves it alone for a long
// while; a sine sub moves once a bar; a drum machine sits well back behind a low-pass with real ghost notes;
// a pad whose filter opens and closes over the whole lap is the form; and halfway through, the harmony slips
// a major third down to B♭ lydian for eight bars and climbs home through the borrowed iv. It should feel like
// a place, not a song: the hook comes round once every two minutes and never insists.
//
// THE TUNE (fixed by hand; the generator arranges, times and ornaments it, never rewrites it)
//   Motif: the 3rd falling to the 9th and the root, F♯ E D, on a half note and two quarters; air after it.
//   A (16 bars, two phrases):
//     | Dadd9 | Dadd9 | Gmaj9 | Gmaj9 | Bm11 | Bm11 | Em9 | A9sus4 |
//       (A) F♯ . E D | B . . . | . A B D | F♯ E D . | . . C♯ E | F♯ . . . | G F♯ E . | D . B A      half cadence
//     | Dadd9 | F♯m11 | Gmaj9 | A9sus4 | Bm9 | Gmaj7♯11 | Em11 | A9sus4 A13 |
//       F♯ . E D | C♯ . E F♯ | A . G F♯ | E D B . | . C♯ D . | C♯ . B A | G . A B | D . C♯ .          the sus resolves in the tune
//   B (8 bars, the modulation: B♭ lydian, the motif a third lower):
//     | B♭maj9 | B♭maj9 | Cadd9/B♭ | Cadd9/B♭ | Dm11 | Dm11 | E♭maj9♯11 | E♭maj9♯11 |
//       D . C B♭ | G . . . | . G C D | E D C . | . . E G | A . . . | G F D . | B♭ A G .                ♯11 as a passing colour
//   R (8 bars, home through the borrowed iv, then the theme's head):
//     | Gm11 | Gm11 | A9sus4 | A13 | Dadd9 | Gmaj9 | Em11 | A9sus4 |
//       F . D C | B♭ . . . | . . D B | C♯ . . A | F♯ . E D | B . A D | E G . F♯ | E D . .
//   Tail (4 bars): | Dadd9 | Dadd9 | Gmaj9/D | Dadd9 |   E held · rest · the motif once, quietly · rest
//   One lap: intro 4 · A 16 · B 8 · R 8 · tail 4 = 40 bars ≈ 2:06. Laps differ in dress only: which
//   drum pattern, whether the glass voice answers the rests, where the pad filter goes, the blinking lights.
(function () {
  "use strict";
  const T = Sim.theory, G = Sim.groove;
  const BPB = 4, CB = 2, BPM = 76;
  const mod12 = T.mod12;

  // ---------- notation ----------
  /** Bars of "Note beat dur, ..." ("" = empty bar) -> [{bar, beat, dur, note}]. */
  function phrase(bars) {
    const out = [];
    bars.forEach((txt, bar) => txt && txt.split(",").forEach((tok) => { const [n, b, d] = tok.trim().split(/\s+/); out.push({ bar, beat: +b, dur: +d, note: T.midi(n) }); }));
    return out;
  }

  // ---------- the score ----------
  const INTRO_CH = ["Dadd9", "Dadd9", "Gmaj9/D", "Dadd9"];
  const A_CH = ["Dadd9", "Dadd9", "Gmaj9", "Gmaj9", "Bm11", "Bm11", "Em9", "A9sus4",
    "Dadd9", "F#m11", "Gmaj9", "A9sus4", "Bm9", "Gmaj7#11", "Em11", "A9sus4 A13"];
  const A_MEL = [
    "F#5 0 2, E5 2 1, D5 3 1",
    "B4 0 2",
    "A4 1 .5, B4 1.5 .5, D5 2 2",
    "F#5 0 1.5, E5 1.5 .5, D5 2 2",
    "C#5 2 1, E5 3 1",
    "F#5 0 3",
    "G5 0 1, F#5 1 1, E5 2 2",
    "D5 0 2, B4 2 1, A4 3.5 .5",
    "F#5 0 2, E5 2 1, D5 3 1",
    "C#5 0 1.5, E5 2.5 .5, F#5 3 1",
    "A5 0 2, G5 2 1, F#5 3 1",
    "E5 0 1.5, D5 1.5 .5, B4 2 2",
    "C#5 1 1, D5 2 2",
    "C#5 0 2, B4 2 1, A4 3 1",
    "G4 0 2, A4 2 1, B4 3 1",
    "D5 0 2, C#5 2 2",
  ];
  const B_CH = ["Bbmaj9", "Bbmaj9", "Cadd9/Bb", "Cadd9/Bb", "Dm11", "Dm11", "Ebmaj9#11", "Ebmaj9#11"];
  const B_MEL = [
    "D5 0 2, C5 2 1, Bb4 3 1",
    "G4 0 2",
    "G4 1 .5, C5 1.5 .5, D5 2 2",
    "E5 0 1.5, D5 1.5 .5, C5 2 2",
    "E5 2 1, G5 3 1",
    "A5 0 3",
    "G5 0 1, F5 1 1, D5 2 2",
    "Bb4 0 1.5, A4 1.5 .5, G4 2 2",
  ];
  const R_CH = ["Gm11", "Gm11", "A9sus4", "A13", "Dadd9", "Gmaj9", "Em11", "A9sus4"];
  const R_MEL = [
    "F5 0 2, D5 2 1, C5 3 1",
    "Bb4 0 3",
    "D5 2 1, B4 3 1",
    "C#5 0 2, A4 3.5 .5",
    "F#5 0 2, E5 2 1, D5 3 1",
    "B4 0 2, A4 2 1, D5 3 1",
    "E5 0 1.5, G5 1.5 1.5, F#5 3 1",
    "E5 0 1.5, D5 1.5 2.5",
  ];
  const TAIL_CH = ["Dadd9", "Dadd9", "Gmaj9/D", "Dadd9"];
  const TAIL_MEL = ["E5 1 2", "", "F#5 0 1, E5 1 1, D5 2 2", ""];

  // the glass voice's answers in the tune's rests (laps after the first): bar index -> notes
  const ANS = {
    A: { 1: "A5 2.5 1.5", 4: "F#5 .5 1", 12: "F#5 0 .75", 15: "E5 2.5 1.5" },
    B: { 1: "F5 2.5 1.5", 4: "F5 .5 1" },
    R: { 1: "F5 3 1", 3: "E5 2 1" },
    TAIL: { 1: "B5 0 2", 3: "A5 1 2" },
  };

  const LAP = [
    { id: "INTRO", bars: 4, ch: INTRO_CH, mel: [] },
    { id: "A", bars: 16, ch: A_CH, mel: A_MEL },
    { id: "B", bars: 8, ch: B_CH, mel: B_MEL },
    { id: "R", bars: 8, ch: R_CH, mel: R_MEL },
    { id: "TAIL", bars: 4, ch: TAIL_CH, mel: TAIL_MEL },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB; // 40 bars, 20 cycles
  LAP.forEach((s) => {
    s.prog = T.progression("| " + s.ch.join(" | ") + " |", BPB);
    s.notes = phrase(s.mel);
    s.ans = phrase(Array.from({ length: s.bars }, (_, i) => (ANS[s.id] || {})[i] || ""));
  });
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    let bar = cl * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    return { lap, cl, f: LAP[i], nf: LAP[(i + 1) % LAP.length], off: bar, last: bar + CB >= LAP[i].bars };
  }

  // ---------- the dress, per lap and section ----------
  // pad filter: [cutoff at the section's start, at its end]; drums: pattern name; comp: comp figure
  function arrange(f, lap, off) {
    const L = lap % 3;
    const d = { drums: "soft", comp: "held", pad: [1000, 1500], glass: lap > 0, blink: false, fill: false, melVel: 0, mono: false };
    if (f.id === "INTRO") return { ...d, drums: lap === 0 ? "out" : L === 1 ? "thin" : off >= 2 ? "soft" : "thin", comp: lap === 0 && off < 2 ? null : "held", pad: [lap === 0 ? 520 : 700, 950], glass: false };
    if (f.id === "A" && off < 8) return { ...d, drums: lap === 0 ? (off < 4 ? "out" : "hats") : "soft", pad: [950, 1400], comp: L === 2 ? "push" : "held" };
    if (f.id === "A") return { ...d, drums: L === 2 ? "deep" : "soft", pad: [1400, 1900], comp: L === 2 ? "pulse" : L === 1 ? "push" : "held", blink: true, fill: off >= 14, melVel: 0.03 };
    if (f.id === "B") return { ...d, drums: L === 0 ? "thin" : L === 1 ? (off < 4 ? "out" : "thin") : "soft", pad: [780, 1300], comp: "held", blink: L === 2, fill: off >= 6, melVel: -0.03 };
    if (f.id === "R") return { ...d, drums: L === 2 ? "deep" : "soft", pad: [1900, 2300], comp: L === 0 ? "held" : "push", blink: true, fill: off >= 6, melVel: 0.02 };
    return { ...d, drums: off < 2 ? "thin" : "out", pad: [1500, 560], comp: "held", melVel: -0.1 };
  }
  function label(f, lap, off) {
    const n = `Lap ${lap + 1} · `;
    if (f.id === "INTRO") return n + (lap === 0 ? "the room: hum, sub, grow lights" : "the room again");
    if (f.id === "A") return n + (off < 8 ? `A · the theme${off >= 4 ? " · Bm11, the half cadence" : ""}` : `A′ · ${off < 12 ? "the climb to the 9th of G" : "♯11 on G, the sus resolves"}`);
    if (f.id === "B") return n + `B · B♭ lydian, a major third down${off >= 4 ? " · Dm11, E♭maj9♯11" : ""}`;
    if (f.id === "R") return n + (off < 4 ? "home through the borrowed iv (Gm11)" : "the theme's head, home");
    return n + "tail · the motif once, quietly";
  }

  // comp figures over a 4-beat chord: [offset, dur, vel]
  const FIG = {
    held: [[0, 2.8, 0.44]],
    push: [[0, 2.3, 0.44], [2.5, 1.2, 0.34]],
    pulse: [[0, 1.2, 0.44], [1.5, 0.8, 0.3], [2.5, 1.1, 0.36]],
  };
  // blink patterns: offsets within a 2-bar cycle, fixed per lap
  const BLINKS = [[0.5, 3.25, 5.5], [1.75, 4, 6.25], [0.25, 2.75, 7], [1.5, 4.75, 6]];

  Sim.register({
    id: "hydroponics-deck",
    title: "Hydroponics Deck",
    genre: "Space synth",
    about: "The quiet of a place where people live in orbit: a soft FM electric piano states a short hand-written theme and leaves it alone, a sine sub moves once a bar, a drum machine sits far back with real ghost notes, and a pad's filter opening and closing over the lap is the form. Halfway through, the harmony drops a major third to B♭ lydian and climbs home through the borrowed iv. Built with Sim.groove.",
    situations: ["work", "hangout", "sleep"],
    energy: 0.35,
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const Gn = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };
      const fin = (x, d) => (Number.isFinite(x) ? x : d);

      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 300, highcut: 5500 });
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.01, lowcut: 250, highcut: 5000 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "4n.", feedback: 0.32, highcut: 2400 });

      /** The keyboard: a DX-style electric piano, softer than the library Rhodes (less bark, a lower tine), stereo tremolo and a light chorus. */
      const keysG = Gn(5);
      const keysCh = ctx.keep(new Tone.Chorus({ frequency: 0.22, delayTime: 5, depth: 0.25, spread: 120, wet: 0.25 }).start()).connect(keysG);
      const keysTrem = ctx.keep(new Tone.Tremolo({ frequency: 2.9, depth: 0.2, spread: 150 }).start()).connect(keysCh);
      const keysLp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12 })).connect(keysTrem);
      const keysBody = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 16, options: {
        harmonicity: 1, modulationIndex: 1.5,
        oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.004, decay: 3.4, sustain: 0.12, release: 1.1 },
        modulationEnvelope: { attack: 0.002, decay: 0.55, sustain: 0.1, release: 0.4 },
      } })).connect(keysLp);
      const keysTine = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 16, options: {
        harmonicity: 7, modulationIndex: 0.4,
        oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
        modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      } })).connect(keysLp);
      keysTine.volume.value = -19;
      function playKeys(t, e, d) {
        const f = arr(e.note).map(hz), v = fin(e.vel, 0.5);
        keysBody.triggerAttackRelease(f, d, t, v);
        keysTine.triggerAttackRelease(f, Math.min(d, 0.4), t, v * v);
      }
      const keysP = pan(keysG, -0.12);
      I.send(ctx, keysP, hall, -14); I.send(ctx, keysP, room, -16); I.send(ctx, keysP, echo, -24);

      /** The pad: three detuned saws through the lowpass that the form moves (each event carries its target cutoff). */
      const padG = Gn(-17);
      const padCh = ctx.keep(new Tone.Chorus({ frequency: 0.18, delayTime: 6, depth: 0.5, spread: 180, wet: 0.5 }).start()).connect(padG);
      const padLp = ctx.keep(new Tone.Filter({ frequency: 700, type: "lowpass", rolloff: -24, Q: 0.9 })).connect(padCh);
      const padS = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 16, options: {
        oscillator: { type: "fatsawtooth", count: 3, spread: 14 },
        envelope: { attack: 1.4, decay: 1, sustain: 0.8, release: 3 },
      } })).connect(padLp);
      function playPad(t, e, d) {
        padS.triggerAttackRelease(arr(e.note).map(hz), d, t, fin(e.vel, 0.4));
        const cut = fin(e.cut, 1000);
        if (cut > 100) { const p = padLp.frequency; p.cancelAndHoldAtTime(t); p.linearRampToValueAtTime(cut, t + Math.max(0.5, d)); }
      }
      const padP = pan(padG, 0.1);
      I.send(ctx, padP, hall, -9);

      /** The glass voice: a triangle with a slow attack, far away; answers the tune's rests. */
      const glassG = Gn(-15);
      const glassLp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 })).connect(glassG);
      const glassS = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 6, options: {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.25, decay: 0.9, sustain: 0.35, release: 1.6 },
      } })).connect(glassLp);
      const glassP = pan(glassG, 0.4);
      I.send(ctx, glassP, hall, -5); I.send(ctx, glassP, echo, -12);

      /** The sub: a sine with a soft attack, and a quiet FM layer under a lowpass so the note reads on small speakers. */
      const sub = I.sub(ctx, { volume: -3, attack: 0.05, release: 0.6 });
      const fm = I.fmBass(ctx, { volume: -15, bite: 1.6 });
      const fmLp = ctx.keep(new Tone.Filter({ frequency: 520, type: "lowpass", rolloff: -12 })).connect(out);
      I.place(ctx, sub, 0, out);
      I.place(ctx, fm, 0, fmLp);

      /** Drum machine, far back: everything through a lowpass, a little room. */
      const kit = I.kit(ctx, { volume: -9, preload: ["kick808", "snare808", "rim", "hat808", "hat808Open", "hatPedal", "shaker"] });
      const kitLp = ctx.keep(new Tone.Filter({ frequency: 2800, type: "lowpass", rolloff: -12 })).connect(out);
      const kitHp = ctx.keep(new Tone.Filter({ frequency: 45, type: "highpass" })).connect(kitLp);
      const kp = I.place(ctx, kit, 0.04, kitHp);
      I.send(ctx, kp, room, -13);

      /** Ventilation: pink noise through a slowly wandering bandpass, very low; retriggered each cycle so the texture mute silences it. */
      const airG = Gn(-30);
      const airBp = ctx.keep(new Tone.Filter({ frequency: 900, type: "bandpass", Q: 0.6 })).connect(airG);
      const airLfo = ctx.keep(new Tone.LFO({ frequency: 0.045, min: 600, max: 1500 }).start());
      airLfo.connect(airBp.frequency);
      const airS = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 2.5, decay: 0.1, sustain: 1, release: 3.5 } })).connect(airBp);
      const airSafe = I.monotonic(airG);
      pan(airG, -0.3);

      /** Blink: a short sine tick, a status light somewhere in the room, with a little echo. */
      const blinkG = Gn(-21);
      const blinkHp = ctx.keep(new Tone.Filter({ frequency: 700, type: "highpass" })).connect(blinkG);
      const blinkS = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.05 } })).connect(blinkHp);
      const blinkSafe = I.monotonic(blinkG);
      const blinkP = pan(blinkG, 0.45);
      I.send(ctx, blinkP, echo, -8); I.send(ctx, blinkP, hall, -12);

      return {
        keys: { layer: "melody", play: playKeys, humanize: { timing: 0.008, vel: 0.05 } },
        glass: { layer: "melody", play: (t, e, d) => glassS.triggerAttackRelease(arr(e.note).map(hz), d, t, fin(e.vel, 0.3)), humanize: { timing: 0.015, vel: 0.05 } },
        comp: { layer: "harmony", play: playKeys, humanize: { timing: 0.01, vel: 0.04 } },
        pad: { layer: "harmony", play: playPad, humanize: { timing: 0.02, vel: 0.02 } },
        bass: { layer: "bass", play: (t, e, d) => { sub.play(t, e.note, d, e.vel); fm.play(t, e.note, d, e.vel * 0.9); }, humanize: { timing: 0.003, vel: 0.03 } },
        drums: { layer: "drums", play: (t, e, d) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.003, vel: 0.06 } },
        air: { layer: "texture", play: (t, e, d) => airS.triggerAttackRelease(d, airSafe(t), fin(e.vel, 0.3)), humanize: { timing: 0, vel: 0 } },
        blink: { layer: "texture", play: (t, e, d) => blinkS.triggerAttackRelease(hz(arr(e.note)[0]), 0.05, blinkSafe(t), fin(e.vel, 0.2)), humanize: { timing: 0.002, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, off } = W;
      const A = arrange(f, lap, off);
      const prog = f.prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const chordAt = T.chordAtFactory(prog, BPB);
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const slice = (notes) => notes.filter((n) => n.bar >= off && n.bar < off + CB).map((n) => ({ ...n, bar: n.bar - off, abs: (n.bar - off) * BPB + n.beat }));
      if (state.lap !== lap) { state.lap = lap; state.blink = BLINKS[r.fork(lap + 11).pick([0, 1, 2, 3])]; }

      // ---------- the theme ----------
      const mel = slice(f.notes);
      let ornBar = -1;
      mel.forEach((n, i) => {
        const on = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
        let v = (on ? (n.beat % 2 === 0 ? 0.62 : 0.58) : 0.54) + A.melVel + (lap > 0 ? 0.02 : 0);
        if (n.dur >= 2) v += 0.04;
        if (n.note >= 81) v += 0.05;
        if (n.beat >= 3.5) v -= 0.08; // pickups
        const art = n.dur <= 0.5 ? n.dur * 0.9 : n.dur - 0.1;
        // an ornament now and then, from the second lap: a grace from the scale step below into a long note
        if (lap > 0 && n.dur >= 2 && n.bar !== ornBar && i < mel.length - 1 && r.chance(0.14)) {
          ornBar = n.bar;
          const c = T.chord(chordAt(n.abs).chord);
          push("keys", n.abs, 0.12, T.step(n.note, -1, c.scale), v - 0.14);
          push("keys", n.abs + 0.125, art - 0.125, n.note, v);
          return;
        }
        push("keys", n.abs, art, n.note, v);
      });
      // ---------- the glass answers ----------
      if (A.glass) slice(f.ans).forEach((n) => push("glass", n.abs, n.dur, n.note, 0.3 + (n.dur >= 1.5 ? 0.03 : 0)));

      // ---------- comp (under the tune: three voices, top no higher than F#4) ----------
      const voicer = (key, opts) => {
        const cache = new Map();
        return (b) => {
          const h = chordAt(b), id = h.bar * BPB + h.beat;
          if (!cache.has(id)) {
            const c = T.chord(h.chord);
            let v = T.voice(h.chord, { ...opts, prev: state[key], rng: r });
            // no semitone rubs inside the voicing: lift the upper note an octave when there is room, else drop it
            for (let guard = 0; guard < 3; guard++) {
              const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
              if (i < 0) break;
              if (v[i] + 12 <= opts.hi && !v.includes(v[i] + 12)) v[i] += 12; else v.splice(c.guide.includes(mod12(v[i])) ? i - 1 : i, 1);
              v.sort((a, b) => a - b);
            }
            state[key] = v; cache.set(id, v);
          }
          return cache.get(id);
        };
      };
      const compV = voicer("vComp", { lo: 52, hi: 66, n: 3, top: [59, 66], omitBass: true });
      if (A.comp) {
        prog.forEach((h) => {
          const s0 = h.bar * BPB + h.beat;
          const fig = h.dur < 4 ? [[0, h.dur - 0.4, 0.42]] : FIG[A.comp];
          fig.forEach(([o, d, v]) => {
            if (o >= h.dur - 0.01) return;
            if (o > 0 && r.chance(0.12)) return; // the player leaves one out now and then
            push("comp", s0 + o, Math.min(d, h.dur - o - 0.1), compV(s0 + o), v + r.range(-0.03, 0.03));
          });
        });
      }
      // ---------- pad: one gesture per chord, the filter walking toward the section's target ----------
      // An open stack, not a close voicing: root and fifth low (a drone), then two colour tones floating a
      // tenth or more above, led smoothly from the last chord. Saws in seconds get thick; this stays clear.
      const padVoice = (sym) => {
        const c = T.chord(sym), prev = state.vPad || null;
        const R = T.nearest(prev ? prev[0] : 52, [c.root], 50, 57);
        const fifth = c.intervals.find((i) => i === 7 || i === 6 || i === 8);
        const low = fifth != null ? [R, R + fifth] : [R];
        const pool = [...new Set([...c.guide, ...c.colors, ...(fifth != null ? [mod12(c.root + fifth)] : []), c.root])];
        const upper = [];
        const want = f.id === "A" || f.id === "R" ? 2 : 3;
        const topLo = Math.max(R + 14, 62), topHi = 76;
        const anchor = prev ? prev[prev.length - 1] : 69;
        for (const pc of pool) {
          if (upper.length >= want) break;
          const m = T.nearest(anchor - 3 * upper.length, [pc], topLo, topHi);
          if (upper.some((x) => Math.abs(x - m) < 3) || low.some((x) => Math.abs(x - m) % 12 === 1)) continue;
          upper.push(m);
        }
        const v = low.concat(upper).sort((a, b) => a - b);
        state.vPad = v;
        return v;
      };
      prog.forEach((h) => {
        const s0 = h.bar * BPB + h.beat, u = (off + h.bar + h.dur / BPB) / f.bars;
        const cut = Math.round(A.pad[0] + (A.pad[1] - A.pad[0]) * u);
        push("pad", s0, h.dur - 0.1, padVoice(h.chord), (f.id === "B" ? 0.4 : 0.36) + r.range(-0.02, 0.02), { cut });
      });
      // ---------- the sub: once a bar ----------
      prog.forEach((h) => {
        const s0 = h.bar * BPB + h.beat, c = T.chord(h.chord);
        const m = T.nearest(state.subLast ?? 38, [c.bass], 31, 43);
        const again = state.subLast === m && h.beat === 0;
        state.subLast = m;
        push("bass", s0, h.dur - 0.3, m, (again ? 0.62 : 0.72) + (f.id === "R" ? 0.04 : 0));
        if (A.comp === "pulse" && h.dur >= 4 && m <= 38 && (off + h.bar) % 2 === 1 && r.chance(0.7)) push("bass", s0 + 3.5, 0.4, m + 12, 0.48);
      });
      // ---------- ventilation ----------
      push("air", 0, CB * BPB + 0.5, "air", f.id === "INTRO" || f.id === "TAIL" ? 0.36 : 0.26, { straight: true });
      // ---------- blinking lights ----------
      if (A.blink && r.chance(0.75)) {
        state.blink.forEach((o) => {
          if (r.chance(0.2)) return;
          const c = T.chord(chordAt(o).chord);
          const pc = c.colors.length ? c.colors[0] : mod12(c.root + 7);
          push("blink", o, 0.1, T.nearest(91, [pc], 86, 98), 0.2 + r.range(-0.03, 0.03), { straight: true });
        });
      }

      // ---------- drums ----------
      const D = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      const L = lap % 3;
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = off + i, odd = bar % 2 === 1, st = A.drums;
        if (st === "out") continue;
        const fillBar = A.fill && i === CB - 1;
        const K = (b, v) => D(B0 + b, "kick808", v, { pitch: 29 });
        const SN = (b, v) => D(B0 + b, lap === 0 ? "rim" : "snare808", v);
        const GH = (b, p, voice = "snare808") => { if (r.chance(p)) D(B0 + b, voice, 0.3, { ghost: true }); };
        if (st === "hats") {
          for (let q = 0; q < 8; q++) D(B0 + q / 2, "hat808", q % 2 ? 0.2 : 0.26);
          GH(1.75, 0.3, "hat808"); GH(3.75, 0.4, "hat808");
          continue;
        }
        if (st === "thin") {
          K(0, 0.6); if (odd) K(2.5, 0.42);
          SN(2, 0.4);
          [1, 3].forEach((b) => D(B0 + b, "hatPedal", 0.26));
          GH(3.5, 0.35, "rim");
          continue;
        }
        // soft / deep: the pocket
        for (let q = 0; q < 8; q++) D(B0 + q / 2, "hat808", q % 2 ? 0.22 : 0.3);
        GH(1.75, 0.4, "hat808"); GH(3.75, 0.5, "hat808");
        if (odd && st === "deep") D(B0 + 3.5, "hat808Open", 0.2);
        K(0, 0.66); K(2.5, 0.5);
        if (odd && r.chance(st === "deep" ? 0.7 : 0.3)) K(3.75, 0.36);
        if (!odd && st === "deep" && r.chance(0.4)) K(1.75, 0.34);
        SN(1, 0.44); SN(3, 0.46);
        GH(1.5, odd ? 0.3 : 0.12); GH(2.25, 0.3); GH(3.5, 0.4);
        if (st === "deep") for (let q = 1; q < 8; q += 2) D(B0 + q / 2, "shaker", 0.2);
        if (fillBar && lap > 0) {
          [[3.25, 0.26], [3.5, 0.3], [3.75, 0.36]].forEach(([b, v]) => D(B0 + b, "rim", v, { fill: true }));
          ev = G.crescendo(ev, { track: "drums", from: B0 + 3, to: B0 + 4, v0: 0.9, v1: 1.15 });
        }
      }

      // ---------- feel: the grid above, Sim.groove moving it ----------
      ev = G.ghosts(ev, { track: "drums", vel: 0.2, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: {
            kick808: "straight", snare808: { template: "laidback", amount: 1.25 }, rim: { template: "laidback", amount: 1.1 },
            hat808: "mpc58", hat808Open: "mpc58", hatPedal: "straight", shaker: { template: "mpc58", late: -3 },
          } },
          bass: { template: "straight", late: 5 },
          keys: { template: "mpc54", late: 14, vels: false },
          comp: { template: "straight", late: 22 },
          glass: { template: "straight", late: 30 },
          pad: { template: "straight", late: 35 },
        },
      });
      ev = G.rubato(ev, { track: "keys", bpm: BPM, bpb: BPB, amount: f.id === "B" ? 0.7 : 0.5, linger: "high", lingerMs: 45, rng: r });

      return { events: ev, harmony: prog, section: label(f, lap, off), state };
    },
  });
})();

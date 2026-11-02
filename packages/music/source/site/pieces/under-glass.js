// Under Glass: a chaconne for a glasshouse at night. E minor, 78 bpm.
//
// A conservatory after closing: warm and damp inside, frost on the panes, the irrigation pump turning
// over on its timer, condensation dripping from the roof bars. Someone is sitting in there not sleeping.
// The pump is the ground: four notes, E B D A, that never change pitch or order for the whole piece. The
// drama is how far the harmony and the tune can travel over a bass that refuses to move, and the one
// moment where it turns out the ground was the tune all along.
//
// THE GROUND (fixed, every bar of the piece)
//   | E2 . . B2 | D3 . . A2 |   dotted half + quarter, twice: the pump's long stroke and its short return.
//   It is a pentatonic fragment with no third, so above it E can be a root (Em), a third (C, Cmaj7),
//   a sixth (G), a ninth (D), a fifth (Am), an eleventh (Bm) or a major seventh (F lydian), and the
//   D–A bar can be the floor of Bb major or Eb lydian. The piece walks that ring and comes back.
//
// THE HOOK (8 bars = 4 grounds; fixed by hand, the generator only dresses it)
//   A three-note figure, a leap of a fourth onto a long note and a late step down, stated three times
//   in sequence, each time a step lower, each time landing on a held note that the pump re-colours:
//     bar 1  G4 . C5 . . . . B4   the fourth lands on C, the b6: the ache held for 2½ beats over Em
//     bar 2  A4 . . . (rest)      lands on the eleventh (the ground's own A): unresolved, hollow
//     bar 3  E4 . A4 . . . . G4   the figure on C (Cmaj13/E: E is now a third)
//     bar 4  F#4 . . .            lands on the lydian #11 of C over the D–A bar
//     bar 5  D4 . G4 . . . . F#4  the figure on G, the low point of the tune
//     bar 6  E4 . . .             lands on the ninth of D
//     bar 7  B4 C5 . E5 . .       the answer breaks the sequence: a climb to the peak E5 over Am9
//     bar 8  D5 . B4 F#4 . .      falls through Bm11 to F#, which resolves up to G when the hook returns
//   Landings A, F#, E: a slow descending line hidden across six bars; then the climb.
//   Counter-line (half notes, mostly contrary, for the return): E D | F# E | C B | D A | B D | B A | E G | A B
//
// THE PANES (one lap = intro 4 · five panes of 8 · tag 4 = 48 bars ≈ 2:28). The tune never changes;
// each pane re-harmonises it over the same ground, with hand-written pad voicings:
//   I   home       | Em7b13 | Em11 | Cmaj13/E | Cmaj13#11/D | Gmaj13/E | D69/D | Am9/E | Bm11/D |
//   II  the major  | Am9/E | Am11/D | Gmaj13/E | Gmaj9/D | Cmaj13#11/E | Am11/D | Cmaj7/E | D69/D |
//       reading      (E heard as a fifth and a sixth: the tune sounds like G major)
//   III the far    | Cmaj7/E | Bbmaj7/D | Am9/E | D9 | Gmaj13/E | Bbmaj7#11/D | Fmaj13#11/E | Gmaj9/D |
//       side         (the pad slides down by semitones, Em–Bb–Am, the first chromatic chord of the
//                    piece lands under the tune's held A; the pump's D is suddenly the third of Bb;
//                    the far point is Bb lydian with the tune's E as its #11; F lydian over E in the bass)
//   IV  the swap   the ground goes upstairs: the lead sings E B D A as if it were the melody, the bells
//                  double it, and the bass plays the hook two octaves down. No kit. (home chords)
//   V   return     home harmony, full band, counter-line, bells shadowing the long notes, and one
//                  residue of the far side: Bbmaj7#11 under the held E in bar 6.
//   tag: the hook's F# resolves G–E over Em; the bells remember the ground over Cmaj13 and Bm11 (the hook's
//        last chord), which hands the next lap's intro back to E minor; the kit thins to drips.
//
// PALETTE (built here): a "glass" lead (FM with a bell onset that decays into a near-sine, late vibrato),
// a hollow "reed" (odd-harmonic MonoSynth through a formant) for the counter-line and alternate laps,
// a "pane" pad (fat triangles through a slowly drifting lowpass, like the hum of a fluorescent fitting),
// a round "pump" bass, three panned drip voices (membrane plinks on chord tones), a brown-noise fan,
// plus stock glockenspiel, sub and a very soft kit. Sends: a damp room, a long glass hall, a water delay.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4, CB = 4;
  const mod12 = T.mod12;

  // ---------- notation ----------
  /** Bars of "Note beat dur, ..." (null = empty bar) -> [{bar, beat, dur, note}], transposed by k. */
  function phrase(bars, k = 0) {
    const out = [];
    bars.forEach((txt, bar) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => {
        const [n, b, d] = tok.trim().split(/\s+/);
        out.push({ bar, beat: +b, dur: +d, note: T.midi(n) + k });
      });
    });
    return out;
  }
  const chordNotes = (txt) => txt.split(/\s+/).map((n) => T.midi(n));

  // ---------- the score ----------
  const HOOK = [
    "G4 0 1, C5 1 2.5, B4 3.5 .5",
    "A4 0 3",
    "E4 0 1, A4 1 2.5, G4 3.5 .5",
    "F#4 0 3",
    "D4 0 1, G4 1 2.5, F#4 3.5 .5",
    "E4 0 3",
    "B4 0 1, C5 1 1.5, E5 2.5 1.5",
    "D5 0 1.5, B4 1.5 1, F#4 2.5 1.5",
  ];
  const COUNTER = ["E4 0 2, D4 2 2", "F#4 0 2, E4 2 2", "C4 0 2, B3 2 2", "D4 0 2, A3 2 2", "B3 0 2, D4 2 2", "B3 0 2, A3 2 2", "E4 0 2, G4 2 2", "A3 0 2, B3 2 2"];
  const COUNTER_RESIDUE6 = null; // the reed sits out the Bb residue (its B natural would rub, and the silence shows the colour)
  const GROUND = ["E2 0 3, B2 3 1", "D3 0 3, A2 3 1"]; // the pump; every bar of the piece
  const TAG_MEL = ["G4 0 2, E4 2 2", null, null, null];

  const PANES = {
    I: {
      ch: ["Em7b13", "Em11", "Cmaj13/E", "Cmaj13#11/D", "Gmaj13/E", "D69/D", "Am9/E", "Bm11/D"],
      pad: ["G3 D4 E4", "G3 B3 E4", "G3 B3 E4", "A3 B3 E4", "F#3 B3 D4", "F#3 B3 D4", "G3 C4 E4", "F#3 A3 D4"],
    },
    II: {
      ch: ["Am9/E", "Am11/D", "Gmaj13/E", "Gmaj9/D", "Cmaj13#11/E", "Am11/D", "Cmaj7/E", "D69/D"],
      pad: ["A3 C4 E4", "A3 C4 G4", "G3 B3 D4", "G3 B3 D4", "G3 C4 E4", "A3 C4 G4", "G3 C4 E4", "F#3 A3 B3"],
    },
    III: {
      ch: ["Cmaj7/E", "Bbmaj7/D", "Am9/E", "D9", "Gmaj13/E", "Bbmaj7#11/D", "Fmaj13#11/E", "Gmaj9/D"],
      pad: ["B3 E4 G4", "Bb3 D4 F4", "A3 C4 E4", "A3 C4 E4", "G3 B3 D4", "F3 Bb3 D4", "F3 A3 C4", "F#3 A3 D4"],
    },
  };
  // V = I with the far side's residue in bar 6
  PANES.V = { ch: PANES.I.ch.slice(), pad: PANES.I.pad.slice() };
  PANES.V.ch[5] = "Bbmaj7#11/D"; PANES.V.pad[5] = "F3 Bb3 D4";
  PANES.IV = PANES.I;
  const INTRO = { ch: ["Em9", "Em11", "Em9", "Em11"], pad: ["B3 E4 G4", "G3 B3 E4", "B3 E4 G4", "G3 B3 E4"] };
  const TAG = { ch: ["Em9", "Em11", "Cmaj13/E", "Bm11/D"], pad: ["B3 E4 G4", "G3 B3 E4", "G3 B3 E4", "F#3 A3 D4"] };

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "I", bars: 8 },
    { id: "II", bars: 8 },
    { id: "III", bars: 8 },
    { id: "IV", bars: 8 },
    { id: "V", bars: 8 },
    { id: "tag", bars: 4 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;

  const secCache = new Map();
  function section(f) {
    if (secCache.has(f.id)) return secCache.get(f.id);
    const src = f.id === "intro" ? INTRO : f.id === "tag" ? TAG : PANES[f.id];
    const s = {
      ch: src.ch, pad: src.pad.map(chordNotes),
      mel: f.id === "intro" ? [] : f.id === "tag" ? phrase(TAG_MEL) : phrase(HOOK),
      cnt: phrase(COUNTER),
      prog: T.progression("| " + src.ch.join(" | ") + " |", BPB),
    };
    secCache.set(f.id, s);
    return s;
  }
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, i, f, nf, off: bar, half: bar / CB, lastHalf: bar + CB >= f.bars };
  }

  // ---------- arrangement ----------
  // lead: who sings the hook. cnt: counter-line voice. bells: "shadow" (hook long notes +12) | "ground" | null.
  // bass: "plain" | "oct" | "pulse". drums: "none" | "tick" | "pulse" | "groove". drips: per bar.
  function arrange(f, lap, half) {
    const L = lap % 4;
    const base = { lead: "glass", cnt: null, bells: null, bass: "plain", sub: false, pad: 0.5, drums: "tick", drips: 1, fan: false, orn: lap > 0, fill: false, swell: false, reedTop: false };
    if (f.id === "intro") return { ...base, pad: lap ? 0.42 : 0, drums: lap ? "tick" : "none", drips: lap ? 1.2 : 1.8, fan: true, fill: lap > 0 };
    if (f.id === "I") return { ...base, cnt: lap >= 2 && L % 2 === 0 ? "reed" : null, drums: lap ? "pulse" : "tick", drips: 1.1, fill: half === 1 };
    if (f.id === "II") return { ...base, lead: L % 2 ? "reed" : "glass", bells: L % 2 ? null : "shadow", bass: "oct", drums: "pulse", pad: 0.52, drips: 0.9, fill: half === 1 };
    if (f.id === "III") return { ...base, bass: "pulse", sub: true, drums: lap ? "groove" : "pulse", pad: 0.56, drips: 0.7, reedTop: L >= 2, fill: half === 1, swell: half === 1 };
    if (f.id === "IV") return { ...base, lead: "swap", bells: "ground", bass: "hook", pad: half ? 0.36 : 0, drums: "none", drips: 1.4, fan: half === 0, swell: half === 1 };
    if (f.id === "V") return { ...base, cnt: "reed", bells: L % 2 ? "shadow" : null, bass: "oct", sub: true, drums: "groove", pad: 0.58, drips: 0.5, fill: half === 1 };
    return { ...base, bells: "ground", bass: "plain", drums: half ? "none" : "tick", drips: 1.6, fan: true, pad: 0.44 };
  }
  function label(f, lap, half) {
    const n = `Lap ${lap + 1} · `;
    if (f.id === "intro") return n + (lap ? "intro · the pump, the pad and the hats" : "the pump alone · E B D A");
    if (f.id === "I") return n + `pane I · home · ${half ? "Gmaj13 · D6/9 · the climb over Am9" : "the ache on C over Em · Cmaj13/E"}`;
    if (f.id === "II") return n + `pane II · the major reading · ${half ? "C lydian · Am11 · D6/9" : "Am9/E · Gmaj9/D"}`;
    if (f.id === "III") return n + `pane III · the far side · ${half ? "Bb lydian under the held E · F lydian over E" : "the pad slides Em–Bb–Am · D9"}`;
    if (f.id === "IV") return n + `pane IV · the swap · the ground is the tune${half ? " · the pad returns" : " · bass sings the hook"}`;
    if (f.id === "V") return n + `pane V · return · counter-line${half ? " · a residue of Bb" : " · full band"}`;
    return n + "tag · F# resolves G–E · the bells remember the ground";
  }

  const FILLS = [
    [[3, "tom", 0.42, 50], [3.5, "tom", 0.46, 45]],
    [[2.5, "rim", 0.3], [3, "rim", 0.34], [3.5, "tom", 0.4, 45]],
    [[3, "brushTap", 0.36], [3.25, "brushTap", 0.3], [3.5, "brushTap", 0.38], [3.75, "brushTap", 0.42]],
  ];

  Sim.register({
    id: "under-glass",
    title: "Under Glass",
    genre: "Chaconne",
    about: "A chaconne for a glasshouse at night: a four-note pump bass (E B D A) that never moves, and a hand-written hook, a leap of a fourth onto a held note stated three times a step lower each time, that five panes of harmony re-colour over it: home in E minor, a major reading, the far side where the pad slides by semitones into Bb and F lydian, a swap where the lead sings the ground and the bass sings the tune, and a return with a counter-line. A glass FM lead with late vibrato, a hollow reed, a humming pane pad, drips, a fan, a glockenspiel and a very soft kit.",
    situations: ["hangout", "work", "sleep"],
    energy: 0.3,
    bpm: 78, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const G = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };

      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.018, lowcut: 240, highcut: 5200 });
      const hall = I.reverb(ctx, out, { decay: 6.5, preDelay: 0.04, lowcut: 320, highcut: 4200 });
      // The water: a dotted-8th ping-pong echo, dark, feeding back a little
      const water = I.delay(ctx, out, { time: "8n.", feedback: 0.34, highcut: 2600, pingPong: true });

      /** Glass lead: FM whose modulator rings at the onset then dies to a near-sine; vibrato arrives late. */
      function glass(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12, Q: 0.5 })).connect(g);
        const trem = ctx.keep(new Tone.Tremolo({ frequency: o.trem, depth: 0.16, spread: 80 }).start());
        trem.connect(lp);
        const s = ctx.keep(new Tone.FMSynth({
          harmonicity: o.ratio, modulationIndex: o.index, portamento: 0.01,
          oscillator: { type: "sine" }, modulation: { type: "triangle" },
          envelope: { attack: o.attack, decay: 0.35, sustain: 0.85, release: o.release },
          modulationEnvelope: { attack: 0.004, decay: o.modDecay, sustain: o.modSus, release: 0.3 },
        })).connect(trem);
        const lfo = ctx.keep(new Tone.LFO({ frequency: o.rate, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0)); // cents
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const tt = safe(t), f = hz(e.note);
            if (e.bend) { s.triggerAttackRelease(hz(e.note - e.bend), d, tt, e.vel); s.frequency.exponentialRampToValueAtTime(f, tt + 0.11); }
            else s.triggerAttackRelease(f, d, tt, e.vel);
            const p = depth.gain;
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > o.vibDelay + 0.2) { p.setValueAtTime(0, tt + o.vibDelay); p.linearRampToValueAtTime(o.vibCents, tt + o.vibDelay + 0.5); }
          },
        };
      }
      const glassLead = glass({ volume: -13, cutoff: 3800, trem: 3.1, ratio: 2, index: 1.6, attack: 0.05, release: 0.6, modDecay: 0.9, modSus: 0.12, rate: 4.6, vibDelay: 0.5, vibCents: 14 });
      const gl = pan(glassLead.out, -0.08);
      I.send(ctx, gl, hall, -11); I.send(ctx, gl, water, -14);

      /** Hollow reed: odd harmonics through a formant peak; slower attack; a slower, deeper vibrato. */
      function reed(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12 })).connect(g);
        const formant = ctx.keep(new Tone.Filter({ frequency: 1050, type: "peaking", Q: 1.6, gain: 6 })).connect(lp);
        const s = ctx.keep(new Tone.MonoSynth({
          portamento: 0.02,
          oscillator: { type: "custom", partials: [1, 0.02, 0.55, 0.02, 0.32, 0.01, 0.16, 0.01, 0.07] },
          filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
          envelope: { attack: 0.07, decay: 0.25, sustain: 0.8, release: 0.3 },
          filterEnvelope: { attack: 0.08, decay: 0.4, sustain: 0.6, release: 0.3, baseFrequency: 520, octaves: 1.6 },
        })).connect(formant);
        const lfo = ctx.keep(new Tone.LFO({ frequency: 4.1, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0));
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const tt = safe(t);
            s.triggerAttackRelease(hz(e.note), d, tt, e.vel);
            const p = depth.gain;
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > 0.8) { p.setValueAtTime(0, tt + 0.45); p.linearRampToValueAtTime(10, tt + 1.0); }
          },
        };
      }
      const reedV = reed({ volume: -15, cutoff: 2600 });
      const rp = pan(reedV.out, 0.3);
      I.send(ctx, rp, room, -12); I.send(ctx, rp, hall, -16);

      /** Pane pad: three detuned triangles per voice, slow envelope, through a lowpass that drifts (the hum). */
      const padG = G(-19);
      const padTrem = ctx.keep(new Tone.Tremolo({ frequency: 0.7, depth: 0.22, spread: 120 }).start());
      padTrem.connect(padG);
      const padDrift = ctx.keep(new Tone.AutoFilter({ frequency: 0.045, baseFrequency: 520, octaves: 2.1, filter: { type: "lowpass", rolloff: -12, Q: 0.9 }, wet: 1 }).start());
      padDrift.connect(padTrem);
      const padS = ctx.keep(new Tone.PolySynth({
        voice: Tone.Synth, maxPolyphony: 12,
        options: {
          oscillator: { type: "fattriangle", count: 3, spread: 16 },
          envelope: { attack: 0.9, decay: 0.5, sustain: 0.8, release: 1.7 },
        },
      })).connect(padDrift);
      const pp = pan(padG, 0.05);
      I.send(ctx, pp, hall, -9);

      /** Pump bass: a round saw-ish wave with a short filter stroke, so each note has a soft knock. */
      const bassG = G(-14);
      bassG.connect(out);
      const bassLp = ctx.keep(new Tone.Filter({ frequency: 1100, type: "lowpass", rolloff: -12 })).connect(bassG);
      const bassS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.55, 0.22, 0.09, 0.04] },
        filter: { type: "lowpass", rolloff: -24, Q: 1 },
        envelope: { attack: 0.006, decay: 0.3, sustain: 0.5, release: 0.14 },
        filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.25, release: 0.1, baseFrequency: 90, octaves: 3 },
      })).connect(bassLp);
      const bassSafe = I.monotonic(bassG);
      I.send(ctx, bassG, room, -24);

      /** Drips: three membrane plinks at different pans; a tiny pitch fall gives the water. */
      const dripVoices = [-0.55, 0.12, 0.6].map((p) => {
        const g = G(-17);
        const pn = ctx.keep(new Tone.Panner(p)); g.connect(pn); pn.connect(out);
        const hp = ctx.keep(new Tone.Filter({ frequency: 900, type: "highpass", rolloff: -12 })).connect(g);
        const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.014, octaves: 0.7, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.12 } })).connect(hp);
        I.send(ctx, g, water, -8); I.send(ctx, g, hall, -14);
        return { s, safe: I.monotonic(g) };
      });

      /** Fan: brown noise with a slow swell, through a bandpass that wanders. */
      const fanG = G(-27);
      fanG.connect(out);
      const fanBp = ctx.keep(new Tone.Filter({ frequency: 700, type: "bandpass", Q: 0.7 })).connect(fanG);
      const fanLfo = ctx.keep(new Tone.LFO({ frequency: 0.07, min: 380, max: 1300 }).start());
      fanLfo.connect(fanBp.frequency);
      const fanS = ctx.keep(new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 1.8, decay: 0.6, sustain: 0.55, release: 2.4 } })).connect(fanBp);
      const fanSafe = I.monotonic(fanG);
      I.send(ctx, fanG, hall, -10);

      // Stock colours for support: glockenspiel (celesta-ish), sub, kit.
      const bells = I.glock(ctx, { volume: -15, decay: 2.6, celesta: true });
      const sub = I.sub(ctx, { volume: -9, attack: 0.03, release: 0.4 });
      const kit = I.kit(ctx, { volume: -5, kickNote: 33, preload: ["softKick", "rim", "hatClosed", "hatPedal", "hatOpen", "shaker", "tom", "brushTap", "brushSweep", "ride"] });
      const bp = I.place(ctx, bells, 0.38, out), sp = I.place(ctx, sub, 0, out), kp = I.place(ctx, kit, -0.04, out);
      I.send(ctx, bp, hall, -8); I.send(ctx, bp, water, -13); I.send(ctx, kp, room, -17);

      return {
        glass: { layer: "melody", play: (t, e, d) => glassLead.play(t, e, d), humanize: { timing: 0.007, vel: 0.04 } },
        reed: { layer: "melody", play: (t, e, d) => reedV.play(t, e, d), humanize: { timing: 0.008, vel: 0.04 } },
        bells: { layer: "melody", play: (t, e, d) => bells.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        reedCnt: { layer: "harmony", play: (t, e, d) => reedV.play(t, e, d), humanize: { timing: 0.008, vel: 0.04 } },
        pad: { layer: "harmony", play: (t, e, d) => padS.triggerAttackRelease(arr(e.note).map(hz), d, t, e.vel), humanize: { timing: 0.012, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bassS.triggerAttackRelease(hz(arr(e.note)[0]), d, bassSafe(t), e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        sub: { layer: "bass", play: (t, e, d) => sub.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.03 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
        drips: { layer: "texture", play: (t, e, d) => { const v = dripVoices[e.v || 0]; v.s.triggerAttackRelease(hz(e.note), 0.2, v.safe(t), e.vel); }, humanize: { timing: 0.02, vel: 0.15 } },
        fan: { layer: "texture", play: (t, e, d) => fanS.triggerAttackRelease(d, fanSafe(t), e.vel), humanize: { timing: 0.03, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, nf, off, half } = W;
      const S = section(f), NS = section(nf);
      const A = arrange(f, lap, half);
      const nextLap = W.i + 1 >= LAP.length ? lap + 1 : lap;
      const nextA = arrange(nf, nextLap, 0);
      const prog = S.prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const inBars = (notes) => notes.filter((n) => n.bar >= off && n.bar < off + CB).map((n) => ({ ...n, bar: n.bar - off, abs: (n.bar - off) * BPB + n.beat }));
      const ground = (bar) => phrase([GROUND[bar % 2]]).map((n) => ({ ...n, abs: bar * BPB + n.beat }));

      // ---------- the tune (or, in the swap, the ground) ----------
      const mel = inBars(S.mel);
      const velOf = (n) => {
        let v = n.beat === 0 ? 0.74 : n.dur >= 1.5 ? 0.72 : 0.62;
        if (n.bar + off === 6) v += 0.05; // the climb
        if (f.id === "V") v += 0.04;
        if (f.id === "tag") v -= 0.08;
        return v;
      };
      if (A.lead === "swap") {
        // the lead sings the pump's four notes, two octaves up, with its late vibrato
        for (let i = 0; i < CB; i++) ground(i).forEach((n) => push("glass", n.abs, n.dur - 0.08, n.note + 24, (n.dur >= 3 ? 0.7 : 0.58) + (i === 0 && half === 0 ? 0.04 : 0)));
      } else {
        const ornP = A.orn ? Math.min(0.2, 0.08 + 0.03 * Math.min(lap, 4)) : 0;
        let ornBar = -1;
        mel.forEach((n, i) => {
          const v = velOf(n);
          const art = n.dur <= 0.5 ? n.dur * 0.85 : n.dur - 0.08;
          const canOrn = ornP && A.lead === "glass" && n.bar !== ornBar;
          // a scoop into a long note (the glass "finds" the pitch), or a lower-neighbour grace into the leap
          if (canOrn && n.dur >= 2.5 && r.chance(ornP)) { ornBar = n.bar; push(A.lead, n.abs, art, n.note, v, { bend: r.chance(0.5) ? 1 : 2 }); return; }
          const below = n.beat === 1 && n.dur >= 1.5 && i > 0 ? T.step(n.note, -1, T.chord(chordAt(n.abs).chord).scale) : null;
          if (canOrn && below != null && below !== mel[i - 1].note && r.chance(ornP * 0.8)) {
            ornBar = n.bar;
            push(A.lead, n.abs - 0.25, 0.2, below, v - 0.14); // the scale step below, on the 16th before the leap lands
            push(A.lead, n.abs, art, n.note, v);
            return;
          }
          push(A.lead, n.abs, art, n.note, v);
        });
      }

      // ---------- counter-line (reed) ----------
      if (A.cnt) {
        const cntBars = COUNTER.slice();
        if (f.id === "V") cntBars[5] = COUNTER_RESIDUE6;
        inBars(phrase(cntBars)).forEach((n) => {
          const vel = 0.4 + (n.beat === 0 ? 0.03 : 0);
          push("reedCnt", n.abs, n.dur - 0.1, n.note, vel);
        });
      }
      // the reed holds the top of each pane (pane III on later laps)
      if (A.reedTop) prog.forEach((h) => { const v = S.pad[h.bar + off]; push("reedCnt", h.bar * BPB, h.dur - 0.15, v[v.length - 1], 0.3); });

      // ---------- bells ----------
      if (A.bells === "shadow") mel.filter((n) => n.dur >= 1.5).forEach((n) => push("bells", n.abs, Math.min(2, n.dur), n.note + 12, n.dur >= 2.5 ? 0.3 : 0.24));
      if (A.bells === "ground") {
        for (let i = 0; i < CB; i++) ground(i).forEach((n) => {
          const long = n.dur >= 3;
          if (f.id === "tag" && (!long || (half === 0 && i < 2))) return; // the tag remembers only the long notes, from its third bar
          push("bells", n.abs, long ? 2.6 : 0.9, n.note + 36, (long ? 0.34 : 0.26) + (f.id === "IV" ? 0.04 : 0));
          if (f.id === "IV" && long && r.chance(0.35)) push("bells", n.abs + 2, 1.0, n.note + 36, 0.2); // a music-box re-strike on beat 3
        });
      }

      // ---------- pad ----------
      if (A.pad) {
        // merge bars whose voicing does not change (the pad only re-attacks on a new chord)
        let i = 0;
        while (i < CB) {
          const bar = off + i;
          const v = S.pad[bar];
          let j = i + 1;
          while (j < CB && S.pad[off + j].join() === v.join()) j++;
          const dur = (j - i) * BPB - 0.15;
          let vel = A.pad;
          if (f.id === "III") vel += 0.015 * bar; // the far side swells
          if (f.id === "IV") vel = A.pad + 0.04 * i; // fades back in
          push("pad", i * BPB, dur, v, vel);
          i = j;
        }
      }

      // ---------- bass ----------
      if (A.bass === "hook") {
        // the swap: the bass plays the hook two octaves down, legato
        mel.forEach((n) => push("bass", n.abs, n.dur - 0.06, n.note - 24, n.beat === 0 ? 0.78 : 0.68));
      } else {
        for (let i = 0; i < CB; i++) {
          const g = ground(i);
          const [L, Sh] = g; // long, short
          const vLong = 0.8, vShort = 0.6;
          if (A.bass === "oct") {
            push("bass", L.abs, 2.35, L.note, vLong); push("bass", L.abs + 2.5, 0.42, L.note + 12, 0.46); push("bass", Sh.abs, 0.9, Sh.note, vShort);
          } else if (A.bass === "pulse") {
            push("bass", L.abs, 1.4, L.note, vLong); push("bass", L.abs + 1.5, 1.35, L.note, 0.58); push("bass", Sh.abs, 0.9, Sh.note, vShort);
          } else {
            push("bass", L.abs, 2.9, L.note, vLong); push("bass", Sh.abs, 0.9, Sh.note, vShort);
          }
          if (A.sub) push("sub", L.abs, 2.8, L.note, 0.7);
        }
      }

      // ---------- drips ----------
      // chord tones (colours first) in the roof register, never on beat 1, a few per bar
      {
        const n16 = (f.id === "intro" && lap === 0) ? 1.2 : 1;
        for (let i = 0; i < CB; i++) {
          const c = T.chord(chordAt(i * BPB).chord);
          const pool = T.notesIn(c.colors.length ? c.colors.concat(c.guide) : c.pcs, 86, 100);
          const count = Math.max(0, Math.round(r.gauss(0.9) + A.drips * n16));
          const used = new Set();
          for (let k = 0; k < count; k++) {
            const q = r.int(1, 15);
            if (used.has(q)) continue;
            used.add(q);
            push("drips", i * BPB + q / 4, 0.25, r.pick(pool), 0.3 + r.range(0, 0.3), { v: r.int(0, 2) });
          }
        }
      }
      // ---------- fan ----------
      if (A.fan) push("fan", half === 0 ? 0 : 2 * BPB, 2 * BPB + 1, "fan", 0.5);

      // ---------- drums ----------
      const D = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = off + i;
        const st = A.drums;
        if (st === "none") continue;
        const fillBar = A.fill && i === CB - 1;
        const fill = fillBar ? r.weighted([[0, 2], [1, 2], [2, 1]]) : null;
        const cut = fill != null ? FILLS[fill][0][0] : 9;
        const ok = (b) => b < cut;
        if (st === "tick") {
          for (let e8 = 0; e8 < 8; e8++) { const b = e8 / 2; if (ok(b)) D(B0 + b, "hatPedal", e8 % 2 ? 0.14 : 0.2); }
          if (ok(3)) D(B0 + 3, "rim", 0.3);
          if (bar % 2 === 0 && ok(0)) D(B0, "softKick", 0.42);
        }
        if (st === "pulse") {
          for (let e8 = 0; e8 < 8; e8++) { const b = e8 / 2; if (ok(b)) D(B0 + b, e8 % 2 ? "hatClosed" : "hatPedal", e8 % 2 ? 0.17 : 0.2); }
          if (ok(0)) D(B0, "softKick", 0.6); if (ok(2.5)) D(B0 + 2.5, "softKick", 0.4);
          if (ok(3)) D(B0 + 3, "rim", 0.4);
          if (bar % 4 === 3 && ok(3.5)) D(B0 + 3.5, "hatOpen", 0.22);
        }
        if (st === "groove") {
          for (let q = 0; q < 16; q++) { const b = q / 4; if (ok(b)) D(B0 + b, "shaker", [0.24, 0.1, 0.16, 0.12][q % 4]); }
          for (let e8 = 0; e8 < 8; e8++) { const b = e8 / 2; if (ok(b)) D(B0 + b, "hatClosed", e8 % 2 ? 0.17 : 0.24); }
          if (ok(0)) D(B0, "softKick", 0.66); if (ok(2.5)) D(B0 + 2.5, "softKick", 0.46);
          if (bar % 2 === 1 && ok(1.5) && r.chance(0.5)) D(B0 + 1.5, "softKick", 0.3);
          if (ok(3)) D(B0 + 3, "rim", 0.46);
          if (r.chance(0.3) && ok(3.75)) D(B0 + 3.75, "brushTap", 0.2);
          if (bar % 2 === 1 && ok(3.5)) D(B0 + 3.5, "hatOpen", 0.24);
          if (f.id === "V" && bar === 0) D(B0, "ride", 0.28);
        }
        if (fill != null) FILLS[fill].forEach(([b, voice, v, pitch]) => D(B0 + b, voice, v, { pitch }));
      }
      if (A.swell) D(3 * BPB + 1.5, "brushSweep", 0.4, { len: 1.6 }); // into the next pane

      return { events: ev, harmony: prog, section: label(f, lap, half), state };
    },
  });
})();

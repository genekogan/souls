// Flying Junction: two railway lines meet at speed on a bright morning. 132 BPM, D major, fusion-funk for a
// small imagined band: a pulse-wave clav, a square-wave horn, a DX-style comp, slap bass, a kit and hand percussion.
// (A flying junction is where one line is carried over another so two trains can cross without ever touching.)
//
// ---- the ideas, fixed before any code (the generator arranges them; it never changes a note) ----
//
// Two tunes over one eight-bar chord sequence. Each stands on its own; the piece is built so that they are heard
// apart first and then together, and the togetherness is the climax. They were written as a pair: on every beat
// the interval between them is a third, a sixth, an octave or a tenth, so they also work the other way up (the
// express an octave higher, over the local), which is the "crossing" section. The only rubs are passing 16ths
// and the dominant's own tritone in bar 4.
//
// Harmony (8 bars): | Dmaj9 | Gmaj13#11 | Gm13 | A7 | Em9 | D/F# | Gmaj9 A13 | D (Bbmaj7#11) |
//   IV turns lydian in bar 2 and minor in bar 3 (the piece's shadow), then ii–I6–IV–V climbs home by step in the
//   bass (E F# G A D); the last two beats pivot to Bb lydian when the lap goes on. Bb's raised fourth is E, and on
//   alternate laps the crossing is lifted to E major: the pivot's colour note becomes the new key.
//
// TUNE A, "the express" (pulse clav, D4–D5): a rising 16th cell that leans on a colour tone and settles.
//   bar 1  F#4 G4 A4 B4~ A4~~ . D4        (3 4 5 6: leans on the sixth, settles on the fifth)
//   bar 2  G4 A4 B4 C#5 B4 G4~~ .         (the cell up a fourth; the lean is now the lydian #4 of G)
//   bar 3  . Bb4 . Bb4 . G4 . F4          (idles: off-beat stabs on the G minor, the b3 and b7)
//   bar 4  E4 F#4 G4 A4~ G4 C#4~ . G4     (the cell on the dominant, falling through the tritone G–C#)
//   bar 5  G4 A4 B4 C#5~ B4 E4~ . E4      (bar 2 again, settling lower, on the root of Em)
//   bar 6  A4 B4 C#5 D5 C#5 A4~ . D5      (the cell on D/F#, up to the root and back)
//   bar 7  . D5 . B4 . C#5 . G4           (idles again: the stabs turned sunny, G major then A7)
//   bar 8  F#4 G4 A4 B4~ A4 F#4 F4 A4 D5  (bar 1 restated, then a tail that climbs the Bb chord;
//                                          on the last lap of a section it lands: F#4 E4 D4)
// TUNE B, "the local" (square horn, A4–A5): a broad four-bar phrase and its sequence a step up.
//   bar 1  A4 D5 F#5~~        bar 2  E5~ D5 E5~~        bar 3  G5 F5 E5 D5       bar 4  C#5~~ E5~~
//   bar 5  B4 E5 G5~~         bar 6  F#5~ E5 F#5~~      bar 7  A5 G5 F#5 E5      bar 8  D5~~~ .
//   Its strange note is the F natural of bar 3 (G dorian against the D major piece); bar 7 answers it with F#.
// THE TURN (the voice, four bars at the end of each lap, over Bbmaj7#11 ×2, A7sus4, A13; or Em9 ×2 when lifted):
//   F5 A5 E5~~ | D5~ C5 A4~~ | G4 A4 D5~~ | C#5~~ E5 G5      (lifted: G5 B5 F#5~~ | E5~ D5 B4~~ | same)
//
// ---- form: one lap = 7 cycles of 8 bars (about 1:42), after a one-time 8-bar intro ----
//   A1  the express alone over bass and drums          A2  the express answered by the comp
//   B1  the local alone, pad and cross-stick            B2  the local with the express idling underneath (its stab bars)
//   AB  the junction: local above, express below        BA  the crossing: express an octave up, local below;
//                                                          lifted a whole step on alternate laps
//   TAG the signal box: four bars of percussion and bass on the pedal, then the turn home
// Per cycle the generator chooses only: kick figures, hat density, fills, conga and shaker patterns, comp
// rhythms, bass riff shapes and approach notes, grace notes and velocities.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BPM = 132, CB = 8;
  const mod12 = T.mod12;
  const dB = (x) => Math.pow(10, x / 20);

  // ---------- notation: "F#4/.25 G4/.25 | ..." bars of 4 beats; r = rest; trailing _ ties into the next note ----------
  function mel(text) {
    const out = [];
    text.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let pos = 0;
      bar.split(/\s+/).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(_?)$/.exec(tok);
        if (!m) throw new Error(`flying-junction: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), tie: m[3] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`flying-junction: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; }
      else merged.push({ ...n });
    }
    return merged.filter((n) => n.note != null);
  }
  /** Transpose a chord symbol by n semitones. */
  function tx(sym, n) {
    if (!n) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    const nm = (p) => T.NAMES[mod12(T.PC[p] + n)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }

  // ---------- the tunes ----------
  const A7BARS = "F#4/.25 G4/.25 A4/.5 B4/.75 A4/1.25 r/.5 D4/.5 | G4/.25 A4/.25 B4/.5 C#5/.5 B4/.5 G4/1.5 r/.5 | " +
    "r/.5 Bb4/.5 r/.5 Bb4/.5 r/.5 G4/.5 r/.5 F4/.5 | E4/.25 F#4/.25 G4/.5 A4/.75 G4/.25 C#4/1 r/.5 G4/.5 | " +
    "G4/.25 A4/.25 B4/.5 C#5/.75 B4/.25 E4/1 r/.5 E4/.5 | A4/.25 B4/.25 C#5/.5 D5/.5 C#5/.5 A4/1 r/.5 D5/.5 | " +
    "r/.5 D5/.5 r/.5 B4/.5 r/.5 C#5/.5 r/.5 G4/.5 | ";
  const TUNE_A = {
    turn: mel(A7BARS + "F#4/.25 G4/.25 A4/.5 B4/.75 A4/.25 F#4/.5 F4/.5 A4/.5 D5/.5"),
    land: mel(A7BARS + "F#4/.25 G4/.25 A4/.5 B4/.75 A4/.25 F#4/.5 E4/.5 D4/1"),
  };
  const TUNE_B = mel("A4/1 D5/1 F#5/2 | E5/1.5 D5/.5 E5/2 | G5/1 F5/1 E5/1 D5/1 | C#5/2 E5/2 | B4/1 E5/1 G5/2 | F#5/1.5 E5/.5 F#5/2 | A5/1 G5/1 F#5/1 E5/1 | D5/3 r/1");
  const TURN = {
    home: mel("F5/1 A5/1 E5/2 | D5/1.5 C5/.5 A4/2 | G4/1 A4/1 D5/2 | C#5/2 E5/1 G5/1"),
    lifted: mel("G5/1 B5/1 F#5/2 | E5/1.5 D5/.5 B4/2 | G4/1 A4/1 D5/2 | C#5/2 E5/1 G5/1"),
  };
  const inBars = (tune, from, to) => tune.filter((n) => n.beat >= from * BPB && n.beat < to * BPB);
  const cellStarts = (tune) => tune.filter((n) => n.beat % BPB === 0 && n.dur === 0.25).map((n) => n.beat); // where a cell begins

  // ---------- harmony ----------
  const PROG = {
    INTRO: "| D | D | D | D | Dmaj9 | Gmaj13#11 | Gm13 | A7 |",
    MAIN: "| Dmaj9 | Gmaj13#11 | Gm13 | A7 | Em9 | D/F# | Gmaj9:2 A13:2 | D:2.5 Bbmaj7#11:1.5 |",
    LAND: "| Dmaj9 | Gmaj13#11 | Gm13 | A7 | Em9 | D/F# | Gmaj9:2 A13:2 | D |",
    TAG: "| D | D | D | D | Bbmaj7#11 | Bbmaj7#11 | A7sus4 | A13 |",
    TAG_E: "| E | E | E | E | Em9 | Em9 | A7sus4 | A13 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const VOICE_SYM = { "Gmaj13#11": "Gmaj9#11", "Gm13": "Gm69", D: "Dadd9", E: "Eadd9" }; // what the comp and pad play for the timeline's symbols
  const LAP = ["A1", "A2", "B1", "B2", "AB", "BA", "TAG"];
  const progFor = (S, lap) => (S === "INTRO" ? "INTRO" : S === "BA" ? "LAND" : S === "TAG" ? (lap % 2 === 1 ? "TAG_E" : "TAG") : "MAIN");
  const keyFor = (S, lap) => (S === "BA" && lap % 2 === 1 ? 2 : 0);

  Sim.register({
    id: "flying-junction",
    title: "Flying Junction",
    genre: "Fusion-funk, two tunes",
    about: "Two lines meet at speed on a bright morning. A 132 BPM fusion-funk in D built on two hand-written tunes that each stand alone and were made to fit: a rising 16th-note clav riff that leans on colour tones, and a broad square-wave horn melody with one G-dorian shadow. Heard apart, then together, then the other way up with the clav an octave over the horn (a whole step higher on alternate laps), with slap bass, congas, timbales and a percussion break before the turn home.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.52, swingUnit: 0.25, cycleBars: CB, gainDb: 0,
    situations: ["chase", "celebrate", "party"],
    energy: 0.78,

    instruments(ctx) {
      const { I, out } = ctx;
      const bus = ctx.keep(new Tone.Filter({ frequency: 12000, type: "lowpass", rolloff: -12 })).connect(out);
      const room = I.reverb(ctx, bus, { decay: 1.3, preDelay: 0.012, lowcut: 260, highcut: 7000 });
      const slapback = I.delay(ctx, bus, { time: 60 / BPM / 2, feedback: 0.2, highcut: 2800 }); // one eighth

      // the clav: a narrow pulse through a snappy resonant filter, high-passed, a touch of chorus
      const clavSyn = ctx.keep(new Tone.PolySynth({
        voice: Tone.MonoSynth, maxPolyphony: 8,
        options: {
          oscillator: { type: "pulse", width: 0.28 },
          filter: { type: "lowpass", rolloff: -24, Q: 2.4 },
          envelope: { attack: 0.002, decay: 0.16, sustain: 0.18, release: 0.07 },
          filterEnvelope: { attack: 0.001, decay: 0.09, sustain: 0.12, release: 0.08, baseFrequency: 380, octaves: 3.6 },
        },
      }));
      const clavHp = ctx.keep(new Tone.Filter({ frequency: 160, type: "highpass" }));
      const clavCh = ctx.keep(new Tone.Chorus({ frequency: 1.4, delayTime: 3.5, depth: 0.35, spread: 60, wet: 0.3 }).start());
      const clavOut = ctx.keep(new Tone.Gain(dB(-8)));
      clavSyn.chain(clavHp, clavCh, clavOut);

      // the horn: two detuned squares, a soft low-pass, vibrato that arrives late, a slapback
      const hornSyn = ctx.keep(new Tone.MonoSynth({
        portamento: 0.018,
        oscillator: { type: "fatsquare", count: 2, spread: 6 },
        filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
        envelope: { attack: 0.03, decay: 0.2, sustain: 0.85, release: 0.16 },
        filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.2, baseFrequency: 700, octaves: 1.6 },
      }));
      const hornVib = ctx.keep(new Tone.Vibrato({ frequency: 5.4, depth: 0 }));
      const hornTone = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 }));
      const hornOut = ctx.keep(new Tone.Gain(dB(-9)));
      hornSyn.chain(hornVib, hornTone, hornOut);
      const hornSafe = I.monotonic(hornOut);
      const playHorn = (t0, note, d, vel) => {
        const t = hornSafe(t0);
        hornSyn.triggerAttackRelease(T.hz(note), d, t, vel);
        hornVib.depth.cancelAndHoldAtTime(t);
        hornVib.depth.setValueAtTime(0, t);
        if (d > 0.3) hornVib.depth.linearRampToValueAtTime(0.055, t + Math.min(d, 0.7));
      };

      // the comp: a glassy two-operator electric piano, chorused
      const compSyn = ctx.keep(new Tone.PolySynth({
        voice: Tone.FMSynth, maxPolyphony: 12,
        options: {
          harmonicity: 2, modulationIndex: 1.6,
          oscillator: { type: "sine" }, modulation: { type: "triangle" },
          envelope: { attack: 0.004, decay: 0.28, sustain: 0.25, release: 0.25 },
          modulationEnvelope: { attack: 0.002, decay: 0.15, sustain: 0.08, release: 0.2 },
        },
      }));
      const compCh = ctx.keep(new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.5, spread: 120, wet: 0.45 }).start());
      const compLp = ctx.keep(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 }));
      const compOut = ctx.keep(new Tone.Gain(dB(-13)));
      compSyn.chain(compCh, compLp, compOut);

      const pad = I.stringMachine(ctx, { volume: -14, cutoff: 2200, attack: 0.3, release: 0.9 });
      const bass = I.slapBass(ctx, { volume: -3 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 33, preload: ["kick", "snare", "rim", "hatClosed", "hatOpen", "crash", "tom", "clap", "conga", "congaLow", "shaker", "tambourine", "timbale", "agogo", "woodblock"] });

      const cp = I.place(ctx, { out: clavOut }, -0.22, bus), hp = I.place(ctx, { out: hornOut }, 0.14, bus);
      const kp = I.place(ctx, { out: compOut }, 0.3, bus), pp = I.place(ctx, pad, 0, bus);
      I.place(ctx, bass, 0, bus);
      const dp = I.place(ctx, kit, 0, bus);
      I.send(ctx, hp, slapback, -12); I.send(ctx, hp, room, -14); I.send(ctx, cp, room, -20);
      I.send(ctx, kp, room, -14); I.send(ctx, pp, room, -10); I.send(ctx, dp, room, -18);

      return {
        clav: { layer: "melody", play: (t, e, d) => clavSyn.triggerAttackRelease((Array.isArray(e.note) ? e.note : [e.note]).map(T.hz), d, t, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        horn: { layer: "melody", play: (t, e, d) => playHorn(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.04 } },
        comp: { layer: "harmony", play: (t, e, d) => compSyn.triggerAttackRelease((Array.isArray(e.note) ? e.note : [e.note]).map(T.hz), d, t, e.vel), humanize: { timing: 0.006, vel: 0.06 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.04 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel, e.art), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.003, vel: 0.07 } },
        perc: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bass == null) Object.assign(state, { bass: 38, bv: null, pv: null, lastFill: null, lastRiff: -1 });
      const intro = cycle === 0;
      const idx = intro ? -1 : (cycle - 1) % LAP.length, lap = intro ? 0 : Math.floor((cycle - 1) / LAP.length);
      const S = intro ? "INTRO" : LAP[idx];
      const key = keyFor(S, lap);
      const lifted = key !== 0;
      const prog = PROGS[progFor(S, lap)].map((e) => ({ ...e, chord: tx(e.chord, key) }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ch = (b) => T.chord(sym(b));
      const vsym = (b) => { const x = sym(b); for (const [k, v] of Object.entries(VOICE_SYM)) if (x === tx(k, key)) return tx(v, key); return x; };
      const nextS = intro ? "A1" : LAP[(idx + 1) % LAP.length], nextLap = idx === LAP.length - 1 ? lap + 1 : lap;
      const nextFirst = T.chord(tx(PROGS[progFor(nextS, nextLap)][0].chord, keyFor(nextS, nextLap)));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const drum = (abs, voice, vel, extra) => push("drums", abs, 0.25, voice, vel, extra);
      const perc = (abs, voice, vel, extra) => push("perc", abs, 0.25, voice, vel, extra);
      const melAttacks = [], melNotes = [];

      // ================= the tunes =================
      /** Tune A on the clav. o.shift (semitones), o.vel, o.from/o.to (bars), o.grace (chance of a scale-step slide into a cell). */
      const playA = (notes, o = {}) => {
        const shift = (o.shift || 0) + key, off = ((o.at ?? o.from ?? 0) - (o.from ?? 0)) * BPB;
        const starts = cellStarts(notes);
        notes.forEach((n) => {
          if (o.from != null && n.beat < o.from * BPB) return;
          if (o.to != null && n.beat >= o.to * BPB) return;
          const abs = n.beat + off, note = n.note + shift;
          const stab = n.beat % 1 === 0.5 && n.dur === 0.5;
          const vel = (o.vel ?? 0.78) + (n.beat % BPB === 0 ? 0.05 : 0) + (n.dur >= 0.75 ? 0.08 : 0) + (n.dur === 0.25 ? -0.06 : 0) + (stab ? 0.02 : 0);
          push("clav", abs, Math.max(0.14, n.dur * (n.dur <= 0.5 ? 0.8 : 0.9)), note, vel);
          melAttacks.push(abs); melNotes.push({ a: abs, b: abs + n.dur, n: note });
          if (o.grace && starts.includes(n.beat) && r.chance(o.grace)) push("clav", abs - 0.125, 0.1, T.step(note, -1, ch(abs).scale), vel - 0.3);
        });
      };
      /** Tune B (or the turn) on the horn. o.shift, o.vel, o.turnIn (chance of an upper-neighbour lean into a long note). */
      const playB = (notes, o = {}) => {
        const shift = (o.shift || 0) + key, off = ((o.at ?? o.from ?? 0) - (o.from ?? 0)) * BPB;
        notes.forEach((n) => {
          if (o.from != null && n.beat < o.from * BPB) return;
          if (o.to != null && n.beat >= o.to * BPB) return;
          const abs = n.beat + off, note = n.note + shift;
          const vel = (o.vel ?? 0.8) + (n.dur >= 2 ? 0.05 : 0) + (n.beat % BPB === 0 ? 0.03 : 0);
          const lean = o.turnIn && n.dur >= 2 && n.beat % BPB !== 0 && r.chance(o.turnIn);
          if (lean) {
            push("horn", abs, 0.22, T.step(note, 1, ch(abs).scale), vel - 0.08);
            push("horn", abs + 0.25, n.dur * 0.96 - 0.25, note, vel);
          } else push("horn", abs, n.dur * (n.dur <= 1 ? 0.9 : 0.96), note, vel);
          melAttacks.push(abs); melNotes.push({ a: abs, b: abs + n.dur, n: note });
        });
      };

      // ================= comp and pad =================
      const voicing = (b, o = {}) => {
        const c = T.chord(vsym(b));
        return T.voice(c, { lo: o.lo ?? 55, hi: o.hi ?? 74, n: c.pcs.length >= 6 ? 4 : 3, rootless: true, omitBass: true, prev: state.bv, spread: "close", top: o.top ?? [62, 72] });
      };
      /** True when the voicing rubs (a semitone or a ninth) against a tune note sounding during [abs, abs + dur). */
      const rubs = (v, abs, dur) => melNotes.some((m) => m.a < abs + dur && m.b > abs + 0.05 && v.some((x) => Math.abs(x - m.n) % 12 === 1));
      const stab = (abs, dur, vel, o = {}) => {
        if (!o.force && melAttacks.some((x) => Math.abs(x - abs) < 0.3)) return; // answer the tunes, never sit on their attacks
        // a push on an "and" takes the chord it leads into, unless that chord rubs against the tune still sounding
        const anticipate = abs % 1 === 0.5 && sym(abs + 0.5) !== sym(abs) && abs + 0.5 < CB * BPB;
        let v = voicing(anticipate ? abs + 0.5 : abs, o);
        if (anticipate && rubs(v, abs, dur)) v = voicing(abs, o);
        if (rubs(v, abs, dur)) return;
        state.bv = v;
        push("comp", abs, dur, v, vel);
      };
      // rhythms: "answer" sits in the clav's rests, "push" anticipates the bar, "held" is one chord per change, "sparse" marks the bar
      const compBar = (bar, style, vel = 0.5) => {
        const B = bar * BPB;
        if (style === "answer") r.pick([[[3, 0.5]], [[2.5, 0.25], [3.5, 0.25]], [[3, 0.3], [3.5, 0.3]]]).forEach(([b, d]) => stab(B + b, d, vel));
        else if (style === "push") [[1.5, 0.3], [3.5, 0.4]].forEach(([b, d]) => stab(B + b, d, vel + (b === 3.5 ? 0.05 : 0), { force: true }));
        else if (style === "sparse") { stab(B, 0.6, vel, { force: true, lo: 50, hi: 67, top: [58, 66] }); if (r.chance(0.4)) stab(B + 2.5, 0.3, vel - 0.06, { force: true, lo: 50, hi: 67, top: [58, 66] }); }
        else if (style === "beats") [0, 1, 2, 3].forEach((b) => stab(B + b, 0.35, vel - (b % 2 ? 0.08 : 0), { force: true }));
      };
      const padBar = (bar, vel = 0.5) => {
        const B = bar * BPB;
        prog.filter((e) => e.bar === bar).forEach((e) => {
          const v = T.voice(vsym(B + e.beat), { lo: 50, hi: 71, n: 4, rootless: true, omitBass: true, prev: state.pv, spread: "any", top: [62, 70] });
          state.pv = v;
          push("pad", B + e.beat, e.dur - 0.1, v, vel);
        });
      };

      // ================= bass =================
      const near = (pc, from = state.bass, lo = 36, hi = 47) => { // one octave, C2-B2: the riff's pops and fifths sit above it
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 41); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const rootAfter = (bar) => (bar < CB - 1 ? near(ch((bar + 1) * BPB).bass) : near(nextFirst.bass));
      const RIFFS = [ // [beat, degree (or "ap" = approach to the next root), articulation, dur]
        [[0, 0, "thumb", 0.45], [0.5, 0, "ghost", 0.1], [0.75, 12, "pop", 0.3], [1.5, 0, "thumb", 0.4], [2.5, 0, "thumb", 0.45], [3, 7, "finger", 0.4], [3.5, "ap", "finger", 0.4]],
        [[0, 0, "thumb", 0.45], [0.75, 0, "thumb", 0.3], [1, 12, "pop", 0.3], [1.5, 0, "ghost", 0.1], [2, 0, "thumb", 0.45], [2.5, 12, "pop", 0.3], [3.5, "ap", "finger", 0.4]],
        [[0, 0, "thumb", 0.7], [1, 0, "ghost", 0.1], [1.5, 7, "finger", 0.4], [2, 12, "pop", 0.3], [2.5, 0, "thumb", 0.45], [3.25, "ap2", "finger", 0.22], [3.5, "ap", "finger", 0.4]],
        [[0, 0, "thumb", 0.45], [0.5, 12, "pop", 0.3], [1, 0, "ghost", 0.1], [1.5, 0, "thumb", 0.4], [2.5, 0, "thumb", 0.45], [3, 0, "ghost", 0.1], [3.5, "ap", "finger", 0.4]],
      ];
      const TWO = [
        [[0, 0, "thumb", 1.4], [1.5, 0, "ghost", 0.1], [2, 7, "finger", 0.9], [3, 0, "finger", 0.45], [3.5, "ap", "finger", 0.4]],
        [[0, 0, "thumb", 0.9], [1, 12, "finger", 0.4], [2, 0, "thumb", 0.9], [3.5, "ap", "finger", 0.4]],
        [[0, 0, "thumb", 1.9], [2, 0, "thumb", 0.9], [3, 7, "finger", 0.45], [3.5, "ap", "finger", 0.4]],
      ];
      const BREAK = [
        [[0, 0, "thumb", 0.4], [0.5, 0, "ghost", 0.1], [0.75, 12, "pop", 0.3], [1, 0, "ghost", 0.1], [1.5, 0, "thumb", 0.4], [2, 0, "ghost", 0.1], [2.25, 12, "pop", 0.3], [2.5, 0, "thumb", 0.4], [3, 7, "finger", 0.3], [3.5, 0, "ghost", 0.1], [3.75, 12, "pop", 0.3]],
        [[0, 0, "thumb", 0.4], [0.75, 12, "pop", 0.3], [1, 0, "ghost", 0.1], [1.25, 0, "thumb", 0.3], [1.75, 12, "pop", 0.3], [2.5, 0, "thumb", 0.4], [3, 0, "ghost", 0.1], [3.25, 10, "finger", 0.3], [3.5, 12, "pop", 0.3]],
      ];
      /** Play a bass pattern over the bar's chords; the approach note leads into the next root. */
      const bassBar = (bar, pats, o = {}) => {
        const B = bar * BPB;
        let pi = r.int(0, pats.length - 1);
        if (pats.length > 1 && pi === state.lastRiff) pi = (pi + 1) % pats.length;
        state.lastRiff = pi;
        const N = rootAfter(bar);
        let R = near(ch(B).bass);
        const pat = (o.pattern || pats[pi]).filter(([b]) => b < (o.until ?? 4)), hasAp2 = pat.some(([, deg]) => deg === "ap2");
        // the approach direction, chosen once: from below unless the roots are a step apart (then from the far side) or the dice say so
        const R0 = near(ch(B + 3.5).bass, R);
        const dir = N === R0 ? 0 : Math.abs(N - R0) <= 2 ? Math.sign(N - R0) : r.chance(0.65) ? -1 : 1;
        pat.forEach(([b, deg, art, d]) => {
          const c = ch(B + b);
          if (mod12(R) !== c.bass) R = near(c.bass, R);
          let m;
          if (deg === "ap" || deg === "ap2") {
            const k = deg === "ap2" ? 2 : 1;
            if (N === R) m = k === 2 ? R + 7 : hasAp2 || r.chance(0.5) ? R + 12 : R - 5; // same root: the fifth and octave above, or the fifth below
            else if (o.fifths) m = k === 2 ? N + 7 : r.chance(0.5) ? N + 7 : N - 5;      // under the pad: the fifth above or below the next root
            else m = N + dir * k;                                                          // chromatic approach
            if (m < 33) m += 12;
          } else m = R + deg;
          const vel = art === "ghost" ? 0.35 : art === "pop" ? 0.82 : b === 0 ? 0.92 : 0.78;
          push("bass", B + b, d, m, vel * (o.vel ?? 1), { art });
        });
        state.bass = R;
      };

      // ================= drums =================
      const KICKS = [[[0, 2.5], 3], [[0, 1.75, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 0.75, 2.5], 1.5], [[0, 2.5, 3.75], 1]];
      const crash = (abs, v = 0.65) => drum(abs, "crash", v);
      const hats = (bar, mode, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        const step = mode === "16" ? 0.25 : 0.5;
        for (let b = 0; b < until - 1e-6; b += step) {
          if (o.open && b === 3.5) { drum(B + b, "hatOpen", 0.42, { len: 0.2 }); continue; }
          const v = b % 1 === 0 ? 0.58 : b % 0.5 === 0 ? 0.4 : 0.24;
          drum(B + b, "hatClosed", v * (o.vel ?? 1));
        }
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        const kicks = o.kicks || r.weighted(KICKS);
        kicks.filter((k) => k < until).forEach((k, i) => drum(B + k, "kick", i === 0 ? 0.95 : k % 1 === 0.75 ? 0.62 : 0.84));
        const back = o.rim ? "rim" : "snare";
        [1, 3].filter((b) => b < until).forEach((b) => { drum(B + b, back, o.rim ? 0.7 : 0.9); if (o.clap) drum(B + b, "clap", 0.5); });
        if (o.ghosts && !o.rim) [1.75, 2.25, 3.75].forEach((b) => { if (b < until && r.chance(0.3)) drum(B + b, "snare", 0.16); });
        if (o.hats) hats(bar, o.hats, { open: o.open, until, vel: o.hatVel });
      };
      /** A fill from `from` to the end of the bar. */
      const fill = (bar, from, kind) => {
        const B = bar * BPB;
        if (kind === "snare") for (let b = from; b < 4 - 1e-6; b += 0.25) drum(B + b, "snare", 0.35 + 0.55 * ((b - from) / (4 - from)));
        else if (kind === "timbale") for (let b = from; b < 4 - 1e-6; b += 0.25) perc(B + b, "timbale", 0.55 + 0.1 * ((b - from) / (4 - from)), { pitch: Math.round((b - from) * 4) % 3 === 2 ? 67 : 74 });
        else if (kind === "toms") {
          const P = [64, 60, 57, 52, 48, 45, 45, 40], steps = Math.round((4 - from) * 4);
          for (let i = 0; i < steps; i++) { const k = Math.floor((i * 8) / steps); if (i === 0) drum(B + from, "snare", 0.75); else drum(B + from + i * 0.25, "tom", 0.6 + 0.03 * i, { pitch: P[Math.min(7, k)] }); }
          drum(B + from, "kick", 0.8);
        } else if (kind === "hits") [2, 2.75, 3.5].filter((b) => b >= from).forEach((b) => { drum(B + b, "kick", 0.92); drum(B + b, "snare", 0.86); stab(B + b, 0.25, 0.7, { force: true }); push("bass", B + b, 0.25, near(ch(B + b).bass) + (b === 3.5 ? 12 : 0), 0.9, { art: "pop" }); });
      };
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill)); state.lastFill = k; return k; };

      // ================= hand percussion =================
      const shaker = (bar, vel = 0.4, until = 4) => { for (let b = 0; b < until - 1e-6; b += 0.25) perc(bar * BPB + b, "shaker", vel * (b % 1 === 0 ? 1 : b % 0.5 === 0 ? 0.75 : 0.5)); };
      const CONGAS = [ // two-bar patterns: [beat, voice, vel, pitch]
        [[[0.5, "congaLow", 0.6], [1, "conga", 0.45, 67], [1.5, "conga", 0.7], [2.5, "congaLow", 0.6], [3, "conga", 0.8], [3.5, "conga", 0.55]],
         [[0.5, "congaLow", 0.6], [1.5, "conga", 0.7], [2, "conga", 0.5, 67], [2.5, "congaLow", 0.7], [3, "conga", 0.85], [3.5, "conga", 0.5]]],
        [[[0, "conga", 0.5, 67], [0.75, "congaLow", 0.6], [1.5, "conga", 0.72], [2.5, "congaLow", 0.6], [3, "conga", 0.8], [3.5, "conga", 0.55]],
         [[0, "conga", 0.5, 67], [0.75, "congaLow", 0.6], [1.5, "conga", 0.72], [2.5, "congaLow", 0.65], [3, "conga", 0.85], [3.75, "congaLow", 0.6]]],
      ];
      const congas = (bar, set, vel = 1, until = 4) => CONGAS[set][bar % 2].filter(([b]) => b < until).forEach(([b, v, vl, p]) => perc(bar * BPB + b, v, vl * vel, p ? { pitch: p } : {}));
      const tambourine = (bar, vel = 0.36, until = 4) => { for (let b = 0; b < until - 1e-6; b += 0.5) perc(bar * BPB + b, "tambourine", vel * (b % 2 === 1 ? 1.25 : b % 1 === 0 ? 0.8 : 1)); };
      const CLAVE = [[0, 1.5, 3], [1, 2]]; // 3-2 on the rim or woodblock
      const clave = (bar, voice, vel = 0.5, until = 4) => CLAVE[bar % 2].filter((b) => b < until).forEach((b) => perc(bar * BPB + b, voice, vel));
      const CASCARA = [[0, 1, 1.5, 2.5, 3, 3.5], [0.5, 1, 2, 2.5, 3, 3.5]];
      const cascara = (bar, vel = 0.5, until = 4) => CASCARA[bar % 2].filter((b) => b < until).forEach((b, i) => perc(bar * BPB + b, "timbale", vel * (b % 1 === 0 ? 1 : 0.8), { pitch: i % 3 === 1 ? 67 : 74 }));
      const AGOGO = [[0, 0.75, 1.5, 2, 3], [0, 0.75, 1.5, 2.5, 3.5]];
      const agogo = (bar, vel = 0.45, until = 4) => AGOGO[bar % 2].filter((b) => b < until).forEach((b) => perc(bar * BPB + b, "agogo", vel, { pitch: b % 1 === 0 ? 81 : 86 }));

      // ================= sections =================
      let label = "";
      const congaSet = lap % 2;
      if (intro) {
        for (let bar = 0; bar < CB; bar++) {
          const B = bar * BPB;
          congas(bar, 0, bar < 2 ? 0.8 : 1);
          shaker(bar, bar < 2 ? 0.34 : 0.4);
          if (bar < 2) { drum(B, "kick", 0.8); drum(B + 2.5, "kick", 0.7); hats(bar, "8", { vel: 0.8 }); if (bar === 1) { drum(B + 3, "snare", 0.5); drum(B + 3.5, "snare", 0.7); } }
          else {
            groove(bar, { hats: "8", open: bar % 2 === 1, until: bar === 7 ? 3 : 4 });
            bassBar(bar, RIFFS);
            if (bar === 7) fill(bar, 3, "snare");
          }
          if (bar >= 4) { compBar(bar, bar === 6 ? "beats" : "answer", 0.46); if (bar === 4) crash(B, 0.5); }
        }
        playA(TUNE_A.turn, { from: 0, to: 4, at: 4, vel: 0.7 }); // the signal: the express's first four bars, as a call
        label = "Intro · percussion, the riff, the express signals";
      } else if (S === "A1" || S === "A2") {
        const second = S === "A2";
        playA(TUNE_A.turn, { vel: second ? 0.8 : 0.78, grace: lap && second ? 0.3 : 0 });
        for (let bar = 0; bar < CB; bar++) {
          const B = bar * BPB, last = bar === CB - 1;
          const fillKind = last ? (second ? pickFill(["snare", "timbale", "toms"]) : "snare") : null;
          const from = fillKind ? (second ? r.pick([2, 3]) : 3) : 4;
          if (bar === 0) crash(B, second ? 0.6 : 0.5);
          groove(bar, { hats: lap % 2 === 1 ? "16" : "8", hatVel: lap % 2 === 1 ? 0.85 : 1, open: second && bar % 2 === 1, ghosts: second, until: from });
          if (fillKind) fill(bar, from, fillKind);
          congas(bar, congaSet, 1, from);
          if (lap > 0 || second) shaker(bar, 0.38, from);
          if (second && lap > 0) tambourine(bar, 0.3, from);
          bassBar(bar, RIFFS);
          if (second) compBar(bar, bar % 4 === 2 ? "beats" : "answer", 0.48); // the comp walks the beats where the clav idles
          else if (lap > 0 && bar % 4 === 2) compBar(bar, "sparse", 0.4);
        }
        label = second ? "The express again · the comp answers" : `Lap ${lap + 1} · the express alone`;
      } else if (S === "B1" || S === "B2") {
        const second = S === "B2";
        playB(TUNE_B, { vel: second ? 0.82 : 0.78, turnIn: second && lap > 0 ? 0.3 : 0 });
        if (second) playA(TUNE_A.turn, { vel: 0.6, from: 2, to: 3 }), playA(TUNE_A.turn, { vel: 0.62, from: 6, to: 7 }); // the express idles under the local's walking bars
        for (let bar = 0; bar < CB; bar++) {
          const B = bar * BPB, last = bar === CB - 1;
          const fillKind = last ? pickFill(second ? ["toms", "hits", "snare"] : ["timbale", "snare"]) : null;
          const from = fillKind === "hits" ? 2 : fillKind ? 3 : 4;
          if (second) groove(bar, { hats: "8", open: bar % 2 === 1, ghosts: true, until: from, kicks: r.weighted([[[0, 2.5], 3], [[0, 1.75, 2.5], 2], [[0, 2.5, 3.5], 1]]) });
          else { groove(bar, { hats: "8", rim: true, until: from, kicks: [0, 2.5] }); }
          if (fillKind) fill(bar, from, fillKind);
          congas(bar, congaSet, second ? 1 : 0.9, from);
          shaker(bar, 0.36, from);
          if (!second) clave(bar, "woodblock", 0.4, from);
          bassBar(bar, second ? RIFFS : TWO, { until: fillKind === "hits" ? 2 : 4, fifths: !second });
          if (!second) padBar(bar, 0.5);
          if (second) compBar(bar, bar === 7 ? "sparse" : "push", 0.46);
        }
        label = second ? "The local again · the express idling underneath" : "The local line · pad and cross-stick";
      } else if (S === "AB" || S === "BA") {
        const cross = S === "BA";
        if (cross) { playA(TUNE_A.land, { shift: 12, vel: 0.8, grace: lap ? 0.25 : 0 }); playB(TUNE_B, { vel: 0.8 }); }
        else { playB(TUNE_B, { vel: 0.84, turnIn: lap > 0 ? 0.25 : 0 }); playA(TUNE_A.turn, { vel: 0.74 }); }
        for (let bar = 0; bar < CB; bar++) {
          const B = bar * BPB, last = bar === CB - 1;
          const fillKind = last ? pickFill(cross ? ["toms", "snare", "timbale"] : ["snare", "timbale", "hits"]) : null;
          const from = fillKind === "hits" ? 2 : fillKind ? 3 : 4;
          if (bar === 0) crash(B, cross ? 0.75 : 0.7);
          if (cross && bar === 4) crash(B, 0.5);
          groove(bar, { hats: cross ? "16" : "8", hatVel: cross ? 0.85 : 1, open: !cross && bar % 2 === 1, ghosts: true, clap: !cross, until: from });
          if (fillKind) fill(bar, from, fillKind);
          congas(bar, congaSet, 1, from);
          if (cross) tambourine(bar, 0.34, from); else shaker(bar, 0.4, from); // the crossing has 16th hats; the shaker would double them
          bassBar(bar, RIFFS, { vel: 1.02, until: fillKind === "hits" ? 2 : 4 });
          compBar(bar, "sparse", cross ? 0.38 : 0.42);
        }
        label = cross ? `The crossing · the express an octave over the local${lifted ? ", lifted to E" : ""}` : "The junction · the local over the express";
      } else { // TAG: the signal box
        const breakKind = lap % 2 === 0 ? "timbales" : "signal", fromE = lap % 2 === 1, tagKey = fromE ? 2 : 0;
        for (let bar = 0; bar < CB; bar++) {
          const B = bar * BPB;
          if (bar < 4) {
            drum(B, "kick", 0.9); drum(B + 2.5, "kick", 0.78);
            if (bar === 3) { drum(B + 3, "snare", 0.6); drum(B + 3.5, "snare", 0.8); }
            bassBar(bar, BREAK);
            if (breakKind === "timbales") { cascara(bar, 0.5); agogo(bar, 0.42); congas(bar, 1 - congaSet, 0.9); if (bar >= 2) hats(bar, "8", { vel: 0.7 }); }
            else { hats(bar, "16", { vel: 0.8 }); congas(bar, congaSet); shaker(bar, 0.4); if (bar === 1 || bar === 2) playA(TUNE_A.turn, { from: 0, to: 1, at: bar, vel: bar === 1 ? 0.66 : 0.72, shift: tagKey + (bar === 2 ? 12 : 0) }); }
          } else {
            const last = bar === 7;
            groove(bar, { hats: "8", open: bar % 2 === 1, ghosts: true, until: last ? 2 : 4, kicks: bar === 4 ? [0, 2.5] : undefined });
            if (last) fill(bar, 2, pickFill(["snare", "timbale"]));
            congas(bar, congaSet, 1, last ? 2 : 4);
            shaker(bar, 0.38, last ? 2 : 4);
            bassBar(bar, bar >= 6 ? TWO : RIFFS);
            compBar(bar, "push", 0.48);
          }
        }
        playB(fromE ? TURN.lifted : TURN.home, { vel: 0.8, at: 4 });
        if (breakKind === "timbales") crash(0, 0.45);
        label = `Signal box · ${breakKind === "timbales" ? "timbales and bass" : "the express signals"}, then the turn home${fromE ? " from E" : ""}`;
      }

      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();

// Grid Runner: mid-90s jungle at 172 BPM for a chase across the city grid.
//
// Drums: one original two-bar break, cut into eight one-beat slices (kick, a fat snare, a lighter
// snare for ghost notes, hats) and re-sequenced every bar or two the way a jungle producer chops a
// break in a sampler: slices swapped, doubled and moved, with snare rolls, 32nd stutters and
// drop-outs at phrase ends, a ride layered on top as the tune intensifies, crashes on arrivals. The
// switch-up brings a second break (tambourine, kick on the "a"), the halftime section a third.
// The whole kit runs through a lowpass, so the intro and the build are the break heard through a
// closed filter that opens onto the drop.
//
// Bass: a reese (two saws detuned against each other, slightly driven, through a lowpass that an LFO
// keeps moving) with a clean sine sub an octave down. Riffs are written in chord-relative tokens
// (root, third, fifth, seventh below, octave) and slide between notes.
//
// Harmony (F minor, dark and lush): Fm9 / Dbmaj9#11 / Bbm9 / Gbmaj7#11 (the Neapolitan) / C7alt.
// The halftime sits on an F pedal with Gbmaj7#11 above it (Phrygian); the switch-up jumps to
// A-flat minor (Abm9 / Emaj9#11 / Dbm9 / Dbmaj9#11 / C7alt, and the C7alt leads home to F).
// Pads underneath, choir stabs in the first drop, string-machine stabs in the switch-up, a Rhodes
// motif with dub delay in the intro and breakdown.
//
// Form (8-bar cycles, about 11 s each; one round is 12 cycles, about 2 min 15 s):
//   intro (filtered break, sub, Rhodes) -> drop A x3 (reese, chops, choir stabs, ride) -> halftime x2
//   (half-time drums, long reese notes, doubles back) -> switch-up x2 (A-flat minor, break B,
//   string-machine stabs) -> breakdown (drums out, pads, filtered ride) -> build (filter opens,
//   riser, rolls) -> drop A x2. Alternate rounds put the switch-up before the halftime.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BARS = 8, CYC = BPB * BARS;
  const db = (x) => Math.pow(10, x / 20);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- harmony ----------
  const PT = {
    INTRO: "| Fm9 | % | Dbmaj9#11 | % | Bbm9 | % | Gbmaj7#11 | C7alt |",
    A: "| Fm9 | % | Dbmaj9#11 | % | Bbm9 | % | Gbmaj7#11 | C7alt |",
    A2: "| Fm9 | % | Dbmaj9#11 | % | Bbm9 | Eb9sus4 | Gbmaj7#11 | C7alt |",
    HALF: "| Fm11 | % | Gbmaj7#11/F | % | Fm11 | % | Gbmaj7#11/F | % |",
    HALF2: "| Fm11 | % | Gbmaj7#11/F | % | Dbmaj9#11 | % | Ebm9 | C7alt |",
    B: "| Abm9 | % | Emaj9#11 | % | Dbm9 | % | Dbmaj9#11 | C7alt |",
    BREAK: "| Fm9 | % | Dbmaj9#11 | % | Bbm9 | % | Gbmaj7#11 | % |",
    BUILD: "| Fm9 | % | Dbmaj9#11 | % | Bbm9 | % | Gbmaj7#11 | C7alt |",
  };
  const PROG = Object.fromEntries(Object.entries(PT).map(([k, v]) => [k, T.progression(v, BPB)]));
  const breakAt = T.chordAtFactory(PROG.BREAK, BPB);

  // ---------- drums ----------
  // A slice is one beat: an array of steps (4 = 16ths, 8 = 32nds); each step is a string of voices:
  // K kick, k soft kick, S fat snare, s light snare, g ghost, h hat, H accented hat, o open hat,
  // r ride, R ride accent, t tambourine, c crash.
  const BREAK_A = [
    ["Kh", "", "Kh", "h"],
    ["Sh", "", "h", "g"],
    ["h", "g", "Kh", "K"],
    ["Sh", "", "h", "g"],
    ["Kh", "", "Kh", "h"],
    ["Sh", "", "h", "g"],
    ["h", "g", "Kh", "g"],
    ["h", "g", "Sh", "g"],
  ];
  const BREAK_B = [
    ["Kht", "", "ht", "K"],
    ["Sht", "g", "ht", "g"],
    ["ht", "K", "Kht", ""],
    ["Sht", "g", "ot", ""],
    ["Kht", "", "ht", "K"],
    ["Sht", "g", "ht", "g"],
    ["ht", "g", "Kht", "g"],
    ["Sht", "", "sh", "g"],
  ];
  // re-sequencings of the eight slices over two bars, [arrangement, weight]
  const ARR = [
    [[0, 1, 2, 3, 4, 5, 6, 7], 3], [[0, 1, 2, 3, 0, 1, 6, 7], 2], [[0, 1, 2, 3, 4, 5, 2, 7], 2],
    [[0, 1, 6, 3, 4, 5, 2, 3], 1.5], [[0, 1, 2, 1, 4, 5, 6, 7], 1], [[0, 3, 2, 1, 4, 1, 6, 7], 1],
    [[4, 5, 2, 3, 0, 1, 6, 5], 1], [[0, 1, 0, 3, 4, 7, 6, 7], 1],
  ];
  const HALF_BARS = [
    [["Kh", "", "h", ""], ["h", "", "Kh", ""], ["Sh", "", "h", "g"], ["h", "g", "h", ""]],
    [["Kh", "", "h", "K"], ["h", "", "h", "g"], ["Sh", "", "h", ""], ["h", "K", "o", ""]],
    [["Kh", "", "h", ""], ["h", "K", "h", ""], ["Sh", "", "h", "g"], ["g", "", "Kh", "g"]],
  ];
  const VOX = {
    K: ["kick", 0.92], k: ["kick", 0.6], S: ["rockSnare", 0.9], s: ["snare", 0.6], g: ["snare", 0.22],
    h: ["hatClosed", 0.34], H: ["hatClosed", 0.52], o: ["hatOpen", 0.4], r: ["ride", 0.4], R: ["ride", 0.58],
    t: ["tambourine", 0.3], c: ["crash", 0.72],
  };

  // ---------- bass riffs: [beat, token, dur, slide] over two bars ----------
  const RIFF_A = [
    [[0, "R", 2.5], [2.5, "R", 0.5], [3, "3", 1, true], [4, "R", 2.75], [6.75, "R", 0.25], [7, "-7", 1, true]],
    [[0, "R", 1.5], [1.5, "R", 0.5], [2, "8", 0.5], [2.5, "R", 1], [3.5, "5", 0.5, true], [4, "R", 2], [6, "3", 0.75], [6.75, "R", 1.25, true]],
    [[0, "R", 0.75], [0.75, "R", 0.75], [1.5, "R", 1], [2.5, "5", 0.5], [3, "R", 1], [4, "R", 0.75], [4.75, "R", 0.75], [5.5, "3", 1, true], [6.5, "R", 1.5, true]],
  ];
  const RIFF_B = [
    [[0, "R", 0.5], [0.75, "R", 0.25], [1.5, "R", 0.75], [2.5, "8", 0.5], [3, "R", 0.75], [3.75, "-7", 0.75, true], [4.5, "R", 1.5, true], [6.5, "3", 0.5], [7, "5", 1, true]],
    [[0, "R", 3], [3, "-7", 0.5, true], [3.5, "R", 0.5, true], [4, "R", 1.5], [5.5, "5", 0.5], [6, "3", 2, true]],
  ];
  const RIFF_HALF = [[0, "R", 3.5], [3.5, "R", 0.5], [4, "R", 2], [6, "-7", 2, true]];
  const RIFF_SUB = [[0, "R", 7.6]];

  function tokenSemis(c, tok) {
    if (c.bass !== c.root) { // slash chord: count from the bass note, staying inside the chord scale
      const want = { R: 0, 8: 12, 3: 3, 5: 7, "-7": -2 }[tok] ?? 0, ok = new Set(c.scale.concat(c.pcs));
      for (const d of [0, -1, 1]) if (ok.has(T.mod12(c.bass + want + d))) return want + d;
      return want;
    }
    const has = (i) => c.intervals.includes(i);
    switch (tok) {
      case "R": return 0;
      case "8": return 12;
      case "3": return has(3) ? 3 : has(4) ? 4 : 5;
      case "5": return has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7;
      case "-7": return (has(10) ? 10 : has(11) ? 11 : 10) - 12;
      default: return 0;
    }
  }
  const bassRoot = (c) => T.nearest(40, [c.bass], 34, 45);

  // ---------- form ----------
  const S = {
    intro: { id: "intro", prog: "INTRO", label: "Intro · the break through a closed filter" },
    a0: { id: "drop", n: 0, prog: "A", label: "Drop · reese and break" },
    a1: { id: "drop", n: 1, prog: "A", label: "Drop · chopped, choir stabs" },
    a2: { id: "drop", n: 2, prog: "A2", label: "Drop · ride on top, edits" },
    h0: { id: "half", n: 0, prog: "HALF", label: "Halftime · the floor drops out" },
    h1: { id: "half", n: 1, prog: "HALF2", label: "Halftime · doubling back" },
    b0: { id: "switch", n: 0, prog: "B", label: "Switch-up · A♭ minor, break B" },
    b1: { id: "switch", n: 1, prog: "B", label: "Switch-up · string-machine stabs" },
    brk: { id: "breakdown", prog: "BREAK", label: "Breakdown · pads and a filtered ride" },
    build: { id: "build", prog: "BUILD", label: "Build · the filter opens" },
    a3: { id: "drop", n: 3, prog: "A", label: "Drop · back in, full weight" },
    a4: { id: "drop", n: 4, prog: "A2", label: "Drop · last run, rolls" },
  };
  const ROUNDS = [
    ["intro", "a0", "a1", "a2", "h0", "h1", "b0", "b1", "brk", "build", "a3", "a4"],
    ["intro", "a0", "a1", "b0", "b1", "h0", "h1", "a2", "brk", "build", "a3", "a4"],
  ];

  // ---------- custom instruments ----------
  /** Reese bass: two detuned saws, driven, through an LFO-swept lowpass and a section lowpass; sine sub. */
  function reese(ctx, dest, o = {}) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? 0))).connect(dest);
    const subAmp = ctx.keep(new Tone.Gain(0)).connect(out);
    const sub = ctx.keep(new Tone.Oscillator({ type: "sine", frequency: 44 }).start()).connect(subAmp);
    const section = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 })).connect(out);
    const sweep = ctx.keep(new Tone.Filter({ frequency: 500, type: "lowpass", rolloff: -24, Q: 2.8 })).connect(section);
    const drive = ctx.keep(new Tone.Distortion({ distortion: 0.32, oversample: "2x", wet: 0.45 })).connect(sweep);
    const amp = ctx.keep(new Tone.Gain(0)).connect(drive);
    const a = ctx.keep(new Tone.Oscillator({ type: "sawtooth", frequency: 87, detune: -13 }).start()).connect(amp);
    const b = ctx.keep(new Tone.Oscillator({ type: "sawtooth", frequency: 87, detune: 13 }).start()).connect(amp);
    const lfo = ctx.keep(new Tone.LFO({ frequency: 172 / 60 / 8, min: 170, max: 900 }).start());
    lfo.connect(sweep.frequency);
    const clock = I.monotonic(amp);
    const LR = db(-14), LS = db(-15);
    return {
      out,
      play(time, e, dur) {
        const t = clock(time), m = e.note;
        if (!Number.isFinite(m)) return;
        const f = T.hz(m), fs = T.hz(m - 12 >= 28 ? m - 12 : m);
        const rv = Number.isFinite(e.reese) ? e.reese : 1, v = e.vel;
        if (e.lfo && Number.isFinite(e.lfo.rate)) {
          lfo.frequency.cancelScheduledValues(t);
          lfo.frequency.setValueAtTime(e.lfo.rate, t);
          lfo.min = e.lfo.min; lfo.max = e.lfo.max;
        }
        if (Number.isFinite(e.cut)) {
          section.frequency.cancelAndHoldAtTime(t);
          section.frequency.exponentialRampToValueAtTime(Math.max(60, e.cut), t + Math.max(0.01, e.cutSecs || 0.05));
        }
        for (const osc of [a, b]) {
          osc.frequency.cancelAndHoldAtTime(t);
          if (e.slide) osc.frequency.exponentialRampToValueAtTime(f, t + 0.07); else osc.frequency.setValueAtTime(f, t);
        }
        sub.frequency.cancelAndHoldAtTime(t);
        if (e.slide) sub.frequency.exponentialRampToValueAtTime(fs, t + 0.07); else sub.frequency.setValueAtTime(fs, t);
        amp.gain.cancelAndHoldAtTime(t); subAmp.gain.cancelAndHoldAtTime(t);
        if (e.slide) { amp.gain.setTargetAtTime(v * LR * rv, t, 0.02); subAmp.gain.setTargetAtTime(v * LS, t, 0.02); }
        else { amp.gain.linearRampToValueAtTime(v * LR * rv, t + 0.006); subAmp.gain.linearRampToValueAtTime(v * LS, t + 0.01); }
        amp.gain.setTargetAtTime(0, t + Math.max(0.03, dur), 0.025);
        subAmp.gain.setTargetAtTime(0, t + Math.max(0.03, dur), 0.03);
      },
    };
  }

  /** Noise riser / downlifter: band-passed noise whose filter and level sweep over the event. */
  function riser(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ frequency: 400, type: "bandpass", Q: 1.6 })).connect(g);
    ctx.keep(new Tone.Noise({ type: "white" }).start()).connect(bp);
    const lvl = db(-21);
    return {
      out: g,
      play(t, e, d) {
        const up = e.note !== "down";
        g.gain.cancelAndHoldAtTime(t); bp.frequency.cancelAndHoldAtTime(t);
        if (up) {
          bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + d);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(lvl * e.vel, t + d * 0.97); g.gain.linearRampToValueAtTime(0, t + d + 0.02);
        } else {
          bp.frequency.setValueAtTime(6000, t); bp.frequency.exponentialRampToValueAtTime(250, t + d);
          g.gain.setValueAtTime(lvl * e.vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        }
      },
    };
  }

  Sim.register({
    id: "grid-runner",
    title: "Grid Runner",
    genre: "Jungle",
    about: "Mid-90s jungle at 172 BPM in F minor: an original break chopped and re-sequenced every bar, a detuned reese with a sine sub, dark maj7#11 pads, choir and string-machine stabs, a halftime drop, an A-flat minor switch-up and a filtered breakdown.",
    situations: ["chase", "fight", "party"],
    energy: 0.95,
    bpm: 172, beatsPerBar: BPB, cycleBars: BARS, swing: 0.53, swingUnit: 0.25, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const space = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 300, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 0.9, preDelay: 0.006, lowcut: 300, highcut: 8000 });
      const dub = I.delay(ctx, out, { time: "8n.", feedback: 0.42, highcut: 2800, pingPong: true });

      // drums through one lowpass (the intro / build filter)
      const kit = I.kit(ctx, { volume: 1, kickNote: 35, preload: ["kick", "rockSnare", "snare", "hatClosed", "hatOpen", "ride", "crash", "tambourine"] });
      const dfilt = ctx.keep(new Tone.Filter({ frequency: 18000, type: "lowpass", rolloff: -24, Q: 1.2 })).connect(out);
      const kp = I.place(ctx, kit, 0, dfilt);
      I.send(ctx, dfilt, room, -15);

      const bass = reese(ctx, out, { volume: -2 });
      const pad = I.pad(ctx, { volume: -13, cutoff: 950, attack: 0.9, release: 2.6, detune: 26 });
      const smPad = I.stringMachine(ctx, { volume: -12, cutoff: 2600, attack: 1.1, release: 2.2 });
      const stab = I.stringMachine(ctx, { volume: -8, cutoff: 3600, attack: 0.008, release: 0.32 });
      const choir = I.choir(ctx, { volume: -7, vowel: "a", attack: 0.025, release: 0.7 });
      const keys = I.rhodes(ctx, { volume: -8, cutoff: 3200, tremolo: 4.2, tremoloDepth: 0.35 });
      const rise = riser(ctx, out);

      const pp = I.place(ctx, pad, -0.1, out), smp = I.place(ctx, smPad, 0.15, out), sp = I.place(ctx, stab, 0.25, out);
      const cp = I.place(ctx, choir, -0.2, out), kyp = I.place(ctx, keys, 0.3, out);
      I.send(ctx, pp, space, -8); I.send(ctx, smp, space, -6); I.send(ctx, sp, space, -9); I.send(ctx, sp, dub, -18);
      I.send(ctx, cp, space, -5); I.send(ctx, cp, dub, -16); I.send(ctx, kyp, dub, -9); I.send(ctx, kyp, space, -10);
      I.send(ctx, rise.out, space, -8);
      void kp;

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel), humanize: { timing: 0.004, vel: 0.1 } },
        dfx: {
          layer: "drums", humanize: { timing: 0, vel: 0 },
          play(t, e, d) {
            if (!Number.isFinite(e.freq)) return;
            dfilt.frequency.cancelAndHoldAtTime(t);
            if (e.instant) dfilt.frequency.setValueAtTime(e.freq, t);
            else dfilt.frequency.exponentialRampToValueAtTime(e.freq, t + d);
          },
        },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e, d), humanize: { timing: 0.002, vel: 0.03 } },
        pad: { layer: "harmony", play: pl(pad), humanize: { timing: 0, vel: 0 } },
        strings: { layer: "harmony", play: pl(smPad), humanize: { timing: 0, vel: 0 } },
        stab: { layer: "harmony", play: pl(stab), humanize: { timing: 0.003, vel: 0.05 } },
        choir: { layer: "melody", play: pl(choir), humanize: { timing: 0.003, vel: 0.05 } },
        keys: { layer: "melody", play: pl(keys), humanize: { timing: 0.008, vel: 0.06 } },
        riser: { layer: "texture", play: (t, e, d) => rise.play(t, e, d), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (cycle % 12 === 0 || state.riffRot == null) state.riffRot = r.int(0, 2);
      const plan = ROUNDS[Math.floor(cycle / 12) % 2], key = plan[cycle % 12], sec = S[key];
      const next = S[plan[(cycle + 1) % 12]];
      const prog = PROG[sec.prog];
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // ---------- drums ----------
      const ghost = () => r.range(0.7, 1.35);
      function renderBeat(at, beat, dyn = 1) {
        if (!beat) return;
        if (beat.roll) { // crescendo roll: n hits over the beat(s)
          const { n, len = 1, v0, v1, voice = "snare" } = beat;
          for (let i = 0; i < n; i++) {
            const u = n > 1 ? i / (n - 1) : 1;
            push("drums", at + (i * len) / n, len / n, i === n - 1 && voice === "snare" ? "rockSnare" : voice, clamp((v0 + (v1 - v0) * u) * dyn, 0.05, 1));
          }
          return;
        }
        const step = 1 / beat.length;
        beat.forEach((s, i) => {
          for (const ch of s) {
            const vx = VOX[ch];
            if (!vx) continue;
            let v = vx[1] * dyn;
            if (ch === "g") v *= ghost();
            if (ch === "h" && i % 2 === 1) v *= 0.72;
            push("drums", at + i * step, step, vx[0], clamp(v, 0.05, 1));
          }
        });
      }
      const EDITS = {
        roll: () => [null, null, { roll: true, n: 4, v0: 0.3, v1: 0.6 }, { roll: true, n: 4, v0: 0.6, v1: 0.95 }],
        roll32: () => [null, null, null, { roll: true, n: 8, v0: 0.3, v1: 0.95 }],
        stutter: (sl) => [null, null, [sl[1][0], "", sl[1][0], ""], ["S", "s", "S", "s"]],
        stutter32: (sl) => [null, null, sl[0], [sl[1][0], "", sl[1][0], "", "S", "s", "S", "s"]],
        gap: () => [null, null, null, []],
        kicks: () => [null, null, null, ["Kh", "", "K", "Kh"]],
      };
      function breakBars(set, from, to, opts) {
        // opts: { arrW (chaos 0..1), dyn, editEvery: 4|8, endEdit, ride, crash, open }
        for (let pair = from; pair < to; pair += 2) {
          const arr = pair === 0 && opts.straightStart ? ARR[0][0] : r.weighted(ARR.map(([a, w], i) => [a, i === 0 ? w * (1.6 - opts.chaos) : w * (0.4 + opts.chaos)]));
          for (let k = 0; k < 2 && pair + k < to; k++) {
            const bar = pair + k, B = bar * BPB;
            let beats = [0, 1, 2, 3].map((i) => set[arr[k * 4 + i]].map((s) => s));
            const last = bar === BARS - 1, mid = bar === 3;
            let edit = null;
            if (last && opts.endEdit) edit = opts.endEdit;
            else if (last) edit = r.weighted([["roll", 2], ["roll32", 1.5], ["stutter", 1.5], ["stutter32", 1], ["kicks", 0.6]]);
            else if (mid && r.chance(0.35 + 0.3 * opts.chaos)) edit = r.weighted([["stutter", 1], ["roll32", 0.7], ["kicks", 1], ["stutter32", 0.6]]);
            else if (bar % 2 === 1 && r.chance(0.12 * opts.chaos)) edit = "kicks";
            if (edit) { const e = EDITS[edit](beats); beats = beats.map((b, i) => (e[i] === null ? b : e[i])); }
            if (opts.open && r.chance(0.4) && !edit) beats[3] = beats[3].map((s, i) => (i === 2 ? s.replace("h", "o") : s));
            beats.forEach((b, i) => renderBeat(B + i, b, opts.dyn));
            if (opts.ride) for (let i = 0; i < 4; i++) if (!(edit && i >= 2)) { push("drums", B + i, 0.5, "ride", (i % 2 ? 0.34 : 0.44) * opts.dyn); if (opts.ride > 1) push("drums", B + i + 0.5, 0.5, "ride", 0.26 * opts.dyn); }
          }
        }
        if (opts.crash) push("drums", 0, 1, "crash", 0.75);
      }
      function halfBars(from, to, dyn = 1, ride = true) {
        for (let bar = from; bar < to; bar++) {
          const B = bar * BPB, pat = HALF_BARS[(bar + (state.halfVar || 0)) % HALF_BARS.length];
          pat.forEach((b, i) => renderBeat(B + i, b, dyn));
          if (ride) for (let i = 0; i < 4; i++) push("drums", B + i, 0.5, "ride", i === 0 ? 0.48 : 0.32);
        }
      }
      const filt = (abs, freq, durBeats, instant) => push("dfx", abs, durBeats, "filter", 1, { freq, instant: !!instant });

      // ---------- bass ----------
      function riff(riffs, from, to, opts = {}) {
        const out = [];
        for (let b2 = from; b2 < to; b2 += 2) {
          // one riff per cycle (its identity), a different one for the turnaround pair
          const k = (opts.rot || 0) + (b2 >= 6 && opts.turn !== false ? 1 : 0);
          const R = Array.isArray(riffs[0][0]) ? riffs[k % riffs.length] : riffs;
          R.forEach(([bt, tok, dur, slide]) => {
            const at = b2 * BPB + bt;
            if (at >= to * BPB - 1e-6) return;
            const c = T.chord(sym(at));
            out.push({ at, dur, note: bassRoot(c) + tokenSemis(c, tok), slide: !!slide });
          });
        }
        // a slide glides out of the previous note, which must still be sounding
        out.forEach((n, i) => {
          const nx = out[i + 1];
          if (nx && nx.slide) n.dur = nx.at - n.at + 0.08;
          else if (nx) n.dur = Math.min(n.dur, nx.at - n.at - 0.05);
        });
        out.forEach((n, i) => {
          const extra = { slide: n.slide && i > 0 };
          if (i === 0 && opts.cut) Object.assign(extra, { cut: opts.cut, cutSecs: opts.cutSecs || 0.05 });
          if (i === 0 && opts.lfo) extra.lfo = opts.lfo;
          if (opts.reese != null) extra.reese = opts.reese;
          push("bass", n.at, Math.max(0.1, n.dur), n.note, (opts.vel || 0.85) * (n.slide ? 0.95 : 1), extra);
        });
      }

      // ---------- pads and stabs ----------
      function pads(track, vel, lo = 53, hi = 76) {
        prog.forEach((h) => {
          const v = T.voice(h.chord, { lo, hi, n: 4, prev: state[track + "V"], top: [67, 75], omitBass: true, rng: r });
          state[track + "V"] = v;
          push(track, h.bar * BPB + h.beat, h.dur - 0.15, v, vel);
        });
      }
      function stabs(track, hitsPerChord, vel, lo, hi) {
        prog.forEach((h) => {
          const v = T.voice(h.chord, { lo, hi, n: 4, prev: state[track + "V"], top: [hi - 8, hi], omitBass: true, rng: r });
          state[track + "V"] = v;
          const s0 = h.bar * BPB + h.beat;
          hitsPerChord.forEach(([o, d]) => { if (o < h.dur) push(track, s0 + o, d, v, vel * (o === 0 ? 1 : 0.85)); });
        });
      }
      function keysMotif(from, to, density = 0.22) {
        if (!state.keysMotif || state.keysRound !== Math.floor(cycle / 12)) {
          const m = C.line({ start: 0, end: 16, chordAt: (b) => breakAt(b).chord, lo: 63, hi: 82, rng: r.fork(9), density, phrase: [3, 5], rest: [3, 6], chromatic: 0, register: 0.55, upbeatStart: 0.6 });
          state.keysMotif = m.motif; state.keysRound = Math.floor(cycle / 12);
        }
        const m = C.line({ start: from, end: to, chordAt: sym, lo: 63, hi: 82, rng: r, density, phrase: [3, 6], rest: [3, 7], motif: state.keysMotif, motifProb: 0.7, chromatic: 0.05, register: 0.55, prev: state.keysLast, upbeatStart: 0.6 });
        state.keysLast = m.last;
        m.notes.forEach((n) => {
          // under 9th-chord pads a passing tone a semitone from a chord tone rubs: take the chord tone
          const c = T.chord(sym(n.beat));
          let note = n.note;
          if (!c.pcs.includes(T.mod12(note)) && c.pcs.some((p) => [1, 11].includes(T.mod12(note - p)))) note = T.nearest(note, c.pcs, 63, 82);
          push("keys", n.beat, Math.max(0.5, n.dur), note, 0.42 + (n.vel - 0.6) * 0.8);
        });
      }

      let label = sec.label;
      const n = sec.n || 0;
      switch (sec.id) {
        case "intro": {
          filt(0, 260, 0.1, true); filt(0.25, 1500, 27.5);
          breakBars(BREAK_A, 0, BARS, { chaos: 0.1, dyn: 0.85, endEdit: "roll", straightStart: true });
          riff(RIFF_SUB, 0, BARS, { reese: 0, cut: 400, vel: 0.8, lfo: { rate: 0.18, min: 160, max: 500 } });
          pads("pad", 0.42);
          keysMotif(2, 26);
          push("riser", 24, 8, "up", 0.9);
          break;
        }
        case "drop": {
          const chaos = [0.2, 0.45, 0.6, 0.35, 0.75][n];
          filt(0, 18000, 0.1, true);
          const nextIsQuiet = next.id === "breakdown" || next.id === "half";
          breakBars(BREAK_A, 0, BARS, { chaos, dyn: 1, ride: n >= 2 ? (n === 4 ? 2 : 1) : 0, crash: n === 0 || n === 3, open: n >= 1, endEdit: nextIsQuiet ? r.pick(["gap", "roll32"]) : null, straightStart: n === 0 });
          const lfo = n === 4 ? { rate: 172 / 60 / 2, min: 200, max: 1300 } : { rate: 172 / 60 / 8, min: 170, max: n >= 2 ? 1150 : 900 };
          riff(RIFF_A, 0, BARS, { rot: (n + state.riffRot) % 3, cut: 2600, cutSecs: 0.05, lfo });
          pads("pad", 0.32);
          if (n === 1 || n === 3) stabs("choir", [[0, 0.45], [1.75, 0.3]], 0.7, 62, 81);
          if (n === 2) keysMotif(0, 30, 0.3);
          if (n === 4) stabs("stab", [[0, 0.3], [2.5, 0.3]], 0.55, 58, 79);
          break;
        }
        case "half": {
          filt(0, 18000, 0.1, true);
          if (n === 0) { halfBars(0, BARS); push("drums", 0, 1, "crash", 0.7); }
          else {
            halfBars(0, 6);
            breakBars(BREAK_A, 6, BARS, { chaos: 0.3, dyn: 1, endEdit: "roll" }); // doubling back
            push("riser", 16, 16, "up", 0.8);
          }
          riff(RIFF_HALF, 0, n === 0 ? BARS : 6, { cut: 1800, lfo: { rate: 172 / 60 / 4, min: 150, max: 1600 } });
          if (n === 1) riff(RIFF_A, 6, BARS, { rot: 2, lfo: { rate: 172 / 60 / 4, min: 170, max: 1000 } });
          pads("strings", n === 0 ? 0.42 : 0.38, 53, 77);
          if (n === 0) push("choir", 0, 1.5, T.voice(prog[0].chord, { lo: 60, hi: 79, n: 4, omitBass: true }), 0.6);
          break;
        }
        case "switch": {
          filt(0, 18000, 0.1, true);
          breakBars(BREAK_B, 0, BARS, { chaos: n ? 0.6 : 0.35, dyn: 1, crash: n === 0, ride: n, open: true, straightStart: n === 0, endEdit: n === 1 && (next.id === "breakdown" || next.id === "half") ? "gap" : null });
          riff(RIFF_B, 0, BARS, { rot: n, cut: 3000, lfo: { rate: 172 / 60 / 4, min: 200, max: 1200 } });
          pads("pad", 0.3);
          stabs("stab", n === 0 ? [[0, 0.3], [0.75, 0.25], [6.5, 0.3]] : [[0, 0.3], [0.75, 0.25], [1.5, 0.3], [4, 0.3], [4.75, 0.25], [6.5, 0.3]], 0.6, 58, 79);
          label = sec.label;
          break;
        }
        case "breakdown": {
          filt(0, 700, 0.1, true);
          for (let bar = 0; bar < BARS; bar++) for (let i = 0; i < 8; i++) push("drums", bar * BPB + i * 0.5, 0.5, "ride", i % 2 ? 0.22 : 0.32);
          riff(RIFF_SUB, 0, BARS, { reese: 0.25, cut: 320, cutSecs: 0.5, vel: 0.75, lfo: { rate: 0.12, min: 150, max: 420 } });
          pads("pad", 0.5);
          pads("strings", 0.36, 65, 86);
          keysMotif(0, 30, 0.25);
          push("choir", 24, 7.5, T.voice(prog[prog.length - 1].chord, { lo: 62, hi: 81, n: 4, omitBass: true }), 0.45);
          break;
        }
        case "build": {
          filt(0, 300, 0.1, true); filt(0.25, 6500, 29.5);
          breakBars(BREAK_A, 0, BARS - 1, { chaos: 0.2, dyn: 0.9, straightStart: true });
          renderBeat(28, ["Kh", "", "Kh", "h"]); renderBeat(29, { roll: true, n: 4, v0: 0.3, v1: 0.5 });
          renderBeat(30, { roll: true, n: 8, v0: 0.45, v1: 0.75 }); renderBeat(31, { roll: true, n: 8, v0: 0.75, v1: 1 });
          // bass: the root in eighths, the reese filter opening with the drums
          for (let b = 0; b < CYC - 2; b += 0.5) {
            const c = T.chord(sym(b));
            push("bass", b, 0.42, bassRoot(c) + (b % 2 === 1.5 ? 12 : 0), b % 1 ? 0.62 : 0.8, b === 0 ? { cut: 3200, cutSecs: (CYC * 60) / 172, lfo: { rate: 172 / 60 / 2, min: 180, max: 700 } } : {});
          }
          pads("pad", 0.4);
          push("riser", 0, CYC, "up", 1);
          break;
        }
        default: break;
      }
      state.halfVar = (state.halfVar || 0) + 1;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();

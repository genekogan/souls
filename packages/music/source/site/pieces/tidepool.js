// Tidepool: generative ambient for the tide-pool stage of a life sim, built on Eno's tape-loop method.
//
// Loops: four voices each repeat a short phrase on their own period (harp 17, glass 21.5, piano 26.5,
// bell 31 beats at 60 BPM). The periods share no small common multiple, so the way the phrases line up
// keeps changing. Loop phases live in `state` and every decision about loop instance k is hashed from
// (seed, voice, k), so a phrase that straddles a cycle boundary plays the same way on both sides.
// Phrases are stored as pentatonic steps from an anchor pitch, so they keep their contour when the
// field changes and hold common tones. Every few repetitions a phrase mutates (one step, a half-beat
// displacement, a drift of register, a note dropped or added), and now and then it returns to its first form.
//
// Harmony: an Ab-major pentatonic field (Ab Bb C Eb F) over slow open-fifth pedals on Db, Ab or F, and a
// Db-pentatonic field (Db Eb F Ab Bb) over Bb or Gb. A center lasts two to four minutes. Each field
// can be lit for a cycle or three by one altered tone that replaces a field tone a semitone above it:
// the lydian #4 over Db or Gb, the maj7 over Ab, the dorian 6th over F or Bb. Ab lydian is always lit.
// Light tones always sit above the pedal tone they neighbour, so they sound as major 7ths and never as b9s.
//
// Tide: two slow sines (about 6.4 and 10 minutes) set how many voices are active and how loud they are.
// At slack water only the piano and the pedal remain. Water (filtered-noise swells) and celesta glints
// follow the tide.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const mod12 = T.mod12;
  const BPB = 4, CYCLE_BARS = 8, CB = BPB * CYCLE_BARS;

  const AB_PENT = [8, 10, 0, 3, 5]; // Ab Bb C Eb F
  const DB_PENT = [1, 3, 5, 8, 10]; // Db Eb F Ab Bb

  // root: lower pedal note (the pad plays root + fifth, the sub an octave below root).
  // light: [field pc, replacement pc a semitone lower]. chord: [unlit symbol, lit symbol].
  const FIELDS = {
    DbL: { name: "D♭", lightName: "lydian #4", root: 37, core: AB_PENT, light: [8, 7], lightP: 0.55, chord: ["Dbmaj13", "Dbmaj13#11"], len: [5, 7] },
    Ab: { name: "A♭", lightName: "maj7 light", root: 44, core: AB_PENT, light: [8, 7], lightP: 0.35, chord: ["Ab69", "Abmaj13"], len: [4, 6] },
    AbL: { name: "A♭ lydian", lightName: "", root: 44, core: AB_PENT, light: [3, 2], lightP: 1, chord: ["Ab69", "Ab69#11"], len: [2, 4] },
    Fm: { name: "F minor", lightName: "dorian 6th", root: 41, core: AB_PENT, light: [3, 2], lightP: 0.45, chord: ["Fm11", "Fm13"], len: [3, 5] },
    Bbm: { name: "B♭ minor", lightName: "dorian 6th", root: 46, core: DB_PENT, light: [8, 7], lightP: 0.45, chord: ["Bbm11", "Bbm13"], len: [3, 5] },
    Gb: { name: "G♭", lightName: "lydian #4", root: 42, core: DB_PENT, light: [1, 0], lightP: 0.65, chord: ["Gbmaj13", "Gbmaj13#11"], len: [3, 4] },
  };
  const NEXT = {
    DbL: [["Ab", 4.5], ["Bbm", 3], ["Gb", 2.5]],
    Ab: [["AbL", 3.5], ["Fm", 3.5], ["DbL", 3]],
    AbL: [["Ab", 4], ["Fm", 3], ["DbL", 3]],
    Fm: [["DbL", 5.5], ["Ab", 4.5]],
    Bbm: [["Gb", 5], ["DbL", 5]],
    Gb: [["DbL", 7], ["Bbm", 3]],
  };

  // Loop voices. Shapes: [offset beats, pentatonic step from anchor (array for dyads), duration beats].
  const VOICES = [
    {
      id: "piano", period: 26.5, phase: 3, gen: 5, thr: 0, skip: 0.1, lo: 70, hi: 93, anchor: [75, 79], vel: 0.52, steps: [-2, 4], maxNotes: 5,
      shapes: [
        [[0, 0, 1.5], [1.5, 1, 1.5], [3, 2, 1], [4, 1, 6]],
        [[0, 2, 2], [2, 0, 1], [3, -1, 1.5], [4.5, 0, 6]],
        [[0, 0, 1], [1, 2, 1.5], [2.5, 1, 3], [6, -1, 6]],
        [[0, 3, 3], [3, 1, 1], [4, 2, 7]],
        [[0, -1, 1], [1, 1, 2], [3, 0, 7]],
      ],
    },
    {
      id: "glass", period: 21.5, phase: 6, gen: 6, thr: 0.26, skip: 0.15, lo: 56, hi: 74, anchor: [57, 62], vel: 0.4, steps: [-1, 4], maxNotes: 2, dyad: true,
      shapes: [
        [[0, [0, 2], 10]],
        [[0, [0, 3], 7], [8, [-1, 2], 6]],
        [[0, [-1, 1], 9]],
        [[0, [1, 3], 6], [6.5, [0, 2], 8]],
      ],
    },
    {
      id: "harp", period: 17, phase: 10.5, gen: 7, thr: 0.42, skip: 0.18, lo: 58, hi: 80, anchor: [61, 65], vel: 0.5, steps: [-1, 4], maxNotes: 4,
      shapes: [
        [[0, 0, 3], [1, 2, 3], [2, 4, 4]],
        [[0, 0, 2], [1, 1, 2], [2, 3, 4]],
        [[0, 2, 3], [1, 0, 3], [2.5, 1, 4]],
        [[0, 1, 2], [1.5, 3, 2], [2.5, 2, 4], [4, 0, 5]],
      ],
    },
    {
      id: "bell", period: 31, phase: 20, gen: 4, thr: 0.5, skip: 0.1, lo: 79, hi: 96, anchor: [84, 89], vel: 0.36, steps: [-2, 2], maxNotes: 2,
      shapes: [
        [[0, 0, 8]],
        [[0, 0, 5], [4, -2, 8]],
        [[0, 1, 4], [2, -1, 8]],
        [[0, -1, 4], [3, 1, 8]],
      ],
    },
  ];

  // ---------- deterministic hashing (loop decisions must not depend on which cycle computes them) ----------
  function mix(...xs) {
    let h = 2166136261 >>> 0;
    for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; }
    return h >>> 0;
  }
  const hr = (...xs) => T.rng(mix(...xs));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /** The tide, 0..1: two slow sines, with a gentle opening ramp so voices enter one by one. */
  function tideAt(state, t) {
    const base = 0.55 + 0.28 * Math.sin((2 * Math.PI * t) / 384 + state.phi1) + 0.17 * Math.sin((2 * Math.PI * t) / 608 + state.phi2);
    return Math.max(0, Math.min(1, base, 0.1 + t / 200));
  }

  /** Mutate one phrase slightly: the loop generation g+1 from generation g. */
  function mutate(prev, orig, v, r, g) {
    const s = mutateOnce(prev, orig, v, r, g);
    // keep only phrases with no repeated adjacent step (a repeated note sounds like a stuck tape, not a phrase)
    const ok = v.dyad || s.notes.every((n, i) => i === 0 || n[1] !== s.notes[i - 1][1]);
    return ok ? s : clone(prev);
  }
  function mutateOnce(prev, orig, v, r, g) {
    const s = clone(prev);
    const ns = s.notes, k = ns.length;
    const total = ns[k - 1][0] + ns[k - 1][2];
    const op = r.weighted([
      ["step", 3], ["shift", k > 1 ? 2 : 0], ["anchor", 1.3],
      ["drop", k > (v.dyad ? 1 : 2) ? 0.8 : 0], ["add", k < v.maxNotes && total < v.period - 6 ? 0.9 : 0],
      ["return", g >= 3 ? 1 : 0],
    ]);
    const clampStep = (x) => Math.max(v.steps[0], Math.min(v.steps[1], x));
    if (op === "return") return clone(orig);
    if (op === "step") {
      const i = r.int(0, k - 1), d = r.chance(0.5) ? 1 : -1;
      if (v.dyad) {
        const j = r.int(0, 1), pair = ns[i][1].slice();
        pair[j] = clampStep(pair[j] + d);
        if (pair[1] - pair[0] >= 1 && pair[1] - pair[0] <= 4) ns[i][1] = pair;
      } else {
        let x = clampStep(ns[i][1] + d);
        const nb = [ns[i - 1], ns[i + 1]].filter(Boolean).map((n) => n[1]);
        if (nb.includes(x)) x = clampStep(ns[i][1] - d); // avoid making a repeated note
        ns[i][1] = x;
      }
    } else if (op === "shift") {
      const i = r.int(1, k - 1), d = r.chance(0.5) ? 0.5 : -0.5, o = ns[i][0] + d;
      const lo = ns[i - 1][0] + 0.5, hi = i + 1 < k ? ns[i + 1][0] - 0.5 : Infinity;
      if (o >= lo && o <= hi) { ns[i][0] = o; ns[i - 1][2] = Math.max(0.5, ns[i - 1][2] + (v.dyad ? 0 : d)); }
    } else if (op === "anchor") {
      const a0 = orig.anchor;
      const a = T.step(s.anchor, r.chance(0.5) ? 1 : -1, AB_PENT);
      if (Math.abs(a - a0) <= 5) s.anchor = a;
    } else if (op === "drop") {
      const i = r.int(1, k - 1);
      if (i === k - 1) ns[i - 1][2] = Math.max(ns[i - 1][2], ns[i][2]); // the new last note rings on
      ns.splice(i, 1);
    } else if (op === "add") {
      if (v.dyad) {
        const last = ns[k - 1];
        ns.push([last[0] + last[2] + 1, last[1].map((x) => clampStep(x + (r.chance(0.5) ? 1 : -1))).sort((a, b) => a - b), 6]);
        if (ns[k][1][1] - ns[k][1][0] < 1) ns.pop();
      } else {
        const gaps = [];
        for (let i = 0; i + 1 < k; i++) if (ns[i + 1][0] - ns[i][0] >= 1.5) gaps.push(i);
        if (gaps.length) {
          const i = r.pick(gaps), off = Math.round((ns[i][0] + ns[i + 1][0])) / 2;
          // a passing or neighbour step that repeats neither note around it
          const a0 = ns[i][1], a1 = ns[i + 1][1], mid = (a0 + a1) / 2;
          const opts = [];
          for (let x = Math.min(a0, a1) - 1; x <= Math.max(a0, a1) + 1; x++) if (x !== a0 && x !== a1 && clampStep(x) === x) opts.push(x);
          if (opts.length) {
            const best = Math.min(...opts.map((x) => Math.abs(x - mid)));
            const sStep = r.pick(opts.filter((x) => Math.abs(x - mid) === best));
            ns.splice(i + 1, 0, [off, sStep, Math.max(1, ns[i + 1][0] - off)]);
          }
        }
      }
    }
    return s;
  }

  Sim.register({
    id: "tidepool",
    title: "Tidepool",
    genre: "Generative ambient",
    about: "Eno-style loops on incommensurate periods (17, 21.5, 26.5 and 31 beats) over slow open-fifth pedals in D♭, A♭ and their relative minors, lit now and then by a lydian #4 or a dorian 6th. A slow tide brings voices in and out.",
    bpm: 60, beatsPerBar: BPB, cycleBars: CYCLE_BARS, swing: 0.5, gainDb: 3.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 9, preDelay: 0.07, lowcut: 220, highcut: 5200 });
      // tape-like echo: a slow wow before a dark dotted-quarter feedback delay
      const tapeOut = ctx.keep(new Tone.Gain(1)).connect(out);
      I.send(ctx, tapeOut, hall, -8); // the echoes live in the same hall
      const tape = I.delay(ctx, tapeOut, { time: "4n.", feedback: 0.42, highcut: 2300 });
      const wow = ctx.keep(new Tone.Vibrato({ frequency: 0.35, depth: 0.1 }));
      wow.connect(tape);

      const piano = I.softPiano(ctx, { volume: -2, decay: 6, release: 4, cutoff: 2200 });
      const bell = I.bell(ctx, { volume: -11, decay: 7 });
      const harp = I.harp(ctx, { volume: -7, dampening: 3600, resonance: 0.98 });
      const glass = I.glassPad(ctx, { volume: -10, attack: 3, release: 6 });
      const pad = I.pad(ctx, { volume: -8, wave: "fattriangle", cutoff: 900, breath: 0.03, attack: 7, release: 9, detune: 12 });
      const sub = I.sub(ctx, { volume: -13, attack: 5, release: 8 });
      const glint = I.glock(ctx, { volume: -15, celesta: true, decay: 3 });

      const pp = I.place(ctx, piano, -0.15, out); I.send(ctx, pp, hall, -6); I.send(ctx, pp, wow, -17);
      const bp = I.place(ctx, bell, 0.38, out); I.send(ctx, bp, hall, -4); I.send(ctx, bp, wow, -12);
      const hp = I.place(ctx, harp, -0.42, out); I.send(ctx, hp, hall, -8); I.send(ctx, hp, wow, -19);
      const gp = I.place(ctx, glass, 0.18, out); I.send(ctx, gp, hall, -7);
      const dp = I.place(ctx, pad, 0, out); I.send(ctx, dp, hall, -15);
      I.place(ctx, sub, 0, out);
      const cp = I.place(ctx, glint, 0.5, out); I.send(ctx, cp, hall, -2); I.send(ctx, cp, wow, -8);

      // water: three filtered-noise voices, each a slow swell with a filter sweep and a stereo drift
      const wOut = ctx.keep(new Tone.Gain(1)).connect(out);
      I.send(ctx, wOut, hall, -6);
      const waters = [0, 1, 2].map((i) => {
        const noise = ctx.keep(new Tone.Noise({ type: i === 1 ? "brown" : "pink" }).start());
        const bpf = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 700, Q: 1.3 }));
        const g = ctx.keep(new Tone.Gain(0));
        const pan = ctx.keep(new Tone.Panner(0));
        noise.connect(bpf); bpf.connect(g); g.connect(pan); pan.connect(wOut);
        return { bpf, g, pan };
      });
      let wi = 0;
      const swell = (t, e, d) => {
        const w = waters[wi++ % waters.length];
        w.g.gain.cancelScheduledValues(t);
        w.g.gain.setValueAtTime(0, t);
        w.g.gain.linearRampToValueAtTime(e.vel * 0.8, t + d * 0.45);
        w.g.gain.linearRampToValueAtTime(0, t + d);
        w.bpf.frequency.cancelScheduledValues(t);
        w.bpf.frequency.setValueAtTime(e.f1, t);
        w.bpf.frequency.exponentialRampToValueAtTime(e.f2, t + d);
        w.pan.pan.cancelScheduledValues(t);
        w.pan.pan.setValueAtTime(e.pan, t);
        w.pan.pan.linearRampToValueAtTime(e.pan2, t + d);
      };

      const loop = { timing: 0.012, vel: 0.06 };
      return {
        piano: { layer: "melody", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: loop },
        bell: { layer: "melody", play: (t, e, d) => bell.play(t, e.note, d, e.vel), humanize: loop },
        harp: { layer: "harmony", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: loop },
        glass: { layer: "harmony", play: (t, e, d) => glass.play(t, e.note, d, e.vel), humanize: loop },
        drone: { layer: "bass", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        sub: { layer: "bass", play: (t, e, d) => sub.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        glint: { layer: "texture", play: (t, e, d) => glint.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.1 } },
        water: { layer: "texture", play: swell, humanize: { timing: 0.05, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (cycle === 0 || state.seed == null) {
        state.seed = Math.floor(r() * 2 ** 31);
        state.phi1 = r.range(-0.5, 0.4); // start near the middle of the long swell, rising
        state.phi2 = r.range(0, 2 * Math.PI);
        state.phase = VOICES.map((v) => v.phase);
        state.shapes = VOICES.map((v, vi) => {
          const sr = hr(state.seed, vi, 99);
          const notes = clone(sr.pick(v.shapes));
          return [{ anchor: T.nearest(sr.int(v.anchor[0], v.anchor[1]), AB_PENT), notes }];
        });
        state.field = "DbL"; state.fieldLeft = r.int(5, 7); state.sinceHome = 0;
        state.lit = false; state.litLeft = 1; // the opening is unlit; light arrives later
      } else if (state.fieldLeft <= 0) {
        const prev = state.field;
        let next = state.sinceHome >= 3 ? "DbL" : r.weighted(NEXT[prev]);
        state.field = next;
        state.fieldLeft = r.int(...FIELDS[next].len);
        state.sinceHome = next === "DbL" ? 0 : state.sinceHome + 1;
        state.litLeft = 0; state.lit = false; // reconsider the light at every change of center
      }
      const F = FIELDS[state.field];
      if (state.litLeft <= 0) { // light comes in episodes: a lit spell is always followed by a plain one
        state.lit = F.lightP >= 1 || (!state.lit && r.chance(F.lightP));
        state.litLeft = state.lit ? r.int(1, 3) : r.int(2, 3);
      }
      state.litLeft--; state.fieldLeft--;
      const lit = state.lit;

      const B = cycle * CB, E = B + CB;
      const tide = (t) => tideAt(state, t);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs - B, BPB);
        ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra });
      };
      const renderStep = (v, anchor, s) => {
        let m = T.step(T.nearest(anchor, F.core), s, F.core);
        while (m > v.hi) m -= 12;
        while (m < v.lo) m += 12;
        if (lit && m >= 60 && mod12(m) === F.light[0]) m -= 1; // below C4 the light would rub on the pedal's overtones
        return m;
      };
      // Eno-like irregularity: an instance may drop out, but never two in a row.
      const rawSkip = (vi, k) => k >= 0 && hr(state.seed, vi, k, 7)() < VOICES[vi].skip;
      const skipped = (vi, k) => { let j = 0; while (rawSkip(vi, k - j)) j++; return j % 2 === 1; };
      // Will the light or the center change at the end of this cycle? Then sustained glass must not ring across.
      const boundaryMoves = state.fieldLeft <= 0 || (state.litLeft <= 0 && F.lightP < 1);
      const shapeFor = (vi, g) => {
        const arr = state.shapes[vi];
        while (arr.length <= g) arr.push(mutate(arr[arr.length - 1], arr[0], VOICES[vi], hr(state.seed, vi, arr.length, 3), arr.length));
        return arr[g];
      };

      // ---- the loops ----
      const playing = [], loopEv = [];
      VOICES.forEach((v, vi) => {
        const ph = state.phase[vi];
        const kLo = Math.max(0, Math.ceil((B - ph - 24) / v.period)), kHi = Math.floor((E - ph) / v.period);
        let any = false;
        for (let k = kLo; k <= kHi; k++) {
          const s0 = ph + k * v.period, td = tide(s0), h = hr(state.seed, vi, k, 99);
          // the piano always opens, and at slack water it is the one voice that never drops out
          if ((td < v.thr || skipped(vi, k)) && !(vi === 0 && (k === 0 || td < 0.3))) continue;
          const shape = shapeFor(vi, Math.floor(k / v.gen));
          const amp = 0.7 + 0.42 * td;
          shape.notes.forEach((n, i) => {
            const t = s0 + n[0];
            if (t < B || t >= E) return;
            const note = v.dyad ? n[1].map((s) => renderStep(v, shape.anchor, s)).sort((a, b) => a - b) : renderStep(v, shape.anchor, n[1]);
            const shapeVel = i === 0 ? 1 : i === shape.notes.length - 1 ? 0.86 : 0.92;
            if (v.dyad && boundaryMoves && t > E - 5) return; // a swell this late would bloom into the next light
            const dur = v.dyad && boundaryMoves ? Math.min(n[2], Math.max(2, E - t - 1)) : n[2];
            any = true;
            loopEv.push({ track: v.id, t, dur, note, vel: v.vel * amp * shapeVel * (0.94 + 0.12 * h()) });
          });
        }
        if (any) playing.push(v.id);
      });
      // A lit cycle must actually show its light. If no loop note fell on the replaced tone, bend the longest
      // note a whole step below the light up onto it (F to G over D♭, C to D over A♭ lydian, ...).
      const lightPc = mod12(F.light[1]);
      const pcsOf = (e) => (Array.isArray(e.note) ? e.note : [e.note]).map(mod12);
      if (lit && loopEv.length && !loopEv.some((e) => pcsOf(e).includes(lightPc))) {
        const cand = loopEv.filter((e) => pcsOf(e).includes(mod12(lightPc - 2))).sort((a, b) => b.dur - a.dur)[0];
        if (cand) cand.note = Array.isArray(cand.note) ? cand.note.map((m) => (mod12(m) === mod12(lightPc - 2) ? m + 2 : m)) : cand.note + 2;
      }
      loopEv.forEach((e) => push(e.track, e.t, e.dur, e.note, e.vel));

      // ---- pedal: open fifth plus sub, re-breathed every cycle with overlapping envelopes ----
      const mid = tide(B + CB / 2);
      push("drone", B, CB + 1, [F.root, F.root + 7], 0.4 + 0.2 * mid);
      push("sub", B, CB + 1, F.root - 12, 0.5 + 0.15 * mid);

      // ---- glints: celesta catching the light, only near high water ----
      if (mid > 0.56 && r.chance((mid - 0.45) * 1.4)) {
        const at = B + r.int(4, 56) / 2;
        let m = T.nearest(r.int(87, 92), F.core);
        const fig = r.pick([[[0, 0], [0.5, -1], [1.5, -2]], [[0, 0], [1, -1]], [[0, -1], [0.5, 0], [1.5, -2]], [[0, 0], [0.5, 1], [1, -1]]]);
        fig.forEach(([o, s], i) => {
          let n = T.step(m, s, F.core);
          if (lit && mod12(n) === F.light[0]) n -= 1;
          push("glint", at + o, 2, n, (0.26 - i * 0.03) * (0.8 + 0.4 * mid));
        });
      }

      // ---- water: filtered-noise swells, more at high tide ----
      const nSwells = r.weighted([[0, 1.3 - mid], [1, 1], [2, mid * 0.6]]);
      for (let i = 0; i < nSwells; i++) {
        const at = B + (i === 0 ? r.int(0, 24) : r.int(30, 50)) / 2;
        const rise = r.chance(0.55), f1 = r.range(280, 800), f2 = f1 * (rise ? r.range(1.8, 3.2) : 1 / r.range(1.6, 2.4));
        const pan = r.range(-0.7, 0.7);
        push("water", at, r.range(8, 15), "swell", 0.2 + 0.25 * mid, { f1: Math.round(f1), f2: Math.round(f2), pan, pan2: Math.max(-0.8, Math.min(0.8, pan + r.range(-0.6, 0.6))) });
      }

      const word = cycle === 0 ? "still water" : mid < 0.3 ? "slack water" : mid > 0.8 ? "high water" : tide(B + CB) >= tide(B) ? "flood tide" : "ebb tide";
      const label = `${F.name}${lit && F.lightName ? " · " + F.lightName : ""} · ${word} · ${playing.length ? playing.join(", ") : "pedal"}`;
      return { events: ev, harmony: [{ bar: 0, beat: 0, dur: CB, chord: F.chord[lit ? 1 : 0] }], section: label, state };
    },
  });
})();

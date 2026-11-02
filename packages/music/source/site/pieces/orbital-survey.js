// Orbital Survey: space synth in the Berlin School / Vangelis manner, for drifting over a planet
// nobody has named yet. One "orbit" is about four minutes in one minor key:
//   drift (pads, sub pedal, celesta constellations) -> the analog sequencer wakes with its filter shut
//   -> CS-80 brass theme -> peak (chromatic-mediant lift, soft pulse) -> theme returns -> thinning
//   -> new horizon (the old key's lydian bVI becomes the next tonic: C -> Ab -> E -> C, a major-third cycle).
// The sequencer is a 2-bar step pattern built from a polymetric cell (3/5/6/7 steps against 16ths) that
// mutates a little every cycle: swapped steps, octave jumps, wandering accents, occasional rests. Its
// filter follows long arcs (section targets plus a 24-bar sine), set per note from the score.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony: [semitones above tonic, quality (+ "/n" bass offset), bars] ----------
  const PROGS = {
    D1: [[0, "m9", 4], [8, "maj7/0", 4]],                        // i, bVI over the tonic pedal
    D2a: [[5, "m9/0", 4], [0, "madd9", 4]],                      // iv over pedal
    D2b: [[10, "add9/0", 4], [0, "m9", 4]],                      // bVII over pedal
    S1: [[0, "m9", 4], [8, "maj9", 4]],
    S2a: [[3, "maj9", 4], [10, "sus4", 2], [10, "", 2]],         // relative-major light, bVII sus -> bVII
    S2b: [[0, "m9", 2], [5, "add9/0", 2], [0, "m9", 2], [5, "add9/0", 2]], // dorian IV shimmer on the pedal
    S3: [[0, "m9", 4], [8, "maj9#11", 2], [10, "sus4", 2]],
    T1: [[0, "m9", 4], [8, "maj9#11", 4]],                       // theme: i, lydian bVI
    T2: [[10, "sus4", 2], [10, "", 2], [5, "add9/9", 2], [7, "sus4", 2]], // bVII sus-res, dorian IV/3, V sus
    P1: [[0, "m9", 4], [8, "maj9", 2], [4, "maj7/8", 2]],        // i, bVI, III#/#5 (Abmaj9 -> Emaj7/G#)
    P2: [[5, "add9/9", 2], [8, "maj9#11", 2], [10, "sus4", 2], [10, "", 2]], // planing up a semitone, home via bVII
    H1: [[0, "m9", 4], [5, "m9/0", 4]],
    TR: [[8, "maj9#11", 4], [8, "sus2", 4]],                     // bVI lydian, third evaporates -> next tonic
  };

  // ---------- brass phrases, written in C minor: [beat in cycle, dur, midi] ----------
  const PHRASES = {
    A: [[0, 2.5, 60], [2.5, 5.5, 67], [8, 1, 65], [9, 1, 63], [10, 5, 62],
      [16, 1.5, 63], [17.5, 4.5, 75], [22, 1, 74], [23, 1, 72], [24, 1, 70], [25, 6, 67]],
    Ar: [[1, 2, 60], [3, 5, 72], [8, 1, 70], [9, 1, 67], [10, 1, 63], [11, 4.5, 62],
      [16, 1.5, 63], [17.5, 2.5, 75], [20, 1, 74], [21, 1, 72], [22, 2, 70], [24, 6, 72]],
    B: [[0, 2, 65], [2, 1, 70], [3, 1, 72], [4, 4, 75], [8, 5, 74], [13, 1, 72], [14, 2, 70],
      [16, 4, 69], [20, 1, 72], [21, 3, 67], [24, 2, 74], [26, 6, 72]],
    P1: [[0, 2, 67], [2, 1, 72], [3, 5, 79], [8, 1, 77], [9, 1, 75], [10, 2, 74], [12, 1, 70], [13, 3, 72],
      [16, 2, 75], [18, 6, 79], [24, 4, 80], [28, 4, 76]],
    P2: [[0, 3, 77], [3, 1, 72], [4, 4, 69], [8, 2, 75], [10, 2, 74], [12, 3.5, 70],
      [16, 1.5, 70], [17.5, 2.5, 77], [20, 4, 75], [24, 6, 74]],
  };

  // ---------- sections ----------
  // seq: { to: filter target Hz at cycle end, d: [density start, end], v: velocity scale, mut: mutations }
  const SEC = {
    D1: { label: "drift", prog: ["D1"], pad: 0.4, star: 2, glass: true },
    D2: { label: "drift · constellations", prog: ["D2a", "D2b"], pad: 0.42, star: 2, glass: true },
    S1: { label: "the sequencer wakes", prog: ["S1"], pad: 0.42, star: 1, seq: { to: 240, d: [0.12, 1], v: [0.65, 0.9], mut: 0 } },
    S2: { label: "sequencer · filter opening", prog: ["S2a", "S2b"], pad: 0.44, seq: { to: 400, d: [1, 1], v: [0.9, 0.95], mut: 1 } },
    S3: { label: "sequencer · strings", prog: ["S3"], pad: 0.45, strings: true, star: 1, seq: { to: 520, d: [1, 1], v: [0.95, 1], mut: 1 } },
    T1: { label: "brass theme", prog: ["T1"], pad: 0.45, strings: true, brass: "A", drums: "soft", seq: { to: 600, d: [1, 1], v: [0.95, 0.95], mut: 1 } },
    T2: { label: "brass theme · answer", prog: ["T2"], pad: 0.46, strings: true, brass: "B", drums: "soft", seq: { to: 700, d: [1, 1], v: [0.95, 1], mut: 1 } },
    P1: { label: "peak", prog: ["P1"], pad: 0.52, strings: true, brass: "P1", drums: "peak", bell: true, seq: { to: 950, d: [1, 1], v: [1, 1], mut: 2, oct: true } },
    P2: { label: "peak · descent", prog: ["P2"], pad: 0.52, strings: true, brass: "P2", drums: "peak", seq: { to: 820, d: [1, 1], v: [1, 1], mut: 2, oct: true } },
    T3: { label: "theme returns", prog: ["T1"], pad: 0.46, strings: true, brass: "Ar", drums: "soft", seq: { to: 560, d: [1, 1], v: [0.95, 0.9], mut: 1 } },
    H1: { label: "thinning", prog: ["H1"], pad: 0.44, star: 1, glass: true, seq: { to: 340, d: [1, 0.7], v: [0.9, 0.8], mut: 1 } },
    TR: { label: "new horizon", prog: ["TR"], pad: 0.42, star: 2, glass: true, seq: { to: 140, d: [0.65, 0.04], v: [0.8, 0.6], mut: 1 } },
  };

  function makePlan(orbit, r) {
    if (orbit === 0) return ["D1", "D2", "S1", "S2", "S3", "T1", "T2", "P1", "P2", "T3", "H1", "TR"];
    const p = ["D1"];
    if (r.chance(0.6)) p.push("D2");
    p.push("S1", "S2");
    if (r.chance(0.7)) p.push("S3");
    p.push("T1", "T2", "P1", "P2", "T3");
    if (r.chance(0.5)) p.push("S2"); // an extra stretch of pure sequencer before thinning
    p.push("H1", "TR");
    return p;
  }

  // ---------- sequencer pattern ----------
  // ladder steps: 0 bass, 1 third, 2 fifth, 3 seventh, 4 octave, 5 ninth, 6 tenth. Odd cell lengths ride
  // across the 16-step bar (Berlin-style polymeter) until the reset at each downbeat.
  const CELLS = [[[0, 2, 4], 2], [[0, 4, 3, 2, 5], 2.5], [[0, 4, 0, 3, 0, 5], 2.5], [[0, 2, 3, 4, 6, 4, 3], 2], [[0, 2, 4, 5, 4, 2, 3, 1], 1]];
  function makePattern(r) {
    const cell = r.weighted(CELLS), L = cell.length;
    const pat = [];
    for (let s = 0; s < 32; s++) {
      const i = s % 16;
      pat.push({ i: cell[i % L], o: 0, a: i % L === 0, g: true });
    }
    // second bar: a variant ending before the reset
    const tail = r.pick([[3, 2, 1], [4, 5, 4], [2, 4, 5], [1, 2, 4]]);
    tail.forEach((x, k) => { pat[29 + k].i = x; });
    pat[r.pick([7, 11, 13])].o = 1;
    pat[16 + r.pick([5, 9, 14])].o = 1;
    return pat;
  }
  function mutate(state, r, n, octBias) {
    const pat = state.pat, home = state.home;
    for (let k = 0; k < n; k++) {
      const op = r.weighted([["swap", 3], ["oct", octBias ? 4 : 2], ["accent", 2.5], ["neighbor", 2], ["rest", 1], ["restore", 2.5]]);
      const s = r.pick([...Array(32).keys()].filter((x) => x % 16 !== 0));
      if (op === "swap") { const t = s % 16 === 15 ? s - 1 : s + 1; [pat[s].i, pat[t].i] = [pat[t].i, pat[s].i]; }
      else if (op === "oct") {
        const ups = pat.filter((x) => x.o).length;
        if (ups >= 7) { const up = r.pick(pat.filter((x) => x.o)); up.o = 0; } else pat[s].o = 1 - pat[s].o;
      } else if (op === "accent") {
        const acc = [...Array(32).keys()].filter((x) => pat[x].a && x % 16 !== 0);
        if (acc.length) { const a = r.pick(acc), b = Math.max(1, Math.min(31, a + (r.chance(0.5) ? 1 : -1))); if (b % 16 !== 0) { pat[a].a = false; pat[b].a = true; } }
      } else if (op === "neighbor") pat[s].i = Math.max(0, Math.min(6, pat[s].i + (r.chance(0.5) ? 1 : -1)));
      else if (op === "rest") {
        const rests = pat.filter((x) => !x.g).length;
        if (!pat[s].a && rests < 3) pat[s].g = false; else pat[s].g = true;
      } else Object.assign(pat[s], home[s]);
    }
  }
  /** Steps ranked by how essential they are: downbeats, accents, roots first. */
  function ranks(pat) {
    const score = pat.map((x, s) => (s % 16 === 0 ? 100 : 0) + (x.a ? 40 : 0) + (x.i === 0 ? 15 : 0) + (s % 4 === 0 ? 8 : 0) + ((s * 7) % 11) * 0.5);
    const order = [...pat.keys()].sort((a, b) => score[b] - score[a]);
    const rank = []; order.forEach((s, k) => { rank[s] = k; });
    return rank;
  }
  /** Chord tones ascending from the bass: chord-core in the first octave, extensions above. */
  function ladder(c, base) {
    const core = c.intervals.filter((iv) => iv < 12).map((iv) => mod12(c.root + iv));
    if (c.sus) c.intervals.filter((iv) => iv > 12).forEach((iv) => core.push(mod12(c.root + iv)));
    return T.notesIn(core, base, base + 11).concat(T.notesIn(c.pcs, base + 12, base + 26));
  }

  Sim.register({
    id: "orbital-survey",
    title: "Orbital Survey",
    genre: "Space synth",
    about: "Berlin School sequencer and CS-80 brass over a slow minor-modal orbit: a mutating 16th-note arpeggio whose filter opens over minutes, lydian and chromatic-mediant lifts, celesta constellations, and a modulation by major thirds every four minutes.",
    bpm: 100, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: -2.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 7.5, preDelay: 0.045, lowcut: 280, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 2.6, preDelay: 0.02, lowcut: 300, highcut: 7000 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.4, highcut: 2600 });

      const seq = I.analog(ctx, { volume: -8, wave: "sawtooth", resonance: 5, base: 180, octaves: 2.5, attack: 0.003, decay: 0.16, sustain: 0.2, release: 0.12, filterDecay: 0.14 });
      const brass = I.synthBrass(ctx, { volume: -1, attack: 0.28, swell: 1.1, release: 1.8, base: 240, octaves: 3.1 });
      const vib = ctx.keep(new Tone.Vibrato({ frequency: 4.6, depth: 0.035 }));
      brass.out.connect(vib);
      const pad = I.pad(ctx, { volume: -9, cutoff: 950, attack: 2.6, release: 5, breath: 0.05, detune: 18 });
      const strings = I.strings(ctx, { volume: -10, attack: 1.4, release: 2.6, cutoff: 2000 });
      const sub = I.sub(ctx, { volume: -4, attack: 0.5, release: 1.6 });
      const cel = I.glock(ctx, { volume: -10, celesta: true, decay: 3 });
      const glass = I.glassPad(ctx, { volume: -15, attack: 4, release: 6 });
      const bell = I.bell(ctx, { volume: -13, decay: 8 });
      const kit = I.kit(ctx, { volume: -3, kickNote: 31, preload: ["softKick", "tom"] });

      const sp = I.place(ctx, seq, -0.12, out);
      const bp = I.place(ctx, { out: vib }, 0.08, out);
      const pp = I.place(ctx, pad, 0, out);
      const stp = I.place(ctx, strings, -0.3, out);
      I.place(ctx, sub, 0, out);
      const cp = I.place(ctx, cel, 0.35, out);
      const gp = I.place(ctx, glass, -0.4, out);
      const blp = I.place(ctx, bell, 0.2, out);
      const kitLp = ctx.keep(new Tone.Filter(1600, "lowpass")).connect(out);
      const kp = I.place(ctx, kit, 0.05, kitLp);
      I.send(ctx, sp, echo, -8); I.send(ctx, sp, hall, -18);
      I.send(ctx, bp, hall, -7); I.send(ctx, bp, echo, -20);
      I.send(ctx, pp, hall, -10); I.send(ctx, stp, hall, -9);
      I.send(ctx, cp, echo, -6); I.send(ctx, cp, hall, -6);
      I.send(ctx, gp, hall, -6); I.send(ctx, blp, hall, -3); I.send(ctx, blp, echo, -14);
      I.send(ctx, kp, hall, -5); I.send(ctx, kp, room, -10);

      return {
        seq: {
          layer: "texture", humanize: { timing: 0.0015, vel: 0.03 },
          play: (t, e, d) => {
            seq.filterEnvelope.baseFrequency = e.cut;
            seq.filterEnvelope.octaves = e.acc ? 3.3 : 2.5;
            seq.play(t, e.note, d, e.vel);
          },
        },
        brass: { layer: "melody", humanize: { timing: 0.012, vel: 0.04 }, play: (t, e, d) => brass.play(t, e.note, d, e.vel) },
        celesta: { layer: "melody", humanize: { timing: 0.015, vel: 0.1 }, play: (t, e, d) => cel.play(t, e.note, d, e.vel) },
        pad: { layer: "harmony", humanize: { timing: 0.02 }, play: (t, e, d) => pad.play(t, e.note, d, e.vel) },
        strings: { layer: "harmony", humanize: { timing: 0.02 }, play: (t, e, d) => strings.play(t, e.note, d, e.vel) },
        sub: { layer: "bass", humanize: { timing: 0.002 }, play: (t, e, d) => sub.play(t, e.note, d, e.vel) },
        glass: { layer: "texture", play: (t, e, d) => glass.play(t, e.note, d, e.vel) },
        bell: { layer: "texture", play: (t, e, d) => bell.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.004, vel: 0.08 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }) },
      };
    },

    compose({ cycle, rng: r, state }) {
      // ---- form ----
      if (!state.plan || state.pos >= state.plan.length) {
        state.orbit = state.orbit == null ? 0 : state.orbit + 1;
        state.key = mod12(8 * state.orbit);                // C -> Ab -> E -> C
        state.plan = makePlan(state.orbit, r.fork(7));
        state.pos = 0;
        state.star = makeStar(r.fork(9));
        state.brassOff = ((state.key + 6) % 12) - 6;     // C 0, Ab -4, E +4
        if (!state.pat) { state.home = makePattern(r.fork(3)); state.pat = state.home.map((x) => ({ ...x })); }
        else { // a new key area gets a half-new sequence: one bar keeps its mutated past, the other is fresh
          const fresh = makePattern(r.fork(5)), h = state.orbit % 2 ? 16 : 0;
          for (let s = h; s < h + 16; s++) { state.pat[s] = { ...fresh[s] }; }
          state.home = state.pat.map((x) => ({ ...x }));
        }
      }
      const name = state.plan[state.pos++], sec = SEC[name], key = state.key;
      const progName = sec.prog.length > 1 ? r.pick(sec.prog) : sec.prog[0];
      const harmony = [];
      let bar = 0;
      for (const [off, q, bars] of PROGS[progName]) {
        const [qual, bassOff] = q.split("/");
        const sym = T.NAMES[mod12(key + off)] + qual + (bassOff != null ? "/" + T.NAMES[mod12(key + Number(bassOff))] : "");
        harmony.push({ bar, beat: 0, dur: bars * 4, chord: sym });
        bar += bars;
      }
      const chordAt = T.chordAtFactory(harmony);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const brassOn = !!sec.brass;

      // ---- brass first, so the accompaniment can stay out of its way ----
      const brassNotes = [];
      if (sec.brass) {
        let phrase = PHRASES[sec.brass];
        if (state.orbit % 2 === 1 && (sec.brass === "A" || sec.brass === "Ar")) phrase = PHRASES[sec.brass === "A" ? "Ar" : "A"];
        const peak = name[0] === "P";
        phrase.forEach(([b, d, m], i) => {
          const n = m + state.brassOff;
          const long = d >= 3;
          // swell shaping: long notes lean in; the phrase's last note sighs
          const vel = (long ? 0.72 : 0.58) + (peak ? 0.08 : 0) - (i === phrase.length - 1 ? 0.06 : 0) + r.range(-0.03, 0.03);
          const notes = peak && n - 12 >= 57 ? [n - 12, n] : [n];
          push("brass", b, d * 0.97, notes.length > 1 ? notes : n, vel);
          notes.forEach((x) => brassNotes.push({ b, e: b + d, n: x, held: d >= 1.5 }));
        });
      }
      /** Accompaniment voices must not sit a minor 2nd or 9th from a held brass note. */
      const badFor = (s0, s1) => {
        const held = brassNotes.filter((x) => x.held && x.b < s1 && x.e > s0).map((x) => x.n);
        return (y) => held.some((n) => [1, 13].includes(Math.abs(n - y)));
      };
      /** Move offending voices down an octave, or drop them; then refill to `want` voices from 5th, root, colors. */
      const clear = (v, c, bad, lo, hi, want) => {
        const out = [];
        for (let x of v) {
          if (bad(x) && x - 12 >= lo && !bad(x - 12) && !v.some((z) => Math.abs(z - x + 12) <= 1)) x -= 12;
          if (!bad(x) && !out.includes(x)) out.push(x);
        }
        const fill = [mod12(c.root + 7), c.root, ...c.colors, ...c.guide].filter((pc) => c.pcs.includes(pc));
        for (const pc of fill) {
          if (out.length >= want) break;
          if (out.some((m) => mod12(m) === pc)) continue;
          const mid = out.length ? (Math.min(...out) + Math.max(...out)) / 2 : (lo + hi) / 2;
          const cand = T.notesIn([pc], lo, hi).filter((m) => !bad(m) && out.every((z) => Math.abs(z - m) >= 3) && !(m < 52 && out.some((z) => Math.abs(z - m) < 5)));
          if (cand.length) out.push(cand.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x)));
        }
        return out.length ? out.sort((x, y) => x - y) : v;
      };

      // ---- pads, strings, glass: one gesture per chord ----
      for (const h of harmony) {
        const c = T.chord(h.chord), s0 = h.bar * 4, s1 = s0 + h.dur;
        // under the brass the pad stays below the phrase's top note and thins to three voices; when the
        // phrase sits too low for that, the pad floats above it instead (a halo over a baritone line)
        const over = brassNotes.filter((x) => x.b < s1 && x.e > s0).map((x) => x.n);
        const top = over.length ? Math.max(...over) : 99, halo = over.length > 0 && top - 2 < 63;
        const lo = halo ? top + 2 : brassOn ? 51 : 53, hi = halo ? top + 16 : over.length ? Math.min(74, top - 2) : 74;
        const want = brassOn ? 3 : 4;
        const bad = badFor(s0, s1);
        const v = T.voice(c, brassOn ? { lo, hi, n: 3, prev: state.padV, top: halo ? [lo + 7, hi] : [hi - 6, hi], rng: r, rootless: !c.sus } : { lo, hi: 74, n: 4, prev: state.padV, top: [65, 72], rng: r, rootless: !c.sus });
        // no semitone rubs inside the pad: lift the upper note of a minor-2nd pair an octave
        for (let guard = 0; guard < 4; guard++) {
          const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
          if (i < 0) break;
          const ok = (m) => !v.some((z) => Math.abs(z - m) <= 1);
          if (v[i] + 12 <= hi && ok(v[i] + 12)) v[i] += 12;
          else if (v[i - 1] - 12 >= lo && ok(v[i - 1] - 12)) v[i - 1] -= 12;
          else v.splice(c.guide.includes(mod12(v[i])) ? i - 1 : i, 1); // keep the guide tone
          v.sort((a, b) => a - b);
        }
        state.padV = v;
        push("pad", s0, h.dur - 0.1, clear(v, c, bad, lo, hi, want), sec.pad + r.range(-0.03, 0.03));
        if (sec.strings) {
          const sLo = halo ? lo : 52, shi = halo ? hi - 3 : Math.min(67, hi);
          let sv = T.voice(c, { lo: sLo, hi: shi, n: 2, prev: state.strV, rng: r, rootless: !c.sus });
          if (sv[1] - sv[0] < 3) sv = sv[1] + 12 <= shi + 2 ? [sv[0], sv[1] + 12] : sv[0] - 12 >= 50 ? [sv[0] - 12, sv[1]] : [sv[1], sv[0] + 12];
          sv.sort((a, b) => a - b);
          state.strV = sv;
          const cl = clear(sv, c, bad, Math.min(sLo, 50), shi, 2);
          push("strings", s0, h.dur - 0.25, cl.length > 1 ? cl : cl[0], 0.42 + (name[0] === "P" ? 0.08 : 0));
        }
        if (sec.glass) {
          const pcs = c.colors.length ? c.colors : [mod12(c.root + 7)];
          const g = T.nearest(state.glassLast ?? 81, [pcs[0]], 76, 88);
          state.glassLast = g;
          push("glass", s0 + 0.5, h.dur - 1, g, 0.38);
        }
      }
      // sub pedal: merge repeated basses into long notes
      const subs = [];
      for (const h of harmony) {
        const pc = T.chord(h.chord).bass;
        const last = subs[subs.length - 1];
        if (last && mod12(last.note) === pc) last.dur += h.dur;
        else {
          const m = T.nearest(state.subLast ?? 34, [pc], 28, 40);
          subs.push({ at: h.bar * 4, dur: h.dur, note: m }); state.subLast = m;
        }
      }
      subs.forEach((s) => push("sub", s.at, s.dur - 0.15, s.note, name[0] === "P" ? 0.78 : 0.7));

      // ---- bell: marks a new key area and the peak ----
      if (name === "D1" || sec.bell) {
        push("bell", 0, 8, T.nearest(66, [key], 60, 71), 0.42);
        if (name === "D1" && state.orbit > 0) push("bell", 16, 8, T.nearest(73, [mod12(key + 7)], 67, 79), 0.3);
      }

      // ---- the sequencer ----
      if (sec.seq) {
        const q = sec.seq;
        if (q.mut && !(name === "S1")) mutate(state, r, q.mut + (r.chance(0.25) ? 1 : 0), q.oct);
        const rank = ranks(state.pat);
        const c0 = state.cut ?? 110;
        for (let s = 0; s < 128; s++) {
          const b = s * 0.25, u = b / 32;
          const st = state.pat[s % 32];
          if (!st.g) continue;
          const dens = q.d[0] + (q.d[1] - q.d[0]) * u;
          if (rank[s % 32] >= Math.round(dens * 32)) continue;
          const c = T.chord(sym(b));
          state.seqBase = T.nearest(state.seqBase ?? 48, [c.bass], 40, 55);
          const lad = ladder(c, state.seqBase);
          const li = Math.min(st.i, lad.length - 1);
          let note = lad[li] + (st.o && li < 4 ? 12 : 0);
          if (note > 79) note -= 12;
          const glob = cycle * 32 + b;
          const cut = Math.round((c0 + (q.to - c0) * u) * (1 + 0.2 * Math.sin((2 * Math.PI * glob) / 96)));
          const vs = q.v[0] + (q.v[1] - q.v[0]) * u;
          const nextRest = !state.pat[(s + 1) % 32].g;
          const vel = (st.a ? 0.86 : 0.56 - (st.o ? 0.05 : 0) + (s % 4 === 0 ? 0.05 : 0)) * vs;
          push("seq", b, nextRest ? 0.42 : st.a ? 0.22 : 0.18, note, vel, { cut, acc: st.a, straight: true });
        }
        state.cut = q.to;
      } else state.cut = 110;

      // ---- celesta constellations: one star-map per orbit, re-drawn on each chord ----
      if (sec.star) {
        const span = state.star.offs[state.star.offs.length - 1] + 1.5;
        const slots = r.weighted([[[0, 4], 2], [[1, 5], 2], [[2, 5], 1], [[0, 3], 1], [[3, 6], 1]]).slice(0, sec.star).concat(sec.star > 2 ? [6] : []);
        slots.forEach((b0) => {
          const start = b0 * 4 + r.pick([0, 0.5, 1, 1.5]);
          if (start + span > 32) return;
          const inv = r.chance(0.3);
          let idx = null;
          state.star.offs.forEach((off, j) => {
            const at = start + off, c = T.chord(sym(at));
            const lad = T.notesIn(c.pcs, 74, 98);
            idx = idx == null ? lad.indexOf(T.nearest(state.star.anchor, c.pcs, 74, 98)) : idx + (inv ? -state.star.steps[j] : state.star.steps[j]);
            idx = Math.max(0, Math.min(lad.length - 1, idx));
            if (j > 0 && j < state.star.offs.length - 1 && r.chance(0.1)) return; // a star behind cloud
            push("celesta", at, 2, lad[idx], 0.44 - j * 0.035 + r.range(-0.03, 0.03));
          });
        });
      }

      // ---- restrained pulse ----
      if (sec.drums) {
        const peak = sec.drums === "peak";
        const tom = T.nearest(43, [key], 38, 49);
        const fill = name === "P2" && r.chance(0.6);
        for (let b0 = 0; b0 < 8; b0++) {
          if (peak || b0 % 2 === 0) push("drums", b0 * 4, 0.5, "softKick", peak ? 0.38 : 0.26);
          if (peak && b0 % 2 === 1 && !(fill && b0 === 7)) push("drums", b0 * 4 + 2.5, 0.5, "tom", 0.2, { pitch: tom + 7 });
          if (peak && b0 % 4 === 0) push("drums", b0 * 4, 0.5, "tom", 0.26, { pitch: tom });
        }
        if (fill) [2, 2.5, 3, 3.5].forEach((x, k) => push("drums", 28 + x, 0.5, "tom", 0.16 + k * 0.06, { pitch: tom + [0, 3, 5, 7][k] }));
      }

      const keyName = T.NAMES[key];
      return { events: ev, harmony, section: `Orbit ${state.orbit + 1} · ${keyName} minor · ${sec.label}`, state };
    },
  });

  /** A constellation: an irregular rhythm and a contour in chord-tone steps, fixed for one orbit. */
  function makeStar(r) {
    const shapes = [[0, 2, 1, 2, -3], [0, 3, -1, 2, 1, -2], [0, -2, 3, 2, -1], [0, 1, 3, -2, 2], [0, 4, -1, -1, 2, 1]];
    const rhythms = [[0, 0.75, 1.5, 3, 3.5, 5], [0, 0.5, 2, 2.75, 4, 4.5], [0, 1.25, 1.75, 3, 4.5, 5.25], [0, 1, 1.5, 2.5, 4, 6]];
    const steps = r.pick(shapes), offs = r.pick(rhythms).slice(0, steps.length);
    return { steps, offs, anchor: r.pick([81, 84, 86]) };
  }
})();

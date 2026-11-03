// Departure Lounge: music for a waiting room at four in the morning, after Eno's Music for Airports.
//
// Method: five tape loops of incommensurate lengths (17.3, 21.1, 25.7, 31.9 and 37.7 beats at 54 BPM),
// each carrying one short fixed phrase: a high soft piano (three or four notes), a low soft piano (two
// or three), a wordless alto "aah", a low tenor "aah" (one or two long notes) and a glassy sine tone.
// The phrases are absolute pitches, written once, and simply repeat; chords form by chance where they
// overlap. Nothing is chosen to fit a chord: everything lives inside one seven-note modal set.
//
// Drift: every three to five minutes the set moves one step round the circle of fifths (one pitch class
// moves a semitone: a new sharp is a lydian #4, a new flat a mixolydian b7). Every loop note on that pitch
// class moves with it, so the tapes keep their shapes and only one colour changes. At the moment of the
// drift a distant high bell sounds the new note, a felt-piano low pulse sounds the new centre, and one or
// two of the tapes are swapped for new phrases. The centre is read as lydian, dorian or aeolian.
//
// Unlike Tidepool (pentatonic steps re-rendered over pedals, a tide of voices), these loops are diatonic,
// fixed in pitch and pedal-less; the only low note is the occasional pulse. A later entry gives way to a
// loop note already sounding a semitone (or minor ninth) away, so chance chords stay soft. Reverse-tape
// swells breathe into some piano phrases, and the whole band runs through a slow, slightly worn tape.
// Activity follows two slow sines (about 13 and 21 minutes); at the low point only the pianos remain.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const mod12 = T.mod12;
  const BPB = 4, CYCLE_BARS = 8, CB = BPB * CYCLE_BARS;
  const K_MIN = -3, K_MAX = 1; // collections from Eb major (3 flats) to G major (1 sharp)

  const NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  const SYM = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  /** Pitch classes of the major collection with k sharps (negative = flats). */
  const collection = (k) => T.scale(mod12(7 * k), "ionian");
  /** Centre readings of a collection: [name, root offset from the ionian tonic, chord quality, weight]. */
  const READINGS = [["lydian", 5, "maj13#11", 3], ["dorian", 2, "m13", 1.6], ["aeolian", 9, "m11b13", 1.4]];

  /** Move a pitch from collection k0 into collection k1, one accidental at a time. */
  function remap(m, k0, k1) {
    for (let j = k0; j < k1; j++) if (mod12(m) === mod12(7 * j + 5)) m += 1;     // new sharp: 4th degree up
    for (let j = k0; j > k1; j--) if (mod12(m) === mod12(7 * j + 11)) m -= 1;    // new flat: 7th degree down
    return m;
  }

  // Loop voices. rhythms: [[offset, dur], ...]; n notes per phrase follow the chosen rhythm.
  const VOICES = [
    { id: "pianoHi", period: 17.3, phase: 0, lo: 67, hi: 86, centre: 75, thr: 0, skip: 0.12, vel: 0.46, maxStep: 3,
      rhythms: [[[0, 1.5], [1.5, 1.5], [3, 6]], [[0, 1], [1, 2], [3, 1], [4, 6]], [[0, 2.5], [2.5, 7]], [[0, 0.75], [0.75, 2.25], [3, 1.5], [4.5, 6]], [[0, 1.5], [2, 1.5], [3.5, 7]]] },
    { id: "choirHi", period: 21.1, phase: 5.5, lo: 62, hi: 76, centre: 68, thr: 0.12, skip: 0.15, vel: 0.36, maxStep: 2,
      rhythms: [[[0, 5], [4.5, 7]], [[0, 3.5], [3.5, 3.5], [7, 6]], [[0, 7]], [[0, 2.5], [2.5, 8]]] },
    { id: "pianoLo", period: 25.7, phase: 10, lo: 55, hi: 70, centre: 62, thr: 0.18, skip: 0.12, vel: 0.42, maxStep: 3,
      rhythms: [[[0, 2], [2, 6]], [[0, 1.5], [1.5, 1.5], [3, 6]], [[0, 3], [3, 1], [4, 6]]] },
    { id: "glass", period: 37.7, phase: 17, lo: 74, hi: 88, centre: 81, thr: 0.42, skip: 0.15, vel: 0.3, maxStep: 2,
      rhythms: [[[0, 9]], [[0, 6], [5, 8]]] },
    { id: "choirLo", period: 31.9, phase: 24, lo: 50, hi: 62, centre: 56, thr: 0.55, skip: 0.12, vel: 0.34, maxStep: 2,
      rhythms: [[[0, 10]], [[0, 6], [6, 8]]] },
  ];
  const PIANO_RING = 4.5; // how long a soft-piano note is heard (beats), whatever its written length

  // ---------- deterministic hashing: loop decisions must not depend on which cycle computes them ----------
  function mix(...xs) {
    let h = 2166136261 >>> 0;
    for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; }
    return h >>> 0;
  }
  const hr = (...xs) => T.rng(mix(...xs));

  /** Write a phrase for voice v in collection k around the centre reading (root pc, reading index). */
  function writePhrase(v, k, root, reading, r) {
    const pcs = collection(k);
    const rhythm = r.pick(v.rhythms);
    // where the last note may rest: the 3rd, 5th and 9th of the reading (the root only in the low choir,
    // the lydian #11 now and then); never the 4th, 6th or 7th
    const third = pcs.includes(mod12(root + 4)) ? mod12(root + 4) : mod12(root + 3);
    const rest = [[third, 3], [mod12(root + 7), 2], [mod12(root + 2), 3], [root, v.id === "choirLo" ? 3 : 0.3]];
    if (reading === 0) rest.push([mod12(root + 6), 0.8]);
    let m = T.nearest(v.centre + r.int(-4, 4), pcs, v.lo, v.hi);
    const notes = [];
    rhythm.forEach(([off, dur], i) => {
      if (i > 0) {
        let next = m;
        for (let tries = 0; tries < 8 && (next === m || next < v.lo || next > v.hi); tries++) {
          const size = Math.min(v.maxStep, r.weighted([[1, 5], [2, 3], [3, 1.5], [4, 0.5]]));
          next = T.step(m, size * (r.chance(m > v.centre ? 0.65 : 0.35) ? -1 : 1), pcs);
        }
        m = Math.max(v.lo, Math.min(v.hi, next));
      }
      if (i === rhythm.length - 1) {
        const prev = notes.length ? notes[notes.length - 1].note : m;
        const lo = Math.max(v.lo, prev - 5), hi = Math.min(v.hi, prev + 5);
        const cands = [];
        for (const [pc, w] of rest) for (const x of T.notesIn([pc], lo, hi)) if (x !== prev || !notes.length) cands.push([x, w]);
        if (cands.length) m = r.weighted(cands);
      }
      notes.push({ off, dur, note: m });
    });
    return { k, notes };
  }

  Sim.register({
    id: "departure-lounge",
    title: "Departure Lounge",
    genre: "Ambient (Eno)",
    about: "Five tape loops of incommensurate lengths (soft pianos, a wordless choir, a glass tone) repeat fixed phrases inside one modal set, so chords form by chance; every few minutes one note of the set drifts a semitone, marked by a distant bell and a low pulse.",
    bpm: 54, beatsPerBar: BPB, cycleBars: CYCLE_BARS, swing: 0.5, gainDb: 0,
    situations: ["sleep", "presentation", "work"],
    energy: 0.08,

    instruments(ctx) {
      const { I, out } = ctx;
      // the whole band runs through a slow, slightly worn tape before the room
      const bus = ctx.keep(new Tone.Gain(1)).connect(out);
      const tape = I.tape(ctx, bus, { wow: 0.18, wowRate: 0.3, flutter: 0.02, cutoff: 7000, drive: 0.04 });
      const hall = I.reverb(ctx, bus, { decay: 11, preDelay: 0.09, lowcut: 200, highcut: 5000 });
      const echo = I.delay(ctx, hall, { time: 0.92, feedback: 0.42, highcut: 2000 }); // under 1 s: the default maxDelay of a FeedbackDelay

      const pianoHi = I.softPiano(ctx, { volume: -1, decay: 6, release: 4, cutoff: 2300 });
      const pianoLo = I.softPiano(ctx, { volume: -3, decay: 6, release: 4, cutoff: 1800 });
      const choirHi = I.choir(ctx, { volume: -7, vowel: "a", attack: 1.8, release: 3.5 });
      const choirLo = I.choir(ctx, { volume: -8, vowel: "o", attack: 2.2, release: 4 });
      const glass = I.glassPad(ctx, { volume: -11, attack: 2.2, release: 5, harmonicity: 3 });
      const pulse = I.softPiano(ctx, { volume: -6, decay: 7, release: 5, cutoff: 900 });
      const bell = I.bell(ctx, { volume: -17, decay: 8 });

      const ph = I.place(ctx, pianoHi, -0.3, tape); I.send(ctx, ph, hall, -5); I.send(ctx, ph, echo, -16);
      const pl = I.place(ctx, pianoLo, 0.3, tape); I.send(ctx, pl, hall, -6);
      const ch = I.place(ctx, choirHi, 0.15, tape); I.send(ctx, ch, hall, -3);
      const cl = I.place(ctx, choirLo, -0.15, tape); I.send(ctx, cl, hall, -4);
      const gp = I.place(ctx, glass, 0.45, tape); I.send(ctx, gp, hall, -4);
      const pp = I.place(ctx, pulse, 0, tape); I.send(ctx, pp, hall, -10);
      const bp = I.place(ctx, bell, -0.4, tape); I.send(ctx, bp, hall, 0); I.send(ctx, bp, echo, -8);

      // reverse-tape swells: a sine-ish tone that fades up and is cut off dead (two voices, round robin)
      const swOut = ctx.keep(new Tone.Gain(Math.pow(10, -21 / 20)));
      const swPan = ctx.keep(new Tone.Panner(0.1));
      swOut.connect(swPan); swPan.connect(tape); I.send(ctx, swPan, hall, -6);
      const swells = [0, 1].map(() => {
        const osc = ctx.keep(new Tone.Oscillator({ type: "custom", partials: [1, 0.35, 0.12, 0.05], frequency: 220 }).start());
        const lp = ctx.keep(new Tone.Filter({ frequency: 1600, type: "lowpass", rolloff: -12 }));
        const g = ctx.keep(new Tone.Gain(0));
        osc.connect(lp); lp.connect(g); g.connect(swOut);
        return { osc, g, clock: I.monotonic(g) };
      });
      let si = 0;
      const swell = (t, e, d) => {
        const w = swells[si++ % swells.length], f = T.hz(e.note), v = e.vel;
        if (!Number.isFinite(f) || !Number.isFinite(v) || !(d > 0.1)) return;
        const t0 = w.clock(t);
        w.osc.frequency.setValueAtTime(f, t0);
        w.g.gain.cancelScheduledValues(t0);
        w.g.gain.setValueAtTime(0, t0);
        w.g.gain.linearRampToValueAtTime(v * 0.25, t0 + d * 0.6);
        w.g.gain.linearRampToValueAtTime(v, t0 + d);
        w.g.gain.linearRampToValueAtTime(0, t0 + d + 0.07);
      };

      const loop = { timing: 0.015, vel: 0.06 };
      return {
        pianoHi: { layer: "melody", play: (t, e, d) => pianoHi.play(t, e.note, d, e.vel), humanize: loop },
        choirHi: { layer: "melody", play: (t, e, d) => choirHi.play(t, e.note, d, e.vel), humanize: loop },
        pianoLo: { layer: "harmony", play: (t, e, d) => pianoLo.play(t, e.note, d, e.vel), humanize: loop },
        choirLo: { layer: "harmony", play: (t, e, d) => choirLo.play(t, e.note, d, e.vel), humanize: loop },
        glass: { layer: "texture", play: (t, e, d) => glass.play(t, e.note, d, e.vel), humanize: loop },
        swell: { layer: "texture", play: swell, humanize: { timing: 0, vel: 0 } },
        bell: { layer: "texture", play: (t, e, d) => bell.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.05 } },
        pulse: { layer: "bass", play: (t, e, d) => pulse.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const B = cycle * CB, E = B + CB;
      let drift = null;
      if (cycle === 0 || state.seed == null) {
        state.seed = Math.floor(r() * 2 ** 31);
        state.phi1 = r.range(-0.6, 0.6); state.phi2 = r.range(0, 2 * Math.PI);
        state.k = r.pick([-2, -1, 0]);
        state.reading = 0; // open in lydian
        state.left = r.int(5, 7);
        state.sets = [{ from: -Infinity, k: state.k }];
        const root = mod12(7 * state.k + READINGS[0][1]);
        state.versions = VOICES.map((v, vi) => [{ from: -Infinity, ...writePhrase(v, state.k, root, 0, hr(state.seed, vi, 1)) }]);
        state.nextK = null;
      } else if (state.left <= 0) {
        // drift one accidental; bounce off the ends of the range
        const old = state.k;
        const k = state.nextK;
        state.k = k;
        const up = k > old;
        // a new sharp is best heard as the lydian #4 of the old tonic (the new IV); a new flat as dorian or aeolian
        state.reading = up ? r.weighted([[0, 4], [1, 1], [2, 1]]) : r.weighted([[0, 1], [1, 2], [2, 2]]);
        state.left = r.int(5, 7);
        state.sets.push({ from: B, k });
        const root = mod12(7 * k + READINGS[state.reading][1]);
        // swap one or two tapes (never the same two as last time if possible)
        const order = r.shuffle(VOICES.map((_, i) => i)).filter((i) => i !== state.lastSwap);
        const swap = order.slice(0, r.chance(0.45) ? 2 : 1);
        swap.forEach((vi) => state.versions[vi].push({ from: B, ...writePhrase(VOICES[vi], k, root, state.reading, hr(state.seed, vi, cycle, 5)) }));
        state.lastSwap = swap[0];
        drift = { old, k, pc: up ? mod12(7 * old + 6) : mod12(7 * old + 10) };
        state.nextK = null;
      }
      if (state.nextK == null) { // decide the next drift now, so the cycle before it can make room
        const k = state.k;
        state.nextK = k <= K_MIN ? k + 1 : k >= K_MAX ? k - 1 : k + (r.chance(0.5) ? 1 : -1);
      }
      state.left--;
      const lastCycleOfSet = state.left <= 0;
      // prune history older than the longest look-back
      state.sets = state.sets.filter((s, i, a) => i === a.length - 1 || a[i + 1].from > B - 48);
      state.versions.forEach((vs, vi) => { state.versions[vi] = vs.filter((s, i, a) => i === a.length - 1 || a[i + 1].from > B - 80); });

      const kAt = (t) => { let k = state.sets[0].k; for (const s of state.sets) if (s.from <= t + 1e-6) k = s.k; return k; };
      const versionAt = (vi, t) => { const vs = state.versions[vi]; let v = vs[0]; for (const s of vs) if (s.from <= t + 1e-6) v = s; return v; };
      const activity = (t) => {
        const base = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / 700 + state.phi1) + 0.15 * Math.sin((2 * Math.PI * t) / 1130 + state.phi2);
        return Math.max(0, Math.min(1, base, 0.04 + t / 170));
      };

      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs - B, BPB);
        ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra });
      };

      // ---- the loops: every note from instances that can sound in [B - 16, E) ----
      const all = [];
      const playing = new Set();
      VOICES.forEach((v, vi) => {
        const kLo = Math.max(0, Math.ceil((B - 32 - v.phase) / v.period)), kHi = Math.floor((E - v.phase) / v.period);
        for (let n = kLo; n <= kHi; n++) {
          const s0 = v.phase + n * v.period, h = hr(state.seed, vi, n, 99);
          const act = activity(s0);
          const always = vi === 0 && (n === 0 || act < 0.25); // the high piano opens and never leaves at the low point
          if (!always && (act < v.thr || h() < v.skip)) continue;
          const ver = versionAt(vi, s0);
          const amp = 0.78 + 0.3 * act;
          ver.notes.forEach((x, i) => {
            const t = s0 + x.off;
            const note = remap(x.note, ver.k, kAt(t));
            const accent = i === 0 ? 1 : i === ver.notes.length - 1 ? 0.88 : 0.93;
            all.push({ vi, track: v.id, t, dur: x.dur, note, ring: v.id.startsWith("piano") ? Math.min(x.dur, PIANO_RING) : x.dur, vel: v.vel * amp * accent * (0.94 + 0.12 * h()), first: i === 0, inst: n });
          });
        }
      });
      all.sort((a, b) => a.t - b.t || a.vi - b.vi);
      // a later entry gives way to a note already sounding a semitone or minor ninth away (other voices only)
      const keep = all.filter((x) => !all.some((y) => y.vi !== x.vi && (y.t < x.t || (y.t === x.t && y.vi < x.vi)) && y.t + y.ring > x.t + 0.25
        && Math.abs(y.note - x.note) < 25 && (Math.abs(y.note - x.note) % 12 === 1 || Math.abs(y.note - x.note) % 12 === 11)));
      // before a drift, notes on the pitch class that is about to move must not ring across the boundary
      const movingPc = lastCycleOfSet ? (state.nextK > state.k ? mod12(7 * state.k + 5) : mod12(7 * state.k + 11)) : null;
      keep.forEach((x) => {
        if (x.t < B || x.t >= E) return;
        let dur = x.dur;
        if (movingPc != null && mod12(x.note) === movingPc && x.t + dur > E - 0.5) {
          if (x.t > E - 2) return; // too late to be heard properly: leave it out
          dur = E - 0.5 - x.t;
        }
        playing.add(x.track);
        push(x.track, x.t, dur, x.note, x.vel);
      });

      // ---- reverse-tape swells into some low-piano and high-piano phrase starts ----
      keep.filter((x) => x.first && (x.track === "pianoLo" || x.track === "pianoHi") && x.t - 3 >= B && x.t < E).forEach((x) => {
        const h = hr(state.seed, x.vi, x.inst, 31);
        if (h() < (x.track === "pianoLo" ? 0.35 : 0.18)) push("swell", x.t - 3, 3, x.note - 12, 0.5 + 0.2 * h());
      });

      // ---- the drift: a distant bell sounds the new note, a low pulse sounds the new centre ----
      const k = state.k, reading = READINGS[state.reading], root = mod12(7 * k + reading[1]);
      const rootLow = T.nearest(43, [root], 38, 49);
      if (drift) {
        push("bell", B + 0.5, 10, T.nearest(86, [drift.pc], 82, 93), 0.32);
        push("bell", B + 9, 10, T.nearest(86, [drift.pc], 82, 93) - 12, 0.2);
        push("pulse", B, 12, rootLow, 0.36);
        push("pulse", B + 6, 10, rootLow + 7 + 12 * (rootLow + 19 < 64 ? 1 : 0), 0.2);
      } else if (cycle === 0) {
        push("pulse", B + 2, 12, rootLow, 0.3);
      } else if (hr(state.seed, cycle, 77)() < 0.4 * (1 - activity(B) * 0.5)) {
        // between drifts the ground is only implied: an occasional single low note, very soft
        push("pulse", B + r.pick([4, 10, 18]), 10, rootLow, 0.22);
      }

      const sym = SYM[root] + reading[2];
      const voices = VOICES.filter((v) => playing.has(v.id)).map((v) => ({ pianoHi: "piano", pianoLo: "low piano", choirHi: "alto aah", choirLo: "tenor aah", glass: "glass" }[v.id]));
      const head = `${NAMES[root]} ${reading[0]}`;
      const label = drift ? `${head} · drift: ${NAMES[drift.pc]} enters · ${voices.join(", ")}` : `${head} · ${voices.length ? voices.join(", ") : "silence"}`;
      return { events: ev, harmony: [{ bar: 0, beat: 0, dur: CB, chord: sym }], section: label, state };
    },
  });
})();

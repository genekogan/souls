// Petri Dish: generative ambient for the cell stage, seen under a microscope. After Budd and Eno's
// "The Plateaux of Mirror", with a little Satie: a soft piano improvising slowly over shifting harmony.
//
// Harmony: a walk through a pool of nineteen rich, ambiguous chords (maj9, maj7#11, m9, m11, 9sus4, add9
// and slash chords) centred on A. The next chord is chosen by voice-leading closeness (average pitch-class
// motion and common tones) and a gentle bass motion, never by function. The walk goes on "voyages": it
// drifts toward a target region on the line of fifths (the flat side around F and D minor, the middle
// around C and G, or the bright side around E and C#m), then gravity pulls it home to Amaj9. A
// homecoming is answered by the pianist's theme.
//
// The pianist: the left hand plays wide, open, rolled voicings (a bass note, a fifth or sixth or tenth
// above it, then guide tones and colours around middle C); in slow-waltz voyages it plays a Satie-like
// bass-then-chord in 3/4. The right hand plays sparse melodic fragments. Its memory holds a theme and a
// few favourite motifs (stored as scale steps and rhythms), recalled with variation (inverted, augmented,
// truncated, extended, displaced, re-pitched), or answered by a sequence of the phrase just played. It also
// has favourite intervals: every interval it plays is reinforced, so its improvised language crystallises.
// Long notes and phrase endings land on chord tones (colours first); a long note that starts just before
// a change belongs to the next chord (an anticipation, kept only if it also agrees with the outgoing chord);
// notes overlap like a half-pedal after leaps (never after a semitone) and are pedalled off at each change.
//
// Echoes ("Discreet Music"): some sustained right-hand notes are also played into two long, darkening
// feedback loops (4.6 s and 7.3 s, panned apart, incommensurate with the beat), so a few pitches
// linger and pile up. A note is fed only if it is compatible with every chord planned for the next ~19 s.
//
// Cells: tiny high glass blips (FM, inharmonic) in chord tones and a soft filtered-noise breath.
// Density breathes with two slow sines (about 6 and 9.6 minutes): phrase rate, rests, bass notes,
// echoes and blips all follow it.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const mod12 = T.mod12;
  const BPB = 3, CYCLE_BARS = 8, CB = BPB * CYCLE_BARS;
  const BPM = 56, SPB = 60 / BPM;
  const ECHO_SECONDS = [4.6, 7.3];
  const ECHO_SPAN = Math.ceil(19 / SPB); // beats an echo stays audible (about four repeats)
  const RH_LO = 68, RH_HI = 88; // G#4..E6
  const db = (x) => Math.pow(10, x / 20);

  // ---------- the chord pool and the walk ----------
  const HOME = "Amaj9";
  const POOL = ["Amaj9", "Aadd9/C#", "Dmaj7#11", "Dadd9/F#", "F#m9", "F#m11/A", "C#m11", "Bm11", "B9sus4", "E9sus4",
    "Emaj9/G#", "Em9", "Am9", "Gmaj7#11", "Cmaj9", "Fmaj9/A", "Fmaj7#11", "Dm9", "Bbmaj7#11"];
  const FIFTH = (pc) => { const x = (mod12(pc - 9) * 7) % 12; return x > 6 ? x - 12 : x; }; // A=0, E=1, D=-1 ...
  const cdist = (a, b) => { const d = mod12(a - b); return Math.min(d, 12 - d); };
  const INFO = {};
  POOL.forEach((s) => { const c = T.chord(s); INFO[s] = { c, mean: c.pcs.reduce((a, p) => a + FIFTH(p), 0) / c.pcs.length }; });
  const HOME_MEAN = INFO[HOME].mean;
  /** Average pitch-class motion between two chords (each tone to its nearest partner, both ways). */
  function vlDist(A, B) {
    let s = 0;
    B.forEach((b) => (s += Math.min(...A.map((a) => cdist(a, b)))));
    A.forEach((a) => (s += Math.min(...B.map((b) => cdist(a, b)))));
    return s / (A.length + B.length);
  }
  const BASS_COST = [0.15, 0, 0, 0.1, 0.1, 0.25, 0.9]; // by bass motion in semitones (pedal, steps, thirds, fourths, tritone)
  const TARGETS = [[-1.3, 3], [0.2, 2.5], [3.3, 1.5]]; // voyage regions on the line of fifths: flat side, middle, bright side

  function newVoyage(state, r) {
    const v = state.voyage || {};
    let target = r.weighted(TARGETS.filter((t) => t[0] !== v.target));
    const mode = state.voyages === 0 ? "plateau" : v.mode === "waltz" ? "plateau" : r.chance(0.4) ? "waltz" : "plateau";
    state.voyage = { target, out: r.int(5, 9), mode };
    state.voyages++;
    state.sinceHome = 0;
  }

  function nextChord(state, r) {
    const prev = state.walkPrev, P = INFO[prev], v = state.voyage;
    const returning = state.sinceHome >= v.out;
    const pairs = [];
    for (const s of POOL) {
      if (s === prev) continue;
      const Q = INFO[s];
      const ct = Q.c.pcs.filter((p) => P.c.pcs.includes(p)).length;
      let cost = 3.2 * vlDist(P.c.pcs, Q.c.pcs) - 0.22 * Math.min(ct, 5) + (ct < 3 ? 0.8 : 0);
      cost += BASS_COST[cdist(P.c.bass, Q.c.bass)];
      const ri = state.recent.lastIndexOf(s);
      if (ri >= 0) cost += ri >= state.recent.length - 3 ? 2.2 : 0.7;
      if (!returning) {
        cost += 0.45 * Math.abs(Q.mean - v.target);
        if (s === HOME) cost += 2.5; // not home yet
      } else {
        const pull = 0.3 + 0.14 * (state.sinceHome - v.out);
        cost += pull * Math.abs(Q.mean - HOME_MEAN);
        if (s === HOME) cost -= 0.4 + 0.3 * (state.sinceHome - v.out);
      }
      pairs.push([s, Math.exp(-1.7 * cost)]);
    }
    return r.weighted(pairs);
  }

  /** Append chords to the plan until it reaches absolute beat `until`. */
  function extendPlan(state, until, r) {
    while (state.planEnd < until) {
      let sym, home = false;
      if (!state.plan.length) sym = HOME;
      else {
        sym = nextChord(state, r);
        state.sinceHome++;
        if (sym === HOME) { home = true; newVoyage(state, r); }
      }
      const b = breathAt(state, state.planEnd);
      const bars = state.plan.length === 0 ? 4 : home ? r.weighted([[3, 1], [4, 2]]) : r.weighted([[2, 0.6 + b], [3, 1.6], [4, 1.5 - b]]);
      const far = Math.abs(INFO[sym].mean - HOME_MEAN) > 1.6;
      const where = state.plan.length === 0 ? "first light" : home ? "home" : state.sinceHome > state.voyage.out ? "returning" : far ? "far field" : state.sinceHome <= 2 ? "leaving" : "near field";
      const entry = { start: state.planEnd, dur: bars * BPB, sym, mode: state.voyage.mode, home, where, opening: state.plan.length === 0, sung: false };
      state.plan.push(entry);
      state.planEnd += entry.dur;
      state.walkPrev = sym;
      state.recent.push(sym);
      if (state.recent.length > 8) state.recent.shift();
    }
  }
  function entryAt(state, t) {
    for (let i = state.plan.length - 1; i >= 0; i--) if (state.plan[i].start <= t + 1e-6) return state.plan[i];
    return state.plan[0];
  }

  /** Density, 0..1: two slow sines, with an opening ramp. */
  function breathAt(state, t) {
    const b = 0.52 + 0.3 * Math.sin((2 * Math.PI * t) / 336 + state.phi1) + 0.2 * Math.sin((2 * Math.PI * t) / 540 + state.phi2);
    return Math.max(0, Math.min(1, b, 0.12 + t / 180));
  }

  // ---------- the pianist's memory ----------
  // Motifs: rhythm [[offset, duration]...] in beats, steps = scale steps from the previous note.
  const SEEDS = [
    { rhythm: [[0, 1], [1, 1.5], [2.5, 0.5], [3, 3]], steps: [0, 3, -1, -1] },        // rise a fourth, sink back
    { rhythm: [[0, 0.5], [0.5, 2.5], [3, 1], [4, 3]], steps: [0, 1, -3, 1] },         // turn, fall, lean up
    { rhythm: [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 3]], steps: [0, 2, -1, -1, -2] },
    { rhythm: [[0, 1], [1, 1], [2, 1], [3, 3]], steps: [0, -1, -1, 4] },              // descend, then open upward
    { rhythm: [[0, 2], [2, 1], [3, 3]], steps: [0, -2, 4] },
    { rhythm: [[0, 0.5], [0.5, 0.5], [1, 3]], steps: [0, 1, 2] },                     // a small rising sigh
    { rhythm: [[0, 3], [3, 3]], steps: [0, -5] },                                     // a falling sixth
  ];
  const IV_BASE = { 1: 3, "-1": 3.4, 2: 2, "-2": 2.4, 3: 1.4, "-3": 1, 4: 0.7, "-4": 0.8, 5: 0.3, "-5": 0.5 };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const r2 = (x) => Math.round(x * 2) / 2;

  /** Variation of a remembered motif. */
  function vary(m, r, op) {
    const s = clone(m);
    op = op || r.weighted([["plain", 2], ["invert", 1.2], ["augment", 1], ["truncate", 1.2], ["extend", 1.3], ["displace", 1]]);
    const n = s.rhythm.length;
    if (op === "invert") s.steps = s.steps.map((x) => -x);
    else if (op === "augment") {
      let t = 0;
      s.rhythm = s.rhythm.map(([, d], i) => { const nd = i === n - 1 ? d : Math.max(1, r2(d * 1.5)); const o = [t, nd]; t += nd; return o; });
    } else if (op === "truncate" && n > 2) {
      const k = r.int(2, n - 1);
      s.rhythm = s.rhythm.slice(0, k); s.steps = s.steps.slice(0, k);
      s.rhythm[k - 1][1] = Math.max(s.rhythm[k - 1][1], r.pick([2, 3]));
    } else if (op === "extend") {
      const last = s.rhythm[n - 1], d = r.pick([1, 1.5]);
      s.rhythm[n - 1] = [last[0], d];
      s.rhythm.push([last[0] + d, r.pick([2, 3])]);
      s.steps.push(r.weighted([[-1, 3], [1, 2], [-2, 1.5], [2, 1]]));
    } else if (op === "displace") s.shift = r.pick([0.5, 1]);
    s.op = op;
    return s;
  }

  /** A fresh phrase built from the pianist's favourite intervals. */
  function improvise(state, r, b) {
    const n = r.weighted([[2, 1], [3, 2.2], [4, 2.4], [5, 1 + b], [6, 0.8 * b]]);
    const rhythm = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const d = last ? r.pick([2, 3, 3, 4]) : r.weighted([[0.5, 0.8 + b], [1, 3], [1.5, 1.6], [2, 1]]);
      rhythm.push([t, d]); t += d;
    }
    // intervals: weighted by memory, with contour sense (gap-fill after a leap, drift back toward centre)
    const steps = [0];
    let pos = 0;
    for (let i = 1; i < n; i++) {
      const prevStep = steps[i - 1];
      const pairs = Object.entries(state.ivw).map(([k, w]) => {
        const s = +k;
        let x = w;
        if (Math.abs(prevStep) >= 3 && Math.sign(s) === Math.sign(prevStep)) x *= 0.2; // fill the gap after a leap
        if (Math.abs(prevStep) >= 3 && Math.sign(s) !== Math.sign(prevStep) && Math.abs(s) <= 2) x *= 1.8;
        if (pos + s > 5 || pos + s < -5) x *= 0.15;
        if (i === n - 1 && Math.abs(s) >= 4) x *= 0.5; // land by a smaller interval
        return [s, x];
      });
      const s = r.weighted(pairs);
      steps.push(s); pos += s;
    }
    return { rhythm, steps, op: "new" };
  }

  // ---------- voicing ----------
  /** Wide open left-hand voicing: bass, an open interval above it, then guide tones and colours. */
  function lhVoicing(sym, state, r) {
    const c = T.chord(sym);
    const low = T.notesIn([c.bass], 38, 49)[0];
    const pref = (iv) => (iv === 7 ? 0 : iv === 8 || iv === 9 ? 1 : iv === 15 || iv === 16 ? 1.5 : 3);
    let second = null, bestS = Infinity;
    for (const m of T.notesIn(c.pcs.filter((p) => p !== c.bass), low + 7, Math.min(low + 16, 60))) {
      const s = pref(m - low) + (mod12(m) === c.root && c.root !== c.bass ? -0.4 : 0);
      if (s < bestS) { bestS = s; second = m; }
    }
    if (second == null) second = low + 12;
    const used = new Set([mod12(low), mod12(second)]);
    const fifth = c.intervals.find((i) => i === 7 || i === 6 || i === 8);
    // candidate tones in priority order; the guide tones must be present, colours are chosen by spacing
    const all = [...new Set(c.guide.concat(c.colors).concat(fifth != null ? [mod12(c.root + fifth)] : []))].filter((p) => !used.has(p));
    if (all.length < 2 && !used.has(c.root)) all.push(c.root);
    const must = c.guide.filter((p) => !used.has(p));
    const size = Math.min(3, all.length);
    const subsets = [];
    const pickSet = (i, acc) => {
      if (acc.length === size) { if (must.every((p) => acc.includes(p))) subsets.push(acc.slice()); return; }
      for (let k = i; k < all.length; k++) { acc.push(all[k]); pickSet(k + 1, acc); acc.pop(); }
    };
    pickSet(0, []);
    const lo = Math.max(second + 3, 52), hi = Math.max(72, lo + 12);
    let best = null, bestScore = Infinity;
    const prev = state.lhUpper;
    for (const tones of subsets) {
      const dropped = all.filter((p) => !tones.includes(p)).reduce((a, p) => a + (c.colors.includes(p) ? 0.9 : 0.3), 0);
      const opts = tones.map((p) => T.notesIn([p], lo, hi));
      const rec = (i, acc) => {
        if (i === opts.length) {
          const v = acc.slice().sort((a, b) => a - b);
          let s = dropped;
          const stack = [second].concat(v);
          for (let k = 1; k < stack.length; k++) {
            const g = stack[k] - stack[k - 1];
            if (g === 0) s += 50;
            if (g === 1) s += 9;
            if (g === 2 && stack[k - 1] < 62) s += 2.5;
            if (g < 3 && stack[k - 1] < 57) s += 4;
            if (g > 9) s += (g - 9) * 0.7;
          }
          const top = v[v.length - 1], span = top - v[0];
          if (top > 68) s += (top - 68) * 1.5; // leave the space above G#4 to the right hand
          if (top < 62) s += (62 - top) * 0.8;
          if (span < 8) s += (8 - span) * 0.5; // open, not clustered
          if (prev) { const m = Math.min(prev.length, v.length); for (let k = 0; k < m; k++) s += Math.abs(v[v.length - 1 - k] - prev[prev.length - 1 - k]) * 0.3; }
          s += r() * 0.8;
          if (s < bestScore) { bestScore = s; best = v; }
          return;
        }
        for (const m of opts[i]) { acc.push(m); rec(i + 1, acc); acc.pop(); }
      };
      rec(0, []);
    }
    if (!best) best = [second + 12];
    state.lhUpper = best;
    return { low, second, upper: best };
  }

  /** Pitch classes the right hand may land on, best first: colours, guide tones, fifth, root. */
  function landing(c) {
    const fifth = c.intervals.find((i) => i === 7 || i === 6 || i === 8);
    return [...new Set(c.colors.concat(c.guide).concat(fifth != null ? [mod12(c.root + fifth)] : []).concat([c.root]))];
  }
  /** Nearest landing tone to m (skipping `avoid`), mildly preferring colours and guide tones. */
  function snap(m, c, avoid, dir) {
    const L = landing(c);
    let best = m, bs = Infinity;
    for (let x = m - 5; x <= m + 5; x++) {
      const i = L.indexOf(mod12(x));
      if (i < 0 || x === avoid || x < RH_LO || x > RH_HI) continue;
      let s = Math.abs(x - m) + i * 0.15 + (mod12(x) === c.root ? 0.8 : 0);
      if (dir && Math.sign(x - m) === -dir && x !== m) s += 0.6; // keep the motion's direction
      if (s < bs) { bs = s; best = x; }
    }
    return best;
  }
  /** 2 = chord tone, 1 = consonant scale tone, 0 = clash. */
  function compat(pc, c) {
    if (c.pcs.includes(pc)) return 2;
    if (c.scale.includes(pc) && !c.pcs.includes(mod12(pc - 1)) && !c.pcs.includes(mod12(pc + 1))) return 1;
    return 0;
  }

  Sim.register({
    id: "petri-dish",
    title: "Petri Dish",
    genre: "Generative ambient",
    about: "A soft piano improvises slowly in 3/4 over a voice-led walk of maj7♯11, m9, sus and slash chords around A, with a memory for its own motifs. Some notes feed long tape-like echo loops that linger and pile up; glass blips and a noise breath drift past like cells.",
    bpm: BPM, beatsPerBar: BPB, cycleBars: CYCLE_BARS, swing: 0.5, gainDb: 8,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 6.5, preDelay: 0.045, lowcut: 200, highcut: 5500 });

      // Discreet-music echo: two long feedback loops, each repeat a little darker than the last
      const echoBus = ctx.keep(new Tone.Gain(db(-4))).connect(out);
      I.send(ctx, echoBus, hall, -4);
      const wow = ctx.keep(new Tone.Vibrato({ frequency: 0.27, depth: 0.05 }));
      ECHO_SECONDS.forEach((sec, i) => {
        const d = ctx.keep(new Tone.Delay(sec, sec + 0.5));
        const lp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "lowpass", rolloff: -12 }));
        const hp = ctx.keep(new Tone.Filter({ frequency: 260, type: "highpass" }));
        const fb = ctx.keep(new Tone.Gain(i === 0 ? 0.6 : 0.55));
        const pan = ctx.keep(new Tone.Panner(i === 0 ? -0.55 : 0.55));
        wow.connect(d); d.connect(lp); lp.connect(hp); hp.connect(fb); fb.connect(d);
        hp.connect(pan); pan.connect(echoBus);
      });

      const rh = I.softPiano(ctx, { volume: 0, decay: 7, release: 2.4, cutoff: 2500 });
      const lh = I.softPiano(ctx, { volume: -7.5, decay: 8, release: 2.6, cutoff: 1500 });
      const echo = I.softPiano(ctx, { volume: -3, decay: 6, release: 2, cutoff: 1900 });
      const bassP = I.softPiano(ctx, { volume: -4, decay: 9, release: 3, cutoff: 650 });
      const sub = I.sub(ctx, { volume: -17, attack: 0.12, release: 2.5 });
      echo.out.connect(wow);

      const rp = I.place(ctx, rh, 0.12, out); I.send(ctx, rp, hall, -5);
      const lp = I.place(ctx, lh, -0.16, out); I.send(ctx, lp, hall, -6);
      const bp = I.place(ctx, bassP, -0.04, out); I.send(ctx, bp, hall, -14);
      I.place(ctx, sub, 0, out);

      // cells: tiny glass blips (inharmonic FM) from two sides of the dish
      const blipBus = ctx.keep(new Tone.Gain(db(-9))).connect(out);
      I.send(ctx, blipBus, hall, 2);
      const blips = [-0.6, 0.6].map((p) => {
        const pan = ctx.keep(new Tone.Panner(p)).connect(blipBus);
        return ctx.keep(new Tone.PolySynth({
          voice: Tone.FMSynth, maxPolyphony: 8,
          options: {
            harmonicity: 2.76, modulationIndex: 0.9, oscillator: { type: "sine" }, modulation: { type: "sine" },
            envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.25 },
            modulationEnvelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
          },
        })).connect(pan);
      });

      // breath: soft band-passed noise swells, two alternating voices
      const brBus = ctx.keep(new Tone.Gain(1)).connect(out);
      I.send(ctx, brBus, hall, -4);
      const breaths = [0, 1].map((i) => {
        const noise = ctx.keep(new Tone.Noise({ type: "pink" }).start());
        const bpf = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 1500, Q: 1.8 }));
        const g = ctx.keep(new Tone.Gain(0));
        const pan = ctx.keep(new Tone.Panner(i ? 0.35 : -0.35));
        noise.connect(bpf); bpf.connect(g); g.connect(pan); pan.connect(brBus);
        return { bpf, g };
      });
      let bi = 0;
      const breathe = (t, e, d) => {
        const w = breaths[bi++ % breaths.length];
        w.g.gain.cancelScheduledValues(t);
        w.g.gain.setValueAtTime(0, t);
        w.g.gain.linearRampToValueAtTime(e.vel * 1.4, t + d * 0.4);
        w.g.gain.linearRampToValueAtTime(0, t + d);
        w.bpf.frequency.cancelScheduledValues(t);
        w.bpf.frequency.setValueAtTime(e.f1, t);
        w.bpf.frequency.exponentialRampToValueAtTime(e.f2, t + d);
      };

      const hands = { timing: 0.03, vel: 0.08 };
      return {
        rh: { layer: "melody", play: (t, e, d) => rh.play(t, e.note, d, e.vel), humanize: hands },
        echo: { layer: "melody", play: (t, e, d) => echo.play(t, e.note, d, e.vel), humanize: hands },
        lh: { layer: "harmony", play: (t, e, d) => lh.play(t, e.note, d, e.vel), humanize: { timing: 0.018, vel: 0.06 } },
        bass: { layer: "bass", play: (t, e, d) => { bassP.play(t, e.note, d, e.vel); sub.play(t, e.note, d * 0.7, e.vel * 0.8); }, humanize: { timing: 0.012, vel: 0.05 } },
        blip: { layer: "texture", play: (t, e, d) => blips[e.side ? 1 : 0].triggerAttackRelease(T.hz(e.note), Math.min(d, 0.3), t, e.vel), humanize: { timing: 0.015, vel: 0.15 } },
        breath: { layer: "texture", play: breathe, humanize: { timing: 0.05, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (cycle === 0 || state.seed == null) {
        state.seed = 1;
        state.phi1 = r.range(-1.2, -0.2); // the first swell is still rising after the opening ramp
        state.phi2 = r.range(0, 2 * Math.PI);
        state.plan = []; state.planEnd = 0; state.recent = []; state.voyages = 0; state.sinceHome = 0;
        newVoyage(state, r);
        state.pending = [];
        state.nextPhrase = 4.5; // the left hand speaks first
        const seeds = r.shuffle(SEEDS.map((_, i) => i));
        state.favs = [seeds[0], seeds[1]].map((i) => ({ ...clone(SEEDS[i]), plays: 0 }));
        state.ivw = { ...IV_BASE };
        r.shuffle(Object.keys(IV_BASE)).slice(0, 2).forEach((k) => (state.ivw[k] += 1.5)); // this pianist's own habits
        state.reg = 76; state.themeStart = null; state.last = null; state.lastFav = -1;
        state.lhUpper = null; state.echoes = []; state.phrases = 0;
      }
      const B0 = cycle * CB, E0 = B0 + CB;
      extendPlan(state, E0 + 48, r);
      const breath = (t) => breathAt(state, t);
      const pend = (track, t, dur, note, vel, extra) => state.pending.push({ track, t, dur, note, vel, ...extra });

      // ---- left hand and deep bass, for every chord that starts in this cycle ----
      for (const e of state.plan) {
        if (e.start < B0 || e.start >= E0) continue;
        const b = breath(e.start), c = INFO[e.sym].c, end = e.start + e.dur;
        const v = lhVoicing(e.sym, state, r);
        const deep = e.opening || e.home || r.chance(0.18 + 0.4 * b);
        if (deep) {
          const at = e.start + (r.chance(0.25) && !e.home ? r.pick([1, 1.5]) : 0);
          pend("bass", at, end - at, v.low - 12, 0.42 + 0.12 * b);
        }
        if (e.mode === "waltz" && !e.opening) {
          // Satie: bass on one, the chord on two, held through three; the two upper voicings alternate
          const alt = v.upper.slice(); alt[0] = T.step(alt[0], -1, c.pcs); // the lowest upper voice dips to the chord tone below
          const altOk = alt[0] - v.second >= 3 && alt[0] >= 55 && !alt.slice(1).some((x) => mod12(x) === mod12(alt[0]));
          for (let bar = 0; bar < e.dur / BPB; bar++) {
            const t = e.start + bar * BPB;
            if (bar > 0 && r.chance(0.12)) continue; // an occasional silent bar
            pend("lh", t, 2.9, bar % 2 && r.chance(0.5) ? v.second : v.low, (bar === 0 ? 0.42 : 0.35) + 0.04 * b);
            const up = bar % 2 === 1 && altOk ? alt : v.upper;
            pend("lh", t + 1, 1.95, up.slice().sort((x, y) => x - y), 0.3 + 0.05 * b);
          }
        } else {
          // plateau: a slow rolled open chord, sometimes rolled from the top, sometimes split (bass then chord)
          const style = e.opening ? "roll" : r.weighted([["roll", 3], ["split", 1.5], ["down", 1]]);
          const ups = style === "down" ? v.upper.slice().reverse() : v.upper;
          const withLow = !deep || r.chance(0.75);
          if (withLow) pend("lh", e.start, e.dur, v.low, 0.4 + 0.06 * b);
          const t2 = e.start + (style === "split" ? 1 : 0.22);
          pend("lh", t2, end - t2, v.second, 0.34 + 0.05 * b);
          ups.forEach((m, i) => {
            const t = e.start + (style === "split" ? 1 + i * 0.06 : 0.45 + i * 0.21);
            pend("lh", t, end - t, m, 0.3 + 0.04 * b + (i === ups.length - 1 ? 0.03 : 0));
          });
          // a long chord breathes once: the upper voices re-struck softly, an inner voice moved to its neighbour chord tone
          if (e.dur >= 9 && r.chance(0.35 + 0.4 * b)) {
            const t = e.start + r.pick([6, 6, 7.5]), up = v.upper.slice();
            const k = r.int(0, up.length - 2), mv = T.step(up[k], r.chance(0.5) ? 1 : -1, c.pcs);
            if (!up.includes(mv) && mv - v.second >= 3 && (k === 0 || mv - up[k - 1] >= 2) && mv < up[k + 1] - 1) up[k] = mv;
            up.forEach((m, i) => pend("lh", t + i * 0.18, end - t - i * 0.18, m, 0.25 + 0.04 * b));
          }
        }
      }

      // ---- right hand: the improvising pianist ----
      while (state.nextPhrase < E0) {
        let t0 = state.nextPhrase;
        const b = breath(t0);
        state.reg = 76 + 3.5 * Math.sin((2 * Math.PI * t0) / 260 + state.phi2) + 3 * (b - 0.5);
        // a homecoming is answered by the theme
        const home = state.plan.find((e) => e.home && !e.sung && t0 >= e.start - 8 && t0 <= e.start + e.dur - 7);
        let spec, kind;
        if (home && r.chance(0.2)) { home.sung = true; home.skip = true; } // now and then a homecoming passes without the theme
        if (state.phrases === 0 || (home && !home.skip)) {
          if (home) { home.sung = true; t0 = Math.max(t0, home.start + r.pick([0, 1, 1.5])); }
          const nth = state.favs[0].plays++;
          spec = nth < 2 ? clone(state.favs[0]) : vary(state.favs[0], r, r.pick(["plain", "extend", "augment", "displace", "truncate"]));
          kind = "theme";
        } else {
          kind = r.weighted([["answer", state.last && state.last.kind !== "answer" ? 1.1 : 0], ["recall", 1.4], ["improvise", 1.3]]);
          if (kind === "answer") spec = clone(state.last.spec);
          else if (kind === "recall") {
            const idx = r.weighted(state.favs.map((f, i) => [i, (1 + 0.3 * Math.min(f.plays, 6)) * (i === state.lastFav ? 0.3 : 1)]));
            state.lastFav = idx; state.favs[idx].plays++;
            spec = vary(state.favs[idx], r);
          } else spec = improvise(state, r, b);
        }
        if (spec.shift) t0 += spec.shift;
        const len = spec.rhythm[spec.rhythm.length - 1][0] + spec.rhythm[spec.rhythm.length - 1][1];

        // start pitch: a landing tone near the register, offset so the phrase centres on it
        let cum = 0, cmin = 0, cmax = 0;
        spec.steps.forEach((s, i) => { if (i) { cum += s; cmin = Math.min(cmin, cum); cmax = Math.max(cmax, cum); } });
        let start;
        const c0 = INFO[entryAt(state, t0).sym].c;
        if (kind === "answer") { // a sequence: the same shape from a neighbouring chord tone
          const L = T.notesIn(landing(c0), RH_LO, RH_HI - 3).filter((m) => m !== state.last.start && Math.abs(m - state.last.start) <= 5);
          start = L.length ? r.pick(L) : state.last.start;
        } else if (kind === "theme" && state.themeStart != null && landing(c0).includes(mod12(state.themeStart))) start = state.themeStart;
        else start = snap(Math.round(state.reg - 1.7 * (cmax + cmin) / 2 + r.gauss(1.5)), c0, null, 0);
        if (kind === "theme" && state.themeStart == null) state.themeStart = start;

        // render: scale steps over each note's own chord, then land long notes on chord tones
        const notes = [];
        let m = start;
        spec.rhythm.forEach(([off, d], i) => {
          const t = t0 + off;
          let e = entryAt(state, t), was = null;
          const eEnd = e.start + e.dur;
          if (eEnd - t <= 0.5 + 1e-6 && d >= 1) { was = INFO[e.sym].c; e = entryAt(state, eEnd); } // anticipation: it belongs to the next chord
          const c = INFO[e.sym].c;
          if (i > 0) {
            let x = T.step(m, spec.steps[i], c.scale);
            if (x > RH_HI || x < RH_LO) x = T.step(m, -spec.steps[i], c.scale); // turn back at the edge of the register
            m = Math.max(RH_LO, Math.min(RH_HI, x));
          }
          const cap = Math.max(0.5, e.start + e.dur - t);
          notes.push({ t, d, m, c, cap, was, change: e.start, onBeat: Math.abs(t - Math.round(t)) < 1e-6 });
        });
        notes.forEach((n, i) => {
          const last = i === notes.length - 1, prevM = i ? notes[i - 1].m : null;
          const dir = i ? Math.sign(n.m - prevM) : 0;
          if (last || n.d >= 1.5 || (n.onBeat && n.d >= 1) || i === 0) {
            if (!landing(n.c).includes(mod12(n.m)) || n.m === prevM) n.m = snap(n.m, n.c, prevM, dir);
          } else if (compat(mod12(n.m), n.c) === 0 || n.m === prevM) {
            n.m = T.step(n.m, dir || 1, n.c.scale);
            if (compat(mod12(n.m), n.c) === 0) n.m = snap(n.m, n.c, prevM, dir);
          }
          if (i && Math.abs(n.m - prevM) > 9) n.m = snap(n.m + (n.m > prevM ? -12 : 12), n.c, prevM, dir);
          while (n.m < RH_LO) n.m += 12;
          while (n.m > RH_HI) n.m -= 12;
          // an anticipation must also agree with the chord it overlaps; otherwise it waits for the downbeat
          if (n.was && compat(mod12(n.m), n.was) === 0) { n.cap -= n.change - n.t; n.t = n.change; }
        });
        // memory: every interval played is reinforced; habits fade slowly toward the base
        notes.forEach((n, i) => {
          if (!i) return;
          const s = spec.steps[i];
          if (state.ivw[s] != null) state.ivw[s] = Math.min(state.ivw[s] + 0.08, IV_BASE[s] * 2 + 1.5); // habits, not obsessions
        });
        for (const k of Object.keys(state.ivw)) state.ivw[k] = 0.985 * state.ivw[k] + 0.015 * IV_BASE[k];
        // a new idea the pianist likes joins its favourites
        if (kind === "improvise" && r.chance(0.2)) {
          if (state.favs.length < 4) state.favs.push({ rhythm: spec.rhythm, steps: spec.steps, plays: 0 });
          else { let w = 1; for (let i = 2; i < state.favs.length; i++) if (state.favs[i].plays < state.favs[w].plays) w = i; state.favs[w] = { rhythm: spec.rhythm, steps: spec.steps, plays: 0 }; }
        }

        // dynamics and rubato: an arch toward the highest note, a hesitation before it, a ritardando at the end
        const top = Math.max(...notes.map((n) => n.m)), bot = Math.min(...notes.map((n) => n.m));
        const base = 0.42 + 0.16 * b;
        const rub = r.range(0.04, 0.12);
        let delay = 0;
        notes.forEach((n, i) => {
          const last = i === notes.length - 1;
          if (n.m === top && i > 0 && notes.length > 2) delay = Math.max(delay, rub * 0.8);
          if (i >= notes.length - 2 && notes.length > 2) delay = Math.max(delay, rub * (last ? 1.6 : 1));
          const vel = base * (0.84 + 0.2 * (top > bot ? (n.m - bot) / (top - bot) : 0.5)) * (last ? 0.9 : 1) * (kind === "theme" ? 1.08 : 1);
          const next = notes[i + 1];
          // pedalled overlap within the chord: generous after a leap, slight after a whole step, none after a semitone
          const step = next ? Math.abs(next.m - n.m) : 9, gap = next ? next.t - n.t : 0;
          const dur = Math.max(0.4, Math.min(n.cap, last ? n.d : gap * (step === 1 ? 0.95 : step === 2 ? 1.15 : 1.6)));
          let note = n.m;
          if (last && n.d >= 2 && r.chance(0.18 + 0.12 * b)) { // close with a sixth or third underneath
            const under = T.notesIn(n.c.pcs, n.m - 9, n.m - 3).filter((x) => x >= 62 && n.m - x !== 6);
            if (under.length) note = [r.pick(under), n.m];
          }
          pend("rh", n.t, dur, note, vel, delay ? { delay: +delay.toFixed(3) } : {});
          n.vel = vel; n.delay = delay; n.dur = dur;
        });

        // echoes: feed sustained notes that agree with every chord planned while they linger
        const now = notes[0].t;
        state.echoes = state.echoes.filter((x) => x > now - ECHO_SPAN);
        const room = Math.round(1 + 2.2 * b) - state.echoes.length;
        if (room > 0 && r.chance(0.35 + 0.5 * b)) {
          const cands = notes.filter((n) => n.d >= 1 && n.c.pcs.includes(mod12(n.m))).filter((n) => {
            for (const e of state.plan) {
              if (e.start + e.dur <= n.t || e.start >= n.t + ECHO_SPAN) continue;
              if (compat(mod12(n.m), INFO[e.sym].c) === 0) return false;
            }
            return true;
          });
          cands.sort((a, b2) => b2.t - a.t); // the phrase's ending first
          cands.slice(0, Math.min(room, r.chance(0.3) ? 2 : 1)).forEach((n) => {
            pend("echo", n.t, Math.min(n.dur, 3), n.m, n.vel * 0.95, n.delay ? { delay: +n.delay.toFixed(3) } : {});
            state.echoes.push(n.t);
          });
        }

        state.last = { spec, start, kind };
        state.phrases++;
        const rest = (1.5 + 13 * Math.pow(1 - b, 1.5)) * r.range(0.7, 1.35) + (kind === "theme" ? 2 : 0);
        state.nextPhrase = r2(t0 + len + rest);
      }

      // ---- cells: glass blips ----
      const mid = breath(B0 + CB / 2);
      const nb = r.weighted([[0, 1.3 - mid], [1, 1], [2, 0.2 + 0.8 * mid], [3, 0.5 * mid]]);
      for (let i = 0; i < nb; i++) {
        let t = B0 + r.int(0, 44) / 2;
        const c = INFO[entryAt(state, t).sym].c;
        const pool = T.notesIn(c.colors.concat(c.guide), 86, 100);
        if (!pool.length) continue;
        let k = r.int(0, pool.length - 1), dir = r.chance(0.5) ? 1 : -1;
        const n = Math.min(pool.length, r.weighted([[1, 2], [2, 2], [3, 1.4], [4, 0.6]])), gap = r.pick([0.25, 0.25, 0.5, 0.75]);
        const side = r.chance(0.5) ? 1 : 0;
        for (let j = 0; j < n; j++) {
          pend("blip", t, 0.25, pool[k], (0.22 + 0.1 * mid) * (1 - j * 0.12), { side });
          if (k + dir < 0 || k + dir >= pool.length || r.chance(0.3)) dir = -dir; // a cell turns at the wall
          k = Math.max(0, Math.min(pool.length - 1, k + dir));
          t += gap;
        }
      }
      // ---- cells: a soft breath, more often when the piano is quiet ----
      if (r.chance(0.2 + 0.4 * (1 - mid))) {
        const f1 = r.range(1600, 2800);
        pend("breath", B0 + r.int(0, 36) / 2, r.range(4, 7), "breath", 0.14 + 0.1 * (1 - mid), { f1: Math.round(f1), f2: Math.round(f1 * r.range(0.4, 0.6)) });
      }

      // ---- emit what falls in this cycle; keep the rest for later ----
      const events = [], keep = [];
      for (const ev of state.pending) {
        if (ev.t >= E0 - 1e-6) { keep.push(ev); continue; }
        const p = C.at(ev.t - B0, BPB);
        const { t, track, ...rest } = ev;
        events.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), ...rest });
      }
      state.pending = keep;

      const harmony = [];
      for (const e of state.plan) {
        const s = Math.max(e.start, B0), en = Math.min(e.start + e.dur, E0);
        if (en <= s) continue;
        const p = C.at(s - B0, BPB);
        harmony.push({ bar: p.bar, beat: p.beat, dur: en - s, chord: e.sym });
      }
      state.plan = state.plan.filter((e) => e.start + e.dur > B0 - CB);

      const e0 = entryAt(state, B0 + 3); // what the listener is hearing for most of the cycle's first bars
      const dens = mid < 0.3 ? "resting" : mid < 0.55 ? "floating" : mid < 0.78 ? "dividing" : "blooming";
      const echoes = state.echoes.length ? ` · ${state.echoes.length} echo${state.echoes.length > 1 ? "es" : ""}` : "";
      return { events, harmony, section: `${e0.mode === "waltz" ? "slow waltz" : "plateau"} · ${e0.where} · ${dens}${echoes}`, state };
    },
  });
})();

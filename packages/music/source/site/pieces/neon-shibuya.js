// Neon Shibuya: future funk. City pop and disco chopped, sped up and pumped at 120 BPM, in E major.
//
// Harmony (written in E):
//   groove   | Amaj9 | G#m7 C#7b13 | F#m9 | B13sus4 B13 |   IV, iii-VI7-ii (a circle of fifths), V
//   build    | F#m9 | G#m7 | Amaj9 | B13sus4 |            the bass climbs F# G# A B under a filter rise
//   chorus   | Amaj9 | B13 | G#m7 | C#m9 | ...            the "royal road" (IV-V-iii-vi) that J-pop runs on;
//            chorus 1 ends on E7#9 (V of IV) to go round again, chorus 2 finally lands on Emaj9
//   drop     | C#m9 | % | Amaj9 | B13sus4 |                just slap bass and claps
// The second build swerves at its last bar to D13sus4 and the choruses come back re-pitched up a minor third
// (G), as if the producer had nudged the sampler; after them the record is braked to a stop (a turntable
// stop on the whole mix) and dropped back into E.
// Form (14 cycles of 8 bars, about 3¾ minutes): intro (filtered chops, kick from bar 1) · groove · groove with
// vocal-chop calls, brass and congas · build (filter rise, riser, snare roll, a half-beat of silence) ·
// chorus · chorus · drop (bass and claps) · rebuild · groove · build to G · chorus in G · chorus in G ·
// turntable stop -> drop in E · outro (filter closes) -> intro.
// The "sample" (Rhodes chops, brass stabs, choir vocal chops, disco strings) runs through a sidechain pump
// keyed by the kick and a sweepable lowpass; at section seams it is chopped: slices repeat (8ths, then 16ths),
// held chords are re-triggered as stutters.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4, CYCLE = 8, CB = CYCLE * BPB;

  const PROGS = {
    groove: "| Amaj9 | G#m7 C#7b13 | F#m9 | B13sus4 B13 | Amaj9 | G#m7 C#7b13 | F#m9 | B13sus4 B13 |",
    build: "| F#m9 | G#m7 | Amaj9 | B13sus4 | F#m9 | G#m7 | Amaj9 | B13sus4 |",
    buildG: "| F#m9 | G#m7 | Amaj9 | B13sus4 | F#m9 | G#m7 | Amaj9 | D13sus4 |",
    chorus1: "| Amaj9 | B13 | G#m7 | C#m9 | Amaj9 | B13 | Emaj9 | E7#9 |",
    chorus2: "| Amaj9 | B13 | G#m7 | C#m9 | F#m9 | G#m7 | Amaj9 B13sus4 | Emaj9 |",
    drop: "| C#m9 | % | Amaj9 | B13sus4 | C#m9 | % | Amaj9 | B13sus4 |",
  };

  // ---------- the vocal-chop hook (choir, "ah"), in E: [beat, dur, midi] ----------
  // One rhythm cell per bar (two quick chops, a lift, a held note, a falling pair, a landing) traced over
  // the royal road; bars 5-8 differ between the two choruses.
  const cell = (bar, a, b, c, d, e, f) => [[bar * 4, 0.25, a], [bar * 4 + 0.5, 0.25, a], [bar * 4 + 0.75, 0.25, b], [bar * 4 + 1.5, 0.5, c], [bar * 4 + 2.5, 0.25, d], [bar * 4 + 2.75, 0.25, e], [bar * 4 + 3, 0.5, f]];
  const HOOK_HEAD = [
    ...cell(0, 76, 78, 80, 78, 76, 73),   // Amaj9: E E F# G# . F# E C#
    ...cell(1, 75, 78, 80, 81, 80, 78),   // B13:   D# D# F# G#(13) . A G# F#
    ...cell(2, 75, 78, 83, 80, 78, 75),   // G#m7:  D# D# F# B . G# F# D#
    [12, 0.25, 76], [12.5, 0.25, 76], [12.75, 0.25, 80], [13.5, 1, 83], [15, 0.25, 80], [15.25, 0.25, 78], [15.5, 0.5, 75], // C#m9
  ];
  const HOOK_TAIL1 = [
    ...cell(4, 76, 78, 80, 78, 76, 73),
    ...cell(5, 75, 78, 80, 81, 80, 78),
    [24, 0.5, 83], [24.75, 0.25, 80], [25.5, 0.5, 78], [26.5, 0.25, 76], [26.75, 0.25, 75], [27, 1, 76],   // Emaj9: B . G# F# . E D# E
    ...cell(7, 74, 79, 80, 79, 76, 74),   // E7#9: D D G(#9) G# . G E D
  ];
  const HOOK_TAIL2 = [
    ...cell(4, 76, 80, 81, 80, 76, 73),   // F#m9
    ...cell(5, 78, 80, 83, 80, 78, 75),   // G#m7
    [24, 0.25, 76], [24.5, 0.25, 80], [25, 0.5, 83], [26, 0.25, 80], [26.5, 0.25, 81], [26.75, 0.25, 83], [27, 1, 85], // Amaj9 | B13sus4
    [28, 0.5, 80], [28.75, 0.25, 78], [29, 2.5, 76],   // Emaj9: home
  ];

  // ---------- 16-step gate patterns for the Rhodes chops ----------
  const GATES = {
    groove: ["x..x..x...x.x...", "x.xx..x.x..x..x.", "x..x..x..x..x.x.", "x..x.x...xx..x.."],
    chorus: ["x..x..x.x..x..x.", "x.x..x.xx..x.x..", "x..x..x...x.xx.."],
    build: ["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
  };
  // slap bass per chord span: [beat, dur, role, art, vel]; R root, O octave pop, F fifth, S seventh, A approach
  const SLAP4 = [
    [[0, 0.4, "R", "thumb", 0.9], [0.5, 0.2, "O", "pop", 0.85], [0.75, 0.1, "R", "ghost", 0.5], [1, 0.3, "R", "thumb", 0.8], [1.5, 0.2, "O", "pop", 0.85], [2, 0.4, "R", "thumb", 0.85], [2.5, 0.2, "O", "pop", 0.85], [2.75, 0.2, "F", "thumb", 0.7], [3, 0.3, "R", "thumb", 0.8], [3.5, 0.2, "O", "pop", 0.85], [3.75, 0.2, "A", "thumb", 0.75]],
    [[0, 0.7, "R", "thumb", 0.9], [0.75, 0.2, "R", "thumb", 0.7], [1.25, 0.1, "R", "ghost", 0.5], [1.5, 0.2, "O", "pop", 0.9], [2, 0.2, "F", "thumb", 0.75], [2.25, 0.2, "R", "thumb", 0.7], [2.5, 0.2, "O", "pop", 0.85], [3, 0.1, "R", "ghost", 0.5], [3.25, 0.2, "S", "pop", 0.8], [3.5, 0.4, "R", "thumb", 0.8]],
    [[0, 0.3, "R", "thumb", 0.9], [0.25, 0.1, "R", "ghost", 0.5], [0.5, 0.2, "O", "pop", 0.85], [1, 0.2, "R", "thumb", 0.8], [1.25, 0.2, "R", "thumb", 0.65], [1.75, 0.2, "O", "pop", 0.85], [2.5, 0.2, "R", "thumb", 0.85], [2.75, 0.2, "O", "pop", 0.85], [3.25, 0.1, "R", "ghost", 0.5], [3.5, 0.2, "F", "thumb", 0.75], [3.75, 0.2, "A", "thumb", 0.75]],
  ];
  const SLAP2 = [
    [[0, 0.4, "R", "thumb", 0.9], [0.5, 0.2, "O", "pop", 0.85], [0.75, 0.1, "R", "ghost", 0.5], [1, 0.3, "R", "thumb", 0.8], [1.5, 0.2, "O", "pop", 0.85], [1.75, 0.2, "A", "thumb", 0.7]],
    [[0, 0.3, "R", "thumb", 0.9], [0.25, 0.1, "R", "ghost", 0.5], [0.5, 0.2, "O", "pop", 0.85], [1.25, 0.2, "R", "thumb", 0.75], [1.5, 0.2, "O", "pop", 0.85]],
  ];
  const PUMP4 = [[[0, 0.3, "R", "thumb", 0.9], [0.5, 0.2, "O", "pop", 0.8], [1, 0.3, "R", "thumb", 0.85], [1.5, 0.2, "O", "pop", 0.8], [2, 0.3, "R", "thumb", 0.85], [2.5, 0.2, "O", "pop", 0.8], [3, 0.3, "R", "thumb", 0.85], [3.5, 0.2, "O", "pop", 0.85]]];

  // ---------- the set ----------
  const PLAN = [
    { name: "intro", prog: "groove", k: 0, label: "Intro · filtered chops" },
    { name: "grooveA", prog: "groove", k: 0, label: "Groove" },
    { name: "grooveB", prog: "groove", k: 0, label: "Groove · vocal chops, brass, congas" },
    { name: "build", prog: "build", k: 0, label: "Build · filter rise" },
    { name: "chorus1", prog: "chorus1", k: 0, label: "Chorus" },
    { name: "chorus2", prog: "chorus2", k: 0, label: "Chorus · lands home" },
    { name: "drop", prog: "drop", k: 0, label: "Drop · bass and claps" },
    { name: "rebuild", prog: "drop", k: 0, label: "Rebuild" },
    { name: "grooveB", prog: "groove", k: 0, label: "Groove · vocal chops, brass, congas" },
    { name: "build", prog: "buildG", k: 0, label: "Build · swerve to G" },
    { name: "chorus1", prog: "chorus1", k: 3, label: "Chorus in G · re-pitched" },
    { name: "chorus2", prog: "chorus2", k: 3, label: "Chorus in G · then the brakes" },
    { name: "drop", prog: "drop", k: 0, label: "Drop · back in E" },
    { name: "outro", prog: "groove", k: 0, label: "Outro · filter closes" },
  ];
  const planAt = (cycle) => ({ ...PLAN[cycle % PLAN.length], set: Math.floor(cycle / PLAN.length), i: cycle % PLAN.length });
  const isChorus = (n) => n === "chorus1" || n === "chorus2";
  const SAMPLE = new Set(["keys", "brass", "vox", "strings"]);

  // ---------- helpers ----------
  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  const PCACHE = {};
  const progIn = (name, k) => (PCACHE[name + k] ||= T.progression(PROGS[name]).map((h) => ({ start: h.bar * BPB + h.beat, dur: h.dur, chord: tsym(h.chord, k) })));
  const rough = (v) => v.some((a, i) => i > 0 && (a - v[i - 1] === 1 || (v[i - 1] < 55 && a - v[i - 1] <= 2))) ||
    v.some((a, i) => v.some((b, j) => j > i && b - a === 13));
  /** Every placement of the chord's n most important tones in [lo, hi] (guide tones, colours, fifth, root):
   *  no adjacent semitones, no minor 9ths, no seconds low down; the smoothest move from `prev` wins. */
  function voiceClean(sym, o) {
    const c = T.chord(sym), n = o.n ?? 4;
    const fifth = c.intervals.find((x) => x === 6 || x === 7 || x === 8);
    const pri = [...new Set([...c.guide, ...c.colors, ...(fifth != null ? [mod12(c.root + fifth)] : []), c.root])];
    let best = null, bs = Infinity;
    const full = pri.slice(0, n), sets = [[full, 0]];
    full.forEach((pc, i) => sets.push([full.filter((_, j) => j !== i), c.guide.includes(pc) ? 9 : c.colors.includes(pc) ? 6 : 5]));
    for (const [set, cost] of sets) {
      const opts = set.map((pc) => T.notesIn([pc], o.lo, o.hi));
      const walk = (i, acc) => {
        if (i === set.length) {
          const v = acc.slice().sort((a, b) => a - b), span = v[v.length - 1] - v[0];
          if (rough(v) || span > 19 || span < 7) return;
          let sc = cost;
          if (o.prev && o.prev.length) { const m = Math.min(v.length, o.prev.length); for (let j = 0; j < m; j++) sc += Math.abs(v[v.length - 1 - j] - o.prev[o.prev.length - 1 - j]); }
          else sc += Math.abs((v[0] + v[v.length - 1]) / 2 - (o.lo + o.hi) / 2);
          const t = v[v.length - 1];
          if (t < o.top[0]) sc += (o.top[0] - t) * 1.5;
          if (t > o.top[1]) sc += (t - o.top[1]) * 1.5;
          if (o.rng) sc += o.rng() * 0.8;
          if (sc < bs) { bs = sc; best = v; }
          return;
        }
        for (const m of opts[i]) { acc.push(m); walk(i + 1, acc); acc.pop(); }
      };
      walk(0, []);
    }
    return best || T.voice(sym, { ...o, n });
  }
  /** Chop: the slice [at, at+slice) of the sample repeats until at+len; notes held into `at` are re-struck. */
  function stutterRaw(ev, at, len, slice, fits = () => true) {
    const out = [], src = [];
    for (const e of ev) {
      if (!SAMPLE.has(e.track)) { out.push(e); continue; }
      const end = e.beat + e.dur;
      if (e.beat >= at - 1e-9 && e.beat < at + len - 1e-9) { if (e.beat < at + slice - 1e-9) src.push(e); continue; }
      if (e.beat < at - 1e-9 && end > at + 0.05) { out.push({ ...e, dur: at - e.beat }); if (fits(e, at)) src.push({ ...e, beat: at, dur: end - at, vel: e.vel * 0.9 }); continue; }
      out.push(e);
    }
    if (!src.length) { // nothing in the slice: grab the most recent stab before it instead
      const prior = ev.filter((e) => SAMPLE.has(e.track) && e.beat < at - 1e-9 && e.beat >= at - 1);
      if (prior.length) {
        const o = Math.max(...prior.map((e) => e.beat));
        prior.filter((e) => e.beat >= o - 1e-9 && e.beat < o + slice - 1e-9 && fits(e, at)).forEach((e) => src.push({ ...e, beat: e.beat + at - o }));
      }
    }
    for (let k = 0; k * slice < len - 1e-9; k++) {
      for (const s of src) {
        const d = Math.min(s.dur, at + slice - s.beat) * 0.85;
        if (d > 0.04) out.push({ ...s, beat: s.beat + k * slice, dur: d, vel: s.vel * (0.85 + 0.15 * (k % 2 ? 0 : 1)) });
      }
    }
    return out;
  }
  /** A hole in the record: everything in [at, at+len) is removed and notes ringing into it are cut. */
  function silence(ev, at, len) {
    return ev.filter((e) => !(e.beat >= at - 1e-9 && e.beat < at + len - 1e-9)).map((e) => (e.beat < at && e.beat + e.dur > at ? { ...e, dur: at - e.beat } : e));
  }

  Sim.register({
    id: "neon-shibuya",
    title: "Neon Shibuya",
    genre: "Future funk",
    about: "Chopped, pumped city-pop disco at 120 BPM: four-on-the-floor with claps and open hats, stuttering Rhodes and brass stabs, slap bass and a pitched choir vocal-chop hook on the royal-road progression, with filter rises, a drop to bass and claps, choruses re-pitched up a minor third and a turntable stop.",
    situations: ["party", "hangout"],
    energy: 0.8,
    bpm: 120, beatsPerBar: BPB, swing: 0.53, swingUnit: 0.25, cycleBars: CYCLE, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const K = (n) => ctx.keep(n);
      const fin = (x, d) => (Number.isFinite(x) ? x : d);

      // ---- the deck: everything -> delay (for the turntable stop) -> gain -> out ----
      const deckGain = K(new Tone.Gain(1)).connect(out);
      const deckDelay = K(new Tone.Delay({ delayTime: 0.005, maxDelay: 0.6 })).connect(deckGain);
      const deck = K(new Tone.Gain(1)).connect(deckDelay);
      const plate = I.reverb(ctx, deck, { decay: 1.6, preDelay: 0.012, lowcut: 350, highcut: 8000 });
      const hall = I.reverb(ctx, deck, { decay: 3.2, preDelay: 0.025, lowcut: 400, highcut: 7000 });
      const echo = I.delay(ctx, deck, { time: "8n.", feedback: 0.28, pingPong: true, highcut: 4200 });

      // ---- the sample: chops -> lowpass (the filter everyone rides) -> sidechain pump ----
      const pumpM = I.pump(ctx, deck, { depth: 0.6, release: 0.24 });
      const pumpB = I.pump(ctx, deck, { depth: 0.3, release: 0.18 });
      const sweep = K(new Tone.Filter({ frequency: 16000, type: "lowpass", rolloff: -24, Q: 1.8 })).connect(pumpM.input);
      I.send(ctx, pumpM.input, plate, -15);
      I.send(ctx, pumpM.input, hall, -20);

      const keys = I.rhodes(ctx, { volume: -5, cutoff: 5600, bark: 2.8, tine: -8, tremolo: 4.5, tremoloDepth: 0.12 });
      const brass = I.brassStab(ctx, { volume: -7, attack: 0.008, release: 0.09, base: 700, octaves: 3.2 });
      const voxA = I.choir(ctx, { volume: -1, vowel: "a", attack: 0.006, release: 0.07 });
      const voxO = I.choir(ctx, { volume: -3, vowel: "o", attack: 0.006, release: 0.07 });
      const strings = I.strings(ctx, { volume: -10, attack: 0.18, release: 0.6, cutoff: 4200 });
      I.place(ctx, keys, -0.25, sweep); I.place(ctx, brass, 0.3, sweep); I.place(ctx, strings, 0, sweep);
      const vp = I.place(ctx, voxA, 0.05, sweep), vo = I.place(ctx, voxO, -0.15, sweep);
      I.send(ctx, vp, echo, -15); I.send(ctx, vo, echo, -15);

      const bass = I.slapBass(ctx, { volume: -3 });
      const bassLP = K(new Tone.Filter({ frequency: 9000, type: "lowpass", rolloff: -12 })).connect(pumpB.input);
      I.place(ctx, bass, 0, bassLP);

      const kit = I.kit(ctx, { volume: 0, preload: ["kick909", "clap", "snare808", "hatClosed", "hatOpen", "tambourine", "conga", "bongo", "crash"] });
      const kp = I.place(ctx, kit, 0, deck);
      I.send(ctx, kp, plate, -19);

      // ---- fx: a white-noise riser ----
      const riseGain = K(new Tone.Gain(0)).connect(deck);
      const riseBP = K(new Tone.Filter({ frequency: 500, type: "bandpass", Q: 2.2 })).connect(riseGain);
      K(new Tone.Noise({ type: "white" }).start()).connect(riseBP);
      I.send(ctx, riseGain, hall, -6);
      const clk = { sweep: I.monotonic(sweep), rise: I.monotonic(riseGain), stop: I.monotonic(deckGain) };

      return {
        vox: { layer: "melody", humanize: { timing: 0.003, vel: 0.04 }, play: (t, e, d) => (e.vowel === "o" ? voxO : voxA).play(t, e.note, d, e.vel) },
        keys: { layer: "harmony", humanize: { timing: 0.003, vel: 0.05 }, play: (t, e, d) => keys.play(t, e.note, d, e.vel) },
        brass: { layer: "harmony", humanize: { timing: 0.003, vel: 0.04 }, play: (t, e, d) => brass.play(t, e.note, d, e.vel) },
        strings: { layer: "harmony", humanize: { timing: 0.006, vel: 0.03 }, play: (t, e, d) => strings.play(t, e.note, d, e.vel) },
        bass: { layer: "bass", humanize: { timing: 0.003, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel, e.art) },
        kick: { layer: "drums", humanize: { timing: 0.001, vel: 0.03 }, play: (t, e) => { kit.hit("kick909", t, e.vel); pumpM.duck(t); pumpB.duck(t); } },
        drums: { layer: "drums", humanize: { timing: 0.003, vel: 0.08 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }) },
        fx: { layer: "texture", humanize: { timing: 0, vel: 0 }, play: (t, e, d) => {
          const len = fin(d, 1);
          if (e.note === "sweep") { // the lowpass moves from `from` to `to` Hz over the event
            const tt = clk.sweep(t), f = sweep.frequency;
            f.cancelScheduledValues(tt); f.setValueAtTime(fin(e.from, 16000), tt); f.exponentialRampToValueAtTime(fin(e.to, 16000), tt + len);
          } else if (e.note === "riser") { // noise swells and climbs, then is cut on the downbeat
            const tt = clk.rise(t), g = riseGain.gain, f = riseBP.frequency;
            g.cancelScheduledValues(tt); f.cancelScheduledValues(tt);
            g.setValueAtTime(0, tt); g.linearRampToValueAtTime(0.05 * fin(e.lvl, 1), tt + len); g.setValueAtTime(0, tt + len + 0.01);
            f.setValueAtTime(450, tt); f.exponentialRampToValueAtTime(9000, tt + len);
          } else if (e.note === "stop") { // turntable stop: the delay grows quadratically (pitch falls to zero) as the level dies
            const tt = clk.stop(t), p = deckDelay.delayTime, g = deckGain.gain;
            p.cancelScheduledValues(tt); g.cancelScheduledValues(tt);
            p.setValueAtTime(0.005, tt);
            [0.25, 0.5, 0.75, 1].forEach((x) => p.linearRampToValueAtTime(0.005 + 0.5 * len * x * x, tt + len * x));
            g.setValueAtTime(1, tt); g.linearRampToValueAtTime(0.6, tt + len * 0.6); g.linearRampToValueAtTime(0, tt + len);
            p.setValueAtTime(0.005, tt + len + 0.02); g.setValueAtTime(0, tt + len + 0.02); g.linearRampToValueAtTime(1, tt + len + 0.05);
          }
        } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = planAt(cycle), next = planAt(cycle + 1), prev = cycle > 0 ? planAt(cycle - 1) : null;
      const k = P.k, prog = progIn(P.prog, k);
      const chordAt = (b) => { let cur = prog[0]; for (const h of prog) if (h.start <= b + 1e-6) cur = h; return cur; };
      const sym = (b) => chordAt(b).chord;
      let ev = [];
      const E = (track, beat, dur, note, vel, extra) => ev.push({ track, beat, dur, note, vel, ...extra });
      const D = (beat, voice, vel, extra) => E("drums", beat, 0.1, voice, vel, extra);
      const name = P.name, chorus = isChorus(name);
      const gateFor = (lib) => { const key = name + lib; if (!state.gate || state.gateFor !== cycle) { state.gate = {}; state.gateFor = cycle; } return (state.gate[key] ||= r.pick(GATES[lib])); };

      // ---------- Rhodes chops ----------
      const keysOn = name !== "drop";
      const kr = chorus ? { lo: 60, hi: 77, top: [70, 75] } : { lo: 59, hi: 77, top: [68, 74] };
      const voicing = {};
      prog.forEach((h) => { voicing[h.start] = state.kv = voiceClean(h.chord, { ...kr, n: 4, prev: state.kv, rng: r }); });
      const vAt = (b) => voicing[chordAt(b).start];
      if (keysOn) {
        for (let bar = 0; bar < CYCLE; bar++) {
          let gate;
          if (name === "build" || name === "rebuild") gate = GATES.build[Math.min(3, Math.floor(bar / 2))];
          else if (chorus) gate = bar % 4 === 3 ? GATES.chorus[(bar >> 2) % 3] : gateFor("chorus");
          else gate = bar % 4 === 3 ? GATES.groove[3] : gateFor("groove");
          if (name === "rebuild" && bar < 4) gate = "x.......x.......";
          for (let s = 0; s < 16; s++) {
            if (gate[s] !== "x") continue;
            const at = bar * 4 + s / 4, accent = s % 4 === 0 || gate[s - 1] !== "x";
            E("keys", at, s % 2 ? 0.18 : 0.22, vAt(at), (accent ? 0.5 : 0.4) + (chorus ? 0.04 : 0) + r.gauss(0.02));
          }
        }
      }

      // ---------- strings: chorus pad, disco runs into it ----------
      if (chorus) {
        prog.forEach((h) => { const v = state.sv = voiceClean(h.chord, { lo: 52, hi: 71, n: 3, prev: state.sv, top: [64, 69] }); E("strings", h.start, h.dur - 0.05, v, 0.42); });
      }
      const runInto = isChorus(next.name) && name === "build";
      if (runInto) { // a 16th-note scale run up the last beats (stopping where the record cuts out)
        const sc = T.chord(sym(28)).scale, start = T.nearest(66, T.chord(sym(28)).pcs, 62, 70);
        for (let i = 0; i < 7; i++) E("strings", 29.75 + i * 0.25, 0.22, T.step(start, i, sc), 0.38 + i * 0.03);
      }

      // ---------- brass stabs ----------
      const bv = (b, top) => (state.bv = voiceClean(sym(b), { lo: 60, hi: top, n: 4, prev: state.bv, top: [top - 6, top] }));
      const stab = (b, d, vel, top = 81) => E("brass", b, d, bv(b, top), vel);
      if (name === "grooveB" || name === "outro") {
        // the brass answers the vocal call of bar 2 and calls ahead of the one in bar 4
        for (let q = 0; q < 2; q++) { const s = q * 16; stab(s + 7.5, 0.2, 0.5); stab(s + 7.75, 0.35, 0.56); stab(s + 13.5, 0.2, 0.5); stab(s + 13.75, 0.2, 0.52); stab(s + 14, 0.4, 0.58); }
      } else if (chorus) {
        [0, 16].forEach((s) => stab(s, 0.45, 0.62));
        [12, 28].forEach((s) => { if (!(name === "chorus2" && s === 28)) { stab(s + 2.5, 0.2, 0.54); stab(s + 3, 0.2, 0.56); stab(s + 3.5, 0.4, 0.6); } });
        if (name === "chorus2") stab(28, 1.2, 0.6, 83);
      } else if (name === "build") {
        stab(28, 0.25, 0.58); stab(28.75, 0.25, 0.6); stab(29.5, 0.25, 0.64);
      }

      // ---------- vocal chops ----------
      if (chorus) {
        const hook = HOOK_HEAD.concat(name === "chorus1" ? HOOK_TAIL1 : HOOK_TAIL2);
        const harmonise = name === "chorus2" || k !== 0;
        hook.forEach(([b, d, m]) => {
          const note = m + k, onBar = b % 4 === 0;
          let n = note;
          if (harmonise && d >= 0.5) { // a chord tone a third-ish below on the held chops
            const c = T.chord(sym(b)), below = T.notesIn(c.pcs, note - 5, note - 3);
            if (below.length) n = [below[below.length - 1], note];
          }
          E("vox", b, d, n, (d >= 0.5 ? 0.66 : 0.58) + (onBar ? 0.05 : 0) + r.gauss(0.02), { vowel: "a" });
        });
      } else if (name === "grooveB" || name === "outro" || (name === "grooveA" && P.set > 0)) {
        // calls: three "oh" chops climbing a chord on the "and" of 3 every other bar, answered by the brass
        for (let bar = 1; bar < CYCLE; bar += 2) {
          if (name === "outro" && bar > 5) break;
          const at = bar * 4 + 2.5, c = T.chord(sym(at));
          const pool = T.notesIn(c.guide.concat(c.colors, [mod12(c.root + 7)]), 70, 82);
          const i0 = Math.max(0, pool.findIndex((m) => m >= 72 + (bar % 4 === 3 ? 2 : 0)));
          [[0, 0.2], [0.25, 0.2], [0.5, 0.45]].forEach(([o, d], j) => E("vox", at + o, d, pool[Math.min(pool.length - 1, i0 + j)], 0.52 + j * 0.04, { vowel: "o" }));
        }
      } else if (name === "build") { // "ah-ah" on every beat of the last four bars, a chord tone higher every two beats
        let n = 64;
        for (let b = 16; b < 29.5; b++) {
          const c = T.chord(sym(b));
          if (b % 2 === 0) { const up = T.notesIn(c.pcs, n + 1, n + 5); n = up.length ? up[0] : T.nearest(n, c.pcs, 62, 84); }
          else if (!c.pcs.includes(mod12(n))) n = T.nearest(n, c.pcs, 62, 84);
          E("vox", b, 0.22, n, 0.48 + (b - 16) * 0.014, { vowel: "a" });
        }
      }

      // ---------- slap bass ----------
      let lastRoot = state.root ?? 33;
      const nextFirst = progIn(next.prog, next.k)[0].chord;
      prog.forEach((h, i) => {
        const c = T.chord(h.chord), root = T.nearest(lastRoot, [c.bass], 28, 40);
        lastRoot = root;
        const nsym = i + 1 < prog.length ? prog[i + 1].chord : nextFirst, nc = T.chord(nsym), nroot = T.nearest(root, [nc.bass], 28, 40);
        const fifth = root + (c.intervals.find((x) => x === 7 || x === 6 || x === 8) ?? 7);
        const sev = root + (c.intervals.includes(10) ? 10 : c.intervals.includes(9) ? 9 : 7);
        const sc = new Set(c.scale.concat(c.pcs));
        const app = nc.bass === c.bass ? fifth : [nroot - 1, nroot + 1, nroot - 2, nroot + 2].find((m) => sc.has(mod12(m))) ?? nroot - 1;
        const role = { R: root, O: root + 12, F: fifth, S: sev, A: app };
        let lib = h.dur >= 4 ? SLAP4 : SLAP2;
        if (name === "build" && h.start < 16) lib = h.dur >= 4 ? PUMP4 : SLAP2;
        const key = `${name}${h.dur}`;
        if (!state.slap || state.slapFor !== cycle) { state.slap = {}; state.slapFor = cycle; }
        if (state.slap[key] == null) state.slap[key] = r.int(0, lib.length - 1);
        for (let off = 0; off < h.dur - 1e-9; off += 4) { // a two-bar chord gets two bars of groove
          const span = Math.min(4, h.dur - off), lastChunk = off + 4 >= h.dur - 1e-9;
          const L = span >= 4 ? lib : SLAP2;
          const tpl = r.chance(name === "drop" ? 0.45 : 0.2) || off > 0 ? r.pick(L) : L[state.slap[key] % L.length];
          for (const [b, d, ro, art, v] of tpl) {
            if (b >= span) continue;
            if (name === "intro" && h.start + off < 16) continue; // the bass enters at bar 5
            const note = ro === "A" && !lastChunk ? fifth : role[ro];
            E("bass", h.start + off + b, d, note, v * (name === "intro" ? 0.9 : 1), { art });
          }
        }
      });
      state.root = lastRoot;
      if (name === "drop") { // fills: an octave run down the chord into bars 5 and 1
        [12, 28].forEach((s) => {
          ev = ev.filter((e) => !(e.track === "bass" && e.beat >= s + 2.5 && e.beat < s + 4));
          const c = T.chord(sym(s + 3)), top = T.nearest(lastRoot + 12, c.pcs, 40, 50);
          [0, 1, 2, 3, 4, 5].forEach((j) => E("bass", s + 2.5 + j * 0.25, 0.2, T.step(top, -j, c.pcs), 0.8 - j * 0.03, { art: j % 2 ? "thumb" : "pop" }));
        });
      }

      // ---------- drums ----------
      const kick = (b, v) => E("kick", b, 0.1, "kick909", v);
      const fourFloor = !["drop"].includes(name);
      for (let bar = 0; bar < CYCLE; bar++) {
        const s = bar * 4, last = bar === CYCLE - 1;
        const buildBar = name === "build" || name === "rebuild";
        // kick
        if (fourFloor && !(buildBar && last) && !(name === "outro" && last)) for (let b = 0; b < 4; b++) kick(s + b, b === 0 ? 0.92 : 0.84);
        if (name === "outro" && last) kick(s, 0.85);
        if (buildBar && last) { kick(s, 0.9); kick(s + 1, 0.85); }
        // claps on 2 and 4, a snare808 underneath
        const clapsOn = !(name === "intro" && bar < 4) && !(name === "rebuild" && bar < 2) && !(buildBar && last);
        if (clapsOn) [1, 3].forEach((b) => { D(s + b, "clap", 0.78); if (name !== "drop") D(s + b, "snare808", 0.42); });
        if (name === "drop") { // the clap does the talking
          if (bar % 2) { D(s + 3.75, "clap", 0.42); }
          if (bar % 4 === 3) { D(s + 2.5, "clap", 0.5); D(s + 2.75, "clap", 0.46); }
        }
        // hats
        const hatsOn = name !== "drop" && !(name === "rebuild" && bar < 4) && !(buildBar && last);
        if (hatsOn) {
          for (let q = 0; q < 16; q++) {
            const b = q / 4;
            if (q % 4 === 2 && !(name === "intro" && bar < 4)) { D(s + b, "hatOpen", chorus ? 0.42 : 0.36); continue; }
            if (q % 4 === 3 && !(name === "intro" && bar < 4)) continue; // the open hat rings through the "a"
            D(s + b, "hatClosed", q % 4 === 0 ? 0.36 : 0.24 + r.range(-0.03, 0.03));
          }
        }
        // tambourine (choruses), congas and bongos (grooveB, second chorus)
        if (chorus) for (let q = 0; q < 16; q++) D(s + q / 4, "tambourine", q % 4 === 2 ? 0.36 : q % 2 ? 0.16 : 0.22);
        if (name === "grooveB" || (name === "chorus2" && bar >= 4)) {
          D(s + 0.75, "conga", 0.36, { pitch: 64 }); D(s + 1.5, "conga", 0.42, { pitch: 64 }); D(s + 2.5, "conga", 0.32, { pitch: 57 });
          D(s + 3, "conga", 0.44, { pitch: 57 }); D(s + 3.5, "bongo", 0.32, { pitch: 74 }); if (bar % 2) D(s + 3.75, "bongo", 0.28, { pitch: 76 });
        }
        // crashes on arrivals
        if (bar === 0 && (chorus || name === "grooveA" || (name === "grooveB" && prev && prev.name === "rebuild"))) D(s, "crash", chorus ? 0.6 : 0.45);
        if (bar === 4 && chorus) D(s, "crash", 0.4);
        // the snare roll of a build: quarters, 8ths, 16ths, then 32nds, crescendo
        if (buildBar && bar >= 4) {
          const step = bar === 4 ? 1 : bar === 5 ? 0.5 : bar === 6 ? 0.25 : 0.125;
          for (let b = 0; b < (last ? 3.5 : 4) - 1e-9; b += step) D(s + b, "snare808", 0.3 + 0.08 * (bar - 4) + 0.12 * (b / 4));
        }
        // fills at the end of grooves and choruses
        if (last && (name === "grooveA" || name === "grooveB" || name === "chorus1")) {
          [[3, 0.5], [3.25, 0.55], [3.5, 0.62], [3.75, 0.7]].forEach(([b, v]) => D(s + b, "snare808", v));
          D(s + 3.5, "clap", 0.6);
        }
      }

      // ---------- chops ----------
      const fitsAt = (e, b) => { const c = T.chord(sym(b)); return (Array.isArray(e.note) ? e.note : [e.note]).every((m) => c.pcs.includes(mod12(m))); };
      const stutter = (evs, at, len, slice) => stutterRaw(evs, at, len, slice, fitsAt);
      if (name === "grooveA" || name === "grooveB") ev = stutter(ev, 30, 2, r.pick([0.5, 0.25]));
      if (name === "intro") ev = stutter(ev, 14, 2, 0.5);
      if (name === "chorus1") { ev = stutter(ev, 13.5, 1, 0.25); ev = stutter(ev, 31, 1, 0.25); }
      if (name === "chorus2" && r.chance(0.7)) ev = stutter(ev, k === 0 && r.chance(0.5) ? 29.5 : 13.5, 1, r.pick([0.25, 0.125]));
      if (name === "build") { ev = stutter(ev, 28, 1.5, 0.5); ev = silence(ev, 31.5, 0.5); }
      if (name === "rebuild") ev = stutter(ev, 28, 4, 0.25);
      if (name === "outro") ev = stutter(ev, 24, 4, 1);

      // ---------- fx ----------
      const fx = (beat, dur, note, extra) => E("fx", beat, dur, note, 0.6, extra);
      if (name === "intro") fx(0, 30, "sweep", { from: 500, to: 16000 });
      else if (name === "build") { fx(0, 31.5, "sweep", { from: 900, to: 16000 }); fx(16, 15.5, "riser", { lvl: 1 }); }
      else if (name === "rebuild") { fx(0, 32, "sweep", { from: 350, to: 16000 }); fx(24, 8, "riser", { lvl: 0.8 }); }
      else if (name === "outro") fx(0, 30, "sweep", { from: 16000, to: 600 });
      else fx(0, 0.5, "sweep", { from: 16000, to: 16000 });
      if (name === "chorus2" && next.k !== k) fx(30.5, 1.5, "stop");

      // ---------- out ----------
      const events = ev.filter((e) => e.dur > 0.03).map((e) => { const p = C.at(e.beat, BPB); const { beat, ...rest } = e; return { ...rest, bar: p.bar, beat: p.beat }; });
      const harmony = prog.map((h) => { const p = C.at(h.start, BPB); return { bar: p.bar, beat: p.beat, dur: h.dur, chord: h.chord }; });
      const keyName = k ? "G" : "E";
      return { events, harmony, section: `${keyName} · ${P.label}`, state };
    },
  });
})();

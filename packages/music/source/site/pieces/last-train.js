// Last Train: dub-influenced trip-hop for the last subway train crossing a sleeping city.
// E minor at 72 BPM, straight 16ths. A heavy half-lit beat, a sub-bass riff with room around every
// note, organ skanks through a home-built spring, and a portamento sine "theremin" carrying a
// tune whose motif is a short note that swoops up a fifth (later a minor sixth) and sighs back down.
// Harmony leans on harmonic minor: bVI (C), the Neapolitan bII (Fmaj7#11) and a phrygian-dominant
// V (B7b9b13); the strings' section is a line cliché (Em, EmMaj9, Em7, Em6) that falls into it.
// Dub logic shapes the form: drums drop out for four bars, single snare hits and chord stabs are
// thrown into a filtered tape echo by opening their send for one hit, and the echo's feedback is
// swelled and cut at marked moments. One pass of the arc is 13 cycles of 8 bars (about 5.8 min).
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- harmony ----------
  const FORM = {
    A: "| Em9 | Em9 | Cmaj9 | Cmaj9 | Am9 | Am9 | F#m7b5 | B7b9b13 |",
    B: "| Am9 | Am9 | Em9 | Em9 | Fmaj7#11 | Fmaj7#11 | B7b9b13 | B7b9b13 |",
    D: "| Em9 | Em9 | Em9 | Em9 | Cmaj9 | Cmaj9 | F#m7b5 | B7b9b13 |",
    S: "| Em9 | EmMaj9 | Em7 | Em6 | Cmaj9 | Am9 | F#m7b5 | B7b9b13 |",
    C: "| Em9 | Em9 | Cmaj9 | Cmaj9 | Am9 | Am9 | EmMaj9 | EmMaj9 |",
  };
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));

  // ---------- tunes [bar, beat, dur, note] ----------
  const THEME = {
    // four two-bar phrases: short note, swoop up, sigh down. Peaks F#5, B5, C6, then the cadence.
    A: [
      [0, 1, 1, "B4"], [0, 2, 3, "F#5"], [1, 1.5, 0.5, "E5"], [1, 2, 2, "D5"],
      [2, 1, 1, "E5"], [2, 2, 3, "B5"], [3, 1.5, 0.5, "A5"], [3, 2, 2, "G5"],
      [4, 1, 1, "E5"], [4, 2, 3, "C6"], [5, 1, 0.5, "B5"], [5, 1.5, 0.5, "A5"], [5, 2, 2, "E5"],
      [6, 1, 1, "F#5"], [6, 2, 2, "A5"], [7, 0, 0.75, "G5"], [7, 0.75, 0.25, "F#5"], [7, 1, 2.75, "D#5"],
    ],
    // the answer: same rhythm, new pitches; the Neapolitan bars hold the #11, then a phrygian-dominant run
    B: [
      [0, 1, 1, "A4"], [0, 2, 3, "E5"], [1, 1.5, 0.5, "D5"], [1, 2, 2, "C5"],
      [2, 1, 1, "B4"], [2, 2, 3, "G5"], [3, 1.5, 0.5, "F#5"], [3, 2, 2, "D5"],
      [4, 1, 1, "E5"], [4, 2, 3, "B5"], [5, 1.5, 0.5, "G5"], [5, 2, 2, "A5"],
      [6, 1, 1, "F#5"], [6, 2, 2, "C6"], [7, 0, 0.5, "B5"], [7, 0.5, 0.5, "A5"], [7, 1, 0.5, "G5"], [7, 1.5, 0.5, "F#5"], [7, 2, 1.75, "D#5"],
    ],
    // the strings' tune over the line cliché: the motif augmented (fifths up, then a falling cadence)
    S: [
      [0, 0, 2, "B4"], [0, 2, 2, "F#5"], [1, 0, 3, "G5"], [1, 3, 1, "D#5"],
      [2, 0, 2, "E5"], [2, 2, 2, "B5"], [3, 0, 1.5, "A5"], [3, 1.5, 2.5, "G5"],
      [4, 0, 1, "E5"], [4, 1, 3, "B5"], [5, 0, 2, "C6"], [5, 2, 1, "B5"], [5, 3, 1, "A5"],
      [6, 0, 2, "A5"], [6, 2, 2, "E5"], [7, 0, 1, "G5"], [7, 1, 1, "F#5"], [7, 2, 2, "D#5"],
    ],
    // last words: the opening swoop, the high B, then the 9th and the major 7th of the Bond chord
    coda: [
      [0, 1, 1, "B4"], [0, 2, 3, "F#5"], [1, 1.5, 0.5, "E5"], [1, 2, 2, "D5"],
      [2, 1, 1, "E5"], [2, 2, 4, "B5"],
      [6, 1, 1, "B4"], [6, 2, 1.5, "F#5"], [6, 3.5, 4, "D#5"],
    ],
  };
  // the strings' own section voicings under THEME.S: an inner line E D# D C# C falls through the chords
  const S_VOICES = [
    ["E3", "B3", "E4", "G4"], ["E3", "B3", "D#4", "G4"], ["E3", "B3", "D4", "G4"], ["E3", "B3", "C#4", "G4"],
    ["C3", "G3", "C4", "E4"], ["A2", "E3", "G3", "C4"], ["F#2", "E3", "A3", "C4"], ["B2", "A3", "D#4", "G4"],
  ].map((v) => v.map(T.midi));
  const S_SWELL = [0.42, 0.6, 0.58, 0.74, 0.8, 1.0, 0.92, 0.78, 0.62]; // section gain at each barline

  // ---------- the arc: 13 cycles of 8 bars ----------
  // drums: none | main | full | half | dub | dub2 | thin. pad: sweep [Hz at start, Hz at end] or null.
  const PLAN = [
    { sec: "A", name: "Platform", drums: "intro", pad: [240, 1500], rails: [0.22, 0.6], horn: [1, 1], bass: "intro", d: "pad, rails, a horn far off" },
    { sec: "A", name: "Doors close", drums: "main", pad: [900, 1100], stabs: 1, rails: [0.45, 0.12], d: "beat and bass" },
    { sec: "A", name: "Theme", drums: "main", pad: [800, 1250], stabs: 1, mel: "A", d: "theremin" },
    { sec: "B", name: "Answer", drums: "main", shaker: 1, pad: [1000, 1600], stabs: 1, mel: "B", d: "theremin" },
    { sec: "D", name: "Dub", drums: "dub", pad: [500, 1400], padFrom: 4, stabs: "dub", mel: "frag", rails: [0.22, 0.14], d: "drums out, bass and echo" },
    { sec: "A", name: "Theme", drums: "main", hats: "16", stabs: 1, mel: "A", vary: 1, strings: "bed", d: "strings waking" },
    { sec: "B", name: "Answer", drums: "main", hats: "16", shaker: 1, pad: [900, 3200], stabs: 1, mel: "B", strings: "swell", stop: 1, d: "strings swelling" },
    { sec: "S", name: "The strings take over", drums: "half", strings: "lead", bass: "half", d: "line cliché" },
    { sec: "A", name: "All aboard", drums: "full", stabs: 1, strings: "theme", d: "strings carry the theme" },
    { sec: "D", name: "Deep dub", drums: "dub2", pad: [420, 1000], padFrom: 6, stabs: "dub", mel: "frag", deep: 1, rails: [0.2, 0.1], d: "bass and echo" },
    { sec: "A", name: "Theme", drums: "main", shaker: 1, pad: [1200, 900], stabs: 1, mel: "A", vary: 1, d: "theremin returns" },
    { sec: "B", name: "Answer", drums: "thin", pad: [900, 600], mel: "B", vary: 1, bass: "thin", d: "thinning out" },
    { sec: "C", name: "Terminus", drums: "none", pad: [1500, 210], mel: "coda", rails: [0.55, 0.16], horn: [2, 1], bass: "coda", d: "the train pulls away" },
  ];

  // ---------- rhythm cells ----------
  // kick patterns for a bar: [pos, vel]
  const KICKS = [
    [[0, 0.95], [2.5, 0.8]],
    [[0, 0.95], [1.75, 0.5], [2.5, 0.8]],
    [[0, 0.95], [0.75, 0.48], [2.5, 0.8]],
    [[0, 0.95], [2.25, 0.55], [2.75, 0.78]],
    [[0, 0.95], [2.5, 0.8], [3.75, 0.42]],
  ];
  // sub-bass riffs for a two-bar or one-bar chord: [pos, dur, role, vel]. Roles: R root, 3, 5, 7,
  // 8 octave, A approach (a scale step into the next root).
  const RIFF2 = {
    main: [[0, 1.6, "R", 0.9], [2.5, 0.4, "3", 0.7], [3, 0.9, "5", 0.75], [4.5, 1.4, "R", 0.82], [7, 0.45, "7", 0.66], [7.5, 0.42, "A", 0.6]],
    alt: [[0, 2.2, "R", 0.9], [2.75, 0.35, "R", 0.62], [3.25, 0.6, "3", 0.7], [4.5, 2, "R", 0.8], [7, 0.9, "A", 0.62]],
    dub: [[0, 3.2, "R", 0.9], [4.5, 0.45, "5", 0.66], [5, 2.3, "R", 0.84]],
    long: [[0, 3.3, "R", 0.72], [4.5, 2.8, "R", 0.66]],
  };
  const RIFF1 = {
    main: [[0, 1.6, "R", 0.9], [2.5, 0.4, "R", 0.68], [3, 0.9, "A", 0.72]],
    alt: [[0, 2.2, "R", 0.9], [3, 0.9, "A", 0.7]],
    dub: [[0, 3.3, "R", 0.88]],
    long: [[0, 3.4, "R", 0.72]],
    half: [[0, 2.6, "R", 0.86], [2.75, 1.1, "R", 0.6]],
  };
  // organ skank: offsets within a bar
  const STABS = [[[1.5], 3], [[3.5], 1.5], [[1.5, 2.75], 1], [[], 1.2]];

  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };
  const KEY = new Set(T.scale(4, "aeolian"));
  /** Semitones low in the texture, or anything closer than a minor third below G3, read as mud. */
  const muddy = (v, semi = 62) => v.some((m, i) => i > 0 && ((v[i - 1] < 55 && m - v[i - 1] < 3) || (v[i - 1] < semi && m - v[i - 1] === 1)));
  /** The smoothest clean voicing over several spreads, floors and voice counts. */
  function cleanVoice(sym, opts, r) {
    let best = null, bestS = Infinity;
    const n0 = opts.n ?? 4;
    const rl0 = opts.rootless ?? true;
    for (const [sy, pen] of [[sym, 0], [plain(sym), 2.5]]) for (const spread of ["any", "close", "drop2", "open"]) for (const dl of [0, 3, 5]) for (const n of n0 > 3 ? [n0, 3] : [n0]) for (const rootless of rl0 ? [true, false] : [false]) {
      const v = T.voice(sy, { ...opts, lo: opts.lo + dl, n, spread, rootless, rng: r }), pcs = T.chord(sy).pcs;
      // (T.voice's out-of-range fallback can return non-chord pitches, so check membership too)
      if (muddy(v, opts.semi) || new Set(v).size < v.length || v[0] < opts.lo || v[v.length - 1] > opts.hi || !v.every((m) => pcs.includes(mod12(m)))) continue;
      let s = pen + (n < n0 ? 2 : 0) + (rootless === rl0 ? 0 : 1.5);
      if (opts.prev && opts.prev.length) {
        const b = opts.prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - (opts.lo + opts.hi) / 2);
      if (opts.top) { const t = v[v.length - 1]; s += Math.max(0, opts.top[0] - t, t - opts.top[1]) * 1.5; }
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, opts);
  }
  /** Stabs are skanks, not jazz chords: drop the extensions. */
  const plain = (sym) => sym.replace(/(maj|mMaj)9/, "$17").replace(/m9/, "m7").replace(/7?b9b13$/, "7").replace(/7#11$/, "7");
  /** Equal neighbouring chords merged into one span. */
  const spansOf = (hAbs, maxLen = Infinity) => {
    const out = [];
    hAbs.forEach((h) => {
      const p = out[out.length - 1];
      if (p && p.chord === h.chord && p.end - p.start < maxLen) p.end = h.end;
      else out.push({ start: h.start, end: h.end, chord: h.chord });
    });
    return out;
  };

  // ---------- home-built instruments and effects ----------
  /** Theremin: a near-sine with a touch of 2nd and 3rd harmonic, slow attack, glide and wide vibrato. */
  function theremin(ctx, dest, volumeDb) {
    const out = ctx.keep(new Tone.Gain(db(volumeDb - 14))).connect(dest); // ~ calibrated to the library's volume 0
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 5.4, depth: 0.09 })).connect(out);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: 0.13,
      oscillator: { type: "custom", partials: [1, 0.07, 0.035] },
      filter: { type: "lowpass", rolloff: -12, Q: 0 },
      envelope: { attack: 0.14, decay: 0.3, sustain: 0.9, release: 0.75 },
      filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.5, baseFrequency: 3200, octaves: 0 },
    })).connect(vib);
    const mono = ctx.I.monotonic(s);
    return { out, play(t, note, dur, vel) { s.triggerAttackRelease(T.hz(note), dur, mono(t), vel); } };
  }

  /** Dub echo: a dotted-eighth tape delay with filters inside the feedback loop and a slow wow. */
  function dubEcho(ctx, dest, hall, spb, fbBase) {
    const input = ctx.keep(new Tone.Gain(1));
    const time = spb * 0.75;
    const delay = ctx.keep(new Tone.Delay(time, 2));
    const hp = ctx.keep(new Tone.Filter({ frequency: 300, type: "highpass" }));
    const lp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 }));
    const fb = ctx.keep(new Tone.Gain(fbBase));
    input.connect(delay); delay.connect(hp); hp.connect(lp); lp.connect(fb); fb.connect(delay);
    const wow = ctx.keep(new Tone.LFO({ frequency: 0.21, min: time - 0.0016, max: time + 0.0016 }).start());
    wow.connect(delay.delayTime);
    const grit = ctx.keep(new Tone.Distortion({ distortion: 0.15, wet: 0.3 })); // tape grit on the return only
    const ret = ctx.keep(new Tone.Gain(db(-4)));
    const pan = ctx.keep(new Tone.AutoPanner({ frequency: 0.07, depth: 0.6 }).start());
    lp.connect(grit); grit.connect(ret); ret.connect(pan); pan.connect(dest);
    ctx.I.send(ctx, ret, hall, -10);
    return { input, fb, lp };
  }

  /** Spring-ish reverb: three short resonant combs (the metallic boing) into a bandpassed small reverb. */
  function spring(ctx, dest) {
    const input = ctx.keep(new Tone.Gain(1));
    const hp = ctx.keep(new Tone.Filter({ frequency: 380, type: "highpass" }));
    const sum = ctx.keep(new Tone.Gain(0.45));
    input.connect(hp);
    [[0.0297, 0.6], [0.0371, 0.54], [0.0433, 0.47]].forEach(([t, g]) => {
      const d = ctx.keep(new Tone.Delay(t, 0.1)), f = ctx.keep(new Tone.Gain(g));
      hp.connect(d); d.connect(f); f.connect(d); d.connect(sum);
    });
    const bp = ctx.keep(new Tone.Filter({ frequency: 1700, type: "bandpass", Q: 0.6 }));
    const verb = ctx.keep(new Tone.Reverb({ decay: 2.4, preDelay: 0.006, wet: 1 }));
    const pan = ctx.keep(new Tone.Panner(0.3));
    sum.connect(bp); bp.connect(verb); hp.connect(verb); verb.connect(pan); pan.connect(dest);
    return input;
  }

  /** Vinyl bed: pink hiss kept in the upper mids plus sparse dust pops. */
  function vinyl(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(db(-31))).connect(dest);
    const lp = ctx.keep(new Tone.Filter({ frequency: 7000, type: "lowpass" })).connect(g);
    const hp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "highpass" })).connect(lp);
    const hiss = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 2, decay: 0.1, sustain: 1, release: 2 } })).connect(hp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 0.8 })).connect(g);
    const pop = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.006, sustain: 0, release: 0.003 } })).connect(bp);
    pop.volume.value = 5;
    const mh = ctx.I.monotonic(hiss), mp = ctx.I.monotonic(pop);
    return (t, e, d) => { if (e.note === "hiss") hiss.triggerAttackRelease(d, mh(t), e.vel); else pop.triggerAttackRelease(0.004, mp(t), e.vel); };
  }

  /** Rails: a click and a low thunk for each wheel crossing a joint. */
  function rails(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(db(-25))).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ frequency: 1300, type: "bandpass", Q: 1.6 })).connect(g);
    const click = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } })).connect(bp);
    const lp = ctx.keep(new Tone.Filter({ frequency: 240, type: "lowpass" })).connect(g);
    const thunk = ctx.keep(new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.03 } })).connect(lp);
    thunk.volume.value = 6;
    const m1 = ctx.I.monotonic(click), m2 = ctx.I.monotonic(thunk);
    return { out: g, play(t, e) { click.triggerAttackRelease(0.03, m1(t), e.vel); thunk.triggerAttackRelease(0.05, m2(t), e.vel * 0.8); } };
  }

  /** A distant two-note horn whose pitch sags as it passes (doppler). */
  function horn(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(db(-27))).connect(dest);
    const lp = ctx.keep(new Tone.Filter({ frequency: 650, type: "lowpass", Q: 0.7 })).connect(g);
    const voices = [-6, 6].map((cents) => {
      const s = ctx.keep(new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.45, decay: 0.2, sustain: 0.9, release: 1.8 } })).connect(lp);
      return { s, cents, mono: ctx.I.monotonic(s) };
    });
    return {
      out: g,
      play(t, notes, d, vel) {
        (Array.isArray(notes) ? notes : [notes]).slice(0, 2).forEach((m, i) => {
          const v = voices[i], tt = v.mono(t);
          v.s.detune.cancelScheduledValues(tt);
          v.s.detune.setValueAtTime(v.cents, tt);
          v.s.detune.linearRampToValueAtTime(v.cents - 70, tt + d + 1.8);
          v.s.triggerAttackRelease(T.hz(m), d, tt, vel);
        });
      },
    };
  }

  const FB_BASE = 0.38, TH_ECHO = 0.1;

  Sim.register({
    id: "last-train",
    title: "Last Train",
    genre: "Downtempo",
    about: "Dub-scented trip-hop in E minor for the last train across a sleeping city: a heavy straight beat, a sub-bass riff with space around it, organ skanks in a spring, a lonely theremin, echo throws and drop-outs, and a harmonic-minor string section that takes over halfway.",
    bpm: 72, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: -2,

    instruments(ctx) {
      const { I, out, bpm } = ctx;
      const spb = 60 / bpm;
      const hall = I.reverb(ctx, out, { decay: 6.5, preDelay: 0.05, lowcut: 320, highcut: 5000 });
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.012, lowcut: 260, highcut: 6000 });
      const plate = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.022, lowcut: 500, highcut: 7000 });
      const echo = dubEcho(ctx, out, hall, spb, FB_BASE);
      const springIn = spring(ctx, out);

      // melody
      const thPan = ctx.keep(new Tone.Panner(0.12)).connect(out);
      const th = theremin(ctx, thPan, -2);
      I.send(ctx, thPan, hall, -7);
      const thEcho = I.send(ctx, thPan, echo.input, 20 * Math.log10(TH_ECHO));
      const violins = I.strings(ctx, { volume: -4, attack: 0.16, release: 1.5, cutoff: 3000 });
      const vp = I.place(ctx, violins, 0.24, out); I.send(ctx, vp, hall, -8);

      // harmony
      const section = I.strings(ctx, { volume: -6, attack: 0.9, release: 2.2, cutoff: 1900 });
      const secSwell = ctx.keep(new Tone.Gain(0.5));
      const secPan = ctx.keep(new Tone.Panner(-0.22)).connect(out);
      section.out.connect(secSwell); secSwell.connect(secPan);
      I.send(ctx, secPan, hall, -9);
      const pad = I.pad(ctx, { volume: -9, cutoff: 2400, attack: 2.2, release: 4, detune: 18 });
      const sweep = ctx.keep(new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -24, Q: 2.2 }));
      const padPan = ctx.keep(new Tone.Panner(0.05)).connect(out);
      pad.out.connect(sweep); sweep.connect(padPan);
      I.send(ctx, padPan, hall, -12);
      const organ = I.organ(ctx, { volume: -13, partials: [1, 0.3, 0.55, 0.08, 0.22, 0.04] });
      const orgHp = ctx.keep(new Tone.Filter({ frequency: 420, type: "highpass" }));
      const orgPan = ctx.keep(new Tone.Panner(-0.32)).connect(out);
      organ.out.connect(orgHp); orgHp.connect(orgPan);
      I.send(ctx, orgPan, springIn, 0);
      const stabEcho = I.send(ctx, orgPan, echo.input, -60);
      stabEcho.gain.value = 0;

      // bass: a pure sub with a quiet triangle on top so the riff reads on small speakers
      const sub = I.sub(ctx, { volume: -2, attack: 0.012, release: 0.25 });
      const growl = I.analog(ctx, { volume: -18, wave: "triangle", base: 220, octaves: 1.2, resonance: 0.8, attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.2, filterDecay: 0.3 });
      I.place(ctx, sub, 0, out);
      const gp = I.place(ctx, growl, 0, out); I.send(ctx, gp, room, -18);

      // drums: kit (kick, hats, rim, toms) and a separate snare channel whose echo send is thrown
      const drumBus = ctx.keep(new Tone.Filter({ frequency: 6500, type: "lowpass", rolloff: -12 }));
      const dirt = ctx.keep(new Tone.Distortion({ distortion: 0.08, wet: 0.2 }));
      drumBus.connect(dirt); dirt.connect(out);
      I.send(ctx, drumBus, room, -14);
      const kit = I.kit(ctx, { volume: -3, kickNote: 28, preload: ["kick", "hatClosed", "hatOpen", "rim", "shaker"] });
      I.place(ctx, kit, 0.04, drumBus);
      const snr = I.kit(ctx, { volume: -3, preload: ["snare"] });
      const sp = I.place(ctx, snr, 0.02, drumBus);
      I.send(ctx, sp, plate, -9);
      const snEcho = I.send(ctx, sp, echo.input, -60);
      snEcho.gain.value = 0;

      // texture
      const vin = vinyl(ctx, out);
      const railPan = ctx.keep(new Tone.Panner(-0.15)).connect(out);
      const rail = rails(ctx, railPan);
      I.send(ctx, railPan, room, -6); I.send(ctx, railPan, hall, -14);
      const hornPan = ctx.keep(new Tone.Panner(0.35)).connect(out);
      const hn = horn(ctx, hornPan);
      I.send(ctx, hornPan, hall, 2);

      /** Open a send for one hit, then close it: the dub "throw". */
      const gate = (g, t, amt, len) => {
        g.gain.cancelScheduledValues(t - 0.012);
        g.gain.setValueAtTime(0, t - 0.012);
        g.gain.linearRampToValueAtTime(amt, t - 0.002);
        g.gain.setValueAtTime(amt, t + len);
        g.gain.linearRampToValueAtTime(0, t + len + 0.04);
      };

      return {
        theremin: {
          layer: "melody",
          play(t, e, d) {
            if (e.throw) { // ride the send up through the end of the note, then let the echo carry it
              const g = thEcho.gain, a = t + d * 0.4, b = t + d * 0.85;
              g.cancelScheduledValues(a);
              g.setValueAtTime(TH_ECHO, a);
              g.linearRampToValueAtTime(e.throw, b);
              g.setValueAtTime(e.throw, t + d + 0.08);
              g.linearRampToValueAtTime(TH_ECHO, t + d + 0.4);
            }
            th.play(t, e.note, d, e.vel);
          },
          humanize: { timing: 0.016, vel: 0.04 },
        },
        violins: { layer: "melody", play: (t, e, d) => violins.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.03 } },
        section: {
          layer: "harmony",
          play(t, e, d) {
            if (e.sw) { const g = secSwell.gain; g.cancelScheduledValues(t); g.setValueAtTime(e.sw[0], t); g.linearRampToValueAtTime(e.sw[1], t + e.swDur * spb); }
            section.play(t, e.note, d, e.vel);
          },
          humanize: { timing: 0, vel: 0 },
        },
        pad: {
          layer: "harmony",
          play(t, e, d) {
            if (e.sw) { const f = sweep.frequency; f.cancelScheduledValues(t); f.setValueAtTime(e.sw[0], t); f.exponentialRampToValueAtTime(e.sw[1], t + e.swDur * spb); }
            pad.play(t, e.note, d, e.vel);
          },
          humanize: { timing: 0, vel: 0 },
        },
        stab: {
          layer: "harmony",
          play(t, e, d) { if (e.throw) gate(stabEcho, t, e.throw, d + 0.05); organ.play(t, e.note, d, e.vel); },
          humanize: { timing: 0.005, vel: 0.06 },
        },
        bass: {
          layer: "bass",
          play(t, e, d) { sub.play(t, e.note, d, e.vel); growl.play(t, e.note, d, e.vel * 0.9); },
          humanize: { timing: 0.004, vel: 0.04 },
        },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.08 } },
        snare: {
          layer: "drums",
          play(t, e) { if (e.throw) gate(snEcho, t, e.throw, 0.16); snr.hit("snare", t, e.vel); },
          humanize: { timing: 0.004, vel: 0.05 },
        },
        // the dub desk: swell the echo feedback (and darken the loop), hold, then cut back
        desk: {
          layer: "texture",
          play(t, e) {
            const up = t + e.up * spb, hold = up + e.hold * spb, down = hold + e.down * spb;
            const g = echo.fb.gain, f = echo.lp.frequency;
            g.cancelAndHoldAtTime(t); g.linearRampToValueAtTime(e.peak, up); g.setValueAtTime(e.peak, hold); g.linearRampToValueAtTime(FB_BASE, down);
            f.cancelAndHoldAtTime(t); f.linearRampToValueAtTime(1500, up); f.setValueAtTime(1500, hold); f.linearRampToValueAtTime(2600, down);
          },
          humanize: { timing: 0, vel: 0 },
        },
        vinyl: { layer: "texture", play: vin, humanize: { timing: 0, vel: 0.2 } },
        rails: { layer: "texture", play: (t, e) => rail.play(t, e), humanize: { timing: 0.004, vel: 0.1 } },
        horn: { layer: "texture", play: (t, e, d) => hn.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % PLAN.length, round = Math.floor(cycle / PLAN.length);
      const plan = PLAN[idx], next = PLAN[(idx + 1) % PLAN.length];
      const harmony = PROG[plan.sec];
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * 4 + h.beat, end: h.bar * 4 + h.beat + h.dur }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const swells = []; // desk events, kept apart so they never overlap
      const swell = (abs, peak, up, hold, down) => {
        if (swells.some((s) => abs < s.end && abs + up + hold + down > s.abs)) return;
        swells.push({ abs, end: abs + up + hold + down });
        push("desk", abs, up + hold + down, "swell", 0.5, { peak, up, hold, down });
      };

      // per-round choices: the kick grooves and which bass riff each section family uses
      if (!state.groove || state.grooveRound !== round) {
        state.grooveRound = round;
        const pair = () => { const a = r.int(0, KICKS.length - 1); let b = r.int(0, KICKS.length - 1); if (b === a) b = (a + 1 + r.int(0, 2)) % KICKS.length; return [a, b]; };
        state.groove = { A: pair(), B: pair() };
        state.riff = { A: round % 2 ? r.pick(["main", "alt"]) : "main", B: round % 2 ? "main" : "alt" };
      }

      // ---- melody: theremin (or the violins when the strings take over) ----
      if (plan.mel) {
        const notes = [];
        const add = (src, barShift, opts = {}) => src.forEach(([bar, beat, dur, n]) => notes.push({ at: (bar + barShift) * 4 + beat + (opts.late || 0), dur, note: T.midi(n) + (opts.oct || 0), ph: Math.floor(bar / 2) }));
        if (plan.mel === "frag") {
          const A = THEME.A;
          const phrase = (p) => A.filter(([bar]) => Math.floor(bar / 2) === p);
          if (plan.deep) add(phrase(1), 2);
          else if (r.chance(0.6)) { add(phrase(0), 2); add(phrase(3), 0); }
          else add(phrase(0), 2, { oct: r.chance(0.5) ? -12 : 0 }); // alone, it may sink an octave
        } else if (plan.mel === "coda") add(THEME.coda, 0);
        else {
          const src = THEME[plan.mel];
          const vary = plan.vary || round > 0;
          let dropped = false;
          for (let p = 0; p < 4; p++) {
            const ph = src.filter(([bar]) => Math.floor(bar / 2) === p);
            let v = "orig";
            if (vary) v = r.weighted([["orig", 3], ["late", p < 3 ? 1.5 : 0], ["scoop", 1.5], ["drop", (p === 1 || p === 2) && !dropped && round > 0 ? 0.6 : 0]]);
            if (v === "drop") { dropped = true; continue; }
            add(ph, 0, { late: v === "late" ? 0.5 : 0 });
            if (v === "scoop") { // a grace a scale step below each long note reached from below: the theremin slides into it
              ph.forEach(([bar, beat, dur, n], i) => {
                if (dur < 2 || i === 0 || T.midi(ph[i - 1][3]) > T.midi(n)) return;
                const m = T.midi(n), sc = T.chord(chordAt(bar * 4 + beat).chord).scale, g = T.step(m, -1, sc);
                if (m - g <= 2 && g > T.midi(ph[i - 1][3])) notes.push({ at: bar * 4 + beat - 0.25, dur: 0.25, note: g, ph: p, grace: true });
              });
            }
          }
        }
        notes.sort((a, b) => a.at - b.at || (a.grace ? -1 : 1));
        // legato but never overlapping, and nothing held into a chord where it clashes
        const clean = notes.filter((n, i) => !(i > 0 && Math.abs(notes[i - 1].at - n.at) < 1e-6));
        clean.forEach((n, i) => {
          if (i + 1 < clean.length) n.dur = Math.min(n.dur, clean[i + 1].at - n.at - 0.04);
          n.dur = Math.min(n.dur, 31.8 - n.at);
          const ok = okSet(chordAt(n.at).chord);
          if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]);
          for (const h of hAbs) {
            if (h.start > n.at + 0.01 && h.start < n.at + n.dur - 0.1 && !okSet(h.chord).has(mod12(n.note))) { n.dur = Math.max(0.2, h.start - n.at - 0.05); break; }
          }
        });
        // which notes get thrown into the echo: phrase-final long notes
        const lastOf = (p) => { const xs = clean.filter((n) => n.ph === p && !n.grace); return xs[xs.length - 1]; };
        const throwP = plan.mel === "frag" ? 1 : 0.4;
        [1, 3, 0].forEach((p) => { const n = lastOf(p); if (n && n.dur >= 1.5 && r.chance(p === 0 ? throwP * 0.5 : throwP)) n.throw = r.range(0.55, 0.8); });
        clean.forEach((n) => {
          const vel = (n.grace ? 0.5 : n.dur >= 1.5 ? 0.74 : 0.64) + r.gauss(0.02);
          if (n.dur > 0.1) push("theremin", n.at, n.dur, n.note, vel, n.throw ? { throw: n.throw } : undefined);
        });
      }

      // ---- strings ----
      if (plan.strings === "lead") {
        THEME.S.forEach(([bar, beat, dur, n]) => {
          const m = T.midi(n);
          push("violins", bar * 4 + beat, dur - 0.05, [m - 12, m], (dur >= 2 ? 0.66 : 0.6) + r.gauss(0.02));
        });
        S_VOICES.forEach((v, bar) => push("section", bar * 4, 3.95, v, 0.62, { sw: [S_SWELL[bar], S_SWELL[bar + 1]], swDur: 4 }));
      } else if (plan.strings) {
        const theme = plan.strings === "theme";
        if (theme) {
          const ns = THEME.A.map(([bar, beat, dur, n]) => ({ at: bar * 4 + beat, dur, note: T.midi(n) }));
          ns.forEach((n, i) => {
            const dur = i + 1 < ns.length ? Math.min(n.dur, ns[i + 1].at - n.at - 0.03) : n.dur;
            push("violins", n.at, dur, [n.note - 12, n.note], (n.dur >= 2 ? 0.6 : 0.52) + r.gauss(0.02));
          });
        }
        if (plan.strings === "swell") push("violins", 16, 15.6, [T.midi("B3"), T.midi("B4")], 0.4); // a held B: #11 of the bII, root of V
        const g0 = plan.strings === "bed" ? 0.36 : plan.strings === "swell" ? 0.3 : 0.62;
        const g1 = plan.strings === "bed" ? 0.5 : plan.strings === "swell" ? 1.0 : 0.85;
        spansOf(hAbs).forEach((h) => {
          const v = cleanVoice(h.chord, theme ? { lo: 48, hi: 64, n: 3, prev: state.secV, top: [58, 64] } : { lo: 55, hi: 74, n: 3, prev: state.secV, top: [66, 72], semi: 67 }, r);
          state.secV = v;
          const a = g0 + (g1 - g0) * (h.start / 32), b = g0 + (g1 - g0) * (h.end / 32);
          push("section", h.start, h.end - h.start - 0.05, v, 0.58, { sw: [a, b], swDur: h.end - h.start });
        });
      } else state.secV = null;

      // ---- pad, with a filter sweep across the cycle ----
      if (plan.pad) {
        const [f0, f1] = plan.pad, from = (plan.padFrom || 0) * 4;
        const f = (b) => f0 * Math.pow(f1 / f0, (b - from) / (32 - from));
        spansOf(hAbs.filter((h) => h.start >= from)).forEach((h) => {
          const v = cleanVoice(h.chord, { lo: 52, hi: 71, n: 4, prev: state.padV, top: [62, 69], semi: 67 }, r);
          state.padV = v;
          push("pad", h.start, h.end - h.start - 0.05, v, 0.5, { sw: [f(h.start), f(h.end)], swDur: h.end - h.start });
        });
      }

      // ---- organ skanks into the spring; thrown into the echo at marked spots ----
      const stab = (abs, thr) => {
        const h = chordAt(abs);
        const v = cleanVoice(plain(h.chord), { lo: 59, hi: 72, n: 3, prev: state.stabV, top: [66, 71], rootless: false }, r);
        state.stabV = v;
        push("stab", abs, 0.2, v, 0.5 + r.range(-0.04, 0.05), thr ? { throw: thr } : undefined);
      };
      if (plan.stabs === 1) {
        for (let bar = 0; bar < 8; bar++) {
          if (r.chance(0.25)) continue;
          const pat = r.weighted(STABS);
          pat.forEach((o, i) => {
            const thr = (bar === 3 || bar === 7) && i === pat.length - 1 && r.chance(0.35) ? r.range(0.6, 0.85) : 0;
            stab(bar * 4 + o, thr);
          });
        }
      } else if (plan.stabs === "dub") {
        const spots = plan.deep ? [[1, 1.5], [3, 3.5], [5, 1.5]] : [[0, 1.5], [2, 1.5], [3, 3.5], [5, 1.5], [6, 2.75]];
        spots.forEach(([bar, o]) => stab(bar * 4 + o, r.range(0.75, 0.95)));
      } else if (idx === 0) stab(6 * 4 + 1.5, 0.85); // the intro announces the echo

      // ---- dub desk: feedback swells ----
      if (plan.drums === "dub") { swell(1.5, 0.68, 2, 8, 3); swell(5 * 4 + 1.5, 0.58, 1, 3, 3); }
      if (plan.drums === "dub2") { swell(4, 0.78, 3, 7.5, 0.5); swell(5 * 4 + 2, 0.6, 1, 2, 4); }

      // ---- sub bass ----
      // spans: consecutive equal chords merged, at most two bars long
      const spans = spansOf(hAbs, 8);
      const rootOf = (sym) => T.nearest(30, [T.chord(sym).bass], 28, 39);
      const nextFirst = PROG[next.sec][0].chord;
      const bassMode = (bar) => {
        const m = plan.bass || (plan.drums === "dub" ? (bar < 4 ? "dub" : "riff") : plan.drums === "dub2" ? (bar < 6 ? "dub" : "riff") : "riff");
        if (m === "intro") return bar < 4 ? null : "long";
        if (m === "thin") return bar < 6 ? "riff" : "long";
        if (m === "coda") return "long";
        return m;
      };
      let last = state.bassLast ?? 28;
      spans.forEach((sp, si) => {
        const len = sp.end - sp.start, bar = sp.start / 4;
        const mode = bassMode(bar);
        if (!mode) return;
        const c = T.chord(sp.chord), root = rootOf(sp.chord), sc = okSet(sp.chord);
        const nextRoot = rootOf(si + 1 < spans.length ? spans[si + 1].chord : nextFirst);
        const family = plan.sec === "B" ? "B" : "A";
        let cell;
        if (mode === "riff") cell = len >= 8 ? RIFF2[state.riff[family]] : RIFF1[bar === 7 && r.chance(0.3) ? "alt" : "main"];
        else if (mode === "half") cell = RIFF1.half;
        else cell = (len >= 8 ? RIFF2 : RIFF1)[mode] || RIFF1.long;
        if (plan.bass === "coda" && bar >= 6) cell = [[0, 7.4, "R", 0.7]];
        const iv = c.intervals;
        const third = iv.includes(3) ? 3 : iv.includes(4) ? 4 : 5;
        const fifth = iv.find((x) => x >= 6 && x <= 8);
        const sev = iv.includes(10) ? 10 : iv.includes(11) ? 11 : iv.includes(9) ? 9 : 12;
        cell.forEach(([pos, dur, role, vel]) => {
          if (pos >= len - 0.01) return;
          let n;
          if (role === "R") n = root;
          else if (role === "3") n = root + third;
          else if (role === "5") n = root + (fifth ?? 12); // altered dominants have no fifth: use the octave
          else if (role === "7") n = root + sev - 12 >= 28 ? root + sev - 12 : root + sev; // under the root when it fits
          else if (role === "8") n = root + 12;
          else { // approach: a scale tone a step from the next root, nearest to where the line is
            const cands = [2, -1, -2, 1].map((s) => nextRoot + s).filter((m) => m >= 28 && m <= 45 && sc.has(mod12(m)) && (KEY.has(mod12(m)) || c.pcs.includes(mod12(m))) && m !== last);
            n = cands.length ? cands.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a)) : nextRoot + 2;
          }
          push("bass", sp.start + pos, Math.min(dur, len - pos - 0.05), n, vel);
          last = n;
        });
      });
      state.bassLast = last;

      // ---- drums ----
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, vel, extra);
      const SN = (abs, vel, thr) => push("snare", abs, 0.1, "snare", vel, { delay: 0.018, ...(thr ? { throw: thr } : {}) });
      const groove = state.groove[plan.sec === "B" ? "B" : "A"];
      const mode = plan.drums;
      const fills = {};
      if (mode === "main" || mode === "full") {
        if (plan.stop) fills[7] = "stop";
        else if (next.drums === "dub" || next.drums === "dub2") fills[7] = "throw";
        else fills[7] = r.weighted([[null, 2], ["throw", 3], ["tom", 1], ["drop", 1]]);
        if (r.chance(0.22)) fills[3] = "throw";
      }
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        let kicks = KICKS[groove[bar % 2]], snare = "back", hats = mode === "full" ? "16" : plan.hats || "8", shaker = mode === "full" || !!plan.shaker, rim = 0.25;
        const fill = fills[bar] || null;
        if (mode === "intro" || mode === "none") { kicks = null; snare = null; hats = null; }
        else if (mode === "dub" && bar < 4) { kicks = null; snare = null; hats = null; }
        else if (mode === "dub2") {
          if (bar < 4) { kicks = null; snare = null; hats = null; }
          else if (bar < 6) { kicks = [[0, 1], [2.5, 0.7]]; snare = "rim"; hats = null; }
          else hats = bar === 6 ? null : "8";
        } else if (mode === "half") {
          kicks = [[0, 0.9], [2.75, 0.45]];
          snare = bar < 4 ? "rim2" : "half";
          hats = bar < 4 ? null : "8soft";
          rim = 0;
        } else if (mode === "thin") {
          if (bar < 6) { kicks = KICKS[0]; hats = "4"; rim = 0; }
          else { kicks = bar === 6 ? [[0, 0.8]] : null; snare = bar === 6 ? "rim" : null; hats = null; rim = 0; }
        }
        if (mode === "dub" && bar === 4) kicks = [[0, 1], ...KICKS[groove[0]].slice(1)];
        const stopAt = fill === "stop" ? 0.5 : fill === "drop" ? 2.5 : fill === "tom" ? 3.25 : 4;
        const busy = new Set();
        if (kicks) kicks.forEach(([p, v]) => { if (p < stopAt) { D(B + p, "kick", v); busy.add(p); } });
        if (hats) {
          const open = (hats === "8" || hats === "16") && bar % 2 === 1 && r.chance(0.35) && stopAt >= 4;
          for (let s = 0; s < 16; s++) {
            const p = s / 4, q = s % 4;
            if (p >= stopAt || (open && p >= 3.5)) break;
            if (hats === "16") { if (q === 1 && r.chance(0.3)) continue; D(B + p, "hatClosed", [0.3, 0.1, 0.19, 0.12][q] + r.gauss(0.02)); }
            else if (hats === "8" || hats === "8soft") {
              const k = hats === "8soft" ? 0.6 : 1;
              if (q === 0) D(B + p, "hatClosed", k * 0.3 + r.gauss(0.02));
              else if (q === 2) D(B + p, "hatClosed", k * 0.19 + r.gauss(0.02));
              else if (q === 3 && hats === "8" && r.chance(0.18)) D(B + p, "hatClosed", 0.1);
            } else if (hats === "4" && q === 0) D(B + p, "hatClosed", 0.2 + r.gauss(0.02));
          }
          if (open) D(B + 3.5, "hatOpen", 0.26 + r.gauss(0.02));
        }
        if (shaker) for (let s = 0; s < 16 && s / 4 < stopAt; s++) {
          if (s % 2) continue; // eighths: the hats carry the sixteenths
          D(B + s / 4, "shaker", [0.12, 0.06, 0.16, 0.08][s % 4] + r.gauss(0.015));
        }
        // backbeat, laid back
        if (snare === "back") {
          if (stopAt > 1) SN(B + 1, 0.78);
          if (stopAt > 3 && !(plan.stop && bar === 6)) SN(B + 3, 0.84, fill === "throw" ? r.range(0.75, 0.95) : 0);
        } else if (snare === "half") SN(B + 2, 0.86, bar === 7 ? 0.85 : 0);
        else if (snare === "rim2") D(B + 2, "rim", 0.32);
        else if (snare === "rim") { D(B + 1, "rim", 0.26); D(B + 3, "rim", 0.3); }
        if (rim && snare === "back" && r.chance(rim)) {
          const p = r.pick([0.75, 2.75, 3.75].filter((x) => !busy.has(x) && x < stopAt));
          if (p != null) D(B + p, "rim", 0.16 + r.range(0, 0.06));
        }
        if (fill === "tom") [[3.25, 52, 0.42], [3.5, 47, 0.48], [3.75, 43, 0.52]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch }));
        if (fill === "throw") swell(B + 3, 0.6, 0.25, 1.5, 3);
      }
      // single thrown snares where the kit is silent: the intro's count-in, the dub's return, the swell's stop
      if (mode === "intro") { SN(7 * 4 + 3, 0.8, 0.9); swell(7 * 4 + 3, 0.62, 0.25, 1.5, 3); }
      if (mode === "dub" || mode === "dub2") SN(3 * 4 + 3, 0.82, 0.92);
      if (plan.stop) { SN(6 * 4 + 3, 0.84, 0.9); swell(6 * 4 + 3, 0.66, 0.25, 4, 3); }

      // ---- texture: vinyl, rails, horn ----
      const quiet = !plan.drums || ["intro", "none", "dub", "dub2", "half"].includes(mode);
      push("vinyl", 0, 31.8, "hiss", quiet ? 0.9 : 0.7);
      for (let bar = 0; bar < 8; bar++) {
        const n = r.int(1, quiet ? 6 : 4), used = new Set();
        for (let i = 0; i < n; i++) {
          const p = Math.round(r.range(0, 3.95) * 32) / 32;
          if (used.has(p)) continue; used.add(p);
          push("vinyl", bar * 4 + p, 0.05, "pop", 0.2 + r() * r() * 0.8);
        }
      }
      if (plan.rails) {
        const [v0, v1] = plan.rails, bars = plan.drums === "dub" || plan.drums === "dub2" ? 4 : plan.drums === "main" ? 3 : 8;
        for (let bar = 0; bar < bars; bar++) {
          const v = v0 + (v1 - v0) * (bar / Math.max(1, bars - 1));
          [[0.5, 0.7], [0.75, 1], [2.5, 0.65], [2.75, 0.95]].forEach(([p, k]) => push("rails", bar * 4 + p, 0.1, "clack", v * k));
        }
      }
      if (plan.horn) push("horn", plan.horn[0] * 4 + plan.horn[1], 6, [T.midi("B3"), T.midi("D4")], 0.6);

      const label = [plan.name, plan.d, round > 0 ? `run ${round + 1}` : null].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: label, state };
    },
  });
})();

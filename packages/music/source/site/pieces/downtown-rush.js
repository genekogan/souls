// Downtown Rush: late-90s city-builder jazz-funk fusion, the music you zone a downtown to. B♭ major / C dorian.
//
// Form: sixteen 8-bar phrases (about five minutes), then again with the soloists swapped:
//   intro vamp · A · A′ · bridge · A · rush hour ×2 · midday lull ×2 · A′ · bridge · rush hour ×2 (the second a
//   brass shout) · A up a whole step in C · A′ (turns home) · lull
// Harmony is written in C and sounded a step lower:
//   A      ii–V chains with a V/ii (Dm9 G13 | Em9 A7b13), a lydian IV, and an A7#9 whose #9 → 3 the head
//          always plays into the next downbeat.
//   A′     bVII lydian (Bbmaj7#11) on the head's high point, then ii–V home to the bridge's I.
//   bridge a chromatic descent of maj7#11 and m9 colours (C Bb A Ab G F, then the backdoor Fm9 Bb13).
//   rush   a dorian vamp (Dm9 / G13) with Bbmaj7#11 → A7#9; the groove doubles up (four-on-the-floor kick,
//          open hats on every "and", 16th tambourine, slap bass pops) and the tempo pushes from 104 to 108.
//   lull   I–IV lydian float (Cmaj9 Fmaj7#11) with the band thinned to cross-stick, pedal hat and congas.
// The second rush hour ends on A7#9, which cadences deceptively into the lull's Imaj9: the traffic clears.
// Percussion: a funk kit locked to the bass, ghost notes, 16th hats with barks closed by the pedal, congas
// and shaker that come and go, tambourine in the rush, timbale fills into the busy sections, crash on arrivals.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  const FORM = {
    intro: "| Dm9 | G13 | Dm9 | G13 | Dm9 | G13 | Bbmaj7#11 | Em7 A7#9 |",
    A: "| Dm9 | G13 | Em9 | A7b13 | Dm9 | G13 | Cmaj9 Fmaj7#11 | Em7 A7#9 |",
    A2: "| Dm9 | G13 | Em9 | A7b13 | Dm9 | Bbmaj7#11 | Em9 A7b13 | Dm9 G13 |",
    B: "| Cmaj9 | Bbmaj7#11 | Am9 | Abmaj7#11 | Gm9 C13 | Fmaj7#11 | Fm9 Bb13 | Em7 A7#9 |",
    R1: "| Dm9 | Dm9 | G13 | G13 | Dm9 | Dm9 | Bbmaj7#11 | A7#9 |",
    R2: "| Dm9 | G13 | Dm9 | G13 | Em9 | A7b13 | Bbmaj7#11 | A7#9 |",
    L1: "| Cmaj9 | Fmaj7#11 | Cmaj9 | Fmaj7#11 | Em9 | Am9 | Dm9 | G13sus4 |",
    L2: "| Cmaj9 | Fmaj7#11 | Cmaj9 | Fmaj7#11 | Em9 | Am9 | Bbmaj7#11 | Em7 A7#9 |",
  };
  const HOME = -2, LIFT = 0;
  // style: head | rush | lull | intro. turn: the last bar is written in the next phrase's key.
  const PLAN = [
    { sec: "intro", style: "intro", key: HOME, d: "Intro · the vamp" },
    { sec: "A", style: "head", key: HOME, head: 1, d: "A · sax head" },
    { sec: "A2", style: "head", key: HOME, head: 1, brass: 1, d: "A′ · sax head, brass" },
    { sec: "B", style: "head", key: HOME, head: 1, brass: 1, d: "Bridge · the long way down" },
    { sec: "A", style: "head", key: HOME, head: 1, vary: 1, brass: 1, d: "A · head again" },
    { sec: "R1", style: "rush", key: HOME, solo: "s1", d: "Rush hour" },
    { sec: "R2", style: "rush", key: HOME, solo: "s1", brass: 1, d: "Rush hour · brass" },
    { sec: "L1", style: "lull", key: HOME, lull: 1, d: "Midday lull" },
    { sec: "L2", style: "lull", key: HOME, lull: 2, d: "Midday lull · picking up" },
    { sec: "A2", style: "head", key: HOME, head: 1, vary: 1, brass: 1, d: "A′ · sax head" },
    { sec: "B", style: "head", key: HOME, head: 1, brass: 1, vary: 1, d: "Bridge" },
    { sec: "R1", style: "rush", key: HOME, solo: "s2", d: "Rush hour" },
    { sec: "R2", style: "rush", key: HOME, solo: "sax", brass: 2, turn: 1, d: "Rush hour · brass shout" },
    { sec: "A", style: "head", key: LIFT, head: 1, brass: 1, dbl: 1, d: "A · up a step, flute doubles" },
    { sec: "A2", style: "head", key: LIFT, head: 1, brass: 1, dbl: 1, turn: 1, d: "A′ · turning home" },
    { sec: "L2", style: "lull", key: HOME, lull: 3, d: "Midday lull · winding down" },
  ];

  // ---------- tunes (in C) [bar, beat, dur, note] ----------
  const HEAD_FRONT = [
    [0, 0, 0.5, "D5"], [0, 0.5, 0.25, "F5"], [0, 0.75, 0.75, "E5"], [0, 1.5, 0.5, "C5"], [0, 2, 0.25, "A4"], [0, 2.25, 0.25, "C5"], [0, 2.5, 1, "D5"],
    [1, 0.5, 0.25, "G5"], [1, 0.75, 0.25, "F5"], [1, 1, 1.5, "E5"], [1, 3, 0.5, "D5"], [1, 3.5, 0.5, "B4"],
    [2, 0, 0.5, "E5"], [2, 0.5, 0.25, "G5"], [2, 0.75, 0.75, "F#5"], [2, 1.5, 0.5, "D5"], [2, 2, 0.25, "B4"], [2, 2.25, 0.25, "D5"], [2, 2.5, 1, "E5"],
    [3, 0.5, 0.25, "G5"], [3, 0.75, 0.25, "F5"], [3, 1, 1.5, "E5"], [3, 3, 0.5, "C#5"], [3, 3.5, 0.5, "A4"],
    [4, 0, 0.5, "D5"], [4, 0.5, 0.25, "F5"], [4, 0.75, 0.75, "E5"], [4, 1.5, 0.5, "C5"], [4, 2, 0.25, "A4"], [4, 2.25, 0.25, "C5"], [4, 2.5, 1, "D5"],
  ];
  const HEAD_A = [ // G13's 9th at the top, the lydian #11 over IV, then the #9 → 3 into the next downbeat
    [5, 0.5, 0.25, "F5"], [5, 0.75, 0.25, "G5"], [5, 1, 1, "A5"], [5, 2, 0.5, "G5"], [5, 2.5, 0.5, "E5"], [5, 3, 1, "D5"],
    [6, 0, 1, "E5"], [6, 1, 0.5, "D5"], [6, 1.5, 0.5, "B4"], [6, 2, 0.5, "A4"], [6, 2.5, 1.5, "B4"],
    [7, 0.5, 0.25, "D5"], [7, 0.75, 0.25, "E5"], [7, 1, 1, "G5"], [7, 2, 0.5, "C5"], [7, 2.5, 1.25, "C#5"],
  ];
  const HEAD_A2 = [ // same climb, but the top lands on Bbmaj7's #11; ends on G13's 3rd, leaning into the bridge
    [5, 0.5, 0.25, "F5"], [5, 0.75, 0.25, "G5"], [5, 1, 1, "A5"], [5, 2, 0.5, "G5"], [5, 2.5, 1.5, "E5"],
    [6, 0, 0.5, "D5"], [6, 0.5, 0.5, "B4"], [6, 1, 1, "G5"], [6, 2, 0.5, "F5"], [6, 2.5, 1.5, "E5"],
    [7, 0.5, 0.25, "A4"], [7, 0.75, 0.25, "C5"], [7, 1, 1, "E5"], [7, 2, 0.5, "D5"], [7, 2.5, 1.25, "B4"],
  ];
  const BRIDGE = [ // long tones riding the chromatic descent; each lydian chord gets its #11
    [0, 0, 1.5, "E5"], [0, 1.5, 0.5, "D5"], [0, 2, 2, "B4"],
    [1, 0.5, 0.5, "C5"], [1, 1, 0.5, "D5"], [1, 1.5, 2.5, "E5"],
    [2, 0.5, 0.5, "C5"], [2, 1, 1, "B4"], [2, 2, 2, "G4"],
    [3, 0.5, 0.5, "Bb4"], [3, 1, 0.5, "C5"], [3, 1.5, 2.5, "D5"],
    [4, 0, 1, "D5"], [4, 1, 0.5, "F5"], [4, 1.5, 0.5, "D5"], [4, 2, 0.5, "Bb4"], [4, 2.5, 1.5, "A4"],
    [5, 0.5, 0.5, "C5"], [5, 1, 0.5, "E5"], [5, 1.5, 2.5, "G5"],
    [6, 0, 1, "Ab5"], [6, 1, 1, "G5"], [6, 2, 0.5, "F5"], [6, 2.5, 1.5, "G5"],
    [7, 0, 0.75, "E5"], [7, 0.75, 0.25, "D5"], [7, 1, 1, "B4"], [7, 2, 0.5, "C5"], [7, 2.5, 1.25, "C#5"],
  ];
  // the head's opening cell as a C.line motif, so solos quote it
  const HEAD_MOTIF = { len: 3.5, rhythm: [{ off: 0, dur: 0.5 }, { off: 0.5, dur: 0.25 }, { off: 0.75, dur: 0.75 }, { off: 1.5, dur: 0.5 }, { off: 2, dur: 0.25 }, { off: 2.25, dur: 0.25 }, { off: 2.5, dur: 1 }], steps: [0, 1.9, -0.6, -1.9, -1.9, 1.9, 1.2] };

  // ---------- rhythm section ----------
  // Bass: [beat, role, dur, vel, art?]. Roles: R root, O octave, F fifth, S seventh, G ghost, A approach.
  const B4 = {
    head: [
      [[0, "R", 0.6, 0.86], [0.75, "G", 0.1, 0.5], [1, "O", 0.25, 0.74], [1.5, "F", 0.4, 0.7], [2.5, "R", 0.4, 0.76], [3, "S", 0.25, 0.66], [3.5, "O", 0.2, 0.72], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.4, 0.86], [0.5, "R", 0.2, 0.6, "finger"], [0.75, "O", 0.2, 0.72], [1.5, "G", 0.1, 0.45], [1.75, "F", 0.4, 0.7], [2.5, "R", 0.3, 0.76], [2.75, "O", 0.2, 0.72], [3.25, "G", 0.1, 0.45], [3.5, "S", 0.25, 0.68], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.9, 0.86], [1.25, "G", 0.1, 0.45], [1.5, "O", 0.25, 0.75], [2, "F", 0.4, 0.68], [2.75, "R", 0.4, 0.74], [3.5, "O", 0.2, 0.7], [3.75, "A", 0.2, 0.7]],
    ],
    rush: [
      [[0, "R", 0.3, 0.9], [0.25, "G", 0.1, 0.5], [0.5, "O", 0.2, 0.84], [0.75, "R", 0.2, 0.66], [1.25, "G", 0.1, 0.5], [1.5, "O", 0.2, 0.86], [1.75, "R", 0.2, 0.62], [2, "F", 0.3, 0.74], [2.5, "O", 0.2, 0.84], [2.75, "G", 0.1, 0.5], [3, "R", 0.25, 0.76], [3.25, "S", 0.2, 0.7], [3.5, "O", 0.2, 0.84], [3.75, "A", 0.2, 0.72]],
      [[0, "R", 0.5, 0.9], [0.75, "R", 0.2, 0.66], [1, "O", 0.2, 0.86], [1.25, "G", 0.1, 0.5], [1.5, "R", 0.2, 0.7], [1.75, "O", 0.2, 0.8], [2.5, "R", 0.3, 0.8], [2.75, "F", 0.2, 0.7], [3, "O", 0.2, 0.84], [3.5, "G", 0.1, 0.5], [3.75, "A", 0.2, 0.74]],
    ],
    lull: [
      [[0, "R", 1.4, 0.74], [1.5, "F", 0.9, 0.62], [2.5, "O", 0.5, 0.6], [3.5, "A", 0.45, 0.58]],
      [[0, "R", 2.4, 0.74], [2.5, "F", 0.4, 0.6], [3, "S", 0.8, 0.58]],
    ],
  };
  const B2 = {
    head: [[[0, "R", 0.5, 0.86], [0.75, "O", 0.2, 0.72], [1.25, "G", 0.1, 0.45], [1.5, "F", 0.25, 0.68], [1.75, "A", 0.2, 0.7]], [[0, "R", 0.75, 0.86], [1, "O", 0.25, 0.74], [1.5, "S", 0.2, 0.64], [1.75, "A", 0.2, 0.7]]],
    rush: [[[0, "R", 0.3, 0.9], [0.5, "O", 0.2, 0.84], [0.75, "R", 0.2, 0.62], [1.25, "G", 0.1, 0.5], [1.5, "O", 0.2, 0.84], [1.75, "A", 0.2, 0.72]]],
    lull: [[[0, "R", 1.4, 0.74], [1.5, "A", 0.45, 0.58]]],
  };
  const ART = { R: "thumb", O: "pop", F: "finger", S: "finger", G: "ghost", A: "finger" };
  // Rhodes comping per chord span: [beat, dur] (-0.25 = a pushed 16th)
  const K4 = {
    head: [[[[0, 0.6], [1.5, 0.3], [2.75, 1]], 3], [[[-0.25, 0.7], [1.75, 0.4], [2.5, 0.5]], 2], [[[0.5, 0.3], [1, 0.6], [2.5, 1.2]], 2], [[[0, 0.3], [0.75, 0.6], [2.25, 0.3], [3, 0.8]], 1.5]],
    rush: [[[[0, 0.3], [1.5, 0.25], [2.75, 0.5]], 2], [[[-0.25, 0.4], [1.25, 0.25], [2.5, 0.3], [3.25, 0.5]], 2], [[[0.5, 0.25], [1, 0.4], [2.75, 0.6]], 1.5]],
    lull: [[[[0, 3.8]], 3], [[[0, 1.9], [2.5, 1.4]], 1], [[[0.5, 3.3]], 1]],
  };
  const K2 = {
    head: [[[[0, 0.75], [1.5, 0.4]], 3], [[[-0.25, 0.7], [1, 0.4]], 2], [[[0, 0.3], [0.75, 0.9]], 2]],
    rush: [[[[0, 0.2], [0.75, 0.2], [1.5, 0.3]], 2], [[[-0.25, 0.3], [0.5, 0.2], [1.25, 0.4]], 2]],
    lull: [[[[0, 1.85]], 3], [[[0.5, 1.4]], 1]],
  };
  // Muted-guitar scratch: 16th offbeats in a two-bar figure (x = dyad, accented values louder)
  const SCRATCH = [[0.25, 0.42], [0.75, 0.5], [1.25, 0.36], [1.75, 0.5], [2.25, 0.42], [2.75, 0.5], [3.5, 0.55], [4.25, 0.42], [4.75, 0.5], [5.5, 0.55], [6.25, 0.42], [6.75, 0.5], [7.25, 0.36], [7.75, 0.5]];
  // Brass figures (beats within a bar pair): head answers and rush-hour shouts
  const SHOUT = [
    [[0, 0.3], [0.75, 0.3], [1.5, 0.6], [6.5, 0.25], [7, 0.6]],
    [[2.5, 0.25], [2.75, 0.5], [3.5, 0.25], [4, 0.6], [5.75, 0.3]],
    [[0, 0.6], [3.25, 0.25], [3.5, 0.5], [6.5, 0.25], [6.75, 0.25], [7, 0.8]],
  ];
  const HEAD_BRASS = { A: [[7, 0, 0.35], [1, 2.75, 0.3], [3, 2.75, 0.3], [5, 3.5, 0.3]], A2: [[1, 2.75, 0.3], [3, 2.75, 0.3], [5, 0, 0.4], [7, 0, 0.35]], B: [[0, 0, 1.6], [2, 0, 1.6], [4, 2, 1.4], [6, 0, 1.2]] };
  const KICKS = [[0, 0.75, 2.5], [0, 0.75, 1.75, 2.5], [0, 2.5, 3.25], [0, 0.75, 2.5, 3.75]];
  const CONGA_HEAD = [[0.5, "conga", 0.32, 62], [1, "conga", 0.22, 62], [1.75, "conga", 0.44, 64], [2.5, "conga", 0.32, 62], [3.5, "congaLow", 0.48, 55], [3.75, "congaLow", 0.42, 55]];
  const CONGA_RUSH = [[0, "conga", 0.3, 62], [0.5, "conga", 0.4, 64], [0.75, "conga", 0.24, 62], [1.5, "conga", 0.44, 64], [2, "congaLow", 0.34, 55], [2.5, "conga", 0.4, 64], [2.75, "conga", 0.24, 62], [3.25, "conga", 0.3, 62], [3.5, "congaLow", 0.5, 55], [3.75, "congaLow", 0.44, 55]];
  const CONGA_LULL = [[1.5, "conga", 0.26, 62], [3.5, "congaLow", 0.36, 55], [3.75, "congaLow", 0.3, 55]];

  // ---------- spelling & transposition ----------
  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  function prog(sec, k, turnKey = null) {
    return T.progression(FORM[sec]).map((h) => ({ ...h, chord: tsym(h.chord, h.bar === 7 && turnKey != null ? turnKey : k) }));
  }
  const keyName = (k) => (k === HOME ? "B♭" : "C");

  // T.voice, rejecting minor 9ths, adjacent semitones and seconds below G3
  const rough = (v) => v.some((a, i) => v.some((b, j) => j > i && Math.abs(b - a) === 13)) || v.some((a, i) => i > 0 && (a - v[i - 1] === 1 || (v[i - 1] < 55 && a - v[i - 1] <= 2)));
  function voiceClean(sym, opts) {
    const n = opts.n ?? 4;
    const tries = [opts, { ...opts, spread: "close" }, { ...opts, spread: "drop2" }, { ...opts, lo: opts.lo + 2 }, { ...opts, n: n - 1 }, { ...opts, n: n - 1, spread: "close" }, { ...opts, lo: opts.lo - 2, hi: opts.hi + 3 }];
    let first = null;
    for (const o of tries) { const v = T.voice(sym, o); first = first || v; if (!rough(v)) return v; }
    return first;
  }
  /** Chord tones hung downward from `top`: no semitones, no minor 9ths, nothing close below G3. */
  function stackDown(sym, top, n) {
    const c = T.chord(sym);
    const fifth = c.intervals.find((i) => i >= 6 && i <= 8);
    const pref = [...new Set(c.guide.concat(c.colors, fifth != null ? [mod12(c.root + fifth)] : [], [c.root]))];
    const out = [top];
    let cur = top;
    while (out.length < n) {
      let pick = null, best = Infinity;
      for (let m = cur - 2; m >= cur - 9; m--) {
        const rank = pref.indexOf(mod12(m));
        if (rank < 0 || out.some((x) => mod12(x) === mod12(m) || Math.abs(x - m) === 13) || (m < 55 && cur - m <= 2)) continue;
        const sc = rank + (cur - m) * 0.25;
        if (sc < best) { best = sc; pick = m; }
      }
      if (pick == null) break;
      out.push(pick); cur = pick;
    }
    return out.sort((a, b) => a - b);
  }
  /** voiceClean, falling back to a hung voicing near the previous top note when every try is rough. */
  function voiceSafe(sym, opts) {
    const v = voiceClean(sym, opts);
    if (!rough(v)) return v;
    const c = T.chord(sym), n = opts.n ?? 4;
    const ref = opts.prev && opts.prev.length ? Math.max(...opts.prev) : opts.top ? Math.round((opts.top[0] + opts.top[1]) / 2) : v[v.length - 1];
    let best = null, bs = Infinity;
    for (let t = ref - 5; t <= ref + 5; t++) {
      if (!c.pcs.includes(mod12(t)) || t > opts.hi + 2) continue;
      const w = stackDown(sym, t, n);
      if (w.length < 3 || w[0] < opts.lo - 4) continue;
      const sc = Math.abs(t - ref) + (n - w.length) * 2 + (mod12(t) === c.root ? 2 : 0);
      if (sc < bs) { bs = sc; best = w; }
    }
    return best || v;
  }
  /** Improvisers' scales: major-7th chords go lydian (no 4th to rub against the 3rd). */
  const lydianize = (sym) => { const c = T.chord(sym); return c.kind === "major7" || c.kind === "major6" ? T.scale(c.root, "lydian") : c.scale; };
  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };

  Sim.register({
    id: "downtown-rush",
    title: "Downtown Rush",
    genre: "City-sim jazz funk",
    about: "Jazz-funk fusion to build a city to, in B♭: an alto sax head over ii–V chains and lydian colours, slap bass, Rhodes, brass punches and a ghost-noted funk kit with congas and shaker; rush hours double the groove and push the tempo for vibes and guitar solos, midday lulls thin it to cross-stick and congas.",
    bpm: 104, beatsPerBar: 4, swing: 0.55, swingUnit: 0.25, cycleBars: 8, gainDb: 0,
    situations: ["work", "explore", "hangout"],
    energy: 0.6,

    instruments(ctx) {
      const { I, out } = ctx;
      const plate = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 350, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.22, pingPong: true, highcut: 3000 });

      const sax = I.sax(ctx, { volume: 0, vibratoDepth: 0.04 });
      const flute = I.flute(ctx, { volume: -5 });
      const vibes = I.vibes(ctx, { volume: -1, decay: 2.4, motor: 4.8, motorDepth: 0.22 });
      const guitar = I.guitar(ctx, { kind: "clean", chorus: true, volume: -2 });
      const scratch = I.guitar(ctx, { kind: "muted", volume: -14 });
      const keys = I.rhodes(ctx, { volume: -7, cutoff: 4200, bark: 2.6, tine: -11, tremolo: 4.4, tremoloDepth: 0.18 });
      const brass = I.brassStab(ctx, { volume: -8 });
      const bass = I.slapBass(ctx, { volume: -4 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 32, preload: ["kick", "snare", "hatClosed", "hatOpen", "hatPedal", "rim", "conga", "congaLow", "shaker", "tambourine", "timbale", "crash", "tom"] });

      const sp = I.place(ctx, sax, 0.06, out), fp = I.place(ctx, flute, 0.16, out);
      const vp = I.place(ctx, vibes, 0.3, out), gp = I.place(ctx, guitar, -0.3, out), xp = I.place(ctx, scratch, -0.45, out);
      const kp = I.place(ctx, keys, -0.18, out), bp = I.place(ctx, brass, 0.24, out);
      I.place(ctx, bass, 0, out); const dp = I.place(ctx, kit, 0, out);
      I.send(ctx, sp, plate, -12); I.send(ctx, sp, hall, -17); I.send(ctx, sp, echo, -20);
      I.send(ctx, fp, hall, -10); I.send(ctx, vp, hall, -12); I.send(ctx, vp, echo, -18);
      I.send(ctx, gp, plate, -12); I.send(ctx, gp, echo, -16); I.send(ctx, xp, plate, -18);
      I.send(ctx, kp, plate, -13); I.send(ctx, bp, hall, -11); I.send(ctx, bp, plate, -15);
      I.send(ctx, dp, plate, -19);
      const melo = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        sax: { layer: "melody", play: melo(sax), humanize: { timing: 0.008, vel: 0.05 } },
        flute: { layer: "melody", play: melo(flute), humanize: { timing: 0.008, vel: 0.05 } },
        vibes: { layer: "melody", play: melo(vibes), humanize: { timing: 0.006, vel: 0.06 } },
        guitar: { layer: "melody", play: (t, e, d) => guitar.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.006, vel: 0.06 } },
        keys: { layer: "harmony", play: melo(keys), humanize: { timing: 0.006, vel: 0.06 } },
        brass: { layer: "harmony", play: melo(brass), humanize: { timing: 0.004, vel: 0.04 } },
        scratch: { layer: "texture", play: (t, e, d) => scratch.play(t, e.note, d, e.vel, 0.006), humanize: { timing: 0.004, vel: 0.1 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel, e.art || "thumb"), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.004, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % 16, round = Math.floor(cycle / 16);
      const plan = PLAN[idx], nextPlan = PLAN[(idx + 1) % 16];
      const k = plan.key, style = plan.style;
      const harmony = prog(plan.sec, k, plan.turn ? nextPlan.key : null);
      const chordAt = T.chordAtFactory(harmony);
      const sym = (b) => chordAt(b).chord;
      const nextFirst = tsym(T.progression(FORM[nextPlan.sec])[0].chord, nextPlan.key);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // tempo: rush hour pushes to 108, everything else sits at 104
      let tempo;
      const want = style === "rush" ? 108 : 104;
      if (state.bpm == null) state.bpm = 104;
      if (state.bpm !== want) { tempo = { bpm: want, rampBeats: style === "rush" ? 8 : 4 }; state.bpm = want; }

      // ---------- melody ----------
      const mel = []; // {at, dur, note}
      const swap = round % 2 === 1; // the second time round the soloists trade places
      let melInst = null;
      if (plan.head) {
        const src = plan.sec === "B" ? BRIDGE : HEAD_FRONT.concat(plan.sec === "A2" ? HEAD_A2 : HEAD_A);
        const turnBar = plan.turn ? nextPlan.key - k : 0;
        src.forEach(([b, x, d, n]) => mel.push({ at: b * 4 + x, dur: d, note: T.midi(n) + k + (b === 7 ? turnBar : 0) }));
        // later heads: some long notes get a 16th turn, a few 8th pairs get a chromatic approach
        if (plan.vary || round > 0) {
          for (let i = mel.length - 1; i >= 0; i--) {
            const n = mel[i];
            if (n.dur < 1.5 || !r.chance(0.3)) continue;
            const up = T.step(n.note, 1, T.chord(sym(n.at + n.dur - 0.5)).scale);
            if (up - n.note > 2) continue;
            mel.splice(i, 1, { at: n.at, dur: n.dur - 0.5, note: n.note }, { at: n.at + n.dur - 0.5, dur: 0.25, note: up }, { at: n.at + n.dur - 0.25, dur: 0.25, note: n.note });
          }
        }
        // fit to the actual chord (the turn bar, substitutions)
        mel.forEach((n) => { const ok = okSet(sym(n.at)); if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]); });
        melInst = round % 2 === 1 && plan.sec === "B" ? "flute" : "sax";
        if (melInst === "flute") mel.forEach((n) => { n.note += 12; }); // the flute takes the bridge an octave up
      } else if (plan.solo || plan.lull) {
        let inst, lo, hi, density, register;
        if (plan.lull) {
          inst = (round + (plan.lull === 2 ? 1 : 0)) % 2 ? "guitar" : "vibes";
          if (plan.lull === 3) inst = "vibes";
          lo = 67; hi = 84; density = plan.lull === 2 ? 0.34 : 0.24; register = 0.5;
        } else if (plan.solo === "sax") { inst = "sax"; lo = 62; hi = 79; density = 0.55; register = 0.55; }
        else {
          inst = (plan.solo === "s1") !== swap ? "vibes" : "guitar";
          lo = inst === "vibes" ? 65 : 60; hi = inst === "vibes" ? 86 : 81; density = idx === 6 || idx === 11 ? 0.62 : 0.52; register = 0.55;
        }
        const end = plan.lull === 3 ? 26 : 31.5;
        const fresh = !(state.soloInst === inst && state.soloFrom === idx - 1);
        const m = C.line({
          start: 0, end, chordAt: sym, lo: lo + k, hi: hi + k, rng: r.fork(7), density, scaleFor: lydianize,
          phrase: plan.lull ? [4, 8] : [3, 8], rest: plan.lull ? [2, 4] : [0.5, 2], motif: (!fresh && state.soloMotif) || HEAD_MOTIF, motifProb: plan.lull ? 0.5 : 0.35,
          chromatic: plan.lull ? 0.1 : 0.3, register, prev: fresh ? undefined : state.soloLast, upbeatStart: 0.5, lead: fresh ? 0.5 : 0,
        });
        state.soloMotif = m.motif; state.soloLast = m.last; state.soloInst = inst; state.soloFrom = idx;
        m.notes.forEach((n, i) => {
          const nx = m.notes[i + 1];
          // fusion flavour: an 8th sometimes splits into two 16ths with a chromatic approach to the next note
          if (plan.solo && !n.strong && nx && Math.abs(n.dur - 0.46) < 0.05 && Math.abs(nx.beat - n.beat - 0.5) < 1e-6 && r.chance(0.18)) {
            const app = nx.note - 1;
            mel.push({ at: n.beat, dur: 0.25, note: n.note }, { at: n.beat + 0.25, dur: 0.25, note: app === n.note ? n.note + 2 : app });
          } else mel.push({ at: n.beat, dur: n.dur, note: n.note });
        });
        melInst = inst;
      }
      mel.sort((a, b) => a.at - b.at);
      const melVel = plan.head ? 0.7 : plan.lull ? 0.56 : 0.64;
      mel.forEach((n, i) => {
        const nx = mel[i + 1];
        const dur = Math.max(0.12, Math.min(n.dur, nx ? nx.at - n.at - 0.02 : 31.9 - n.at));
        const onBeat = Math.abs(n.at - Math.round(n.at)) < 1e-6;
        const vel = melVel + (n.dur >= 1 ? 0.05 : n.dur <= 0.25 ? -0.06 : 0) + (onBeat ? 0.03 : 0) + r.gauss(0.025);
        push(melInst, n.at, melInst === "vibes" ? Math.max(dur, 0.5) : dur, n.note, vel);
        if (plan.dbl && melInst === "sax") push("flute", n.at, dur, n.note + 12, vel * 0.85);
      });
      const melOnset = (b, before, after) => mel.some((n) => n.at > b - before && n.at < b + after);
      const melTop = (b) => { const n = mel.find((x) => x.at <= b + 1e-6 && x.at + x.dur > b + 1e-6); return n ? n.note : null; };

      // ---------- Rhodes ----------
      const kStyle = style === "intro" ? "head" : style;
      const keyTop = plan.head ? [60 + k, 67 + k] : style === "lull" ? [64 + k, 72 + k] : [62 + k, 70 + k];
      const hits = harmony.map((h) => {
        const s0 = h.bar * 4 + h.beat;
        const v = voiceSafe(h.chord, { lo: 50 + k, hi: (plan.head ? 70 : 74) + k, n: 4, prev: state.kv, top: keyTop, rng: r });
        state.kv = v;
        let pats = (h.dur >= 4 ? K4 : K2)[kStyle];
        if (s0 === 0 || style === "lull") pats = pats.filter(([p]) => p[0][0] >= 0);
        const pat = r.weighted(pats);
        return pat.map(([b, d]) => ({ at: s0 + b, d, v }));
      });
      hits.forEach((hs, i) => {
        const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : 32;
        hs.forEach((h, j) => {
          if (h.at >= nextStart - 0.2) return;
          const vel = (style === "lull" ? 0.4 : style === "rush" ? 0.48 : 0.46) + (j === 0 ? 0.04 : 0) + r.range(-0.04, 0.04);
          const dur = Math.max(0.15, Math.min(h.d, nextStart - h.at - 0.05));
          if (style === "lull" && h.d >= 1.5) h.v.forEach((m, q) => push("keys", h.at, dur, m, vel * (1 - q * 0.03), { delay: q * 0.02 })); // rolled
          else push("keys", h.at, dur, h.v, vel);
        });
      });

      // ---------- slap bass, and the kick that locks to it ----------
      const kicks = Array.from({ length: 8 }, () => []);
      let lastRoot = state.bassRoot ?? 36 + k;
      const rootOf = (pc, near) => T.nearest(near, [pc], 28, 40);
      if (!state.groove || state.grooveFor !== cycle) { state.groove = {}; state.grooveFor = cycle; }
      const bStyle = style === "intro" ? "head" : style;
      harmony.forEach((h, i) => {
        const ch = T.chord(h.chord), s0 = h.bar * 4 + h.beat;
        const root = rootOf(ch.bass, lastRoot);
        lastRoot = root;
        const nextSym = i + 1 < harmony.length ? harmony[i + 1].chord : nextFirst;
        const nc = T.chord(nextSym), nextRoot = rootOf(nc.bass, root);
        const fifthIv = ch.intervals.find((x) => x === 7 || x === 6 || x === 8) ?? (ch.intervals.includes(10) ? 10 : 12); // 7b13 has no 5th
        const sevIv = ch.intervals.includes(10) ? 10 : 12; // a major 7th is too sweet down there: use the octave
        let app;
        if (nc.bass === ch.bass) app = root + fifthIv;
        else { const sc = new Set(ch.scale); app = sc.has(mod12(nextRoot - 1)) ? nextRoot - 1 : sc.has(mod12(nextRoot + 1)) ? nextRoot + 1 : nextRoot - 1; }
        const roleNote = { R: root, O: root + 12, F: root + fifthIv, S: root + sevIv, G: root, A: app };
        const lib = (h.dur >= 4 ? B4 : B2)[bStyle];
        const gk = `${bStyle}${h.dur >= 4 ? 4 : 2}`;
        if (state.groove[gk] == null) state.groove[gk] = r.int(0, lib.length - 1);
        const tpl = r.chance(0.2) ? r.pick(lib) : lib[state.groove[gk]];
        for (const [b, role, d, v, art] of tpl) {
          if (b >= h.dur - 0.01) continue;
          if (style === "intro" && h.bar < 1 && role === "G") continue;
          const at = s0 + b;
          const a = art || (style === "lull" ? "finger" : ART[role]);
          push("bass", at, d, Math.max(28, Math.min(55, roleNote[role])), v * (style === "lull" ? 0.92 : 1), { art: a });
          const pos = at - h.bar * 4;
          if (role === "R" || (role !== "G" && Math.abs(pos - 0.75) < 1e-6)) kicks[h.bar].push(pos);
        }
      });
      state.bassRoot = lastRoot;

      // ---------- muted guitar scratch ----------
      const scratchOn = style === "rush" ? melInst !== "guitar" : plan.sec === "A2" || plan.sec === "intro";
      if (scratchOn) {
        for (let pair = 0; pair < 4; pair++) {
          SCRATCH.forEach(([b, v]) => {
            const at = pair * 8 + b;
            if (at >= 31.75) return;
            const c = T.chord(sym(at));
            const dy = T.notesIn(c.guide, 64 + k, 76 + k).slice(0, 2);
            if (dy.length) push("scratch", at, 0.12, dy, v * (style === "rush" ? 1 : 0.85));
          });
        }
      }

      // ---------- brass ----------
      const brassAt = (at, d, vel) => {
        const m = melTop(at);
        const hi = style === "rush" || m == null || m >= 80 ? 77 + Math.min(0, k) : Math.max(72, m - 3);
        const v = voiceSafe(sym(at), { lo: Math.max(55, hi - 15), hi, n: 4, prev: state.bv, top: [hi - 5, hi] });
        state.bv = v;
        push("brass", at, d, v, vel);
      };
      if (plan.brass && plan.head) {
        (HEAD_BRASS[plan.sec] || []).forEach(([bar, b, d]) => {
          const at = bar * 4 + b;
          if (plan.sec !== "B" && melOnset(at, 0.05, 0.3)) return;
          brassAt(at, d, plan.sec === "B" ? 0.42 : 0.6);
        });
      } else if (plan.brass && style === "rush") {
        const figs = plan.brass === 2 ? [SHOUT[0], SHOUT[1], SHOUT[2], SHOUT[0]] : [SHOUT[1], null, SHOUT[2], null];
        figs.forEach((f, pair) => f && f.forEach(([b, d]) => { const at = pair * 8 + b; if (at < 31.5) brassAt(at, d, plan.brass === 2 ? 0.66 : 0.58); }));
      } else if (style === "intro") {
        brassAt(13.5, 0.3, 0.55); brassAt(29.5, 0.3, 0.58); brassAt(30, 0.6, 0.62);
      }

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4, last = bar === 7;
        const nextBusy = nextPlan.style === "rush" && style !== "rush";
        let fill = null;
        if (last && style !== "lull") fill = nextBusy ? "timbale" : nextPlan.style === "lull" ? "stop" : r.chance(0.6) ? "snare" : "tom";
        if (last && plan.lull === 2) fill = "snare";
        const cut = fill === "timbale" || fill === "tom" ? 2 : fill === "snare" ? 3 : fill === "stop" ? 3 : 4;
        const keep = (b) => b < cut - 1e-6;
        const ksets = new Set(kicks[bar].map((x) => Math.round(x * 4) / 4));
        if (style === "rush") {
          [0, 1, 2, 3].filter(keep).forEach((b) => D(B + b, "kick", b === 0 ? 0.86 : 0.78));
          if (ksets.has(2.5) && keep(2.5)) D(B + 2.5, "kick", 0.55); else if (ksets.has(2.75) && keep(2.75)) D(B + 2.75, "kick", 0.5);
          [1, 3].filter(keep).forEach((b) => D(B + b, "snare", 0.8));
          for (let s = 0; s < 16; s++) {
            const b = s / 4; if (!keep(b)) break;
            const q = s % 4;
            if (q === 2) D(B + b, "hatOpen", 0.32);
            else if (q === 0) D(B + b, "hatPedal", 0.4);
            else D(B + b, "hatClosed", q === 1 ? 0.22 : 0.3);
            D(B + b, "tambourine", q === 2 ? 0.34 : q === 0 ? 0.24 : 0.14);
          }
          CONGA_RUSH.filter(([b]) => keep(b)).forEach(([b, v, vel, p]) => D(B + b, v, vel, { pitch: p }));
          [0.75, 1.75, 2.25, 3.25, 3.75].filter((b) => keep(b) && !ksets.has(b) && r.chance(0.45)).forEach((b) => D(B + b, "snare", 0.12 + r.range(0, 0.07)));
          if (bar === 0) D(B, "crash", 0.56);
          if (bar === 3 && r.chance(0.6)) [[3, 74], [3.25, 74], [3.5, 67], [3.75, 67]].forEach(([b, p], i) => D(B + b, "timbale", 0.4 + i * 0.05, { pitch: p }));
        } else if (style === "lull") {
          const fade = plan.lull === 3 ? Math.max(0.55, 1 - bar * 0.06) : 1;
          const pick = plan.lull === 2 && bar >= 4;
          D(B, "kick", 0.56 * fade);
          if (ksets.has(2.5) || pick) D(B + 2.5, "kick", 0.42 * fade);
          D(B + 1, "hatPedal", 0.32 * fade); D(B + 3, "hatPedal", 0.32 * fade);
          D(B + 3, "rim", 0.4 * fade);
          if (pick) D(B + 1, "rim", 0.3);
          for (let s = 0; s < 8; s++) if (s % 2 || pick) D(B + s / 2, "shaker", (s % 2 ? 0.26 : 0.16) * fade);
          if (bar % 2 === 1 || plan.lull === 2) CONGA_LULL.forEach(([b, v, vel, p]) => D(B + b, v, vel * fade, { pitch: p }));
          if (plan.lull === 3 && bar === 7) D(B, "crash", 0.22);
          if (fill === "snare") [[3, 0.3], [3.25, 0.4], [3.5, 0.5], [3.75, 0.6]].forEach(([b, v]) => D(B + b, "snare", v));
        } else {
          // head / intro groove
          const intro = style === "intro";
          D(B, "kick", 0.84);
          // the drummer's own figure, plus the bass's late downbeat when it has one
          if (state.kickFig == null || bar === 0) state.kickFig = r.int(0, KICKS.length - 1);
          const fig = new Set(KICKS[(state.kickFig + (bar % 4 === 3 ? 1 : 0)) % KICKS.length]);
          if (ksets.has(2.75)) { fig.delete(2.5); fig.add(2.75); }
          [...fig].filter((b) => b > 0 && keep(b)).forEach((b) => D(B + b, "kick", b === 2.5 || b === 2.75 ? 0.72 : 0.6));
          [1, 3].filter(keep).forEach((b) => D(B + b, "snare", 0.76));
          // ghost notes, kept off the kick
          const ghosts = [0.25, 1.75, 2.25, 2.75, 3.25, 3.75].filter((b) => keep(b) && !fig.has(b));
          r.shuffle(ghosts).slice(0, r.int(1, 3)).forEach((b) => D(B + b, "snare", 0.1 + r.range(0, 0.08)));
          // 16th hats with barks: open on the "and" of 4 (or the "a" of 2), closed by the pedal on the next beat
          const bark = bar % 2 === 1 ? 3.5 : r.chance(0.3) ? 1.75 : null;
          for (let s = 0; s < 16; s++) {
            const b = s / 4; if (!keep(b)) break;
            if (bark != null && Math.abs(b - bark) < 1e-6) { D(B + b, "hatOpen", 0.3); continue; }
            if (bark != null && b > bark && b < bark + 0.3) continue;
            const q = s % 4;
            D(B + b, "hatClosed", [0.46, 0.16, 0.32, 0.2][q] + r.range(-0.03, 0.03));
          }
          if (bark === 1.75) D(B + 2, "hatPedal", 0.36);
          // aux percussion grows with the form: shaker in A, congas from A′ on
          const shaker = !intro || bar >= 4, congas = plan.sec !== "A" || plan.vary || k === LIFT;
          if (shaker) for (let s = 0; s < 16 && keep(s / 4); s++) D(B + s / 4, "shaker", [0.22, 0.1, 0.16, 0.12][s % 4]);
          if (congas && !intro) CONGA_HEAD.filter(([b]) => keep(b)).forEach(([b, v, vel, p]) => D(B + b, v, vel, { pitch: p }));
          if (intro && bar >= 2) CONGA_LULL.forEach(([b, v, vel, p]) => D(B + b, v, vel, { pitch: p }));
          if (bar === 0 && plan.head && (plan.sec !== "A" || idx === 1 || k === LIFT)) D(B, "crash", 0.5);
        }
        // fills that mark the form
        if (fill === "timbale") [[2, 74, 0.5], [2.25, 74, 0.36], [2.5, 67, 0.5], [2.75, 74, 0.4], [3, 67, 0.55], [3.25, 74, 0.45], [3.5, 67, 0.62], [3.75, 67, 0.7]].forEach(([b, p, v]) => D(B + b, "timbale", v, { pitch: p }));
        else if (fill === "tom") { D(B + 2, "snare", 0.5); [[2.5, 57], [2.75, 55], [3, 52], [3.25, 50], [3.5, 47], [3.75, 45]].forEach(([b, p], i) => D(B + b, "tom", 0.5 + i * 0.05, { pitch: p })); }
        else if (fill === "snare" && style !== "lull") [[3, 0.34], [3.25, 0.44], [3.5, 0.56], [3.75, 0.66]].forEach(([b, v]) => D(B + b, "snare", v));
        else if (fill === "stop") { D(B + 3, "snare", 0.6); D(B + 3, "kick", 0.7); }
      }

      const who = plan.head ? (melInst === "flute" ? " · flute" : "") : melInst ? ` · ${melInst} ${plan.lull ? "melody" : "solo"}` : "";
      const label = `${plan.d}${who} · ${keyName(k)}${state.bpm !== 104 ? " · " + state.bpm + " BPM" : ""}`;
      return { events: ev, harmony, section: label, state, tempo };
    },
  });
})();

// Mambo Plaza: a 1950s New York mambo / salsa dura at 190, for a plaza where the whole sim is dancing.
//
// Time: 4/4 at 190 in quarter notes, i.e. cut time; one bar here is one half of the clave. The clave is
// 2-3 son: even bars (counting from 0) are the 2-side (beats 2 and 3), odd bars the 3-side (1, 2&, 4).
// Every section is an even number of bars and starts on the 2-side, so the whole band stays in clave.
//
// Rhythm section: piano montuno in octaves with the chord filled in, anticipating each change on the
// "and" of 4; tumbao bass (2& and an anticipated 4, tied over, never on 1); congas tumbao (slap on 2,
// open tones on 4 and 4&, the tumbadora answering on the 3-side); bongo martillo, which becomes the
// hand-held bongo bell in the montuno; timbales on the cáscara (shell) in the verses and on the mambo
// bell from the montuno on; güiro; the clave itself. Abanicos (timbale rolls into a rimshot and crash)
// mark every section change, and the two bells are synthesized in this file.
//
// Harmony: F major with ii-V-I everywhere, a modal-mixture iv (Bbm6), secondary dominants into ii and
// iii, and two D minor sections (the verse B and the mambo, i-iv-VI-V). The last bar of every section
// is the dominant of whatever comes next (the band's turnaround). The breakdown pivots on E7b9 and the
// moña comes back a whole step up, in G; the cierre (a band "bloque" on D7b9) drops it home to F.
//
// Form (8-bar cycles, one round = 12 cycles = 96 bars, about two minutes):
//   intro (trombones, then trumpets answer) -> verse A (trumpet melody in three parts, alto an octave
//   down) -> verse B (D minor, sax melody) -> montuno (coro answered by a soloist: trumpet, sax or piano,
//   rotating by round) -> mambo (trombone riff, trumpet riff on top, sax line under: they pile up) ->
//   percussion breakdown (bass creeps back, a bloque) -> moña in G (coro, then horn riffs stacked) -> cierre.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const M = T.midi, mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation: "note/beats" tokens, r = rest; a token may cross bar lines ----------
  function L(str, len) {
    const out = [];
    let b = 0;
    for (const tok of str.trim().split(/\s+/)) {
      if (tok === "|") continue; // bar lines are only for the reader
      const [n, d] = tok.split("/");
      const dur = Number(d);
      if (!(dur > 0)) throw new Error(`mambo: bad token "${tok}"`);
      if (n !== "r") out.push({ beat: b, dur, note: M(n) });
      b += dur;
    }
    if (len != null && Math.abs(b - len) > 1e-6) throw new Error(`mambo: line is ${b} beats, expected ${len}: ${str.slice(0, 40)}…`);
    return out;
  }

  // ---------- harmony (written in F; the moña is transposed up a step) ----------
  // "*" = the turnaround: the dominant of the next section's first chord.
  const PROG_TEXT = {
    intro: "| Gm7 | C7 | F6 | D7b9 | Gm7 | C7 | F6 | * |",
    A0: "| F6 | F6 | Gm7 | C7 | Gm7 | C7 | F6 | F6 |",
    A1: "| Cm7 | F7 | Bbmaj7 | Bbm6 | Am7 | D7b9 | Gm7 | * |",
    B0: "| Dm | Dm | Em7b5 | A7b9 | Em7b5 | A7b9 | Dm | Dm6 |",
    B1: "| Gm7 | C7 | Fmaj7 | Bbmaj7 | Em7b5 | A7b9 | Dm | * |",
    mont0: "| Gm7 | C7 | F6 | D7b9 | Gm7 | C7 | F6 | D7b9 |",
    mont1: "| Gm7 | C7 | F6 | D7b9 | Gm7 | C7 | F6 | * |",
    mambo0: "| Dm | Gm7 | Bbmaj7 | A7b9 | Dm | Gm7 | Bbmaj7 | A7b9 |",
    mambo1: "| Dm | Gm7 | Bbmaj7 | A7b9 | Dm | Gm7 | Bbmaj7 | * |",
    brk: "| Dm | Dm | Dm | Dm | Dm | Dm | Dm | * |",
  };
  const PROG = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, v.split("|").map((s) => s.trim()).filter(Boolean)]));
  const trSym = (sym, k) => (!k ? sym : sym.replace(/^([A-G][b#]?)/, (m) => T.NAMES[mod12(T.PC[m] + k)]).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + T.NAMES[mod12(T.PC[m] + k)]));
  const dominantOf = (sym) => { const c = T.chord(sym); const minor = /minor|halfDim/.test(c.kind); return T.NAMES[mod12(c.root + 7)] + (minor ? "7b9" : "7"); };
  /** chord tones without extensions (root, 3rd, 5th, 6th/7th) */
  const core = (sym) => { const c = T.chord(sym); return c.intervals.filter((i) => i < 12).map((i) => mod12(c.root + i)); };

  // ---------- the form ----------
  const ROUND = [
    { id: "intro", prog: "intro", dyn: 0.92, label: "Intro · trombones, then the trumpets answer" },
    { id: "A", part: 0, prog: "A0", dyn: 1, label: "Verse A · the tune" },
    { id: "A", part: 1, prog: "A1", dyn: 1, label: "Verse A · ii–V to IV, minor iv" },
    { id: "B", part: 0, prog: "B0", dyn: 0.94, label: "Verse B · D minor" },
    { id: "B", part: 1, prog: "B1", dyn: 0.96, label: "Verse B · back round to the montuno" },
    { id: "mont", part: 0, prog: "mont0", dyn: 1, label: "Montuno · coro and" },
    { id: "mont", part: 1, prog: "mont1", dyn: 1.03, label: "Montuno · coro and" },
    { id: "mambo", part: 0, prog: "mambo0", dyn: 1.05, label: "Mambo · the riffs interlock" },
    { id: "mambo", part: 1, prog: "mambo1", dyn: 1.1, label: "Mambo · all three riffs stacked" },
    { id: "brk", prog: "brk", dyn: 0.95, label: "Breakdown · percussion, then bass, then a bloque" },
    { id: "mona", part: 0, prog: "mont0", K: 2, dyn: 1.08, label: "Moña in G · coro and trumpets" },
    { id: "mona", part: 1, prog: "mont1", K: 2, dyn: 1.14, label: "Moña in G · the horns pile up · cierre" },
  ];
  const SOLOISTS = ["trumpet", "sax", "piano"];
  function planAt(cycle) {
    const round = Math.floor(cycle / ROUND.length), idx = cycle % ROUND.length;
    return { ...ROUND[idx], K: ROUND[idx].K || 0, part: ROUND[idx].part || 0, round, idx, soloist: SOLOISTS[round % 3] };
  }
  /** Absolute chord symbols for a cycle's 8 bars, with the turnaround resolved. */
  function barsOf(plan, nextPlan) {
    const syms = PROG[plan.prog].map((s) => (s === "*" ? s : trSym(s, plan.K)));
    const nextFirst = trSym(PROG[nextPlan.prog][0], nextPlan.K);
    return syms.map((s) => (s === "*" ? dominantOf(nextFirst) : s));
  }

  // ---------- horn material (in F; positions in beats from the section start) ----------
  // Intro: a rising trombone riff in arpeggios, each bar anticipating the next chord's third on 4&;
  // then the trumpets answer.
  const INTRO_TBN = L("r/0.5 G2/0.5 Bb2/0.5 D3/1 F3/0.5 r/0.5 E3/0.5 | r/0.5 C3/0.5 E3/0.5 G3/1 Bb3/0.5 r/0.5 A3/0.5 | r/0.5 F3/0.5 A3/0.5 C4/1 D4/0.5 r/0.5 F#3/0.5 | r/0.5 A3/0.5 F#3/0.5 Eb3/1 C3/0.5 r/0.5 Bb2/0.5", 16);
  const INTRO_TPT = L("r/1 Bb4/0.5 D5/0.5 r/0.5 F5/1 E5/1.5 C5/0.5 Bb4/0.5 G4/0.5 r/1 A4/1.5 C5/0.5 r/0.5 F5/1 E5/0.5 D5/0.5 C5/0.5 Bb4/0.5 G4/0.5 E4/1 r/1.5", 16);

  // Verse A (16 bars): the tune. Phrases start on the 2-side; long notes land a half beat early.
  const VERSE_A = L(
    "r/1 C5/0.5 D5/0.5 r/0.5 F5/1 D5/1.5 C5/0.5 A4/1 r/1.5 " +
    "r/1 D5/0.5 F5/0.5 r/0.5 Bb5/1 G5/1.5 F5/0.5 E5/1 r/1.5 " +
    "r/0.5 Bb4/0.5 D5/0.5 r/0.5 F5/0.5 D5/0.5 r/0.5 E5/1.5 D5/0.5 C5/0.5 Bb4/0.5 G4/1 r/0.5 " +
    "r/0.5 A4/0.5 C5/0.5 F5/1 E5/0.5 F5/1 r/2 C5/0.5 D5/0.5 F5/0.5 G5/2 " +
    "Eb5/0.5 r/0.5 C5/1 A4/1.5 C5/0.5 Eb5/0.5 r/0.5 D5/1 F5/1.5 " +
    "A5/1 F5/0.5 D5/0.5 F5/0.5 Db5/1.5 C5/0.5 Bb4/0.5 G4/1 r/0.5 C5/1.5 " +
    "E5/0.5 G5/0.5 r/0.5 E5/1 F#5/1.5 Eb5/0.5 C5/0.5 A4/1 r/0.5 Bb4/1.5 " +
    "D5/0.5 F5/0.5 r/0.5 D5/1 E5/1.5 C#5/0.5 Bb4/0.5 G4/0.5 A4/1 r/0.5", 64);

  // Verse B (16 bars, D minor): longer lines for the saxes, harmonic minor over the A7b9s.
  const VERSE_B = L(
    "A4/1.5 D5/0.5 F5/1 E5/1 " +
    "D5/1 r/0.5 A4/0.5 C5/0.5 D5/1 E5/1.5 G5/1 F5/0.5 E5/0.5 D5/0.5 C#5/1.5 " +
    "Bb4/0.5 A4/0.5 G4/1 E4/1 " +
    "r/0.5 G4/0.5 Bb4/0.5 D5/1 C5/0.5 Bb4/0.5 G4/0.5 " +
    "C#5/1.5 E5/0.5 G5/1 F5/0.5 E5/0.5 " +
    "D5/2 A4/1 r/0.5 B4/1.5 D5/0.5 F5/1 E5/0.5 D5/0.5 Bb4/1.5 " +
    "D5/0.5 G5/1 F5/0.5 D5/0.5 E5/1.5 G5/0.5 F5/0.5 E5/0.5 C5/1 A4/1.5 " +
    "C5/0.5 E5/0.5 G5/1 F5/0.5 D5/1.5 C5/0.5 Bb4/0.5 A4/1 r/0.5 G4/1.5 " +
    "Bb4/0.5 D5/0.5 r/0.5 E5/1 C#5/1.5 Bb4/0.5 G4/0.5 E4/0.5 G4/0.5 Bb4/0.5 A4/1.5 " +
    "F4/0.5 A4/0.5 D5/2 r/0.5 C5/1 A4/0.5 F#4/1 r/1", 64);

  // Montuno coro (2 bars over Gm7 C7) and the moña coro.
  const CORO_A = L("r/1 D5/0.5 F5/0.5 r/0.5 D5/0.5 C5/0.5 Bb4/1.5 C5/0.5 E5/1 r/1.5", 8);
  const CORO_B = L("F5/1 r/0.5 F5/0.5 D5/0.5 F5/1 G5/1.5 F5/0.5 D5/0.5 C5/0.5 r/1.5", 8);

  // Mambo riffs (4 bars over Dm Gm7 Bbmaj7 A7b9), written to interlock.
  const MAMBO_TBN = L("r/0.5 A2/0.5 D3/0.5 F3/1 A2/0.5 r/0.5 D3/0.5 | r/0.5 Bb2/0.5 D3/0.5 G3/1 F3/0.5 r/0.5 D3/0.5 | r/0.5 D3/0.5 F3/0.5 A3/1 F3/0.5 r/0.5 E3/0.5 | r/0.5 C#3/0.5 E3/0.5 G3/1.5 E3/0.5 r/0.5", 16);
  const MAMBO_TPT = L("A5/1.5 F5/0.5 r/0.5 D5/0.5 F5/0.5 G5/0.5 | r/0.5 G5/1 D5/0.5 r/1 Bb4/0.5 D5/0.5 | F5/1.5 D5/0.5 r/0.5 A4/0.5 C5/0.5 E5/0.5 | r/0.5 C#5/0.5 r/0.5 E5/0.5 r/0.5 G5/0.5 r/0.5 F5/0.5", 16);
  const MAMBO_SAX = L("r/0.5 D4/0.5 F4/0.5 A4/0.5 C5/1 A4/0.5 F4/0.5 | G4/0.5 Bb4/0.5 D5/0.5 r/0.5 F5/1 D5/0.5 Bb4/0.5 | A4/0.5 C5/0.5 D5/0.5 r/0.5 F5/1 E5/0.5 C#5/0.5 | Bb4/0.5 G4/0.5 E4/0.5 G4/0.5 Bb4/0.5 C#5/0.5 E5/0.5 D5/0.5", 16);

  // Moña riffs (4 bars over Gm7 C7 F6 D7b9; played a step up): repeated-note trumpet shout, an
  // offbeat trombone counter-riff, and a sustained sax counter-melody.
  const MONA_TPT = L("r/0.5 D5/0.5 r/0.5 F5/0.5 r/0.5 D5/0.5 F5/0.5 E5/0.5 | r/1 G5/0.5 E5/0.5 r/0.5 Bb4/0.5 C5/0.5 A4/0.5 | r/0.5 C5/0.5 r/0.5 F5/0.5 r/0.5 C5/0.5 D5/0.5 F#5/0.5 | r/1 A5/0.5 F#5/0.5 r/0.5 Eb5/0.5 C5/0.5 D5/0.5", 16);
  const MONA_TBN = L("G3/1 r/0.5 F3/0.5 r/0.5 D3/1 E3/0.5 | r/0.5 E3/1 G3/0.5 r/0.5 Bb3/1 A3/0.5 | r/0.5 A3/1 F3/0.5 r/0.5 C3/1 F#3/0.5 | r/0.5 F#3/1 A3/0.5 r/0.5 C4/1 Bb3/0.5", 16);
  const MONA_SAX = L("D5/1.5 Bb4/0.5 r/1 C5/1 | Bb4/1.5 G4/0.5 r/1 A4/1 | C5/1.5 A4/0.5 r/1 C5/1 | Eb5/1.5 C5/0.5 r/1 D5/1", 16);

  // ---------- percussion patterns (beats within a bar; even bar = 2-side) ----------
  const CLAVE = [[1, 2], [0, 1.5, 3]];
  const CASCARA = [[0, 1, 2, 2.5, 3.5], [0, 1, 1.5, 2.5, 3.5]];
  const BELL = [[[0, 0], [1, 1], [1.5, 1], [2, 0], [3, 1], [3.5, 1]], [[0, 0], [0.5, 1], [1.5, 1], [2, 0], [3, 1]]]; // [beat, neck?]
  const MARTILLO = [[0, 0.3, 77], [0.5, 0.14, 74], [1, 0.26, 77], [1.5, 0.14, 74], [2, 0.3, 77], [2.5, 0.14, 74], [3, 0.5, 69], [3.5, 0.22, 77]];
  // montuno piano rhythms: H/L = high/low octave of the line, F/G = the same with the chord filled in
  const MONTUNO = {
    guajeo: [".F.HL.FH", ".H.LF.LF"],
    guajeo2: [".HLH.FLH", ".LHL.FHF"], // the mambo and moña: the octave line rocks harder
    block: ["F..F..F.", "..F.F..."],
    sparse: ["F.......", "..F....."],
  };

  // ---------- custom instruments ----------
  /** A hand-held cowbell (two square waves, band-passed) with a stick click; neck strokes are higher and drier. */
  function cowbell(ctx, dest, o) {
    const I = ctx.I;
    const out = ctx.keep(new Tone.Gain(db(o.level))).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ frequency: o.bp, type: "bandpass", Q: o.Q })).connect(out);
    const env = ctx.keep(new Tone.Gain(0)).connect(bp);
    const o1 = ctx.keep(new Tone.Oscillator({ type: "square", frequency: o.f1 }).start());
    const o2 = ctx.keep(new Tone.Oscillator({ type: "square", frequency: o.f2 }).start());
    o1.connect(env); o2.connect(env);
    const hp = ctx.keep(new Tone.Filter(3500, "highpass")).connect(out);
    const click = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.005 } })).connect(hp);
    click.volume.value = -16;
    const clock = I.monotonic(env), clickClock = I.monotonic(click);
    return {
      out,
      hit(t, vel, neck) {
        if (!Number.isFinite(vel)) return;
        const tt = clock(t), k = neck ? o.neck : 1;
        o1.frequency.setValueAtTime(o.f1 * k, tt); o2.frequency.setValueAtTime(o.f2 * k, tt);
        env.gain.setValueAtTime(0, tt);
        env.gain.linearRampToValueAtTime(0.5 * vel, tt + 0.001);
        env.gain.setTargetAtTime(0.16 * vel, tt + 0.001, 0.012);
        env.gain.setTargetAtTime(0, tt + 0.03, neck ? o.decay * 0.45 : o.decay);
        click.triggerAttackRelease(0.01, clickClock(t), vel);
      },
    };
  }

  // ---------- voicing helpers ----------
  /** Stack voices under a lead note. */
  function harmonize(lead, sym, n, floor = 55) {
    const c = T.chord(sym), tones = core(sym);
    if (c.intervals.includes(13) && mod12(lead) !== c.root) { const i = tones.indexOf(c.root); if (i >= 0) tones[i] = mod12(c.root + 1); } // b9 replaces the root
    // the section holds chord tones under the lead (at least a minor third apart), so passing notes in the
    // lead rub against the band for an eighth at most
    const out = [lead];
    let cur = lead;
    for (let i = 1; i < n; i++) {
      let x = cur - 3;
      while (!tones.includes(mod12(x))) x--;
      if (x < floor) break;
      out.unshift(x); cur = x;
    }
    return out;
  }
  /** Montuno line notes for a chord: hi near the previous hi, lo the next chord tone down. */
  function montunoPair(sym, prevHi) {
    const c = T.chord(sym), tones = c.kind === "major7" ? [0, 4, 7].map((i) => mod12(c.root + i)) : core(sym); // no maj7 in the octaves
    const cands = T.notesIn(tones, 67, 79);
    let hi = cands[0], best = Infinity;
    for (const m of cands) { const s = Math.abs(m - prevHi) + (m === prevHi ? 1.5 : 0) + (mod12(m) === c.root ? 0.8 : 0); if (s < best) { best = s; hi = m; } }
    const los = T.notesIn(tones, 64, hi - 3);
    const lo = los.length ? los[los.length - 1] : T.notesIn(tones, hi + 3, hi + 8)[0] ?? hi;
    return { hi, lo };
  }
  /** Octave plus the chord filled in between (guide tones first, never a semitone against the octave). */
  function filled(n, sym) {
    const c = T.chord(sym), tones = core(sym);
    const inner = T.notesIn(tones, n - 11, n - 1).filter((m) => n - m > 1 && m - (n - 12) > 1);
    inner.sort((a, b) => (c.guide.includes(mod12(b)) ? 1 : 0) - (c.guide.includes(mod12(a)) ? 1 : 0));
    const pick = inner.slice(0, 2).sort((a, b) => a - b);
    if (pick.length === 2 && pick[1] - pick[0] === 1) pick.pop();
    return [n - 12, ...pick, n];
  }

  Sim.register({
    id: "mambo",
    title: "Mambo Plaza",
    genre: "Mambo",
    about: "A 1950s New York mambo at 190 in 2-3 clave: piano montuno and tumbao bass, congas, bongo martillo and bell, timbales on cáscara then the mambo bell, a three-part trumpet tune, a D minor sax verse, coro answered by a rotating soloist, interlocking mambo riffs, a percussion breakdown and a moña a step up.",
    bpm: 190, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    strongBeats: [0, 2],
    situations: ["party", "celebrate", "romance"],
    energy: 0.85,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.012, lowcut: 260, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.025, lowcut: 350, highcut: 6500 });

      const tpt = I.brassStab(ctx, { volume: -2, base: 650, octaves: 3.2, attack: 0.01, release: 0.1 });
      const solo = I.brassStab(ctx, { volume: -1, base: 700, octaves: 3.4, attack: 0.015, release: 0.14 });
      const tbn = I.synthBrass(ctx, { volume: -4, attack: 0.03, swell: 0.07, base: 260, octaves: 2.6, release: 0.18 });
      const alto = I.sax(ctx, { volume: -3, cutoff: 3400, vibratoDepth: 0.03 });
      const tenor = I.sax(ctx, { volume: -5, cutoff: 2800, base: 600, vibratoDepth: 0.025 });
      const coro = I.choir(ctx, { volume: -5, vowel: "o", attack: 0.05, release: 0.35 });
      const piano = I.softPiano(ctx, { volume: -4, cutoff: 5600, decay: 1.6, release: 0.35 });
      const hammer = I.marimba(ctx, { volume: -15, hardness: 1.1, decay: 0.3, cutoff: 6000 });
      const bass = I.upright(ctx, { volume: -2, base: 190 });

      const kitT = I.kit(ctx, { volume: -2, preload: ["timbale", "rim", "crash"] });
      const kitC = I.kit(ctx, { volume: 0, preload: ["conga", "congaLow"] });
      const kitB = I.kit(ctx, { volume: -1, preload: ["bongo"] });
      const kitG = I.kit(ctx, { volume: -6, preload: ["guiro"] });
      const kitK = I.kit(ctx, { volume: -7, preload: ["clave"] });
      const mbP = ctx.keep(new Tone.Panner(0.4)).connect(out), cbP = ctx.keep(new Tone.Panner(-0.12)).connect(out);
      const mamboBell = cowbell(ctx, mbP, { level: -6, f1: 820, f2: 1190, bp: 3000, Q: 1.4, decay: 0.07, neck: 1.07 });
      const campana = cowbell(ctx, cbP, { level: -8, f1: 560, f2: 850, bp: 2100, Q: 1.1, decay: 0.11, neck: 1.1 });

      const tp = I.place(ctx, tpt, 0.18, out), sp = I.place(ctx, solo, 0.05, out), bp = I.place(ctx, tbn, -0.25, out);
      const ap = I.place(ctx, alto, -0.08, out), np = I.place(ctx, tenor, -0.32, out), cp = I.place(ctx, coro, 0.3, out);
      const pp = I.place(ctx, piano, -0.4, out), hp = I.place(ctx, hammer, -0.4, out);
      I.place(ctx, bass, 0, out);
      const kt = I.place(ctx, kitT, 0.35, out), kc = I.place(ctx, kitC, -0.3, out), kb = I.place(ctx, kitB, -0.05, out);
      const kg = I.place(ctx, kitG, 0.55, out), kk = I.place(ctx, kitK, -0.55, out);
      I.send(ctx, tp, hall, -13); I.send(ctx, sp, hall, -11); I.send(ctx, bp, hall, -14); I.send(ctx, ap, hall, -14); I.send(ctx, np, hall, -15);
      I.send(ctx, cp, hall, -9); I.send(ctx, pp, room, -14); I.send(ctx, hp, room, -18);
      [kt, kc, kb, kg, kk, mbP, cbP].forEach((k) => I.send(ctx, k, room, -15));
      I.send(ctx, bass.out, room, -24);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      const perc = (kit) => (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len });
      return {
        trumpets: { layer: "melody", play: pl(tpt), humanize: { timing: 0.006, vel: 0.05 } },
        solo: { layer: "melody", play: pl(solo), humanize: { timing: 0.01, vel: 0.06 } },
        alto: { layer: "melody", play: pl(alto), humanize: { timing: 0.007, vel: 0.05 } },
        coro: { layer: "melody", play: pl(coro), humanize: { timing: 0.01, vel: 0.05 } },
        tenor: { layer: "harmony", play: pl(tenor), humanize: { timing: 0.007, vel: 0.05 } },
        trombones: { layer: "harmony", play: pl(tbn), humanize: { timing: 0.007, vel: 0.05 } },
        piano: { layer: "harmony", play: (t, e, d) => { piano.play(t, e.note, d, e.vel); hammer.play(t, e.note, Math.min(d, 0.2), e.vel * 0.8); }, humanize: { timing: 0.005, vel: 0.06 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.004, vel: 0.05 } },
        timbales: { layer: "drums", play: perc(kitT), humanize: { timing: 0.004, vel: 0.08 } },
        bell: { layer: "drums", play: (t, e) => mamboBell.hit(t, e.vel, e.note === "neck"), humanize: { timing: 0.003, vel: 0.06 } },
        congas: { layer: "drums", play: perc(kitC), humanize: { timing: 0.005, vel: 0.08 } },
        bongo: { layer: "drums", play: perc(kitB), humanize: { timing: 0.005, vel: 0.1 } },
        campana: { layer: "drums", play: (t, e) => campana.hit(t, e.vel, e.note === "neck"), humanize: { timing: 0.004, vel: 0.06 } },
        guiro: { layer: "drums", play: perc(kitG), humanize: { timing: 0.004, vel: 0.08 } },
        clave: { layer: "drums", play: perc(kitK), humanize: { timing: 0.003, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1), prev = cycle > 0 ? planAt(cycle - 1) : null;
      const syms = barsOf(plan, next);
      const nextSyms = barsOf(next, planAt(cycle + 2));
      const symAt = (b) => (b >= 32 ? nextSyms[0] : syms[Math.max(0, Math.min(7, Math.floor(b / BPB + 1e-9)))]);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const D = plan.dyn, K = plan.K, id = plan.id, odd = plan.round % 2 === 1;
      const off = plan.part * 32; // where this cycle sits inside a 16-bar line
      const arriving = !prev || prev.id !== id; // a new section starts here
      const leaving = next.id !== id; // the last cycle of a section
      const cierre = id === "mona" && plan.part === 1; // the round ends with a bloque
      const brk = id === "brk";

      /** Emit a written line (F-frame) for this cycle's slice, transposed and optionally harmonized. */
      const writ = (track, notes, { from = 0, to = 32, shift = 0, voices = 1, vel = 0.7, floor = 55, octave = 0, lo = 0, hi = 128, gap = 0.94, under = false } = {}) => {
        for (const n of notes) {
          const at = n.beat + shift - off;
          if (at < from - 1e-6 || at >= to - 1e-6) continue;
          const lead = n.note + K + octave;
          const sym = symAt(at % BPB === 3.5 ? at + 0.5 : at); // the "and" of 4 anticipates the next bar's chord
          let note = voices > 1 ? harmonize(lead, sym, voices, floor) : lead;
          if (under) { if (note.length < 2) continue; note = note[0]; } // a second mono horn: just the voice under the lead
          if (Array.isArray(note)) note = note.filter((m) => m >= lo && m <= hi);
          else if (note < lo || note > hi) continue;
          if (Array.isArray(note) && !note.length) continue;
          const inBar = at % BPB;
          const acc = (n.dur >= 1 ? 0.06 : 0) + (inBar === 0 || inBar === 2 ? 0.03 : 0) + (at % 1 === 0.5 ? 0.04 : 0);
          push(track, at, Math.max(0.2, n.dur * gap), Array.isArray(note) && note.length === 1 ? note[0] : note, (vel + acc) * D);
        }
      };
      const loop4 = (notes, times) => { const outN = []; for (let k = 0; k < times; k++) notes.forEach((n) => outN.push({ ...n, beat: n.beat + 16 * k })); return outN; };

      // ================= horns, coro, solos =================
      if (id === "intro") {
        writ("trombones", INTRO_TBN, { to: 16, vel: 0.62 });
        writ("tenor", INTRO_TBN, { to: 16, octave: 12, vel: 0.5 });
        writ("trumpets", INTRO_TPT, { shift: 16, voices: 2, vel: 0.62, floor: 58 });
        writ("alto", INTRO_TPT, { shift: 16, octave: -12, vel: 0.5 });
        for (let b = 4; b < 8; b++) { // trombones hold the guide tones under the answer
          const v = T.voice(syms[b], { lo: 50, hi: 63, n: 2, prev: state.tbnV, rng: r });
          state.tbnV = v;
          push("trombones", b * BPB, 2.9, v, 0.36 * D); // released before the bass anticipates
        }
      } else if (id === "A") {
        if (!odd) {
          writ("trumpets", VERSE_A, { voices: 2, vel: 0.6, floor: 58 });
          writ("alto", VERSE_A, { octave: -12, vel: 0.46 });
        } else { // second time round the saxes take the tune in thirds, the trumpets punch
          writ("alto", VERSE_A, { vel: 0.6 });
          writ("tenor", VERSE_A, { vel: 0.46, voices: 2, floor: 52, under: true });
        }
        // trombone backgrounds: where the tune rests on the 3-side, punch the guide tones; otherwise a soft pad
        for (let b = 0; b < 8; b++) {
          const sym = syms[b];
          const v = T.voice(sym, { lo: 50, hi: 64, n: 3, prev: state.tbnV, rng: r });
          state.tbnV = v;
          const s = off + b * BPB;
          const busy = VERSE_A.some((n) => n.beat >= s + 2.5 && n.beat < s + 4);
          if (b % 2 === 1 && !busy) { push("trombones", b * BPB + 2.5, 0.4, v, 0.5 * D); push("trombones", b * BPB + 3, 0.8, v, 0.54 * D); }
          else if (b % 2 === 0) push("trombones", b * BPB, 1.8, v, 0.3 * D);
        }
        if (odd) for (const b of [1, 3, 5]) { // trumpet punches on the 3-side
          const v = T.voice(syms[b], { lo: 62, hi: 79, n: 3, top: [72, 78], spread: "close", rng: r });
          if (!VERSE_A.some((n) => n.beat >= off + b * BPB + 2.5 && n.beat < off + b * BPB + 4)) { push("trumpets", b * BPB + 2.5, 0.35, v, 0.5 * D); push("trumpets", b * BPB + 3, 0.6, v, 0.55 * D); }
        }
      } else if (id === "B") {
        if (!odd) {
          writ("alto", VERSE_B, { vel: 0.62 });
          writ("tenor", VERSE_B, { vel: 0.48, voices: 2, floor: 50, under: true });
        } else { // second time: alto and tenor in octaves
          writ("alto", VERSE_B, { vel: 0.52 });
          writ("tenor", VERSE_B, { vel: 0.6, octave: -12 });
        }
        // trombone pads on the guide tones; the trumpets (or saxes) answer on the 2-side of every other pair
        for (let b = 0; b < 8; b++) {
          const v = T.voice(syms[b], { lo: 50, hi: 62, n: 2, prev: state.tbnV, rng: r });
          state.tbnV = v;
          push("trombones", b * BPB, 2.9, v, 0.32 * D);
        }
        for (const b of [1, 5]) {
          const s = off + b * BPB;
          { const v = T.voice(syms[b], { lo: 64, hi: 81, n: 3, top: [74, 80], spread: "close", rng: r }); push("trumpets", b * BPB + 2.5, 0.35, v, 0.42 * D); push("trumpets", b * BPB + 3, 0.7, v, 0.46 * D); }
        }
      } else if (id === "mont" || id === "mona") {
        const coroLine = id === "mont" ? CORO_A : CORO_B;
        const coroGroups = id === "mona" && plan.part === 1 ? [] : [0, 16];
        coroGroups.forEach((g) => coroLine.forEach((n) => {
          const at = g + n.beat;
          const sym = symAt(at % BPB === 3.5 ? at + 0.5 : at);
          push("coro", at, n.dur * 0.92, harmonize(n.note + K, sym, 3, 60), (0.5 + (n.dur >= 1 ? 0.05 : 0)) * D);
        }));
        if (id === "mont") {
          // the soloist answers the coro in bars 3-4 of every four
          const who = plan.soloist;
          const spec = who === "trumpet" ? { track: "solo", lo: 65, hi: 84, dens: 0.55 } : who === "sax" ? { track: "alto", lo: 58, hi: 79, dens: 0.6 } : { track: "piano", lo: 67, hi: 84, dens: 0.72 };
          for (const g of [8, 24]) {
            const lead = r.pick([0, 0.5, 1]);
            const scaleFor = (sym) => { const c = T.chord(sym); const sc = c.scale; return /major/.test(c.kind) ? sc.filter((p) => p !== mod12(c.root + 5)) : sc; }; // no 4th over a major chord
            const m = C.line({ start: g, end: g + 8, lead, scaleFor, chordAt: (b) => symAt(b), lo: spec.lo, hi: spec.hi, rng: r.fork(g + 7), density: spec.dens + 0.08 * plan.part, phrase: [3, 7], rest: [0.5, 1.5], motif: state.soloMotif, motifProb: 0.45, chromatic: 0.25, register: 0.55 + 0.1 * plan.part, prev: state.soloLast, upbeatStart: 0.6 });
            state.soloMotif = m.motif; state.soloLast = m.last;
            m.notes.forEach((n) => {
              if (n.beat >= g + 7.75) return;
              const vel = (0.56 + (n.vel - 0.6) * 1.1 + (n.strong ? 0.04 : 0)) * D;
              if (who === "piano") push("piano", n.beat, Math.min(n.dur, 0.9), [n.note - 12, n.note], vel * 0.95);
              else push(spec.track, n.beat, n.dur, n.note, vel);
            });
          }
        } else {
          // moña: trumpets answer the coro, then trombones and saxes pile on; the last bar is the cierre
          const end = cierre ? 27.5 : 32; // no anticipation into the cierre
          if (plan.part === 0) {
            writ("trumpets", loop4(MONA_TPT, 2), { from: 8, to: 16, voices: 3, vel: 0.6, floor: 63 });
            writ("trumpets", loop4(MONA_TPT, 2), { from: 24, to: 32, voices: 3, vel: 0.62, floor: 63 });
          } else {
            writ("trumpets", loop4(MONA_TPT, 4), { to: end, voices: 3, vel: 0.64, floor: 63 });
            writ("trombones", loop4(MONA_TBN, 4), { to: end, vel: 0.56, voices: 2, floor: 50 });
            writ("alto", loop4(MONA_SAX, 4), { from: 16, to: end, vel: 0.58 });
            writ("tenor", loop4(MONA_SAX, 4), { from: 16, to: end, vel: 0.46, voices: 2, floor: 52, under: true });
          }
        }
      } else if (id === "mambo") {
        // entries: trombones, then trumpets, then saxes (odd rounds: trumpets first)
        const order = odd ? ["trumpets", "trombones", "saxes"] : ["trombones", "trumpets", "saxes"];
        const startOf = (who) => [0, 16, 32][order.indexOf(who)];
        const from = (who) => Math.max(0, startOf(who) - off);
        const to = leaving ? 31.5 : 32; // the breakdown follows: nothing anticipates it
        writ("trombones", loop4(MAMBO_TBN, 4).flatMap((n) => [n, { ...n, note: n.note + 12 }]), { from: from("trombones"), to, vel: 0.58 });
        writ("trumpets", loop4(MAMBO_TPT, 4), { from: from("trumpets"), to, voices: 3, vel: 0.6, floor: 63 });
        if (plan.part === 1) {
          writ("alto", loop4(MAMBO_SAX, 4), { from: from("saxes"), to, vel: 0.54 });
          writ("tenor", loop4(MAMBO_SAX, 4), { from: from("saxes"), to, vel: 0.44, voices: 2, floor: 50, under: true });
        }
      }

      // ================= bloques (band unison hits) =================
      const bloqueBar = cierre ? 7 : brk ? 7 : -1;
      if (bloqueBar >= 0) {
        const sym = syms[bloqueBar], s = bloqueBar * BPB;
        const hits = [[0, 0.35], [1.5, 0.35], [3, 0.7]];
        const vT = T.voice(sym, { lo: 64, hi: 82, n: 4, top: [77, 82], spread: "close", rng: r });
        const vB = T.voice(sym, { lo: 50, hi: 65, n: 3, prev: state.tbnV, rng: r });
        const vS = T.voice(sym, { lo: 58, hi: 72, n: 2, rng: r });
        hits.forEach(([b, d], i) => {
          const v = (0.66 + 0.06 * i) * D;
          push("trumpets", s + b, d, vT, v); push("trombones", s + b, d, vB, v * 0.9);
          push("alto", s + b, d, vS[1], v * 0.85); push("tenor", s + b, d, vS[0], v * 0.8);
          push("piano", s + b, d, filled(montunoPair(sym, 72).hi, sym), v * 0.85);
          push("bass", s + b, d + 0.1, T.nearest(40, [T.chord(sym).root], 33, 45), v);
        });
      }

      // ================= piano montuno =================
      const soloPiano = id === "mont" && plan.soloist === "piano";
      {
        const style = id === "A" || id === "B" ? "block" : id === "mambo" || id === "mona" ? "guajeo2" : "guajeo";
        const playBar = (b) => {
          if (brk) return b === 5 || b === 6; // the piano peeks back in before the bloque
          if (b === bloqueBar) return false;
          if (soloPiano && (b % 4 === 2 || b % 4 === 3)) return false; // the right hand is soloing
          return true;
        };
        // one line pair per bar, each led from the last; the anticipation on 4& already uses the next bar's pair
        const pairs = [];
        let h = state.montHi ?? 72;
        for (let b = 0; b < 8; b++) {
          pairs[b] = b === 0 && state.montNext && state.montNext.sym === syms[0] ? state.montNext : { sym: syms[b], ...montunoPair(syms[b], h) };
          h = pairs[b].hi;
        }
        const after = { sym: nextSyms[0], ...montunoPair(nextSyms[0], h) };
        state.montHi = h; state.montNext = after;
        for (let b = 0; b < 8; b++) {
          if (!playBar(b)) continue;
          const pat = MONTUNO[style][b % 2];
          for (let i = 0; i < 8; i++) {
            const ch = pat[i];
            if (ch === ".") continue;
            const at = b * BPB + i * 0.5;
            if (i === 7 && (b + 1 === bloqueBar || (b === 7 && leaving && (next.id === "brk" || cierre)) || (soloPiano && b % 4 === 1))) continue; // no anticipation into a break
            const pair = i === 7 ? (b === 7 ? after : pairs[b + 1]) : pairs[b];
            const n = ch === "H" || ch === "F" ? pair.hi : pair.lo;
            const notes = ch === "F" || ch === "G" ? filled(n, pair.sym) : [n - 12, n];
            const vel = (ch === "F" || ch === "G" ? 0.5 : 0.42) + (i % 2 ? 0.04 : 0);
            push("piano", at, i === 7 ? 0.9 : i === 6 ? 0.22 : 0.42, notes, vel * D * (style === "block" ? 0.92 : 1));
          }
        }
      }

      // ================= tumbao bass =================
      {
        let last = state.bassLast ?? 41;
        const rootNear = (sym, ref) => T.nearest(ref, [T.chord(sym).root], 33, 46);
        const fifthOf = (root, sym) => { const c = T.chord(sym); const iv = c.intervals.find((i) => i === 7 || i === 6) ?? 7; const f = root + iv; return f <= 50 ? f : f - 12; };
        for (let b = 0; b < 8; b++) {
          if (brk && b < 4) continue;
          if (b === bloqueBar) continue;
          const s = b * BPB, sym = syms[b];
          const afterBreak = !prev || prev.id === "brk" || (prev.id === "mona" && prev.part === 1);
          const fresh = (b === 0 && afterBreak) || (brk && b === 4);
          if (fresh) { last = rootNear(sym, last); push("bass", s, 1.4, last, 0.72 * D); }
          // 2&: the fifth (or the root) of this chord
          const n1 = fresh || r.chance(0.75) ? fifthOf(rootNear(sym, last), sym) : rootNear(sym, last);
          push("bass", s + 1.5, 1.45, n1, 0.62 * D);
          // 4: the next bar's root, tied over the barline
          const nextSym = b === 7 ? (next.id === "brk" || cierre || b + 1 === bloqueBar ? null : nextSyms[0]) : (b + 1 === bloqueBar ? null : syms[b + 1]);
          if (nextSym) {
            let n2 = rootNear(nextSym, n1);
            if (n2 === n1) n2 = n1 + 12 <= 50 ? n1 + 12 : n1 - 12 >= 33 ? n1 - 12 : n1; // same note again: jump the octave
            push("bass", s + 3, 2.4, n2, 0.74 * D);
            last = n2;
            if (r.chance(0.15) && b % 2 === 1) { // a pickup from another tone of this chord
              const pk = T.notesIn(core(sym), n2 - 7, n2 + 7).filter((m) => m !== n2 && m !== n1 && m >= 33 && m <= 50);
              if (pk.length) push("bass", s + 2.5, 0.45, pk.reduce((a, m) => (Math.abs(m - n2) < Math.abs(a - n2) ? m : a)), 0.5 * D);
            }
          } else { push("bass", s + 3, 0.9, rootNear(sym, n1), 0.66 * D); last = rootNear(sym, n1); }
        }
        state.bassLast = last;
      }

      // ================= percussion =================
      const hit = (track, abs, voice, vel, extra) => push(track, abs, 0.25, voice, vel, extra);
      const bellPhase = id === "mont" || id === "mambo" || id === "mona" || (brk);
      for (let b = 0; b < 8; b++) {
        const s = b * BPB, side = b % 2;
        const isBloque = b === bloqueBar;
        const lastBar = b === 7 && (leaving || cierre);
        const fillFrom = lastBar || isBloque ? 3 : 4;
        // ---- clave: always, except the first breakdown bars ----
        CLAVE[side].forEach((x) => hit("clave", s + x, "clave", (x === 0 ? 0.5 : 0.44) * D));
        // ---- güiro: long-short-short ----
        if (!(brk && b < 2) && !isBloque) {
          [[0, 0.22, 0.42], [1, 0.07, 0.3], [1.5, 0.07, 0.34], [2, 0.22, 0.4], [3, 0.07, 0.3], [3.5, 0.07, 0.34]].forEach(([x, len, v]) => {
            if (x < fillFrom) push("guiro", s + x, 0.25, "guiro", v * D, { len });
          });
        }
        // ---- congas: tumbao, with the tumbadora answering on the 3-side ----
        if (!isBloque) {
          const open = bellPhase ? 1.1 : 1;
          hit("congas", s, "conga", 0.13 * D, { pitch: 60 }); // heel
          hit("congas", s + 0.5, "conga", 0.11 * D, { pitch: 61 }); // toe
          hit("congas", s + 1, "conga", 0.5 * D, { pitch: 68 }); // slap
          hit("congas", s + 1.5, "conga", 0.12 * D, { pitch: 61 });
          hit("congas", s + 2, "conga", 0.13 * D, { pitch: 60 });
          hit("congas", s + 2.5, "conga", 0.11 * D, { pitch: 61 });
          if (fillFrom > 3) {
            if (side === 0) { hit("congas", s + 3, "conga", 0.5 * open * D, { pitch: 63 }); hit("congas", s + 3.5, "conga", 0.46 * open * D, { pitch: 63 }); }
            else { hit("congas", s + 3, "conga", 0.5 * open * D, { pitch: 63 }); hit("congas", s + 3.5, "congaLow", 0.54 * open * D, { pitch: 56 }); }
            if (bellPhase && side === 1 && r.chance(0.35)) hit("congas", s + 2.5, "congaLow", 0.42 * D, { pitch: 56 }); // third drum talking
          }
        }
        // ---- bongo: martillo in the verses, bongo bell from the montuno on ----
        if (!isBloque && !(brk && b < 2)) {
          if (!bellPhase) MARTILLO.forEach(([x, v, p]) => { if (x < fillFrom) hit("bongo", s + x, "bongo", v * D * 1.15, { pitch: p }); });
          else {
            [0, 1, 2, 3].forEach((x) => { if (x < fillFrom) push("campana", s + x, 0.25, x % 2 ? "neck" : "mouth", (x % 2 ? 0.36 : 0.56) * D); });
            if (side === 1 && fillFrom > 3 && r.chance(0.5)) push("campana", s + 3.5, 0.25, "neck", 0.28 * D);
          }
        }
        // ---- timbales: cáscara in the verses, the mambo bell later; the left hand on the hembra ----
        const solo = brk && b >= 4 && b < 7;
        if (!isBloque && !(brk && b < 4) && !solo) {
          if (!bellPhase) {
            CASCARA[side].forEach((x) => { if (x < fillFrom) hit("timbales", s + x, "rim", ((CLAVE[side].includes(x) ? 0.62 : 0.5) + (x === 0 ? 0.06 : 0)) * D); });
            if (fillFrom > 3) hit("timbales", s + 3, "timbale", 0.22 * D, { pitch: 67 });
          } else {
            BELL[side].forEach(([x, neck]) => { if (x < fillFrom) push("bell", s + x, 0.25, neck ? "neck" : "mouth", (neck ? 0.42 : 0.6) * D); });
            if (side === 0 && fillFrom > 3) hit("timbales", s + 3, "timbale", 0.4 * D, { pitch: 67 }); // hembra on 4 of the 2-side
          }
        }
        if (solo) { // timbale solo: phrases of sixteenths and rimshots against the clave
          const cells = [[[0, 74, 0.6], [0.5, 67, 0.4], [1, 74, 0.5], [1.25, 74, 0.3], [1.5, 67, 0.55], [2.5, 74, 0.6], [3, 67, 0.5], [3.5, 74, 0.65]],
            [[0, 67, 0.55], [0.25, 67, 0.3], [0.5, 74, 0.45], [1, 74, 0.6], [2, 67, 0.4], [2.25, 74, 0.35], [2.5, 74, 0.5], [2.75, 67, 0.4], [3, 74, 0.7]],
            [[0, 74, 0.7], [1.5, 74, 0.65], [2, 67, 0.4], [2.25, 67, 0.4], [2.5, 67, 0.45], [2.75, 74, 0.5], [3, 74, 0.6], [3.25, 74, 0.4], [3.5, 67, 0.6]]];
          if (b === 4) state.soloCells = r.shuffle([0, 1, 2]);
          cells[(state.soloCells || [0, 1, 2])[b - 4]].forEach(([x, p, v]) => hit("timbales", s + x, "timbale", v * D, { pitch: p }));
          CLAVE[side].forEach((x) => hit("timbales", s + x, "rim", 0.5 * D));
        }
        // ---- abanico: a rimshot on 4 and a roll into the next downbeat ----
        if (lastBar || isBloque) {
          hit("timbales", s + 3, "timbale", 0.72 * D, { pitch: 74 }); hit("timbales", s + 3, "rim", 0.7 * D);
          for (let k = 0; k < 6; k++) hit("timbales", s + 3.25 + k * 0.125, "timbale", (0.26 + 0.07 * k) * D, { pitch: k % 2 ? 74 : 72 });
        }
        // ---- bloque: the timbales hit with the band ----
        if (isBloque) [0, 1.5].forEach((x) => { hit("timbales", s + x, "timbale", 0.75 * D, { pitch: 74 }); hit("timbales", s + x, "crash", 0.5 * D); });
        // ---- inner phrase fills (8-bar points inside 16-bar sections) ----
        if (b === 7 && !lastBar && !brk && plan.part === 0 && r.chance(0.6)) {
          const f = r.pick([[[2.5, 67], [3, 74], [3.5, 74]], [[3, 74], [3.25, 67], [3.5, 74], [3.75, 67]], [[2, 74], [2.5, 74], [3, 67], [3.5, 67]]]);
          f.forEach(([x, p], i) => hit("timbales", s + x, "timbale", (0.4 + 0.07 * i) * D, { pitch: p }));
        }
      }
      // arrivals: crash and macho on the downbeat of a new section (and of the moña's pile-up)
      if ((arriving && cycle > 0 && !brk) || (id === "mona" && plan.part === 1) || (id === "mambo" && plan.part === 1)) {
        hit("timbales", 0, "crash", 0.62 * D); hit("timbales", 0, "timbale", 0.65 * D, { pitch: 74 });
      }
      if (cycle === 0) { hit("timbales", 0, "timbale", 0.6, { pitch: 74 }); hit("timbales", 0, "crash", 0.5); }

      // ================= label =================
      let label = plan.label;
      if (id === "mont") label += ` ${plan.soloist}`;
      if (id === "A") label += odd ? " · saxes lead" : " · trumpets lead";
      if (id === "B") label += odd ? " · saxes in octaves" : " · alto lead";
      if (plan.round > 0) label += ` · round ${plan.round + 1}`;
      const harmony = syms.map((chord, bar) => ({ bar, beat: 0, dur: BPB, chord }));
      return { events: ev, harmony, section: label, state };
    },
  });
})();

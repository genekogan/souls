// Mirror Ball: 1976 Philadelphia / Salsoul disco for the dancefloor under the ball.
//
// Groove (118 BPM, straight): four-on-the-floor kick, closed hat on the beat and an open hat on every "and",
// snare and clap on 2 and 4, tambourine 16ths, congas (open tones and slaps, the low drum on the "and" of 3),
// an electric bass that jumps octaves in eighths, a muted "chicken scratch" guitar in 16ths with accented chops,
// a clean guitar chank on 2 and 4 in the choruses, a string section that pads, stabs and sweeps up into every
// arrival, a horn section that answers the tune, and the tune itself on strings in octaves or on flute.
//
// Harmony (written in F minor / Ab major, transposed for the lift):
//   verse   the dorian vamp Fm9 – Bb13, then a turnaround onto C7#9 (v1 via Dbmaj9, v2 via Abmaj9 Gm7b5).
//   pre     the V7 of the verse goes deceptively to Dbmaj9: Db – Cm7 – Bbm9 – Eb13sus4 descends while the string line
//           climbs F G Ab, Bb; a 32nd-note string sweep lands the chorus.
//   chorus  the relative major. The hook is one cell (a syncopated "da-DAAA" with an anticipation) sequenced up a
//           step per bar over a rising bass I – ii – iii – IV, peaking on C6, the maj7 of Dbmaj9; the answer falls
//           through a ii–V into vi (Gm7b5 C7#9 → Fm9), its secondary Bb13, and Eb13sus4 back to the top.
//   break   drums and congas only (timbales and bongos join), then the strings swell back in over Fm11 and a
//           chromatic approach (Db Eb Cm F13, or Db D Bm E13) takes the last choruses up a whole or a half step.
// Form, one "set" of eleven 8-bar phrases (88 bars, about 3 minutes):
//   intro (drums, then the band and the horn riff) · verse · verse · pre · chorus · chorus · percussion break ·
//   strings swell · LIFTED chorus ×2 · outro (horn riff in the new key, the band drops out to drums and congas,
//   which become the next set's intro). Sets alternate the lift (+2 / +1) and who sings the verse (flute / strings).
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  // ---------- form ----------
  const PHRASES = ["intro", "v1", "v2", "pre", "c1", "c2", "brk1", "brk2", "mc1", "mc2", "outro"];
  const LIFTED = new Set(["mc1", "mc2", "outro"]);
  const SETS = [{ lift: 2 }, { lift: 1 }];
  const STYLE = { intro: "intro", v1: "verse", v2: "verse", pre: "pre", c1: "chorus", c2: "chorus", brk1: "break", brk2: "swell", mc1: "chorus", mc2: "chorus", outro: "outro" };

  const PROG = {
    intro: "| Fm9 | Bb13 | Fm9 | Bb13 | Fm9 | Bb13 | Fm9 | Bb13 |",
    v1: "| Fm9 | Bb13 | Fm9 | Bb13 | Fm9 | Bb13 | Dbmaj9 | C7sus4 C7#9 |",
    v2: "| Fm9 | Bb13 | Fm9 | Bb13 | Fm9 | Bb13 | Abmaj9 Gm7b5 | C7sus4 C7#9 |",
    pre: "| Dbmaj9 | Cm7 | Bbm9 | Eb13sus4 | Dbmaj9 | Cm7 | Bbm9 | Eb13sus4 Eb13 |",
    c1: "| Abmaj9 | Bbm9 | Cm7 | Dbmaj9 | Gm7b5 C7b9 | Fm9 Bb13 | Bbm9 | Eb13sus4 Eb13 |",
    c2: "| Abmaj9 | Bbm9 | Cm7 | Dbmaj9 | Gm7b5 C7b9 | Fm9 Bb13 | Bbm9 | C7sus4 C7#9 |",
    brk1: "| Fm11 | % | % | % | % | % | % | % |",
    brk2_2: "| Fm11 | % | % | % | Dbmaj9 | Ebmaj9 | Cm9 | F13sus4 F13 |",
    brk2_1: "| Fm11 | % | % | % | Dbmaj9 | Dmaj9 | Bm9 | E13sus4 E13 |",
    outro: "| Fm9 | Bb13 | Fm9 | Bb13 | Dbmaj9 | Cm7 | Bbm9 | Eb13sus4 |",
  };

  // ---------- tunes (home key) [bar, beat, dur, note] ----------
  // Chorus hook: the cell climbs Eb–F–G–Ab with long notes G–Ab–Bb–C over I ii iii IV.
  const HOOK_PICK = [[-1, 3.5, 0.5, "C5"]];
  const HOOK_HEAD = [
    [0, 0, 0.5, "Eb5"], [0, 0.5, 1, "G5"], [0, 1.5, 0.5, "F5"], [0, 2, 1.5, "G5"], [0, 3.5, 0.5, "Ab5"],
    [1, 0, 0.5, "F5"], [1, 0.5, 1, "Ab5"], [1, 1.5, 0.5, "G5"], [1, 2, 1.5, "Ab5"], [1, 3.5, 0.5, "Bb5"],
    [2, 0, 0.5, "G5"], [2, 0.5, 1, "Bb5"], [2, 1.5, 0.5, "C6"], [2, 2, 1.5, "Bb5"], [2, 3.5, 0.5, "C6"],
    [3, 0, 0.5, "Ab5"], [3, 0.5, 2, "C6"], [3, 2.5, 0.5, "Bb5"], [3, 3, 1, "Ab5"],
    // the answer: down through the ii–V into vi (the #9 of C7 bends to its 3rd)
    [4, 0, 0.5, "F5"], [4, 0.5, 1, "Bb5"], [4, 1.5, 0.5, "Ab5"], [4, 2, 0.5, "G5"], [4, 2.5, 1, "E5"], [4, 3.5, 0.5, "G5"],
    [5, 0, 1.5, "Ab5"], [5, 1.5, 0.5, "G5"], [5, 2, 1.5, "F5"], [5, 3.5, 0.5, "Ab5"],
    [6, 0, 0.5, "Db5"], [6, 0.5, 1, "F5"], [6, 1.5, 0.5, "Eb5"], [6, 2, 1.5, "F5"], [6, 3.5, 0.5, "Bb5"],
  ];
  const HOOK_END_TURN = [[7, 0, 1.5, "Ab5"], [7, 1.5, 0.5, "F5"], [7, 2, 1.5, "G5"]]; // sus4 → 3 of Eb13
  const HOOK_END_HOME = [[7, 0, 1.5, "F5"], [7, 1.5, 0.5, "D5"], [7, 2, 2, "E5"]];   // sus4 → 3 of C7#9, the leading tone of F minor
  const HOOK_A = HOOK_PICK.concat(HOOK_HEAD, HOOK_END_TURN);
  const HOOK_B = HOOK_PICK.concat(HOOK_HEAD, HOOK_END_HOME);

  // Verse: a call (bars 0, 2, 4) and a short sigh (bars 1, 3, 5) that leaves beats 3–4 to the horns.
  const VERSE_HEAD = [
    [0, 0.5, 0.5, "C5"], [0, 1, 0.5, "Eb5"], [0, 1.5, 1, "F5"], [0, 2.5, 0.5, "G5"], [0, 3, 1, "Ab5"],
    [1, 0, 1.5, "G5"], [1, 1.5, 0.5, "F5"], [1, 2, 0.5, "D5"],
    [2, 0.5, 0.5, "C5"], [2, 1, 0.5, "Eb5"], [2, 1.5, 1, "F5"], [2, 2.5, 0.5, "Ab5"], [2, 3, 1, "C6"],
    [3, 0, 1.5, "Bb5"], [3, 1.5, 0.5, "Ab5"], [3, 2, 0.5, "G5"],
  ];
  const VERSE_TAIL_1 = [
    [4, 0, 0.5, "F5"], [4, 0.5, 0.5, "Eb5"], [4, 1, 1, "C5"], [4, 2, 0.5, "Eb5"], [4, 2.5, 0.5, "F5"], [4, 3, 1, "Ab5"],
    [5, 0, 2, "G5"], [5, 2, 0.5, "F5"],
    [6, 0, 1.5, "F5"], [6, 1.5, 0.5, "Eb5"], [6, 2, 2, "C5"],
    [7, 0, 1.5, "Bb4"], [7, 1.5, 0.5, "C5"], [7, 2, 0.5, "Eb5"], [7, 2.5, 1.5, "E5"],
  ];
  const VERSE_TAIL_2 = [
    [4, 0.5, 0.5, "Ab5"], [4, 1, 0.5, "G5"], [4, 1.5, 0.5, "F5"], [4, 2, 1, "Eb5"], [4, 3, 0.5, "F5"], [4, 3.5, 0.5, "Ab5"],
    [5, 0, 2, "C6"], [5, 2, 0.5, "Bb5"],
    [6, 0, 1, "G5"], [6, 1, 0.5, "Eb5"], [6, 1.5, 0.5, "C5"], [6, 2, 1, "Db5"], [6, 3, 1, "F5"],
    [7, 0, 1.5, "G5"], [7, 1.5, 0.5, "F5"], [7, 2, 0.5, "Eb5"], [7, 2.5, 1.5, "E5"],
  ];
  // Pre-chorus string line: climbs against the falling chords; bar 7 leaves room for the sweep.
  const PRE = [
    [0, 0, 3, "F5"], [0, 3, 1, "Ab5"],
    [1, 0, 3, "G5"], [1, 3, 1, "Bb5"],
    [2, 0, 3, "Ab5"], [2, 3, 1, "C6"],
    [3, 0, 2, "Bb5"], [3, 2, 1, "Ab5"], [3, 3, 1, "F5"],
    [4, 0, 2, "F5"], [4, 2, 1, "Ab5"], [4, 3, 1, "C6"],
    [5, 0, 2, "Bb5"], [5, 2, 2, "G5"],
    [6, 0, 2, "Ab5"], [6, 2, 1, "F5"], [6, 3, 1, "Db6"],
    [7, 0, 2, "C6"],
  ];
  // Strings swell: long tones climbing toward the new key (one line per lift).
  const SWELL = {
    2: [[4, 0, 2, "F5"], [4, 2, 2, "Ab5"], [5, 0, 2, "G5"], [5, 2, 2, "Bb5"], [6, 0, 2, "C6"], [6, 2, 1, "Bb5"], [6, 3, 1, "G5"], [7, 0, 2, "Bb5"]],
    1: [[4, 0, 2, "F5"], [4, 2, 2, "Ab5"], [5, 0, 2, "F#5"], [5, 2, 2, "A5"], [6, 0, 2, "C#6"], [6, 2, 1, "B5"], [6, 3, 1, "F#5"], [7, 0, 2, "A5"]],
  };
  // The swell's Fm11, re-voiced higher every bar.
  const SWELL_PAD = [["Ab3", "Eb4", "G4", "Bb4"], ["Bb3", "Eb4", "Ab4", "C5"], ["C4", "F4", "Ab4", "Eb5"], ["Eb4", "Ab4", "C5", "G5"]];
  // Outro: the flute recalls the hook's climb over Dbmaj9 Cm7 before the band drops out.
  const OUTRO_FLUTE = [
    [4, 0, 0.5, "Ab5"], [4, 0.5, 1, "C6"], [4, 1.5, 0.5, "Bb5"], [4, 2, 1.5, "Ab5"], [4, 3.5, 0.5, "F5"],
    [5, 0, 0.5, "G5"], [5, 0.5, 1, "Bb5"], [5, 1.5, 0.5, "G5"], [5, 2, 2, "Eb5"],
  ];

  // Horn riff (top line; the section harmonises below it): "BAP ba-BAAP … ba-BAP-BAP | … ba-BAAAH".
  const RIFF = [
    [0, 0, 0.3, "C6"], [0, 0.5, 0.22, "Bb5"], [0, 0.75, 0.6, "Ab5"], [0, 2.5, 0.22, "F5"], [0, 3, 0.3, "Ab5"], [0, 3.5, 0.3, "Bb5"],
    [1, 0.75, 0.22, "C6"], [1, 1, 0.9, "D6"],
  ];
  const RIFF_ANSWER = [[1, 2.5, 0.22, "C6"], [1, 2.75, 0.22, "Bb5"], [1, 3, 0.6, "Ab5"]]; // second time round
  // Horn answers in the verse's gaps (bars 1, 3, 5, beats 3–4).
  const VERSE_HORNS = [[1, 2.75, 0.25, "Ab5"], [1, 3.25, 0.6, "G5"], [3, 2.75, 0.25, "C6"], [3, 3.25, 0.6, "Bb5"], [5, 2.5, 0.22, "F5"], [5, 2.75, 0.22, "G5"], [5, 3.25, 0.6, "Ab5"]];
  // Chorus horn hits per bar [beat, dur]; dropped if they would cover a melody onset.
  const CHORUS_HORNS = { 0: [[2.75, 0.3]], 1: [[2.75, 0.3]], 2: [[2.75, 0.3]], 3: [[1.5, 0.25], [2, 0.5]], 4: [[1, 0.3]], 5: [[2.75, 0.3]], 6: [[2.75, 0.3]] };

  // ---------- bass: [beat, role, dur, vel]  R root, O octave, F fifth, S seventh, A approach ----------
  const BASS4 = {
    oct: [
      [[0, "R", 0.4, 0.92], [0.5, "O", 0.3, 0.72], [1, "R", 0.4, 0.85], [1.5, "O", 0.3, 0.72], [2, "R", 0.4, 0.88], [2.5, "O", 0.3, 0.72], [3, "R", 0.4, 0.85], [3.5, "O", 0.3, 0.75]],
      [[0, "R", 0.4, 0.92], [0.5, "O", 0.3, 0.72], [1, "R", 0.2, 0.8], [1.25, "R", 0.2, 0.52], [1.5, "O", 0.3, 0.75], [2, "R", 0.4, 0.88], [2.5, "O", 0.3, 0.72], [3, "F", 0.4, 0.8], [3.5, "O", 0.2, 0.72], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.4, 0.92], [0.5, "O", 0.3, 0.72], [1, "R", 0.4, 0.85], [1.5, "O", 0.3, 0.72], [2, "R", 0.4, 0.88], [2.5, "O", 0.22, 0.72], [2.75, "S", 0.22, 0.6], [3, "O", 0.3, 0.8], [3.5, "F", 0.22, 0.7], [3.75, "A", 0.2, 0.7]],
    ],
    pump: [[[0, "R", 0.4, 0.9], [0.5, "R", 0.35, 0.6], [1, "R", 0.4, 0.8], [1.5, "R", 0.35, 0.6], [2, "R", 0.4, 0.85], [2.5, "R", 0.35, 0.6], [3, "R", 0.4, 0.8], [3.5, "O", 0.3, 0.7]]],
    sparse: [[[0, "R", 1.6, 0.9], [2, "O", 0.4, 0.7], [2.5, "R", 0.9, 0.8], [3.5, "A", 0.4, 0.7]]],
  };
  const BASS2 = {
    oct: [[[0, "R", 0.4, 0.92], [0.5, "O", 0.3, 0.72], [1, "R", 0.4, 0.85], [1.5, "O", 0.3, 0.75]], [[0, "R", 0.4, 0.92], [0.5, "O", 0.3, 0.72], [1, "F", 0.4, 0.8], [1.5, "O", 0.2, 0.72], [1.75, "A", 0.2, 0.7]]],
    pump: [[[0, "R", 0.4, 0.9], [0.5, "R", 0.35, 0.6], [1, "R", 0.4, 0.8], [1.5, "O", 0.3, 0.7]]],
    sparse: [[[0, "R", 1.4, 0.9], [1.5, "A", 0.4, 0.7]]],
  };

  // Chicken scratch: 16 steps, X = accented chop, x = muted ghost, . = rest.
  const SCRATCH = {
    verse: ["x.X.xxX.x.X.xxX.", "xxX.x.Xxx.X.xxXx"],
    chorus: ["xxXxxxXxxxXxxxXx", "x.XxxxX.xxXxx.Xx"],
    pre: ["x.x.x.x.x.x.x.x.", "x.x.x.X.x.x.x.X."],
    swell: [".xX..xX..xX..xXx"],
  };

  // Congas: [beat, voice, pitch, vel]. Two bars that answer each other, plus a busier break pattern.
  const CONGA = [
    [[0.5, "conga", 62, 0.45], [1, "conga", 67, 0.4], [1.5, "conga", 62, 0.32], [2.5, "congaLow", 55, 0.55], [3, "conga", 67, 0.42], [3.5, "congaLow", 55, 0.5], [3.75, "congaLow", 55, 0.36]],
    [[0.5, "conga", 62, 0.45], [0.75, "conga", 62, 0.28], [1, "conga", 67, 0.42], [2, "conga", 62, 0.3], [2.5, "congaLow", 55, 0.55], [3, "conga", 67, 0.4], [3.5, "conga", 62, 0.42], [3.75, "congaLow", 55, 0.45]],
  ];
  const CONGA_BREAK = [
    [[0, "congaLow", 55, 0.5], [0.5, "conga", 62, 0.5], [0.75, "conga", 62, 0.3], [1, "conga", 67, 0.48], [1.5, "conga", 62, 0.4], [1.75, "conga", 67, 0.3], [2.5, "congaLow", 55, 0.6], [2.75, "congaLow", 53, 0.4], [3, "conga", 67, 0.48], [3.5, "conga", 62, 0.45], [3.75, "congaLow", 55, 0.45]],
    [[0.5, "conga", 62, 0.5], [1, "conga", 67, 0.5], [1.25, "conga", 62, 0.3], [1.5, "conga", 62, 0.42], [2, "congaLow", 55, 0.45], [2.5, "congaLow", 55, 0.6], [3, "conga", 67, 0.5], [3.25, "conga", 67, 0.32], [3.5, "congaLow", 53, 0.5], [3.75, "congaLow", 55, 0.5]],
  ];

  // ---------- spelling & transposition ----------
  const FLAT = T.NAMES, SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function spell(pc, tonic) {
    pc = mod12(pc);
    if (![7, 2, 9, 4, 11].includes(tonic)) return FLAT[pc];
    if (pc === 6 || pc === 1) return SHARP[pc];
    if (pc === 8 && [4, 9, 11].includes(tonic)) return SHARP[pc];
    if (pc === 3 && [4, 11].includes(tonic)) return SHARP[pc];
    return FLAT[pc];
  }
  function trChord(sym, t) {
    if (!t) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const tonic = mod12(8 + t); // the chorus key names the spelling
    return spell(T.PC[m[1]] + t, tonic) + m[2] + (m[3] ? "/" + spell(T.PC[m[3]] + t, tonic) : "");
  }
  const progCache = new Map();
  function progFor(name, lift) {
    const t = LIFTED.has(name) ? lift : 0;
    const src = name === "brk2" ? `brk2_${lift}` : name === "mc1" ? "c1" : name === "mc2" ? "c1" : name;
    const k = `${src}|${t}`;
    if (!progCache.has(k)) {
      const text = PROG[src].split(/\s+/).map((tok) => (tok === "|" || tok === "" || tok === "%" ? tok : trChord(tok, t))).join(" ");
      progCache.set(k, T.progression(text));
    }
    return { prog: progCache.get(k), t };
  }
  const keyName = (pc) => spell(pc, pc).replace("b", "♭").replace("#", "♯");

  // Close-position section voicing with the given note on top (horns).
  function soli(top, sym, voices = 3) {
    const c = T.chord(sym);
    const fifth = c.intervals.find((x) => x === 7 || x === 6 || x === 8);
    const pref = c.guide.concat(c.colors, fifth != null ? [mod12(c.root + fifth)] : [], [c.root]);
    const out = [top];
    let cur = top;
    for (let k = 0; k < voices; k++) {
      let pick = null, best = Infinity;
      for (let m = cur - 2; m >= cur - 5 && m > top - 12; m--) {
        const rank = pref.indexOf(mod12(m));
        if (rank < 0 || out.some((x) => mod12(x) === mod12(m))) continue;
        if (rank < best) { best = rank; pick = m; }
      }
      if (pick == null) break;
      out.push(pick); cur = pick;
    }
    return out.sort((a, b) => a - b);
  }
  // T.voice, but avoid minor 9ths, adjacent semitones and seconds below G3.
  const rough = (v) => v.some((a, i) => v.some((b, j) => j > i && Math.abs(b - a) === 13)) ||
    v.some((a, i) => i > 0 && (a - v[i - 1] === 1 || (v[i - 1] < 55 && a - v[i - 1] <= 2)));
  function voiceClean(sym, opts) {
    const n = opts.n ?? 4;
    const tries = [opts, { ...opts, spread: "close" }, { ...opts, spread: "drop2" }, { ...opts, lo: opts.lo + 2 }, { ...opts, n: n - 1 }, { ...opts, n: n - 1, spread: "close" },
      { ...opts, prev: null }, { ...opts, prev: null, spread: "close" }, { ...opts, prev: null, lo: opts.lo - 3 }, { ...opts, prev: null, n: n - 1 }];
    let first = null;
    for (const o of tries) { const v = T.voice(sym, o); first = first || v; if (!rough(v)) return v; }
    return first;
  }

  Sim.register({
    id: "mirror-ball",
    title: "Mirror Ball",
    genre: "Philly disco",
    situations: ["party", "celebrate"],
    energy: 0.85,
    about: "1976 Philly disco in F minor: four-on-the-floor with open hats, congas and tambourine, an octave-jumping bass, chicken-scratch guitar, sweeping strings and answering horns, a hook that climbs to the top of the chorus, a percussion break and a key change for the last choruses.",
    bpm: 118, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.025, lowcut: 300, highcut: 7500 });
      const plate = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 400, highcut: 9000 });

      const strLead = I.strings(ctx, { volume: -1, attack: 0.06, release: 0.5, cutoff: 5200 });
      const flute = I.flute(ctx, { volume: -1, vibratoDepth: 0.05, breath: -22 });
      const pad = I.strings(ctx, { volume: -10, attack: 0.45, release: 1.2, cutoff: 3000 });
      const sweep = I.strings(ctx, { volume: -9, attack: 0.012, release: 0.3, cutoff: 6500 });
      const horns = I.brassStab(ctx, { volume: -6, release: 0.1 });
      const scratch = I.guitar(ctx, { kind: "muted", volume: -11 });
      const chops = I.guitar(ctx, { kind: "clean", volume: -13, chorus: true });
      const bass = I.ebass(ctx, { volume: -3, base: 190 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 32, preload: ["kick", "snare", "clap", "hatClosed", "hatOpen", "tambourine", "conga", "congaLow", "crash"] });

      const lp = I.place(ctx, strLead, -0.12, out), fp = I.place(ctx, flute, 0.18, out);
      const pp = I.place(ctx, pad, 0, out), swp = I.place(ctx, sweep, -0.3, out);
      const hp = I.place(ctx, horns, 0.32, out);
      const scp = I.place(ctx, scratch, -0.45, out), chp = I.place(ctx, chops, 0.45, out);
      I.place(ctx, bass, 0, out);
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -9); I.send(ctx, fp, hall, -11); I.send(ctx, pp, hall, -8); I.send(ctx, swp, hall, -7);
      I.send(ctx, hp, plate, -11); I.send(ctx, hp, hall, -16); I.send(ctx, chp, plate, -14); I.send(ctx, scp, plate, -18);
      I.send(ctx, kp, plate, -17);

      return {
        strings: { layer: "melody", play: (t, e, d) => strLead.play(t, [e.note, e.note - 12], d, e.vel), humanize: { timing: 0.006, vel: 0.04 } },
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.03 } },
        horns: { layer: "harmony", play: (t, e, d) => horns.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        sweep: { layer: "texture", play: (t, e, d) => sweep.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.03 } },
        scratch: { layer: "texture", play: (t, e, d) => scratch.play(t, e.note, d, e.vel, 0.004), humanize: { timing: 0.003, vel: 0.1 } },
        chops: { layer: "texture", play: (t, e, d) => chops.play(t, e.note, d, e.vel, 0.009), humanize: { timing: 0.004, vel: 0.06 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.003, vel: 0.06 } },
        perc: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const setNo = Math.floor(cycle / PHRASES.length), pos = cycle % PHRASES.length;
      const name = PHRASES[pos], style = STYLE[name];
      const { lift } = SETS[setNo % 2];
      const odd = setNo % 2 === 1;
      const { prog, t } = progFor(name, lift);
      const nextName = PHRASES[(pos + 1) % PHRASES.length];
      const nextLift = pos === PHRASES.length - 1 ? SETS[(setNo + 1) % 2].lift : lift;
      const nextFirst = progFor(nextName, nextLift).prog[0].chord;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const tune = (list, shift = 0) => list.map(([b, x, d, n]) => ({ beat: b * 4 + x, dur: d, note: T.midi(n) + t + shift }));

      // ---------- melody ----------
      let mel = [], melTrack = null;
      if (style === "verse") {
        mel = tune(VERSE_HEAD.concat(name === "v1" ? VERSE_TAIL_1 : VERSE_TAIL_2));
        melTrack = odd ? "strings" : "flute";
      } else if (style === "pre") { mel = tune(PRE); melTrack = "strings"; }
      else if (style === "chorus") { mel = tune(name === "c2" ? HOOK_B : HOOK_A); melTrack = "strings"; }
      else if (name === "outro") { mel = tune(OUTRO_FLUTE); melTrack = "flute"; }
      else if (name === "brk2") { mel = SWELL[lift].map(([b, x, d, n]) => ({ beat: b * 4 + x, dur: d, note: T.midi(n) })); melTrack = "strings"; }
      // the key's own scale: ornaments and harmony notes must belong to it as well as to the chord
      const keySet = new Set(style === "chorus" || style === "pre" ? T.scale(mod12(8 + t), "ionian") : T.scale(5, "dorian").concat([1]));
      // later sets ornament some long notes with a quick lower-neighbour turn
      if (setNo > 0 && (style === "verse" || style === "chorus")) {
        for (let i = mel.length - 1; i >= 0; i--) {
          const n = mel[i];
          if (n.dur < 1.5 || n.beat < 0 || !r.chance(0.18)) continue;
          const lo = T.step(n.note, -1, T.chord(sym(n.beat + n.dur - 0.5)).scale);
          if (n.note - lo > 2 || !keySet.has(mod12(lo))) continue;
          mel.splice(i, 1, { beat: n.beat, dur: n.dur - 0.5, note: n.note }, { beat: n.beat + n.dur - 0.5, dur: 0.25, note: lo }, { beat: n.beat + n.dur - 0.25, dur: 0.25, note: n.note });
        }
      }
      const melBase = style === "chorus" ? 0.78 : style === "pre" ? 0.68 : 0.72;
      mel.forEach((n) => {
        const onBeat = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
        const vel = melBase + (n.dur >= 1 ? 0.04 : 0) + (onBeat ? 0.02 : -0.03) + r.gauss(0.02);
        push(melTrack, n.beat, n.dur >= 0.5 ? n.dur - 0.05 : n.dur, n.note, vel);
        // the flute doubles the hook an octave up in the second and the lifted choruses (and in every chorus of odd sets)
        const dbl = style === "chorus" && (name !== "c1" || odd) && n.beat >= 0;
        if (dbl) {
          // an octave up; above C7 the flute takes the diatonic sixth below instead, a third over the strings
          let f = n.note + 12;
          if (f > 96) f = T.step(f, -5, [...keySet]);
          push("flute", n.beat, n.dur >= 0.5 ? n.dur - 0.05 : n.dur, f, vel * 0.82);
        }
      });
      const melAt = (b) => { const n = mel.find((x) => x.beat <= b + 1e-6 && x.beat + x.dur > b + 1e-6); return n ? n.note : null; };
      const onsetNear = (b, before, after) => mel.some((x) => x.beat > b - before && x.beat < b + after);

      // ---------- horns ----------
      const hornsTop = (list) => list.forEach(([b, x, d, n]) => {
        const at = b * 4 + x, top = T.midi(n) + t;
        push("horns", at, d, soli(top, sym(at)), 0.66 + (d >= 0.5 ? 0.04 : 0));
      });
      if (name === "intro") { hornsTop(RIFF.map(([b, x, d, n]) => [b + 4, x, d, n])); hornsTop(RIFF.map(([b, x, d, n]) => [b + 6, x, d, n]).concat(RIFF_ANSWER.map(([b, x, d, n]) => [b + 6, x, d, n]))); }
      else if (name === "outro") { // the riff an octave down: darker, the party winding into the next record
        const low = (list, sh) => list.map(([b, x, d, n]) => [b + sh, x, d, T.noteName(T.midi(n) - 12)]);
        hornsTop(low(RIFF, 0)); hornsTop(low(RIFF, 2).concat(low(RIFF_ANSWER, 2)));
        const v = voiceClean(sym(24), { lo: 60 + t, hi: 79 + t, n: 4, top: [74 + t, 79 + t] });
        push("horns", 24, 0.5, v, 0.7); push("sweep", 24, 0.6, v.map((m) => m - 12).filter((m) => m >= 55), 0.5);
      }
      else if (style === "verse") hornsTop(VERSE_HORNS);
      else if (style === "pre") {
        // offbeat stabs on the "and" of 1, just after the string line moves
        [[1, 0.5], [3, 0.5], [5, 0.5]].forEach(([b, x]) => {
          const at = b * 4 + x, s = sym(at), m = melAt(at);
          const v = voiceClean(s, { lo: 60, hi: Math.min(79, (m ?? 82) - 3), n: 4, prev: state.hv, top: [70, 77] });
          state.hv = v;
          push("horns", at, 0.4, v, 0.62);
        });
      } else if (style === "chorus") {
        for (let bar = 0; bar < 7; bar++) {
          for (const [b, d] of CHORUS_HORNS[bar] || []) {
            const at = bar * 4 + b;
            if (onsetNear(at, 0.05, 0.2)) continue;
            const m = melAt(at), hi = Math.min(80 + t, (m ?? 84) - 3);
            const v = voiceClean(sym(at), { lo: hi - 11, hi, n: 3, prev: state.hv, top: [hi - 3, hi] });
            state.hv = v;
            push("horns", at, d, v, LIFTED.has(name) ? 0.68 : 0.63);
          }
        }
        // the band hit on the last bar: the turnaround sus chord, or the C7#9 that sends us to the break
        const at = 30, v = voiceClean(sym(at), { lo: 62 + t, hi: 78 + t, n: 4, prev: state.hv, top: [72 + t, 78 + t] });
        if (!onsetNear(at, 0.05, 0.2)) push("horns", at, name === "c2" ? 1.6 : 0.4, v, 0.66);
        state.hv = v;
      } else if (name === "brk2") {
        // the dominant of the new key, punched twice
        const v = voiceClean(sym(28), { lo: 62, hi: 80, n: 4, top: [74, 80] });
        push("horns", 28, 0.3, v, 0.62); push("horns", 28.75, 0.3, v, 0.64);
        const v2 = voiceClean(sym(30), { lo: 62, hi: 80, n: 4, prev: v, top: [74, 80] });
        push("horns", 30, 0.3, v2, 0.66); push("horns", 30.5, 0.25, v2, 0.62); push("horns", 31, 0.6, v2, 0.72);
        state.hv = v2;
      }

      // ---------- strings: pads, stabs and sweeps ----------
      const run = (start, end, from, to, s, vel = 0.5) => { // a fast upward scale sweep, crescendo
        const notes = T.notesIn(T.chord(s).scale.concat(T.chord(s).pcs), from, to);
        const step = (end - start) / notes.length;
        notes.forEach((m, i) => push("sweep", start + i * step, step * 1.6, m, vel * (0.6 + 0.4 * i / notes.length)));
      };
      const padOn = style === "chorus" || style === "pre" || style === "verse" || name === "outro" || (name === "intro");
      if (padOn) {
        const cfg = style === "chorus" ? { lo: 50 + t, hi: 68 + t, n: 3, top: [61 + t, 67 + t], vel: 0.42 }
          : style === "pre" ? { lo: 55, hi: 74, n: 4, top: [65, 72], vel: 0.4 }
          : { lo: 53, hi: 70, n: 3, top: [62, 68], vel: 0.32 };
        prog.forEach((c) => {
          const s0 = c.bar * 4 + c.beat;
          if (name === "intro" && s0 < 16) return;
          if (name === "outro" && (s0 >= 24 || s0 < 16)) return;
          const v = voiceClean(c.chord, { ...cfg, prev: state.pv, rng: r });
          state.pv = v;
          push("pad", s0, c.dur + 0.05, v, cfg.vel);
        });
      }
      if (name === "brk2") {
        // the swell: Fm11 re-voiced higher each bar, louder, with sweeps between
        SWELL_PAD.forEach((names, bar) => {
          const v = names.map(T.midi);
          state.pv = v;
          push("pad", bar * 4, 4.05, v, 0.22 + bar * 0.08);
        });
        prog.filter((c) => c.bar >= 4).forEach((c) => {
          const v = voiceClean(c.chord, { lo: 55, hi: 76, n: 4, prev: state.pv, top: [68, 75] });
          state.pv = v;
          push("pad", c.bar * 4 + c.beat, c.dur + 0.05, v, 0.48);
        });
        run(7, 8, 60, 79, "Fm11", 0.42); run(15, 16, 63, 84, "Fm11", 0.5);
      }
      // sweeps into arrivals
      if (name === "intro") run(14, 16, 53, 77, "Bb13", 0.5);
      if (name === "v2" || style === "pre") run(30, 31.75, 55, 82, sym(30), 0.55);
      if (style === "chorus") {
        run(14, 15.5, 60 + t, 79 + t, sym(14), 0.42);
        if (name !== "c2") run(30, 31.5, 58 + t, 81 + t, sym(30), 0.46);
      }
      if (name === "brk2") run(30, 31.75, 57, 86, sym(30), 0.58);
      // string stabs on the verse turnarounds
      if (style === "verse") {
        const v = voiceClean(sym(24), { lo: 62, hi: 82, n: 4, top: [76, 82] });
        push("sweep", 23.5, 0.3, v, 0.42); push("sweep", 24, 0.5, v, 0.48);
      }

      // ---------- rhythm guitars ----------
      if (style !== "break") {
        const pats = SCRATCH[style === "chorus" ? "chorus" : style === "pre" ? "pre" : style === "swell" ? "swell" : "verse"];
        const pat = pats[state.scrPat = (cycle + (odd ? 1 : 0)) % pats.length];
        for (let bar = 0; bar < 8; bar++) {
          if (name === "intro" && bar < 2) continue;
          if (name === "brk2" && bar < 4) continue;
          if (name === "outro" && bar >= 6) continue;
          for (let s = 0; s < 16; s++) {
            const ch = pat[s];
            if (ch === ".") continue;
            const at = bar * 4 + s / 4, c = sym(at);
            const v = state.gv && state.gvFor === c ? state.gv : (state.gv = T.voice(c, { lo: 64, hi: 77, n: 2, prev: state.gv }), state.gvFor = c, state.gv);
            push("scratch", at, ch === "X" ? 0.2 : 0.1, v, ch === "X" ? 0.62 : 0.26);
          }
        }
      }
      if (style === "chorus") {
        for (let bar = 0; bar < 8; bar++) {
          for (const b of [1, 3]) {
            const at = bar * 4 + b, c = sym(at);
            const v = voiceClean(c, { lo: 63 + t, hi: 78 + t, n: 3, prev: state.cv, top: [72 + t, 78 + t] });
            state.cv = v;
            push("chops", at, 0.3, v, 0.5);
          }
        }
      }

      // ---------- bass ----------
      const bassOn = (b) => !(name === "intro" && b < 8) && style !== "break" && !(name === "brk2" && b < 16) && !(name === "outro" && b >= 24.5);
      let lastRoot = state.bassRoot ?? 34;
      const rootOf = (pc, near) => T.nearest(near, [pc], 28, 40);
      prog.forEach((c, i) => {
        const ch = T.chord(c.chord), s0 = c.bar * 4 + c.beat;
        const root = rootOf(ch.bass, lastRoot);
        lastRoot = root;
        const nextSym = i + 1 < prog.length ? prog[i + 1].chord : nextFirst;
        const nc = T.chord(nextSym), nextRoot = rootOf(nc.bass, root);
        const fifth = root + (ch.intervals.find((x) => x === 7 || x === 6 || x === 8) ?? 7);
        const seventh = root + (ch.intervals.includes(10) ? 10 : ch.intervals.includes(9) ? 9 : 7);
        let app;
        if (nc.bass === ch.bass) app = fifth;
        else { const sc = new Set(ch.scale); app = sc.has(mod12(nextRoot - 1)) ? nextRoot - 1 : sc.has(mod12(nextRoot + 1)) ? nextRoot + 1 : nextRoot - 1; }
        const role = { R: root, O: root + 12, F: fifth, S: seventh, A: app };
        let bstyle = style === "pre" ? "pump" : name === "brk2" ? "sparse" : "oct";
        if (name === "brk2" && c.bar >= 6) bstyle = "oct";
        if (name === "intro" && c.bar < 4) bstyle = "sparse";
        const lib = (c.dur >= 4 ? BASS4 : BASS2)[bstyle];
        if (state.bassFor !== cycle) { state.bassFor = cycle; state.bassPick = {}; }
        const gk = `${bstyle}${c.dur >= 4 ? 4 : 2}`;
        if (state.bassPick[gk] == null) state.bassPick[gk] = r.int(0, lib.length - 1);
        const tpl = c.bar === 7 || r.chance(0.2) ? lib[lib.length - 1] : lib[state.bassPick[gk]];
        for (const [b, ro, d, v] of tpl) {
          if (b >= c.dur || !bassOn(s0 + b)) continue;
          push("bass", s0 + b, d, Math.max(28, Math.min(52, role[ro])), v);
        }
      });
      state.bassRoot = lastRoot;

      // ---------- drums ----------
      const D = (abs, v, vel, extra) => push("drums", abs, 0.1, v, vel, extra);
      const P = (abs, v, vel, extra) => push("perc", abs, 0.1, v, vel, extra);
      const groove = (bar, o) => {
        const B = bar * 4, cut = o.cut ?? 4, k = (b) => b < cut - 1e-6;
        if (o.kick) [0, 1, 2, 3].filter(k).forEach((b) => D(B + b, "kick", b === 0 ? 0.9 : 0.8));
        if (o.back) [1, 3].filter(k).forEach((b) => { D(B + b, "snare", 0.72); D(B + b, "clap", 0.5); });
        if (o.back && k(3.75) && r.chance(0.3)) D(B + 3.75, "snare", 0.16);
        if (o.back && k(1.75) && r.chance(0.2)) D(B + 1.75, "snare", 0.14);
        if (o.hats) for (let i = 0; i < 8; i++) {
          const b = i / 2; if (!k(b)) continue;
          if (i % 2) { if (o.hats === "open") D(B + b, "hatOpen", 0.36 + (i === 7 ? 0.04 : 0)); else D(B + b, "hatClosed", 0.38); }
          else D(B + b, "hatClosed", 0.32);
        }
        if (o.hats === "16") for (let i = 0; i < 8; i++) if (k(i / 2 + 0.25)) D(B + i / 2 + 0.25, "hatClosed", 0.2);
        if (o.tamb) for (let s = 0; s < 16; s += o.tamb === 16 ? 1 : 2) {
          const b = s / 4; if (!k(b)) continue;
          const v = s % 8 === 4 ? 0.48 : s % 4 === 2 ? 0.4 : s % 4 === 0 ? 0.3 : 0.18;
          P(B + b, "tambourine", v);
        }
        if (o.conga) (o.congaPat || CONGA)[bar % 2].forEach(([b, v, p, vel]) => { if (k(b)) P(B + b, v, vel * o.conga, { pitch: p }); });
        if (o.bongo) [[0, 72, 0.32], [0.5, 72, 0.2], [1, 77, 0.36], [1.5, 72, 0.22], [2, 72, 0.3], [2.5, 72, 0.2], [3, 77, 0.38], [3.5, 72, 0.24], [3.75, 77, 0.2]]
          .forEach(([b, p, vel]) => { if (k(b)) P(B + b, "bongo", vel * o.bongo, { pitch: p }); });
        if (o.crash) D(B, "crash", o.crash);
      };
      const fill = (bar, kind) => { // returns the beat where the fill starts
        const B = bar * 4;
        if (kind === "pickup") { D(B + 3.5, "snare", 0.42); D(B + 3.75, "snare", 0.58); return 3.5; }
        if (kind === "snare16") { for (let i = 0; i < 8; i++) D(B + 2 + i / 4, "snare", 0.32 + i * 0.07); return 2; }
        if (kind === "toms") {
          const F = r.pick([[[2, "snare", 0.6], [2.5, "tom", 0.7, 57], [2.75, "tom", 0.62, 57], [3, "tom", 0.74, 50], [3.25, "tom", 0.66, 50], [3.5, "tom", 0.78, 45], [3.75, "tom", 0.8, 40]],
            [[3, "snare", 0.62], [3.25, "tom", 0.7, 55], [3.5, "tom", 0.76, 48], [3.75, "tom", 0.82, 41]]]);
          F.forEach(([b, v, vel, p]) => D(B + b, v, vel, p ? { pitch: p } : undefined));
          return F[0][0];
        }
        if (kind === "timbale") {
          [[2, 74, 0.5], [2.25, 74, 0.35], [2.5, 67, 0.55], [2.75, 67, 0.4], [3, 74, 0.6], [3.25, 74, 0.5], [3.5, 67, 0.7], [3.75, 74, 0.75]]
            .forEach(([b, p, vel]) => P(B + b, "timbale", vel, { pitch: p }));
          return 2;
        }
        return 4;
      };
      const full = (bar, extra = {}) => groove(bar, { kick: true, back: true, hats: "open", tamb: 16, conga: 1, ...extra });
      for (let bar = 0; bar < 8; bar++) {
        const last = bar === 7;
        if (style === "intro") {
          if (bar < 2) {
            const cut = bar === 1 ? fill(bar, "snare16") : 4;
            groove(bar, { kick: true, hats: "open", conga: 0.9, tamb: 8, cut });
          } else full(bar, { tamb: bar >= 4 ? 16 : 8, crash: bar === 4 ? 0.5 : 0, cut: last ? fill(bar, "pickup") : 4 });
        } else if (style === "verse") {
          const cut = last ? fill(bar, name === "v2" ? "toms" : "pickup") : 4;
          full(bar, { tamb: name === "v1" ? 8 : 16, crash: bar === 0 ? 0.5 : 0, conga: name === "v1" && bar < 4 ? 0.7 : 1, cut });
        } else if (style === "pre") {
          if (bar < 6) groove(bar, { kick: true, back: true, hats: "16", tamb: 8, conga: 0.8, crash: bar === 0 ? 0.42 : 0 });
          else {
            [0, 1, 2, 3].forEach((b) => D(bar * 4 + b, "kick", 0.82));
            const n = bar === 6 ? 8 : 16;
            for (let i = 0; i < n; i++) D(bar * 4 + (i * 4) / n, "snare", (bar === 6 ? 0.3 : 0.42) + (i / n) * 0.35);
          }
        } else if (style === "chorus") {
          // timbales ride over the groove into the break; other fills replace the groove
          const into = name === "c2" ? "timbale" : name === "mc2" ? "toms" : "pickup";
          const from = last ? fill(bar, into) : 4;
          full(bar, { crash: bar === 0 ? 0.62 : bar === 4 && LIFTED.has(name) ? 0.4 : 0, cut: into === "timbale" ? 4 : from });
        } else if (style === "break") {
          const o = { kick: true, hats: bar >= 4 ? "open" : "closed", conga: 1.1, congaPat: CONGA_BREAK, crash: bar === 0 ? 0.55 : 0 };
          if (bar >= 2) o.back = true;
          if (bar >= 4) { o.tamb = 16; o.bongo = 1; }
          if (last) fill(bar, "timbale"); // the timbales play over the groove
          groove(bar, o);
          if (bar === 6) [[0.5, 74, 0.45], [1.5, 67, 0.4], [2.5, 74, 0.45], [3, 67, 0.5], [3.5, 74, 0.55]].forEach(([b, p, v]) => P(bar * 4 + b, "timbale", v, { pitch: p }));
        } else if (style === "swell") {
          const cut = last ? fill(bar, "snare16") : 4;
          full(bar, { tamb: bar >= 4 ? 16 : 8, conga: 1, cut, crash: bar === 4 ? 0.45 : 0 });
        } else if (style === "outro") {
          if (bar < 6) full(bar, { crash: bar === 0 ? 0.55 : 0 });
          else groove(bar, { kick: true, back: true, hats: "open", conga: 1.1, congaPat: CONGA_BREAK, crash: bar === 6 ? 0.45 : 0, cut: last ? fill(bar, "pickup") : 4 });
        }
      }

      // ---------- label ----------
      const lifted = LIFTED.has(name);
      const keyPc = mod12(8 + (lifted ? lift : 0));
      const label = {
        intro: "Intro · drums, then the horn riff", v1: odd ? "Verse · strings" : "Verse · flute", v2: odd ? "Verse 2 · strings" : "Verse 2 · flute",
        pre: "Pre-chorus · string line climbs", c1: "Chorus · the hook", c2: "Chorus · flute doubles, off to the break",
        brk1: "Break · drums and congas", brk2: `Break · strings swell, up to ${keyName(mod12(8 + lift))}`,
        mc1: "Last chorus · lifted", mc2: "Last chorus · lifted, all in", outro: "Outro · horn riff, band drops out",
      }[name];
      const keyLabel = style === "verse" || style === "intro" || style === "break" || name === "brk2" ? "F minor" : name === "outro" ? `${keyName(mod12(5 + lift))} minor` : `${keyName(keyPc)} major`;
      return { events: ev, harmony: prog, section: `Set ${setNo + 1} · ${keyLabel} · ${label}`, state };
    },
  });
})();

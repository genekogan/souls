// Roller Rink: early-80s post-disco boogie for a mall rink in 1982, all neon and carpet on the walls.
//
// Groove (112 BPM, 16ths with a little push): a LinnDrum-style kit (tight snare doubled by a clap on 2 and 4,
// kick on 1 and 3 with 16th pickups, closed hats in 16ths, an open hat to lift the turnarounds), an 808 cowbell
// on the offbeats and a shaker in 16ths that come and go with the form; a Minimoog-ish bass that plays boogie
// octave figures with 16th syncopations and chromatic approaches; Rhodes 9th and 11th chords in pushed 16th
// stabs; a brass section that punches the downbeats the tune leaves empty; and a gliding square lead through an
// envelope-following formant filter, phrased like a talkbox singer.
//
// Harmony (E minor / G major):
//   verse   the minor-11 rock Em11 – Am9 (i – iv), then Cmaj9 Bm7 Am9 and the boogie suspension D9sus4 – D13.
//   chorus  G major that never lands on G: Cmaj9 – D/C (the IV with the V over it, the boogie slash chord) – Bm7 –
//           Em9, then Am9 Bm7 Cmaj9 and a chromatic C#m7b5 into D9sus4 – D13. The hook is one cell that starts on
//           the "and" of 1, so the brass gets the downbeat: call and response every bar.
//   break   bass and claps alone over Em11 – Am9, then a side-slip (Fmaj9#11, the bII lydian, or Gm11 – C13, a
//           minor third up) as the Rhodes, the kick and the hats come back one by one.
// Form, one "session" of eleven 8-bar phrases (88 bars, about 3 minutes):
//   intro (drums and bass at once, Rhodes from bar 5) · verse · verse · chorus · chorus · breakdown (bass and
//   claps) · breakdown (rebuild) · solo (talkbox lead, or a Rhodes solo on alternate sessions) · chorus (brass
//   harmonises the tune) · last chorus (finally resolves) · tag on Gmaj9 – Cmaj9 that thins into the next intro.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  const PHRASES = ["intro", "v1", "v2", "c1", "c2", "bd1", "bd2", "solo", "c3", "c4", "tag"];
  const STYLE = { intro: "intro", v1: "verse", v2: "verse", c1: "chorus", c2: "chorus", bd1: "bd1", bd2: "bd2", solo: "solo", c3: "chorus", c4: "chorus", tag: "tag" };

  const PROG_TEXT = {
    intro: "| Em11 | Am9 | Em11 | Am9 | Em11 | Am9 | Cmaj9 | D9sus4 D13 |",
    verse: "| Em11 | Am9 | Em11 | Am9 | Cmaj9 | Bm7 | Am9 | D9sus4 D13 |",
    chorus: "| Cmaj9 | D/C | Bm7 | Em9 | Am9 | Bm7 | Cmaj9 C#m7b5 | D9sus4 D13 |",
    bd1: "| Em11 | Am9 | Em11 | Am9 | Em11 | Am9 | Em11 | Am9 |",
    bd2a: "| Em11 | Am9 | Fmaj9#11 | Fmaj9#11 | Cmaj9 | Bm7 | Am9 | D9sus4 D13 |",
    bd2b: "| Em11 | Am9 | Gm11 | C13 | Cmaj9 | Bm7 | Am9 | D9sus4 D13 |",
    tag: "| Gmaj9 | Cmaj9 | Gmaj9 | Cmaj9 | Em11 | Am9 | Em11 | D9sus4 |",
  };
  const PROG = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v)]));
  const progFor = (name, odd) => PROG[name === "bd2" ? (odd ? "bd2b" : "bd2a") : name === "solo" ? "verse" : STYLE[name] === "verse" ? "verse" : STYLE[name] === "chorus" ? "chorus" : name];

  // ---------- tunes [bar, beat, dur, note] ----------
  const VERSE_HEAD = [
    [0, 0.5, 0.25, "B4"], [0, 0.75, 0.25, "D5"], [0, 1, 0.5, "E5"], [0, 1.5, 0.5, "D5"], [0, 2, 0.75, "B4"], [0, 2.75, 0.25, "A4"], [0, 3, 0.75, "B4"],
    [1, 0, 1.5, "C5"], [1, 1.5, 0.5, "B4"], [1, 2, 1, "G4"],
    [2, 0.5, 0.25, "B4"], [2, 0.75, 0.25, "D5"], [2, 1, 0.5, "E5"], [2, 1.5, 0.5, "F#5"], [2, 2, 1, "G5"], [2, 3, 0.5, "F#5"], [2, 3.5, 0.5, "E5"],
    [3, 0, 1, "E5"], [3, 1, 0.5, "D5"], [3, 1.5, 0.5, "C5"], [3, 2, 1, "B4"],
  ];
  const VERSE_TAIL_1 = [
    [4, 0, 0.5, "E5"], [4, 0.5, 0.5, "G5"], [4, 1, 1, "B5"], [4, 2, 0.5, "A5"], [4, 2.5, 0.5, "G5"], [4, 3, 1, "E5"],
    [5, 0, 1, "F#5"], [5, 1, 0.5, "D5"], [5, 1.5, 0.5, "B4"], [5, 2, 1.5, "D5"],
    [6, 0, 0.5, "C5"], [6, 0.5, 0.5, "E5"], [6, 1, 1, "G5"], [6, 2, 0.5, "E5"], [6, 2.5, 1.5, "B4"],
    [7, 0, 1.5, "C5"], [7, 1.5, 0.5, "A4"], [7, 2, 1.5, "F#4"],
  ];
  const VERSE_TAIL_2 = [
    [4, 0.5, 0.25, "G5"], [4, 0.75, 0.25, "A5"], [4, 1, 0.5, "B5"], [4, 1.5, 0.5, "A5"], [4, 2, 0.5, "G5"], [4, 2.5, 1.5, "E5"],
    [5, 0, 1, "D5"], [5, 1, 0.5, "F#5"], [5, 1.5, 0.5, "A5"], [5, 2, 1.5, "F#5"],
    [6, 0.5, 0.5, "G5"], [6, 1, 0.5, "E5"], [6, 1.5, 0.5, "C5"], [6, 2, 1, "B4"], [6, 3, 0.5, "A4"], [6, 3.5, 0.5, "B4"],
    [7, 0, 1.5, "C5"], [7, 1.5, 0.5, "D5"], [7, 2, 1.5, "E5"],
  ];
  // Chorus hook: the "and-of-1" cell over Cmaj9, D/C, Bm7 and Am9; Em9 and the turnaround answer it.
  const HOOK_HEAD = [
    [0, 0.5, 0.5, "B4"], [0, 1, 0.25, "D5"], [0, 1.25, 0.75, "E5"], [0, 2, 0.5, "D5"], [0, 2.5, 1.5, "B4"],
    [1, 0.5, 0.5, "A4"], [1, 1, 0.25, "D5"], [1, 1.25, 0.75, "F#5"], [1, 2, 0.5, "E5"], [1, 2.5, 1.5, "D5"],
    [2, 0.5, 0.5, "D5"], [2, 1, 0.25, "F#5"], [2, 1.25, 0.75, "A5"], [2, 2, 0.5, "F#5"], [2, 2.5, 1, "D5"], [2, 3.5, 0.5, "E5"],
    [3, 0, 2, "F#5"], [3, 2, 0.5, "E5"], [3, 2.5, 0.5, "D5"], [3, 3, 1, "B4"],
    [4, 0.5, 0.5, "C5"], [4, 1, 0.25, "E5"], [4, 1.25, 0.75, "G5"], [4, 2, 0.5, "A5"], [4, 2.5, 1.5, "B5"],
    [5, 0, 1, "A5"], [5, 1, 0.5, "F#5"], [5, 1.5, 0.5, "E5"], [5, 2, 1.5, "D5"],
    [6, 0, 0.5, "E5"], [6, 0.5, 0.5, "G5"], [6, 1, 1, "B5"], [6, 2, 1, "G5"], [6, 3, 1, "E5"],
  ];
  const HOOK_END = [[7, 0, 1.5, "G5"], [7, 1.5, 0.5, "E5"], [7, 2, 1.5, "F#5"]];
  const HOOK_END_HOME = [[7, 0, 1.5, "G5"], [7, 1.5, 0.5, "A5"], [7, 2, 2, "F#5"]];
  const TAG_LEAD = [ // the last chorus finally lands on G: a sung "yeah" on the tonic and a fall
    [0, 0, 1.5, "G5"], [0, 1.5, 0.5, "A5"], [0, 2, 0.5, "G5"], [0, 2.5, 1, "D5"],
    [1, 0.5, 0.5, "E5"], [1, 1, 0.5, "G5"], [1, 1.5, 0.5, "E5"], [1, 2, 2, "D5"],
    [2, 0.5, 0.25, "B4"], [2, 0.75, 0.25, "D5"], [2, 1, 1, "F#5"], [2, 2, 0.5, "E5"], [2, 2.5, 1, "D5"],
    [3, 0.5, 0.5, "E5"], [3, 1, 0.5, "D5"], [3, 1.5, 0.5, "B4"], [3, 2, 2, "G4"],
  ];
  const HOOK_MOTIF = { len: 4, rhythm: [{ off: 0.5, dur: 0.5 }, { off: 1, dur: 0.25 }, { off: 1.25, dur: 0.75 }, { off: 2, dur: 0.5 }, { off: 2.5, dur: 1.5 }], steps: [0, 1.5, 1.2, -1.2, -1.5] };

  // ---------- comping: [beat, dur] per chord span (negative = 16th push into the chord) ----------
  const K4 = {
    verse: [[[[0, 0.4], [0.75, 0.25], [1.5, 0.5], [2.75, 0.75]], 3], [[[-0.25, 0.5], [0.75, 0.25], [2, 0.25], [2.5, 0.75]], 2], [[[0.5, 0.25], [1, 0.5], [2.25, 0.25], [2.75, 0.5], [3.5, 0.25]], 2]],
    chorus: [[[[0.25, 0.25], [0.75, 0.5], [1.75, 0.25], [2.5, 0.5], [3.25, 0.5]], 3], [[[-0.25, 0.5], [0.75, 0.25], [1.5, 0.25], [2.25, 0.5], [3, 0.25], [3.5, 0.25]], 2], [[[0.5, 0.5], [1.25, 0.25], [2, 0.25], [2.75, 0.75]], 2]],
    sparse: [[[[0, 1.6], [2.5, 1.2]], 2], [[[0.75, 0.75], [2.75, 1]], 2]],
  };
  const K2 = {
    verse: [[[[0, 0.4], [0.75, 0.5]], 2], [[[-0.25, 0.5], [1, 0.25], [1.5, 0.25]], 2]],
    chorus: [[[[0.25, 0.25], [0.75, 0.5], [1.5, 0.25]], 2], [[[-0.25, 0.5], [0.75, 0.25], [1.25, 0.5]], 2]],
    sparse: [[[[0, 1.6]], 2], [[[0.75, 1]], 1]],
  };

  // ---------- bass: [beat, role, dur, vel]  R root, O octave, F fifth, S seventh, A approach, G ghost ----------
  const BASS4 = {
    groove: [
      [[0, "R", 0.35, 0.9], [0.75, "O", 0.2, 0.75], [1, "R", 0.2, 0.55], [1.5, "R", 0.3, 0.8], [2, "O", 0.2, 0.78], [2.5, "R", 0.35, 0.85], [3, "F", 0.2, 0.7], [3.25, "O", 0.2, 0.75], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.5, 0.9], [0.75, "R", 0.2, 0.6], [1, "O", 0.25, 0.8], [1.75, "R", 0.2, 0.65], [2.25, "R", 0.2, 0.7], [2.5, "O", 0.25, 0.85], [3, "S", 0.25, 0.7], [3.5, "O", 0.2, 0.75], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.25, 0.9], [0.5, "O", 0.2, 0.75], [0.75, "R", 0.2, 0.6], [1.5, "O", 0.25, 0.8], [2, "R", 0.4, 0.85], [2.75, "O", 0.2, 0.75], [3.25, "R", 0.2, 0.7], [3.5, "F", 0.2, 0.7], [3.75, "O", 0.2, 0.72]],
    ],
    lead: [ // the breakdown: the bass has the floor, so it talks more
      [[0, "R", 0.25, 0.92], [0.25, "G", 0.1, 0.4], [0.75, "O", 0.2, 0.82], [1.25, "S", 0.2, 0.72], [1.5, "O", 0.2, 0.8], [2, "R", 0.3, 0.88], [2.5, "F", 0.2, 0.72], [2.75, "O", 0.2, 0.82], [3.25, "S", 0.2, 0.7], [3.5, "F", 0.2, 0.72], [3.75, "A", 0.2, 0.72]],
      [[0, "R", 0.4, 0.92], [0.5, "R", 0.2, 0.6], [0.75, "O", 0.2, 0.82], [1.5, "S", 0.25, 0.75], [1.75, "O", 0.2, 0.8], [2.25, "R", 0.2, 0.75], [2.5, "G", 0.1, 0.4], [2.75, "F", 0.2, 0.75], [3, "O", 0.2, 0.82], [3.5, "R", 0.2, 0.7], [3.75, "A", 0.2, 0.75]],
    ],
    sparse: [[[0, "R", 1.4, 0.88], [1.5, "O", 0.25, 0.7], [2.5, "R", 0.9, 0.8], [3.5, "F", 0.2, 0.65], [3.75, "A", 0.2, 0.68]]],
  };
  BASS4.lead.push([[0, "R", 0.3, 0.92], [0.75, "R", 0.2, 0.6], [1, "O", 0.2, 0.85], [1.25, "S", 0.2, 0.7], [1.75, "F", 0.2, 0.72], [2, "R", 0.3, 0.85], [2.5, "O", 0.2, 0.82], [2.75, "G", 0.1, 0.4], [3, "S", 0.2, 0.72], [3.25, "O", 0.2, 0.8], [3.75, "A", 0.2, 0.72]]);
  // the breakdown's last bar: a run down from the octave into the rebuild
  const BASS_RUN = [[0, "R", 0.25, 0.9], [0.5, "O", 0.2, 0.8], [1, "R", 0.2, 0.7], [1.5, "S", 0.2, 0.75], [2, "R", 0.2, 0.8], [2.5, "O", 0.2, 0.85], [2.75, "O", 0.2, 0.75], [3, "S", 0.2, 0.8], [3.25, "F", 0.2, 0.75], [3.5, "T", 0.2, 0.78], [3.75, "A", 0.2, 0.82]];
  const BD1_ORDER = [0, 0, 1, 1, 2, 2, 0, "run"];
  const BASS2 = {
    groove: [[[0, "R", 0.35, 0.9], [0.75, "O", 0.2, 0.75], [1, "R", 0.2, 0.55], [1.5, "O", 0.25, 0.8], [1.75, "A", 0.2, 0.7]], [[0, "R", 0.5, 0.9], [0.75, "R", 0.2, 0.6], [1, "O", 0.25, 0.8], [1.5, "F", 0.2, 0.7], [1.75, "A", 0.2, 0.7]]],
    lead: [[[0, "R", 0.25, 0.92], [0.5, "O", 0.2, 0.8], [0.75, "R", 0.2, 0.62], [1.25, "S", 0.2, 0.72], [1.5, "O", 0.2, 0.8], [1.75, "A", 0.2, 0.72]]],
    sparse: [[[0, "R", 1.4, 0.88], [1.5, "A", 0.4, 0.68]]],
  };
  const KICKS = { verse: [[0, 2, 2.75], [0, 0.75, 2, 2.5]], chorus: [[0, 1.75, 2, 3.5], [0, 0.75, 2, 2.75]], solo: [[0, 0.75, 2, 2.5], [0, 2, 2.75, 3.25]] };
  // Brass in the chorus: the downbeats the hook leaves open, and a "ba-BAP" pickup into the next phrase.
  const CHORUS_BRASS = { 0: [[0, 0.3]], 1: [[0, 0.3]], 2: [[0, 0.3]], 4: [[0, 0.3]], 6: [[2, 0.25]], 7: [[3.5, 0.2], [3.75, 0.3]] };

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
  const G_MAJOR = new Set(T.scale(7, "ionian"));

  Sim.register({
    id: "roller-rink",
    title: "Roller Rink",
    genre: "Boogie",
    situations: ["hangout", "party", "shopping"],
    energy: 0.65,
    about: "Early-80s boogie in E minor and G major: a Linn-style kit with claps, cowbell and shaker, a syncopated octave synth bass, Rhodes 11th chords and brass stabs under a gliding talkbox-style lead; a breakdown to bass and claps, a solo, and a chorus that waits until the very end to land on G.",
    bpm: 112, beatsPerBar: 4, swing: 0.54, swingUnit: 0.25, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.012, lowcut: 350, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 2.6, preDelay: 0.03, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.22, pingPong: true, highcut: 3000 });

      // talkbox-ish lead: a gliding square through an envelope-following formant (auto-wah) filter
      const lead = I.lead(ctx, { volume: -1, wave: "fatsquare", detune: 8, glide: 0.06, vibrato: 5.2, vibratoDepth: 0.05, vibratoDelay: 0.3, base: 700, octaves: 2.2, resonance: 2, attack: 0.02, sustain: 0.8, release: 0.12 });
      const wah = ctx.keep(new Tone.AutoWah({ baseFrequency: 320, octaves: 3.2, sensitivity: -28, Q: 3.5, gain: 2, follower: 0.08, wet: 0.75 }));
      const mouth = ctx.keep(new Tone.Filter({ frequency: 2400, type: "lowpass", rolloff: -12, Q: 1.5 }));
      lead.out.connect(wah); wah.connect(mouth);
      const lp = ctx.keep(new Tone.Panner(0.04)); mouth.connect(lp); lp.connect(out);

      const keys = I.rhodes(ctx, { volume: -7, cutoff: 4400, bark: 2.6, tine: -10, tremolo: 4.6, tremoloDepth: 0.22 });
      const soloKeys = I.rhodes(ctx, { volume: -2, cutoff: 5000, bark: 3, tine: -8, tremolo: 0.01, tremoloDepth: 0 });
      const brass = I.brassStab(ctx, { volume: -7, release: 0.1 });
      const pad = I.pad(ctx, { volume: -17, cutoff: 1600, attack: 0.4, release: 1.4, detune: 16 });
      const bass = I.analog(ctx, { volume: -3, wave: "sawtooth", resonance: 2.5, base: 150, octaves: 3, filterDecay: 0.16, decay: 0.3, sustain: 0.55, release: 0.08 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 34, preload: ["kick", "snare", "clap", "hatClosed", "hatOpen", "cowbell", "shaker", "tom", "crash", "snap"] });

      const kp = I.place(ctx, keys, -0.32, out), skp = I.place(ctx, soloKeys, 0.15, out);
      const bp = I.place(ctx, brass, 0.3, out), pp = I.place(ctx, pad, 0, out);
      I.place(ctx, bass, 0, out);
      const dp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -13); I.send(ctx, lp, echo, -17);
      I.send(ctx, kp, room, -12); I.send(ctx, kp, echo, -22); I.send(ctx, skp, hall, -14); I.send(ctx, skp, echo, -18);
      I.send(ctx, bp, room, -10); I.send(ctx, bp, hall, -16); I.send(ctx, pp, hall, -9);
      I.send(ctx, dp, room, -16);

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        solo: { layer: "melody", play: (t, e, d) => soloKeys.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        brass: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        pad: { layer: "texture", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.002, vel: 0.05 } },
        perc: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const sessNo = Math.floor(cycle / PHRASES.length), pos = cycle % PHRASES.length;
      const name = PHRASES[pos], style = STYLE[name];
      const odd = sessNo % 2 === 1;
      const prog = progFor(name, odd);
      const nextOdd = pos === PHRASES.length - 1 ? !odd : odd;
      const nextFirst = progFor(PHRASES[(pos + 1) % PHRASES.length], nextOdd)[0].chord;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const tune = (list) => list.map(([b, x, d, n]) => ({ beat: b * 4 + x, dur: d, note: T.midi(n) }));
      const inKey = (pc) => G_MAJOR.has(mod12(pc));
      const scaleFor = (s) => { const c = T.chord(s); return [...new Set(c.scale.filter((p) => G_MAJOR.has(p)).concat(c.pcs))]; };

      // ---------- melody ----------
      let mel = [], melTrack = "lead";
      if (style === "verse") mel = tune(VERSE_HEAD.concat(name === "v1" ? VERSE_TAIL_1 : VERSE_TAIL_2));
      else if (style === "chorus") mel = tune(HOOK_HEAD.concat(name === "c4" ? HOOK_END_HOME : HOOK_END));
      else if (name === "tag") mel = tune(TAG_LEAD);
      else if (name === "intro") mel = tune([[6, 0.5, 0.5, "B4"], [6, 1, 0.25, "D5"], [6, 1.25, 0.75, "E5"], [6, 2, 0.5, "D5"], [6, 2.5, 1.5, "B4"], [7, 0, 1.5, "C5"], [7, 1.5, 0.5, "A4"], [7, 2, 1.5, "F#4"]]);
      else if (name === "bd2") mel = tune([[6, 0.5, 0.5, "C5"], [6, 1, 0.25, "E5"], [6, 1.25, 0.75, "G5"], [6, 2, 0.5, "A5"], [6, 2.5, 1.5, "B5"], [7, 0, 1.5, "A5"], [7, 1.5, 0.5, "G5"], [7, 2, 1.5, "F#5"]]);
      else if (name === "solo") {
        melTrack = odd ? "solo" : "lead";
        // talkbox: short sung phrases that keep returning to the hook's rhythm; Rhodes: longer, busier lines
        const m = C.line({
          start: 0, end: 29.5, chordAt: sym, lo: odd ? 64 : 64, hi: odd ? 86 : 83, rng: r.fork(5), density: odd ? 0.6 : 0.5,
          phrase: odd ? [4, 8] : [3, 6], rest: odd ? [1, 2] : [0.5, 1.5], motif: odd ? state.soloMotif : (state.talkMotif || HOOK_MOTIF), motifProb: odd ? 0.35 : 0.45,
          chromatic: odd ? 0.3 : 0.15, register: 0.6, prev: state.soloLast ?? 71, upbeatStart: 0.6, scaleFor, lead: 0.5,
        });
        if (odd) state.soloMotif = m.motif; else state.talkMotif = m.motif;
        state.soloLast = m.last;
        mel = m.notes.filter((n) => n.beat < 29.5).map((n) => ({ beat: n.beat, dur: Math.min(n.dur, 29.75 - n.beat), note: n.note, strong: n.strong }));
        // the singer's held last note over the D13
        mel.push({ beat: 30, dur: 1.5, note: T.nearest(mel.length ? mel[mel.length - 1].note : 66, [6, 9], 62, 81) });
      }
      // talkbox scoops: some long notes start with a 16th from the scale step below (later sessions, and the solo)
      if ((sessNo > 0 && melTrack === "lead") || name === "solo") {
        for (let i = mel.length - 1; i >= 0; i--) {
          const n = mel[i];
          if (n.dur < 1 || !r.chance(name === "solo" ? 0.3 : 0.22)) continue;
          const lo = T.step(n.note, -1, scaleFor(sym(n.beat)));
          if (n.note - lo > 2 || !inKey(lo)) continue;
          mel.splice(i, 1, { beat: n.beat, dur: 0.25, note: lo, grace: true }, { beat: n.beat + 0.25, dur: n.dur - 0.25, note: n.note });
        }
      }
      const melVel = style === "chorus" ? 0.8 : name === "solo" ? 0.74 : 0.74;
      mel.forEach((n) => {
        const onBeat = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
        const vel = n.grace ? melVel - 0.12 : melVel + (n.dur >= 1 ? 0.04 : 0) + (onBeat ? 0.02 : -0.02) + r.gauss(0.02);
        // legato: a talkbox singer slurs, so notes run into the next one (the glide does the rest)
        // the Rhodes soloist leans on long notes with a double-stop (the scale third below)
        const note = melTrack === "solo" && n.dur >= 1 ? [T.step(n.note, -2, scaleFor(sym(n.beat))), n.note] : n.note;
        push(melTrack, n.beat, melTrack === "lead" ? n.dur * 0.97 : n.dur * 0.9, note, vel);
      });
      const melAt = (b) => { const n = mel.find((x) => x.beat <= b + 1e-6 && x.beat + x.dur > b + 1e-6); return n ? n.note : null; }; // single notes only
      const onsetNear = (b, before, after) => mel.some((x) => x.beat > b - before && x.beat < b + after);

      // ---------- Rhodes comping ----------
      const compDens = (b) => {
        if (name === "bd1") return null;
        if (name === "intro") return b < 16 ? null : "verse";
        if (name === "bd2") return b < 8 ? "sparse" : "verse";
        if (name === "tag") return b < 24 ? "verse" : null;
        if (name === "solo") return odd ? "sparse" : "verse";
        return style === "chorus" ? "chorus" : "verse";
      };
      const kr = style === "chorus" ? { lo: 55, hi: 74, top: [65, 71] } : { lo: 54, hi: 72, top: [63, 69] };
      const hitsByChord = prog.map((c) => {
        const s0 = c.bar * 4 + c.beat, dens = compDens(s0);
        const v = voiceClean(c.chord, { lo: kr.lo, hi: kr.hi, n: 4, prev: state.kv, top: kr.top, rng: r, omitBass: true });
        state.kv = v;
        if (!dens) return { hits: [], v };
        const lib = (c.dur >= 4 ? K4 : K2)[dens];
        // no push into the first bar, into the break's return, or into a bar whose downbeat belongs to the brass
        const brassDown = style === "chorus" && (CHORUS_BRASS[c.bar] || []).some(([b]) => b === 0) && c.beat === 0;
        const pats = s0 === 0 || brassDown || (name === "bd2" && s0 === 8) ? lib.filter(([p]) => p[0][0] >= 0) : lib;
        return { hits: r.weighted(pats).map(([b, d]) => ({ at: s0 + b, d })), v };
      });
      // a chord the keys push (a 16th early) is pushed by the bass and the pad too
      const pushed = prog.map((c, i) => hitsByChord[i].hits.length > 0 && hitsByChord[i].hits[0].at < c.bar * 4 + c.beat - 1e-6);
      hitsByChord.forEach(({ hits, v }, i) => {
        const nxt = hitsByChord.slice(i + 1).find((h) => h.hits.length);
        const nextStart = nxt ? Math.min(...nxt.hits.map((h) => h.at)) : 32;
        for (const h of hits) {
          if (h.at >= nextStart - 0.2) continue;
          push("keys", h.at, Math.max(0.15, Math.min(h.d, nextStart - h.at - 0.05)), v, (style === "chorus" ? 0.52 : 0.47) + r.range(-0.04, 0.04) + (h === hits[0] ? 0.04 : 0));
        }
      });

      // ---------- brass ----------
      const brassAt = (at, d, vel, top = [74, 79]) => {
        const lo = Math.min(62, top[1] - 13);
        const v = voiceClean(sym(at), { lo, hi: top[1], n: top[1] - lo < 14 ? 3 : 4, prev: state.bv, top, omitBass: true });
        state.bv = v;
        push("brass", at, d, v, vel);
      };
      if (style === "chorus") {
        for (const [bar, figs] of Object.entries(CHORUS_BRASS)) {
          for (const [b, d] of figs) {
            const at = +bar * 4 + b;
            if (onsetNear(at, 0.05, 0.2)) continue;
            const m = melAt(at);
            brassAt(at, d, name === "c4" ? 0.7 : 0.64, m != null ? [Math.min(74, m - 6), Math.min(79, m - 3)] : [74, 79]);
          }
        }
        if (name === "c3") { // the section harmonises the tune's answer, the lead on top
          mel.filter((n) => n.beat >= 16 && n.beat < 28 && n.dur >= 0.5).forEach((n) => {
            push("brass", n.beat, Math.min(n.dur, 1.2) - 0.05, soli(n.note, sym(n.beat)).filter((x) => x !== n.note), 0.58);
          });
        }
      } else if (style === "verse") {
        [[1, 3.25, 0.2], [1, 3.5, 0.4], [3, 3.25, 0.2], [3, 3.5, 0.4]].forEach(([b, x, d]) => brassAt(b * 4 + x, d, 0.6, [70, 76]));
        if (name === "v2") { brassAt(31.5, 0.2, 0.62); brassAt(31.75, 0.3, 0.66); }
      } else if (name === "intro") { brassAt(31.5, 0.2, 0.6); brassAt(31.75, 0.3, 0.64); }
      else if (name === "bd2") { brassAt(16, 0.35, 0.64); brassAt(16.75, 0.3, 0.6); brassAt(31.5, 0.2, 0.64); brassAt(31.75, 0.3, 0.68); }
      else if (name === "tag") { // home at last: a bright Gmaj9 under the singer's G, then an echo
        push("brass", 0, 0.7, soli(T.midi("A5"), "Gmaj9"), 0.72);
        brassAt(8, 0.4, 0.62); brassAt(8.75, 0.3, 0.6);
      }
      else if (name === "solo" && odd) { [4, 12, 20].forEach((at) => { brassAt(at + 3.5, 0.25, 0.58, [70, 76]); }); }

      // ---------- pad (Oberheim-ish glue) ----------
      const padOn = style === "chorus" || (name === "tag" && true) || (name === "solo" && odd) || name === "bd2";
      if (padOn) {
        prog.forEach((c) => {
          const s0 = c.bar * 4 + c.beat;
          if (name === "bd2" && s0 < 8) return;
          if (name === "tag" && s0 >= 24) return;
          const v = voiceClean(c.chord, { lo: 55, hi: 72, n: 3, prev: state.pv, top: [64, 71], omitBass: true });
          state.pv = v;
          const i = prog.indexOf(c), start = pushed[i] ? s0 - 0.25 : s0;
          const end = i + 1 < prog.length && pushed[i + 1] ? s0 + c.dur - 0.25 : s0 + c.dur;
          push("pad", start, end - start + 0.03, v, name === "bd2" ? 0.34 : 0.4);
        });
      }

      // ---------- bass ----------
      let lastRoot = state.bassRoot ?? 33;
      const rootOf = (pc, near) => T.nearest(near, [pc], 28, 40);
      if (state.bassFor !== cycle) { state.bassFor = cycle; state.bassPick = {}; }
      const bassEv = [];
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
        else { const sc = new Set(ch.scale); app = sc.has(mod12(nextRoot - 1)) && inKey(nextRoot - 1) ? nextRoot - 1 : inKey(nextRoot + 1) && sc.has(mod12(nextRoot + 1)) ? nextRoot + 1 : nextRoot - 1; }
        const third = root + (ch.intervals.includes(3) ? 3 : 4) + 12;
        const role = { R: root, O: root + 12, F: fifth, S: seventh, A: app, G: root, T: Math.min(third, root + 12 + 4) };
        let bs = "groove";
        if (name === "bd1" || (name === "bd2" && c.bar < 4)) bs = "lead";
        if (name === "tag" && c.bar >= 6) bs = "sparse";
        const lib = (c.dur >= 4 ? BASS4 : BASS2)[bs];
        const gk = `${bs}${c.dur >= 4 ? 4 : 2}`;
        if (state.bassPick[gk] == null) state.bassPick[gk] = r.int(0, lib.length - 1);
        let tpl = r.chance(0.2) ? r.pick(lib) : lib[state.bassPick[gk]];
        if (name === "bd1") { const o = BD1_ORDER[c.bar]; tpl = o === "run" ? BASS_RUN : BASS4.lead[(o + (odd ? 1 : 0)) % BASS4.lead.length]; }
        if (name === "bd2" && c.bar < 4) tpl = BASS4.lead[(c.bar + 1) % BASS4.lead.length];
        for (const [b, ro, d, v] of tpl) {
          if (b >= c.dur) continue;
          bassEv.push({ at: s0 + b, dur: d, note: Math.max(28, Math.min(52, role[ro])), vel: v });
        }
      });
      state.bassRoot = lastRoot;
      // shared anticipations: the root of a pushed chord lands on the last 16th before it and ties over
      prog.forEach((c, i) => {
        if (!pushed[i]) return;
        const s0 = c.bar * 4 + c.beat;
        const first = bassEv.find((e) => Math.abs(e.at - s0) < 1e-6);
        for (let k = bassEv.length - 1; k >= 0; k--) if (bassEv[k].at > s0 - 0.5 + 1e-6 && bassEv[k].at < s0 + 0.5 - 1e-6) bassEv.splice(k, 1);
        bassEv.push({ at: s0 - 0.25, dur: 0.6, note: first ? first.note : rootOf(T.chord(c.chord).bass, 33), vel: 0.9 });
      });
      bassEv.forEach((e) => push("bass", e.at, e.dur, e.note, e.vel));

      // ---------- drums ----------
      const D = (abs, v, vel, extra) => push("drums", abs, 0.1, v, vel, extra);
      const P = (abs, v, vel, extra) => push("perc", abs, 0.1, v, vel, extra);
      const kickSet = KICKS[style === "chorus" ? "chorus" : name === "solo" ? "solo" : "verse"];
      const groove = (bar, o) => {
        const B = bar * 4, cut = o.cut ?? 4, k = (b) => b < cut - 1e-6;
        if (o.kick) (o.kickPat || kickSet[bar % 2]).filter(k).forEach((b) => D(B + b, "kick", b === 0 ? 0.9 : b % 1 ? 0.62 : 0.8));
        if (o.back) [1, 3].filter(k).forEach((b) => { D(B + b, "snare", 0.62); D(B + b, "clap", 0.6); });
        if (o.back && o.ghosts) [0.75, 1.75, 2.25, 3.25].forEach((b) => { if (k(b) && r.chance(0.22)) D(B + b, "snare", 0.13); });
        if (o.hats) for (let s = 0; s < 16; s++) {
          const b = s / 4; if (!k(b)) continue;
          if (o.open && b === 3.5 && (bar % 2 === 1 || o.open === "all")) { D(B + b, "hatOpen", 0.32); continue; }
          if (o.open && b === 3.75 && (bar % 2 === 1 || o.open === "all")) continue;
          D(B + b, "hatClosed", s % 4 === 0 ? 0.42 : s % 2 === 0 ? 0.32 : 0.17 + r.range(-0.02, 0.03));
        }
        if (o.cowbell) [0.5, 1.5, 2.5, 3.5].concat(bar % 4 === 3 ? [3.75] : bar % 2 ? [2.75] : []).forEach((b) => { if (k(b)) P(B + b, "cowbell", b % 1 === 0.5 ? 0.3 : 0.22); });
        if (o.shaker) for (let s = 0; s < 16; s++) { const b = s / 4; if (k(b)) P(B + b, "shaker", (s % 2 ? 0.2 : 0.3) * o.shaker); }
        if (o.crash) D(B, "crash", o.crash);
      };
      const fill = (bar, kind) => {
        const B = bar * 4;
        if (kind === "pickup") { D(B + 3.5, "snare", 0.4); D(B + 3.75, "snare", 0.55); D(B + 3.75, "clap", 0.4); return 3.5; }
        if (kind === "claps") { [3, 3.25, 3.5, 3.75].forEach((b, i) => { D(B + b, "clap", 0.42 + i * 0.08); }); return 3; }
        if (kind === "toms") {
          const F = r.pick([[[2.5, "snare", 0.55], [2.75, "tom", 0.66, 57], [3, "tom", 0.7, 52], [3.25, "tom", 0.66, 52], [3.5, "tom", 0.74, 47], [3.75, "tom", 0.78, 43]],
            [[3, "snare", 0.6], [3.25, "snare", 0.4], [3.5, "tom", 0.74, 52], [3.75, "tom", 0.8, 45]],
            [[2, "tom", 0.62, 57], [2.5, "tom", 0.66, 52], [3, "tom", 0.7, 47], [3.5, "snare", 0.62], [3.75, "snare", 0.72]]]);
          F.forEach(([b, v, vel, p]) => D(B + b, v, vel, p ? { pitch: p } : undefined));
          D(B + 3.75, "clap", 0.45);
          return F[0][0];
        }
        return 4;
      };
      for (let bar = 0; bar < 8; bar++) {
        const last = bar === 7;
        if (name === "intro") {
          const cut = last ? fill(bar, "pickup") : 4;
          groove(bar, { kick: true, back: true, hats: true, ghosts: true, shaker: bar >= 4 ? 0.8 : 0, crash: bar === 4 ? 0.4 : 0, cut });
        } else if (style === "verse") {
          const cut = last ? fill(bar, name === "v2" ? "toms" : "pickup") : 4;
          groove(bar, { kick: true, back: true, hats: true, ghosts: true, shaker: 1, cowbell: name === "v2", open: name === "v2" ? true : false, crash: bar === 0 && name === "v1" ? 0.45 : 0, cut });
        } else if (style === "chorus") {
          const into = name === "c2" ? "claps" : name === "c4" ? "pickup" : "toms";
          const cut = last ? fill(bar, into) : 4;
          groove(bar, { kick: true, back: true, hats: true, ghosts: true, shaker: 1, cowbell: true, open: name === "c4" ? "all" : true, crash: bar === 0 ? 0.55 : bar === 4 && name === "c4" ? 0.38 : 0, cut });
        } else if (name === "bd1") {
          // the bass and the claps carry it: claps on 2 and 4 with a few syncopated answers
          [1, 3].filter((b) => !last || b < 3).forEach((b) => D(bar * 4 + b, "clap", 0.66));
          if (bar % 2 === 1 && !last) D(bar * 4 + 3.75, "clap", 0.32);
          if (bar % 4 === 2 && r.chance(0.6)) D(bar * 4 + 2.75, "clap", 0.3);
          if (bar >= 4) for (let s = 0; s < 16; s++) P(bar * 4 + s / 4, "shaker", (s % 2 ? 0.14 : 0.22) * (0.6 + 0.1 * bar));
          if (bar >= 2) [1, 3].forEach((b) => D(bar * 4 + b + (bar % 2 ? 0 : 0.5), "snap", 0.3));
          if (last) fill(bar, "claps");
        } else if (name === "bd2") {
          const o = { back: true, shaker: 1 };
          if (bar < 2) o.kickPat = [0];
          o.kick = true;
          if (bar >= 4) { o.hats = true; o.cowbell = true; o.ghosts = true; }
          if (bar === 2) o.crash = 0.32;
          o.cut = last ? fill(bar, "toms") : 4;
          groove(bar, o);
        } else if (name === "solo") {
          const cut = last ? fill(bar, "toms") : 4;
          groove(bar, { kick: true, back: true, hats: true, ghosts: true, shaker: 1, cowbell: true, open: true, crash: bar === 0 ? 0.5 : 0, cut });
        } else if (name === "tag") {
          if (bar < 6) groove(bar, { kick: true, back: true, hats: true, ghosts: true, shaker: 1, cowbell: bar < 4, open: true, crash: bar === 0 ? 0.6 : 0 });
          else groove(bar, { kick: true, back: true, hats: true, cut: last ? fill(bar, "pickup") : 4 });
        }
      }

      // ---------- label ----------
      const label = {
        intro: "Intro · drums and bass, Rhodes at bar 5", v1: "Verse · talkbox", v2: "Verse 2 · cowbell in",
        c1: "Chorus · brass on the downbeats", c2: "Chorus", bd1: "Breakdown · bass and claps", bd2: odd ? "Breakdown · up a minor third, rebuild" : "Breakdown · bII lydian, rebuild",
        solo: odd ? "Solo · Rhodes" : "Solo · talkbox", c3: "Chorus · brass harmonises the tune", c4: "Last chorus · lands on G", tag: "Tag · Gmaj9 at last, thinning out",
      }[name];
      return { events: ev, harmony: prog, section: `Session ${sessNo + 1} · ${label}`, state };
    },
  });
})();

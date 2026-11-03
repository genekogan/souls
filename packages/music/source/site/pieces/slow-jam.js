// Candlelight: a late-night quiet-storm slow jam in Db major at 68 BPM.
//
// Song form, eight bars a cycle: intro · verse (two halves) · chorus · verse 2 · chorus 2 · bridge ·
// sax solo · breakdown · last chorus up a half step in D (twice) · tag that slides home to Db.
// A breathy alto sax sings a composed melody in the verses and choruses (the second time round it
// phrases behind the beat, scoops into long notes and adds turns), then improvises over the bridge,
// the solo, the second last chorus and the tag. Tremolo Rhodes on maj9, m11 and 13sus chords with
// passing diminished chords (Gb–G°7–Db/Ab, Db–D°7–Ebm11, Fm7–E°7–Ebm11), a fretless bass that
// glides into every change, string swells for the choruses, and wind chimes at the turns.
// The bridge visits Amaj9#11, a chromatic neighbour that slips down a half step onto Ab13sus4; the
// breakdown pivots through Em11–A13 into D, and the tag planes F#m11–Fm11–Ebm9 back down to Db.
// Drum machine: a laid-back kick, cross-stick doubled by finger snaps on 2 and 4, shaker 16ths,
// a soft 808 snare, hats and tambourine for the choruses, congas under the bridge and solo, tom fills.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony (written in Db, transposed by the section key) ----------
  const FORM = {
    intro: "| Gbmaj9 | Fm9 | Ebm11 | Ab13sus4 Ab13 | Gbmaj9 | Fm9 | Ebm11 | Ab13sus4 Ab13 |",
    verseA: "| Gbmaj9 | Fm9 | Ebm9 | Ab13sus4 Ab13 | Gbmaj9 | Gdim7 | Dbmaj9/Ab Bbm9 | Ebm11 Ab13 |",
    verseB: "| Gbmaj9 | Fm9 | Ebm9 | Ab13sus4 Ab13 | Dbmaj9 | Ddim7 | Ebm11 | Ab13sus4 Ab7b9 |",
    chorus: "| Dbmaj9 | Bbm11 | Gbmaj9 | Fm7 Edim7 | Ebm11 | Ab13sus4 Ab13 | Dbmaj9/F Gbmaj9 | Ebm9 Ab13sus4 |",
    bridge: "| Bbm11 | Fm9 | Gbmaj9 | Dbmaj9/F | Ebm11 | Amaj9#11 | Ab13sus4 | Ab7b9 |",
    solo: "| Gbmaj9 | Fm9 | Ebm9 | Ab13sus4 Ab13 | Gbmaj9 | Gdim7 | Dbmaj9/Ab Bbm9 | Ebm11 Ab13 |",
    breakdown: "| Gbmaj9 | Fm9 | Ebm9 | Dbmaj9 | Gbmaj9 | Gdim7 | Em11 | A13sus4 A7b9 |",
    outro: "| Gbmaj9 | Fm11 | Ebm11 | Ab13sus4 | Gbmaj9 | Fm11 |", // in D (key 1) ...
    outroTurn: "| Fm11 Ebm9 | Ab13sus4 Ab13 |", // ... then planing home to Db
  };

  // ---------- tunes (Db major) [bar, beat, dur, note] ----------
  const M = (xs) => xs.map(([bar, beat, dur, n]) => ({ at: bar * 4 + beat, dur, note: T.midi(n) }));
  const INTRO = M([
    [4, 1, 0.5, "Db5"], [4, 1.5, 1.5, "F5"], [4, 3, 0.5, "Eb5"], [4, 3.5, 0.5, "Db5"],
    [5, 0, 2, "C5"], [5, 2.5, 0.5, "Ab4"], [5, 3, 0.75, "G4"],
    [6, 0, 2.5, "Bb4"], [6, 3, 0.75, "Ab4"],
  ]);
  const VERSE_HEAD = M([ // a sigh down to the 9th, answered by a climb to Eb; the same answer over Ebm9 reaches F
    [0, 0.75, 0.25, "Bb4"], [0, 1, 1, "Db5"], [0, 2, 0.5, "Bb4"], [0, 2.5, 1.25, "Ab4"],
    [1, 0.75, 0.25, "Ab4"], [1, 1, 0.5, "C5"], [1, 1.5, 1.25, "Eb5"], [1, 3, 0.75, "C5"],
    [2, 0.75, 0.25, "Gb4"], [2, 1, 0.5, "Bb4"], [2, 1.5, 1, "Db5"], [2, 2.5, 0.5, "F5"], [2, 3, 1, "Eb5"],
    [3, 0, 1.5, "Db5"], [3, 1.5, 0.5, "Bb4"], [3, 2, 1.25, "C5"],
  ]);
  const VERSE_A_TAIL = M([ // up to the maj7, the dim chord's Fb as a held tension, resolving onto F over Db/Ab
    [4, 0.75, 0.25, "Eb5"], [4, 1, 1.5, "F5"], [4, 2.5, 0.5, "Eb5"], [4, 3, 1, "Db5"],
    [5, 0, 1, "Bb4"], [5, 1, 0.5, "Db5"], [5, 1.5, 1.5, "E5"],
    [6, 0, 1.5, "F5"], [6, 1.5, 0.5, "Eb5"], [6, 2, 1, "Db5"], [6, 3, 0.5, "C5"],
    [7, 0, 1.5, "Bb4"], [7, 1.5, 0.5, "Ab4"], [7, 2, 1.5, "Gb4"],
  ]);
  const VERSE_B_TAIL = M([ // a rising Db arpeggio, the D°7 climbing in thirds, the b9 of Ab7b9 leaning into the chorus
    [4, 0.5, 0.5, "Ab4"], [4, 1, 0.5, "C5"], [4, 1.5, 0.5, "Eb5"], [4, 2, 1.5, "F5"],
    [5, 0, 0.5, "Ab4"], [5, 0.5, 0.5, "B4"], [5, 1, 1, "D5"], [5, 2, 1.5, "F5"],
    [6, 0, 1.5, "Eb5"], [6, 1.5, 0.5, "Db5"], [6, 2, 1, "Bb4"], [6, 3, 0.5, "Ab4"],
    [7, 0, 1.5, "Db5"], [7, 1.5, 0.5, "Eb5"], [7, 2, 0.75, "C5"], [7, 2.75, 1, "A4"],
  ]);
  const CHORUS = M([ // the hook: 5-7-3 of Db, the same cell sequenced down over Gbmaj9, a peak on the b3 of Ebm11
    [0, 0, 0.5, "Ab4"], [0, 0.5, 0.5, "C5"], [0, 1, 2, "F5"], [0, 3, 0.5, "Eb5"], [0, 3.5, 0.5, "Db5"],
    [1, 0, 1.5, "Eb5"], [1, 1.5, 0.5, "Db5"], [1, 2, 1.5, "C5"],
    [2, 0, 0.5, "F4"], [2, 0.5, 0.5, "Ab4"], [2, 1, 2, "Db5"], [2, 3, 0.5, "Bb4"], [2, 3.5, 0.5, "Ab4"],
    [3, 0, 1.5, "Ab4"], [3, 1.5, 0.5, "C5"], [3, 2, 1, "Db5"], [3, 3, 0.75, "Bb4"],
    [4, 0, 0.5, "Bb4"], [4, 0.5, 0.5, "Db5"], [4, 1, 2, "Gb5"], [4, 3, 0.5, "F5"], [4, 3.5, 0.5, "Eb5"],
    [5, 0, 1.5, "Db5"], [5, 1.5, 0.5, "Bb4"], [5, 2, 1.5, "C5"],
    [6, 0, 0.5, "Ab4"], [6, 0.5, 0.5, "C5"], [6, 1, 2, "F5"], [6, 3, 0.5, "Eb5"], [6, 3.5, 0.5, "Db5"],
    [7, 0, 1, "Db5"], [7, 1, 1, "Bb4"], [7, 2, 1.5, "Eb5"],
  ]);

  // ---------- the arc ----------
  // sec: harmony; k: key (semitones above Db); mel: theme | improv; strings 0/1/2/"swell"; drums mode
  const PLAN = [
    { sec: "intro", k: 0, mel: "intro", strings: 1, drums: "intro", chimes: 1, label: "Intro" },
    { sec: "verseA", k: 0, mel: "verseA", strings: 0, drums: "verse", label: "Verse 1" },
    { sec: "verseB", k: 0, mel: "verseB", strings: 1, drums: "verse", label: "Verse 1 · second half" },
    { sec: "chorus", k: 0, mel: "chorus", strings: 2, drums: "chorus", label: "Chorus" },
    { sec: "verseA", k: 0, mel: "verseA", vary: 1, strings: 1, drums: "verse", label: "Verse 2" },
    { sec: "verseB", k: 0, mel: "verseB", vary: 1, strings: 1, drums: "verse", label: "Verse 2 · second half" },
    { sec: "chorus", k: 0, mel: "chorus", vary: 1, strings: 2, drums: "chorus", label: "Chorus 2" },
    { sec: "bridge", k: 0, mel: "improv", density: 0.3, register: 0.55, strings: 2, drums: "bridge", label: "Bridge · sax ad lib" },
    { sec: "solo", k: 0, mel: "improv", density: 0.5, register: 0.6, strings: 0, drums: "solo", label: "Sax solo" },
    { sec: "breakdown", k: 0, mel: "pickup", strings: "swell", drums: "break", chimes: 1, label: "Breakdown · lifting" },
    { sec: "chorus", k: 1, mel: "chorus", vary: 1, strings: 2, drums: "chorus", crash: 1, label: "Last chorus · up a half step, D" },
    { sec: "chorus", k: 1, mel: "adlib", strings: 2, drums: "chorus", label: "Last chorus · ad lib" },
    { sec: "outro", k: 1, mel: "improv", density: 0.34, register: 0.64, strings: 1, drums: "outro", chimes: 2, label: "Tag · sliding home" },
  ];

  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const nm = (pc, k) => (k === 1 ? SHARPS : T.NAMES)[mod12(pc)]; // spell D major with sharps
  const tsym = (sym, k) => !k ? sym : sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k, k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k, k));
  const prog = (text, k, off = 0) => T.progression(text).map((h) => ({ bar: h.bar + off, beat: h.beat, dur: h.dur, chord: tsym(h.chord, k) }));
  const harmonyFor = (plan) => plan.sec === "outro" ? prog(FORM.outro, 1).concat(prog(FORM.outroTurn, 0, 6)) : prog(FORM[plan.sec], plan.k);

  // ---------- comping, bass and drum cells ----------
  const COMP4 = [[[[0, 3.8, 1]], 3], [[[0, 1.4, 0], [1.5, 2.3, 0]], 2], [[[0, 2.4, 1], [2.75, 1.1, 0]], 2], [[[0, 0.9, 0], [1.75, 2.1, 1]], 1.5], [[[-0.25, 4, 1]], 1]];
  const COMP2 = [[[[0, 1.85, 1]], 3], [[[0, 0.9, 0], [1, 0.9, 0]], 1], [[[-0.25, 2.1, 0]], 1]];
  const LONG4 = [[[[0, 3.85, 1]], 1]], LONG2 = [[[[0, 1.9, 1]], 1]];
  // fretless: [pos, dur, role]  R root, O octave, F fifth, T tenth, A approach (glides into the next root)
  const BASS4 = [
    [[[0, 2.5, "R"], [2.75, 0.5, "F"], [3.5, 0.5, "A"]], 3],
    [[[0, 1.5, "R"], [1.75, 1, "O"], [3, 0.75, "F"]], 2],
    [[[0, 3.4, "R"], [3.5, 0.5, "A"]], 2.5],
    [[[0, 1, "R"], [1.5, 0.5, "R"], [2, 1.25, "T"], [3.5, 0.5, "A"]], 1.5],
  ];
  const BASS2 = [[[[0, 1.75, "R"]], 3], [[[0, 1.25, "R"], [1.5, 0.5, "A"]], 2]];
  const KICK = { verse: [[0, 2.5], [0, 2.75, 3.5], [0, 1.75, 2.5]], chorus: [[0, 2.5, 2.75], [0, 1.75, 2.5], [0, 2.5, 3.5]], half: [[0, 2.5], [0, 2.75]] };

  const muddy = (v, semi = 70) => v.some((m, i) => i > 0 && ((v[i - 1] < 55 && m - v[i - 1] < 3) || (v[i - 1] < semi && m - v[i - 1] === 1)));
  function voiceKeys(sym, prev, n, r) {
    const top = [65, 74];
    let best = null, bestS = Infinity;
    for (const spread of ["any", "close", "drop2", "open"]) for (const lo of [51, 53, 56]) for (const nn of n > 4 ? [n, 4] : [n]) {
      const v = T.voice(sym, { lo, hi: 77, n: nn, prev, top, spread, rng: r, omitBass: true });
      if (muddy(v) || new Set(v).size < v.length) continue;
      let s = nn < n ? 1.5 : 0;
      if (prev && prev.length) {
        const b = prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - 63);
      const t = v[v.length - 1];
      if (t > top[1]) s += (t - top[1]) * 1.5;
      if (t < top[0]) s += (top[0] - t) * 1.5;
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo: 55, hi: 78, n: 4, prev });
  }
  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };

  Sim.register({
    id: "slow-jam",
    title: "Candlelight",
    genre: "Quiet storm",
    about: "A late-night quiet-storm slow jam in D♭: a breathy alto sax sings its melody and then improvises over tremolo Rhodes maj9 and m11 chords with passing diminished chords, a gliding fretless bass, string swells, cross-stick and finger snaps on a soft drum machine, and a last chorus lifted a half step.",
    situations: ["romance", "hangout"],
    energy: 0.35,
    bpm: 68, swing: 0.54, swingUnit: 0.25, beatsPerBar: 4, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 4.8, preDelay: 0.035, lowcut: 350, highcut: 6000 });
      const plate = I.reverb(ctx, out, { decay: 1.9, preDelay: 0.01, lowcut: 400, highcut: 7500 });
      const echo = I.delay(ctx, out, { time: "4n", feedback: 0.22, highcut: 2400 });
      const sax = I.sax(ctx, { volume: 0, cutoff: 2700, breath: -17, vibrato: 4.9, vibratoDepth: 0.055, attack: 0.05, glide: 0.04, release: 0.32 });
      const rhodes = I.rhodes(ctx, { volume: -6, cutoff: 3200, tremolo: 2.6, tremoloDepth: 0.3, bark: 1.9, tine: -15 });
      const strings = I.strings(ctx, { volume: -11, cutoff: 2600, attack: 0.9, release: 1.8 });
      const bass = I.ebass(ctx, { volume: -4, fretless: true, base: 115 });
      const chimes = I.glock(ctx, { volume: -17, celesta: true, decay: 3 });
      const kit = I.kit(ctx, { volume: -5, kickNote: 32, preload: ["kick", "rim", "snap", "shaker"] });
      const warm = ctx.keep(new Tone.Filter({ frequency: 7000, type: "lowpass", rolloff: -12 })).connect(out);
      const sp = I.place(ctx, sax, 0.08, out), rp = I.place(ctx, rhodes, -0.22, out), stp = I.place(ctx, strings, 0.3, out);
      I.place(ctx, bass, 0, out);
      const cp = I.place(ctx, chimes, 0.55, out), kp = I.place(ctx, kit, -0.03, warm);
      I.send(ctx, sp, hall, -9); I.send(ctx, sp, echo, -19); I.send(ctx, rp, hall, -15); I.send(ctx, rp, plate, -17);
      I.send(ctx, stp, hall, -7); I.send(ctx, cp, hall, -4); I.send(ctx, kp, plate, -14); I.send(ctx, kp, hall, -24);
      I.send(ctx, bass.out, plate, -28);
      const play = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        sax: { layer: "melody", play: play(sax), humanize: { timing: 0.014, vel: 0.05 } },
        keys: { layer: "harmony", play: play(rhodes), humanize: { timing: 0.01, vel: 0.05 } },
        keyFill: { layer: "harmony", play: play(rhodes), humanize: { timing: 0.008, vel: 0.06 } },
        strings: { layer: "harmony", play: play(strings), humanize: { timing: 0.02, vel: 0.03 } },
        bass: { layer: "bass", play: play(bass), humanize: { timing: 0.008, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.07 } },
        chimes: { layer: "texture", play: play(chimes), humanize: { timing: 0.004, vel: 0.15 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % PLAN.length, round = Math.floor(cycle / PLAN.length);
      const plan = PLAN[idx], next = PLAN[(idx + 1) % PLAN.length];
      const k = plan.k;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };

      // ---- harmony ----
      const harmony = harmonyFor(plan);
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * 4 + h.beat, end: h.bar * 4 + h.beat + h.dur }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const sym = (b) => chordAt(b).chord;
      const nextFirst = harmonyFor(next)[0].chord;

      /** Keep a line legato without overlaps, fit onsets to the chord, never hold into a clash. */
      const fit = (ns) => {
        ns.sort((a, b) => a.at - b.at);
        ns = ns.filter((n, i) => n.at >= -0.5 && n.at < 31.8 && (n.grace || !(i + 1 < ns.length && ns[i + 1].at - n.at < 0.2)));
        ns.forEach((n, i) => {
          const nx = ns[i + 1];
          if (n.grace) { n.dur = nx ? Math.max(0.06, nx.at - n.at - 0.01) : 0.12; return; } // a scoop runs straight into its note
          if (nx) n.dur = Math.min(n.dur, nx.at - n.at - 0.04);
          n.dur = Math.max(0.15, Math.min(n.dur, 31.9 - n.at));
          const ok = okSet(sym(Math.max(0, n.at)));
          if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]);
          for (const h of hAbs) if (h.start > n.at + 0.01 && h.start < n.at + n.dur - 0.1 && !okSet(h.chord).has(mod12(n.note))) { n.dur = Math.max(0.2, h.start - n.at - 0.05); break; }
        });
        return ns;
      };
      /** A singer's second time through: behind the beat, scoops, turns, falls at phrase ends. */
      const sing = (src, amount) => {
        let ns = src.map((n) => ({ ...n }));
        // phrases = runs separated by a rest of a beat or more
        const phrases = [];
        ns.forEach((n, i) => { if (!i || n.at - (ns[i - 1].at + ns[i - 1].dur) >= 0.9) phrases.push([]); phrases[phrases.length - 1].push(n); });
        const out = [];
        phrases.forEach((ph) => {
          const lag = r.chance(0.35 * amount) ? 0.25 : 0;
          ph.forEach((n, i) => {
            const at = n.at + (i === 0 || lag ? lag : 0);
            const sc = T.chord(sym(Math.max(0, at))).scale;
            if (n.dur >= 1.5 && r.chance(0.22 * amount)) { // turn: note, upper neighbour, note
              out.push({ at, dur: 0.25, note: n.note }, { at: at + 0.25, dur: 0.25, note: T.step(n.note, 1, sc) }, { at: at + 0.5, dur: n.dur - 0.5 - lag, note: n.note });
            } else if (n.dur >= 1 && r.chance(0.3 * amount)) { // scoop from below
              out.push({ at, dur: 0.12, note: T.step(n.note, -1, sc), grace: 1 }, { at: at + 0.12, dur: n.dur - 0.12 - lag, note: n.note, straight: true });
            } else out.push({ at, dur: n.dur - (i === ph.length - 1 ? 0 : lag), note: n.note });
          });
          const last = out[out.length - 1];
          if (last.dur >= 1.25 && r.chance(0.3 * amount)) { // a soft fall off the end of the phrase
            last.dur -= 0.4;
            out.push({ at: last.at + last.dur + 0.02, dur: 0.3, note: T.step(last.note, -2, T.chord(sym(last.at)).scale), vel: 0.4 });
          }
        });
        return out;
      };
      const improvise = (start, end, density, register, rest = [1, 2.5], hiAdd = 0) => {
        const m = C.line({ start, end, chordAt: sym, lo: 61 + k, hi: 79 + k + hiAdd, rng: r, density, phrase: [3, 7], rest, motif: state.motif, motifProb: 0.4, chromatic: 0.2, register, prev: state.saxLast, upbeatStart: 0.55, lead: r.pick([0, 0.5, 0.75]) });
        state.motif = m.motif; state.saxLast = m.last;
        return sing(m.notes.map((n) => ({ at: n.beat, dur: n.dur, note: n.note })), 0.8);
      };

      // ---- sax ----
      let line = [];
      const theme = (src) => src.map((n) => ({ ...n, note: n.note + k }));
      const amount = plan.vary || round > 0 ? 1 : 0;
      if (plan.mel === "intro") line = sing(theme(INTRO), amount * 0.5);
      else if (plan.mel === "verseA") line = sing(theme(VERSE_HEAD.concat(VERSE_A_TAIL)), amount);
      else if (plan.mel === "verseB") line = sing(theme(VERSE_HEAD.concat(VERSE_B_TAIL)), amount);
      else if (plan.mel === "chorus") line = sing(theme(CHORUS), amount);
      else if (plan.mel === "adlib") line = sing(theme(CHORUS.filter((n) => n.at < 16)), 1).concat(improvise(16, 31, 0.58, 0.74, [0.5, 1.5], 2));
      else if (plan.sec === "solo") line = improvise(0, 15.5, plan.density - 0.1, plan.register - 0.05, [1, 2]).concat(improvise(16, 31, plan.density + 0.15, plan.register + 0.12, [0.5, 1.5], 3)); // the solo builds
      else if (plan.mel === "improv") line = improvise(plan.sec === "outro" ? 0.5 : 0, plan.sec === "outro" ? 25 : 31, plan.density, plan.register);
      else if (plan.mel === "pickup") line = improvise(20, 30, 0.3, 0.45);
      line = fit(line);
      const saxBusy = new Set();
      line.forEach((n) => {
        const long = n.dur >= 1;
        const vel = n.vel ?? (0.62 + (long ? 0.06 : 0) - (n.grace ? 0.15 : 0) + (plan.sec === "chorus" ? 0.04 : 0) + r.gauss(0.025));
        push("sax", n.at, n.dur, n.note, vel, n.straight ? { delay: 0.04 } : undefined);
        for (let b = Math.floor(n.at * 2) / 2; b < n.at + n.dur; b += 0.5) saxBusy.add(b);
      });

      // ---- Rhodes ----
      const quiet = plan.drums === "break" || plan.drums === "intro";
      const hits = [];
      harmony.forEach((h) => {
        const s0 = h.bar * 4 + h.beat;
        const v = voiceKeys(h.chord, state.voicing, r.chance(0.4) ? 5 : 4, r);
        state.voicing = v;
        let pats = (quiet && h.bar < 4) ? (h.dur >= 4 ? LONG4 : LONG2) : (h.dur >= 4 ? COMP4 : COMP2);
        if (s0 === 0) pats = pats.filter(([p]) => p[0][0] >= 0);
        r.weighted(pats).forEach(([b, d, roll]) => hits.push({ at: s0 + b, d, v, roll }));
      });
      hits.sort((a, b) => a.at - b.at);
      hits.forEach((h, i) => {
        const nx = i + 1 < hits.length ? hits[i + 1].at : 32;
        const dur = Math.min(h.d, nx - h.at - 0.06);
        const vel = 0.44 + (h.at < 0 ? 0.04 : 0) + r.range(-0.03, 0.04);
        if (h.roll) h.v.forEach((m, j) => push("keys", h.at, dur, m, vel * (1 - j * 0.03), { delay: j * 0.024 }));
        else push("keys", h.at, dur, h.v, vel);
      });
      state.fillBar = -9;
      // little Rhodes answers in the sax's rests: three chord tones falling from the top
      if (plan.mel !== "improv" && plan.mel !== "adlib") {
        for (let bar = 0; bar < 8; bar++) {
          const b0 = bar * 4 + 2.5;
          if ([0, 0.5, 1, 1.5].some((x) => saxBusy.has(b0 + x)) || state.fillBar === bar - 1 || !r.chance(0.32)) continue;
          const h = chordAt(b0);
          if (h.start > b0 || h.end < b0 + 1.5) continue;
          const c = T.chord(h.chord);
          const tones = T.notesIn(c.guide.concat(c.colors, [mod12(c.root + 7)]), 72, 86).reverse();
          if (tones.length < 3) continue;
          const st = r.int(0, Math.min(2, tones.length - 3));
          [[0, 0.25], [0.25, 0.25], [0.5, 0.9]].forEach(([o, d], j) => push("keyFill", b0 + o, d, tones[st + j], 0.36 - j * 0.03));
          state.fillBar = bar;
        }
      }

      // ---- strings ----
      if (plan.strings) {
        harmony.forEach((h, i) => {
          const s0 = h.bar * 4 + h.beat;
          if (plan.strings === "swell" && h.bar < 4) return;
          const full = plan.strings === 2 || plan.strings === "swell";
          let v = null;
          for (let t = 0; t < 10 && (!v || muddy(v, 99)); t++) v = T.voice(h.chord, { lo: full ? 60 : 58, hi: full ? 84 : 77, n: 3, prev: state.strV, top: full ? [74, 81] : [68, 74], rng: t ? r : null, omitBass: true });
          // no semitones in the section: open any minor second into a major seventh
          for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] === 1) { v[i - 1] -= 12; v.sort((a, b) => a - b); i = 0; }
          state.strV = v;
          const vel = plan.strings === "swell" ? 0.26 + 0.07 * (h.bar - 4) : full ? 0.42 : 0.3;
          push("strings", s0, h.dur - 0.08, v, vel);
          void i;
        });
      }

      // ---- fretless bass ----
      let root = state.bassRoot ?? 37, last = state.bassLast ?? 37;
      const rootOf = (s, ref) => T.nearest(ref, [T.chord(s).bass], 30, 46);
      // chords sharing a bass note (Ab13sus4 → Ab13) are one span for the bass
      const spans = [];
      hAbs.forEach((h) => {
        const p = spans[spans.length - 1];
        if (p && T.chord(p.chord).bass === T.chord(h.chord).bass && p.bar === h.bar) { p.dur += h.dur; p.end = h.end; }
        else spans.push({ ...h });
      });
      spans.forEach((h, hi) => {
        const len = h.dur, c = T.chord(h.chord);
        root = rootOf(h.chord, root);
        const nextSym = hi + 1 < spans.length ? spans[hi + 1].chord : nextFirst;
        const nextRoot = rootOf(nextSym, root);
        const fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
        let cell = r.weighted(len >= 4 ? BASS4 : BASS2).map((x) => x.slice());
        if (plan.drums === "break" && h.bar < 4) cell = [[0, len - 0.2, "R"]];
        if (plan.drums === "intro" && h.bar < 2) cell = [[0, len - 0.2, "R"]];
        const slash = c.bass !== c.root;
        cell.forEach(([pos, dur, role]) => {
          if (pos >= len - 0.01) return;
          const cc = T.chord(sym(h.start + pos)); // a merged span may have changed chord (sus4 → 3)
          const third = cc.intervals.includes(3) ? 3 : cc.intervals.includes(4) ? 4 : 5;
          let n;
          if (slash && role !== "R" && role !== "A") n = root + 12 <= 53 ? root + 12 : root; // over a slash bass, stay on it
          else if (role === "R") n = root;
          else if (role === "O") n = root + 12 <= 50 ? root + 12 : root + fifth;
          else if (role === "F") n = root + fifth > 47 ? root + fifth - 12 : root + fifth;
          else if (role === "T") n = root + third + 12 <= 52 ? root + third + 12 : root + third;
          else { // glide into the next root from a chord tone a step away (the fretless slides the rest)
            const ok = new Set(c.pcs.concat([c.bass]));
            const opts = [[-1, 3], [1, 2.5], [-2, 1.5], [2, 1]].filter(([s]) => ok.has(mod12(nextRoot + s)) && nextRoot + s !== last);
            if (!opts.length || nextRoot === root) return;
            n = nextRoot + r.weighted(opts);
            dur = len - pos; // legato: the glide happens on the next note
          }
          push("bass", h.start + pos, dur, n, role === "A" ? 0.55 : pos === 0 ? 0.8 : 0.66);
          last = n;
        });
      });
      state.bassRoot = root; state.bassLast = last;

      // ---- drums ----
      const mode = plan.drums;
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      const kickSet = KICK[mode === "chorus" ? "chorus" : mode === "bridge" ? "half" : "verse"];
      const ka = r.pick(kickSet), kb = r.pick(kickSet.filter((x) => x !== ka));
      const backbeat = (B, p) => {
        if (mode === "chorus") { D(B + p, "snare808", 0.42, { delay: 0.018 }); D(B + p, "snap", 0.3, { delay: 0.026 }); D(B + p, "tambourine", 0.2, { delay: 0.02 }); }
        else { D(B + p, "rim", 0.46, { delay: 0.016 }); D(B + p, "snap", 0.34, { delay: 0.026 }); }
      };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        const lastBar = bar === 7, nextBig = next.drums === "chorus" && mode !== "chorus";
        let fill = null;
        if (lastBar) fill = mode === "break" ? "toms" : nextBig ? r.pick(["toms", "flam"]) : r.weighted([["rimRoll", 2], ["flam", 1.5], [null, 1]]);
        else if (bar === 3 && r.chance(0.3) && mode !== "break") fill = "pickup";
        const stopAt = fill === "toms" ? 2.5 : 4;
        // which layers play this bar
        let kick = true, shaker = "16", hats = null, back = true, conga = false;
        if (mode === "intro") { kick = bar >= 2; back = bar >= 1; shaker = bar >= 1 ? "16" : null; }
        else if (mode === "chorus") hats = "8";
        else if (mode === "bridge") { shaker = "8"; conga = true; }
        else if (mode === "solo") conga = true;
        else if (mode === "break") { kick = bar >= 4; shaker = bar >= 4 ? "16" : "8"; back = true; }
        else if (mode === "outro") { kick = bar < 6; hats = null; conga = bar >= 2 && bar < 6; }
        if (kick) (bar % 2 ? kb : ka).forEach((p) => { if (p < stopAt) D(B + p, "kick", p === 0 ? 0.62 : 0.5); });
        if (back) {
          if (mode === "bridge") { if (stopAt > 2) backbeat(B, 2); D(B + 3.75, "rim", 0.16); }
          else if (mode === "break" && bar < 4) { D(B + 1, "snap", 0.36, { delay: 0.024 }); D(B + 3, "snap", 0.38, { delay: 0.024 }); }
          else { backbeat(B, 1); if (stopAt > 3) backbeat(B, 3); }
        }
        if (shaker) for (let s = 0; s < 16; s++) {
          const p = s / 4;
          if (p >= stopAt) break;
          if (shaker === "8" && s % 2) continue;
          D(B + p, "shaker", [0.24, 0.09, 0.16, 0.11][s % 4] + r.gauss(0.015));
        }
        if (hats) {
          const open = bar % 2 === 1 && stopAt > 3.5;
          for (let s = 0; s < 8; s++) { const p = s / 2; if (p >= stopAt || (open && p >= 3.5)) break; D(B + p, "hat808", s % 2 ? 0.16 : 0.24); }
          if (open) D(B + 3.5, "hat808Open", 0.18);
        }
        if (conga) [[1.5, "conga", 0.26, 63], [1.75, "conga", 0.18, 63], [3.25, "congaLow", 0.24, 56], [3.5, "conga", 0.2, 63]].forEach(([p, v, vel, pitch]) => { if (p < stopAt) D(B + p, v, vel + r.gauss(0.03), { pitch }); });
        // ghost cross-stick
        if (back && mode !== "break" && r.chance(0.35)) { const p = r.pick([1.75, 2.75, 3.75].filter((x) => x < stopAt && !(bar % 2 ? kb : ka).includes(x))); if (p != null) D(B + p, "rim", 0.14); }
        // fills that mark the form
        if (fill === "toms") [[2.5, 50, 0.32], [2.75, 50, 0.28], [3, 45, 0.38], [3.25, 45, 0.34], [3.5, 41, 0.44], [3.75, 38, 0.5]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch }));
        else if (fill === "flam") { D(B + 3.5, "snare808", 0.3, { delay: 0.01 }); D(B + 3.5, "snare808", 0.42, { delay: 0.035 }); }
        else if (fill === "rimRoll") [[3.25, 0.18], [3.5, 0.24], [3.75, 0.3]].forEach(([p, v]) => D(B + p, "rim", v, { delay: 0.012 }));
        else if (fill === "pickup") D(B + 3.75, "rim", 0.22);
        if (mode === "chorus" && bar % 4 === 0) D(B, "triangle", 0.2);
      }
      if (plan.crash || (plan.drums === "chorus" && PLAN[(idx + PLAN.length - 1) % PLAN.length].drums !== "chorus")) D(0, "crash", 0.32);

      // ---- wind chimes at the turns ----
      const chime = (at, dir) => {
        const c = T.chord(sym(at));
        const ns = T.notesIn(c.pcs, 82, 97);
        const seq = dir < 0 ? ns.slice().reverse() : ns;
        const end = chordAt(at).end;
        seq.slice(0, 8).forEach((m, i) => push("chimes", at + i * 0.11, Math.max(0.3, Math.min(1.5, end - at - i * 0.11 - 0.05)), m, 0.34 - i * 0.02, { straight: true }));
      };
      if (plan.chimes === 1) chime(plan.sec === "breakdown" ? 28 : 0, -1);
      if (plan.chimes === 2) { chime(0, -1); chime(28, 1); }

      return { events: ev, harmony, section: plan.label, state };
    },
  });
})();

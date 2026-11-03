// Taiko Clash: kumi-daiko for a battle or a festival.
//
// The ensemble: an o-daiko (the big drum, tuned a fifth below the drone), two chu-daiko players
// left and right (tuned to the tonic and its fifth), a shime-daiko keeping the ji-uchi (base rhythm),
// kachi rim clicks on every drum, an atarigane-like bell (chan-chiki), a shinobue (the high festival
// flute, a bright shakuhachi voice) and, for the quiet song, a breathy shakuhachi. Strings and a
// wordless choir only swell under the accelerando and the climaxes.
//
// Each drum is its own kit, so the players can strike together (a kit voice is monophonic) and are
// placed across the stage. Patterns are written on a 16th grid, one string per bar:
//   X massive  O accent  o stroke  x edge stroke (thinner, higher)  k/K kachi (rim)  r roll  f flam
//
// Scales: yo (D E G A B, bright, festival) and in / miyako-bushi (D Eb G A Bb, dark, battle).
// Harmony labels: yo = "Dsus4" (its chord scale is the yo scale plus C); in = "Ebmaj7#11/D", which is
// exactly the in-scale's pitch set over the D drone.
//
// Form (cycles of 4 bars; one round is 17 cycles, about 2.5 minutes; tonic D, then E, then C):
//   oroshi (rolls rise from silence, a unison call) -> ji-uchi x3 (base patterns lock in, the fue enters)
//   -> kakeai x2 (left and right drums trade calls, the trades shorten into unison) -> uta x2
//   (shakuhachi in the in-scale over a heartbeat) -> solo x2 (o-daiko or a chu-daiko, rotating by round)
//   -> hayame x3 (accelerando with tempo ramps, the fue's in-scale riff, strings) -> unison climax x2
//   (yo scale, massive hits, then one stroke and silence) -> finale (o-daiko alone, accelerating;
//   then everyone, crescendo, and a last stroke).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BARS = 4, CYC = BPB * BARS;
  const YO = [0, 2, 5, 7, 9], IN = [0, 1, 5, 7, 8];
  const TONICS = [2, 4, 0];          // D, E, C
  const BASES = [120, 126, 116];      // base tempo per round
  const NM = T.NAMES;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const strip = (s) => s.replace(/\s+/g, "");

  // ---------- patterns (one string = one bar of 16ths) ----------
  const JI = {
    doko: "O.xx o.xx O.xx o.xx",
    ten: "O.o. o.o. O.o. o.o.",
    matsuri: "O..x o..x O..x o..x",
    kizami: "Oxox oxox Oxox oxox",
    quiet: "o... ..x. o... ..x.",
    fill: "oxox oxox OxOx OOOO",
  };
  const ODA = {
    A: ["O... .... O... ....", "O... .... O..o ...."],
    B: ["O... ...o O... ....", "O... ..o. O... O..."],
    C: ["O... .... .... ..o.", "O... .... O... .O.."],
    drive: ["O... O... O... O...", "O... O... O.O. O..."],
  };
  const CHU = {
    A: ["O..o ..o. O.oo O...", "O..o ..o. k.kk O.O."],
    B: ["O.o. O.oo .oO. o.k.", "O.oo O.oo k.k. O..."],
    C: ["O... o.oo O... kkO.", "O..o O..o O.O. O..."],
    E: ["Oo.o Oo.o O.k. O...", "Oo.o Oo.o OOOO k.O."],
  };
  const SYNC = ["O..O ..O. .O.. O.k.", "O..O ..O. .O.O kkO."]; // the hayame phrase
  const CALLS = ["O.O. O.oo O... k.k.", "O..o O..o OO.. ....", "Oooo O... O.O. ....", "O.k. O.k. Oooo O...", "f... O.oo kkO. O...", "O..O ..O. O.oo O..."];
  const CADENCES = ["O...", "OO..", "k.O.", "O.O.", "Oo.."];
  const UNI = ["X... X... X.X. X...", "X..X ..X. X..X ..X.", "X.X. X.X. XXXX X...", "X... .... X... X...", "Xxxx Xxxx X.X. X.X.", "X..X ..X. XXXX XXXX", "X.XX .XX. X.XX .X.."];
  const KANE = { chanchiki: "O... O.oo O... O.oo", quarters: "O... o... O... o...", haya: "O.oo O.oo O.oO O.oo" };
  const SOLO_LO = ["O...", "O.o.", "o.oo", "O..o", ".oO.", "O.k.", "k.O.", "O.oo", "..oo", "Ok.k"];
  const SOLO_HI = ["oooo", "Oooo", "O.Oo", "rr..", "rrrr", "OoOo", "kkO.", "f.oo", "Ooxo", "oxox"];

  // ---------- melody ----------
  const CELLS = [
    [[0, 1.5], [1.5, 0.5], [2, 2]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
    [[0, 2], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]],
    [[0, 0.75], [0.75, 0.25], [1, 1], [2, 2]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
  ];
  const LONG = [[[0, 3], [3, 1]], [[0, 4]], [[0, 2], [2, 2]], [[0, 2.5], [2.5, 0.5], [3, 1]]];
  const CADENCE = [[[0, 1], [1, 3]], [[0, 0.5], [0.5, 0.5], [1, 3]], [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 4]]];
  const RIFF_CELL = [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]];
  const RIFFS = [[5, 6, 5, 3, 4, 3], [3, 4, 5, 4, 3, 2], [5, 6, 7, 6, 5, 3], [6, 5, 3, 4, 5, 3]];

  /** Walk a rhythm cell from degree `from` to `to`, stepwise through the pentatonic. */
  function walk(r, cell, at, from, to, lo, hi) {
    const out = [], span = 2 * cell.length + 1;
    while (to - from > span && to - 5 >= lo) to -= 5;
    while (from - to > span && to + 5 <= hi) to += 5;
    let d = from;
    cell.forEach(([off, dur], i) => {
      if (i === cell.length - 1) d = to;
      else if (i > 0) {
        const remain = cell.length - 1 - i, gap = to - d, dir = Math.sign(gap) || (r.chance(0.5) ? 1 : -1);
        // no repeated notes, and the note before the goal approaches it from a neighbour
        const opts = (Math.abs(gap) > remain + 1 ? [[dir * 2, 1], [dir, 2]] : [[dir, 2], [-dir, 1.1], [dir * 2, 0.3]])
          .map(([s, w]) => [clamp(d + s, lo, hi), w]).filter(([x]) => x !== d && !(remain === 1 && x === to));
        d = opts.length ? r.weighted(opts) : clamp(d + dir, lo, hi);
      }
      d = clamp(d, lo, hi);
      out.push({ beat: at + off, dur, deg: d });
    });
    return out;
  }
  function motifAt(m, at, start, lo, hi) { return m.cell.map(([off, dur], i) => ({ beat: at + off, dur, deg: clamp(start + m.shape[i], lo, hi) })); }
  /** Grace notes (a quick upper neighbour) before long notes, the flute's "uchi" ornament. */
  function ornament(r, notes, p) {
    const out = [];
    notes.forEach((n, i) => {
      const prev = notes[i - 1];
      if (n.dur >= 1.5 && r.chance(p) && (!prev || prev.deg !== n.deg + 1) && (!prev || n.beat - (prev.beat + prev.dur) > -1e-6)) {
        if (prev && prev.beat + prev.dur > n.beat - 0.125) prev.dur = Math.max(0.25, n.beat - 0.125 - prev.beat);
        out.push({ beat: n.beat - 0.125, dur: 0.125, deg: n.deg + 1, grace: true });
      }
      out.push(n);
    });
    return out;
  }
  /** A 4-bar fue phrase: motif, motif in sequence, a climb, a long cadence. */
  function fuePhrase(r, m, at, { start, seq, peak, end, lo, hi }) {
    const a = motifAt(m, at, start, lo, hi);
    const b = motifAt(m, at + 4, start + seq, lo, hi);
    const bl = b[b.length - 1];
    const goal = clamp([0, 3, 5, 8].reduce((best, x) => (Math.abs(x - bl.deg) < Math.abs(best - bl.deg) ? x : best), 3), lo, hi);
    if (b.length < 2 || b[b.length - 2].deg !== goal) bl.deg = goal;
    const c = walk(r, r.pick(CELLS), at + 8, bl.deg + (peak > bl.deg ? 1 : -1), peak, lo, hi);
    // land the cadence in the octave nearest the climb, with enough notes to walk there
    const from = peak - 1;
    const goal2 = [end, end + 5, end - 5].filter((x) => x >= lo && x <= hi).reduce((best, x) => (Math.abs(x - from) < Math.abs(best - from) ? x : best), end);
    const fits = CADENCE.filter((cl) => cl.length >= Math.min(3, Math.abs(goal2 - from)));
    const d = walk(r, r.pick(fits.length ? fits : CADENCE), at + 12, from, goal2, lo, hi);
    return a.concat(b, c, d);
  }

  // ---------- form ----------
  const ROUND = [
    { id: "intro", mode: "in", label: "Oroshi · rolls rise out of silence" },
    { id: "ji", n: 0, mode: "yo", label: "Ji-uchi · the base rhythm locks in" },
    { id: "ji", n: 1, mode: "yo", label: "Ji-uchi · shinobue and bell enter" },
    { id: "ji", n: 2, mode: "yo", label: "Ji-uchi · the phrase answers" },
    { id: "kake", n: 0, mode: "yo", label: "Kakeai · left and right drums trade calls" },
    { id: "kake", n: 1, mode: "yo", label: "Kakeai · the trades shorten into unison" },
    { id: "uta", n: 0, mode: "in", label: "Uta · shakuhachi over a heartbeat" },
    { id: "uta", n: 1, mode: "in", label: "Uta · the drums gather" },
    { id: "solo", n: 0, mode: "in", label: "Solo" },
    { id: "solo", n: 1, mode: "in", label: "Solo · rolls" },
    { id: "haya", n: 0, mode: "in", label: "Hayame · accelerando", up: 12 },
    { id: "haya", n: 1, mode: "in", label: "Hayame · faster", up: 26 },
    { id: "haya", n: 2, mode: "in", label: "Hayame · flat out", up: 40 },
    { id: "uni", n: 0, mode: "yo", label: "Climax · unison strokes" },
    { id: "uni", n: 1, mode: "yo", label: "Climax · one stroke, then ma" },
    { id: "fin", n: 0, mode: "yo", label: "Finale · the o-daiko alone, accelerating" },
    { id: "fin", n: 1, mode: "yo", label: "Finale · everyone, crescendo" },
  ];
  const SOLOISTS = ["chuL", "odaiko", "chuR"];
  const SOLO_NAME = { chuL: "chu-daiko (left)", odaiko: "o-daiko", chuR: "chu-daiko (right)" };

  /** Everything decided once per round: tonic, patterns, melodies, the solo. */
  function planRound(r, round) {
    const tonic = TONICS[round % 3];
    const fueT = 72 + tonic, shakuT = 60 + tonic;
    const fueHi = (() => { let d = 0; while (fueT + 12 * Math.floor((d + 1) / 5) + YO[(d + 1) % 5] <= 93) d++; return d; })();
    const m = (() => {
      const cell = r.pick(CELLS.filter((c) => c.length >= 3));
      const shape = [0];
      for (let i = 1; i < cell.length; i++) shape.push(shape[i - 1] + r.weighted([[1, 3], [-1, 3], [2, 1], [-2, 1]]));
      return { cell, shape };
    })();
    const s0 = r.pick([2, 3, 5]);
    const fueA = ornament(r, fuePhrase(r, m, 0, { start: s0, seq: r.pick([1, -1, 2]), peak: Math.min(fueHi, s0 + r.int(2, 4)), end: 3, lo: -1, hi: fueHi }), 0.55);
    const fueB = ornament(r, fuePhrase(r, m, 0, { start: s0, seq: 2, peak: Math.min(fueHi, s0 + r.int(3, 5)), end: r.pick([0, 5]), lo: -1, hi: fueHi }), 0.55);
    // the uta: 8 slow bars of shakuhachi in the in-scale
    const uta = [];
    const goals = [5, 6, r.pick([4, 5]), 3, 5, 7, r.pick([6, 8]), 5];
    let at = 3;
    goals.forEach((g, i) => {
      let start = i === 0 ? 3 : clamp(at + (g > at ? 1 : g < at ? -1 : r.pick([1, -1])), 0, 8);
      if (start === g) start = clamp(g + (g >= at ? 1 : -1), 0, 8); // overshoot, then settle onto the goal
      const cell = i % 4 === 3 ? r.pick(CADENCE) : r.chance(0.6) ? r.pick(LONG) : r.pick([CELLS[0], CELLS[2], CELLS[5]]);
      const notes = walk(r, cell, i * 4, start, g, 0, 8);
      uta.push(...notes);
      at = notes[notes.length - 1].deg;
    });
    // the climax tune: long high yo notes
    const top = fueHi, climax = ornament(r, [
      { beat: 0, dur: 3, deg: top }, { beat: 3, dur: 1, deg: top - 1 },
      { beat: 4, dur: 2, deg: top }, { beat: 6, dur: 1, deg: top - 2 }, { beat: 7, dur: 1, deg: top - 1 },
      { beat: 8, dur: 3, deg: top - 3 }, { beat: 11, dur: 1, deg: top - 2 },
      { beat: 12, dur: 4, deg: top - 1 },
    ], 0.8);
    // the solo: 7 bars generated from cells, the eighth is the ensemble's break
    const lo = () => r.pick(SOLO_LO), hi = () => r.pick(SOLO_HI);
    const M = [lo(), lo(), r.chance(0.5) ? hi() : lo(), r.pick(["O...", "O.O.", "Oo.."])];
    const solo = [
      M,
      [M[0], M[1], M[2], hi()],
      [lo(), hi(), lo(), hi()],
      [M[0], M[1], "O.O.", "...."],
      M.map((c) => (r.chance(0.6) ? hi() : c)),
      [r.pick(["k.k.", "kkk."]), hi(), r.pick(["k.k.", "kkO."]), hi()],
      [hi(), "rrrr", hi(), "rrrr"],
    ].map((cells) => cells.join(""));
    return {
      round, tonic, fueT, shakuT, fueHi,
      base: BASES[round % 3],
      ji: r.pick(["doko", "doko", "matsuri", "ten"]),
      oda: r.pick(["A", "B", "C"]),
      chu: r.pick(Object.keys(CHU)),
      calls: r.shuffle(CALLS),
      uni: r.shuffle(UNI),
      riff: r.pick(RIFFS),
      soloist: SOLOISTS[round % 3],
      fueA, fueB, uta, climax, solo,
      // pitches: o-daiko a fifth below the chu-daiko's tonic; chu right on the fifth
      pitch: { odaiko: 31 + tonic, chuL: 36 + tonic, chuR: 43 + tonic, edge: 2 },
    };
  }

  Sim.register({
    id: "taiko-clash",
    title: "Taiko Clash",
    genre: "Taiko ensemble",
    about: "Kumi-daiko for a battle or a festival: o-daiko, two chu-daiko and a shime ji-uchi trade calls, solo and accelerate over a shinobue in the yo and in scales, then strike in unison, fall silent, and build again.",
    situations: ["fight", "training", "celebrate"],
    energy: 0.9,
    bpm: BASES[0], beatsPerBar: BPB, cycleBars: BARS, swing: 0.5, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.03, lowcut: 160, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.008, lowcut: 250, highcut: 7000 });
      const drum = (volume, pan, preload, hallDb, roomDb) => {
        const k = I.kit(ctx, { volume, preload });
        const p = I.place(ctx, k, pan, out);
        I.send(ctx, p, hall, hallDb); I.send(ctx, p, room, roomDb);
        return k;
      };
      const odaiko = drum(2, 0, ["taiko", "kachi"], -9, -16);
      const chuL = drum(-2.5, -0.45, ["taiko", "kachi"], -11, -14);
      const chuR = drum(-2.5, 0.45, ["taiko", "kachi"], -11, -14);
      const shime = drum(-5, 0.18, ["shime", "kachi"], -15, -12);
      const kane = drum(-11, -0.22, ["gankogui"], -14, -14);

      // shinobue: the shakuhachi voice made bright and piercing, less breath, quicker tongue
      const fue = I.shakuhachi(ctx, { volume: -1, cutoff: 5600, base: 1500, octaves: 1.3, breath: -19, breathFreq: 3400, vibrato: 5.8, vibratoDepth: 0.045, attack: 0.035, glide: 0.03, release: 0.22 });
      const shaku = I.shakuhachi(ctx, { volume: -1.5, glide: 0.11, vibratoDepth: 0.08 });
      const strings = I.strings(ctx, { volume: -9, cutoff: 1900, attack: 1.4, release: 2.2 });
      const choir = I.choir(ctx, { volume: -9, vowel: "o", attack: 1.0, release: 2.4 });
      const fp = I.place(ctx, fue, 0.08, out), sp = I.place(ctx, shaku, -0.1, out);
      const stp = I.place(ctx, strings, 0, out), cp = I.place(ctx, choir, 0, out);
      I.send(ctx, fp, hall, -9); I.send(ctx, sp, hall, -7); I.send(ctx, stp, hall, -10); I.send(ctx, cp, hall, -6);

      const hit = (k) => (t, e) => k.hit(e.note, t, e.vel, { pitch: e.pitch });
      const tight = { timing: 0.004, vel: 0.07 };
      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        odaiko: { layer: "drums", play: hit(odaiko), humanize: tight },
        chuL: { layer: "drums", play: hit(chuL), humanize: tight },
        chuR: { layer: "drums", play: hit(chuR), humanize: tight },
        shime: { layer: "drums", play: hit(shime), humanize: { timing: 0.003, vel: 0.06 } },
        kane: { layer: "drums", play: hit(kane), humanize: { timing: 0.004, vel: 0.1 } },
        fue: { layer: "melody", play: pl(fue), humanize: { timing: 0.006, vel: 0.04 } },
        shaku: { layer: "melody", play: pl(shaku), humanize: { timing: 0.012, vel: 0.05 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0, vel: 0 } },
        choir: { layer: "harmony", play: pl(choir), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const L = ROUND.length, round = Math.floor(cycle / L), pos = cycle % L, sec = ROUND[pos];
      if (!state.plan || state.plan.round !== round) state.plan = planRound(r.fork(round + 101), round);
      const P = state.plan, t = P.tonic, scale = sec.mode === "yo" ? YO : IN;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // ---- drum writing helpers ----
      const VOICE = { odaiko: "taiko", chuL: "taiko", chuR: "taiko", shime: "shime", kane: "gankogui" };
      const PITCH = { odaiko: P.pitch.odaiko, chuL: P.pitch.chuL, chuR: P.pitch.chuR, kane: 84 };
      function strike(track, b, ch, dyn = 1) {
        const v = VOICE[track], p = PITCH[track];
        const h = (bb, voice, vel, pitch) => push(track, bb, 0.25, voice, clamp(vel, 0.05, 1), pitch != null ? { pitch } : {});
        const edge = track === "kane" ? p : p != null ? p + P.pitch.edge : null;
        switch (ch) {
          case "X": h(b, v, 1.0 * dyn, p); break;
          case "O": h(b, v, 0.84 * dyn, p); break;
          case "o": h(b, v, 0.62 * dyn, p); break;
          case "x": h(b, v, 0.4 * dyn, edge); break;
          case "k": if (track !== "kane") h(b, "kachi", 0.5 * dyn); break;
          case "K": if (track !== "kane") h(b, "kachi", 0.8 * dyn); break;
          case "r": h(b, v, 0.52 * dyn, p); h(b + 0.125, v, 0.44 * dyn, edge); break;
          case "f": h(b - 0.07, v, 0.36 * dyn, edge); h(b, v, 0.88 * dyn, p); break;
          default: break;
        }
      }
      function line(track, at, pat, dyn = 1, from = 0, to = 99) {
        const s = strip(pat);
        for (let i = 0; i < s.length; i++) if (i >= from && i < to && s[i] !== ".") strike(track, at + i * 0.25, s[i], dyn);
      }
      // the o-daiko in a unison passage: only the strokes that fall on beats
      function odaikoUnison(at, pat, dyn = 1) {
        const s = strip(pat);
        for (let i = 0; i < s.length; i += 4) if (s[i] === "X" || s[i] === "O") strike("odaiko", at + i * 0.25, "X", dyn);
      }
      // a crescendo roll: 16ths (alternating players if two given), from..to beats, velocity v0 -> v1
      function roll(tracks, from, to, v0, v1, step = 0.25) {
        const n = Math.round((to - from) / step);
        for (let i = 0; i < n; i++) {
          const tr = tracks[i % tracks.length], u = n > 1 ? i / (n - 1) : 1;
          push(tr, from + i * step, step, VOICE[tr], clamp(v0 + (v1 - v0) * u, 0.05, 1), PITCH[tr] != null ? { pitch: PITCH[tr] } : {});
        }
      }

      // ---- melody helpers ----
      const fueNote = (d) => { let m = P.fueT + 12 * Math.floor(d / 5) + scale[((d % 5) + 5) % 5]; while (m > 96) m -= 12; return m; };
      const shakuNote = (d) => P.shakuT + 12 * Math.floor(d / 5) + scale[((d % 5) + 5) % 5];
      function melody(track, notes, offset, from, to, toMidi, vel = 0.7) {
        const sorted = notes.slice().sort((a, b) => a.beat - b.beat);
        sorted.forEach((n, i) => {
          const b = n.beat - offset;
          if (n.beat < from || n.beat >= to || (n.grace && n.beat + 0.125 >= to)) return;
          const next = sorted[i + 1];
          const room = next ? next.beat - n.beat : n.dur;
          const dur = n.grace ? 0.12 : Math.max(0.2, Math.min(n.dur, room) - (room <= n.dur ? 0.04 : 0));
          const v = n.grace ? vel * 0.7 : vel * (n.dur >= 2 ? 1.05 : n.dur >= 1 ? 0.95 : 0.85);
          push(track, b, dur, toMidi(n.deg), clamp(v, 0.1, 1));
        });
      }

      // ---- drones ----
      const t3 = 48 + t;
      const droneOpen = [t3, t3 + 7, t3 + 12];
      const droneFull = sec.mode === "yo" ? [t3, t3 + 7, t3 + 12, t3 + 17, t3 + 19] : [t3, t3 + 7, t3 + 12, t3 + 19];
      const choirV = sec.mode === "yo" ? [t3 + 12, t3 + 17, t3 + 19, t3 + 24] : [t3 + 7, t3 + 12, t3 + 19];

      const dyn = { odaiko: 1, chu: 1 };
      let tempo = null;
      let label = sec.label;

      switch (sec.id) {
        case "intro": {
          tempo = { bpm: P.base, rampBeats: 0 };
          // bars 1-2: hand-to-hand rolls from pianissimo, 8ths then 16ths then 32nds
          roll(["chuL", "chuR"], 0, 2, 0.14, 0.26, 0.5);
          roll(["chuL", "chuR"], 2, 6, 0.28, 0.6, 0.25);
          roll(["chuL", "chuR"], 6, 8, 0.6, 0.9, 0.125);
          strike("odaiko", 0, "o", 0.8); strike("odaiko", 4, "O");
          // bar 3: the unison call; bar 4: the shime counts the ensemble in
          const call = P.uni[0];
          ["chuL", "chuR"].forEach((tr) => line(tr, 8, call));
          odaikoUnison(8, call);
          line("shime", 12, JI[P.ji]);
          line("shime", 8, "K... K... K... K...");
          strike("odaiko", 12, "O"); line("chuL", 12, ".... .... .... k.kk"); line("chuR", 12, ".... .... .... k.kk");
          // the fue cries out over the call (hishigi)
          push("fue", 7.875, 0.12, fueNote(P.fueHi + 1), 0.55);
          push("fue", 8, 3.4, fueNote(P.fueHi), 0.85);
          break;
        }
        case "ji": {
          const n = sec.n;
          for (let bar = 0; bar < BARS; bar++) {
            const B = bar * BPB;
            line("shime", B, n === 2 && bar === 3 ? JI.fill : JI[P.ji], 0.9);
            line("odaiko", B, ODA[P.oda][bar % 2], 0.95, n === 0 && bar === 0 ? 1 : 0);
            const chuPat = CHU[P.chu][bar % 2];
            if (n === 2 && bar === 3) { ["chuL", "chuR"].forEach((tr) => line(tr, B, "O.O. O.oo O.O. rrrr")); continue; }
            line("chuL", B, chuPat);
            if (n > 0 || bar >= 2) line("chuR", B, chuPat, n === 0 ? 0.8 : 0.95);
            if (n > 0) line("kane", B, KANE.chanchiki, n === 1 && bar < 2 ? 0.6 : 0.8);
          }
          if (n === 1) melody("fue", P.fueA, 0, 0, 16, fueNote, 0.72);
          if (n === 2) melody("fue", P.fueB, 0, 0, 16, fueNote, 0.76);
          if (n === 0) strike("odaiko", 0, "X");
          break;
        }
        case "kake": {
          const n = sec.n, calls = P.calls;
          for (let bar = 0; bar < BARS; bar++) line("shime", bar * BPB, n === 1 && bar === 3 ? JI.kizami : JI.ten, 0.55);
          if (n === 0) {
            for (let k = 0; k < 2; k++) {
              const call = calls[k], B = k * 8;
              line("chuL", B, call, 0.95);
              const ans = r.chance(0.4) ? call : r.chance(0.6) ? strip(call).slice(0, 12) + r.pick(CADENCES) : calls[k + 2];
              line("chuR", B + 4, ans, 0.95);
              strike("odaiko", B, "O"); strike("odaiko", B + 7, r.pick(["O", "o"])); if (r.chance(0.5)) strike("odaiko", B + 7.5, "O");
              line("kane", B, KANE.quarters, 0.45); line("kane", B + 4, KANE.quarters, 0.45);
            }
          } else {
            // half-bar trades, then one beat each, then unison
            const halves = [calls[4], calls[5]].map((c) => strip(c));
            line("chuL", 0, halves[0].slice(0, 8)); line("chuR", 2, halves[0].slice(0, 8));
            line("chuL", 4, halves[1].slice(0, 8)); line("chuR", 6, halves[1].slice(8, 16));
            const beats = [r.pick(SOLO_LO), r.pick(SOLO_HI), r.pick(SOLO_LO), r.pick(SOLO_HI)];
            beats.forEach((c, i) => line(i % 2 ? "chuR" : "chuL", 8 + i, c));
            strike("odaiko", 0, "O"); strike("odaiko", 4, "O"); strike("odaiko", 8, "O"); strike("odaiko", 10, "O");
            const u = P.uni[1];
            ["chuL", "chuR"].forEach((tr) => line(tr, 12, u)); odaikoUnison(12, u); line("kane", 12, KANE.chanchiki, 0.8);
          }
          break;
        }
        case "uta": {
          const n = sec.n;
          for (let bar = 0; bar < BARS; bar++) {
            const B = bar * BPB;
            line("shime", B, JI.quiet, n === 0 ? 0.5 : 0.6);
            line("odaiko", B, "O..o .... .... ....", n === 0 ? 0.55 : 0.65); // the heartbeat
            if (n === 1 && bar < 3) { line("chuL", B, ".... o.xx .... o.xx", 0.45); line("chuR", B, "o.xx .... o.xx ....", 0.45); }
          }
          if (n === 1) { roll(["chuL", "chuR"], 12, 15, 0.3, 0.85); ["chuL", "chuR"].forEach((tr) => strike(tr, 15, "X")); strike("odaiko", 15, "X"); line("shime", 12, JI.fill, 0.7); }
          melody("shaku", P.uta, n * CYC, n * CYC, n * CYC + CYC, shakuNote, 0.7);
          push("choir", 0, CYC - 0.5, choirV, n === 0 ? 0.4 : 0.48);
          if (n === 1) push("strings", 0, CYC - 1, droneOpen, 0.32);
          break;
        }
        case "solo": {
          const n = sec.n, who = P.soloist;
          label = `Solo · ${SOLO_NAME[who]}${n ? " · rolls" : ""}`;
          for (let bar = 0; bar < BARS; bar++) {
            const B = bar * BPB, k = n * 4 + bar;
            const last = n === 1 && bar === 3;
            if (!last) {
              line("shime", B, JI.doko, 0.65);
              line(who, B, P.solo[k], 0.95);
              if (who !== "odaiko") line("odaiko", B, ODA.A[bar % 2], 0.6);
              else { line("chuL", B, "o... .... o... ....", 0.5); line("chuR", B, ".... o... .... o...", 0.5); }
              if (n === 1) line("kane", B, KANE.chanchiki, 0.55);
            } else {
              line(who, B, "rrrr rrrr .... ....", 1);
              ["odaiko", "chuL", "chuR"].forEach((tr) => line(tr, B, ".... .... X... X..."));
              line("shime", B, "oxox OxOx X... X...", 0.8);
            }
          }
          break;
        }
        case "haya": {
          const n = sec.n;
          tempo = { bpm: P.base + sec.up, rampBeats: CYC };
          for (let bar = 0; bar < BARS; bar++) {
            const B = bar * BPB, last = n === 2 && bar === 3;
            line("shime", B, n === 0 ? JI.doko : JI.kizami, 0.7 + 0.08 * n);
            line("kane", B, n === 0 ? KANE.chanchiki : KANE.haya, 0.7 + 0.05 * n);
            if (last) {
              roll(["chuL", "chuR"], B, B + 4, 0.45, 1, 0.125);
              line("odaiko", B, "O... O... O.O. OOOO");
              continue;
            }
            line("odaiko", B, n === 0 ? ODA[P.oda][bar % 2] : ODA.drive[bar % 2]);
            if (n === 0) { line("chuL", B, SYNC[bar % 2]); line("chuR", B, SYNC[bar % 2], 0.9); }
            else if (n === 1) { line("chuL", B, SYNC[bar % 2]); line("chuR", B, "O.o. O.o. O.o. O.o.", 0.8); }
            else { const p = bar % 2 ? "O.oo O.oo OOOO rrrr" : "O.oo O.oo O.oo O.oo"; line("chuL", B, p); line("chuR", B, p, 0.95); }
          }
          // the fue's in-scale riff, rising
          const riff = P.riff;
          const riffBar = (B, shift, v) => RIFF_CELL.forEach(([o, d], i) => push("fue", B + o, d * 0.92, fueNote(riff[i] + shift), v * (i === 0 || i === 2 || i === 5 ? 1 : 0.85)));
          if (n === 0) { riffBar(0, 0, 0.66); riffBar(4, 0, 0.68); riffBar(8, 0, 0.7); push("fue", 12, 1.5, fueNote(riff[0]), 0.72); push("fue", 13.5, 0.5, fueNote(riff[1]), 0.6); push("fue", 14, 1.9, fueNote(riff[0]), 0.72); }
          if (n === 1) { riffBar(0, 2, 0.72); riffBar(4, 2, 0.74); riffBar(8, 0, 0.72); riffBar(12, 2, 0.76); }
          if (n === 2) [5, 6, 7, 8].forEach((d, i) => { push("fue", i * 4 - 0.125, 0.12, fueNote(d + 1), 0.55); push("fue", i * 4, 3.7, fueNote(d), 0.74 + i * 0.05); });
          push("strings", 0, CYC - 0.25, n === 2 ? droneFull : droneOpen, 0.36 + 0.12 * n);
          if (n === 2) push("choir", 0, CYC - 0.25, choirV, 0.5);
          break;
        }
        case "uni": {
          const n = sec.n;
          const pats = n === 0 ? [P.uni[2], P.uni[3], P.uni[4], P.uni[5]] : [P.uni[6], P.uni[2]];
          pats.forEach((u, bar) => {
            const B = bar * BPB;
            ["chuL", "chuR", "shime"].forEach((tr) => line(tr, B, u));
            odaikoUnison(B, u);
            line("kane", B, KANE.chanchiki, 0.9);
          });
          if (n === 0) {
            melody("fue", P.climax, 0, 0, 16, (d) => fueNote(d), 0.82);
            push("strings", 0, CYC - 0.25, droneFull, 0.62);
            push("choir", 0, CYC - 0.25, choirV, 0.62);
          } else {
            // two bars more, then a single stroke from everyone and silence (ma)
            melody("fue", P.climax, 0, 0, 8, (d) => fueNote(d), 0.86);
            push("strings", 0, 8, droneFull, 0.68);
            push("choir", 0, 8, choirV, 0.68);
            ["odaiko", "chuL", "chuR", "shime"].forEach((tr) => strike(tr, 8, "X"));
            push("kane", 8, 0.25, "gankogui", 1, { pitch: 84 });
            push("fue", 7.875, 0.12, fueNote(P.fueHi + 1), 0.6);
            push("fue", 8, 0.6, fueNote(P.fueHi), 0.9);
            push("strings", 8, 0.6, droneFull, 0.8);
            push("choir", 8, 0.6, choirV, 0.8);
          }
          break;
        }
        case "fin": {
          const n = sec.n;
          if (n === 0) {
            tempo = { bpm: P.base + 4, rampBeats: 0 };
            // the o-daiko alone, strokes drawing closer and closer
            const at = [0, 3, 5.5, 7.5, 9, 10.25, 11.25, 12, 12.75, 13.25, 13.75, 14.25, 14.5, 14.75, 15, 15.25, 15.5, 15.75];
            at.forEach((b, i) => strike("odaiko", b, "o", 0.55 + 0.45 * (i / (at.length - 1))));
            roll(["chuL", "chuR"], 8, 12, 0.18, 0.5, 0.25);
            roll(["chuL", "chuR"], 12, 16, 0.5, 0.95, 0.125);
            roll(["shime"], 12, 16, 0.35, 0.9, 0.25);
            line("shime", 0, "K... .... K... ....", 0.6); line("shime", 4, "K... .... K.K. K.K.", 0.7);
            push("fue", 3.875, 0.12, fueNote(6), 0.5);
            push("fue", 4, 7.8, fueNote(5), 0.7);
            push("fue", 11.875, 0.12, fueNote(P.fueHi + 1), 0.6);
            push("fue", 12, 3.9, fueNote(P.fueHi), 0.85);
            push("strings", 8, 8, droneOpen, 0.55);
          } else {
            tempo = { bpm: P.base + 34, rampBeats: CYC };
            const pats = [P.uni[0], P.uni[5], "XxXx XxXx XXXX XXXX"];
            pats.forEach((u, bar) => {
              const B = bar * BPB, d = 0.85 + 0.08 * bar;
              ["chuL", "chuR", "shime"].forEach((tr) => line(tr, B, u, d));
              odaikoUnison(B, u, d);
              line("kane", B, KANE.haya, 0.85 + 0.05 * bar);
            });
            ["odaiko", "chuL", "chuR", "shime"].forEach((tr) => strike(tr, 12, "X"));
            push("kane", 12, 0.25, "gankogui", 1, { pitch: 84 });
            melody("fue", P.climax, 0, 0, 8, (d) => fueNote(d), 0.86);
            push("fue", 7.875, 0.12, fueNote(P.fueHi), 0.6);
            push("fue", 8, 3.9, fueNote(P.fueHi - 1), 0.9);
            push("fue", 12, 1.2, fueNote(P.fueHi), 0.95);
            push("strings", 0, 11.9, droneFull, 0.66);
            push("choir", 0, 11.9, choirV, 0.66);
            push("strings", 12, 1.5, droneFull, 0.85);
            push("choir", 12, 1.5, choirV, 0.85);
          }
          break;
        }
        default: break;
      }

      const chord = sec.mode === "yo" ? `${NM[t]}sus4` : `${NM[(t + 1) % 12]}maj7#11/${NM[t]}`;
      const res = { events: ev, harmony: [{ bar: 0, beat: 0, dur: CYC, chord }], section: `${label} · ${NM[t]} ${sec.mode}`, state };
      if (tempo) res.tempo = tempo;
      return res;
    },
  });
})();

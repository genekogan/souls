// Traffic Grid: rush hour seen from above. Aleatoric pulse minimalism in the manner of Terry Riley's
// "In C" (the method, not the notes): forty-three short original modules, eight players, one shared
// high pulse.
//
// Players: flute, oboe, clarinet, vibes, marimba, piano, pizzicato and glockenspiel. Each one repeats
// its current module as many times as it likes, then moves on. It may enter on any eighth, breathe
// between repetitions (which knocks it out of step with the others), rest, or come back a module or two
// further on. Nobody runs more than three modules ahead of the slowest player.
//
// Harmony: the modules drift through eight "fields", one pitch at a time:
//   Cmaj9 -> (F#) Cmaj7#11 -> Am11 -> (Bb) D9b13 -> (F) Gm11 -> (Eb) Cm11 -> (E) Fmaj9 -> (B) C6/9
// Each field opens with a module that holds the new pitch and steps off it (F#-G, Bb-A, F-D, Eb-D,
// E-F, B-C), and each ends with "buffer" modules that avoid the pitch about to change. A player may only
// start a module if the pitch content of every module sounding at that moment still fits one common
// field, so mismatched modules never collide. The current field (the harmony shown and linted) follows
// the median player, and a dark low pad holds its root.
//
// Form: one "pass" is a day of traffic (about ten to twelve minutes). The pulse starts alone, players
// enter one by one, the ensemble breathes on two slow waves (loudness, and how many players rest),
// everyone gathers on the last module, swells, and drops out one by one. The pulse then moves to a new
// tonic and the next pass begins there (C, A, F, D, G, Bb, E).
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4, EPB = 8, CB = 4, EC = EPB * CB; // beats per bar, eighths per bar, bars per cycle, eighths per cycle
  const SPREAD = 3;

  // ---------- fields (in C; transposed per pass) ----------
  const FIELDS = [
    { root: 0, q: "maj9", drone: 36, name: "Morning grid" },
    { root: 0, q: "maj7#11", drone: 36, name: "Green wave" },
    { root: 9, q: "m11", drone: 33, name: "Ring road" },
    { root: 2, q: "9b13", drone: 38, name: "Merge lane" },
    { root: 7, q: "m11", drone: 43, name: "Overpass" },
    { root: 0, q: "m11", drone: 36, name: "Underpass" },
    { root: 5, q: "maj9", drone: 41, name: "Off-ramp" },
    { root: 0, q: "69", drone: 36, name: "Home" },
  ];
  const SPELL = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const symOf = (f, key) => SPELL[(FIELDS[f].root + key) % 12] + FIELDS[f].q;
  const KEYS = [0, 9, 5, 2, 7, 10, 4]; // pass tonics: C A F D G Bb E
  const shiftOf = (key) => ((key + 6) % 12) - 6; // transpose by the nearest way: -6..+5
  const pulseTop = (key) => 88 + ((key - 4 + 12) % 12); // tonic in E6..Eb7, doubled an octave below

  // ---------- modules: [home field, "note:eighths ..."] (r = rest; default length one eighth) ----------
  const MODS = [
    // Morning grid (Cmaj9)
    [0, "G5:2 E5:4"],
    [0, "D5 E5 G5:3"],
    [0, "r C6 B5 G5"],
    [0, "F5:2 E5 D5:3 r:2"],
    [0, "E5:0.5 G5:2.5 A5 G5 r:2"],
    [0, "B4 C5 D5 E5 C5 D5 E5 G5 A5:3 r"],
    [0, "A5:2 G5 E5 D5:2 E5:2 r"],
    // Green wave (Cmaj7#11): F# arrives
    [1, "F#5:6 G5:2"],
    [1, "D5 E5 F#5:3"],
    [1, "B4:2 D5 F#5:2 A5:4"],
    [1, "G5 F#5 r:2 G5 F#5 E5:2 r:2"],
    [1, "C6:3 B5 A5 F#5:3"],
    // Ring road (Am11): same pitches, the bass moves to A
    [2, "E5:2 B5:2 A5 r"],
    [2, "A4:2 C5 E5 F#5:4 r"],
    [2, "E5 G5 A5"],
    [2, "B5 A5 G5 E5:2 r:2"],
    [2, "A4 B4 C5 r A4 B4 E5 r"],
    [2, "A5 G5 F#5 E5:2 D5:3 r"],
    // Merge lane (D9b13): Bb arrives
    [3, "Bb5:6 A5:2"],
    [3, "D5 F#5 A5 r Bb5:2 A5:2"],
    [3, "C5 D5 E5 F#5 Bb5:2 r"],
    [3, "A5 G5 r F#5 E5 r"],
    [3, "D5 r"],
    [3, "Bb4 C5 D5:2 G5:2 r:2"],
    // Overpass (Gm11): F returns
    [4, "F5:2 D5 Bb4:3 r:2"],
    [4, "G4 Bb4 D5 F5 A5:4 r"],
    [4, "E5 F5 G5 F5 E5:2"],
    [4, "C5:3 Bb4 A4:2 G4:2"],
    [4, "D5 F5 G5:2 r"],
    // Underpass (Cm11): Eb arrives
    [5, "Eb5:6 D5:2"],
    [5, "C5 Eb5 G5 Bb5:2 A5 r:2"],
    [5, "G5 F5 Eb5 F5 r:2"],
    [5, "Bb4 C5 r Eb5:3 r:3"],
    [5, "A4 C5 F5:3 G5 r"],
    // Off-ramp (Fmaj9): E returns
    [6, "E5:6 F5:2"],
    [6, "F4 A4 C5 E5 G5:4 r:2"],
    [6, "D5 C5 Bb4 C5 D5:2 r:2"],
    [6, "G5 A5 C6:2 A5 r"],
    [6, "A5 G5 E5 D5 C5:3 r"],
    // Home (C6/9): B returns
    [7, "B4:6 C5:2"],
    [7, "E5 D5 C5 D5 E5 G5 A5:2 r:2"],
    [7, "G4:2 C5:2 D5:2 E5:4"],
    [7, "E5:2 D5 G5:3"],
  ].map(([home, src], i) => {
    const notes = [];
    let at = 0;
    for (const tok of src.trim().split(/\s+/)) {
      const [nm, d] = tok.split(":");
      const len = d ? Number(d) : 1;
      if (nm !== "r") notes.push({ at, len, m: T.midi(nm) });
      at += len;
    }
    if (at !== Math.round(at)) throw new Error(`traffic-grid: module ${i + 1} is not a whole number of eighths`);
    const ms = notes.map((n) => n.m);
    return { i, home, notes, len: at, pcs: [...new Set(ms.map(T.mod12))], lo: Math.min(...ms), hi: Math.max(...ms) };
  });
  const LAST = MODS.length - 1;
  // Fields each module fits (home field and its neighbours), made monotone so that ranges only move forward.
  (function () {
    const fits = (m, f) => { const sc = new Set(T.chord(symOf(f, 0)).scale); return m.pcs.every((p) => sc.has(p)); };
    MODS.forEach((m) => {
      if (!fits(m, m.home)) throw new Error(`traffic-grid: module ${m.i + 1} does not fit its field`);
      m.flo = m.home; m.fhi = m.home;
      if (m.home > 0 && fits(m, m.home - 1)) m.flo = m.home - 1;
      if (m.home < FIELDS.length - 1 && fits(m, m.home + 1)) m.fhi = m.home + 1;
    });
    for (let i = 1; i < MODS.length; i++) MODS[i].flo = Math.max(MODS[i].flo, MODS[i - 1].flo);
    for (let i = MODS.length - 2; i >= 0; i--) MODS[i].fhi = Math.min(MODS[i].fhi, MODS[i + 1].fhi);
    MODS.forEach((m, i) => {
      if (m.flo > m.fhi || (i > 0 && m.flo > MODS[i - 1].fhi)) throw new Error(`traffic-grid: module ${i + 1} breaks the field chain`);
    });
  })();

  // ---------- players ----------
  // offs: octave transpositions in order of preference; lo/hi: comfortable range; rest: tendency to rest.
  const PLAYERS = [
    { id: "marimba", offs: [-12, 0], lo: 50, hi: 79, vel: 0.62, art: 0.9, early: true, rest: 0.9 },
    { id: "piano", offs: [-24, -12], lo: 48, hi: 67, vel: 0.56, art: 0.95, early: true, rest: 1 },
    { id: "clarinet", offs: [-12, 0], lo: 52, hi: 79, vel: 0.6, art: 0.92, wind: true, early: true, rest: 1.1 },
    { id: "oboe", offs: [0, 12], lo: 62, hi: 86, vel: 0.56, art: 0.9, wind: true, early: true, rest: 1.2 },
    { id: "vibes", offs: [0, -12], lo: 58, hi: 86, vel: 0.5, art: 0.95, rest: 1 },
    { id: "flute", offs: [12, 0], lo: 72, hi: 96, vel: 0.56, art: 0.9, wind: true, rest: 1.2 },
    { id: "pizz", offs: [-24, -12], lo: 45, hi: 64, vel: 0.62, art: 0.5, rest: 1.1 },
    { id: "glock", offs: [12, 24], lo: 76, hi: 100, vel: 0.36, art: 0.6, rest: 2 },
  ];
  const NP = PLAYERS.length;

  // ---------- slow curves (absolute eighths) ----------
  const TAU = Math.PI * 2;
  const loud = (e) => 0.86 + 0.09 * Math.sin((TAU * e) / 1180) + 0.05 * Math.sin((TAU * e) / 410 + 1.3);
  const density = (e) => 0.5 + 0.5 * Math.sin((TAU * e) / 1560 + 2.1); // 1 = everyone playing, 0 = sparse

  function chooseOff(P, mod, shift, r, prev) {
    const viol = (o) => Math.max(0, P.lo - (mod.lo + shift + o)) + Math.max(0, mod.hi + shift + o - P.hi);
    const ok = P.offs.filter((o) => viol(o) === 0);
    if (ok.length > 1 && prev != null && ok.includes(prev) && r.chance(0.8)) return prev; // stay in the same octave
    if (ok.length > 1 && r.chance(0.12)) return ok[1];
    if (ok.length) return ok[0];
    return P.offs.slice().sort((a, b) => viol(a) - viol(b))[0];
  }

  function newPlayers(r) {
    return PLAYERS.map((P, i) => ({
      i, t: Infinity, entered: false, done: true, mod: 0, reps: 0, target: 0, off: P.offs[0], seg: null, segs: [], pending: [],
      speed: r.range(0.82, 1.22), wavePer: r.range(180, 420), wavePh: r.range(0, TAU), lag: P.wind ? r.range(0, 0.012) : r.range(0, 0.004),
      resting: false, fresh: 0, dropAt: null,
    }));
  }

  function startPass(S, at, r) {
    S.pass = (S.pass ?? -1) + 1;
    S.key = KEYS[S.pass % KEYS.length];
    S.passStart = at; S.gatherT = null; S.nextPassAt = null; S.lastDrop = null;
    S.keyLine.push({ at, key: S.key, pass: S.pass });
    const early = r.shuffle(PLAYERS.filter((P) => P.early).map((P) => PLAYERS.indexOf(P)));
    const late = r.shuffle(PLAYERS.filter((P) => !P.early).map((P) => PLAYERS.indexOf(P)));
    let t = at + 16; // the pulse alone for two bars
    [...early, ...late].forEach((i) => {
      Object.assign(S.players[i], { t, entered: false, done: false, mod: 0, reps: 0, target: 0, seg: null, resting: false, fresh: 0, dropAt: null });
      t += r.int(4, 10) * 2;
    });
  }

  Sim.register({
    id: "traffic-grid",
    title: "Traffic Grid",
    genre: "Minimalism",
    about: "Rush hour from above, after Riley's In C: eight players work through forty-three short modules at their own pace over a high eighth-note pulse, drifting from C major through lydian, dorian and mixolydian fields and home, then starting a new day in a new key.",
    bpm: 82, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 9.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.01, lowcut: 300, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.03, lowcut: 320, highcut: 6500 });
      const inst = {
        marimba: I.marimba(ctx, { volume: -8, decay: 0.6, hardness: 1.2, cutoff: 3800 }),
        piano: I.softPiano(ctx, { volume: -8, decay: 1.6, release: 0.5, cutoff: 2400 }),
        clarinet: I.clarinet(ctx, { volume: -8, attack: 0.05, release: 0.16, vibratoDepth: 0.01 }),
        oboe: I.oboe(ctx, { volume: -10, attack: 0.05, release: 0.16, vibratoDepth: 0.025, cutoff: 3000 }),
        vibes: I.vibes(ctx, { volume: -10, decay: 1.6, release: 0.8, motor: 4.6, motorDepth: 0.16 }),
        flute: I.flute(ctx, { volume: -9, attack: 0.05, release: 0.2, vibratoDepth: 0.04, breath: -24 }),
        pizz: I.pizz(ctx, { volume: -5, decay: 0.3, cutoff: 1900 }),
        glock: I.glock(ctx, { volume: -15, decay: 1.2 }),
      };
      const pulse = I.softPiano(ctx, { volume: -12, decay: 0.45, release: 0.18, cutoff: 3400 });
      const drone = I.pad(ctx, { volume: -14, attack: 2.2, release: 3, cutoff: 520, breath: 0.05, detune: 14 });
      const PAN = { marimba: -0.5, piano: 0.15, clarinet: -0.25, oboe: 0.35, vibes: 0.55, flute: -0.4, pizz: 0.25, glock: -0.1 };
      const SEND = { marimba: [room, -12], piano: [hall, -14], clarinet: [hall, -11], oboe: [hall, -11], vibes: [hall, -13], flute: [hall, -10], pizz: [room, -12], glock: [hall, -10] };
      for (const [k, v] of Object.entries(inst)) { const p = I.place(ctx, v, PAN[k], out); I.send(ctx, p, SEND[k][0], SEND[k][1]); }
      const pp = I.place(ctx, pulse, 0.05, out); I.send(ctx, pp, room, -16); I.send(ctx, pp, hall, -22);
      const dp = I.place(ctx, drone, 0, out); I.send(ctx, dp, hall, -12);
      const wind = { timing: 0.018, vel: 0.08 }, mallet = { timing: 0.007, vel: 0.06 };
      const play = (x) => (t, e, d) => x.play(t, e.note, d, e.vel);
      return {
        flute: { layer: "melody", play: play(inst.flute), humanize: wind },
        oboe: { layer: "melody", play: play(inst.oboe), humanize: wind },
        clarinet: { layer: "melody", play: play(inst.clarinet), humanize: wind },
        vibes: { layer: "harmony", play: play(inst.vibes), humanize: mallet },
        marimba: { layer: "harmony", play: play(inst.marimba), humanize: mallet },
        piano: { layer: "harmony", play: play(inst.piano), humanize: mallet },
        glock: { layer: "texture", play: play(inst.glock), humanize: mallet },
        pizz: { layer: "bass", play: play(inst.pizz), humanize: { timing: 0.01, vel: 0.08 } },
        drone: { layer: "bass", play: play(drone), humanize: { timing: 0, vel: 0.02 } },
        pulse: { layer: "texture", play: play(pulse), humanize: { timing: 0.002, vel: 0.03 } },
      };
    },

    compose({ cycle, rng: r, state: S }) {
      const W0 = cycle * EC, W1 = W0 + EC;
      if (!S.players) { S.players = newPlayers(r.fork(99)); S.keyLine = []; S.lab = null; S.drone = null; startPass(S, 0, r); }
      const PS = S.players;
      PS.forEach((p) => { p.segs = p.segs.filter((s) => s.end > W0); });

      // ---- the ensemble, decision by decision in time order ----
      const sounding = (p, t) => PS.filter((q) => q !== p && q.seg && q.seg.mod != null && q.seg.end > t).map((q) => MODS[q.seg.mod]);
      const trailOf = () => Math.min(...PS.filter((q) => !q.done).map((q) => q.mod));
      const restingCount = () => PS.filter((q) => !q.done && (q.resting || !q.entered)).length;
      const setSeg = (p, start, end, mod) => { p.seg = { start, end, mod }; p.segs.push(p.seg); p.t = end; };

      function startModule(p, j, t) {
        const P = PLAYERS[p.i], m = MODS[j];
        const trail = trailOf(), lead = Math.max(...PS.filter((q) => !q.done).map((q) => q.mod));
        p.off = chooseOff(P, m, shiftOf(S.key), r, p.off);
        p.mod = j; p.reps = 0;
        let dwell = r.range(16, 40) * p.speed;
        if (j <= trail && lead - j >= 2) dwell *= 0.55; // stragglers hurry
        else if (j - trail >= 2) dwell *= 1.35;           // the front of the pack idles
        p.target = j === LAST ? Infinity : Math.max(2, Math.round(dwell / m.len));
      }

      function playIteration(p, t) {
        const P = PLAYERS[p.i], m = MODS[p.mod], shift = shiftOf(S.key);
        const ramp = [0.6, 0.75, 0.88][p.fresh] ?? 1;
        p.fresh++;
        const wave = (e) => 0.84 + 0.16 * Math.sin((TAU * e) / p.wavePer + p.wavePh); // each player leans in and out
        m.notes.forEach((n, k) => {
          const e = t + n.at;
          let v = P.vel * loud(e) * wave(e) * ramp * coda(e);
          if (k === 0) v *= 1.08;
          if (n.len >= 3) v *= 1.04;
          if (e % 2 === 1) v *= 0.95;
          p.pending.push({ e, note: n.m + shift + p.off, len: n.len, vel: v });
        });
        p.reps++;
        let end = t + m.len;
        if (p.mod !== LAST && r.chance(P.wind ? 0.16 : 0.07)) end += 1; // a breath: this player slips an eighth
        setSeg(p, t, end, p.mod);
      }

      function coda(e) {
        if (S.gatherT == null || e < S.gatherT) return 1;
        const u = e - S.gatherT;
        const swell = u < 96 ? 1 + 0.22 * Math.sin((Math.PI * u) / 96) : 1;
        const fade = S.lastDrop ? Math.max(0.55, 1 - 0.45 * Math.max(0, u - 64) / Math.max(1, S.lastDrop - S.gatherT - 64)) : 1;
        return swell * fade;
      }

      function rest(p, t, len) { p.resting = true; p.fresh = 0; setSeg(p, t, t + len, null); }

      function decide(p, t) {
        if (p.dropAt != null && t >= p.dropAt) {
          p.done = true; p.seg = null; p.t = Infinity;
          if (PS.every((q) => q.done)) S.nextPassAt = Math.ceil((t + 20) / EPB) * EPB;
          return;
        }
        const others = sounding(p, t);
        const L = Math.max(-1, ...others.map((m) => m.flo)), H = Math.min(99, ...others.map((m) => m.fhi));
        const fitsNow = (j) => j >= 0 && j <= LAST && Math.max(L, MODS[j].flo) <= Math.min(H, MODS[j].fhi);
        const trail = trailOf();
        const wasResting = p.resting;
        p.resting = false;
        if (!p.entered) { p.entered = true; p.fresh = 0; startModule(p, 0, t); playIteration(p, t); return; }
        const finished = p.reps >= p.target;
        // rest now and then (never in the last stretch)
        if (!wasResting && p.mod < LAST - 2 && S.gatherT == null) {
          const d = density(t), cap = d < 0.3 ? 4 : d < 0.6 ? 3 : d < 0.85 ? 2 : 1;
          const pr = (finished ? 0.08 + 0.5 * (1 - d) ** 1.3 : 0.015) * PLAYERS[p.i].rest;
          if (restingCount() < cap && r.chance(pr)) { rest(p, t, (r.int(2, 5) + Math.round(8 * (1 - d))) * 4); return; }
        }
        const cands = finished || wasResting ? [p.mod + 1, p.mod] : [p.mod, p.mod + 1];
        if (wasResting) for (let j = p.mod + 2; j <= trail + SPREAD; j++) cands.push(j); // come back further on
        const j = cands.find((x) => fitsNow(x) && (x <= p.mod || x - trail <= SPREAD));
        if (j == null) { rest(p, t, 4); return; }
        if (j === LAST && p.mod === LAST && r.chance(0.08)) p.off = chooseOff(PLAYERS[p.i], MODS[LAST], shiftOf(S.key), r, null); // octave changes on the last module
        if (j !== p.mod) {
          startModule(p, j, t);
          const gap = r.weighted([[0, 3], [1, 3], [2, 2], [3, 1]]); // a moment's listening before the new module
          if (gap) { setSeg(p, t, t + gap, j); t += gap; }
        }
        playIteration(p, t);
        // everyone on the last module: gather, swell, and leave one by one
        if (S.gatherT == null && PS.every((q) => q.entered && !q.done && q.mod === LAST && !q.resting)) {
          S.gatherT = t;
          let d = t + 40;
          r.shuffle(PS.map((q) => q.i)).forEach((i) => { d += r.int(5, 12) * 2; PS[i].dropAt = d; });
          S.lastDrop = d;
        }
      }

      for (let guard = 0; guard < 4000; guard++) {
        if (S.nextPassAt != null && S.nextPassAt < W1 && PS.every((q) => q.done)) startPass(S, S.nextPassAt, r);
        let p = null;
        for (const q of PS) if (!q.done && (p == null || q.t < p.t)) p = q;
        if (!p || p.t >= W1) break;
        decide(p, p.t);
      }

      // ---- events ----
      const ev = [];
      const push = (track, e, durE, note, vel, delay = 0) => {
        const b = (e - W0) / 2, bar = Math.floor(b / BPB + 1e-9);
        ev.push({ track, bar, beat: b - bar * BPB, dur: Math.max(0.1, durE / 2), note, vel: Math.max(0.05, Math.min(1, vel)), ...(delay ? { delay } : {}) });
      };
      PS.forEach((p) => {
        const P = PLAYERS[p.i];
        p.pending.filter((n) => n.e < W1).forEach((n) => push(P.id, n.e, P.id === "pizz" ? Math.min(n.len, 0.7) : n.len * P.art, n.note, n.vel, p.lag));
        p.pending = p.pending.filter((n) => n.e >= W1);
      });

      // ---- the field, eighth by eighth ----
      S.keyLine = S.keyLine.filter((k, i, a) => i === a.length - 1 || a[i + 1].at > W0);
      const keyAt = (e) => { let k = S.keyLine[0]; for (const x of S.keyLine) if (x.at <= e) k = x; return k; };
      const harmony = [], fieldAt = [], countAt = [];
      for (let e = W0; e < W1; e++) {
        const K = keyAt(e);
        if (!S.lab || S.lab.pass !== K.pass) S.lab = { pass: K.pass, key: K.key, f: 0, since: e };
        const mods = [];
        PS.forEach((p) => { const s = p.segs.find((x) => x.start <= e && x.end > e && x.mod != null); if (s) mods.push(MODS[s.mod]); });
        if (mods.length) {
          const lo = Math.max(...mods.map((m) => m.flo)), hi = Math.min(...mods.map((m) => m.fhi));
          const idx = mods.map((m) => m.i).sort((a, b) => a - b);
          const target = MODS[idx[Math.floor((idx.length - 1) / 2)]].home;
          const L = S.lab;
          if (L.f < lo || L.f > hi) { L.f = Math.max(lo, Math.min(hi, target)); L.since = e; }
          else if (target > L.f && target <= hi && e % 2 === 0 && e - L.since >= 8) { L.f = target; L.since = e; }
        }
        fieldAt.push(S.lab.f); countAt.push(mods.length);
        const sym = symOf(S.lab.f, S.lab.key), last = harmony[harmony.length - 1];
        if (last && last.chord === sym) last.durE++;
        else harmony.push({ e, durE: 1, chord: sym, f: S.lab.f, key: S.lab.key });
      }

      // ---- pulse: the tonic in octaves on every eighth ----
      for (let e = W0; e < W1; e++) {
        const top = pulseTop(keyAt(e).key);
        push("pulse", e, 0.8, [top - 12, top], (0.4 + (e % 2 === 0 ? 0.03 : 0)) * loud(e) * (0.94 + 0.06 * Math.sin((TAU * e) / 64)));
      }

      // ---- drone: a dark low pad on the field's root, renewed every four bars ----
      const D = (S.drone ||= { on: false });
      let open = null;
      const close = (e) => { if (open) { push("drone", open.e, e - open.e - 0.4, open.note, open.vel); open = null; } };
      for (let e = W0; e < W1; e++) {
        const i = e - W0, n = countAt[i];
        if (!D.on && n >= 3) D.on = true; else if (D.on && n <= 1) D.on = false;
        const h = harmony.find((x) => x.e <= e && x.e + x.durE > e);
        const root = 33 + ((FIELDS[h.f].drone - 33 + shiftOf(h.key) + 24) % 12);
        const note = root;
        const changed = open && open.note !== root;
        if (!D.on) { close(e); continue; }
        if (!open || changed || (e % EC === 0 && e - open.e >= 8)) { close(e); open = { e, note, vel: 0.42 * loud(e) * coda(e) }; }
      }
      close(W1);

      // ---- label ----
      const f0 = fieldAt[0], k0 = harmony[0].key, act = PS.filter((p) => p.entered && !p.done && !p.resting);
      const lo = act.length ? Math.min(...act.map((p) => p.mod)) + 1 : 0, hi = act.length ? Math.max(...act.map((p) => p.mod)) + 1 : 0;
      let what;
      if (!act.length) what = "the pulse alone";
      else if (S.gatherT != null && S.gatherT <= W1) what = PS.some((p) => p.done) ? "dispersing" : "everyone on the last module";
      else what = `module${lo === hi ? " " + lo : "s " + lo + "–" + hi} · ${act.length} playing`;
      const section = `Day ${keyAt(W0).pass + 1} in ${SPELL[k0]} · ${FIELDS[f0].name} · ${what}`;

      return {
        events: ev,
        harmony: harmony.map((h) => { const b = (h.e - W0) / 2, bar = Math.floor(b / BPB + 1e-9); return { bar, beat: b - bar * BPB, dur: h.durE / 2, chord: h.chord }; }),
        section, state: S,
      };
    },
  });
})();

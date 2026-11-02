// Creature Lab: a pastoral 12/8 in D mixolydian for little beings taking their first steps.
//
// Meter: 12/8 written in quarter-note beats (beatsPerBar 6, bpm 156), so the dotted-quarter pulse
// (0, 1.5, 3, 4.5) runs at 104 and every eighth is 0.5. Writing in quarters makes hemiola native:
// anything on whole beats (0..5) is "3/4 inside 6/8".
//
// The two kalimbas interlock mbira-style: kalimba A plays only on the beat (quarter grid), kalimba B
// only on the off-eighths. Each part alone is a 3/4 hemiola; together they fill the 6/8 eighth grid,
// with each part accenting the dotted-quarter pulses that fall in its own grid. Patterns are written
// as steps through each chord's "kalimba keys" from a voice-led anchor, so they follow the harmony
// the way an mbira player shifts a pattern through a chord cycle.
//
// Form (one round = 14 cycles of 8 bars, about 4.3 minutes, then round 2 with variations):
// dawn (one kalimba, then two) -> hand drums join -> whistle theme x2 -> call & response x2 ->
// B (relative-minor cloud, deceptive A7 -> Bb, then bVI-bVII sunshine) -> breakdown -> drum talk ->
// return (theme in thirds) -> call & response tutti -> B with counterline -> last theme -> dusk.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 6;
  const PULSES = [0, 1.5, 3, 4.5];
  const onPulse = (abs) => PULSES.some((p) => Math.abs((((abs % 6) + 6) % 6) - p) < 1e-6);

  // ---------- harmony ----------
  const PROG_TEXT = {
    INTRO: "| D | D | C/D | D | D | C/D | G/D | D |",
    // I-bVII-IV twice: first over a D pedal, then with the bass moving; hemiola cadence in half notes.
    A: "| D | C/D | G/D | D | D/F# | C/E | G | Em7:2 A7sus4:2 A7:2 |",
    A2: "| D | C/D | G/D | D | D/F# | C/E | G | G:2 C:2 D:2 |",
    // relative-minor cloud, then V -> bVI (deceptive) and bVI-bVII sunshine back to I
    B: "| Bm7 | Gmaj7 | Em7 | A7sus4:3 A7:3 | Bbadd9 | Cadd9 | Bbadd9 | Cadd9 |",
    BREAK: "| D | D | C/D | C/D | G/D | G/D | C/D | D |",
    TALK: "| D | C/D | G/D | D | D | C/D | G/D | A7sus4 |",
    DUSK: "| D | C/D | G/D | D | G/D | C/D | Dsus4:3 D:3 | D |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v, BPB)]));

  const ROUND = [
    { id: "intro", prog: "INTRO", label: "Dawn · a kalimba wakes" },
    { id: "groove", prog: "A", label: "First steps · hand drums join" },
    { id: "theme", prog: "A", label: "Theme" },
    { id: "theme2", prog: "A2", label: "Theme · glockenspiel answers" },
    { id: "call", prog: "A", label: "Call & response" },
    { id: "call2", prog: "A2", label: "Call & response · copycat" },
    { id: "B", prog: "B", label: "Sunny valley · cloud, then ♭VI" },
    { id: "break", prog: "BREAK", label: "Breakdown · kalimbas & shaker" },
    { id: "talk", prog: "TALK", label: "Breakdown · drum talk" },
    { id: "return", prog: "A", label: "Return · theme in thirds" },
    { id: "call3", prog: "A2", label: "Call & response · everyone" },
    { id: "B2", prog: "B", label: "Sunny valley · harp & counterline" },
    { id: "coda", prog: "A2", label: "Theme · last time" },
    { id: "dusk", prog: "DUSK", label: "Dusk · kalimbas" },
  ];

  // Parent collections: D mixolydian (= G major) for the A world, D major for the B-minor cloud and
  // the A7 dominants, F major for the bVI-bVII sunshine.
  const G_MAJ = T.scale(7, "ionian"), D_MAJ = T.scale(2, "ionian"), F_MAJ = T.scale(5, "ionian");
  function coll(sym, secId) {
    if (/^(Bb|Cadd9)/.test(sym)) return F_MAJ;
    if (sym.startsWith("A7")) return D_MAJ;
    if (secId === "B" || secId === "B2") return D_MAJ;
    return G_MAJ;
  }

  // ---------- melody notation: one string per 12/8 bar, "note/dur" in quarter beats, r = rest, ~ = grace ----------
  function parseBar(s) {
    const out = [];
    let b = 0;
    for (const tok of s.trim().split(/\s+/)) {
      const [n, d] = tok.split("/");
      const dur = Number(d);
      if (!(dur > 0)) throw new Error(`creature-lab: bad duration in "${tok}"`);
      if (n !== "r") {
        const grace = n.endsWith("~");
        out.push({ beat: b, dur, note: T.midi(grace ? n.slice(0, -1) : n), grace });
      }
      b += dur;
    }
    if (Math.abs(b - BPB) > 1e-6) throw new Error(`creature-lab: bar sums to ${b}: ${s}`);
    return out;
  }
  const P = (xs) => xs.map((s) => (s ? parseBar(s) : null));

  // The theme. Motifs: x = three eighths rising into a dotted quarter (bars 1, 3, 7);
  // y = three quarter notes against the 6/8 pulse (hemiola, bars 2 and 6); cadence in half notes.
  const THEME = P([
    "A4/.5 D5/.5 E5/.5 F#5/1.5 A5/1 F#5/.5 E5/1 D5/.5", // D
    "E5/1 G5/1 C6~/1.5 A5/.5 G5/.5 E5/1.5", //            C/D   hemiola, cheeky syncopated C
    "D5/.5 G5/.5 B5/.5 D6~/1.5 C6/1 B5/.5 A5/1.5", //     G/D   x up to the peak, C->B sigh
    "F#5/2.5 r/1.5 A4/.5 B4/.5 D5/.5 E5/.5", //           D     land, then a pentatonic scurry
    "F#5/1.5 A5/1 B5/.5 A5/1.5 F#5/1 E5/.5", //           D/F#
    "G5/1 A5/1 G5/1 E5/1.5 D5/1 E5/.5", //                C/E   hemiola again
    "D5/.5 G5/.5 B5/.5 D6~/1.5 B5/1 A5/.5 G5/1.5", //     G     peak again, resolving down
    null,
  ]);
  const THEME_END = { A: P(["B5/2 A5/2 G5/1 E5/1"])[0], A2: P(["B5/2 G5/2 F#5/2"])[0] };
  // variants used on later rounds so the tune is recognisably the same but not frozen
  const THEME_ALT = {
    3: P(["F#5/2.5 r/1.5 B4/.5 A4/.5 D5/.5 E5/.5", "F#5/2.5 r/2.5 D5/.5 E5/.5"]),
    5: P(["E5/1 G5/1 A5/1 G5/1.5 D5/1 E5/.5"]),
  };

  // Call & response. The whistle calls; the flute answers with the call's rhythm displaced by an
  // eighth and its contour inverted (v1), or copies it a register lower (v2, "copycat").
  const CALL = {
    v1: [
      ["whistle", "D6~/.5 B5/.5 A5/1 F#5/.5 A5/1.5 r/2"],
      ["flute", "r/.5 G4/.5 C5/.5 E5/1 D5/.5 C5/1.5 r/1.5"],
      ["whistle", "B5/.5 D6/.5 B5/1 G5/.5 A5/1.5 r/2"],
      ["flute", "r/.5 A4/.5 D5/.5 F#5/1 E5/.5 D5/1.5 r/1.5"],
      ["whistle", "A5/1 F#5/1 A5/1 D6~/1.5 r/1.5"],
      ["flute", "G5/1 E5/1 G5/1 C5/1.5 r/1.5"],
    ],
    v2: [
      ["whistle", "D6~/.5 B5/.5 A5/1 F#5/.5 A5/1.5 r/2"],
      ["flute", "r/.5 C5/.5 A4/.5 G4/1 E4/.5 G4/1.5 r/1.5"],
      ["whistle", "B5/.5 D6/.5 B5/1 G5/.5 A5/1.5 r/2"],
      ["flute", "r/.5 D5/.5 F#5/.5 D5/1 A4/.5 D5/1.5 r/1.5"],
      ["whistle", "A5/1 B5/1 C6/1 D6~/1.5 r/1.5"],
      ["flute", "E5/1 D5/1 C5/1 G4/1.5 r/1.5"],
    ],
  };
  for (const v of Object.values(CALL)) v.forEach((x) => (x[1] = parseBar(x[1])));
  const CALL_TUTTI = parseBar("D6/.5 B5/.5 G5/.5 A5/1.5 B5/1 A5/.5 G5/1.5");
  const CALL_END = {
    A: { whistle: parseBar("G5/2 A5/2 G5/1 E5/1"), flute: parseBar("E5/2 D5/2 C#5/2") }, // D->C# suspension
    A2: { whistle: parseBar("B5/2 C6/2 A5/2"), flute: parseBar("G5/2 E5/2 F#5/2") },
  };

  // B: the flute sings the cloud, the whistle bursts into the sunshine (motif x, now in F major colours)
  const B_CLOUD = P(["D5/1.5 F#5/1 E5/.5 D5/1.5 B4/1.5", "B4/1.5 D5/1 E5/.5 F#5/3", "G5/1.5 F#5/1 E5/.5 B4/1.5 D5/1.5", "E5/1.5 D5/1.5 C#5/1.5 E5/1.5"]);
  const B_SUN = P(["F5/.5 Bb5/.5 C6/.5 D6~/1.5 C6/1 Bb5/.5 C6/1.5", "G5/.5 C6/.5 D6/.5 E6~/1.5 D6/1 C6/.5 G5/1.5", "D6/1 C6/1 Bb5/1 C6/1.5 D6/1.5", "E6/1.5 D6/1.5 C6/1.5 r/1.5"]);
  const B_COUNTER = P(["A5/3 F#5/3", "B5/3 A5/3", "B5/3 G5/3", "A5/3 G5/3"]);
  const GLOCK_FILL = { 3: parseBar("r/2.5 D6/.5 E6/.5 F#6/2.5"), 7: parseBar("r/4.5 A6/.5 F#6/.5 D6/.5") };
  const DUSK_MEL = { whistle: P([null, null, null, "r/3 A4/.5 D5/.5 E5/.5 F#5/1.5", "G5/3 r/3", null, null, null]), flute: P([null, null, null, null, null, null, "r/1.5 G4/1.5 F#4/3", null]) };

  // ---------- kalimba patterns: 2 bars x 6 slots; steps from the anchor through the chord's keys ----------
  // A plays slot k at beat k (on the beat), B plays slot k at beat k + 0.5 (off the beat).
  const KAL = {
    P1: { a: [0, 3, 2, 3, 1, 3, 0, 3, 2, 4, 3, 2], b: [0, -1, 1, 0, -2, -1, 0, -1, 2, 1, 0, -1] },
    P1m: { a: [0, 3, 2, 3, 1, 3, 0, 3, 2, 4, 3, 2], b: [null, 0, 2, null, 1, -1, null, 1, 2, null, 0, -1] }, // B thins under a tune
    P2: { a: [0, 2, 1, 3, 2, 4, 0, 2, 1, 3, 4, 2], b: [1, 0, 2, 1, -1, 1, 1, 0, 3, 2, 1, 0] },
    P3: { a: [0, null, 3, 2, null, 4, 0, null, 3, 1, null, 2], b: [2, null, 1, 0, null, -1, 1, null, 2, 0, null, -1] }, // skipping
  };
  // which pitch classes each kalimba's keys hold for a chord (A: chordal, B: pentatonic around the chord)
  function kalSets(c) {
    let a, b, triad;
    if (c.kind === "major7") { a = [0, 4, 7, 11]; b = [0, 2, 4, 7, 11]; triad = [0, 4, 7]; }
    else if (c.kind === "minor7" || c.kind === "minor") { a = [0, 3, 7, 10]; b = [0, 3, 5, 7, 10]; triad = [0, 3, 7]; }
    else if (c.kind === "dominant" && c.sus) { a = [0, 5, 7, 10]; b = [0, 2, 5, 7, 10]; triad = [0, 5, 7]; }
    else if (c.kind === "dominant") { a = [0, 4, 7, 10]; b = [0, 2, 4, 7, 10]; triad = [0, 4, 7]; }
    else if (c.sus) { a = [0, 5, 7]; b = [0, 2, 5, 7, 9]; triad = [0, 5, 7]; }
    else { a = [0, 2, 4, 7]; b = [0, 2, 4, 7, 9]; triad = [0, 4, 7]; }
    const pc = (xs) => xs.map((i) => T.mod12(c.root + i));
    return { a: pc(a), b: pc(b), triad: pc(triad), third: T.mod12(c.root + triad[1]) };
  }
  // B's home is F#5 when the kalimbas carry the tune, B4 under a melody (so the whistle floats above).
  const KAL_RANGE = { a: { lo: 60, hi: 81, alo: 60, ahi: 67 }, b: { lo: 64, hi: 88 } };
  /** Anchor for a part on a chord: nearest triad tone to the previous anchor (A favours roots, B thirds near home). */
  function anchorFor(part, c, prev, home) {
    const s = kalSets(c), R = KAL_RANGE[part];
    const [alo, ahi] = part === "a" ? [R.alo, R.ahi] : [home - 6, home + 3];
    let best = null, bs = Infinity;
    for (const m of T.notesIn(s.triad, alo, ahi)) {
      const pc = T.mod12(m);
      const sc = part === "a"
        ? Math.abs(m - prev) - (pc === c.root ? 2.5 : 0)
        : Math.abs(m - prev) * 0.6 + Math.abs(m - home) * 0.5 - (pc === s.third ? 2 : 0);
      if (sc < bs) { bs = sc; best = m; }
    }
    return best ?? prev;
  }
  function kalNote(part, sym, step, st) {
    const c = T.chord(sym), R = KAL_RANGE[part];
    if (st.sym[part] !== sym || st.home[part] !== st.wantHome) { st.anchor[part] = anchorFor(part, c, st.anchor[part], st.wantHome); st.sym[part] = sym; st.home[part] = st.wantHome; }
    const keys = T.notesIn(kalSets(c)[part], R.lo, R.hi);
    const i = keys.indexOf(st.anchor[part]);
    return keys[Math.max(0, Math.min(keys.length - 1, i + step))];
  }
  /** Later rounds: the players drift — a couple of slots move to a neighbouring key. */
  function driftPatterns(r) {
    const out = {};
    for (const [k, p] of Object.entries(KAL)) {
      const a = p.a.slice(), b = p.b.slice();
      for (const arr of [a, b, a]) {
        const i = r.int(1, 11);
        if (i % 6 === 0 || arr[i] == null) continue; // keep the downbeats and rests
        const v = arr[i] + (r.chance(0.5) ? 1 : -1);
        if (v !== arr[i - 1] && v !== arr[i + 1]) arr[i] = v; // never create a repeated key
      }
      out[k] = { a, b };
    }
    return out;
  }

  // ---------- percussion ----------
  const BELLS = [[0, 1, 2, 2.5, 3.5, 4.5, 5.5], [0, 1, 2.5, 3, 4, 5.5]];
  const TUNE = { conga: 62, congaLow: 57, bongoHi: 74, bongoLo: 69 }; // D4, A3, D5, A4

  Sim.register({
    id: "creature-lab",
    title: "Creature Lab",
    genre: "Pastoral world",
    about: "A 12/8 pastoral in D mixolydian. Two kalimbas interlock mbira-style (each alone is a 3/4 hemiola, together they make 6/8), over hand drums and a marimba bass. A whistle sings a cheeky theme that a flute answers, copies and harmonizes. In the B section a B-minor cloud passes, then the music breaks into sunshine on ♭VI–♭VII.",
    bpm: 156, beatsPerBar: BPB, meter: "12/8", strongBeats: [0, 1.5, 3, 4.5], swing: 0.5, cycleBars: 8, gainDb: 0.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const meadow = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.025, lowcut: 300, highcut: 7500 });
      const echo = I.delay(ctx, out, { time: "4n.", feedback: 0.22, highcut: 3000 }); // echoes on the dotted-quarter pulse
      const kalA = I.kalimba(ctx, { volume: -7, decay: 1.6, bright: 1.0 });
      const kalB = I.kalimba(ctx, { volume: -8.5, decay: 1.25, bright: 1.25 });
      const mar = I.marimba(ctx, { volume: -4, hardness: 1.1, decay: 1.1, cutoff: 2600 });
      const sub = I.sub(ctx, { volume: -10, attack: 0.012, release: 0.25 });
      const kit = I.kit(ctx, { volume: -3, preload: ["shaker", "conga", "congaLow", "bongo", "woodblock", "clave"] });
      const whistle = I.whistle(ctx, { volume: 0, vibrato: 5.6, vibratoDepth: 0.035 });
      const flute = I.flute(ctx, { volume: -2, vibratoDepth: 0.05 });
      const glock = I.glock(ctx, { volume: -13, decay: 2.6 });
      const harp = I.harp(ctx, { volume: -11 });
      const ka = I.place(ctx, kalA, -0.42, out), kb = I.place(ctx, kalB, 0.42, out);
      const mp = I.place(ctx, mar, -0.05, out); I.place(ctx, sub, 0, out);
      const kp = I.place(ctx, kit, 0.05, out);
      const wp = I.place(ctx, whistle, 0.08, out), fp = I.place(ctx, flute, -0.18, out);
      const gp = I.place(ctx, glock, 0.35, out), hp = I.place(ctx, harp, -0.3, out);
      I.send(ctx, ka, meadow, -14); I.send(ctx, kb, meadow, -13);
      I.send(ctx, wp, meadow, -10); I.send(ctx, wp, echo, -21); I.send(ctx, fp, meadow, -11);
      I.send(ctx, gp, meadow, -8); I.send(ctx, gp, echo, -16); I.send(ctx, hp, meadow, -9);
      I.send(ctx, kp, meadow, -18); I.send(ctx, mp, meadow, -22);
      return {
        kalA: { layer: "harmony", play: (t, e, d) => kalA.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.08 } },
        kalB: { layer: "harmony", play: (t, e, d) => kalB.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.08 } },
        bass: {
          layer: "bass", humanize: { timing: 0.004, vel: 0.06 },
          play: (t, e, d) => { mar.play(t, e.note, d, e.vel); sub.play(t, e.note - 12, d * 0.85, e.vel * 0.8); },
        },
        perc: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.004, vel: 0.12 } },
        whistle: { layer: "melody", play: (t, e, d) => whistle.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.05 } },
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.05 } },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel) },
        harp: { layer: "texture", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: { timing: 0.003 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const round = Math.floor(cycle / ROUND.length), sec = ROUND[cycle % ROUND.length];
      const nextSec = ROUND[(cycle + 1) % ROUND.length];
      const prog = PROGS[sec.prog];
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      if (!state.kal) state.kal = { anchor: { a: 62, b: 78 }, sym: { a: null, b: null }, home: { a: 78, b: 78 }, wantHome: 78 };
      // kalimba B sits under the whistle in tune sections, and above the flute's low cloud melody in B
      state.kal.wantHome = ["theme", "theme2", "return", "coda", "call", "call2", "call3"].includes(sec.id) ? 73 : 78;
      if (state.round !== round) { state.round = round; state.pats = round === 0 ? KAL : driftPatterns(r.fork(7)); }
      const pats = state.pats;
      const id = sec.id;

      // ---- kalimbas ----
      const kalAAt = new Map(); // eighth index -> kalimba A note, so B can avoid echoing A's pitch
      let lastB = null;
      const kal = (part, pat, from, to, vel = 1, sparseLast = false) => {
        for (let bar = from; bar < to; bar++) {
          for (let k = 0; k < 6; k++) {
            const step = pat[part][(bar % 2) * 6 + k];
            if (step == null) continue;
            if (sparseLast && bar === to - 1 && k !== 0 && k !== 3) continue;
            const abs = bar * 6 + k + (part === "b" ? 0.5 : 0);
            let note = kalNote(part, sym(abs), step, state.kal);
            if (part === "a") kalAAt.set(abs * 2, note);
            else { // don't echo kalimba A's neighbouring note or B's own previous note
              const bad = (m) => m === kalAAt.get(abs * 2 - 1) || m === kalAAt.get(abs * 2 + 1) || m === lastB;
              if (bad(note)) {
                const alts = [step + 1, step - 1].map((x) => kalNote(part, sym(abs), x, state.kal)).filter((m) => !bad(m));
                if (alts.length) note = alts.sort((x, y) => Math.abs(x - state.kal.wantHome) - Math.abs(y - state.kal.wantHome))[0];
              }
              lastB = note;
            }
            const accent = part === "a" ? k === 0 || k === 3 : k === 1 || k === 4;
            push(part === "a" ? "kalA" : "kalB", abs, 1.2, note, (accent ? 0.6 : 0.43) * vel + (k === 0 && bar % 2 === 0 ? 0.04 : 0));
          }
        }
      };

      // ---- bass: marimba with a sine sub an octave below ----
      const nextFirst = T.chord(PROGS[nextSec.prog][0].chord);
      const bass = (modes) => {
        let last = state.bassLast ?? 50;
        prog.forEach((h, i) => {
          const mode = modes[h.bar];
          if (!mode || mode === "none") return;
          const c = T.chord(h.chord), s0 = h.bar * 6 + h.beat;
          const root = T.nearest(last, [c.bass], 43, 55);
          const pedal = c.bass !== c.root && c.bass === 2; // C/D, G/D: a tonic pedal, not an inversion
          // root position and pedals bounce to the fifth above the bass; inversions to the chord root
          const alt = c.bass === c.root || pedal ? (root + 7 <= 57 ? root + 7 : root - 5) : T.nearest(root - 3, [c.root], 43, 57);
          const fifth = T.nearest(root + 3, [T.mod12(c.root + 7)], 43, 57);
          const nxt = i + 1 < prog.length ? T.chord(prog[i + 1].chord) : nextFirst;
          const nextRoot = T.nearest(root, [nxt.bass], 43, 55);
          const approach = () => { // a scale step into the next bass note, from the side we're coming from
            const sc = coll(h.chord, id);
            let a = T.step(nextRoot, nextRoot > root ? -1 : 1, sc);
            if (a === root) a = T.step(nextRoot, nextRoot > root ? 1 : -1, sc);
            return a;
          };
          if (mode === "sparse") push("bass", s0, Math.min(h.dur, 5), root, 0.68);
          else if (mode === "long") {
            push("bass", s0, Math.min(2.8, h.dur - 0.1), root, 0.7);
            if (h.dur >= 6) push("bass", s0 + 3, 2.8, alt, 0.58);
          } else if (h.dur <= 2) push("bass", s0, 1.8, root, 0.74); // hemiola halves
          else {
            push("bass", s0, 1.3, root, 0.78);
            push("bass", s0 + 1.5, 1.0, alt, 0.56);
            if (h.dur >= 6) {
              push("bass", s0 + 3, 1.3, root, 0.7);
              const moving = nextRoot !== root;
              if (moving && r.chance(0.35)) { // walk in with an eighth pickup
                const ap = approach();
                push("bass", s0 + 4.5, 0.9, ap === alt ? (fifth !== root ? fifth : root) : alt, 0.52);
                push("bass", s0 + 5.5, 0.45, ap, 0.5);
              } else if (moving) push("bass", s0 + 4.5, 1.0, approach(), 0.55);
              else push("bass", s0 + 4.5, 1.0, r.chance(0.3) && root + 12 <= 57 ? root + 12 : alt, 0.54);
            }
          }
          last = root;
        });
        state.bassLast = last;
      };

      // ---- hand percussion ----
      const bell = BELLS[round % 2];
      const drum = (voice, abs, vel, pitch, delay) => push("perc", abs, 0.1, voice, vel, { pitch, ...(delay ? { delay } : {}) });
      const perc = (bar, f) => {
        const s = bar * 6;
        const hemi = f.hemiola, fill = f.fill;
        const g = f.gain ?? 1;
        if (f.shaker) for (let e = 0; e < 12; e++) {
          const b = e * 0.5, ph = b % 1.5;
          if (f.shaker === 1 && ph !== 0) continue;
          drum("shaker", s + b, (ph === 0 ? 0.34 : ph === 1 ? 0.22 : 0.13) * g);
        }
        if (f.conga) {
          drum("congaLow", s, 0.5 * g, TUNE.congaLow);
          if (hemi) { // three half notes against four pulses: clave marks them
            [0, 2, 4].forEach((b, i) => { drum("clave", s + b, 0.42 + i * 0.04); if (b) drum("conga", s + b, 0.55, TUNE.conga); });
          } else {
            drum("conga", s + 1, 0.16, TUNE.conga);
            drum("conga", s + 2, 0.44, TUNE.conga, 0.006); drum("conga", s + 2.5, 0.58, TUNE.conga, 0.006);
            if (!fill) {
              drum("congaLow", s + 3, 0.42, TUNE.congaLow);
              drum("conga", s + 4, 0.16, TUNE.conga);
              drum("conga", s + 5, 0.44, TUNE.conga, 0.006); drum("conga", s + 5.5, 0.6, TUNE.conga, 0.006);
            }
          }
        }
        if (f.bongo && !hemi) {
          drum("bongo", s + 0.5, 0.2, TUNE.bongoLo); drum("bongo", s + 1.5, 0.5, TUNE.bongoHi);
          if (!fill) { drum("bongo", s + 3.5, 0.2, TUNE.bongoLo); drum("bongo", s + 4.5, 0.52, TUNE.bongoHi); }
        }
        if (f.bell && !hemi) bell.forEach((b, i) => { if (!fill || b < 3) drum("woodblock", s + b, i === 0 ? 0.42 : 0.3); });
        if (fill) { // little feet running into the next section
          drum("congaLow", s + 3, 0.5, TUNE.congaLow); drum("conga", s + 3.5, 0.38, TUNE.conga); drum("conga", s + 4, 0.45, TUNE.conga);
          drum("bongo", s + 4.5, 0.48, TUNE.bongoHi); drum("bongo", s + 5, 0.54, TUNE.bongoLo); drum("bongo", s + 5.5, 0.62, TUNE.bongoHi);
        }
      };
      // conversation: congas ask (bars 0, 2), bongos reply (bars 1, 3)
      const talk = (bar) => {
        const s = bar * 6;
        if (bar % 2 === 0) {
          drum("congaLow", s, 0.55, TUNE.congaLow); drum("conga", s + 1, 0.4, TUNE.conga); drum("conga", s + 1.5, 0.56, TUNE.conga);
          drum("conga", s + 2.5, 0.5, TUNE.conga, 0.006); drum("congaLow", s + 3, 0.48, TUNE.congaLow);
          if (bar === 2) { drum("conga", s + 4, 0.3, TUNE.conga); drum("conga", s + 4.5, 0.5, TUNE.conga); }
        } else {
          [[0.5, 0.36, "bongoLo"], [1, 0.3, "bongoLo"], [1.5, 0.55, "bongoHi"], [3, 0.3, "bongoLo"], [3.5, 0.4, "bongoLo"], [4.5, 0.56, "bongoHi"], [5.5, 0.42, "bongoLo"]]
            .forEach(([b, v, p]) => drum("bongo", s + b, v, TUNE[p]));
        }
      };

      // ---- melody ----
      // A second voice under the tune: chord tones (a third or sixth below) on strong notes, a diatonic
      // third on passing notes, or a pentatonic fourth where the third would be the chord's 4th or 7th.
      const pentOf = (c) => {
        const iv = c.kind === "minor7" || c.kind === "minor" ? [0, 3, 5, 7, 10] : c.sus ? [0, 2, 5, 7, 10] : c.kind === "dominant" ? [0, 2, 4, 7, 10] : [0, 2, 4, 7, 9];
        return iv.map((i) => T.mod12(c.root + i));
      };
      const below = (m, symb, strong, prev) => {
        const c = T.chord(symb), pref = { 3: 0, 4: 0, 8: 1, 9: 1, 5: 1.5, 7: 3, 6: 5 };
        if (strong) {
          let best = null, bs = Infinity;
          for (let d = 3; d <= 9; d++) {
            if (!c.pcs.includes(T.mod12(m - d))) continue;
            const sc = pref[d] + (prev != null ? Math.abs(m - d - prev) * 0.2 : 0);
            if (sc < bs) { bs = sc; best = m - d; }
          }
          if (best != null && bs < 3) return best;
        }
        const third = T.step(m, -2, coll(symb, id)), pent = pentOf(c);
        return pent.includes(T.mod12(third)) || c.pcs.includes(T.mod12(third)) ? third : T.step(m, -2, pent);
      };
      const graceP = round === 0 ? 0.7 : 0.9;
      /** Play parsed bars starting at bar `start`. o: { vel, transpose, grace, harm: track, unison: track } */
      const line = (track, barsArr, start, o = {}) => {
        const notes = [];
        barsArr.forEach((ns, i) => ns && ns.forEach((n) => notes.push({ ...n, abs: (start + i) * 6 + n.beat })));
        let harmPrev = null;
        notes.forEach((n, i) => {
          const next = notes[i + 1], end = n.abs + n.dur;
          const phraseEnd = !next || next.abs > end + 0.01;
          const strong = onPulse(n.abs) || n.dur >= 1.5;
          const note = n.note + (o.transpose || 0);
          const vel = (o.vel ?? 0.68) + (onPulse(n.abs) ? 0.06 : -0.02) + (n.dur >= 1.5 ? 0.03 : 0) - (phraseEnd ? 0.06 : 0);
          const dur = phraseEnd ? n.dur : n.dur * 0.94;
          const gn = T.step(note, -1, coll(sym(n.abs), id));
          if (n.grace && o.grace !== false && gn !== (notes[i - 1]?.note ?? -1) + (o.transpose || 0) && r.chance(graceP)) {
            push(track, n.abs - 0.125, 0.12, gn, vel * 0.6); // a quick scoop from the scale step below
          }
          push(track, n.abs, dur, note, vel);
          if (o.harm) {
            const h = below(note, sym(n.abs), strong, harmPrev?.note);
            // oblique motion: hold the lower voice rather than re-striking the same pitch
            if (harmPrev && h === harmPrev.note && Math.abs(harmPrev.abs + harmPrev.dur - n.abs) < 0.01) { harmPrev.dur += n.dur; harmPrev.ev.dur = harmPrev.dur * (phraseEnd ? 1 : 0.96); }
            else {
              push(o.harm, n.abs, dur, h, vel * 0.82);
              harmPrev = { note: h, abs: n.abs, dur: n.dur, ev: ev[ev.length - 1] };
            }
            if (phraseEnd) harmPrev = null;
          }
          if (o.unison) push(o.unison, n.abs, dur, note, vel * 0.62);
        });
      };
      const themeBars = (end) => {
        const t = THEME.slice();
        if (round > 0) { t[3] = r.pick([THEME[3], ...THEME_ALT[3]]); t[5] = r.pick([THEME[5], ...THEME_ALT[5]]); }
        t[7] = THEME_END[end];
        return t;
      };
      const harpSweep = (abs, symb, lo, n = 6) => {
        const c = T.chord(symb);
        const triad = c.pcs.filter((pc) => pc !== T.mod12(c.root + 2)); // no added 9th low down: keep the bottom open
        T.notesIn(c.pcs, lo, 90).filter((m) => m >= 67 || triad.includes(T.mod12(m))).slice(0, n)
          .forEach((m, i) => push("harp", abs + i * 0.25, 3 - i * 0.25, m, 0.34 + i * 0.03));
      };

      const groove = { shaker: 2, conga: true };
      const full = { shaker: 2, conga: true, bongo: true, bell: true };
      const all = (f, n = 8) => { for (let b = 0; b < n; b++) perc(b, { ...f, hemiola: b === 7 && (sec.prog === "A" || sec.prog === "A2"), fill: f.fillLast && b === 7 }); };
      const bounce = Array(8).fill("bounce");

      switch (id) {
        case "intro": {
          const bEnter = round === 0 ? 4 : 2;
          for (let b = 0; b < 8; b++) kal("a", pats.P1, b, b + 1, b < 4 ? 0.72 + b * 0.07 : 1);
          kal("b", pats.P1, bEnter, 8);
          break;
        }
        case "groove":
          kal("a", pats.P1, 0, 8); kal("b", pats.P1, 0, 8);
          bass(bounce);
          for (let b = 0; b < 8; b++) perc(b, b < 2 ? { shaker: 1 } : b < 4 ? groove : { ...groove, bell: b < 7, bongo: b >= 6, hemiola: b === 7 });
          break;
        case "theme": case "theme2": case "return": case "coda": {
          kal("a", pats.P1, 0, 8, 0.88); kal("b", pats.P1m, 0, 8, 0.85);
          bass(bounce);
          const end = sec.prog === "A2" ? "A2" : "A";
          const lead = id === "theme" && round % 2 === 1 ? "flute" : "whistle";
          const tb = themeBars(end);
          if (id === "return") { line("whistle", tb, 0, { harm: "flute" }); harpSweep(0, "D", 57); }
          else if (id === "coda") { line("whistle", tb.slice(0, 4), 0); line("whistle", tb.slice(4), 4, { unison: "flute" }); } // last time, everyone sings
          else line(lead, tb, 0, { vel: lead === "flute" ? 0.66 : 0.68 });
          if (id === "theme2" || id === "coda") { line("glock", [GLOCK_FILL[3]], 3, { vel: 0.4, grace: false }); if (end === "A2") line("glock", [GLOCK_FILL[7]], 7, { vel: 0.36, grace: false }); }
          all(id === "theme" ? groove : id === "return" ? full : { ...groove, bell: true });
          break;
        }
        case "call": case "call2": case "call3": {
          kal("a", pats.P1, 0, 8, 0.88); kal("b", pats.P1m, 0, 8, 0.85);
          bass(bounce);
          const v = id === "call" ? CALL.v1 : CALL.v2, end = CALL_END[sec.prog === "A2" ? "A2" : "A"];
          v.forEach(([track, notes], i) => line(track, [notes], i, { vel: track === "flute" ? 0.64 : 0.68 }));
          line("whistle", [CALL_TUTTI], 6, { harm: "flute" });
          line("whistle", [end.whistle], 7); line("flute", [end.flute], 7, { vel: 0.6 });
          if (id === "call3") { // everyone: the glockenspiel echoes the tail of each call an octave up
            harpSweep(36, "G", 55);
            [0, 2, 4].forEach((bar) => {
              const ns = v[bar][1], tail = ns.slice(-2);
              tail.forEach((n, k) => push("glock", bar * 6 + 4 + k * 0.5, k ? 1.5 : 0.5, n.note + 12 <= 93 ? n.note + 12 : n.note, 0.3 - k * 0.04));
            });
          }
          all(id === "call" ? { ...groove, bongo: true } : full);
          break;
        }
        case "B": case "B2": {
          // the cloud: kalimbas skip quietly under the flute; the sun: they flow (P2)
          state.kal.wantHome = 81; // above the flute's low cloud melody
          kal("a", pats.P3, 0, 4, 0.72); kal("b", pats.P3, 0, 4, 0.66);
          state.kal.wantHome = 73; // below the whistle's sunshine
          kal("a", pats.P2, 4, 8, 0.88); kal("b", pats.P2, 4, 8, 0.82);
          bass(["long", "long", "long", "long", "bounce", "bounce", "bounce", "bounce"]);
          line("flute", B_CLOUD, 0, { vel: 0.66 });
          line("whistle", B_SUN, 4, id === "B2" ? { harm: "flute" } : {});
          if (id === "B2") {
            line("whistle", B_COUNTER, 0, { vel: 0.5, grace: false });
            [[4, "F6"], [5, "G6"], [6, "D6"], [7, "E6"]].forEach(([b, n]) => push("glock", b * 6 + 4.5, 1.5, T.midi(n), 0.34));
          }
          for (let b = 4; b < 8; b++) harpSweep(b * 6, sym(b * 6), 58, b === 4 ? 7 : 5);
          for (let b = 0; b < 8; b++) perc(b, b < 3 ? { shaker: 1, gain: 1.1 } : b === 3 ? { shaker: 2, conga: true, fill: true } : { ...groove, bongo: true, bell: id === "B2" });
          break;
        }
        case "break":
          kal("a", pats.P3, 0, 8); kal("b", pats.P3, 0, 8, 0.95);
          bass(Array(8).fill("sparse"));
          for (let b = 0; b < 8; b++) perc(b, { shaker: 1, gain: 0.9 });
          break;
        case "talk":
          kal("a", pats.P3, 0, 4); kal("b", pats.P3, 0, 4, 0.95); kal("a", pats.P1, 4, 8); kal("b", pats.P1, 4, 8);
          bass(["sparse", "sparse", "sparse", "sparse", "bounce", "bounce", "bounce", "bounce"]);
          for (let b = 0; b < 4; b++) { talk(b); perc(b, { shaker: 1 }); }
          for (let b = 4; b < 8; b++) perc(b, { ...groove, bongo: b >= 6, fill: b === 7 });
          break;
        case "dusk": {
          kal("a", pats.P1, 0, 8, 0.9, true); kal("b", pats.P1, 0, 6, 0.85);
          bass(["sparse", "sparse", "sparse", "sparse", "none", "none", "none", "none"]);
          for (let b = 0; b < 3; b++) perc(b, { shaker: 1, gain: 1 - b * 0.25 });
          line("whistle", DUSK_MEL.whistle, 0, { vel: 0.6 });
          line("flute", DUSK_MEL.flute, 0, { vel: 0.52 });
          push("glock", 7 * 6 + 1.5, 3, T.midi("A6"), 0.3); push("glock", 7 * 6 + 3, 3, T.midi("F#6"), 0.26);
          break;
        }
      }

      const label = round > 0 && (id === "intro") ? `${sec.label} · round ${round + 1}` : sec.label;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();

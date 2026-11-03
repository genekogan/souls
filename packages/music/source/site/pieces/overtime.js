// Overtime: a lounge-jazz ballad in Db for city hall after hours, the mayor still at the desk.
// 32-bar AABA at 64 BPM. A round is nine 8-bar sections:
//   tag (the intro on the first pass) · head A1 A2 B A3 · Rhodes solo A1 A2 · head out B A3′
// The A sections lean on a guide-tone descent (Eb–D–Db–C over iii–VI–ii–V and its tritone sub),
// A2 closes with the minor-plagal backdoor (Gbm6 → Cb9 → Db), the bridge tonicizes A major (bVI)
// and slips home through a deceptive E7b9 → Fm9, and the last A is reharmonized over a falling then
// rising bass (Db C Cb Bb … Gb G Ab). The head-out ends deceptively and becomes a tag: the ii–V
// repeats with a slowing harmonic rhythm and a written ritardando, lands on Dbmaj9, and its
// Ab13sus4 turns over into the next chorus.
// Lead: a custom flugelhorn (cup-muted, dark) with scoops, fall-offs, late vibrato and laid-back
// rubato. Rhodes in rolled ballad voicings (quartal, So-What and upper-structure shapes), upright in
// two, brushes stirred in slow circles, and a soft string pad in the bridge and the closing tag.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- harmony ----------
  const FORM = {
    TAG: "| Ebm9 Ab13 | Fm9 E13#11 | Ebm9 | Ab7b9 | Ebm9 | D13#11 | Dbmaj9 | Ab13sus4 |",
    A1: "| Dbmaj9 | Bbm9 Eb13 | Ebm9 | Ab13sus4 Ab13 | Fm9 Bb7b9 | Ebm9 D9#11 | Dbmaj9 Bbm9 | Ebm9 Ab13 |",
    A2: "| Dbmaj9 | Bbm9 Eb13 | Ebm9 | Ab13sus4 Ab13 | Gbmaj9 | Gbm6 Cb9 | Dbmaj9 | Bm9 E13 |",
    B: "| Amaj9 | C#m9 F#7b13 | Bm9 | E13sus4 E7b9 | Fm9 Bb7b9 | Ebm9 Ab13 | Fm9 E13#11 | Ebm9 D7#11 |",
    A3: "| Dbmaj9 Cm7b5 | Cbmaj9#11 Bbm9 | Gbmaj9 Gm7b5 | Ab13sus4 Ab13 | Gbmaj9 Gbm6 | Fm9 E13#11 | Ebm9 D7#11 | Dbmaj9 |",
    A3out: "| Dbmaj9 Cm7b5 | Cbmaj9#11 Bbm9 | Gbmaj9 Gm7b5 | Ab13sus4 Ab13 | Gbmaj9 Gbm6 | Fm9 E13#11 | Ebm9 Ab13 | Fm9 Bb7b9 |",
  };
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));

  // Rhodes voicing shapes: intervals above the root, bottom to top.
  const SHAPES = {
    maj9: [[4, 7, 11, 14], [11, 14, 16, 19], [4, 9, 14, 19]], // A-form, B-form, quartal 3-13-9-5
    "maj9#11": [[4, 11, 14, 18], [4, 9, 14, 18], [11, 14, 16, 18, 21]],
    m9: [[3, 7, 10, 14], [10, 14, 15, 19], [5, 10, 15, 19]], // A, B, So What (11-b7-b3-5)
    m7b5: [[3, 6, 10, 17], [6, 10, 15, 17]],
    m6: [[3, 9, 14, 19], [3, 7, 9, 14]],
    9: [[4, 10, 14, 19], [10, 14, 16, 19]],
    13: [[10, 14, 16, 21], [4, 9, 10, 14], [4, 10, 14, 21]],
    "13sus4": [[10, 14, 17, 21], [5, 10, 14, 21], [10, 14, 17, 19]],
    "7b9": [[4, 9, 10, 13], [4, 7, 10, 13], [10, 13, 16, 21]],
    "9#11": [[4, 10, 14, 18], [10, 16, 18, 21], [4, 9, 10, 14]],
    "7#11": [[4, 10, 14, 18], [10, 16, 18, 21], [4, 10, 14, 18, 21]], // last: shell + II triad
    "13#11": [[4, 10, 14, 18], [10, 16, 18, 21], [4, 10, 14, 18, 21]],
    "7b13": [[4, 10, 14, 20], [10, 16, 20, 26]],
  };
  const qual = (sym) => sym.replace(/^[A-G][b#]?/, "").replace(/\/.*$/, "");

  // ---------- the tune (concert pitch), [beat within the section, beats, note] ----------
  const A_FRONT = [
    [0, 2.5, "C5"], [2.5, 0.5, "Bb4"], [3, 0.5, "Ab4"], [3.5, 0.5, "F4"],
    [4, 1, "Ab4"], [5, 0.5, "Bb4"], [5.5, 0.5, "Db5"], [6, 1.5, "C5"],
    [8, 1.5, "Bb4"], [9.5, 0.5, "Gb4"], [10, 1, "F4"], [11, 0.5, "Ab4"], [11.5, 0.5, "Bb4"],
    [12, 2, "Db5"], [14, 1, "C5"], [15.5, 0.5, "Bb4"],
  ];
  const BACK = {
    A1: [
      [16, 2, "Eb5"], [18, 2, "D5"], [20, 1.5, "Db5"], [21.5, 0.5, "Bb4"], [22, 3.5, "C5"],
      [25.5, 0.5, "Bb4"], [26, 1.5, "Ab4"], [27.5, 0.5, "F4"], [28, 1.5, "Bb4"], [29.5, 0.5, "Gb4"], [30, 1, "F4"],
    ],
    A2: [
      [16, 2.5, "F5"], [18.5, 0.5, "Eb5"], [19, 1, "Db5"], [20, 2, "A4"], [22, 1, "Gb4"], [23, 1, "A4"],
      [24, 3, "Ab4"], [27, 1, "F4"], [28, 1, "A4"], [29, 1, "C#5"], [30, 1, "B4"],
    ],
    A3: [
      [16, 2, "F5"], [18, 1, "Eb5"], [19, 1, "Db5"], [20, 1.5, "C5"], [21.5, 1.5, "Ab4"], [23, 0.5, "C#5"], [23.5, 0.5, "B4"],
      [24, 1.5, "Bb4"], [25.5, 0.5, "Gb4"], [26, 1, "A4"], [27, 4, "C5"],
    ],
    A3out: [
      [16, 2, "F5"], [18, 1, "Eb5"], [19, 1, "Db5"], [20, 1.5, "C5"], [21.5, 1.5, "Ab4"], [23, 0.5, "C#5"], [23.5, 0.5, "B4"],
      [24, 1.5, "Bb4"], [25.5, 0.5, "Gb4"], [26, 2, "C5"], [28, 2, "Eb5"], [30, 2, "D5"],
    ],
  };
  const TUNE = {
    A1: A_FRONT.concat(BACK.A1), A2: A_FRONT.concat(BACK.A2), A3: A_FRONT.concat(BACK.A3), A3out: A_FRONT.concat(BACK.A3out),
    B: [
      [0, 2.5, "G#5"], [2.5, 0.5, "F#5"], [3, 1, "E5"], [4, 1.5, "D#5"], [5.5, 0.5, "C#5"], [6, 2, "A#4"],
      [8, 1.5, "C#5"], [9.5, 0.5, "B4"], [10, 1, "A4"], [11, 0.5, "C#5"], [11.5, 0.5, "D5"],
      [12, 2, "E5"], [14, 1, "D5"], [15, 1, "F5"], [16, 2, "Eb5"], [18, 2, "D5"],
      [20, 1.5, "Db5"], [21.5, 0.5, "Bb4"], [22, 2, "C5"], [24, 1, "Ab4"], [25, 1, "C5"], [26, 2, "B4"],
      [28, 1.5, "Bb4"], [29.5, 1.5, "Gb4"],
    ],
    TAG: [
      [0, 2, "Db5"], [2, 2, "C5"], [4, 1, "Ab4"], [5, 1, "C5"], [6, 2, "B4"],
      [8, 1.5, "Bb4"], [9.5, 0.5, "Gb4"], [10, 1, "F4"], [11, 0.5, "Ab4"], [11.5, 0.5, "Bb4"], [12, 2.5, "C5"],
      [16.5, 0.5, "Gb4"], [17, 1, "Bb4"], [18, 2, "Db5"], [20, 1.5, "C5"], [21.5, 0.5, "B4"], [22, 2, "Ab4"],
      [24, 5, "Eb5"],
    ],
  };
  // pickups into a section, played in the last bar of the section before it
  const PICKUP = {
    A1: [[-1, 0.5, "Ab4"], [-0.5, 0.5, "Bb4"]], A2: [[-1, 0.5, "Ab4"], [-0.5, 0.5, "Bb4"]],
    B: [[-1, 0.5, "E5"], [-0.5, 0.5, "F#5"]], A3: [[-1, 0.5, "A4"], [-0.5, 0.5, "B4"]], A3out: [[-1, 0.5, "A4"], [-0.5, 0.5, "B4"]],
  };
  const toNotes = (xs) => xs.map(([beat, dur, n]) => ({ beat, dur, note: T.midi(n) }));
  // the head's opening gesture as a C.line motif, so the Rhodes solo can quote it
  const HEAD_MOTIF = (() => {
    const ns = toNotes(A_FRONT.slice(0, 8));
    return { len: 8, rhythm: ns.map((n) => ({ off: n.beat, dur: n.dur })), steps: ns.map((n, i) => (i ? Math.sign(n.note - ns[i - 1].note) * Math.min(4, Math.abs(n.note - ns[i - 1].note) / 1.6) : 0)) };
  })();

  // one round = nine sections
  const ROUND = [
    { key: "TAG", kind: "tag" },
    { key: "A1", kind: "head" }, { key: "A2", kind: "head" }, { key: "B", kind: "head" }, { key: "A3", kind: "head" },
    { key: "A1", kind: "solo" }, { key: "A2", kind: "solo" },
    { key: "B", kind: "out" }, { key: "A3out", kind: "out" },
  ];
  const FIRST = Object.fromEntries(Object.keys(PROG).map((k) => [k, PROG[k][0].chord]));

  // ---------- custom voices ----------
  /** Flugelhorn with a cup mute: dark partials, nasal bump, scoops, fall-offs and late vibrato. */
  function flugel(ctx, I, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 9)));
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 4.7, depth: 0 })).connect(out);
    const cup = ctx.keep(new Tone.Filter({ type: "peaking", frequency: 1250, Q: 1.1, gain: 3.5 })).connect(vib);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 1900, type: "lowpass", rolloff: -12 })).connect(cup);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: 0,
      oscillator: { type: "custom", partials: [1, 0.72, 0.5, 0.34, 0.22, 0.14, 0.09, 0.05] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
      envelope: { attack: 0.07, decay: 0.3, sustain: 0.82, release: 0.34 },
      filterEnvelope: { attack: 0.09, decay: 0.45, sustain: 0.62, release: 0.35, baseFrequency: 520, octaves: 2.1 },
    })).connect(lp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 0.8 })).connect(lp);
    const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.03, decay: 0.15, sustain: 0.06, release: 0.2 } })).connect(bp);
    breath.volume.value = -30;
    const mono = I.monotonic(out), monoB = I.monotonic(out);
    return {
      out,
      play(time, e, dur) {
        const m = typeof e.note === "number" ? e.note : 70;
        const t = mono(time), f = T.hz(m);
        s.triggerAttackRelease(f, dur, t, e.vel);
        if (e.scoop) { s.frequency.setValueAtTime(T.hz(m - e.scoop), t + 0.001); s.frequency.exponentialRampToValueAtTime(f, t + 0.11); }
        if (e.fall && dur > 0.4) {
          const a = t + dur - 0.1;
          s.frequency.setValueAtTime(f, a);
          s.frequency.exponentialRampToValueAtTime(T.hz(m - e.fall), a + 0.34);
        }
        vib.depth.cancelScheduledValues(t);
        vib.depth.setValueAtTime(0.004, t);
        if (dur > 0.6) vib.depth.linearRampToValueAtTime(0.045 * (e.vib ?? 1), t + Math.min(1.3, dur * 0.55));
        breath.triggerAttackRelease(Math.min(0.25, dur), monoB(time), e.vel * 0.8);
      },
    };
  }
  /** A brush stirred in a slow circle: pink noise, slow swell, band moving up and back down. */
  function stir(ctx, I, dest, gainDb) {
    const g = ctx.keep(new Tone.Gain(db(gainDb))).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 1800, Q: 0.7 })).connect(g);
    const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.28, decay: 0.3, sustain: 0.6, release: 0.45 } })).connect(bp);
    const mono = I.monotonic(g);
    return (time, vel, durSec) => {
      const t = mono(time), d = Math.max(0.2, durSec);
      n.triggerAttackRelease(d * 0.8, t, vel);
      bp.frequency.cancelScheduledValues(t);
      bp.frequency.setValueAtTime(1450, t);
      bp.frequency.linearRampToValueAtTime(2700, t + d * 0.45);
      bp.frequency.linearRampToValueAtTime(1600, t + d * 0.95);
    };
  }

  Sim.register({
    id: "overtime",
    title: "Overtime",
    genre: "Lounge jazz",
    about: "A ballad in D♭ for city hall after hours: a cup-muted flugelhorn sings a 32-bar tune over rolled Rhodes voicings, an upright in two and slowly stirred brushes; the bridge drifts to A major under soft strings, the Rhodes takes half a chorus, and a slowing ii–V tag turns into the next chorus.",
    bpm: 64, swing: 0.6, beatsPerBar: 4, cycleBars: 8, gainDb: -3.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 250, highcut: 6500 });
      const hall = I.reverb(ctx, out, { decay: 5.2, preDelay: 0.04, lowcut: 350, highcut: 5200 });
      const echo = I.delay(ctx, out, { time: "4n", feedback: 0.22, highcut: 2200 });
      const horn = flugel(ctx, I, { volume: 0, cutoff: 1900 });
      const rhodes = I.rhodes(ctx, { volume: -7, cutoff: 3000, tremolo: 2.6, tremoloDepth: 0.22, bark: 1.9, tine: -16 });
      const solo = I.rhodes(ctx, { volume: -2, cutoff: 3800, tremolo: 0.01, tremoloDepth: 0, bark: 2.1, tine: -13 });
      const strings = I.strings(ctx, { volume: -15, cutoff: 1500, attack: 1.5, release: 2.6 });
      const bass = I.upright(ctx, { volume: -5, base: 140 });
      const kit = I.kit(ctx, { volume: 2, preload: ["brushSweep", "hatPedal", "softKick"] });
      const hp = I.place(ctx, horn, 0.08, out), rp = I.place(ctx, rhodes, -0.26, out), sp = I.place(ctx, solo, 0.2, out);
      const stp = I.place(ctx, strings, 0.3, out);
      I.place(ctx, bass, 0, out);
      const kp = I.place(ctx, kit, 0.06, out);
      const stirPan = ctx.keep(new Tone.Panner(-0.12)).connect(out);
      const brush = stir(ctx, I, stirPan, 3);
      I.send(ctx, hp, hall, -9); I.send(ctx, hp, echo, -21); I.send(ctx, rp, room, -12); I.send(ctx, rp, hall, -19);
      I.send(ctx, sp, room, -10); I.send(ctx, sp, hall, -17); I.send(ctx, stp, hall, -8);
      I.send(ctx, kp, room, -13); I.send(ctx, stirPan, room, -12); I.send(ctx, bass.out, room, -24);
      const keys = (inst) => (t, e, d) => {
        if (e.roll && Array.isArray(e.note)) e.note.slice().sort((a, b) => a - b).forEach((m, i, xs) => inst.play(t + i * e.roll, m, Math.max(0.1, d - i * e.roll), e.vel * (0.9 + (i === xs.length - 1 ? 0.1 : 0))));
        else inst.play(t, e.note, d, e.vel);
      };
      return {
        flugel: { layer: "melody", play: (t, e, d) => horn.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        solo: { layer: "melody", play: keys(solo), humanize: { timing: 0.012, vel: 0.06 } },
        comp: { layer: "harmony", play: keys(rhodes), humanize: { timing: 0.01, vel: 0.05 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        brushes: {
          layer: "drums",
          play: (t, e, d) => (e.note === "stir" ? brush(t, e.vel, d) : kit.hit(e.note, t, e.vel, { dur: e.sweep })),
          humanize: { timing: 0.012, vel: 0.12 },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % ROUND.length, round = Math.floor(cycle / ROUND.length);
      const { key, kind } = ROUND[idx];
      const intro = cycle === 0;
      const next = ROUND[(idx + 1) % ROUND.length];
      const prog = PROG[key];
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(Math.max(0, b)).chord;
      const ev = [];
      // ritardando for the tag: later beats arrive progressively late (the pickup into the next chorus is a tempo)
      const rit = (b) => (kind !== "tag" || b <= 16 ? 0 : (intro ? 0.005 : 0.011) * Math.pow(Math.min(b, 30) - 16, 1.5));
      const push = (track, abs, dur, note, vel, extra = {}) => {
        const p = C.at(abs, 4);
        const d = dur; // the conductor swings note ends as well as starts
        const delay = (extra.delay || 0) + (abs >= 0 ? rit(abs) : 0);
        ev.push({ track, bar: p.bar, beat: p.beat, dur: Math.max(0.05, d), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra, delay });
      };

      // ---------- who plays what ----------
      const rhodesHead = kind === "head" && key === "A1" && round % 3 === 2; // every third round the pianist takes the first A
      const hornPlays = (kind === "head" && !rhodesHead) || kind === "out" || (kind === "tag" && !intro);
      const keysMelody = rhodesHead || intro;
      const orn = [0.22, 0.38, 0.3][round % 3];
      const lagMax = [0.05, 0.08, 0.065][round % 3];

      // ---------- melody ----------
      const myLead = hornPlays ? "flugel" : keysMelody ? "solo" : null;
      const tune = TUNE[key] ? toNotes(TUNE[key]) : null;
      if (myLead && tune) {
        // pickup into this section (it sits in the previous section's last bar, which the tune leaves empty)
        const notes = (PICKUP[key] ? toNotes(PICKUP[key]) : []).concat(tune);
        // where the next melodic note falls: the next section's pickup, its first note, or nowhere (solo follows)
        const after = next.kind === "solo" ? 40 : PICKUP[next.key] ? 31 : 32 + TUNE[next.key][0][0];
        const base = { A1: 0.6, A2: 0.63, B: kind === "out" ? 0.74 : 0.7, A3: 0.64, A3out: 0.66, TAG: 0.6 }[key];
        perform(notes, {
          r: r.fork(11), track: myLead, horn: myLead === "flugel", after, base, orn: kind === "out" ? orn + 0.08 : orn, lagMax,
          fade: kind === "tag" ? 0.22 : 0, sym, chordAt, push,
        });
      }

      // ---------- Rhodes solo (right hand) ----------
      if (kind === "solo") rhodesSolo(key, r.fork(21), state, sym, push);

      // ---------- comping ----------
      let compMode = "head";
      if (kind === "solo" || keysMelody) compMode = "shell";
      if (key === "B") compMode = "bridge";
      if (kind === "tag" && !intro) compMode = "tag";
      comp(prog, compMode, r.fork(31), state, push, { intro, tune: myLead ? tune : null });

      // ---------- strings ----------
      const tn = myLead ? tune : null;
      if (key === "B") strings(prog, 0, r.fork(41), state, push, kind === "out" ? 0.5 : 0.42, true, tn);
      else if (kind === "tag" && !intro) strings(prog, 2, r.fork(41), state, push, 0.4, true, tn);
      else if (kind === "head" && key === "A3" && round % 3 === 1) strings(prog, 4, r.fork(41), state, push, 0.32, false, tn);
      else state.strPrev = null;

      // ---------- bass ----------
      let bassMode = "two";
      if (kind === "tag") bassMode = "tag";
      else if (kind === "solo" && key === "A2") bassMode = "walk";
      else if (kind === "head" && key === "A1" && round === 0) bassMode = "open";
      bassLine(prog, bassMode, r.fork(51), state, push, FIRST[next.key], intro);

      // ---------- brushes ----------
      brushes(kind, key, intro, round, r.fork(61), push);

      let label;
      const chorus = 2 * round + (kind === "head" ? 1 : 2);
      const part = { A1: "A1", A2: "A2", B: "bridge", A3: "last A, reharmonized", A3out: "last A, reharmonized" }[key];
      if (intro) label = "Intro · Rhodes alone, after hours";
      else if (kind === "tag") label = "Tag · the ii–V one more time, slowing";
      else if (kind === "head") label = `Chorus ${chorus} · ${part} · ${rhodesHead ? "Rhodes takes the first A" : "flugelhorn head"}${key === "B" ? ", strings" : ""}`;
      else if (kind === "solo") label = `Chorus ${chorus} · ${part} · Rhodes solo${key === "A2" ? ", bass walks" : ""}`;
      else label = `Chorus ${chorus} · ${part} · head out${key === "B" ? ", strings" : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });

  // ---------- melody performance ----------
  /** Play a written line with rubato lag, scoops, grace notes, fall-offs and phrase-shaped dynamics. */
  function perform(notes, o) {
    const { r, push } = o;
    let lag = 0, prevEnd = -Infinity;
    notes.forEach((n, i) => {
      const nextStart = i + 1 < notes.length ? notes[i + 1].beat : o.after;
      const gapAfter = nextStart - (n.beat + n.dur);
      const gapBefore = n.beat - prevEnd;
      if (gapBefore >= 0.5 || i === 0) lag = n.beat < 0 ? 0.005 : r.range(0.008, o.lagMax); // a new phrase sets its own lateness
      const long = n.dur >= 1.5;
      const extra = { delay: lag + (long ? 0.015 : 0) };
      if (o.horn) {
        extra.vib = long ? 1 : 0.5;
        const isLast = i === notes.length - 1;
        if (n.dur >= 1 && gapAfter >= 0.45 && !(isLast && o.fade) && r.chance(o.orn + 0.12)) extra.fall = r.pick([3, 4, 4, 5]);
        if (n.dur >= 1 && !extra.fall && r.chance(o.orn * 0.6)) extra.scoop = 1;
      }
      // grace note from a step above before some long notes
      if (long && i > 0 && gapBefore >= 0.4 && n.beat >= 0 && r.chance(o.orn * 0.5)) {
        const g = T.step(n.note, 1, T.chord(o.sym(n.beat)).scale);
        if (g - n.note <= 2) push(o.track, n.beat - 0.16, 0.12, g, 0.5, { straight: true, delay: extra.delay });
        delete extra.scoop;
      }
      const shape = 0.05 * (n.note - 70) / 8 + (long ? 0.04 : 0) + (n.beat < 0 ? -0.08 : 0);
      const fade = o.fade ? 1 - o.fade * Math.max(0, n.beat) / 32 : 1;
      const vel = (o.base + shape + r.gauss(0.025)) * fade;
      // leave a little air before the next attack so a monophonic release never cuts the following note
      const dur = gapAfter < 0.3 ? n.dur - 0.09 - extra.delay / 0.9375 : n.dur * 0.97;
      if (!o.horn && long && n.beat >= 0) { // the pianist harmonizes long melody notes from below, within the chord
        const h = o.chordAt(n.beat), c = T.chord(h.chord);
        const below = T.notesIn(c.pcs, n.note - 9, n.note - 3);
        const until = h.bar * 4 + h.beat + h.dur - n.beat - 0.1;
        if (below.length && until >= 1) push(o.track, n.beat, Math.min(dur, until), below[below.length - 1], vel * 0.7, { delay: extra.delay + 0.012 });
      }
      push(o.track, n.beat, dur, n.note, o.horn ? vel : vel * 0.85, extra);
      prevEnd = n.beat + n.dur;
    });
  }

  // ---------- Rhodes solo ----------
  function rhodesSolo(key, r, state, sym, push) {
    const base = { chordAt: sym, lo: 65, hi: 84, rng: r, chromatic: 0.15, register: 0.5, upbeatStart: 0.5, motifProb: 0.45 };
    const out = [];
    let motif = state.soloMotif || HEAD_MOTIF, last = state.soloLast ?? 72;
    const run = (start, end, density, extra = {}) => {
      const m = C.line({ ...base, start, end, density, phrase: [4, 7], rest: [1, 2.5], motif, prev: last, ...extra });
      out.push(...m.notes); motif = m.motif; last = m.last;
    };
    if (key === "A1") run(0, 31, 0.28 + 0.1 * r(), { lead: r.pick([0.5, 1, 1.5]) });
    else {
      run(0, 15, 0.34, { lead: r.pick([0, 0.5]) });
      if (r.chance(0.75)) { // a short double-time run over bars 5–6: lazy swung 16ths up the chord, down the scale, landing on a guide tone
        const c = T.chord(sym(16)), sc = c.scale;
        let m = T.nearest(Math.min(last, 72), c.pcs, 65, 74);
        const run16 = [m];
        T.notesIn(c.pcs, m + 1, 88).slice(0, r.pick([3, 4])).forEach((x) => run16.push(x));
        m = run16[run16.length - 1];
        const down = r.int(5, 7);
        for (let i = 0; i < down; i++) { m = T.step(m, -1, sc); run16.push(m); }
        const t0 = 19 - run16.length * 0.25;
        run16.forEach((x, i) => out.push({ beat: t0 + i * 0.25 + (i % 2 ? 0.035 : 0), dur: 0.22, note: x, vel: 0.6 + (i === 0 ? 0.05 : 0) - i * 0.006, strong: false, straight: true }));
        const land = T.nearest(m - 1, c.guide.concat(c.colors), 62, 84);
        out.push({ beat: 19, dur: 1.2, note: land, vel: 0.62, strong: true });
        last = land;
        run(21, 30, 0.25);
      } else run(17, 30, 0.3);
    }
    state.soloMotif = motif; state.soloLast = last;
    out.forEach((n) => push("solo", n.beat, Math.max(0.3, n.dur), n.note, 0.4 + (n.vel - 0.6) * 1.2 + (n.strong ? 0.04 : 0), n.straight ? { straight: true } : {}));
  }

  // ---------- comping ----------
  const COMP4 = [[[[0, 3.7]], 3], [[[0, 1.8], [2.5, 1.3]], 1.2], [[[-0.5, 4.1]], 1], [[[0, 1.4], [1.5, 2.3]], 0.8], [[[0.5, 3.2]], 0.6]];
  const COMP2 = [[[[0, 1.85]], 3], [[[-0.5, 2.3]], 1], [[[0.5, 1.4]], 0.6]];
  const SHELL4 = [[[[0, 2.8]], 3], [[[0, 1.4], [2.5, 1.2]], 1.5], [[[-0.5, 2.5]], 1], [[[1, 2.6]], 0.8]];
  const SHELL2 = [[[[0, 1.7]], 3], [[[-0.5, 1.9]], 1], [[[0.5, 1.2]], 0.7]];

  function shape(sym, { lo, hi, top, prev, r, n, ceil = 999 }) {
    const c = T.chord(sym), forms = SHAPES[qual(sym)];
    if (!forms) return T.voice(sym, { lo, hi, top, prev, n: n || 4, rng: r });
    let best = null, bestS = Infinity;
    for (const f0 of forms) {
      const f = n ? f0.slice(0, n) : f0;
      for (let base = c.root; base <= hi; base += 12) {
        const v = f.map((i) => base + i);
        if (v[0] < lo || v[v.length - 1] > hi) continue;
        let s = 0;
        for (let i = 1; i < v.length; i++) {
          const gap = v[i] - v[i - 1];
          if (v[i - 1] < 52 && gap < 3) s += 20;
          if (v[i - 1] < 48 && gap < 5) s += 8;
          if (gap === 1) s += v.length <= 3 ? 9 : v[i - 1] < 57 ? 7 : i === v.length - 1 ? 5 : 2; // semitones: thin or low ones muddy, top one exposed
          if (v[i - 1] < 55 && gap === 2) s += 3;
          if (v[i - 1] < 52 && gap === 3) s += 4;
        }
        const t = v[v.length - 1];
        if (top) { if (t < top[0]) s += (top[0] - t) * 1.5; if (t > top[1]) s += (t - top[1]) * 2.2; }
        if (prev && prev.length) {
          const a = v, b = prev.slice().sort((x, y) => x - y), m = Math.min(a.length, b.length);
          for (let i = 0; i < m; i++) s += Math.abs(a[a.length - 1 - i] - b[b.length - 1 - i]) * 0.7;
          s += Math.abs((a[0] + t) / 2 - (b[0] + b[b.length - 1]) / 2) * 0.4;
        }
        s += Math.abs((v[0] + t) / 2 - (lo + hi) / 2) * (prev && prev.length ? 0.25 : 0.5); // resist drifting
        if (t > ceil - 2) s += (t - ceil + 2) * 3; // stay under the melody
        s += r() * 1.2;
        if (s < bestS) { bestS = s; best = v; }
      }
    }
    return best || T.voice(sym, { lo, hi, top, prev, n: n || 4, rng: r });
  }

  function comp(prog, mode, r, state, push, o) {
    const cfg = {
      head: { lo: 50, hi: 69, top: [60, 66], n: 0, vel: 0.46 },
      shell: { lo: 47, hi: 64, top: [55, 62], n: 3, vel: 0.4 },
      bridge: { lo: 50, hi: 65, top: [59, 64], n: 3, vel: 0.4 },
      tag: { lo: 51, hi: 68, top: [59, 65], n: 0, vel: 0.44 },
    }[mode];
    const hits = prog.map((c, i) => {
      const s0 = c.bar * 4 + c.beat;
      const under = o.tune ? o.tune.filter((m) => m.dur >= 1 && m.beat < s0 + c.dur && m.beat + m.dur > s0 - 0.5).map((m) => m.note) : [];
      let v = shape(c.chord, { lo: cfg.lo, hi: cfg.hi, top: cfg.top, prev: state.voicing, r, n: cfg.n, ceil: under.length ? Math.min(...under) : 999 });
      state.voicing = v;
      if (mode === "tag" && s0 === 24) { // the arrival gets a wide roll with a color tone on top
        const ch = T.chord(c.chord), t = v[v.length - 1];
        const up = T.notesIn(ch.colors.concat(ch.guide), t + 3, t + 7);
        if (up.length) v = v.concat(up[0]);
      }
      let pat;
      if (mode === "bridge" || mode === "tag") pat = [[0, c.dur - 0.1]];
      else {
        const pats = mode === "head" ? (c.dur >= 4 ? COMP4 : COMP2) : (c.dur >= 4 ? SHELL4 : SHELL2);
        pat = r.weighted(i === 0 ? pats.filter(([p]) => p[0][0] === 0) : pats);
      }
      const roll = mode === "tag" && s0 >= 24 ? 0.06 : mode === "shell" ? 0.012 : r.range(0.015, 0.04);
      return pat.map(([b, d], j) => ({ at: s0 + b, d, v, roll: j === 0 ? roll : 0 }));
    });
    hits.forEach((hs, i) => {
      const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : 32;
      hs.filter((h) => h.at < nextStart - 0.25).forEach((h, j) => {
        let vel = cfg.vel + r.range(-0.04, 0.05) - (j > 0 ? 0.06 : 0);
        if (o.intro && h.at < 16) vel -= 0.04;
        if (mode === "tag") vel *= 1 - 0.25 * (h.at / 32);
        push("comp", h.at, Math.min(h.d, nextStart - h.at - 0.05), h.v, vel, h.roll ? { roll: h.roll } : {});
      });
    });
    // fills in the melody's longer rests (and only there)
    if (o.tune && mode !== "shell") {
      for (let i = 0; i < o.tune.length; i++) {
        const end = o.tune[i].beat + o.tune[i].dur, nxt = i + 1 < o.tune.length ? o.tune[i + 1].beat : 31;
        const at = Math.ceil((end + 0.25) * 2) / 2;
        if (nxt - at < 1.5 || (mode === "tag" && at >= 24) || !r.chance(0.6)) continue;
        const c = T.chord(prog.find((h) => h.bar * 4 + h.beat <= at + 1e-6 && at < h.bar * 4 + h.beat + h.dur)?.chord || prog[0].chord);
        const pool = T.notesIn(c.guide.concat(c.colors), 70, 82);
        if (pool.length < 2) continue;
        const k = Math.min(3, Math.floor((nxt - at - 0.5) / 0.5));
        let m = pool[pool.length - 1 - r.int(0, 1)];
        for (let j = 0; j < k; j++) {
          push("comp", at + j * 0.5, 0.45, m, 0.32 - j * 0.03);
          const lower = pool.filter((x) => x < m);
          if (!lower.length) break;
          m = lower[lower.length - 1];
        }
      }
    }
  }

  // ---------- strings ----------
  function strings(prog, fromBar, r, state, push, vel, high, tune) {
    prog.filter((c) => c.bar >= fromBar).forEach((c, i, xs) => {
      const s0 = c.bar * 4 + c.beat;
      const under = tune ? tune.filter((m) => m.dur >= 1 && m.beat < s0 + c.dur && m.beat + m.dur > s0).map((m) => m.note) : [];
      const v = shape(c.chord, { ...(high ? { lo: 56, hi: 72, top: [64, 70] } : { lo: 53, hi: 68, top: [60, 65] }), n: 3, prev: state.strPrev, r, ceil: under.length ? Math.min(...under) : 999 });
      state.strPrev = v;
      const swell = 1 + 0.15 * Math.sin(Math.PI * (c.bar + c.beat / 4 + 0.5) / 8);
      push("strings", c.bar * 4 + c.beat, c.dur + (i + 1 < xs.length ? 0.05 : 0.8), v, vel * swell + r.range(-0.03, 0.03));
    });
  }

  // ---------- bass ----------
  function bassLine(prog, mode, r, state, push, nextFirst, intro) {
    let last = state.bassLast ?? 44;
    const pick = (pc, from = last) => {
      let best = null, bs = Infinity;
      for (let m = 33; m <= 50; m++) if (mod12(m) === pc) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 41); if (s < bs) { bs = s; best = m; } }
      return best;
    };
    const fifthOf = (c, root) => {
      const iv = c.intervals.find((i) => i >= 6 && i <= 8) ?? 7;
      const opts = [root + iv, root + iv - 12].filter((m) => m >= 31 && m <= 52);
      return opts.sort((a, b) => Math.abs(a - root) - Math.abs(b - root))[0] ?? root;
    };
    prog.forEach((e, i) => {
      const s0 = e.bar * 4 + e.beat, c = T.chord(e.chord);
      const nxt = T.chord(i + 1 < prog.length ? prog[i + 1].chord : nextFirst);
      const root = pick(c.bass), nextRoot = pick(nxt.bass, root);
      const changes = nxt.bass !== c.bass;
      const sameAsPrev = i > 0 && e.beat > 0 && T.chord(prog[i - 1].chord).bass === c.bass; // e.g. sus → dominant inside a bar
      const approach = (cur) => { const xs = [nextRoot + 1, nextRoot - 1].filter((m) => m !== cur && m >= 31 && m <= 52); return xs.length ? r.pick(xs) : nextRoot; };
      if (mode === "tag") {
        if (intro && s0 < 16) { last = root; return; } // the bass enters halfway through the intro
        // the last note must let go before the next chorus's downbeat despite the ritardando
        push("bass", s0, s0 >= 28 ? 3.3 : e.dur - 0.15, root, s0 >= 24 ? 0.7 : 0.78);
      } else if (mode === "walk") {
        let prev = sameAsPrev ? fifthOf(c, last) : root;
        push("bass", s0, 0.92, prev, 0.8);
        for (let b = 1; b < e.dur; b++) {
          let n;
          if (b === e.dur - 1 && changes) {
            n = r.chance(0.75) ? approach(prev) : T.step(nextRoot, r.chance(0.5) ? 1 : -1, c.scale);
            if (n === prev || n === nextRoot) n = approach(prev);
          }
          else {
            const pool = T.notesIn(c.pcs.slice(0, 4), 33, 52).filter((m) => m !== prev && Math.abs(m - prev) <= 7);
            n = pool.length ? r.pick(pool) : T.step(prev, 1, c.scale);
          }
          n = Math.max(31, Math.min(52, n));
          push("bass", s0 + b, 0.92, n, b % 2 ? 0.68 : 0.74);
          prev = n;
        }
      } else if (mode === "open" && s0 < 16) {
        push("bass", s0, e.dur - 0.15, sameAsPrev ? fifthOf(c, last) : root, 0.74);
      } else if (e.dur >= 4) {
        const hold = r.chance(0.12);
        push("bass", s0, hold ? 3.8 : 1.85, root, 0.8);
        if (!hold) {
          const kindOf = r.weighted([["fifth", 3], ["third", 1], ["approach", changes ? 1.6 : 0]]);
          let n;
          if (kindOf === "fifth") n = fifthOf(c, root);
          else if (kindOf === "third") n = pick(mod12(c.root + (c.intervals.includes(3) ? 3 : c.intervals.includes(4) ? 4 : 5)), root);
          else n = r.chance(0.5) ? approach(root) : fifthOf(nxt, nextRoot);
          n = Math.max(31, Math.min(52, n));
          const eighth = changes && kindOf !== "approach" && r.chance(0.18);
          push("bass", s0 + 2, eighth ? 1.4 : 1.85, n, 0.7);
          if (eighth) push("bass", s0 + 3.5, 0.4, approach(n), 0.58);
        }
      } else {
        const eighth = changes && r.chance(0.15);
        const n = sameAsPrev ? fifthOf(c, last) : root; // a repeated root (sus → dominant, maj → minor) moves to the fifth
        push("bass", s0, eighth ? 1.4 : 1.85, n, s0 % 4 === 0 ? 0.8 : 0.72);
        if (eighth) push("bass", s0 + 1.5, 0.4, approach(n), 0.56);
      }
      last = root;
    });
    state.bassLast = last;
  }

  // ---------- brushes ----------
  function brushes(kind, key, intro, round, r, push) {
    const walk = kind === "solo" && key === "A2";
    const pedal = !(kind === "head" && key === "A1") || round > 0;
    const lift = key === "B" ? 0.04 : 0;
    for (let bar = 0; bar < 8; bar++) {
      const B = bar * 4;
      let mode = walk ? "four" : "two";
      if (kind === "tag") mode = intro ? (bar < 4 ? "none" : bar < 6 ? "stir" : bar === 6 ? "long" : "cue") : (bar < 4 ? "two" : bar < 6 ? "stir" : bar === 6 ? "long" : "none");
      if (kind === "head" && key === "A1" && round === 0 && bar < 4) mode = "stir";
      if (mode === "none") continue;
      if (mode === "cue") { push("brushes", B + 3, 0.5, "brushSweep", 0.3, { sweep: 0.5 }); continue; }
      if (mode === "long") { push("brushes", B, 3.5, "stir", 0.2); continue; }
      const sv = (mode === "stir" ? 0.22 : 0.3) + lift;
      if (mode === "four") for (let b = 0; b < 4; b++) push("brushes", B + b, 0.95, "stir", sv - 0.04 + (b % 2) * 0.03);
      else { push("brushes", B, 1.9, "stir", sv + r.range(-0.02, 0.02)); push("brushes", B + 2, 1.9, "stir", sv - 0.03 + r.range(-0.02, 0.02)); }
      if (mode === "stir") continue;
      for (const b of [1, 3]) {
        push("brushes", B + b, 0.4, "brushSweep", 0.24 + lift + r.range(-0.03, 0.03), { sweep: 0.32 });
        if (pedal) push("brushes", B + b, 0.1, "hatPedal", 0.16);
      }
      // a pull into the next section at the end of A2 and the bridge
      if (bar === 7 && (key === "A2" || key === "B") && kind !== "solo") push("brushes", B + 3.5, 0.5, "brushSweep", 0.36, { sweep: 0.45 });
      if (bar === 0 && key === "B") push("brushes", B, 0.1, "softKick", 0.22);
    }
  }
})();

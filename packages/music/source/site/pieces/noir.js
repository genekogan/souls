// Rain on Fifth: a late-night detective score in C minor at 72 BPM, for an investigation or a slow dance
// with somebody you shouldn't trust.
//
// The colours are the noir ones: minor-major ninths (C Eb G B D), the Neapolitan Dbmaj9#11, half-diminished
// ii chords into 7b9 dominants, the minor line cliché (C - B - Bb - A under the tune), Db9#11 as a tritone
// substitute, and a pedal C under shifting chords for the stakeout. A tenor sax sings, a harmon-muted
// trumpet answers and takes the major-key turn, a soft piano plays dark rolled voicings, vibes add colour
// in the gaps, the upright moves between half-time and a slow walk, brushes stir in two-beat circles
// with the odd rim click, low strings swell when something is about to happen, and it rains throughout
// (two decorrelated pink-noise channels with gusts, plus drips off the fire escape).
//
// A round (9 cycles of 8 bars, about 4 minutes):
//   The street    sparse: rain, rolled CmMaj9 / Dbmaj9#11 chords, a vibraphone figure, bass in half notes
//   The office    the sax tune, 16 bars (the line cliché, Fm9 - Bb13 - Ebmaj7, a Db9#11 tritone sub)
//   The stakeout  16 bars over a C pedal: a straight-eighth piano ostinato against the swing, a heartbeat
//                 bass, ticking brushes, low strings; the second half climbs, the trumpet cries
//   The dame      the stakeout's G7b9 resolves deceptively to Ab major: the trumpet's lyrical tune over a
//                 slow walk and a soft ride, then Dbmaj9#11 and a ii-V home
//   The office    the tune again, embellished, then a piano solo (a vibes solo in alternate rounds)
// Alternate rounds swap the horns: the trumpet takes the office tune and the sax the dame.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation ----------
  // "G4/.5 C5/1.5 r/2 | ..." -> [{beat, dur, note}]. Bars add up to 4 beats.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`noir: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`noir: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }

  // ---------- the book ----------
  const SRC = {
    street: {
      harm: "| CmMaj9 | Dbmaj9#11 | CmMaj9 | Dbmaj9#11 | Abmaj7#11 | Fm9 | Dm7b5 | G7b9 |",
      vibes: "r/1 G5/.5 B5/.5 D6/2 | r/2 C6/1 G5/1 | r/4 | r/1 F5/.5 Ab5/.5 Eb6/2 | D6/2 r/2 | r/2 Ab5/1 G5/1 | r/4 | r/1 Ab5/1 F5/1 B4/1",
    },
    officeA: {
      harm: "| Cm9 | CmMaj9 | Cm9 | Cm6 | Fm9 | Bb13 | Ebmaj7 | Dm7b5 G7b9 |",
      mel: "r/1.5 G4/.5 C5/.5 D5/.5 Eb5/1 | D5/2.5 B4/.5 C5/1 | Bb4/1.5 G4/.5 Eb4/1 F4/1 | A4/3 r/1 | " +
        "r/.5 Ab4/.5 C5/.5 Eb5/.5 G5/2 | F5/1 Eb5/.5 D5/.5 G5/1.5 r/.5 | G5/.5 F5/.5 D5/1 Bb4/2 | Ab4/1 F4/1 B4/1 Ab4/1",
    },
    officeA2: {
      harm: "| Cm9 | CmMaj9 | Cm9 | F13 | Abmaj7#11 | Db9#11 | Dm7b5 | G7b9 |",
      mel: "r/1.5 G4/.5 C5/.5 D5/.5 Eb5/1 | G5/2.5 F5/.5 Eb5/1 | D5/1.5 C5/.5 Bb4/2 | A4/1.5 C5/.5 Eb5/2 | " +
        "D5/2 C5/1 G4/1 | F4/1.5 G4/.5 Ab4/1 B4/1 | C5/2 Ab4/1 F4/1 | Ab4/1.5 G4/.5 B3/2",
    },
    stakeout: {
      harm: "| CmMaj9 | Dbmaj7/C | CmMaj9 | Dbmaj7/C | Bbm7/C | Bdim7/C | Abmaj7#11/C | G7b9 |",
      cries: "r/4 | r/1 G5/1 Ab5/.5 G5/1.5 | r/4 | r/1 Ab5/1 Bb5/.5 Ab5/1.5 | r/4 | r/1 F5/1 Ab5/.5 B5/1.5 | r/4 | r/1 Ab5/1 G5/2",
    },
    dameA: {
      harm: "| Abmaj9 | Fm9 | Bbm9 | Eb13 | Cm7 | F7b9 | Bbm9 | Eb13sus4 |",
      mel: "C5/1.5 Bb4/.5 Eb5/2 | Ab5/1.5 G5/.5 C5/2 | Db5/1 C5/.5 Db5/.5 F5/2 | G5/2.5 F5/.5 C5/1 | " +
        "Eb5/1.5 D5/.5 G4/2 | A4/1 C5/.5 Eb5/.5 Gb5/2 | F5/1.5 Db5/.5 C5/2 | Bb4/3 r/1",
    },
    dameA2: {
      harm: "| Abmaj9 | Dbmaj9#11 | Gm7 | C7b9 | Fm9 | Bb13 | Dm7b5 | G7b9 |",
      mel: "C5/1.5 Bb4/.5 Eb5/1 G5/1 | Ab5/1 G5/1 F5/2 | Bb4/1.5 D5/.5 F5/2 | E5/1.5 Db5/.5 Bb4/2 | " +
        "Ab4/1 C5/.5 Eb5/.5 G5/2 | Ab5/1.5 G5/.5 D5/2 | F5/1 Eb5/.5 D5/.5 C5/2 | B4/2 Ab4/1 G4/1",
    },
  };
  const PH = {};
  for (const [k, s] of Object.entries(SRC)) {
    PH[k] = { prog: T.progression(s.harm) };
    for (const f of ["mel", "vibes", "cries"]) if (s[f]) PH[k][f] = line(s[f]);
  }
  // the stakeout ostinato: pedal, low, high, low (one cell per chord)
  const OST = {
    CmMaj9: ["C3", "G3", "B3", "G3"], "Dbmaj7/C": ["C3", "Ab3", "C4", "Ab3"], "Bbm7/C": ["C3", "F3", "Db4", "F3"],
    "Bdim7/C": ["C3", "Ab3", "D4", "Ab3"], "Abmaj7#11/C": ["C3", "G3", "D4", "G3"], G7b9: ["B2", "F3", "Ab3", "F3"],
  };

  const ROUND = [
    { s: "street" }, { s: "officeA" }, { s: "officeA2" }, { s: "stakeout", h: 1 }, { s: "stakeout", h: 2 },
    { s: "dameA" }, { s: "dameA2" }, { s: "officeA", ret: true }, { s: "officeA2", ret: true, solo: true },
  ];
  const RAIN = { street: -25, officeA: -31, officeA2: -31, stakeout: -28, dameA: -33, dameA2: -33 };

  // the line cliché under the office tune's first four bars: C - B - Bb - A between a fixed Eb and G
  const CLICHE = [[51, 60, 62, 67], [51, 59, 62, 67], [51, 58, 62, 67], [51, 57, 60, 67]];
  // comping rhythms for a chord span: [beat, dur]
  const COMP4 = [[[[0, 3.7]], 3], [[[0, 1.6], [2, 1.7]], 2], [[[0, 2.4], [3, 0.8]], 1.5], [[[1.5, 2.3]], 1], [[[0, 0.9], [1.5, 2.2]], 1.2]];
  const COMP2 = [[[[0, 1.8]], 3], [[[0, 0.8], [1, 0.8]], 1], [[[0.5, 1.3]], 1]];

  const near = (pc, from, lo, hi) => {
    let best = null, bs = Infinity;
    for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from); if (s < bs) { bs = s; best = m; } }
    return best;
  };
  const fifthOf = (c) => c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;

  /** A note leading into target t: a semitone either side, a scale step or the target's fifth, preferring ones that don't rub against chord c. */
  /** True when m is a tone of chord c or sits at least a whole step from all of them. */
  const safeOver = (c, m) => c.pcs.includes(mod12(m)) || !c.pcs.some((p) => [1, 11].includes(mod12(m - p)));
  function approach(c, t, last, r) {
    const safe = (m) => safeOver(c, m);
    let cands = [[t - 1, 3], [t + 1, 2.5], [T.step(t, 1, c.scale), 1.5], [T.step(t, -1, c.scale), 1.5], [t - 5, 1], [t + 7, 0.6]]
      .filter(([m]) => m !== last && m !== t && m >= 29 && m <= 52);
    const ok = cands.filter(([m]) => safe(m));
    if (ok.length) cands = ok;
    return cands.length ? r.weighted(cands) : t - 1;
  }
  /** A slow walk: roots on chord downbeats, chord tones between, a chromatic or scale approach into each change. */
  function walk(prog, total, nextPc, last, r, lo = 31, hi = 50) {
    const out = [];
    const starts = prog.map((e) => e.bar * BPB + e.beat);
    prog.forEach((e, i) => {
      const s = starts[i], end = i + 1 < prog.length ? starts[i + 1] : total;
      const c = T.chord(e.chord);
      const nc = i + 1 < prog.length ? T.chord(prog[i + 1].chord) : null;
      const nPc = nc ? nc.bass : nextPc;
      // the chord's root near the last note, with a pull toward the middle of the bass's range
      let n = null, bs = Infinity;
      for (const m of T.notesIn([c.bass], lo, hi)) { const sc = Math.abs(m - last) + 0.5 * Math.abs(m - 39); if (sc < bs) { bs = sc; n = m; } }
      out.push({ beat: s, note: n }); last = n;
      let prev2 = null;
      for (let b = s + 1; b < end; b++) {
        if (b === end - 1) { // approach the next root (avoiding a rub with the chord the piano is holding)
          n = approach(c, near(nPc, last, lo, hi), last, r);
        } else {
          // chord tones (root, third, fifth, seventh) or a passing step of the chord scale; never back where it just was
          const cands = T.notesIn(c.pcs.slice(0, 4), lo, hi).filter((m) => Math.abs(m - last) <= 7).map((m) => [m, 1])
            .concat([[T.step(last, 1, c.scale), 1.2], [T.step(last, -1, c.scale), 1.2]].filter(([m]) => safeOver(c, m)))
            .filter(([m]) => m !== last && m !== prev2 && m >= lo && m <= hi);
          n = cands.length ? r.weighted(cands) : T.step(last, r.chance(0.5) ? 1 : -1, c.scale);
        }
        n = Math.max(lo, Math.min(hi, n));
        out.push({ beat: b, note: n }); prev2 = last; last = n;
      }
    });
    return { notes: out, last };
  }

  // ---------- custom instruments ----------
  /** Rain: two decorrelated pink-noise channels, band-limited, with slow gusts. Each event holds the level for its duration. */
  function rain(ctx) {
    const out = ctx.keep(new Tone.Gain(1));
    const g = ctx.keep(new Tone.Gain(0)).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 })).connect(g);
    const hp = ctx.keep(new Tone.Filter({ frequency: 850, type: "highpass" })).connect(lp);
    [-0.65, 0.65].forEach((pan) => {
      const p = ctx.keep(new Tone.Panner(pan)).connect(hp);
      ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(p);
    });
    const gust = ctx.keep(new Tone.LFO({ frequency: 0.047, min: 3600, max: 6800 }).start());
    gust.connect(lp.frequency);
    const clock = ctx.I.monotonic(g);
    return {
      out,
      play(time, levelDb, secs) {
        const t = clock(time), lvl = db(Number.isFinite(levelDb) ? levelDb : -30);
        g.gain.cancelAndHoldAtTime(t);
        g.gain.linearRampToValueAtTime(lvl, t + 1.5);
        g.gain.setValueAtTime(lvl, t + secs);
        g.gain.linearRampToValueAtTime(0, t + secs + 2.5);
      },
    };
  }
  /** Drips off the fire escape: tiny sine chirps that rise as they fall off. */
  function drips(ctx) {
    const out = ctx.keep(new Tone.Gain(db(-16)));
    const hp = ctx.keep(new Tone.Filter({ frequency: 1400, type: "highpass" })).connect(out);
    const voices = [0, 1, 2].map(() => {
      const s = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03 } })).connect(hp);
      return { s, clock: ctx.I.monotonic(s) };
    });
    let i = 0;
    return {
      out,
      play(time, note, vel) {
        const v = voices[i++ % voices.length], t = v.clock(time), f = T.hz(Number.isFinite(note) ? note : 100);
        v.s.triggerAttackRelease(f, 0.05, t, vel);
        v.s.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.045);
      },
    };
  }

  Sim.register({
    id: "noir",
    title: "Rain on Fifth",
    genre: "Noir jazz",
    about: "A late-night detective score in C minor: a smoky tenor sax over minor-major ninths and half-diminished turnarounds, brushes and a lazy upright, a stakeout on a C pedal with a ticking ostinato and low strings, and a deceptive turn to A♭ major for the dame, with rain on the window the whole time.",
    situations: ["mystery", "romance"],
    energy: 0.35,
    bpm: 72, swing: 0.64, beatsPerBar: BPB, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 250, highcut: 6500 });
      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.045, lowcut: 350, highcut: 5000 });
      const echo = I.delay(ctx, out, { time: 0.62, feedback: 0.22, highcut: 2200 });
      const sax = I.sax(ctx, { volume: 0, cutoff: 2500, vibratoDepth: 0.045, breath: -21, glide: 0.04 });
      const tpt = I.mutedTrumpet(ctx, { volume: -1, vibratoDepth: 0.035 });
      const piano = I.softPiano(ctx, { volume: -6, cutoff: 3000, decay: 4.2 });
      const vibes = I.vibes(ctx, { volume: -9, decay: 3.8, motor: 4.0, motorDepth: 0.35 });
      const strings = I.strings(ctx, { volume: -10, cutoff: 1500, attack: 1.9, release: 2.6 });
      const bass = I.upright(ctx, { volume: -3 });
      const kit = I.kit(ctx, { volume: 4, kickNote: 33, preload: ["brushSweep", "brushTap", "hatPedal", "softKick", "rim", "ride"] });
      const wet = rain(ctx), drip = drips(ctx);

      const sp = I.place(ctx, sax, 0.08, out), tp = I.place(ctx, tpt, -0.18, out);
      const pp = I.place(ctx, piano, -0.26, out), vp = I.place(ctx, vibes, 0.36, out);
      const stp = I.place(ctx, strings, 0, out), bp = I.place(ctx, bass, 0, out), kp = I.place(ctx, kit, 0.05, out);
      wet.out.connect(out);
      const dp = I.place(ctx, drip, 0.3, out);
      I.send(ctx, sp, room, -10); I.send(ctx, sp, hall, -15); I.send(ctx, sp, echo, -22);
      I.send(ctx, tp, room, -10); I.send(ctx, tp, hall, -14); I.send(ctx, tp, echo, -19);
      I.send(ctx, pp, room, -11); I.send(ctx, pp, hall, -19);
      I.send(ctx, vp, hall, -11); I.send(ctx, stp, hall, -12);
      I.send(ctx, bp, room, -22); I.send(ctx, kp, room, -13); I.send(ctx, dp, hall, -6);

      return {
        sax: { layer: "melody", play: (t, e, d) => sax.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        trumpet: { layer: "melody", play: (t, e, d) => tpt.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        solo: { layer: "melody", play: (t, e, d) => (e.inst === "vibes" ? vibes : piano).play(t, e.note, d, e.vel), humanize: { timing: 0.012 } },
        piano: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.06 } },
        ostinato: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        vibes: { layer: "harmony", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.02 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.006 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.len }), humanize: { timing: 0.008, vel: 0.12 } },
        rain: { layer: "texture", play: (t, e, d) => wet.play(t, e.level, d), humanize: { timing: 0, vel: 0 } },
        drips: { layer: "texture", play: (t, e) => drip.play(t, e.pitch, e.vel), humanize: { timing: 0.02, vel: 0.2 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bass == null) Object.assign(state, { bass: 36, cv: null, sv: null });
      const round = Math.floor(cycle / ROUND.length), S = ROUND[cycle % ROUND.length];
      const N = ROUND[(cycle + 1) % ROUND.length];
      const swap = round % 2 === 1; // alternate rounds: trumpet takes the office, sax the dame
      const P = PH[S.s], prog = P.prog;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const nextFirst = T.chord(PH[N.s].prog[0].chord);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const lead = []; // sounding melody notes, for the accompaniment's clash check
      const s = S.s;
      const office = s === "officeA" || s === "officeA2", dame = s === "dameA" || s === "dameA2";

      // ---------------------------------------------------------------- melody
      function sing(track, notes, o = {}) {
        let prev = o.prev ?? null;
        notes.forEach((n, i) => {
          let note = n.note + (o.shift || 0);
          const next = notes[i + 1];
          const legato = next && Math.abs(next.beat - (n.beat + n.dur)) < 1e-6;
          // embellishments on the return: a chromatic scoop into leapt-to long notes, a neighbour in a long note
          if (o.orn && prev != null && n.dur >= 1.5 && Math.abs(note - prev) >= 3 && r.chance(0.45)) {
            push(track, n.beat - 0.17, 0.15, note - 1, (o.vel ?? 0.66) * 0.8, { straight: true });
          }
          if (o.orn && n.dur >= 2.5 && r.chance(0.35)) {
            const sc = T.chord(sym(n.beat)).scale;
            push(track, n.beat, 1.4, note, o.vel ?? 0.66, { delay: 0.03 });
            push(track, n.beat + 1.5, 0.45, T.step(note, 1, sc), (o.vel ?? 0.66) * 0.85);
            push(track, n.beat + 2, n.dur - 2, note, (o.vel ?? 0.66) * 0.9);
          } else {
            const long = n.dur >= 2;
            push(track, n.beat, legato ? n.dur : n.dur * 0.92, note, (o.vel ?? 0.66) + (long ? -0.04 : 0) + (n.beat % 1 === 0 ? 0.03 : 0), { delay: 0.025 });
          }
          lead.push({ a: n.beat, b: n.beat + n.dur, note });
          prev = note;
        });
      }
      const officeHorn = swap ? "trumpet" : "sax", dameHorn = swap ? "sax" : "trumpet";
      if (office && !S.solo) sing(officeHorn, P.mel, { vel: 0.68, orn: S.ret || round > 0 });
      if (office && S.solo) {
        // the office tune's harmony under a solo: piano in even rounds, vibes in odd ones
        const inst = swap ? "vibes" : "piano";
        const m = C.line({ start: 0, end: 30, chordAt: sym, lo: inst === "vibes" ? 65 : 62, hi: inst === "vibes" ? 89 : 84, rng: r, density: 0.38, phrase: [3, 7], rest: [1, 2.5],
          motif: state.soloMotif, motifProb: 0.4, chromatic: 0.3, register: 0.5, prev: state.soloLast, upbeatStart: 0.5 });
        state.soloMotif = m.motif; state.soloLast = m.last;
        m.notes.forEach((n) => { push("solo", n.beat, n.dur, n.note, 0.5 + (n.vel - 0.6), { inst }); lead.push({ a: n.beat, b: n.beat + n.dur, note: n.note }); });
        push("solo", 30, 1.8, T.nearest(m.last, [7, 11], 62, 84), 0.5, { inst }); // land on the dominant
      }
      if (dame) sing(dameHorn, P.mel, { vel: 0.64, shift: dameHorn === "sax" ? -12 : 0, orn: round > 0 });
      if (s === "stakeout" && S.h === 2) sing("trumpet", P.cries, { vel: 0.56 });

      // ---------------------------------------------------------------- vibes colour
      if (s === "street") {
        const notes = P.vibes;
        if (swap) { // the trumpet takes the first half of the figure, an octave down; vibes keep the second
          sing("trumpet", notes.filter((n) => n.beat < 16), { vel: 0.52, shift: -12 });
          notes.filter((n) => n.beat >= 16).forEach((n) => push("vibes", n.beat, n.dur, n.note, 0.5));
        } else notes.forEach((n) => push("vibes", n.beat, n.dur, n.note, 0.5 + (n.beat % 4 === 1 ? 0.04 : 0)));
        notes.forEach((n) => lead.push({ a: n.beat, b: n.beat + Math.min(n.dur, 1), note: n.note }));
      } else if (s === "stakeout") {
        // a high ringing colour every two bars
        for (let bar = 0; bar < 8; bar += 2) {
          const c = T.chord(sym(bar * BPB)), pcs = c.colors.length ? c.colors : c.guide;
          const n = T.nearest(S.h === 2 ? 86 : 81, [r.pick(pcs)], 74, 89);
          push("vibes", bar * BPB + 1.5, 2.4, n, 0.36); lead.push({ a: bar * BPB + 1.5, b: bar * BPB + 3.9, note: n });
        }
      } else if ((office && !S.solo) || dame) {
        // fills in the melody's breaths: one to three colour tones, high
        const gaps = [];
        const notes = lead.slice().sort((a, b) => a.a - b.a);
        for (let i = 0; i < notes.length; i++) {
          const end = notes[i].b, nxt = i + 1 < notes.length ? notes[i + 1].a : 32;
          if (nxt - end >= 1.5) gaps.push([end, nxt]);
          else if (notes[i].b - notes[i].a >= 2.5 && r.chance(0.4)) gaps.push([notes[i].a + 1, notes[i].b - 0.5]); // under a held note
        }
        gaps.forEach(([a, b]) => {
          if (!r.chance(dame ? 0.45 : 0.6)) return;
          let t = Math.ceil((a + 0.25) * 2) / 2, k = r.int(1, 3);
          while (k-- > 0 && t < b - 0.4) {
            const e = chordAt(t), cEnd = e.bar * BPB + e.beat + e.dur;
            const c = T.chord(e.chord), pcs = c.colors.length ? c.colors.concat(c.guide) : c.guide;
            const n = T.nearest(r.int(76, 86), [r.pick(pcs)], 74, 89);
            if (cEnd - t >= 0.5) push("vibes", t, Math.min(1.2, cEnd - t - 0.05), n, 0.38 + r.range(-0.04, 0.04));
            t += r.pick([0.5, 1, 1]);
          }
        });
      }

      // ---------------------------------------------------------------- piano
      const semis = (x, y) => { const d = Math.abs(x - y); return d % 12 === 1 && d < 26; };
      const leadAt = (a, b) => lead.filter((l) => Math.min(b, l.b) - Math.max(a, l.a) >= 0.2).map((l) => l.note);
      const comp = (abs, dur, sy, vel, o = {}) => {
        const c = T.chord(sy);
        let v = o.voicing ? o.voicing.slice() : T.voice(sy, { lo: o.lo ?? 50, hi: o.hi ?? 69, n: o.n ?? 4, prev: state.cv, top: o.top ?? [60, 67], rng: r, omitBass: true });
        // no semitone at the bottom of the voicing below middle C: lift the lower note an octave
        for (let k = 0; k < 3; k++) {
          const i = v.findIndex((m, j) => j + 1 < v.length && v[j + 1] - m === 1 && m < 60);
          if (i < 0) break;
          v[i] += 12; v = [...new Set(v)].sort((a, b) => a - b);
        }
        state.cv = v;
        const ln = leadAt(abs, abs + dur);
        const ct = (m) => c.pcs.includes(mod12(m)) || c.bass === mod12(m);
        v = v.filter((m) => !ln.some((x) => semis(x, m) && !(ct(x) && ct(m))) && !ln.includes(m));
        if (v.length < 2) return;
        if (o.roll) v.forEach((m, i) => push("piano", abs, dur, m, vel * (1 - i * 0.04), { delay: i * 0.045 }));
        else push("piano", abs, dur, v, vel);
      };
      if (s === "street") {
        prog.forEach((e) => comp(e.bar * BPB + e.beat, 3.8, e.chord, 0.5, { roll: true, lo: 48, hi: 70, n: 4, top: [64, 70] }));
      } else if (s === "stakeout") {
        prog.forEach((e) => {
          const cell = OST[e.chord].map(T.midi);
          for (let i = 0; i < 8; i++) push("ostinato", e.bar * BPB + i * 0.5, 0.42, cell[i % 4], (i % 4 === 0 ? 0.5 : 0.38) + (S.h === 2 ? 0.06 * (e.bar / 7) : 0), { straight: true });
        });
      } else {
        const light = S.solo;
        prog.forEach((e, i) => {
          const s0 = e.bar * BPB + e.beat, end = i + 1 < prog.length ? prog[i + 1].bar * BPB + prog[i + 1].beat : 32;
          const pats = end - s0 >= 4 ? COMP4 : COMP2;
          const pat = r.weighted(pats);
          const cliche = s === "officeA" && e.bar < 4 ? { voicing: CLICHE[e.bar] } : {};
          pat.forEach(([b, d]) => {
            if (s0 + b >= end - 0.25) return;
            comp(s0 + b, Math.min(d, end - s0 - b - 0.05), e.chord, (light ? 0.36 : 0.44) + r.range(-0.04, 0.05),
              light ? { lo: 48, hi: 64, n: 3, top: [57, 64] } : dame ? { lo: 50, hi: 70, n: 4, top: [60, 68] } : cliche);
          });
        });
      }

      // ---------------------------------------------------------------- strings: low swells on suspense
      const swell = (from, to, lo, hi, vel) => {
        prog.filter((e) => e.bar >= from && e.bar < to).forEach((e, i, a) => {
          const st = e.bar * BPB + e.beat, end = i + 1 < a.length ? a[i + 1].bar * BPB + a[i + 1].beat : to * BPB;
          const v = T.voice(e.chord, { lo, hi, n: 3, prev: state.sv, rng: r, omitBass: true });
          state.sv = v;
          push("strings", st, end - st - 0.1, v, vel);
        });
      };
      if (s === "street") swell(6, 8, 52, 67, 0.4);
      else if (s === "stakeout") swell(0, 8, S.h === 2 ? 60 : 52, S.h === 2 ? 76 : 67, S.h === 2 ? 0.46 : 0.4);
      else if (s === "officeA2" && !S.solo) swell(5, 6, 52, 67, 0.34);
      else if (s === "dameA2") swell(0, 4, 60, 74, 0.3);

      // ---------------------------------------------------------------- bass
      const bassLo = 31, bassHi = 50;
      if (s === "stakeout") {
        prog.forEach((e) => {
          const c = T.chord(e.chord), n = near(c.bass, 36, 31, 43), B = e.bar * BPB;
          push("bass", B, 1.3, n, 0.8, { straight: true });
          push("bass", B + 1.5, 0.4, n, 0.56, { straight: true });
          if (S.h === 2 && e.bar >= 4) push("bass", B + 3, 0.4, n, 0.5, { straight: true });
          state.bass = n;
        });
      } else if (s === "street" || (s === "officeA" && !S.ret)) {
        // half-time: root and fifth in half notes, an approach into the next chord now and then
        prog.forEach((e, i) => {
          const st = e.bar * BPB + e.beat, end = i + 1 < prog.length ? prog[i + 1].bar * BPB + prog[i + 1].beat : 32;
          const c = T.chord(e.chord), nc = i + 1 < prog.length ? T.chord(prog[i + 1].chord) : nextFirst;
          const n0 = near(c.bass, 38, bassLo, 45);
          if (end - st <= 2) { push("bass", st, end - st - 0.1, n0, 0.78); state.bass = n0; return; }
          push("bass", st, 1.9, n0, 0.8);
          const t = near(nc.bass, n0, bassLo, bassHi);
          const f5 = near(mod12(c.root + fifthOf(c)), n0, bassLo, bassHi);
          if (nc.bass !== c.bass && r.chance(0.35)) { push("bass", st + 2, 0.95, f5, 0.66); push("bass", st + 3, 0.9, approach(c, t, f5, r), 0.62); }
          else push("bass", st + 2, 1.85, nc.bass !== c.bass && r.chance(0.3) ? approach(c, t, n0, r) : f5, 0.68);
          state.bass = n0;
        });
      } else {
        const w = walk(prog, 32, nextFirst.bass, state.bass, r, bassLo, bassHi);
        w.notes.forEach((n) => push("bass", n.beat, 0.9, n.note, n.beat % 2 === 0 ? 0.78 : 0.68));
        state.bass = w.last;
      }

      // ---------------------------------------------------------------- brushes
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.2, voice, vel, extra);
      const endsSection = N.s !== s || s === "stakeout";
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB, last = bar === 7;
        const fill = last && endsSection && s !== "street" && r.chance(0.8);
        if (s === "stakeout") {
          D(B, "brushSweep", 0.24, { len: 1.5 });
          for (let i = 0; i < 8; i++) if (!(fill && i >= 6)) D(B + i * 0.5, "brushTap", (i % 2 ? 0.2 : 0.28) + (S.h === 2 ? 0.1 * (bar / 7) : 0), { straight: true });
          D(B + 2, "rim", 0.42);
          D(B, "softKick", 0.24); D(B + 1.5, "softKick", 0.16, { straight: true });
          if (S.h === 2) { D(B + 1, "hatPedal", 0.3); D(B + 3, "hatPedal", 0.3); }
        } else {
          // two-beat circles with the left brush, taps on 2 and 4, a skip note before 4
          D(B, "brushSweep", s === "street" ? 0.26 : 0.3, { len: 1.5 });
          D(B + 2, "brushSweep", s === "street" ? 0.22 : 0.28, { len: 1.4 });
          if (s === "street") {
            if (bar >= 2) D(B + 3, "hatPedal", 0.3);
            if (bar % 4 === 3 || r.chance(0.2)) D(B + 3, "rim", 0.4);
            else if (bar >= 2) D(B + 3, "brushTap", 0.36);
          } else if (dame) {
            // the ride, brushed, gives the dame some lift
            [[0, 0.32], [1, 0.36], [1.5, 0.22], [2, 0.32], [3, 0.36], [3.5, 0.22]].forEach(([b, v]) => { if (!(fill && b >= 3)) D(B + b, "ride", v); });
            D(B + 1, "hatPedal", 0.36); D(B + 3, "hatPedal", 0.38);
            D(B, "softKick", 0.14);
          } else {
            D(B + 1, "brushTap", 0.42);
            if (!fill) D(B + 3, r.chance(0.12) ? "rim" : "brushTap", 0.44); // the odd rim click on 4
            if (!fill && r.chance(0.55)) D(B + 2.5, "brushTap", 0.2);
            D(B + 1, "hatPedal", 0.34); D(B + 3, "hatPedal", 0.36);
            D(B, "softKick", 0.14);
          }
        }
        if (fill) {
          [3, 3 + 1 / 3, 3 + 2 / 3].forEach((p, i) => D(B + p, "brushTap", 0.36 + i * 0.08, { straight: true }));
          D(B + 3 + 2 / 3, "softKick", 0.3, { straight: true });
        }
      }

      // ---------------------------------------------------------------- rain and drips
      const lvl = RAIN[s];
      for (let bar = 0; bar < 8; bar++) push("rain", bar * BPB, 4.4, null, 0.5, { level: lvl, straight: true });
      const dripRate = s === "street" ? 2 : s === "stakeout" ? 1.2 : 0.7;
      for (let bar = 0; bar < 8; bar++) {
        let k = 0; while (r.chance(dripRate / (dripRate + 1)) && k < 3) k++;
        for (let j = 0; j < k; j++) push("drips", bar * BPB + r.range(0, 3.9), 0.1, "drip", r.range(0.25, 0.55), { straight: true, pitch: r.int(96, 106) });
      }

      // ---------------------------------------------------------------- label
      const L = {
        street: "The street · rain, rolled chords, a vibraphone figure",
        officeA: S.ret ? `The office · the tune returns on the ${officeHorn}` : `The office · the ${officeHorn} tune, half-time bass`,
        officeA2: S.solo ? `The office · ${swap ? "vibes" : "piano"} solo` : `The office · the ${officeHorn} tune, slow walk`,
        stakeout: S.h === 1 ? "The stakeout · ostinato on a C pedal, low strings" : "The stakeout · the strings climb, the trumpet cries",
        dameA: `The dame · A♭ major, the ${dameHorn}`,
        dameA2: "The dame · D♭maj9♯11, and home through G7♭9",
      }[s];
      return { events: ev, harmony: prog, section: `Round ${round + 1} · ${L}`, state };
    },
  });
})();

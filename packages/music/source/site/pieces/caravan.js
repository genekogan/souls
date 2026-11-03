// Caravan: a desert crossing in maqam Hijaz on D, at a walking pace that breaks into a dance.
//
// Modes, in 12-TET: Hijaz on D (D Eb F# G A Bb C, labelled D7b9b13 so the chord scale is the maqam),
// Nahawand on G (G A Bb C D Eb with F# rising and F falling; D Hijaz is its fifth, so the two share
// every note and the drone moves between them), and Hijaz on G (G Ab B C D Eb F) for the dance.
// Melody is built around the maqam's resting notes (D, F#, G, A, D') rather than chord tones.
//
// Ensemble: oud (a dark plucked lute with risha tremolo on long notes), ney (breathy flute, wide
// glides), a string section that doubles the tune in unison the way an Arab firqa does, a tonic
// drone, pizzicato bass walking the camel's gait, and a qanun whose runs mark phrase ends.
// Percussion: darbuka (dum / tek / soft ka ornaments) playing saidi for the setting out, maqsum
// under the theme, baladi for the Nahawand, and a fast malfuf (2+2 in each half bar) for the dance;
// riq jingles; a deep frame drum on the dums; finger cymbals galloping 3+3+2.
//
// Form (8-bar cycles; one round = 11 cycles, about 3.5 minutes):
//   taqsim (oud alone over the drone; the frame drum and a darbuka roll bring in the rhythm) ->
//   the caravan sets out (saidi, camel riff) -> theme: oud calls, ney answers -> theme with strings ->
//   Nahawand (strings take the tune) -> ney taqsim over maqsum -> dance in Hijaz on G (faster,
//   malfuf) -> dance back on D -> the whole caravan, then a darbuka solo -> theme returns at the
//   walking pace -> the caravan moves on. Alternate rounds give the opening taqsim to the ney.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4, Q = 0.25;
  const BPM = 92, DANCE_BPM = 124;
  const HIJ_D = T.scale(2, "phrygianDominant"), HIJ_G = T.scale(7, "phrygianDominant");
  const NAH_G = [7, 9, 10, 0, 2, 3, 5, 6];

  // ---------- notation: "note@beat+dur" per bar ----------
  const M = (rows) => rows.map((row) => (row.trim() === "r" ? [] : row.trim().split(/\s+/).map((t) => { const [n, b, d] = t.split(/[@+]/); return [Number(b), Number(d), T.midi(n)]; })));

  // Theme A, D Hijaz: oud call (bars 1-2, 5-6) and ney answer (bars 3-4, 7-8).
  const THEME_A = M([
    "D4@0+0.5 Eb4@0.5+0.25 D4@0.75+0.25 C4@1+0.5 Bb3@1.5+0.5 A3@2+1 Bb3@3+0.5 C4@3.5+0.5",
    "D4@0+0.75 Eb4@0.75+0.25 F#4@1+1 Eb4@2+0.5 D4@2.5+0.5 C4@3+1",
    "A4@0.5+0.5 Bb4@1+0.5 C5@1.5+0.5 D5@2+1.5 Eb5@3.5+0.5",
    "D5@0+0.5 C5@0.5+0.5 Bb4@1+0.5 A4@1.5+0.5 G4@2+1 A4@3+1",
    "A3@0+0.5 D4@0.5+0.5 Eb4@1+0.25 F#4@1.25+0.25 G4@1.5+0.5 A4@2+1 G4@3+0.5 F#4@3.5+0.5",
    "G4@0+0.5 F#4@0.5+0.25 Eb4@0.75+0.25 F#4@1+1 Eb4@2+0.5 D4@2.5+0.5 C4@3+0.5 Bb3@3.5+0.5",
    "D5@0+1 Eb5@1+0.5 D5@1.5+0.5 C5@2+0.5 Bb4@2.5+0.5 A4@3+0.5 G4@3.5+0.25 F#4@3.75+0.25",
    "G4@0+0.5 F#4@0.5+0.5 Eb4@1+0.5 F#4@1.5+0.5 D4@2+2",
  ]);
  const WHO_A = ["oud", "oud", "ney", "ney", "oud", "oud", "ney", "ney"];
  // Theme B, Nahawand on G: strings and ney in unison; the last two bars pivot back to D Hijaz.
  const THEME_B = M([
    "G4@0+0.5 A4@0.5+0.5 Bb4@1+1 C5@2+0.5 D5@2.5+0.5 Eb5@3+0.75 D5@3.75+0.25",
    "C5@0+0.5 Bb4@0.5+0.5 A4@1+0.5 Bb4@1.5+0.5 G4@2+2",
    "F#4@0+0.5 G4@0.5+0.5 A4@1+0.5 Bb4@1.5+0.5 C5@2+0.5 Bb4@2.5+0.25 A4@2.75+0.25 Bb4@3+1",
    "A4@0+0.5 F#4@0.5+0.5 G4@1+3",
    "D5@0+0.5 Eb5@0.5+0.5 D5@1+0.5 C5@1.5+0.5 Bb4@2+1 C5@3+0.5 D5@3.5+0.5",
    "Eb5@0+1 D5@1+0.5 C5@1.5+0.5 Bb4@2+0.5 A4@2.5+0.5 Bb4@3+1",
    "A4@0+0.5 Bb4@0.5+0.25 A4@0.75+0.25 G4@1+0.5 F#4@1.5+0.5 Eb4@2+1 F#4@3+1",
    "G4@0+0.5 F#4@0.5+0.5 Eb4@1+0.5 F#4@1.5+0.5 D4@2+2",
  ]);
  // Dance riff, Hijaz on G, four bars (each bar is two 2/4 halves); transposed down a fourth for D.
  const DANCE = M([
    "G4@0+0.25 Ab4@0.25+0.25 B4@0.5+0.5 Ab4@1+0.25 G4@1.25+0.25 F4@1.5+0.5 G4@2+0.5 B4@2.5+0.25 C5@2.75+0.25 D5@3+0.5 C5@3.5+0.25 B4@3.75+0.25",
    "Ab4@0+0.5 B4@0.5+0.5 Ab4@1+0.25 G4@1.25+0.25 F4@1.5+0.25 Eb4@1.75+0.25 F4@2+0.5 G4@2.5+1.5",
    "D5@0+0.25 Eb5@0.25+0.25 D5@0.5+0.5 C5@1+0.25 B4@1.25+0.25 C5@1.5+0.5 D5@2+0.5 C5@2.5+0.25 B4@2.75+0.25 Ab4@3+0.5 B4@3.5+0.5",
    "C5@0+0.5 B4@0.5+0.25 Ab4@0.75+0.25 G4@1+0.5 F4@1.5+0.5 G4@2+1.5",
  ]);
  const DANCE_B = M([ // the second half: the riff sequenced up a third, then the same cadence
    "B4@0+0.25 C5@0.25+0.25 D5@0.5+0.5 C5@1+0.25 B4@1.25+0.25 Ab4@1.5+0.5 B4@2+0.5 D5@2.5+0.25 Eb5@2.75+0.25 F5@3+0.5 Eb5@3.5+0.25 D5@3.75+0.25",
    "C5@0+0.5 D5@0.5+0.5 C5@1+0.25 B4@1.25+0.25 Ab4@1.5+0.25 G4@1.75+0.25 Ab4@2+0.5 B4@2.5+1.5",
  ]).concat(DANCE.slice(2));
  // Answer phrases for the ney in the dance (Hijaz on G): it fills where the riff holds.
  const DANCE_ANS = M(["r", "B5@2.5+0.25 C6@2.75+0.25 D6@3+0.5 C6@3.5+0.5", "r", "Ab5@2.5+0.25 B5@2.75+0.25 C6@3+0.25 B5@3.25+0.25 Ab5@3.5+0.25 G5@3.75+0.25"]);

  // Bass (pizzicato): the camel's gait, locked to the saidi dums; and a dance pattern.
  const CAMEL = M(["D2@0+0.5 A2@1.5+0.5 D2@2+0.75 C3@3+0.5 A2@3.5+0.5", "D2@0+0.5 A2@1.5+0.5 D2@2+0.5 Eb2@2.5+0.5 F#2@3+0.5 G2@3.5+0.5"]);

  // ---------- percussion: 16 characters per bar ----------
  // D dum, T tek, k soft ka; for the frame drum and riq the darbuka part is read and coloured.
  const RHY = {
    saidi: "D.T...D.D...T...",
    maqsum: "D.T...T.D...T...",
    baladi: "D.D...T.D...T...",
    malfuf: "D..T..T.D..T..T.",
    ayoub: "D..kT.k.D..kT.k.",
  };
  const ORN = { // where ka ornaments may fall, per rhythm
    saidi: [3, 5, 10, 11, 14, 15], maqsum: [3, 4, 5, 10, 11, 14, 15], baladi: [3, 4, 5, 10, 11, 14, 15],
    malfuf: [1, 2, 4, 5, 9, 10, 12, 13], ayoub: [1, 2, 6, 7, 9, 10, 14, 15],
  };
  const ZILLS = { gallop: "x..x..x.x..x..x.", two: "x.......x.......", off: "..x...x...x...x.", none: "................" };
  const pat = (s) => [...s].map((c, i) => [i, c]).filter(([, c]) => c !== ".");

  // ---------- form ----------
  const ROUND = ["TQ", "CV", "TA", "TA2", "TB", "TQ2", "DA", "DB", "DC", "TA3", "OUT"];
  const PROG = {
    D: "| D7b9b13 | % | % | % | % | % | % | % |",
    G: "| G7b9b13 | % | % | % | % | % | % | % |",
    B: "| Gm7b13 | % | D7b9b13 | D7b9b13:1 Gm7b13:3 | Gm7b13 | % | D7b9b13 | % |",
  };
  const PLAN = {
    TQ: { prog: "D", rhy: null, label: "Taqsim · the oud alone over the drone" },
    CV: { prog: "D", rhy: "saidi", label: "The caravan sets out · saidi, the camel's gait" },
    TA: { prog: "D", rhy: "maqsum", label: "Theme · the oud calls, the ney answers" },
    TA2: { prog: "D", rhy: "maqsum", label: "Theme · the strings join" },
    TB: { prog: "B", rhy: "baladi", label: "Nahawand · the strings take the tune" },
    TQ2: { prog: "D", rhy: "maqsum", label: "Ney taqsim · over the walking rhythm" },
    DA: { prog: "G", rhy: "malfuf", label: "Dance · malfuf, quicker, Hijaz on G" },
    DB: { prog: "D", rhy: "malfuf", label: "Dance · back on D, the ney answers" },
    DC: { prog: "G", rhy: "malfuf", label: "Dance · the whole caravan, then the darbuka alone" },
    TA3: { prog: "D", rhy: "maqsum", label: "Theme · back to the walking pace" },
    OUT: { prog: "D", rhy: "baladi", label: "The caravan moves on" },
  };

  Sim.register({
    id: "caravan",
    title: "Caravan",
    genre: "Desert caravan",
    situations: ["explore", "celebrate"],
    energy: 0.6,
    about: "A desert crossing in maqam Hijaz: an oud taqsim over a drone, then darbuka, riq, frame drum and finger cymbals set a walking saidi and maqsum while the oud calls and a breathy ney answers; the strings carry a Nahawand tune, and the caravan breaks into a fast malfuf dance before walking on.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const night = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.04, lowcut: 350, highcut: 5500 });
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 300, highcut: 7500 });
      const echo = I.delay(ctx, out, { time: "4n.", feedback: 0.2, highcut: 2400 });

      const oud = I.koto(ctx, { volume: -1, resonance: 0.935, dampening: 3400, voices: 10 });
      const oudTone = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 }));
      oud.out.connect(oudTone);
      const ney = I.shakuhachi(ctx, { volume: -1, glide: 0.13, breath: -11, vibrato: 4.8, vibratoDepth: 0.06, attack: 0.12 });
      const strings = I.strings(ctx, { volume: -9, attack: 0.14, release: 0.6, cutoff: 2800 });
      const drone = I.strings(ctx, { volume: -15, attack: 2.2, release: 3, cutoff: 1100 });
      const bass = I.upright(ctx, { volume: -5 });
      const qanun = I.harp(ctx, { volume: -12, dampening: 6000, resonance: 0.96 });
      const darb = I.kit(ctx, { volume: 2, preload: ["dum", "tek"] });
      const hand = I.kit(ctx, { volume: -1, preload: ["tambourine", "tom", "triangle", "tek"] });

      const op = ctx.keep(new Tone.Panner(-0.2)); oudTone.connect(op); op.connect(out);
      const np = I.place(ctx, ney, 0.12, out), sp = I.place(ctx, strings, 0.25, out), dp = I.place(ctx, drone, 0, out);
      I.place(ctx, bass, 0, out);
      const qp = I.place(ctx, qanun, 0.4, out), kp = I.place(ctx, darb, 0.04, out), hp = I.place(ctx, hand, -0.1, out);
      I.send(ctx, op, night, -11); I.send(ctx, op, room, -14); I.send(ctx, np, night, -8); I.send(ctx, np, echo, -20);
      I.send(ctx, sp, night, -10); I.send(ctx, dp, night, -12); I.send(ctx, qp, night, -9);
      I.send(ctx, kp, room, -12); I.send(ctx, hp, room, -10); I.send(ctx, kp, night, -24); I.send(ctx, bass.out, room, -20);

      const kitPlay = (k) => (t, e) => k.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len });
      return {
        ney: { layer: "melody", play: (t, e, d) => ney.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
        oud: { layer: "melody", play: (t, e, d) => oud.play(t, e.note, Math.max(0.12, d), e.vel), humanize: { timing: 0.006 } },
        strings: { layer: "melody", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.012 } },
        drone: { layer: "harmony", play: (t, e, d) => drone.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        qanun: { layer: "texture", play: (t, e, d) => qanun.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.006 } },
        darbuka: { layer: "drums", play: kitPlay(darb), humanize: { timing: 0.005, vel: 0.1 } },
        hand: { layer: "drums", play: kitPlay(hand), humanize: { timing: 0.007, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const round = Math.floor(cycle / ROUND.length), id = ROUND[cycle % ROUND.length];
      const plan = PLAN[id];
      const prog = T.progression(PROG[plan.prog], BPB);
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, b, dur, note, vel, extra) => { const bar = Math.floor(b / BPB + 1e-9); ev.push({ track, bar, beat: b - bar * BPB, dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra }); };
      const neyFirst = round % 2 === 1;
      const dance = id === "DA" || id === "DB" || id === "DC";
      let tempo;
      if (id === "DA") tempo = { bpm: DANCE_BPM, rampBeats: 8 };
      else if (id === "TA3" || (id === "TQ" && cycle > 0)) tempo = { bpm: BPM, rampBeats: 2 };

      // ---------- drone ----------
      const droneRoot = plan.prog === "G" ? 43 : 50; // G2 / D3
      for (let bar = 0; bar < 8; bar += 4) {
        const s = sym(bar * BPB), root = T.chord(s).root;
        const lowRoot = T.nearest(droneRoot, [root], 43, 52);
        const notes = id === "TQ" || id === "OUT" || dance ? [lowRoot, lowRoot + 12] : [lowRoot, lowRoot + 12];
        if (plan.prog === "B") { // follow the Nahawand / Hijaz pivot, two bars at a time
          for (let b2 = bar; b2 < bar + 4; b2 += 2) { const rr = T.nearest(droneRoot, [T.chord(sym(b2 * BPB)).root], 43, 52); push("drone", b2 * BPB, 7.8, [rr, rr + 12], 0.5); }
        } else push("drone", bar * BPB, 15.8, notes, id === "TQ" && bar === 0 ? 0.42 : 0.5);
      }

      // ---------- melody helpers ----------
      const oudNote = (b, d, n, vel, opts = {}) => {
        if (d >= 1.5 && opts.tremolo !== false && r.chance(opts.tremoloP ?? 0.6)) { // risha tremolo
          const step = 0.125, until = b + d - 0.2;
          let i = 0;
          for (let t = b; t < until; t += step, i++) push("oud", t, 0.2, n, vel * (i === 0 ? 1 : 0.55 + 0.1 * Math.sin(i * 0.9)), opts.extra);
          return;
        }
        if (opts.grace && d >= 0.5 && r.chance(opts.grace)) { // a quick upper neighbour before the note
          const nb = T.step(n, 1, opts.pcs ?? HIJ_D);
          push("oud", b, 0.125, nb, vel * 0.7, opts.extra); push("oud", b + 0.125, d - 0.125, n, vel, opts.extra);
          return;
        }
        push("oud", b, d, n, vel, opts.extra);
      };
      const neyNote = (b, d, n, vel, opts = {}) => {
        if (opts.scoop && d >= 1 && r.chance(opts.scoop)) { push("ney", b, 0.18, T.step(n, -1, T.chord(sym(b)).scale), vel * 0.7, opts.extra); push("ney", b + 0.18, d - 0.18, n, vel, opts.extra); return; }
        push("ney", b, d * 0.96, n, vel, opts.extra);
      };
      const qanunRun = (endBeat, target, pcs, n = 6, up = true) => {
        const notes = [];
        let m = target;
        for (let i = 0; i < n; i++) { m = T.step(m, up ? -1 : 1, pcs); notes.unshift(m); }
        const stepB = 0.125;
        notes.forEach((x, i) => push("qanun", endBeat - (n - i) * stepB, 0.4, x, 0.38 + 0.05 * i));
      };

      // ---------- sections ----------
      if (id === "TQ") {
        const who = neyFirst ? "ney" : "oud";
        const lo = who === "oud" ? 50 : 62, top = who === "oud" ? 67 : 81;
        const D = who === "oud" ? 50 : 62;
        const phrases = who === "oud"
          ? [{ from: D, top: D + 5, rest: D }, { top: D + 7, rest: D + 4 }, { top: D + 10, rest: D + 5 }, { top: D + 13, rest: D + 12 }, { top: D + 7, rest: D }]
          : [{ from: D + 7, top: D + 12, rest: D + 7 }, { top: D + 13, rest: D + 10 }, { top: D + 17, rest: D + 12 }, { top: D + 19, rest: D + 17 }, { top: D + 12, rest: D + 7 }, { top: D + 5, rest: D }];
        const notes = taqsim(r.fork(11 + round), { start: 0.5, end: 26, pcs: HIJ_D, lo, hi: top + 2, phrases, slow: who === "ney" });
        notes.forEach((n) => {
          const extra = { straight: true, delay: r.range(0, 0.03) };
          if (who === "oud") oudNote(n.beat, n.dur, n.note, 0.62 + (n.strong ? 0.08 : 0), { tremoloP: 0.75, grace: 0.25, extra });
          else neyNote(n.beat, n.dur, n.note, 0.6 + (n.strong ? 0.06 : 0), { scoop: 0.35, extra });
        });
        // the walk begins: the oud (or ney) settles on the tonic as the rhythm enters
        if (who === "oud") push("oud", 28, 2, 50, 0.55); else push("ney", 28, 3, 62, 0.5);
      }

      if (id === "CV" || id === "OUT") { // camel riff on the oud an octave above the bass, with fills
        for (let bar = 0; bar < 8; bar++) {
          if (id === "OUT" && bar >= 6) break;
          const B = bar * BPB;
          CAMEL[bar % 2].forEach(([b, d, n]) => oudNote(B + b, d * 0.9, n + 12, (b === 0 ? 0.6 : 0.5) + r.range(-0.04, 0.04), { grace: 0.12, tremolo: false }));
          if (bar % 2 === 1 && r.chance(0.4)) qanunRun(B + 4, 62, HIJ_D, 4);
        }
        if (id === "CV") { // the ney hints at the theme's answer over the last four bars
          THEME_A[3].forEach(([b, d, n]) => neyNote(5 * BPB + b, d, n, 0.48, { scoop: 0.4 }));
          THEME_A[7].forEach(([b, d, n]) => neyNote(7 * BPB + b, d, n, 0.5, { scoop: 0.4 }));
        } else { // the last phrase drifts away
          THEME_A[7].forEach(([b, d, n]) => neyNote(5 * BPB + b, d, n + 12, 0.46, { scoop: 0.5 }));
          push("ney", 7 * BPB, 3.5, 74, 0.38);
        }
      }

      if (id === "TA" || id === "TA2" || id === "TA3") {
        const strings = id !== "TA";
        const orn = id === "TA" ? 0.15 : 0.3;
        const swap = id === "TA3"; // on the return the ney calls (an octave up) and the oud answers (an octave down)
        THEME_A.forEach((row, bar) => {
          const B = bar * BPB, who = WHO_A[bar];
          row.forEach(([b, d, n]) => {
            if (swap) {
              if (who === "oud") neyNote(B + b, d, n + 12, 0.62, { scoop: 0.4 });
              else oudNote(B + b, d, n - 12, 0.66, { grace: 0.3, tremoloP: 0.7 });
            } else if (who === "oud") oudNote(B + b, d, n, 0.66 + (b % 1 === 0 ? 0.05 : 0), { grace: orn, tremoloP: 0.5 });
            else neyNote(B + b, d, n, 0.64, { scoop: orn + 0.15 });
            if (swap) push("strings", B + b, d * 0.95, who === "oud" ? n : n - 12, 0.46);
            else if (strings && who === "ney") push("strings", B + b, d * 0.95, n - 12, 0.46);
          });
          // heterophony: in TA2 the oud shadows the ney's answer an octave below, plainly
          if (id === "TA2" && who === "ney") row.forEach(([b, d, n]) => { if (d >= 0.5) push("oud", B + b, Math.min(d, 1), n - 12, 0.4); });
        });
        [3, 7].forEach((bar) => qanunRun(bar * BPB + 4, bar === 3 ? 74 : 62, HIJ_D, 6));
      }

      if (id === "TB") {
        const oudLeads = round % 2 === 1;
        THEME_B.forEach((row, bar) => {
          const B = bar * BPB;
          row.forEach(([b, d, n]) => {
            const pcs = T.chord(sym(B + b)).scale;
            push("strings", B + b, d * 0.95, n, 0.52);
            if (oudLeads) oudNote(B + b, d, n - 12, 0.62, { grace: 0.2, tremoloP: 0.6, pcs });
            else neyNote(B + b, d, n, 0.6, { scoop: 0.3 });
            if (!oudLeads && bar >= 4 && d >= 0.5) push("oud", B + b, Math.min(d, 1), n - 12, 0.42); // heterophony
          });
          if (!oudLeads && bar < 4 && row.length) { // the oud answers each held note with a turn
            const [b, d, n] = row[row.length - 1];
            if (d >= 1.5) { const pcs = T.chord(sym(B + b)).scale; [1, 0, -1, 0].forEach((s, i) => push("oud", B + b + 0.5 + i * 0.25, 0.22, T.step(n - 12, s, pcs), 0.45)); }
          }
        });
        qanunRun(4 * BPB, 67, NAH_G.filter((p) => p !== 5), 8);
        qanunRun(8 * BPB, 62, HIJ_D, 8);
      }

      if (id === "TQ2") { // the ney improvises, the oud keeps the riff low
        const D = 62;
        const notes = taqsim(r.fork(31 + round), { start: 0.5, end: 30, pcs: HIJ_D, lo: 62, hi: 84, slow: true,
          phrases: [{ from: D + 7, top: D + 12, rest: D + 7 }, { top: D + 15, rest: D + 12 }, { top: D + 19, rest: D + 15 }, { top: D + 22, rest: D + 19 }, { top: D + 13, rest: D + 12 }, { top: D + 7, rest: D }] });
        notes.forEach((n) => neyNote(n.beat, n.dur, n.note, 0.6 + (n.strong ? 0.06 : 0), { scoop: 0.35 }));
        for (let bar = 0; bar < 8; bar++) CAMEL[bar % 2].forEach(([b, d, n]) => { if (b < 3 || bar % 2 === 1) push("oud", bar * BPB + b, d * 0.85, n + 12, 0.42); });
      }

      if (dance) {
        const k = plan.prog === "G" ? 0 : -5; // the riff is written on G
        const pcs = plan.prog === "G" ? HIJ_G : HIJ_D;
        const lastRiffBar = id === "DC" ? 6 : 8;
        for (let bar = 0; bar < lastRiffBar; bar++) {
          const B = bar * BPB, row = (bar >= 4 && id !== "DB" ? DANCE_B : DANCE)[bar % 4];
          const neyRiff = id !== "DB";
          row.forEach(([b, d, n]) => {
            push("oud", B + b, d * 0.9, n + k - (id === "DB" ? 0 : 12), (b % 1 === 0 ? 0.66 : 0.54) + r.range(-0.03, 0.03));
            if (neyRiff && (id === "DC" || bar >= 2)) push("ney", B + b, d * 0.9, n + k, 0.52 + (b % 1 === 0 ? 0.05 : 0));
            if (id === "DC") push("strings", B + b, d * 0.92, n + k, 0.44);
          });
          if (id === "DB") DANCE_ANS[bar % 4].forEach(([b, d, n]) => push("ney", B + b, d * 0.95, n - 5 - 12 + (bar >= 4 ? 12 : 0), 0.58));
          if (id === "DB" && bar % 4 === 0) push("ney", B, 1.4, (bar >= 4 ? 74 : 62) + 7, 0.52); // a long call at each phrase start
          if (bar % 4 === 3) qanunRun(B + 4, T.nearest(67 + k + 12, [T.chord(sym(B)).root], 60, 84), pcs, 8);
        }
        if (id === "DC") { push("oud", 6 * BPB, 0.5, 55, 0.7); push("strings", 6 * BPB, 0.5, [55, 67], 0.55); push("ney", 6 * BPB, 0.6, 79, 0.6); }
      }

      // ---------- bass ----------
      // the bass gives way (to the root) wherever it would sit a semitone or minor ninth from the tune
      const tune = ev.filter((e) => e.track === "oud" || e.track === "ney" || e.track === "strings").map((e) => ({ a: e.bar * BPB + e.beat, b: e.bar * BPB + e.beat + e.dur, ns: Array.isArray(e.note) ? e.note : [e.note] }));
      const bassSafe = (b, n, c) => {
        const rub = tune.some((x) => x.a < b + 0.3 && x.b > b + 0.05 && x.ns.some((m) => { const d = Math.abs(m - n) % 12; return (d === 1 || d === 11) && !(c.pcs.includes(T.mod12(m)) && c.pcs.includes(T.mod12(n))); }));
        return rub ? T.nearest(n, [c.root], n - 7, n + 7) : n;
      };
      const pushBass = (b, d, n, vel) => push("bass", b, d, bassSafe(b, n, T.chord(sym(b))), vel);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB, s = sym(B), c = T.chord(s);
        if (id === "TQ" || (id === "DC" && bar >= 6) || (id === "OUT" && bar >= 6)) continue;
        if (dance) {
          const root = T.nearest(40, [c.root], 36, 45), fifth = T.step(root, 4, c.scale);
          [0, 2].forEach((h) => {
            pushBass(B + h, 0.45, root, 0.82);
            pushBass(B + h + 0.75, 0.22, root + 12, 0.55);
            pushBass(B + h + 1.5, 0.45, h === 2 && bar % 2 === 1 ? T.step(root, -1, c.scale) : fifth, 0.68);
          });
          continue;
        }
        if (c.root === 2) {
          CAMEL[bar % 2].forEach(([b, d, n]) => pushBass(B + b, Math.min(0.32, d * 0.6), n, b === 0 ? 0.85 : 0.68));
        } else { // Nahawand bars: root, fifth, a walk down the minor scale
          const root = T.nearest(43, [c.root], 40, 47);
          [[0, root, 0.5], [1.5, root + 7, 0.5], [2, root, 0.5], [3, T.step(root, -1, c.scale), 0.5], [3.5, T.step(root, -2, c.scale), 0.5]].forEach(([b, n, d]) => pushBass(B + b, 0.32, n, b === 0 ? 0.85 : 0.66));
        }
      }

      // ---------- percussion ----------
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        let rhy = plan.rhy;
        if (id === "DB" && bar % 4 >= 2) rhy = "ayoub";
        const lastBar = bar === 7;
        // the taqsim: frame drum heartbeat from bar 4, riq shimmer, then a darbuka roll in bar 8
        if (id === "TQ") {
          if (bar >= 4 && bar < 7) { push("hand", B, 0.5, "tom", 0.42, { pitch: 40 }); push("hand", B + 2, 0.5, "tom", 0.32, { pitch: 40 }); if (bar === 6) for (let i = 0; i < 8; i++) push("hand", B + 2 + i * 0.25, 0.25, "tambourine", 0.12 + i * 0.03); }
          if (bar === 2 || bar === 5) push("hand", B, 1, "triangle", 0.25, { len: 1.5 });
          if (bar === 7) { push("darbuka", B, 0.5, "dum", 0.7, { pitch: 47 }); push("darbuka", B + 1.5, 0.25, "tek", 0.55, { pitch: 81 }); darbukaRoll(push, B, r, 8, 1); }
          continue;
        }
        const solo = id === "DC" && bar >= 6; // the darbuka alone
        const orn = { CV: 0.18, TA: 0.25, TA2: 0.35, TB: 0.3, TQ2: 0.15, DA: 0.3, DB: 0.35, DC: 0.45, TA3: 0.3, OUT: 0.15 }[id] ?? 0.2;
        const fill = lastBar && id !== "OUT" ? (dance || id === "TQ2" ? "roll" : "short") : bar === 3 && r.chance(0.35) ? "tiny" : null;
        const fillFrom = fill === "roll" ? 8 : fill === "short" ? 12 : fill === "tiny" ? 14 : 16;
        if (solo) { darbukaSolo(push, B, r, bar === 7); continue; }
        if (id === "OUT" && bar >= 6) { // thinning out
          if (bar === 6) { push("darbuka", B, 0.5, "dum", 0.6); push("darbuka", B + 2, 0.5, "dum", 0.45); push("hand", B, 1, "triangle", 0.22, { len: 1.5 }); }
          if (bar === 7) push("hand", B, 0.5, "tom", 0.35, { pitch: 40 });
          continue;
        }
        const P = pat(RHY[rhy]);
        const used = new Set(P.map(([p]) => p));
        P.forEach(([p, c]) => {
          if (p >= fillFrom) return;
          if (c === "D") push("darbuka", B + p * Q, 0.25, "dum", p === 0 ? 0.82 : 0.72, { pitch: 47 });
          else if (c === "T") push("darbuka", B + p * Q, 0.25, "tek", 0.66, { pitch: 81 });
          else push("darbuka", B + p * Q, 0.25, "tek", 0.3, { pitch: 76 });
        });
        ORN[rhy].forEach((p) => { if (p < fillFrom && !used.has(p) && r.chance(orn)) push("darbuka", B + p * Q, 0.25, "tek", 0.16 + r.range(0, 0.1), { pitch: 76 }); });
        if (fill) darbukaRoll(push, B, r, fillFrom, fill === "roll" ? 1 : 0.8);
        // frame drum: deep on the dums
        P.forEach(([p, c]) => { if (c === "D" && p < fillFrom && (p === 0 || p === 8 || dance || id === "TB")) push("hand", B + p * Q, 0.5, "tom", (p === 0 ? 0.5 : 0.4) * (dance ? 1.05 : 1), { pitch: id === "TB" ? 38 : 40 }); });
        // riq: jingles on the teks and a soft running pulse
        if (id !== "CV" || bar >= 2) {
          const run = dance ? 1 : id === "TQ2" ? 0 : 0.5;
          for (let p = 0; p < fillFrom; p++) {
            const c = RHY[rhy][p];
            if (c === "T" || c === "k") push("hand", B + p * Q, 0.25, "tambourine", 0.42);
            else if (c === "D") push("hand", B + p * Q, 0.25, "tek", 0.3, { pitch: 70 }); // the riq's skin
            else if (p % 2 === 0 ? r.chance(run) : r.chance(run * 0.5)) push("hand", B + p * Q, 0.25, "tambourine", p % 2 ? 0.12 : 0.18);
          }
        }
        // finger cymbals
        const z = dance ? (id === "DA" && bar < 2 ? "two" : "gallop") : id === "TA2" || id === "TA3" ? "two" : id === "TB" ? "off" : "none";
        pat(ZILLS[z]).forEach(([p]) => { if (p < fillFrom) push("hand", B + p * Q, 0.25, "triangle", dance ? (p % 8 === 0 ? 0.3 : 0.2) : 0.2, { len: dance ? 0.18 : 0.6 }); });
      }

      const label = id === "TQ" && neyFirst ? "Taqsim · the ney alone over the drone" : plan.label;
      return { events: ev, harmony: prog, section: label, state, tempo };
    },
  });

  /**
   * A taqsim: phrases that climb the maqam step by step to a ceiling, turn, and fall to a resting note,
   * each one reaching a little higher; free rhythm (pieces add a small random delay to blur the grid).
   */
  function taqsim(r, opts) {
    // drop middle phrases until the whole taqsim fits and ends on its final resting note
    let ph = opts.phrases.slice();
    for (let tries = 0; tries < 8; tries++) {
      const res = taqsimTry(r.fork(tries), { ...opts, phrases: ph });
      if (res.fits || ph.length <= 2) return res.notes;
      ph = ph.slice(0, ph.length - 2).concat(ph.slice(-1));
    }
    return taqsimTry(r.fork(99), { ...opts, phrases: ph }).notes;
  }
  function taqsimTry(r, { start, end, pcs, lo, hi, phrases, slow }) {
    const sc = T.notesIn(pcs, lo, hi);
    const ix = (m) => sc.indexOf(T.nearest(m, pcs, lo, hi));
    const out = [];
    let t = start, cur = phrases[0].from ?? phrases[0].rest;
    for (const ph of phrases) {
      if (t >= end - 2) break;
      const path = [];
      let i = ix(cur);
      const iTop = ix(ph.top), iRest = ix(ph.rest);
      if (r.chance(0.4) && i > 0) { path.push(sc[i]); path.push(sc[i - 1]); } // start from a lower neighbour
      while (i < iTop) {
        path.push(sc[i]);
        if (r.chance(0.22) && i + 1 <= iTop) { path.push(sc[i + 1]); path.push(sc[i]); } // a turn
        i += r.chance(0.82) ? 1 : 2;
      }
      i = iTop; path.push(sc[i]);
      if (r.chance(0.45) && sc[i + 1] != null) { path.push(sc[i + 1]); path.push(sc[i]); }
      while (i > iRest) { i -= r.chance(0.85) ? 1 : 2; if (i < iRest) i = iRest; path.push(sc[i]); }
      path.forEach((m, j) => {
        const last = j === path.length - 1;
        let d = last ? r.pick(slow ? [2, 2.5, 3] : [1.5, 2, 2.5]) : r.weighted(slow ? [[0.5, 3], [0.75, 2], [1, 2], [1.5, 1]] : [[0.25, 3], [0.5, 4], [0.75, 1.5], [1, 1.2]]);
        if (j === 0 && !last && r.chance(0.4)) d = slow ? 1.5 : 1;
        if (t + d > end) d = Math.max(0.25, end - t);
        if (t < end) out.push({ beat: t, dur: d, note: m, strong: last || j === 0 });
        t += d;
      });
      t += r.pick([0.5, 1, 1.5]);
      t = Math.round(t * 4) / 4;
      cur = ph.rest;
    }
    const last = out[out.length - 1];
    return { notes: out, fits: !!last && last.beat + last.dur <= end + 1e-6 && last.note === T.nearest(phrases[phrases.length - 1].rest, pcs, lo, hi) };
  }

  /** A darbuka roll from 16th `from` to the end of the bar, crescendo, finishing on a tek. */
  function darbukaRoll(push, B, r, from, lvl) {
    const len = 16 - from;
    for (let i = 0; i < len * 2; i++) {
      const p = from + i / 2, last = i === len * 2 - 1;
      const v = (0.2 + 0.5 * (i / (len * 2))) * lvl;
      push("darbuka", B + p * 0.25, 0.125, "tek", last ? 0.72 * lvl : v, { pitch: i % 2 ? 76 : 81 });
    }
    if (from <= 8) push("darbuka", B + from * 0.25, 0.25, "dum", 0.6 * lvl, { pitch: 47 });
  }

  /** Two bars of darbuka solo: dum-tek conversations getting denser, a roll into the next section. */
  function darbukaSolo(push, B, r, second) {
    const cells = second ? ["D.TkD.TkT.TkTkTk", "D..TD..TTkTkTkTk"] : ["D..T..T.D.kTk.T.", "D.k.T.kTD..TkTk."];
    const cell = r.pick(cells);
    [...cell].forEach((c, p) => {
      if (second && p >= 12) return;
      if (c === "D") push("darbuka", B + p * 0.25, 0.25, "dum", 0.78, { pitch: 47 });
      else if (c === "T") push("darbuka", B + p * 0.25, 0.25, "tek", 0.7, { pitch: 81 });
      else if (c === "k") push("darbuka", B + p * 0.25, 0.25, "tek", 0.34, { pitch: 76 });
    });
    if (second) darbukaRoll(push, B, r, 12, 1);
  }
})();

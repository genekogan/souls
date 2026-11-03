// Island Time: roots reggae in G major at 74 BPM, swung sixteenths, for a backyard at dusk.
// A live-band riddim: the bass riff is the hook (a two-bar G-to-C figure that climbs out of the low G),
// clean-guitar skanks on 2 and 4, an organ bubble rocking low-on-the-beat / high-on-the-and, a one-drop
// kit (kick and cross-stick together on 3) that shifts to rockers and steppers as the form builds, and a
// nyabinghi section of hand drums (funde heartbeat, improvising repeater, a low akete thump) and shaker.
// A melodica sings a pentatonic verse tune (sol-la-do, held, back down) and a chorus that climbs the
// 3-5-7 of each chord. The bridge turns to the parallel G minor (Gm7 Ebmaj7 F, Cm7 D7); on alternate
// rounds it goes to the relative E minor instead and comes home through B7 to G, a chromatic-mediant step.
// Dub logic: a section where the drums leave and the skank, snare and melodica are thrown into a filtered
// tape echo whose feedback is swelled from the desk, a one-bar bass drop, then a melodica version over
// steppers, a last chorus with the melodica harmonised in parallel, and a riddim outro.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- harmony ----------
  const FORM = {
    V: "| G | Cmaj7 | G | Cmaj7 | G | Cmaj7 | Am7 | D7 |",
    C: "| Cmaj7 | D | Bm7 | Em7 | Cmaj7 | D7 | G | G |",
    Bg: "| Gm7 | Gm7 | Ebmaj7 | F | Gm7 | Gm7 | Cm7 | D7 |",
    Be: "| Em7 | Em7 | Cmaj7 | D | Em7 | Em7 | Am7 | B7 |",
  };
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));
  const G_MAJOR = T.scale(7, "ionian");

  // ---------- tunes [bar, beat, dur, note] ----------
  const THEME = {
    // verse: sol-la-do (held) la sol; the answer climbs to B; the peak is D6; the turnaround moves it onto Am.
    V: [
      [0, 0.5, 0.5, "D5"], [0, 1, 0.5, "E5"], [0, 1.5, 1, "G5"], [0, 2.5, 0.5, "E5"], [0, 3, 1.5, "D5"],
      [1, 1, 0.5, "C5"], [1, 1.5, 0.5, "D5"], [1, 2, 1.75, "E5"],
      [2, 0.5, 0.5, "D5"], [2, 1, 0.5, "E5"], [2, 1.5, 1, "G5"], [2, 2.5, 0.5, "A5"], [2, 3, 1.25, "B5"],
      [3, 0.5, 0.5, "A5"], [3, 1, 1, "G5"], [3, 2, 0.5, "E5"], [3, 2.5, 1.25, "G5"],
      [4, 0.5, 0.5, "B5"], [4, 1, 1.5, "D6"], [4, 2.5, 0.5, "B5"], [4, 3, 1, "A5"],
      [5, 0, 1.5, "G5"], [5, 1.5, 0.5, "E5"], [5, 2, 0.5, "G5"], [5, 2.5, 1.25, "E5"],
      [6, 0.5, 0.5, "C5"], [6, 1, 0.5, "E5"], [6, 1.5, 1, "G5"], [6, 2.5, 0.5, "E5"], [6, 3, 1, "C5"],
      [7, 0, 1.5, "D5"], [7, 1.5, 0.5, "E5"], [7, 2, 1.75, "F#5"],
    ],
    // chorus: 3-5-7 of C, 3-5-8 of D, down through Bm7 and Em7; again, then home to G and a bar of space.
    C: [
      [0, 0.5, 0.5, "E5"], [0, 1, 0.5, "G5"], [0, 1.5, 2, "B5"],
      [1, 0.5, 0.5, "F#5"], [1, 1, 0.5, "A5"], [1, 1.5, 2, "D6"],
      [2, 0.5, 0.5, "D6"], [2, 1, 1, "B5"], [2, 2, 1, "A5"], [2, 3, 1, "F#5"],
      [3, 0, 2, "G5"], [3, 2, 0.5, "F#5"], [3, 2.5, 0.5, "E5"], [3, 3, 1, "D5"],
      [4, 0.5, 0.5, "E5"], [4, 1, 0.5, "G5"], [4, 1.5, 2, "B5"],
      [5, 0.5, 0.5, "F#5"], [5, 1, 0.5, "A5"], [5, 1.5, 1.5, "D6"], [5, 3, 0.5, "C6"], [5, 3.5, 0.5, "A5"],
      [6, 0, 1, "B5"], [6, 1, 0.5, "A5"], [6, 1.5, 2.5, "G5"],
    ],
    // bridge (written in G minor; transposed down a minor third for the E minor version)
    B: [
      [0, 0.5, 0.5, "D5"], [0, 1, 0.5, "F5"], [0, 1.5, 2.5, "G5"],
      [1, 0.5, 0.5, "Bb5"], [1, 1, 0.5, "A5"], [1, 1.5, 0.5, "G5"], [1, 2, 1.5, "F5"], [1, 3.5, 0.5, "D5"],
      [2, 0, 2, "G5"], [2, 2, 0.5, "F5"], [2, 2.5, 1.5, "D5"],
      [3, 0, 1.5, "C5"], [3, 1.5, 0.5, "D5"], [3, 2, 0.5, "F5"], [3, 2.5, 1.5, "A5"],
      [4, 0.5, 0.5, "G5"], [4, 1, 0.5, "A5"], [4, 1.5, 2.5, "Bb5"],
      [5, 0.5, 0.5, "C6"], [5, 1, 0.5, "Bb5"], [5, 1.5, 0.5, "A5"], [5, 2, 1.5, "G5"], [5, 3.5, 0.5, "F5"],
      [6, 0, 1, "G5"], [6, 1, 0.5, "Eb5"], [6, 1.5, 1, "G5"], [6, 2.5, 0.5, "Bb5"], [6, 3, 1, "C6"],
      [7, 0, 1, "F#5"], [7, 1, 1, "A5"], [7, 2, 1.75, "C6"],
    ],
  };
  // the verse cell as a C.line motif, so the melodica version keeps quoting it
  const THEME_MOTIF = { len: 4, rhythm: [{ off: 0.5, dur: 0.5 }, { off: 1, dur: 0.5 }, { off: 1.5, dur: 1 }, { off: 2.5, dur: 0.5 }, { off: 3, dur: 1 }], steps: [0, 1.25, 1.9, -1.9, -1.25] };

  // ---------- bass ----------
  // The hook: two bars over G | Cmaj7. Variant "b" answers with a stepwise climb G A B C D.
  const RIFF = {
    a: [[0, 0, 0.7, "G1", 0.92], [0, 0.75, 0.2, "G1", 0.55], [0, 1.5, 0.45, "B1", 0.72], [0, 2, 0.9, "D2", 0.86], [0, 3, 0.45, "E2", 0.72], [0, 3.5, 0.4, "D2", 0.66],
      [1, 0, 1.3, "C2", 0.9], [1, 1.5, 0.45, "E2", 0.7], [1, 2, 0.45, "G2", 0.78], [1, 2.5, 0.9, "E2", 0.74], [1, 3.5, 0.4, "B1", 0.64]],
    b: [[0, 0, 0.7, "G1", 0.92], [0, 0.75, 0.2, "G1", 0.55], [0, 1.5, 0.45, "B1", 0.72], [0, 2, 0.9, "D2", 0.86], [0, 3, 0.45, "E2", 0.72], [0, 3.5, 0.4, "D2", 0.66],
      [1, 0, 0.9, "C2", 0.9], [1, 1, 0.45, "G1", 0.68], [1, 1.5, 0.45, "A1", 0.7], [1, 2, 0.9, "B1", 0.8], [1, 3, 0.45, "C2", 0.72], [1, 3.5, 0.4, "D2", 0.7]],
    turn: [[0, 0, 0.7, "A1", 0.9], [0, 0.75, 0.2, "A1", 0.55], [0, 1.5, 0.45, "C2", 0.72], [0, 2, 0.9, "E2", 0.84], [0, 3, 0.45, "G2", 0.72], [0, 3.5, 0.4, "E2", 0.66],
      [1, 0, 1.3, "D2", 0.9], [1, 1.5, 0.45, "F#2", 0.7], [1, 2, 0.45, "A2", 0.76], [1, 2.5, 0.9, "F#2", 0.72], [1, 3.5, 0.4, "E2", 0.64]],
  };
  // role cells for the chorus and bridge: [pos, dur, role, vel]
  // R root, 8 octave, 3 third, 5 fifth, 5b fifth below, 7 seventh, 7b seventh (or sixth) below, A approach to the next root
  const CELL1 = [
    [[0, 1.3, "R", 0.9], [1.5, 0.45, "5b", 0.7], [2, 0.9, "R", 0.82], [3, 0.45, "3", 0.72], [3.5, 0.4, "A", 0.66]],
    [[0, 0.7, "R", 0.9], [0.75, 0.2, "R", 0.55], [1.5, 0.45, "3", 0.72], [2, 0.9, "5", 0.8], [3, 0.45, "8", 0.7], [3.5, 0.4, "A", 0.66]],
    [[0, 1.4, "R", 0.9], [2, 0.45, "5b", 0.75], [2.5, 0.9, "R", 0.8], [3.5, 0.4, "A", 0.66]],
  ];
  const CELL2 = [
    [[0, 0.7, "R", 0.9], [0.75, 0.2, "R", 0.55], [1.5, 0.45, "3", 0.72], [2, 0.9, "5", 0.84], [3, 0.45, "7", 0.7], [3.5, 0.4, "5", 0.66],
      [4, 1.3, "R", 0.88], [5.5, 0.45, "5b", 0.7], [6, 0.45, "7b", 0.7], [6.5, 0.9, "R", 0.8], [7.5, 0.4, "A", 0.66]],
    [[0, 1.4, "R", 0.9], [1.5, 0.45, "5", 0.72], [2, 0.9, "7", 0.8], [3, 0.45, "5", 0.7], [3.5, 0.4, "3", 0.66],
      [4, 0.7, "R", 0.88], [4.75, 0.2, "R", 0.5], [5.5, 0.45, "3", 0.7], [6, 0.9, "5", 0.8], [7, 0.45, "5b", 0.68], [7.5, 0.4, "A", 0.66]],
  ];

  // ---------- percussion cells ----------
  // nyabinghi repeater (high conga) improvisations for one bar: [pos, pitch, vel]
  const REPEATER = [
    [[[1.75, 64, 0.38], [2, 67, 0.6], [2.25, 64, 0.34]], 3],
    [[[0.25, 64, 0.34], [0.5, 64, 0.44], [3.5, 67, 0.56], [3.75, 64, 0.4]], 3],
    [[[2.5, 67, 0.5], [2.75, 64, 0.34], [3, 64, 0.46], [3.25, 67, 0.5]], 2],
    [[[1.5, 64, 0.4], [1.75, 64, 0.3], [3.25, 64, 0.36], [3.5, 67, 0.56]], 2],
    [[], 1.5],
  ];
  const REPEATER_ROLL = [[3, 64, 0.42], [3.25, 64, 0.46], [3.5, 67, 0.54], [3.75, 67, 0.62]];

  // ---------- the arc: ten cycles of 8 bars (about 4.3 minutes) ----------
  // drums: onedrop | rockers | steppers | nyah | dub. hand: heart | full. fill: what ends the cycle.
  const PLAN = [
    { sec: "V", name: "Riddim", drums: "onedrop", intro: 1, fill: "pickup", d: "bass, drums, skank" },
    { sec: "V", name: "Verse", drums: "onedrop", mel: "V", fill: "pickup", d: "melodica" },
    { sec: "C", name: "Chorus", drums: "onedrop", snare: 1, mel: "C", shaker: 1, fill: "flam", d: "shaker in" },
    { sec: "V", name: "Verse 2", drums: "onedrop", mel: "V", vary: 1, hand: "heart", shaker: 1, fill: "pickup", d: "hand drums" },
    { sec: "C", name: "Chorus 2", drums: "rockers", snare: 1, mel: "C", vary: 1, hand: "heart", shaker: 1, fill: "stop", d: "rockers" },
    { sec: "B", name: "Bridge", drums: "nyah", mel: "B", hand: "full", organ: "hold", fill: "roll", d: "nyabinghi" },
    { sec: "V", name: "Dub", drums: "dub", mel: "frag", hand: "late", organ: "off", skank: "dub", bass: "dub", fill: "toms", d: "drums out, echo" },
    { sec: "V", name: "Melodica version", drums: "steppers", mel: "solo", hand: "full", shaker: 1, fill: "pickup", d: "steppers" },
    { sec: "C", name: "Last chorus", drums: "onedrop", snare: 1, mel: "C", vary: 1, harm: 1, hand: "heart", shaker: 1, fill: "flam", d: "melodica in thirds" },
    { sec: "V", name: "Outro riddim", drums: "onedrop", mel: "tag", hand: "heart", fill: "toms", d: "riddim and echoes" },
  ];

  /** The skank and bubble play triads: drop sevenths and extensions. */
  const plain = (sym) => { const m = /^([A-G](?:#|b)?)(.*)$/.exec(sym); return m[1] + (/^m(?!aj)/.test(m[2]) ? "m" : ""); };
  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };

  /** Gated triad voicing in a register, smoothest from prev, root position allowed. */
  function triad(sym, lo, hi, prev, r) {
    const pcs = T.chord(sym).pcs;
    let best = null, bestS = Infinity;
    for (const spread of ["close", "any"]) {
      const v = T.voice(sym, { lo, hi, n: 3, rootless: false, spread, prev, rng: r, avoidRootOnTop: false });
      if (new Set(v).size < v.length || v[0] < lo || v[v.length - 1] > hi || !v.every((m) => pcs.includes(mod12(m)))) continue;
      let s = spread === "close" ? 0 : 1;
      if (prev) for (let i = 0; i < Math.min(v.length, prev.length); i++) s += Math.abs(v[v.length - 1 - i] - prev[prev.length - 1 - i]);
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo, hi, n: 3, rootless: false });
  }

  /** A bass note for a role over a chord. */
  function bassRole(role, sym, nextSym, last) {
    const c = T.chord(sym), iv = c.intervals;
    const root = T.nearest(33, [c.bass], 28, 40);
    const third = iv.includes(3) ? 3 : iv.includes(4) ? 4 : 5;
    const fifth = iv.find((x) => x >= 6 && x <= 8) ?? 7;
    const sev = iv.includes(10) ? 10 : iv.includes(11) ? 11 : null;
    switch (role) {
      case "R": return root;
      case "8": return root + 12 <= 45 ? root + 12 : root;
      case "3": return root + third;
      case "5": return root + fifth;
      case "5b": return root + fifth - 12 >= 28 ? root + fifth - 12 : root + fifth;
      case "7": return sev != null ? root + sev : root + 12;
      case "7b": {
        const below = sev != null ? root + sev - 12 : root - 3;
        return below >= 28 ? below : below + 12;
      }
      default: { // approach: a scale step next to the next chord's root, nearest to where the line is
        const nc = T.chord(nextSym), nr = T.nearest(33, [nc.bass], 28, 40);
        const ok = okSet(sym);
        const cands = [2, -1, -2, 1].map((s) => nr + s).filter((m) => m >= 28 && m <= 45 && ok.has(mod12(m)) && G_MAJOR.concat(c.pcs).includes(mod12(m)) && m !== last);
        return cands.length ? cands.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a)) : nr + 2 <= 45 ? nr + 2 : nr - 2;
      }
    }
  }

  Sim.register({
    id: "reggae",
    title: "Island Time",
    genre: "Roots reggae",
    about: "Roots reggae in G at 74 BPM: a deep melodic bass riff, one-drop drums that turn rockers and steppers, guitar skank and organ bubble, nyabinghi hand drums, a melodica tune, a minor bridge and a dub section of echo throws.",
    situations: ["hangout", "campfire"],
    energy: 0.45,
    bpm: 74, beatsPerBar: 4, swing: 0.6, swingUnit: 0.25, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out, bpm } = ctx;
      const spb = 60 / bpm;
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 350, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.01, lowcut: 300, highcut: 7000 });
      const spring = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.006, lowcut: 650, highcut: 4200 });

      // the tape echo: dotted eighth, highpassed in, darkening repeats, a slow drift in time; the desk rides its feedback
      const echoIn = ctx.keep(new Tone.Filter({ frequency: 380, type: "highpass" }));
      const echo = I.delay(ctx, out, { time: 0.75 * spb, feedback: 0.42, highcut: 2300 });
      echoIn.connect(echo);
      const drift = ctx.keep(new Tone.LFO({ frequency: 0.17, min: 0.75 * spb - 0.002, max: 0.75 * spb + 0.002 }).start());
      drift.connect(echo.delayTime);
      I.send(ctx, echo, hall, -12);

      // melody: melodica
      const mel = I.accordion(ctx, { volume: -1, melodica: true, cutoff: 2600 });
      const mp = I.place(ctx, mel, 0.14, out);
      I.send(ctx, mp, hall, -13);
      const melEcho = I.send(ctx, mp, echoIn, -60); melEcho.gain.value = db(-24);

      // harmony: clean guitar skank (spring, echo throws) and organ bubble
      const gtr = I.guitar(ctx, { kind: "clean", volume: -6, dampening: 3400, resonance: 0.9, voices: 12 });
      const gHp = ctx.keep(new Tone.Filter({ frequency: 260, type: "highpass" }));
      const gPan = ctx.keep(new Tone.Panner(-0.34)).connect(out);
      gtr.out.connect(gHp); gHp.connect(gPan);
      I.send(ctx, gPan, spring, -8);
      const gEcho = I.send(ctx, gPan, echoIn, -60); gEcho.gain.value = 0;
      const organ = I.organ(ctx, { volume: -12, partials: [1, 0.55, 0.4, 0.12, 0.06, 0.1] });
      const oHp = ctx.keep(new Tone.Filter({ frequency: 210, type: "highpass" }));
      const oPan = ctx.keep(new Tone.Panner(0.3)).connect(out);
      organ.out.connect(oHp); oHp.connect(oPan);
      I.send(ctx, oPan, room, -12);

      // bass: round fingered electric with a sine underneath
      const bass = I.ebass(ctx, { volume: -3, base: 120 });
      const sub = I.sub(ctx, { volume: -9, attack: 0.01, release: 0.2 });
      I.place(ctx, bass, 0, out); I.place(ctx, sub, 0, out);

      // drums: kit (kick, hats, toms), a snare channel (snare and cross-stick) with an echo send, hand drums
      const kit = I.kit(ctx, { volume: -2, kickNote: 30, preload: ["kick", "hatClosed", "hatOpen", "tom"] });
      const kp = I.place(ctx, kit, 0.03, out);
      I.send(ctx, kp, room, -13);
      const snr = I.kit(ctx, { volume: -3, preload: ["snare", "rim"] });
      const sp = I.place(ctx, snr, 0.06, out);
      I.send(ctx, sp, room, -10);
      const snEcho = I.send(ctx, sp, echoIn, -60); snEcho.gain.value = 0;
      const hand = I.kit(ctx, { volume: -5, preload: ["conga", "congaLow", "tom", "shaker"] });
      const hp = I.place(ctx, hand, -0.22, out);
      I.send(ctx, hp, room, -9); I.send(ctx, hp, hall, -20);

      /** Open a send for one hit, then close it: the dub throw. */
      const gate = (g, t, amt, len, rest = 0) => {
        g.gain.cancelScheduledValues(t - 0.012);
        g.gain.setValueAtTime(rest, t - 0.012);
        g.gain.linearRampToValueAtTime(amt, t - 0.002);
        g.gain.setValueAtTime(amt, t + len);
        g.gain.linearRampToValueAtTime(rest, t + len + 0.05);
      };
      const MEL_REST = db(-24);

      return {
        melodica: {
          layer: "melody",
          play(t, e, d) { if (e.throw) gate(melEcho, t + d * 0.5, e.throw, d * 0.5 + 0.05, MEL_REST); mel.play(t, e.note, d, e.vel); },
          humanize: { timing: 0.012, vel: 0.05 },
        },
        skank: {
          layer: "harmony",
          play(t, e, d) { if (e.throw) gate(gEcho, t, e.throw, d + 0.04); gtr.play(t, e.note, d, e.vel, e.strum ?? 0.007); },
          humanize: { timing: 0.006, vel: 0.06 },
        },
        organ: { layer: "harmony", play: (t, e, d) => organ.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.08 } },
        bass: {
          layer: "bass",
          play(t, e, d) { bass.play(t, e.note, d, e.vel); sub.play(t, e.note, d, e.vel * 0.9); },
          humanize: { timing: 0.008, vel: 0.05 },
        },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.007, vel: 0.1 } },
        snare: {
          layer: "drums",
          play(t, e) { if (e.throw) gate(snEcho, t, e.throw, 0.14); snr.hit(e.note, t, e.vel); },
          humanize: { timing: 0.005, vel: 0.06 },
        },
        hand: { layer: "drums", play: (t, e) => hand.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.01, vel: 0.12 } },
        // the dub desk: swell the echo's feedback, hold, then pull it back
        desk: {
          layer: "texture",
          play(t, e) {
            const up = t + e.up * spb, hold = up + e.hold * spb, down = hold + e.down * spb;
            const f = echo.feedback;
            f.cancelAndHoldAtTime(t); f.linearRampToValueAtTime(e.peak, up); f.setValueAtTime(e.peak, hold); f.linearRampToValueAtTime(0.42, down);
          },
          humanize: { timing: 0, vel: 0 },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % PLAN.length, round = Math.floor(cycle / PLAN.length);
      const plan = PLAN[idx], next = PLAN[(idx + 1) % PLAN.length];
      const minorE = plan.sec === "B" && round % 2 === 1;
      const key = plan.sec === "B" ? (minorE ? "Be" : "Bg") : plan.sec;
      const prog = PROG[key];
      const nextKey = next.sec === "B" ? ((round + (idx + 1 === PLAN.length ? 1 : 0)) % 2 ? "Be" : "Bg") : next.sec;
      const sym = (abs) => prog[Math.max(0, Math.min(7, Math.floor(abs / 4)))].chord;
      const symNext = (abs) => (abs >= 32 ? PROG[nextKey][0].chord : sym(abs));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const swells = [];
      const swell = (abs, peak, up, hold, down) => {
        if (swells.some((s) => abs < s.end && abs + up + hold + down > s.abs)) return;
        swells.push({ abs, end: abs + up + hold + down });
        push("desk", abs, up + hold + down, "swell", 0.5, { peak, up, hold, down });
      };

      // per-round drum flavour: the second time round the verse-2 groove steps, the first chorus rocks
      let drums = plan.drums;
      if (round % 2 === 1 && idx === 3) drums = "steppers";
      if (round % 2 === 1 && idx === 2) drums = "rockers";

      // ---------- melodica ----------
      const notes = [];
      const addTheme = (src, shift, opts = {}) => src.forEach(([bar, beat, dur, n]) => {
        const at = (bar + shift) * 4 + beat;
        if (at < 0 || at >= 32) return;
        notes.push({ at, dur, note: T.midi(n) + (opts.tr || 0), ph: Math.floor(bar / 2) + shift / 2 });
      });
      const phrase = (src, p) => src.filter(([bar]) => Math.floor(bar / 2) === p);
      if (plan.mel === "V" || plan.mel === "C") addTheme(THEME[plan.mel], 0);
      else if (plan.mel === "B") addTheme(THEME.B, 0, { tr: minorE ? -3 : 0 });
      else if (plan.mel === "frag") {
        if (r.chance(0.5)) { addTheme(phrase(THEME.V, 0), 0); addTheme(phrase(THEME.V, 2), 0); }
        else { addTheme(phrase(THEME.V, 1), 0); addTheme(phrase(THEME.V, 3), 0); }
      } else if (plan.mel === "tag") { addTheme(phrase(THEME.V, 0), 0); addTheme(phrase(THEME.V, 1), 0); }
      else if (plan.mel === "solo") {
        // a dub-version melodica: it calls with a phrase of the tune (as written, an octave down, or pushed
        // an eighth late) and answers itself with an improvisation built on the tune's own cell
        const calls = [[0, r.pick([0, 0, 1])], [2, r.pick([2, 1])]]; // [bar of the call, which phrase]
        calls.forEach(([bar, p], k) => {
          const how = r.weighted([["orig", 3], ["low", round > 0 ? 1.5 : 0.8], ["late", 1.2]]);
          phrase(THEME.V, p).forEach(([b, beat, dur, n]) => {
            const at = (b - p * 2 + bar * 2) * 4 + beat + (how === "late" ? 0.5 : 0);
            notes.push({ at, dur: how === "late" ? Math.max(0.3, dur - 0.5) : dur, note: T.midi(n) - (how === "low" ? 12 : 0), ph: k * 2 });
          });
          const m = C.line({
            start: (bar * 2 + 2) * 4 + 0.5, end: (bar * 2 + 4) * 4 - 0.5, chordAt: sym, lo: 64, hi: 86, rng: r.fork(7 + k),
            density: 0.34 + 0.12 * k + 0.05 * (round % 3), phrase: [3, 6], rest: [0.5, 1.5], motif: state.soloMotif || THEME_MOTIF,
            motifProb: 0.6, chromatic: 0.08, register: 0.5 + 0.12 * k, prev: notes[notes.length - 1].note, upbeatStart: 0.7, scaleFor: () => G_MAJOR,
          });
          state.soloMotif = m.motif;
          m.notes.forEach((n) => notes.push({ at: n.beat, dur: n.dur, note: n.note, ph: k * 2 + 1, solo: true }));
        });
      }
      if (notes.length) {
        notes.sort((a, b) => a.at - b.at);
        // ornaments on repeats: a slide into long notes from a scale step below, or a quick upper mordent
        let out = notes;
        if ((plan.vary || round > 0) && plan.mel !== "solo") {
          out = [];
          notes.forEach((n, i) => {
            const prevEnd = i ? notes[i - 1].at + notes[i - 1].dur : -9;
            const sc = okSet(sym(n.at));
            const pick = n.dur >= 1 ? r.weighted([["none", 5], ["slide", 1.6], ["mordent", 1.2]]) : "none";
            if (pick === "slide" && n.at - prevEnd >= 0.24 && n.at >= 0.25) {
              const g = T.step(n.note, -1, [...sc]);
              if (n.note - g <= 2) out.push({ at: n.at - 0.25, dur: 0.25, note: g, ph: n.ph, grace: true });
              out.push(n);
            } else if (pick === "mordent" && n.dur >= 1.25) {
              const up = T.step(n.note, 1, [...sc]);
              if (up - n.note <= 2) {
                out.push({ at: n.at, dur: 0.25, note: n.note, ph: n.ph, grace: true }, { at: n.at + 0.25, dur: 0.25, note: up, ph: n.ph, grace: true }, { ...n, at: n.at + 0.5, dur: n.dur - 0.5 });
              } else out.push(n);
            } else out.push(n);
          });
        }
        // legato, never overlapping, nothing held into a chord where it clashes
        out.forEach((n, i) => {
          if (i + 1 < out.length) n.dur = Math.min(n.dur, out[i + 1].at - n.at - 0.04);
          n.dur = Math.min(n.dur, 31.9 - n.at);
          const ok = okSet(sym(n.at));
          if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]);
          const nextBar = Math.floor(n.at / 4) * 4 + 4;
          if (nextBar < n.at + n.dur - 0.1 && !okSet(sym(nextBar)).has(mod12(n.note))) n.dur = Math.max(0.2, nextBar - n.at - 0.05);
        });
        // echo throws: phrase-final long notes (always in the dub and the outro)
        const throwP = plan.mel === "frag" || plan.mel === "tag" ? 1 : plan.mel === "solo" ? 0.3 : 0.35;
        const phs = [...new Set(out.map((n) => n.ph))];
        phs.forEach((p) => {
          const xs = out.filter((n) => n.ph === p && !n.grace), n = xs[xs.length - 1];
          if (n && n.dur >= 1 && r.chance(throwP)) n.throw = r.range(0.5, 0.75);
        });
        out.forEach((n) => {
          if (n.dur < 0.1) return;
          let note = n.note;
          if (plan.harm && !n.grace) { // parallel harmony a third (or fourth/sixth) below, from the chord where possible
            const c = T.chord(sym(n.at));
            const below = [];
            for (let m = n.note - 3; m >= n.note - 9; m--) if (c.pcs.includes(mod12(m))) below.push(m);
            const lo = below.length ? below[0] : T.step(n.note, -2, G_MAJOR);
            if (n.note - lo >= 3) note = [lo, n.note];
          }
          const vel = (n.grace ? 0.5 : n.dur >= 1.25 ? 0.72 : 0.64) + r.gauss(0.025);
          push("melodica", n.at, n.dur, note, vel, n.throw ? { throw: n.throw } : undefined);
        });
        const lastN = out[out.length - 1];
        if (lastN) state.melLast = lastN.note;
      }

      // ---------- skank: clean guitar on 2 and 4 ----------
      const skankAt = (abs, vel, extra = {}) => {
        const s = plain(sym(abs));
        const v = triad(s, 63, 76, state.skV, r);
        state.skV = v;
        push("skank", abs, extra.dur ?? 0.22, v, vel, extra);
      };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        if (plan.skank === "dub") {
          // only a few chops survive, each thrown into the echo
          if (bar < 4) {
            if (bar % 2 === 0) skankAt(B + 1, 0.56, { throw: r.range(0.7, 0.9) });
            else if (r.chance(0.6)) skankAt(B + 3, 0.52, { throw: r.range(0.65, 0.85) });
          } else {
            skankAt(B + 1, 0.54); skankAt(B + 3, 0.58, bar === 7 ? { throw: 0.8 } : {});
          }
          continue;
        }
        const double = drums === "steppers" ? 0.22 : 0.1;
        skankAt(B + 1, 0.54 + r.range(-0.03, 0.03));
        const thr = (bar === 3 || bar === 7) && r.chance(0.3) ? r.range(0.55, 0.8) : 0;
        skankAt(B + 3, 0.58 + r.range(-0.03, 0.03), thr ? { throw: thr } : {});
        if (r.chance(double) && !(bar === 7 && plan.fill === "stop")) skankAt(B + 3.75, 0.3, { dur: 0.12, strum: -0.005 }); // the up-stroke ghost
      }

      // ---------- organ: bubble (low on the beat, high on the "and"), or held chords in the bridge ----------
      if (plan.organ === "hold") {
        for (let bar = 0; bar < 8; bar++) {
          const s = prog[bar].chord;
          if (bar > 0 && prog[bar - 1].chord === s) continue;
          const len = bar < 7 && prog[bar + 1].chord === s ? 8 : 4;
          const v = T.voice(s, { lo: 55, hi: 72, n: 4, prev: state.orgHi, top: [65, 71], rng: r });
          state.orgHi = v;
          push("organ", bar * 4, len - 0.1, v, 0.34);
        }
      } else if (plan.organ !== "off") {
        const from = plan.intro && round === 0 ? 2 : 0;
        for (let bar = from; bar < 8; bar++) {
          const s = plain(prog[bar].chord), c = T.chord(s);
          const hi = triad(s, 54, 67, state.orgHi, r);
          state.orgHi = hi;
          const root = T.nearest(47, [c.root], 43, 54);
          const lo = [root, root + 7];
          const stop = bar === 7 && plan.fill === "stop" ? 2 : 4;
          for (let b = 0; b < stop; b++) {
            push("organ", bar * 4 + b, 0.28, lo, 0.3 + (b % 2) * 0.03);
            push("organ", bar * 4 + b + 0.5, 0.24, hi, 0.4 + r.range(-0.03, 0.03));
            if (r.chance(0.18)) push("organ", bar * 4 + b + 0.75, 0.14, hi, 0.26);
          }
        }
      }

      // ---------- bass ----------
      let last = state.bassLast ?? 31;
      const bassEv = (abs, dur, n, vel) => { push("bass", abs, dur, n, vel); last = n; };
      if (plan.sec === "V") {
        const riffB = r.chance(0.5 + 0.1 * round);
        const pairs = [RIFF.a, riffB ? RIFF.b : RIFF.a, RIFF.a, RIFF.turn];
        pairs.forEach((cell, pi) => cell.forEach(([bar, beat, dur, n, vel]) => {
          const abs = (pi * 2 + bar) * 4 + beat;
          if (plan.bass === "dub" && abs >= 20 && abs < 23.5) return; // the bass drop: one bar of drums alone
          if (plan.intro && round === 0 && abs < 1) vel *= 1.05;
          let note = T.midi(n);
          // later passes: an octave-up answer on the last eighth now and then
          if ((round > 0 || plan.vary) && beat === 3.5 && r.chance(0.12) && note + 12 <= 45) note += 12;
          bassEv(abs, dur, note, vel);
          // ghost repeats in the gaps
          if ((round > 0 || drums === "steppers") && (beat === 1.5 || beat === 3) && r.chance(0.12)) push("bass", abs - 0.25, 0.15, note, 0.32);
        }));
      } else {
        for (let bar = 0; bar < 8; bar++) {
          const s = prog[bar].chord;
          if (bar > 0 && prog[bar - 1].chord === s) continue;
          const two = bar < 7 && prog[bar + 1].chord === s;
          const cell = two ? r.pick(CELL2) : r.pick(CELL1);
          const span = two ? 8 : 4;
          cell.forEach(([pos, dur, role, vel]) => {
            const abs = bar * 4 + pos;
            const n = bassRole(role, s, symNext(bar * 4 + span), last);
            if (plan.fill === "stop" && abs >= 30) return;
            bassEv(abs, dur, n, vel);
          });
        }
        if (plan.fill === "stop") bassEv(28 + 2, 1.5, bassRole("R", prog[7].chord, null, last), 0.8);
      }
      state.bassLast = last;

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, vel, extra);
      const SN = (abs, voice, vel, thr) => push("snare", abs, 0.1, voice, vel, thr ? { throw: thr } : undefined);
      const H = (abs, voice, vel, pitch) => push("hand", abs, 0.1, voice, vel, pitch ? { pitch } : undefined);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        let mode = drums;
        if (mode === "dub") mode = bar < 4 ? "none" : "onedrop";
        const fill = bar === 7 ? plan.fill : bar === 3 && mode === "onedrop" && r.chance(0.22) ? "flam" : null;
        const hatStop = fill === "roll" ? 2.5 : fill === "stop" ? 2.25 : fill === "toms" ? 3 : fill === "pickup" ? 3.25 : fill === "flam" ? 3.5 : 4;
        const drop = plan.snare ? "snare" : "rim";
        // kick and the drop
        if (mode === "onedrop") { D(B + 2, "kick", 0.92); SN(B + 2, drop, drop === "snare" ? 0.72 : 0.8); }
        else if (mode === "rockers") {
          D(B, "kick", 0.85); D(B + 2, "kick", 0.92); SN(B + 2, drop, drop === "snare" ? 0.74 : 0.8);
          if (r.chance(0.3) && hatStop >= 4) D(B + 3.5, "kick", 0.5);
        } else if (mode === "steppers") {
          [0.86, 0.7, 0.92, 0.72].forEach((v, b) => { if (b < hatStop) D(B + b, "kick", v); });
          SN(B + 2, "snare", 0.7);
        } else if (mode === "nyah") SN(B + 2, "rim", 0.55);
        // hats
        if (mode !== "none") {
          const style = mode === "steppers" ? "off" : mode === "rockers" ? "16" : mode === "nyah" ? "4" : "8s";
          const open = (style === "8s" || style === "16") && bar % 4 === 3 && hatStop >= 4 && r.chance(0.55);
          for (let s = 0; s < 16; s++) {
            const p = s / 4, q = s % 4;
            if (p >= hatStop || (open && p >= 3.5)) break;
            if (style === "8s") {
              if (q === 0) D(B + p, "hatClosed", 0.3 + r.gauss(0.02));
              else if (q === 2) D(B + p, "hatClosed", 0.22 + r.gauss(0.02));
              else if (q === 3 && r.chance(0.3)) D(B + p, "hatClosed", 0.13);
              else if (q === 1 && r.chance(0.05)) D(B + p, "hatClosed", 0.1);
            } else if (style === "16") D(B + p, "hatClosed", [0.3, 0.12, 0.22, 0.15][q] + r.gauss(0.02));
            else if (style === "off") { if (q === 2) D(B + p, "hatOpen", 0.18 + r.gauss(0.015)); else if (q === 0) D(B + p, "hatClosed", 0.2); }
            else if (style === "4" && q === 0) D(B + p, "hatClosed", 0.15 + r.gauss(0.02));
          }
          if (open) D(B + 3.5, "hatOpen", 0.24);
          // a cross-stick ghost on the "a" of 4
          if ((mode === "onedrop" || mode === "rockers") && hatStop >= 4 && r.chance(0.16)) SN(B + 3.75, "rim", 0.2);
        }
        // fills
        if (fill === "pickup") [[3.25, 0.4], [3.5, 0.55], [3.75, 0.7]].forEach(([p, v]) => SN(B + p, "snare", v));
        else if (fill === "flam") { SN(B + 3.5, "snare", 0.5); SN(B + 3.75, "snare", 0.72, r.range(0.6, 0.8)); }
        else if (fill === "toms") { SN(B + 2.75, "snare", 0.5); [[3, 50, 0.55], [3.25, 47, 0.6], [3.5, 45, 0.64], [3.75, 41, 0.7]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch })); }
        else if (fill === "roll") [2.5, 2.75, 3, 3.25, 3.5, 3.75].forEach((p, i) => SN(B + p, "snare", 0.34 + i * 0.08, i === 5 ? 0.85 : 0));
        else if (fill === "stop") { SN(B + 3, "snare", 0.82, 0.9); swell(B + 3, 0.62, 0.25, 2, 3); }
        if (fill === "roll") swell(B + 3.75, 0.6, 0.25, 1.5, 3);

        // hand drums: funde heartbeat, repeater, akete
        const handOn = plan.hand === "full" || plan.hand === "heart" || (plan.hand === "late" && bar >= 4);
        if (handOn && !(fill === "stop" && false)) {
          const stopH = fill === "stop" ? 2.5 : 4;
          [[0.5, 0.26], [1, 0.52], [2.5, 0.26], [3, 0.54]].forEach(([p, v]) => { if (p < stopH) H(B + p, "congaLow", v, p % 1 ? 50 : 52); });
          if (plan.hand === "full" || drums === "nyah") {
            if (bar % 2 === 0) H(B, "tom", 0.42, 38);
            const cell = bar === 7 ? REPEATER_ROLL : r.weighted(REPEATER);
            cell.forEach(([p, pitch, v]) => { if (p < stopH) H(B + p, "conga", v, pitch); });
          }
        }
        // shaker: swung sixteenths, pushing the "and"
        if (plan.shaker || (plan.drums === "dub" && bar >= 4) || mode === "steppers") {
          for (let s = 0; s < 16; s++) { const p = s / 4; if (p >= hatStop) break; H(B + p, "shaker", [0.13, 0.06, 0.17, 0.08][s % 4] + r.gauss(0.012)); }
        }
      }
      // the dub: single thrown hits where the kit is silent, and the desk opening up
      if (plan.drums === "dub") {
        SN(1 * 4 + 2, "snare", 0.8, 0.9); swell(1 * 4 + 2, 0.66, 0.5, 3, 2);
        SN(3 * 4 + 3.5, "rim", 0.7, 0.85); swell(3 * 4 + 3.5, 0.6, 0.25, 1, 2);
        D(3 * 4 + 2, "kick", 0.7);
      }
      if (plan.intro && round === 0) { /* cue in: nothing before bar 1; the riddim starts on the one */ }

      const label = [plan.name, plan.sec === "B" ? (minorE ? "E minor" : "G minor") : null, plan.d, round > 0 ? `round ${round + 1}` : null].filter(Boolean).join(" · ");
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();

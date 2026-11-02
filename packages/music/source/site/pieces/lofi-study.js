// Study Hall: lo-fi hip hop beats to study to, in D major at 78 BPM.
//
// The keys are a "sample": each four-bar chord loop is voiced and rhythmed once per pass of the arc
// and then repeats exactly, the way a chopped record loop does. Everything moves around it instead:
// a dusty boom-bap kit on heavily swung 16ths with lazy late snares, a mellow bass, short hooks on
// clean guitar, flute or a chopped choir that come back varied (pushed a 16th, grace notes, dropped
// notes), and a tape-and-vinyl bus with rain outside.
//
// Loops: A  Gmaj9 · F#m7 B7#9 · Em9 · A13sus4 A7b9   (IV iii VI7 ii V, the V falls back to IV)
//        B  Bm9 · Gmaj9 · Em11 · F#7#9                (the relative minor, a blue 7#9 turnaround)
//        C  Dmaj9 · Bm9 · Gmaj9 · Gm9 C13             (borrowed minor iv and a backdoor bVII13 home)
//        D  Bbmaj9 · Am9 · Dm9 · Gm9 C13 / Gm9 A7#9   (A7b9 slips deceptively onto Bbmaj9: a chromatic-
//                                                      mediant visit to F, and Gm9 pivots back as iv of D)
// The arc (13 cycles of two loops, about 5.3 minutes): needle drop with the filter shut, guitar hook,
// flute over loop B, a filter-down where the beat drops out and comes back with a snare lift, a drum-
// machine section (808 kick, clap and snap, 808 hats, bongos) with Rhodes and choir chops, a half-time
// trip to F, a flute/guitar trade, and a fade into the next needle drop.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  const LOOPS = {
    A: "| Gmaj9 | F#m7 B7#9 | Em9 | A13sus4 A7b9 |",
    B: "| Bm9 | Gmaj9 | Em11 | F#7#9 |",
    C: "| Dmaj9 | Bm9 | Gmaj9 | Gm9 C13 |",
    D: "| Bbmaj9 | Am9 | Dm9 | Gm9 C13 |",
    Dx: "| Bbmaj9 | Am9 | Dm9 | Gm9 A7#9 |",
  };
  const PROG = Object.fromEntries(Object.entries(LOOPS).map(([k, v]) => [k, T.progression(v)]));

  // ---------- hooks: [bar, beat, dur, note] within a 4-bar loop ----------
  const H = (xs) => xs.map(([bar, beat, dur, n]) => ({ at: bar * 4 + beat, dur, note: T.midi(n) }));
  const HOOK = {
    // a rising 9-3-5-7 pickup onto a held maj7; the same shape lands on Em9 as 3-5-7-9; the b9 of A7b9
    // resolves down to the 9th of Gmaj9 when the loop comes round
    A: H([[0, 0.75, 0.25, "A4"], [0, 1, 0.5, "B4"], [0, 1.5, 0.5, "D5"], [0, 2, 1.5, "F#5"],
      [1, 0.5, 0.5, "E5"], [1, 1, 0.75, "C#5"], [1, 2, 0.5, "D5"], [1, 2.5, 1.25, "A4"],
      [2, 0.75, 0.25, "G4"], [2, 1, 0.5, "B4"], [2, 1.5, 0.5, "D5"], [2, 2, 1, "F#5"], [2, 3, 0.5, "E5"],
      [3, 0.5, 0.5, "D5"], [3, 1, 0.5, "B4"], [3, 1.5, 0.5, "A4"], [3, 2, 0.5, "C#5"], [3, 2.5, 1.25, "Bb4"]]),
    // a falling line in B minor that climbs to the 11th of Em11 and hangs on the blue #9 of F#7#9
    B: H([[0, 1, 0.75, "F#5"], [0, 1.75, 0.25, "E5"], [0, 2, 1, "D5"], [0, 3, 1, "C#5"],
      [1, 0.5, 0.5, "D5"], [1, 1, 1.5, "F#5"], [1, 2.5, 0.5, "E5"], [1, 3, 0.75, "D5"],
      [2, 0, 1.5, "A5"], [2, 1.5, 0.5, "G5"], [2, 2, 0.5, "F#5"], [2, 2.5, 1, "D5"],
      [3, 0.5, 0.5, "C#6"], [3, 1, 1, "A#5"], [3, 2, 0.5, "A5"], [3, 2.5, 1.25, "F#5"]]),
    // vocal chops: the same off-beat cell every bar (and-of-1, 2, and-of-3, 4)
    C: H([[0, 0.5, 0.5, "C#5"], [0, 1, 0.75, "E5"], [0, 2.5, 0.5, "A4"], [0, 3, 0.5, "C#5"],
      [1, 0.5, 0.5, "C#5"], [1, 1, 0.75, "D5"], [1, 2.5, 0.5, "F#4"], [1, 3, 0.5, "A4"],
      [2, 0.5, 0.5, "A4"], [2, 1, 0.75, "B4"], [2, 2.5, 0.5, "D5"], [2, 3, 1, "F#5"],
      [3, 0.5, 0.5, "F5"], [3, 1, 0.75, "D5"], [3, 2, 0.5, "Bb4"], [3, 2.5, 1, "A4"]]),
    // F major: wide, airy intervals up to the 9th of Bbmaj9, an arpeggio climbing Dm9
    D: H([[0, 0.5, 0.5, "F5"], [0, 1, 1, "A5"], [0, 2, 1.5, "C6"],
      [1, 0.5, 0.5, "B5"], [1, 1, 1, "G5"], [1, 2, 1.5, "E5"],
      [2, 0.5, 0.5, "F5"], [2, 1, 0.5, "A5"], [2, 1.5, 0.5, "C6"], [2, 2, 1, "D6"], [2, 3, 0.5, "C6"], [2, 3.5, 0.5, "A5"],
      [3, 0, 1, "Bb5"], [3, 1, 1, "A5"], [3, 2, 1.5, "E5"]]),
  };
  // the exit loop: the blue #9 of A7#9 rubs up into its third, and the third leads to D
  HOOK.Dx = HOOK.D.filter((n) => n.at < 12).concat(H([[3, 0, 1, "Bb5"], [3, 1, 0.5, "A5"], [3, 1.5, 0.5, "G5"], [3, 2, 0.5, "C6"], [3, 2.5, 1.25, "C#6"]]));

  // ---------- the arc ----------
  // loops: the two loops of the cycle; keys: piano | rhodes; drums: boom | boom2 | machine | lazy;
  // hook: instrument for the hook (trade = flute and guitar split the hook); fd: [fromBar, toBar) filter-down
  const PLAN = [
    { loops: ["A", "A"], keys: "piano", drums: "boom", intro: 1, rain: 1, d: "needle drop" },
    { loops: ["A", "A"], keys: "piano", drums: "boom", hook: "guitar", rain: 1, d: "guitar hook" },
    { loops: ["A", "A"], keys: "piano", drums: "boom", hook: "guitar", vary: 1, shaker: 1, rain: 0.7, d: "guitar, answered" },
    { loops: ["B", "B"], keys: "piano", drums: "boom2", hook: "flute", shaker: 1, rain: 0.7, d: "flute" },
    { loops: ["B", "B"], keys: "piano", drums: "boom2", fd: [0, 4], hook: "flute", hookLoops: [1], rain: 1.4, d: "filter-down" },
    { loops: ["C", "C"], keys: "rhodes", drums: "machine", hook: "choir", rain: 0.7, d: "drum machine, choir chops" },
    { loops: ["C", "C"], keys: "rhodes", drums: "machine", hook: "guitar", bongo: 1, rain: 0.7, d: "drum machine, guitar" },
    { loops: ["A", "A"], keys: "piano", drums: "boom", shaker: 1, rain: 1, d: "just the loop" },
    { loops: ["D", "Dx"], keys: "rhodes", drums: "lazy", hook: "flute", shaker: 1, rain: 1.4, d: "half-time, F major" },
    { loops: ["C", "C"], keys: "rhodes", drums: "machine", fd: [0, 3], hook: "choir", hookLoops: [1], bongo: 1, rain: 1, d: "filter-down, choir" },
    { loops: ["B", "B"], keys: "piano", drums: "boom2", hook: "trade", shaker: 1, rain: 0.7, d: "flute and guitar trade" },
    { loops: ["A", "A"], keys: "piano", drums: "boom", hook: "guitar", vary: 1, shaker: 1, rain: 1, d: "guitar" },
    { loops: ["A", "A"], keys: "piano", drums: "boom", fd: [6, 8], hook: "guitar", hookLoops: [0], vary: 1, rain: 1.4, d: "fading out" },
  ];

  // ---------- comping cells for the sampled keys: [beat, dur, roll] ----------
  const K4 = [
    [[[0, 1.6, 1], [1.75, 2.1, 0]], 3], [[[0, 3.8, 1]], 2], [[[0, 0.7, 0], [0.75, 1.1, 0], [2.5, 1.4, 1]], 2],
    [[[0, 2.3, 1], [2.75, 1.1, 0]], 2], [[[0, 1.4, 0], [1.5, 0.4, 0], [2.5, 1.4, 1]], 1],
  ];
  const K2 = [[[[0, 1.8, 1]], 3], [[[0, 0.7, 0], [0.75, 1.1, 0]], 2], [[[0.5, 1.4, 1]], 1]];
  // bass cells: [pos, dur, role]  R root, O octave, F fifth, T third, A approach (into the next root)
  const B4 = [
    [[[0, 1.5, "R"], [1.75, 0.5, "R"], [2.5, 1.25, "F"]], 3],
    [[[0, 2.25, "R"], [2.75, 0.5, "O"], [3.5, 0.5, "A"]], 2.5],
    [[[0, 3.25, "R"], [3.5, 0.5, "A"]], 2],
    [[[0, 0.75, "R"], [1.5, 1, "R"], [2.75, 1, "T"]], 1.5],
  ];
  const B2 = [[[[0, 1.75, "R"]], 3], [[[0, 1, "R"], [1.5, 0.5, "A"]], 2], [[[0, 0.75, "R"], [1, 0.75, "O"]], 1]];
  // kick patterns per mode (beats within a bar)
  const KICKS = {
    boom: [[0, 0.75, 2.5], [0, 2.5, 2.75], [0, 1.75, 2.5], [0, 2.25], [0, 0.5, 2.5]],
    boom2: [[0, 0.75, 2.5, 2.75], [0, 1.75, 2.5], [0, 0.5, 2.25, 2.75], [0, 2.5, 3.25]],
    machine: [[0, 1.5, 2.5], [0, 0.75, 2.5, 3.5], [0, 2.5], [0, 2.25, 2.75]],
    lazy: [[0, 2.75], [0, 1.5, 2.75], [0, 0.75, 2.75]],
  };

  const muddy = (v) => v.some((m, i) => i > 0 && ((v[i - 1] < 55 && m - v[i - 1] < 3) || (v[i - 1] < 65 && m - v[i - 1] === 1)));
  /** The smoothest clean voicing across spreads and floors. */
  function voiceKeys(sym, prev, n, r) {
    const top = [64, 72];
    let best = null, bestS = Infinity;
    for (const spread of ["any", "close", "drop2", "open"]) for (const lo of [50, 52, 55]) {
      const v = T.voice(sym, { lo, hi: 75, n, prev, top, spread, rng: r });
      if (muddy(v) || new Set(v).size < v.length) continue;
      let s = 0;
      if (prev && prev.length) {
        const b = prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - 62);
      const t = v[v.length - 1];
      if (t > top[1]) s += (t - top[1]) * 1.5;
      if (t < top[0]) s += (top[0] - t) * 1.5;
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo: 55, hi: 77, n: 4, prev });
  }
  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };
  const loopChordAt = (L) => { const p = PROG[L]; return (b) => { let cur = p[0]; for (const h of p) { if (h.bar * 4 + h.beat <= b + 1e-6) cur = h; else break; } return cur; }; };

  /** The keys loop: voiced and rhythmed once, repeated like a sample. */
  function keysLoop(L, r) {
    const prog = PROG[L];
    const voicings = [];
    let v = null;
    for (let pass = 0; pass < 2; pass++) prog.forEach((h, i) => { v = voiceKeys(h.chord, v, r.chance(0.35) ? 5 : 4, r); if (pass) voicings[i] = v; });
    const hits = [];
    prog.forEach((h, i) => {
      const s0 = h.bar * 4 + h.beat;
      r.weighted(h.dur >= 4 ? K4 : K2).forEach(([b, d, roll]) => hits.push({ at: s0 + b, d, v: voicings[i], roll: !!roll }));
    });
    hits.sort((a, b) => a.at - b.at);
    hits.forEach((x, i) => { const nx = i + 1 < hits.length ? hits[i + 1].at : 16; x.d = Math.min(x.d, nx - x.at - 0.06); });
    return hits;
  }
  function bassLoop(L, r) {
    return PROG[L].map((h) => ({ start: h.bar * 4 + h.beat, len: h.dur, chord: h.chord, cell: r.weighted(h.dur >= 4 ? B4 : B2) }));
  }

  /** A hook coming back: pushed or dragged a 16th, a weak note dropped, grace notes into long ones. */
  function varyHook(src, r, L) {
    const chordAt = loopChordAt(L);
    let ns = src.map((n) => ({ ...n }));
    if (r.chance(0.45)) {
      const h = r.pick([0, 8]), s = r.pick([0.25, -0.25, 0.5]);
      ns.forEach((n) => { if (n.at >= h && n.at < h + 8 && n.at + s >= 0) n.at += s; });
    }
    if (r.chance(0.5)) {
      const weak = ns.filter((n) => n.dur <= 0.5 && Math.abs(n.at - Math.round(n.at)) > 1e-6);
      if (weak.length > 3) ns.splice(ns.indexOf(r.pick(weak)), 1);
    }
    ns.slice().forEach((n) => {
      if (n.dur < 1 || !r.chance(0.35)) return;
      const before = ns.filter((m) => m.at < n.at - 1e-6);
      const p = before[before.length - 1];
      if (p && (p.at + 0.3 > n.at - 0.25 || Math.abs(p.note - n.note) > 5)) return;
      const sc = T.chord(chordAt(n.at).chord).scale;
      let g = T.step(n.note, r.chance(0.7) ? 1 : -1, sc);
      if (p && g === p.note) g = T.step(n.note, g > n.note ? -1 : 1, sc);
      ns.push({ at: n.at - 0.25, dur: 0.22, note: g, grace: 1 });
    });
    return fitHook(ns, L);
  }
  /** Sort, keep legato without overlaps, and fit every onset to the chord under it. */
  function fitHook(ns, L) {
    const chordAt = loopChordAt(L), prog = PROG[L];
    ns.sort((a, b) => a.at - b.at);
    ns = ns.filter((n, i) => !(i + 1 < ns.length && ns[i + 1].at - n.at < 0.2));
    ns.forEach((n, i) => {
      const nx = ns[i + 1];
      if (nx) n.dur = Math.min(n.dur, nx.at - n.at - 0.04);
      n.dur = Math.max(0.15, Math.min(n.dur, 15.9 - n.at));
      const ok = okSet(chordAt(n.at).chord);
      if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]);
      for (const h of prog) { // don't hold into a chord the note clashes with
        const s = h.bar * 4 + h.beat;
        if (s > n.at + 0.01 && s < n.at + n.dur - 0.1 && !okSet(h.chord).has(mod12(n.note))) { n.dur = Math.max(0.2, s - n.at - 0.05); break; }
      }
    });
    return ns;
  }

  /** A continuous source behind a gain that each cycle's event renews (and that fades if nothing renews it). */
  function bed(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    const clock = Sim.instruments.monotonic(g);
    return {
      input: g,
      play(t, level, durSec, fade = 2) {
        const at = clock(t);
        g.gain.cancelAndHoldAtTime(at);
        g.gain.setTargetAtTime(Math.max(0, level), at, fade / 3);
        g.gain.setTargetAtTime(0, at + durSec + 0.4, 1.2);
      },
    };
  }

  Sim.register({
    id: "lofi-study",
    title: "Study Hall",
    genre: "Lo-fi hip hop",
    about: "Lo-fi hip hop in D at 78 BPM: sampled-sounding piano and Rhodes loops of maj9, m9 and 7#9 chords, a dusty swung boom-bap kit with lazy snares, clean guitar, flute and chopped-choir hooks, rain on the window, and a filter-down where the beat drops out and comes back.",
    situations: ["work", "hangout", "sleep"],
    energy: 0.35,
    bpm: 78, swing: 0.6, swingUnit: 0.25, beatsPerBar: 4, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      // the music runs through a worn tape; reverbs, rain and vinyl sit outside it
      const tape = I.tape(ctx, out, { wow: 0.32, wowRate: 0.55, flutter: 0.05, cutoff: 6400, drive: 0.09 });
      const room = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.012, lowcut: 320, highcut: 5200 });
      const hall = I.reverb(ctx, out, { decay: 3.8, preDelay: 0.03, lowcut: 450, highcut: 5000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.27, highcut: 2200 });
      // the "sample" bus: keys, hooks and bass share the filter that closes for the filter-downs
      const OPEN = 6500;
      const sample = ctx.keep(new Tone.Filter({ frequency: OPEN, type: "lowpass", rolloff: -24, Q: 1.6 })).connect(tape);
      let lastCut = OPEN;
      const setCut = (t, c) => { if (!(c > 0) || c === lastCut) return; lastCut = c; sample.frequency.setTargetAtTime(c, Math.max(t, sample.context.currentTime), 0.14); };

      const piano = I.softPiano(ctx, { volume: -4, cutoff: 2300, decay: 4, release: 1.2 });
      const rhodes = I.rhodes(ctx, { volume: -6, cutoff: 2600, tremolo: 2.8, tremoloDepth: 0.22, bark: 1.8, tine: -17 });
      const guitar = I.guitar(ctx, { kind: "clean", chorus: true, volume: -1 });
      const flute = I.flute(ctx, { volume: -3, breath: -18, vibratoDepth: 0.04 });
      const choir = I.choir(ctx, { vowel: "o", volume: -5, attack: 0.02, release: 0.35 });
      const bass = I.ebass(ctx, { volume: -3, base: 105 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 31, preload: ["kick", "snare", "rim", "hatClosed", "hatOpen", "shaker"] });

      const kp = I.place(ctx, piano, -0.12, sample), rp = I.place(ctx, rhodes, -0.12, sample);
      const gp = I.place(ctx, guitar, 0.28, sample), fp = I.place(ctx, flute, 0.18, sample), cp = I.place(ctx, choir, -0.25, sample);
      I.place(ctx, bass, 0, sample);
      I.send(ctx, sample, room, -15);
      I.send(ctx, kp, hall, -19); I.send(ctx, rp, hall, -18);
      I.send(ctx, gp, echo, -14); I.send(ctx, gp, room, -12);
      I.send(ctx, fp, hall, -10); I.send(ctx, fp, echo, -17);
      I.send(ctx, cp, hall, -8);
      // the kit is dusty: darkened before the tape
      const dust = ctx.keep(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 })).connect(tape);
      const kitP = I.place(ctx, kit, 0.02, dust);
      I.send(ctx, kitP, room, -21);

      // rain on the window: pink noise in a moving band, plus the odd drip on the sill
      const rain = bed(ctx, out);
      const rainLp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12 })).connect(rain.input);
      const rainHp = ctx.keep(new Tone.Filter({ frequency: 450, type: "highpass" })).connect(rainLp);
      ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(ctx.keep(new Tone.Gain(Math.pow(10, -27 / 20))).connect(rainHp));
      ctx.keep(new Tone.LFO({ frequency: 0.06, min: 2000, max: 4200 }).start()).connect(rainLp.frequency);
      const dripG = ctx.keep(new Tone.Gain(Math.pow(10, -30 / 20))).connect(out);
      const dripHp = ctx.keep(new Tone.Filter({ frequency: 900, type: "highpass" })).connect(dripG);
      const drip = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.018, octaves: 1.4, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 } })).connect(dripHp);
      const dripClock = I.monotonic(dripG);
      // vinyl crackle, renewed each cycle so the texture mute takes effect
      const vin = bed(ctx, out);
      I.vinyl(ctx, vin.input, { level: -27, crackle: 8, seed: 11 });

      const melo = (inst) => (t, e, d) => { setCut(t, e.cut); inst.play(t, e.note, d, e.vel); };
      return {
        keys: { layer: "harmony", play: (t, e, d) => { setCut(t, e.cut); (e.inst === "rhodes" ? rhodes : piano).play(t, e.note, d, e.vel); }, humanize: { timing: 0.006, vel: 0.05 } },
        sweep: { layer: "harmony", play: (t, e) => setCut(t, e.cut), humanize: { timing: 0, vel: 0 } },
        guitar: { layer: "melody", play: (t, e, d) => { setCut(t, e.cut); guitar.play(t, e.note, d, e.vel); }, humanize: { timing: 0.01, vel: 0.06 } },
        flute: { layer: "melody", play: melo(flute), humanize: { timing: 0.012, vel: 0.05 } },
        choir: { layer: "melody", play: melo(choir), humanize: { timing: 0.004, vel: 0.04 } },
        bass: { layer: "bass", play: melo(bass), humanize: { timing: 0.008, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.007, vel: 0.08 } },
        rain: { layer: "texture", play: (t, e, d) => rain.play(t, e.level, d, 3), humanize: { timing: 0, vel: 0 } },
        drip: { layer: "texture", play: (t, e) => drip.triggerAttackRelease(T.hz(e.pitch), 0.04, dripClock(t), e.vel), humanize: { timing: 0, vel: 0.2 } },
        vinyl: { layer: "texture", play: (t, e, d) => vin.play(t, e.level, d, 1), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % PLAN.length, round = Math.floor(cycle / PLAN.length);
      const plan = PLAN[idx], next = PLAN[(idx + 1) % PLAN.length];
      if (state.round !== round) { state.round = round; state.keysPat = {}; state.bassPat = {}; state.grooves = {}; }
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };

      // ---- harmony ----
      const harmony = [];
      plan.loops.forEach((L, li) => PROG[L].forEach((h) => harmony.push({ bar: h.bar + li * 4, beat: h.beat, dur: h.dur, chord: h.chord })));
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * 4 + h.beat }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const nextFirst = PROG[next.loops[0]][0].chord;

      // ---- the sample filter: shut for the needle drop, closing for filter-downs ----
      const OPEN = 6500, LOW = 380, INTRO = 750;
      const introBars = plan.intro ? (round === 0 ? 4 : 2) : 0;
      const expi = (a, b, u) => a * Math.pow(b / a, Math.max(0, Math.min(1, u)));
      const fd = plan.fd ? [plan.fd[0] * 4, plan.fd[1] * 4] : null;
      const cutAt = (b) => {
        let c = OPEN;
        if (introBars) { const e = introBars * 4; if (b < e - 1) c = INTRO; else if (b < e) c = expi(INTRO, OPEN, b - (e - 1)); }
        if (fd) {
          const [a, z] = fd;
          if (b >= a && b < z - 1) c = LOW;
          else if (b >= a - 2 && b < a) c = expi(OPEN, LOW, (b - (a - 2)) / 2);
          else if (b >= z - 1 && b < z) c = z >= 32 ? LOW : expi(LOW, OPEN, b - (z - 1));
        }
        return Math.round(c);
      };
      const dark = (b) => cutAt(b) < 2000; // the beat is out
      for (let b = 0; b < 32; b += 0.25) {
        const prevC = cutAt(b - 0.25), c = cutAt(b);
        if (b % 4 === 0 || c !== prevC) push("sweep", b, 0.25, "cut", 0.5, { cut: c, straight: true });
      }

      // ---- keys: the sampled loop ----
      plan.loops.forEach((L, li) => {
        const key = plan.keys + L;
        if (!state.keysPat[key]) state.keysPat[key] = keysLoop(L, r.fork(7 + li));
        state.keysPat[key].forEach((h) => {
          const at = li * 4 * 4 + h.at;
          const vel = (plan.keys === "rhodes" ? 0.5 : 0.46) + (h.roll ? 0.03 : 0);
          if (h.roll) h.v.forEach((m, j) => push("keys", at, h.d, m, vel * (1 - j * 0.04), { inst: plan.keys, cut: cutAt(at), delay: j * 0.019 }));
          else push("keys", at, h.d, h.v, vel, { inst: plan.keys, cut: cutAt(at) });
        });
      });

      // ---- bass ----
      const bassIn = introBars * 4;
      let root = state.bassRoot ?? 38, last = state.bassLast ?? 38;
      const rootOf = (sym, ref) => T.nearest(ref, [T.chord(sym).bass], 31, 45);
      plan.loops.forEach((L, li) => {
        if (!state.bassPat[L]) state.bassPat[L] = bassLoop(L, r.fork(17 + li));
        const spans = state.bassPat[L];
        spans.forEach((sp, si) => {
          const s0 = li * 16 + sp.start;
          const c = T.chord(sp.chord);
          root = rootOf(sp.chord, root);
          const nextSym = si + 1 < spans.length ? spans[si + 1].chord : li === 0 ? PROG[plan.loops[1]][0].chord : nextFirst;
          const nextRoot = rootOf(nextSym, root);
          const fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
          const third = c.intervals.includes(3) ? 3 : c.intervals.includes(4) ? 4 : 5;
          let cell = sp.cell;
          if (dark(s0)) cell = [[0, sp.len - 0.15, "R"]]; // filter-down: just long roots
          // the last bar of the cycle sometimes gets a walk-up into the next root
          if (!dark(s0) && li === 1 && si === spans.length - 1 && sp.len >= 4 && r.chance(0.4)) cell = [[0, 1.5, "R"], [2, 0.5, "F"], [2.5, 0.5, "O"], [3.25, 0.5, "A"]];
          cell.forEach(([pos, dur, role]) => {
            const at = s0 + pos;
            if (at < bassIn || pos >= sp.len - 0.01) return;
            let n;
            if (role === "R") n = root;
            else if (role === "O") n = root + 12 <= 52 ? root + 12 : root + fifth;
            else if (role === "F") n = root + fifth > 47 ? root + fifth - 12 : root + fifth;
            else if (role === "T") n = root + third + (root + third < 36 ? 12 : 0);
            else {
              // approach the next root from a step that belongs to the chord still sounding (no rub with the keys)
              const ok = new Set(c.pcs.concat([c.bass]));
              const opts = [[-1, 3], [1, 2.5], [-2, 1.5], [2, 1]].filter(([s]) => ok.has(mod12(nextRoot + s)) && nextRoot + s !== last);
              n = opts.length ? nextRoot + r.weighted(opts) : nextRoot === root ? root + fifth - 12 : root;
              dur = Math.min(dur, sp.len - pos - 0.05);
            }
            const vel = role === "A" ? 0.55 : pos === 0 ? 0.78 : 0.64;
            push("bass", at, dur, n, vel * (dark(at) ? 0.85 : 1), { cut: cutAt(at) });
            last = n;
          });
        });
      });
      state.bassRoot = root; state.bassLast = last;

      // ---- hooks ----
      if (plan.hook) {
        const loopsWith = plan.hookLoops || [0, 1];
        plan.loops.forEach((L, li) => {
          if (!loopsWith.includes(li)) return;
          const vary = li === 1 || plan.vary || round > 0;
          let ns = vary ? varyHook(HOOK[L], r.fork(31 + li + 5 * round), L) : fitHook(HOOK[L].map((n) => ({ ...n })), L);
          ns.forEach((n) => {
            const at = li * 16 + n.at;
            if (dark(at)) return;
            let track = plan.hook, note = n.note;
            if (plan.hook === "trade") { // each half moves by whole octaves, so its shape stays intact
              const first = n.at < 8, half = ns.filter((m) => (m.at < 8) === first).map((m) => m.note);
              track = (li === 0) === first ? "flute" : "guitar";
              if (track === "guitar" && Math.max(...half) > 79) note -= 12;
              if (track === "flute" && Math.min(...half) < 69) note += 12;
            }
            const base = track === "guitar" ? 0.66 : track === "flute" ? 0.58 : 0.5;
            const vel = base + (n.dur >= 1 ? 0.05 : 0) - (n.grace ? 0.14 : 0) + r.gauss(0.025);
            const dur = track === "choir" ? Math.min(n.dur, 0.45) : n.dur;
            push(track, at, dur, note, vel, { cut: cutAt(at) });
          });
        });
      }

      // ---- drums ----
      const mode = plan.drums;
      const gk = mode + plan.loops[0];
      if (!state.grooves[gk]) {
        const a = r.pick(KICKS[mode]);
        state.grooves[gk] = { a, b: r.pick(KICKS[mode].filter((k) => k !== a)), pickup: r.chance(0.5) };
      }
      const g = state.grooves[gk];
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      const late = (base) => ({ delay: Math.max(0.008, base + r.gauss(0.005)) });
      const nextDark = next.intro || (next.fd && next.fd[0] === 0);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        if (dark(B) || bar < introBars) {
          // the beat is out; on the last dark bar before it returns, a snare lift brings it back
          const back = bar + 1 < 8 ? !(dark(B + 4) || bar + 1 < introBars) : false;
          if (back) {
            [[2.5, 0.12], [3, 0.18], [3.25, 0.24], [3.5, 0.32], [3.75, 0.42]].forEach(([p, v]) => D(B + p, "snare", v, { delay: 0.01 }));
            D(B + 3.5, "hatOpen", 0.22);
          } else if (bar >= 1 && fd && r.chance(0.5)) D(B, "kick", 0.32); // a far-off kick keeps the pulse
          continue;
        }
        const loopEnd = bar % 4 === 3, cycEnd = bar === 7;
        let fill = null;
        if (cycEnd) fill = nextDark ? "drop" : r.weighted([["drag", 2], ["drop", 1.2], ["kicks", 1.5], ["open", 1.5]]);
        else if (loopEnd && r.chance(0.45)) fill = r.pick(["open", "kicks", "ghost"]);
        if (bar + 1 < 8 && dark(B + 4)) fill = "drop"; // the beat stops before a filter-down
        const stopAt = fill === "drop" ? 3 : fill === "drag" ? 3.25 : 4;
        let kicks = (bar % 2 === 0 ? g.a : g.b).slice();
        if (bar % 2 === 1 && g.pickup && fill !== "drop") kicks.push(3.75);
        if (fill === "kicks") kicks = kicks.filter((p) => p < 3).concat([3.25, 3.5]);
        const kickSet = new Set(kicks);
        const machine = mode === "machine";
        // kick
        kicks.forEach((p) => { if (p < stopAt) machine ? D(B + p, "kick808", p === 0 ? 0.62 : 0.5, { pitch: 33 }) : D(B + p, "kick", p === 0 ? 0.8 : 0.66); });
        // backbeat, laid back
        const backs = mode === "lazy" ? [2] : [1, 3];
        backs.forEach((p) => {
          if (p >= stopAt) return;
          if (machine) { D(B + p, "clap", 0.5, late(0.026)); D(B + p, "snap", 0.3, late(0.034)); }
          else if (mode === "boom2") { D(B + p, "snare", 0.58, late(0.03)); D(B + p, "rim", 0.34, late(0.03)); }
          else D(B + p, "snare", mode === "lazy" ? 0.64 : 0.6, late(mode === "lazy" ? 0.042 : 0.032));
        });
        if (mode === "lazy" && r.chance(0.6)) D(B + 3.5, "rim", 0.22, late(0.03));
        // ghost notes
        if (!machine && r.chance(0.5)) {
          const cands = [1.75, 3.25, 0.75].filter((p) => !kickSet.has(p) && p < stopAt);
          if (cands.length) D(B + r.pick(cands), "snare", 0.1 + r.range(0, 0.06), { delay: 0.015 });
        }
        // hats
        const openAt = (fill === "open" || (loopEnd && fill !== "drop" && r.chance(0.35))) ? 3.5 : null;
        for (let s = 0; s < 16; s++) {
          const p = s / 4, q = s % 4;
          if (p >= stopAt || (openAt != null && p >= openAt)) break;
          if (machine) {
            if (q === 1 && r.chance(0.3)) continue;
            D(B + p, "hat808", [0.34, 0.11, 0.22, 0.14][q] + r.gauss(0.02));
          } else if (mode === "boom2") {
            // with the shaker carrying the 16ths, the hats keep to 8ths and the odd swung "a"
            if ((q === 1 && (plan.shaker || r.chance(0.35))) || (q === 3 && plan.shaker && r.chance(0.55))) continue;
            D(B + p, "hatClosed", [0.4, 0.13, 0.26, 0.17][q] + r.gauss(0.02));
          } else if (q % 2 === 0) {
            D(B + p, "hatClosed", (mode === "lazy" ? 0.7 : 1) * (q === 0 ? 0.4 : 0.25) + r.gauss(0.02));
          } else if (q === 3 && r.chance(0.13)) D(B + p, "hatClosed", 0.14);
        }
        if (openAt != null) D(B + openAt, machine ? "hat808Open" : "hatOpen", 0.26);
        // auxiliary percussion
        if (plan.shaker && !machine) for (let s = 0; s < 16 && s / 4 < stopAt; s++) D(B + s / 4, "shaker", [0.2, 0.08, 0.14, 0.1][s % 4] + r.gauss(0.015));
        if (plan.bongo) [[1.5, 72, 0.3], [2.75, 66, 0.26], [3.25, 72, 0.22]].forEach(([p, pitch, v]) => { if (p < stopAt) D(B + p, "bongo", v + r.gauss(0.03), { pitch }); });
        // fills
        if (fill === "drag") [[3.25, 0.2], [3.5, 0.28], [3.75, 0.38]].forEach(([p, v]) => D(B + p, machine ? "clap" : "snare", v, { delay: 0.012 }));
        else if (fill === "ghost") D(B + 3.75, "snare", 0.16, { delay: 0.012 });
      }

      // ---- texture: vinyl, rain, drips ----
      push("vinyl", 0, 32, "bed", 0.5, { level: 1, straight: true });
      const rainLevel = (plan.rain || 0) * (fd || introBars ? 1.25 : 1);
      push("rain", 0, 32, "bed", 0.5, { level: rainLevel, straight: true });
      for (let bar = 0; bar < 8; bar++) {
        const n = r.weighted([[0, 3], [1, 2], [2, 1]]) + (rainLevel > 1 ? 1 : 0);
        for (let i = 0; i < n; i++) push("drip", bar * 4 + Math.round(r.range(0, 3.9) * 8) / 8 + i * 0.01, 0.05, "drip", 0.25 + r() * 0.4, { pitch: r.int(93, 101), straight: true });
      }

      const label = `Loop ${plan.loops[0]}${plan.loops[1] !== plan.loops[0] ? "–" + plan.loops[1].replace("x", "′") : ""} · ${plan.d}`;
      return { events: ev, harmony, section: label, state };
    },
  });
})();

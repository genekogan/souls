// Night Shift: downtempo / neo-soul for the city after midnight, downtown lights on wet streets.
// 32-bar choruses (A · A′ · bridge · breakdown) around F minor, a circle-of-fifths A section that
// cadences home and an A′ that turns gospel (Bbm11 → B°7 → Fm/C) and opens into the bridge.
// The bridge walks a descending root line, then planes m11 voicings up by half steps. Four choruses
// make one arc (about 6 minutes): the third chorus lifts a whole step to G minor out of a half-time
// breakdown, and later A sections take tritone substitutions (D13#11, Gb13#11).
// Groove: swung 16ths, kick locked to a fretless bass, laid-back snare, ghost notes, shaped hats.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  // ---------- harmony (written in F minor, transposed by the chorus key) ----------
  const FORM = {
    A: "| Fm9 | Bb13 | Ebm9 Ab13 | Dbmaj9#11 | Bbm11 | Eb13sus4 Eb13 | Abmaj9 | Gm7b5 C7#9 |",
    A2: "| Fm9 | Bb13 | Ebm9 Ab13 | Dbmaj9#11 | Bbm11 | Bdim7 | Fm9/C | Db13#11 |",
    As: "| Fm9 | Bb13 | Ebm9 D13#11 | Dbmaj9#11 | Bbm11 | Eb13sus4 Eb13 | Abmaj9 | Gm7b5 Gb13#11 |",
    A2s: "| Fm9 | Bb13 | Ebm9 D13#11 | Dbmaj9#11 | Bbm11 | Bdim7 | Fm9/C | Db13#11 |",
    B: "| Gbmaj7#11 | Fm9 | Ebm9 | Dbmaj9 | Bbm11 | Bm11 | Cm11 | Ab13sus4 Ab13 |",
    D: "| Dbmaj9#11 | Ebm9/Db | Dbmaj9#11 | Ebm9/Db | Bbm11 | Gbmaj7#11 |",
    turn: "| Gm7b5 | C13sus4 C7#9 |", // ii–V into the next chorus's key, appended to D
  };
  const FIRST = { A: "Fm9", A2: "Fm9", B: "Gbmaj7#11", D: "Dbmaj9#11" };
  const PLANE_BARS = [4, 5, 6]; // bridge: Bbm11 → Bm11 → Cm11 in one parallel shape

  // ---------- tunes (concert pitch in F minor) [bar, beat, dur, note] ----------
  const HEAD = [
    [0, 2.5, 0.25, "Eb5"], [0, 2.75, 0.25, "F5"], [0, 3, 1.75, "G5"],
    [1, 1, 0.5, "F5"], [1, 1.5, 1.25, "D5"],
    [2, 0.5, 0.25, "Bb4"], [2, 0.75, 0.25, "Db5"], [2, 1, 0.75, "F5"], [2, 1.75, 0.75, "Eb5"], [2, 2.75, 0.25, "Bb4"], [2, 3, 1.75, "C5"],
    [3, 2.5, 0.25, "C5"], [3, 2.75, 0.25, "Db5"], [3, 3, 1.75, "Eb5"],
  ];
  const TAIL = {
    A: [ // answers the head, rises to the 3rd of Eb13, then the blue #9 → 3 over C7#9
      [4, 1, 0.5, "Db5"], [4, 1.5, 1.25, "Ab4"],
      [5, 1.25, 0.25, "Bb4"], [5, 1.5, 0.25, "Db5"], [5, 1.75, 0.25, "F5"], [5, 2, 1.25, "G5"],
      [6, 0.5, 0.25, "F5"], [6, 0.75, 0.75, "Eb5"], [6, 1.5, 0.25, "C5"], [6, 1.75, 1.25, "Bb4"],
      [7, 0.75, 0.25, "Bb4"], [7, 1, 0.75, "Db5"], [7, 1.75, 0.25, "C5"], [7, 2, 0.5, "Eb5"], [7, 2.5, 1, "E5"],
    ],
    A2: [ // gospel turn: the blue b5 (B) is the root of the passing diminished chord; ends on Db13's flat 7
      [4, 1, 0.5, "Db5"], [4, 1.5, 1.25, "Ab4"],
      [5, 0.75, 0.25, "Ab4"], [5, 1, 0.5, "B4"], [5, 1.5, 1, "D5"], [5, 2.75, 0.25, "F5"],
      [6, 0, 1, "Eb5"], [6, 1.5, 0.25, "C5"], [6, 1.75, 1, "G4"],
      [7, 0.75, 0.25, "Ab4"], [7, 1, 0.5, "Bb4"], [7, 1.5, 2, "B4"],
    ],
  };
  const BRIDGE = [ // the head's short-short-long cell on a falling guide-tone line, then planed with the chords
    [0, 0.5, 0.25, "Bb4"], [0, 0.75, 0.25, "C5"], [0, 1, 2.25, "F5"],
    [1, 0.5, 0.25, "Ab4"], [1, 0.75, 0.25, "C5"], [1, 1, 2.25, "Eb5"],
    [2, 0.5, 0.25, "Gb4"], [2, 0.75, 0.25, "Bb4"], [2, 1, 1.5, "Db5"], [2, 2.75, 0.25, "Eb5"], [2, 3, 0.25, "F5"], [2, 3.25, 0.25, "Gb5"], [2, 3.5, 2, "Ab5"],
    [3, 1.5, 0.5, "F5"], [3, 2, 1.5, "Eb5"],
    [4, 2.5, 0.25, "Db5"], [4, 2.75, 0.25, "Eb5"], [4, 3, 1, "F5"],
    [5, 2.5, 0.25, "D5"], [5, 2.75, 0.25, "E5"], [5, 3, 1, "F#5"],
    [6, 2.5, 0.25, "Eb5"], [6, 2.75, 0.25, "F5"], [6, 3, 1, "G5"],
    [7, 0.5, 0.25, "F5"], [7, 0.75, 1.25, "Eb5"], [7, 2, 1.5, "C5"],
  ];
  const FRAG = [ // breakdown: the cell twice over the Db pedal, then the head's Db–Ab sigh
    [1, 2.5, 0.25, "Bb4"], [1, 2.75, 0.25, "Db5"], [1, 3, 2, "F5"],
    [3, 2.5, 0.25, "Bb4"], [3, 2.75, 0.25, "Db5"], [3, 3, 1.25, "Eb5"],
    [4, 1, 0.5, "Db5"], [4, 1.5, 2, "Ab4"],
  ];

  // ---------- the arc: 16 cycles of 8 bars ----------
  const PLAN = [
    { sec: "A", key: 0, drums: "main", lick: 1, e: 0.66, d: "keys and the night" },
    { sec: "A2", key: 0, drums: "main", mel: "theme", inst: "trumpet", e: 0.72 },
    { sec: "B", key: 0, drums: "B", mel: "bridge", inst: "trumpet", pad: 1, e: 0.8 },
    { sec: "D", key: 0, drums: "break", mel: "frag", inst: "flute", pad: 1, e: 0.42, d: "far off" },
    { sec: "A", key: 0, drums: "main", lick: 1, e: 0.76, d: "the Rhodes speaks" },
    { sec: "A2", key: 0, drums: "main", mel: "theme", vary: 1, sub: 1, inst: "trumpet", e: 0.8, d: "displaced" },
    { sec: "B", key: 0, drums: "B", lick: 1, pad: 1, e: 0.82, d: "keys" },
    { sec: "D", key: 0, drums: "half", pad: 1, e: 0.5, d: "half-time, lifting" },
    { sec: "A", key: 2, drums: "main", mel: "theme", inst: "flute", e: 0.84, d: "up a step, G minor" },
    { sec: "A2", key: 2, drums: "main", lick: 1, sub: 1, e: 0.84, d: "G minor, keys" },
    { sec: "B", key: 2, drums: "B", mel: "bridge", inst: "flute", pad: 1, e: 0.9, d: "G minor" },
    { sec: "D", key: 2, drums: "break", mel: "frag", inst: "trumpet", pad: 1, e: 0.45, d: "easing home" },
    { sec: "A", key: 0, drums: "main", mel: "theme", vary: 1, sub: 1, inst: "trumpet", e: 0.78, d: "home, reharmonized" },
    { sec: "A2", key: 0, drums: "main", lick: 1, sub: 1, e: 0.72, d: "keys" },
    { sec: "B", key: 0, drums: "B", lick: 1, pad: 1, e: 0.66, d: "keys, thinning out" },
    { sec: "D", key: 0, drums: "drop", pad: 1, e: 0.3, d: "the drop, rain" },
  ];
  const SEC_NAME = { A: "A", A2: "A′", B: "Bridge", D: "Breakdown" };

  // ---------- rhythm cells ----------
  // Bass + kick for a 4-beat chord: [pos, dur, role, kick]. Roles: R root, O octave, F fifth,
  // S seventh, G dead note, A approach (slides legato into the next chord's root on the fretless).
  const BASS4 = [
    [[[0, 1.5, "R", 1], [1.75, 0.5, "R", 1], [2.5, 1, "F", 1], [3.75, 0.25, "A", 0]], 3],
    [[[0, 2.25, "R", 1], [2.5, 0.25, "O", 1], [3, 0.4, "S", 0], [3.5, 0.1, "G", 0]], 2],
    [[[0, 0.5, "R", 1], [0.75, 1.4, "R", 1], [2.5, 1, "F", 1]], 2],
    [[[0, 3.1, "R", 1], [3.5, 0.5, "A", 0]], 1.5],
    [[[0, 1.25, "R", 1], [1.5, 0.1, "G", 0], [1.75, 0.6, "O", 0], [2.75, 0.75, "S", 1]], 1.5],
  ];
  const BASS2 = [
    [[[0, 1.5, "R", 1]], 3],
    [[[0, 0.5, "R", 1], [0.75, 0.9, "R", 1]], 1.5],
    [[[0, 1.25, "R", 1], [1.75, 0.25, "A", 0]], 2],
    [[[0, 0.75, "R", 1], [1, 0.1, "G", 0], [1.25, 0.5, "O", 0]], 1],
  ];
  const BASS_HALF = [[0, 2.25, "R", 1], [2.75, 0.75, "O", 1], [3.75, 0.25, "A", 0]];
  // Rhodes comping for a chord span: [beat, dur]; -0.25 is a pushed 16th.
  const COMP4 = [
    [[[0, 3.5]], 2], [[[0, 1.4], [1.75, 2]], 2.5], [[[0, 0.6], [1.5, 0.4], [2.75, 1.1]], 1.5],
    [[[0, 2.2], [2.5, 0.35], [3.25, 0.6]], 1.2], [[[0.5, 1.1], [2.25, 1.6]], 1], [[[-0.25, 3.6]], 2],
  ];
  const COMP2 = [[[[0, 1.8]], 3], [[[-0.25, 2]], 2], [[[0, 0.6], [1.25, 0.6]], 1.2], [[[0.5, 1.3]], 1]];
  const LONG4 = [[[[0, 3.85]], 3], [[[0, 1.9], [2.5, 1.4]], 1]];
  const LONG2 = [[[[0, 1.9]], 1]];
  // Rhodes right-hand licks: [offset, dur, scale steps above the target chord tone]
  const LICKS = [
    [[0, 0.25, 3], [0.25, 0.25, 2], [0.5, 0.25, 1], [0.75, 0.7, 0]],
    [[0.5, 0.25, 2], [0.75, 0.25, 1], [1, 0.45, 0]],
    [[0, 0.5, 1], [0.5, 0.25, 2], [0.75, 0.7, 0]],
    [[0.25, 0.25, -1], [0.5, 0.25, 0], [0.75, 0.25, 2], [1, 0.45, 1]],
  ];

  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  function prog(text, k, barOffset = 0) {
    return T.progression(text).map((h) => ({ bar: h.bar + barOffset, beat: h.beat, dur: h.dur, chord: tsym(h.chord, k) }));
  }
  /** Seconds or minor thirds low in the keys sound like mud on a Rhodes. */
  const muddy = (v, semi = 62) => v.some((m, i) => i > 0 && ((v[i - 1] < 55 && m - v[i - 1] < 3) || (v[i - 1] < semi && m - v[i - 1] === 1)));
  /** Rhodes voicing: the smoothest clean (non-muddy, no doubled pitch) candidate across spreads and floors. */
  function voiceKeys(sym, prev, n, r) {
    const c = T.chord(sym);
    n = Math.min(n, c.pcs.length);
    let best = null, bestS = Infinity;
    for (const spread of ["any", "close", "drop2", "open"]) for (const lo of [50, 53, 56]) for (const nn of n > 4 ? [n, 4] : [n]) {
      const v = T.voice(sym, { lo, hi: 73, n: nn, prev, top: [61, 70], spread, rng: r });
      if (muddy(v) || new Set(v).size < v.length) continue;
      let s = nn < n ? 1.5 : 0;
      if (prev && prev.length) {
        const a = v, b = prev.slice().sort((x, y) => x - y), m = Math.min(a.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(a[a.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - 62);
      const t = v[v.length - 1];
      if (t > 70) s += (t - 70) * 1.5;
      if (t < 61) s += (61 - t) * 1.5;
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo: 55, hi: 76, n: 4, prev });
  }
  /** 7#9: the "Hendrix" spacing, 3rd below the #9 (E3 Bb3 D#4 G4 on C). */
  function sharpNine(sym, prev) {
    const c = T.chord(sym), third = T.nearest(prev && prev.length ? Math.min(55, Math.max(52, prev[0])) : 53, [c.root + 4], 52, 58);
    return [0, 6, 11, 15].map((x) => third + x);
  }
  const okSet = (sym) => { const c = T.chord(sym); return new Set(c.scale.concat(c.pcs)); };

  /** A home-built vinyl bed: pink hiss plus sparse crackle, all very low. */
  function vinyl(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(Math.pow(10, -30 / 20))).connect(dest);
    const lp = ctx.keep(new Tone.Filter({ frequency: 6500, type: "lowpass" })).connect(g);
    const hp = ctx.keep(new Tone.Filter({ frequency: 1600, type: "highpass" })).connect(lp);
    const hiss = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 1.5, decay: 0.1, sustain: 1, release: 2 } })).connect(hp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 0.7 })).connect(g);
    const pop = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.005, sustain: 0, release: 0.003 } })).connect(bp);
    pop.volume.value = 4;
    let last = -Infinity, lastHiss = -Infinity;
    return {
      play(t, e, d) {
        const now = g.context.currentTime + 0.003; // Tone clamps past times to now; keep triggers distinct
        if (e.note === "hiss") { lastHiss = Math.max(t, now, lastHiss + 0.004); hiss.triggerAttackRelease(d, lastHiss, e.vel); }
        else { last = Math.max(t, now, last + 0.004); pop.triggerAttackRelease(0.003, last, e.vel); }
      },
    };
  }

  Sim.register({
    id: "night-shift",
    title: "Night Shift",
    genre: "Downtempo",
    about: "Neo-soul after midnight in F minor: tremolo Rhodes on m9, m11 and 13sus chords, a fretless bass locked to a dusty swung-16th beat, and a muted trumpet that states its theme and then lets the city carry the night.",
    bpm: 84, swing: 0.58, swingUnit: 0.25, beatsPerBar: 4, cycleBars: 8, gainDb: 3.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.015, lowcut: 300, highcut: 6500 });
      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 400, highcut: 5500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.3, highcut: 2400 });
      const rhodes = I.rhodes(ctx, { volume: -6, cutoff: 3000, tremolo: 4.2, tremoloDepth: 0.34, bark: 2.4, tine: -15 });
      const pad = I.pad(ctx, { volume: -19, cutoff: 850, attack: 1.2, release: 3, detune: 16 });
      const bass = I.ebass(ctx, { volume: -4, fretless: true, base: 120 });
      const trumpet = I.mutedTrumpet(ctx, { volume: -1, vibratoDepth: 0.025 });
      const flute = I.flute(ctx, { volume: -3, breath: -22 });
      const kit = I.kit(ctx, { volume: -4, kickNote: 33, preload: ["kick", "snare", "hatClosed", "hatOpen", "rim", "shaker"] });
      const dust = ctx.keep(new Tone.Filter({ frequency: 8000, type: "lowpass", rolloff: -12 })).connect(out);
      const rp = I.place(ctx, rhodes, -0.18, out), pp = I.place(ctx, pad, 0.22, out);
      I.place(ctx, bass, 0, out);
      const tp = I.place(ctx, trumpet, 0.14, out), fp = I.place(ctx, flute, 0.1, out);
      const kp = I.place(ctx, kit, 0.03, dust);
      I.send(ctx, rp, room, -12); I.send(ctx, rp, hall, -20); I.send(ctx, pp, hall, -10);
      I.send(ctx, tp, hall, -11); I.send(ctx, tp, echo, -15); I.send(ctx, fp, hall, -9); I.send(ctx, fp, echo, -13);
      I.send(ctx, kp, room, -19); I.send(ctx, bass.out, room, -26);
      const vin = vinyl(ctx, out);
      const melo = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        trumpet: { layer: "melody", play: melo(trumpet), humanize: { timing: 0.012, vel: 0.05 } },
        flute: { layer: "melody", play: melo(flute), humanize: { timing: 0.012, vel: 0.05 } },
        keys: { layer: "harmony", play: (t, e, d) => rhodes.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.06 } },
        lick: { layer: "harmony", play: (t, e, d) => rhodes.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.08 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.08 } },
        vinyl: { layer: "texture", play: (t, e, d) => vin.play(t, e, d), humanize: { timing: 0, vel: 0.2 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % 16, round = Math.floor(cycle / 16);
      const plan = PLAN[idx], nextPlan = PLAN[(idx + 1) % 16];
      const k = plan.key, e = plan.e;
      const swapInst = round % 2 === 1;
      const inst = plan.inst ? (swapInst ? (plan.inst === "trumpet" ? "flute" : "trumpet") : plan.inst) : null;
      const sub = plan.sub || (round > 0 && plan.sec === "A" && r.chance(0.4));
      const drumMode = cycle === 0 ? "intro" : plan.drums;

      // ---- harmony ----
      let harmony;
      if (plan.sec === "D") harmony = prog(FORM.D, k).concat(prog(FORM.turn, nextPlan.key, 6));
      else harmony = prog(FORM[plan.sec + (sub && plan.sec !== "B" ? "s" : "")], k);
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * 4 + h.beat, end: h.bar * 4 + h.beat + h.dur }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const nextFirst = tsym(FIRST[nextPlan.sec], nextPlan.key);

      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const quiet = (drumMode === "break" || drumMode === "half" || drumMode === "drop");
      const planed = (bar) => plan.sec === "B" && PLANE_BARS.includes(bar);

      // ---- melody ----
      const melodyBusy = new Set(); // bars where the horn is playing (keys stay out of the way)
      if (plan.mel && inst) {
        const src = plan.mel === "theme" ? HEAD.concat(TAIL[plan.sec === "A2" ? "A2" : "A"]) : plan.mel === "bridge" ? BRIDGE : FRAG;
        const vary = plan.vary || round > 0;
        const shift = vary && plan.mel === "theme" && r.chance(0.7) ? 0.5 : 0;
        let notes = src.map(([bar, beat, dur, n]) => {
          let at = bar * 4 + beat;
          if (shift && at < 12) at += shift; // displace the opening phrase by an eighth
          return { at, dur, note: T.midi(n) + k };
        });
        notes.sort((a, b) => a.at - b.at);
        // keep it legato but never overlapping
        notes.forEach((n, i) => { if (i + 1 < notes.length) n.dur = Math.min(n.dur, notes[i + 1].at - n.at - 0.03); n.dur = Math.min(n.dur, 31.9 - n.at); });
        // fit to the actual harmony (substitutions, keys): onset in the chord scale, and don't hold into a clash
        notes.forEach((n) => {
          const ok = okSet(chordAt(n.at).chord);
          if (!ok.has(mod12(n.note))) n.note = T.nearest(n.note, [...ok]);
          for (const h of hAbs) {
            if (h.start > n.at + 0.01 && h.start < n.at + n.dur - 0.1 && !okSet(h.chord).has(mod12(n.note))) { n.dur = Math.max(0.2, h.start - n.at - 0.05); break; }
          }
        });
        const scoopP = plan.mel === "frag" ? 0.2 : vary ? 0.4 : 0.2;
        const base = inst === "flute" ? 0.56 : 0.62;
        notes.forEach((n, i) => {
          const long = n.dur >= 1;
          const vel = base + (long ? 0.06 : 0) - (i > 0 && notes[i - 1].at + notes[i - 1].dur < n.at - 0.4 ? 0.04 : 0) + r.gauss(0.025);
          melodyBusy.add(Math.floor(n.at / 4));
          const prevNote = i > 0 ? notes[i - 1].note : null;
          if (long && prevNote !== n.note - 1 && prevNote !== n.note && r.chance(scoopP)) { // a scoop from a half step below (the blue b5 when the target is the 5th)
            push(inst, n.at, 0.12, n.note - 1, vel * 0.7);
            push(inst, n.at, n.dur, n.note, vel, { delay: 0.05 });
          } else push(inst, n.at, n.dur * (n.dur <= 0.25 ? 0.9 : 1), n.note, vel);
        });
      }

      // ---- Rhodes licks (decided first; only while the horn rests) ----
      const lickBars = new Set();
      if (plan.lick) {
        for (let bar = 1; bar < 8; bar += 2) {
          if (melodyBusy.has(bar) || planed(bar) || !r.chance(0.42 + (e - 0.6) * 0.5)) continue;
          const h = chordAt(bar * 4 + 2.5);
          if (h.start > bar * 4 + 2.5 + 1e-6 || h.end < bar * 4 + 4 - 1e-6) continue;
          lickBars.add(bar);
          const c = T.chord(h.chord);
          const pent = [0, 3, 5, 7, 10].map((x) => mod12(5 + k + x));
          let pcs = pent.filter((p) => c.scale.includes(p));
          if (pcs.length < 4) pcs = c.scale;
          const target = T.nearest(76 + r.int(-3, 2), c.guide.concat(c.colors), 70, 81);
          const shape = r.pick(LICKS);
          const start = bar * 4 + 3.5 - shape[shape.length - 1][0];
          shape.forEach(([o, d, s]) => {
            const at = start + o;
            push("lick", at, Math.min(d, bar * 4 + 4 - at - 0.05), s ? T.step(target, s, pcs) : target, 0.42 + (s === 0 ? 0.06 : 0) + r.range(-0.03, 0.04));
          });
        }
      }

      // ---- Rhodes comping ----
      const hits = [];
      let planePat = null, planeBase = null;
      harmony.forEach((h, i) => {
        const s0 = h.bar * 4 + h.beat;
        let v;
        if (planed(h.bar)) {
          if (planeBase == null) planeBase = T.nearest(51, [T.chord(h.chord).root + 5], 49, 56);
          const lo = planeBase + (h.bar - PLANE_BARS[0]);
          v = [0, 5, 10, 14].map((x) => lo + x); // 11, b7, b3, 5: one quartal shape planed upward
        } else if (/7#9/.test(h.chord)) {
          v = sharpNine(h.chord, state.voicing);
        } else {
          v = voiceKeys(h.chord, state.voicing, r.chance(0.35) ? 5 : 4, r);
        }
        state.voicing = v;
        let pats = quiet ? (h.dur >= 4 ? LONG4 : LONG2) : (h.dur >= 4 ? COMP4 : COMP2);
        if (s0 === 0) pats = pats.filter(([p]) => p[0][0] >= 0);
        let pat;
        if (planed(h.bar)) pat = planePat || (planePat = r.weighted(pats.filter(([p]) => p[0][0] >= 0)));
        else pat = r.weighted(pats);
        const hs = pat.map(([b, d]) => ({ at: s0 + b, d, v, accent: b < 0 }));
        // chromatic approach chord: the same voicing a half step above, a 16th before the change
        const free = !melodyBusy.has(h.bar) && !quiet;
        if (free && i > 0 && h.dur >= 2 && Math.abs(hs[0].at - s0) < 1e-6 && r.chance(0.14) && !planed(h.bar) && !lickBars.has(Math.floor((s0 - 0.25) / 4))) {
          hs.unshift({ at: s0 - 0.25, d: 0.22, v: v.map((x) => x + 1), accent: true });
        }
        hs.forEach((x) => { x.roll = quiet ? r.chance(0.6) : x.d >= 2 && r.chance(0.2); });
        hits.push(hs);
      });
      hits.forEach((hs, i) => {
        const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : 32;
        hs.filter((h) => h.at < nextStart - 0.2).forEach((h) => {
          const dur = Math.min(h.d, nextStart - h.at - 0.05);
          const vel = (quiet ? 0.42 : 0.47) + (h.accent ? 0.06 : 0) + (plan.mel ? -0.03 : 0) + r.range(-0.04, 0.05);
          if (h.roll) h.v.forEach((m, j) => push("keys", h.at, dur, m, vel * (1 - j * 0.03), { delay: j * 0.017 }));
          else push("keys", h.at, dur, h.v, vel);
        });
      });

      // ---- pad ----
      if (plan.pad) {
        harmony.forEach((h) => {
          let v = null;
          for (let t = 0; t < 8 && (!v || muddy(v, 76)); t++) v = T.voice(h.chord, { lo: 56, hi: 74, n: 3, prev: state.padV, top: [66, 72], rng: t ? r : null });
          if (muddy(v, 76)) v = T.voice(h.chord, { lo: 56, hi: 74, n: 2, prev: state.padV, top: [64, 72] });
          state.padV = v;
          push("pad", h.bar * 4 + h.beat, h.dur - 0.1, v, quiet ? 0.42 : 0.34);
        });
      }

      // ---- fretless bass, and the kick that locks to it ----
      if (!state.groove || idx === 0 || state.grooveRound !== round) {
        state.grooveRound = round;
        const pair = () => { const a = r.weighted(BASS4); let b = r.weighted(BASS4); for (let t = 0; t < 6 && b === a; t++) b = r.weighted(BASS4); return [a, b, r.weighted(BASS2)]; };
        state.groove = { A: pair(), B: pair() };
      }
      const groove = state.groove[plan.sec === "B" ? "B" : "A"];
      const kicks = Array.from({ length: 8 }, () => []);
      let root = state.bassRoot ?? 41 + k;
      let lastNote = state.bassLast ?? root;
      const rootOf = (sym, ref) => T.nearest(ref, [T.chord(sym).bass], 31, 46);
      const bassNotes = [];
      const bassBar = (bar, mode) => {
        // group this bar's chords into spans; chords sharing a root (Eb13sus4 → Eb13) are one span
        const spans = [];
        hAbs.filter((h) => h.bar === bar).forEach((h) => {
          const prev = spans[spans.length - 1];
          if (prev && T.chord(prev.chord).bass === T.chord(h.chord).bass) prev.end = h.end;
          else spans.push({ start: h.start, end: h.end, chord: h.chord });
        });
        spans.forEach((sp, si) => {
          const len = sp.end - sp.start;
          let cell;
          if (mode === "pedal") cell = [[0, len - 0.5, "R", 0]];
          else if (mode === "long") cell = len >= 4 ? [[0, 2.25, "R", 0], [2.5, 1, "F", 0]] : [[0, len - 0.3, "R", 0]];
          else if (mode === "half") cell = len >= 4 ? BASS_HALF : [[0, len - 0.3, "R", 1]];
          else if (len >= 4) cell = bar === 7 && r.chance(0.5) ? r.weighted(BASS4) : groove[bar % 2];
          else cell = groove[2];
          const c = T.chord(sp.chord);
          root = rootOf(sp.chord, root);
          const nextSym = si + 1 < spans.length ? spans[si + 1].chord : bar < 7 ? chordAt(sp.end).chord : nextFirst;
          const nextRoot = rootOf(nextSym, root);
          const sev = c.intervals.includes(10) ? 10 : c.intervals.includes(9) ? 9 : 16; // b7, dim 7, or the tenth on major chords
          const fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
          cell.forEach(([pos, dur, role, kick]) => {
            if (pos >= len - 0.01) return;
            let n;
            if (role === "R") n = root;
            else if (role === "O") n = root + 12 <= 52 ? root + 12 : root + fifth <= 52 ? root + fifth : root + fifth - 12;
            else if (role === "F") n = root + fifth > 47 ? root + fifth - 12 : root + fifth;
            else if (role === "S") n = T.nearest(lastNote, [root + sev], 31, 52);
            else if (role === "G") n = lastNote;
            else { // approach: slide into the next root
              const opts = [[-1, 3], [1, 2], [-2, 1.5]].filter(([s]) => nextRoot + s !== lastNote && nextRoot + s !== root);
              n = nextRoot + (nextRoot === root ? -2 : r.weighted(opts.length ? opts : [[-2, 1]]));
              dur = len - pos; // legato, so the fretless glides
            }
            const at = sp.start + pos;
            const vel = role === "G" ? 0.3 : role === "A" ? 0.58 : pos === 0 ? 0.84 : 0.7;
            bassNotes.push({ at, dur, note: n, vel });
            if (kick) kicks[bar].push([at - bar * 4, pos === 0 ? 0.8 : 0.64]);
            lastNote = n;
          });
        });
      };
      for (let bar = 0; bar < 8; bar++) {
        let mode = "groove";
        if (drumMode === "intro") mode = bar < 4 ? null : bar < 6 ? "long" : "groove";
        else if (drumMode === "break") mode = bar < 4 ? "pedal" : bar < 6 ? "long" : "groove";
        else if (drumMode === "half") mode = bar < 4 ? "pedal" : "half";
        else if (drumMode === "drop") mode = bar < 6 ? (bar % 2 === 0 ? "pedal" : null) : bar === 6 ? "long" : "groove";
        if (mode) bassBar(bar, mode);
      }
      bassNotes.forEach((n) => push("bass", n.at, n.dur, n.note, n.vel * (0.9 + e * 0.12)));
      state.bassRoot = root; state.bassLast = lastNote;

      // ---- drums ----
      const ve = 0.82 + e * 0.25;
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel * ve), extra);
      const snareLate = () => ({ delay: Math.max(0.01, 0.024 + r.gauss(0.004)) });
      const HAT = [0.48, 0.16, 0.3, 0.21];
      const fillAt = { 7: drumMode === "main" ? (plan.sec === "A2" ? r.weighted([["run", 3], ["flam", 2], ["tom", 1.5], [null, 1]]) : r.chance(0.3) ? r.pick(["run", "flam"]) : null)
        : drumMode === "B" ? "stop" : drumMode === "half" ? "tom" : drumMode === "break" ? "run" : drumMode === "drop" ? "stop" : null };
      if (drumMode === "main" && r.chance(0.25)) fillAt[3] = "flam";
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        const fill = fillAt[bar] || null;
        const kickSet = new Set(kicks[bar].map(([p]) => p));
        // which layers play in this bar
        let hats = "16", snare = "full", shaker = false, open = bar % 2 === 1 && r.chance(0.55), ghosts = 0.5 + e * 0.4, kicksOn = true;
        if (drumMode === "intro") { hats = bar < 4 ? null : bar < 6 ? "8soft" : "16"; snare = bar < 6 ? (bar < 4 ? null : "rim") : "full"; ghosts = bar < 6 ? 0 : 0.4; open = bar === 7 && open; kicksOn = bar >= 4; }
        else if (drumMode === "B") { hats = "8"; shaker = true; open = bar % 2 === 1; }
        else if (drumMode === "break") { hats = bar < 4 ? null : bar < 6 ? "8soft" : "16"; snare = bar < 4 ? null : bar < 6 ? "rim" : bar === 6 ? "ghost" : "full"; ghosts = bar >= 6 ? 0.5 : 0; open = bar === 7; kicksOn = bar >= 6; }
        else if (drumMode === "half") { hats = bar < 4 ? null : "8"; snare = bar < 4 ? null : "half"; ghosts = bar < 4 ? 0 : 0.35; open = bar >= 4 && bar % 2 === 1; kicksOn = bar >= 4; }
        else if (drumMode === "drop") { hats = bar < 6 ? null : bar === 6 ? "8soft" : "16"; snare = bar < 7 ? null : "full"; ghosts = 0; open = false; kicksOn = bar >= 7; }
        const stopAt = fill === "stop" ? 3 : fill === "run" || fill === "tom" ? 3.25 : 4;
        // kick (locked to the bass)
        if (kicksOn) kicks[bar].forEach(([p, v]) => { if (p < stopAt) D(B + p, "kick", v); });
        // hats
        if (hats) {
          for (let s = 0; s < 16; s++) {
            const p = s / 4, q = s % 4;
            if (p >= stopAt) break;
            if (open && p >= 3.5) break;
            if (hats === "16") {
              if (q === 1 && r.chance(0.28)) continue; // leave holes on the 'e'
              D(B + p, "hatClosed", (HAT[q] * (s % 8 === 0 ? 1.08 : 1)) + r.gauss(0.025));
            } else if (q % 2 === 0) D(B + p, "hatClosed", (hats === "8soft" ? 0.6 : 1) * (q === 0 ? 0.44 : 0.27) + r.gauss(0.02));
          }
          if (open && stopAt > 3.5) D(B + 3.5, "hatOpen", 0.3 + r.gauss(0.03));
        }
        if (shaker) for (let s = 0; s < 16 && s / 4 < stopAt; s++) D(B + s / 4, "shaker", [0.3, 0.13, 0.22, 0.16][s % 4] + r.gauss(0.02));
        // backbeat, laid back
        if (snare === "full") { D(B + 1, "snare", 0.62, snareLate()); if (stopAt > 3) D(B + 3, "snare", 0.67, snareLate()); }
        else if (snare === "rim") D(B + 3, "rim", 0.42, snareLate());
        else if (snare === "half") D(B + 2, "snare", 0.66, snareLate());
        else if (snare === "ghost") { D(B + 3, "snare", 0.3, snareLate()); }
        // ghost notes
        if (snare && r.chance(ghosts)) {
          const cands = [0.75, 2.25, 2.75, 3.75].filter((p) => !kickSet.has(p) && p < stopAt && !(snare === "half" && p === 2.25));
          r.shuffle(cands).slice(0, r.chance(0.35) ? 2 : 1).forEach((p) => D(B + p, "snare", 0.1 + r.range(0, 0.07), { delay: 0.014 }));
        }
        // fills that mark the form
        if (fill === "run") [[3.25, 0.2], [3.5, 0.3], [3.75, 0.42]].forEach(([p, v]) => D(B + p, "snare", v, { delay: 0.012 }));
        else if (fill === "flam") { D(B + 3, "snare", 0.32); if (!open && hats) D(B + 3.5, "hatOpen", 0.34); }
        else if (fill === "tom") { D(B + 3.25, "tom", 0.42, { pitch: 50 }); D(B + 3.5, "tom", 0.48, { pitch: 45 }); D(B + 3.75, "tom", 0.5, { pitch: 41 }); }
        else if (fill === "stop" && drumMode === "B") D(B + 3, "rim", 0.3);
      }

      // ---- vinyl bed ----
      push("vinyl", 0, 31.8, "hiss", quiet ? 0.9 : 0.75);
      for (let bar = 0; bar < 8; bar++) {
        const n = r.int(2, quiet ? 7 : 5), used = new Set();
        for (let i = 0; i < n; i++) {
          const p = Math.round(r.range(0, 3.95) * 32) / 32;
          if (used.has(p)) continue; used.add(p);
          push("vinyl", bar * 4 + p, 0.05, "pop", 0.2 + r() * r() * 0.8, { straight: true });
        }
      }

      const who = inst ? (inst === "trumpet" ? "muted trumpet" : "flute") + (plan.mel === "theme" ? " theme" : "") : null;
      const label = [SEC_NAME[plan.sec], who, plan.d].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: label, state };
    },
  });
})();

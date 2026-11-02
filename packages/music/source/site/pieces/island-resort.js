// Island Resort: 1950s exotica for a tiki bar on the edge of the sim-island.
//
// Rhythm: a slow Cuban bolero in straight eighths. Upright bass and tom-toms play the bolero cell
// (dotted quarter, eighth, half: onsets 0, 1.5, 2), bongos play the martillo (open hembra on 4),
// the conga a tumbao (slap on 2, open tones on 4 and 4&), claves a 2-3 son clave, maracas eighths.
// The tom-toms are tuned to A and D so the "jungle drum" sits inside every chord of the piece.
//
// Harmony: D minor, coloured three ways. Phrygian: the vamp rocks Dm9 against Ebmaj9#11 over a
// D pedal (bII lydian over the tonic). Harmonic minor: every dominant is A7b9b13 (phrygian dominant),
// approached from Eb, its tritone partner (the Neapolitan). Lush major: the B section blossoms into
// F major with maj9, 6/9 and lydian chords, borrows Eb lydian (bVII) and Bbm6 (iv), then slides
// back through Eb to A7. The interlude planes maj9#11 chords down by semitones, voicing shape fixed.
//
// Form (cycles of 8 bars; one round = 10 cycles, about 3.7 minutes, preceded once by an intro):
//   intro (drums and birds) -> vamp (marimba ostinato) ->
//   [ A1 A2 (vibes theme) -> B1 B2 (strings, F major) -> A' (glockenspiel echoes) ->
//     I1 I2 (interlude: drums fall away, jungle takes over, planing chords, hand drums creep back) ->
//     A1 A2 (theme returns in thirds) -> outro vamp (motif drifts off) ] repeat,
//   alternate rounds swapping the B orchestration and the interlude harmony.
// Birds, tree frogs, cicadas and a gong are synthesized in this file.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- harmony ----------
  const PROG_TEXT = {
    INTRO: "| Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D |",
    VAMP: "| Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Dm9 | A7b9b13 |",
    A1: "| Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Bbmaj9 | Gm9 | Ebmaj9#11 | A7b9b13 |",
    A2: "| Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Bbmaj9 | Gm9 A7b9b13 | Dm69 | Ebmaj9#11/D |",
    B1: "| Fmaj9 | Bbmaj9#11 | Fmaj9 | Ebmaj9#11 | Dm9 | Gm9 | C13sus4 | C13 |",
    B2: "| F69 | Bbmaj9#11 | Am7 | Dm9 | Gm9 | Bbm6 | Ebmaj9#11 | A7b9b13 |",
    I1a: "| Dm11 | % | % | % | Ebmaj9#11/D | % | % | % |",
    I2a: "| Dbmaj9#11 | Cmaj9#11 | Bmaj9#11 | Bbmaj9#11 | Gm9 | Ebmaj9#11 | A7b9b13 | % |",
    I1b: "| Dm11 | % | Bbmaj9#11/D | % | Dm11 | % | Gm9/D | % |",
    I2b: "| Ebmaj9#11 | Dmaj9#11 | Dbmaj9#11 | Cmaj9#11 | Bbmaj9 | Gm9 | A7b9b13 | % |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- melody notation: one string per bar, "note/beats", r = rest ----------
  function bars(list, startBar = 0) {
    const out = [];
    list.forEach((s, i) => {
      if (s == null) return;
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const [n, d] = tok.split("/");
        const dur = Number(d);
        if (!(dur > 0)) throw new Error(`island-resort: bad duration in "${tok}"`);
        if (n !== "r") out.push({ beat: (startBar + i) * BPB + b, dur, note: T.midi(n) });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`island-resort: bar sums to ${b}: ${s}`);
    });
    return out;
  }

  // The theme (vibraphone). Bars 1-4 sit on the Phrygian vamp: a 5th-root-9th rise, then a stepwise
  // descent through the b2 (G F Eb D), repeated a third higher through the lydian #11 (Bb A G F).
  // Bars 5-8 climb to D6 and fall through the harmonic-minor tetrachord F E D C# onto the dominant.
  const A_HEAD = [
    "A4/1.5 D5/0.5 E5/2",
    "G5/1 F5/0.5 Eb5/0.5 D5/2",
    "A4/1.5 E5/0.5 F5/1 G5/0.5 A5/0.5",
    "Bb5/1 A5/0.5 G5/0.5 F5/2",
  ];
  const A1_TAIL = [
    "A5/1.5 C6/0.5 D6/2",
    "Bb5/1 A5/0.5 G5/0.5 F5/1.5 D5/0.5",
    "G5/1.5 Bb5/0.5 A5/1 G5/1",
    "F5/1 E5/0.5 D5/0.5 C#5/1.5 r/0.5",
  ];
  const A2_TAIL = [
    "A5/1.5 C6/0.5 D6/2",
    "Bb5/1 A5/0.5 G5/0.5 F5/1 E5/1",
    "D5/3 r/1",
    "r/4",
  ];
  const THEME = { A1: bars(A_HEAD.concat(A1_TAIL)), A2: bars(A_HEAD.concat(A2_TAIL)) };
  const DOM_TAIL = bars(["F5/1 E5/0.5 D5/0.5 C#5/1.5 r/0.5"], 7); // vamp bar 8: pickup into the theme
  const HEAD_MOTIF = bars(A_HEAD.slice(0, 2));

  // The B tune (strings): long-breathed and rising, in F major. It ends on the same F E D C# tail.
  const B_TUNE = {
    B1: bars([
      "C5/1 F5/1 A5/2",
      "Bb5/1 A5/0.5 G5/0.5 E5/2",
      "G5/1.5 A5/0.5 C6/2",
      "Bb5/1.5 G5/0.5 F5/1 D5/1",
      "F5/1.5 E5/0.5 D5/1 A4/1",
      "Bb4/1 D5/1 F5/1.5 E5/0.5",
      "F5/1 G5/1 A5/2",
      "G5/2 E5/1.5 r/0.5",
    ]),
    B2: bars([
      "C5/1 F5/1 A5/1 C6/1",
      "D6/2 C6/1 A5/1",
      "G5/1.5 A5/0.5 E5/2",
      "F5/1.5 E5/0.5 C5/1 D5/1",
      "Bb4/1.5 D5/0.5 A5/2",
      "G5/1.5 F5/0.5 Db5/2",
      "D5/1.5 F5/0.5 G5/1 A5/1",
      "G5/1 F5/0.5 E5/0.5 C#5/2",
    ]),
  };

  // Interlude: the vibes remember the theme from far away as the drums return.
  const I2_VIBES = {
    a: bars(["D5/1.5 G5/0.5 A5/2", "Bb5/1 A5/0.5 G5/0.5 F5/2", "G5/1 F5/0.5 E5/0.5 C#5/2"], 4),
    b: bars(["A5/1.5 C6/0.5 D6/2", "Bb5/1 A5/0.5 G5/0.5 F5/2", "G5/1 F5/0.5 E5/0.5 C#5/2"], 4),
  };

  // Marimba ostinato for vamp bars, in the bolero cell (0, 1.5, 2). Dm9 ends on E, which slides to Eb.
  const OSTINATO = {
    Dm9: bars(["D4/1 r/0.5 A3/0.5 E4/1 F4/0.5 E4/0.5"]),
    "Ebmaj9#11/D": bars(["Eb4/1 r/0.5 Bb3/0.5 D4/1.5 r/0.5"]),
    A7b9b13: bars(["C#4/1 r/0.5 A3/0.5 Bb3/1 A3/1"]),
  };
  // ...and its answer, a fourth higher at the top, for the middle of a vamp
  const OSTINATO2 = {
    Dm9: bars(["A4/1 r/0.5 D4/0.5 E4/1 F4/0.5 E4/0.5"]),
    "Ebmaj9#11/D": bars(["G4/1 r/0.5 Bb3/0.5 D4/1.5 r/0.5"]),
  };

  /**
   * T.voice, but a slash chord keeps its own root: with omitBass the engine filters the slash bass out
   * after deciding whether the root fits, so Ebmaj9#11/D came out as G F A Bb (no Eb). Here the root is
   * promoted to a guide tone and the bass note removed up front.
   */
  function voiceOf(sym, opts) {
    const c = T.chord(sym);
    if (c.bass === c.root) return T.voice(c, opts);
    const strip = (xs) => xs.filter((p) => p !== c.bass);
    const guide = strip(c.guide);
    if (!guide.includes(c.root)) guide.push(c.root);
    return T.voice({ ...c, guide, colors: strip(c.colors) }, { ...opts, omitBass: true });
  }

  /** Try close, drop-2 and open spreads; keep the one with the fewest seconds and least low crowding. */
  function blockVoicing(sym, opts) {
    let best = null, bestS = Infinity;
    for (const spread of ["close", "drop2", "open"]) {
      const v = voiceOf(sym, { ...opts, spread });
      if (!v || v.length < 2) continue;
      let s = 0;
      for (let i = 1; i < v.length; i++) {
        const gap = v[i] - v[i - 1];
        if (gap <= 2) s += v[i - 1] < 60 ? 6 : 3;
        if (v[i - 1] < 55 && gap < 5) s += 5;
      }
      if (opts.prev && opts.prev.length) { const a = v.slice().sort((x, y) => x - y), b = opts.prev.slice().sort((x, y) => x - y); s += Math.abs(a[a.length - 1] - b[b.length - 1]) * 0.4 + Math.abs(a[0] - b[0]) * 0.2; }
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || voiceOf(sym, opts);
  }

  // ---------- form ----------
  const SECTIONS = {
    intro: { prog: "INTRO", kind: "vamp", intro: true, dyn: 0.85, label: "Vamp · tom-toms, birds and tree frogs" },
    vamp: { prog: "VAMP", kind: "vamp", dyn: 0.9, label: "Vamp · marimba over a D pedal" },
    A1: { prog: "A1", kind: "A", theme: "A1", dyn: 1, label: "A · vibraphone theme" },
    A2: { prog: "A2", kind: "A", theme: "A2", dyn: 1, label: "A · theme, cadence" },
    B1: { prog: "B1", kind: "B", dyn: 1.05, label: "B · the lagoon opens into F major" },
    B2: { prog: "B2", kind: "B", dyn: 1.05, label: "B · minor iv, ♭VII and back" },
    A2g: { prog: "A2", kind: "A", theme: "A2", glock: true, dyn: 0.95, label: "A′ · theme with glockenspiel echoes" },
    I1: { prog: "I1", kind: "I1", dyn: 0.8, label: "Interlude · the drums fall away, the jungle takes over" },
    I2: { prog: "I2", kind: "I2", dyn: 0.85, label: "Interlude · planing chords, hand drums creep back" },
    A1r: { prog: "A1", kind: "A", theme: "A1", glock: true, ret: true, dyn: 1.05, label: "A · the theme returns" },
    A2r: { prog: "A2", kind: "A", theme: "A2", ret: true, dyn: 1, label: "A · theme in thirds" },
    outro: { prog: "VAMP", kind: "vamp", outro: true, dyn: 0.9, label: "Vamp · sunset, the motif drifts off" },
  };
  const ROUND = ["A1", "A2", "B1", "B2", "A2g", "I1", "I2", "A1r", "A2r", "outro"];
  function planAt(cycle) {
    if (cycle === 0) return { id: "intro", round: 0, ...SECTIONS.intro };
    if (cycle === 1) return { id: "vamp", round: 0, ...SECTIONS.vamp };
    const k = cycle - 2, round = Math.floor(k / ROUND.length), id = ROUND[k % ROUND.length];
    const s = { id, round, ...SECTIONS[id] };
    if (s.kind === "I1" || s.kind === "I2") s.prog = s.kind + (round % 2 ? "b" : "a");
    return s;
  }

  // ---------- percussion ----------
  const TOM_LO = 45, TOM_HI = 50; // A2 and D3: inside every chord of the piece
  /** One bar of bolero percussion. f: { tom, shaker, bongo, conga, clave, heart, fill } (levels 0..1+). */
  function drumBar(push, bar, f) {
    const B = bar * BPB;
    const hit = (b, voice, vel, pitch) => push("drums", B + b, 0.25, voice, vel, pitch != null ? { pitch } : {});
    const fillFrom = f.fill === "bongo" ? 3 : f.fill === "tom" ? 2 : 4;
    if (f.tom) {
      hit(0, "tom", 0.5 * f.tom, TOM_LO);
      if (fillFrom > 1.5) hit(1.5, "tom", 0.3 * f.tom, TOM_HI);
      if (fillFrom > 2) hit(2, "tom", 0.4 * f.tom, TOM_LO);
    }
    if (f.heart) hit(0, "tom", 0.24 * f.heart, TOM_LO);
    if (f.shaker) for (let i = 0; i < 8; i++) hit(i * 0.5, "shaker", (i % 2 ? 0.15 : 0.25) * f.shaker);
    if (f.bongo) {
      // martillo: index-finger taps on the macho, thumb on the off-eighths, open hembra on beat 4
      const M = [[0, 0.3, 77], [0.5, 0.15, 74], [1, 0.27, 77], [1.5, 0.15, 74], [2, 0.3, 77], [2.5, 0.15, 74], [3, 0.46, 69], [3.5, 0.22, 77]];
      M.forEach(([b, v, p]) => { if (b < fillFrom) hit(b, "bongo", v * f.bongo, p); });
    }
    if (f.conga) {
      hit(1, "conga", 0.4 * f.conga, 67); // slap
      if (fillFrom > 3) { hit(3, "conga", 0.44 * f.conga, 62); hit(3.5, "congaLow", 0.46 * f.conga, 57); }
    }
    if (f.clave) (bar % 2 === 0 ? [1, 2] : [0, 1.5, 3]).forEach((b) => hit(b, "clave", 0.32 * f.clave)); // 2-3 son clave
    if (f.fill === "bongo") [3, 3.25, 3.5, 3.75].forEach((b, i) => hit(b, "bongo", 0.3 + i * 0.09, i % 2 ? 69 : 77));
    if (f.fill === "tom") [2, 2.5, 3, 3.25, 3.5, 3.75].forEach((b, i) => hit(b, "tom", 0.26 + i * 0.07, i % 2 ? TOM_LO : TOM_HI));
  }

  // ---------- birds and frogs: call shapes in seconds; chirp = [offset, f1, f2, f3, dur, vel] ----------
  function birdChirps(sp, r) {
    const out = [];
    if (sp.kind === "oriole") { // a rising-falling whistle, "wheee-oo", one to three times
      const f = sp.f * r.range(0.96, 1.04), reps = r.int(1, 3);
      let o = 0;
      for (let i = 0; i < reps; i++) {
        out.push([o, f, f * 1.5, f * 1.22, 0.26, 1], [o + 0.34, f * 1.28, f * 1.34, f * 0.9, 0.32, 0.8]);
        o += r.range(0.85, 1.15);
      }
    } else if (sp.kind === "warbler") { // a falling trill of tiny upward chirps
      const f = sp.f * r.range(0.95, 1.05), n = r.int(7, 12);
      for (let i = 0; i < n; i++) { const g = f * (1 - (0.16 * i) / n); out.push([i * 0.072, g, g * 1.2, g * 1.08, 0.048, 0.65 + 0.35 * Math.sin((Math.PI * (i + 0.5)) / n)]); }
    } else if (sp.kind === "dove") { // three soft coos, the middle one higher
      const f = sp.f;
      out.push([0, f, f * 1.03, f * 0.94, 0.28, 0.6], [0.42, f * 1.16, f * 1.19, f * 1.04, 0.4, 1], [1.0, f * 0.98, f, f * 0.9, 0.55, 0.7]);
    } else { // toucan: a whooping rise, then four laughing keks
      const f = sp.f;
      out.push([0, f * 0.55, f * 1.5, f * 1.4, 0.42, 0.9]);
      for (let i = 0; i < 4; i++) { const k = 1 - 0.05 * i; out.push([0.55 + i * 0.15, f * 1.25 * k, f * 1.3 * k, f * 1.1 * k, 0.07, 0.75]); }
    }
    return out;
  }
  function croakChirps(fr, r) { // [offset, f1, f2, dur, vel]
    const out = [], n = r.int(2, 3);
    let o = 0;
    for (let i = 0; i < n; i++) { const d = r.range(0.18, 0.26); out.push([o, fr.f, fr.f * 0.86, d, i ? 0.85 : 1]); o += d + r.range(0.16, 0.24); }
    return out;
  }
  function peepChirps(r) { // a coqui-like "ko-kee"
    const out = [], reps = r.int(2, 3), k = r.range(0.93, 1.07);
    for (let i = 0; i < reps; i++) { const o = i * r.range(0.5, 0.65); out.push([o, 1150 * k, 1100 * k, 0.06, 0.7], [o + 0.12, 1700 * k, 2150 * k, 0.1, 1]); }
    return out;
  }
  const finite = (xs) => xs.every((c) => c.every((x) => Number.isFinite(x) && x >= 0));

  // ---------- custom instruments ----------
  function aviary(ctx, dest) {
    const { I } = ctx;
    const bus = ctx.keep(new Tone.Gain(db(-17))).connect(dest);
    const voices = [0, 1, 2].map(() => {
      const pan = ctx.keep(new Tone.Panner(0)).connect(bus);
      const hp = ctx.keep(new Tone.Filter({ frequency: 320, type: "highpass" })).connect(pan);
      const s = ctx.keep(new Tone.FMSynth({
        harmonicity: 2, modulationIndex: 0.5, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.008, decay: 0.05, sustain: 0.85, release: 0.03 },
        modulationEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.05 },
      })).connect(hp);
      return { s, pan, mono: I.monotonic(s) };
    });
    return {
      out: bus,
      play(t, e) {
        if (!Array.isArray(e.chirps) || !finite(e.chirps)) return;
        const v = voices[(e.voice || 0) % voices.length];
        v.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, e.pan || 0)), t);
        for (const [o, f1, f2, f3, d, g] of e.chirps) {
          const tt = v.mono(t + o);
          v.s.frequency.cancelScheduledValues(tt);
          v.s.triggerAttackRelease(f1, d, tt, e.vel * g);
          v.s.frequency.exponentialRampToValueAtTime(f2, tt + d * 0.4);
          v.s.frequency.exponentialRampToValueAtTime(f3, tt + d);
        }
      },
    };
  }

  /** Two frogs answering each other across the stereo field (pulsed buzz plus rasp), and a tree frog. */
  function frogPond(ctx, dest) {
    const { I } = ctx;
    const bus = ctx.keep(new Tone.Gain(db(-9))).connect(dest);
    const frogs = [-0.55, 0.6].map((p) => {
      const pan = ctx.keep(new Tone.Panner(p)).connect(bus);
      const trem = ctx.keep(new Tone.Tremolo({ frequency: 28, depth: 0.9, spread: 0 }).start()).connect(pan);
      const bp = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 620, Q: 2.2 })).connect(trem);
      const osc = ctx.keep(new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.025, decay: 0.08, sustain: 0.75, release: 0.07 } })).connect(bp);
      const nbp = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 1300, Q: 1.4 })).connect(trem);
      const nz = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.06 } })).connect(nbp);
      nz.volume.value = -8;
      return { trem, osc, nz, mo: I.monotonic(osc), mn: I.monotonic(nz) };
    });
    const peepPan = ctx.keep(new Tone.Panner(0.3)).connect(bus);
    const peep = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.006, decay: 0.04, sustain: 0.7, release: 0.03 } })).connect(peepPan);
    peep.volume.value = -12;
    const mp = I.monotonic(peep);
    return {
      out: bus,
      play(t, e) {
        if (!Array.isArray(e.chirps) || !finite(e.chirps)) return;
        if (e.note === "peep") {
          for (const [o, f1, f2, d, g] of e.chirps) {
            const tt = mp(t + o);
            peep.frequency.cancelScheduledValues(tt);
            peep.triggerAttackRelease(f1, d, tt, e.vel * g);
            peep.frequency.exponentialRampToValueAtTime(f2, tt + d);
          }
          return;
        }
        const f = frogs[(e.frog || 0) % 2];
        if (Number.isFinite(e.rate)) f.trem.frequency.setValueAtTime(e.rate, t);
        for (const [o, f1, f2, d, g] of e.chirps) {
          const to = f.mo(t + o);
          f.osc.frequency.cancelScheduledValues(to);
          f.osc.triggerAttackRelease(f1, d, to, e.vel * g);
          f.osc.frequency.exponentialRampToValueAtTime(f2, to + d);
          f.nz.triggerAttackRelease(d, f.mn(t + o), e.vel * g);
        }
      },
    };
  }

  /** Cicadas: band-passed noise pulsing at ~31 Hz, faded in and out over whole sections. */
  function cicadas(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    const trem = ctx.keep(new Tone.Tremolo({ frequency: 31, depth: 0.8, spread: 90 }).start()).connect(g);
    const bp = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 5200, Q: 4 })).connect(trem);
    ctx.keep(new Tone.Noise({ type: "white" }).start()).connect(bp);
    return {
      out: g,
      play(t, e, d) {
        const lvl = db(-17) * Math.max(0, Math.min(1, e.vel || 0));
        g.gain.cancelAndHoldAtTime(t);
        g.gain.linearRampToValueAtTime(lvl, t + d * 0.3);
        g.gain.linearRampToValueAtTime(lvl, t + d * 0.7);
        g.gain.linearRampToValueAtTime(0, t + d);
      },
    };
  }

  /** A tuned gong (D2): inharmonic FM whose modulation blooms after the strike. */
  function gong(ctx, dest) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db(-13))).connect(dest);
    const lp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass" })).connect(out);
    const s = ctx.keep(new Tone.FMSynth({
      harmonicity: 1.41, modulationIndex: 4, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.004, decay: 7, sustain: 0, release: 4 },
      modulationEnvelope: { attack: 0.35, decay: 4, sustain: 0.2, release: 3 },
    })).connect(lp);
    const mono = I.monotonic(s);
    return { out, play(t, e, d) { s.triggerAttackRelease(T.hz(38), d, mono(t), e.vel); } };
  }

  // ---------- comping figures (beat, dur) for the piano's block chords ----------
  const PIANO4 = [
    [[[0, 1.4], [1.5, 2.3]], 4],            // the bolero cell
    [[[0, 3.6]], 1],
    [[[0, 1.4], [1.5, 1.4], [3, 0.9]], 1.5],
    [[[-0.5, 1.9], [1.5, 2.3]], 1.5],       // anticipated
  ];
  const PIANO2 = [[[[0, 1.4]], 3], [[[0, 0.9]], 1]];

  Sim.register({
    id: "island-resort",
    title: "Island Resort",
    genre: "Exotica",
    about: "A tiki-bar bolero in D minor: tremolo vibraphone over a Phrygian vamp and tuned tom-toms, harmonic-minor dominants, a string tune that blossoms into F major, planing maj9#11 chords, and synthesized birds, tree frogs and cicadas that take over when the drums fall away.",
    bpm: 86, swing: 0.5, beatsPerBar: BPB, cycleBars: 8, gainDb: 2,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.028, lowcut: 280, highcut: 6500 });
      const jungle = I.reverb(ctx, out, { decay: 6.5, preDelay: 0.06, lowcut: 450, highcut: 7500 });
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.01, lowcut: 300, highcut: 6000 });
      const echo = I.delay(ctx, out, { time: "4n", feedback: 0.28, highcut: 5000, pingPong: true });

      const vibes = I.vibes(ctx, { volume: -2, decay: 3.8, motor: 4.6, motorDepth: 0.42 });
      const strings = I.strings(ctx, { volume: -4, cutoff: 3200, attack: 0.32, release: 1.1 });
      const pad = I.strings(ctx, { volume: -12, cutoff: 1700, attack: 1.3, release: 2.6 });
      const piano = I.softPiano(ctx, { volume: -5, cutoff: 3000, decay: 4.5, release: 1.6 });
      const marimba = I.marimba(ctx, { volume: -7, cutoff: 3800, decay: 0.8 });
      const glock = I.glock(ctx, { volume: -16, decay: 2.4 });
      const harp = I.harp(ctx, { volume: -12 });
      const bass = I.upright(ctx, { volume: -4 });
      const kit = I.kit(ctx, { volume: -4, preload: ["tom", "conga", "congaLow", "bongo", "clave", "shaker"] });

      const vp = I.place(ctx, vibes, -0.22, out), sp = I.place(ctx, strings, 0.08, out), pp = I.place(ctx, pad, 0.15, out);
      const kp = I.place(ctx, piano, -0.35, out), mp = I.place(ctx, marimba, 0.38, out), gp = I.place(ctx, glock, 0.45, out);
      const hp = I.place(ctx, harp, -0.42, out), dp = I.place(ctx, kit, 0, out);
      I.place(ctx, bass, 0, out);
      I.send(ctx, vp, hall, -9); I.send(ctx, vp, echo, -22);
      I.send(ctx, sp, hall, -8); I.send(ctx, pp, hall, -10); I.send(ctx, kp, hall, -12); I.send(ctx, mp, hall, -13);
      I.send(ctx, gp, hall, -6); I.send(ctx, gp, echo, -14); I.send(ctx, hp, hall, -7);
      I.send(ctx, dp, room, -14); I.send(ctx, dp, hall, -22); I.send(ctx, bass.out, room, -24);

      const birds = aviary(ctx, out), frogs = frogPond(ctx, out), bugs = cicadas(ctx, out), bong = gong(ctx, out);
      I.send(ctx, birds.out, jungle, -4); I.send(ctx, birds.out, echo, -12);
      I.send(ctx, frogs.out, jungle, -8); I.send(ctx, bugs.out, jungle, -10);
      I.send(ctx, bong.out, jungle, -3); I.send(ctx, bong.out, hall, -8);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        vibes: { layer: "melody", play: pl(vibes), humanize: { timing: 0.01, vel: 0.05 } },
        strings: { layer: "melody", play: pl(strings), humanize: { timing: 0.008, vel: 0.04 } },
        glock: { layer: "melody", play: pl(glock), humanize: { timing: 0.01, vel: 0.08 } },
        piano: { layer: "harmony", play: pl(piano), humanize: { timing: 0.012, vel: 0.06 } },
        pad: { layer: "harmony", play: pl(pad), humanize: { timing: 0, vel: 0 } },
        marimba: { layer: "harmony", play: pl(marimba), humanize: { timing: 0.008, vel: 0.08 } },
        harp: { layer: "harmony", play: pl(harp), humanize: { timing: 0.004, vel: 0.05 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.1 } },
        gong: { layer: "drums", play: (t, e, d) => bong.play(t, e, d), humanize: { timing: 0, vel: 0 } },
        birds: { layer: "texture", play: (t, e) => birds.play(t, e), humanize: { timing: 0.03, vel: 0.15 } },
        frogs: { layer: "texture", play: (t, e) => frogs.play(t, e), humanize: { timing: 0.03, vel: 0.15 } },
        insects: { layer: "texture", play: (t, e, d) => bugs.play(t, e, d), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const prog = PROGS[plan.prog];
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(b).chord;
      const spans = prog.map((h) => ({ sym: h.chord, start: h.bar * BPB + h.beat, dur: h.dur }));
      const nextFirst = PROGS[next.prog][0].chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const D = plan.dyn, odd = plan.round % 2 === 1;
      const kind = plan.kind;

      if (!state.species) {
        const s = r.fork(7);
        state.species = [
          { kind: "oriole", f: s.range(1500, 2000), pan: s.range(-0.75, -0.3), voice: 0 },
          { kind: "warbler", f: s.range(3000, 3700), pan: s.range(0.3, 0.75), voice: 1 },
          { kind: "dove", f: s.range(500, 600), pan: s.range(-0.2, 0.2), voice: 2 },
          { kind: "toucan", f: s.range(1050, 1350), pan: s.pick([-0.6, 0.6]), voice: 0 },
        ];
        state.frogs = [{ f: s.range(98, 112), rate: s.range(24, 28) }, { f: s.range(122, 138), rate: s.range(31, 35) }];
        state.ansDir = s.chance(0.5) ? 1 : -1;
      }

      // ================= melody =================
      const vib = (n, vel) => push("vibes", n.beat, n.dur, n.note, vel);
      const accent = (n) => { const inBar = n.beat % BPB; return (inBar === 0 ? 0.66 : inBar === 2 ? 0.62 : n.dur >= 1 ? 0.58 : 0.52) + ((Array.isArray(n.note) ? n.note[1] : n.note) >= 84 ? 0.05 : 0); };
      const echoBars = plan.glock ? [1, 3] : [];
      if (kind === "A") {
        const src = THEME[plan.theme];
        const notes = [];
        src.forEach((n, i) => {
          const nx = src[i + 1], bar = Math.floor(n.beat / BPB);
          let dur = n.dur, note = n.note, pickup = null;
          // fills: on a return, a long note may give up its last half beat to a neighbour into the next note
          const fillP = plan.ret ? 0.35 : plan.glock ? 0.2 : 0;
          if (fillP && dur >= 2 && nx && Math.abs(nx.beat - (n.beat + dur)) < 1e-6 && !echoBars.includes(bar) && r.chance(fillP)) {
            const p = T.step(nx.note, nx.note > n.note ? -1 : 1, T.chord(symAt(n.beat + dur - 0.5)).scale);
            if (p !== n.note && p !== nx.note && Math.abs(p - n.note) <= 5) { dur -= 0.5; pickup = { beat: n.beat + dur, dur: 0.5, note: p }; }
          }
          // thirds: on the returns, the vibes play long notes as double stops (a chord tone a 3rd or 6th below)
          if (plan.ret && n.dur >= 1.5 && n.beat % 2 === 0) {
            const c = T.chord(symAt(n.beat));
            for (const iv of [3, 4, 8, 9]) { const m = n.note - iv; if (c.pcs.includes(T.mod12(m)) && m >= 62) { note = [m, n.note]; break; } }
          }
          notes.push({ beat: n.beat, dur, note });
          if (pickup) notes.push(pickup);
        });
        notes.forEach((n) => vib(n, accent(n) * D * (n.dur === 0.5 && n.beat % 1 ? 0.95 : 1)));
        // glockenspiel echoes the descents an octave up while the vibes hold
        echoBars.forEach((bar) => {
          src.filter((n) => n.beat >= bar * BPB && n.beat < bar * BPB + 2).slice(0, 3).forEach((n, i) =>
            push("glock", n.beat + 2, n.dur, n.note + 12, (i ? 0.26 : 0.34) * D));
        });
      } else if (kind === "B") {
        // even rounds: the strings alone; odd rounds: vibes and strings in unison
        B_TUNE[plan.id].forEach((n) => {
          const inBar = n.beat % BPB;
          push("strings", n.beat, n.dur * 0.98, n.note, (inBar === 0 ? 0.62 : 0.56) * D);
          if (odd) vib(n, accent(n) * 0.85 * D);
        });
      } else if (kind === "vamp") {
        if (plan.outro) { // the opening motif drifts off: vibes, then glockenspiel an octave up, then the pickup
          HEAD_MOTIF.forEach((n) => vib(n, accent(n) * 0.85 * D));
          HEAD_MOTIF.forEach((n) => push("glock", n.beat + 4 * BPB, n.dur, n.note + 12, (n.beat % BPB === 0 ? 0.32 : 0.26) * D));
        }
        if (!plan.intro) DOM_TAIL.forEach((n) => vib(n, accent(n) * 0.8 * D));
      } else if (kind === "I2") {
        I2_VIBES[odd ? "b" : "a"].forEach((n) => vib(n, accent(n) * 0.75 * D));
      }

      // ================= which bars the piano comps (the pad makes room for it) =================
      const pianoBars = new Set();
      if (kind === "A") { [4, 5, 6].forEach((b) => pianoBars.add(b)); if (plan.theme === "A1") pianoBars.add(7); }
      if (kind === "vamp" && !plan.intro) pianoBars.add(7);
      if (kind === "B" && odd) for (let b = 0; b < 8; b++) pianoBars.add(b);
      if (kind === "I2") for (let b = 0; b < 7; b++) pianoBars.add(b);

      // ================= pad (strings) =================
      // under the theme: below the vibes; in B: low, under the string tune (off when the piano comps);
      // in the interlude: high and open, with the drums gone
      if (!(kind === "B" && odd)) {
        const o = kind === "B" ? { lo: 53, hi: 69, n: 3, top: [62, 68], vel: 0.34 }
          : kind === "I1" || kind === "I2" ? { lo: 57, hi: 81, n: 4, top: [72, 79], vel: 0.34 }
          : { lo: 52, hi: 69, n: 4, top: [60, 67], vel: 0.3 };
        let plane = null;
        spans.forEach((s, si) => {
          for (let st = s.start; st < s.start + s.dur - 1e-6; st += 8) { // re-bow long chords every two bars
            if (plan.intro && st < 16) continue; // the strings enter halfway through the intro
            const len = Math.min(8, s.start + s.dur - st);
            const c = T.chord(s.sym);
            let v;
            if (kind === "I2" && si < 4) { // chromatic planing: one shape, moved down a semitone a bar
              if (!plane) plane = { v: voiceOf(s.sym, { lo: o.lo, hi: o.hi, n: 4, prev: state.padV, top: o.top, rng: r }), root: c.root };
              v = plane.v.map((x) => x - T.mod12(plane.root - c.root));
            } else if (kind === "A" && pianoBars.has(Math.floor(st / BPB))) { // the piano comps: the strings keep low guide tones
              v = voiceOf(s.sym, { lo: 50, hi: 64, n: 2, prev: state.padV, top: [57, 64], rng: r });
            } else v = blockVoicing(s.sym, { lo: o.lo, hi: o.hi, n: o.n, prev: state.padV, top: o.top, rng: r });
            state.padV = v;
            push("pad", st, len + 0.1, v, o.vel * D * (plan.intro || kind === "I1" ? 0.8 : 1));
          }
        });
      }

      // ================= piano block chords =================
      {
        const lowB = kind === "B";
        const hits = [];
        let plane = null, prevBarPlayed = false;
        spans.forEach((s, si) => {
          const bar = Math.floor(s.start / BPB);
          if (!pianoBars.has(bar)) { prevBarPlayed = false; return; }
          const c = T.chord(s.sym);
          let v;
          if (kind === "I2" && si < 4) {
            if (!plane) plane = { v: voiceOf(s.sym, { lo: 55, hi: 76, n: 4, prev: state.pianoV, top: [68, 75], rng: r }), root: c.root };
            v = plane.v.map((x) => x - T.mod12(plane.root - c.root));
          } else {
            // close block chords just under the melody (in B, under the vibes-and-strings unison)
            v = blockVoicing(s.sym, { lo: lowB ? 50 : 53, hi: lowB ? 70 : 74, n: 4, prev: state.pianoV, top: lowB ? [63, 69] : [67, 72], rng: r });
          }
          state.pianoV = v;
          let pat;
          if (kind === "I2") pat = si < 4 ? [[0, 3.8]] : [[0, 1.4], [1.5, 2.3]];
          else {
            // anticipate the chord only if every note of it also fits the chord it will sound over
            const pc = si > 0 ? T.chord(spans[si - 1].sym) : null, fits = pc && v.every((m) => pc.scale.concat(pc.pcs).includes(T.mod12(m)));
            const pool = s.dur >= 4 ? PIANO4 : PIANO2;
            pat = r.weighted(prevBarPlayed && fits ? pool : pool.filter(([p]) => p[0][0] >= 0));
          }
          hits.push(pat.map(([b, d]) => ({ at: s.start + b, d, v })));
          prevBarPlayed = true;
        });
        hits.forEach((hs, i) => {
          const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : 1e9;
          hs.filter((h) => h.at < nextStart - 0.25).forEach((h, j) =>
            push("piano", h.at, Math.min(h.d, nextStart - h.at - 0.05), h.v, (j === 0 ? 0.46 : 0.4) * D * (kind === "I2" ? 0.8 : 1) + r.range(-0.03, 0.04)));
        });
      }

      // ================= marimba =================
      const ost = (bar, vel, alt) => {
        const pat = (alt && OSTINATO2[symAt(bar * BPB)]) || OSTINATO[symAt(bar * BPB)];
        if (pat) pat.forEach((n) => push("marimba", bar * BPB + n.beat, n.dur, n.note, (n.beat === 0 ? 0.46 : 0.36) * vel * D));
      };
      /** A short answer stepping into `target` (midi) at the next downbeat from above (dir 1) or below (-1). */
      const answer = (bar, beats, target, dir, landing) => {
        const B = bar * BPB, c = T.chord(symAt(B + beats[0]));
        const ns = [T.step(target, dir, c.scale)];
        while (ns.length < beats.length) ns.unshift(T.step(ns[0], dir, c.pcs));
        ns.forEach((m, i) => push("marimba", B + beats[i], 0.5, m, (i === ns.length - 1 ? 0.3 : 0.36) * D));
        if (landing) push("marimba", B + BPB, 1, target, 0.3 * D);
      };
      const ansDir = (sym) => { const c = T.chord(sym); if (c.kind === "dominant") return -1; state.ansDir = -state.ansDir; return state.ansDir; };
      if (kind === "vamp" && !plan.intro) for (let b = 0; b < 8; b++) ost(b, b === 0 && plan.outro ? 0.9 : 1, b === 4 || b === 5);
      if (kind === "vamp" && plan.intro) for (let b = 6; b < 8; b++) ost(b, 0.7);
      if (kind === "A") {
        for (let b = 0; b < 4; b++) ost(b, 0.85);
        const t5 = T.nearest(62, T.chord(symAt(5 * BPB)).pcs, 57, 67);
        answer(4, [2.5, 3, 3.5], t5, ansDir(symAt(4 * BPB)), true);
        if (plan.theme === "A1") answer(7, [3, 3.5], 62, -1, false); // C#4 into the ostinato's D4
        else { answer(6, [3, 3.5], 63, ansDir(symAt(6 * BPB)), false); ost(7, 0.85); }
      }
      if (kind === "B" && !odd) { // rippling arpeggios, accented in the bolero cell
        const SHAPES = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 4, 3, 2, 1, 2]];
        const shape = SHAPES[(state.rippleShape = state.rippleShape ?? r.int(0, 2))];
        for (let b = 0; b < 8; b++) {
          const c = T.chord(symAt(b * BPB));
          const pool = T.notesIn(c.pcs, 52, 74);
          const base = new Set([c.root, T.mod12(c.root + (c.intervals.includes(3) ? 3 : 4)), T.mod12(c.root + 7)]);
          let s0 = pool.findIndex((m) => m >= 53 && base.has(T.mod12(m)));
          if (s0 < 0) s0 = 0;
          s0 = Math.min(s0, pool.length - 5);
          shape.forEach((k, i) => {
            const at = b * BPB + i * 0.5;
            const acc = i === 0 ? 0.42 : i === 3 || i === 4 ? 0.36 : 0.26;
            push("marimba", at, 0.5, pool[s0 + k], acc * D * (b === 0 ? 0.9 : 1));
          });
        }
      }
      if (kind === "I1" || (kind === "I2" && odd)) { // soft two-note tremolo rolls
        const rollBars = kind === "I1" ? [r.pick([1, 2, 3]), r.pick([5, 6])] : [r.pick([1, 2])];
        rollBars.forEach((b) => {
          const at = b * BPB + r.pick([0, 2]), c = T.chord(symAt(at));
          const lo = T.nearest(r.int(57, 61), c.pcs, 55, 64);
          const hi = [7, 8, 9, 5].map((iv) => lo + iv).find((m) => c.pcs.includes(T.mod12(m))) ?? lo + 12;
          for (let i = 0; i < 8; i++) push("marimba", at + i * 0.25, 0.25, i % 2 ? hi : lo, (0.12 + 0.18 * Math.sin((Math.PI * (i + 0.5)) / 8)) * D);
        });
      }

      // ================= harp glissandi =================
      if (kind === "A" && plan.theme === "A2" && next.kind === "B") { // F pentatonic (inside Eb lydian) up into the B section
        const g = T.notesIn([5, 7, 9, 0, 2], 53, 86);
        g.forEach((m, i) => push("harp", 7 * BPB + 2 + (i * 2) / g.length, 1.5, m, 0.24 + (0.26 * i) / g.length, { straight: true }));
      }
      if (kind === "I2") { // phrygian dominant down onto the returning theme
        const g = T.notesIn(T.scale(9, "phrygianDominant"), 57, 81).reverse();
        g.forEach((m, i) => push("harp", 7 * BPB + 2 + (i * 1.75) / g.length, 1.2, m, 0.42 - (0.16 * i) / g.length, { straight: true }));
      }

      // ================= bass (bolero) =================
      {
        let last = state.bassLast ?? 38;
        const approach = (from, toSym, curSym) => {
          const to = T.chord(toSym), cur = T.chord(curSym);
          const tgt = T.nearest(from, [to.bass], 33, 46);
          const ok = new Set(cur.scale.concat(cur.pcs));
          const opts = [[tgt - 1, 2], [tgt + 1, 1], [tgt <= 40 ? tgt + 7 : tgt - 5, 2]].filter(([m]) => ok.has(T.mod12(m)) && m >= 31);
          return opts.length ? r.weighted(opts) : (tgt <= 40 ? tgt + 7 : tgt - 5);
        };
        spans.forEach((s, si) => {
          const c = T.chord(s.sym);
          const nextSym = si + 1 < spans.length ? spans[si + 1].sym : nextFirst;
          for (let st = s.start; st < s.start + s.dur - 1e-6; st += Math.min(BPB, s.dur)) {
            const len = Math.min(BPB, s.start + s.dur - st);
            const bar = Math.floor(st / BPB), lastBarOfSpan = st + len >= s.start + s.dur - 1e-6;
            const root = T.nearest(last, [c.bass], 33, 46);
            // the bolero's fifth; on a chord without one (A7b9b13: the b13 replaces it) the octave
            const fifth = c.intervals.includes(7) || c.bass !== c.root ? (root <= 40 ? root + 7 : root - 5) : root <= 40 ? root + 12 : root - 12;
            if (plan.intro) {
              if (bar < 4) continue;
              push("bass", st, 1.4, root, 0.7 * D); push("bass", st + 1.5, 0.45, fifth, 0.5 * D); push("bass", st + 2, 1.8, root, 0.6 * D);
              last = root; continue;
            }
            if (kind === "I1") {
              if (bar % 2 === 0) push("bass", st, 7.5, root, 0.5 * D);
              last = root; continue;
            }
            if (kind === "I2" && bar < 4) { push("bass", st, 3.8, root, 0.58 * D); last = root; continue; }
            push("bass", st, 1.4, root, 0.82 * D);
            if (st % BPB === 0) push("bass", st + 1.5, 0.45, fifth, 0.58 * D);
            if (len >= 4) {
              const chg = lastBarOfSpan && nextSym !== s.sym;
              const pick = r.chance(chg ? 0.55 : 0.2);
              const third = r.chance(0.25) ? fifth : root;
              push("bass", st + 2, pick ? 1.4 : 1.85, third, 0.68 * D);
              const ap = pick ? approach(third, chg ? nextSym : s.sym, s.sym) : null;
              if (ap != null && ap !== third) { push("bass", st + 3.5, 0.45, ap, 0.55 * D); last = ap; continue; } // the next root resolves the pickup
              if (pick) ev[ev.length - 1].dur = 1.85; // nothing new to say: let the note ring
            } else if (st % BPB === 2 && lastBarOfSpan && r.chance(0.5)) {
              const ap = approach(root, nextSym, s.sym);
              push("bass", st + 1.5, 0.45, ap, 0.55 * D); last = ap; continue;
            }
            last = root;
          }
        });
        state.bassLast = last;
      }

      // ================= drums =================
      for (let b = 0; b < 8; b++) {
        let f = {};
        if (kind === "vamp" && plan.intro) f = { tom: 0.55 + 0.06 * b, shaker: b >= 2 ? 0.8 : 0, bongo: b >= 4 ? 0.85 : 0, conga: b >= 6 ? 0.9 : 0, clave: b >= 6 ? 0.9 : 0 };
        else if (kind === "vamp") f = { tom: 1, shaker: 1, bongo: 1, conga: 1, clave: 1 };
        else if (kind === "A") f = { tom: plan.ret ? 1.1 : 1, shaker: 1, bongo: 1, conga: 1, clave: 1, fill: b === 7 && next.kind === "B" ? "bongo" : null };
        else if (kind === "B") f = { tom: 0.75, shaker: 1, bongo: 0.9, conga: 1, fill: b === 7 && plan.id === "B2" ? "bongo" : null };
        else if (kind === "I1") f = { heart: b >= 2 ? 0.6 + 0.08 * b : 0 };
        else if (kind === "I2") f = b < 4 ? { heart: 1 } : b === 4 ? { heart: 1, conga: 0.7 } : b === 5 ? { tom: 0.7, conga: 0.8, shaker: 0.6 }
          : b === 6 ? { tom: 0.85, conga: 0.9, shaker: 0.8, bongo: 0.7 } : { tom: 1, conga: 1, shaker: 0.9, fill: "tom" };
        if (Object.keys(f).length) drumBar(push, b, f);
      }
      if (plan.intro || kind === "I1") push("gong", 0, 8, "gong", (plan.intro ? 0.5 : 0.6));

      // ================= birds, frogs, cicadas =================
      const sp = state.species;
      const bird = (abs, s, vel) => {
        const chirps = birdChirps(s, r);
        if (finite(chirps)) push("birds", abs, 1, "call", vel, { voice: s.voice, pan: Math.max(-0.9, Math.min(0.9, s.pan + r.range(-0.15, 0.15))), chirps });
      };
      const croak = (abs, which, vel) => {
        const fr = state.frogs[which], chirps = croakChirps(fr, r);
        if (finite(chirps)) push("frogs", abs, 1, "croak", vel, { frog: which, rate: fr.rate * r.range(0.95, 1.05), chirps });
      };
      const peep = (abs, vel) => { const chirps = peepChirps(r); if (finite(chirps)) push("frogs", abs, 1, "peep", vel, { chirps }); };
      /** One spot per group of bars, so calls spread over the section instead of bunching. */
      const spots = (groups, beats) => groups.map((g) => r.pick(g) * BPB + r.pick(beats));
      const common = () => r.weighted([[sp[0], 3], [sp[1], 2], [sp[2], 1.5]]);
      if (kind === "vamp") {
          const at = spots(plan.intro ? [[0, 1], [2, 3], [5, 6]] : [[1, 2], [3, 5]], [0.5, 2.5]);
        at.forEach((a, i) => bird(a, plan.intro && i === 1 ? sp[1] : common(), 0.55));
        if (plan.intro || r.chance(0.6)) { const a = r.pick([3, 6]) * BPB + 1; croak(a, 0, 0.5); if (plan.intro) croak(a + 2.5, 1, 0.45); }
        if (plan.intro) { peep(4 * BPB + 3, 0.4); push("insects", 0, 30, "swell", 0.45); }
      } else if (kind === "A") {
        if (plan.theme === "A1" && !plan.glock && r.chance(0.45)) bird(r.pick([1, 3]) * BPB + 2.5, common(), 0.45);
        if (plan.theme === "A2" && r.chance(0.6)) bird(7 * BPB + 0.5, common(), 0.5);
      } else if (kind === "B") {
        if (r.chance(0.4)) bird(r.pick([2, 6]) * BPB + 2.5, r.pick([sp[0], sp[2]]), 0.42);
      } else if (kind === "I1") {
        const at = spots([[0, 1], [2], [3, 4], [5], [6, 7]], [0.5, 1.5, 2.5]);
        const tuc = r.int(1, 3);
        at.forEach((a, i) => bird(a, i === tuc ? sp[3] : r.weighted([[sp[0], 2], [sp[1], 2], [sp[2], 1]]), 0.6 + 0.08 * Math.sin(i)));
        r.shuffle([1, 3, 5, 6]).slice(0, 2).forEach((b) => { const a = b * BPB + r.pick([0, 2]); croak(a, 0, 0.55); croak(a + r.pick([1.5, 2, 2.5]), 1, 0.5); });
        peep(r.pick([2, 4]) * BPB + 3, 0.45); peep(7 * BPB + 1, 0.4);
        push("insects", 0, 60, "swell", 1);
      } else if (kind === "I2") {
        spots([[0, 1], [2, 3]], [0.5, 2.5]).forEach((a) => bird(a, common(), 0.45));
        const a = r.pick([0, 1, 2]) * BPB + 1.5; croak(a, 1, 0.5); croak(a + 2, 0, 0.45);
      }

      const label = `${plan.label}${plan.round > 0 ? ` · round ${plan.round + 1}` : ""}${kind === "B" && odd ? " · vibes and strings" : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();

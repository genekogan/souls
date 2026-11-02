// Warehouse: Chicago acid house, 1988, 122 BPM in A minor (dorian), for the dancefloor.
// A 303 runs a sixteen-step pattern that someone keeps tweaking: every few bars a step flips, a note
// moves, an accent or slide appears, and the cutoff and resonance knobs ride long sweeps across each block.
// Around it: a swung 909/808 kit (clap, closed and open hats, ride, cowbell, toms, rim), a sine sub on the
// offbeats, and "chord memory" stabs: one quartal minor-eleventh shape moved in parallel under one finger.
// The arc is 18 blocks of 8 bars (about 4.7 minutes): jack, acid, chords, peak; a breakdown where the acid
// plays alone and climbs; the drop with the original pattern back; a second breakdown that climbs into
// D minor; and a half-step slide (Bbm11 -> Am11) home.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  // ---------- harmony (written in A; the D block transposes) ----------
  const H = {
    vamp: "| Am11 | Am11 | Am11 | Am11 | Am11 | Am11 | Am11 | Am11 |",
    lift: "| Am11 | Am11 | Am11 | Am11 | Am11 | Am11 | Cm11 | Dm11 |",
    shade: "| Am11 | Am11 | Am11 | Am11 | Fm11 | Gm11 | Am11 | Am11 |",
    jump: "| Am11 | Am11 | Cm11 | Am11 | Am11 | Am11 | Dm11 | Cm11 |",
    walk: "| Am11 | Gm11 | Fm11 | Gm11 | Am11 | Gm11 | Fm11 | Em11 |",
    climb: "| Am11 | Am11 | Cm11 | Cm11 | Dm11 | Dm11 | Em11 | Em11 |",
    climbD: "| Am11 | Am11 | Cm11 | Cm11 | Em11 | Em11 | Gm11 | Gm11 |",
    dvamp: "| Dm11 | Dm11 | Dm11 | Dm11 | Dm11 | Dm11 | Fm11 | Gm11 |",
    dwalk: "| Dm11 | Dm11 | Fm11 | Dm11 | Dm11 | Dm11 | Gm11 | Fm11 |",
    home: "| Dm11 | Dm11 | Cm11 | Cm11 | Bbm11 | Bbm11 | Bbm11 | Bbm11 |",
  };
  // Transposition (semitones from A) of each chord root for the acid line and the stabs. Climbs go up.
  const trOf = (pc) => { const t = mod12(pc - 9); return t > 7 ? t - 12 : t; };
  const CLIMB_TR = { climb: [0, 0, 3, 3, 5, 5, 7, 7], climbD: [0, 0, 3, 3, 7, 7, 10, 10] };

  // Chord memory: one quartal minor-eleventh shape (root, 11, b7, b3, 5) under every chord.
  const SHAPE = [0, 5, 10, 15, 19];
  // Stab rhythms (beats in a bar), sequenced like a drum machine track.
  const STABS = {
    off: [0.5, 1.5, 2.5, 3.5],
    chicago: [0, 0.75, 1.5, 2.5, 3.25],
    push: [0.75, 1.5, 2.75, 3.5],
    sparse: [0, 1.75, 3],
    skip: [0.5, 1.25, 2, 2.75, 3.5],
  };

  // ---------- the arc: 18 blocks of 8 bars ----------
  // cut: 303 cutoff [start, end] (exponential) or wave: [lo, hi] (down and back up); q resonance; env/dec the
  // envelope knobs; mut: bars between tweaks. Drums: kick clap hats ("16", "8", "off") oh ride cb toms rim.
  const PLAN = [
    { name: "Jack", d: "drums and a closed 303", h: "vamp", cut: [190, 260], q: 9, env: 3.4, dec: 0.2, mut: 4, kick: 1, clap: "late", hats: "16", oh: "late", acid: 1 },
    { name: "Acid", d: "turning the knob", h: "vamp", cut: [260, 480], q: 9.5, env: 3.3, dec: 0.22, mut: 2, kick: 1, clap: 1, hats: "16", oh: 1, sub: 1, acid: 1, fill: "clap" },
    { name: "Chord memory", d: "stabs in", h: "lift", cut: [480, 760], q: 9.5, env: 3.2, dec: 0.24, mut: 4, kick: 1, clap: 1, hats: "16", oh: 1, cb: 1, sub: 1, acid: 1, stab: "chicago", fill: "toms" },
    { name: "Opening up", d: "resonance rising", h: "shade", cut: [760, 1700], q: 10.3, env: 3, dec: 0.26, mut: 2, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, sub: 1, acid: 1, stab: "chicago", fill: "roll" },
    { name: "Squelch", d: "full tilt", h: "jump", wave: [1300, 3200], q: 10.9, env: 2.6, dec: 0.3, mut: 1, crash: 1, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, toms: 1, sub: 1, acid: 1, stab: "push", fill: "toms" },
    { name: "Breakdown", d: "the acid alone, climbing", h: "climb", climb: 1, cut: [380, 2400], q: 11.2, env: 2.8, dec: 0.36, mut: 1, acid: 1, roll: 1, fill: "gasp" },
    { name: "Drop", d: "the first pattern comes back", h: "vamp", home: 1, cut: [2600, 650], q: 10, env: 3.1, dec: 0.26, mut: 4, crash: 1, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, sub: 1, acid: 1, stab: "off", fill: "clap" },
    { name: "Jack", d: "drums and acid, tweaked every bar", h: "vamp", newPat: 1, cut: [650, 1300], q: 10, env: 3.2, dec: 0.24, mut: 1, kick: 1, jackKick: 1, clap: 1, hats: "8", oh: 1, cb: 1, toms: 1, rim: 1, sub: 1, acid: 1, fill: "toms" },
    { name: "Chord memory", d: "walking down", h: "walk", wave: [900, 2000], q: 10, env: 3, dec: 0.26, mut: 2, kick: 1, clap: 1, hats: "16", oh: 1, cb: 1, sub: 1, acid: 1, stab: "skip", fill: "roll" },
    { name: "Peak", d: "everything", h: "jump", wave: [1600, 3600], q: 11.2, env: 2.5, dec: 0.32, mut: 1, crash: 1, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, toms: 1, rim: 1, sub: 1, acid: 1, stab: "chicago", fill: "toms" },
    { name: "Breakdown", d: "climbing out of the key", h: "climbD", climb: 1, cut: [420, 2800], q: 11.5, env: 2.8, dec: 0.38, mut: 1, acid: 1, roll: 1, pad: 1, fill: "gasp" },
    { name: "Drop", d: "D minor", h: "dvamp", key: 5, cut: [2400, 900], q: 10.3, env: 3, dec: 0.26, mut: 2, crash: 1, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, sub: 1, acid: 1, stab: "chicago", fill: "clap" },
    { name: "Chord memory", d: "D minor", h: "dwalk", key: 5, wave: [900, 2200], q: 10.6, env: 2.9, dec: 0.28, mut: 2, kick: 1, clap: 1, hats: "16", oh: 1, cb: 1, sub: 1, acid: 1, stab: "push", fill: "toms" },
    { name: "Jack", d: "D minor, toms", h: "dvamp", key: 5, newPat: 1, cut: [1200, 700], q: 10, env: 3.2, dec: 0.24, mut: 1, kick: 1, jackKick: 1, clap: 1, hats: "8", oh: 1, cb: 1, toms: 1, rim: 1, sub: 1, acid: 1, fill: "roll" },
    { name: "Way home", d: "sliding down to A", h: "home", cut: [700, 260], q: 10.6, env: 3.4, dec: 0.3, mut: 2, kick: 1, clap: 1, hats: "off", sub: 1, acid: 1, stab: "sparse", pad: 1, fill: "stop" },
    { name: "Home", d: "the first pattern", h: "vamp", home: 1, cut: [260, 900], q: 9.8, env: 3.3, dec: 0.24, mut: 2, crash: 1, kick: 1, clap: 1, hats: "16", oh: 1, cb: 1, sub: 1, acid: 1, stab: "off", fill: "clap" },
    { name: "Peak", d: "last time round", h: "walk", wave: [1500, 3400], q: 10.9, env: 2.6, dec: 0.3, mut: 1, kick: 1, clap: 1, hats: "16", oh: 1, ride: 1, cb: 1, toms: 1, rim: 1, sub: 1, acid: 1, stab: "chicago", fill: "toms" },
    { name: "Knob down", d: "closing the filter", h: "lift", cut: [2400, 210], q: 9.5, env: 3.4, dec: 0.22, mut: 2, kick: 1, clap: 1, hats: "16", oh: 1, cb: 1, sub: 1, acid: 1, stab: "sparse", stabTo: 4, fill: "roll" },
  ];

  // 303 note pool, semitones from the root: [degree, weight]. Strong steps lean on root, octave and fifth.
  const DEG = [[0, 3], [12, 3], [3, 1.5], [7, 2], [10, 2], [-2, 1.5], [5, 1], [15, 1.2], [-5, 1.5], [2, 0.6]];
  const DEG_STRONG = [[0, 6], [12, 2], [7, 1.5], [-5, 1], [10, 1], [3, 1]];

  function newPattern(r) {
    const steps = [];
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      steps.push({
        on: i === 0 || (strong ? r.chance(0.85) : r.chance(i % 2 ? 0.5 : 0.68)),
        deg: i === 0 ? 0 : r.weighted(strong ? DEG_STRONG : DEG),
        acc: r.chance(strong ? 0.38 : 0.16),
        slide: false,
      });
    }
    // it has to go somewhere: at least two high notes, accented, off the beat
    for (let tries = 0; tries < 12 && steps.filter((x) => x.on && x.deg >= 10).length < 2; tries++) {
      const i = r.pick([2, 3, 6, 7, 10, 11, 14]);
      Object.assign(steps[i], { on: true, deg: r.pick([12, 12, 15, 10]), acc: true });
    }
    for (let n = r.int(2, 3), tries = 0; n > 0 && tries < 20; tries++) { // a few slides between notes that are both on
      const i = r.int(1, 15);
      if (steps[i].on && steps[i - 1].on && steps[i].deg !== steps[i - 1].deg) { steps[i].slide = true; n--; }
    }
    return steps;
  }
  /** The tweak: flip a gate, move a note, toggle an accent or a slide. */
  function mutate(steps, r, n) {
    const s = steps.map((x) => ({ ...x }));
    for (let k = 0; k < n; k++) {
      const i = r.int(1, 15), x = s[i];
      const op = r.weighted([["gate", 3], ["note", 3], ["acc", 2], ["slide", 1.5]]);
      if (op === "gate") { x.on = !x.on; if (!x.on) x.slide = false; if (i < 15 && !x.on) s[i + 1].slide = false; }
      else if (op === "note") x.deg = r.weighted(i % 4 === 0 ? DEG_STRONG : DEG);
      else if (op === "acc") x.acc = !x.acc;
      else if (s[i - 1].on && x.on) x.slide = !x.slide;
      if (x.slide && s[i - 1].deg === x.deg) x.slide = false;
    }
    return s;
  }

  const nm = (pc) => T.NAMES[mod12(pc)];
  const tsym = (sym, k) => (!k ? sym : sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)));

  Sim.register({
    id: "warehouse",
    title: "Warehouse",
    genre: "Acid house",
    about: "Chicago acid house in A minor at 122 BPM: a squelching 303 pattern that mutates every few bars under long cutoff and resonance sweeps, a swung 909/808 kit with cowbell and toms, parallel minor-eleventh chord-memory stabs, and breakdowns where the acid climbs alone.",
    situations: ["party"],
    energy: 0.9,
    bpm: 122, swing: 0.56, swingUnit: 0.25, beatsPerBar: 4, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 300, highcut: 6500 }); // the warehouse
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.38, highcut: 2800, pingPong: true });

      const acidOpts = { volume: 0, cutoff: 190, resonance: 9, envMod: 3.4, decay: 0.2, drive: 0.32 };
      const acid = I.acid(ctx, acidOpts);
      const ap = I.place(ctx, acid, 0.03, out);
      I.send(ctx, ap, echo, -17); I.send(ctx, ap, room, -20);

      const stab = I.pluck(ctx, { volume: -7, wave: "sawtooth", cutoff: 520, octaves: 3.4, decay: 0.28, filterDecay: 0.16, resonance: 2.5, release: 0.18 });
      const sp = I.place(ctx, stab, -0.2, out);
      I.send(ctx, sp, echo, -10); I.send(ctx, sp, room, -13);
      const pad = I.pad(ctx, { volume: -15, cutoff: 900, attack: 1.4, release: 2.5, detune: 18 });
      const pp = I.place(ctx, pad, 0.2, out);
      I.send(ctx, pp, room, -10);

      const sub = I.sub(ctx, { volume: -6, attack: 0.008, release: 0.08 });
      I.place(ctx, sub, 0, out);

      const grit = ctx.keep(new Tone.Distortion({ distortion: 0.18, oversample: "2x", wet: 0.22 })).connect(out);
      const kit = I.kit(ctx, { volume: -1, preload: ["kick909", "clap", "hat808", "hat808Open", "ride", "cowbell", "tom", "rim", "snare808", "crash"] });
      const kp = I.place(ctx, kit, 0, grit);
      I.send(ctx, kp, room, -18);

      return {
        acid: {
          layer: "melody", humanize: { timing: 0.002, vel: 0.03 },
          play(t, e, d) {
            // the knobs: envelope mod and decay are read on every note; the cutoff moves note by note
            acidOpts.envMod = e.env ?? 3; acidOpts.decay = e.dec ?? 0.22;
            const cut = Math.max(120, Math.min(5000, e.cut || 300));
            if (e.slide) acidOpts.cutoff = cut; else acid.sweep(t, cut, 0.01);
            if (e.q) { acid.filter.Q.cancelAndHoldAtTime(t); acid.filter.Q.linearRampToValueAtTime(e.q, t + 1.5); }
            acid.play(t, e.note, d, e.vel, { slide: !!e.slide, accent: !!e.accent });
          },
        },
        stabs: { layer: "harmony", play: (t, e, d) => stab.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.04 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        sub: { layer: "bass", play: (t, e, d) => sub.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.03 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.002, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const N = PLAN.length;
      const idx = cycle < N ? cycle : 1 + ((cycle - N) % (N - 1));
      const round = cycle < N ? 0 : 1 + Math.floor((cycle - N) / (N - 1));
      const P = PLAN[idx], k = P.key || 0;

      const harmony = T.progression(H[P.h]).map((h) => ({ ...h, chord: tsym(h.chord, k) }));
      const trBar = Array.from({ length: 8 }, (_, bar) => (P.climb ? CLIMB_TR[P.h][bar] : trOf(T.chord(harmony.find((h) => h.bar === bar).chord).root)));

      const ev = [];
      const stop = P.fill === "stop" ? 31 : P.fill === "gasp" ? 31.5 : 32; // the band cuts out here
      const push = (track, abs, dur, note, vel, extra) => {
        if (abs >= stop - 1e-6 && track !== "drums") return;
        dur = Math.min(dur, 32 - abs - 0.02);
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };

      // ---- the 303 ----
      if (!state.pat) { state.pat = newPattern(r); state.home = state.pat; }
      if (P.home) state.pat = mutate(state.home, r, round > 0 ? 1 : 0);
      if (P.newPat) state.pat = round % 2 ? mutate(state.home, r, 4) : newPattern(r);
      const cutAt = (u) => {
        if (P.wave) { const [lo, hi] = P.wave; return lo * Math.pow(hi / lo, 0.5 + 0.5 * Math.cos(2 * Math.PI * u)); }
        const [a, b] = P.cut; return a * Math.pow(b / a, u);
      };
      if (P.acid) for (let bar = 0; bar < 8; bar++) {
        if (bar > 0 && bar % P.mut === 0) state.pat = mutate(state.pat, r, r.chance(0.3) ? 2 : 1);
        let steps = state.pat;
        // phrase ends: a turnaround in the last four steps, then back to the pattern
        if (bar % 4 === 3 && !P.climb && r.chance(0.55)) {
          steps = steps.map((x, i) => (i < 12 ? x : { ...x, on: i !== 13 || x.on, deg: i === 15 ? r.pick([12, 10, 7]) : x.deg, acc: i === 14 || i === 15 ? true : x.acc, slide: i === 15 && steps[14].on }));
        }
        const B = bar * 4, base = 45 + trBar[bar];
        steps.forEach((s, i) => {
          if (!s.on) return;
          const at = B + i / 4;
          const nx = steps[i + 1];
          const legato = i < 15 && nx && nx.on && nx.slide;
          const note = Math.max(33, Math.min(74, base + s.deg));
          const u = at / 32;
          const extra = { cut: Math.round(cutAt(u) * (s.acc ? 1.1 : 1)), env: P.env, dec: P.dec, slide: s.slide && i > 0, accent: s.acc };
          if (i === 0 && bar % 2 === 0) extra.q = P.q;
          push("acid", at, legato ? 0.29 : 0.14, note, s.acc ? 0.95 : 0.74, extra);
        });
      }

      // ---- chord memory stabs and pad ----
      const shapeAt = (bar) => SHAPE.map((x) => 57 + trBar[bar] + x);
      if (P.stab) {
        const pat = STABS[P.stab];
        for (let bar = 0; bar < 8; bar++) {
          if (P.stabTo && bar >= P.stabTo) break;
          const v = shapeAt(bar);
          let hits = pat;
          if (bar % 4 === 3 && r.chance(0.5)) hits = pat.filter((p) => p < 3).concat([3.25, 3.75]); // the answer at the phrase end
          hits.forEach((p, i) => push("stabs", bar * 4 + p, 0.2, v, 0.6 + (i === 0 ? 0.06 : 0) + r.gauss(0.02)));
        }
      }
      if (P.pad) {
        for (let bar = 0; bar < 8; bar += 2) {
          if (P.climb && bar < 4) continue; // the acid really is alone at first
          const v = shapeAt(bar).slice(0, 4);
          push("pad", bar * 4, 7.8, v, P.climb ? 0.36 : 0.32);
        }
      }

      // ---- sub: offbeat pulses on the root ----
      if (P.sub) for (let bar = 0; bar < 8; bar++) {
        const root = 33 + trBar[bar];
        for (let q = 0; q < 4; q++) push("sub", bar * 4 + q + 0.5, 0.32, root, 0.74);
      }

      // ---- drums ----
      const D = (abs, voice, vel, extra) => { if (abs < stop - 1e-6 || voice === "crash") push("drums", abs, 0.1, voice, Math.min(1, vel), extra); };
      const CB = [[0, 0.75, 1.5, 2.5, 3.25], [0.75, 1.5, 2.25, 3.5]][round % 2 === 0 && idx < 9 ? 0 : 1];
      const TOMS = [[1.75, 50, 0.42], [2.5, 45, 0.48], [3.25, 52, 0.4]];
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4, last = bar === 7, fill = last ? P.fill : null;
        const yieldAt = fill === "toms" || fill === "roll" ? 3 : 4;
        if (P.crash && bar === 0) D(0, "crash", 0.6);
        if (P.kick) {
          for (let q = 0; q < 4; q++) D(B + q, "kick909", q === 0 ? 0.96 : 0.9);
          if (P.jackKick && bar % 2 === 1) D(B + r.pick([2.75, 3.75]), "kick909", 0.62);
        }
        if (P.clap === 1 || (P.clap === "late" && bar >= 4)) { D(B + 1, "clap", 0.7 + r.gauss(0.02)); if (yieldAt > 3) D(B + 3, "clap", 0.74 + r.gauss(0.02)); }
        if (P.hats) for (let s = 0; s < 16; s++) {
          const p = s / 4;
          if (p >= yieldAt) break;
          const off8 = s % 4 === 2;
          if (P.hats === "16") { if (s % 4 === 1 && r.chance(0.18)) continue; if (off8 && (P.oh === 1 || (P.oh === "late" && bar >= 4))) continue; D(B + p, "hat808", (off8 ? 0.5 : s % 2 ? 0.26 : 0.36) + r.gauss(0.03)); }
          else if (P.hats === "8") { if (s % 2) continue; if (off8 && P.oh) continue; D(B + p, "hat808", (off8 ? 0.5 : 0.34) + r.gauss(0.03)); }
          else if (P.hats === "off" && off8) D(B + p, "hat808", 0.48 + r.gauss(0.03));
        }
        if (P.oh === 1 || (P.oh === "late" && bar >= 4)) for (let q = 0; q < 4; q++) if (q + 0.5 < yieldAt) D(B + q + 0.5, "hat808Open", 0.4 + r.gauss(0.03), { len: 0.22 });
        if (P.ride) for (let q = 0; q < 4; q++) if (q < yieldAt) D(B + q, "ride", q % 2 ? 0.42 : 0.5);
        if (P.cb) CB.forEach((p, i) => { if (p < yieldAt) D(B + p, "cowbell", (i === 0 ? 0.5 : 0.4) + r.gauss(0.03)); });
        if (P.toms && bar % 2 === 1) TOMS.forEach(([p, pitch, v]) => { if (p < yieldAt) D(B + p, "tom", v, { pitch }); });
        if (P.rim) [0.75, 2.25, 3.75].forEach((p) => { if (p < yieldAt && r.chance(0.8)) D(B + p, "rim", 0.3 + r.gauss(0.03)); });
        // breakdown: snare roll and the kick coming back in the last two bars
        if (P.roll) {
          if (bar >= 4) {
            const step = bar < 6 ? 1 : bar === 6 ? 0.5 : 0.25;
            for (let p = 0; p < 4; p += step) { const u = (B + p - 16) / 16; D(B + p, "snare808", 0.2 + 0.6 * u * u); }
          }
          if (bar >= 6) for (let q = 0; q < 4; q++) D(B + q, "kick909", 0.72 + (bar - 6) * 0.12);
        }
        // fills
        if (fill === "clap") { D(B + 3.5, "clap", 0.5); D(B + 3.75, "clap", 0.64); }
        else if (fill === "toms") [[3, 55, 0.5], [3.25, 52, 0.55], [3.5, 47, 0.6], [3.75, 43, 0.66]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch }));
        else if (fill === "roll") [3, 3.25, 3.5, 3.75].forEach((p, i) => D(B + p, "snare808", 0.36 + i * 0.1));
      }
      if (P.fill === "stop") push("drums", 31.5, 0.1, "clap", 0.8);

      return { events: ev, harmony, section: `${P.name} · ${P.d}`, state };
    },
  });
})();

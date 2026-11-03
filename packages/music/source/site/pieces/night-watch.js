// Night Watch: stealth suspense for sneaking past the guards.
//
// The pulse: a dark analog ostinato on a low E pedal in sixteenths, accented 3+3+2 | 3+3+2, with a sub-bass
// doubling the downbeats and a ghosted upper neighbour (the b2, the leading tone, the minor third) in each
// "2" group. Under it a bass-drum heartbeat (lub-dub) that beats once a bar while you are hidden, twice,
// then on every beat as the guard comes close. Over it a ticking layer in a different metre: woodblock and
// kachi play groups of 7 sixteenths (2+2+3) four times and a 4 to fill two bars, so the clicks slide against
// the ostinato and realign every other downbeat; a shaker keeps the 3+3+2 sixteenths; a rim answers in the
// "2" groups.
//
// The theme is a tiptoe for pizzicato: B C B Bb B, a semitone neighbour each side, then E F E (the
// Phrygian b2). It is restated over the b2 chord (Fmaj7#11 over the E pedal), where the F that rubbed
// becomes the root, and over a tritone chord (Bbmaj7#11/E, where the pedal E is the #11). Low strings hold
// close clusters that swell slowly; a clarinet in the chalumeau answers the pizzicato.
// Nothing cadences on a bare tonic: phrases end on the 9th, the #11 or the b2.
//
// Alert: the drums come in (taiko on 1 and 3, kick in the 3+3+2, toms on the "2"s, snare backbeat, crash),
// the ostinato doubles at the octave, the strings chug the 3+3+2 and synth brass turn the tiptoe cell
// into an alarm, all a little faster. The second alert lurches up a semitone, then stop-hits and
// silence. Search: the ostinato thins to eighths and the harmony wanders down by thirds (Am9 F Dm Bb, then
// the same a step lower) while a sonar ping sounds and the clarinet asks questions; the heartbeat slows
// and the stealth music returns. Every other round the close call is a false alarm: the build collapses
// into a held breath (ostinato stopped, heartbeat slowing) and the sneaking resumes before the alert.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- chords: progressions are written in E and transposed by `key` ----------
  function trSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m) throw new Error(`night-watch: bad chord ${sym}`);
    const nm = (p) => T.NAMES[mod12(T.PC[p] + k)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }
  const progOf = (text, k = 0) => T.progression(text.replace(/[A-G][#b]?[^\s|]*/g, (tok) => trSym(tok, k)), BPB);

  const PROG = {
    INTRO: "| Em9b13 | % | % | % | Fmaj7#11/E | % | Em9b13 | % |",
    SNEAK_A: "| Em9b13 | % | Fmaj7#11/E | % | Em9b13 | % | Bbmaj7#11/E | EmMaj9 |",
    SNEAK_B: "| Cmaj7#11/E | % | EmMaj9 | % | Am9/E | % | Bbmaj7#11/E | B7b9/D# |",
    SNEAK_C: "| Em9b13 | % | Em7b5 | % | Fmaj7#11/E | % | Em9b13 | B7b9 |",
    BUILD: "| Em9b13 | Fmaj7#11/E | Em9b13 | Fmaj7#11/E | Cmaj7#11/E | % | Bbmaj7#11/E | B7b9 |",
    ALERT: "| Em9b13 | Cmaj7#11 | Em9b13 | Bbmaj7#11 | Em9b13 | Cmaj7#11 | Am9 | B7b9 |",
    HOLD: "| Em9b13 | % | Fmaj7#11/E | % | Em9b13 | % | EmMaj9 | B7b9 |",
    SEARCH_1: "| Am9 | % | Fmaj7#11 | % | Dm9 | % | Bbmaj7#11 | % |",
    SEARCH_2: "| Gm9 | % | Ebmaj7#11 | % | Cm9 | % | B7b9 | % |",
  };

  // ---------- notation: one string per bar, "note/beats", r = rest, a trailing c = deliberate chromatic ----------
  function bars(list, k = 0) {
    const out = [];
    list.forEach((s, i) => {
      if (s == null) return;
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(c?)$/.exec(tok);
        if (!m) throw new Error(`night-watch: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: i * BPB + b, dur, note: T.midi(m[1]) + k, chrom: !!m[3] });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`night-watch: bar ${i + 1} sums to ${b}: ${s}`);
    });
    return out;
  }

  // The tiptoe theme (pizzicato), over SNEAK_A.
  const PIZZ_A = bars([
    "B3/0.5 r/0.5 C4/0.5 r/0.5 B3/0.25 r/0.25 Bb3/0.25c r/0.25 B3/0.5 r/0.5",
    "r/2 E4/0.5 r/0.25 F4/0.25c E4/0.5 r/0.5",
    "A3/0.5 r/0.5 B3/0.5 r/0.5 A3/0.25 r/0.25 G#3/0.25c r/0.25 A3/0.5 r/0.5",
    "r/2 E4/0.5 r/0.25 F4/0.25 E4/0.5 r/0.5",
    "G4/0.5 r/0.25 F#4/0.25 E4/0.5 r/0.5 D#4/0.5c r/0.5 E4/0.5 r/0.5",
    "r/1 B3/0.25 C4/0.25 B3/0.5 r/0.5 G3/0.5 r/1",
    "E4/0.5 r/0.5 Bb3/0.5 r/0.5 D4/0.5 r/0.5 A3/0.5 r/0.5",
    "D#4/1 r/0.5 B3/0.5 F#4/0.5 r/1.5",
  ]);
  // SNEAK_B: clarinet calls (bars 1-2, 5-6), pizzicato answers (3-4, 7-8).
  const CLAR_B = bars([
    "E3/1.5 F#3/0.5 G3/1 B3/1",
    "A3/1.5 G3/0.5 F#3/2",
    null, null,
    "C4/1.5 B3/0.5 A3/1 E3/1",
    "B3/1.5 C4/0.5 F#3/2",
  ]);
  const PIZZ_B = bars([
    null, null,
    "D#4/0.5 r/0.5 E4/0.5 r/0.5 D#4/0.25 r/0.25 D4/0.25c r/0.25 D#4/0.5 r/0.5",
    "r/2 B3/0.5 r/0.25 C4/0.25c B3/0.5 r/0.5",
    null, null,
    "E4/0.5 r/0.5 Bb3/0.5 r/0.5 D4/0.5 r/0.5 A3/0.5 r/0.5",
    "C4/0.5 r/0.25 B3/0.25 A3/0.5 r/0.5 F#3/0.5 r/0.5 D#4/0.5 r/0.5",
  ]);
  // SNEAK_C: the theme displaced by an eighth, then over the half-diminished chord; pizz in octaves.
  const PIZZ_C = bars([
    "r/0.5 B3/0.5 r/0.5 C4/0.5 r/0.5 B3/0.25 r/0.25 Bb3/0.25c r/0.25 B3/0.5",
    "r/0.5 r/2 E4/0.5 r/0.25 F4/0.25c E4/0.5",
    "Bb3/0.5 r/0.5 A3/0.5 r/0.5 Bb3/0.25 r/0.25 B3/0.25c r/0.25 Bb3/0.5 r/0.5",
    "r/2 G4/0.5 r/0.25 F4/0.25 E4/0.5 r/0.5",
    "C4/0.5 r/0.5 B3/0.5 r/0.5 E4/0.5 r/0.5 F4/0.5 r/0.5",
    "A4/1 r/0.5 G4/0.5 E4/1 r/1",
    "G4/0.5 r/0.25 F#4/0.25 E4/0.5 r/0.5 D#4/0.5c r/0.5 E4/0.5 r/0.5",
    "F4/0.5 r/0.5 D#4/0.5 r/0.5 C4/0.5 r/0.5 A3/0.5 r/0.5",
  ]);
  const CLAR_C = bars(["G3/4", "G3/4", "D3/4", "D3/4", "E3/4", "E3/4", "G3/4", "F#3/3.5 r/0.5"]);
  // The alarm: the tiptoe cell (B C B) in 3+3+2, synth brass in octaves. Transposed with the alert's key.
  const BRASS_TEXT = [
    "B4/0.75 C5/0.75 B4/0.5 E4/2",
    "B4/0.75 C5/0.75 B4/0.5 F#4/2",
    "B4/0.75 C5/0.75 D5/0.5 E5/1 D5/1",
    "E5/0.75 D5/0.75 Bb4/0.5 A4/2",
    "G4/0.75 F#4/0.75 E4/0.5 B4/2",
    "C5/0.75 D5/0.75 E5/0.5 F#5/2",
    "G5/0.75 E5/0.75 C5/0.5 B4/2",
    "C5/0.75 B4/0.75 A4/0.5 D#4/1 F#4/1",
  ];
  // Search: the clarinet's questions; the second search is the first a whole step lower (a real sequence).
  const CLAR_S1_TEXT = [
    "r/1 E3/0.5 A3/0.5 B3/1.5 C4/0.5", "B3/2 r/2",
    "r/1 A3/0.5 C4/0.5 E4/1 B3/1", "r/4",
    "r/1 F3/0.5 A3/0.5 C4/1.5 E4/0.5", "E4/2 r/2",
    "r/1 D4/0.5 E4/0.5 F4/1.5 A4/0.5", "E4/3 r/1",
  ];
  const CLAR_S1 = bars(CLAR_S1_TEXT);
  const CLAR_S2 = bars(CLAR_S1_TEXT.slice(0, 6), -2).concat(bars([null, null, null, null, null, null, "r/1 F#3/0.5 A3/0.5 C4/1.5 B3/0.5", "D#4/3 r/1"]));
  const HOLD_CLAR = bars([null, null, "E3/4", "F3/3.5c r/0.5"]);

  // ---------- form ----------
  const S = {
    intro: { prog: "INTRO", kind: "intro", tempo: 92, label: "Infiltration · heartbeat and ostinato" },
    sneakA: { prog: "SNEAK_A", kind: "sneak", tempo: 92, label: "Sneaking · pizzicato footsteps" },
    sneakB: { prog: "SNEAK_B", kind: "sneak", tempo: 92, label: "Sneaking · clarinet in the shadows" },
    sneakC: { prog: "SNEAK_C", kind: "sneak", tempo: 92, label: "Sneaking · the guard turns" },
    build: { prog: "BUILD", kind: "build", tempo: 97, ramp: 32, label: "Close call · heartbeat racing" },
    hold: { prog: "HOLD", kind: "hold", tempo: 92, ramp: 24, label: "False alarm · hold your breath" },
    alert1: { prog: "ALERT", kind: "alert", tempo: 100, ramp: 2, label: "Alert! · full drums, the ostinato doubles" },
    alert2: { prog: "ALERT", kind: "alert", second: true, tempo: 102, ramp: 4, label: "Alert! · lurching up" },
    search1: { prog: "SEARCH_1", kind: "search", tempo: 95, ramp: 16, label: "Search · descending thirds, sonar" },
    search2: { prog: "SEARCH_2", kind: "search", second: true, tempo: 92, ramp: 24, label: "Search · the trail goes cold" },
  };
  const ROUNDS = [
    ["sneakA", "sneakB", "sneakC", "build", "alert1", "alert2", "search1", "search2"],
    ["sneakA", "sneakB", "build", "hold", "sneakC", "build", "alert1", "alert2", "search1", "search2"],
  ];
  function planAt(cycle) {
    if (cycle === 0) return { id: "intro", round: 0, ...S.intro, key: 0 };
    let k = cycle - 1, round = 0;
    while (k >= ROUNDS[round % 2].length) { k -= ROUNDS[round % 2].length; round++; }
    const list = ROUNDS[round % 2], id = list[k];
    const p = { id, round, idx: k, ...S[id], key: 0 };
    if (id === "alert2") p.key = round % 2 ? 3 : 1; // up a semitone, or (odd rounds) a minor third
    if (id === "build") p.toHold = list[k + 1] === "hold";
    return p;
  }

  // ---------- helpers ----------
  /** Keep a written note if it belongs to the chord (or is marked chromatic); else nudge it a semitone. */
  function fit(m, sym, chrom, prev) {
    if (chrom) return m;
    const c = T.chord(sym), set = new Set(c.scale.concat(c.pcs, [c.bass]));
    if (set.has(mod12(m))) return m;
    for (const x of [m - 1, m + 1]) if (set.has(mod12(x)) && x !== prev) return x;
    return T.nearest(m, c.pcs);
  }
  const ACC = new Set([0, 3, 6, 8, 11, 14]); // 3+3+2 | 3+3+2 in sixteenths

  /** A tense, close string voicing: the chord's guide tones and colors packed into a small span. */
  function cluster(sym, prev, lo, hi, top, n, r) {
    return T.voice(sym, { lo, hi, n, spread: "close", prev, top, rng: r, omitBass: true });
  }

  // ---------- custom instruments ----------
  /** Night air: pink noise through a slowly wandering band-pass, faded in and out per section. */
  function nightAir(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 520, Q: 0.9 })).connect(g);
    const lfo = ctx.keep(new Tone.LFO({ frequency: 0.045, min: 280, max: 950 }).start());
    lfo.connect(bp.frequency);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(bp);
    return {
      out: g,
      play(t, e, d) {
        const lvl = db(-26) * Math.max(0, Math.min(1, Number.isFinite(e.vel) ? e.vel : 0));
        g.gain.cancelAndHoldAtTime(t);
        g.gain.linearRampToValueAtTime(lvl, t + d * 0.35);
        g.gain.linearRampToValueAtTime(lvl, t + d * 0.75);
        g.gain.linearRampToValueAtTime(0, t + d);
      },
    };
  }

  Sim.register({
    id: "night-watch",
    title: "Night Watch",
    genre: "Stealth suspense",
    about: "Sneaking past the guards in E minor: a 3+3+2 analog ostinato on a low pedal, a bass-drum heartbeat that quickens, woodblock and kachi ticking in sevens against it, a pizzicato tiptoe theme over Phrygian and tritone chords, then an alert with taiko, toms and brass, a search that wanders down by thirds, and the return to the shadows.",
    situations: ["mystery", "fight"],
    energy: 0.5,
    bpm: 92, beatsPerBar: BPB, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 4.8, preDelay: 0.03, lowcut: 260, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.01, lowcut: 200, highcut: 7000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.38, highcut: 3800, pingPong: true });

      const ost = I.analog(ctx, { volume: -5, wave: "sawtooth", base: 130, octaves: 2.6, resonance: 5, filterDecay: 0.11, decay: 0.16, sustain: 0.1, release: 0.08 });
      const ost2 = I.analog(ctx, { volume: -14, wave: "square", base: 320, octaves: 2.4, resonance: 3, filterDecay: 0.08, decay: 0.12, sustain: 0.05, release: 0.06 });
      const sub = I.sub(ctx, { volume: -7, attack: 0.01, release: 0.2 });
      const strings = I.strings(ctx, { volume: -8, cutoff: 1500, attack: 1.9, release: 2.4 });
      const high = I.strings(ctx, { volume: -17, cutoff: 4200, attack: 2.6, release: 3 });
      const chugs = I.strings(ctx, { volume: -9, cutoff: 2600, attack: 0.012, release: 0.12 });
      const pizz = I.pizz(ctx, { volume: -1, cutoff: 2200, decay: 0.28 });
      const clar = I.clarinet(ctx, { volume: -3, cutoff: 2200, vibratoDepth: 0.012 });
      const brass = I.synthBrass(ctx, { volume: -5, attack: 0.04, swell: 0.12, base: 260, octaves: 3.2, release: 0.5 });
      const bell = I.bell(ctx, { volume: -19, decay: 4 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 31, preload: ["softKick", "kick", "rockSnare", "snare", "tom", "taiko", "crash", "hatClosed"] });
      const perc = I.kit(ctx, { volume: -3, preload: ["woodblock", "kachi", "shaker", "rim", "hatPedal"] });
      const air = nightAir(ctx, out);

      const op = I.place(ctx, ost, 0, out), o2 = I.place(ctx, ost2, 0.12, out);
      I.place(ctx, sub, 0, out);
      const sp = I.place(ctx, strings, -0.22, out), hp = I.place(ctx, high, 0.3, out), cp = I.place(ctx, chugs, 0.25, out);
      const pp = I.place(ctx, pizz, 0.32, out), clp = I.place(ctx, clar, -0.3, out), bp = I.place(ctx, brass, -0.05, out);
      const bl = I.place(ctx, bell, 0.45, out), kp = I.place(ctx, kit, 0, out), pc = I.place(ctx, perc, -0.3, out);
      I.send(ctx, op, room, -20); I.send(ctx, o2, echo, -22);
      I.send(ctx, sp, hall, -8); I.send(ctx, hp, hall, -4); I.send(ctx, cp, room, -14); I.send(ctx, cp, hall, -18);
      I.send(ctx, pp, hall, -10); I.send(ctx, pp, echo, -18); I.send(ctx, clp, hall, -9); I.send(ctx, bp, hall, -10);
      I.send(ctx, bl, hall, -3); I.send(ctx, bl, echo, -6);
      I.send(ctx, kp, room, -12); I.send(ctx, kp, hall, -20); I.send(ctx, pc, room, -10); I.send(ctx, pc, echo, -24);
      I.send(ctx, air.out, hall, -10);

      let lastBright = -1;
      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        ost: {
          layer: "bass", humanize: { timing: 0.002, vel: 0.04 },
          play(t, e, d) {
            const b = e.bright;
            if (Number.isFinite(b) && Math.abs(b - lastBright) > 0.01) { lastBright = b; ost.filterEnvelope.baseFrequency = 110 + 380 * Math.max(0, Math.min(1, b)); }
            ost.play(t, e.note, d, e.vel);
          },
        },
        ost2: { layer: "bass", play: pl(ost2), humanize: { timing: 0.002, vel: 0.04 } },
        sub: { layer: "bass", play: pl(sub), humanize: { timing: 0, vel: 0.02 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0.01, vel: 0.03 } },
        high: { layer: "harmony", play: pl(high), humanize: { timing: 0, vel: 0 } },
        chugs: { layer: "harmony", play: pl(chugs), humanize: { timing: 0.004, vel: 0.06 } },
        pizz: { layer: "melody", play: pl(pizz), humanize: { timing: 0.008, vel: 0.08 } },
        clar: { layer: "melody", play: pl(clar), humanize: { timing: 0.01, vel: 0.04 } },
        brass: { layer: "melody", play: pl(brass), humanize: { timing: 0.006, vel: 0.05 } },
        ping: { layer: "texture", play: pl(bell), humanize: { timing: 0, vel: 0.05 } },
        air: { layer: "texture", play: (t, e, d) => air.play(t, e, d), humanize: { timing: 0, vel: 0 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.08 } },
        perc: { layer: "drums", play: (t, e) => perc.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const K = plan.key;
      const prog = progOf(PROG[plan.prog], K);
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(Math.max(0, b)).chord;
      const spans = prog.map((h) => ({ sym: h.chord, start: h.bar * BPB + h.beat, dur: h.dur }));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const drum = (abs, voice, vel, pitch) => push("drums", abs, 0.25, voice, vel, pitch != null ? { pitch } : {});
      const tick = (abs, voice, vel, pitch) => push("perc", abs, 0.25, voice, vel, pitch != null ? { pitch } : {});
      const kind = plan.kind, odd = plan.round % 2 === 1;
      const lastOfSection = (b) => b === 7;

      // ================= ostinato (analog), its octave double and the sub =================
      const ostMode = (bar) => {
        if (kind === "intro") return bar < 4 ? "pedal" : "nb";
        if (kind === "sneak") return plan.id === "sneakC" ? "bounce" : "nb";
        if (kind === "build") return bar < 4 ? "bounce" : "double";
        if (kind === "alert") return plan.second && bar === 7 ? "stop" : "double";
        if (kind === "search") return "eighths";
        if (kind === "hold") return bar >= 6 ? "pedal" : null;
        return "nb";
      };
      const bright = kind === "alert" ? 0.75 : kind === "search" ? 0.05 : 0.14;
      for (let bar = 0; bar < 8; bar++) {
        const mode = ostMode(bar);
        if (!mode) continue;
        const sym = symAt(bar * BPB), c = T.chord(sym);
        const rn = T.nearest(40 + K, [c.bass], 36, 47);
        const up = T.step(rn, 1, c.scale), third = T.step(rn, 2, c.scale);
        const br = kind === "build" ? 0.15 + 0.07 * bar : bright;
        const sv = kind === "hold" ? 0.6 + 0.2 * (bar - 6) : 1;
        if (mode === "stop") { // alert ends: three hits in the 3+3+2, then silence
          [0, 3, 6].forEach((s, i) => { push("ost", bar * BPB + s / 4, 0.3, rn, 0.85, { bright: br }); push("ost2", bar * BPB + s / 4, 0.3, rn + 12, 0.6); push("sub", bar * BPB + s / 4, 0.6, rn - 12, 0.8 - i * 0.05); });
          continue;
        }
        for (let s = 0; s < 16; s++) {
          if (mode === "eighths" && s % 2) continue;
          const at = bar * BPB + s / 4;
          const acc = mode === "eighths" ? s === 0 || s === 6 || s === 12 : ACC.has(s);
          let note = rn, vel = acc ? 0.78 : s % 2 ? 0.3 : 0.36;
          if (mode !== "pedal") {
            if (s === 7 || (mode === "eighths" && s === 14)) { note = up; vel = 0.5; }
            if (s === 15) { note = [rn - 1, up, third, up][bar % 4]; vel = note === rn - 1 ? 0.4 : 0.46; } // the leading tone stays a ghost
            if ((mode === "bounce" || mode === "double") && (s === 2 || s === 10)) { note = rn + 12; vel = 0.42; }
          }
          push("ost", at, acc ? 0.3 : 0.2, note, vel * sv, { bright: br });
          if (mode === "double") push("ost2", at, 0.2, note + 12, (acc ? 0.62 : 0.34));
        }
        // sub: downbeats (every 3+3+2 accent when doubled)
        const subAt = mode === "double" ? [0, 3, 6, 8, 11, 14] : mode === "eighths" ? [0, 6] : [0, 8];
        subAt.forEach((s, i) => {
          const nextS = i + 1 < subAt.length ? subAt[i + 1] : 16;
          push("sub", bar * BPB + s / 4, (nextS - s) / 4 - 0.05, rn - 12, (s === 0 ? 0.75 : 0.6) * sv);
        });
      }

      // ================= heartbeat =================
      const heartRate = (bar) => {
        if (kind === "intro" || plan.id === "sneakA") return 1;
        if (plan.id === "sneakB") return bar >= 6 ? 2 : 1;
        if (plan.id === "sneakC") return 2;
        if (kind === "build") return bar < 4 ? 2 : 4;
        if (kind === "hold") return bar < 2 ? 4 : bar < 4 ? 2 : 1;
        if (kind === "search") return plan.second ? (bar < 4 ? 0 : 1) : 0;
        return 0;
      };
      for (let bar = 0; bar < 8; bar++) {
        const rate = heartRate(bar);
        if (!rate) continue;
        const gap = rate === 4 ? 0.25 : 0.5, lvl = rate === 4 ? 1.1 : 1;
        for (let b = 0; b < 4; b += 4 / rate) {
          drum(bar * BPB + b, "softKick", 0.7 * lvl);
          drum(bar * BPB + b + gap, "softKick", 0.45 * lvl);
        }
      }

      // ================= ticking percussion =================
      const SEVENS = [[0, 4], [7, 11], [14, 18], [21, 25], [28, 30]]; // woodblock, kachi (16ths over two bars)
      const ticksOn = (bar) => (kind === "intro" ? bar >= 4 : kind === "sneak" || kind === "build" ? true : kind === "hold" ? bar >= 6 : kind === "search" && plan.second ? bar >= 4 : kind === "alert");
      for (let bar = 0; bar < 8; bar += 2) {
        for (const [w, k] of SEVENS) {
          if (ticksOn(bar + Math.floor(w / 16)) && kind !== "alert") tick(bar * BPB + w / 4, "woodblock", w === 0 ? 0.42 : 0.32, w === 0 ? 82 : w === 28 ? 76 : 79);
          if (ticksOn(bar + Math.floor(k / 16))) tick(bar * BPB + k / 4, "kachi", kind === "alert" ? 0.36 : 0.26);
        }
      }
      for (let bar = 0; bar < 8; bar++) {
        // shaker: 3+3+2 sixteenths (eighths only at the start, and in the second search)
        const shk = kind === "intro" ? (bar >= 2 ? (bar >= 4 ? 16 : 8) : 0) : kind === "sneak" || kind === "build" || kind === "alert" ? 16 : kind === "search" && plan.second ? 8 : kind === "hold" && bar >= 6 ? 8 : 0;
        const lift = kind === "alert" ? 1.35 : kind === "build" ? 1 + bar * 0.04 : 1;
        if (shk) for (let s = 0; s < 16; s += 16 / shk) tick(bar * BPB + s / 4, "shaker", (ACC.has(s) ? 0.26 : 0.12) * lift);
        // rim in the "2" groups
        if ((plan.id === "sneakB" || plan.id === "sneakC" || kind === "build") && !(kind === "build" && bar >= 6)) [6, 14].forEach((s) => tick(bar * BPB + s / 4, "rim", 0.3));
        // pedal hat on 2 and 4 as the guard comes near
        if (plan.id === "sneakC" || (kind === "build" && bar < 6)) [1, 3].forEach((b) => tick(bar * BPB + b, "hatPedal", 0.34));
        // a small tick flourish at the end of a sneaking section
        if (kind === "sneak" && lastOfSection(bar) && r.chance(0.6)) [3.25, 3.5, 3.75].forEach((b, i) => tick(bar * BPB + b, i === 1 ? "woodblock" : "kachi", 0.3 + 0.05 * i, 82));
      }

      // ================= drums: build, alert, search =================
      const tp = 40 + K; // taiko tuned to the key's tonic (E2 in E)
      const toms = (sym) => { const c = T.chord(sym); return { lo: T.nearest(43, [c.root], 40, 47), mid: T.nearest(50, [mod12(c.root + 7)], 47, 54), hi: T.nearest(55, [c.root], 52, 59) }; };
      if (kind === "build") {
        for (let bar = 0; bar < 8; bar++) {
          if (bar >= 4 && bar < 6) drum(bar * BPB + 3.5, "tom", 0.3 + 0.08 * (bar - 4), toms(symAt(bar * BPB)).lo);
          if (bar === 6) for (let i = 0; i < 8; i++) drum(bar * BPB + i * 0.5, "snare", 0.12 + 0.03 * i);
          if (bar === 7) {
            if (plan.toHold) { for (let i = 0; i < 12; i++) drum(bar * BPB + i * 0.25, "snare", 0.32 + 0.03 * i); } // the roll is cut short: false alarm
            else {
              for (let i = 0; i < 8; i++) drum(bar * BPB + i * 0.25, "snare", 0.36 + 0.04 * i);
              const t = toms(symAt(bar * BPB));
              [t.hi, t.hi, t.mid, t.mid, t.lo, t.lo, t.lo, t.lo].forEach((p, i) => drum(bar * BPB + 2 + i * 0.25, "tom", 0.5 + 0.05 * i, p));
              drum(bar * BPB + 3.5, "taiko", 0.6, tp);
            }
          }
        }
      }
      if (kind === "alert") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, sym = symAt(B), t = toms(sym);
          if (plan.second && bar === 7) { // stop-hits
            [0, 0.75, 1.5].forEach((b, i) => { drum(B + b, "taiko", 0.9, tp); drum(B + b, "kick", 0.8); if (i === 2) drum(B + b, "rockSnare", 0.8); });
            drum(B, "crash", 0.7);
            continue;
          }
          const fill = bar === 3 || bar === 7;
          const big = plan.second && bar >= 4;
          if (bar === 0) drum(B, "crash", 0.75);
          if (bar === 4) drum(B, "crash", 0.55);
          drum(B, "taiko", 0.85, tp);
          if (!fill) drum(B + 2, "taiko", 0.62, tp);
          [[0, 0.8], [0.75, 0.58], [2, 0.74], [2.75, 0.55]].forEach(([b, v]) => { if (!fill || b < 2) drum(B + b, "kick", v); });
          if (big) [0.75, 1.5, 2.75, 3.5].forEach((b) => { if (!fill || b < 2) drum(B + b, "taiko", 0.48, tp); });
          drum(B + 1.5, "tom", 0.55, t.lo);
          if (!fill) drum(B + 3.5, "tom", 0.58, t.mid);
          drum(B + 1, "rockSnare", 0.78);
          if (!fill) drum(B + 3, "rockSnare", 0.8);
          [1.75, 2.5, 3.75].forEach((b) => { if ((!fill || b < 2) && r.chance(0.55)) drum(B + b, "snare", 0.12 + r.range(0, 0.07)); });
          for (let s = 0; s < 16; s += 2) if (!fill || s < 8) drum(B + s / 4, "hatClosed", s % 4 === 0 ? 0.34 : 0.22);
          if (fill) {
            [t.hi, t.hi, t.mid, t.mid, t.mid, t.lo, t.lo, t.lo].forEach((p, i) => drum(B + 2 + i * 0.25, "tom", 0.5 + 0.045 * i, p));
            drum(B + 3.5, "taiko", 0.75, tp);
          }
        }
      }
      if (kind === "search") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar % 2 === 0) drum(B, "taiko", plan.second ? 0.3 : 0.4, tp);
          if (bar % 2 === 1 && r.chance(0.7)) [0, 1.5, 3].forEach((b, i) => drum(B + b, "tom", 0.16 + 0.03 * i, toms(symAt(B)).lo));
        }
      }
      if (kind === "hold") drum(0, "taiko", 0.45, tp);
      if (next.kind === "alert" && kind !== "alert" && kind !== "build") drum(7 * BPB + 3.5, "taiko", 0.6, tp);

      // ================= low strings: clusters that swell =================
      {
        const o = kind === "alert" ? { lo: 55, hi: 76, top: [67, 74], n: 4, vel: 0.46 }
          : kind === "search" ? { lo: 55, hi: 79, top: [71, 77], n: 3, vel: 0.3 }
          : kind === "build" ? { lo: 52, hi: 76, top: [64, 74], n: 4, vel: 0.34 }
          : { lo: 52, hi: 72, top: [62, 69], n: 4, vel: 0.32 };
        spans.forEach((s) => {
          const step = kind === "build" || kind === "alert" ? 4 : 8;
          for (let st = s.start; st < s.start + s.dur - 1e-6; st += step) {
            if (kind === "intro" && st < 4) continue; // enter after a bar
            const len = Math.min(step, s.start + s.dur - st);
            const bar = Math.floor(st / BPB);
            let top = o.top;
            if (kind === "build") top = [o.top[0] + bar, o.top[1] + bar]; // the cluster climbs
            const v = cluster(s.sym, state.strV, o.lo, o.hi, top, o.n, r);
            state.strV = v;
            const vel = o.vel * (kind === "build" ? 1 + bar * 0.07 : 1) * (kind === "hold" ? 1.1 : 1);
            push("strings", st, len + (kind === "alert" ? 0.05 : 0.2), v, vel);
          }
        });
      }
      // a thin high harmonic over the build, the held breath and the search
      if (kind === "build" || kind === "hold" || (kind === "search" && !plan.second)) {
        spans.forEach((s) => {
          const c = T.chord(s.sym);
          const m = T.nearest(kind === "build" ? 83 : 86, [c.guide[0] ?? c.root], 79, 91);
          push("high", s.start, s.dur + 0.1, m, kind === "build" ? 0.24 + 0.02 * (s.start / 4) : 0.22);
        });
      }

      // ================= string chugs (alert): 3+3+2 =================
      if (kind === "alert" || kind === "build") {
        for (let bar = kind === "build" ? 6 : 0; bar < 8; bar++) {
          const sym = symAt(bar * BPB), c = T.chord(sym);
          const root = T.nearest(50 + K, [c.root], 47, 54);
          const fifth = root + (c.intervals.find((i) => i >= 6 && i <= 8) ?? 7);
          const v = [root, fifth, root + 12];
          const steps = plan.second && bar === 7 ? [0, 3, 6] : kind === "build" ? (bar === 6 ? [0, 3, 6, 8, 11, 14] : []) : [...ACC];
          steps.forEach((s) => push("chugs", bar * BPB + s / 4, 0.3, v, (s === 0 || s === 8 ? 0.62 : 0.5) * (kind === "build" ? 0.75 : 1)));
        }
      }

      // ================= melody =================
      const playPart = (track, notes, opts = {}) => {
        let prev = null;
        notes.forEach((n) => {
          if (opts.from != null && (n.beat < opts.from || n.beat >= opts.to)) return;
          const at = n.beat + (opts.shift || 0);
          const sym = symAt(at);
          const m = fit(n.note + (opts.oct || 0), sym, n.chrom, prev);
          prev = m;
          const inBar = at % BPB;
          const accent = inBar === 0 ? 1 : Math.abs(inBar - Math.round(inBar)) < 1e-6 ? 0.92 : 0.84;
          const note = opts.octaves ? [m - 12, m] : m;
          push(track, at, opts.legato ? n.dur * 0.97 : Math.min(n.dur, 0.24), note, (opts.vel ?? 0.6) * accent); // pizzicato: the string is plucked and left
        });
      };
      if (kind === "intro") playPart("pizz", PIZZ_A.filter((n) => n.beat < 4), { shift: 24, vel: 0.5 });
      if (plan.id === "sneakA") {
        if (odd) { // second time: bars 5-6 become the theme inverted around B3
          playPart("pizz", PIZZ_A.filter((n) => n.beat < 16 || n.beat >= 24), { vel: 0.6 });
          playPart("pizz", PIZZ_A.filter((n) => n.beat < 8).map((n) => ({ ...n, note: 2 * 59 - n.note + (n.beat >= 4 ? 5 : 0) })), { shift: 16, vel: 0.58 });
        } else playPart("pizz", PIZZ_A, { vel: 0.6 });
      }
      if (plan.id === "sneakB") {
        playPart("clar", CLAR_B, { legato: true, vel: 0.5, oct: odd ? 12 : 0 });
        playPart("pizz", PIZZ_B, { vel: 0.6 });
      }
      if (plan.id === "sneakC") {
        playPart("pizz", PIZZ_C, { vel: 0.58, octaves: true });
        playPart("clar", CLAR_C, { legato: true, vel: 0.36 });
      }
      if (kind === "build") {
        // the theme's first cell on each of the first four bars, then a rising pizzicato run
        for (let bar = 0; bar < 4; bar++) playPart("pizz", PIZZ_A.filter((n) => n.beat < 4).map((n) => ({ ...n, beat: n.beat + bar * BPB })), { vel: 0.56 + 0.03 * bar });
        let m = 52;
        for (let bar = 4; bar < 8; bar++) {
          const sym = symAt(bar * BPB), c = T.chord(sym);
          const stepB = bar < 6 ? 0.5 : 0.25;
          for (let b = 0; b < 4 - 1e-6; b += stepB) {
            if (bar === 7 && b >= 2) break;
            m = T.step(m, 1, c.pcs.concat([c.bass]));
            if (m > 76) m = T.nearest(m - 12, c.pcs, 55, 70);
            push("pizz", bar * BPB + b, stepB * 0.9, m, 0.42 + 0.05 * (bar - 4) + (b % 1 === 0 ? 0.08 : 0));
          }
        }
      }
      if (kind === "alert") {
        const brassBars = bars(BRASS_TEXT, K);
        brassBars.forEach((n) => {
          const bar = Math.floor(n.beat / BPB);
          if (plan.second && bar === 7) return;
          const sym = symAt(n.beat), m = fit(n.note, sym, n.chrom, null);
          const inBar = n.beat % BPB;
          push("brass", n.beat, n.dur * 0.94, [m - 12, m], inBar === 0 ? 0.72 : n.dur >= 1 ? 0.66 : 0.6);
        });
        if (plan.second) { // stop-hits: the brass punch the three hits on the chord
          const sym = symAt(7 * BPB), v = T.voice(sym, { lo: 55, hi: 74, n: 4, spread: "close", rng: r });
          [0, 0.75, 1.5].forEach((b, i) => push("brass", 7 * BPB + b, i === 2 ? 1.2 : 0.4, v, 0.75));
        }
      }
      if (kind === "search") {
        playPart("clar", plan.second ? CLAR_S2 : CLAR_S1, { legato: true, vel: 0.46 });
        // pizzicato answers where the clarinet rests: the tiptoe cell, fragmented
        [[1, 2.5], [3, 1], [5, 2.5], [7, 3]].forEach(([bar, b]) => {
          if (!r.chance(plan.second ? 0.85 : 0.65)) return;
          const at = bar * BPB + b, sym = symAt(at), c = T.chord(sym);
          const a = T.nearest(r.pick([59, 62, 64]), c.pcs.filter((p) => p !== c.root).concat(c.guide), 57, 67);
          const nb = T.step(a, 1, c.scale);
          [[0, a], [0.25, nb], [0.5, a]].forEach(([o, m]) => { if (b + o < 4) push("pizz", at + o, 0.2, m, 0.46); });
        });
        // sonar ping: a chord tone up high, every two bars
        for (let bar = 0; bar < 8; bar += 2) {
          const sym = symAt(bar * BPB), c = T.chord(sym);
          push("ping", bar * BPB + 0.5, 2, T.nearest(84, [mod12(c.root + 7)], 79, 88), 0.5);
        }
      }
      if (kind === "hold") {
        playPart("clar", HOLD_CLAR, { legato: true, vel: 0.4 });
        playPart("pizz", PIZZ_A.filter((n) => n.beat >= 4 && n.beat < 8), { shift: 16, vel: 0.5 });
      }

      // ================= night air =================
      if (kind !== "alert") push("air", 0, 32, "air", kind === "search" ? 1 : kind === "hold" ? 0.9 : kind === "build" ? 0.5 : 0.7);

      // ================= tempo =================
      const res = { events: ev, harmony: prog, section: `${plan.label}${plan.key ? ` (in ${T.NAMES[mod12(4 + plan.key)]} minor)` : ""}${plan.round > 0 ? ` · round ${plan.round + 1}` : ""}`, state };
      if (state.bpm !== plan.tempo) { res.tempo = { bpm: plan.tempo, rampBeats: plan.ramp || 0 }; state.bpm = plan.tempo; }
      return res;
    },
  });
})();

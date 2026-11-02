// Cumbia del Puerto: a sunny Colombian / Peruvian cumbia at 92 for a harbour-front hangout.
//
// Groove (straight eighths): the guacharaca scrapes every beat long-short (down-stroke, up-stroke) with a
// maraca under it; the tambora (a low surdo here) hits 1, a muted 3 and a pickup on the "and" of 4; the
// congas play heel-toe with slaps on 2 and 4 and open tones on the "ands" (the llamador's job); a cowbell
// marks the offbeats, leaning on the "and" of 2 and 4. The electric bass plays the cumbia's root and fifth
// on 1 and 3 and walks up chromatically into every chord change. A muted guitar chops the offbeats.
//
// Melody: the accordion plays a tune made of one lilting cell (rest, three eighths up, a long note, three
// eighths back) answered by dotted figures, in parallel diatonic thirds when the band is full, decorated
// with mordents, grace notes and sixteenth-note runs. The chicha section turns to E minor: a clean guitar
// through a phaser plays the second tune, a second guitar joins in thirds, a cheap organ stabs the offbeats.
//
// Form (8-bar cycles, one round = 11 cycles = 88 bars, about 3.8 minutes):
//   intro (groove, then the accordion's llamada) -> A1 -> A2 (tune in thirds) -> break (accordion calls,
//   percussion answers) -> accordion solo (16) -> A1 -> chicha (16, E minor, guitars) -> percussion break
//   (tambor solo, bass walks back in) -> A2.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const M = T.midi, mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  /** "note/beats" tokens, r = rest; checks the total length. */
  function L(str, len) {
    const out = [];
    let b = 0;
    for (const tok of str.trim().split(/\s+/)) {
      if (tok === "|") continue;
      const [n, d] = tok.split("/");
      const dur = Number(d);
      if (!(dur > 0)) throw new Error(`cumbia: bad token "${tok}"`);
      if (n !== "r") out.push({ beat: b, dur, note: M(n) });
      b += dur;
    }
    if (len != null && Math.abs(b - len) > 1e-6) throw new Error(`cumbia: line is ${b} beats, expected ${len}: ${str.slice(0, 40)}…`);
    return out;
  }

  // ---------- harmony ----------
  const PROG_TEXT = {
    intro: "| G | G | D7 | D7 | G | G | D7 | D7 |",
    A1: "| G | G | D7 | D7 | D7 | D7 | G | G |",
    A2: "| G | G | C | C | D7 | D7 | G | D7 |",
    brk1: "| G | D7 | G | D7 | G | D7 | G | D7 |",
    S0: "| C | D7 | G | Em | C | D7 | G | G |",
    S1: "| Am7 | D7 | G | Em | C | D7 | G | D7 |",
    C0: "| Em | Em | Am | B7 | Em | D | C | B7 |",
    C1: "| Em | Em | Am | B7 | Em | D | C | B7 |",
    brk2: "| Em | Em | Em | Em | Em | Em | D7 | D7 |",
  };
  const PROG = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, v.split("|").map((s) => s.trim()).filter(Boolean)]));
  const G_MAJOR = T.scale(7, "ionian"), E_MINOR = T.scale(4, "aeolian"), E_HARM = T.scale(4, "harmonicMinor");
  const keyScale = (sym, minor) => (minor ? (sym === "B7" ? E_HARM : E_MINOR) : G_MAJOR);

  const ROUND = [
    { id: "intro", prog: "intro", dyn: 0.9, label: "Intro · groove, then the accordion calls" },
    { id: "A1", prog: "A1", dyn: 1, label: "A · the accordion tune" },
    { id: "A2", prog: "A2", dyn: 1.02, label: "A · the tune in thirds" },
    { id: "brk1", prog: "brk1", dyn: 0.98, label: "Break · accordion calls, the drums answer" },
    { id: "solo", part: 0, prog: "S0", dyn: 1.02, label: "Accordion solo" },
    { id: "solo", part: 1, prog: "S1", dyn: 1.05, label: "Accordion solo · higher" },
    { id: "A1", prog: "A1", ret: true, dyn: 1.02, label: "A · the tune returns" },
    { id: "C", part: 0, prog: "C0", minor: true, dyn: 0.98, label: "Chicha · E minor, guitar and organ" },
    { id: "C", part: 1, prog: "C1", minor: true, dyn: 1.02, label: "Chicha · two guitars in thirds" },
    { id: "brk2", prog: "brk2", minor: true, dyn: 0.95, label: "Break · tambor solo, the bass walks back in" },
    { id: "A2", prog: "A2", ret: true, dyn: 1.05, label: "A · last time, in thirds" },
  ];
  const planAt = (cycle) => { const round = Math.floor(cycle / ROUND.length), idx = cycle % ROUND.length; return { part: 0, ...ROUND[idx], round, idx }; };

  // ---------- melodies ----------
  const LLAMADA = L("r/2 D5/0.25 E5/0.25 F#5/0.25 G5/0.25 A5/0.5 B5/0.5 | D6/1.5 B5/0.5 G5/0.5 A5/0.5 B5/1 | A5/0.5 F#5/0.5 D5/0.5 F#5/0.5 A5/1 C6/1 | B5/0.5 A5/0.5 G5/0.5 F#5/0.5 E5/0.5 D5/0.5 C5/0.5 A4/0.5", 16);
  const HEAD = "r/0.5 B4/0.5 D5/0.5 G5/1 F#5/0.5 G5/0.5 A5/0.5 | B5/1.5 A5/0.5 G5/1 r/0.5 D5/0.5 | ";
  const TUNE = {
    A1: L(HEAD + "C5/0.5 D5/0.5 F#5/0.5 A5/1 G5/0.5 F#5/0.5 E5/0.5 | F#5/1.5 E5/0.5 D5/1 r/1 | r/0.5 A4/0.5 C5/0.5 F#5/1 E5/0.5 F#5/0.5 G5/0.5 | A5/1.5 G5/0.5 F#5/1 r/0.5 D5/0.5 | E5/0.5 F#5/0.5 G5/0.5 B5/1 A5/0.5 G5/0.5 F#5/0.5 | G5/2 r/2", 32),
    A2: L(HEAD + "C5/0.5 E5/0.5 G5/0.5 C6/1 B5/0.5 A5/0.5 G5/0.5 | E5/1.5 D5/0.5 C5/1 r/0.5 D5/0.5 | r/0.5 F#5/0.5 A5/0.5 D6/1 C6/0.5 B5/0.5 A5/0.5 | F#5/1.5 E5/0.5 D5/1 r/0.5 D5/0.5 | E5/0.5 F#5/0.5 G5/0.5 B5/1 A5/0.5 G5/0.5 F#5/0.5 | G5/1 r/0.5 A5/0.5 F#5/0.5 D5/0.5 r/1", 32),
  };
  // break 1: two calls, each answered by the drums
  const CALLS = [
    L("B5/0.5 A5/0.25 B5/0.25 D6/1 B5/0.5 G5/1.5 | A5/0.5 G5/0.25 A5/0.25 C6/1 A5/0.5 F#5/1.5", 8),
    L("D6/0.5 C6/0.5 B5/0.5 A5/0.5 G5/1 D5/1 | C6/0.5 B5/0.5 A5/0.5 G5/0.5 F#5/1 D5/1", 8),
  ];
  // the chicha tune (E minor): descending sequences in eighths, harmonic minor over B7
  const CHICHA = L("B4/0.5 E5/0.5 G5/0.5 F#5/0.5 E5/1 D5/0.5 E5/0.5 | B4/1.5 r/1.5 G4/0.5 A4/0.5 | C5/0.5 E5/0.5 A5/0.5 G5/0.5 E5/1 D5/0.5 C5/0.5 | B4/1.5 D#5/0.5 F#5/1 r/0.5 A5/0.5 | G5/0.5 F#5/0.5 E5/0.5 D5/0.5 E5/1 B4/0.5 E5/0.5 | F#5/1.5 E5/0.5 D5/1 r/0.5 A4/0.5 | C5/0.5 E5/0.5 G5/0.5 E5/0.5 C5/1 B4/0.5 A4/0.5 | B4/1.5 C5/0.5 D#5/1 r/1", 32);
  const CHICHA2_END = L("C5/0.5 E5/0.5 G5/0.5 B5/0.5 A5/1 G5/0.5 E5/0.5 | F#5/0.5 D#5/0.5 B4/0.5 D#5/0.5 F#5/2", 8); // bars 7-8 of the second time: hang on the dominant into the break

  // ---------- percussion ----------
  const CONGA = [[0, 60, 0.13], [0.5, 61, 0.1], [1, 68, 0.46], [1.5, 63, 0.4], [2, 60, 0.13], [2.5, 61, 0.1], [3, 68, 0.46], [3.5, 63, 0.42]];
  const ANSWERS = [ // drum answers in break 1: [beat, voice, pitch, vel] over two bars
    [[0, "conga", 63, 0.5], [0.5, "conga", 63, 0.45], [1, "conga", 68, 0.55], [1.75, "congaLow", 56, 0.5], [2, "congaLow", 56, 0.55], [2.5, "conga", 68, 0.5], [3, "conga", 63, 0.5], [3.5, "congaLow", 56, 0.5],
      [4, "timbale", 74, 0.6], [4.5, "timbale", 74, 0.45], [4.75, "timbale", 67, 0.45], [5, "timbale", 67, 0.55], [6, "timbale", 74, 0.5], [6.25, "timbale", 74, 0.4], [6.5, "timbale", 67, 0.5], [6.75, "timbale", 67, 0.45], [7, "timbale", 74, 0.65]],
    [[0, "timbale", 74, 0.6], [0.25, "timbale", 74, 0.35], [0.5, "timbale", 67, 0.5], [1, "conga", 68, 0.55], [1.5, "conga", 63, 0.5], [2, "timbale", 74, 0.55], [2.5, "timbale", 67, 0.5], [3, "conga", 68, 0.55], [3.5, "congaLow", 56, 0.5],
      [4, "conga", 63, 0.5], [4.25, "conga", 63, 0.35], [4.5, "conga", 68, 0.5], [5, "congaLow", 56, 0.55], [5.5, "conga", 63, 0.45], [6, "timbale", 74, 0.5], [6.25, "timbale", 74, 0.4], [6.5, "timbale", 74, 0.45], [6.75, "timbale", 67, 0.5], [7, "timbale", 67, 0.55], [7.25, "timbale", 67, 0.6], [7.5, "timbale", 74, 0.7]],
  ];
  // tambor alegre phrases for the percussion break (one bar each), improvised over the llamador and bell
  const TAMBOR = [
    [[0, 63, 0.5], [0.5, 68, 0.55], [0.75, 68, 0.35], [1.5, 63, 0.5], [2, 56, 0.55], [2.5, 68, 0.55], [3.5, 63, 0.5]],
    [[0, 68, 0.55], [0.25, 63, 0.4], [0.5, 63, 0.45], [1, 56, 0.55], [1.5, 68, 0.5], [2.5, 63, 0.5], [2.75, 63, 0.4], [3, 68, 0.6]],
    [[0.5, 63, 0.5], [1, 63, 0.45], [1.5, 68, 0.6], [2, 56, 0.5], [2.25, 56, 0.4], [2.5, 63, 0.5], [3, 68, 0.55], [3.25, 68, 0.4], [3.5, 63, 0.55]],
    [[0, 56, 0.6], [0.5, 68, 0.5], [1, 68, 0.4], [1.25, 63, 0.4], [1.5, 63, 0.5], [2.5, 68, 0.6], [3, 56, 0.5], [3.5, 68, 0.55], [3.75, 68, 0.4]],
  ];

  // ---------- custom instruments ----------
  /** A cowbell: two square waves through a band-pass, plus a stick click. */
  function cowbell(ctx, dest, o) {
    const I = ctx.I;
    const out = ctx.keep(new Tone.Gain(db(o.level))).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ frequency: o.bp, type: "bandpass", Q: o.Q })).connect(out);
    const env = ctx.keep(new Tone.Gain(0)).connect(bp);
    const o1 = ctx.keep(new Tone.Oscillator({ type: "square", frequency: o.f1 }).start());
    const o2 = ctx.keep(new Tone.Oscillator({ type: "square", frequency: o.f2 }).start());
    o1.connect(env); o2.connect(env);
    const hp = ctx.keep(new Tone.Filter(3500, "highpass")).connect(out);
    const click = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.005 } })).connect(hp);
    click.volume.value = -16;
    const clock = I.monotonic(env), clickClock = I.monotonic(click);
    return {
      out,
      hit(t, vel, damp) {
        if (!Number.isFinite(vel)) return;
        const tt = clock(t);
        env.gain.setValueAtTime(0, tt);
        env.gain.linearRampToValueAtTime(0.5 * vel, tt + 0.001);
        env.gain.setTargetAtTime(0.16 * vel, tt + 0.001, 0.012);
        env.gain.setTargetAtTime(0, tt + 0.03, damp ? o.decay * 0.4 : o.decay);
        click.triggerAttackRelease(0.01, clickClock(t), vel);
      },
    };
  }

  /** Decorate a line: mordents on long notes, grace notes, and sixteenth runs into phrase starts after a rest. */
  function ornament(notes, r, amt, scaleAt, minBeat = -Infinity) {
    const out = [];
    notes.forEach((n, i) => {
      const prev = notes[i - 1];
      const gap = prev ? n.beat - (prev.beat + prev.dur) : 2;
      const sc = scaleAt(n.beat);
      const x = r();
      if (n.dur >= 1 && x < amt * 0.45) { // mordent: main, upper neighbour, main
        const up = T.step(n.note, 1, sc);
        out.push({ ...n, dur: 0.125, orn: true }, { ...n, beat: n.beat + 0.125, dur: 0.125, note: up, orn: true }, { ...n, beat: n.beat + 0.25, dur: n.dur - 0.25 });
      } else if (gap >= 1 && n.beat - 0.75 >= minBeat && x < amt * 0.75) { // a run of sixteenths up into the note
        const k = r.chance(0.5) ? 3 : 2;
        for (let j = k; j >= 1; j--) out.push({ beat: n.beat - j * 0.25, dur: 0.24, note: T.step(n.note, -j, sc), orn: true });
        out.push(n);
      } else if (gap >= 0.25 && n.dur >= 0.5 && n.beat - 0.125 >= minBeat && x < amt) { // a grace note
        out.push({ beat: n.beat - 0.125, dur: 0.12, note: T.step(n.note, r.chance(0.65) ? -1 : 1, sc), orn: true }, n);
      } else out.push(n);
    });
    return out;
  }

  Sim.register({
    id: "cumbia",
    title: "Cumbia del Puerto",
    genre: "Cumbia",
    about: "A sunny cumbia in G at 92: guacharaca and maraca, congas, a low tambora and an offbeat cowbell under an accordion tune in thirds with mordents and runs, a call-and-response break, an accordion solo, a chicha section in E minor for two guitars and organ, and a tambor solo.",
    bpm: 92, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["hangout", "party"],
    energy: 0.6,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.014, lowcut: 250, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 3, preDelay: 0.03, lowcut: 350, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.25, highcut: 3200, pingPong: true });

      const acc = I.accordion(ctx, { volume: -2, cutoff: 3200 });
      const gtrBus = ctx.keep(new Tone.Gain(1)).connect(out);
      const phaser = ctx.keep(new Tone.Phaser({ frequency: 0.35, octaves: 3, baseFrequency: 500, wet: 0.45 })).connect(gtrBus);
      const gtr1 = I.guitar(ctx, { kind: "clean", volume: 1, chorus: false });
      const gtr2 = I.guitar(ctx, { kind: "clean", volume: -3, chorus: true });
      const chops = I.guitar(ctx, { kind: "muted", volume: -9 });
      const organ = I.organ(ctx, { volume: -12, partials: [1, 0.5, 0.35, 0.15, 0, 0.08] });
      const bass = I.ebass(ctx, { volume: -3, base: 150 });

      const kitG = I.kit(ctx, { volume: -5, preload: ["guiro", "shaker"] });
      const kitC = I.kit(ctx, { volume: -1, preload: ["conga", "congaLow"] });
      const kitD = I.kit(ctx, { volume: -2, preload: ["surdo", "timbale", "crash"] });
      const bellP = ctx.keep(new Tone.Panner(0.32)).connect(out);
      const bell = cowbell(ctx, bellP, { level: -10, f1: 600, f2: 900, bp: 2400, Q: 1.2, decay: 0.09 });

      const ap = I.place(ctx, acc, 0.08, out);
      const g1 = I.place(ctx, gtr1, -0.22, phaser), g2 = I.place(ctx, gtr2, 0.3, phaser);
      const cp = I.place(ctx, chops, -0.42, out), op = I.place(ctx, organ, 0.38, out);
      I.place(ctx, bass, 0, out);
      const kg = I.place(ctx, kitG, 0.5, out), kc = I.place(ctx, kitC, -0.3, out), kd = I.place(ctx, kitD, 0.1, out);
      I.send(ctx, ap, hall, -12); I.send(ctx, ap, echo, -24);
      I.send(ctx, gtrBus, hall, -10); I.send(ctx, gtrBus, echo, -16);
      I.send(ctx, cp, room, -14); I.send(ctx, op, room, -10);
      [kg, kc, kd, bellP].forEach((k) => I.send(ctx, k, room, -15));
      I.send(ctx, bass.out, room, -26);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      const perc = (kit) => (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len });
      return {
        accordion: { layer: "melody", play: pl(acc), humanize: { timing: 0.008, vel: 0.05 } },
        guitar: { layer: "melody", play: (t, e, d) => gtr1.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        guitar2: { layer: "harmony", play: (t, e, d) => gtr2.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        chops: { layer: "harmony", play: (t, e, d) => chops.play(t, e.note, d, e.vel, 0.008), humanize: { timing: 0.005, vel: 0.08 } },
        organ: { layer: "harmony", play: pl(organ), humanize: { timing: 0.005, vel: 0.05 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.004, vel: 0.05 } },
        guacharaca: { layer: "drums", play: perc(kitG), humanize: { timing: 0.004, vel: 0.08 } },
        congas: { layer: "drums", play: perc(kitC), humanize: { timing: 0.005, vel: 0.08 } },
        tambora: { layer: "drums", play: perc(kitD), humanize: { timing: 0.004, vel: 0.06 } },
        cowbell: { layer: "drums", play: (t, e) => bell.hit(t, e.vel, e.note === "damp"), humanize: { timing: 0.003, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1), prev = cycle > 0 ? planAt(cycle - 1) : null;
      const syms = PROG[plan.prog], nextFirst = PROG[next.prog][0];
      const symAt = (b) => (b >= 32 ? nextFirst : syms[Math.max(0, Math.min(7, Math.floor(b / BPB + 1e-9)))]);
      const minor = !!plan.minor;
      const scaleAt = (b) => keyScale(symAt(b), minor);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const D = plan.dyn, id = plan.id, odd = plan.round % 2 === 1;
      const brk2 = id === "brk2", brk1 = id === "brk1";
      // bars where only the drums play (the answers in break 1, the start of break 2)
      const drumsOnly = (b) => (brk1 && (b % 4 === 2 || b % 4 === 3) && b !== 7) || (brk2 && b < 6);
      /** The voice under a melody note: a diatonic third, unless that would put a non-chord tone under a
       *  chord tone on a strong beat or a long note; then the chord tone below (a third or a fourth). */
      const third = (n, b, dur = 0.5) => {
        const c = T.chord(symAt(b)), tones = c.intervals.filter((i) => i < 12).map((i) => mod12(c.root + i));
        const dia = T.step(n, -2, scaleAt(b));
        const strong = (Math.abs(b - Math.round(b)) < 1e-6 && Math.round(b) % 2 === 0) || dur >= 1;
        if (tones.includes(mod12(dia)) || !tones.includes(mod12(n)) || (!strong && c.scale.includes(mod12(dia)))) return dia;
        let x = n - 3; while (!tones.includes(mod12(x))) x--;
        return x;
      };

      // ================= melody =================
      const accLine = (notes, { vel = 0.62, thirds = false, orn = 0.3, shift = 0 } = {}) => {
        const src = notes.map((n) => ({ ...n, beat: n.beat + shift }));
        const dec = ornament(src, r.fork(cycle * 7 + shift), orn, scaleAt, cycle === 0 ? 0 : -0.5);
        dec.forEach((n) => {
          const inBar = ((n.beat % BPB) + BPB) % BPB;
          const v = (vel + (inBar === 0 || inBar === 2 ? 0.05 : 0) + (n.dur >= 1 ? 0.04 : 0) - (n.orn ? 0.12 : 0)) * D;
          const note = thirds && !n.orn && n.dur >= 0.5 ? [third(n.note, n.beat, n.dur), n.note] : n.note;
          push("accordion", n.beat, n.orn ? n.dur : n.dur * 0.94, note, v, n.orn ? { straight: true } : {});
        });
      };
      if (id === "intro") accLine(LLAMADA, { shift: 16, vel: 0.6, orn: 0.15 });
      else if (id === "A1" || id === "A2") {
        // first A plain, then thirds; the returns ornament more and take thirds throughout
        const thirds = id === "A2" || plan.ret || odd;
        accLine(TUNE[id], { thirds, orn: plan.ret ? 0.45 : 0.28 + 0.06 * plan.round, vel: 0.62 });
      } else if (brk1) {
        accLine(CALLS[0], { orn: 0.35, thirds: odd });
        accLine(CALLS[1], { shift: 16, orn: 0.35, thirds: true });
      } else if (id === "solo") {
        // improvised over the changes; the second half climbs and gets busier
        const m = C.line({ start: 0, end: 31, lead: r.pick([0, 0.5]), chordAt: symAt, lo: 67 + 2 * plan.part, hi: 86 + 2 * plan.part, rng: r.fork(3), density: 0.5 + 0.12 * plan.part, phrase: [4, 8], rest: [0.5, 2], motif: state.soloMotif, motifProb: 0.5, chromatic: 0.2, register: 0.5 + 0.15 * plan.part, prev: state.soloLast, upbeatStart: 0.55, scaleFor: (s) => G_MAJOR });
        state.soloMotif = m.motif; state.soloLast = m.last;
        const notes = m.notes.map((n) => ({ beat: n.beat, dur: n.dur, note: n.note, vel: n.vel }));
        // a triplet flourish once per half: a run down from the highest note
        const top = notes.reduce((a, n) => (n.note > (a?.note ?? 0) && n.dur >= 1 && n.beat < 28 ? n : a), null);
        if (top && r.chance(0.7)) {
          const k = notes.indexOf(top), run = [];
          for (let j = 0; j < 6; j++) run.push({ beat: top.beat + j / 3, dur: 1 / 3, note: T.step(top.note, -j, G_MAJOR), trip: true });
          notes.splice(k, 1, ...run.filter((x) => !notes.some((y) => y !== top && y.beat >= x.beat - 1e-6 && y.beat < top.beat + 2 - 1e-6)));
        }
        const dec = ornament(notes.filter((n) => !n.trip), r.fork(5), 0.35, scaleAt).concat(notes.filter((n) => n.trip));
        dec.forEach((n) => {
          const v = (0.6 + (n.vel ? (n.vel - 0.6) : 0) - (n.orn ? 0.1 : 0) - (n.trip ? 0.04 : 0)) * D;
          push("accordion", n.beat, n.orn || n.trip ? n.dur : n.dur * 0.94, n.note, v, n.orn || n.trip ? { straight: true } : {});
        });
      } else if (id === "C") {
        const tune = plan.part === 0 ? CHICHA : CHICHA.filter((n) => n.beat < 24).concat(CHICHA2_END.map((n) => ({ ...n, beat: n.beat + 24 })));
        const dec = ornament(tune, r.fork(9), 0.25, scaleAt);
        dec.forEach((n) => {
          const inBar = n.beat % BPB;
          const v = (0.62 + (inBar === 0 || inBar === 2 ? 0.05 : 0) - (n.orn ? 0.12 : 0)) * D;
          push("guitar", n.beat, n.orn ? 0.2 : n.dur * 0.9, n.note, v, n.orn ? { straight: true } : {});
          if (plan.part === 1 && !n.orn) push("guitar2", n.beat, n.dur * 0.9, third(n.note, n.beat, n.dur), v * 0.85);
        });
        if (plan.part === 0) { // the accordion answers the guitar's held notes from far off
          [[4, "E5 D5 B4"], [20, "F#5 E5 D5"]].forEach(([at, s], k) => s.split(" ").forEach((nm, j) => push("accordion", at + 2.5 + j * 0.5, 0.45, M(nm), (0.38 - 0.03 * j) * D)));
        }
      }

      // ================= offbeat chops (muted guitar) / organ in the chicha =================
      {
        let v = state.chopV;
        for (let b = 0; b < 8; b++) {
          if (drumsOnly(b)) continue;
          const sym = syms[b];
          v = T.voice(sym, { lo: 55, hi: 72, n: 3, prev: v, spread: "close", rng: r });
          const inst = id === "C" ? "organ" : "chops";
          for (let k = 0; k < 4; k++) {
            if (brk2 && b === 7 && k === 3) continue;
            push(inst, b * BPB + k + 0.5, inst === "organ" ? 0.24 : 0.22, v, ((k % 2 ? 0.46 : 0.38) + (inst === "organ" ? 0.02 : 0)) * D);
          }
        }
        state.chopV = v;
      }

      // ================= bass: root and fifth on 1 and 3, walk-ups into changes =================
      {
        let last = state.bassLast ?? 43;
        for (let b = 0; b < 8; b++) {
          if (drumsOnly(b)) continue;
          const s = b * BPB, c = T.chord(syms[b]);
          const nextSym = b < 7 ? syms[b + 1] : nextFirst;
          const root = T.nearest(last, [c.root], 36, 52);
          const fifth = root + 7 <= 52 ? root + 7 : root - 5;
          const silentNext = b === 7 ? next.id === "brk2" : drumsOnly(b + 1);
          const change = nextSym !== syms[b] && !silentNext;
          push("bass", s, 1.4, root, 0.78 * D);
          // walk up chromatically (or diatonically, then chromatically) into the next root, unless the
          // melody sits a semitone from the walk
          const tgt = T.nearest(root + 3, [T.chord(nextSym).root], 36, 52);
          const dir = tgt > root ? 1 : -1; // walk up into it, or down when it lies below
          const mel = ev.filter((e) => (e.track === "accordion" || e.track === "guitar") && e.bar * BPB + e.beat >= s + 2.25 && e.bar * BPB + e.beat < s + 4.25).flatMap((e) => [].concat(e.note));
          const ks = keyScale(syms[b], minor);
          const walks = [[tgt - 3 * dir, tgt - 2 * dir, tgt - dir], [T.step(tgt, -2 * dir, ks), T.step(tgt, -dir, ks), tgt - dir], [T.step(tgt, -2 * dir, ks), T.step(tgt, -dir, ks)]]
            .map((w) => w.filter((m, i) => (m - tgt) * dir < 0 && (i === 0 || (m - w[i - 1]) * dir > 0) && m >= 33))
            .filter((w) => !w.some((m) => mel.some((x) => Math.abs(mod12(x - m)) === 1 || Math.abs(mod12(x - m)) === 11)));
          if (change && walks.length && r.chance(0.8)) {
            const uniq = r.chance(0.5) ? walks[0] : walks[walks.length - 1];
            push("bass", s + 2, 0.45, fifth, 0.66 * D);
            uniq.forEach((m, i) => push("bass", s + 4 - (uniq.length - i) * 0.5, 0.45, m, (0.56 + 0.04 * i) * D));
            last = tgt;
          } else {
            push("bass", s + 2, 1.4, fifth, 0.68 * D);
            if (r.chance(0.25)) push("bass", s + 3.5, 0.45, fifth > root ? root + 12 <= 52 ? root + 12 : fifth : root, 0.5 * D); // a bounce on 4&
            last = root;
          }
        }
        state.bassLast = last;
      }

      // ================= percussion =================
      const hit = (track, abs, voice, vel, extra) => push(track, abs, 0.25, voice, vel, extra);
      const lift = id === "solo" || id === "C" || (id === "A2" && plan.ret);
      for (let b = 0; b < 8; b++) {
        const s = b * BPB;
        const fillBar = b === 7 && next.id !== id && !brk1 && !brk2;
        const answer = brk1 && (b % 4 === 2 || b % 4 === 3);
        // ---- guacharaca: long down-stroke on the beat, short up-stroke on the "and"; a double up-stroke now and then
        for (let k = 0; k < 4; k++) {
          if (fillBar && k === 3) break;
          push("guacharaca", s + k, 0.25, "guiro", (k % 2 ? 0.36 : 0.42) * D, { len: 0.17 });
          push("guacharaca", s + k + 0.5, 0.25, "guiro", 0.3 * D, { len: 0.06 });
          if (lift && k === 3 && r.chance(0.5)) push("guacharaca", s + k + 0.75, 0.25, "guiro", 0.24 * D, { len: 0.05 });
        }
        // ---- maraca: sixteenths, the "e" and "a" ghosted (enters after the intro's first bars)
        if (!(id === "intro" && b < 2) && !answer) for (let k = 0; k < 16; k++) {
          if (!lift && k % 2) continue;
          hit("guacharaca", s + k * 0.25, "shaker", (k % 4 === 2 ? 0.34 : k % 2 ? 0.14 : 0.22) * D);
        }
        // ---- congas (the llamador's offbeats live in the open tones)
        if (!answer && !brk2) {
          CONGA.forEach(([x, p, v]) => { if (!(fillBar && x >= 3)) hit("congas", s + x, p < 58 ? "congaLow" : "conga", v * D, { pitch: p }); });
          if (lift && b % 2 === 1 && !fillBar) hit("congas", s + 3.75, "congaLow", 0.4 * D, { pitch: 56 });
        }
        // ---- tambora: 1, a muted 3, and a pickup on the "and" of 4
        if (!answer && !(brk2 && b < 2) && !(id === "intro" && b < 1)) {
          hit("tambora", s, "surdo", 0.56 * D, { pitch: 40 });
          push("tambora", s + 2, 0.25, "surdo", 0.42 * D, { pitch: 40, len: 0.1 });
          if (!fillBar) hit("tambora", s + 3.5, "surdo", 0.34 * D, { pitch: 40 });
        }
        // ---- cowbell on the offbeats (enters in bar 3 of the intro)
        if (!(id === "intro" && b < 2) && !answer && !(brk2 && b < 2)) {
          [0.5, 1.5, 2.5, 3.5].forEach((x) => { if (!(fillBar && x > 3)) push("cowbell", s + x, 0.25, x === 1.5 || x === 3.5 ? "open" : "damp", (x === 1.5 || x === 3.5 ? 0.5 : 0.34) * D); });
        }
        // ---- fills at section ends: timbale sixteenths into a crash on the next downbeat
        if (fillBar) {
          const f = r.pick([[[3, 74], [3.25, 74], [3.5, 67], [3.75, 67]], [[2.5, 74], [3, 67], [3.25, 74], [3.5, 67], [3.75, 67]], [[3, 67], [3.25, 67], [3.5, 74], [3.75, 74]]]);
          f.forEach(([x, p], i) => hit("tambora", s + x, "timbale", (0.4 + 0.07 * i) * D, { pitch: p }));
        }
      }
      // break 1: the drums answer the accordion
      if (brk1) [8, 24].forEach((at, k) => ANSWERS[(k + plan.round) % 2].forEach(([x, voice, p, v]) => hit(voice === "timbale" ? "tambora" : "congas", at + x, voice, v * D, { pitch: p })));
      // break 2: the tambor alegre improvises, phrases in pairs, over the cowbell and guacharaca
      if (brk2) for (let b = 0; b < 8; b++) {
        const ph = TAMBOR[(state.tamborK = ((state.tamborK ?? r.int(0, 3)) + (b % 2 === 0 ? r.int(1, 3) : 0)) % 4)];
        ph.forEach(([x, p, v]) => hit("congas", b * BPB + x, p < 58 ? "congaLow" : "conga", v * (b < 6 ? 1.1 : 0.9) * D, { pitch: p }));
      }
      // arrivals
      const arriving = prev && prev.id !== id;
      if (arriving && !brk2 && !(brk1)) { hit("tambora", 0, "crash", 0.42 * D); }
      if (brk1 || brk2) hit("tambora", 0, "crash", 0.36 * D);

      let label = plan.label;
      if (plan.round > 0) label += ` · round ${plan.round + 1}`;
      return { events: ev, harmony: syms.map((chord, bar) => ({ bar, beat: 0, dur: BPB, chord })), section: label, state };
    },
  });
})();

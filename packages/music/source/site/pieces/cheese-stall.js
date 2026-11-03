// Noon at the Cheese Stall: a market town on a bright weekday, 126 bpm, G major with a trio in Bb.
//
// Three players share one quick-witted tune the way a Pilotwings or SimCity arrangement would: a clarinet
// (chalumeau when it takes the high phrases an octave down), a fife (a small bright flute) and a mandolin.
// Under them a tuba plays oom, a nylon guitar plays pah, and a brushed kit keeps a light pocket with a
// woodblock, tambourine, shaker and triangle. The tune is hand-written below and never changes; the
// generator decides who plays what, the ornaments, the comping figures and the fills.
//
// Engine modules: Sim.phrasing (the tune is written in its notation; staccato dots, accents, grace notes,
// a chromatic turn, fall-offs and slurs are realized by its instrument wrapper on the three mono winds/brass),
// Sim.dialogue (the tune is routed phrase by phrase, handed off on long notes, hocketed two notes at a time,
// and in the trio the calls are answered in the rests by a different stall: down a third, inverted,
// backwards, cut short), Sim.groove (laid-back brushes, pushed sweeps, an MPC-style 54% feel on the
// woodblock and mandolin, ghost taps, accent patterns, a lift into the last chorus and a ritardando into
// the tag, light rubato on the trio calls).
//
// THE TUNE (A, 8 bars, by hand; Sim.phrasing marks: . staccato  > accent  _ tenuto  ~ slur  g grace  f2 fall)
//   | G6             | Em7                  | Cmaj7           | C#m7b5   F#7         |
//   | B4. B4. D5> r G5. E5. r | D5 D#5 E5 G5> F#5 E5 | E5. E5. G5> r C6. A5. r | G5 E5 C#5 E5 A#5_ F#5 f |
//   | Bm7              | Bbmaj7                | Am7                     | D7                       |
//   | F#5. F#5. A5> r D6. B5. r | A5 Bb5 C6 D6 F6> D6 | E6. C6. A5. E5. gG5 F#5 E5 | D5_ r D5. D5. D5. D5. |
//   The question (bars 1-4): two staccato knocks and a hop, "this one? ...and that"; the chromatic turn
//   D D# E in bar 2; the motif sequenced up a fourth; a ii-V to iii (C#m7b5 F#7) that ends on the tenuto
//   A# with a little fall: a raised eyebrow. The answer (bars 5-8): the motif on iii, then the cheeky
//   sidestep to Bbmaj7 (bIII) with a run up to F6, a staccato tumble down Am7 with a grace note, and four
//   knocks on D over D7: "sold?" The closed ending swaps bars 7-8 for | Am7 D7 | G6 | with D6. B5. E5 F#5 G5>.
//
// THE TRIO (8 bars in Bb, legato calls in the odd bars, answered in the rests by another player)
//   | Bbmaj7 | Gm7 | Cm7 | F7 | Dm7 G7 | Cm7 F7 | Ebmaj7 | D7sus4 D7 |
//   | r gF5 D5~ F5~ Bb5~v | A5~ G5 f r r | r gG5 Eb5~ G5~ C6~v | Bb5~ A5 f r r |
//   | r A5 F5 D5 F5~ B5>_ | Eb6. C6. G5~ A5 r | Bb5 G5 D5~ F5~ G5~v | A5~ G5~ F#5 r D5. D5. D5. |
//   Ebmaj7 is IV of Bb and bVI of G, so the last bar turns home through D7; the knocks come back as the pickup.
//
// TAG (4 bars): | Ebmaj7 | D7sus4 D7 | G6 | G6 |: the knocks traded one note at a time between the three
//   stalls, then B4. B4. D5> and three low G knocks: closed.
//
// FORM, one lap of 56 bars (14 cycles of 4, 1:47): intro 4 · A (a phrase each) 8 · A (handed off on the long
//   notes) 8 · trio 8 · trio (re-orchestrated, answers inverted) 8 · A (hocketed) 8 · A (all together, closed) 8 ·
//   tag 4. Laps rotate who starts, who answers, the join style, the hocket grouping, the aux percussion.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const { mod12 } = T;
  const BPB = 4, CB = 4, BPM = 126;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- the score ----------
  const A_CH = "| G6 | Em7 | Cmaj7 | C#m7b5 F#7 | Bm7 | Bbmaj7 | Am7 | D7 |";
  const A_CH_CLOSE = "| G6 | Em7 | Cmaj7 | C#m7b5 F#7 | Bm7 | Bbmaj7 | Am7 D7 | G6 |";
  const A_BODY = [
    "B4/0.5. B4/0.5. D5/1> r/0.5 G5/0.5. E5/0.5. r/0.5",
    "D5/0.5 D#5/0.5 E5/0.5 G5/1> F#5/0.5 E5/1",
    "E5/0.5. E5/0.5. G5/1> r/0.5 C6/0.5. A5/0.5. r/0.5",
    "G5/0.5 E5/0.5 C#5/0.5 E5/0.5 A#5/1.5_ F#5/0.5f2",
    "F#5/0.5. F#5/0.5. A5/1> r/0.5 D6/0.5. B5/0.5. r/0.5",
    "A5/0.5 Bb5/0.5 C6/0.5 D6/0.5 F6/1.5> D6/0.5",
    "E6/0.5. C6/0.5. A5/0.5. E5/0.5. G5/0.5g F#5/0.5 E5/1",
  ];
  const A_OPEN = A_BODY.concat(["D5/1.5_ r/0.5 D5/0.5. D5/0.5. D5/0.5. D5/0.5."]);
  const A_CLOSE = A_BODY.concat(["D6/0.5. B5/0.5. E5/0.5 F#5/0.5 G5/2>"]);
  const A_PH = [[0, 8], [8, 16], [16, 24], [24, 32]];

  const T_CH = "| Bbmaj7 | Gm7 | Cm7 | F7 | Dm7 G7 | Cm7 F7 | Ebmaj7 | D7sus4:1 D7:3 |";
  const T_CALLS = [
    "r/0.5 F5/0.5g D5/1~ F5/0.5~ Bb5/1.5~v",
    "A5/1~ G5/1f2 r/2",
    "r/0.5 G5/0.5g Eb5/1~ G5/0.5~ C6/1.5~v",
    "Bb5/1~ A5/1f2 r/2",
    "r/0.5 A5/0.5 F5/0.5 D5/0.5 F5/0.5~ B5/1.5>_",
    "Eb6/0.5. C6/0.5. G5/1~ A5/1 r/1",
    "Bb5/0.5 G5/0.5 D5/1~ F5/0.5~ G5/1.5~v",
    "A5/0.5~ G5/0.5~ F#5/1 r/0.5 D5/0.5. D5/0.5. D5/0.5.",
  ];
  const T_PH = [[0, 8], [8, 16], [16, 24], [24, 32]];

  const INTRO_CH = "| G6 | G6 | Am7 D7 | G6 |";
  const TAG_CH = "| Ebmaj7 | D7sus4:2 D7:2 | G6 | G6 |";
  const TAG_LINE = [
    "D5/0.5. D5/0.5. D5/0.5. D5/0.5. r/2",
    "r/2 D5/0.5. D5/0.5. D5/0.5. D5/0.5.",
    "G5/1> r/1 B4/0.5. B4/0.5. D5/1>",
    "r/1.5 G4/0.5. G4/0.5. G4/0.5. G4/1>",
  ];

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, how: "phrase" },
    { id: "A", bars: 8, how: "handoff" },
    { id: "T", bars: 8, pass: 0 },
    { id: "T", bars: 8, pass: 1 },
    { id: "A", bars: 8, how: "hocket" },
    { id: "A", bars: 8, how: "tutti", close: true },
    { id: "tag", bars: 4 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i];
    return { lap, i, f, off: bar, cil: cycle % LAP_CYCLES, lastHalf: bar + CB >= f.bars };
  }
  const progOf = (f) => T.progression(f.id === "intro" ? INTRO_CH : f.id === "A" ? (f.close ? A_CH_CLOSE : A_CH) : f.id === "T" ? T_CH : TAG_CH, BPB);

  // ranges (midi) and the dialogue voices
  const RANGE = { clar: [50, 82], fife: [67, 96], mand: [55, 91], tuba: [31, 50] };
  const VOICE = {
    clar: { track: "clar", range: RANGE.clar, gain: 1 },
    fife: { track: "fife", range: RANGE.fife, gain: 0.92 },
    mand: { track: "mand", range: RANGE.mand, gain: 0.9 },
  };
  const V = (...names) => names.map((n) => VOICE[n]);
  const ORDER = {
    phrase: [["clar", "fife", "clar", "mand"], ["fife", "clar", "mand", "clar"], ["mand", "clar", "fife", "fife"]],
    handoff: [["clar", "fife", "mand"], ["fife", "mand", "clar"], ["mand", "clar", "fife"]],
    hocket: [["mand", "fife", "clar"], ["fife", "mand", "clar"], ["clar", "mand", "fife"]],
    tag: [["clar", "fife", "mand"], ["mand", "clar", "fife"], ["fife", "mand", "clar"]],
  };
  // trio: who calls each phrase and who answers it (per pass, per lap)
  const CALLERS = [
    [["fife", "fife", "clar", "fife"], ["clar", "clar", "fife", "clar"], ["fife", "mand", "fife", "clar"]],
    [["clar", "fife", "mand", "clar"], ["mand", "fife", "clar", "fife"], ["clar", "clar", "mand", "fife"]],
  ];
  const ANSWERERS = [
    [["clar", "tuba", "mand", "clar"], ["fife", "mand", "tuba", "mand"], ["clar", "tuba", "clar", "mand"]],
    [["mand", "tuba", "fife", "fife"], ["fife", "tuba", "mand", "clar"], ["tuba", "mand", "fife", "clar"]],
  ];
  const TRANSFORMS = [{ steps: -2 }, { invert: true }, [{ tail: 3 }, { even: 0.5 }], { retrograde: true }, [{ steps: 2 }, { truncate: 3 }]];

  // ---------- helpers ----------
  /** phrasing notation -> dialogue notes (at in beats from the section start; the art marks ride along). */
  function toNotes(bars, velOf) {
    return P.line(bars, { beatsPerBar: BPB }).map((e) => ({ at: e.bar * BPB + e.beat, dur: e.dur, note: e.note, vel: velOf(e), art: e.art }));
  }
  const contour = (base) => (e) => base + (e.note - 76) / 150 + (e.dur >= 1.5 ? 0.03 : 0);
  const isWind = (t) => t === "clar" || t === "fife" || t === "tuba";

  /**
   * Realize the articulation marks per track (Sim.phrasing.articulate works on one monophonic line at a
   * time). Winds get phrase shaping; the mandolin only the per-note marks. Returns notes with at/bar/beat.
   */
  function articulateAll(notes, { scaleAt, legato = false, phrasesFor = null, r, orn = 0, firstAt = 0 }) {
    const byTrack = new Map();
    for (const n of notes) { if (!byTrack.has(n.track)) byTrack.set(n.track, []); byTrack.get(n.track).push(n); }
    const out = [];
    for (const [track, xs] of byTrack) {
      // generator ornaments on the winds: a grace from below on a leap, a mordent on a long held note (never on a marked note)
      if (isWind(track) && track !== "tuba" && orn > 0) {
        xs.sort((a, b) => a.at - b.at).forEach((e, i) => {
          const a = P.parseArt(e.art || "");
          if (a.grace != null || a.mordent || a.scoop || a.staccato || e.answer) return;
          const prev = xs[i - 1];
          const leap = prev ? e.note - prev.note : 0;
          if (e.at > firstAt + 0.5 && leap >= 4 && e.dur >= 1 && r.chance(orn * 0.6)) e.grace = "step";
          else if (e.dur >= 1.5 && !a.legato && r.chance(orn * 0.5)) e.mordent = true;
        });
      }
      let marks;
      if (phrasesFor === "none") marks = [];
      else {
        marks = P.phrases(xs, { beatsPerBar: BPB, gap: 0.75 }).map((ph) => ({ ...ph, dyn: "arch", legato: legato && isWind(track) }));
      }
      const done = P.articulate(xs, marks, {
        beatsPerBar: BPB, scale: scaleAt, lengthen: legato ? 1.08 : 1.04, breathLate: track === "tuba" ? 0.015 : 0.03,
        breathGap: 0.1, breathFirst: false, staccato: track === "mand" ? 0.6 : 0.45, accent: 0.1, overlap: 0.05,
      });
      for (const e of done) out.push({ ...e, track, at: e.bar * BPB + e.beat });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** Everything hand-written for one section of one lap, routed to tracks and articulated. */
  function planSection(f, lap, r) {
    const prog = progOf(f);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.max(0, Math.min(b, f.bars * BPB - 0.01))).chord).scale;
    const L = lap % 3;
    const orn = Math.min(0.35, 0.08 + 0.09 * lap);
    let notes = [], label = "";
    if (f.id === "intro") {
      if (lap > 0) for (let k = 0; k < 4; k++) notes.push({ at: 14 + k * 0.5, dur: 0.3, note: 74, vel: 0.5 + (k === 3 ? 0.08 : 0), track: "mand", staccato: true });
      label = lap === 0 ? "intro · tuba, guitar and brushes set up the stall" : "intro · the mandolin knocks";
      return { prog, notes: notes.map(withBar), label };
    }
    if (f.id === "A") {
      const tune = toNotes(f.close ? A_CLOSE : A_OPEN, contour(0.74));
      if (f.how === "phrase") {
        notes = D.distribute(tune, { voices: V("clar", "fife", "mand"), mode: "phrase", order: ORDER.phrase[L], rng: r, phrases: A_PH });
        label = "A · a phrase each: " + ORDER.phrase[L].join(", ");
      } else if (f.how === "handoff") {
        const join = L === 1 ? "double" : "extend";
        notes = D.distribute(tune, { voices: V(...ORDER.handoff[L]), mode: "handoff", join, overlap: 0.25, handoffDur: 1, handoffChance: 0.6, stay: 0.3, rng: r, phrases: A_PH });
        label = `A · handed off on the long notes${L === 1 ? ", doubled at the joins" : ""}`;
      } else if (f.how === "hocket") {
        const group = L === 1 ? 1 : 2;
        notes = D.distribute(tune, { voices: V(...ORDER.hocket[L]), mode: "hocket", group, rng: r, phrases: A_PH });
        label = `A · hocketed ${group === 1 ? "note by note" : "two notes at a time"} between the stalls`;
      } else {
        notes = tune.map((n) => ({ ...n, track: "fife", vel: n.vel + 0.03 }))
          .concat(tune.map((n) => ({ ...n, track: "clar", note: n.note - 12, vel: n.vel * 0.88 })))
          .concat(tune.map((n) => ({ ...n, track: "mand", dur: Math.min(n.dur, 0.5), vel: n.vel * 0.7, art: /\./.test(n.art || "") ? "." : "" })))
          .map(withBar);
        label = "A · all together: fife, clarinet an octave down, mandolin · closed ending";
      }
      const first = notes.length ? Math.min(...notes.map((n) => n.at)) : 0;
      notes = articulateAll(notes, { scaleAt, r, orn: f.how === "tutti" ? orn * 0.5 : orn, phrasesFor: f.how === "hocket" ? "none" : null, firstAt: first });
      return { prog, notes, label };
    }
    if (f.id === "T") {
      const calls = toNotes(T_CALLS, contour(0.72));
      const callers = CALLERS[f.pass][L], who = ANSWERERS[f.pass][L];
      notes = D.distribute(calls, { voices: V("fife", "clar", "mand"), mode: "phrase", order: callers, rng: r, phrases: T_PH });
      const responder = (i) => (who[i] === callers[i] ? (callers[i] === "clar" ? "fife" : "clar") : who[i]);
      const tf = (i) => TRANSFORMS[(i + lap + 2 * f.pass) % TRANSFORMS.length];
      notes = notes.concat(D.respond(calls, {
        track: responder, transform: tf,
        gap: (i, p) => { const e = Math.max(...p.map((n) => n.at + n.dur)); return Math.ceil(e * 2 - 1e-6) / 2 - e; }, // on the next 8th
        range: (i) => RANGE[responder(i)], minGap: 1.5, end: 32, breath: 0.3, scaleAt, vel: 0.58, phrases: T_PH, bpb: BPB,
      }).map((n) => {
        // dialogue.answer only shifts by two octaves at most; the tuba lives three below the fife
        if (n.track !== "tuba") return n;
        let note = n.note, shift = n.shift || 0;
        while (note > RANGE.tuba[1]) { note -= 12; shift -= 12; }
        while (note < RANGE.tuba[0]) { note += 12; shift += 12; }
        return { ...n, note, shift, vel: 0.72 };
      }));
      notes = articulateAll(notes, { scaleAt, legato: true, r, orn: orn * 0.6, firstAt: 0.5 });
      const names = { clar: "clarinet", fife: "fife", mand: "mandolin", tuba: "tuba" };
      label = `trio in Bb · ${names[callers[0]]} calls, ${[0, 1, 2].map(responder).filter((x, i, a) => a.indexOf(x) === i).map((x) => names[x]).join(" and ")} answer`;
      return { prog, notes, label };
    }
    // tag: the knocks traded one note at a time
    const line = toNotes(TAG_LINE, contour(0.7));
    notes = D.distribute(line, { voices: V(...ORDER.tag[L]), mode: "hocket", group: 1, rng: r, phrases: [[0, 8], [8, 16]] });
    notes = articulateAll(notes, { scaleAt, r, orn: 0, phrasesFor: "none" });
    label = "tag · the knocks traded, three low Gs: closed";
    return { prog, notes, label };
  }
  const withBar = (n) => { const bar = Math.floor(n.at / BPB + 1e-9); return { ...n, bar, beat: +(n.at - bar * BPB).toFixed(4) }; };

  // ---------- drums ----------
  const FILLS = [
    [[2.5, "brushTap", 0.42], [2.75, "brushTap", 0.44], [3, "brushTap", 0.5], [3.25, "brushTap", 0.52], [3.5, "brushTap", 0.58], [3.75, "brushTap", 0.62]],
    [[2, "tom", 0.45, 52], [2.5, "tom", 0.5, 48], [3, "brushTap", 0.55], [3.5, "tom", 0.6, 43]],
    [[3, "brushTap", 0.46], [3.25, "brushTap", 0.5], [3.5, "snap", 0.5], [3.75, "brushTap", 0.6]],
    [[2.5, "woodblock", 0.5], [3, "woodblock", 0.55], [3.5, "woodblock", 0.6], [3.75, "woodblock", 0.65]],
  ];
  const WB = [[0, 1.5, 2, 3.5], [0, 1, 1.5, 2.5, 3], [0, 1.5, 2.5, 3], [0.5, 1.5, 2, 3, 3.5]];

  const tempoAt = G.tempoScript(BPM, [{ at: 11, bpm: BPM + 4, rampBeats: 4, hold: true }, { at: 13, bpm: 118, rampBeats: 14 }]);

  Sim.register({
    id: "cheese-stall",
    title: "Noon at the Cheese Stall",
    genre: "Market town theme",
    about: "A bright weekday in a market town at 126, G major with a trio in Bb. A clarinet, a fife and a mandolin pass one quick-witted tune between the stalls (a phrase each, handed off on the long notes, hocketed two notes at a time) and answer each other's calls in the trio, down a third, upside down or backwards, with the tuba butting in; staccato knocks, a chromatic turn, a cheeky sidestep to bIII. Tuba oom, nylon-guitar pah, brushes with a woodblock, tambourine and triangle, a lift into the last chorus and a ritardando into the tag.",
    situations: ["shopping", "hangout", "explore"],
    energy: 0.55,
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.02, lowcut: 300, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.01, lowcut: 260, highcut: 7500 });
      const echo = I.delay(ctx, out, { time: "8n", feedback: 0.18, highcut: 3000 });
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };

      /** Clarinet: odd-harmonic loop, a formant peak, quick tongue; the phrasing wrapper does the rest. */
      const clarSynth = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.05, 0.5, 0.04, 0.3, 0.03, 0.13, 0.02, 0.06] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.9 },
        envelope: { attack: 0.03, decay: 0.15, sustain: 0.85, release: 0.16 },
        filterEnvelope: { attack: 0.03, decay: 0.25, sustain: 0.65, release: 0.2, baseFrequency: 520, octaves: 2.2 },
      }));
      const clar = P.wrap(ctx, clarSynth, {
        volume: -11, glide: 0.035, scoopTime: 0.07, fallTime: 0.2, release: 0.16, staccatoRelease: 0.04, accentBright: 0.5,
        vibrato: { rate: 5.2, depth: 0.045, delay: 0.35, rise: 0.35 },
        breath: P.breath(ctx, room, { level: -30, freq: 2000, length: 0.14 }),
      });
      const clarLp = ctx.keep(new Tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -12 })); clar.out.connect(clarLp);
      const clarP = pan(clarLp, -0.26);
      /** Fife: a nearly pure loop with a chiff and more breath. */
      const fifeSynth = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.22, 0.07, 0.025, 0.01] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
        envelope: { attack: 0.018, decay: 0.12, sustain: 0.82, release: 0.14 },
        filterEnvelope: { attack: 0.012, decay: 0.2, sustain: 0.6, release: 0.2, baseFrequency: 1100, octaves: 1.8 },
      }));
      const fife = P.wrap(ctx, fifeSynth, {
        volume: -12, glide: 0.03, scoopTime: 0.06, fallTime: 0.18, release: 0.14, staccatoRelease: 0.035, accentBright: 0.4,
        vibrato: { rate: 5.6, depth: 0.05, delay: 0.3, rise: 0.3 },
        breath: P.breath(ctx, room, { level: -26, freq: 3000, length: 0.12 }),
      });
      const fifeP = pan(fife.out, 0.28);
      /** Tuba: round partials, a slow-ish lip attack, no vibrato to speak of. */
      const tubaSynth = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.6, 0.38, 0.22, 0.12, 0.06, 0.03] },
        filter: { type: "lowpass", rolloff: -24, Q: 1.0 },
        envelope: { attack: 0.028, decay: 0.3, sustain: 0.7, release: 0.12 },
        filterEnvelope: { attack: 0.02, decay: 0.25, sustain: 0.45, release: 0.15, baseFrequency: 120, octaves: 2.4 },
      }));
      const tuba = P.wrap(ctx, tubaSynth, { volume: -9, glide: 0.05, scoopTime: 0.08, fallTime: 0.2, release: 0.12, staccatoRelease: 0.05, vibrato: { rate: 4.6, depth: 0.02, delay: 0.6 } });
      const tubaP = pan(tuba.out, 0.02);

      const mand = I.guitar(ctx, { kind: "steel", volume: -4 });
      const gtr = I.nylon(ctx, { volume: -8, cutoff: 3800 });
      const glock = I.glock(ctx, { volume: -17, celesta: true, decay: 1.2 });
      const kit = I.kit(ctx, { volume: -2, preload: ["softKick", "brushTap", "brushSweep", "rim", "woodblock", "tambourine", "shaker", "triangle", "tom", "snap"] });

      const mdP = I.place(ctx, mand, 0.12, out), gtP = I.place(ctx, gtr, -0.14, out), glP = I.place(ctx, glock, 0.34, out), ktP = I.place(ctx, kit, 0.04, out);
      I.send(ctx, clarP, hall, -14); I.send(ctx, clarP, room, -16);
      I.send(ctx, fifeP, hall, -12); I.send(ctx, fifeP, echo, -20);
      I.send(ctx, mdP, room, -13); I.send(ctx, mdP, hall, -18);
      I.send(ctx, gtP, room, -15);
      I.send(ctx, glP, hall, -10);
      I.send(ctx, tubaP, room, -24);
      I.send(ctx, ktP, room, -16);

      return {
        clar: { layer: "melody", play: (t, e, d) => clar.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        fife: { layer: "melody", play: (t, e, d) => fife.play(t, e, d), humanize: { timing: 0.007, vel: 0.05 } },
        mand: { layer: "melody", play: (t, e, d) => mand.play(t, e.note, d, e.vel, e.strum ?? 0), humanize: { timing: 0.005, vel: 0.06 } },
        gtr: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, e.strum ?? 0), humanize: { timing: 0.008, vel: 0.07 } },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        tuba: { layer: "bass", play: (t, e, d) => tuba.play(t, e, d), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.08 } },
        perc: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, off, cil, lastHalf } = W;
      const L = lap % 3;
      const key = `${lap}:${W.i}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...planSection(f, lap, r.fork(7 + W.i)) };
      const { prog, notes, label } = state.plan;
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const trio = f.id === "T", tutti = f.how === "tutti", intro = f.id === "intro", tag = f.id === "tag";

      // ---------- the dialogue (hand-written, routed, articulated) ----------
      const STRIP = new Set(["at", "bar", "beat", "idx", "track", "note", "dur", "vel", "phrase", "voice", "shift", "entrance", "handoff", "join", "answer", "art", "split"]);
      for (const n of notes) {
        if (n.at < s0 - 1e-6 || n.at >= s1 - 1e-6) continue;
        if (cycle === 0 && n.at < 0) continue;
        const extra = {};
        for (const k in n) if (!STRIP.has(k) && n[k] !== undefined) extra[k] = n[k];
        push(n.track, n.at - s0, n.dur, n.note, n.vel, extra);
      }
      const busy = (track, bar) => notes.some((n) => n.track === track && n.at < (bar + 1) * BPB && n.at + n.dur > bar * BPB + 0.1);
      const chords = prog.filter((h) => h.bar >= off && h.bar < off + CB);

      // ---------- guitar: pah on 2 and 4; broken chords in the trio ----------
      chords.forEach((h) => {
        const s = h.bar * BPB + h.beat - s0, d = h.dur;
        if (intro && lap === 0 && h.bar === 0) return;
        if (tag && h.bar === 3) return; // the guitar stops for the three low Gs
        if (trio) {
          const v = T.voice(h.chord, { lo: 52, hi: 72, n: 4, prev: state.gtrPrev, rng: r, omitBass: true, top: [64, 72] });
          state.gtrPrev = v;
          const u = v.slice().sort((a, b) => a - b);
          const cyc = u.concat(u.slice(1, -1).reverse()); // up and down
          for (let k = 0; k * 0.5 < d - 1e-6; k++) push("gtr", s + k * 0.5, 0.62, cyc[k % cyc.length], 0.34 + (k % 2 === 0 ? 0.04 : 0) + (k === 0 ? 0.03 : 0));
          if (f.pass === 1 || lap > 0) push("glock", s, Math.min(d, 2), u[u.length - 1] + 12, 0.26);
        } else {
          const v = T.voice(h.chord, { lo: 55, hi: 74, n: 3, prev: state.gtrPrev, rng: r, omitBass: true, top: [62, 74] });
          state.gtrPrev = v;
          const vv = tag ? 0.36 : 0.42;
          for (let b = 1; b < d; b += 2) push("gtr", s + b, 0.3, v, vv, { strum: 0.012 });
          if ((tutti || f.how === "handoff") && d >= 4 && r.chance(tutti ? 0.5 : 0.25)) push("gtr", s + 3.5, 0.25, v, vv - 0.08, { strum: 0.01 });
        }
      });

      // ---------- tuba: oom (root) and the fifth, approach notes into the changes ----------
      {
        let last = state.tubaLast ?? 43;
        chords.forEach((h, i) => {
          const s = h.bar * BPB + h.beat - s0, d = h.dur, c = T.chord(h.chord);
          if (trio && busy("tuba", h.bar)) { // the tuba is answering a call here: the oom only until it starts talking
            const ans = notes.filter((n) => n.track === "tuba" && n.at >= h.bar * BPB + h.beat && n.at < h.bar * BPB + h.beat + d).map((n) => n.at);
            const firstAns = ans.length ? Math.min(...ans) - (h.bar * BPB + h.beat) : d;
            if (firstAns >= 0.6) { const R0 = T.nearest(last, [c.bass], 31, 47); push("tuba", s, Math.min(0.7, firstAns - 0.15), R0, 0.74); last = R0; }
            return;
          }
          if (tag && h.bar === 3) { // the three low Gs with the hocket
            [1.5, 2, 2.5].forEach((b) => push("tuba", s + b, 0.3, 31, 0.7, { staccato: true }));
            push("tuba", s + 3, 1, 31, 0.78, { accent: true });
            last = 31; return;
          }
          const R = T.nearest(last, [c.bass], 31, 47);
          const fifthPc = mod12(c.bass + 7);
          const fifth = R >= 40 ? T.nearest(R - 5, [fifthPc], 31, 47) : T.nearest(R + 7, [fifthPc], 31, 47);
          const nextH = i + 1 < chords.length ? chords[i + 1] : prog.find((x) => x.bar === off + CB) || null;
          const nextPc = nextH ? T.chord(nextH.chord).bass : f.id === "tag" ? 7 : 7;
          const tgt = T.nearest(R, [nextPc], 31, 47);
          const soft = intro || trio;
          push("tuba", s, soft ? 0.7 : 0.6, R, 0.8 - (soft ? 0.06 : 0), { staccato: !soft });
          if (d >= 4) push("tuba", s + 2, soft ? 0.7 : 0.6, fifth, 0.68, { staccato: !soft });
          else if (d >= 2 && !soft) push("tuba", s + 1, 0.5, fifth, 0.62, { staccato: true });
          const changes = tgt !== R;
          if (changes && r.chance(trio ? 0.3 : 0.55)) {
            const ap = r.weighted([[tgt - 1, 2], [tgt + 1, 1.2], [tgt + 2, 1.3], [fifth, d >= 4 ? 1 : 0]]);
            push("tuba", s + d - 0.5, 0.42, Math.max(29, ap), 0.6, { staccato: true });
          } else if (!changes && (tutti || f.how === "handoff") && d >= 4 && r.chance(0.3)) {
            push("tuba", s + 3.5, 0.4, R + 12 <= 50 ? R + 12 : R, 0.5, { staccato: true });
          }
          last = R;
        });
        state.tubaLast = last;
      }

      // ---------- glock doubles the fife in the tutti ----------
      if (tutti) for (const n of notes) if (n.track === "fife" && n.at >= s0 - 1e-6 && n.at < s1 - 1e-6 && (n.staccato || n.accent) && n.dur <= 1.1) push("glock", n.at - s0, Math.min(n.dur, 0.6), n.note, 0.28);

      // ---------- drums ----------
      const fillBar = lastHalf;
      const wbPat = WB[(lap + W.i) % WB.length];
      for (let bar = 0; bar < CB; bar++) {
        const sb = off + bar, first = sb === 0 && bar === 0;
        const hit = (track, b, voice, v, extra) => push(track, bar * BPB + b, 0.25, voice, v, extra);
        const isFill = fillBar && bar === CB - 1;
        // kick and brushes
        if (!(intro && lap === 0 && sb === 0)) {
          hit("drums", 0, "softKick", intro || trio ? 0.66 : 0.76);
          hit("drums", 2, "softKick", intro || trio ? 0.58 : 0.66);
          if ((f.how === "handoff" || tutti) && r.chance(0.3)) hit("drums", 2.5, "softKick", 0.5);
          const back = f.how === "hocket" ? "rim" : "brushTap";
          hit("drums", 1, back, trio ? 0.5 : 0.62); hit("drums", 3, back, trio ? 0.5 : 0.62);
          if (!trio && r.chance(0.45)) hit("drums", r.pick([0.75, 2.75, 1.5]), "brushTap", 0.3, { ghost: true });
          if (trio || f.how === "handoff") for (let b = 0.5; b < 4; b += 1) hit("drums", b, "brushSweep", trio ? 0.4 : 0.3);
        }
        // woodblock
        const wbOn = !(trio && f.pass === 0) && !(intro && lap === 0 && sb < 2);
        if (wbOn && !isFill) wbPat.forEach((b) => { if (!(intro && sb === 3 && b >= 2)) hit("perc", b, "woodblock", 0.52); });
        if (intro && sb === 3) [2, 2.5, 3, 3.5].forEach((b, k) => hit("perc", b, "woodblock", 0.56 + (k === 3 ? 0.1 : 0)));
        if (tag && sb === 3) [1.5, 2, 2.5].forEach((b) => hit("perc", b, "woodblock", 0.5));
        // tambourine, shaker, triangle
        if ((trio && f.pass === 1) || tutti) for (let b = 0; b < 4; b += 0.5) hit("perc", b, "tambourine", 0.4);
        if (f.how === "handoff" || f.how === "hocket") for (let b = 0; b < 4; b += 0.5) hit("perc", b, "shaker", b % 1 === 0 ? 0.34 : 0.26);
        if (sb === 0 && bar === 0 && !intro) hit("perc", 0, "triangle", 0.5);
        if (f.id === "A" && sb === 5 && bar === 0) hit("perc", 0, "triangle", 0.42); // the sidestep to Bbmaj7
        if (tag && sb === 3) hit("perc", 3, "triangle", 0.5);
        // fill
        if (isFill && !tag) {
          const fill = FILLS[r.weighted([[0, 3], [1, tutti || f.how === "handoff" ? 2 : 0.6], [2, 2], [3, 1.5]])];
          fill.forEach(([b, voice, v, pitch]) => hit(voice === "woodblock" ? "perc" : "drums", b, voice, v, pitch ? { pitch } : undefined));
        }
        void first;
      }

      // ---------- feel: everything above is on the grid; Sim.groove moves it ----------
      let evs = G.ghosts(ev, { track: "drums", vel: 0.22, dur: 0.08 });
      evs = G.accents(evs, { track: "perc", voices: ["woodblock"], pattern: [1, 0.78, 0.9, 0.74], unit: 0.5 });
      evs = G.accents(evs, { track: "perc", voices: ["tambourine"], pattern: [0.82, 0.68, 1, 0.68], unit: 0.5 });
      if (fillBar && !tag) evs = G.crescendo(evs, { track: "drums", from: (CB - 1) * BPB + 2, to: CB * BPB, v0: 0.85, v1: 1.18, curve: 1.2 });
      evs = G.apply(evs, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { brushTap: "laidback", rim: "laidback", brushSweep: "pushed", softKick: "straight", tom: "laidback", snap: "laidback" } },
          perc: { voices: { woodblock: { template: "mpc54", late: 2 }, tambourine: "pushed", shaker: "mpc58", triangle: "straight" } },
          tuba: { template: "boogie", late: 2, vels: false },
          gtr: { template: trio ? "mpc54" : "boogie", late: 8, vels: false },
          mand: { template: "mpc54", late: 4, vels: false },
        },
      });
      if (trio) {
        evs = G.rubato(evs, { track: "fife", bpm: BPM, bpb: BPB, amount: 0.45, linger: "high", lingerMs: 40, rng: r });
        evs = G.rubato(evs, { track: "clar", bpm: BPM, bpb: BPB, amount: 0.4, linger: "high", lingerMs: 36, rng: r });
      }

      // ---------- tempo: a lift into the last chorus, a ritardando into the tag, a tempo at the top ----------
      let tempo = tempoAt(cil);
      if (!tempo && cil === 0 && lap > 0) tempo = { bpm: BPM, rampBeats: 0 };

      const harmony = chords.map((h) => ({ bar: h.bar - off, beat: h.beat, dur: h.dur, chord: h.chord }));
      return { events: evs, harmony, section: `${label} · lap ${lap + 1}`, tempo: tempo || undefined };
    },
  });
})();

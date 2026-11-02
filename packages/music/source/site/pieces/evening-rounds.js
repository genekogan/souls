// Evening Rounds: a chamber tune that is never played by one instrument alone. D major, 92 bpm.
//
// Four players (a double reed, a bottle flute, a celesta, a cello) with drums and a fingered bass
// pass one tune around the way a SimCity or Pilotwings arrangement orchestrates a melody: a phrase
// each, then mid-phrase handoffs on the long notes, then calls answered in the rests, then the tune
// hocketed two notes at a time and split by register, and at last everyone together. Built on
// Sim.dialogue (distribute / respond / separate): the generator chooses who speaks, the ornaments,
// the fills and the comping; the notes of the tune never change.
//
// THE TUNE (fixed by hand; beats are counted from the start of the 8-bar section)
//   A: | Dmaj9 | F#m7 | Gmaj9 | A13sus4 | Bm9 | Bm7/A | Gmaj7 Gm6 | D/A A7sus4 |   (close: | Gmaj7 Gm6 | D6/9 |)
//     p0 (bars 1-2)  A4 B4 D5 F#5 | E5 C#5 A4 .        a rise of a sixth, a fall back to the fifth
//     p1 (bars 3-4)  B4 D5 G5 F#5 | E5 D5 B4 .         the same shape a step up, over IV and V
//     p2 (bars 5-6)  F#5 A5 B5 A5 F#5 | E5 F#5 D5 C#5   the peak on B5, settling onto the 9th of Bm
//     p3 (bars 7-8)  D5 E5 F#5 E5 D5 Bb4 | A4 . . .     the sigh: Bb over borrowed iv, a long rest for an answer
//     counter (cello, half notes): F#4 E4 | C#4 A3 | D4 B3 | G4 E4 | D4 F#4 | A4 F#4 | B3 Bb3 | A3 G3
//   B: | Bm9 | Bm9/A | Gmaj9 | Gmaj9/B | Em9 | Em9/D | Fmaj7#11 | A13sus4 |   calls in the odd bars, answers in the even
//     c0 F#5 D5 B4 C#5   c1 G5 D5 B4 A4   c2 E5 G5 F#5 B5   c3 A5 G5 E5 B4  (the bIII lydian bar, B = #11)
//     the answers are derived: down a third, inverted, up a step and cut short, backwards; they are snapped
//     to the chord scale of their own bar and may only sound while the caller rests.
//   Bridge (A pedal): | Gmaj9/A | Dmaj9/A | Em9/A | A13sus4 | Fmaj7#11/A | Gm6/A | Dmaj9/A | A7sus4 |
//     a broken-chord line in 8ths split by register between celesta and flute (or hocketed two by two);
//     the cello sings p0 twice as slow, the reed answers it inverted, an octave up.
//   Tag: | Gm6/D | D6/9 | Gmaj9/A | A7sus4 |   E5 D5 Bb4 A4 (the sigh) answered by F#4 A4 B4 D5 (a rise)
//   One lap: intro 4 · A 8 (a phrase each) · A 8 (handoffs) · B 8 (call and response) · A 8 (hocket, then by
//   register, cello counter) · bridge 8 · A 8 (tutti, closed ending) · tag 4 = 56 bars ≈ 2:26. Laps rotate who
//   starts, the join style, the responders, the drum weight; rng chooses fills, comping and ornaments.
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue;
  const { mod12 } = T;
  const BPB = 4, CB = 4;
  const N = (s) => T.midi(s);

  // ---------- notation: phrases of "Note at dur, ..." (at in beats from the section start) ----------
  function line(phraseTexts, k = 0) {
    const out = [];
    phraseTexts.forEach((txt, pi) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => { const [n, b, d] = tok.trim().split(/\s+/); out.push({ at: +b, dur: +d, note: N(n) + k, phrase: pi }); });
    });
    return out;
  }

  // ---------- the score ----------
  const A_CH = "| Dmaj9 | F#m7 | Gmaj9 | A13sus4 | Bm9 | Bm7/A | Gmaj7 Gm6 | D/A A7sus4 |";
  const A_CH_CLOSE = "| Dmaj9 | F#m7 | Gmaj9 | A13sus4 | Bm9 | Bm7/A | Gmaj7 Gm6 | D69 |";
  const A_P = [
    "A4 0 1, B4 1 .5, D5 1.5 1.5, F#5 3 1, E5 4 1.5, C#5 5.5 .5, A4 6 1.5",
    "B4 8 1, D5 9 .5, G5 9.5 1.5, F#5 11 1, E5 12 1, D5 13 .5, B4 13.5 1.5",
    "F#5 16 1.5, A5 17.5 .5, B5 18 1, A5 19 .5, F#5 19.5 .5, E5 20 1, F#5 21 .5, D5 21.5 .5, C#5 22 1.5",
  ];
  const A_P3_OPEN = "D5 24 1, E5 25 .5, F#5 25.5 .5, E5 26 .5, D5 26.5 .5, Bb4 27 1, A4 28 1.5";
  const A_P3_CLOSE = "D5 24 1, E5 25 .5, F#5 25.5 .5, E5 26 .5, D5 26.5 .5, Bb4 27 1, A4 28 1, F#4 29 1, D5 30 2";
  const A_TUNE = line(A_P.concat([A_P3_OPEN]));
  const A_TUNE_CLOSE = line(A_P.concat([A_P3_CLOSE]));
  const A_CNT = line([
    "F#4 0 2, E4 2 2, C#4 4 2, A3 6 2", "D4 8 2, B3 10 2, G4 12 2, E4 14 2",
    "D4 16 2, F#4 18 2, A4 20 2, F#4 22 2", "B3 24 2, Bb3 26 2, A3 28 2, G3 30 2",
  ]);
  const A_CNT_CLOSE = line([
    "F#4 0 2, E4 2 2, C#4 4 2, A3 6 2", "D4 8 2, B3 10 2, G4 12 2, E4 14 2",
    "D4 16 2, F#4 18 2, A4 20 2, F#4 22 2", "B3 24 2, Bb3 26 2, A3 28 2, F#3 30 2",
  ]);

  const B_CH = "| Bm9 | Bm9/A | Gmaj9 | Gmaj9/B | Em9 | Em9/D | Fmaj7#11 | A13sus4 |";
  const B_CALLS = line([
    "F#5 0 1, D5 1 .5, B4 1.5 .5, C#5 2 1.5",
    "G5 8 1, D5 9 .5, B4 9.5 .5, A4 10 1.5",
    "E5 16 1, G5 17 .5, F#5 17.5 .5, B5 18 1.5",
    "A5 24 1.5, G5 25.5 .5, E5 26 1, B4 27 1",
  ]);

  const BR_CH = "| Gmaj9/A | Dmaj9/A | Em9/A | A13sus4 | Fmaj7#11/A | Gm6/A | Dmaj9/A | A7sus4 |";
  // the broken-chord line, 8ths, one bar per chord
  const ARP = {
    "Gmaj9/A": "G4 B4 D5 F#5 A5 F#5 D5 B4", "Dmaj9/A": "F#4 A4 C#5 E5 A5 E5 C#5 A4", "Em9/A": "E4 G4 B4 D5 F#5 D5 B4 G4",
    A13sus4: "G4 A4 D5 E5 G5 E5 D5 A4", "Fmaj7#11/A": "F4 A4 C5 E5 G5 E5 C5 A4", "Gm6/A": "G4 Bb4 D5 E5 G5 E5 D5 Bb4",
    A7sus4: "G4 A4 D5 E5 G5 E5 D5 A4", "Gm6/D": "G4 Bb4 D5 E5 G5 E5 D5 Bb4", D69: "F#4 A4 B4 E5 A5 E5 B4 A4",
  };
  function arpLine(prog) {
    const out = [];
    prog.forEach((h) => {
      const names = ARP[h.chord];
      if (!names) return;
      names.split(/\s+/).forEach((n, i) => { if (i * 0.5 < h.dur) out.push({ at: h.bar * BPB + h.beat + i * 0.5, dur: 0.5, note: N(n), phrase: h.bar }); });
    });
    return out;
  }

  const INTRO_CH = "| Dmaj9/A | Gmaj9/A | Dmaj9/A | A13sus4 |";
  const TAG_CH = "| Gm6/D | D69 | Gmaj9/A | A7sus4 |";
  const TAG_LINE = line(["E5 0 .5, D5 .5 .5, Bb4 1 1, A4 2 2", "F#4 4 .5, A4 4.5 .5, B4 5 1, D5 6 2"]);

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, how: "phrase" },
    { id: "A", bars: 8, how: "handoff" },
    { id: "B", bars: 8 },
    { id: "A", bars: 8, how: "hocket" },
    { id: "BR", bars: 8 },
    { id: "A", bars: 8, how: "tutti", close: true },
    { id: "TAG", bars: 4 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i];
    return { lap, i, f, off: bar, half: bar / CB, lastHalf: bar + CB >= f.bars };
  }
  const progOf = (f) => T.progression(f.id === "intro" ? INTRO_CH : f.id === "A" ? (f.close ? A_CH_CLOSE : A_CH) : f.id === "B" ? B_CH : f.id === "BR" ? BR_CH : TAG_CH, BPB);

  // ranges (midi) and colours
  const RANGE = { reed: [62, 83], flute: [69, 96], cel: [60, 96], cello: [48, 69], bass: [33, 52] };
  const VOICE = {
    reed: { track: "reed", range: RANGE.reed, gain: 1 },
    flute: { track: "flute", range: RANGE.flute, gain: 0.9 },
    cel: { track: "cel", range: RANGE.cel, gain: 0.82 },
    cello: { track: "cello", range: RANGE.cello, gain: 0.95 },
  };
  const V = (...names) => names.map((n) => VOICE[n]);
  // who starts each section, per lap (the lap index rotates these)
  const ORDER = {
    phrase: [["reed", "flute", "cel", "reed"], ["flute", "cello", "reed", "cel"], ["cel", "reed", "flute", "cello"]],
    B: [["reed", "reed", "reed", "flute"], ["flute", "flute", "cello", "reed"], ["cel", "reed", "cel", "flute"]],
    tag: [["flute", "reed"], ["cello", "flute"], ["reed", "cel"]],
  };
  const ANSWERERS = [["cello", "flute", "cel", "cello"], ["reed", "cel", "flute", "cel"], ["flute", "cello", "reed", "cello"]];
  const TRANSFORMS = [{ steps: -2 }, { invert: true }, { steps: 2, truncate: 3 }, { retrograde: true }];

  /** Everything hand-written for one section of one lap, already routed to tracks (at = beats from the section start). */
  function planSection(f, lap, r) {
    const prog = progOf(f);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(b).chord).scale;
    const L = lap % 3;
    const notes = [];
    const base = 0.74;
    const vel = (xs, v) => xs.map((n) => ({ ...n, vel: n.vel ?? v }));
    let label = "";
    if (f.id === "intro") {
      const arp = arpLine(prog);
      if (lap === 0) notes.push(...D.distribute(arp, { voices: [{ track: "celTex", range: [55, 96] }], mode: "interval", vel: 0.34 }));
      else notes.push(...D.distribute(arp, { voices: [{ track: "celTex", range: [55, 96] }, { track: "fluteTex", range: [74, 96], gain: 0.7 }], mode: "interval", pivot: 74, vel: 0.36 }));
      label = lap === 0 ? "intro · celesta over the A pedal" : "intro · celesta and flute share the broken chord";
    } else if (f.id === "A" && f.how === "phrase") {
      const tune = vel(A_TUNE, base);
      notes.push(...D.distribute(tune, { voices: V("reed", "flute", "cel", "cello"), mode: "phrase", order: ORDER.phrase[L], rng: r }));
      label = "A · a phrase each · " + ORDER.phrase[L].join(", ");
    } else if (f.id === "A" && f.how === "handoff") {
      const tune = vel(A_TUNE, base);
      const voices = L === 1 ? V("flute", "cel", "reed") : L === 2 ? V("cel", "reed", "flute") : V("reed", "flute", "cel");
      notes.push(...D.distribute(tune, { voices, mode: "handoff", join: L === 1 ? "double" : "extend", overlap: 0.3, handoffDur: 1.5, stay: 0.3, rng: r }));
      // the bass answers the sigh in the long rest at the end
      notes.push(...D.respond(A_TUNE, { track: "bassAns", transform: { tail: 3 }, minGap: 2, end: 32, gap: 0, scaleAt, range: RANGE.bass, vel: 0.7, breath: 0.4 }));
      label = `A · handed off on the long notes${L === 1 ? ", doubled at the joins" : ""} · the bass answers`;
    } else if (f.id === "B") {
      const calls = vel(B_CALLS, base + 0.02);
      notes.push(...D.distribute(calls, { voices: V("reed", "flute", "cel", "cello"), mode: "phrase", order: ORDER.B[L], rng: r }));
      const who = ANSWERERS[L];
      const responder = (i) => (who[i] === ORDER.B[L][i] ? "cel" : who[i]);
      notes.push(...D.respond(B_CALLS, {
        track: responder,
        transform: (i) => TRANSFORMS[(i + lap) % TRANSFORMS.length],
        gap: (i, p) => { const e = Math.max(...p.map((n) => n.at + n.dur)); return Math.ceil(e - 1e-6) - e; }, // on the next downbeat
        range: (i) => RANGE[responder(i)],
        minGap: 1, end: 32, breath: 0.3, scaleAt, vel: 0.56,
      }));
      label = "B · calls and answers: down a third, inverted, cut short, backwards";
    } else if (f.id === "A" && f.how === "hocket") {
      const tune = vel(A_TUNE, base);
      const first = tune.filter((n) => n.phrase < 2), peak = tune.filter((n) => n.phrase === 2), sigh = tune.filter((n) => n.phrase === 3);
      const pair = L === 2 ? V("cel", "flute") : V("reed", "flute");
      notes.push(...D.distribute(first, { voices: pair, mode: "hocket", group: 2, rng: r }));
      notes.push(...D.distribute(peak, { voices: L === 1 ? V("cel", "flute") : V("reed", "flute"), mode: "interval", pivot: 76 }));
      notes.push(...D.distribute(sigh, { voices: V("reed", "flute", "cel"), mode: "phrase", order: [["cel", "flute", "reed"][L]] }));
      // the cello's counter-line, kept out of the way
      notes.push(...D.separate(tune, vel(A_CNT, 0.42), { range: RANGE.cello, prefer: "below", min: 3 }).map((n) => ({ ...n, track: "cello" })));
      notes.push(...D.respond(A_TUNE, { track: "bassAns", transform: { tail: 3, retrograde: true }, minGap: 2, end: 32, scaleAt, range: RANGE.bass, vel: 0.7, breath: 0.4 }));
      label = "A · hocketed two notes at a time, then split by register · cello counter-line";
    } else if (f.id === "BR") {
      const arp = arpLine(prog);
      if (L === 1) notes.push(...D.distribute(arp, { voices: [{ track: "celTex", range: [55, 96] }, { track: "fluteTex", range: [74, 96], gain: 0.7 }], mode: "hocket", group: 2, vel: 0.36 }));
      else notes.push(...D.distribute(arp, { voices: [{ track: "celTex", range: [55, 96] }, { track: "fluteTex", range: [74, 96], gain: 0.7 }], mode: "interval", pivot: 74, vel: 0.38 }));
      const slow = D.answer(A_TUNE.filter((n) => n.phrase === 0), { track: "cello", transform: { augment: 2 }, at: 0, scaleAt, range: RANGE.cello, vel: 0.5 });
      notes.push(...slow);
      notes.push(...D.answer(slow, { track: L === 2 ? "flute" : "reed", transform: { invert: true }, at: 16, before: 32, breath: 0.5, scaleAt, range: L === 2 ? RANGE.flute : RANGE.reed, vel: 0.66 }));
      label = `bridge · the cello sings the tune twice as slow, the ${L === 2 ? "flute" : "reed"} answers it inverted`;
    } else if (f.id === "A" && f.how === "tutti") {
      const tune = vel(A_TUNE_CLOSE, base + 0.04);
      notes.push(...tune.map((n) => ({ ...n, track: "reed" })));
      notes.push(...tune.map((n) => ({ ...n, track: "flute", note: n.note + (n.phrase === 2 ? 0 : 12), vel: 0.5 }))); // at pitch on the peak phrase
      notes.push(...tune.map((n) => ({ ...n, track: "cel", dur: Math.min(n.dur, 0.6), vel: 0.4 })));
      notes.push(...D.separate(tune, vel(A_CNT_CLOSE, 0.5), { range: RANGE.cello, prefer: "below", min: 3 }).map((n) => ({ ...n, track: "cello" })));
      label = "A · all together: reed, flute an octave up, celesta, cello counter · the closed ending";
    } else {
      notes.push(...D.distribute(vel(TAG_LINE, 0.62), { voices: V("reed", "flute", "cel", "cello"), mode: "phrase", order: ORDER.tag[L], rng: r }));
      notes.push(...D.distribute(arpLine(prog).filter((n) => n.at >= 8), { voices: [{ track: "celTex", range: [55, 96] }], mode: "interval", vel: 0.3 }));
      label = "tag · the sigh and its answer, handed over";
    }
    return { prog, notes: notes.map((n) => withBar(n)), label };
  }
  const withBar = (n) => { const bar = Math.floor(n.at / BPB + 1e-9); return { ...n, bar, beat: +(n.at - bar * BPB).toFixed(4) }; };

  // ---------- drums ----------
  const FILLS = [
    [[2.5, "snare", 0.42], [3, "snare", 0.46], [3.5, "tom", 0.55, 50], [3.75, "tom", 0.6, 45]],
    [[3, "snare", 0.4], [3.25, "snare", 0.44], [3.5, "snare", 0.5], [3.75, "tom", 0.58, 45]],
    [[2, "tom", 0.45, 52], [2.5, "tom", 0.5, 48], [3, "snare", 0.52], [3.5, "tom", 0.58, 43]],
    [[3, "rim", 0.4], [3.5, "rim", 0.44], [3.75, "hatOpen", 0.36]],
  ];

  Sim.register({
    id: "evening-rounds",
    title: "Evening Rounds",
    genre: "Chamber theme",
    about: "A warm D-major tune for a small ensemble that never lets one instrument play it alone: a double reed, a bottle flute, a celesta and a cello take a phrase each, hand it over on the long notes, answer each other's calls in the rests, hocket it two notes at a time, split it by register, and finally play it together over a borrowed-iv sigh. Fingered bass and a soft kit; a 56-bar lap whose roles rotate.",
    situations: ["hangout", "explore", "presentation"],
    energy: 0.45,
    bpm: 92, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const G = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };
      const hall = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.028, lowcut: 320, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.012, lowcut: 260, highcut: 7000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.22, highcut: 3200 });

      /** A monophonic wind: custom partials, a formant peak, breath noise, vibrato that arrives late. */
      function wind(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12, Q: 0.5 })).connect(g);
        let dest = lp;
        if (o.formant) { const f = ctx.keep(new Tone.Filter({ frequency: o.formant, type: "peaking", Q: o.formantQ ?? 1.3, gain: o.formantGain ?? 6 })).connect(lp); dest = f; }
        const s = ctx.keep(new Tone.MonoSynth({
          portamento: o.glide ?? 0.02,
          oscillator: { type: "custom", partials: o.partials },
          filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
          envelope: { attack: o.attack, decay: 0.2, sustain: 0.84, release: o.release ?? 0.18 },
          filterEnvelope: { attack: o.attack * 1.2, decay: 0.35, sustain: 0.6, release: 0.25, baseFrequency: o.base, octaves: o.octaves ?? 2 },
        })).connect(dest);
        const bp = ctx.keep(new Tone.Filter({ frequency: o.breathFreq, type: "bandpass", Q: 0.9 })).connect(lp);
        const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.015, decay: o.breathDecay ?? 0.12, sustain: 0.06, release: 0.15 } })).connect(bp);
        breath.volume.value = o.breath;
        const lfo = ctx.keep(new Tone.LFO({ frequency: o.vibRate, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0)); // cents
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g), safeB = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const m = arr(e.note)[0];
            if (typeof m !== "number") return;
            const tt = safe(t), f = hz(m);
            s.triggerAttackRelease(f, d, tt, e.vel);
            if (e.scoop) { s.frequency.setValueAtTime(hz(m - e.scoop), tt + 0.001); s.frequency.exponentialRampToValueAtTime(f, tt + 0.08); }
            breath.triggerAttackRelease(Math.min(0.15, d), safeB(t), e.vel * (e.entrance ? 0.9 : 0.6));
            const p = depth.gain;
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > o.vibDelay + 0.2) { p.setValueAtTime(0, tt + o.vibDelay); p.linearRampToValueAtTime(o.vibCents * (e.vib ?? 1), tt + o.vibDelay + 0.4); }
          },
        };
      }
      // double reed: a bright, nasal spectrum with a formant near 1 kHz
      const reed = wind({ volume: -12, cutoff: 3400, formant: 1050, formantGain: 7, partials: [0.6, 1, 0.75, 0.95, 0.55, 0.35, 0.45, 0.22, 0.12, 0.08, 0.05], attack: 0.045, base: 600, octaves: 2.1, breathFreq: 2600, breath: -30, vibRate: 5.6, vibDelay: 0.3, vibCents: 18, glide: 0.015 });
      // bottle flute: nearly a sine with a soft chiff and more breath
      const flute = wind({ volume: -9, cutoff: 5200, partials: [1, 0.05, 0.22, 0.02, 0.06, 0, 0.02], attack: 0.06, base: 1200, octaves: 1.6, breathFreq: 3400, breath: -24, breathDecay: 0.08, vibRate: 5.1, vibDelay: 0.35, vibCents: 22, release: 0.22, glide: 0.012 });
      // cello: a bowed saw-ish spectrum, slow bow, darker
      const cello = wind({ volume: -11, cutoff: 1900, formant: 420, formantQ: 1.1, formantGain: 4, partials: [1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.16, 0.11, 0.08, 0.05], attack: 0.09, base: 320, octaves: 1.9, breathFreq: 1800, breath: -36, vibRate: 4.8, vibDelay: 0.4, vibCents: 14, release: 0.32, glide: 0.03 });

      /** Celesta: a 1:1 FM body with a quick 5th-partial hum, short and bright. */
      const celG = G(-5);
      const celLp = ctx.keep(new Tone.Filter({ frequency: 6500, type: "lowpass", rolloff: -12 })).connect(celG);
      const celBody = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 16, options: {
        harmonicity: 1, modulationIndex: 0.9, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 1.3, sustain: 0, release: 0.5 },
        modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 },
      } })).connect(celLp);
      const celHum = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 16, options: {
        harmonicity: 5.02, modulationIndex: 0.35, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 },
        modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
      } })).connect(celLp);
      celHum.volume.value = -14;
      const celesta = { out: celG, play(t, notes, d, v) { const f = arr(notes).map(hz); celBody.triggerAttackRelease(f, Math.min(d, 1.3), t, v); celHum.triggerAttackRelease(f, Math.min(d, 0.35), t, v * v); } };

      const bass = I.ebass(ctx, { volume: -4, base: 150 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 34, preload: ["softKick", "kick", "snare", "rim", "hatClosed", "hatOpen", "hatPedal", "ride", "shaker", "tambourine", "tom", "crash", "triangle"] });

      const rp = pan(reed.out, -0.22), fp = pan(flute.out, 0.26), cp = pan(celesta.out, 0.38), vp = pan(cello.out, -0.3);
      I.send(ctx, rp, hall, -11); I.send(ctx, rp, echo, -18);
      I.send(ctx, fp, hall, -9); I.send(ctx, fp, echo, -14);
      I.send(ctx, cp, hall, -12); I.send(ctx, cp, room, -14);
      I.send(ctx, vp, hall, -10);
      I.place(ctx, bass, 0, out); const kp = I.place(ctx, kit, 0.05, out);
      I.send(ctx, kp, room, -15); I.send(ctx, bass.out, room, -26);

      const mono = (inst) => (t, e, d) => inst.play(t, e, d);
      return {
        reed: { layer: "melody", play: mono(reed), humanize: { timing: 0.007, vel: 0.04 } },
        flute: { layer: "melody", play: mono(flute), humanize: { timing: 0.008, vel: 0.05 } },
        cel: { layer: "melody", play: (t, e, d) => celesta.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        cello: { layer: "melody", play: mono(cello), humanize: { timing: 0.009, vel: 0.04 } },
        celComp: { layer: "harmony", play: (t, e, d) => celesta.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.07 } },
        celloHold: { layer: "harmony", play: mono(cello), humanize: { timing: 0.012, vel: 0.04 } },
        celTex: { layer: "texture", play: (t, e, d) => celesta.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        fluteTex: { layer: "texture", play: mono(flute), humanize: { timing: 0.006, vel: 0.05 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        bassAns: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, off, half } = W;
      const L = lap % 3;
      // the section's hand-written material is routed once, on its first cycle, and kept for the second
      const key = `${lap}:${W.i}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...planSection(f, lap, r.fork(11)) };
      const { prog, notes } = state.plan;
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beats from this cycle's start
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (secBeat) => chordAt(Math.min(secBeat, f.bars * BPB - 0.01)).chord;

      // ---------- the dialogue (hand-written, routed) ----------
      const ornP = Math.min(0.3, 0.08 + 0.06 * lap);
      for (const n of notes) {
        if (n.at < s0 - 1e-6 || n.at >= s1 - 1e-6) continue;
        const { at, bar, beat, idx, ...rest } = n;
        const abs = at - s0;
        const extra = { ...rest };
        let dur = n.dur, v = n.vel;
        const isWind = n.track === "reed" || n.track === "flute" || n.track === "cello";
        if (isWind) {
          if (n.entrance && n.dur >= 1 && r.chance(ornP)) extra.scoop = 1;
          extra.vib = n.dur >= 1.5 ? 1 : 0.5;
          dur = n.dur - (n.handoff ? 0 : 0.06);
          if (n.entrance) v += 0.02;
        } else if (n.track === "cel") dur = Math.min(n.dur, 1.2);
        if (n.track === "celTex" || n.track === "fluteTex") v = n.vel + (beat % 2 === 0 ? 0.05 : 0) + r.range(-0.02, 0.02);
        push(n.track, abs, dur, n.note, v, extra);
      }
      // which bars the celesta and the cello are busy in (so their comping stays out of their own way)
      const busy = (track, bar) => notes.some((n) => (n.track === track) && n.at < (bar + 1) * BPB && n.at + n.dur > bar * BPB + 0.1);
      const busyAny = (tracks, bar) => tracks.some((t) => busy(t, bar));

      // ---------- celesta comping: a soft broken chord under the tune ----------
      const compOn = f.id === "A" || f.id === "B" || (f.id === "TAG" && off === 0);
      if (compOn) {
        prog.filter((h) => h.bar >= off && h.bar < off + CB).forEach((h) => {
          if (busyAny(["cel", "celTex"], h.bar)) return;
          const s = h.bar * BPB + h.beat;
          const under = f.how === "tutti";
          const v = T.voice(h.chord, { lo: under ? 52 : 55, hi: under ? 67 : 72, n: 3, top: under ? [60, 67] : [64, 72], prev: state.compPrev, rng: r, omitBass: true });
          state.compPrev = v;
          const vv = (f.id === "B" ? 0.3 : 0.34) + (lap > 0 ? 0.02 : 0);
          const fig = r.weighted([["up", 3], ["spread", 2], ["block", f.id === "B" ? 2 : 0.6]]);
          const u = v.slice().sort((a, b) => a - b);
          if (fig === "block") push("celComp", s - off * BPB, Math.min(h.dur - 0.1, 1.6), u, vv);
          else if (fig === "up") u.forEach((m, k) => push("celComp", s - off * BPB + k * 0.5, 1.2, m, vv - 0.03 * k));
          else { // T.voice may return fewer voices than asked (a triad with its bass left out), so index by what it gave
            const top = u[u.length - 1], mid = u[Math.min(1, u.length - 1)];
            push("celComp", s - off * BPB, 1.4, u[0], vv); push("celComp", s - off * BPB + 1, 1, top, vv - 0.04); if (h.dur >= 4) push("celComp", s - off * BPB + 2.5, 1, mid, vv - 0.05);
          }
        });
      }

      // ---------- cello holds: a guide tone per chord when the cello is not in the conversation ----------
      if (f.id !== "BR" && f.how !== "tutti" && f.how !== "hocket") {
        let prevHold = state.hold ?? 55;
        prog.filter((h) => h.bar >= off && h.bar < off + CB).forEach((h) => {
          if (busy("cello", h.bar)) return;
          const c = T.chord(h.chord);
          const cands = c.guide.concat([c.root]);
          const m = T.nearest(prevHold, cands.length ? cands : c.pcs, 50, 62);
          prevHold = m;
          const s = h.bar * BPB + h.beat - off * BPB;
          push("celloHold", s, h.dur - 0.25, m, (f.id === "intro" ? 0.3 : 0.34) + (h.beat === 0 ? 0.02 : 0), { vib: 0.6 });
        });
        state.hold = prevHold;
      }

      // ---------- bass ----------
      const style = f.id === "intro" || f.id === "BR" ? "pedal" : f.id === "TAG" ? "long" : f.how === "tutti" || f.how === "hocket" ? "bounce" : f.id === "B" ? "two" : "root";
      let last = state.bassLast ?? 45;
      const chords = prog.filter((h) => h.bar >= off && h.bar < off + CB);
      chords.forEach((h, i) => {
        const s = h.bar * BPB + h.beat - off * BPB, d = h.dur, c = T.chord(h.chord);
        const R = T.nearest(last, [c.bass], 35, 50);
        const fifthPc = mod12(c.bass + 7), fifth = R >= 43 ? T.nearest(R - 5, [fifthPc], 33, 52) : T.nearest(R + 7, [fifthPc], 33, 52);
        const oct = R + 12 <= 54 ? R + 12 : R - 12;
        const nextH = i + 1 < chords.length ? chords[i + 1] : prog.find((x) => x.bar === off + CB) || null;
        const nextPc = nextH ? T.chord(nextH.chord).bass : f.id === "TAG" ? 9 : 2;
        const tgt = T.nearest(R, [nextPc], 33, 52);
        const approach = () => r.weighted([[tgt - 1, 2], [tgt + 1, 1.2], [tgt + 2, 1.5], [fifth, 1.5], [T.nearest(R, [mod12(c.root + 4)], 33, 52), c.intervals.includes(4) ? 1 : 0]]);
        const add = (b, n, dur, v) => push("bass", s + b, dur, n, v);
        const ans = notes.filter((n) => n.track === "bassAns" && n.at >= h.bar * BPB + h.beat && n.at < h.bar * BPB + h.beat + d);
        const answering = ans.length > 0;
        if (answering) { // the bass answers the tune here: the root is held only until the answer begins
          add(0, R, Math.max(0.4, Math.min(ans[0].at, 1e9) - (h.bar * BPB + h.beat) - 0.1), 0.78);
          last = R;
          return;
        }
        if (style === "pedal") {
          const p = T.nearest(45, [c.bass], 33, 47);
          add(0, p, d >= 4 ? 2.3 : d - 0.1, 0.78);
          if (d >= 4) { if (r.chance(0.55)) add(2.5, p + 12 <= 52 ? p + 12 : p, 0.45, 0.46); add(3, p, 0.9, 0.6); }
          last = p;
        } else if (style === "long") {
          add(0, R, d - 0.15, 0.74);
          if (d >= 4 && r.chance(0.5)) add(3.5, approach(), 0.45, 0.5);
          last = R;
        } else if (style === "root") {
          add(0, R, Math.min(d, 2.4), 0.8);
          if (d >= 4) { add(2.5, fifth, 0.9, 0.6); add(3.5, approach(), 0.45, 0.55); }
          last = R;
        } else if (style === "two") {
          add(0, R, 1.4, 0.8);
          if (d >= 4) { add(1.5, R, 0.4, 0.5); add(2, r.chance(0.5) ? oct : fifth, 1.3, 0.62); add(3.5, approach(), 0.45, 0.55); }
          last = R;
        } else { // bounce
          add(0, R, 1.3, 0.82); add(1.5, R, 0.4, 0.5);
          if (d >= 4) { add(2.5, r.chance(0.35) ? oct : R, 0.8, 0.66); add(3.5, approach(), 0.45, 0.58); }
          last = R;
        }
      });
      state.bassLast = Math.max(33, Math.min(52, last));

      // ---------- drums ----------
      const Dr = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      let st = f.id === "intro" ? (lap === 0 ? "none" : "brush") : f.how === "phrase" ? (lap === 0 ? "light" : "groove") : f.how === "handoff" ? "groove" : f.id === "B" ? "air" : f.how === "hocket" ? "groove" : f.id === "BR" ? "halftime" : f.how === "tutti" ? "full" : "thin";
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = off + i;
        const lastBar = W.lastHalf && i === CB - 1;
        const fillHere = lastBar && (f.id === "BR" || f.id === "TAG" || (f.id === "A" && f.how !== "phrase") || (f.id === "A" && lap > 0) || (f.id === "B" && lap > 0));
        const fill = fillHere ? r.weighted(st === "thin" || st === "air" ? [[3, 3], [1, 1]] : [[0, 2], [1, 1.5], [2, 1.5], [3, 1]]) : null;
        const cut = fill != null ? FILLS[fill][0][0] : 9;
        const ok = (b) => b < cut;
        const K = (b, v, voice = "softKick") => { if (ok(b)) Dr(B0 + b, voice, v); };
        const S = (b, v, voice = "snare") => { if (ok(b)) Dr(B0 + b, voice, v); };
        const H = (b, v, voice = "hatClosed") => { if (ok(b)) Dr(B0 + b, voice, v); };
        const hats8 = (v, open) => { for (let e = 0; e < 8; e++) { const b = e / 2; const o = open && bar % 4 === 3 && e === 7; H(b, o ? 0.36 : e % 2 ? v * 0.75 : v, o ? "hatOpen" : "hatClosed"); } };
        const shaker16 = (v) => { for (let q = 0; q < 16; q++) { const b = q / 4; if (ok(b)) Dr(B0 + b, "shaker", v * [1, 0.45, 0.7, 0.5][q % 4]); } };
        if (st === "none") continue;
        if (st === "brush") { hats8(0.2); if (bar >= 2) { S(1, 0.4, "rim"); S(3, 0.42, "rim"); } K(0, 0.5); continue; }
        if (st === "light") { hats8(0.26); K(0, 0.68); K(2.5, 0.5); S(1, 0.48, "rim"); S(3, 0.5, "rim"); if (lap > 0) shaker16(0.22); }
        if (st === "groove") { hats8(0.3, true); shaker16(0.24); K(0, 0.74); K(2.5, 0.58); if (bar % 2 === 1 && r.chance(0.6)) K(3.5, 0.42); S(1, f.how === "hocket" ? 0.58 : 0.5, lap === 0 ? "rim" : "snare"); S(3, f.how === "hocket" ? 0.6 : 0.54, lap === 0 ? "rim" : "snare"); if (r.chance(0.25)) S(3.75, 0.16); if (f.how === "hocket") { S(1, 0.3, "tambourine"); S(3, 0.3, "tambourine"); } }
        if (st === "air") { for (let e = 1; e < 8; e += 2) H(e / 2, 0.22); K(0, 0.6); if (bar % 2 === 1) K(2.5, 0.42); S(3, 0.4, "rim"); if (bar % 2 === 0 && r.chance(0.5)) Dr(B0 + 2, "ride", 0.3); if (lap > 0) for (let q = 0; q < 16; q += 2) { if (ok(q / 4)) Dr(B0 + q / 4, "shaker", q % 4 === 0 ? 0.24 : 0.14); } }
        if (st === "halftime") { for (let b = 0; b < 4; b++) { if (ok(b)) Dr(B0 + b, "ride", b % 2 ? 0.28 : 0.36); } K(0, 0.72, "kick"); if (bar >= 4) K(2.5, 0.46, "kick"); S(2, 0.56); if (bar >= 6) { H(1.5, 0.2); H(3.5, 0.22); } if (bar === 7 && lastBar) { for (let q = 8; q < 16; q++) Dr(B0 + q / 4, "snare", 0.24 + (q - 8) * 0.045, { straight: true }); } }
        if (st === "full") { hats8(0.32, true); shaker16(0.26); K(0, 0.8, "kick"); K(2.5, 0.62, "kick"); if (bar % 2 === 1) K(3.5, 0.46, "kick"); S(1, 0.62); S(3, 0.66); if (r.chance(0.3)) S(3.75, 0.2); S(1, 0.34, "tambourine"); S(3, 0.34, "tambourine"); }
        if (st === "thin") { for (let b = 0; b < 4; b++) { if (ok(b)) Dr(B0 + b, "ride", b % 2 ? 0.22 : 0.3); } if (bar < 2) { K(0, 0.6); K(2.5, 0.42); } if (bar === 2) Dr(B0 + 0, "triangle", 0.3, { len: 1.5 }); }
        if (fill != null && !(st === "halftime" && bar === 7)) FILLS[fill].forEach(([b, voice, v, pitch]) => Dr(B0 + b, voice, v, { pitch, straight: b % 0.5 !== 0 }));
      }
      if (f.how === "tutti" && half === 0) Dr(0, "crash", 0.5);

      const harmony = prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${state.plan.label}`, state };
    },
  });
})();

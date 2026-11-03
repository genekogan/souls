// Section Lines: build-mode music for an hour of laying out roads. B♭ major, 90 bpm.
//
// Surveyors' section lines: the mile grid that every road in the plains follows. The piece is the
// SimCity / Sims build-mode tradition (mallets, electric piano, brushes, a finger snap) with one rule
// taken from Orbital Survey: the tune may be present for an hour, so it is stated in full only twice a
// lap and spends the rest of the lap as fragments, passed between players and answered in the rests.
// Nothing pushes: the pocket is brushes, a pedal hat and a snap; the bass plays a two-feel; the keys
// comp once a chord. The harmony moves in gentle, slightly surprising steps: chromatic mediants
// (B♭ → D♭, G♭ → B♭, B♭ → G) and ii–Vs that land a third away from where they point.
//
// THE TUNE (fixed by hand; the generator never changes a note, only who plays it and what dresses it)
//   Head = F B♭ D C: up a 4th, up a 3rd, down a step, on a pickup-and-land rhythm (½ 1 1½ 1).
//   A (8 bars):  | B♭maj9 | Gm9 | E♭maj9 | Cm9 F13 | D♭maj9 | G♭maj7♯11 | Cm9 F13 | B♭69 |
//     bar 1  F B♭ D C         the head on I, landing on the 9th
//     bar 2  B♭ A G .         settles on vi
//     bar 3  G B♭ E♭ D        the head's shape from the 3rd of IV (3 5 1 7)
//     bar 4  C E♭ D C A       ii–V; A is the 3rd of F13 …
//     bar 5  A♭ D♭ F E♭       … and the V lands a third away: the head exactly, on D♭ (♭III)
//     bar 6  D♭ C B♭          over G♭maj7♯11 (♭VI): C is the ♯11, B♭ the 3rd
//     bar 7  B♭ D F E♭        the head's rhythm from the ♭7 of ii (♭7 9 11 → 3 … → ♭7 of V)
//     bar 8  D C B♭           tail: 3 9 1, home.  Second statement: D C B, a deceptive landing on Gmaj9 (VI)
//   Counter (second statement only, half notes, marimba): D A | B♭ D | G B♭ | C A | A♭ D♭ | B♭ C | G A | B♭ D (B D)
//   B calls (in G, the chromatic mediant above): the head inverted, D A F♯ G | E B G A | B F♯ D E | B♭ F D E♭
//     | Gmaj9 | Em9 | Cmaj9 | Am9 D13 | Gmaj9 | B♭maj9 | Cm9 | F13 |  calls in the odd bars, answers in the even
//   Vamp (I pedal): | B♭69 | E♭maj9/B♭ | B♭69 | G♭maj7♯11/B♭ |  the head or the tail, once, answered low
//   Turn: | Cm9 | F13 | D♭maj9 | D♭maj9 | G♭maj7♯11 | G♭maj7♯11 | Cm9 | F13sus4 F13 |  fragments on D♭ and G♭
//   After the deceptive cadence: | Gmaj9 | Em9 | Cmaj9 | Cm9 F13 |  the head in G, then ii–V home
// One lap = vamp 4 · A 8 · vamp 4 · B 8 · turn 8 · A′ 8 · after 4 · tag 4 = 48 bars ≈ 2:08.
// Laps rotate who carries the tune (handoff / a phrase each / hocket), the ocarina joins from lap 2,
// the counter-line from lap 2; rng chooses ornaments, fills, sprinkles, voicings and ghost notes.
// Modules: Sim.dialogue (distribute / answer / separate), Sim.groove (templates, rubato, ghosts),
// Sim.phrasing (the ocarina wrapper: glide and late vibrato).
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue, G = Sim.groove, PH = Sim.phrasing;
  const BPB = 4, CB = 4, BPM = 90;
  const { mod12 } = T;

  // ---------- notation ----------
  /** Bars of "Note beat dur, ..." (null = empty bar) -> [{at, dur, note, phrase}], phrase from `phraseOf(bar)`. */
  function line(bars, phraseOf = (b) => Math.floor(b / 2)) {
    const out = [];
    bars.forEach((txt, bar) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => { const [n, b, d] = tok.trim().split(/\s+/); out.push({ at: bar * BPB + +b, dur: +d, note: T.midi(n), phrase: phraseOf(bar) }); });
    });
    return out;
  }

  // ---------- the score ----------
  const VAMP_CH = "| Bb69 | Ebmaj9/Bb | Bb69 | Gbmaj7#11/Bb |";
  const A_CH = "| Bbmaj9 | Gm9 | Ebmaj9 | Cm9 F13 | Dbmaj9 | Gbmaj7#11 | Cm9 F13 | Bb69 |";
  const A2_CH = "| Bbmaj9 | Gm9 | Ebmaj9 | Cm9 F13 | Dbmaj9 | Gbmaj7#11 | Cm9 F13 | Gmaj9 |";
  const B_CH = "| Gmaj9 | Em9 | Cmaj9 | Am9 D13 | Gmaj9 | Bbmaj9 | Cm9 | F13 |";
  const TURN_CH = "| Cm9 | F13 | Dbmaj9 | Dbmaj9 | Gbmaj7#11 | Gbmaj7#11 | Cm9 | F13sus4 F13 |";
  const AFTER_CH = "| Gmaj9 | Em9 | Cmaj9 | Cm9 F13 |";

  const A_BARS = [
    "F4 0 .5, Bb4 .5 1, D5 1.5 1.5, C5 3 1",
    "Bb4 0 1.5, A4 1.5 .5, G4 2 1.5",
    "G4 0 .5, Bb4 .5 1, Eb5 1.5 1.5, D5 3 1",
    "C5 0 1, Eb5 1 .5, D5 1.5 .5, C5 2 .5, A4 2.5 1.5",
    "Ab4 0 .5, Db5 .5 1, F5 1.5 1.5, Eb5 3 1",
    "Db5 0 1.5, C5 1.5 .5, Bb4 2 2",
    "Bb4 0 .5, D5 .5 1, F5 1.5 1.5, Eb5 3 1",
  ];
  const A_TUNE = line(A_BARS.concat(["D5 0 1, C5 1 .5, Bb4 1.5 2.5"]));
  const A2_TUNE = line(A_BARS.concat(["D5 0 1, C5 1 .5, B4 1.5 2.5"]));
  const HEAD = A_TUNE.slice(0, 4);
  const TAIL = A_TUNE.slice(-3).map((n) => ({ ...n, at: n.at - 28 }));
  // the counter-line (half notes) under the second statement; separate() keeps it below the tune
  const A_CNT = line([
    "D4 0 2, A3 2 2", "Bb3 0 2, D4 2 2", "G3 0 2, Bb3 2 2", "C4 0 2, A3 2 2",
    "Ab3 0 2, Db4 2 2", "Bb3 0 2, C4 2 2", "G3 0 2, A3 2 2", "B3 0 2, D4 2 2",
  ]);
  const B_CALLS = line([
    "D5 0 .5, A4 .5 1, F#4 1.5 1.5, G4 3 1", null,
    "E5 0 .5, B4 .5 1, G4 1.5 1.5, A4 3 1", null,
    "B5 0 .5, F#5 .5 1, D5 1.5 1.5, E5 3 1", null,
    "Bb5 0 .5, F5 .5 1, D5 1.5 1.5, Eb5 3 1", null,
  ], (b) => Math.floor(b / 2));

  const LAP = [
    { id: "vamp", bars: 4, ch: VAMP_CH },
    { id: "A", bars: 8, ch: A_CH },
    { id: "vamp2", bars: 4, ch: VAMP_CH },
    { id: "B", bars: 8, ch: B_CH },
    { id: "turn", bars: 8, ch: TURN_CH },
    { id: "A2", bars: 8, ch: A2_CH },
    { id: "after", bars: 4, ch: AFTER_CH },
    { id: "tag", bars: 4, ch: VAMP_CH },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i];
    return { lap, i, f, off: bar, first: bar === 0, last: bar + CB >= f.bars };
  }

  // ---------- voices for the dialogue ----------
  const RANGE = { mallet: [65, 91], epMel: [58, 84], ocarina: [67, 89], marimba: [50, 74] };
  const VOICE = {
    mallet: { track: "mallet", range: RANGE.mallet, gain: 1 },
    epMel: { track: "epMel", range: RANGE.epMel, gain: 0.95 },
    ocarina: { track: "ocarina", range: RANGE.ocarina, gain: 0.9 },
    marimba: { track: "marimba", range: RANGE.marimba, gain: 0.9 },
  };
  const V = (...names) => names.map((n) => VOICE[n]);
  /** Velocity contour: a little louder up high, a lean on downbeats. */
  function shape(notes, base) {
    const lo = Math.min(...notes.map((n) => n.note)), span = Math.max(1, Math.max(...notes.map((n) => n.note)) - lo);
    return notes.map((n) => ({ ...n, vel: base + 0.08 * (n.note - lo) / span + (n.at % BPB === 0 ? 0.03 : 0) }));
  }
  const ANSWER_TF = [{ invert: true }, { steps: -2 }, { retrograde: true }, { invert: true, truncate: 3 }, { steps: 2, retrograde: true }];

  /** Everything hand-written for one section of one lap, routed to tracks (at = beats from the section start). */
  function planSection(f, lap, r) {
    const prog = T.progression(f.ch, BPB);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(b).chord).scale;
    const L = lap % 3, oc = lap >= 1;
    const notes = [];
    let label = "", counter = false;
    const ans = (call, o) => D.answer(call, { scaleAt, bpb: BPB, ...o });
    if (f.id === "vamp" || f.id === "vamp2" || f.id === "tag") {
      // one fragment, answered low; the rest of the bars belong to the sprinkles and the brushes
      const frag = f.id === "vamp2" ? TAIL : HEAD;
      const who = f.id === "tag" ? "mallet" : lap % 2 ? "epMel" : "mallet";
      const hiOct = who === "mallet" ? [77, 91] : [70, 84];
      if (f.id === "tag") {
        if (lap === 0 || r.chance(0.7)) {
          notes.push(...ans(TAIL, { track: "mallet", transform: { augment: 2 }, at: 0, range: hiOct, vel: 0.42 }));
          if (r.chance(0.5)) notes.push(...ans(HEAD, { track: "marimba", transform: { retrograde: true }, at: 8.5, before: 15, range: RANGE.marimba, vel: 0.4 }));
          label = "tag · the tail, slowly, on the pedal";
        } else label = "tag · pedal, brushes, a few celesta notes";
      } else if (f.id === "vamp2" && lap > 0 && r.chance(0.35)) {
        label = "pedal · nobody sings";
      } else {
        notes.push(...D.distribute(shape(frag, 0.52), { voices: [{ ...VOICE[who], range: hiOct }], mode: "phrase", bpb: BPB }));
        const tf = ANSWER_TF[(lap + (f.id === "vamp2" ? 2 : 0)) % ANSWER_TF.length];
        const callEnd = Math.max(...frag.map((n) => n.at + n.dur));
        notes.push(...ans(frag, { track: "marimba", transform: tf, at: callEnd + 1, before: 11.5, range: RANGE.marimba, vel: 0.46 }));
        label = `${f.id === "vamp2" ? "the tail" : "the head"} once on the ${who === "mallet" ? "mallets" : "electric piano"}, the marimba answers`;
      }
    } else if (f.id === "A") {
      const tune = shape(A_TUNE, 0.6);
      if (L === 0) {
        const voices = oc ? V("epMel", "mallet", "ocarina") : V("epMel", "mallet");
        notes.push(...D.distribute(tune, { voices, mode: "handoff", join: "extend", overlap: 0.25, handoffDur: 2, minNotes: 3, stay: 0.35, rng: r, bpb: BPB }));
        label = "A · the tune handed between the players on its long notes";
      } else if (L === 1) {
        const order = oc ? ["mallet", "ocarina", "epMel", "mallet"] : ["mallet", "epMel", "mallet", "epMel"];
        notes.push(...D.distribute(tune, { voices: V("mallet", "epMel", "ocarina"), mode: "phrase", order, rng: r, bpb: BPB }));
        label = "A · a phrase each · " + order.join(", ");
      } else {
        notes.push(...D.distribute(tune, { voices: oc ? V("ocarina", "mallet", "epMel") : V("mallet", "epMel"), mode: "handoff", join: "double", overlap: 0.3, handoffDur: 2, minNotes: 3, stay: 0.3, rng: r, bpb: BPB }));
        label = "A · handed off, doubled at the joins";
      }
    } else if (f.id === "A2") {
      const tune = shape(A2_TUNE, 0.62);
      if (L === 0) {
        const order = oc ? ["mallet", "epMel", "ocarina", "mallet"] : ["mallet", "epMel", "mallet", "epMel"];
        notes.push(...D.distribute(tune, { voices: V("mallet", "epMel", "ocarina"), mode: "phrase", order, rng: r, bpb: BPB }));
        label = "A′ · a phrase each · deceptive landing on VI";
      } else if (L === 1) {
        const first = tune.filter((n) => n.phrase < 2), peak = tune.filter((n) => n.phrase === 2), last = tune.filter((n) => n.phrase === 3);
        notes.push(...D.distribute(first, { voices: V("mallet", "epMel"), mode: "hocket", group: 2, rng: r, bpb: BPB }));
        notes.push(...D.distribute(peak, { voices: V("mallet", "epMel"), mode: "interval", pivot: 75, bpb: BPB }));
        notes.push(...D.distribute(last, { voices: V(oc ? "ocarina" : "epMel"), mode: "phrase", bpb: BPB }));
        label = "A′ · hocketed two notes at a time, split by register at the peak · deceptive landing on VI";
      } else {
        notes.push(...D.distribute(tune, { voices: oc ? V("mallet", "ocarina", "epMel") : V("mallet", "epMel"), mode: "handoff", join: "extend", overlap: 0.25, handoffDur: 2, minNotes: 3, stay: 0.4, rng: r, bpb: BPB }));
        label = "A′ · handed off · deceptive landing on VI";
      }
      if (lap >= 1) {
        counter = true;
        notes.push(...D.separate(tune, A_CNT.map((n) => ({ ...n, vel: 0.4 })), { range: RANGE.marimba, prefer: "below", min: 3, bpb: BPB }).map((n) => ({ ...n, track: "marimba" })));
        label += " · marimba counter-line";
      }
    } else if (f.id === "B") {
      const calls = shape(B_CALLS, 0.58);
      const orders = [["mallet", "epMel", "mallet", "epMel"], ["epMel", "mallet", oc ? "ocarina" : "epMel", "mallet"], ["mallet", oc ? "ocarina" : "mallet", "epMel", oc ? "ocarina" : "mallet"]];
      const order = orders[L];
      notes.push(...D.distribute(calls, { voices: V("mallet", "epMel", "ocarina"), mode: "phrase", order, rng: r, bpb: BPB }));
      const answerers = [["marimba", "marimba", "epMel", "marimba"], ["marimba", "epMel", "marimba", "marimba"], ["epMel", "marimba", "marimba", "epMel"]][L];
      const phr = D.phrases(B_CALLS, { bpb: BPB });
      phr.forEach((p, i) => {
        const who = answerers[i] === order[i] ? "marimba" : answerers[i];
        const tf = ANSWER_TF[(i + lap) % ANSWER_TF.length];
        const pEnd = Math.max(...p.map((n) => n.at + n.dur));
        const next = i + 1 < phr.length ? phr[i + 1][0].at : 32;
        notes.push(...ans(p, { track: who, transform: tf, at: pEnd + (r.chance(0.5) ? 0 : 0.5), before: next, range: RANGE[who], vel: 0.5, breath: 0.3 }));
      });
      label = "B · in G, a third away: the head inverted, called and answered";
    } else if (f.id === "turn") {
      // the head on D♭ (bar 3), answered; the tail on G♭ (bar 6), answered; everything else is bed and brushes
      const headDb = HEAD.map((n) => ({ ...n, note: n.note + 3, at: n.at + 8 }));
      const who = L === 1 ? "mallet" : "epMel";
      notes.push(...D.distribute(shape(headDb, 0.54), { voices: V(who), mode: "phrase", bpb: BPB }));
      notes.push(...ans(headDb, { track: "marimba", transform: ANSWER_TF[(lap + 1) % ANSWER_TF.length], at: 12.5, before: 19.5, range: RANGE.marimba, vel: 0.46 }));
      const tailGb = TAIL.map((n) => ({ ...n, note: n.note - 1, at: n.at + 20 }));
      notes.push(...ans(tailGb, { track: oc && L === 2 ? "ocarina" : "mallet", transform: { transpose: 0 }, at: 20, range: oc && L === 2 ? RANGE.ocarina : [77, 91], vel: 0.5 }));
      if (r.chance(0.7)) notes.push(...ans(tailGb, { track: "epMel", transform: { steps: -2, retrograde: true }, at: 24.5, before: 30, range: [62, 80], vel: 0.42 }));
      label = "turn · ii–V lands on D♭, then G♭ · fragments only";
    } else if (f.id === "after") {
      const headG = HEAD.map((n) => ({ ...n, note: n.note - 3 }));
      const who = L === 2 && oc ? "ocarina" : "mallet";
      notes.push(...D.distribute(shape(headG, 0.56), { voices: [{ ...VOICE[who], range: who === "mallet" ? [74, 91] : RANGE.ocarina }], mode: "phrase", bpb: BPB }));
      notes.push(...ans(headG, { track: "epMel", transform: { invert: true }, at: 4.5, before: 11.5, range: [62, 80], vel: 0.46 }));
      if (r.chance(0.5)) notes.push(...ans(TAIL, { track: "marimba", transform: { steps: -2 }, at: 12, before: 16, range: RANGE.marimba, vel: 0.42 }));
      label = "after · the head in G, inverted back, ii–V home";
    }
    return { prog, notes: notes.sort((a, b) => a.at - b.at), label, counter, scaleAt };
  }

  Sim.register({
    id: "section-lines",
    title: "Section Lines",
    genre: "Build mode",
    about: "Mallets, electric piano, marimba, brushes and a finger snap for an hour of laying out roads: a hand-written tune stated twice a lap and otherwise passed around as fragments and answered in the rests, over harmony that lands a third away from where it points (B♭ → D♭, G♭ → B♭, B♭ → G). Sim.dialogue routes the tune, Sim.groove sits the pocket.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["work", "hangout"], energy: 0.4,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.018, lowcut: 260, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.035, lowcut: 320, highcut: 5500 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.26, highcut: 2800 });

      // --- patch 1: tines. A vibraphone-ish FM bar with the motor off, slightly inharmonic, through a slow chorus ---
      const malletOut = ctx.keep(new Tone.Gain(Math.pow(10, 6 / 20)));
      const malletLp = ctx.keep(new Tone.Filter({ frequency: 4200, type: "lowpass", rolloff: -12 })).connect(malletOut);
      const malletCh = ctx.keep(new Tone.Chorus({ frequency: 0.9, delayTime: 3.5, depth: 0.3, spread: 90, wet: 0.35 }).start()).connect(malletLp);
      const malletSyn = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 16, options: {
        harmonicity: 3.98, modulationIndex: 1.25, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 2.4, sustain: 0, release: 1.1 },
        modulationEnvelope: { attack: 0.001, decay: 0.28, sustain: 0.02, release: 0.2 },
      } })).connect(malletCh);
      const mallet = { out: malletOut, play: (t, n, d, v) => malletSyn.triggerAttackRelease((Array.isArray(n) ? n : [n]).map(T.hz), d, t, v) };

      // --- patch 2: electric piano, darker than the library default, with a touch of chorus ---
      const ep = I.rhodes(ctx, { volume: -3, cutoff: 2600, tremolo: 2.8, tremoloDepth: 0.18, bark: 1.6, tine: -18 });
      const epCh = ctx.keep(new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.25, spread: 60, wet: 0.22 }).start());
      ep.out.connect(epCh);

      // --- patch 3: a small ocarina (triangle through a soft filter), phrased: glide, late vibrato ---
      const ocSyn = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "triangle" },
        filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
        envelope: { attack: 0.035, decay: 0.12, sustain: 0.78, release: 0.28 },
        filterEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.3, baseFrequency: 900, octaves: 1.3 },
      }));
      const ocarina = PH.wrap(ctx, ocSyn, { volume: -9, glide: 0.05, release: 0.28, vibrato: { rate: 5.1, depth: 0.05, delay: 0.32, rise: 0.35 } });

      const marimba = I.marimba(ctx, { volume: -4, cutoff: 3800, decay: 0.9, hardness: 1.3 });
      const bass = I.ebass(ctx, { volume: -4, base: 120 });
      const sparkle = I.glock(ctx, { celesta: true, volume: -12, decay: 2.2 });
      const bed = I.glassPad(ctx, { volume: -16, attack: 2.5, release: 4 });
      const kit = I.kit(ctx, { volume: 0, preload: ["brushSweep", "brushTap", "hatPedal", "snap", "softKick"] });

      const mp = I.place(ctx, mallet, 0.22, out);
      const epp = I.place(ctx, { out: epCh }, -0.2, out);
      const op = I.place(ctx, ocarina, 0.1, out);
      const mrp = I.place(ctx, marimba, -0.35, out);
      I.place(ctx, bass, 0, out);
      const sp = I.place(ctx, sparkle, 0.4, out);
      const bp = I.place(ctx, bed, -0.1, out);
      const kp = I.place(ctx, kit, 0.06, out);
      I.send(ctx, mp, room, -12); I.send(ctx, mp, echo, -16); I.send(ctx, mp, hall, -18);
      I.send(ctx, epp, room, -13); I.send(ctx, epp, hall, -20);
      I.send(ctx, op, room, -11); I.send(ctx, op, hall, -14); I.send(ctx, op, echo, -18);
      I.send(ctx, mrp, room, -12);
      I.send(ctx, sp, hall, -8); I.send(ctx, sp, echo, -10);
      I.send(ctx, bp, hall, -6);
      I.send(ctx, kp, room, -15);

      return {
        mallet: { layer: "melody", humanize: { timing: 0.006, vel: 0.05 }, play: (t, e, d) => mallet.play(t, e.note, d, e.vel) },
        epMel: { layer: "melody", humanize: { timing: 0.007, vel: 0.05 }, play: (t, e, d) => ep.play(t, e.note, d, e.vel) },
        ocarina: { layer: "melody", humanize: { timing: 0.008, vel: 0.04 }, play: (t, e, d) => ocarina.play(t, e, d) },
        marimba: { layer: "melody", humanize: { timing: 0.007, vel: 0.06 }, play: (t, e, d) => marimba.play(t, e.note, d, e.vel) },
        ep: { layer: "harmony", humanize: { timing: 0.008, vel: 0.04 }, play: (t, e, d) => ep.play(t, e.note, d, e.vel) },
        bed: { layer: "harmony", humanize: { timing: 0.02 }, play: (t, e, d) => bed.play(t, e.note, d, e.vel) },
        bass: { layer: "bass", humanize: { timing: 0.004, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        sparkle: { layer: "texture", humanize: { timing: 0.01, vel: 0.08 }, play: (t, e, d) => sparkle.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.005, vel: 0.1 }, play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep, pitch: e.pitch }) },
      };
    },

    compose({ cycle, rng: r, state }) {
      const L = locate(cycle);
      const { f, lap, off } = L;
      if (L.first || !state.plan) state.plan = planSection(f, lap, r.fork(11));
      const P = state.plan;
      if (state.bassLast == null) Object.assign(state, { bassLast: 46, epV: null, bedV: null });
      const offB = off * BPB;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---- the hand-written material for this cycle ----
      for (const n of D.toEvents(D.window(P.notes, offB, offB + CB * BPB), { bpb: BPB, offset: offB })) { const { at, idx, voice, ...e } = n; ev.push(e); }
      const sung = P.notes.filter((n) => n.track !== "marimba" || !P.counter);
      const melodyIn = (s0, s1) => sung.some((n) => n.at < s1 - 1e-6 && n.at + n.dur > s0 + 1e-6);
      const melodyLow = (s0, s1) => { const m = sung.filter((n) => n.at < s1 - 1e-6 && n.at + n.dur > s0 + 1e-6).map((n) => n.note); return m.length ? Math.min(...m) : 99; };

      // ---- harmony for this cycle ----
      const harmony = P.prog.filter((e) => e.bar >= off && e.bar < off + CB).map((e) => ({ ...e, bar: e.bar - off }));
      const chordAt = T.chordAtFactory(P.prog, BPB);
      const id = f.id;
      const vamp = id === "vamp" || id === "vamp2" || id === "tag", stmt = id === "A" || id === "A2";
      const statement = stmt, inB = id === "B", turn = id === "turn";

      // ---- bass: a two-feel that never hurries ----
      harmony.forEach((e, k) => {
        const s0 = e.bar * BPB + e.beat, secB = offB + s0;
        const c = T.chord(e.chord);
        if (vamp) {
          // pedal: the root on 1, the fifth above on the and of 2, every other bar
          if (e.bar % 2 === 0 || id === "tag") push("bass", s0, 1.6, 46, 0.6);
          if (e.bar % 2 === 1 && id !== "tag") { push("bass", s0, 1.2, 46, 0.56); push("bass", s0 + 2.5, 0.6, 53, 0.4); }
          state.bassLast = 46;
          return;
        }
        const root = (state.bassLast = T.nearest(state.bassLast, [c.bass], 38, 53));
        push("bass", s0, Math.min(e.dur, 2) * 0.72, root, e.beat === 0 ? 0.62 : 0.56);
        const nextSym = (() => { const b = secB + e.dur; return b < f.bars * BPB ? chordAt(b).chord : LAP[(L.i + 1) % LAP.length].ch.split("|").map((s) => s.trim()).filter(Boolean)[0].split(/\s+/)[0]; })();
        const nextRoot = T.nearest(root, [T.chord(nextSym).bass], 38, 53);
        if (e.dur >= 4) {
          const fifth = T.nearest(root + 7, [mod12(c.root + 7)], 40, 57);
          if (r.chance(inB ? 0.75 : 0.55)) push("bass", s0 + 2.5, 0.55, r.chance(0.7) ? fifth : root + 12 <= 57 ? root + 12 : fifth, 0.42);
          if (nextRoot !== root && r.chance(0.4)) push("bass", s0 + 3.5, 0.4, nextRoot + (nextRoot > root ? -1 : 1), 0.4); // chromatic approach
          else if (r.chance(0.2)) push("bass", s0 + 3.5, 0.4, root, 0.34); // a repeated-root pickup
        } else if (e.dur >= 2 && k === harmony.length - 1 && r.chance(0.3)) push("bass", s0 + 1.5, 0.4, root, 0.36); // a pickup into the next bar
      });

      // ---- electric piano: one voicing per chord, under the tune when the tune is out ----
      /** Drop (or lower) voicing tones that rub a semitone / minor 9th against what is being sung over them. */
      const sungIn = (s0, s1) => P.notes.filter((n) => n.at < s1 - 1e-6 && n.at + n.dur > s0 + 1e-6).map((n) => n.note);
      function clear(v, over, lo) {
        const rub = (m) => over.some((x) => mod12(Math.abs(x - m)) === 1 && Math.abs(x - m) <= 13);
        const out = [];
        for (let m of v) {
          if (rub(m) && m - 12 >= lo && !rub(m - 12) && !v.some((z) => Math.abs(z - (m - 12)) <= 2)) m -= 12;
          if (!rub(m)) out.push(m);
        }
        return out.sort((a, b) => a - b);
      }
      /** No semitone pairs inside a voicing: lift the upper note an octave, else drop the lower one. */
      function tidy(v, hi) {
        for (let guard = 0; guard < 3; guard++) {
          const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
          if (i < 0) break;
          if (v[i] + 12 <= hi && !v.includes(v[i] + 12)) v[i] += 12; else v.splice(i - 1, 1);
          v.sort((a, b) => a - b);
        }
        return v;
      }
      const ant = harmony.map((e, k) => k > 0 && !vamp && e.dur >= 4 && harmony[k - 1].dur >= 4 && r.chance(0.3));
      harmony.forEach((e, k) => {
        const s0 = e.bar * BPB + e.beat, secB = offB + s0;
        const c = T.chord(e.chord);
        const low = melodyLow(secB, secB + e.dur);
        const hi = Math.min(72, low - 3), lo = 55;
        if (hi - lo < 9) return;
        const over = sungIn(secB - 0.5, secB + e.dur);
        if (P.counter && stmt) {
          // the marimba has the inner voice: the piano only touches the guide tones, lightly
          const gv = clear(T.voice(c, { lo: 57, hi: Math.min(68, hi), n: 2, prev: state.epV, rng: r, omitBass: true }), over, 57);
          if (!gv.length) return;
          state.epV = gv;
          push("ep", s0 + 1.5, 1.2, gv, 0.3);
          return;
        }
        // shells (root, 3rd, 7th) when the glass bed holds the colours; rootless four-note voicings under the tune
        const shell = vamp || turn || id === "after";
        let v = T.voice(c, shell ? { lo, hi, n: 3, prev: state.epV, top: [hi - 7, hi], rng: r, omitBass: true, rootless: false }
          : { lo, hi, n: 4, prev: state.epV, top: [hi - 7, hi], rng: r, omitBass: true, rootless: !c.sus });
        v = clear(tidy(v, hi), over, lo);
        if (v.length < 2) return;
        state.epV = v;
        const short = e.dur < 4;
        const at = vamp ? s0 + 1 : ant[k] ? s0 - 0.5 : short ? s0 : s0 + (r.chance(0.5) ? 0.5 : 0);
        const dur = Math.max(1.2, Math.min(e.dur - (at - s0) - 0.5, 3));
        push("ep", at, dur, v, (vamp ? 0.34 : 0.4) + (inB ? 0.03 : 0));
        if (inB && !short && !ant[k + 1] && r.chance(0.5)) push("ep", s0 + 2.5, 1, v.slice(-2), 0.3);
      });

      // ---- glass bed: in the vamps, the turn and the after ----
      if (vamp || turn || id === "after") {
        harmony.forEach((e) => {
          if (e.dur < 4) return;
          const c = T.chord(e.chord);
          const bv = T.voice(c, { lo: 72, hi: 86, n: 2, prev: state.bedV, rng: r, rootless: true, omitBass: true });
          state.bedV = bv;
          push("bed", e.bar * BPB + 0.25, e.dur - 0.5, bv, id === "tag" && e.bar >= 2 ? 0.22 : 0.28);
        });
      }

      // ---- celesta sprinkles in bars where nobody is singing ----
      function sprinkle(at, len, count) {
        const c = T.chord(chordAt(offB + at).chord);
        const nb = offB + at + len;
        const nc = T.chord(nb < f.bars * BPB ? chordAt(nb).chord : chordAt(offB + at).chord);
        // root, 3rd, 5th and 9th only: no 7ths or #11s a semitone from their neighbours up here
        const pcs = c.intervals.filter((iv) => [0, 2, 3, 4, 7, 14].includes(iv)).map((iv) => mod12(c.root + iv));
        const pool = T.notesIn(pcs, 84, 100);
        const n = Math.min(count, pool.length);
        if (n < 2) return;
        const up = r.chance(0.6);
        const start = up ? r.int(0, pool.length - n) : r.int(n - 1, pool.length - 1);
        let prev = null;
        for (let k = 0; k < n; k++) {
          let note = pool[up ? start + k : start - k];
          if (k === n - 1 && prev != null && !nc.pcs.includes(mod12(note))) {
            const step = T.notesIn(nc.pcs, prev - 3, prev + 3).filter((m) => m !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
            if (step != null) note = step;
          }
          push("sparkle", at + k * 0.5, k === n - 1 ? 1.6 : 0.6, note, 0.3 + 0.02 * k);
          prev = note;
        }
      }
      if (vamp || turn || id === "after") {
        for (let b = 0; b < CB; b++) {
          const s0 = offB + b * BPB;
          if (melodyIn(s0, s0 + BPB)) continue;
          if (r.chance(id === "tag" ? 0.5 : 0.45)) sprinkle(b * BPB + r.pick([1, 1.5, 2, 2.5]), 1.5, r.pick([2, 3, 3]));
        }
      }

      // ---- the pocket: brushes, a pedal hat, a snap; never more than that ----
      const level = vamp ? 0 : turn ? 1 : id === "after" ? 1 : id === "A" ? 1 : 2;
      const snap = lap % 2 === 0 ? "snap" : "brushTap";
      const fadeOut = id === "tag";
      for (let b = 0; b < CB; b++) {
        const B = b * BPB;
        const last = L.last && b === CB - 1;
        const quiet = fadeOut && b >= 2;
        const fill = last && (id === "A2" || inB) && r.chance(0.6);
        push("drums", B, 0.1, "brushSweep", quiet ? 0.14 : 0.2, { sweep: 0.55 });
        if (!quiet) push("drums", B + 2, 0.1, "brushSweep", 0.16, { sweep: 0.5 });
        if (level === 0) {
          push("drums", B + 1, 0.1, "hatPedal", quiet ? 0.08 : 0.13);
          push("drums", B + 3, 0.1, "hatPedal", quiet ? 0.08 : 0.12);
          if (id === "vamp2" && lap > 0) push("drums", B + 3, 0.1, "snap", 0.22);
          continue;
        }
        push("drums", B, 0.1, "softKick", level === 2 ? 0.3 : turn ? 0.22 : 0.26);
        if (!turn && r.chance(level === 2 ? 0.5 : 0.3)) push("drums", B + 2.5, 0.1, "softKick", 0.17);
        if (fill) {
          [2, 2.25, 2.5, 2.75, 3, 3.5].forEach((p, k) => push("drums", B + p, 0.1, "brushTap", 0.13 + 0.03 * k));
          push("drums", B + 1, 0.1, snap, 0.3);
          continue;
        }
        // the turn thins to brushes: no snap, so the return of A′ has something to come back with
        push("drums", B + 1, 0.1, turn ? "brushTap" : snap, turn ? 0.2 : 0.32);
        push("drums", B + 3, 0.1, turn ? "brushTap" : snap, turn ? 0.18 : 0.3);
        push("drums", B + 1, 0.1, "hatPedal", 0.12);
        push("drums", B + 3, 0.1, "hatPedal", 0.12);
        if (level === 2 && r.chance(0.22)) push("drums", B + r.pick([1.75, 3.75]), 0.1, "brushTap", 0.2, { ghost: true });
        if (level >= 1 && r.chance(0.12)) push("drums", B + r.pick([0.75, 2.75]), 0.1, "hatPedal", 0.12, { ghost: true });
      }

      // ---- feel ----
      ev = G.ghosts(ev, { track: "drums", vel: 0.16, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { snap: "laidback", brushTap: "laidback", hatPedal: "pushed", softKick: "straight", brushSweep: "straight" } },
          bass: { template: "mpc58", late: 3 },
          ep: { template: "mpc58", late: 10, vels: false },
          epMel: { template: "mpc54", late: 6, vels: false },
          mallet: { template: "mpc54", late: 4, vels: false },
          marimba: { template: "mpc54", late: 4, vels: false },
        },
      });
      if (ev.some((e) => e.track === "ocarina")) ev = G.rubato(ev, { track: "ocarina", bpm: BPM, bpb: BPB, amount: 0.6, linger: "high", lingerMs: 45, rng: r });

      const part = f.bars > CB ? ` (${off / CB + 1}/${f.bars / CB})` : "";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${P.label}${part}`, state };
    },
  });
})();

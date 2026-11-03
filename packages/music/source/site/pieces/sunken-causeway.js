// Sunken Causeway: the flooded stage, a road under still water, lanterns somewhere above. B minor, 6/8 at
// 96 (dotted quarter = 64), written for an eight-voice sound chip (Sim.spc) whose echo does the water: every
// voice sends into a 160 ms echo with a dark feedback filter, so each note leaves a trail of 16th-note
// reflections. A lyrical, slightly sad tune over a slow buoyant lilt; the chip's voice budget keeps the
// arrangement thin (the hat and the pluck are the first to lose their voice when the pad fills up).
//
// ---- the ideas, fixed by hand (the generator only arranges, fills, ornaments and times them) ----
//
// THE HOOK (A, 8 bars, 6/8 counted in quarter beats: a bar is 3, an eighth is 0.5). It descends by thirds,
// one bar per chord, and each bar starts a third below the last: F#5 · D5 · B4 · G4 — the descending-thirds
// harmony is the tune's own shape — then climbs home through the dominant.
//   bar 1  F#5(1.5) D5 E5 C#5        | Bm9       a turn: the fifth, down a third, back up, down to the ninth
//   bar 2  D5(1.5) B4(1) A4          | Gmaj9     a third lower: the fifth of G, the third, the ninth
//   bar 3  B4(1) G4 F#4(1) E4        | Em9       a third lower again: fifth, third, ninth, root
//   bar 4  G4(1) F#4(2)              | Cmaj7#11  the bottom of the descent: the #11 (the key's fifth) held
//   bar 5  . A4 B4 D5 E5(1)          | Dmaj9     the climb: up to the ninth
//   bar 6  C#5(1.5) A4 F#4(1)        | F#m7      the minor dominant: a sigh down the triad
//   bar 7  G4 A4 B4 D5(1.5)          | Em9       climbing again
//   bar 8  C#5(1) B4 A#4(1) .        | F#7sus4 F#7b9   the leading tone, a breath, and the fifth again
//   Variants of bar 8 only: toward B · C#5 B4 G5 over F#7sus4 A13sus4; closed · C#5 D5 B4 over F#7sus4 Bm9.
//   Counter (A3, A4; clarinet, half-bar notes, kept below the tune by Sim.dialogue.separate):
//     D4 C#4 | B3 A3 | G3 B3 | C4 D4 | F#4 E4 | C#4 A3 | B3 G3 | B3 A#3
//
// THE B THEME (8 bars): the harmony drifts around the major-third cycle, D → B♭ → G♭ → D, two bars each, and
// comes back; the tune keeps one shape (a fall from the top of the chord) and lets the chords recolour it,
// hovering on A5 (the fifth of D, the seventh of B♭) and dipping to A♭5 (the ninth of G♭) before A5 returns.
//   A5(1.5) F#5(1) E5 | D5(1.5) E5(1) .     Dmaj9
//   A5(1.5) F5(1) D5  | C5(1.5) D5(1) .     B♭maj9
//   A♭5(1.5) F5(1) D♭5 | E♭5(1) F5 A♭5(1.5)  G♭maj9 (the climb back)
//   A5(1.5) F#5 E5 D5 | E5(1) F#5 G5(1) .   Dmaj9/A · A13sus4 (G5 leans into the hook's F#5)
//   Counter (clarinet, whole bars): F#4 F#4 F4 F4 F4 F4 F#4 E4 — the common tones, a semitone apart.
//
// THE DEEP (8 bars over a B pedal): the hook's first half twice as slow, an octave down, on the clarinet,
// bell glints above it, the drums down to a kick and the shaker; a tempo that has sunk to 88 and climbs out.
//
// FORM, one lap = 60 bars ≈ 1:53: intro 4 · A1 8 (flute alone) · A2 8 (handed between flute, clarinet and
// bell as it descends) · B 8 · A3 8 (a phrase each, the counter below) · deep 8 · B2 8 (flute and bell hand
// it over, pluck sixteenths) · A4 8 (flute, clarinet an octave below, bell on the long notes; closed ending).
// Laps rotate who starts, the join style and the drum weight; rng chooses fills, bass shapes, arpeggio
// direction, glints and velocities. Modules: Sim.spc (the chip, its echo and voice budget), Sim.dialogue
// (distribute / answer / separate), Sim.groove (a 6/8 lilt template per track, rubato for the tune, ghosts,
// crescendos through fills, a tempo script: ritardando into the deep, a lift for the last A).
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue, G = Sim.groove;
  const mod12 = T.mod12;
  const BPB = 3, CB = 4, BPM = 96, VOICES = 8;
  const STRONG = [0, 1.5];

  // ---------- notation: phrases of bars "Note/beats ..." (r = rest); at = beats from the section start ----------
  function tune(phraseTexts) {
    const out = [];
    let bar = 0;
    phraseTexts.forEach((txt, pi) => {
      txt.split("|").map((s) => s.trim()).filter(Boolean).forEach((b) => {
        let pos = 0;
        b.split(/\s+/).forEach((tok) => {
          const m = /^(r|[A-G][#b]?\d)\/([\d.]+)$/.exec(tok);
          if (!m) throw new Error(`sunken-causeway: bad token ${tok}`);
          const dur = parseFloat(m[2]);
          if (m[1] !== "r") out.push({ at: bar * BPB + pos, dur, note: T.midi(m[1]), phrase: pi });
          pos += dur;
        });
        if (Math.abs(pos - BPB) > 1e-6) throw new Error(`sunken-causeway: bar ${bar + 1} has ${pos} beats: ${b}`);
        bar++;
      });
    });
    return out;
  }
  /** Half-bar / whole-bar counter-lines: "Note dur, ..." in time order, phrase per text. */
  function held(texts) {
    const out = [];
    let at = 0;
    texts.forEach((txt, pi) => txt.split(",").forEach((tok) => { const [n, d] = tok.trim().split(/\s+/); out.push({ at, dur: +d, note: T.midi(n), phrase: pi }); at += +d; }));
    return out;
  }

  // ---------- the score ----------
  const A_P = [
    "F#5/1.5 D5/0.5 E5/0.5 C#5/0.5 | D5/1.5 B4/1 A4/0.5",
    "B4/1 G4/0.5 F#4/1 E4/0.5 | G4/1 F#4/2",
    "r/0.5 A4/0.5 B4/0.5 D5/0.5 E5/1 | C#5/1.5 A4/0.5 F#4/1",
  ];
  const A_END = {
    down: "G4/0.5 A4/0.5 B4/0.5 D5/1.5 | C#5/1 B4/0.5 A#4/1 r/0.5",
    toB: "G4/0.5 A4/0.5 B4/0.5 D5/1.5 | C#5/1 B4/0.5 G5/1 r/0.5",
    close: "G4/0.5 A4/0.5 B4/0.5 D5/1.5 | C#5/1 D5/0.5 B4/1.5",
  };
  const A_TUNE = Object.fromEntries(Object.entries(A_END).map(([k, v]) => [k, tune(A_P.concat([v]))]));
  const A_CH = {
    down: "| Bm9 | Gmaj9 | Em9 | Cmaj7#11 | Dmaj9 | F#m7 | Em9 | F#7sus4:1.5 F#7b9:1.5 |",
    toB: "| Bm9 | Gmaj9 | Em9 | Cmaj7#11 | Dmaj9 | F#m7 | Em9 | F#7sus4:1.5 A13sus4:1.5 |",
    close: "| Bm9 | Gmaj9 | Em9 | Cmaj7#11 | Dmaj9 | F#m7 | Em9 | F#7sus4:1.5 Bm9:1.5 |",
  };
  const A_CNT = held(["D4 1.5, C#4 1.5, B3 1.5, A3 1.5, G3 1.5, B3 1.5, C4 1.5, D4 1.5", "F#4 1.5, E4 1.5, C#4 1.5, A3 1.5, B3 1.5, G3 1.5, B3 1.5, A#3 1.5"]);
  const A_CNT_CLOSE = held(["D4 1.5, C#4 1.5, B3 1.5, A3 1.5, G3 1.5, B3 1.5, C4 1.5, D4 1.5", "F#4 1.5, E4 1.5, C#4 1.5, A3 1.5, B3 1.5, G3 1.5, B3 1.5, D4 1.5"]);

  const B_TUNE = tune([
    "A5/1.5 F#5/1 E5/0.5 | D5/1.5 E5/1 r/0.5",
    "A5/1.5 F5/1 D5/0.5 | C5/1.5 D5/1 r/0.5",
    "Ab5/1.5 F5/1 Db5/0.5 | Eb5/1 F5/0.5 Ab5/1.5",
    "A5/1.5 F#5/0.5 E5/0.5 D5/0.5 | E5/1 F#5/0.5 G5/1 r/0.5",
  ]);
  const B_CH = "| Dmaj9 | Dmaj9 | Bbmaj9 | Bbmaj9 | Gbmaj9 | Gbmaj9 | Dmaj9/A | A13sus4 |";
  const B_CNT = held(["F#4 3, F#4 3", "F4 3, F4 3", "F4 3, F4 3", "F#4 3, E4 3"]);

  const DEEP_CH = "| Bm9 | Bm9 | Gmaj9/B | Gmaj9/B | Em9/B | Em9/B | Cmaj7#11 | A13sus4 |";
  const INTRO_CH = "| Bm9 | Gmaj9/B | Em9/B | F#7sus4:1.5 F#7b9:1.5 |";

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, how: "solo", end: "down" },
    { id: "A", bars: 8, how: "handoff", end: "toB" },
    { id: "B", bars: 8, how: "solo" },
    { id: "A", bars: 8, how: "phrase", end: "down" },
    { id: "deep", bars: 8 },
    { id: "B", bars: 8, how: "handoff" },
    { id: "A", bars: 8, how: "tutti", end: "close" },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB; // 60 bars, 15 cycles
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    let bar = cl * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, cl, i, f, nf, off: bar, lastHalf: bar + CB >= f.bars, firstHalf: bar === 0 };
  }
  const chText = (f) => (f.id === "intro" ? INTRO_CH : f.id === "A" ? A_CH[f.end] : f.id === "B" ? B_CH : DEEP_CH);
  const progCache = new Map();
  const progOf = (f) => { const k = chText(f); if (!progCache.has(k)) progCache.set(k, T.progression(k, BPB)); return progCache.get(k); };

  // the chip: who wins a hardware voice when eight are busy
  const PRIORITY = { flute: 6, clar: 6, counter: 5, kick: 5, pad: 5, bass: 5, snare: 4, bell: 4, pluck: 2, tom: 2, hat: 1, shk: 1 };
  // melody colours and their ranges; the hook runs E4–F#5, so the flute cannot hold its low bars and hands them over
  const RANGE = { flute: [66, 93], clar: [52, 79], bell: [62, 96], counter: [50, 70] };
  const V = (...names) => names.map((n) => ({ track: n, range: RANGE[n], octaves: false, gain: n === "bell" ? 0.8 : 1 }));

  // tempo: the deep is slower; cycle 8 (the second half of A3) sinks into it, B2 climbs out, A4 lifts
  const tempoAt = G.tempoScript(BPM, [
    G.aTempo(0, BPM),
    G.ritardando(8, 88, 12, true),
    G.accelerando(11, BPM, 6, true),
    G.accelerando(13, BPM + 2, 3, true),
  ]);
  // the 6/8 lilt: the second and fifth eighths lean late and soft, the fourth (beat 2 of the two) a hair early
  const LILT = { unit: 0.5, offsets: [0, 0.012, 0.02, -0.006, 0.012, 0.028], vels: [1, 0.64, 0.8, 0.9, 0.62, 0.74] };
  const BACK = { unit: 0.5, offsets: [0, 0, 0, 0.03, 0, 0], vels: [1, 1, 1, 1, 1, 1] }; // the snare on 2 sits late

  /** Everything hand-written for one section of one lap, routed to tracks (at = beats from the section start). */
  function plan(f, lap, r) {
    const prog = progOf(f);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.min(b, f.bars * BPB - 0.01)).chord).scale;
    const L = lap % 2;
    const notes = [];
    const vel = (xs, v) => xs.map((n) => ({ ...n, vel: n.vel ?? v }));
    let label = "";
    if (f.id === "intro") {
      if (lap > 0) notes.push(...A_TUNE.down.filter((n) => n.at < 3).map((n) => ({ ...n, at: n.at + 6, track: "bell", vel: 0.5 })));
      label = lap === 0 ? "intro · the pluck finds the water" : "intro · the bell remembers the turn";
    } else if (f.id === "A" && f.how === "solo") {
      notes.push(...vel(A_TUNE[f.end], 0.8).map((n) => ({ ...n, track: "flute" })));
      label = "A · the hook on the flute, down by thirds";
    } else if (f.id === "A" && f.how === "handoff") {
      const voices = L ? V("bell", "flute", "clar") : V("flute", "clar", "bell");
      notes.push(...D.distribute(vel(A_TUNE[f.end], 0.78), { voices, mode: "handoff", join: L ? "double" : "extend", overlap: 0.25, handoffDur: 1.5, stay: 0.35, rng: r, bpb: BPB }));
      label = `A · handed over as it descends${L ? ", doubled at the joins" : ""}`;
    } else if (f.id === "A" && f.how === "phrase") {
      const order = L ? ["bell", "flute", "flute", "bell"] : ["flute", "bell", "flute", "flute"];
      notes.push(...D.distribute(vel(A_TUNE[f.end], 0.78), { voices: V("flute", "bell"), mode: "phrase", order, rng: r, bpb: BPB }));
      notes.push(...D.separate(A_TUNE[f.end], vel(A_CNT, 0.48), { range: RANGE.counter, prefer: "below", min: 3, bpb: BPB, phrases: [[0, 12], [12, 24]] }).map((n) => ({ ...n, track: "counter" })));
      label = "A · a phrase each, the clarinet counter below";
    } else if (f.id === "A") { // tutti, closed
      const t = vel(A_TUNE.close, 0.82);
      notes.push(...t.map((n) => ({ ...n, track: "flute" })));
      notes.push(...t.map((n) => ({ ...n, track: "clar", note: n.note - 12, vel: 0.6 })));
      notes.push(...t.filter((n) => n.dur >= 1.5).map((n) => ({ ...n, track: "bell", vel: 0.42 })));
      notes.push(...D.separate(t, vel(A_CNT_CLOSE, 0.46), { range: RANGE.counter, prefer: "below", min: 3, bpb: BPB, phrases: [[0, 12], [12, 24]] }).map((n) => ({ ...n, track: "counter" })));
      label = "A · all together, the clarinet an octave below · the closed ending";
    } else if (f.id === "B" && f.how === "solo") {
      notes.push(...vel(B_TUNE, 0.8).map((n) => ({ ...n, track: "flute" })));
      notes.push(...vel(B_CNT, 0.44).map((n) => ({ ...n, track: "counter" })));
      label = "B · D, B♭, G♭ and back · the clarinet holds the common tone";
    } else if (f.id === "B") {
      const voices = L ? V("bell", "flute") : V("flute", "bell");
      notes.push(...D.distribute(vel(B_TUNE, 0.78), { voices, mode: "handoff", join: "extend", overlap: 0.25, handoffDur: 1.5, stay: 0.4, rng: r, bpb: BPB }));
      label = "B · flute and bell hand it over · pluck sixteenths";
    } else { // the deep
      const slow = D.answer(A_TUNE.down.filter((n) => n.phrase < 2), { track: "clar", transform: [{ augment: 2 }, { transpose: -12 }], at: 0, scaleAt, range: [50, 70], vel: 0.62, bpb: BPB });
      notes.push(...slow);
      label = "the deep · the hook twice as slow, an octave down, over the pedal";
    }
    return { prog, notes, label };
  }

  Sim.register({
    id: "sunken-causeway",
    title: "Sunken Causeway",
    genre: "16-bit water stage",
    about: "A flooded road, still water, lanterns somewhere above: a 6/8 cave stage in B minor for an eight-voice sound chip whose echo does the water. A hand-written hook descends by thirds (Bm, G, Em, C) and is passed between flute, clarinet and bell as it sinks; a B theme drifts around the major-third cycle D, B♭, G♭ and comes back; the deep slows to 88 with the tune twice as slow on the clarinet over a pedal. Light percussion with a lilt, rubato on the tune, the chip's voice budget keeping the arrangement thin.",
    situations: ["explore", "mystery"],
    energy: 0.38,
    bpm: BPM, beatsPerBar: BPB, strongBeats: STRONG, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const chip = Sim.spc.chip(ctx, {
        voices: VOICES, volume: -7, rate: 32000, bits: 8, crush: 0.4, tone: 6800,
        echo: { time: 0.16, feedback: 0.52, tone: 2000, lowcut: 180, level: -5 },
      });
      const flute = chip.voice("flute", { priority: PRIORITY.flute, echo: 0.62, pan: 0.1, volume: 0, cutoff: 4200, attack: 0.05, release: 0.12, vibrato: { rate: 4.8, depth: 0.11, delay: 0.4 } });
      const clar = chip.voice("clarinet", { priority: PRIORITY.clar, echo: 0.48, pan: -0.25, volume: -1.5, cutoff: 3200, attack: 0.04, release: 0.1, vibrato: { rate: 4.6, depth: 0.05, delay: 0.5 } });
      const cnt = chip.voice("clarinet", { priority: PRIORITY.counter, echo: 0.4, pan: 0.22, volume: -4.5, cutoff: 2600, attack: 0.08, release: 0.15, vibrato: { rate: 4.4, depth: 0.04, delay: 0.6 } });
      const bell = chip.voice("bell", { poly: 2, priority: PRIORITY.bell, echo: 0.68, pan: 0.32, volume: -3, cutoff: 6500, decay: 1.4 });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.3, pan: -0.12, volume: -6, cutoff: 2600, attack: 0.3, release: 0.6, vibrato: { rate: 0.5, depth: 0.04, delay: 0 } });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.7, pan: 0.38, volume: -4, cutoff: 6000, decay: 0.3 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.14, pan: 0, volume: -1, cutoff: 150, grit: 7, decay: 0.4, sustain: 0.6 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: 2, note: 40, decay: 0.26, octaves: 3.5 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.4, pan: 0.05, volume: 0, decay: 0.13, tone: 2300, body: 170 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.2, volume: -2, cutoff: 7500, closed: 0.04, open: 0.3 });
      const shk = chip.voice("hat", { priority: PRIORITY.shk, pan: 0.28, volume: -6, cutoff: 5200, sweep: 1200, closed: 0.09, open: 0.14 });
      const tom = chip.voice("tom", { priority: PRIORITY.tom, echo: 0.35, pan: 0.15, volume: 1, decay: 0.3 });
      const hum = { timing: 0.002, vel: 0.04 }; // a chip does not breathe; the groove module and the velocities do
      return {
        flute: { layer: "melody", play: flute.play, humanize: hum },
        clar: { layer: "melody", play: clar.play, humanize: hum },
        bell: { layer: "melody", play: bell.play, humanize: hum },
        counter: { layer: "harmony", play: cnt.play, humanize: hum },
        pad: { layer: "harmony", play: pad.play, humanize: hum },
        pluck: { layer: "texture", play: pluck.play, humanize: hum },
        bass: { layer: "bass", play: bass.play, humanize: hum },
        kick: { layer: "drums", play: kick.play, humanize: hum },
        snare: { layer: "drums", play: snare.play, humanize: hum },
        hat: { layer: "drums", play: hat.play, humanize: hum },
        shk: { layer: "drums", play: shk.play, humanize: hum },
        tom: { layer: "drums", play: tom.play, humanize: hum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, cl, f, nf, off } = W;
      const L = lap % 2;
      const key = `${lap}:${W.i}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...plan(f, lap, r.fork(7)) };
      const { prog, notes } = state.plan;
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beats from this cycle's start
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (abs) => chordAt(Math.min(s0 + abs, f.bars * BPB - 0.01)).chord; // abs within the cycle
      const chAt = (abs) => T.chord(symAt(abs));
      const isA = f.id === "A", isB = f.id === "B", deep = f.id === "deep", intro = f.id === "intro";
      if (state.bassLast == null) Object.assign(state, { bassLast: 35, pv: null, lastFill: null, stolen: 0, dropped: 0 });

      // ---------- the tune (hand-written, routed) ----------
      for (const n of notes) {
        if (n.at < s0 - 1e-6 || n.at >= s1 - 1e-6) continue;
        const { at, bar, beat, idx, ...rest } = n;
        const abs = at - s0;
        const extra = { ...rest };
        let dur = n.dur, v = n.vel;
        const wind = n.track === "flute" || n.track === "clar";
        if (wind) {
          // the chip voices read ev.bend: an entrance scoops up from below, a phrase-final long note settles from above
          if (n.entrance && n.dur >= 1) extra.bend = { cents: -70, time: 0.09 };
          else if (n.dur >= 1.5 && r.chance(0.3)) extra.bend = { cents: 30, time: 0.06 };
          dur = n.dur - (n.handoff ? 0 : 0.05);
          if (n.entrance) v += 0.02;
        } else if (n.track === "bell") dur = Math.min(n.dur, 1.5);
        else if (n.track === "counter") { dur = n.dur - 0.12; v += n.at % BPB === 0 ? 0.02 : 0; }
        push(n.track, abs, dur, n.note, v, extra);
      }
      /** Pitches of the hand-written lines sounding at a beat (within the cycle). */
      const melodyAt = (abs) => notes.filter((n) => n.at <= s0 + abs + 1e-6 && n.at + n.dur > s0 + abs + 0.05).map((n) => n.note);

      // ---------- pad: the plain chord (the tune and the bass carry the colours), thinner when the pluck needs voices ----------
      const plain = (s) => s.replace(/\/[A-G][#b]?$/, "").replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/13sus4/, "7sus4").replace(/#11/, "").replace(/7b9/, "7");
      const voicing = (abs, n) => {
        const v = T.voice(plain(symAt(abs)), { lo: 55, hi: 74, n, rootless: true, prev: state.pv, spread: "close", top: [62, 74] });
        state.pv = v;
        return v;
      };
      const chordsHere = prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const padN = intro ? (lap === 0 ? 2 : 3) : deep ? 2 : isB ? (f.how === "solo" ? 3 : 2) : f.how === "solo" ? 2 : 2;
      chordsHere.forEach((h) => {
        const abs = h.bar * BPB + h.beat;
        if (intro && lap === 0 && abs < 3) return; // the pluck alone for the first bar
        const d = h.dur - 0.35;
        if (d >= 0.5) push("pad", abs, d, voicing(abs, padN), deep ? 0.46 : isB ? 0.52 : 0.5);
      });
      /** A chord stab at the drums' priority: three voices that cut the hat, the pluck and the bass for a moment. */
      const stab = (abs, v = 0.6, dur = 0.3) => push("pad", abs, dur, voicing(abs, 3), v, { priority: 5 });

      // ---------- pluck: eighths (or sixteenths) through the plain chord, up on even bars ----------
      const arpBar = (bar, v, o = {}) => {
        const B = bar * BPB, c = T.chord(plain(symAt(B)));
        const tones = T.notesIn(c.pcs, o.lo ?? 64, o.hi ?? 86);
        if (!tones.length) return;
        const up = o.dir ?? ((off + bar) % 2 === 0);
        const seq = up ? tones : tones.slice().reverse();
        const step = o.sixteenths ? 0.25 : 0.5, n = Math.round(BPB / step), period = Math.max(1, 2 * seq.length - 2);
        for (let s = 0; s < n; s++) {
          const pos = s * step;
          if (o.until != null && pos >= o.until) break;
          if (o.from != null && pos < o.from) continue;
          const k = s % period < seq.length ? s % period : period - (s % period);
          push("pluck", B + pos, step * 0.85, seq[k], v * (pos % 1.5 === 0 ? 1 : pos % 0.5 === 0 ? 0.8 : 0.66) + r.range(-0.02, 0.02));
        }
      };

      // ---------- bass ----------
      const near = (pc, from, lo = 31, hi = 45) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 38); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const nextRootPc = (i) => {
        if (i + 1 < chordsHere.length) return T.chord(chordsHere[i + 1].chord).bass;
        if (!W.lastHalf) return T.chord(prog.find((h) => h.bar === off + CB).chord).bass;
        return T.chord(progOf(nf)[0].chord).bass;
      };
      let last = state.bassLast;
      const style = intro || deep ? "pedal" : isB ? "float" : f.how === "solo" ? "lilt" : f.how === "tutti" ? "walk" : "lilt";
      chordsHere.forEach((h, i) => {
        const s = h.bar * BPB + h.beat, d = h.dur, c = T.chord(h.chord);
        const R = near(c.bass, last);
        const O = R + 12 <= 50 ? R + 12 : R;
        const F5 = near(mod12(c.bass + 7), R, 31, 47);
        const N = near(nextRootPc(i), R);
        // the note before the next root: a half step or a whole step from the side the line travels, or the fifth;
        // never one that rubs (a semitone or a minor ninth) against a melody note sounding at that moment
        const apAt = (b) => {
          const sounding = melodyAt(s + b);
          const clean = (m) => !sounding.some((x) => Math.abs(x - m) % 12 === 1);
          const side = N === R ? [[F5, 1]] : N > R ? [[N - 1, 2], [N - 2, 1.2], [F5, 0.8]] : [[N + 1, 2], [N + 2, 1.2], [F5, 0.8]];
          const ok = side.filter(([m]) => m !== R && m >= 31 && m <= 45 && clean(m));
          return ok.length ? r.weighted(ok) : clean(F5) ? F5 : R;
        };
        const add = (b, dur, n, v) => { if (b < d - 0.01) push("bass", s + b, Math.min(dur, d - b - 0.03), n === "ap" ? apAt(b) : n, v + r.range(-0.02, 0.02)); };
        if (d < 3) { // a split bar: the root, then a step toward what follows
          add(0, 1.2, R, 0.84); if (h.beat > 0 || style === "walk") add(1, 0.45, "ap", 0.6);
        } else if (style === "pedal") {
          add(0, 1.35, R, 0.84); add(2, 0.45, R, 0.6);
          if (d >= 3 && r.chance(0.45)) add(2.5, 0.45, O, 0.5);
        } else if (style === "float") {
          add(0, 1.4, R, 0.84);
          if (d >= 3) { if (r.chance(0.5)) add(1.5, 0.9, F5, 0.6); add(2.5, 0.45, r.chance(0.5) ? O : "ap", 0.58); }
        } else if (style === "lilt") {
          const fig = r.weighted([
            [[[0, 1.35, R, 0.86], [2, 0.45, O, 0.62], [2.5, 0.45, "ap", 0.6]], 3],
            [[[0, 0.9, R, 0.86], [1, 0.4, R, 0.5], [1.5, 0.9, F5, 0.64], [2.5, 0.45, "ap", 0.6]], 2],
            [[[0, 1.35, R, 0.86], [1.5, 0.9, F5, 0.62], [2.5, 0.45, "ap", 0.58]], 1.5],
          ]);
          fig.forEach(([b, dur, n, v]) => add(b, dur, n, v));
        } else { // walk: eighths on the back half, the fifth below, back to the root, a step on
          add(0, 1.35, R, 0.88); add(1.5, 0.45, F5, 0.66); add(2, 0.45, R, 0.6); add(2.5, 0.45, "ap", 0.62);
        }
        last = R;
      });
      state.bassLast = Math.max(31, Math.min(45, last));

      // ---------- drums ----------
      const drum = (track, abs, vel, extra) => push(track, abs, track === "hat" && extra?.open ? 0.6 : 0.25, track, vel, extra);
      const secBar = (i) => off + i; // bar within the section
      const lastBar = (i) => W.lastHalf && i === CB - 1;
      const FILLS = ["snare16", "toms", "hits", "roll"];
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill)); state.lastFill = k; return k; };
      const fill = (bar, kind) => {
        const B = bar * BPB;
        if (kind === "snare16") { for (let q = 0; q < 6; q++) drum("snare", B + 1.5 + q * 0.25, 0.42 + 0.08 * q); drum("kick", B + 1.5, 0.8); }
        else if (kind === "roll") { for (let q = 0; q < 4; q++) drum("snare", B + 2 + q * 0.25, 0.4 + 0.1 * q); drum("tom", B + 2.75, 0.62, { pitch: 48 }); }
        else if (kind === "toms") { [[1.5, 62], [2, 57], [2.5, 52], [2.75, 47]].forEach(([b, p], i) => drum("tom", B + b, 0.58 + 0.04 * i, { pitch: p })); drum("snare", B + 1.5, 0.6); }
        else { [2, 2.5].forEach((b) => { drum("kick", B + b, 0.9); drum("snare", B + b, 0.82); stab(B + b, 0.68, 0.28); }); }
        return kind === "snare16" || kind === "toms" ? 1.5 : 2;
      };
      const st = intro ? (lap === 0 ? "in" : "air") : deep ? "deep" : isB ? (f.how === "solo" ? "float" : "pocket") : f.how === "solo" ? (lap === 0 ? "soft" : "pocket") : f.how === "tutti" ? "full" : "pocket";
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = secBar(i), odd = bar % 2 === 1;
        let cut = 9;
        const closing = f.how === "tutti" && lastBar(i); // the closed ending lands: one hit on the Bm9, then the echo
        if (closing) { cut = 1.5; drum("kick", B0 + 1.5, 0.92); drum("tom", B0 + 1.5, 0.6, { pitch: 47 }); drum("hat", B0 + 1.5, 0.6, { open: true }); }
        else if (lastBar(i) && !deep) cut = fill(i, pickFill(st === "soft" || st === "float" || st === "air" ? ["toms", "roll"] : st === "full" ? ["hits", "snare16", "toms"] : ["snare16", "toms", "roll"]));
        const ok = (b) => b < cut;
        const K = (b, v) => { if (ok(b)) drum("kick", B0 + b, v); };
        const S = (b, v, extra) => { if (ok(b)) drum("snare", B0 + b, v, extra); };
        const H = (b, v, open) => { if (ok(b)) drum("hat", B0 + b, v, open ? { open: true } : undefined); };
        const hats = (v, open) => { for (let e = 0; e < 6; e++) H(e * 0.5, v, open && odd && e === 5); };
        const shaker = (v) => { for (let e = 0; e < 6; e++) if (ok(e * 0.5)) drum("shk", B0 + e * 0.5, v); };
        if (st === "in") { if (bar >= 2) { hats(0.5); shaker(0.5); } if (bar === 3) K(0, 0.8); continue; }
        if (st === "air") { shaker(0.45); if (bar === 0) K(0, 0.7); if (bar >= 2) S(1.5, 0.4); continue; }
        if (st === "soft") { hats(0.5); K(0, 0.86); if (odd) K(2, 0.5); S(1.5, 0.58); }
        if (st === "float") { hats(0.46); K(0, 0.84); if (odd) K(2.5, 0.5); S(1.5, 0.52); if (r.chance(0.3)) S(2.5, 0.3, { ghost: true }); }
        if (st === "pocket" || st === "full") {
          hats(0.52, true); shaker(0.42);
          K(0, 0.9); K(2, 0.62); if (odd && r.chance(0.6)) K(2.5, 0.48);
          S(1.5, st === "full" ? 0.78 : 0.7);
          if (r.chance(0.35)) S(1, 0.3, { ghost: true });
          if (r.chance(0.3)) S(2.75, 0.3, { ghost: true });
          if (st === "full" && !odd && ok(2.5)) drum("tom", B0 + 2.5, 0.5, { pitch: 55 });
        }
        if (st === "deep") {
          shaker(bar < 4 ? 0.4 : 0.48);
          K(0, 0.72); if (bar >= 4 && odd) K(2, 0.46);
          if (bar >= 4 && bar < 6) S(1.5, 0.4);
          if (bar >= 6) for (let q = 0; q < 6; q++) drum("snare", B0 + 1.5 + q * 0.25, 0.3 + 0.07 * q + (bar === 7 ? 0.12 : 0));
        }
        if (cut < 9 && !closing) ev = G.crescendo(ev, { tracks: ["snare", "tom", "kick"], from: B0 + cut, to: B0 + BPB, v0: 0.85, v1: 1.15, curve: 1.2, bpb: BPB });
      }
      if ((f.how === "tutti" || (isB && f.how === "handoff")) && off === 0) drum("hat", 0, 0.62, { open: true });

      // ---------- pluck and bell glints by section ----------
      for (let i = 0; i < CB; i++) {
        const bar = secBar(i);
        if (intro) arpBar(i, lap === 0 ? 0.56 : 0.46, { until: bar === 3 ? 1.5 : undefined });
        else if (isA && f.how === "solo") { if (bar >= 4 || lap > 0) arpBar(i, 0.4, { until: bar === 7 ? 1.5 : undefined }); }
        else if (isA && f.how === "handoff" && lap > 0) arpBar(i, 0.38, { until: bar === 7 ? 1.5 : undefined });
        else if (isB && f.how === "handoff") arpBar(i, 0.4, { sixteenths: true, lo: 67, hi: 89, until: bar === 7 ? 2 : undefined });
        else if (isB && lap > 0) arpBar(i, 0.36, { until: bar === 7 ? 2 : undefined });
        else if (deep && bar >= 2) { // bell glints: a high chord tone on the and of the second pulse, now and then two
          const B = i * BPB, c = chAt(B);
          if (r.chance(bar >= 6 ? 0.9 : 0.6)) {
            const top = T.nearest(r.pick([79, 81, 83, 86]), c.pcs, 76, 91);
            push("bell", B + r.pick([1.5, 2, 2.5]), 1.2, top, 0.42);
            if (r.chance(0.35)) push("bell", B + 0.5, 1, T.nearest(top - 5, c.pcs, 72, 86), 0.34);
          }
        }
      }

      // ---------- feel ----------
      ev = G.ghosts(ev, { tracks: ["snare"], vel: 0.22, dur: 0.1 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          bass: { template: LILT, late: 3, vels: false },
          pluck: { template: LILT, late: 5 },
          hat: { template: LILT, late: -3 },
          shk: { template: LILT, late: -2, amount: 0.8 },
          snare: { template: BACK, late: 8 },
          tom: { template: LILT, late: 4, vels: false },
          kick: { template: "straight" },
          pad: { template: "straight", late: 20, vels: false },
          counter: { template: "straight", late: 16, vels: false },
        },
      });
      const rub = deep ? 1 : isB ? 0.8 : f.how === "tutti" ? 0.5 : 0.7;
      for (const t of ["flute", "clar", "bell"]) ev = G.rubato(ev, { track: t, bpm: BPM, bpb: BPB, amount: rub, linger: isB ? "both" : "high", lingerMs: isB ? 60 : 45, gap: 0.75, rng: r });

      // ---------- the chip: eight voices, stolen by priority; the score shows what survived ----------
      const bud = Sim.spc.budget(ev, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      const harmony = chordsHere;
      return { events: bud.events, harmony, section: `Lap ${lap + 1} · ${state.plan.label}`, state, tempo: tempoAt(cl) };
    },
  });
})();

// Harbour Mouth: a coastal town's morning. Boats going out through the harbour mouth, gulls over the quay, the
// first light on the water. D major, 6/8 at 114 (dotted quarter = 76), counted in quarter beats (a bar is 3, an
// eighth is 0.5, the pulses at 0 and 1.5). A concertina sings; a nylon guitar rolls the water under it; a mandolin
// (double course, tremolo on its long notes) and a low whistle take the tune in the middle; a soft upright bass
// that walks only once a lap; a frame drum heartbeat with a harbour bell and a triangle for accents.
//
// THE TUNE (fixed by hand; the generator never changes a pitch or a rhythm, only who plays it and how it is dressed)
//   a (4 bars): a rising fourth and a turn, in the long-short lilt of 6/8.
//     | D   A4 B4 D5·        | Bm  D5 E5 D5 B4 A4   | G   G4 A4 B4·         | A   C#5 B4 A4·        |
//   a′ (4 bars): the same start, the turn goes up this time, and the phrase lands on the fifth with a breath.
//     | D   A4 B4 D5·        | Bm  D5 E5 D5 F#5 D5  | Em A  E5 D5 C#5 B4    | D   A4·  (r) B4 D5    |  ← pickup
//   b (8 bars): the wide, singing second phrase: up to G5, back down, climbing again to A5 (the top of the piece),
//     then B minor slips up a semitone into C major, the one modal turn (♭VII), and the tune comes home through it.
//     | Gmaj7 G5· F#5 E5     | D/F# F#5 E5 D5·      | Em7 E5 F#5 G5·        | A7  A5· G5 E5         |
//     | Bm  F#5 D5 B4·       | C   C5 D5 E5·        | D   D5 E5 F#5 D5      | A7  E5 (held)         |   open
//                                                   | Gmaj7 D5 E5 F#5 D5    | D   D5 (held)         |   closed
//   Counter (final statement only, mandolin, one note per pulse under b): B4 D5 | F#4 A4 | G4 B4 | C#5 E5 | D5 F#4 | G4 C5 | B4 B4 | F#4
//   Gulls (the link, low whistle): two-note cries, a scoop up and a fall off, over | D | C/D | D | A7sus4 |.
//   Tail: the head once more over | D | Gmaj7 |, answered high by the mandolin; then B♭ A G over the borrowed iv (Gm6),
//     F# E D home; four bars of water, bell and heartbeat over | Bm7 | Gmaj7 | A7sus4 | A7sus4 |, slowing a little.
//
// FORM, one lap = 64 bars ≈ 1:41: intro 4 · A 16 (concertina; mandolin on every third lap) · gulls 4 ·
//   M 16 (the tune passed between the whistle an octave up, the concertina and the mandolin; the bass walks) ·
//   A 16 (concertina, the whistle doubling the wide phrase an octave up, the mandolin counter from lap 2; closed) · tail 8.
// Modules: Sim.phrasing (the concertina and whistle wrappers: slurs, swells, scoops, falls, breaths; notation),
//   Sim.dialogue (distribute / answer / separate), Sim.groove (a 6/8 sway template, rubato on the singers, a ritardando).
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue, G = Sim.groove, PH = Sim.phrasing;
  const { mod12 } = T;
  const BPB = 3, CB = 4, BPM = 114;
  const STRONG = [0, 1.5];
  const db = (x) => Math.pow(10, x / 20);
  const arr = (n) => (Array.isArray(n) ? n : [n]);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- the score (Sim.phrasing notation: Note/beats + marks; r = rest; a bar is 3 beats) ----------
  const A_BARS = [
    "A4/1 B4/0.5 D5/1.5",
    "D5/0.5 E5/0.5 D5/0.5 B4/1 A4/0.5",
    "G4/1 A4/0.5 B4/1.5",
    "C#5/1 B4/0.5 A4/1.5",
    "A4/1 B4/0.5 D5/1.5",
    "D5/0.5 E5/0.5 D5/0.5 F#5/1 D5/0.5",
    "E5/1 D5/0.5 C#5/1 B4/0.5",
    "A4/1.5 r/0.5 B4/0.5 D5/0.5",
    "G5/1.5s F#5/1 E5/0.5",
    "F#5/1 E5/0.5 D5/1.5",
    "E5/1 F#5/0.5 G5/1.5",
    "A5/1.5s G5/1 E5/0.5",
    "F#5/1 D5/0.5 B4/1.5",
    "C5/1 D5/0.5 E5/1.5",
    "D5/1 E5/0.5 F#5/1 D5/0.5",
  ];
  const A_END = { open: "E5/2 r/1", closed: "D5/2.5 r/0.5" };
  const A_CH = {
    open: "| D | Bm | G | A | D | Bm | Em:1.5 A:1.5 | D | Gmaj7 | D/F# | Em7 | A7 | Bm | C | D | A7 |",
    closed: "| D | Bm | G | A | D | Bm | Em:1.5 A:1.5 | D | Gmaj7 | D/F# | Em7 | A7 | Bm | C | Gmaj7 | D |",
  };
  // the counter under b (bars 9-16), one note per pulse
  const CNT_BARS = ["B4/1.5 D5/1.5", "F#4/1.5 A4/1.5", "G4/1.5 B4/1.5", "C#5/1.5 E5/1.5", "D5/1.5 F#4/1.5", "G4/1.5 C5/1.5", "B4/1.5 B4/1.5", "F#4/3"];
  const INTRO_CH = "| D | Gmaj7/D | D | A7sus4 |";
  const LINK_CH = "| D | C/D | D | A7sus4 |";
  const TAIL_CH = "| D | Gmaj7 | Gm6 | D | Bm7 | Gmaj7 | A7sus4 | A7sus4 |";
  const TAIL_LEAD = ["A4/1 B4/0.5 D5/1.5s", "r/3", "Bb4/1 A4/0.5 G4/1.5", "F#4/1 E4/0.5 D4/1.5", "r/3", "r/3", "r/3", "r/3"];
  // gull cries for the low whistle: ^ scoop in from below, f fall off at the end
  const CRIES = [
    ["r/1.5 A5/0.5^1 F#5/1f2", "r/3", "r/1.5 D6/0.5^1 A5/1f3", "r/3"],
    ["r/2 A5/0.5^1 F#5/0.5f2", "r/3", "r/0.5 F#5/0.5^1 D5/0.5 A5/1.5f3", "r/3"],
    ["r/3", "r/1.5 E6/0.5^1 C6/1f2", "r/3", "r/1.5 A5/1.5f3"],
  ];
  const GULL_FAR = "r/1.5 D6/0.5^1 B5/1f2"; // one far-off cry over a Gmaj7 bar
  // phrase marks (beats from the section start): a, a′, the pickup-and-climb, the turn home
  const PHR_A = [
    { from: 0, to: 12, dyn: "arch", legato: true },
    { from: 12, to: 23, dyn: "arch", legato: true },
    { from: 23, to: 36, dyn: "<", legato: true },
    { from: 36, to: 48, dyn: ">", legato: true, lengthen: 1.15 },
  ];
  const PHR_TAIL = [{ from: 0, to: 4.5, dyn: "arch", legato: true }, { from: 6, to: 12, dyn: ">", legato: true, lengthen: 1.2 }];

  /** Notation → dialogue notes { at, dur, note, art, phrase, vel } with a velocity contour (higher and longer a touch louder). */
  function toNotes(bars, base = 0.64, barOffset = 0) {
    return PH.line(bars, { beatsPerBar: BPB }).map((e) => {
      const bar = e.bar + barOffset, at = bar * BPB + e.beat;
      let phrase = Math.floor(bar / 4);
      if (bar === 7 && e.beat >= 2) phrase = 2; // the pickup belongs to the wide phrase
      return { at, dur: e.dur, note: e.note, art: e.art, phrase, vel: base + (e.note - 72) / 150 + (e.dur >= 1.5 ? 0.04 : 0) };
    });
  }
  const TUNE = { open: toNotes(A_BARS.concat([A_END.open])), closed: toNotes(A_BARS.concat([A_END.closed])) };
  const HEAD = TUNE.open.slice(0, 3);
  const CNT = toNotes(CNT_BARS, 0.38, 8);
  /** Dialogue note → conductor-style event (bar/beat relative to the section), keeping the fields the wrappers read. */
  function toEv(n) {
    const { at, idx, voice, shift, track, ...rest } = n;
    const bar = Math.floor(at / BPB + 1e-9);
    return { ...rest, bar, beat: +(at - bar * BPB).toFixed(4) };
  }
  const RANGE = { whistle: [79, 95], lead: [57, 84], mandolin: [62, 88] };
  const V = (...names) => names.map((n) => ({ track: n, range: RANGE[n], gain: n === "whistle" ? 0.78 : n === "mandolin" ? 0.9 : 1, weight: n === "whistle" ? 2 : 1 }));

  // ---------- articulation per player ----------
  /** The concertina: slurred phrases, bellows swells on the long notes, a grace into a leap, a mordent now and then. */
  function leadLine(evs, marks, c) {
    const r = c.r;
    evs.forEach((e, i) => {
      const prev = evs[i - 1];
      const leap = prev ? e.note - prev.note : 0;
      const a = PH.parseArt(e.art || "");
      if (!a.swell && !a.grace && !a.mordent) {
        if (leap >= 4 && e.dur >= 1 && r.chance(c.orn * 0.6)) e.grace = "step";
        else if (e.dur >= 1.5 && r.chance(c.orn * 0.3)) e.mordent = true;
      }
      e.vel = clamp((e.vel ?? 0.64) + r.gauss(0.012), 0.05, 1);
    });
    return PH.articulate(evs, marks, { beatsPerBar: BPB, scale: c.scaleAt, lengthen: 1.12, breathLate: 0.04, breathGap: 0.15, breathFirst: true, glide: 0.012 });
  }
  /** The low whistle: tongued at the pulse, slurred inside it; a scoop into an entrance; a fall off the end of a phrase. */
  function whistleLine(src, marks, c, vel = 0.5) {
    const r = c.r;
    const evs = Array.isArray(src) && typeof src[0] === "string" ? PH.line(src, { beatsPerBar: BPB, vel }) : src;
    const lastOf = {};
    evs.forEach((e) => { if (e.phrase != null) lastOf[e.phrase] = e; });
    evs.forEach((e) => {
      const a = PH.parseArt(e.art || "");
      if (Math.abs(e.beat % 1.5) < 1e-6 && !a.legato) e.legato = false;
      if (e.entrance && e.dur >= 1 && !a.scoop && !a.fall) e.scoop = 1;
      if (lastOf[e.phrase] === e && !a.fall && e.dur >= 1.5 && r.chance(0.35 + c.orn * 0.4)) e.fall = 2;
      else if (e.dur >= 1.5 && !a.scoop && !a.grace && r.chance(c.orn * 0.4)) e.grace = "step";
      e.vel = clamp((e.vel ?? vel) + r.gauss(0.012), 0.05, 1);
    });
    return PH.articulate(evs, marks, { beatsPerBar: BPB, scale: c.scaleAt, lengthen: 1.1, breathLate: 0.03, breathGap: 0.12, breathFirst: true, glide: 0.05 });
  }
  /** The mandolin: plucked, so no slurs; its long notes are tremolo-picked (expanded in compose). */
  function mandolinLine(evs, o = {}) {
    const out = evs.map((e) => { const { art, ...rest } = e; return { ...rest, vel: e.vel ?? 0.5 }; });
    if (o.trem) out.forEach((e) => { if (e.dur >= 2 || (e.dur >= 1.5 && o.r.chance(0.55))) e.trem = true; });
    if (o.tremLast && out.length) out[out.length - 1].trem = true;
    return out;
  }

  // ---------- form ----------
  const LAP = [
    { id: "intro", bars: 4, ch: INTRO_CH },
    { id: "A1", bars: 16, ch: A_CH.open },
    { id: "link", bars: 4, ch: LINK_CH },
    { id: "M", bars: 16, ch: A_CH.open },
    { id: "A2", bars: 16, ch: A_CH.closed },
    { id: "tail", bars: 8, ch: TAIL_CH },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB; // 64 bars, 16 cycles
  const progCache = new Map();
  const progOf = (f) => { if (!progCache.has(f.ch)) progCache.set(f.ch, T.progression(f.ch, BPB)); return progCache.get(f.ch); };
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    let bar = cl * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, cl, i, f, nf, off: bar, first: bar === 0, last: bar + CB >= f.bars };
  }
  // the tail's last three bars slow a little; the next lap starts a tempo
  const tempoAt = G.tempoScript(BPM, [G.aTempo(0, BPM), G.ritardando(15, 104, 9, true)]);
  // the 6/8 sway: the second eighth of each pulse leans late and soft, the second pulse a hair early
  const SWAY = { unit: 0.5, offsets: [0, 0.03, 0.012, -0.008, 0.03, 0.018], vels: [1, 0.62, 0.8, 0.9, 0.6, 0.74] };

  /** Everything hand-written for one section of one lap, routed and articulated (bar/beat relative to the section). */
  function plan(f, lap, r) {
    const prog = progOf(f), chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(clamp(b, 0, f.bars * BPB - 0.01)).chord).scale;
    const L = lap % 3, orn = Math.min(0.6, 0.12 + 0.16 * lap);
    const c = { scaleAt, r, orn };
    const lines = [];
    const add = (track, events) => { if (events && events.length) lines.push({ track, events }); };
    const solo = (tune) => tune.map(toEv);
    let label = "";
    if (f.id === "intro") {
      if (lap > 0 && r.chance(0.6)) add("whistle", whistleLine(["r/3", GULL_FAR, "r/3", "r/3"], null, c, 0.4));
      label = lap === 0 ? "intro · the guitar on the water, the frame drum wakes" : "intro · a gull over the quay";
    } else if (f.id === "A1") {
      if (L === 1) { add("mandolin", mandolinLine(solo(TUNE.open), { trem: true, r })); label = "A · the tune on the mandolin, tremolo on the long notes"; }
      else { add("lead", leadLine(solo(TUNE.open), PHR_A, c)); label = "A · the tune on the concertina"; }
    } else if (f.id === "link") {
      add("whistle", whistleLine(CRIES[(lap + r.int(0, 1)) % CRIES.length], null, c, 0.46));
      label = "gulls · ♭VII over the tonic";
    } else if (f.id === "M") {
      let routed, how;
      if (L === 1) {
        routed = D.distribute(TUNE.open, { voices: V("whistle", "lead", "mandolin"), mode: "handoff", join: "extend", overlap: 0.15, handoffDur: 1.5, minNotes: 3, stay: 0.3, shiftWeight: 1, rng: r, bpb: BPB });
        how = "handed from player to player on the long notes";
        if (!routed.some((n) => n.track === "whistle")) { // the whistle must have the wide phrase at least
          routed = routed.filter((n) => n.phrase !== 2).concat(D.distribute(TUNE.open.filter((n) => n.phrase === 2), { voices: V("whistle"), mode: "phrase", bpb: BPB }));
        }
      } else {
        const order = L === 0 ? ["whistle", "lead", "whistle", "mandolin"] : ["mandolin", "whistle", "lead", "whistle"];
        routed = D.distribute(TUNE.open, { voices: V("whistle", "lead", "mandolin"), mode: "phrase", order, rng: r, bpb: BPB });
        how = "a phrase each: " + order.join(", ");
      }
      for (const t of ["whistle", "lead", "mandolin"]) {
        const xs = routed.filter((n) => n.track === t).map(toEv);
        if (!xs.length) continue;
        add(t, t === "lead" ? leadLine(xs, PHR_A, c) : t === "whistle" ? whistleLine(xs, PHR_A, c) : mandolinLine(xs, { trem: true, r }));
      }
      label = `the tune passed to the whistle an octave up · ${how} · the bass walks`;
    } else if (f.id === "A2") {
      add("lead", leadLine(solo(TUNE.closed), PHR_A, c));
      const wide = TUNE.closed.filter((n) => n.at >= 23).map((n) => ({ ...n, note: n.note + 12, vel: 0.44 }));
      add("whistle", whistleLine(wide.map(toEv), PHR_A, c));
      if (lap >= 1) {
        const cnt = D.separate(TUNE.closed, CNT, { range: [60, 86], prefer: "below", min: 3, bpb: BPB, phrases: [[24, 36], [36, 48]] });
        add("mandolin", mandolinLine(cnt.map(toEv), { tremLast: true }));
      }
      label = `A · concertina, the whistle an octave above on the wide phrase${lap >= 1 ? ", the mandolin counter" : ""} · closed ending`;
    } else {
      add("lead", leadLine(PH.line(TAIL_LEAD, { beatsPerBar: BPB }).map((e) => ({ ...e, vel: 0.6 + (e.note - 72) / 150 })), PHR_TAIL, c));
      add("mandolin", mandolinLine(D.answer(HEAD, { track: "mandolin", transform: { steps: -2 }, at: 3.5, before: 6, scaleAt, range: [69, 84], vel: 0.42, bpb: BPB }).map(toEv), {}));
      if (lap >= 1 && r.chance(0.5)) add("whistle", whistleLine(["r/3", "r/3", "r/3", "r/3", "r/3", GULL_FAR, "r/3", "r/3"], null, c, 0.36));
      label = "tail · the head again, the borrowed iv, the day settles";
    }
    return { prog, lines, label };
  }

  // ---------- the palette ----------
  const REED = { type: "fatcustom", partials: [1, 0.12, 0.6, 0.08, 0.32, 0.05, 0.18, 0.03, 0.1], count: 2, spread: 11 };
  /** Concertina right hand: two reeds a few cents apart (musette), a bellows attack, slurred by the phrasing wrapper. */
  function concertinaSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: REED,
      filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
      envelope: { attack: 0.045, decay: 0.15, sustain: 0.9, release: 0.14 },
      filterEnvelope: { attack: 0.06, decay: 0.3, sustain: 0.75, release: 0.2, baseFrequency: 1400, octaves: 0.9 },
    }));
  }
  /** Concertina left hand: the same reeds, polyphonic, darker. */
  function concertinaChords(ctx, volume) {
    const out = ctx.keep(new Tone.Gain(db(volume)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 1900, type: "lowpass", rolloff: -12 })).connect(out);
    const s = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 8, options: { oscillator: REED, envelope: { attack: 0.07, decay: 0.2, sustain: 0.85, release: 0.25 } } })).connect(lp);
    return { out, play(time, notes, dur, vel) { s.triggerAttackRelease(arr(notes).map(T.hz), dur, time, vel); } };
  }
  /** Low whistle: a near-sine with a little edge, breath noise on phrase starts, late vibrato; scoops and falls from the wrapper. */
  function whistleSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.1, 0.25, 0.04, 0.06] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
      envelope: { attack: 0.03, decay: 0.1, sustain: 0.85, release: 0.2 },
      filterEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.25, baseFrequency: 1800, octaves: 1.2 },
    }));
  }
  /** Mandolin: a double course of bright Karplus-Strong plucks, the second string a few ms behind. */
  function makeMandolin(ctx, I, volume) {
    const out = ctx.keep(new Tone.Gain(db(volume)));
    const body = ctx.keep(new Tone.EQ3({ low: -6, mid: 2, high: 1, lowFrequency: 300, highFrequency: 3200 })).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: 6500, type: "lowpass", rolloff: -12 })).connect(body);
    const N = 8, strings = [], clocks = [];
    for (let i = 0; i < N; i++) {
      const s = ctx.keep(new Tone.PluckSynth({ attackNoise: 1.8, dampening: 7000, resonance: 0.955, release: 0.8 })).connect(lp);
      strings.push(s); clocks.push(I.monotonic(s));
    }
    let k = 0;
    const pluck = (time, m, dur, vel) => { const i = k++ % N; strings[i].triggerAttackRelease(T.hz(m), dur, clocks[i](time), vel); };
    return {
      out,
      play(time, notes, dur, vel = 0.6) {
        for (const m of arr(notes)) { pluck(time, m, dur, vel); pluck(time + 0.007, m, dur, vel * 0.45); }
      },
    };
  }

  Sim.register({
    id: "harbour-mouth",
    title: "Harbour Mouth",
    genre: "Coastal folk",
    about: "A coastal town's morning in D major, 6/8 at a sway: boats going out through the harbour mouth, gulls over the quay, first light on the water. A hand-written tune with a wide singing second phrase and one modal turn (B minor slipping up into C), sung by a musette concertina over a nylon guitar's rolling water, passed to a low whistle an octave up and a double-course mandolin in the middle while the bass walks for the only time; a frame-drum heartbeat, a harbour bell, a triangle. Built with Sim.phrasing, Sim.dialogue and Sim.groove.",
    situations: ["explore", "hangout", "work"],
    energy: 0.4,
    bpm: BPM, beatsPerBar: BPB, strongBeats: STRONG, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.9, preDelay: 0.016, lowcut: 240, highcut: 6500 });
      const air = I.reverb(ctx, out, { decay: 4.6, preDelay: 0.04, lowcut: 320, highcut: 5200 });
      const across = I.delay(ctx, out, { pingPong: true, time: "4n.", feedback: 0.24, highcut: 2800 }); // a cry across the water lands on the next pulse

      const lead = PH.wrap(ctx, concertinaSynth(ctx), {
        volume: -2, glide: 0.012, release: 0.14,
        vibrato: { rate: 5.6, depth: 0.025, delay: 0.5, rise: 0.5, deepen: 1.1 },
        breath: PH.breath(ctx, room, { level: -34, freq: 700, q: 0.6, length: 0.26, attack: 0.08 }), // the bellows sigh
      });
      const whistle = PH.wrap(ctx, whistleSynth(ctx), {
        volume: -5, glide: 0.05, scoopTime: 0.08, fallTime: 0.22, release: 0.2,
        vibrato: { rate: 5.0, depth: 0.06, delay: 0.35, rise: 0.4, deepen: 1.2 },
        breath: PH.breath(ctx, air, { level: -26, freq: 3000, length: 0.16 }),
      });
      const mandolin = makeMandolin(ctx, I, -4);
      const chords = concertinaChords(ctx, -12);
      const nylon = I.nylon(ctx, { volume: -6, cutoff: 3800, dampening: 3600, resonance: 0.95, voices: 10 });
      const bass = I.upright(ctx, { volume: -4, base: 150 });
      const bell = I.bell(ctx, { volume: -16, decay: 5 });
      const glint = I.glock(ctx, { volume: -17, celesta: true, decay: 2.4 });
      const bed = I.glassPad(ctx, { volume: -20, attack: 3, release: 5 });
      const kit = I.kit(ctx, { volume: -4, preload: ["dum", "djembe", "triangle"] });

      const lp = I.place(ctx, lead, -0.08, out), wp = I.place(ctx, whistle, 0.22, out), mp = I.place(ctx, mandolin, 0.3, out);
      const cp = I.place(ctx, chords, -0.18, out), np = I.place(ctx, nylon, -0.3, out), bp = I.place(ctx, bass, 0, out);
      const blp = I.place(ctx, bell, 0.12, out), gp = I.place(ctx, glint, 0.38, out), bdp = I.place(ctx, bed, 0, out), kp = I.place(ctx, kit, -0.05, out);
      I.send(ctx, lp, room, -12); I.send(ctx, lp, air, -16);
      I.send(ctx, wp, room, -12); I.send(ctx, wp, air, -11); I.send(ctx, wp, across, -15);
      I.send(ctx, mp, room, -12); I.send(ctx, mp, air, -16);
      I.send(ctx, cp, room, -13); I.send(ctx, cp, air, -18);
      I.send(ctx, np, room, -13); I.send(ctx, np, air, -20);
      I.send(ctx, bp, room, -26);
      I.send(ctx, blp, air, -4); I.send(ctx, gp, air, -7); I.send(ctx, gp, across, -14); I.send(ctx, bdp, air, -6);
      I.send(ctx, kp, room, -14); I.send(ctx, kp, air, -22);

      return {
        lead: { layer: "melody", humanize: { timing: 0.006, vel: 0.04 }, play: (t, e, d) => lead.play(t, e, d) },
        whistle: { layer: "melody", humanize: { timing: 0.008, vel: 0.04 }, play: (t, e, d) => whistle.play(t, e, d) },
        mandolin: { layer: "melody", humanize: { timing: 0.007, vel: 0.06 }, play: (t, e, d) => mandolin.play(t, e.note, d, e.vel) },
        chords: { layer: "harmony", humanize: { timing: 0.012, vel: 0.04 }, play: (t, e, d) => chords.play(t, e.note, d, e.vel) },
        nylon: { layer: "harmony", humanize: { timing: 0.006, vel: 0.06 }, play: (t, e, d) => nylon.play(t, e.note, d, e.vel, Number.isFinite(e.strum) ? e.strum : 0) },
        bass: { layer: "bass", humanize: { timing: 0.004, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.005, vel: 0.1 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }) },
        bell: { layer: "texture", humanize: { timing: 0.01, vel: 0.06 }, play: (t, e, d) => bell.play(t, e.note, d, e.vel) },
        glint: { layer: "texture", humanize: { timing: 0.01, vel: 0.08 }, play: (t, e, d) => glint.play(t, e.note, d, e.vel) },
        bed: { layer: "texture", humanize: { timing: 0.02 }, play: (t, e, d) => bed.play(t, e.note, d, e.vel) },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, cl, f, nf, off, last } = W;
      const L = lap % 3;
      const key = `${lap}:${W.i}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...plan(f, lap, r.fork(7 + lap)) };
      const P = state.plan;
      if (state.bassLast == null) Object.assign(state, { bassLast: 38, nyV: null, chV: null, bedV: null });
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beats from this cycle's start
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      const id = f.id, intro = id === "intro", link = id === "link", mid = id === "M", tail = id === "tail", isA = id === "A1" || id === "A2";
      const chordAt = T.chordAtFactory(P.prog, BPB);
      const chordsHere = P.prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const symAt = (abs) => chordAt(clamp(s0 + abs, 0, f.bars * BPB - 0.01)).chord;

      // ---------- the hand-written lines: this cycle's window (the last half beat belongs to the next cycle as a pickup) ----------
      const lo = s0 - 0.5, hi = last ? s1 : s1 - 0.5;
      for (const line of P.lines) {
        for (const e of line.events) {
          const abs = e.bar * BPB + e.beat;
          if (abs < lo - 1e-6 || abs >= hi - 1e-6) continue;
          const rel = abs - s0, bar = Math.floor(rel / BPB + 1e-9);
          const { art, phrase, ...rest } = e;
          ev.push({ ...rest, track: line.track, bar, beat: +(rel - bar * BPB).toFixed(4), vel: clamp(e.vel ?? 0.6, 0.05, 1) });
        }
      }
      const singing = (track) => P.lines.some((l) => l.track === track && l.events.some((e) => { const a = e.bar * BPB + e.beat; return a < s1 && a + e.dur > s0; }));
      const mandolinSings = singing("mandolin") && !tail && !(id === "A2");

      // ---------- concertina left hand ----------
      chordsHere.forEach((h) => {
        const abs = h.bar * BPB + h.beat, bar = off + h.bar;
        if (intro && lap === 0 && bar < 2) return;
        const v = T.voice(h.chord, { lo: 55, hi: 67, n: 3, rootless: true, omitBass: true, prev: state.chV, top: [60, 67], rng: r });
        state.chV = v;
        const base = intro || tail || link ? 0.28 : id === "A2" ? 0.33 : 0.3;
        if (mid || mandolinSings) { push("chords", abs, Math.min(1.3, h.dur - 0.2), v, base); if (h.dur >= 3) push("chords", abs + 1.5, 1.2, v, base - 0.04); }
        else push("chords", abs, h.dur - 0.3, v, base);
      });

      // ---------- nylon guitar: the water ----------
      const nylonV = (sym) => {
        const c = T.chord(sym);
        const v = T.voice(c, { lo: 55, hi: 74, n: c.intervals.length >= 4 ? 4 : 3, rootless: false, omitBass: true, prev: state.nyV, top: [64, 74], rng: r });
        state.nyV = v;
        const s = v.slice().sort((a, b) => a - b), k = s.length;
        while (s.length < 4) { // a triad gets a fourth string: its octave on top, or below when that would sit over the tune
          const up = s[s.length - k] + 12;
          if (up <= 76) s.push(up); else s.unshift(s[s.length - 1] - 12);
        }
        return s.sort((a, b) => a - b);
      };
      const ROLL = [0, 1, 2, -1, 2, 1], ROLL_V = [0.58, 0.4, 0.46, 0.5, 0.4, 0.44];
      const ring = (b) => Math.min(1.2, BPB - b + 0.05); // strings ring to the bar line, then the hand damps them
      const nylonSound = []; // what the guitar has sounding, for the bass's approach notes
      for (let i = 0; i < CB; i++) {
        const B = i * BPB, bar = off + i;
        const seq = nylonV(symAt(B));
        const at = (k) => seq[k < 0 ? seq.length + k : Math.min(k, seq.length - 1)];
        const quiet = intro || tail || link;
        const strum = id === "A2" && bar >= 8 && !(bar === 15);
        const final = id === "A2" && bar === 15;
        const ny = (b, dur, note, vel, extra) => { push("nylon", B + b, dur, note, vel, extra); arr(note).forEach((m) => nylonSound.push({ a: B + b, b: B + b + dur, m })); };
        if (final) { ny(0, 2.8, seq, 0.5, { strum: 0.014 }); continue; }
        if (tail && bar < 4) { [[0, 0, 0.5], [1.5, -1, 0.42], [2.5, 1, 0.34]].forEach(([b, k, v]) => ny(b, Math.min(0.9, ring(b)), at(k), v + r.range(-0.02, 0.02))); continue; }
        if (strum) {
          ny(0, 1.4, seq, 0.46, { strum: 0.012 }); ny(1, 0.5, seq.slice(-2), 0.3, { strum: -0.008 });
          ny(1.5, 1.4, seq, 0.42, { strum: 0.012 }); ny(2.5, 0.5, seq.slice(-2), 0.32, { strum: -0.008 });
          continue;
        }
        const early = id === "A1" && bar < 8 && !mandolinSings;
        if (early || (quiet && (tail ? bar >= 4 : true) && r.chance(tail && bar >= 6 ? 0.9 : 0.45))) { // the pulse pattern: bass, a middle string, the top, a middle
          [[0, 0, 0.54], [1, 2, 0.4], [1.5, -1, 0.46], [2.5, 1, 0.36]].forEach(([b, k, v]) => ny(b, ring(b), at(k), v + r.range(-0.02, 0.02)));
          continue;
        }
        ROLL.forEach((k, e) => {
          if (tail && bar === 7 && e >= 4) return;
          ny(e * 0.5, ring(e * 0.5), at(k), ROLL_V[e] * (quiet ? 0.88 : 1) + r.range(-0.02, 0.02));
        });
      }

      // ---------- bass: roots on the pulse, the fifth now and then; it walks only in the middle ----------
      const near = (pc, from, lo2 = 36, hi2 = 50) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo2, hi2)) { const s = Math.abs(m - from) + 0.25 * Math.abs(m - 42); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const nextRootPc = (i) => {
        if (i + 1 < chordsHere.length) return T.chord(chordsHere[i + 1].chord).bass;
        if (!last) return T.chord(P.prog.find((h) => h.bar === off + CB).chord).bass;
        return T.chord(progOf(nf)[0].chord).bass;
      };
      const melodySound = ev.filter((e) => e.track !== "bass" && e.track !== "drums").flatMap((e) => arr(e.note).map((m) => ({ a: e.bar * BPB + e.beat, b: e.bar * BPB + e.beat + e.dur, m })));
      const rubs = (m, t) => nylonSound.concat(melodySound).some((x) => x.a < t + 0.45 && x.b > t + 0.05 && Math.abs(x.m - m) % 12 === 1);
      let lastB = state.bassLast, prevB = null;
      chordsHere.forEach((h, i) => {
        const s = h.bar * BPB + h.beat, d = h.dur, c = T.chord(h.chord), bar = off + h.bar;
        if (intro && lap === 0 && bar < 3) return;
        const R = near(c.bass, lastB);
        const F5 = near(mod12(c.root + 7), R, 36, 50);
        const third = c.intervals.includes(3) || c.intervals.includes(4) ? near(mod12(c.root + (c.intervals.includes(3) ? 3 : 4)), R + 3, 38, 52) : F5;
        const N = near(nextRootPc(i), R);
        const approach = (b) => { // the note before the next root: a step from the side the line travels, or the fifth
          const t = s + b;
          const side = N === R ? [] : N > R ? [[N - 1, 2], [N - 2, 1.4]] : [[N + 1, 1.6], [N + 2, 1.4]];
          const cands = side.concat([[F5, 0.8], [R + 12 <= 50 ? R + 12 : F5, 0.5]]).filter(([m]) => m >= 36 && m <= 50 && m !== R && m !== prevB && !rubs(m, t));
          return cands.length ? r.weighted(cands) : rubs(F5, t) ? R : F5;
        };
        const add = (b, dur, n, v) => { if (b < d - 0.01) { push("bass", s + b, Math.min(dur, d - b - 0.05), n, v + r.range(-0.02, 0.02)); prevB = n; } };
        if (d < 3) { add(0, 1.3, R, 0.74); }
        else if (mid) { // the walk: root, a chord tone on the second pulse, a step into the next root; every fourth bar in quarters
          if (bar % 4 === 3) { add(0, 0.9, R, 0.78); add(1, 0.9, third, 0.62); add(2, 0.9, approach(2), 0.66); }
          else { add(0, 1.3, R, 0.78); add(1.5, 0.9, r.chance(0.6) ? F5 : third, 0.62); add(2.5, 0.45, approach(2.5), 0.6); }
        } else if (tail && bar >= 6) add(0, 2.8, R, 0.62);
        else if (tail && bar >= 4) { add(0, 2.6, R, 0.66); }
        else if (intro || link) { add(0, 2.6, R, 0.68); if (link && bar === 3) add(2, 0.9, approach(2), 0.58); }
        else { // the A sections: a soft two-feel
          add(0, 1.4, R, 0.72);
          if (bar % 2 === 1 && r.chance(0.6)) add(1.5, 1.1, F5, 0.52);
          else if (r.chance(0.3)) add(1.5, 1.2, R, 0.5);
          if (bar % 4 === 3 && N !== R && r.chance(0.5)) add(2.5, 0.45, approach(2.5), 0.5);
        }
        lastB = R;
      });
      state.bassLast = clamp(lastB, 36, 50);

      // ---------- frame drum heartbeat, bell accents ----------
      const H = (abs, voice, v, extra) => push("drums", abs, 0.25, voice, v, extra);
      const dw = 1 + 0.04 * Math.min(2, lap);
      for (let i = 0; i < CB; i++) {
        const B = i * BPB, bar = off + i, odd = bar % 2 === 1;
        const lub = (v) => { H(B, "dum", v * dw, { pitch: 45 }); H(B + 0.5, "dum", v * 0.55, { pitch: 45 }); H(B + 1.5, "dum", v * 0.8, { pitch: 45 }); };
        const tone = (b, v) => H(B + b, "djembe", v, { pitch: 58 });
        const tip = (b, v) => H(B + b, "djembe", v, { pitch: 63 });
        const slap = (b, v) => H(B + b, "djembe", v, { pitch: 68 });
        const tri = (b, v) => H(B + b, "triangle", v);
        if (intro) { if (bar >= 2 || lap > 0) lub(0.5); if (bar === 3) tone(2.5, 0.28); continue; }
        if (link) { lub(0.52); if (bar === 3) { tone(1, 0.26); tone(2, 0.32); slap(2.5, 0.4); } continue; }
        if (id === "A1") { lub(0.56); if (odd) tone(2.5, 0.3); if (bar === 7 || bar === 15) { tone(2, 0.28); tone(2.5, 0.34); } if (bar === 15) tri(1.5, 0.26); continue; }
        if (mid) {
          lub(0.6); tip(1, 0.22); tone(2.5, 0.32); if (odd) tip(2, 0.2);
          if (bar % 4 === 3 && r.chance(0.7)) tri(1.5, 0.28);
          if (bar === 15) { tone(1.5, 0.3); tone(2, 0.34); slap(2.5, 0.42); }
          continue;
        }
        if (id === "A2") {
          if (bar === 15) { H(B, "dum", 0.7, { pitch: 45 }); continue; } // the landing
          lub(0.62); tone(2.5, 0.34); tip(1, 0.24); if (bar >= 8) tip(2, 0.2);
          if (bar % 4 === 3) tri(1.5, 0.3);
          if (bar === 7 && r.chance(0.6)) { tone(2, 0.3); slap(2.5, 0.38); }
          continue;
        }
        // tail: the heartbeat thins
        if (bar < 4) lub(0.5);
        else if (bar < 6) { H(B, "dum", 0.46, { pitch: 45 }); H(B + 1.5, "dum", 0.32, { pitch: 45 }); }
        else H(B, "dum", bar === 7 ? 0.36 : 0.42, { pitch: 45 });
      }
      // the harbour bell at the big entrances and on the landing
      if (W.first && (id === "A1" || mid || id === "A2")) push("bell", 0, 6, 62, mid ? 0.26 : 0.3);
      if (id === "A2" && last) push("bell", 9, 6, 57, 0.32);

      // ---------- first light: celesta glints and a glass bed in the quiet sections ----------
      if (intro || link || tail) {
        for (let i = 0; i < CB; i++) {
          const B = i * BPB, bar = off + i;
          if (tail && bar < 4) continue;
          if (!r.chance(0.5)) continue;
          const c = T.chord(symAt(B));
          const pool = T.notesIn(c.intervals.filter((iv) => [0, 4, 7, 9, 14].includes(iv)).map((iv) => mod12(c.root + iv)), 84, 96);
          if (!pool.length) continue;
          const n1 = r.pick(pool), b1 = r.pick([1, 1.5, 2]);
          push("glint", B + b1, Math.min(1.5, BPB - b1), n1, 0.3);
          if (r.chance(0.4)) push("glint", B + b1 + 0.5, Math.min(1.2, BPB - b1 - 0.5), T.nearest(n1 + (r.chance(0.5) ? 4 : -3), c.pcs, 84, 96), 0.24);
        }
        chordsHere.forEach((h) => {
          if (h.dur < 3 || (tail && off + h.bar < 4)) return;
          const v = T.voice(h.chord, { lo: 72, hi: 86, n: 2, rootless: true, omitBass: true, prev: state.bedV, rng: r });
          state.bedV = v;
          push("bed", h.bar * BPB + 0.25, h.dur - 0.5, v, tail && off + h.bar >= 6 ? 0.22 : 0.27);
        });
      }

      // ---------- feel ----------
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          nylon: { template: SWAY, late: 3 },
          bass: { template: SWAY, late: 2, vels: false },
          drums: { voices: { dum: { template: SWAY, amount: 0.5 }, djembe: { template: SWAY, late: -2 }, triangle: "straight" } },
          chords: { template: "straight", late: 15, vels: false },
        },
      });
      ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: 0.65, linger: "high", lingerMs: 50, gap: 0.75, rng: r });
      ev = G.rubato(ev, { track: "whistle", bpm: BPM, bpb: BPB, amount: 0.8, linger: "high", lingerMs: 55, gap: 0.75, rng: r });
      // mandolin tremolo: a long note becomes a run of sextuplet plucks that swell and fade
      const trem = [];
      ev = ev.filter((e) => {
        if (e.track !== "mandolin" || !e.trem || e.dur < 1.2) return true;
        const n = Math.max(4, Math.floor(e.dur / (1 / 6)));
        const abs = e.bar * BPB + e.beat;
        for (let k = 0; k < n; k++) {
          const u = k / (n - 1);
          const bar = Math.floor((abs + k / 6) / BPB + 1e-9);
          trem.push({ ...e, bar, beat: +(abs + k / 6 - bar * BPB).toFixed(4), dur: 0.3, vel: clamp(e.vel * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, u * 1.2))), 0.05, 1), trem: undefined, norubato: true });
        }
        return false;
      }).concat(trem);

      return { events: ev, harmony: chordsHere, section: `Lap ${lap + 1} · ${P.label}`, state, tempo: tempoAt(cl) };
    },
  });
})();
